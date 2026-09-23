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
const RADIO_MAXIMO_KM = 10;   // Límite aproximado de alcaldías centrales antes de cruzar a periferias/municipios

// Función para calcular distancia entre coordenadas (Haversine)
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

// Función para enviar mensajes automáticos a tu Telegram
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

// --- RUTA PRINCIPAL ---
app.get('/', (req, res) => {
    res.send('Servidor de Monitoreo GPS Activo');
});

// --- ENDPOINT QUE RECIBE LOS DATOS DE TRACCAR CLIENT ---
app.post('/api/posicion', (req, res) => {
    const lat = req.query.lat || req.body.lat;
    const lon = req.query.lon || req.body.lon;
    const speed = req.query.speed || req.body.speed || 0;
    const batt = req.query.batt || req.body.batt;

    const velocidadKmH = Math.round(speed * 1.852);

    // 1. Alerta de velocidad (>80 km/h)
    if (velocidadKmH > 80) {
        enviarAlertaTelegram(`⚠️ *ALERTA DE VELOCIDAD*\nEl vehículo circula a *${velocidadKmH} km/h*.\n📍 [Ver en Google Maps](https://www.google.com/maps?q=${lat},${lon})`);
    }

    // 2. Movimiento nocturno (11:00 PM a 5:00 AM)
    const horaActual = new Date().getHours();
    if (horaActual >= 23 || horaActual <= 5) {
        enviarAlertaTelegram(`🚨 *MOVIMIENTO NOCTURNO DETECTADO*\nSe detectó actividad a las ${horaActual}:00 hrs.\n📍 [Ver ubicación](https://www.google.com/maps?q=${lat},${lon})`);
    }

    // 3. Alerta por salir del área permitida del centro de CDMX
    if (lat && lon) {
        const distancia = calcularDistanciaKm(LAT_CENTRO, LON_CENTRO, Number(lat), Number(lon));
        if (distancia > RADIO_MAXIMO_KM) {
            enviarAlertaTelegram(`📍 *ALERTA DE GEOCERCA:* El vehículo salió del centro de CDMX (se encuentra a *${distancia.toFixed(1)} km* del punto central, ingresando a municipios/alcaldías aledañas).\n📍 [Ver ubicación actual](https://www.google.com/maps?q=${lat},${lon})`);
        }
    }

    // 4. Batería baja
    if (batt && Number(batt) <= 15) {
        enviarAlertaTelegram(`🔋 *BATERÍA BAJA:* El celular emisor tiene *${batt}%* de carga.`);
    }

    res.sendStatus(200);
});

// --- INICIO DEL SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor GPS iniciado en puerto ${PORT}`));
