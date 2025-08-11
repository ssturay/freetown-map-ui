// ==========================
// Login prompt logic
// ==========================
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

// ==========================
// Global constants & vars
// ==========================
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, userMarker = null;
let vehicleMarkers = {};
let vehiclesData = [];
let trackedVehicleId = null;
let routeLayers = L.featureGroup();
let stopsLayer;
let trackingInterval = null;
let allVehiclesInterval = null;
let stopTrackingTimeout = null;

// Map of icons by transport mode
const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

// ==========================
// Utility functions
// ==========================
function getIcon(mode) {
  const key = mode?.toLowerCase() || "podapoda";
  return L.icon({
    iconUrl: iconMap[key] || iconMap["podapoda"],
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

// ==========================
// Map + Data loading
// ==========================
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
      })
    }).addTo(routeLayers);
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
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: 6,
        fillColor: "#ff0000",
        color: "#880000",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      })
    }).addTo(map);
  } catch (err) {
    console.error(err);
  }
}

async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");
    const data = await res.json();
    vehiclesData = data.vehicles || [];

    // Update markers for each vehicle
    vehiclesData.forEach(v => {
      if (!v.id || !v.lat || !v.lon) return;
      const icon = getIcon(v.mode);
      let popupContent = `<b>Vehicle ID:</b> ${v.id}<br><b>Mode:</b> ${v.mode}`;
      if (userMarker) {
        const userPos = userMarker.getLatLng();
        const { distance, eta } = computeETA(userPos.lat, userPos.lng, v.lat, v.lon);
        popupContent += `<br><b>Distance:</b> ${distance} m<br><b>ETA:</b> ${eta} min`;
      }
      if (vehicleMarkers[v.id]) {
        vehicleMarkers[v.id].setLatLng([v.lat, v.lon]).setIcon(icon).setPopupContent(popupContent);
      } else {
        vehicleMarkers[v.id] = L.marker([v.lat, v.lon], { icon }).bindPopup(popupContent).addTo(map);
      }
    });

    updateSidebarETAs();
    updateSidebarAlerts();
  } catch (err) {
    console.error("Vehicle update error:", err);
  }
}

// ==========================
// Tracking logic
// ==========================
function startTracking(vehicleId, mode) {
  trackedVehicleId = vehicleId;
  clearInterval(trackingInterval);
  if (stopTrackingTimeout) clearTimeout(stopTrackingTimeout);

  trackingInterval = setInterval(() => {
    fetch(`${BACKEND_URL}/api/vehicles`)
      .then(res => res.json())
      .then(data => {
        const vehicle = (data.vehicles || []).find(v => v.id === trackedVehicleId);
        if (vehicle) {
          const icon = getIcon(vehicle.mode);
          if (vehicleMarkers[vehicle.id]) {
            vehicleMarkers[vehicle.id].setLatLng([vehicle.lat, vehicle.lon]).setIcon(icon);
          } else {
            vehicleMarkers[vehicle.id] = L.marker([vehicle.lat, vehicle.lon], { icon }).addTo(map);
          }
          map.setView([vehicle.lat, vehicle.lon], 15);
        }
      });
  }, 2000);

  // Show Stop Tracking button
  document.getElementById("stopTrackingBtn").style.display = "block";

  // Auto-stop after 5 min
  stopTrackingTimeout = setTimeout(stopTracking, 5 * 60 * 1000);
}

function stopTracking() {
  trackedVehicleId = null;
  clearInterval(trackingInterval);
  document.getElementById("stopTrackingBtn").style.display = "none";
}

// ==========================
// Sidebar updates
// ==========================
function updateSidebarETAs() {
  const etaList = document.getElementById("etaList");
  if (!etaList) return;
  etaList.innerHTML = "";
  vehiclesData.forEach(v => {
    const iconUrl = iconMap[v.mode?.toLowerCase()] || iconMap["podapoda"];
    const item = document.createElement("div");
    item.className = "sidebar-item";
    item.innerHTML = `<img src="${iconUrl}" alt="${v.mode}" class="sidebar-icon"> ${v.id} (${v.mode})`;
    etaList.appendChild(item);
  });
}

function updateSidebarAlerts() {
  const alertList = document.getElementById("alertSidebar");
  if (!alertList) return;
  alertList.innerHTML = `<div class="sidebar-item">No alerts</div>`;
}

// ==========================
// Init + Events
// ==========================
function initMap() {
  map = L.map("map").setView([8.48, -13.22], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  routeLayers.addTo(map);
  loadRoutes();
  loadStops();
  fetchVehicles();

  // All vehicles refresh every 2 sec
  allVehiclesInterval = setInterval(fetchVehicles, 2000);

  // Floating buttons
  const startBtn = document.getElementById("openTrackingModal");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      document.getElementById("trackingModal").style.display = "block";
    });
  }

  const stopBtn = document.getElementById("stopTrackingBtn");
  if (stopBtn) {
    stopBtn.addEventListener("click", stopTracking);
  }

  // Form submission
  const trackingForm = document.getElementById("trackingForm");
  if (trackingForm) {
    trackingForm.addEventListener("submit", e => {
      e.preventDefault();
      const id = document.getElementById("vehicleId").value.trim();
      const mode = document.getElementById("mode").value.trim();
      if (!id || !mode) {
        alert("Please enter Vehicle ID and Mode");
        return;
      }
      startTracking(id, mode);
      document.getElementById("trackingModal").style.display = "none";
    });
  }
}

// ==========================
// Page load
// ==========================
window.addEventListener("DOMContentLoaded", () => {
  if (promptLogin()) initMap();
});
