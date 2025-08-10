function promptLogin() {
  const username = prompt("Enter username:");
  const password = prompt("Enter password:");

  const VALID_USERNAME = "admin";
  const VALID_PASSWORD = "mypassword";

  if (username !== VALID_USERNAME || password !== VALID_PASSWORD) {
    alert("Access denied");
    document.body.innerHTML = "<h2 style='text-align:center; padding: 2rem;'>Access Denied</h2>";
    return false;
  }
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
        const mode = feature.properties.mode?.toLowerCase() || "podapoda";
        const iconUrl = iconMap[mode] || iconMap["podapoda"];
        return L.marker(latlng, {
          icon: L.icon({
            iconUrl,
            iconSize: [25, 25],
            iconAnchor: [12, 24],
            popupAnchor: [0, -24]
          })
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
  const key = mode?.toLowerCase() || "podapoda";
  return L.icon({
    iconUrl: iconMap[key],
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

  if (!userMarker || vehiclesData.length === 0) {
    etaList.innerHTML = "<p>No data available.</p>";
    return;
  }

  const userPos = userMarker.getLatLng();
  vehiclesData.forEach(v => {
    const { distance, eta } = computeETA(userPos.lat, userPos.lng, v.lat, v.lon);
    const div = document.createElement("div");
    div.textContent = `${capitalize(v.mode)} (ID: ${v.id}) — ${distance} m, ETA ~${eta} min`;
    etaList.appendChild(div);
  });
}

function updateSidebarAlerts() {
  const alertList = document.getElementById("alertSidebar");
  if (!alertList) return;
  alertList.innerHTML = "";

  if (!userMarker) {
    alertList.innerHTML = "<p>No location available.</p>";
    return;
  }

  const userPos = userMarker.getLatLng();
  const nearbyVehicles = vehiclesData.filter(v => {
    const { distance } = computeETA(userPos.lat, userPos.lng, v.lat, v.lon);
    return distance <= 500;
  });

  if (nearbyVehicles.length === 0) {
    alertList.innerHTML = "<p>No nearby vehicles within 500m.</p>";
    return;
  }

  nearbyVehicles.forEach(vehicle => {
    const { distance, eta } = computeETA(userPos.lat, userPos.lng, vehicle.lat, vehicle.lon);
    const div = document.createElement("div");
    div.textContent = `${capitalize(vehicle.mode)} (ID: ${vehicle.id}) is ${distance} m away (~${eta} min walk)`;
    alertList.appendChild(div);
  });
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

  filterContainer.innerHTML = ""; // Clear existing filters

  modes.forEach(mode => {
    const id = `filter-${mode.replace(/\s+/g, "-").toLowerCase()}`;
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
    .map(cb => cb.value.toLowerCase());

  Object.entries(vehicleMarkers).forEach(([id, marker]) => {
    const vehicle = vehiclesData.find(v => v.id === id);
    if (!vehicle) {
      marker.remove();
      delete vehicleMarkers[id];
      return;
    }
    if (checkedModes.includes(vehicle.mode.toLowerCase())) {
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

function setupModal() {
  const modal = document.getElementById("trackingModal");
  const trigger = document.querySelector(".modal-trigger");
  const closeBtn = document.querySelector(".modal-close");

  if (!modal || !trigger || !closeBtn) {
    console.warn("Modal elements missing, skipping modal setup.");
    return;
  }

  function openModal() {
    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");
    modal.inert = false;
    trigger.setAttribute("aria-expanded", "true");

    // Focus modal for accessibility
    closeBtn.focus();
  }

  function closeModal() {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    modal.inert = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.focus();
  }

  trigger.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);

  // Close modal on outside click
  modal.addEventListener("click", e => {
    if (e.target === modal) closeModal();
  });

  // Close modal on Escape key
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && modal.style.display === "block") {
      closeModal();
    }
  });

  // Handle form submit inside modal
  const form = document.getElementById("trackingForm");
  form.addEventListener("submit", e => {
    e.preventDefault();

    const vehicleId = form.vehicleId.value.trim();
    const mode = form.mode.value;

    if (!vehicleId || !mode) {
      alert("Please fill out all fields.");
      return;
    }

    alert(`Tracking started for Vehicle ID: ${vehicleId} (${mode})`);
    closeModal();

    // TODO: Add your tracking logic here
  });
}

function setupEventListeners() {
  const clearBtn = document.getElementById("clearVehiclesBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearVehicles);
  }
}

function initMap() {
  map = L.map("map").setView([8.4844, -13.2344], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  routeLayers.addTo(map);
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!promptLogin()) return;

  initMap();
  addLocateMeButton();
  initFilters();
  setupModal();
  setupEventListeners();

  await loadRoutes();
  await loadStops();

  await fetchVehicles();
  setInterval(fetchVehicles, 30 * 1000);
});
