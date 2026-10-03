const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("Telegram no configurado. Mensaje:", message);
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message })
    });
  } catch (err) {
    console.error("Error enviando Telegram:", err.message);
  }
}

const USERS = { "admin": "12345" };

function isOutsideCDMX_Edomex(lat, lon) {
  const minLat = 18.9, maxLat = 20.1;
  const minLon = -99.4, maxLon = -98.5;
  return lat < minLat || lat > maxLat || lon < minLon || lon > maxLon;
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const rad1 = lat1 * Math.PI / 180, rad2 = lat2 * Math.PI / 180;
  const dRad = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dRad / 2) ** 2 + Math.cos(rad1) * Math.cos(rad2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.use(express.static(path.join(__dirname, 'public')));
const devicesState = {};

io.on('connection', (socket) => {
  socket.on('login', (data, callback) => {
    if (USERS[data.username] && USERS[data.username] === data.password) {
      callback({ success: true });
    } else {
      callback({ success: false, message: 'Usuario o contraseña incorrectos' });
    }
  });

  socket.on('update-location', (data) => {
    const { latitude, longitude, deviceId } = data;
    const now = Date.now();
    const id = deviceId || socket.id;

    if (!devicesState[id]) {
      devicesState[id] = { lastLat: latitude, lastLon: longitude, stoppedSince: now, outsideAlertSent: false, stopAlertSent: false };
    }

    const state = devicesState[id];
    const dist = getDistanceMeters(state.lastLat, state.lastLon, latitude, longitude);

    if (dist > 15) {
      state.lastLat = latitude;
      state.lastLon = longitude;
      state.stoppedSince = now;
      state.stopAlertSent = false;
    } else {
      const stoppedMinutes = (now - state.stoppedSince) / (1000 * 60);
      if (stoppedMinutes >= 15 && !state.stopAlertSent) {
        state.stopAlertSent = true;
        const msg = ` ALERTA: El vehículo (${id}) lleva más de 15 minutos detenido.`;
        io.emit('alert-stopped', { deviceId: id, message: msg });
        sendTelegramAlert(msg);
      }
    }

    const isOutside = isOutsideCDMX_Edomex(latitude, longitude);
    if (isOutside && !state.outsideAlertSent) {
      state.outsideAlertSent = true;
      const msg = ` ALERTA DE PERÍMETRO: El vehículo (${id}) ha salido de CDMX/Edomex hacia otro estado.`;
      io.emit('alert-out-of-bounds', { deviceId: id, message: msg });
      sendTelegramAlert(msg);
    } else if (!isOutside) {
      state.outsideAlertSent = false;
    }

    io.emit('location-updated', { id, latitude, longitude, timestamp: now });
  });

  socket.on('disconnect', () => {
    delete devicesState[socket.id];
    io.emit('user-disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor listo en el puerto ${PORT}`));
