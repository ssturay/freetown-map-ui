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

const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, userMarker = null;
let vehicleMarkers = {};
let vehiclesData = [];
let routeLayers = L.featureGroup();
let stopsLayer;
let trackingInterval = null;
let trackingTimeout = null;

const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};
const defaultIconUrl = "https://cdn-icons-png.flaticon.com/512/854/854894.png"; // fallback icon

function getIcon(mode) {
  const key = mode?.toLowerCase() || "";
  return L.icon({
    iconUrl: iconMap[key] || defaultIconUrl,
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

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}

function addLocateMeButton() {
  const locateBtn = document.getElementById("locateMeBtn");
  if (!locateBtn) return;
  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Geolocation not supported.");
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
      err => console.error(err)
    );
  });
}

async function loadRoutes() {
  try {
    const res = await fetch("data/routes.geojson");
    const geojson = await res.json();
    routeLayers.clearLayers();
    L.geoJSON(geojson, {
      style: f => ({ color: f.properties.color || "#3388ff", weight: 5, opacity: 0.7 }),
      onEachFeature: (f, layer) => {
        if (f.properties?.name) layer.bindPopup(`<strong>Route:</strong> ${f.properties.name}`);
        routeLayers.addLayer(layer);
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
      pointToLayer: (_, latlng) => L.circleMarker(latlng, {
        radius: 6, fillColor: "#ff0000", color: "#880000", weight: 1, fillOpacity: 0.8
      }),
      onEachFeature: (f, layer) => {
        if (f.properties?.name) layer.bindPopup(`<strong>Stop:</strong> ${f.properties.name}`);
      }
    }).addTo(map);
  } catch (err) { console.error(err); }
}

async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    const data = await res.json();
    vehiclesData = Object.entries(data).map(([id, info]) => ({
      id, lat: info.lat, lon: info.lon, mode: info.mode || "unknown"
    }));
    vehiclesData.forEach(v => {
      if (!v.id || !v.lat || !v.lon) return;
      const icon = getIcon(v.mode);
      let popup = `Vehicle ID: ${v.id}<br>Mode: ${capitalize(v.mode)}`;
      if (userMarker) {
        const { distance, eta } = computeETA(userMarker.getLatLng().lat, userMarker.getLatLng().lng, v.lat, v.lon);
        popup += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }
      if (vehicleMarkers[v.id]) {
        vehicleMarkers[v.id].setLatLng([v.lat, v.lon]).setIcon(icon).setPopupContent(popup);
      } else {
        vehicleMarkers[v.id] = L.marker([v.lat, v.lon], { icon }).bindPopup(popup).addTo(map);
      }
    });
    updateSidebarETAs();
    updateSidebarAlerts();
    const lbl = document.getElementById("lastUpdated");
    if (lbl) lbl.textContent = new Date().toLocaleTimeString();
  } catch (err) { console.error(err); }
}

function updateSidebarETAs() {
  const list = document.getElementById("etaList");
  if (!list) return;
  list.innerHTML = vehiclesData.length ? "" : "<p>No data available.</p>";
  vehiclesData.forEach(v => {
    let distanceText = "";
    if (userMarker) {
      const { distance, eta } = computeETA(userMarker.getLatLng().lat, userMarker.getLatLng().lng, v.lat, v.lon);
      distanceText = ` — ${distance} m, ETA ~${eta} min`;
    }
    const div = document.createElement("div");
    div.innerHTML = `<img src="${iconMap[v.mode.toLowerCase()] || defaultIconUrl}" 
                        style="width:18px;height:18px;margin-right:6px;">${capitalize(v.mode)} (ID: ${v.id})${distanceText}`;
    list.appendChild(div);
  });
}

function updateSidebarAlerts() {
  const list = document.getElementById("alertSidebar");
  if (!list) return;
  list.innerHTML = "";
  let nearby = vehiclesData;
  if (userMarker) {
    nearby = vehiclesData.filter(v => computeETA(userMarker.getLatLng().lat, userMarker.getLatLng().lng, v.lat, v.lon).distance <= 500);
  }
  if (!nearby.length) {
    list.innerHTML = "<p>No nearby vehicles within 500m.</p>";
    return;
  }
  nearby.forEach(v => {
    const { distance, eta } = userMarker ? computeETA(userMarker.getLatLng().lat, userMarker.getLatLng().lng, v.lat, v.lon) : { distance: 0, eta: 0 };
    const div = document.createElement("div");
    div.innerHTML = `<img src="${iconMap[v.mode.toLowerCase()] || defaultIconUrl}" 
                        style="width:18px;height:18px;margin-right:6px;">${capitalize(v.mode)} (ID: ${v.id}) is ${distance} m away (~${eta} min walk)`;
    list.appendChild(div);
  });
}

function clearVehicles() {
  Object.values(vehicleMarkers).forEach(m => map.removeLayer(m));
  vehicleMarkers = {};
  vehiclesData = [];
}

function startTracking(vehicleId, mode) {
  clearVehicles();
  if (trackingInterval) clearInterval(trackingInterval);
  if (trackingTimeout) clearTimeout(trackingTimeout);
  const update = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/vehicles/${vehicleId}`);
      const v = await res.json();
      if (!v.lat || !v.lon) return;
      const icon = getIcon(mode);
      let popup = `Vehicle ID: ${vehicleId}<br>Mode: ${capitalize(mode)}`;
      if (userMarker) {
        const { distance, eta } = computeETA(userMarker.getLatLng().lat, userMarker.getLatLng().lng, v.lat, v.lon);
        popup += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }
      if (vehicleMarkers[vehicleId]) {
        vehicleMarkers[vehicleId].setLatLng([v.lat, v.lon]).setIcon(icon).setPopupContent(popup);
      } else {
        vehicleMarkers[vehicleId] = L.marker([v.lat, v.lon], { icon }).bindPopup(popup).addTo(map);
      }
      map.setView([v.lat, v.lon], 15);
    } catch (err) { console.error(err); }
  };
  update();
  trackingInterval = setInterval(update, 5000);
  trackingTimeout = setTimeout(stopTracking, 5 * 60 * 1000);
}

function stopTracking() {
  clearInterval(trackingInterval);
  clearTimeout(trackingTimeout);
  fetchVehicles(); // return to all vehicles
}

function initFilters() {
  const container = document.querySelector(".sidebar-filter-container");
  if (!container) return;
  container.innerHTML = "";
  ["Podapoda", "Taxi", "Keke", "Paratransit Bus", "Waka Fine Bus", "Motorbike"].forEach(mode => {
    const id = `filter-${mode.replace(/\s+/g, "-").toLowerCase()}`;
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = mode; cb.checked = true;
    cb.addEventListener("change", applyFilters);
    label.appendChild(cb); label.append(` ${mode}`);
    container.appendChild(label);
  });
}

function applyFilters() {
  const checked = Array.from(document.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value.toLowerCase());
  Object.entries(vehicleMarkers).forEach(([id, marker]) => {
    const v = vehiclesData.find(x => x.id === id);
    if (v && checked.includes(v.mode.toLowerCase())) {
      if (!map.hasLayer(marker)) map.addLayer(marker);
    } else {
      if (map.hasLayer(marker)) map.removeLayer(marker);
    }
  });
}

function initMap() {
  map = L.map("map").setView([8.48, -13.22], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
  routeLayers.addTo(map);
  loadRoutes();
  loadStops();
  addLocateMeButton();
  fetchVehicles();
  setInterval(fetchVehicles, 5000);
  initFilters();

  // Menu toggle for mobile
  document.getElementById("menuToggleBtn").addEventListener("click", () => {
    document.querySelector(".sidebar").classList.toggle("open");
  });

  // Tracking form
  document.getElementById("trackingForm").addEventListener("submit", e => {
    e.preventDefault();
    const vehicleId = document.getElementById("vehicleId").value.trim();
    const mode = document.getElementById("mode").value.trim();
    if (!vehicleId || !mode) { alert("Please enter both fields."); return; }
    startTracking(vehicleId, mode);
    document.getElementById("trackingModal").style.display = "none";
  });
}

window.addEventListener("DOMContentLoaded", () => {
  if (promptLogin()) initMap();
});
