const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURACIÓN DE TELEGRAM ---
const TELEGRAM_TOKEN = '8960091089:AAHQHEqEWh6Pli3yJDupRGInRL06qOq3iRg';
const TELEGRAM_CHAT_ID = '7996171093';

// --- CONFIGURACIÓN DE GEOCERCA (CENTRO DE CDMX) ---
const LAT_CENTRO = 19.4326;  // Coordenada Zócalo CDMX
const LON_CENTRO = -99.1332;
const RADIO_MAXIMO_KM = 10;   // Límite de 10 km

// Variable para almacenar la última posición del vehículo
let ultimaUbicacion = {
    lat: 19.4326,
    lon: -99.1332,
    speed: 0,
    batt: 100,
    fecha: 'Sin datos aún'
};

// Función para calcular distancia (Haversine)
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

// Función para enviar mensajes automáticos a Telegram
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

// --- RUTA API: DEVUELVE LA ÚLTIMA UBICACIÓN EN FORMATO JSON ---
app.get('/api/ubicacion-actual', (req, res) => {
    res.json(ultimaUbicacion);
});

// --- RUTA PRINCIPAL: MAPA INTERACTIVO HTML ---
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Monitoreo GPS en Vivo</title>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <style>
            body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
            #map { width: 100vw; height: 100vh; }
            .info-panel {
                position: absolute; top: 10px; left: 10px; z-index: 1000;
                background: rgba(255, 255, 255, 0.95); padding: 12px 16px;
                border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                max-width: 280px;
            }
            .info-panel h3 { margin: 0 0 8px 0; font-size: 16px; color: #333; }
            .info-panel p { margin: 4px 0; font-size: 13px; color: #555; }
        </style>
    </head>
    <body>
        <div class="info-panel">
            <h3>📍 Monitoreo GPS</h3>
            <p><b>Velocidad:</b> <span id="speed">0</span> km/h</p>
            <p><b>Batería:</b> <span id="batt">--</span>%</p>
            <p><b>Última act.:</b> <span id="fecha">Cargando...</span></p>
        </div>
        <div id="map"></div>

        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
            let map = L.map('map').setView([${ultimaUbicacion.lat}, ${ultimaUbicacion.lon}], 15);
            
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap'
            }).addTo(map);

            let marker = L.marker([${ultimaUbicacion.lat}, ${ultimaUbicacion.lon}]).addTo(map)
                .bindPopup("<b>Vehículo en Monitoreo</b>").openPopup();

            async function actualizarMapa() {
                try {
                    const res = await fetch('/api/ubicacion-actual');
                    const data = await res.json();
                    
                    const latLng = [Number(data.lat), Number(data.lon)];
                    marker.setLatLng(latLng);
                    map.panTo(latLng);

                    document.getElementById('speed').innerText = data.speed;
                    document.getElementById('batt').innerText = data.batt || '--';
                    document.getElementById('fecha').innerText = data.fecha;
                } catch (e) {
                    console.error("Error al actualizar mapa:", e);
                }
            }

            // Actualizar la posición en la pantalla cada 10 segundos
            setInterval(actualizarMapa, 10000);
            actualizarMapa();
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// --- ENDPOINT QUE RECIBE LOS DATOS DE TRACCAR CLIENT ---
app.post('/api/posicion', (req, res) => {
    const lat = req.query.lat || req.body.lat;
    const lon = req.query.lon || req.body.lon;
    const speed = req.query.speed || req.body.speed || 0;
    const batt = req.query.batt || req.body.batt;

    const velocidadKmH = Math.round(speed * 1.852);

    // Guardar datos en memoria para el mapa interactivo
    if (lat && lon) {
        ultimaUbicacion = {
            lat: Number(lat),
            lon: Number(lon),
            speed: velocidadKmH,
            batt: batt ? Number(batt) : '--',
            fecha: new Date().toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City' })
        };
    }

    // 1. Alerta de velocidad (>80 km/h)
    if (velocidadKmH > 80) {
        enviarAlertaTelegram(`⚠️ *ALERTA DE VELOCIDAD*\nEl vehículo circula a *${velocidadKmH} km/h*.\n📍 [Ver en Google Maps](https://www.google.com/maps?q=${lat},${lon})`);
    }

    // 2. Movimiento nocturno (11:00 PM a 5:00 AM)
    const horaActual = new Date().getHours();
    if (horaActual >= 23 || horaActual <= 5) {
        enviarAlertaTelegram(`🚨 *MOVIMIENTO NOCTURNO DETECTADO*\nSe detectó actividad a las ${horaActual}:00 hrs.\n📍 [Ver ubicación](https://www.google.com/maps?q=${lat},${lon})`);
    }

    // 3. Alerta de Geocerca (10 km del Centro de CDMX)
    if (lat && lon) {
        const distancia = calcularDistanciaKm(LAT_CENTRO, LON_CENTRO, Number(lat), Number(lon));
        if (distancia > RADIO_MAXIMO_KM) {
            enviarAlertaTelegram(`📍 *ALERTA DE GEOCERCA:* El vehículo salió del centro de CDMX (está a *${distancia.toFixed(1)} km* del punto central).\n📍 [Ver ubicación](https://www.google.com/maps?q=${lat},${lon})`);
        }
    }

    // 4. Batería baja
    if (batt && Number(batt) <= 15) {
        enviarAlertaTelegram(`🔋 *BATERÍA BAJA:* El teléfono emisor tiene *${batt}%* de carga.`);
    }

    res.sendStatus(200);
});

// --- INICIO DEL SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor GPS iniciado en puerto ${PORT}`));
