const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURACIÓN DE TELEGRAM ---
const TELEGRAM_TOKEN = '8960091089:AAHQHEqEWh6Pli3yJDupRGInRL06qOq3iRg';
const TELEGRAM_CHAT_ID = '7996171093';

// --- CONFIGURACIÓN DE GEOCERCA (CENTRO DE CDMX) ---
const LAT_CENTRO = 19.4326;
const LON_CENTRO = -99.1332;
const RADIO_MAXIMO_KM = 10;

// Objeto para almacenar múltiples dispositivos por su ID
let dispositivos = {};

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

// Devuelve el objeto completo de todos los dispositivos
app.get('/api/ubicacion-actual', (req, res) => {
    res.json(dispositivos);
});

// Mapa interactivo preparado para múltiples marcadores
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Flota de Monitoreo GPS</title>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <style>
            body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
            #map { width: 100vw; height: 100vh; }
            .info-panel {
                position: absolute; top: 10px; left: 10px; z-index: 1000;
                background: rgba(255, 255, 255, 0.95); padding: 12px 16px;
                border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                max-width: 300px; max-height: 40vh; overflow-y: auto;
            }
            .info-panel h3 { margin: 0 0 8px 0; font-size: 16px; color: #333; }
            .dev-card { border-bottom: 1px solid #ddd; padding: 6px 0; font-size: 12px; }
            .dev-card:last-child { border-bottom: none; }
        </style>
    </head>
    <body>
        <div class="info-panel">
            <h3>🚗 Dispositivos Activos</h3>
            <div id="lista-dispositivos">Cargando...</div>
        </div>
        <div id="map"></div>

        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
            let map = L.map('map').setView([19.4326, -99.1332], 12);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap'
            }).addTo(map);

            let markers = {};

            async function actualizarMapa() {
                try {
                    const res = await fetch('/api/ubicacion-actual');
                    const data = await res.json();
                    
                    let htmlList = '';
                    const devIds = Object.keys(data);

                    if (devIds.length === 0) {
                        document.getElementById('lista-dispositivos').innerHTML = '<p>Sin reportes</p>';
                        return;
                    }

                    devIds.forEach(id => {
                        const dev = data[id];
                        const latLng = [Number(dev.lat), Number(dev.lon)];

                        // Crear o actualizar marcador en el mapa
                        if (markers[id]) {
                            markers[id].setLatLng(latLng);
                        } else {
                            markers[id] = L.marker(latLng).addTo(map);
                        }

                        markers[id].bindPopup("<b>" + id + "</b><br>Velocidad: " + dev.speed + " km/h<br>Batería: " + dev.batt + "%");

                        htmlList += "<div class='dev-card'>" +
                            "<b>ID: " + id + "</b><br>" +
                            "Velocidad: " + dev.speed + " km/h | Batería: " + dev.batt + "%<br>" +
                            "Hora: " + dev.fecha +
                            "</div>";
                    });

                    document.getElementById('lista-dispositivos').innerHTML = htmlList;
                } catch (e) {
                    console.error("Error al actualizar mapa:", e);
                }
            }

            setInterval(actualizarMapa, 10000);
            actualizarMapa();
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// Endpoint receptor
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

    // Alertas identificando el vehículo por ID
    if (velocidadKmH > 80) {
        enviarAlertaTelegram(`⚠️ *ALERTA DE VELOCIDAD*\nDispositivo: *${id}*\nVelocidad: *${velocidadKmH} km/h*\n📍 [Ver en Mapa](https://www.google.com/maps?q=${lat},${lon})`);
    }

    const horaActual = new Date().getHours();
    if (horaActual >= 23 || horaActual <= 5) {
        enviarAlertaTelegram(`🚨 *MOVIMIENTO NOCTURNO*\nDispositivo: *${id}*\nHora: ${horaActual}:00 hrs\n📍 [Ver en Mapa](https://www.google.com/maps?q=${lat},${lon})`);
    }

    if (lat && lon) {
        const distancia = calcularDistanciaKm(LAT_CENTRO, LON_CENTRO, Number(lat), Number(lon));
        if (distancia > RADIO_MAXIMO_KM) {
            enviarAlertaTelegram(`📍 *ALERTA DE GEOCERCA*\nDispositivo: *${id}*\nDistancia del centro: *${distancia.toFixed(1)} km*\n📍 [Ver en Mapa](https://www.google.com/maps?q=${lat},${lon})`);
        }
    }

    if (batt && Number(batt) <= 15) {
        enviarAlertaTelegram(`🔋 *BATERÍA BAJA:* El dispositivo *${id}* tiene *${batt}%* de carga.`);
    }

    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor GPS iniciado en puerto ${PORT}`));
