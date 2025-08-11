// ====== FRONTEND CONFIG ======
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
const VALID_USERNAME = "admin";
const VALID_PASSWORD = "mypassword";
const REFRESH_INTERVAL = 2000; // 2 seconds

let map;
let vehicleMarkers = {};
let trackedVehicleId = null;
let trackingIntervalId = null;

// Icon map for modes
const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png",
  "unknown": "https://cdn-icons-png.flaticon.com/512/565/565547.png"
};

function getIcon(mode) {
  const key = mode?.toLowerCase() || "unknown";
  return L.icon({
    iconUrl: iconMap[key] || iconMap["unknown"],
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30]
  });
}

// ====== LOGIN LOGIC ======
document.getElementById("loginBtn").addEventListener("click", () => {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  const error = document.getElementById("loginError");

  if (username === VALID_USERNAME && password === VALID_PASSWORD) {
    document.getElementById("loginModal").style.display = "none";
    document.getElementById("map").classList.remove("blurred");
    initMap();
  } else {
    error.textContent = "Invalid credentials";
  }
});

// ====== MAP INIT ======
function initMap() {
  map = L.map("map").setView([8.48, -13.24], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  fetchVehicles();
  setInterval(fetchVehicles, REFRESH_INTERVAL);
}

// ====== FETCH VEHICLES ======
function fetchVehicles() {
  fetch(`${BACKEND_URL}/api/vehicles`)
    .then(res => res.json())
    .then(data => {
      const listContainer = document.getElementById("vehicleList");
      listContainer.innerHTML = "";

      if (!data.vehicles || data.vehicles.length === 0) {
        listContainer.innerHTML = "<p>No active vehicles</p>";
        return;
      }

      data.vehicles.forEach(v => {
        const icon = getIcon(v.mode);
        const latLng = [v.lat, v.lon];

        if (vehicleMarkers[v.id]) {
          vehicleMarkers[v.id].setLatLng(latLng).setIcon(icon);
        } else {
          vehicleMarkers[v.id] = L.marker(latLng, { icon }).addTo(map);
        }

        vehicleMarkers[v.id].bindPopup(`
          <b>Vehicle ID:</b> ${v.id}<br>
          <b>Mode:</b> ${v.mode}<br>
          <b>ETA:</b> ${v.eta_min} min
        `);

        // Sidebar item
        const item = document.createElement("div");
        item.className = "vehicle-item";
        item.innerHTML = `<img src="${icon.options.iconUrl}" width="20" height="20"> ${v.id} (${v.mode})`;
        item.addEventListener("click", () => {
          map.setView(latLng, 15);
        });
        listContainer.appendChild(item);
      });

      // Keep panning to tracked vehicle
      if (trackedVehicleId && vehicleMarkers[trackedVehicleId]) {
        map.setView(vehicleMarkers[trackedVehicleId].getLatLng(), 15);
      }
    })
    .catch(err => console.error("Error fetching vehicles:", err));
}

// ====== TRACKING ======
document.getElementById("startTrackingBtn").addEventListener("click", () => {
  const vehicleId = prompt("Enter vehicle ID to track:");
  if (!vehicleId) return;
  trackedVehicleId = vehicleId;
  document.getElementById("startTrackingBtn").classList.add("hidden");
  document.getElementById("stopTrackingBtn").classList.remove("hidden");
});

document.getElementById("stopTrackingBtn").addEventListener("click", () => {
  trackedVehicleId = null;
  document.getElementById("stopTrackingBtn").classList.add("hidden");
  document.getElementById("startTrackingBtn").classList.remove("hidden");
});
