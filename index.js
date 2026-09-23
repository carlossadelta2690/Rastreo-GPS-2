const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let ultimaUbicacion = { lat: 19.4326, lng: -99.1332 };

// 1. Recibir datos del teléfono emisor (Traccar Client)
app.all('/api/posicion', (req, res) => {
  const lat = req.query.lat || req.body.lat;
  const lon = req.query.lon || req.body.lon;

  if (lat && lon) {
    ultimaUbicacion = { lat: parseFloat(lat), lng: parseFloat(lon) };
    console.log(`Nueva ubicación recibida: Lat ${lat}, Lon ${lon}`);
  }
  res.status(200).send("OK");
});

// 2. Entregar última ubicación al mapa
app.get('/api/ubicacion-actual', (req, res) => {
  res.json(ultimaUbicacion);
});

// 3. Mostrar mapa interactivo
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
      <style> body { margin:0; padding:0; } #map { height: 100vh; width: 100vw; } </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        const map = L.map('map').setView([${ultimaUbicacion.lat}, ${ultimaUbicacion.lng}], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        const marker = L.marker([${ultimaUbicacion.lat}, ${ultimaUbicacion.lng}]).addTo(map);

        setInterval(() => {
          fetch('/api/ubicacion-actual')
            .then(res => res.json())
            .then(data => {
              marker.setLatLng([data.lat, data.lng]);
              map.panTo([data.lat, data.lng]);
            });
        }, 5000);
      </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
