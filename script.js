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
  const key = (mode || "podapoda").toLowerCase();
  const iconUrl = iconMap[key] || iconMap["podapoda"];
  return L.icon({
    iconUrl,
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

    routeLayers.addTo(map);
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
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
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

async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");
    const data = await res.json();

    vehiclesData = Object.entries(data).map(([id, info]) => ({
      id,
      lat: info.lat,
      lon: info.lon,
      mode: info.mode || "podapoda"
    }));

    vehiclesData.forEach(({ id, lat, lon, mode }) => {
      if (!id || !lat || !lon) return;

      const icon = getIcon(mode);
      let popupContent = `Vehicle ID: ${id}<br>Mode: ${mode}`;
      if (userMarker) {
        const { distance, eta } = computeETA(userMarker.getLatLng().lat, userMarker.getLatLng().lng, lat, lon);
        popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }

      if (vehicleMarkers[id]) {
        vehicleMarkers[id].setLatLng([lat, lon]).setIcon(icon).setPopupContent(popupContent);
      } else {
        vehicleMarkers[id] = L.marker([lat, lon], { icon }).bindPopup(popupContent).addTo(map);
      }
    });

    updateSidebarETAs();
    updateSidebarAlerts();

    const timeLabel = document.getElementById("lastUpdated");
    if (timeLabel) timeLabel.textContent = new Date().toLocaleTimeString();
  } catch (err) {
    console.error("Vehicle update error:", err);
  }
}

function updateSidebarETAs() {
  const etaList = document.getElementById("etaList");
  if (!etaList) return;
  etaList.innerHTML = vehiclesData.length === 0
    ? "<p>No data available.</p>"
    : vehiclesData.map(v => {
        const { distance, eta } = userMarker
          ? computeETA(userMarker.getLatLng().lat, userMarker.getLatLng().lng, v.lat, v.lon)
          : { distance: null, eta: null };
        return `<div>
          <img src="${iconMap[v.mode?.toLowerCase()] || iconMap['podapoda']}" alt="${v.mode}" style="width:18px; height:18px; margin-right:6px;">
          ${capitalize(v.mode)} (ID: ${v.id})${distance ? ` — ${distance} m, ETA ~${eta} min` : ""}
        </div>`;
      }).join("");
}

function updateSidebarAlerts() {
  const alertList = document.getElementById("alertSidebar");
  if (!alertList) return;
  alertList.innerHTML = vehiclesData.length === 0
    ? "<p>No vehicles available.</p>"
    : vehiclesData.filter(v => {
        if (!userMarker) return true;
        const { distance } = computeETA(userMarker.getLatLng().lat, userMarker.getLatLng().lng, v.lat, v.lon);
        return distance <= 500;
      }).map(v => {
        const { distance, eta } = userMarker
          ? computeETA(userMarker.getLatLng().lat, userMarker.getLatLng().lng, v.lat, v.lon)
          : { distance: null, eta: null };
        return `<div>
          <img src="${iconMap[v.mode?.toLowerCase()] || iconMap['podapoda']}" alt="${v.mode}" style="width:18px; height:18px; margin-right:6px;">
          ${capitalize(v.mode)} (ID: ${v.id})${distance ? ` is ${distance} m away (~${eta} min walk)` : ""}
        </div>`;
      }).join("");
}

function startTracking(vehicleId, transportMode) {
  clearInterval(trackingInterval);
  clearTimeout(trackingTimeout);

  document.getElementById("stopTrackingBtn").style.display = "inline-block";
  clearVehicles();

  async function updateTrackedVehicle() {
    try {
      const res = await fetch(`${BACKEND_URL}/api/vehicles/${vehicleId}`);
      if (!res.ok) throw new Error("Vehicle fetch failed");
      const data = await res.json();
      if (!data.lat || !data.lon) return;

      const icon = getIcon(transportMode);
      let popupContent = `Vehicle ID: ${vehicleId}<br>Mode: ${transportMode}`;
      if (userMarker) {
        const { distance, eta } = computeETA(userMarker.getLatLng().lat, userMarker.getLatLng().lng, data.lat, data.lon);
        popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }

      if (vehicleMarkers[vehicleId]) {
        vehicleMarkers[vehicleId].setLatLng([data.lat, data.lon]).setIcon(icon).setPopupContent(popupContent);
      } else {
        vehicleMarkers[vehicleId] = L.marker([data.lat, data.lon], { icon }).bindPopup(popupContent).addTo(map);
      }

      map.setView([data.lat, data.lon], 15);
    } catch (err) {
      console.error("Tracking error:", err);
    }
  }

  updateTrackedVehicle();
  trackingInterval = setInterval(updateTrackedVehicle, 5000);
  trackingTimeout = setTimeout(stopTracking, 5 * 60 * 1000); // auto stop after 5 min
}

function stopTracking() {
  clearInterval(trackingInterval);
  clearTimeout(trackingTimeout);
  document.getElementById("stopTrackingBtn").style.display = "none";
  fetchVehicles();
}

function clearVehicles() {
  Object.values(vehicleMarkers).forEach(marker => map.removeLayer(marker));
  vehicleMarkers = {};
}

function initMap() {
  map = L.map("map").setView([8.48, -13.22], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(map);

  routeLayers.addTo(map);
  loadRoutes();
  loadStops();
  fetchVehicles();
  setInterval(fetchVehicles, 5000);

  document.getElementById("trackingForm").addEventListener("submit", e => {
    e.preventDefault();
    const vehicleId = document.getElementById("vehicleId").value.trim();
    const transportMode = document.getElementById("mode").value.trim();
    if (!vehicleId || !transportMode) {
      alert("Please enter both Vehicle ID and Mode.");
      return;
    }
    startTracking(vehicleId, transportMode);
    document.getElementById("trackingModal").style.display = "none";
  });

  document.getElementById("stopTrackingBtn").addEventListener("click", stopTracking);
}

window.addEventListener("DOMContentLoaded", () => {
  if (promptLogin()) initMap();
});
