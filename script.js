// ==================== LOGIN CHECK ====================
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

// ==================== GLOBAL VARIABLES ====================
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, userMarker = null;
let vehicleMarkers = {};
let vehiclesData = [];
let routeLayers = L.featureGroup();
let stopsLayer;
let trackingInterval = null;
let trackedVehicleId = null;
let trackedVehicleMode = null;

const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

// ==================== HELPER FUNCTIONS ====================
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

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}

function getIcon(mode) {
  const key = mode?.toLowerCase() || "podapoda";
  return L.icon({
    iconUrl: iconMap[key] || iconMap["podapoda"],
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30]
  });
}

// ==================== MAP LOADING ====================
async function loadRoutes() {
  try {
    const res = await fetch("data/routes.geojson");
    if (!res.ok) throw new Error("Routes fetch failed.");
    const geojson = await res.json();
    routeLayers.clearLayers();

    L.geoJSON(geojson, {
      style: feature => ({
        color: feature.properties.color || "#3388ff",
        weight: 5,
        opacity: 0.7
      }),
      onEachFeature: (feature, layer) => {
        if (feature.properties?.name) {
          layer.bindPopup(`<strong>Route:</strong> ${feature.properties.name}`);
        }
        routeLayers.addLayer(layer);
      }
    });

    routeLayers.addTo(map);
  } catch (err) {
    console.error(err);
  }
}

async function loadStops() {
  try {
    const res = await fetch("data/stops.geojson");
    if (!res.ok) throw new Error("Stops fetch failed.");
    const geojson = await res.json();
    if (stopsLayer) stopsLayer.clearLayers();

    stopsLayer = L.geoJSON(geojson, {
      pointToLayer: (feature, latlng) => {
        return L.circleMarker(latlng, {
          radius: 6,
          fillColor: "#ff0000",
          color: "#880000",
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        });
      },
      onEachFeature: (feature, layer) => {
        if (feature.properties?.name) {
          layer.bindPopup(`<strong>Stop:</strong> ${feature.properties.name}`);
        }
      }
    }).addTo(map);
  } catch (err) {
    console.error(err);
  }
}

// ==================== VEHICLE FETCHING ====================
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");

    const { vehicles } = await res.json();
    vehiclesData = vehicles;

    vehicles.forEach(vehicle => {
      const { id, lat, lon, mode } = vehicle;
      if (!id || !lat || !lon) return;

      const icon = getIcon(mode);
      let popupContent = `<b>Vehicle ID:</b> ${id}<br><b>Mode:</b> ${capitalize(mode)}`;
      if (userMarker) {
        const userPos = userMarker.getLatLng();
        const { distance, eta } = computeETA(userPos.lat, userPos.lng, lat, lon);
        popupContent += `<br><b>Distance:</b> ${distance} m<br><b>ETA:</b> ${eta} min`;
      }

      if (vehicleMarkers[id]) {
        vehicleMarkers[id].setLatLng([lat, lon]);
        vehicleMarkers[id].setIcon(icon);
        vehicleMarkers[id].setPopupContent(popupContent);
      } else {
        vehicleMarkers[id] = L.marker([lat, lon], { icon }).bindPopup(popupContent).addTo(map);
      }
    });

    updateSidebarETAs();
    updateSidebarAlerts();

  } catch (err) {
    console.error("Vehicle update error:", err);
  }
}

// ==================== TRACKING ====================
function startTracking(vehicleId, mode) {
  trackedVehicleId = vehicleId;
  trackedVehicleMode = mode;
  document.getElementById("stopTrackingBtn").style.display = "block";

  if (trackingInterval) clearInterval(trackingInterval);

  trackingInterval = setInterval(async () => {
    await fetchVehicles();
    if (trackedVehicleId) {
      const tracked = vehiclesData.find(v => v.id === trackedVehicleId);
      if (tracked) {
        map.setView([tracked.lat, tracked.lon], 15);
      }
    }
  }, 2000);
}

function stopTracking() {
  trackedVehicleId = null;
  trackedVehicleMode = null;
  document.getElementById("stopTrackingBtn").style.display = "none";
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
}

// ==================== SIDEBAR UPDATES ====================
function updateSidebarETAs() {
  const etaList = document.getElementById("etaList");
  if (!etaList) return;
  etaList.innerHTML = "";
  vehiclesData.forEach(v => {
    const icon = `<img src="${iconMap[v.mode.toLowerCase()]}" style="width:20px;height:20px;vertical-align:middle;margin-right:5px;">`;
    etaList.innerHTML += `<div>${icon}<b>${v.id}</b> - ${capitalize(v.mode)}</div>`;
  });
}

function updateSidebarAlerts() {
  const alertList = document.getElementById("alertSidebar");
  if (!alertList) return;
  alertList.innerHTML = "<div>No alerts</div>";
}

// ==================== MAP INITIALIZATION ====================
function initMap() {
  map = L.map("map").setView([8.48, -13.22], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(map);

  routeLayers.addTo(map);
  loadRoutes();
  loadStops();
  fetchVehicles();
  setInterval(fetchVehicles, 2000);

  document.getElementById("startTrackingBtn").addEventListener("click", () => {
    const id = prompt("Enter Vehicle ID to track:");
    const mode = prompt("Enter Transport Mode:");
    if (id && mode) startTracking(id, mode);
  });

  document.getElementById("stopTrackingBtn").addEventListener("click", stopTracking);

  document.getElementById("sidebarToggle").addEventListener("click", () => {
    document.querySelector(".sidebar").classList.toggle("collapsed");
  });
}

// ==================== PAGE LOAD ====================
window.addEventListener("DOMContentLoaded", () => {
  if (promptLogin()) {
    initMap();
  }
});
