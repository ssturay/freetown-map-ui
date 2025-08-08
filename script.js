function promptLogin() {
  const username = prompt("Enter username:");
  const password = prompt("Enter password:");

  const VALID_USERNAME = "admin";
  const VALID_PASSWORD = "mypassword";

  if (username !== VALID_USERNAME || password !== VALID_PASSWORD) {
    alert("Access denied");
    // Stop script execution
    document.body.innerHTML = "<h2 style='text-align:center; padding: 2rem;'>Access Denied</h2>";
    throw new Error("Unauthorized access");
  }
}

promptLogin();


const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, vehicleMarkers = {}, routeLayers = L.featureGroup();
let availableModes = new Set();
let stopsLayer;
let vehiclesData = {};
let userMarker = null;
let nearbyStopCircles = [];

const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

window.addEventListener("load", async () => {
  map = L.map("map").setView([8.48, -13.23], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 100);
  addLocateMeButton();

  await loadRoutes();
  initFilters();
  loadStops();
  fetchVehicles();
  setInterval(fetchVehicles, 10000);
  showUserLocationAndNearbyStops();
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

  stopsLayer = L.geoJSON(data, {
    pointToLayer: (_, ll) => L.circleMarker(ll, {
      radius: 6,
      fillColor: "#000",
      color: "#fff",
      weight: 1,
      fillOpacity: 0.9
    }),
    onEachFeature: (feature, layer) => {
      layer.bindPopup(`Loading arrivals...`);
    }
  }).addTo(map);
}

function initFilters() {
  const container = L.control({ position: 'topright' });

  container.onAdd = () => {
    const div = L.DomUtil.create('div', 'filter-panel');
    div.innerHTML = `<h4>Filter Modes</h4>`;

    Array.from(availableModes).sort().forEach(mode => {
      const key = mode.trim().toLowerCase();
      const iconUrl = iconMap[key] || "";
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

  // Move filter panel into sidebar container
  setTimeout(() => {
    const filterPanel = document.querySelector('.filter-panel');
    const sidebarContainer = document.querySelector('.sidebar-filter-container');
    if (filterPanel && sidebarContainer && !sidebarContainer.contains(filterPanel)) {
      sidebarContainer.appendChild(filterPanel);
    }

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
  const key = mode.trim().toLowerCase();
  const iconUrl = iconMap[key] || "https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png";

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
  vehiclesData = data;

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

  updateStopPopups();

  // ✅ Update WAKA FINE Bus alerts
  updateSidebarAlerts();
}

function updateStopPopups() {
  if (!stopsLayer) return;

  stopsLayer.eachLayer(stopLayer => {
    const stopLatLng = stopLayer.getLatLng();
    const nearbyVehicles = [];

    for (const [id, v] of Object.entries(vehiclesData)) {
      const vehicleLatLng = L.latLng(v.lat, v.lon);
      const distanceMeters = stopLatLng.distanceTo(vehicleLatLng);
      if (distanceMeters < 300) {
        nearbyVehicles.push({ id, mode: v.mode, eta_min: v.eta_min });
      }
    }

    if (nearbyVehicles.length === 0) {
      stopLayer.setPopupContent(`<strong>${stopLayer.feature.properties.name}</strong><br>No vehicles nearby.`);
    } else {
      const listHtml = nearbyVehicles.map(v =>
        `<li><img src="${getIcon(v.mode).options.iconUrl}" style="width:16px; vertical-align:middle; margin-right:4px;">` +
        `<b>${v.mode}</b> #${v.id} - ETA: ${v.eta_min} min</li>`).join("");
      stopLayer.setPopupContent(
        `<strong>${stopLayer.feature.properties.name}</strong><br>` +
        `<ul style="padding-left: 16px; margin: 4px 0;">${listHtml}</ul>`
      );
    }
  });
}

function showUserLocationAndNearbyStops() {
  if (!navigator.geolocation) {
    alert("Geolocation not supported by your browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(position => {
    const { latitude, longitude } = position.coords;
    const userLatLng = L.latLng(latitude, longitude);

    if (userMarker) {
      userMarker.setLatLng(userLatLng);
    } else {
      userMarker = L.circleMarker(userLatLng, {
        radius: 8,
        fillColor: "#3388ff",
        color: "#fff",
        weight: 2,
        fillOpacity: 0.9
      }).addTo(map).bindPopup("📍 You are here").openPopup();
    }

    map.setView(userLatLng, 15);

    nearbyStopCircles.forEach(c => map.removeLayer(c));
    nearbyStopCircles = [];

    if (stopsLayer) {
      stopsLayer.eachLayer(stopLayer => {
        const stopLatLng = stopLayer.getLatLng();
        const distance = userLatLng.distanceTo(stopLatLng);

        if (distance <= 500) {
          const circle = L.circleMarker(stopLatLng, {
            radius: 10,
            color: "#00cc44",
            weight: 2,
            fillOpacity: 0,
            dashArray: '4,2'
          }).addTo(map);
          nearbyStopCircles.push(circle);
        }
      });
    }
  }, error => {
    alert("Unable to retrieve your location.");
    console.error(error);
  });
}

function addLocateMeButton() {
  document.getElementById("locateMeBtn").addEventListener("click", () => {
    showUserLocationAndNearbyStops();
  });
}

function updateSidebarAlerts() {
  const alertSidebar = document.getElementById("alertSidebar");
  if (!alertSidebar || !vehiclesData) return;

  const wakaFineVehicles = Object.entries(vehiclesData)
    .filter(([id, v]) => v.mode.toLowerCase() === "waka fine bus");

  if (wakaFineVehicles.length === 0) {
    alertSidebar.innerHTML = "<p>No WAKA FINE Bus alerts at the moment.</p>";
    return;
  }

  let html = `<h3>🚍 WAKA FINE Bus Alerts</h3><ul style="padding-left: 16px; margin: 0;">`;
  wakaFineVehicles.forEach(([id, v]) => {
    html += `<li><b>Bus #${id}</b> — ETA: ${v.eta_min} min</li>`;
  });
  html += "</ul>";

  alertSidebar.innerHTML = html;
}

