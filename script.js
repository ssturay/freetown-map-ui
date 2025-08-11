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
let vehiclesData = []; // latest vehicles array returned from backend

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
  const walkingSpeed = 1.4; // m/s

  return {
    distance: Math.round(distance),
    eta: Math.round(distance / walkingSpeed / 60) // minutes
  };
}

// Small helper to safely get element by id or return null
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
  loadStops();
  addLocateMeButton();

  // initial fetch and periodic refresh (every 2s)
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
    console.error("loadStops error:", err);
  }
}

// ================== VEHICLE FETCH & SIDEBAR ==================
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");

    // backend returns { vehicles: [...] }
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

    // update last-updated label safely
    const lastUpdated = $id("lastUpdated");
    if (lastUpdated) lastUpdated.textContent = new Date().toLocaleTimeString();

    // Update sidebar lists if present
    updateSidebarETAs();
    updateSidebarAlerts();

  } catch (err) {
    console.error("fetchVehicles error:", err);
  }
}

// ================== SIDEBAR (ETAs & ALERTS) ==================
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

  // Example: alert when vehicle ETA is less than 3 minutes (customize as needed)
  let found = false;
  if (userMarker) {
    const u = userMarker.getLatLng();
    vehiclesData.forEach(v => {
      const { distance, eta } = computeETA(u.lat, u.lng, v.lat, v.lon);
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
  // keep last values
  trackedVehicleId = vehicleId;
  trackedMode = mode;

  // clear previous interval if any
  if (trackingInterval) clearInterval(trackingInterval);

  // immediate update + periodic (2s)
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
        vehicleMarkers[vehicle.id].setPopupContent(`<b>Vehicle ID:</b> ${vehicle.id}<br><b>Mode:</b> ${trackedMode}`);
      } else {
        vehicleMarkers[vehicle.id] = L.marker([vehicle.lat, vehicle.lon], { icon })
          .bindPopup(`<b>Vehicle ID:</b> ${vehicle.id}<br><b>Mode:</b> ${trackedMode}`)
          .addTo(map);
      }

      // center map to tracked vehicle
      map.setView([vehicle.lat, vehicle.lon], 15);
    } catch (err) {
      console.error("startTracking/update error:", err);
    }
  };

  // run immediately and then every 2s
  updateFn();
  trackingInterval = setInterval(updateFn, 2000);

  // show stop button if present
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

      // update ETA/alerts immediately after setting location
      updateSidebarETAs();
      updateSidebarAlerts();
    }, err => {
      console.error("Geolocation error:", err);
      alert("Unable to retrieve your location.");
    });
  });
}

// ================== ACCESSIBLE MODAL (open/close + inert handling) ==================
function openTrackingModal(openerEl) {
  const modal = $id("trackingModal");
  if (!modal) return;

  // Make sure underlying page content is inert (if supported) to prevent focus leakage
  // The main page element in your markup is .page-container — if not present fallback to body
  const page = document.querySelector(".page-container") || document.body;
  try {
    if (page) page.inert = true;
  } catch (e) {
    // inert might not be supported in all browsers; this will fail silently
  }

  // Show modal and make it visible to assistive tech
  modal.style.display = "block";
  modal.removeAttribute("aria-hidden");

  // Focus first focusable field inside modal (vehicleId)
  const firstInput = modal.querySelector("input, select, textarea, button");
  if (firstInput) {
    // small timeout to ensure element is visible before focusing
    setTimeout(() => firstInput.focus(), 40);
  }

  // store opener so we can return focus on close
  if (openerEl && openerEl.focus) modal._opener = openerEl;
}

function closeTrackingModal() {
  const modal = $id("trackingModal");
  if (!modal) return;

  // Hide modal and restore inert / aria-hidden
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");

  const page = document.querySelector(".page-container") || document.body;
  try {
    if (page) page.inert = false;
  } catch (e) {
    // ignore
  }

  // return focus to opener if present
  const opener = modal._opener;
  if (opener && typeof opener.focus === "function") {
    opener.focus();
    modal._opener = null;
  }
}

// Close modal when user clicks outside modal-content
function setupModalOutsideClick() {
  const modal = $id("trackingModal");
  if (!modal) return;
  modal.addEventListener("click", (e) => {
    // assume modal-content is a child; if click target is modal itself => outside
    if (e.target === modal) closeTrackingModal();
  });
}

// close modal on Escape
function setupModalEscapeKey() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const modal = $id("trackingModal");
      if (modal && modal.style.display === "block") {
        closeTrackingModal();
      }
    }
  });
}

// ================== INIT (safe event binding) ==================
document.addEventListener("DOMContentLoaded", () => {
  if (!promptLogin()) return;

  // initialize map and data fetch
  initMap();

  // Wire modal openers (accept multiple possible IDs/classes so it's robust)
  const possibleOpeners = [
    $id("startTrackingBtn"),
    $id("openTrackingModal"),
    document.querySelector(".modal-trigger")
  ];
  possibleOpeners.forEach(btn => {
    if (btn) {
      btn.addEventListener("click", (e) => {
        openTrackingModal(btn);
      });
    }
  });

  // Close modal button
  const closeBtn = $id("closeTrackingModal");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => closeTrackingModal());
  }

  // Form submit inside modal (start tracking)
  const form = $id("trackingForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = ($id("vehicleId") && $id("vehicleId").value || "").trim();
      // the select in your markup is 'mode'
      const mode = ($id("mode") && $id("mode").value || "").trim();

      if (!id || !mode) {
        alert("Please enter both Vehicle ID and Mode");
        return;
      }

      startTracking(id, mode);
      closeTrackingModal();
    });
  }

  // Stop tracking button (floating), hide if not present
  const stopBtn = $id("stopTrackingBtn");
  if (stopBtn) {
    stopBtn.style.display = "none"; // ensure hidden initially
    stopBtn.addEventListener("click", stopTracking);
  }

  // Sidebar toggle (mobile) — tolerant lookup
  const toggleBtn = $id("toggleSidebarBtn");
  const sidebar = $id("sidebar") || document.querySelector(".sidebar");
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener("click", () => {
      sidebar.classList.toggle("open");
    });
  }

  // Setup modal outside click and Escape behavior for accessibility
  setupModalOutsideClick();
  setupModalEscapeKey();
});
