// =======================
// Login Prompt (Unchanged)
// =======================
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

// =======================
// Global Variables
// =======================
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, userMarker = null;
let vehicleMarkers = {};
let vehiclesData = [];
let routeLayers = L.featureGroup();
let stopsLayer;
let trackingInterval = null;
let trackingTimeout = null;

const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

// =======================
// Map Init
// =======================
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
  setInterval(fetchVehicles, 2000); // Refresh all vehicles every 2s

  // Create floating tracking buttons
  createTrackingButtons();
}

// =======================
// Create Floating Buttons
// =======================
function createTrackingButtons() {
  const startBtn = document.createElement("button");
  startBtn.id = "floatingStartBtn";
  startBtn.innerHTML = "🚗 Start Tracking";
  startBtn.className = "floating-btn";
  startBtn.addEventListener("click", openTrackingModal);

  const stopBtn = document.createElement("button");
  stopBtn.id = "floatingStopBtn";
  stopBtn.innerHTML = "🛑 Stop Tracking";
  stopBtn.className = "floating-btn stop-btn";
  stopBtn.style.display = "none"; // hidden until tracking starts
  stopBtn.addEventListener("click", stopTracking);

  document.body.appendChild(startBtn);
  document.body.appendChild(stopBtn);
}

// =======================
// Open Tracking Modal
// =======================
function openTrackingModal() {
  const modal = document.getElementById("trackingModal");
  if (modal) {
    modal.style.display = "block";
    modal.removeAttribute("aria-hidden");
    document.getElementById("vehicleId").focus();
  }
}

// =======================
// Close Tracking Modal
// =======================
function closeTrackingModal() {
  const modal = document.getElementById("trackingModal");
  if (modal) {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  }
}

// =======================
// Start Tracking
// =======================
function startTracking(vehicleId, transportMode) {
  console.log(`Tracking ${vehicleId} (${transportMode})`);

  clearVehicles();

  // Hide start button, show stop button
  document.getElementById("floatingStartBtn").style.display = "none";
  document.getElementById("floatingStopBtn").style.display = "block";

  const updateTrackedVehicle = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/vehicles/${vehicleId}`);
      if (!res.ok) throw new Error("Vehicle fetch failed");
      const data = await res.json();

      if (!data.lat || !data.lon) {
        console.warn("Vehicle has no location data yet");
        return;
      }

      const icon = getIcon(transportMode);
      let popupContent = `Vehicle ID: ${vehicleId}<br>Mode: ${transportMode}`;
      if (userMarker) {
        const userPos = userMarker.getLatLng();
        const { distance, eta } = computeETA(userPos.lat, userPos.lng, data.lat, data.lon);
        popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }

      if (vehicleMarkers[vehicleId]) {
        vehicleMarkers[vehicleId].setLatLng([data.lat, data.lon]);
        vehicleMarkers[vehicleId].setIcon(icon);
        vehicleMarkers[vehicleId].setPopupContent(popupContent);
      } else {
        const marker = L.marker([data.lat, data.lon], { icon }).bindPopup(popupContent).addTo(map);
        vehicleMarkers[vehicleId] = marker;
      }

      map.setView([data.lat, data.lon], 15);
    } catch (err) {
      console.error("Tracking error:", err);
    }
  };

  updateTrackedVehicle();
  trackingInterval = setInterval(updateTrackedVehicle, 2000);

  // Auto stop after 5 minutes
  trackingTimeout = setTimeout(stopTracking, 5 * 60 * 1000);
}

// =======================
// Stop Tracking
// =======================
function stopTracking() {
  console.log("Stopping tracking...");
  clearInterval(trackingInterval);
  clearTimeout(trackingTimeout);
  trackingInterval = null;

  document.getElementById("floatingStartBtn").style.display = "block";
  document.getElementById("floatingStopBtn").style.display = "none";
}

// =======================
// Fetch Vehicles
// =======================
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");

    const data = await res.json();
    if (!data.vehicles) return;

    vehiclesData = data.vehicles;

    vehiclesData.forEach(vehicle => {
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
        vehicleMarkers[id].setLatLng([lat, lon]);
        vehicleMarkers[id].setIcon(icon);
        vehicleMarkers[id].setPopupContent(popupContent);
      } else {
        const marker = L.marker([lat, lon], { icon }).bindPopup(popupContent).addTo(map);
        vehicleMarkers[id] = marker;
      }
    });
  } catch (err) {
    console.error("Vehicle update error:", err);
  }
}

// =======================
// Helpers
// =======================
function getIcon(mode) {
  const key = mode?.toLowerCase() || "podapoda";
  return L.icon({
    iconUrl: iconMap[key],
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

function clearVehicles() {
  Object.values(vehicleMarkers).forEach(marker => map.removeLayer(marker));
  vehicleMarkers = {};
}

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
      pointToLayer: (feature, latlng) => {
        return L.circleMarker(latlng, {
          radius: 6,
          fillColor: "#ff0000",
          color: "#880000",
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        });
      }
    }).addTo(map);
  } catch (err) {
    console.error(err);
  }
}

function addLocateMeButton() {
  const locateBtn = document.getElementById("locateMeBtn");
  if (!locateBtn) return;

  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Geolocation not supported.");
      return;
    }
    navigator.geolocation.getCurrentPosition(pos => {
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
    });
  });
}

// =======================
// DOM Ready
// =======================
document.addEventListener("DOMContentLoaded", () => {
  if (promptLogin()) {
    initMap();

    // Tracking form listener
    const trackingForm = document.getElementById("trackingForm");
    if (trackingForm) {
      trackingForm.addEventListener("submit", e => {
        e.preventDefault();
        const vehicleId = document.getElementById("vehicleId").value.trim();
        const transportMode = document.getElementById("mode").value.trim();
        if (!vehicleId || !transportMode) {
          alert("Please enter both Vehicle ID and Transport Mode.");
          return;
        }
        startTracking(vehicleId, transportMode);
        closeTrackingModal();
      });
    }

    // Modal close button
    const closeBtn = document.getElementById("closeTrackingModal");
    if (closeBtn) closeBtn.addEventListener("click", closeTrackingModal);
  }
});
