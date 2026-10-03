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
// CONFIGURACIÓN DE TELEGRAM
// -------------------------------------------------------------
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'TU_TELEGRAM_BOT_TOKEN';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'TU_TELEGRAM_CHAT_ID';

async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'TU_TELEGRAM_BOT_TOKEN') {
    console.log('[Simulación Telegram]:', message);
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
    console.error('Error al enviar alerta a Telegram:', error.message);
  }
}

// -------------------------------------------------------------
// BASE DE DATOS EN MEMORIA (Usuarios y sus unidades asignadas)
// -------------------------------------------------------------
const USERS_DB = {
  'admin': {
    password: '123',
    name: 'Administrador Flota',
    units: ['unidad-01', 'unidad-02', 'unidad-03']
  },
  'chofer1': {
    password: '123',
    name: 'Juan Pérez',
    units: ['unidad-01']
  }
};

// Estado global de ubicaciones activas
const activeDevices = {};

// -------------------------------------------------------------
// LÓGICA DE GEOCERCA (Bounding Box de la CDMX)
// -------------------------------------------------------------
function isInsideCDMX(lat, lng) {
  return lat >= 19.04 && lat <= 19.59 && lng >= -99.37 && lng <= -98.94;
}

function processLocationUpdate(data) {
  const { id, lat, lng, username } = data;
  const previousState = activeDevices[id];
  const currentlyInside = isInsideCDMX(lat, lng);

  const payload = {
    id,
    lat,
    lng,
    isInsideCDMX: currentlyInside,
    timestamp: Date.now(),
    updatedBy: username
  };

  // Alerta si la unidad estaba dentro y sale de la zona
  if (previousState && previousState.isInsideCDMX && !currentlyInside) {
    const alertMsg = `⚠️ ALERTA GEOCERCA: La unidad "${id}" ha salido de la CDMX.\nCoordenadas: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    
    // 1. Notificación a Telegram
    sendTelegramAlert(alertMsg);

    // 2. Notificación en pantalla vía WebSocket
    io.emit('geofence_alert', {
      id,
      title: 'Salida de Zona CDMX',
      message: `La unidad "${id}" cruzó el límite exterior de la CDMX.`,
      lat,
      lng,
      timestamp: Date.now()
    });
  }

  activeDevices[id] = payload;
  io.emit('location_updated', payload);
  return payload;
}

// -------------------------------------------------------------
// RUTAS Y ENDPOINTS HTTP
// -------------------------------------------------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Autenticación de usuarios
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS_DB[username];

  if (user && user.password === password) {
    return res.json({
      status: 'ok',
      username,
      name: user.name,
      units: user.units
    });
  }

  res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
});

// -------------------------------------------------------------
// CONEXIÓN WEBSOCKET
// -------------------------------------------------------------
io.on('connection', (socket) => {
  socket.emit('initial_locations', activeDevices);

  socket.on('update_location', (data) => {
    if (data.id && data.lat !== undefined && data.lng !== undefined) {
      processLocationUpdate(data);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
