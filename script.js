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
let selectedStopCoords = null;
const STOP_FILTER_RADIUS = 800; // meters
let vehiclesData = [];
let trackedVehicleId = null;

// ================== ICON MAP ==================
const iconMap = {
  "podapoda": "assets/icons/podapoda.png",
  "keke": "assets/icons/keke.png",
  "taxi": "assets/icons/taxi.png",
  "paratransit bus": "assets/icons/paratransit_bus.png",
  "waka fine bus": "assets/icons/waka_fine_bus.png",
  "motorbike": "assets/icons/motorbike.png"
};

// ================== HELPERS ==================
function getIcon(mode) {
  const key = (mode || "podapoda").toLowerCase();
  const url = iconMap[key] || iconMap["podapoda"];
  return L.icon({
    iconUrl: url,
    iconSize: [35, 35],
    iconAnchor: [17, 35],
    popupAnchor: [0, -35]
  });
}

function computeETA(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
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

function isVehicleNearStop(vehicle) {
  if (!selectedStopCoords) return true;
  const { distance } = computeETA(
    selectedStopCoords.lat, selectedStopCoords.lon,
    vehicle.lat, vehicle.lon
  );
  return distance <= STOP_FILTER_RADIUS;
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

    const stopSelect = $id("stopSelect");
    if (stopSelect) {
      stopSelect.innerHTML = `<option value="">-- Select Stop --</option>`;
      geojson.features.forEach(f => {
        stopSelect.innerHTML += `<option value="${f.properties.name}">${f.properties.name}</option>`;
      });
      stopSelect.addEventListener("change", () => {
        const selectedStop = stopSelect.value;
        if (selectedStop) {
          const feature = geojson.features.find(f => f.properties.name === selectedStop);
          if (feature) {
            const [lon, lat] = feature.geometry.coordinates;
            selectedStopCoords = { lat, lon };
            map.setView([lat, lon], 16);
            autoTrackNearestVehicle();
          }
        } else {
          selectedStopCoords = null;
          trackedVehicleId = null;
        }
      });
    }
  } catch (err) {
    console.error("loadStops error:", err);
  }
}

// ================== VEHICLE FETCH & AUTO-TRACK ==================
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");
    const payload = await res.json();
    vehiclesData = Array.isArray(payload.vehicles) ? payload.vehicles : [];

    vehiclesData.forEach(v => {
      if (!v.id || !v.lat || !v.lon) return;
      const icon = getIcon(v.mode);
      if (vehicleMarkers[v.id]) {
        vehicleMarkers[v.id].setLatLng([v.lat, v.lon]).setIcon(icon);
      } else {
        vehicleMarkers[v.id] = L.marker([v.lat, v.lon], { icon }).addTo(map);
      }
    });

    updateSidebarETAs();
    updateSidebarAlerts();

    if (trackedVehicleId) {
      const tracked = vehiclesData.find(v => v.id === trackedVehicleId);
      if (tracked) {
        map.panTo([tracked.lat, tracked.lon]);
      }
    }
  } catch (err) {
    console.error("fetchVehicles error:", err);
  }
}

function autoTrackNearestVehicle() {
  if (!selectedStopCoords) return;
  let nearest = null;
  let minDistance = Infinity;
  vehiclesData.forEach(v => {
    const { distance } = computeETA(selectedStopCoords.lat, selectedStopCoords.lon, v.lat, v.lon);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = v;
    }
  });
  if (nearest) {
    trackedVehicleId = nearest.id;
    map.panTo([nearest.lat, nearest.lon]);
  }
}

// ================== SIDEBAR ==================
function updateSidebarETAs() {
  const etaList = $id("etaList");
  etaList.innerHTML = "";
  let list = vehiclesData;
  if (selectedStopCoords) {
    list = list.filter(v => isVehicleNearStop(v));
  }
  if (!list.length) {
    etaList.innerHTML = "<p>No data available.</p>";
    return;
  }
  list.forEach(v => {
    const iconURL = iconMap[(v.mode || "podapoda").toLowerCase()] || iconMap["podapoda"];
    const div = document.createElement("div");
    div.className = "sidebar-item";
    let distanceText = "";
    if (selectedStopCoords) {
      const { distance, eta } = computeETA(selectedStopCoords.lat, selectedStopCoords.lon, v.lat, v.lon);
      distanceText = ` — ${distance} m, ETA ~${eta} min`;
    }
    div.innerHTML = `
      <img src="${iconURL}" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;">
      ${v.id} (${v.mode || "unknown"}) ${distanceText}
    `;
    etaList.appendChild(div);
  });
}

function updateSidebarAlerts() {
  const alertList = $id("alertSidebar");
  alertList.innerHTML = "";
  let found = false;
  let list = vehiclesData;
  if (selectedStopCoords) {
    list = list.filter(v => isVehicleNearStop(v));
  }
  list.forEach(v => {
    const { eta } = computeETA(selectedStopCoords.lat, selectedStopCoords.lon, v.lat, v.lon);
    if (eta <= 3) {
      const div = document.createElement("div");
      div.className = "alert-item";
      div.textContent = `⚠️ ${v.id} arriving in ~${eta} min`;
      alertList.appendChild(div);
      found = true;
    }
  });
  if (!found) {
    alertList.innerHTML = "<p>No nearby vehicles within alert range.</p>";
  }
}

// ================== LOCATE ME ==================
function addLocateMeButton() {
  const locateBtn = $id("locateMeBtn");
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
    });
  });
}

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", () => {
  if (!promptLogin()) return;
  initMap();

  const toggleBtn = $id("toggleSidebarBtn");
  const sidebar = $id("sidebar");
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener("click", () => {
      sidebar.classList.toggle("open");
    });
  }

  const roleSelect = $id("roleSelect");
  const driverInputs = $id("driverInputs");
  if (roleSelect) {
    roleSelect.addEventListener("change", () => {
      driverInputs.style.display = roleSelect.value.startsWith("driver") ? "block" : "none";
    });
  }
});
