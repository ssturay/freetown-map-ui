function promptLogin() {
  const username = prompt("Enter username:");
  const password = prompt("Enter password:");

  const VALID_USERNAME = "admin";
  const VALID_PASSWORD = "mypassword";

  if (username !== VALID_USERNAME || password !== VALID_PASSWORD) {
    alert("Access denied");
    // Stop script execution
    document.body.innerHTML = "<h2 style='text-align:center; padding: 2rem;'>Access Denied</h2>";
    throw new Error("Unauthorized access");
  }
}

promptLogin();


const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, userMarker = null;
let vehicleMarkers = {};
let vehiclesData = {};
let routeLayers = L.featureGroup();
let stopsLayer;
let availableModes = new Set();
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

  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  const walkingSpeed = 1.4;

  return { distance: Math.round(distance), eta: Math.round(distance / walkingSpeed / 60) };
}

window.addEventListener("load", async () => {
  map = L.map("map").setView([8.48, -13.23], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 100);

  addLocateMeButton();
  await loadRoutes();
  initFilters();
  await loadStops();
  fetchVehicles();
  setInterval(fetchVehicles, 10000);
  showUserLocationAndNearbyStops();
});

async function loadRoutes() {
  const base = window.location.hostname.includes("github.io") ? "/freetown-map-ui" : "";
  const res = await fetch(`${base}/data/routes.geojson`);
  const data = await res.json();

  data.features.forEach(f => {
    if (f.properties?.mode) availableModes.add(f.properties.mode);
  });

  L.geoJSON(data, {
    style: f => ({ color: f.properties.color, weight: 4 }),
    onEachFeature: (f, layer) => {
      layer.bindPopup(`<strong>${f.properties.name}</strong><br><small>${f.properties.mode}</small>`);
      layer.properties = f.properties;
      routeLayers.addLayer(layer);
    }
  }).addTo(map);
}

async function loadStops() {
  const base = window.location.hostname.includes("github.io") ? "/freetown-map-ui" : "";
  const res = await fetch(`${base}/data/stops.geojson`);
  const data = await res.json();

  stopsLayer = L.geoJSON(data, {
    pointToLayer: (_, ll) => L.circleMarker(ll, {
      radius: 6, fillColor: "#000", color: "#fff", weight: 1, fillOpacity: 0.9
    }),
    onEachFeature: (feature, layer) => {
      layer.bindPopup(`Loading arrivals...`);
    }
  }).addTo(map);
}

function initFilters() {
  const container = L.control({ position: 'topright' });

  container.onAdd = () => {
    const div = L.DomUtil.create('div', 'filter-panel');
    div.innerHTML = `<h4>Filter Modes</h4>`;

    Array.from(availableModes).sort().forEach(mode => {
      const key = mode.trim().toLowerCase();
      const iconUrl = iconMap[key] || "";
      div.innerHTML += `
        <label>
          <input type="checkbox" value="${mode}" checked>
          <img src="${iconUrl}" alt="${mode}" style="width: 18px; vertical-align: middle; margin-right: 6px;">
          ${mode}
        </label><br>`;
    });

    div.onmousedown = div.ondblclick = L.DomEvent.stopPropagation;
    return div;
  };

  container.addTo(map);

  setTimeout(() => {
    const filterPanel = document.querySelector('.filter-panel');
    const sidebarContainer = document.querySelector('.sidebar-filter-container');
    if (filterPanel && sidebarContainer && !sidebarContainer.contains(filterPanel)) {
      sidebarContainer.appendChild(filterPanel);
    }

    document.querySelectorAll('.filter-panel input').forEach(inp => {
      inp.addEventListener('change', applyFilters);
    });
  }, 0);
}

function applyFilters() {
  const selected = Array.from(document.querySelectorAll('.filter-panel input:checked')).map(i => i.value);

  routeLayers.eachLayer(layer => {
    selected.includes(layer.properties.mode) ? map.addLayer(layer) : map.removeLayer(layer);
  });

  Object.values(vehicleMarkers).forEach(marker => {
    selected.includes(marker.mode) ? map.addLayer(marker) : map.removeLayer(marker);
  });
}

function getIcon(mode) {
  const key = (mode || "unknown").trim().toLowerCase();
  const iconUrl = iconMap[key] || "https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png";

  return L.icon({
    iconUrl, iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -28],
    shadowUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png",
    shadowSize: [41, 41], shadowAnchor: [14, 41]
  });
}

async function fetchVehicles() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    const data = await res.json();

    vehiclesData = data;
    document.getElementById("lastUpdated").innerText = new Date().toLocaleTimeString();

    for (const [id, info] of Object.entries(data)) {
      const { lat, lon, mode } = info;
      const icon = getIcon(mode);

      if (vehicleMarkers[id]) {
        vehicleMarkers[id].setLatLng([lat, lon])
          .setPopupContent(`🚐 <b>${id}</b>`);
      } else {
        const m = L.marker([lat, lon], { icon }).addTo(map)
          .bindPopup(`🚐 <b>${id}</b>`);
        m.mode = mode;
        vehicleMarkers[id] = m;
      }
    }

    updateUserVehicleETAs();
    updateStopPopups();
    updateSidebarAlerts();

  } catch (error) {
    console.error("Error fetching vehicle data:", error);
  }
}

function updateSidebarAlerts() {
  const sidebar = document.getElementById("alertSidebar");
  if (!sidebar) return;

  const arrivingSoon = Object.entries(vehiclesData).filter(([_, v]) => v.eta_min < 5);
  sidebar.innerHTML = "<h3>Alerts</h3>";

  if (arrivingSoon.length === 0) {
    sidebar.innerHTML += "<p>No vehicles arriving within 5 minutes.</p>";
    return;
  }

  arrivingSoon.forEach(([id, v]) => {
    sidebar.innerHTML += `<p><strong>${v.mode}</strong> #${id} arriving soon.</p>`;
  });
}

function updateUserVehicleETAs() {
  const sidebar = document.getElementById("etaSidebar");
  if (!sidebar) return;

  if (!userMarker) {
    sidebar.innerHTML = `<h3>Closest Vehicles (ETA)</h3><p>User location not available.</p>`;
    return;
  }

  const userLatLng = userMarker.getLatLng();
  const rows = [];

  for (const [id, v] of Object.entries(vehiclesData)) {
    const { eta, distance } = computeETA(userLatLng.lat, userLatLng.lng, v.lat, v.lon);
    rows.push({ id, mode: v.mode, eta, distance, iconUrl: getIcon(v.mode).options.iconUrl });
  }

  rows.sort((a, b) => a.eta - b.eta);

  sidebar.innerHTML = `<h3>Closest Vehicles (ETA)</h3>`;
  if (rows.length === 0) {
    sidebar.innerHTML += `<p>No vehicles to show.</p>`;
    return;
  }

  rows.slice(0, 5).forEach(r => {
    sidebar.innerHTML += `
      <div style="margin-bottom: 8px;">
        <img src="${r.iconUrl}" style="width: 20px; vertical-align: middle; margin-right: 8px;">
        <strong>${r.mode}</strong> #${r.id}<br>
        ETA: ${r.eta} min — ${r.distance} m
      </div>`;
  });
}

function updateStopPopups() {
  if (!stopsLayer) return;

  stopsLayer.eachLayer(stopLayer => {
    const stopLatLng = stopLayer.getLatLng();
    const nearbyVehicles = [];

    for (const [id, v] of Object.entries(vehiclesData)) {
      const vehicleLatLng = L.latLng(v.lat, v.lon);
      if (stopLatLng.distanceTo(vehicleLatLng) < 300) {
        nearbyVehicles.push({ id, mode: v.mode });
      }
    }

    if (nearbyVehicles.length === 0) {
      stopLayer.setPopupContent(`<strong>${stopLayer.feature.properties.name}</strong><br>No vehicles nearby.`);
    } else {
      const listHtml = nearbyVehicles.map(v =>
        `<li><img src="${getIcon(v.mode).options.iconUrl}" style="width:16px; vertical-align:middle; margin-right:4px;">` +
        `<b>${v.mode}</b> #${v.id}</li>`).join("");
      stopLayer.setPopupContent(
        `<strong>${stopLayer.feature.properties.name}</strong><br><ul style="padding-left:16px; margin:4px 0;">${listHtml}</ul>`
      );
    }
  });
}

function showUserLocationAndNearbyStops() {
  if (!navigator.geolocation) {
    alert("Geolocation not supported by your browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(position => {
    const { latitude, longitude } = position.coords;
    const userLatLng = L.latLng(latitude, longitude);

    if (userMarker) {
      userMarker.setLatLng(userLatLng);
    } else {
      userMarker = L.circleMarker(userLatLng, {
        radius: 8, fillColor: "#3388ff", color: "#fff", weight: 2, fillOpacity: 0.9
      }).addTo(map).bindPopup("📍 You are here").openPopup();
    }

    map.setView(userLatLng, 15);
    nearbyStopCircles.forEach(c => map.removeLayer(c));
    nearbyStopCircles = [];

    if (stopsLayer) {
      stopsLayer.eachLayer(stopLayer => {
        const stopLatLng = stopLayer.getLatLng();
        if (userLatLng.distanceTo(stopLatLng) < 300) {
          const circle = L.circle(stopLatLng, {
            radius: 300, color: "#3388ff", weight: 2, fillOpacity: 0.1
          }).addTo(map);
          nearbyStopCircles.push(circle);
        }
      });
    }

    updateUserVehicleETAs();
  }, () => {
    alert("Unable to retrieve your location.");
  });
}

function addLocateMeButton() {
  const locateControl = L.control({ position: "topleft" });
  locateControl.onAdd = () => {
    const btn = L.DomUtil.create("button", "leaflet-bar leaflet-control leaflet-control-custom");
    btn.title = "Locate Me";
    btn.innerHTML = "📍";
    btn.style.backgroundColor = "#fff";
    btn.style.width = "34px";
    btn.style.height = "34px";
    btn.style.cursor = "pointer";

    btn.onclick = () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
          const latlng = [pos.coords.latitude, pos.coords.longitude];
          map.setView(latlng, 16);
          if (userMarker) {
            userMarker.setLatLng(latlng).openPopup();
          } else {
            userMarker = L.circleMarker(latlng, {
              radius: 8, fillColor: "#3388ff", color: "#fff", weight: 2, fillOpacity: 0.9
            }).addTo(map).bindPopup("📍 You are here").openPopup();
          }
          updateUserVehicleETAs();
        }, () => alert("Unable to get your location."));
      } else {
        alert("Geolocation is not supported by your browser.");
      }
    };

    return btn;
  };
  locateControl.addTo(map);
}


// === Collapsible Panel Support ===
document.addEventListener("DOMContentLoaded", () => {
  const collapsibles = document.querySelectorAll(".collapsible");

  collapsibles.forEach(btn => {
    const content = btn.nextElementSibling;

    // Initial state: collapsed on small screens, expanded otherwise
    if (window.innerWidth <= 768) {
      content.style.maxHeight = null;
      content.style.display = "none";
    } else {
      content.style.maxHeight = content.scrollHeight + "px";
      content.style.display = "block";
    }

    btn.addEventListener("click", () => {
      const isVisible = content.style.display === "block";

      if (isVisible) {
        content.style.display = "none";
        content.style.maxHeight = null;
      } else {
        content.style.display = "block";
        content.style.maxHeight = content.scrollHeight + "px";
      }
    });
  });
});

document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("trackingModal");
  const openBtn = document.getElementById("openTrackingModal");
  const closeBtn = document.getElementById("closeTrackingModal");

  // Open modal
  openBtn.onclick = () => {
    modal.style.display = "block";
  };

  // Close modal on (x)
  closeBtn.onclick = () => {
    modal.style.display = "none";
  };

  // Close modal on outside click
  window.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
    }
  };

  // Submit tracking form
  document.getElementById("trackingForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const vehicleId = document.getElementById("vehicleId").value.trim();
    const mode = document.getElementById("mode").value;

    if (!vehicleId || !mode) return alert("Please complete all fields.");

    // Get current geolocation
    if (!navigator.geolocation) return alert("Geolocation not supported.");

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      try {
        const url = `${BACKEND_URL}/api/location/update?id=${encodeURIComponent(vehicleId)}&lat=${lat}&lon=${lon}&mode=${encodeURIComponent(mode)}`;
        const res = await fetch(url);
        if (res.ok) {
          alert("Tracking started successfully!");
          modal.style.display = "none";
        } else {
          alert("Failed to start tracking.");
        }
      } catch (err) {
        console.error(err);
        alert("Error starting tracking.");
      }
    }, () => {
      alert("Could not get your location.");
    });
  });
});
