// ============================
// CONFIG
// ============================

// Backend URL
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";

// Vehicle mode → icon mapping
const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

// Refresh interval (ms)
const REFRESH_INTERVAL = 2000;

// ============================
// GLOBALS
// ============================
let map, userMarker = null;
let vehicleMarkers = {};
let vehiclesData = [];
let routeLayers = L.featureGroup();
let stopsLayer;
let trackingVehicleId = null;
let trackingMode = null;
let trackingInterval = null;

// ============================
// HELPER FUNCTIONS
// ============================

// Compute ETA + distance
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

// Get Leaflet icon for mode
function getIcon(mode) {
  const key = mode?.toLowerCase() || "podapoda";
  return L.icon({
    iconUrl: iconMap[key],
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30]
  });
}

// Create or update a vehicle marker (used by both fetchVehicles & tracking)
function createOrUpdateVehicleMarker(id, lat, lon, mode) {
  const icon = getIcon(mode);
  let popupContent = `<b>Vehicle ID:</b> ${id}<br><b>Mode:</b> ${mode}`;

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
}

// ============================
// MAP INIT
// ============================

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
  setupSidebarToggle();
  setupTrackingForm();
  fetchVehicles();

  setInterval(fetchVehicles, REFRESH_INTERVAL);
}

// ============================
// FETCH FUNCTIONS
// ============================

async function loadRoutes() {
  try {
    const res = await fetch("data/routes.geojson");
    if (!res.ok) throw new Error("Routes fetch failed.");
    const geojson = await res.json();
    routeLayers.clearLayers();

    L.geoJSON(geojson, {
      style: f => ({
        color: f.properties.color || "#3388ff",
        weight: 5,
        opacity: 0.7
      })
    }).addTo(routeLayers);
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
      pointToLayer: (_, latlng) => L.circleMarker(latlng, {
        radius: 6, fillColor: "#ff0000", color: "#880000", weight: 1, fillOpacity: 0.8
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
    const vehicles = data.vehicles || [];

    vehicles.forEach(v => {
      if (v.lat && v.lon) createOrUpdateVehicleMarker(v.id, v.lat, v.lon, v.mode);
    });

  } catch (err) {
    console.error("Vehicle update error:", err);
  }
}

// ============================
// TRACKING
// ============================

function startTracking(vehicleId, mode) {
  trackingVehicleId = vehicleId;
  trackingMode = mode;
  if (trackingInterval) clearInterval(trackingInterval);

  trackingInterval = setInterval(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/vehicles`);
      const data = await res.json();
      const vehicle = (data.vehicles || []).find(v => v.id === trackingVehicleId);
      if (vehicle) {
        createOrUpdateVehicleMarker(vehicle.id, vehicle.lat, vehicle.lon, vehicle.mode);
        map.setView([vehicle.lat, vehicle.lon], 15);
      }
    } catch (err) {
      console.error("Tracking error:", err);
    }
  }, REFRESH_INTERVAL);
}

function stopTracking() {
  trackingVehicleId = null;
  trackingMode = null;
  if (trackingInterval) clearInterval(trackingInterval);
}

// ============================
// UI FUNCTIONS
// ============================

function addLocateMeButton() {
  const locateBtn = document.getElementById("locateMeBtn");
  if (!locateBtn) return;
  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) return alert("Geolocation not supported");
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords;
      if (userMarker) userMarker.setLatLng([latitude, longitude]);
      else {
        userMarker = L.marker([latitude, longitude], {
          icon: L.icon({ iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png", iconSize: [25, 25] })
        }).addTo(map);
      }
      map.setView([latitude, longitude], 15);
    });
  });
}

function setupSidebarToggle() {
  const toggleBtn = document.getElementById("sidebarToggle");
  const sidebar = document.querySelector(".sidebar");
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener("click", () => {
      sidebar.classList.toggle("open");
    });
  }
}

function setupTrackingForm() {
  const form = document.getElementById("trackingForm");
  const modal = document.getElementById("trackingModal");
  const startBtn = document.getElementById("openTrackingModal");
  const closeBtn = document.getElementById("closeTrackingModal");

  if (startBtn && modal) {
    startBtn.addEventListener("click", () => {
      modal.style.display = "block";
      modal.removeAttribute("aria-hidden");
      document.getElementById("vehicleId").focus();
    });
  }

  if (closeBtn && modal) {
    closeBtn.addEventListener("click", () => {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      startBtn.focus();
    });
  }

  if (form) {
    form.addEventListener("submit", e => {
      e.preventDefault();
      const id = document.getElementById("vehicleId").value.trim();
      const mode = document.getElementById("mode").value.trim();
      if (!id || !mode) return alert("Enter both Vehicle ID and Mode");
      startTracking(id, mode);
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      startBtn.focus();
    });
  }
}

// ============================
// INIT
// ============================

window.addEventListener("DOMContentLoaded", initMap);
