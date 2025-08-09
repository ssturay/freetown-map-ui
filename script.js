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
  let stopsLayer = L.featureGroup();  // Make stops a layer group
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

    const a = Math.sin(Δφ/2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    const walkingSpeed = 1.4;

    return { distance: Math.round(distance), eta: Math.round(distance / walkingSpeed / 60) };
  }

  // Load and display GeoJSON routes
  async function loadRoutes() {
    try {
      const response = await fetch('routes.geojson');
      if (!response.ok) throw new Error("Failed to load routes.geojson");

      const geojson = await response.json();

      // Clear previous route layers
      routeLayers.clearLayers();

      // Style function for routes - random color per route
      function styleRoute(feature) {
        return {
          color: getRandomColor(),
          weight: 4,
          opacity: 0.8
        };
      }

      L.geoJSON(geojson, {
        style: styleRoute,
        onEachFeature: function (feature, layer) {
          if (feature.properties && feature.properties.name) {
            layer.bindPopup(`<strong>Route:</strong> ${feature.properties.name}`);
          }
        }
      }).addTo(routeLayers);

      routeLayers.addTo(map);
      console.log("Routes loaded");
    } catch (err) {
      console.error("Error loading routes:", err);
    }
  }

  // Load and display GeoJSON stops
  async function loadStops() {
    try {
      const response = await fetch('stops.geojson');
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
      console.log("Stops loaded");
    } catch (err) {
      console.error("Error loading stops:", err);
    }
  }

  // Utility: random hex color generator for route lines
  function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i=0; i<6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
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

  // Main load
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

  // Keep the rest of your existing logic here (initFilters, fetchVehicles, etc.)
  // ...

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
