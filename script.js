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

async function startApp() {
  const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
  let map, userMarker = null;
  let vehicleMarkers = {};
  let vehiclesData = [];
  let routeLayers = L.featureGroup();
  let stopsLayer;
  let nearbyStopCircles = [];

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

    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    const walkingSpeed = 1.4; // meters per second

    return { distance: Math.round(distance), eta: Math.round(distance / walkingSpeed / 60) };
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
        (position) => {
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
          updateUserVehicleETAs();
          updateSidebarAlerts();
          updateSidebarETAs();
        },
        (error) => {
          alert("Unable to retrieve your location.");
          console.error("Geolocation error:", error);
        }
      );
    });
  }

  async function loadRoutes() {
    try {
      const res = await fetch("data/routes.geojson");
      if (!res.ok) throw new Error("Failed to load routes.geojson");
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
      console.error("Error loading routes:", err);
      alert("Could not load route data.");
    }
  }

  async function loadStops() {
    try {
      const res = await fetch("data/stops.geojson");
      if (!res.ok) throw new Error("Failed to load stops.geojson");
      const geojson = await res.json();

      if (stopsLayer) stopsLayer.clearLayers();

      stopsLayer = L.geoJSON(geojson, {
        pointToLayer: (feature, latlng) => {
          const mode = feature.properties.mode ? feature.properties.mode.toLowerCase() : "default";
          const iconUrl = iconMap[mode] || "https://cdn-icons-png.flaticon.com/512/252/252025.png";
          const stopIcon = L.icon({
            iconUrl,
            iconSize: [25, 25],
            iconAnchor: [12, 24],
            popupAnchor: [0, -24]
          });
          return L.marker(latlng, { icon: stopIcon });
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties && feature.properties.name) {
            layer.bindPopup(`<strong>Stop:</strong> ${feature.properties.name}`);
          }
        }
      }).addTo(map);
    } catch (err) {
      console.error("Error loading stops:", err);
      alert("Could not load stops data.");
    }
  }

  function initFilters() {
    const filterContainer = document.getElementById("filterPanel");
    if (!filterContainer) return;

    filterContainer.innerHTML = "";
    const modes = ["Podapoda", "Taxi", "Keke", "Paratransit Bus", "Waka Fine Bus", "Motorbike"];
    modes.forEach(mode => {
      const div = document.createElement("div");
      div.className = "filter-option";
      div.innerHTML = `
        <label>
          <input type="checkbox" value="${mode.toLowerCase()}" checked />
          ${mode}
        </label>
      `;
      filterContainer.appendChild(div);
    });

    filterContainer.querySelectorAll("input[type=checkbox]").forEach(input => {
      input.addEventListener("change", () => {
        applyFilters();
      });
    });
  }

  function applyFilters() {
    const filterContainer = document.getElementById("filterPanel");
    if (!filterContainer) return;

    // Get all checked modes
    const checkedModes = Array.from(filterContainer.querySelectorAll("input[type=checkbox]:checked"))
      .map(input => input.value);

    // Filter vehicle markers
    for (const [id, marker] of Object.entries(vehicleMarkers)) {
      const vehicle = vehiclesData.find(v => v.id === id);
      if (!vehicle) continue;
      if (checkedModes.includes(vehicle.mode.toLowerCase())) {
        if (!map.hasLayer(marker)) map.addLayer(marker);
      } else {
        if (map.hasLayer(marker)) map.removeLayer(marker);
      }
    }

    // Filter stops layer
    if (!stopsLayer) return;
    stopsLayer.eachLayer(layer => {
      const mode = (layer.feature.properties.mode || "").toLowerCase();
      if (checkedModes.includes(mode)) {
        if (!map.hasLayer(layer)) map.addLayer(layer);
      } else {
        if (map.hasLayer(layer)) map.removeLayer(layer);
      }
    });
  }

  function getIcon(mode) {
    if (!mode) return null;
    const key = mode.toLowerCase();
    return L.icon({
      iconUrl: iconMap[key] || iconMap["podapoda"],
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

      // Backend sends object keyed by vehicle IDs, convert to array
      vehiclesData = Object.entries(data).map(([id, info]) => ({
        id,
        lat: info.lat,
        lon: info.lon,
        mode: info.mode || "unknown",
        eta_min: info.eta_min || null
      }));

      // Update or add vehicle markers
      vehiclesData.forEach(vehicle => {
        if (!vehicle.id || !vehicle.lat || !vehicle.lon) return;
        const { id, lat, lon, mode } = vehicle;
        const icon = getIcon(mode);

        let popupContent = `Vehicle ID: ${id}<br>Mode: ${mode}`;
        if (userMarker) {
          const userPos = userMarker.getLatLng();
          const { distance, eta } = computeETA(userPos.lat, userPos.lng, lat, lon);
          popupContent += `<br>Distance to you: ${distance} meters<br>ETA (walking): ${eta} minutes`;
        }

        if (vehicleMarkers[id]) {
          vehicleMarkers[id].setLatLng([lat, lon]);
          vehicleMarkers[id].setIcon(icon);
          vehicleMarkers[id].setPopupContent(popupContent);
        } else {
          vehicleMarkers[id] = L.marker([lat, lon], { icon }).addTo(map);
          vehicleMarkers[id].bindPopup(popupContent);
        }
      });

      applyFilters(); // Apply filter after update to sync visibility

      updateSidebarAlerts();
      updateSidebarETAs();

      const lastUpdatedEl = document.getElementById("lastUpdated");
      if (lastUpdatedEl) {
        lastUpdatedEl.textContent = new Date().toLocaleTimeString();
      }
    } catch (err) {
      console.error("Error fetching vehicles:", err);
    }
  }

  function updateUserVehicleETAs() {
    if (!userMarker) return;
    const userPos = userMarker.getLatLng();

    vehiclesData.forEach(vehicle => {
      if (!vehicle.id || !vehicle.lat || !vehicle.lon) return;
      const { distance, eta } = computeETA(userPos.lat, userPos.lng, vehicle.lat, vehicle.lon);
      const marker = vehicleMarkers[vehicle.id];
      if (marker) {
        const popupContent = `Vehicle ID: ${vehicle.id}<br>Mode: ${vehicle.mode}<br>Distance to you: ${distance} meters<br>ETA (walking): ${eta} minutes`;
        marker.setPopupContent(popupContent);
      }
    });
  }

  function updateSidebarAlerts() {
    const alertListEl = document.getElementById("alert-list");
    if (!alertListEl) return;
    alertListEl.innerHTML = "";

    if (!userMarker) {
      alertListEl.innerHTML = "<p>No location set.</p>";
      return;
    }

    const userPos = userMarker.getLatLng();
    // Show only vehicles within 500m (updated from 2000m)
    const nearbyVehicles = vehiclesData.filter(v => {
      const dist = computeETA(userPos.lat, userPos.lng, v.lat, v.lon).distance;
      return dist <= 500;
    });

    if (nearbyVehicles.length === 0) {
      alertListEl.innerHTML = "<p>No vehicles nearby within 500m.</p>";
      return;
    }

    nearbyVehicles.forEach(vehicle => {
      const { distance, eta } = computeETA(userPos.lat, userPos.lng, vehicle.lat, vehicle.lon);
      const div = document.createElement("div");
      div.textContent = `${capitalize(vehicle.mode)} (ID: ${vehicle.id}) is ${distance} m away (~${eta} min walk)`;
      alertListEl.appendChild(div);
    });
  }

  function updateSidebarETAs() {
    const etaListEl = document.getElementById("eta-list");
    if (!etaListEl) return;
    etaListEl.innerHTML = "";

    if (!userMarker) {
      etaListEl.innerHTML = "<p>No location set.</p>";
      return;
    }

    if (vehiclesData.length === 0) {
      etaListEl.innerHTML = "<p>No vehicle data available.</p>";
      return;
    }

    const userPos = userMarker.getLatLng();

    vehiclesData.forEach(vehicle => {
      const { distance, eta } = computeETA(userPos.lat, userPos.lng, vehicle.lat, vehicle.lon);
      const div = document.createElement("div");
      div.textContent = `${capitalize(vehicle.mode)} (ID: ${vehicle.id}) — ${distance} m, ETA ~${eta} min`;
      etaListEl.appendChild(div);
    });
  }

  function capitalize(str) {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function setupMap() {
    map = L.map("map").setView([8.4912, -13.2345], 14);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap"
    }).addTo(map);

    routeLayers.addTo(map);
  }

  if (!promptLogin()) return;

  setupMap();
  addLocateMeButton();
  loadRoutes();
  loadStops();
  initFilters();

  fetchVehicles();
  setInterval(fetchVehicles, 30000);
}
