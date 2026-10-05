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
        headers: { 
            'Content-Type': 'application/json', 
            'Content-Length': Buffer.byteLength(payload) 
        }
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
        const mapaUrl = 'https://maps.google.com/?q=' + dev.lat + ',' + dev.lon;
        
        let msg = '🚨 ALERTA DE AUXILIO (SOS)\n\n📌 Unidad: ' + dev.deviceId + '\n👤 Usuario: ' + dev.usuarioAsignado + '\n📍 Ubicación: ' + mapaUrl;
        if (tipo !== 'SOS') {
            msg = '✅ ESTADO: TODO BIEN\n\n📌 Unidad: ' + dev.deviceId + '\n👤 Usuario: ' + dev.usuarioAsignado + '\n📍 Ubicación: ' + mapaUrl;
        }

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
    <link rel="stylesheet" href="https://unpkg.com" />
    <style>
        body { font-family: sans-serif; margin: 10px; background: #f0f2f5; }
        .wrapper { display: flex; flex-direction: column; gap: 10px; }
        .card { background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .btn { width: 100%; padding: 12px; margin-top: 8px; border: none; border-radius: 5px; font-weight: bold; color: white; cursor: pointer; display: block; }
        .btn-sos { background: #e74c3c; } .btn-ok { background: #2ecc71; }
        #map { height: 400px; border-radius: 8px; width: 100%; position: relative; z-index: 1; }
        
        /* Modal prioritario sobre Leaflet */
        .modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 9999; justify-content: center; align-items: center; }
        .modal-box { background: white; padding: 25px; border-radius: 12px; text-align: center; max-width: 320px; width: 90%; box-shadow: 0 10px 25px rgba(0,0,0,0.4); }
        .modal-buttons { display: flex; gap: 12px; margin-top: 20px; }
        .btn-modal { padding: 12px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; flex: 1; font-size: 14px; }
        .btn-confirm { background: #2ecc71; color: white; }
        .btn-cancel { background: #95a5a6; color: white; }
    </style>
</head>
<body>
    <h2>📡 Sistema de Rastreo GPS</h2>
    <div class="wrapper">
        <div id="unidades">Cargando datos de las unidades...</div>
        <div id="map"></div>
    </div>

    <!-- RECUADRO DE CONFIRMACIÓN -->
    <div id="confirmModal" class="modal-overlay">
        <div class="modal-box">
            <h3 id="modalTitle">¿Confirmar Acción?</h3>
            <p>Se enviará una notificación inmediata al chat de Telegram.</p>
            <div class="modal-buttons">
                <button class="btn-modal btn-confirm" id="btnConfirmar">Enviar</button>
                <button class="btn-modal btn-cancel" onclick="cerrarRecuadro()">Cancelar</button>
            </div>
        </div>
    </div>

    <script src="https://unpkg.com"></script>
    <script>
        // Inicialización única del mapa fuera de los renders repetitivos
        const map = L.map('map').setView([19.4326, -99.1332], 11);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        
        let markers = {};
        let datosAlertaPendiente = null;

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
                            <button class="btn btn-sos" onclick="abrirRecuadro('SOS', '\${dev.deviceId}')">🚨 SOLICITAR AYUDA (SOS)</button>
                            <button class="btn btn-ok" onclick="abrirRecuadro('OK', '\${dev.deviceId}')">✅ TODO BIEN</button>
                        </div>
                    \`;
                    
                    // Actualización asíncrona del marcador sin tocar el contenedor HTML
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
                console.error("Error en ciclo de lectura GPS:", err);
            }
        }

        function abrirRecuadro(tipo, deviceId) {
            datosAlertaPendiente = { tipo, deviceId };
            document.getElementById('modalTitle').innerText = tipo === 'SOS' ? '⚠️ ¿Enviar auxilio SOS?' : '✅ ¿Notificar que Todo Bien?';
            document.getElementById('confirmModal').style.display = 'flex';
        }

        function cerrarRecuadro() {
            document.getElementById('confirmModal').style.display = 'none';
            datosAlertaPendiente = null;
        }

        // Ejecución inmediata del borrado visual
        document.getElementById('btnConfirmar').onclick = function() {
            if (!datosAlertaPendiente) return;
            
            const { tipo, deviceId } = datosAlertaPendiente;
            
            // Corrección: El recuadro desaparece ANTES de procesar peticiones HTTP o llamadas de mapas
            cerrarRecuadro();

            fetch('/api/alerta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tipo, deviceId })
            })
            .then(() => {
                update(); // Refresca posiciones una vez enviado
            })
            .catch(err => console.error("Error al despachar el API:", err));
        };

        update();
        setInterval(update, 10000);
    </script>
</body>
</html>`);
});

