const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, vehicleMarkers = {}, routeLayers = L.featureGroup();
let availableModes = new Set();
let stopsLayer;
let vehiclesData = {};
let userMarker = null;
let nearbyStopCircles = [];

// We'll keep track of alerts shown to avoid duplicates
let shownAlerts = new Set();

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

  createAlertSidebar();

  await loadRoutes();
  initFilters();
  loadStops();
  fetchVehicles();
  setInterval(fetchVehicles, 10000);
  showUserLocationAndNearbyStops();
});

function createAlertSidebar() {
  // Create sidebar container for alerts
  let sidebar = document.createElement('div');
  sidebar.id = 'alertSidebar';
  sidebar.className = 'alert-sidebar';
  document.body.appendChild(sidebar);
}

function addAlert(message) {
  const sidebar = document.getElementById('alertSidebar');
  if (!sidebar) return;

  // Prevent duplicate alerts
  if (shownAlerts.has(message)) return;
  shownAlerts.add(message);

  const alertDiv = document.createElement('div');
  alertDiv.className = 'alert-msg';
  alertDiv.innerHTML = message;

  sidebar.appendChild(alertDiv);
}

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

  // Clear previous alerts on new fetch
  const sidebar = document.getElementById('alertSidebar');
  if (sidebar) sidebar.innerHTML = '';
  shownAlerts.clear();

  // Map vehicle id to stops where they will arrive soon
  // We use this to generate the "WAKA FINE Bus #x will be at stop y in z minutes" alerts
  // We’ll find the nearest stop to each waka fine bus

  // Build stop array for distance checking (name + latlng)
  let stopsArr = [];
  if (stopsLayer) {
    stopsLayer.eachLayer(stopLayer => {
      stopsArr.push({
        name: stopLayer.feature.properties.name,
        latlng: stopLayer.getLatLng()
      });
    });
  }

  // Collect WAKA FINE buses and prepare alerts
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

    // Only for WAKA FINE Bus
    if (mode.toLowerCase() === "waka fine bus") {
      // Find nearest stop (within 300m)
      let nearestStop = null;
      let nearestDistance = 999999;

      stopsArr.forEach(stop => {
        const dist = L.latLng(lat, lon).distanceTo(stop.latlng);
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestStop = stop;
        }
      });

      if (nearestStop && nearestDistance <= 300) {
        // Alert 1: WAKA FINE Bus #x will be at stop y in z minutes
        addAlert(`WAKA FINE Bus <b>#${id}</b> will be at stop <b>${nearestStop.name}</b> in ${eta_min} minute${eta_min === 1 ? '' : 's'}.`);
      }

      // Alert 2: "It looks like you usually catch WAKA FINE Bus #x at 8:00 AM — here’s today’s ETA."
      // For demo purposes, let's assume a fixed usual catch time of 8:00 AM for all buses.
      addAlert(`It looks like you usually catch WAKA FINE Bus <b>#${id}</b> at 8:00 AM — here’s today’s ETA: ${eta_min} minutes.`);
    }
  }

  updateStopPopups();
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
        const distance = userLatLng.distanceTo(stopLatLng); // in meters

        if (distance <= 500) {
          // Draw highlight
          const circle = L.circleMarker(stopLatLng, {
            radius: 10,
            color: "#00cc44",
            weight: 2,
            fillOpacity: 0,
            dashArray: '4,2'
          }).addTo(map);
          nearbyStopCircles.push(circle);

          // Estimate walking time (80m/min)
          const walkingTimeMin = Math.max(1, Math.round(distance / 80));
          const originalName = stopLayer.feature.properties.name;

          stopLayer.bindPopup(
            `<strong>${originalName}</strong><br>` +
            `🚶 Approx. ${walkingTimeMin} min walk (${Math.round(distance)} m)`
          );
        }
      });
    }
  }, error => {
    alert("Unable to retrieve your location.");
    console.error(error);
  });
}

function addLocateMeButton() {
  const locateControl = L.control({ position: "topleft" });

  locateControl.onAdd = function () {
    const div = L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-custom");
    div.innerHTML = "📍";
    div.title = "Locate Me";

    Object.assign(div.style, {
      backgroundColor: "white",
      padding: "6px 10px",
      cursor: "pointer",
      fontSize: "18px",
      textAlign: "center",
      border: "1px solid #ccc"
    });

    div.onclick = showUserLocationAndNearbyStops;
    return div;
  };

  locateControl.addTo(map);
}
