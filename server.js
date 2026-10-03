const express = require('express');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// Base de datos en memoria con usuarios y unidades asignadas
let baseDatosGPS = {
    'dispositivo 1': {
        deviceId: 'dispositivo 1',
        usuarioAsignado: 'chofer',
        lat: 19.4326,
        lon: -99.1332,
        speed: 0,
        batt: '98%',
        estadoGeofence: 'CDMX',
        ultimaFechaMovimiento: Date.now(),
        alertaParadoEnviada: false,
        fecha: new Date().toLocaleTimeString('es-MX')
    },
    'dispositivo 2': {
        deviceId: 'dispositivo 2',
        usuarioAsignado: 'admin',
        lat: 19.5000,
        lon: -99.2000,
        speed: 25,
        batt: '85%',
        estadoGeofence: 'CDMX',
        ultimaFechaMovimiento: Date.now(),
        alertaParadoEnviada: false,
        fecha: new Date().toLocaleTimeString('es-MX')
    }
};

function determinarEstado(lat, lon) {
    if (lat >= 19.048 && lat <= 19.592 && lon >= -99.364 && lon >= -98.940) {
        return 'CDMX';
    }
    return 'Fuera de CDMX / Estado de México u otro';
}

function enviarNotificacionTelegram(mensaje) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.log("⚠️ Faltan variables TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID.");
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const payload = JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: mensaje,
            parse_mode: 'HTML'
        });

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

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                console.log("📲 Respuesta Telegram:", responseData);
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error("❌ Error Telegram:", e.message);
            resolve();
        });

        req.write(payload);
        req.end();
    });
}

// Alerta de 15 minutos parado
setInterval(() => {
    const ahora = Date.now();
    const LIMITE_PARADO_MS = 15 * 60 * 1000;

    Object.values(baseDatosGPS).forEach(async (dev) => {
        if (dev.speed === 0 && (ahora - dev.ultimaFechaMovimiento) >= LIMITE_PARADO_MS) {
            if (!dev.alertaParadoEnviada) {
                dev.alertaParadoEnviada = true;
                const mapaUrl = `https://maps.google.com/?q=${dev.lat},${dev.lon}`;
                const msj = `⚠️ <b>ALERTA DE INACTIVIDAD</b>\n` +
                            `<b>Unidad:</b> ${dev.deviceId}\n` +
                            `<b>Asignado a:</b> ${dev.usuarioAsignado}\n` +
                            `<b>Estatus:</b> Detenido por más de 15 minutos.\n` +
                            `<b>Ubicación:</b> <a href="${mapaUrl}">Ver Mapa</a>`;
                console.log(`⏰ Alerta 15 min enviada para ${dev.deviceId}`);
                await enviarNotificacionTelegram(msj);
            }
        }
    });
}, 30000);

// API Login
app.post('/api/login', (req, res) => {
    const { usuario, password } = req.body;
    if ((usuario === 'admin' && password === 'admin123') || (usuario === 'chofer' && password === '1234')) {
        return res.json({ success: true, usuario });
    }
    return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
});

// Ingesta GPS
app.post('/api/posicion', async (req, res) => {
    const { id, lat, lon, speed, batt, usuario } = req.body;
    const deviceKey = id || 'dispositivo 1';
    
    if (lat && lon) {
        const nuevaLat = parseFloat(lat);
        const nuevaLon = parseFloat(lon);
        const velocidad = parseFloat(speed || 0);
        const estadoActual = determinarEstado(nuevaLat, nuevaLon);
        const dispositivoPrevio = baseDatosGPS[deviceKey] || {};

        if (dispositivoPrevio.estadoGeofence && dispositivoPrevio.estadoGeofence !== estadoActual) {
            const mapaUrl = `https://maps.google.com/?q=${nuevaLat},${nuevaLon}`;
            let mensajeAlerta = `🚨 <b>ALERTA DE CAMBIO DE ZONA</b>\n` +
                                `<b>Unidad:</b> ${deviceKey}\n` +
                                `<b>Anterior:</b> ${dispositivoPrevio.estadoGeofence}\n` +
                                `<b>Actual:</b> ${estadoActual}\n` +
                                `<b>Ubicación:</b> <a href="${mapaUrl}">Ver Mapa</a>`;
            await enviarNotificacionTelegram(mensajeAlerta);
        }

        let tiempoMovimiento = dispositivoPrevio.ultimaFechaMovimiento || Date.now();
        let alertaEnviada = dispositivoPrevio.alertaParadoEnviada || false;
        
        if (velocidad > 0) {
            tiempoMovimiento = Date.now();
            alertaEnviada = false;
        }

        baseDatosGPS[deviceKey] = {
            deviceId: deviceKey,
            usuarioAsignado: usuario || dispositivoPrevio.usuarioAsignado || 'chofer',
            lat: nuevaLat,
            lon: nuevaLon,
            speed: velocidad,
            batt: batt || '100%',
            estadoGeofence: estadoActual,
            ultimaFechaMovimiento: tiempoMovimiento,
            alertaParadoEnviada: alertaEnviada,
            fecha: new Date().toLocaleTimeString('es-MX')
        };
    }
    res.json({ status: 'ok' });
});

// Endpoint de dispositivos por usuario
app.get('/api/dispositivos', (req, res) => {
    const usuario = req.query.usuario;
    let lista = Object.values(baseDatosGPS);
    if (usuario && usuario !== 'admin') {
        lista = lista.filter(d => d.usuarioAsignado === usuario);
    }
    res.json(lista);
});

// Reporte Manual (SOS / OK)
app.post('/api/reportar-estado', async (req, res) => {
    const { usuario, estado, lat, lon, dispositivo } = req.body;
    const mapaUrl = `https://maps.google.com/?q=${lat},${lon}`;

    let textoTelegram = estado === 'SOS'
        ? `🚨 <b>ALERTA SOS SOLICITADA</b>\n<b>Usuario:</b> ${usuario}\n<b>Unidad:</b> ${dispositivo}\n<b>Ubicación:</b> <a href="${mapaUrl}">Google Maps</a>`
        : `✅ <b>REPORTE OK</b>\n<b>Usuario:</b> ${usuario}\n<b>Unidad:</b> ${dispositivo}\n<b>Ubicación:</b> <a href="${mapaUrl}">Google Maps</a>`;

    await enviarNotificacionTelegram(textoTelegram);
    res.json({ success: true });
});

// Interfaz Web completa
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Panel Rastreo GPS</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        body { margin: 0; padding: 0; font-family: Arial, sans-serif; background: #eef2f5; }
        #map { height: 100vh; width: 100vw; display: none; }
        .login-box { max-width: 320px; margin: 80px auto; padding: 25px; background: white; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; }
        .login-box input { width: 90%; padding: 12px; margin: 8px 0; border: 1px solid #ccc; border-radius: 5px; box-sizing: border-box; }
        .login-box button { width: 90%; padding: 12px; background: #007bff; color: white; border: none; border-radius: 5px; font-weight: bold; cursor: pointer; }
        .info-panel { position: absolute; top: 15px; right: 15px; z-index: 1000; background: white; padding: 15px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); width: 290px; }
        .btn { width: 100%; padding: 10px; border: none; border-radius: 5px; color: white; font-weight: bold; margin-bottom: 6px; cursor: pointer; }
        .select-user { width: 100%; padding: 8px; margin-bottom: 10px; border-radius: 5px; border: 1px solid #ccc; }
        .unit-card { background: #f8f9fa; border-left: 4px solid #007bff; padding: 8px; margin-bottom: 8px; border-radius: 4px; font-size: 12px; }
    </style>
</head>
<body>

    <div id="login-box" class="login-box">
        <h2 style="margin-top:0;">📍 Rastreo GPS</h2>
        <p style="color:#666; font-size:14px;">Ingresa tus credenciales</p>
        <input type="text" id="userInput" placeholder="Usuario (admin/chofer)">
        <input type="password" id="passInput" placeholder="Contraseña">
        <button onclick="login()">Ingresar</button>
        <p id="error-msg" style="color:red; display:none; font-size:12px; margin-top:10px;">Credenciales incorrectas</p>
    </div>

    <div id="map"></div>

    <div id="panel-vehiculo" class="info-panel" style="display:none;">
        <h3 style="margin-top:0; font-size:15px; color:#333;">👤 Panel de Control</h3>
        
        <label style="font-size:12px; font-weight:bold;">Filtrar por Usuario:</label>
        <select id="userSelector" class="select-user" onchange="cambiarFiltroUsuario()">
            <option value="admin">Todos los Usuarios (Admin)</option>
            <option value="chofer">Ver sólo Chofer</option>
        </select>

        <h4 style="margin: 8px 0 5px 0; font-size:13px; color:#555;">🚘 Unidades Asignadas</h4>
        <div id="lista-unidades">Cargando unidades...</div>

        <hr style="margin: 10px 0; border: 0; border-top: 1px solid #ddd;">
        <p style="margin:5px 0; font-size:12px; font-weight:bold;">Enviar Reporte Manual:</p>
        <button class="btn" onclick="enviarReporteEstado('OK')" style="background-color: #28a745;">✅ Todo Bien</button>
        <button class="btn" onclick="enviarReporteEstado('SOS')" style="background-color: #dc3545;">🚨 Solicitar Ayuda (SOS)</button>
        <button class="btn" onclick="cerrarSesion()" style="background-color: #6c757d; margin-top:5px;">Cerrar Sesión</button>
    </div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
        var map, markers = {};
        var currentUser = localStorage.getItem('gps_user') || null;
        var filtroUsuario = localStorage.getItem('gps_filter') || 'admin';
        var ultimaLat = 19.4326;
        var ultimaLon = -99.1332;

        if (currentUser) {
            mostrarMapa();
        }

        async function login() {
            var u = document.getElementById('userInput').value;
            var p = document.getElementById('passInput').value;
            try {
                var res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuario: u, password: p })
                });
                var data = await res.json();
                if (data.success) {
                    localStorage.setItem('gps_user', u);
                    currentUser = u;
                    filtroUsuario = u;
                    localStorage.setItem('gps_filter', u);
                    mostrarMapa();
                } else {
                    document.getElementById('error-msg').style.display = 'block';
                }
            } catch(e) {
                alert('Error al comunicar con el servidor');
            }
        }

        function cerrarSesion() {
            localStorage.removeItem('gps_user');
            localStorage.removeItem('gps_filter');
            location.reload();
        }

        function cambiarFiltroUsuario() {
            filtroUsuario = document.getElementById('userSelector').value;
            localStorage.setItem('gps_filter', filtroUsuario);
            actualizarMapa();
        }

        function mostrarMapa() {
            document.getElementById('login-box').style.display = 'none';
            document.getElementById('map').style.display = 'block';
            document.getElementById('panel-vehiculo').style.display = 'block';
            document.getElementById('userSelector').value = filtroUsuario;

            if (!map) {
                map = L.map('map').setView([19.4326, -99.1332], 12);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© OpenStreetMap'
                }).addTo(map);
            }

            actualizarMapa();
            setInterval(actualizarMapa, 5000);
            setInterval(enviarUbicacionPeriodica, 5000);
        }

        async function enviarUbicacionPeriodica() {
            try {
                await fetch('/api/posicion', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: 'dispositivo 1',
                        usuario: 'chofer',
                        lat: ultimaLat,
                        lon: ultimaLon,
                        speed: 0,
                        batt: '98%'
                    })
                });
            } catch(e) {}
        }

        async function enviarReporteEstado(tipo) {
            var msj = tipo === 'SOS' ? '¿Confirmas enviar ALERTA SOS?' : '¿Confirmas reportar TODO BIEN?';
            if (!confirm(msj)) return;

            var viejo = document.getElementById('aviso-confirmacion');
            if (viejo) viejo.remove();

            var aviso = document.createElement('div');
            aviso.id = 'aviso-confirmacion';
            aviso.style.padding = '8px';
            aviso.style.marginTop = '8px';
            aviso.style.borderRadius = '5px';
            aviso.style.textAlign = 'center';
            aviso.style.fontWeight = 'bold';
            aviso.style.fontSize = '12px';

            if (tipo === 'OK') {
                aviso.style.background = '#d4edda';
                aviso.style.color = '#155724';
                aviso.innerText = '✅ Reporte enviado: Todo bien';
            } else {
                aviso.style.background = '#f8d7da';
                aviso.style.color = '#721c24';
                aviso.innerText = '🚨 Alerta SOS enviada';
            }

            document.getElementById('panel-vehiculo').appendChild(aviso);

            try {
                await fetch('/api/reportar-estado', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        usuario: currentUser, 
                        estado: tipo, 
                        lat: ultimaLat, 
                        lon: ultimaLon, 
                        dispositivo: 'dispositivo 1' 
                    })
                });
            } catch(e) {}

            setTimeout(function() {
                var el = document.getElementById('aviso-confirmacion');
                if (el) el.remove();
            }, 3000);
        }

        async function actualizarMapa() {
            try {
                var res = await fetch('/api/dispositivos?usuario=' + encodeURIComponent(filtroUsuario));
                if (!res.ok) return;
                var dispositivos = await res.json();
                
                var contenedorHtml = '';
                
                if (!dispositivos || dispositivos.length === 0) {
                    document.getElementById('lista-unidades').innerHTML = '<p style="font-size:12px; color:#888;">Sin unidades para este usuario.</p>';
                    return;
                }

                dispositivos.forEach(function(dev) {
                    ultimaLat = dev.lat;
                    ultimaLon = dev.lon;
                    var pos = [dev.lat, dev.lon];

                    if (markers[dev.deviceId]) {
                        markers[dev.deviceId].setLatLng(pos);
                    } else {
                        markers[dev.deviceId] = L.marker(pos).addTo(map)
                            .bindPopup('<b>' + dev.deviceId + '</b><br>Asignado a: ' + dev.usuarioAsignado);
                    }

                    contenedorHtml += 
                        '<div class="unit-card">' +
                            '<b>' + dev.deviceId + '</b> (' + dev.estadoGeofence + ')<br>' +
                            '<b>Usuario:</b> ' + dev.usuarioAsignado + '<br>' +
                            '<b>Velocidad:</b> ' + dev.speed + ' km/h | <b>Batería:</b> ' + dev.batt + '<br>' +
                            '<b>Hora:</b> ' + dev.fecha +
                        '</div>';
                });

                document.getElementById('lista-unidades').innerHTML = contenedorHtml;
            } catch (err) {}
        }
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log('Servidor GPS corriendo en puerto ' + PORT));
