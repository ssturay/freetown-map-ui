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

const iconMap = {
  "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
};

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

function getIcon(mode) {
  const key = mode?.toLowerCase() || "podapoda";
  return L.icon({
    iconUrl: iconMap[key] || iconMap["podapoda"],
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30]
  });
}

function addLocateMeButton() {
  const locateBtn = document.getElementById("locateMeBtn");
  if (!locateBtn) return;

  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
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
        if (feature.properties && feature.properties.name) {
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

async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    if (!res.ok) throw new Error("Failed to fetch vehicles");
    const { vehicles } = await res.json();
    vehiclesData = vehicles;
    vehicles.forEach(vehicle => {
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
    updateSidebarETAs();
    updateSidebarAlerts();
    document.getElementById("lastUpdated").textContent = new Date().toLocaleTimeString();
  } catch (err) {
    console.error("Vehicle update error:", err);
  }
}

// ✅ NEW startTracking
async function startTracking(vehicleId, transportMode) {
  console.log(`Starting tracking for ${vehicleId} (${transportMode})`);

  try {
    await fetch(`${BACKEND_URL}/api/tracking/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: vehicleId })
    });
  } catch (err) {
    console.error("Failed to start tracking:", err);
    return;
  }

  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
      pos => {
        fetch(
          `${BACKEND_URL}/api/location/update?id=${vehicleId}&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&mode=${transportMode}`,
          { method: "GET" }
        ).catch(err => console.error("Failed to update location:", err));
      },
      err => console.error("GPS error:", err),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  }

  const updateTrackedVehicle = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/vehicles`);
      if (!res.ok) throw new Error("Failed to fetch vehicle data");
      const { vehicles } = await res.json();
      const tracked = vehicles.find(v => v.id === vehicleId);
      if (!tracked) return;
      const icon = getIcon(tracked.mode);
      let popupContent = `Vehicle ID: ${vehicleId}<br>Mode: ${tracked.mode}`;
      if (userMarker) {
        const userPos = userMarker.getLatLng();
        const { distance, eta } = computeETA(userPos.lat, userPos.lng, tracked.lat, tracked.lon);
        popupContent += `<br>Distance: ${distance} m<br>ETA: ${eta} min`;
      }
      if (vehicleMarkers[vehicleId]) {
        vehicleMarkers[vehicleId].setLatLng([tracked.lat, tracked.lon]);
        vehicleMarkers[vehicleId].setPopupContent(popupContent);
      } else {
        vehicleMarkers[vehicleId] = L.marker([tracked.lat, tracked.lon], { icon })
          .bindPopup(popupContent)
          .addTo(map);
      }
      updateSidebarETAs();
      updateSidebarAlerts();
    } catch (err) {
      console.error("Error updating tracked vehicle:", err);
    }
  };

  const trackingInterval = setInterval(updateTrackedVehicle, 5000);

  setTimeout(() => {
    clearInterval(trackingInterval);
    fetch(`${BACKEND_URL}/api/tracking/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: vehicleId })
    });
    alert(`Tracking stopped for ${vehicleId}`);
  }, 5 * 60 * 1000);
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
  addLocateMeButton();
  fetchVehicles();
  setInterval(fetchVehicles, 5000);

  const trackingForm = document.getElementById("trackingForm");
  if (trackingForm) {
    trackingForm.addEventListener("submit", function (e) {
      e.preventDefault();
      const vehicleId = document.getElementById("vehicleId").value.trim();
      const transportMode = document.getElementById("mode").value.trim();
      if (!vehicleId || !transportMode) {
        alert("Please enter both Vehicle ID and Transport Mode.");
        return;
      }
      startTracking(vehicleId, transportMode);
      const modal = document.getElementById("trackingModal");
      modal.style.display = "none";
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  if (promptLogin()) {
    initMap();
  }
});
