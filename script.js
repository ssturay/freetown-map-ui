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

function getIcon(mode) {
  const key = mode?.toLowerCase();
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

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}

function addLocateMeButton() {
  const locateBtn = document.getElementById("locateMeBtn");
  if (!locateBtn) return;

  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Geolocation not supported by your browser.");
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
      err => alert("Unable to retrieve location")
    );
  });
}

async function loadRoutes() {
  try {
    const res = await fetch("data/routes.geojson");
    if (!res.ok) throw new Error();
    const geojson = await res.json();
    routeLayers.clearLayers();
    L.geoJSON(geojson, {
      style: f => ({
        color: f.properties.color || "#3388ff",
        weight: 5,
        opacity: 0.7
      }),
      onEachFeature: (f, l) => {
        if (f.properties?.name) l.bindPopup(`<strong>Route:</strong> ${f.properties.name}`);
        routeLayers.addLayer(l);
      }
    });
    routeLayers.addTo(map);
  } catch {}
}

async function loadStops() {
  try {
    const res = await fetch("data/stops.geojson");
    if (!res.ok) throw new Error();
    const geojson = await res.json();
    if (stopsLayer) stopsLayer.clearLayers();
    stopsLayer = L.geoJSON(geojson, {
      pointToLayer: (f, latlng) => L.circleMarker(latlng, {
        radius: 6, fillColor: "#ff0000", color: "#880000", weight: 1, opacity: 1, fillOpacity: 0.8
      }),
      onEachFeature: (f, l) => {
        if (f.properties?.name) l.bindPopup(`<strong>Stop:</strong> ${f.properties.name}`);
      }
    }).addTo(map);
  } catch {}
}

async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    vehiclesData = Object.entries(data).map(([id, info]) => ({
      id, lat: info.lat, lon: info.lon, mode: info.mode || "podapoda"
    }));
    vehiclesData.forEach(v => {
      if (!v.id || !v.lat || !v.lon) return;
      const icon = getIcon(v.mode);
      let popupContent = `Vehicle ID: ${v.id}<br>Mode: ${v.mode}`;
      if (userMarker) {
        const userPos = userMarker.getLatLng();
        const { distance, eta } = computeETA(userPos.lat, userPos.lng, v.lat, v.lon);
        popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }
      if (vehicleMarkers[v.id]) {
        vehicleMarkers[v.id].setLatLng([v.lat, v.lon]).setIcon(icon).setPopupContent(popupContent);
      } else {
        vehicleMarkers[v.id] = L.marker([v.lat, v.lon], { icon }).bindPopup(popupContent).addTo(map);
      }
    });
    applyFilters();
    updateSidebarETAs();
    updateSidebarAlerts();
    const timeLabel = document.getElementById("lastUpdated");
    if (timeLabel) timeLabel.textContent = new Date().toLocaleTimeString();
  } catch {}
}

function updateSidebarETAs() {
  const etaList = document.getElementById("etaList");
  if (!etaList) return;
  etaList.innerHTML = "";
  if (!vehiclesData.length) {
    etaList.innerHTML = "<p>No data available.</p>";
    return;
  }
  vehiclesData.forEach(v => {
    let distText = "";
    if (userMarker) {
      const userPos = userMarker.getLatLng();
      const { distance, eta } = computeETA(userPos.lat, userPos.lng, v.lat, v.lon);
      distText = ` — ${distance} m, ETA ~${eta} min`;
    }
    etaList.innerHTML += `
      <div>
        <img src="${iconMap[v.mode?.toLowerCase()] || iconMap['podapoda']}" style="width:18px;height:18px;margin-right:6px;vertical-align:middle;">
        ${capitalize(v.mode)} (ID: ${v.id})${distText}
      </div>`;
  });
}

function updateSidebarAlerts() {
  const alertList = document.getElementById("alertSidebar");
  if (!alertList) return;
  alertList.innerHTML = "";
  if (!vehiclesData.length) {
    alertList.innerHTML = "<p>No vehicles available.</p>";
    return;
  }
  let showVehicles = vehiclesData;
  if (userMarker) {
    const userPos = userMarker.getLatLng();
    showVehicles = vehiclesData.filter(v => computeETA(userPos.lat, userPos.lng, v.lat, v.lon).distance <= 500);
    if (!showVehicles.length) {
      alertList.innerHTML = "<p>No nearby vehicles within 500m.</p>";
      return;
    }
  }
  showVehicles.forEach(v => {
    let extra = "";
    if (userMarker) {
      const userPos = userMarker.getLatLng();
      const { distance, eta } = computeETA(userPos.lat, userPos.lng, v.lat, v.lon);
      extra = ` is ${distance} m away (~${eta} min walk)`;
    }
    alertList.innerHTML += `
      <div>
        <img src="${iconMap[v.mode?.toLowerCase()] || iconMap['podapoda']}" style="width:18px;height:18px;margin-right:6px;vertical-align:middle;">
        ${capitalize(v.mode)} (ID: ${v.id})${extra}
      </div>`;
  });
}

function initFilters() {
  const container = document.querySelector(".sidebar-filter-container");
  if (!container) return;
  const modes = ["Podapoda","Taxi","Keke","Paratransit Bus","Waka Fine Bus","Motorbike"];
  container.innerHTML = "";
  modes.forEach(mode => {
    const id = `filter-${mode.replace(/\s+/g,"-").toLowerCase()}`;
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox"; checkbox.value = mode; checkbox.checked = true;
    checkbox.addEventListener("change", applyFilters);
    label.appendChild(checkbox);
    label.append(` ${mode}`);
    container.appendChild(label);
  });
}

function applyFilters() {
  const checked = Array.from(document.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value.toLowerCase());
  Object.entries(vehicleMarkers).forEach(([id, marker]) => {
    const v = vehiclesData.find(x => x.id === id);
    if (!v) return;
    if (checked.includes(v.mode.toLowerCase())) {
      if (!map.hasLayer(marker)) map.addLayer(marker);
    } else {
      if (map.hasLayer(marker)) map.removeLayer(marker);
    }
  });
}

function clearVehicles() {
  Object.values(vehicleMarkers).forEach(m => map.removeLayer(m));
  vehicleMarkers = {};
  vehiclesData = [];
}

function setupModal() {
  const modal = document.getElementById("trackingModal");
  const openBtn = document.getElementById("openTrackingModal");
  const closeBtn = document.getElementById("closeTrackingModal");
  openBtn.addEventListener("click", () => modal.style.display = "block");
  closeBtn.addEventListener("click", () => modal.style.display = "none");
}

function startTracking(vehicleId, mode) {
  clearInterval(trackingInterval);
  clearTimeout(trackingTimeout);
  clearVehicles();
  const updateTracked = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/vehicles/${vehicleId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!data.lat || !data.lon) return;
      const icon = getIcon(mode);
      let popupContent = `Vehicle ID: ${vehicleId}<br>Mode: ${mode}`;
      if (userMarker) {
        const userPos = userMarker.getLatLng();
        const { distance, eta } = computeETA(userPos.lat, userPos.lng, data.lat, data.lon);
        popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }
      if (vehicleMarkers[vehicleId]) {
        vehicleMarkers[vehicleId].setLatLng([data.lat, data.lon]).setIcon(icon).setPopupContent(popupContent);
      } else {
        vehicleMarkers[vehicleId] = L.marker([data.lat, data.lon], { icon }).bindPopup(popupContent).addTo(map);
      }
      map.setView([data.lat, data.lon], 15);
    } catch {}
  };
  updateTracked();
  trackingInterval = setInterval(updateTracked, 5000);
  trackingTimeout = setTimeout(stopTracking, 5 * 60 * 1000);
}

function stopTracking() {
  clearInterval(trackingInterval);
  clearTimeout(trackingTimeout);
  alert("Tracking stopped after 5 minutes");
}

function initMap() {
  map = L.map("map").setView([8.48, -13.22], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors", maxZoom: 19
  }).addTo(map);
  routeLayers.addTo(map);
  loadRoutes(); loadStops();
  addLocateMeButton();
  fetchVehicles();
  setInterval(fetchVehicles, 5000);
  setupModal();
  initFilters();
  const form = document.getElementById("trackingForm");
  if (form) {
    form.addEventListener("submit", e => {
      e.preventDefault();
      const id = document.getElementById("vehicleId").value.trim();
      const mode = document.getElementById("mode").value.trim();
      if (!id || !mode) {
        alert("Please enter both Vehicle ID and Transport Mode.");
        return;
      }
      startTracking(id, mode);
      document.getElementById("trackingModal").style.display = "none";
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  if (promptLogin()) initMap();
});
