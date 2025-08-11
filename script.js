// =========================
// CONFIG
// =========================
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
const VALID_USERNAME = "admin";
const VALID_PASSWORD = "mypassword";

let map, userMarker = null;
let vehicleMarkers = {};
let trackingInterval = null;
let trackingVehicleId = null;

// Icon mapping
const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

// =========================
// INIT FUNCTIONS
// =========================
document.addEventListener("DOMContentLoaded", () => {
  setupLoginModal();
  setupTrackingModal();
  setupStopTrackingBtn();
  initMap();
});

// =========================
// LOGIN MODAL LOGIC
// =========================
function setupLoginModal() {
  const loginModal = document.getElementById("loginModal");
  const loginForm = document.getElementById("loginForm");

  // Show login modal immediately on page load
  loginModal.style.display = "block";

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    if (username === VALID_USERNAME && password === VALID_PASSWORD) {
      loginModal.style.display = "none";
      initMap(); // Only init map after login success
    } else {
      alert("Invalid credentials");
    }
  });
}

// =========================
// MAP INIT
// =========================
function initMap() {
  if (map) return; // Prevent multiple inits

  map = L.map("map").setView([8.48, -13.22], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(map);

  fetchVehicles();
  setInterval(fetchVehicles, 2000); // Auto-refresh every 2s
}

// =========================
// VEHICLE FETCH + DISPLAY
// =========================
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");

    const data = await res.json();
    const vehicles = data.vehicles || [];

    vehicles.forEach(vehicle => {
      const { id, lat, lon, mode } = vehicle;
      if (!lat || !lon) return;

      const icon = L.icon({
        iconUrl: iconMap[mode.toLowerCase()] || iconMap["podapoda"],
        iconSize: [30, 30]
      });

      if (vehicleMarkers[id]) {
        vehicleMarkers[id].setLatLng([lat, lon]).setIcon(icon);
      } else {
        vehicleMarkers[id] = L.marker([lat, lon], { icon })
          .bindPopup(`<b>${mode}</b><br>ID: ${id}`)
          .addTo(map);
      }
    });

    document.getElementById("lastUpdated").textContent = new Date().toLocaleTimeString();
  } catch (err) {
    console.error("Vehicle fetch error:", err);
  }
}

// =========================
// TRACKING MODAL LOGIC
// =========================
function setupTrackingModal() {
  const openBtn = document.getElementById("openTrackingModal");
  const closeBtn = document.getElementById("closeTrackingModal");
  const modal = document.getElementById("trackingModal");
  const form = document.getElementById("trackingForm");

  if (!openBtn || !closeBtn || !modal || !form) return;

  openBtn.addEventListener("click", () => {
    modal.style.display = "block";
  });

  closeBtn.addEventListener("click", () => {
    modal.style.display = "none";
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const vehicleId = document.getElementById("vehicleId").value.trim();
    const mode = document.getElementById("mode").value.trim();
    if (!vehicleId || !mode) return;

    startTracking(vehicleId, mode);
    modal.style.display = "none";
  });
}

// =========================
// START / STOP TRACKING
// =========================
function startTracking(vehicleId, mode) {
  trackingVehicleId = vehicleId;
  document.getElementById("stopTrackingBtn").style.display = "block";

  if (trackingInterval) clearInterval(trackingInterval);

  trackingInterval = setInterval(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/vehicles`);
      const data = await res.json();
      const vehicle = (data.vehicles || []).find(v => v.id === vehicleId);
      if (!vehicle) return;

      const icon = L.icon({
        iconUrl: iconMap[mode.toLowerCase()] || iconMap["podapoda"],
        iconSize: [30, 30]
      });

      if (vehicleMarkers[vehicleId]) {
        vehicleMarkers[vehicleId].setLatLng([vehicle.lat, vehicle.lon]).setIcon(icon);
      } else {
        vehicleMarkers[vehicleId] = L.marker([vehicle.lat, vehicle.lon], { icon })
          .bindPopup(`<b>${mode}</b><br>ID: ${vehicleId}`)
          .addTo(map);
      }

      map.setView([vehicle.lat, vehicle.lon], 15);
    } catch (err) {
      console.error("Tracking fetch error:", err);
    }
  }, 2000);
}

function setupStopTrackingBtn() {
  const stopBtn = document.getElementById("stopTrackingBtn");
  if (!stopBtn) return;

  stopBtn.addEventListener("click", () => {
    if (trackingInterval) clearInterval(trackingInterval);
    trackingVehicleId = null;
    stopBtn.style.display = "none";
  });
}
