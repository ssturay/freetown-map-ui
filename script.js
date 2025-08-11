const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, userMarker = null;
let vehicleMarkers = {};
let vehiclesData = [];
let trackingVehicleId = null;
let trackingTimer = null;

const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

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

// ===== Login Modal =====
function setupLoginModal() {
  const modal = document.getElementById("loginModal");
  const form = document.getElementById("loginForm");
  const errorMsg = document.getElementById("loginError");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    try {
      const res = await fetch(`${BACKEND_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      if (!res.ok) throw new Error("Invalid login");
      const data = await res.json();

      if (data.status === "ok") {
        localStorage.setItem("loggedIn", "true");
        modal.style.display = "none";
        document.getElementById("map").classList.remove("blurred");
      } else {
        errorMsg.textContent = "Invalid username or password.";
      }
    } catch (err) {
      errorMsg.textContent = "Login failed.";
      console.error(err);
    }
  });
}

// ===== Fetch Vehicles =====
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");
    const data = await res.json();
    vehiclesData = data.vehicles || [];

    updateMapMarkers();
    updateSidebar();
  } catch (err) {
    console.error("Vehicle update error:", err);
  }
}

function updateMapMarkers() {
  vehiclesData.forEach(v => {
    const { id, lat, lon, mode } = v;
    if (!lat || !lon) return;

    const icon = getIcon(mode);
    let popupContent = `<strong>ID:</strong> ${id}<br><strong>Mode:</strong> ${mode}`;
    if (userMarker) {
      const userPos = userMarker.getLatLng();
      const { distance, eta } = computeETA(userPos.lat, userPos.lng, lat, lon);
      popupContent += `<br>Distance: ${distance}m<br>ETA: ${eta} min`;
    }

    if (vehicleMarkers[id]) {
      vehicleMarkers[id].setLatLng([lat, lon]).setPopupContent(popupContent);
    } else {
      vehicleMarkers[id] = L.marker([lat, lon], { icon }).bindPopup(popupContent).addTo(map);
    }
  });
}

function updateSidebar() {
  const etaList = document.getElementById("etaList");
  etaList.innerHTML = "";

  let sorted = [...vehiclesData];
  if (userMarker) {
    const userPos = userMarker.getLatLng();
    sorted.sort((a, b) => {
      const da = computeETA(userPos.lat, userPos.lng, a.lat, a.lon).distance;
      const db = computeETA(userPos.lat, userPos.lng, b.lat, b.lon).distance;
      return da - db;
    });
  }

  sorted.forEach(v => {
    const item = document.createElement("div");
    item.className = "sidebar-item";
    const icon = document.createElement("img");
    icon.src = iconMap[v.mode?.toLowerCase()] || iconMap["podapoda"];
    const text = document.createElement("span");
    text.textContent = `${v.id} (${v.mode})`;
    item.appendChild(icon);
    item.appendChild(text);
    etaList.appendChild(item);
  });
}

// ===== Tracking =====
function startTracking(vehicleId) {
  trackingVehicleId = vehicleId;
  document.getElementById("startBtn").classList.add("hidden");
  document.getElementById("stopBtn").classList.remove("hidden");

  fetch(`${BACKEND_URL}/api/tracking/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: vehicleId })
  });

  if (trackingTimer) clearTimeout(trackingTimer);
  trackingTimer = setTimeout(stopTracking, 5 * 60 * 1000); // Auto stop after 5min
}

function stopTracking() {
  if (!trackingVehicleId) return;
  fetch(`${BACKEND_URL}/api/tracking/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: trackingVehicleId })
  });
  trackingVehicleId = null;
  document.getElementById("startBtn").classList.remove("hidden");
  document.getElementById("stopBtn").classList.add("hidden");
}

function initMap() {
  map = L.map("map").setView([8.48, -13.22], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  document.getElementById("locateMeBtn").addEventListener("click", () => {
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords;
      if (userMarker) {
        userMarker.setLatLng([latitude, longitude]);
      } else {
        userMarker = L.marker([latitude, longitude], {
          icon: L.icon({
            iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
            iconSize: [25, 25]
          })
        }).addTo(map);
      }
      map.setView([latitude, longitude], 14);
    });
  });
}

// ===== Init =====
window.addEventListener("DOMContentLoaded", () => {
  if (!localStorage.getItem("loggedIn")) {
    document.getElementById("map").classList.add("blurred");
    document.getElementById("loginModal").style.display = "flex";
  } else {
    document.getElementById("map").classList.remove("blurred");
  }

  setupLoginModal();
  initMap();

  fetchVehicles();
  setInterval(fetchVehicles, 2000);

  document.getElementById("startBtn").addEventListener("click", () => {
    const vid = prompt("Enter Vehicle ID to track:");
    if (vid) startTracking(vid);
  });
  document.getElementById("stopBtn").addEventListener("click", stopTracking);
});
