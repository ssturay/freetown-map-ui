function promptLogin() {
  if (localStorage.getItem("loggedIn") === "true") return true;

  const username = prompt("Enter username:");
  const password = prompt("Enter password:");

  const VALID_USERNAME = "admin";
  const VALID_PASSWORD = "mypassword";

  if (username !== VALID_USERNAME || password !== VALID_PASSWORD) {
    alert("Access denied");
    document.body.innerHTML =
      "<h2 style='text-align:center; padding: 2rem;'>Access Denied</h2>";
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
  "Podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
  "Taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
  "Keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
  "Paratransit Bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
  "Waka Fine Bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
  "Motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
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

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
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
      pointToLayer: (feature, latlng) => {
        return L.circleMarker(latlng, {
          radius: 6,
          fillColor: "#ff0000",
          color: "#880000",
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        });
      },
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

function getIcon(mode) {
  const iconUrl = iconMap[mode] || iconMap["Podapoda"];
  return L.icon({
    iconUrl,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30]
  });
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
      mode: info.mode || "Podapoda"
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
        const marker = L.marker([lat, lon], { icon }).bindPopup(popupContent).addTo(map);
        vehicleMarkers[id] = marker;
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

function updateSidebarETAs() {
  const etaList = document.getElementById("etaList");
  if (!etaList) return;
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
    const div = document.createElement("div");
    div.innerHTML = `
      <img src="${iconMap[v.mode] || iconMap["Podapoda"]}" 
           alt="${v.mode}" 
           style="width:18px; height:18px; vertical-align:middle; margin-right:6px;">
      ${v.mode} (ID: ${v.id})${distanceText}
    `;
    etaList.appendChild(div);
  });
}

function updateSidebarAlerts() {
  const alertList = document.getElementById("alertSidebar");
  if (!alertList) return;
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
    let extraInfo = "";
    if (userMarker) {
      const userPos = userMarker.getLatLng();
      const { distance, eta } = computeETA(userPos.lat, userPos.lng, vehicle.lat, vehicle.lon);
      extraInfo = ` is ${distance} m away (~${eta} min walk)`;
    }
    const div = document.createElement("div");
    div.innerHTML = `
      <img src="${iconMap[vehicle.mode] || iconMap["Podapoda"]}" 
           alt="${vehicle.mode}" 
           style="width:18px; height:18px; vertical-align:middle; margin-right:6px;">
      ${vehicle.mode} (ID: ${vehicle.id})${extraInfo}
    `;
    alertList.appendChild(div);
  });
}

function initFilters() {
  const filterContainer = document.querySelector(".sidebar-filter-container");
  if (!filterContainer) return;

  const modes = Object.keys(iconMap);

  filterContainer.innerHTML = "";
  modes.forEach(mode => {
    const id = `filter-${mode.replace(/\s+/g, "-")}`;
    const label = document.createElement("label");
    label.style.display = "block";
    label.style.marginBottom = "0.3rem";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = id;
    checkbox.name = "modeFilter";
    checkbox.value = mode;
    checkbox.checked = true;
    checkbox.addEventListener("change", applyFilters);

    label.appendChild(checkbox);
    label.append(` ${mode}`);
    filterContainer.appendChild(label);
  });
}

function applyFilters() {
  const checkedModes = Array.from(document.querySelectorAll('input[name="modeFilter"]:checked'))
    .map(cb => cb.value);

  Object.entries(vehicleMarkers).forEach(([id, marker]) => {
    const vehicle = vehiclesData.find(v => v.id === id);
    if (!vehicle) {
      marker.remove();
      delete vehicleMarkers[id];
      return;
    }
    if (checkedModes.includes(vehicle.mode)) {
      if (!map.hasLayer(marker)) map.addLayer(marker);
    } else {
      if (map.hasLayer(marker)) map.removeLayer(marker);
    }
  });
}

function clearVehicles() {
  Object.values(vehicleMarkers).forEach(marker => {
    if (map.hasLayer(marker)) map.removeLayer(marker);
  });
  vehicleMarkers = {};
  vehiclesData = [];
  updateSidebarETAs();
  updateSidebarAlerts();
}

function startTracking(vehicleId, transportMode) {
  console.log(`Starting tracking for ${vehicleId} (${transportMode})`);
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
        const marker = L.marker([data.lat, data.lon], { icon })
          .bindPopup(popupContent)
          .addTo(map);
        vehicleMarkers[vehicleId] = marker;
      }
      map.setView([data.lat, data.lon], 15);
    } catch (err) {
      console.error("Tracking error:", err);
    }
  };

  updateTrackedVehicle();
  trackingInterval = setInterval(updateTrackedVehicle, 5000);
  trackingTimeout = setTimeout(stopTracking, 5 * 60 * 1000); // auto stop after 5 min
}

function stopTracking() {
  clearInterval(trackingInterval);
  clearTimeout(trackingTimeout);
  console.log("Tracking stopped");
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
  initFilters();

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
      const modal = document.getElementById("trackingModal");
      if (modal) {
        modal.style.display = "none";
        modal.setAttribute("aria-hidden", "true");
      }
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  if (promptLogin()) {
    initMap();
  }
});
