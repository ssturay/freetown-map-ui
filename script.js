// =====================
// Login check on page load
// =====================
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

// =====================
// Map variables
// =====================
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, userMarker = null;
let vehicleMarkers = {};
let vehiclesData = [];
let routeLayers = L.featureGroup();
let stopsLayer;
let trackingInterval = null;
let currentTrackedVehicle = null;

// Vehicle icon map
const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

// =====================
// Helper functions
// =====================
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

// =====================
// Map setup
// =====================
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

  setupTrackingButtons();
  setupSidebarToggle();
  setupTrackingForm();
}

// =====================
// Fetch & display routes
// =====================
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
      }),
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

// =====================
// Vehicle fetching
// =====================
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");
    const data = await res.json();
    const list = data.vehicles || [];

    list.forEach(vehicle => {
      const { id, lat, lon, mode } = vehicle;
      if (!id || !lat || !lon) return;

      const icon = getIcon(mode);
      let popupContent = `Vehicle ID: ${id}<br>Mode: ${mode}`;
      if (userMarker) {
        const userPos = userMarker.getLatLng();
        const { distance, eta } = computeETA(userPos.lat, userPos.lng, lat, lon);
        popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }

      if (vehicleMarkers[id]) {
        vehicleMarkers[id].setLatLng([lat, lon]).setIcon(icon).setPopupContent(popupContent);
      } else {
        vehicleMarkers[id] = L.marker([lat, lon], { icon }).bindPopup(popupContent).addTo(map);
      }
    });
  } catch (err) {
    console.error("Vehicle update error:", err);
  }
}

// =====================
// Locate Me button
// =====================
function addLocateMeButton() {
  const btn = document.getElementById("locateMeBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Geolocation not supported.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        if (userMarker) {
          userMarker.setLatLng([lat, lon]);
        } else {
          userMarker = L.marker([lat, lon], {
            title: "You are here",
            icon: L.icon({
              iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
              iconSize: [25, 25]
            })
          }).addTo(map);
        }
        map.setView([lat, lon], 15);
      },
      err => console.error(err)
    );
  });
}

// =====================
// Tracking
// =====================
function startTracking(vehicleId, transportMode) {
  currentTrackedVehicle = vehicleId;
  clearInterval(trackingInterval);
  trackingInterval = setInterval(() => updateTrackedVehicle(vehicleId, transportMode), 2000);
  document.getElementById("stopTrackingBtn").style.display = "block";
}

function stopTracking() {
  clearInterval(trackingInterval);
  trackingInterval = null;
  currentTrackedVehicle = null;
  document.getElementById("stopTrackingBtn").style.display = "none";
}

async function updateTrackedVehicle(vehicleId, transportMode) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    const data = await res.json();
    const vehicle = (data.vehicles || []).find(v => v.id === vehicleId);
    if (!vehicle) return;
    const icon = getIcon(transportMode);
    let popupContent = `Vehicle ID: ${vehicleId}<br>Mode: ${transportMode}`;
    if (userMarker) {
      const userPos = userMarker.getLatLng();
      const { distance, eta } = computeETA(userPos.lat, userPos.lng, vehicle.lat, vehicle.lon);
      popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
    }
    if (vehicleMarkers[vehicleId]) {
      vehicleMarkers[vehicleId].setLatLng([vehicle.lat, vehicle.lon]).setIcon(icon).setPopupContent(popupContent);
    } else {
      vehicleMarkers[vehicleId] = L.marker([vehicle.lat, vehicle.lon], { icon }).bindPopup(popupContent).addTo(map);
    }
    map.setView([vehicle.lat, vehicle.lon], 15);
  } catch (err) {
    console.error("Tracking error:", err);
  }
}

// =====================
// UI Setup
// =====================
function setupSidebarToggle() {
  const toggle = document.getElementById("sidebarToggle");
  const sidebar = document.querySelector(".sidebar");
  if (!toggle || !sidebar) return;
  toggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-collapsed");
  });
}

function setupTrackingButtons() {
  const startBtn = document.getElementById("openTrackingModal");
  const stopBtn = document.getElementById("stopTrackingBtn");
  if (stopBtn) stopBtn.style.display = "none";
  if (stopBtn) stopBtn.addEventListener("click", stopTracking);
}

function setupTrackingForm() {
  const form = document.getElementById("trackingForm");
  if (!form) return;
  form.addEventListener("submit", e => {
    e.preventDefault();
    const vehicleId = document.getElementById("vehicleId").value.trim();
    const transportMode = document.getElementById("mode").value.trim();
    if (!vehicleId || !transportMode) {
      alert("Please enter both Vehicle ID and Mode.");
      return;
    }
    startTracking(vehicleId, transportMode);
    document.getElementById("trackingModal").style.display = "none";
  });
}

// =====================
// Init on page load
// =====================
window.addEventListener("DOMContentLoaded", () => {
  if (promptLogin()) {
    initMap();
  }
});
