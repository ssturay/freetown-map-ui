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
  let stopsLayer = L.featureGroup();
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

    const a = Math.sin(Δφ / 2) ** 2 +
              Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    const walkingSpeed = 1.4; // meters per second

    return { distance: Math.round(distance), eta: Math.round(distance / walkingSpeed / 60) };
  }

  async function loadRoutes() {
    try {
      const response = await fetch("routes.geojson");
      if (!response.ok) throw new Error("Failed to load routes.geojson");
      const geojson = await response.json();

      routeLayers.clearLayers();

      L.geoJSON(geojson, {
        style: feature => ({
          color: feature.properties.color || "#3388ff",
          weight: 4,
          opacity: 0.7
        }),
        onEachFeature: (feature, layer) => {
          if (feature.properties && feature.properties.name) {
            layer.bindPopup(`<strong>Route:</strong> ${feature.properties.name}`);
          }
        }
      }).addTo(routeLayers);

      routeLayers.addTo(map);
    } catch (err) {
      console.error("Error loading routes:", err);
    }
  }

  async function loadStops() {
    try {
      const response = await fetch("stops.geojson");
      if (!response.ok) throw new Error("Failed to load stops.geojson");
      const geojson = await response.json();

      stopsLayer.clearLayers();

      L.geoJSON(geojson, {
        pointToLayer: (feature, latlng) => {
          return L.circleMarker(latlng, {
            radius: 6,
            fillColor: "#007bff",
            color: "#fff",
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
          });
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties && feature.properties.name) {
            layer.bindPopup(`<strong>Stop:</strong> ${feature.properties.name}`);
          }
        }
      }).addTo(stopsLayer);

      stopsLayer.addTo(map);
    } catch (err) {
      console.error("Error loading stops:", err);
    }
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

  async function fetchVehicles() {
    try {
      const response = await fetch(`${BACKEND_URL}/api/vehicles`);
      if (!response.ok) throw new Error("Failed to fetch vehicles");
      vehiclesData = await response.json();

      // Clear old markers
      Object.values(vehicleMarkers).forEach(marker => map.removeLayer(marker));
      vehicleMarkers = {};

      vehiclesData.forEach(vehicle => {
        const { id, lat, lon, mode } = vehicle;
        const iconUrl = iconMap[mode.toLowerCase()] || iconMap["podapoda"];

        const icon = L.icon({
          iconUrl,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });

        const marker = L.marker([lat, lon], { icon, title: `${mode} (${id})` });
        marker.addTo(map);

        marker.bindPopup(`<strong>ID:</strong> ${id}<br/><strong>Mode:</strong> ${mode}`);

        vehicleMarkers[id] = marker;
        availableModes.add(mode);
      });

      document.getElementById("lastUpdated").textContent = new Date().toLocaleTimeString();
    } catch (err) {
      console.error("Error fetching vehicles:", err);
    }
  }

  function initFilters() {
    // Placeholder for filter panel init logic
    // Implement if you want mode-based filtering, etc.
  }

  function showUserLocationAndNearbyStops() {
    if (!navigator.geolocation) {
      console.warn("Geolocation not supported");
      return;
    }

    navigator.geolocation.getCurrentPosition((pos) => {
      const userLat = pos.coords.latitude;
      const userLon = pos.coords.longitude;

      if (userMarker) {
        userMarker.setLatLng([userLat, userLon]);
      } else {
        userMarker = L.marker([userLat, userLon], {
          title: "You are here",
          icon: L.icon({
            iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
            iconSize: [25, 25]
          })
        }).addTo(map);
      }

      map.setView([userLat, userLon], 15);

      // Clear previous circles
      nearbyStopCircles.forEach(circle => map.removeLayer(circle));
      nearbyStopCircles = [];

      stopsLayer.eachLayer(stopMarker => {
        const stopLatLng = stopMarker.getLatLng();
        const { distance, eta } = computeETA(userLat, userLon, stopLatLng.lat, stopLatLng.lng);

        if (distance <= 1000) { // within 1 km
          const circle = L.circle(stopLatLng, {
            radius: distance,
            color: 'green',
            fillOpacity: 0.1
          }).addTo(map);

          nearbyStopCircles.push(circle);
        }
      });
    });
  }

  // Initialize map and layers on window load
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

    await fetchVehicles();
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

  // Clear vehicles button support
  const clearBtn = document.getElementById("clearVehiclesBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      Object.values(vehicleMarkers).forEach(marker => map.removeLayer(marker));
      vehicleMarkers = {};
      availableModes.clear();
      document.getElementById("lastUpdated").textContent = "--";
    });
  }
}

// Start app only if login passes
if (promptLogin()) {
  startApp();
}
