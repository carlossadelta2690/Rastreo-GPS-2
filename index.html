const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// CONFIGURACIÓN DE TELEGRAM (Reemplaza con tus datos reales)
// -------------------------------------------------------------
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'TU_TELEGRAM_BOT_TOKEN';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'TU_TELEGRAM_CHAT_ID';

async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'TU_TELEGRAM_BOT_TOKEN') {
    console.log('[Telegram Simulación]:', message);
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message })
    });
  } catch (error) {
    console.error('Error enviando mensaje a Telegram:', error.message);
  }
// Middleware simple de autenticación o redirección
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Endpoint para validar credenciales
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    // Sustituye con tu lógica de verificación/BD real
    if (username === 'admin' && password === '123456') {
        return res.json({ status: 'ok', token: 'token-de-sesion-demo' });
    }
    
    res.status(401).json({ error: 'Credenciales incorrectas' });
});

// -------------------------------------------------------------
// GEOCERCA: Límites aproximados de la CDMX (Bounding Box)
// Latitud: 19.04 a 19.59 | Longitud: -99.37 a -98.94
// -------------------------------------------------------------
function isInsideCDMX(lat, lng) {
  return lat >= 19.04 && lat <= 19.59 && lng >= -99.37 && lng <= -98.94;
}

const activeDevices = {};

function processLocationUpdate(data) {
  const { id, lat, lng } = data;
  const previousState = activeDevices[id];
  const currentlyInside = isInsideCDMX(lat, lng);

  const payload = {
    id,
    lat,
    lng,
    isInsideCDMX: currentlyInside,
    timestamp: Date.now()
  };

  // Detectar si el dispositivo estaba dentro y acaba de salir de la CDMX
  if (previousState && previousState.isInsideCDMX && !currentlyInside) {
    const alertMsg = `⚠️ ALERTA GPS: El dispositivo "${id}" ha salido de la CDMX.\nCoordenadas: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    
    // 1. Enviar a Telegram
    sendTelegramAlert(alertMsg);

    // 2. Enviar evento de alerta a las pantallas
    io.emit('geofence_alert', {
      id,
      title: 'Salida de Zona (CDMX)',
      message: `El dispositivo "${id}" salió de los límites de la Ciudad de México.`,
      lat,
      lng,
      timestamp: Date.now()
    });
  }

  activeDevices[id] = payload;
  io.emit('location_updated', payload);
  return payload;
}

// WebSocket
io.on('connection', (socket) => {
  socket.emit('initial_locations', activeDevices);

  socket.on('update_location', (data) => {
    if (data.id && data.lat !== undefined && data.lng !== undefined) {
      processLocationUpdate(data);
    }
  });
});

// Endpoint HTTP REST opcional (para dispositivos GPS dedicados)
app.post('/api/location', (req, res) => {
  const { id, lat, lng } = req.body;
  if (!id || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'Parámetros requeridos: id, lat, lng' });
  }
  const payload = processLocationUpdate({ id, lat: parseFloat(lat), lng: parseFloat(lng) });
  res.json({ status: 'ok', data: payload });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor activo en http://localhost:${PORT}`);
});
