<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rastreador Satelital Avanzado - GitHub</title>
    
    <!-- Librería de Mapas Leaflet -->
    <link rel="stylesheet" href="https://unpkg.com" />
    
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        body {
            display: flex;
            flex-direction: column;
            height: 100vh;
            background-color: #f6f8fa;
        }
        header {
            background-color: #24292e;
            color: white;
            padding: 15px;
            text-align: center;
        }
        #panel-control {
            background: white;
            padding: 15px;
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 10px;
            border-bottom: 1px solid #e1e4e8;
            align-items: center;
        }
        button {
            padding: 10px 18px;
            font-size: 14px;
            font-weight: bold;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.2s;
        }
        .btn-activar { background-color: #2ea44f; color: white; }
        .btn-activar:hover { background-color: #22863a; }
        .btn-detener { background-color: #cb2431; color: white; }
        .btn-detener:hover { background-color: #b31d28; }
        
        #info-status {
            font-size: 14px;
            color: #586069;
            min-width: 250px;
            text-align: center;
        }
        #mapa {
            flex-grow: 1;
            width: 100%;
        }
    </style>
</head>
<body>

    <header>
        <h2>🛰️ Consola de Rastreo Automático Inteligente</h2>
    </header>

    <div id="panel-control">
        <button class="btn-activar" onclick="iniciarRastreoAutomatico()">Iniciar Rastreo (5s)</button>
        <button class="btn-detener" onclick="detenerRastreo()">Detener</button>
        <div id="info-status">Sistema en espera. Presiona Iniciar...</div>
    </div>

    <div id="mapa"></div>

    <script src="https://unpkg.com"></script>
    
    <script>
        // CONFIGURACIÓN DE TELEGRAM (Reemplaza con tus credenciales)
        const TOKEN_TELEGRAM = 7996171093;
        const CHAT_ID_TELEGRAM = 7996171093;

        let mapa;
        let marcador;
        let lineaRuta;
        let intervaloRastreo;
        
        // Variables de estado y lógica de negocio
        let ultimaUbicacion = null;
        let tiempoDetenidoInicio = null;
        let alertaInmovilidadEmitida = false;
        let alertaFronteraEmitida = false;

        // Polígono simplificado del perímetro de la Ciudad de México (CDMX)
        const poligonoCDMX = [
            [19.5927, -99.1873], [19.5015, -99.0116], [19.2974, -98.9456],
            [19.1172, -99.0171], [19.1152, -99.2711], [19.2922, -99.3639],
            [19.5080, -99.3145]
        ];

        function inicializarMapa() {
            mapa = L.map('mapa').setView([19.4326, -99.1332], 10); // Centrado inicial en CDMX
            
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap'
            }).addTo(mapa);

            // Dibujar el límite visual de la CDMX en el mapa
            L.polygon(poligonoCDMX, {
                color: '#ff4444',
                weight: 2,
                fillColor: '#ff4444',
                fillOpacity: 0.1
            }).addTo(mapa).bindPopup('Límite CDMX');

            lineaRuta = L.polyline([], { color: '#0366d6', weight: 4 }).addTo(mapa);
        }

        // Envío de notificaciones centralizado mediante la API de Telegram
        async function enviarNotificacionTelegram(mensaje) {
            const url = `https://telegram.org{TOKEN_TELEGRAM}/sendMessage`;
            try {
                await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: CHAT_ID_TELEGRAM,
                        text: `🚨 ALERTA DE RASTREO:\n${mensaje}`,
                        parse_mode: 'Markdown'
                    })
                });
            } catch (e) {
                console.error('Error al despachar notificación a Telegram:', e);
            }
        }

        // Algoritmo matemático Ray-Casting para saber si un punto está dentro de un polígono
        function estaDentroDeCDMX(lat, lon) {
            let dentro = false;
            for (let i = 0, j = poligonoCDMX.length - 1; i < poligonoCDMX.length; j = i++) {
                let xi = poligonoCDMX[i][0], yi = poligonoCDMX[i][1];
                let xj = poligonoCDMX[j][0], yj = poligonoCDMX[j][1];
                
                let cruza = ((yi > lon) != (yj > lon))
                    && (lat < (xj - xi) * (lon - yi) / (yj - yi) + xi);
                if (cruza) dentro = !dentro;
            }
            return dentro;
        }

        // Ejecuta el ciclo iterativo estricto cada 5 segundos solicitado
        function iniciarRastreoAutomatico() {
            if (intervaloRastreo) clearInterval(intervaloRastreo);
            
            document.getElementById('info-status').innerText = "Rastreo activo (Ciclo: 5s)...";
            ejecutarMuestreoGPS(); // Primera ejecución inmediata

            intervaloRastreo = setInterval(ejecutarMuestreoGPS, 5000);
        }

        function ejecutarMuestreoGPS() {
            if (!("geolocation" in navigator)) return;

            navigator.geolocation.getCurrentPosition((posicion) => {
                const lat = posicion.coords.latitude;
                const lon = posicion.coords.longitude;

                document.getElementById('info-status').innerHTML = `<strong>Lat:</strong> ${lat.toFixed(5)} | <strong>Lon:</strong> ${lon.toFixed(5)}`;

                // Actualizar interfaz gráfica del mapa
                if (!marcador) {
                    marcador = L.marker([lat, lon]).addTo(mapa);
                    mapa.setView([lat, lon], 14);
                } else {
                    marcador.setLatLng([lat, lon]);
                }
                lineaRuta.addLatLng([lat, lon]);

                // 1. ANÁLISIS DE GEOCERCA (Salida de la Ciudad de México)
                const enCDMX = estaDentroDeCDMX(lat, lon);
                if (!enCDMX && !alertaFronteraEmitida) {
                    alertaFronteraEmitida = true;
                    enviarNotificacionTelegram(`⚠️ El vehículo ha salido del perímetro de la Ciudad de México.\nCoordenadas: ${lat}, ${lon}`);
                } else if (enCDMX) {
                    alertaFronteraEmitida = false; // Reset si vuelve a entrar
                }

                // 2. ANÁLISIS DE INMOVILIDAD (Alerta 10 Minutos en el mismo lugar)
                if (ultimaUbicacion) {
                    // Cálculo de la distancia en metros de forma lineal simple para detectar movimiento real
                    const distanciaMovida = mapa.distance([lat, lon], [ultimaUbicacion.lat, ultimaUbicacion.lon]);
                    
                    if (distanciaMovida < 15) { // Si se movió menos de 15 metros, se considera estacionario
                        if (!tiempoDetenidoInicio) {
                            tiempoDetenidoInicio = Date.now();
                        } else {
                            const minutosDetenido = (Date.now() - tiempoDetenidoInicio) / 1000 / 60;
                            
                            if (minutosDetenido >= 10 && !alertaInmovilidadEmitida) {
                                alertaInmovilidadEmitida = true;
                                enviarNotificacionTelegram(`⏳ Vehículo inmóvil por más de 10 minutos continuos.`);
                                
                                // Alerta interactiva en pantalla: al confirmar cancela el ciclo automático
                                setTimeout(() => {
                                    if (confirm("Alerta: El dispositivo lleva 10 minutos sin registrar movimiento. ¿Deseas apagar el rastreo automático?")) {
                                        detenerRastreo();
                                    }
                                }, 500);
                            }
                        }
                    } else {
                        // El vehículo se movió: reiniciamos los contadores de inmovilidad
                        tiempoDetenidoInicio = null;
                        alertaInmovilidadEmitida = false;
                    }
                }

                ultimaUbicacion = { lat, lon };
            }, (error) => {
                console.error(error);
            }, { enableHighAccuracy: true });
        }

        function detenerRastreo() {
            if (intervaloRastreo) {
                clearInterval(intervaloRastreo);
                intervaloRastreo = null;
                document.getElementById('info-status').innerText = "Ciclo automático apagado.";
            }
        }

        window.onload = inicializarMapa;
    </script>
</body>
</html>
