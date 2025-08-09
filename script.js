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

  const iconMap = {
    "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
    "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
    "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
    "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
    "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
    "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
  };

  function computeETA(userLat, userLon, vehicleLat, vehicleLon) {
    const R = 6371e3; // meters
    const φ1 = userLat * Math.PI / 180;
    const φ2 = vehicleLat * Math.PI / 180;
    const Δφ = (vehicleLat - userLat) * Math.PI / 180;
    const Δλ = (vehicleLon - userLon) * Math.PI / 180;

    const a = Math.sin(Δφ/2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // meters
    const walkingSpeed = 1.4; // meters per second (approx 5 km/h)

    return {
      distance: Math.round(distance), // meters
      eta: Math.round(distance / walkingSpeed / 60) // minutes
    };
  }

  async function loadRoutes() {
    try {
      const response = await fetch("data/routes.geojson");
      if (!response.ok) throw new Error("Failed to load routes.geojson");
      const geojson = await response.json();

      routeLayers.clearLayers();
      routeLayers = L.geoJSON(geojson, {
        style: (feature) => ({
          color: feature.properties.color || "blue",
          weight: 3,
          opacity: 0.7,
        }),
        onEachFeature: (feature, layer) => {
          if (feature.properties && feature.properties.name) {
            layer.bindPopup(`<b>Route:</b> ${feature.properties.name}`);
          }
        }
      }).addTo(map);
    } catch (err) {
      console.error("Error loading routes:", err);
    }
  }

  async function loadStops() {
    try {
      const response = await fetch("data/stops.geojson");
      if (!response.ok) throw new Error("Failed to load stops.geojson");
      const geojson = await response.json();

      if (stopsLayer) {
        stopsLayer.clearLayers();
      }

      stopsLayer = L.geoJSON(geojson, {
        pointToLayer: (feature, latlng) => {
          return L.circleMarker(latlng, {
            radius: 6,
            fillColor: "#0078A8",
            color: "#fff",
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
          });
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties && feature.properties.name) {
            layer.bindPopup(`<b>Stop:</b> ${feature.properties.name}`);
          }
        }
      }).addTo(map);
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

          updateVehicleETAs(lat, lon);
        },
        (error) => {
          alert("Unable to retrieve your location.");
          console.error("Geolocation error:", error);
        }
      );
    });
  }

  // Update ETA for each vehicle marker popup if user location is known
  function updateVehicleETAs(userLat, userLon) {
    Object.entries(vehicleMarkers).forEach(([vehicleId, marker]) => {
      const vehicle = vehiclesData[vehicleId];
      if (!vehicle) return;

      const { distance, eta } = computeETA(userLat, userLon, vehicle.lat, vehicle.lon);
      const modeIcon = iconMap[vehicle.mode.toLowerCase()] || null;

      const popupContent = `
        <b>Vehicle ID:</b> ${vehicleId} <br />
        <b>Mode:</b> ${vehicle.mode} ${modeIcon ? `<img src="${modeIcon}" alt="${vehicle.mode}" width="20" />` : ''} <br />
        <b>Distance:</b> ${distance} m <br />
        <b>ETA (walking):</b> ${eta} min
      `;

      marker.bindPopup(popupContent);
    });
  }

  async function fetchVehicles() {
    try {
      const response = await fetch(`${BACKEND_URL}/api/vehicles`);
      if (!response.ok) throw new Error("Failed to fetch vehicles");

      const data = await response.json();
      vehiclesData = {};

      data.forEach(vehicle => {
        vehiclesData[vehicle.id] = {
          lat: vehicle.lat,
          lon: vehicle.lon,
          mode: vehicle.mode
        };

        const vehicleIconUrl = iconMap[vehicle.mode.toLowerCase()] || null;
        const icon = vehicleIconUrl ? L.icon({
          iconUrl: vehicleIconUrl,
          iconSize: [30, 30],
          iconAnchor: [15, 30]
        }) : null;

        if (vehicleMarkers[vehicle.id]) {
          // Update position and icon if changed
          vehicleMarkers[vehicle.id].setLatLng([vehicle.lat, vehicle.lon]);
          if (icon) vehicleMarkers[vehicle.id].setIcon(icon);
        } else {
          vehicleMarkers[vehicle.id] = L.marker([vehicle.lat, vehicle.lon], { icon }).addTo(map);
          vehicleMarkers[vehicle.id].bindPopup(`<b>Vehicle ID:</b> ${vehicle.id}<br><b>Mode:</b> ${vehicle.mode}`);
        }
      });

      // Update popups with ETA if user location known
      if (userMarker) {
        const userLatLng = userMarker.getLatLng();
        updateVehicleETAs(userLatLng.lat, userLatLng.lng);
      }

      // Update last updated timestamp
      const now = new Date();
      document.getElementById("lastUpdated").textContent = now.toLocaleTimeString();

    } catch (err) {
      console.error("Error fetching vehicles:", err);
    }
  }

  // Placeholder for filter initialization (expand as needed)
  function initFilters() {
    // This function should implement filter UI and logic,
    // For now it just logs a message.
    console.log("Filters initialized (expand this function as needed).");
  }

  // Modal handling for tracking
  function setupTrackingModal() {
    const modal = document.getElementById("trackingModal");
    const openBtn = document.getElementById("openTrackingModal");
    const closeBtn = document.getElementById("closeTrackingModal");
    const trackingForm = document.getElementById("trackingForm");

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
  }

  // Initialize map and app
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

    setupTrackingModal();
  });

  // Collapsible panels logic
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
}

// Start app only if login passes
if (promptLogin()) {
  startApp();
}
