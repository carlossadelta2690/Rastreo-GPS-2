const express = require('express');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8960091089:AAHUDP3SN7Zc0L2xvPHzEef9EKE67LzEYU';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7996171093';


const CDMX_LAT = 19.4326;
const CDMX_LON = -99.1332;
const RADIO_MAXIMO_KM = 35;
const TIEMPO_DETENIDO_MAX_MINUTOS = 30;

let baseDatosGPS = {
    'dispositivo 1': {
        deviceId: 'dispositivo 1',
        usuarioAsignado: 'chofer',
        lat: 19.4326,
        lon: -99.1332,
        speed: 0,
        batt: '98%',
        estadoGeofence: 'Dentro de CDMX',
        ultimaActualizacion: new Date().toISOString(),
        inicioDetenido: new Date().getTime(),
        alertaSinMovimientoEnviada: false,
        alertaFueraGeocercaEnviada: false
    }
};

function calcularDistanciaKM(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function enviarNotificacionTelegram(texto) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    const payload = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: texto, parse_mode: 'HTML' });
    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    const req = https.request(options);
    req.on('error', (e) => console.error('Error Telegram:', e));
    req.write(payload);
    req.end();
}

app.all('/api/gps', (req, res) => {
    const data = { ...req.query, ...req.body };
    const id = data.id || data.deviceid || 'dispositivo 1';
    
    if (!baseDatosGPS[id]) {
        baseDatosGPS[id] = {
            deviceId: id,
            usuarioAsignado: 'Chofer',
            inicioDetenido: new Date().getTime(),
            alertaSinMovimientoEnviada: false,
            alertaFueraGeocercaEnviada: false
        };
    }

    const dev = baseDatosGPS[id];
    dev.lat = parseFloat(data.lat || dev.lat || CDMX_LAT);
    dev.lon = parseFloat(data.lon || dev.lon || CDMX_LON);
    const nuevaVelocidad = data.speed ? Math.round(parseFloat(data.speed) * 1.852) : 0;

    if (nuevaVelocidad === 0) {
        if (!dev.inicioDetenido) dev.inicioDetenido = new Date().getTime();
    } else {
        dev.inicioDetenido = null;
        dev.alertaSinMovimientoEnviada = false;
    }

    dev.speed = nuevaVelocidad;
    dev.batt = data.batt ? `${data.batt}%` : (dev.batt || 'N/A');
    dev.ultimaActualizacion = new Date().toISOString();

    res.send('OK');
});

app.post('/api/alerta', async (req, res) => {
    try {
        const { tipo, deviceId } = req.body;
        const dev = baseDatosGPS[deviceId] || { deviceId: 'dispositivo 1', usuarioAsignado: 'chofer', lat: CDMX_LAT, lon: CDMX_LON };
        const mapaUrl = `https://maps.google.com/?q=${dev.lat},${dev.lon}`;
        
        let msg = tipo === 'SOS' 
            ? `🚨 <b>ALERTA DE AUXILIO (SOS)</b>\n\n📌 <b>Unidad:</b> ${dev.deviceId}\n👤 <b>Usuario:</b> ${dev.usuarioAsignado}\n📍 <b>Ubicación:</b> ${mapaUrl}`
            : `✅ <b>ESTADO: TODO BIEN</b>\n\n📌 <b>Unidad:</b> ${dev.deviceId}\n👤 <b>Usuario:</b> ${dev.usuarioAsignado}\n📍 <b>Ubicación:</b> ${mapaUrl}`;

        await enviarNotificacionTelegram(msg);
        res.status(200).json({ status: 'ok', message: 'Alerta enviada' });
    } catch (error) {
        console.error('Error enviando alerta:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/api/unidades', (req, res) => res.json(Object.values(baseDatosGPS)));

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GPS Tracker</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        body { font-family: sans-serif; margin: 10px; background: #f0f2f5; }
        .card { background: white; padding: 15px; border-radius: 8px; margin-bottom: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .btn { width: 100%; padding: 12px; margin-top: 8px; border: none; border-radius: 5px; font-weight: bold; color: white; cursor: pointer; }
        .btn-sos { background: #e74c3c; } .btn-ok { background: #2ecc71; }
        #map { height: 350px; border-radius: 8px; margin-top: 10px; }
    </style>
</head>
<body>
    <h2>📡 Sistema de Rastreo GPS</h2>
    <div id="unidades">Cargando datos...</div>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
        const map = L.map('map').setView([19.4326, -99.1332], 10);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        let markers = {};

        async function update() {
            try {
                const res = await fetch('/api/unidades');
                const data = await res.json();
                let html = '';
                data.forEach(dev => {
                    const zona = dev.estadoGeofence || 'CDMX';
                    html += \`
                        <div class="card">
                            <h3>🚘 \${dev.deviceId}</h3>
                            <p>👤 Usuario: <b>\${dev.usuarioAsignado}</b></p>
                            <p>🔋 Batería: <b>\${dev.batt}</b> | ⚡ Vel: <b>\${dev.speed} km/h</b></p>
                            <p>📍 Zona: <b>\${zona}</b></p>
                            <button class="btn btn-sos" onclick="sendAlert('SOS', '\${dev.deviceId}')">🚨 SOLICITAR AYUDA (SOS)</button>
                            <button class="btn btn-ok" onclick="sendAlert('OK', '\${dev.deviceId}')">✅ TODO BIEN</button>
                        </div>
                    \`;
                    if (dev.lat && dev.lon) {
                        if (markers[dev.deviceId]) {
                            markers[dev.deviceId].setLatLng([dev.lat, dev.lon]);
                        } else {
                            markers[dev.deviceId] = L.marker([dev.lat, dev.lon]).addTo(map);
                        }
                    }
                });
                document.getElementById('unidades').innerHTML = html;
            } catch (err) {
                console.error(err);
            }
        }

        async function sendAlert(tipo, deviceId) {
            await fetch('/api/alerta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tipo, deviceId })
            });
            alert('Alerta enviada a Telegram');
        }

        update();
        setInterval(update, 10000);
    </script>
</body>
</html>`);
});

setInterval(async () => {
    const ahora = new Date().getTime();

    Object.values(baseDatosGPS).forEach(async (dev) => {
        if (!dev.lat || !dev.lon) return;

        const mapaUrl = `https://maps.google.com/?q=${dev.lat},${dev.lon}`;
        const distanciaCDMX = calcularDistanciaKM(CDMX_LAT, CDMX_LON, dev.lat, dev.lon);
        
        if (distanciaCDMX > RADIO_MAXIMO_KM) {
            dev.estadoGeofence = 'Fuera de CDMX';
            if (!dev.alertaFueraGeocercaEnviada) {
                dev.alertaFueraGeocercaEnviada = true;
                const msg = `⚠️ <b>ALERTA AUTOMÁTICA: UNIDAD FUERA DE CDMX</b>\n\n` +
                            `🚘 <b>Unidad:</b> ${dev.deviceId}\n` +
                            `👤 <b>Usuario:</b> ${dev.usuarioAsignado}\n` +
                            `📍 <b>Distancia desde centro CDMX:</b> ${distanciaCDMX.toFixed(1)} km\n` +
                            `⚡ <b>Velocidad:</b> ${dev.speed} km/h | 🔋 <b>Batería:</b> ${dev.batt}\n` +
                            `🗺️ <a href="${mapaUrl}">Ver Ubicación Actual</a>`;
                await enviarNotificacionTelegram(msg);
            }
        } else {
            dev.estadoGeofence = 'Dentro de CDMX';
            dev.alertaFueraGeocercaEnviada = false;
        }

        if (dev.speed === 0 && dev.inicioDetenido) {
            const minutosDetenido = Math.floor((ahora - dev.inicioDetenido) / (1000 * 60));
            if (minutosDetenido >= TIEMPO_DETENIDO_MAX_MINUTOS && !dev.alertaSinMovimientoEnviada) {
                dev.alertaSinMovimientoEnviada = true;
                const msg = `⏳ <b>ALERTA AUTOMÁTICA: UNIDAD DETENIDA</b>\n\n` +
                            `🚘 <b>Unidad:</b> ${dev.deviceId}\n` +
                            `👤 <b>Usuario:</b> ${dev.usuarioAsignado}\n` +
                            `🛑 <b>Tiempo sin movimiento:</b> ${minutosDetenido} minutos\n` +
                            `🔋 <b>Batería:</b> ${dev.batt}\n` +
                            `🗺️ <a href="${mapaUrl}">Ver Ubicación Detenida</a>`;
                await enviarNotificacionTelegram(msg);
            }
        }
    });
}, 20000);

app.listen(PORT, () => console.log('Server activo en puerto ' + PORT));
