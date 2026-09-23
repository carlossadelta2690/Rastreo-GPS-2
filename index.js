const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- BASE DE DATOS LOCAL (SQLITE3) ---
const db = new sqlite3.Database('gps_local.db');

// Inicializar tablas en la base de datos
db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS usuarios (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        dispositivos TEXT NOT NULL,
        velocidad_max INTEGER DEFAULT 80
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS dispositivos (
        deviceId TEXT PRIMARY KEY,
        lat REAL,
        lon REAL,
        speed INTEGER,
        batt TEXT,
        fecha TEXT,
        last_updated INTEGER,
        alerta_desconexion_enviada INTEGER DEFAULT 0
      )
    `);

    // Crear usuario admin si no existe
    db.get('SELECT * FROM usuarios WHERE username = ?', ['admin'], (err, row) => {
        if (!row) {
            db.run('INSERT INTO usuarios (username, password, dispositivos, velocidad_max) VALUES (?, ?, ?, ?)', ['admin', 'admin123', '*', 80]);
            console.log('✅ Usuario admin creado (admin / admin123)');
        }
    });
});

// --- CONFIGURACIÓN DE TELEGRAM ---
const TELEGRAM_TOKEN = '8960091089:AAHQHEqEWh6Pli3yJDupRGInRL06qOq3iRg';
const TELEGRAM_CHAT_ID = '7996171093';

async function enviarAlertaTelegram(mensaje) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    try {
        await axios.post(url, { chat_id: TELEGRAM_CHAT_ID, text: mensaje, parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error enviando alerta a Telegram:', error.message);
    }
}

// --- MONITOREO DE PÉRDIDA DE SEÑAL GPS (CADA MINUTO) ---
const TIEMPO_LIMITE_SIN_SEÑAL_MS = 5 * 60 * 1000;

setInterval(() => {
    const ahora = Date.now();
    db.all('SELECT * FROM dispositivos WHERE alerta_desconexion_enviada = 0', [], (err, rows) => {
        if (err || !rows) return;
        rows.forEach(dev => {
            if (dev.last_updated && (ahora - dev.last_updated) > TIEMPO_LIMITE_SIN_SEÑAL_MS) {
                enviarAlertaTelegram(`📡 *ALERTA: PÉRDIDA DE SEÑAL*\nEl dispositivo *${dev.deviceId}* lleva más de 5 minutos sin reportar ubicación.\nÚltimo reporte: ${dev.fecha}`);
                db.run('UPDATE dispositivos SET alerta_desconexion_enviada = 1 WHERE deviceId = ?', [dev.deviceId]);
            }
        });
    });
}, 60000);

// --- PANEL ADMIN PARA REGISTRAR USUARIOS ---
app.get('/panel-admin', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8"><title>Panel Admin - Gestión de Clientes</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 20px; background: #f0f2f5; }
            .box { max-width: 450px; background: white; padding: 25px; border-radius: 8px; margin: auto; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            input { width: 92%; padding: 8px; margin: 8px 0; display: block; border: 1px solid #ccc; border-radius: 4px; }
            button { width: 97%; padding: 10px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-top: 10px; }
            button:hover { background: #218838; }
            .hint { font-size: 11px; color: #666; margin-bottom: 10px; }
        </style>
    </head>
    <body>
        <div class="box">
            <h2>➕ Registrar Nuevo Cliente</h2>
            <form action="/api/crear-usuario-form" method="POST">
                <label><b>Contraseña del Admin:</b></label>
                <input type="password" name="adminPass" placeholder="Tu clave admin" required />
                <hr>
                <label><b>Usuario del Cliente:</b></label>
                <input type="text" name="username" placeholder="Ej. cliente2" required />
                <label><b>Contraseña del Cliente:</b></label>
                <input type="text" name="password" placeholder="Ej. clave123" required />
                <label><b>Dispositivos Asignados:</b></label>
                <input type="text" name="dispositivos" placeholder="Ej. dispositivo uno, Unidad 2" required />
                <div class="hint">Nombres exactos separados por coma.</div>
                <label><b>Límite de Velocidad (km/h):</b></label>
                <input type="number" name="velocidad_max" value="80" required />
                <button type="submit">Guardar Cliente</button>
            </form>
        </div>
    </body>
    </html>
    `);
});

// Procesador del formulario de administración
app.post('/api/crear-usuario-form', (req, res) => {
    const { adminPass, username, password, dispositivos, velocidad_max } = req.body;

    db.get('SELECT * FROM usuarios WHERE username = "admin"', [], (err, admin) => {
        if (!admin || admin.password !== adminPass) {
            return res.status(401).send('<h3>❌ Contraseña de Administrador incorrecta</h3><a href="/panel-admin">Volver</a>');
        }

        db.run('INSERT INTO usuarios (username, password, dispositivos, velocidad_max) VALUES (?, ?, ?, ?)', 
            [username, password, dispositivos, velocidad_max || 80], 
            function(err) {
                if (err) {
                    return res.send(`<h3>❌ Error: El nombre de usuario ya existe.</h3><a href="/panel-admin">Volver</a>`);
                }
                res.send(`<h3>✅ Cliente '${username}' creado con éxito.</h3><p>Unidades asignadas: ${dispositivos}</p><a href="/">Ir al Mapa</a> | <a href="/panel-admin">Agregar otro</a>`);
            }
        );
    });
});

// --- RUTA API: CONSULTA UBICACIONES PERMITIDAS ---
app.get('/api/ubicacion-actual', (req, res) => {
    const u = req.query.user;
    const p = req.query.pass;

    db.get('SELECT * FROM usuarios WHERE username = ? AND password = ?', [u, p], (err, usuario) => {
        if (!usuario) {
            return res.status(401).json({ error: "No autorizado" });
        }

        if (usuario.dispositivos === '*') {
            db.all('SELECT * FROM dispositivos', [], (err, filas) => {
                let resultado = {};
                (filas || []).forEach(dev => {
                    resultado[dev.deviceId] = { lat: dev.lat, lon: dev.lon, speed: dev.speed, batt: dev.batt, fecha: dev.fecha };
                });
                res.json(resultado);
            });
        } else {
            const listaDevs = usuario.dispositivos.split(',').map(d => d.trim());
            const placeholders = listaDevs.map(() => '?').join(',');
            db.all(`SELECT * FROM dispositivos WHERE deviceId IN (${placeholders})`, listaDevs, (err, filas) => {
                let resultado = {};
                (filas || []).forEach(dev => {
                    resultado[dev.deviceId] = { lat: dev.lat, lon: dev.lon, speed: dev.speed, batt: dev.batt, fecha: dev.fecha };
                });
                res.json(resultado);
            });
        }
    });
});

// --- MAPA WEB EN VIVO CON LOGIN ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Plataforma de Monitoreo GPS</title>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <style>
            body { margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f6f9; }
            #login-box { max-width: 320px; margin: 80px auto; padding: 25px; background: white; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); text-align: center; }
            #login-box input { width: 90%; padding: 10px; margin: 8px 0; border: 1px solid #ccc; border-radius: 5px; }
            #login-box button { width: 95%; padding: 10px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
            #map-container { display: none; width: 100vw; height: 100vh; position: relative; }
            #map { width: 100%; height: 100%; }
            .info-panel { position: absolute; top: 10px; left: 10px; z-index: 1000; background: rgba(255, 255, 255, 0.95); padding: 12px 16px; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.3); max-width: 280px; }
            .dev-card { border-bottom: 1px solid #ddd; padding: 6px 0; font-size: 12px; }
            .logout-btn { margin-top: 8px; padding: 5px 10px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; }
        </style>
    </head>
    <body>
        <div id="login-box">
            <h2>📍 Rastreo GPS</h2>
            <p style="font-size: 13px; color: #666;">Ingresa tus credenciales</p>
            <input type="text" id="username" placeholder="Usuario" />
            <input type="password" id="password" placeholder="Contraseña" />
            <button onclick="iniciarSesion()">Ingresar</button>
            <p id="error-msg" style="color: red; font-size: 12px; display: none; margin-top: 10px;">Credenciales incorrectas</p>
        </div>

        <div id="map-container">
            <div class="info-panel">
                <h3>🚗 Vehículos Asignados</h3>
                <div id="lista-dispositivos">Cargando...</div>
                <button class="logout-btn" onclick="cerrarSesion()">Cerrar Sesión</button>
            </div>
            <div id="map"></div>
        </div>

        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
            let currentUser = localStorage.getItem('gps_user');
            let currentPass = localStorage.getItem('gps_pass');
            let map, markers = {};

            if (currentUser && currentPass) mostrarMapa();

            async function iniciarSesion() {
                const u = document.getElementById('username').value;
                const p = document.getElementById('password').value;
                const res = await fetch(\`/api/ubicacion-actual?user=\${u}&pass=\${p}\`);
                if (res.ok) {
                    localStorage.setItem('gps_user', u);
                    localStorage.setItem('gps_pass', p);
                    currentUser = u; currentPass = p;
                    mostrarMapa();
                } else {
                    document.getElementById('error-msg').style.display = 'block';
                }
            }

            function cerrarSesion() {
                localStorage.removeItem('gps_user');
                localStorage.removeItem('gps_pass');
                location.reload();
            }

            function mostrarMapa() {
                document.getElementById('login-box').style.display = 'none';
                document.getElementById('map-container').style.display = 'block';
                if (!map) {
                    map = L.map('map').setView([19.4326, -99.1332], 12);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                }
                actualizarMapa();
                setInterval(actualizarMapa, 10000);
            }

            async function actualizarMapa() {
                try {
                    const res = await fetch(\`/api/ubicacion-actual?user=\${currentUser}&pass=\${currentPass}\`);
                    if (!res.ok) { cerrarSesion(); return; }
                    const data = await res.json();
                    let htmlList = '';
                    const devIds = Object.keys(data);

                    if (devIds.length === 0) {
                        document.getElementById('lista-dispositivos').innerHTML = '<p style="font-size:12px;">Esperando señal del vehículo...</p>';
                        return;
                    }

                    devIds.forEach(id => {
                        const dev = data[id];
                        const latLng = [Number(dev.lat), Number(dev.lon)];
                        if (markers[id]) markers[id].setLatLng(latLng);
                        else markers[id] = L.marker(latLng).addTo(map);

                        markers[id].bindPopup("<b>" + id + "</b><br>Velocidad: " + dev.speed + " km/h");
                        htmlList += "<div class='dev-card'><b>" + id + "</b><br>Velocidad: " + dev.speed + " km/h | Batería: " + dev.batt + "%<br>Hora: " + dev.fecha + "</div>";
                    });
                    document.getElementById('lista-dispositivos').innerHTML = htmlList;
                } catch (e) { console.error(e); }
            }
        </script>
    </body>
    </html>
    `);
});

// --- RECEPCIÓN DE DATOS Y ALERTAS ---
app.post('/api/posicion', (req, res) => {
    const id = req.query.id || req.body.id || 'Vehiculo_Desconocido';
    const lat = req.query.lat || req.body.lat;
    const lon = req.query.lon || req.body.lon;
    const speed = req.query.speed || req.body.speed || 0;
    const batt = req.query.batt || req.body.batt;

    const velocidadKmH = Math.round(speed * 1.852);
    const fechaActual = new Date().toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City' });
    const ahora = Date.now();

    if (lat && lon) {
        db.get('SELECT alerta_desconexion_enviada FROM dispositivos WHERE deviceId = ?', [id], (err, dev) => {
            if (dev && dev.alerta_desconexion_enviada === 1) {
                enviarAlertaTelegram(`📶 *SEÑAL RESTABLECIDA*\nEl dispositivo *${id}* ha vuelto a transmitir correctamente.`);
            }

            db.run(`
                INSERT INTO dispositivos (deviceId, lat, lon, speed, batt, fecha, last_updated, alerta_desconexion_enviada)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0)
                ON CONFLICT(deviceId) DO UPDATE SET
                lat=excluded.lat, lon=excluded.lon, speed=excluded.speed, batt=excluded.batt, fecha=excluded.fecha, last_updated=excluded.last_updated, alerta_desconexion_enviada=0
            `, [id, Number(lat), Number(lon), velocidadKmH, batt || '--', fechaActual, ahora]);
        });
    }

    db.all('SELECT * FROM usuarios', [], (err, usuarios) => {
        if (!usuarios) return;
        usuarios.forEach(u => {
            const tieneAcceso = u.dispositivos === '*' || u.dispositivos.split(',').map(d => d.trim()).includes(id);
            if (tieneAcceso && velocidadKmH > u.velocidad_max) {
                enviarAlertaTelegram(`⚠️ *ALERTA DE VELOCIDAD*\nDispositivo: *${id}*\nVelocidad: *${velocidadKmH} km/h* (Límite: ${u.velocidad_max} km/h)\n📍 [Ver en Mapa](https://www.google.com/maps?q=${lat},${lon})`);
            }
        });
    });

    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor GPS operativo en puerto ${PORT}`));
