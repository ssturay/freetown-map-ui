// ================== LOGIN PROMPT ==================
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

// ================== GLOBALS ==================
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, userMarker = null;
let vehicleMarkers = {};
let routeLayers = L.featureGroup();
let stopsLayer;
let trackingInterval = null;
let trackedVehicleId = null;
let trackedMode = null;

// ================== ICON MAP ==================
const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

// ================== HELPERS ==================
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

// ================== MAP INIT ==================
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
}

// ================== ROUTES & STOPS ==================
async function loadRoutes() {
  try {
    const res = await fetch("data/routes.geojson");
    if (!res.ok) throw new Error("Routes fetch failed.");
    const geojson = await res.json();

    routeLayers.clearLayers();

    L.geoJSON(geojson, {
      style: feature => ({
        color: feature.properties.color || "#3388ff",
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
      pointToLayer: (feature, latlng) =>
        L.circleMarker(latlng, {
          radius: 6,
          fillColor: "#ff0000",
          color: "#880000",
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        })
    }).addTo(map);
  } catch (err) {
    console.error(err);
  }
}

// ================== VEHICLE FETCH ==================
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");

    const { vehicles } = await res.json();

    vehicles.forEach(v => {
      if (!v.id || !v.lat || !v.lon) return;

      const icon = getIcon(v.mode);
      let popupContent = `<b>Vehicle ID:</b> ${v.id}<br>Mode: ${v.mode}`;
      if (userMarker) {
        const uPos = userMarker.getLatLng();
        const { distance, eta } = computeETA(uPos.lat, uPos.lng, v.lat, v.lon);
        popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }

      if (vehicleMarkers[v.id]) {
        vehicleMarkers[v.id].setLatLng([v.lat, v.lon]);
        vehicleMarkers[v.id].setIcon(icon);
        vehicleMarkers[v.id].setPopupContent(popupContent);
      } else {
        vehicleMarkers[v.id] = L.marker([v.lat, v.lon], { icon })
          .bindPopup(popupContent)
          .addTo(map);
      }
    });

    document.getElementById("lastUpdated").textContent = new Date().toLocaleTimeString();
  } catch (err) {
    console.error("Vehicle update error:", err);
  }
}

// ================== TRACKING ==================
function startTracking(vehicleId, mode) {
  trackedVehicleId = vehicleId;
  trackedMode = mode;
  clearInterval(trackingInterval);

  trackingInterval = setInterval(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/vehicles`);
      const { vehicles } = await res.json();
      const vehicle = vehicles.find(v => v.id === trackedVehicleId);

      if (vehicle) {
        const icon = getIcon(mode);
        if (vehicleMarkers[vehicle.id]) {
          vehicleMarkers[vehicle.id].setLatLng([vehicle.lat, vehicle.lon]);
          vehicleMarkers[vehicle.id].setIcon(icon);
        } else {
          vehicleMarkers[vehicle.id] = L.marker([vehicle.lat, vehicle.lon], { icon })
            .addTo(map);
        }
        map.setView([vehicle.lat, vehicle.lon], 15);
      }
    } catch (err) {
      console.error("Tracking error:", err);
    }
  }, 2000);

  document.getElementById("stopTrackingBtn").style.display = "block";
}

function stopTracking() {
  clearInterval(trackingInterval);
  trackingInterval = null;
  trackedVehicleId = null;
  trackedMode = null;
  document.getElementById("stopTrackingBtn").style.display = "none";
}

// ================== BUTTON HANDLERS ==================
function addLocateMeButton() {
  document.getElementById("locateMeBtn").addEventListener("click", () => {
    if (!navigator.geolocation) return alert("Geolocation not supported");

    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      if (userMarker) {
        userMarker.setLatLng([lat, lon]);
      } else {
        userMarker = L.marker([lat, lon], {
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

// ================== EVENT LISTENERS ==================
document.addEventListener("DOMContentLoaded", () => {
  if (!promptLogin()) return;

  initMap();

  // Floating buttons
  document.getElementById("startTrackingBtn").addEventListener("click", () => {
    document.getElementById("trackingModal").style.display = "block";
  });

  document.getElementById("stopTrackingBtn").addEventListener("click", stopTracking);

  document.getElementById("closeTrackingModal").addEventListener("click", () => {
    document.getElementById("trackingModal").style.display = "none";
  });

  document.getElementById("trackingForm").addEventListener("submit", e => {
    e.preventDefault();
    const id = document.getElementById("vehicleId").value.trim();
    const mode = document.getElementById("mode").value.trim();
    if (!id || !mode) return;
    startTracking(id, mode);
    document.getElementById("trackingModal").style.display = "none";
  });

  // Sidebar toggle for mobile
  document.getElementById("toggleSidebarBtn").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });
});
