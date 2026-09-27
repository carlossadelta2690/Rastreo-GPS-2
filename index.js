const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuración de Telegram (Establecer en variables de entorno de Render)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'TU_BOT_TOKEN_AQUI';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'TU_CHAT_ID_AQUI';

// Base de datos en memoria para dispositivos y estados
let baseDatosGPS = {
    'dispositivo 1': {
        deviceId: 'dispositivo 1',
        usuarioAsignado: 'chofer',
        lat: 19.4326,
        lon: -99.1332,
        speed: 0,
        batt: '100%',
        estadoGeofence: 'CDMX',
        fecha: new Date().toLocaleTimeString()
    }
};

// Límites aproximados del polígono de la CDMX
function determinarEstado(lat, lon) {
    if (lat >= 19.048 && lat <= 19.592 && lon >= -99.364 && lon <= -98.940) {
        return 'CDMX';
    }
    return 'Fuera de CDMX / Estado de México u otro';
}

// Función auxiliar para notificaciones a Telegram
async function enviarNotificacionTelegram(mensaje) {
    if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'TU_BOT_TOKEN_AQUI') return;
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: mensaje,
                parse_mode: 'HTML'
            })
        });
    } catch (e) {
        console.error("Error al enviar mensaje a Telegram:", e);
    }
}

// Login Endpoint
app.post('/api/login', (req, res) => {
    const { usuario, password } = req.body;
    if ((usuario === 'admin' && password === 'admin123') || (usuario === 'chofer' && password === '1234')) {
        return res.json({ success: true, usuario });
    }
    return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
});

// Recepción e ingesta de ubicación GPS (Enviado cada 5 segundos)
app.post('/api/posicion', async (req, res) => {
    const { id, lat, lon, speed, batt, usuario } = req.body;
    const deviceKey = id || 'dispositivo 1';
    
    if (lat && lon) {
        const nuevaLat = parseFloat(lat);
        const nuevaLon = parseFloat(lon);
        const estadoActual = determinarEstado(nuevaLat, nuevaLon);
        const dispositivoPrevio = baseDatosGPS[deviceKey] || {};

        // Validar si salió de CDMX o cambió de región geográfica
        if (dispositivoPrevio.estadoGeofence && dispositivoPrevio.estadoGeofence !== estadoActual) {
            const mapaUrl = `https://maps.google.com/?q=${nuevaLat},${nuevaLon}`;
            let mensajeAlerta = `🚨 <b>ALERTA DE CAMBIO DE ZONA</b>\n` +
                                `<b>Unidad:</b> ${deviceKey}\n` +
                                `<b>Estado Anterior:</b> ${dispositivoPrevio.estadoGeofence}\n` +
                                `<b>Nuevo Estado:</b> ${estadoActual}\n` +
                                `<b>Ubicación:</b> <a href="${mapaUrl}">Ver Mapa</a>`;
            
            await enviarNotificacionTelegram(mensajeAlerta);
        }

        baseDatosGPS[deviceKey] = {
            deviceId: deviceKey,
            usuarioAsignado: usuario || dispositivoPrevio.usuarioAsignado || 'chofer',
            lat: nuevaLat,
            lon: nuevaLon,
            speed: speed || 0,
            batt: batt || '100%',
            estadoGeofence: estadoActual,
            fecha: new Date().toLocaleTimeString()
        };
    }
    res.json({ status: 'ok' });
});

// Obtener dispositivos filtrados según el usuario con sesión activa
app.get('/api/dispositivos', (req, res) => {
    const usuario = req.query.usuario;
    let lista = Object.values(baseDatosGPS);
    
    if (usuario && usuario !== 'admin') {
        lista = lista.filter(d => d.usuarioAsignado === usuario);
    }
    res.json(lista);
});

// Procesar alertas de estado manuales (SOS / OK)
app.post('/api/reportar-estado', async (req, res) => {
    const { usuario, estado, lat, lon, dispositivo } = req.body;
    const mapaUrl = `https://maps.google.com/?q=${lat},${lon}`;

    let textoTelegram = "";
    if (estado === 'SOS') {
        textoTelegram = `🚨 <b>ALERTA SOS SOLICITADA</b>\n<b>Usuario:</b> ${usuario}\n<b>Unidad:</b> ${dispositivo}\n<b>Coordenadas:</b> <a href="${mapaUrl}">Google Maps</a>`;
    } else {
        textoTelegram = `✅ <b>REPORTE OK: TODO EN ORDEN</b>\n<b>Usuario:</b> ${usuario}\n<b>Unidad:</b> ${dispositivo}\n<b>Coordenadas:</b> <a href="${mapaUrl}">Google Maps</a>`;
    }

    await enviarNotificacionTelegram(textoTelegram);
    res.json({ success: true });
});

// Interfaz de Usuario
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rastreo GPS de Unidades</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        body { margin: 0; padding: 0; font-family: sans-serif; background: #f4f4f9; }
        #map { height: 100vh; width: 100vw; display: none; }
        .login-box { max-width: 320px; margin: 80px auto; padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.15); text-align: center; }
        .login-box input { width: 90%; padding: 10px; margin: 8px 0; border: 1px solid #ccc; border-radius: 4px; }
        .login-box button { width: 95%; padding: 10px; background: #007bff; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; }
        .info-panel { position: absolute; top: 10px; right: 10px; z-index: 1000; background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.25); width: 270px; }
        .btn { width: 100%; padding: 10px; border: none; border-radius: 5px; color: white; font-weight: bold; margin-bottom: 5px; cursor: pointer; }
    </style>
</head>
<body>

    <div id="login-box" class="login-box">
        <h2>Rastreo GPS - Login</h2>
        <input type="text" id="userInput" placeholder="Usuario">
        <input type="password" id="passInput" placeholder="Contraseña">
        <button onclick="login()">Ingresar</button>
        <p id="error-msg" style="color:red; display:none; font-size:12px; margin-top:8px;">Credenciales incorrectas</p>
    </div>

    <div id="map"></div>

    <div id="panel-vehiculo" class="info-panel" style="display:none;">
        <h3 style="margin-top:0;">🚗 Unidades Vinculadas</h3>
        <div id="info-vehiculo-datos">Cargando datos...</div>
        <hr style="margin: 10px 0; border: 0; border-top: 1px solid #eee;">
        <p style="margin:5px 0; font-size:12px; font-weight:bold;">Reportar Estado:</p>
        <button class="btn" onclick="enviarReporteEstado('OK')" style="background-color: #28a745;">✅ Todo está Bien</button>
        <button class="btn" onclick="enviarReporteEstado('SOS')" style="background-color: #dc3545;">🚨 Solicitar Ayuda (SOS)</button>
        <button class="btn" onclick="cerrarSesion()" style="background-color: #6c757d; margin-top:5px;">Cerrar Sesión</button>
    </div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
        var map, marker;
        var currentUser = localStorage.getItem('gps_user') || null;
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
                    mostrarMapa();
                } else {
                    document.getElementById('error-msg').style.display = 'block';
                }
            } catch(e) {
                alert('Error de conexión con el servidor');
            }
        }

        function cerrarSesion() {
            localStorage.removeItem('gps_user');
            location.reload();
        }

        function mostrarMapa() {
            document.getElementById('login-box').style.display = 'none';
            document.getElementById('map').style.display = 'block';
            document.getElementById('panel-vehiculo').style.display = 'block';

            if (!map) {
                map = L.map('map').setView([19.4326, -99.1332], 14);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© OpenStreetMap'
                }).addTo(map);
            }

            // Iniciar ciclo de actualización y simulación/envío cada 5 segundos
            actualizarMapa();
            setInterval(actualizarMapa, 5000);
            setInterval(enviarUbicacionPeriodica, 5000);
        }

        // Transmite la posición GPS del cliente cada 5 segundos
        async function enviarUbicacionPeriodica() {
            try {
                await fetch('/api/posicion', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: 'dispositivo 1',
                        usuario: currentUser,
                        lat: ultimaLat,
                        lon: ultimaLon,
                        speed: 15,
                        batt: '98%'
                    })
                });
            } catch(e) {}
        }

        async function enviarReporteEstado(tipo) {
            var msj = tipo === 'SOS' ? '¿Confirmas enviar ALERTA SOS?' : '¿Confirmas reportar TODO BIEN?';
            if (!confirm(msj)) return;

            // Retirar alertas existentes
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

            // Ocultar y remover la alerta de confirmación tras 3 segundos
            setTimeout(function() {
                var el = document.getElementById('aviso-confirmacion');
                if (el) el.remove();
            }, 3000);
        }

        async function actualizarMapa() {
            try {
                var res = await fetch('/api/dispositivos?usuario=' + encodeURIComponent(currentUser));
                if (!res.ok) return;
                var data = await res.json();
                if (!data || data.length === 0) return;

                var dev = data[0];
                ultimaLat = dev.lat;
                ultimaLon = dev.lon;
                var pos = [dev.lat, dev.lon];

                if (marker) {
                    marker.setLatLng(pos);
                } else {
                    marker = L.marker(pos).addTo(map);
                }

                document.getElementById('info-vehiculo-datos').innerHTML = 
                    '<b>' + dev.deviceId + '</b> (' + dev.estadoGeofence + ')<br>' +
                    'Velocidad: ' + dev.speed + ' km/h | Batería: ' + dev.batt + '<br>' +
                    'Última actualización: ' + dev.fecha;
            } catch (err) {}
        }
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log('Servidor corriendo en puerto ' + PORT));
            // Ocultar y remover la alerta de confirmación tras 3 segundos
            setTimeout(function() {
                var el = document.getElementById('aviso-confirmacion');
                if (el) el.remove();
            }, 3000);
        }

        async function actualizarMapa() {
            try {
                var res = await fetch('/api/dispositivos?usuario=' + encodeURIComponent(currentUser));
                if (!res.ok) return;
                var data = await res.json();
                if (!data || data.length === 0) return;

                var dev = data[0];
                ultimaLat = dev.lat;
                ultimaLon = dev.lon;
                var pos = [dev.lat, dev.lon];

                if (marker) {
                    marker.setLatLng(pos);
                } else {
                    marker = L.marker(pos).addTo(map);
                }

                document.getElementById('info-vehiculo-datos').innerHTML = 
                    '<b>' + dev.deviceId + '</b> (' + dev.estadoGeofence + ')<br>' +
                    'Velocidad: ' + dev.speed + ' km/h | Batería: ' + dev.batt + '<br>' +
                    'Última actualización: ' + dev.fecha;
            } catch (err) {}
        }
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log('Servidor corriendo en puerto ' + PORT));
                document.getElementById('info-vehiculo-datos').innerHTML = 
                    '<b>' + dev.deviceId + '</b> (' + dev.estadoGeofence + ')<br>' +
                    'Velocidad: ' + dev.speed + ' km/h | Batería: ' + dev.batt + '<br>' +
                    'Última actualización: ' + dev.fecha;
            } catch (err) {}
        }
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log('Servidor corriendo en puerto ' + PORT));
                    'Velocidad: ' + dev.speed + ' km/h | Batería: ' + dev.batt + '<br>' +
                    'Última actualización: ' + dev.fecha;
            } catch (err) {}
        }
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log('Servidor corriendo en puerto ' + PORT));
