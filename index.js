<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Panel de Rastreo GPS</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    body { margin: 0; font-family: sans-serif; display: flex; flex-direction: column; height: 100vh; }
    header { background: #1e293b; color: white; padding: 10px 20px; display: flex; justify-content: space-between; align-items: center; }
    #container { display: flex; flex: 1; }
    #sidebar { width: 300px; padding: 15px; background: #f8fafc; border-right: 1px solid #e2e8f0; }
    #map { flex: 1; }
    .alert-banner { display: none; background: #ef4444; color: white; padding: 12px; text-align: center; font-weight: bold; }
    button.btn-danger { background: #dc2626; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <div id="alertBanner" class="alert-banner"></div>
  <header>
    <h2>Monitoreo GPS</h2>
    <div>
      <span id="userInfo"></span>
      <button class="btn-danger" onclick="logout()">Cerrar Sesión</button>
    </div>
  </header>

  <div id="container">
    <div id="sidebar">
      <h3>Mis Unidades</h3>
      <label for="unitSelect">Seleccionar unidad activa:</label>
      <select id="unitSelect" style="width: 100%; padding: 8px; margin-top: 5px;"></select>
      
      <p><strong>Frecuencia:</strong> Transmitiendo cada 5 segundos.</p>
      <div id="status">Estado: Conectando...</div>
    </div>
    <div id="map"></div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const userSession = JSON.parse(localStorage.getItem('userSession'));
    if (!userSession) window.location.href = '/login';

    document.getElementById('userInfo').innerText = `Usuario: ${userSession.name} | `;
    const unitSelect = document.getElementById('unitSelect');
    userSession.units.forEach(unit => {
      const opt = document.createElement('option');
      opt.value = unit;
      opt.innerText = unit;
      unitSelect.appendChild(opt);
    });

    // Configurar mapa centrado en CDMX
    const map = L.map('map').setView([19.4326, -99.1332], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // Dibujar el límite aproximado de la Geocerca CDMX
    L.rectangle([[19.04, -99.37], [19.59, -98.94]], { color: "#ff7800", weight: 2, fillOpacity: 0.1 }).addTo(map);

    const markers = {};
    const socket = io();

    socket.on('connect', () => {
      document.getElementById('status').innerText = 'Estado: Transmitiendo datos...';
    });

    // Actualizaciones de marcadores en el mapa
    socket.on('location_updated', (data) => {
      if (userSession.units.includes(data.id)) {
        if (markers[data.id]) {
          markers[data.id].setLatLng([data.lat, data.lng]);
        } else {
          markers[data.id] = L.marker([data.lat, data.lng]).addTo(map).bindPopup(`Unidad: ${data.id}`);
        }
      }
    });

    // Manejar Alertas en Pantalla
    socket.on('geofence_alert', (alert) => {
      if (userSession.units.includes(alert.id)) {
        const banner = document.getElementById('alertBanner');
        banner.style.display = 'block';
        banner.innerText = `🚨 ${alert.title}: ${alert.message}`;
        setTimeout(() => { banner.style.display = 'none'; }, 8000);
      }
    });

    // Envío automático cada 5 segundos
    setInterval(() => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
          socket.emit('update_location', {
            id: unitSelect.value,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            username: userSession.username
          });
        });
      }
    }, 5000);

    function logout() {
      localStorage.removeItem('userSession');
      window.location.href = '/login';
    }
  </script>
</body>
</html>
