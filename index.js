const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURACIÓN DE TELEGRAM ---
const TELEGRAM_TOKEN = '8960091089:AAHQHEqEWh6Pli3yJDupRGInRL06qOq3iRg';
const TELEGRAM_CHAT_ID = '7996171093';

// Base de datos de posiciones en memoria
let dispositivos = {};

// --- BASE DE DATOS DE USUARIOS Y CONFIGURACIÓN PERSONALIZADA DE ALERTAS ---
// Puedes asignar múltiples dispositivos a una sola cuenta en la lista "dispositivos"
const USUARIOS = {
    "admin": {
        password: "admin123",
        dispositivos: ["*"], // "*" ve TODOS los dispositivos de la plataforma
        alertas: {
            velocidadMax: 80,
            geocerca: { lat: 19.4326, lon: -99.1332, radioKm: 10 }
        }
    },
    "cliente1": {
        password: "pass123",
        // Un usuario puede ver múltiples vehículos asignados en este arreglo:
        dispositivos: ["dispositivo uno", "dispositivo dos"],
        alertas: {
            velocidadMax: 90, // Límite de velocidad personalizado para este cliente (km/h)
            geocerca: { lat: 19.5367, lon: -99.1945, radioKm: 5 } // Geocerca personalizada
        }
    }
};

// Función Haversine para calcular distancia entre dos coordenadas (en Km)
function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Función para enviar notificaciones a Telegram
async function enviarAlertaTelegram(mensaje) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: mensaje,
            parse_mode: 'Markdown'
        });
        console.log('Alerta enviada a Telegram');
    } catch (error) {
        console.error('Error enviando alerta a Telegram:', error.message);
    }
}

// --- RUTA API: DEVUELVE LOS DISPOSITIVOS AUTORIZADOS DEL USUARIO ---
app.get('/api/ubicacion-actual', (req, res) => {
    const usuarioQuery = req.query.user;
    const passQuery = req.query.pass;

    if (!usuarioQuery || !USUARIOS[usuarioQuery] || USUARIOS[usuarioQuery].password !== passQuery) {
        return res.status(401).json({ error: "Acceso no autorizado" });
    }

    const permisos = USUARIOS[usuarioQuery].dispositivos;

    // Si es administrador, recibe la flota completa
    if (permisos.includes("*")) {
        return res.json(dispositivos);
    }

    // Filtra únicamente los vehículos que le pertenecen al usuario
    let filtrados = {};
    permisos.forEach(devId => {
        if (dispositivos[devId]) {
            filtrados[devId] = dispositivos[devId];
        }
    });

    res.json(filtrados);
});

// --- RUTA PRINCIPAL: PANTALLA DE LOGIN Y MAPA EN VIVO ---
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Plataforma de Monitoreo GPS</title>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <style>
            body { margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f6f9; }
            #login-box {
                max-width: 320px; margin: 80px auto; padding: 25px;
                background: white; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                text-align: center;
            }
            #login-box input {
                width: 90%; padding: 10px; margin: 8px 0;
                border: 1px solid #ccc; border-radius: 5px; font-size: 14px;
            }
            #login-box button {
                width: 95%; padding: 10px; background: #007bff; color: white;
                border: none; border-radius: 5px; font-size: 15px; cursor: pointer; font-weight: bold;
            }
            #login-box button:hover { background: #0056b3; }
            #map-container { display: none; width: 100vw; height: 100vh; position: relative; }
            #map { width: 100%; height: 100%; }
            .info-panel {
                position: absolute; top: 10px; left: 10px; z-index: 1000;
                background: rgba(255, 255, 255, 0.95); padding: 12px 16px;
                border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                max-width: 280px; max-height: 40vh; overflow-y: auto;
            }
            .info-panel h3 { margin: 0 0 8px 0; font-size: 15px; color: #333; }
            .dev-card { border-bottom: 1px solid #ddd; padding: 6px 0; font-size: 12px; }
            .logout-btn {
                margin-top: 8px; padding: 5px 10px; background: #dc3545; color: white;
                border: none; border-radius: 4px; cursor: pointer; font-size: 11px;
            }
        </style>
    </head>
    <body>

        <!-- PANTALLA DE ACCESO -->
        <div id="login-box">
            <h2>📍 Rastreo GPS</h2>
            <p style="font-size: 13px; color: #666;">Ingresa tus credenciales para acceder</p>
            <input type="text" id="username" placeholder="Usuario" />
            <input type="password" id="password" placeholder="Contraseña" />
            <button onclick="iniciarSesion()">Ingresar</button>
            <p id="error-msg" style="color: red; font-size: 12px; display: none; margin-top: 10px;">Usuario o contraseña incorrectos</p>
        </div>

        <!-- MAPA Y PANEL FLOTANTE -->
        <div id="map-container">
            <div class="info-panel">
                <h3>🚗 Vehículos Monitoreados</h3>
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

            if (currentUser && currentPass) {
                mostrarMapa();
            }

            async function iniciarSesion() {
                const u = document.getElementById('username').value;
                const p = document.getElementById('password').value;

                const res = await fetch(\`/api/ubicacion-actual?user=\${u}&pass=\${p}\`);
                if (res.ok) {
                    localStorage.setItem('gps_user', u);
                    localStorage.setItem('gps_pass', p);
                    currentUser = u;
                    currentPass = p;
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
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                        attribution: '© OpenStreetMap'
                    }).addTo(map);
                }

                actualizarMapa();
                setInterval(actualizarMapa, 10000);
            }

            async function actualizarMapa() {
                try {
                    const res = await fetch(\`/api/ubicacion-actual?user=\${currentUser}&pass=\${currentPass}\`);
                    if (!res.ok) {
                        cerrarSesion();
                        return;
                    }
                    const data = await res.json();
                    let htmlList = '';
                    const devIds = Object.keys(data);

                    if (devIds.length === 0) {
                        document.getElementById('lista-dispositivos').innerHTML = '<p style="font-size:12px;">Esperando posición del vehículo...</p>';
                        return;
                    }

                    devIds.forEach(id => {
                        const dev = data[id];
                        const latLng = [Number(dev.lat), Number(dev.lon)];

                        // Si existe el marcador se actualiza, si no se crea
                        if (markers[id]) {
                            markers[id].setLatLng(latLng);
                        } else {
                            markers[id] = L.marker(latLng).addTo(map);
                        }

                        markers[id].bindPopup("<b>" + id + "</b><br>Velocidad: " + dev.speed + " km/h<br>Batería: " + dev.batt + "%");

                        htmlList += "<div class='dev-card'>" +
                            "<b>" + id + "</b><br>" +
                            "Velocidad: " + dev.speed + " km/h | Batería: " + dev.batt + "%<br>" +
                            "Hora: " + dev.fecha +
                            "</div>";
                    });

                    document.getElementById('lista-dispositivos').innerHTML = htmlList;
                } catch (e) {
                    console.error("Error al actualizar mapa:", e);
                }
            }
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// --- ENDPOINT RECEPTOR DE TRACCAR CLIENT / DISPOSITIVOS ---
app.post('/api/posicion', (req, res) => {
    const id = req.query.id || req.body.id || 'Vehiculo_Desconocido';
    const lat = req.query.lat || req.body.lat;
    const lon = req.query.lon || req.body.lon;
    const speed = req.query.speed || req.body.speed || 0;
    const batt = req.query.batt || req.body.batt;

    const velocidadKmH = Math.round(speed * 1.852);

    if (lat && lon) {
        dispositivos[id] = {
            lat: Number(lat),
            lon: Number(lon),
            speed: velocidadKmH,
            batt: batt ? Number(batt) : '--',
            fecha: new Date().toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City' })
        };
    }

    // --- EVALUACIÓN DE ALERTAS PERSONALIZADAS POR USUARIO/DUEÑO ---
    Object.keys(USUARIOS).forEach(username => {
        const usuario = USUARIOS[username];
        const tienePermiso = usuario.dispositivos.includes("*") || usuario.dispositivos.includes(id);

        if (tienePermiso) {
            // 1. Alerta de Velocidad personalizada
            const limiteVelocidad = usuario.alertas?.velocidadMax || 80;
            if (velocidadKmH > limiteVelocidad) {
                enviarAlertaTelegram(`⚠️ *ALERTA DE VELOCIDAD*\nDispositivo: *${id}*\nVelocidad: *${velocidadKmH} km/h* (Límite: ${limiteVelocidad} km/h)\n📍 [Ver en Mapa](https://www.google.com/maps?q=${lat},${lon})`);
            }

            // 2. Alerta de Geocerca/Zona personalizada
            if (lat && lon && usuario.alertas?.geocerca) {
                const geo = usuario.alertas.geocerca;
                const distancia = calcularDistanciaKm(geo.lat, geo.lon, Number(lat), Number(lon));
                if (distancia > geo.radioKm) {
                    enviarAlertaTelegram(`📍 *ALERTA DE GEOCERCA (FUERA DE ZONA)*\nDispositivo: *${id}*\nDistancia de la zona: *${distancia.toFixed(1)} km* (Máximo: ${geo.radioKm} km)\n📍 [Ver en Mapa](https://www.google.com/maps?q=${lat},${lon})`);
                }
            }
        }
    });

    // 3. Alerta de Movimiento Nocturno (11:00 PM a 5:00 AM)
    const horaActual = new Date().getHours();
    if (horaActual >= 23 || horaActual <= 5) {
        enviarAlertaTelegram(`🚨 *MOVIMIENTO NOCTURNO*\nDispositivo: *${id}*\nHora: ${horaActual}:00 hrs\n📍 [Ver en Mapa](https://www.google.com/maps?q=${lat},${lon})`);
    }

    // 4. Alerta de Batería Baja
    if (batt && Number(batt) <= 15) {
        enviarAlertaTelegram(`🔋 *BATERÍA BAJA:* El dispositivo *${id}* tiene *${batt}%* de carga.`);
    }

    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor GPS iniciado en puerto ${PORT}`));
