const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, vehicleMarkers = {}, routeLayers = L.featureGroup();

window.addEventListener("load", () => {
  map = L.map("map").setView([8.48, -13.23], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" }).addTo(map);
  setTimeout(() => map.invalidateSize(), 100);

  loadRoutes();
  loadStops();
  fetchVehicles();
  setInterval(fetchVehicles, 10000);

  initFilters();
});

async function loadRoutes() {
  const base = window.location.hostname.includes("github.io") ? "/freetown-map-ui" : "";
  const res = await fetch(`${base}/data/routes.geojson`);
  const data = await res.json();
  L.geoJSON(data, {
    style: f => ({ color: f.properties.color, weight: 4 }),
    onEachFeature: (f, layer) => {
      layer.bindPopup(`<strong>${f.properties.name}</strong><br><small>${f.properties.mode}</small>`);
      layer.properties = f.properties;
      routeLayers.addLayer(layer);
    }
  }).addTo(map);
}

async function loadStops() {
  const base = window.location.hostname.includes("github.io") ? "/freetown-map-ui" : "";
  const res = await fetch(`${base}/data/stops.geojson`);
  const data = await res.json();
  L.geoJSON(data, {
    pointToLayer: (_, ll) => L.circleMarker(ll, { radius: 6, fillColor:"#000", color:"#fff", weight:1, fillOpacity:0.9 }),
    onEachFeature: (f, layer) => layer.bindPopup(`<strong>${f.properties.name}</strong><br><small>Route: ${f.properties.route_id}</small>`)
  }).addTo(map);
}

function initFilters() {
  const container = L.control({ position: 'topright' });

  container.onAdd = () => {
    const div = L.DomUtil.create('div', 'filter-panel');
    div.innerHTML = `
      <h4>Filter Modes</h4>
      <label><input type="checkbox" value="Bus" checked> Bus</label><br>
      <label><input type="checkbox" value="Minibus" checked> Minibus</label>
    `;
    div.onmousedown = div.ondblclick = L.DomEvent.stopPropagation;
    return div; // ✅ Let Leaflet insert the container
  };

  container.addTo(map);

  // 🛠 Setup filters after DOM is ready
  setTimeout(() => {
    document.querySelectorAll('.filter-panel input').forEach(inp => {
      inp.addEventListener('change', () => applyFilters());
    });
  }, 0);
}


function applyFilters() {
  const selected = Array.from(document.querySelectorAll('.filter-panel input:checked')).map(i => i.value);
  routeLayers.eachLayer(layer => {
    (selected.includes(layer.properties.mode)) ? map.addLayer(layer) : map.removeLayer(layer);
  });
  Object.values(vehicleMarkers).forEach(m => {
    (selected.includes(m.mode)) ? map.addLayer(m) : map.removeLayer(m);
  });
}

function getIcon(mode) {
  let iconUrl;
  if (mode === "Bus") {
    iconUrl = "https://cdn-icons-png.flaticon.com/512/61/61221.png";
  } else if (mode === "Minibus") {
    iconUrl = "https://cdn-icons-png.flaticon.com/512/61/61413.png";
  } else {
    iconUrl = "https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png";
  }
  return L.icon({
    iconUrl,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
    shadowUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png",
    shadowSize: [41, 41],
    shadowAnchor: [14, 41]  // <-- no trailing comma here
  });
}


async function fetchVehicles() {
  const res = await fetch(`${BACKEND_URL}/api/vehicles`);
  const data = await res.json();
  document.getElementById("lastUpdated").innerText = new Date().toLocaleTimeString();
  for (const [id, info] of Object.entries(data)) {
    const { lat, lon, eta_min, mode } = info;
    const icon = getIcon(mode);
    if (vehicleMarkers[id]) {
      vehicleMarkers[id].setLatLng([lat, lon]).setPopupContent(`🚐 <b>${id}</b><br>ETA: ${eta_min} min`);
    } else {
      const m = L.marker([lat, lon], { icon }).addTo(map)
        .bindPopup(`🚐 <b>${id}</b><br>ETA: ${eta_min} min`);
      m.mode = mode;
      vehicleMarkers[id] = m;
    }
  }
}
