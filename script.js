// ====== FRONTEND LOGIN ======
function setupLogin() {
  const loginModal = document.getElementById("loginModal");
  const loginBtn = document.getElementById("loginBtn");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const loginError = document.getElementById("loginError");
  const mapDiv = document.getElementById("map");

  loginBtn.addEventListener("click", () => {
    const user = usernameInput.value.trim();
    const pass = passwordInput.value.trim();

    if (user === "admin" && pass === "mypassword") {
      loginModal.style.display = "none";
      mapDiv.classList.remove("blurred");
    } else {
      loginError.textContent = "Invalid credentials";
    }
  });
}

// ====== MAP SETUP ======
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, vehicleMarkers = {};
let trackingVehicleId = null;
let trackingInterval = null;

// Icon mapping for modes
const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png",
};

function getIcon(mode) {
  return L.icon({
    iconUrl: iconMap[mode?.toLowerCase()] || iconMap["podapoda"],
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30]
  });
}

function initMap() {
  map = L.map("map").setView([8.48, -13.22], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);
}

// ====== FETCH & UPDATE VEHICLES ======
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    const data = await res.json();
    const vehicles = data.vehicles || [];

    updateSidebar(vehicles);

    vehicles.forEach(v => {
      if (!v.lat || !v.lon) return;

      const icon = getIcon(v.mode);
      const popup = `<b>Vehicle ID:</b> ${v.id}<br><b>Mode:</b> ${v.mode}<br><b>ETA:</b> ${v.eta_min} min`;

      if (vehicleMarkers[v.id]) {
        vehicleMarkers[v.id].setLatLng([v.lat, v.lon]).setPopupContent(popup);
      } else {
        vehicleMarkers[v.id] = L.marker([v.lat, v.lon], { icon }).bindPopup(popup).addTo(map);
      }

      if (trackingVehicleId === v.id) {
        map.setView([v.lat, v.lon], 15);
      }
    });
  } catch (err) {
    console.error("Error fetching vehicles", err);
  }
}

// ====== SIDEBAR UPDATE ======
function updateSidebar(vehicles) {
  const listDiv = document.getElementById("vehicleList");
  listDiv.innerHTML = "";
  vehicles.forEach(v => {
    const item = document.createElement("div");
    item.className = "vehicle-item";
    item.innerHTML = `
      <img src="${iconMap[v.mode?.toLowerCase()] || iconMap["podapoda"]}" width="20" height="20" />
      ${v.id} (${v.mode})
    `;
    listDiv.appendChild(item);
  });
}

// ====== TRACKING CONTROL ======
function setupTrackingButtons() {
  const startBtn = document.getElementById("startTrackingBtn");
  const stopBtn = document.getElementById("stopTrackingBtn");

  startBtn.addEventListener("click", () => {
    const vehicleId = prompt("Enter vehicle ID to track:");
    if (vehicleId) {
      trackingVehicleId = vehicleId.trim();
      startBtn.classList.add("hidden");
      stopBtn.classList.remove("hidden");
    }
  });

  stopBtn.addEventListener("click", () => {
    trackingVehicleId = null;
    stopBtn.classList.add("hidden");
    startBtn.classList.remove("hidden");
  });
}

// ====== INIT ======
window.addEventListener("DOMContentLoaded", () => {
  setupLogin();
  initMap();
  setupTrackingButtons();
  setInterval(fetchVehicles, 2000); // refresh every 2s
});
