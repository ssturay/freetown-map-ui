// ===================== LOGIN MODAL LOGIC =====================
function setupLoginModal() {
  const loginModal = document.getElementById("loginModal");
  const loginForm = document.getElementById("loginForm");
  const usernameInput = document.getElementById("loginUsername");
  const passwordInput = document.getElementById("loginPassword");

  // Show login modal on page load
  loginModal.style.display = "flex";
  loginModal.removeAttribute("aria-hidden");
  usernameInput.focus();

  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (username === VALID_USERNAME && password === VALID_PASSWORD) {
      localStorage.setItem("loggedIn", "true");
      loginModal.style.display = "none";
      initMap();
    } else {
      alert("Invalid credentials");
    }
  });
}

// ===================== CONFIG =====================
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
const VALID_USERNAME = "admin";
const VALID_PASSWORD = "mypassword";
let map, userMarker = null;
let vehicleMarkers = {};
let trackingInterval = null;
let routeLayers = L.featureGroup();
let stopsLayer;

// Vehicle mode → icon mapping
const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

// ===================== MAP ICON HELPER =====================
function getIcon(mode) {
  const key = mode?.toLowerCase() || "podapoda";
  return L.icon({
    iconUrl: iconMap[key],
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30]
  });
}

// ===================== ETA HELPER =====================
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

// ===================== VEHICLE FETCH & UPDATE =====================
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");
    const { vehicles } = await res.json();

    vehicles.forEach(v => {
      if (!v.lat || !v.lon) return;
      const icon = getIcon(v.mode);
      let popupContent = `<b>Vehicle ID:</b> ${v.id}<br><b>Mode:</b> ${v.mode}`;
      if (userMarker) {
        const userPos = userMarker.getLatLng();
        const { distance, eta } = computeETA(userPos.lat, userPos.lng, v.lat, v.lon);
        popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }
      if (vehicleMarkers[v.id]) {
        vehicleMarkers[v.id].setLatLng([v.lat, v.lon]).setIcon(icon).setPopupContent(popupContent);
      } else {
        vehicleMarkers[v.id] = L.marker([v.lat, v.lon], { icon }).bindPopup(popupContent).addTo(map);
      }
    });

    document.getElementById("lastUpdated").textContent = new Date().toLocaleTimeString();
  } catch (err) {
    console.error("Vehicle update error:", err);
  }
}

// ===================== ROUTES & STOPS =====================
async function loadRoutes() {
  const res = await fetch("data/routes.geojson");
  const geojson = await res.json();
  routeLayers.clearLayers();
  L.geoJSON(geojson, {
    style: f => ({ color: f.properties.color || "#3388ff", weight: 5, opacity: 0.7 })
  }).addTo(routeLayers);
}

async function loadStops() {
  const res = await fetch("data/stops.geojson");
  const geojson = await res.json();
  if (stopsLayer) stopsLayer.clearLayers();
  stopsLayer = L.geoJSON(geojson, {
    pointToLayer: (f, latlng) => L.circleMarker(latlng, {
      radius: 6, fillColor: "#ff0000", color: "#880000", weight: 1, opacity: 1, fillOpacity: 0.8
    })
  }).addTo(map);
}

// ===================== TRACKING =====================
function startTracking(vehicleId, transportMode) {
  clearInterval(trackingInterval);
  trackingInterval = setInterval(() => {
    fetch(`${BACKEND_URL}/api/vehicles/${vehicleId}`)
      .then(res => res.json())
      .then(data => {
        if (!data.lat || !data.lon) return;
        const icon = getIcon(transportMode);
        let popupContent = `<b>Vehicle ID:</b> ${vehicleId}<br><b>Mode:</b> ${transportMode}`;
        if (userMarker) {
          const userPos = userMarker.getLatLng();
          const { distance, eta } = computeETA(userPos.lat, userPos.lng, data.lat, data.lon);
          popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
        }
        if (vehicleMarkers[vehicleId]) {
          vehicleMarkers[vehicleId].setLatLng([data.lat, data.lon]).setIcon(icon).setPopupContent(popupContent);
        } else {
          vehicleMarkers[vehicleId] = L.marker([data.lat, data.lon], { icon }).bindPopup(popupContent).addTo(map);
        }
      });
  }, 2000);
  document.getElementById("stopTrackingBtn").style.display = "block";
}

function stopTracking() {
  clearInterval(trackingInterval);
  document.getElementById("stopTrackingBtn").style.display = "none";
}

// ===================== MAP INIT =====================
function initMap() {
  map = L.map("map").setView([8.48, -13.22], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);
  routeLayers.addTo(map);
  loadRoutes();
  loadStops();
  fetchVehicles();
  setInterval(fetchVehicles, 2000);
}

// ===================== PAGE LOAD =====================
document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem("loggedIn") === "true") {
    initMap();
  } else {
    setupLoginModal();
  }

  document.getElementById("stopTrackingBtn").addEventListener("click", stopTracking);
});
