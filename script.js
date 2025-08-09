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
  await loadStops();
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
  const key = (mode || "unknown").trim().toLowerCase(); // <- Avoids undefined.trim() crash

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
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    const data = await res.json();

    console.log("Fetched vehicles data:", data);  // Debug log

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
    updateSidebarAlerts();
  } catch (error) {
    console.error("Error fetching vehicle data:", error);
  }
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
        if (userLatLng.distanceTo(stopLatLng) < 300) {
          const circle = L.circle(stopLatLng, {
            radius: 300,
            color: "#3388ff",
            weight: 2,
            fillOpacity: 0.1
          }).addTo(map);
          nearbyStopCircles.push(circle);
        }
      });
    }
  }, () => {
    alert("Unable to retrieve your location.");
  });
}

function updateSidebarAlerts() {
  const sidebar = document.getElementById("alertSidebar");  // <-- Fixed ID here
  if (!sidebar) return;

  const nearbyVehicles = Object.entries(vehiclesData).filter(([_, v]) => v.eta_min < 5);
  sidebar.innerHTML = `<h3>Alerts (vehicles arriving soon)</h3>`;

  if (nearbyVehicles.length === 0) {
    sidebar.innerHTML += `<p>No vehicles arriving in the next 5 minutes.</p>`;
    return;
  }

  nearbyVehicles.forEach(([id, v]) => {
    sidebar.innerHTML += `
      <div style="margin-bottom: 6px;">
        <img src="${getIcon(v.mode).options.iconUrl}" style="width: 20px; vertical-align: middle; margin-right: 8px;">
        <strong>${v.mode}</strong> #${id} arriving in ${v.eta_min} min
      </div>
    `;
  });
}

function addLocateMeButton() {
  const locateControl = L.control({ position: "topright" });

  locateControl.onAdd = () => {
    const div = L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-custom");
    div.innerHTML = `<button title="Locate Me" style="background:#fff; border:none; padding: 6px; cursor:pointer;">📍</button>`;
    div.onclick = () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
          const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
          map.setView(latlng, 15);

          if (userMarker) {
            userMarker.setLatLng(latlng).openPopup();
          } else {
            userMarker = L.circleMarker(latlng, {
              radius: 8,
              fillColor: "#3388ff",
              color: "#fff",
              weight: 2,
              fillOpacity: 0.9
            }).addTo(map).bindPopup("📍 You are here").openPopup();
          }
        }, () => alert("Unable to retrieve your location."));
      } else {
        alert("Geolocation not supported by your browser.");
      }
    };
    return div;
  };

  locateControl.addTo(map);
}


document.getElementById("clearVehiclesBtn").addEventListener("click", async () => {
  // Clear backend
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles/clear`, {
      method: "POST"
    });
    const result = await res.json();
    console.log(result.message || "Vehicles cleared on backend");
  } catch (err) {
    console.error("Error clearing backend vehicles:", err);
  }

  // Clear frontend markers
  Object.values(vehicleMarkers).forEach(m => map.removeLayer(m));
  vehicleMarkers = {};
  vehiclesData = {};
  document.getElementById("lastUpdated").innerText = "--";

  if (stopsLayer) {
    stopsLayer.eachLayer(layer => {
      const stopName = layer.feature?.properties?.name || "Stop";
      layer.setPopupContent(`<strong>${stopName}</strong><br>No vehicles nearby.`);
    });
  }

  const sidebar = document.getElementById("alertSidebar");
  if (sidebar) {
    sidebar.innerHTML = `<h3>Alerts (vehicles arriving soon)</h3><p>No vehicles arriving in the next 5 minutes.</p>`;
  }

  alert("🚫 All vehicles permanently cleared from frontend and backend.");
});
