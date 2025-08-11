// === LOGIN PROMPT ===
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

// === GLOBALS ===
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, userMarker = null;
let vehicleMarkers = {};
let vehiclesData = [];
let routeLayers = L.featureGroup();
let stopsLayer;
let trackingVehicleId = null;
let trackingMode = null;
let trackingInterval = null;

const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png",
  "unknown": "https://cdn-icons-png.flaticon.com/512/565/565547.png"
};

// === UTILITIES ===
function getIcon(mode) {
  const key = mode?.toLowerCase() || "unknown";
  return L.icon({
    iconUrl: iconMap[key] || iconMap["unknown"],
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

// === MAP SETUP ===
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

  // Start 2-sec refresh
  setInterval(fetchVehicles, 2000);
}

// === ROUTES & STOPS ===
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
      }),
      onEachFeature: (feature, layer) => {
        if (feature.properties?.name) {
          layer.bindPopup(`<strong>Route:</strong> ${feature.properties.name}`);
        }
        routeLayers.addLayer(layer);
      }
    });
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
        }),
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

// === VEHICLES ===
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");

    const { vehicles } = await res.json();
    vehiclesData = vehicles;

    // Update markers
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
        vehicleMarkers[v.id].setLatLng([v.lat, v.lon]);
        vehicleMarkers[v.id].setIcon(icon);
        vehicleMarkers[v.id].setPopupContent(popupContent);
      } else {
        vehicleMarkers[v.id] = L.marker([v.lat, v.lon], { icon }).bindPopup(popupContent).addTo(map);
      }
    });

    updateSidebarETAs();
    updateSidebarAlerts();
  } catch (err) {
    console.error("Vehicle update error:", err);
  }
}

function updateSidebarETAs() {
  const etaList = document.getElementById("etaList");
  if (!etaList) return;
  etaList.innerHTML = "";

  vehiclesData.forEach(v => {
    if (userMarker) {
      const { distance, eta } = computeETA(userMarker.getLatLng().lat, userMarker.getLatLng().lng, v.lat, v.lon);
      etaList.innerHTML += `
        <div class="sidebar-item">
          <img src="${iconMap[v.mode?.toLowerCase()] || iconMap['unknown']}" class="sidebar-icon" alt="${v.mode}">
          <span><b>${v.id}</b> - ${eta} min (${distance} m)</span>
        </div>
      `;
    }
  });
}

function updateSidebarAlerts() {
  const alertSidebar = document.getElementById("alertSidebar");
  if (!alertSidebar) return;
  alertSidebar.innerHTML = "";

  vehiclesData.forEach(v => {
    alertSidebar.innerHTML += `
      <div class="sidebar-item">
        <img src="${iconMap[v.mode?.toLowerCase()] || iconMap['unknown']}" class="sidebar-icon" alt="${v.mode}">
        <span>Vehicle ${v.id} - Mode: ${v.mode}</span>
      </div>
    `;
  });
}

// === TRACKING ===
function startTracking(vehicleId, mode) {
  trackingVehicleId = vehicleId;
  trackingMode = mode;
  document.getElementById("stopTrackingBtn").style.display = "block";
}

function stopTracking() {
  trackingVehicleId = null;
  trackingMode = null;
  document.getElementById("stopTrackingBtn").style.display = "none";
}

// === UI SETUP ===
function addLocateMeButton() {
  const locateBtn = document.getElementById("locateMeBtn");
  if (!locateBtn) return;

  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
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

// === INIT ===
document.addEventListener("DOMContentLoaded", () => {
  if (!promptLogin()) return;
  initMap();

  const stopBtn = document.getElementById("stopTrackingBtn");
  if (stopBtn) stopBtn.addEventListener("click", stopTracking);
});
