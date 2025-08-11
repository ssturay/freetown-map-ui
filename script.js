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
let trackedVehicleId = null;
let trackingInterval = null;
let trackingTimeout = null;

const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png",
  "default": "https://cdn-icons-png.flaticon.com/512/854/854894.png"
};

function getIcon(mode) {
  const key = mode?.toLowerCase() || "default";
  return L.icon({
    iconUrl: iconMap[key] || iconMap["default"],
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
    });
  });
}

async function loadRoutes() {
  try {
    const res = await fetch("data/routes.geojson");
    const geojson = await res.json();
    routeLayers.clearLayers();
    L.geoJSON(geojson, {
      style: f => ({
        color: f.properties.color || "#3388ff",
        weight: 5,
        opacity: 0.7
      }),
      onEachFeature: (f, layer) => {
        if (f.properties?.name) {
          layer.bindPopup(`<strong>Route:</strong> ${f.properties.name}`);
        }
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
      pointToLayer: (f, latlng) => L.circleMarker(latlng, {
        radius: 6, fillColor: "#ff0000", color: "#880000",
        weight: 1, fillOpacity: 0.8
      }),
      onEachFeature: (f, layer) => {
        if (f.properties?.name) {
          layer.bindPopup(`<strong>Stop:</strong> ${f.properties.name}`);
        }
      }
    }).addTo(map);
  } catch (err) { console.error(err); }
}

async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    const data = await res.json();
    vehiclesData = Object.entries(data).map(([id, info]) => ({
      id, lat: info.lat, lon: info.lon, mode: info.mode || "default"
    }));

    vehiclesData.forEach(v => {
      if (!v.lat || !v.lon) return;
      const icon = getIcon(v.mode);
      let popupContent = `Vehicle ID: ${v.id}<br>Mode: ${capitalize(v.mode)}`;
      if (userMarker) {
        const u = userMarker.getLatLng();
        const { distance, eta } = computeETA(u.lat, u.lng, v.lat, v.lon);
        popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }
      if (vehicleMarkers[v.id]) {
        vehicleMarkers[v.id].setLatLng([v.lat, v.lon]).setIcon(icon).setPopupContent(popupContent);
      } else {
        vehicleMarkers[v.id] = L.marker([v.lat, v.lon], { icon }).bindPopup(popupContent).addTo(map);
      }
    });

    updateSidebarETAs();
    updateSidebarAlerts();
    const timeLabel = document.getElementById("lastUpdated");
    if (timeLabel) timeLabel.textContent = new Date().toLocaleTimeString();
  } catch (err) { console.error("Vehicle update error:", err); }
}

function updateSidebarETAs() {
  const list = document.getElementById("etaList");
  list.innerHTML = "";
  if (!vehiclesData.length) return list.innerHTML = "<p>No data</p>";

  const sorted = [...vehiclesData];
  if (trackedVehicleId) {
    sorted.sort((a, b) => a.id === trackedVehicleId ? -1 : b.id === trackedVehicleId ? 1 : 0);
  }

  sorted.forEach(v => {
    let distanceText = "";
    if (userMarker) {
      const u = userMarker.getLatLng();
      const { distance, eta } = computeETA(u.lat, u.lng, v.lat, v.lon);
      distanceText = ` — ${distance} m, ETA ~${eta} min`;
    }
    const div = document.createElement("div");
    if (v.id === trackedVehicleId) div.style.fontWeight = "bold";
    div.innerHTML = `<img src="${iconMap[v.mode] || iconMap.default}" style="width:18px; height:18px; vertical-align:middle; margin-right:6px;">${capitalize(v.mode)} (ID: ${v.id})${distanceText}`;
    list.appendChild(div);
  });
}

function updateSidebarAlerts() {
  const list = document.getElementById("alertSidebar");
  list.innerHTML = "";
  if (!vehiclesData.length) return list.innerHTML = "<p>No vehicles</p>";

  const sorted = [...vehiclesData];
  if (trackedVehicleId) {
    sorted.sort((a, b) => a.id === trackedVehicleId ? -1 : b.id === trackedVehicleId ? 1 : 0);
  }

  sorted.forEach(v => {
    let extraInfo = "";
    if (userMarker) {
      const u = userMarker.getLatLng();
      const { distance, eta } = computeETA(u.lat, u.lng, v.lat, v.lon);
      extraInfo = ` is ${distance} m away (~${eta} min walk)`;
    }
    const div = document.createElement("div");
    if (v.id === trackedVehicleId) div.style.fontWeight = "bold";
    div.innerHTML = `<img src="${iconMap[v.mode] || iconMap.default}" style="width:18px; height:18px; vertical-align:middle; margin-right:6px;">${capitalize(v.mode)} (ID: ${v.id})${extraInfo}`;
    list.appendChild(div);
  });
}

function startTracking(id, mode) {
  trackedVehicleId = id;
  document.getElementById("stopTrackingBtn").style.display = "inline-block";
  clearInterval(trackingInterval);
  clearTimeout(trackingTimeout);

  const update = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/vehicles/${id}`);
      const data = await res.json();
      if (!data.lat || !data.lon) return;
      const icon = getIcon(mode);
      let popupContent = `Vehicle ID: ${id}<br>Mode: ${capitalize(mode)}`;
      if (userMarker) {
        const u = userMarker.getLatLng();
        const { distance, eta } = computeETA(u.lat, u.lng, data.lat, data.lon);
        popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }
      if (vehicleMarkers[id]) {
        vehicleMarkers[id].setLatLng([data.lat, data.lon]).setIcon(icon).setPopupContent(popupContent);
      } else {
        vehicleMarkers[id] = L.marker([data.lat, data.lon], { icon }).bindPopup(popupContent).addTo(map);
      }
      updateSidebarETAs();
      updateSidebarAlerts();
    } catch (err) { console.error("Tracking error:", err); }
  };

  update();
  trackingInterval = setInterval(update, 5000);
  trackingTimeout = setTimeout(stopTracking, 5 * 60 * 1000);
}

function stopTracking() {
  trackedVehicleId = null;
  clearInterval(trackingInterval);
  clearTimeout(trackingTimeout);
  document.getElementById("stopTrackingBtn").style.display = "none";
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

  document.getElementById("trackingForm").addEventListener("submit", e => {
    e.preventDefault();
    const id = document.getElementById("vehicleId").value.trim();
    const mode = document.getElementById("mode").value.trim().toLowerCase();
    if (!id || !mode) return alert("Fill all fields");
    startTracking(id, mode);
    document.getElementById("trackingModal").style.display = "none";
  });

  document.getElementById("stopTrackingBtn").addEventListener("click", stopTracking);
}

window.addEventListener("DOMContentLoaded", () => {
  if (promptLogin()) initMap();
});
