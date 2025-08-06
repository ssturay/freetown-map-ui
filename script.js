const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, vehicleMarkers = {}, routeLayers = L.featureGroup();
let availableModes = new Set();

window.addEventListener("load", async () => {
  map = L.map("map").setView([8.48, -13.23], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 100);

  await loadRoutes();     // ✅ Wait for modes to load before filters
  initFilters();          // ✅ Now build filters
  loadStops();
  fetchVehicles();
  setInterval(fetchVehicles, 10000);
});

async function loadRoutes() {
  const base = window.location.hostname.includes("github.io") ? "/freetown-map-ui" : "";
  const res = await fetch(`${base}/data/routes.geojson`);
  const data = await res.json();

  data.features.forEach(f => {
    if (f.properties && f.properties.mode) {
      availableModes.add(f.properties.mode);
    }
  });

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
    pointToLayer: (_, ll) => L.circleMarker(ll, {
      radius: 6,
      fillColor: "#000",
      color: "#fff",
      weight: 1,
      fillOpacity: 0.9
    }),
    onEachFeature: (f, layer) =>
      layer.bindPopup(`<strong>${f.properties.name}</strong><br><small>Route: ${f.properties.route_id}</small>`)
  }).addTo(map);
}

function initFilters() {
  const container = L.control({ position: 'topright' });

  container.onAdd = () => {
    const div = L.DomUtil.create('div', 'filter-panel');
    div.innerHTML = `<h4>Filter Modes</h4>`;

    const iconMap = {
      "Podapoda": "https://cdn-icons-png.flaticon.com/512/190/190675.png",
      "Keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
      "Taxi": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
      "Paratransit Bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
      "WAKA FINE Bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
      "Motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
    };

    Array.from(availableModes).sort().forEach(mode => {
      const iconUrl = iconMap[mode] || "";
      div.innerHTML += `
        <label>
          <input type="checkbox" value="${mode}" checked>
          <img src="${iconUrl}" alt="${mode}" style="width: 18px; vertical-align: middle; margin-right: 6px;">
          ${mode}
        </label><br>
      `;
    });

    div.onmousedown = div.ondblclick = L.DomEvent.stopPropagation;
    return div;
  };

  container.addTo(map);

  setTimeout(() => {
    document.querySelectorAll('.filter-panel input').forEach(inp => {
      inp.addEventListener('change', applyFilters);
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
      iconUrl = "https://cdn-icons-png.flaticon.com/512/190/190675.png";
      break;
    case "Keke":
      iconUrl = "https://cdn-icons-png.flaticon.com/512/2967/2967037.png";
      break;
    case "Taxi":
      iconUrl = "https://cdn-icons-png.flaticon.com/512/743/743007.png";
      break;
    case "Paratransit Bus":
      iconUrl = "https://cdn-icons-png.flaticon.com/512/61/61221.png";
      break;
    case "WAKA FINE Bus":
      iconUrl = "https://cdn-icons-png.flaticon.com/512/861/861060.png";
      break;
    case "Motorbike":
      iconUrl = "https://cdn-icons-png.flaticon.com/512/4721/4721203.png";
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
      vehicleMarkers[id].setLatLng([lat, lon])
        .setPopupContent(`🚐 <b>${id}</b><br>ETA: ${eta_min} min`);
    } else {
      const m = L.marker([lat, lon], { icon }).addTo(map)
        .bindPopup(`🚐 <b>${id}</b><br>ETA: ${eta_min} min`);
      m.mode = mode;
      vehicleMarkers[id] = m;
    }
  }
}

   
