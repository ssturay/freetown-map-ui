const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, vehicleMarkers = {}, userMarker = null;
let trackingInterval = null, trackingVehicleId = null;
const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

function getIcon(mode) {
  return L.icon({ iconUrl: iconMap[mode?.toLowerCase()] || iconMap["podapoda"], iconSize: [30, 30] });
}

function setupLoginModal() {
  const modal = document.getElementById("loginModal");
  const btn = document.getElementById("loginBtn");
  btn.addEventListener("click", () => {
    const u = document.getElementById("username").value;
    const p = document.getElementById("password").value;
    if (u === "admin" && p === "mypassword") {
      modal.style.display = "none";
    } else { alert("Access denied"); }
  });
}

function setupSidebarToggle() {
  const sidebar = document.querySelector(".sidebar");
  document.getElementById("menuToggleBtn").addEventListener("click", () => {
    sidebar.classList.toggle("hidden");
  });
}

function fetchVehicles() {
  fetch(`${BACKEND_URL}/api/vehicles`)
    .then(res => res.json())
    .then(data => {
      const list = document.getElementById("vehicleList");
      list.innerHTML = "";
      (data.vehicles || []).forEach(v => {
        const icon = getIcon(v.mode);
        if (vehicleMarkers[v.id]) {
          vehicleMarkers[v.id].setLatLng([v.lat, v.lon]).setIcon(icon);
        } else {
          vehicleMarkers[v.id] = L.marker([v.lat, v.lon], { icon }).addTo(map);
        }
        const div = document.createElement("div");
        div.className = "vehicle-item";
        div.innerHTML = `<img src="${icon.options.iconUrl}"/> ${v.id} (${v.mode})`;
        list.appendChild(div);
      });
    });
}

function startTracking(id, mode) {
  trackingVehicleId = id;
  clearInterval(trackingInterval);
  trackingInterval = setInterval(() => fetchVehicles(), 2000);
  fetchVehicles();
  document.getElementById("startTrackingBtn").classList.add("hidden");
  document.getElementById("stopTrackingBtn").classList.remove("hidden");
  setTimeout(stopTracking, 5 * 60 * 1000);
}

function stopTracking() {
  trackingVehicleId = null;
  clearInterval(trackingInterval);
  document.getElementById("stopTrackingBtn").classList.add("hidden");
  document.getElementById("startTrackingBtn").classList.remove("hidden");
}

function initMap() {
  map = L.map("map").setView([8.48, -13.22], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
  fetchVehicles();
  setInterval(fetchVehicles, 2000);
}

document.addEventListener("DOMContentLoaded", () => {
  setupLoginModal();
  setupSidebarToggle();
  initMap();
  document.getElementById("startTrackingBtn").addEventListener("click", () => {
    document.getElementById("trackingModal").style.display = "flex";
  });
  document.getElementById("closeTrackingModal").addEventListener("click", () => {
    document.getElementById("trackingModal").style.display = "none";
  });
  document.getElementById("trackingForm").addEventListener("submit", e => {
    e.preventDefault();
    startTracking(document.getElementById("vehicleId").value, document.getElementById("mode").value);
    document.getElementById("trackingModal").style.display = "none";
  });
  document.getElementById("stopTrackingBtn").addEventListener("click", stopTracking);
});
