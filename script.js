// ================== LOGIN PROMPT ==================
function promptLogin() {
  if (localStorage.getItem("loggedIn") === "true") return true;

  const username = prompt("Enter username:");
  const password = prompt("Enter password:");

  const VALID_USERNAME = "admin";
  const VALID_PASSWORD = "mypassword";

  if (username !== VALID_USERNAME || password !== VALID_PASSWORD) {
    alert("Access denied");
    document.body.innerHTML = "<h2 style='text-align:center; padding: 2rem;'>Access Denied</h2>";
    return false;
  }

  localStorage.setItem("loggedIn", "true");
  return true;
}

// ================== GLOBALS ==================
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, userMarker = null;
let vehicleMarkers = {};
let routeLayers = L.featureGroup();
let stopsLayer;
let trackingInterval = null;
let trackedVehicleId = null;
let trackedMode = null;
let vehiclesData = [];
let stopsData = []; // store real stops

// ================== ICON MAP ==================
const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

// ================== HELPERS ==================
function getIcon(mode) {
  const key = (mode || "podapoda").toLowerCase();
  const url = iconMap[key] || iconMap["podapoda"];
  return L.icon({
    iconUrl: url,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30]
  });
}

function computeETA(userLat, userLon, vehicleLat, vehicleLon) {
  const R = 6371e3;
  const φ1 = userLat * Math.PI / 180;
  const φ2 = vehicleLat * Math.PI / 180;
  const Δφ = (vehicleLat - userLat) * Math.PI / 180;
  const Δλ = (vehicleLon - userLon) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) ** 2 +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  const walkingSpeed = 1.4;

  return {
    distance: Math.round(distance),
    eta: Math.round(distance / walkingSpeed / 60)
  };
}

function $id(id) {
  return document.getElementById(id) || null;
}

// ================== MAP INIT ==================
function initMap() {
  map = L.map("map").setView([8.48, -13.22], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(map);

  routeLayers.addTo(map);
  loadRoutes();
  loadStops();
  loadStopsIntoDropdown(); // NEW: populate real stops dropdown
  addLocateMeButton();

  fetchVehicles();
  setInterval(fetchVehicles, 2000);
}

// ================== ROUTES & STOPS ==================
async function loadRoutes() {
  try {
    const res = await fetch("data/routes.geojson");
    if (!res.ok) throw new Error("Routes fetch failed.");
    const geojson = await res.json();
    routeLayers.clearLayers();
    L.geoJSON(geojson, {
      style: feature => ({
        color: feature.properties?.color || "#3388ff",
        weight: 5,
        opacity: 0.7
      })
    }).addTo(routeLayers);
  } catch (err) {
    console.error("loadRoutes error:", err);
  }
}

async function loadStops() {
  try {
    const res = await fetch("data/stops.geojson");
    if (!res.ok) throw new Error("Stops fetch failed.");
    const geojson = await res.json();
    stopsData = geojson.features; // store real stops
    if (stopsLayer) stopsLayer.clearLayers();
    stopsLayer = L.geoJSON(geojson, {
      pointToLayer: (feature, latlng) =>
        L.circleMarker(latlng, {
          radius: 6,
          fillColor: "#ff0000",
          color: "#880000",
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        })
    }).addTo(map);
  } catch (err) {
    console.error("loadStops error:", err);
  }
}

// ================== Populate Stops Dropdown ==================
async function loadStopsIntoDropdown() {
  try {
    const res = await fetch("data/stops.geojson");
    if (!res.ok) throw new Error("Stops fetch failed.");
    const geojson = await res.json();
    const stopSelect = $id("stopSelect");
    stopSelect.innerHTML = `<option value="">All Stops</option>`;
    geojson.features.forEach(f => {
      const stopName = f.properties?.name || "Unnamed Stop";
      const option = document.createElement("option");
      option.value = stopName;
      option.textContent = stopName;
      stopSelect.appendChild(option);
    });
  } catch (err) {
    console.error("Error loading stops into dropdown:", err);
  }
}

// ================== VEHICLE FETCH & SIDEBAR ==================
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");
    const payload = await res.json();
    vehiclesData = Array.isArray(payload.vehicles) ? payload.vehicles : [];

    const selectedStop = $id("stopSelect")?.value || "";

    vehiclesData.forEach(v => {
      if (!v.id || !v.lat || !v.lon) return;

      // Filter by selected stop if any
      if (selectedStop) {
        const stop = stopsData.find(s => s.properties?.name === selectedStop);
        if (stop) {
          const stopCoords = stop.geometry.coordinates;
          const { distance } = computeETA(stopCoords[1], stopCoords[0], v.lat, v.lon);
          if (distance > 1000) return; // skip if > 1km from stop
        }
      }

      const icon = getIcon(v.mode);
      let popupContent = `<b>Vehicle ID:</b> ${v.id}<br><b>Mode:</b> ${v.mode || "unknown"}`;
      if (userMarker) {
        const uPos = userMarker.getLatLng();
        const { distance, eta } = computeETA(uPos.lat, uPos.lng, v.lat, v.lon);
        popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }
      if (vehicleMarkers[v.id]) {
        vehicleMarkers[v.id].setLatLng([v.lat, v.lon]);
        vehicleMarkers[v.id].setIcon(icon);
        vehicleMarkers[v.id].setPopupContent(popupContent);
      } else {
        vehicleMarkers[v.id] = L.marker([v.lat, v.lon], { icon })
          .bindPopup(popupContent)
          .addTo(map);
      }
    });

    const lastUpdated = $id("lastUpdated");
    if (lastUpdated) lastUpdated.textContent = new Date().toLocaleTimeString();

    updateSidebarETAs();
    updateSidebarAlerts();
  } catch (err) {
    console.error("fetchVehicles error:", err);
  }
}

// ================== ETAs & Alerts ==================
function updateSidebarETAs() {
  const etaList = $id("etaList");
  if (!etaList) return;
  etaList.innerHTML = "";

  if (!vehiclesData.length) {
    etaList.innerHTML = "<p>No data available.</p>";
    return;
  }

  vehiclesData.forEach(v => {
    const iconURL = iconMap[(v.mode || "podapoda").toLowerCase()] || iconMap["podapoda"];
    const div = document.createElement("div");
    div.className = "sidebar-item";
    let distanceText = "";
    if (userMarker) {
      const u = userMarker.getLatLng();
      const { distance, eta } = computeETA(u.lat, u.lng, v.lat, v.lon);
      distanceText = ` — ${distance} m, ETA ~${eta} min`;
    }
    div.innerHTML = `
      <img src="${iconURL}" alt="${v.mode}" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;">
      ${v.id} (${v.mode || "unknown"}) ${distanceText}
    `;
    etaList.appendChild(div);
  });
}

function updateSidebarAlerts() {
  const alertList = $id("alertSidebar");
  if (!alertList) return;
  alertList.innerHTML = "";
  let found = false;
  if (userMarker) {
    const u = userMarker.getLatLng();
    vehiclesData.forEach(v => {
      const { eta } = computeETA(u.lat, u.lng, v.lat, v.lon);
      if (eta <= 3) {
        const div = document.createElement("div");
        div.className = "alert-item";
        div.textContent = `⚠️ ${v.id} arriving in ~${eta} min`;
        alertList.appendChild(div);
        found = true;
      }
    });
  }
  if (!found) {
    alertList.innerHTML = "<p>No nearby vehicles within alert range.</p>";
  }
}

// ================== Locate Me Button ==================
function addLocateMeButton() {
  const locateBtn = $id("locateMeBtn");
  if (!locateBtn) return;
  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) return alert("Geolocation not supported");
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      if (userMarker) {
        userMarker.setLatLng([lat, lon]);
      } else {
        userMarker = L.marker([lat, lon], {
          icon: L.icon({
            iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
            iconSize: [25, 25]
          })
        }).addTo(map);
      }
      map.setView([lat, lon], 15);
      updateSidebarETAs();
      updateSidebarAlerts();
    }, err => {
      console.error("Geolocation error:", err);
      alert("Unable to retrieve your location.");
    });
  });
}

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", () => {
  if (!promptLogin()) return;
  initMap();
});
