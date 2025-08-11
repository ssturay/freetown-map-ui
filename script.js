/* app script.js - responsive sidebar, icons, tracking, ETAs/alerts */

function promptLogin() {
  if (localStorage.getItem("loggedIn") === "true") return true;
  const username = prompt("Enter username:");
  const password = prompt("Enter password:");
  const VALID_USERNAME = "admin", VALID_PASSWORD = "mypassword";
  if (username !== VALID_USERNAME || password !== VALID_PASSWORD) {
    alert("Access denied");
    document.body.innerHTML = "<h2 style='text-align:center; padding:2rem;'>Access Denied</h2>";
    return false;
  }
  localStorage.setItem("loggedIn", "true");
  return true;
}

const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, userMarker = null;
let vehicleMarkers = {};
let vehiclesData = [];
let routeLayers = L.featureGroup();
let stopsLayer;

// icons keyed by lowercase mode
const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png",
  "unknown": "https://cdn-icons-png.flaticon.com/512/684/684908.png"
};

function normalizeMode(mode) {
  return (mode || "unknown").toString().trim().toLowerCase();
}

function getIcon(mode) {
  const key = normalizeMode(mode);
  return L.icon({
    iconUrl: iconMap[key] || iconMap["unknown"],
    iconSize: [30,30],
    iconAnchor: [15,30],
    popupAnchor: [0,-30]
  });
}

function computeETA(userLat, userLon, vehicleLat, vehicleLon) {
  const R = 6371e3;
  const toRad = v => v * Math.PI / 180;
  const φ1 = toRad(userLat), φ2 = toRad(vehicleLat);
  const Δφ = toRad(vehicleLat - userLat);
  const Δλ = toRad(vehicleLon - userLon);
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  const walkingSpeed = 1.4; // m/s
  return { distance: Math.round(distance), eta: Math.round(distance / walkingSpeed / 60) };
}

/* fetch and display routes (if provided) */
async function loadRoutes() {
  try {
    const res = await fetch("data/routes.geojson");
    if (!res.ok) return;
    const geo = await res.json();
    routeLayers.clearLayers();
    L.geoJSON(geo, {
      style: f => ({ color: f.properties?.color || "#3388ff", weight:4, opacity:0.7 }),
      onEachFeature: (f,l) => {
        if (f.properties?.name) l.bindPopup(`<strong>Route:</strong> ${f.properties.name}`);
        routeLayers.addLayer(l);
      }
    });
    routeLayers.addTo(map);
  } catch (e) { console.warn("loadRoutes:", e); }
}

/* fetch and show stops */
async function loadStops() {
  try {
    const res = await fetch("data/stops.geojson");
    if (!res.ok) return;
    const geo = await res.json();
    if (stopsLayer) stopsLayer.clearLayers();
    stopsLayer = L.geoJSON(geo, {
      pointToLayer: (feat, latlng) => L.circleMarker(latlng, { radius:6, fillColor:"#ff4444", color:"#880000", weight:1, fillOpacity:0.9 }),
      onEachFeature: (f,l) => { if (f.properties?.name) l.bindPopup(`<strong>Stop:</strong> ${f.properties.name}`); }
    }).addTo(map);
  } catch (e) { console.warn("loadStops:", e); }
}

/* fetch all vehicles from backend and refresh markers + sidebar */
async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");
    const data = await res.json();

    // transform into array: [{id, lat, lon, mode}]
    vehiclesData = Object.entries(data || {}).map(([id, info]) => ({
      id,
      lat: info?.lat,
      lon: info?.lon,
      mode: info?.mode || "unknown"
    }));

    // update markers
    vehiclesData.forEach(v => {
      if (!v.id || v.lat==null || v.lon==null) return;
      const icon = getIcon(v.mode);
      const popup = `Vehicle ID: ${v.id}<br>Mode: ${v.mode}`;
      if (vehicleMarkers[v.id]) {
        vehicleMarkers[v.id].setLatLng([v.lat, v.lon]);
        vehicleMarkers[v.id].setIcon(icon);
        vehicleMarkers[v.id].setPopupContent(popup);
      } else {
        const m = L.marker([v.lat, v.lon], { icon }).bindPopup(popup).addTo(map);
        vehicleMarkers[v.id] = m;
      }
    });

    // remove markers not in vehiclesData
    Object.keys(vehicleMarkers).forEach(id => {
      if (!vehiclesData.find(v => v.id === id)) {
        if (map.hasLayer(vehicleMarkers[id])) map.removeLayer(vehicleMarkers[id]);
        delete vehicleMarkers[id];
      }
    });

    updateSidebarETAs();
    updateSidebarAlerts();
    updateLastUpdatedBadge();

  } catch (err) {
    console.error("Vehicle update error:", err);
  }
}

function updateLastUpdatedBadge() {
  const t = document.getElementById("lastUpdated");
  if (t) t.textContent = new Date().toLocaleTimeString();
}

/* Sidebar: ETAs */
function updateSidebarETAs() {
  const etaList = document.getElementById("etaList");
  if (!etaList) return;
  etaList.innerHTML = "";

  if (!userMarker) {
    // show nearest few vehicles (or default message)
    if (vehiclesData.length === 0) {
      etaList.innerHTML = "<p>No data available.</p>"; return;
    }
  }

  // Build entries (if user location available show distance)
  vehiclesData.forEach(v => {
    const modeKey = normalizeMode(v.mode);
    const imgSrc = iconMap[modeKey] || iconMap["unknown"];
    let distanceText = "";
    if (userMarker && v.lat != null && v.lon != null) {
      const userPos = userMarker.getLatLng();
      const { distance, eta } = computeETA(userPos.lat, userPos.lng, v.lat, v.lon);
      distanceText = ` — ${distance} m, ETA ~${eta} min`;
    }
    const div = document.createElement("div");
    div.innerHTML = `<img src="${imgSrc}" alt="${v.mode}"> ${escapeHtml(capitalize(v.mode))} (ID: ${escapeHtml(v.id)})${distanceText}`;
    etaList.appendChild(div);
  });
}

/* Sidebar: Alerts (nearby vehicles within 500m) */
function updateSidebarAlerts() {
  const alertList = document.getElementById("alertSidebar");
  if (!alertList) return;
  alertList.innerHTML = "";

  if (vehiclesData.length === 0) { alertList.innerHTML = "<p>No vehicles available.</p>"; return; }

  let vehiclesToShow = vehiclesData;
  if (userMarker) {
    const userPos = userMarker.getLatLng();
    vehiclesToShow = vehiclesData.filter(v => {
      if (v.lat==null || v.lon==null) return false;
      const { distance } = computeETA(userPos.lat, userPos.lng, v.lat, v.lon);
      return distance <= 500;
    });
    if (vehiclesToShow.length === 0) { alertList.innerHTML = "<p>No nearby vehicles within 500m.</p>"; return; }
  } else {
    // if no user location, show default message / top vehicles
    vehiclesToShow = vehiclesData.slice(0, 6);
  }

  vehiclesToShow.forEach(v => {
    const modeKey = normalizeMode(v.mode);
    const imgSrc = iconMap[modeKey] || iconMap["unknown"];
    let extra = "";
    if (userMarker && v.lat != null && v.lon != null) {
      const userPos = userMarker.getLatLng();
      const { distance, eta } = computeETA(userPos.lat, userPos.lng, v.lat, v.lon);
      extra = ` is ${distance} m away (~${eta} min walk)`;
    }
    const div = document.createElement("div");
    div.innerHTML = `<img src="${imgSrc}" alt="${v.mode}"> ${escapeHtml(capitalize(v.mode))} (ID: ${escapeHtml(v.id)})${extra}`;
    alertList.appendChild(div);
  });
}

/* Filters: render checkboxes for modes */
function initFilters() {
  const modes = [ "Podapoda","Taxi","Keke","Paratransit Bus","Waka Fine Bus","Motorbike" ];
  const container = document.getElementById("filters");
  if (!container) return;
  container.innerHTML = "";
  modes.forEach(mode => {
    const id = `filter-${mode.replace(/\s+/g,"-").toLowerCase()}`;
    const label = document.createElement("label");
    label.style.display = "block";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.id = id; cb.name = "modeFilter"; cb.value = mode; cb.checked = true;
    cb.addEventListener("change", applyFilters);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(" " + mode));
    container.appendChild(label);
  });
}

/* apply filters: show/hide markers */
function applyFilters() {
  const checked = Array.from(document.querySelectorAll('input[name="modeFilter"]:checked'))
    .map(n => n.value.toLowerCase());
  Object.entries(vehicleMarkers).forEach(([id, marker]) => {
    const vehicle = vehiclesData.find(v => v.id === id);
    if (!vehicle) {
      if (map.hasLayer(marker)) map.removeLayer(marker);
      delete vehicleMarkers[id];
      return;
    }
    const modeKey = normalizeMode(vehicle.mode);
    if (checked.includes(modeKey) || checked.includes(vehicle.mode.toLowerCase())) {
      if (!map.hasLayer(marker)) map.addLayer(marker);
    } else {
      if (map.hasLayer(marker)) map.removeLayer(marker);
    }
  });
}

/* locate me button */
function addLocateMeButton() {
  const btn = document.getElementById("locateMeBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (!navigator.geolocation) { alert("Geolocation not supported"); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      if (userMarker) userMarker.setLatLng([lat,lon]);
      else userMarker = L.marker([lat,lon], { title: "You are here" }).addTo(map);
      map.setView([lat,lon], 15);
      updateSidebarETAs();
      updateSidebarAlerts();
    }, (e) => { console.warn(e); alert("Unable to get location"); });
  });
}

/* clear vehicles button */
function wireClearVehicles() {
  const btn = document.getElementById("clearVehiclesBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    Object.values(vehicleMarkers).forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
    vehicleMarkers = {}; vehiclesData = [];
    updateSidebarETAs(); updateSidebarAlerts();
  });
}

/* ---------- Tracking logic ---------- */
let trackingIntervalId = null;
let trackingTimeoutId = null;
let currentlyTrackingId = null;

function startTracking(vehicleId, transportMode) {
  if (!vehicleId) return;
  // if already tracking another vehicle, stop first
  if (currentlyTrackingId && currentlyTrackingId !== vehicleId) stopTracking();

  currentlyTrackingId = vehicleId;
  document.getElementById("stopTrackingBtn").style.display = "inline-block";

  // fetch single vehicle from the full list endpoint (safer if backend doesn't have per-id URL)
  async function updateTracked() {
    try {
      const res = await fetch(`${BACKEND_URL}/api/vehicles`);
      if (!res.ok) throw new Error("fetch failed");
      const all = await res.json();
      const info = all?.[vehicleId] || null;
      if (!info || info.lat == null || info.lon == null) {
        console.warn("No location yet for", vehicleId);
        return;
      }
      const icon = getIcon(transportMode);
      const popup = `Vehicle ID: ${vehicleId}<br>Mode: ${transportMode}`;
      if (vehicleMarkers[vehicleId]) {
        vehicleMarkers[vehicleId].setLatLng([info.lat, info.lon]);
        vehicleMarkers[vehicleId].setIcon(icon);
        vehicleMarkers[vehicleId].setPopupContent(popup);
      } else {
        const m = L.marker([info.lat, info.lon], { icon }).bindPopup(popup).addTo(map);
        vehicleMarkers[vehicleId] = m;
      }
      map.setView([info.lat, info.lon], 15);
      updateSidebarETAs();
      updateSidebarAlerts();
    } catch (e) {
      console.error("Tracking fetch error:", e);
    }
  }

  // initial immediate update then every 5s
  updateTracked();
  trackingIntervalId = setInterval(updateTracked, 5000);

  // auto-stop after 5 minutes (300000 ms)
  if (trackingTimeoutId) clearTimeout(trackingTimeoutId);
  trackingTimeoutId = setTimeout(() => {
    stopTracking();
    alert(`Auto-stopped tracking ${vehicleId} after 5 minutes.`);
  }, 300000);
}

function stopTracking() {
  if (trackingIntervalId) { clearInterval(trackingIntervalId); trackingIntervalId = null; }
  if (trackingTimeoutId) { clearTimeout(trackingTimeoutId); trackingTimeoutId = null; }
  currentlyTrackingId = null;
  document.getElementById("stopTrackingBtn").style.display = "none";
}

/* Escape HTML helper */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]));
}

/* capitalize helper */
function capitalize(str){ return str ? str.charAt(0).toUpperCase() + str.slice(1) : ""; }

/* Modal behavior */
function setupModal() {
  const modal = document.getElementById("trackingModal");
  const trigger = document.getElementById("openTrackingModal");
  const closeBtn = document.getElementById("closeTrackingModal");
  const form = document.getElementById("trackingForm");
  // open modal
  trigger?.addEventListener("click", () => {
    modal.style.display = "flex"; modal.setAttribute("aria-hidden", "false");
  });
  // close modal
  closeBtn?.addEventListener("click", () => {
    modal.style.display = "none"; modal.setAttribute("aria-hidden", "true");
  });
  // outside click closes
  modal?.addEventListener("click", e => { if (e.target === modal) { modal.style.display = "none"; modal.setAttribute("aria-hidden","true"); }});
  // escape key
  document.addEventListener("keydown", e => { if (e.key === "Escape" && modal.style.display === "flex") { modal.style.display = "none"; modal.setAttribute("aria-hidden","true"); }});

  // handle form submit
  form?.addEventListener("submit", e => {
    e.preventDefault();
    const vehicleId = document.getElementById("vehicleId").value.trim();
    const mode = document.getElementById("mode").value.trim();
    if (!vehicleId || !mode) { alert("Please enter vehicle id and mode"); return; }
    startTracking(vehicleId, mode);
    // auto-close modal
    modal.style.display = "none"; modal.setAttribute("aria-hidden","true");
    // if on mobile close sidebar to reveal map
    const sidebar = document.getElementById("sidebar");
    if (window.innerWidth <= 768 && sidebar) sidebar.classList.remove("open");
  });
}

/* Sidebar toggle for mobile */
function setupSidebarToggle() {
  const toggle = document.getElementById("sidebarToggle");
  const sidebar = document.getElementById("sidebar");
  const closeBtn = document.getElementById("closeSidebarBtn");
  toggle?.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    toggle.setAttribute("aria-expanded", sidebar.classList.contains("open") ? "true" : "false");
  });
  closeBtn?.addEventListener("click", () => sidebar.classList.remove("open"));
}

/* initialize map and wiring */
function initMap() {
  map = L.map("map").setView([8.48, -13.22], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors", maxZoom: 19
  }).addTo(map);

  routeLayers.addTo(map);
  loadRoutes();
  loadStops();
  addLocateMeButton();
  wireClearVehicles();

  // initial vehicle load and polling
  fetchVehicles();
  setInterval(fetchVehicles, 5000);

  // wire UI pieces
  setupModal();
  setupSidebarToggle();

  // Stop tracking button
  const stopBtn = document.getElementById("stopTrackingBtn");
  stopBtn?.addEventListener("click", () => { stopTracking(); });

  // filters init
  initFilters();
}

/* run on DOM ready */
window.addEventListener("DOMContentLoaded", () => {
  if (!promptLogin()) return;
  initMap();
});
