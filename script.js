const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, vehicleMarkers = {}, routeLayers = L.featureGroup();

const availableModes = [
  "Podapoda",
  "Keke",
  "Taxi",
  "Paratransit Bus",
  "WAKA FINE Bus",
  "Motorbike"
];

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

function getIconUrlForFilter(mode) {
  switch (mode) {
    case "Podapoda":
      return "https://cdn-icons-png.flaticon.com/512/61/61413.png";
    case "Keke":
      return "https://cdn-icons-png.flaticon.com/512/1079/1079794.png";
    case "Taxi":
      return "https://cdn-icons-png.flaticon.com/512/854/854894.png";
    case "Paratransit Bus":
      return "https://cdn-icons-png.flaticon.com/512/61/61221.png";
    case "WAKA FINE Bus":
      return "https://cdn-icons-png.flaticon.com/512/61/61221.png";
    case "Motorbike":
      return "https://cdn-icons-png.flaticon.com/512/3448/3448609.png";
    default:
      return "https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png";
  }
}

function initFilters() {
  const container = L.control({ position: 'topright' });

  container.onAdd = () => {
    const div = L.DomUtil.create('div', 'filter-panel');

    let html = `<h4>Filter Modes</h4>`;
    Array.from(availableModes).sort().forEach(mode => {
      const iconUrl = getIconUrlForFilter(mode);
      html += `
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
          <input type="checkbox" value="${mode}" checked>
          <img src="${iconUrl}" alt="${mode} icon" width="20" height="20" style="vertical-align:middle;">
          ${mode}
        </label><br>
      `;
    });

    div.innerHTML = html;
    div.onmousedown = div.ondblclick = L.DomEvent.stopPropagation;
    return div;
  };

  container.addTo(map);

  // Attach change listeners after DOM is ready
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
  switch (mode) {
    case "Podapoda":
      iconUrl = "https://cdn-icons-png.flaticon.com/512/61/61413.png";
      break;
    case "Keke":
      iconUrl = "https://cdn-icons-png.flaticon.com/512/1079/1079794.png";
      break;
    case "Taxi":
      iconUrl = "https://cdn-icons-png.flaticon.com/512/854/854894.png";
      break;
    case "Paratransit Bus":
      iconUrl = "https://cdn-icons-png.flaticon.com/512/61/61221.png";
      break;
    case "WAKA FINE Bus":
      iconUrl = "https://cdn-icons-png.flaticon.com/512/61/61221.png";
      break;
    case "Motorbike":
      iconUrl = "https://cdn-icons-png.flaticon.com/512/3448/3448609.png";
      break;
    default:
      iconUrl = "https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png";
  }
  return L.icon({
    iconUrl,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
    shadowUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png",
    shadowSize: [41, 41],
    shadowAnchor: [14, 41]
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

