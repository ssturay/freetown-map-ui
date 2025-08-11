// === LOGIN FUNCTION ===
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

// === GLOBAL VARIABLES ===
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, userMarker = null;
let vehicleMarkers = {};
let vehiclesData = [];
let routeLayers = L.featureGroup();
let stopsLayer;
let trackingInterval = null;
let trackedVehicleId = null;

// === ICON MAP ===
const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

// === UTILITY FUNCTIONS ===
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

// === LOAD ROUTES ===
async function loadRoutes() {
  try {
    const res = await fetch("data/routes.geojson");
    if (!res.ok) throw new Error("Routes fetch failed.");
    const geojson = await res.json();
    routeLayers.clearLayers();
    L.geoJSON(geojson, {
      style: f => ({ color: f.properties.color || "#3388ff", weight: 5, opacity: 0.7 }),
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

// === LOAD STOPS ===
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

// === FETCH VEHICLES ===
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");
    const data = await res.json();
    const list = data.vehicles || [];
    vehiclesData = list;

    list.forEach(v => {
      const { id, lat, lon, mode } = v;
      if (!id || !lat || !lon) return;
      const icon = getIcon(mode);
      let popupContent = `<b>Vehicle ID:</b> ${id}<br>Mode: ${mode}`;
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

    document.getElementById("lastUpdated").textContent = new Date().toLocaleTimeString();
  } catch (err) {
    console.error("Vehicle update error:", err);
  }
}

// === START TRACKING ===
function startTracking(vehicleId, transportMode) {
  trackedVehicleId = vehicleId;
  document.getElementById("stopTrackingBtn").style.display = "block";
  if (trackingInterval) clearInterval(trackingInterval);
  trackingInterval = setInterval(() => fetchVehicles(), 2000);
}

// === STOP TRACKING ===
function stopTracking() {
  trackedVehicleId = null;
  document.getElementById("stopTrackingBtn").style.display = "none";
  if (trackingInterval) clearInterval(trackingInterval);
  trackingInterval = setInterval(() => fetchVehicles(), 2000);
}

// === INIT MAP ===
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
  setInterval(fetchVehicles, 2000); // refresh every 2s even when tracking
}

// === EVENT LISTENERS ===
window.addEventListener("DOMContentLoaded", () => {
  if (promptLogin()) {
    initMap();

    document.getElementById("trackingForm").addEventListener("submit", e => {
      e.preventDefault();
      const vehicleId = document.getElementById("vehicleId").value.trim();
      const mode = document.getElementById("mode").value.trim();
      if (!vehicleId || !mode) return alert("Please enter vehicle ID and mode");
      startTracking(vehicleId, mode);
      document.getElementById("trackingModal").style.display = "none";
    });

    document.getElementById("stopTrackingBtn").addEventListener("click", stopTracking);
  }
});
