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
let vehiclesData = [];

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
  const key = (mode || "podapoda").toLowerCase();
  const url = iconMap[key] || iconMap["podapoda"];
  return L.icon({
    iconUrl: url,
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

function $id(id) {
  return document.getElementById(id) || null;
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
  loadStopsFromBackend();
  addLocateMeButton();

  fetchVehicles();
  setInterval(fetchVehicles, 2000);
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
        color: feature.properties?.color || "#3388ff",
        weight: 5,
        opacity: 0.7
      })
    }).addTo(routeLayers);
  } catch (err) {
    console.error("loadRoutes error:", err);
  }
}

async function loadStopsFromBackend() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/stops`);
    if (!res.ok) throw new Error("Stops fetch failed.");
    const payload = await res.json();
    const stops = payload.stops || [];
    if (stopsLayer) stopsLayer.clearLayers();
    stopsLayer = L.layerGroup();
    stops.forEach(stop => {
      L.circleMarker([stop.lat, stop.lon], {
        radius: 6,
        fillColor: "#ff0000",
        color: "#880000",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      })
        .bindPopup(`<b>${stop.name}</b>`)
        .addTo(stopsLayer);
    });
    stopsLayer.addTo(map);
  } catch (err) {
    console.error("loadStopsFromBackend error:", err);
  }
}

// ================== VEHICLE FETCH & SIDEBAR ==================
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");
    const payload = await res.json();
    vehiclesData = Array.isArray(payload.vehicles) ? payload.vehicles : [];

    vehiclesData.forEach(v => {
      if (!v.id || !v.lat || !v.lon) return;
      const icon = getIcon(v.mode);
      let popupContent = `<b>Vehicle ID:</b> ${v.id}<br><b>Mode:</b> ${v.mode || "unknown"}`;
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

    const lastUpdated = $id("lastUpdated");
    if (lastUpdated) lastUpdated.textContent = new Date().toLocaleTimeString();

    updateSidebarETAs();
    updateSidebarAlerts();
  } catch (err) {
    console.error("fetchVehicles error:", err);
  }
}

function updateSidebarETAs() {
  const etaList = $id("etaList");
  if (!etaList) return;
  etaList.innerHTML = "";

  if (!vehiclesData.length) {
    etaList.innerHTML = "<p>No data available.</p>";
    return;
  }

  vehiclesData.forEach(v => {
    const iconURL = iconMap[(v.mode || "podapoda").toLowerCase()] || iconMap["podapoda"];
    const div = document.createElement("div");
    div.className = "sidebar-item";
    let distanceText = "";
    if (userMarker) {
      const u = userMarker.getLatLng();
      const { distance, eta } = computeETA(u.lat, u.lng, v.lat, v.lon);
      distanceText = ` — ${distance} m, ETA ~${eta} min`;
    }
    div.innerHTML = `
      <img src="${iconURL}" alt="${v.mode}" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;">
      ${v.id} (${v.mode || "unknown"}) ${distanceText}
    `;
    etaList.appendChild(div);
  });
}

function updateSidebarAlerts() {
  const alertList = $id("alertSidebar");
  if (!alertList) return;
  alertList.innerHTML = "";
  let found = false;
  if (userMarker) {
    const u = userMarker.getLatLng();
    vehiclesData.forEach(v => {
      const { eta } = computeETA(u.lat, u.lng, v.lat, v.lon);
      if (eta <= 3) {
        const div = document.createElement("div");
        div.className = "alert-item";
        div.textContent = `⚠️ ${v.id} arriving in ~${eta} min`;
        alertList.appendChild(div);
        found = true;
      }
    });
  }
  if (!found) {
    alertList.innerHTML = "<p>No nearby vehicles within alert range.</p>";
  }
}

// ================== TRACKING ==================
function startTracking(vehicleId, mode) {
  trackedVehicleId = vehicleId;
  trackedMode = mode;
  if (trackingInterval) clearInterval(trackingInterval);
  const updateFn = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/vehicles`);
      if (!res.ok) return;
      const payload = await res.json();
      const vehicles = Array.isArray(payload.vehicles) ? payload.vehicles : [];
      const vehicle = vehicles.find(x => x.id === trackedVehicleId);
      if (!vehicle) return;
      const icon = getIcon(trackedMode);
      if (vehicleMarkers[vehicle.id]) {
        vehicleMarkers[vehicle.id].setLatLng([vehicle.lat, vehicle.lon]);
        vehicleMarkers[vehicle.id].setIcon(icon);
      } else {
        vehicleMarkers[vehicle.id] = L.marker([vehicle.lat, vehicle.lon], { icon })
          .addTo(map);
      }
      map.setView([vehicle.lat, vehicle.lon], 15);
    } catch (err) {
      console.error("startTracking/update error:", err);
    }
  };
  updateFn();
  trackingInterval = setInterval(updateFn, 2000);
  const stopBtn = $id("stopTrackingBtn");
  if (stopBtn) stopBtn.style.display = "block";
}

function stopTracking() {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
  trackedVehicleId = null;
  trackedMode = null;
  const stopBtn = $id("stopTrackingBtn");
  if (stopBtn) stopBtn.style.display = "none";
}

// ================== BUTTONS ==================
function addLocateMeButton() {
  const locateBtn = $id("locateMeBtn");
  if (!locateBtn) return;
  locateBtn.addEventListener("click", () => {
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
      updateSidebarETAs();
      updateSidebarAlerts();
    }, err => {
      console.error("Geolocation error:", err);
      alert("Unable to retrieve your location.");
    });
  });
}

// ================== ACCESSIBLE MODAL ==================
function openTrackingModal(openerEl) {
  const modal = $id("trackingModal");
  if (!modal) return;
  modal.style.display = "block";
  modal.removeAttribute("aria-hidden");
  document.body.classList.add("modal-open");
  const firstInput = modal.querySelector("input, select, textarea, button");
  if (firstInput) setTimeout(() => firstInput.focus(), 40);
  if (openerEl && openerEl.focus) modal._opener = openerEl;
}

function closeTrackingModal() {
  const modal = $id("trackingModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  const opener = modal._opener;
  if (opener && typeof opener.focus === "function") opener.focus();
  modal._opener = null;
}

function setupModalOutsideClick() {
  const modal = $id("trackingModal");
  if (!modal) return;
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeTrackingModal();
  });
}

function setupModalEscapeKey() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const modal = $id("trackingModal");
      if (modal && modal.style.display === "block") closeTrackingModal();
    }
  });
}

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", () => {
  if (!promptLogin()) return;
  initMap();

  const openBtn = $id("startTrackingBtn");
  if (openBtn) openBtn.addEventListener("click", () => openTrackingModal(openBtn));

  const closeBtn = $id("closeTrackingModal");
  if (closeBtn) closeBtn.addEventListener("click", closeTrackingModal);

  const form = $id("trackingForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = ($id("vehicleId")?.value || "").trim();
      const mode = ($id("mode")?.value || "").trim();
      if (!id || !mode) {
        alert("Please enter both Vehicle ID and Mode");
        return;
      }
      startTracking(id, mode);
      closeTrackingModal();
    });
  }

  const stopBtn = $id("stopTrackingBtn");
  if (stopBtn) {
    stopBtn.style.display = "none";
    stopBtn.addEventListener("click", stopTracking);
  }

  const toggleBtn = $id("toggleSidebarBtn");
  const sidebar = $id("sidebar");
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener("click", () => sidebar.classList.toggle("open"));
  }

  setupModalOutsideClick();
  setupModalEscapeKey();
});
