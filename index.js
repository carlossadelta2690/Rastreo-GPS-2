const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURACIÓN DE CORREO ELECTRÓNICO ---
const EMAIL_ADMIN = process.env.EMAIL_ADMIN || 'tu_correo@gmail.com'; 

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'tu_correo_emisor@gmail.com', 
        pass: process.env.EMAIL_PASS || 'xxxx xxxx xxxx xxxx'          
    }
});

async function enviarCorreoAlerta(asunto, mensajeHtml) {
    try {
        await transporter.sendMail({
            from: `"Sistema GPS" <${process.env.EMAIL_USER || 'tu_correo_emisor@gmail.com'}>`,
            to: EMAIL_ADMIN,
            subject: asunto,
            html: mensajeHtml
        });
        console.log('📧 Correo enviado con éxito');
    } catch (error) {
        console.error('❌ Error enviando correo:', error.message);
    }
}

// --- BASE DE DATOS LOCAL (SQLITE3) ---
const db = new sqlite3.Database('gps_local.db');

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
        last_moved INTEGER,
        alerta_desconexion_enviada INTEGER DEFAULT 0,
        alerta_detenido_enviada INTEGER DEFAULT 0
      )
    `);

    db.get('SELECT * FROM usuarios WHERE username = ?', ['admin'], (err, row) => {
        if (!row) {
            db.run('INSERT INTO usuarios (username, password, dispositivos, velocidad_max) VALUES (?, ?, ?, ?)', ['admin', 'admin123', '*', 80]);
            console.log('✅ Usuario admin creado (admin / admin123)');
        }
    });
});

// --- CONFIGURACIÓN DE TELEGRAM ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8960091089:AAHQHEqEWh6Pli3yJDupRGInRL06qOq3iRg';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7996171093';

async function enviarAlertaTelegram(mensaje) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    try {
        await axios.post(url, { 
            chat_id: TELEGRAM_CHAT_ID, 
            text: mensaje 
        });
        console.log('✅ Alerta entregada a Telegram con éxito');
    } catch (error) {
        if (error.response) {
            console.error('❌ Telegram rechazó la alerta:', error.response.data);
        } else {
            console.error('❌ Error de conexión con Telegram:', error.message);
        }
    }
}

// --- CONFIGURACIÓN DE TIEMPOS DE ALERTAS ---
const TIEMPO_LIMITE_SIN_SEÑAL_MS = 5 * 60 * 1000;    // 5 minutos sin reportar
const TIEMPO_LIMITE_DETENIDO_MS = 10 * 60 * 1000;     // 10 minutos estático

setInterval(() => {
    const ahora = Date.now();

    db.all('SELECT * FROM dispositivos', [], (err, rows) => {
        if (err || !rows) return;

        rows.forEach(dev => {
            // 1. Alerta de Pérdida de Señal
            if (dev.alerta_desconexion_enviada === 0 && dev.last_updated && (ahora - dev.last_updated) > TIEMPO_LIMITE_SIN_SEÑAL_MS) {
                const msjTelegram = `📡 ALERTA: PÉRDIDA DE SEÑAL\nEl dispositivo ${dev.deviceId} lleva más de 5 minutos sin reportar ubicación.\nÚltimo reporte: ${dev.fecha}`;
                
                enviarAlertaTelegram(msjTelegram);
                enviarCorreoAlerta(`📡 Pérdida de Señal - ${dev.deviceId}`, `<p>El dispositivo <b>${dev.deviceId}</b> lleva más de 5 minutos sin reportar ubicación.<br>Último reporte: ${dev.fecha}</p>`);

                db.run('UPDATE dispositivos SET alerta_desconexion_enviada = 1 WHERE deviceId = ?', [dev.deviceId]);
            }

            // 2. Alerta de Vehículo Detenido (+10 Minutos)
            if (dev.alerta_detenido_enviada === 0 && dev.last_moved && (ahora - dev.last_moved) > TIEMPO_LIMITE_DETENIDO_MS) {
                const urlMap = `https://www.google.com/maps?q=${dev.lat},${dev.lon}`;
                const msjTelegram = `🛑 ALERTA: VEHÍCULO DETENIDO\nEl dispositivo ${dev.deviceId} lleva más de 10 minutos estático.\n📍 Ubicación: ${urlMap}`;
                
                enviarAlertaTelegram(msjTelegram);
                enviarCorreoAlerta(`🛑 Vehículo Detenido (+10 min) - ${dev.deviceId}`, `<p>El dispositivo <b>${dev.deviceId}</b> lleva más de 10 minutos estático.<br><a href="${urlMap}">Ver en Google Maps</a></p>`);

                db.run('UPDATE dispositivos SET alerta_detenido_enviada = 1 WHERE deviceId = ?', [dev.deviceId]);
            }
        });
    });
}, 60000);

// Endpoint manual de auxilio / estado
app.post('/api/reportar-estado', (req, res) => {
    const { usuario, estado, lat, lon, dispositivo } = req.body;
    const urlMap = `https://www.google.com/maps?q=${lat},${lon}`;

    if (estado === 'SOS') {
        enviarAlertaTelegram(`🚨 ALERTA DE AUXILIO / SOS!\nEl usuario ${usuario} o unidad ${dispositivo || 'N/A'} solicita AYUDA INMEDIATA.\n📍 Ubicación: ${urlMap}`);
        enviarCorreoAlerta(`🚨 ALERTA SOS - ${usuario}`, `<p>El usuario <b>${usuario}</b> solicita AYUDA INMEDIATA.<br><a href="${urlMap}">Ver en Google Maps</a></p>`);
    } else if (estado === 'OK') {
        enviarAlertaTelegram(`✅ CONFIRMACIÓN DE ESTADO\nEl usuario ${usuario} reporta que TODO ESTÁ BIEN.\n📍 Ubicación: ${urlMap}`);
    }

    res.json({ status: "ok" });
});

// Panel Admin
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
                <label><b>Límite de Velocidad (km/h):</b></label>
                <input type="number" name="velocidad_max" value="80" required />
                <button type="submit">Guardar Cliente</button>
            </form>
        </div>
    </body>
    </html>
    `);
});

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
                res.send(`<h3>✅ Cliente '${username}' creado con éxito.</h3><p>Unidades asignadas: ${dispositivos}</p><a href="/">Ir al Mapa</a>`);
            }
        );
    });
});

// API Ubicaciones
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

// Mapa Web con Auto-limpieza de Alertas
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
            .btn-status { width: 100%; padding: 8px; margin-top: 6px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; color: white; font-size: 12px; }
            .btn-ok { background: #28a745; }
            .btn-sos { background: #dc3545; }
            .logout-btn { margin-top: 12px; padding: 5px 10px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; width: 100%; }
            #estado-banner { display: none; padding: 8px; font-size: 11px; border-radius: 4px; text-align: center; margin-top: 8px; font-weight: bold; }
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
                <div id="estado-banner"></div>
                <hr>
                <div style="text-align: center;">
                    <span style="font-size: 11px; font-weight: bold; color: #444;">Reportar Estado:</span>
                    <button class="btn-status btn-ok" onclick="enviarReporteEstado('OK')">✅ Todo está Bien</button>
                    <button class="btn-status btn-sos" onclick="enviarReporteEstado('SOS')">🚨 Solicitar Ayuda (SOS)</button>
                </div>
                <button class="logout-btn" onclick="cerrarSesion()">Cerrar Sesión</button>
            </div>
            <div id="map"></div>
        </div>

        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
            let currentUser = localStorage.getItem('gps_user');
            let currentPass = localStorage.getItem('gps_pass');
            let map, markers = {}, ultimasCoordenadas = { lat: 19.4326, lon: -99.1332 };

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
                        ultimasCoordenadas = { lat: dev.lat, lon: dev.lon, id: id };

                        if (markers[id]) markers[id].setLatLng(latLng);
                        else markers[id] = L.marker(latLng).addTo(map);

                        markers[id].bindPopup("<b>" + id + "</b><br>Velocidad: " + dev.speed + " km/h");
                        htmlList += "<div class='dev-card'><b>" + id + "</b><br>Velocidad: " + dev.speed + " km/h | Batería: " + dev.batt + "%<br>Hora: " + dev.fecha + "</div>";
                    });
                    document.getElementById('lista-dispositivos').innerHTML = htmlList;
                } catch (e) { console.error(e); }
            }

            async function enviarReporteEstado(tipo) {
                const msj = tipo === 'SOS' ? '¿Confirmas que deseas enviar una ALERTA DE AUXILIO (SOS)?' : '¿Confirmas reportar que TODO ESTÁ BIEN?';
                if (!confirm(msj)) return;

                await fetch('/api/reportar-estado', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        usuario: currentUser,
                        estado: tipo,
                        lat: ultimasCoordenadas.lat,
                        lon: ultimasCoordenadas.lon,
                        dispositivo: ultimasCoordenadas.id || 'Web'
                    })
                });

                const banner = document.getElementById('estado-banner');
                banner.style.display = 'block';

                if (tipo === 'OK') {
                    banner.style.background = '#d4edda';
                    banner.style.color = '#155724';
                    banner.innerText = '✅ Estado enviado: Todo bien';

                    setTimeout(() => {
                        banner.style.display = 'none';
                        banner.innerText = '';
                    }, 2000);
                } else {
                    banner.style.background = '#f8d7da';
                    banner.style.color = '#721c24';
                    banner.innerText = '🚨 Alerta SOS enviada';
                }
            }
        </script>
    </body>
    </html>
    `);
});

// Recepción de Posición
app.post('/api/posicion', (req, res) => {
    const id = req.query.id || req.body.id || 'Vehiculo_Desconocido';
    const lat = req.query.lat || req.body.lat;
    const lon = req.query.lon || req.body.lon;
    const speed = req.query.speed || req.body.speed || 0;
    const batt = req.query.batt || req.body.batt;
    const alarm = req.query.alarm || req.body.alarm;

    const velocidadKmH = Math.round(speed * 1.852);
    const fechaActual = new Date().toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City' });
    const ahora = Date.now();

    if (alarm && (alarm.toLowerCase() === 'sos' || alarm.toLowerCase() === 'panic')) {
        const urlMap = `https://www.google.com/maps?q=${lat},${lon}`;
        enviarAlertaTelegram(`🚨 ALERTA DE BOTÓN DE PÁNICO (SOS)!\nEl dispositivo ${id} ha presionado el botón de pánico.\n📍 Ubicación: ${urlMap}`);
        enviarCorreoAlerta(`🚨 BOTÓN DE PÁNICO - ${id}`, `<p>El dispositivo <b>${id}</b> presionó el botón de pánico.<br><a href="${urlMap}">Ver en Google Maps</a></p>`);
    }

    if (lat && lon) {
        const nuevaLat = Number(lat);
        const nuevaLon = Number(lon);

        db.get('SELECT * FROM dispositivos WHERE deviceId = ?', [id], (err, dev) => {
            let lastMoved = ahora;
            let resetDetenido = 0;

            if (dev) {
                if (dev.alerta_desconexion_enviada === 1) {
                    enviarAlertaTelegram(`📶 SEÑAL RESTABLECIDA\nEl dispositivo ${id} ha vuelto a transmitir correctamente.`);
                }

                const latDiferencia = Math.abs(dev.lat - nuevaLat);
                const lonDiferencia = Math.abs(dev.lon - nuevaLon);

                if (velocidadKmH > 3 || latDiferencia > 0.0005 || lonDiferencia > 0.0005) {
                    lastMoved = ahora;
                    resetDetenido = 0;
                } else {
                    lastMoved = dev.last_moved || ahora;
                    resetDetenido = dev.alerta_dete
