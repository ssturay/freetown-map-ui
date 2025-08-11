// ===== CONFIG =====
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
const VALID_USERNAME = "admin";
const VALID_PASSWORD = "mypassword";

const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

// ===== STATE =====
let map;
let markers = {};
let trackingVehicleId = null;
let refreshInterval;

// ===== INIT =====
window.addEventListener("DOMContentLoaded", () => {
  setupLogin();
  initMap();
  setupTrackingButtons();
});

// ===== LOGIN =====
function setupLogin() {
  const loginModal = document.getElementById("loginModal");
  const loginBtn = document.getElementById("loginBtn");
  const errorMsg = document.getElementById("loginError");

  if (localStorage.getItem("loggedIn") === "true") {
    loginModal.style.display = "none";
    document.getElementById("map").classList.remove("blurred");
    startRefreshing();
    return;
  }

  loginBtn.addEventListener("click", () => {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    if (username === VALID_USERNAME && password === VALID_PASSWORD) {
      localStorage.setItem("loggedIn", "true");
      loginModal.style.display = "none";
      document.getElementById("map").classList.remove("blurred");
      startRefreshing();
    } else {
      errorMsg.textContent = "Invalid credentials.";
    }
  });
}

// ===== MAP =====
function initMap() {
  map = L.map("map").setView([8.48, -13.22], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);
}

// ===== VEHICLE FETCH & DISPLAY =====
function startRefreshing() {
  fetchAndDisplayVehicles();
  refreshInterval = setInterval(fetchAndDisplayVehicles, 2000);
}

async function fetchAndDisplayVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    const data = await res.json();
    const vehicles = data.vehicles || [];

    updateSidebar(vehicles);

    vehicles.forEach(vehicle => {
      const { id, lat, lon, mode } = vehicle;
      if (!lat || !lon) return;

      const icon = getIcon(mode);
      const popup = `<b>${id}</b><br>${mode}`;

      if (markers[id]) {
        markers[id].setLatLng([lat, lon]).setPopupContent(popup).setIcon(icon);
      } else {
        markers[id] = L.marker([lat, lon], { icon }).addTo(map).bindPopup(popup);
      }

      if (trackingVehicleId === id) {
        map.setView([lat, lon], 15);
      }
    });

  } catch (err) {
    console.error("Error fetching vehicles:", err);
  }
}

function getIcon(mode) {
  const url = iconMap[mode?.toLowerCase()] || iconMap["podapoda"];
  return L.icon({
    iconUrl: url,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28]
  });
}

// ===== SIDEBAR =====
function updateSidebar(vehicles) {
  const list = document.getElementById("vehicleList");
  list.innerHTML = "";

  vehicles.forEach(v => {
    const item = document.createElement("div");
    item.className = "vehicle-item";

    const img = document.createElement("img");
    img.src = iconMap[v.mode?.toLowerCase()] || iconMap["podapoda"];
    img.alt = v.mode;
    img.className = "vehicle-icon";

    const text = document.createElement("span");
    text.textContent = `${v.id} (${v.mode})`;

    item.appendChild(img);
    item.appendChild(text);

    item.addEventListener("click", () => {
      if (markers[v.id]) {
        map.setView(markers[v.id].getLatLng(), 15);
        markers[v.id].openPopup();
      }
    });

    list.appendChild(item);
  });
}

// ===== TRACKING =====
function setupTrackingButtons() {
  const startBtn = document.getElementById("startTrackingBtn");
  const stopBtn = document.getElementById("stopTrackingBtn");

  startBtn.addEventListener("click", () => {
    const id = prompt("Enter Vehicle ID to track:");
    if (id) {
      trackingVehicleId = id.trim();
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
