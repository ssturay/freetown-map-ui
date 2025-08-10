// ========================
// LOGIN PROMPT
// ========================
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

// ========================
// GLOBALS
// ========================
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, userMarker = null;
let vehicleMarkers = {};
let vehiclesData = [];
let routeLayers = L.featureGroup();
let stopsLayer;
let fetchInterval = null;
let trackingInterval = null;
let trackingVehicleId = null;
let trackingMode = null;

const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

// ========================
// HELPERS
// ========================
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

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}

function getIcon(mode) {
  const key = mode?.toLowerCase() || "podapoda";
  return L.icon({
    iconUrl: iconMap[key] || iconMap["podapoda"],
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30]
  });
}

// ========================
// MAP INIT
// ========================
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
  initFilters();
  setupModal();

  fetchVehicles();
  fetchInterval = setInterval(fetchVehicles, 5000);

  document.getElementById("clearVehiclesBtn").addEventListener("click", clearVehicles);
}

// ========================
// FETCHING VEHICLES
// ========================
async function fetchVehicles() {
  if (trackingVehicleId) return; // skip in tracking mode

  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");

    const data = await res.json();
    vehiclesData = Object.entries(data).map(([id, info]) => ({
      id,
      lat: info.lat,
      lon: info.lon,
      mode: info.mode || "unknown"
    }));

    vehiclesData.forEach(vehicle => {
      const { id, lat, lon, mode } = vehicle;
      if (!id || !lat || !lon) return;

      const icon = getIcon(mode);
      let popupContent = `Vehicle ID: ${id}<br>Mode: ${mode}`;
      if (userMarker) {
        const userPos = userMarker.getLatLng();
        const { distance, eta } = computeETA(userPos.lat, userPos.lng, lat, lon);
        popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }

      if (vehicleMarkers[id]) {
        vehicleMarkers[id].setLatLng([lat, lon]);
        vehicleMarkers[id].setIcon(icon);
        vehicleMarkers[id].setPopupContent(popupContent);
      } else {
        vehicleMarkers[id] = L.marker([lat, lon], { icon }).bindPopup(popupContent).addTo(map);
      }
    });

    applyFilters();
    updateSidebarETAs();
    updateSidebarAlerts();

    const timeLabel = document.getElementById("lastUpdated");
    if (timeLabel) timeLabel.textContent = new Date().toLocaleTimeString();

  } catch (err) {
    console.error("Vehicle update error:", err);
  }
}

// ========================
// TRACKING
// ========================
function startTracking(vehicleId, transportMode) {
  trackingVehicleId = vehicleId;
  trackingMode = transportMode;

  clearInterval(fetchInterval); // stop general updates
  clearVehicles();

  const updateTrackedVehicle = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/vehicles/${vehicleId}`);
      if (!res.ok) throw new Error("Vehicle fetch failed");
      const data = await res.json();

      if (!data.lat || !data.lon) {
        console.warn("Vehicle has no location data yet");
        return;
      }

      const icon = getIcon(transportMode);
      let popupContent = `Vehicle ID: ${vehicleId}<br>Mode: ${transportMode}`;
      if (userMarker) {
        const userPos = userMarker.getLatLng();
        const { distance, eta } = computeETA(userPos.lat, userPos.lng, data.lat, data.lon);
        popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }

      if (vehicleMarkers[vehicleId]) {
        vehicleMarkers[vehicleId].setLatLng([data.lat, data.lon]);
        vehicleMarkers[vehicleId].setIcon(icon);
        vehicleMarkers[vehicleId].setPopupContent(popupContent);
      } else {
        vehicleMarkers[vehicleId] = L.marker([data.lat, data.lon], { icon })
          .bindPopup(popupContent)
          .addTo(map);
      }

      map.setView([data.lat, data.lon], 15);
    } catch (err) {
      console.error("Tracking error:", err);
    }
  };

  updateTrackedVehicle();
  trackingInterval = setInterval(updateTrackedVehicle, 5000);
}

function stopTracking() {
  clearInterval(trackingInterval);
  trackingVehicleId = null;
  trackingMode = null;
  fetchVehicles();
  fetchInterval = setInterval(fetchVehicles, 5000);
}

// ========================
// UI / MODAL / FILTERS
// ========================
function setupModal() {
  const modal = document.getElementById("trackingModal");
  const trigger = document.getElementById("openTrackingModal");
  const closeBtn = document.getElementById("closeTrackingModal");

  if (!modal || !trigger || !closeBtn) return;

  function openModal() {
    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  }

  trigger.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

  // Tracking form
  const trackingForm = document.getElementById("trackingForm");
  if (trackingForm) {
    trackingForm.addEventListener("submit", e => {
      e.preventDefault();
      const vehicleId = document.getElementById("vehicleId").value.trim();
      const transportMode = document.getElementById("mode").value.trim();
      if (!vehicleId || !transportMode) {
        alert("Please enter both Vehicle ID and Transport Mode.");
        return;
      }
      startTracking(vehicleId, transportMode);
      closeModal();
    });
  }
}

function initFilters() {
  const filterContainer = document.querySelector(".sidebar-filter-container");
  if (!filterContainer) return;

  const modes = [
    "Podapoda",
    "Taxi",
    "Keke",
    "Paratransit Bus",
    "Waka Fine Bus",
    "Motorbike"
  ];

  filterContainer.innerHTML = "";
  modes.forEach(mode => {
    const id = `filter-${mode.replace(/\s+/g, "-").toLowerCase()}`;
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = mode;
    checkbox.checked = true;
    checkbox.addEventListener("change", applyFilters);
    label.appendChild(checkbox);
    label.append(` ${mode}`);
    filterContainer.appendChild(label);
  });
}

// ========================
// SIDE PANELS
// ========================
function updateSidebarETAs() {
  const etaList = document.getElementById("etaList");
  etaList.innerHTML = "";
  if (vehiclesData.length === 0) {
    etaList.innerHTML = "<p>No data available.</p>";
    return;
  }
  vehiclesData.forEach(v => {
    let distanceText = "";
    if (userMarker) {
      const userPos = userMarker.getLatLng();
      const { distance, eta } = computeETA(userPos.lat, userPos.lng, v.lat, v.lon);
      distanceText = ` — ${distance} m, ETA ~${eta} min`;
    }
    etaList.innerHTML += `<div>
      <img src="${iconMap[v.mode.toLowerCase()]}" style="width:18px;height:18px;margin-right:6px;vertical-align:middle;">
      ${capitalize(v.mode)} (ID: ${v.id})${distanceText}
    </div>`;
  });
}

function updateSidebarAlerts() {
  const alertList = document.getElementById("alertSidebar");
  alertList.innerHTML = "";
  if (vehiclesData.length === 0) {
    alertList.innerHTML = "<p>No vehicles available.</p>";
    return;
  }
  let vehiclesToShow = vehiclesData;
  if (userMarker) {
    const userPos = userMarker.getLatLng();
    vehiclesToShow = vehiclesData.filter(v => {
      const { distance } = computeETA(userPos.lat, userPos.lng, v.lat, v.lon);
      return distance <= 500;
    });
    if (vehiclesToShow.length === 0) {
      alertList.innerHTML = "<p>No nearby vehicles within 500m.</p>";
      return;
    }
  }
  vehiclesToShow.forEach(vehicle => {
    alertList.innerHTML += `<div>
      <img src="${iconMap[vehicle.mode.toLowerCase()]}" style="width:18px;height:18px;margin-right:6px;vertical-align:middle;">
      ${capitalize(vehicle.mode)} (ID: ${vehicle.id})
    </div>`;
  });
}

// ========================
// MAP EXTRAS
// ========================
function addLocateMeButton() {
  const locateBtn = document.getElementById("locateMeBtn");
  if (!locateBtn) return;
  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
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
        updateSidebarETAs();
        updateSidebarAlerts();
      },
      err => {
        alert("Unable to retrieve your location.");
        console.error(err);
      }
    );
  });
}

function clearVehicles() {
  Object.values(vehicleMarkers).forEach(marker => {
    map.removeLayer(marker);
  });
  vehicleMarkers = {};
  vehiclesData = [];
  updateSidebarETAs();
  updateSidebarAlerts();
}

async function loadRoutes() {
  try {
    const res = await fetch("data/routes.geojson");
    const geojson = await res.json();
    routeLayers.clearLayers();
    L.geoJSON(geojson, {
      style: f => ({ color: f.properties.color || "#3388ff", weight: 5, opacity: 0.7 }),
      onEachFeature: (f, l) => {
        if (f.properties?.name) l.bindPopup(`<strong>Route:</strong> ${f.properties.name}`);
        routeLayers.addLayer(l);
      }
    });
    routeLayers.addTo(map);
  } catch (err) { console.error(err); }
}

async function loadStops() {
  try {
    const res = await fetch("data/stops.geojson");
    const geojson = await res.json();
    if (stopsLayer) stopsLayer.clearLayers();
    stopsLayer = L.geoJSON(geojson, {
      pointToLayer: (f, latlng) => L.circleMarker(latlng, {
        radius: 6, fillColor: "#ff0000", color: "#880000", weight: 1, opacity: 1, fillOpacity: 0.8
      }),
      onEachFeature: (f, l) => { if (f.properties?.name) l.bindPopup(`<strong>Stop:</strong> ${f.properties.name}`); }
    }).addTo(map);
  } catch (err) { console.error(err); }
}

// ========================
// START APP
// ========================
window.addEventListener("DOMContentLoaded", () => {
  if (promptLogin()) initMap();
});
