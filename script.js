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
let selectedStopCoords = null; // for stop filtering
const STOP_FILTER_RADIUS = 500; // meters

// ================== ICON MAP ==================
const iconMap = {
  "podapoda": "img/podapoda.png", // Your provided podapoda icon
  "keke": "img/keke.png", // First selected keke icon
  "taxi": "img/taxi.png", // Second selected taxi icon
  "paratransit bus": "https://png.pngtree.com/png-clipart/20230925/original/pngtree-public-bus-illustration-png-image_13067476.png", // First bus icon
  "waka fine bus": "https://png.pngtree.com/png-clipart/20230925/original/pngtree-travel-tour-bus-illustration-png-image_13067477.png", // Third bus icon
  "motorbike": "https://static.vecteezy.com/system/resources/previews/013/743/488/original/motorcycle-silhouette-clipart-free-png.png" // Fourth motorcycle icon
};

// ================== HELPERS ==================
function getIcon(mode) {
  const key = (mode || "podapoda").toLowerCase();
  const url = iconMap[key] || iconMap["podapoda"];
  return L.icon({
    iconUrl: url,
    iconSize: [38, 38], // larger for better visibility
    iconAnchor: [19, 38],
    popupAnchor: [0, -38]
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

function isVehicleNearStop(vehicle) {
  if (!selectedStopCoords) return true; // no filter
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

    // Populate stop dropdown
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
          }
        } else {
          selectedStopCoords = null; // reset filter
        }
        updateSidebarETAs();
        updateSidebarAlerts();
      });
    }
  } catch (err) {
    console.error("loadStops error:", err);
  }
}

// ================== VEHICLE FETCH & SIDEBAR ==================
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");
    const payload = await res.json();
    vehiclesData = Array.isArray(payload.vehicles) ? payload.vehicles : [];

    vehiclesData.forEach(v => {
      if (!v.id || !v.lat || !v.lon) return;
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

function updateSidebarETAs() {
  const etaList = $id("etaList");
  if (!etaList) return;
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
    if (userMarker) {
      const u = userMarker.getLatLng();
      const { distance, eta } = computeETA(u.lat, u.lng, v.lat, v.lon);
      distanceText = ` — ${distance} m, ETA ~${eta} min`;
    }
    div.innerHTML = `
      <img src="${iconURL}" alt="${v.mode}" style="width:20px;height:20px;vertical-align:middle;margin-right:6px;">
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

  let list = vehiclesData;
  if (selectedStopCoords) {
    list = list.filter(v => isVehicleNearStop(v));
  }

  if (userMarker) {
    const u = userMarker.getLatLng();
    list.forEach(v => {
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

// ================== LOCATE ME ==================
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

  const toggleBtn = $id("toggleSidebarBtn");
  const sidebar = $id("sidebar");
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener("click", () => {
      sidebar.classList.toggle("open");
    });
  }
});
