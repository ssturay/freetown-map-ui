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

    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    const walkingSpeed = 1.4;

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

      if (stopsLayer) {
        stopsLayer.clearLayers();
      }

      stopsLayer = L.geoJSON(geojson, {
        pointToLayer: (feature, latlng) => {
          const mode = feature.properties.mode ? feature.properties.mode.toLowerCase() : "default";
          let iconUrl = iconMap[mode] || "https://cdn-icons-png.flaticon.com/512/252/252025.png";
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
    // Example filter: populate availableModes from stops or routes and create UI filters
    // Here you might want to dynamically generate filters based on data
    // This is a placeholder example
    const filterContainer = document.querySelector(".sidebar-filter-container");
    if (!filterContainer) return;

    // Clear existing filters
    filterContainer.innerHTML = "";

    // Example: checkbox filter for transport modes (hardcoded for now)
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

    // Add event listeners for filtering (you'll need to implement filtering logic)
    filterContainer.querySelectorAll("input[type=checkbox]").forEach(input => {
      input.addEventListener("change", () => {
        applyFilters();
      });
    });
  }

  function applyFilters() {
    // TODO: implement filtering logic for vehicleMarkers and stopsLayer based on checked modes
    // For now, this is a stub to demonstrate where filtering would happen
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

      console.log("Raw vehicle data:", data);

      let vehiclesArray = [];

if (Array.isArray(data)) {
  vehiclesArray = data;
} else if (data.vehicles && Array.isArray(data.vehicles)) {
  vehiclesArray = data.vehicles;
} else if (Object.keys(data).length === 0) {
  console.warn("No vehicle data received from backend.");
  return;
} else {
  throw new Error("Vehicle data format unrecognized");
}


      vehiclesData = vehiclesArray;

      // Update or add vehicle markers
      vehiclesArray.forEach(vehicle => {
        if (!vehicle.id || !vehicle.lat || !vehicle.lon) return; // skip invalid entries

        const { id, lat, lon, mode } = vehicle;
        const icon = getIcon(mode);

        if (vehicleMarkers[id]) {
          vehicleMarkers[id].setLatLng([lat, lon]);
          vehicleMarkers[id].setIcon(icon);
        } else {
          vehicleMarkers[id] = L.marker([lat, lon], { icon }).addTo(map);
          vehicleMarkers[id].bindPopup(`Vehicle ID: ${id}<br>Mode: ${mode}`);
        }
      });

      updateUserVehicleETAs();
      updateSidebarAlerts();

      document.getElementById("lastUpdated").textContent = new Date().toLocaleTimeString();
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
        marker.bindPopup(`
          Vehicle ID: ${vehicle.id}<br>
          Mode: ${vehicle.mode}<br>
          Distance: ${distance} meters<br>
          ETA (walking): ${eta} minutes
        `);
      }
    });
  }

  function updateSidebarAlerts() {
    const alertSidebar = document.getElementById("alertSidebar");
    if (!alertSidebar) return;

    // Clear alerts
    alertSidebar.innerHTML = "";

    // Example: show vehicles within 500 meters
    if (!userMarker) return;

    const userPos = userMarker.getLatLng();

    vehiclesData.forEach(vehicle => {
      if (!vehicle.id || !vehicle.lat || !vehicle.lon) return;

      const { distance, eta } = computeETA(userPos.lat, userPos.lng, vehicle.lat, vehicle.lon);

      if (distance <= 500) {
        const alertDiv = document.createElement("div");
        alertDiv.className = "alert-item";
        alertDiv.innerHTML = `
          <strong>Vehicle ID:</strong> ${vehicle.id} <br>
          <strong>Mode:</strong> ${vehicle.mode} <br>
          <strong>Distance:</strong> ${distance} meters <br>
          <strong>ETA:</strong> ${eta} minutes (walking)
        `;
        alertSidebar.appendChild(alertDiv);
      }
    });
  }

  function showUserLocationAndNearbyStops() {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(position => {
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

      // Find and circle nearby stops within 500m
      if (!stopsLayer) return;

      // Clear old circles
      nearbyStopCircles.forEach(circle => map.removeLayer(circle));
      nearbyStopCircles = [];

      stopsLayer.eachLayer(stopMarker => {
        const stopPos = stopMarker.getLatLng();
        const dist = map.distance([lat, lon], stopPos);
        if (dist <= 500) {
          const circle = L.circle(stopPos, {
            radius: 100,
            color: 'blue',
            fillColor: '#30f',
            fillOpacity: 0.3
          }).addTo(map);
          nearbyStopCircles.push(circle);
        }
      });
    }, error => {
      console.error("Could not get user location:", error);
    });
  }

  window.addEventListener("load", async () => {
    map = L.map("map").setView([8.48, -13.23], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors"
    }).addTo(map);

    setTimeout(() => map.invalidateSize(), 100);

    addLocateMeButton();
    await loadRoutes();
    await loadStops();
    initFilters();

    fetchVehicles();
    setInterval(fetchVehicles, 10000);
    showUserLocationAndNearbyStops();
  });

  // --- Collapsible Panel Support ---
  document.addEventListener("DOMContentLoaded", () => {
    const collapsibles = document.querySelectorAll(".collapsible");

    collapsibles.forEach(btn => {
      const content = btn.nextElementSibling;

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

  // --- Modal Handling ---
  document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("trackingModal");
    const openBtn = document.getElementById("openTrackingModal");
    const closeBtn = document.getElementById("closeTrackingModal");

    if (openBtn) {
      openBtn.onclick = () => {
        modal.style.display = "block";
      };
    }

    if (closeBtn) {
      closeBtn.onclick = () => {
        modal.style.display = "none";
      };
    }

    window.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
      }
    };

    const trackingForm = document.getElementById("trackingForm");
    if (trackingForm) {
      trackingForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const vehicleId = document.getElementById("vehicleId").value.trim();
        const mode = document.getElementById("mode").value;

        if (!vehicleId || !mode) {
          alert("Please complete all fields.");
          return;
        }

        if (!navigator.geolocation) {
          alert("Geolocation not supported.");
          return;
        }

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
    }
  });
}

// Start app only if login passes
if (promptLogin()) {
  startApp();
}
