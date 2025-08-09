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
  let routeLayers = L.featureGroup();
  let availableModes = new Set();
  let filters = {};
  let stopsLayer = L.layerGroup().addTo(map);
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

  function getIcon(mode) {
    const url = iconMap[mode.toLowerCase()] || iconMap["podapoda"];
    return L.icon({ iconUrl: url, iconSize: [32, 32] });
  }

  function addLocateMeButton() {
    const locateBtn = document.getElementById("locateMeBtn");

    if (!locateBtn) return;

    locateBtn.addEventListener("click", () => {
      if (!navigator.geolocation) {
        alert("Geolocation not supported.");
        return;
      }

      navigator.geolocation.getCurrentPosition((pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

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
      }, () => {
        alert("Could not retrieve location.");
      });
    });
  }

  async function fetchVehicles() {
    try {
      const res = await fetch(`${BACKEND_URL}/api/vehicles`);
      const data = await res.json();
      document.getElementById("lastUpdated").textContent = new Date().toLocaleTimeString();

      for (const id in data) {
        const vehicle = data[id];
        const { lat, lon, mode, eta_min } = vehicle;

        availableModes.add(mode);

        // Filter logic
        if (Object.keys(filters).length && !filters[mode.toLowerCase()]) {
          if (vehicleMarkers[id]) {
            map.removeLayer(vehicleMarkers[id]);
            delete vehicleMarkers[id];
          }
          continue;
        }

        if (vehicleMarkers[id]) {
          vehicleMarkers[id].setLatLng([lat, lon]);
        } else {
          vehicleMarkers[id] = L.marker([lat, lon], {
            icon: getIcon(mode),
            title: `${mode.toUpperCase()} (${id})`
          }).bindPopup(`<b>${mode.toUpperCase()}</b><br>ID: ${id}<br>ETA: ${eta_min} min`).addTo(map);
        }
      }
    } catch (err) {
      console.error("Error fetching vehicles:", err);
    }
  }

  function initFilters() {
    const container = document.createElement("div");
    container.className = "filter-panel";

    container.innerHTML = `<h3>Filter by mode</h3>
      <div id="modeFilters"></div>
      <button onclick="applyFilters()">Apply Filters</button>`;

    document.querySelector(".sidebar-filter-container").appendChild(container);

    function applyFilters() {
      const checkboxes = document.querySelectorAll(".filter-panel input[type='checkbox']");
      filters = {};
      checkboxes.forEach(cb => {
        if (cb.checked) {
          filters[cb.value.toLowerCase()] = true;
        }
      });
      fetchVehicles();
    }

    window.applyFilters = applyFilters;
  }

  async function loadRoutes() {
    // Placeholder: You could load GeoJSON routes here
  }

  async function loadStops() {
    // Optional: Load stops and show as markers or circles
  }

  function showUserLocationAndNearbyStops() {
    // Optional: Enhance later to show stop markers around the user
  }

  // -------------------------------
  // MAIN INITIALIZATION
  // -------------------------------
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

  // -------------------------------
  // MODAL & FORM LOGIC
  // -------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("trackingModal");
    const openBtn = document.getElementById("openTrackingModal");
    const closeBtn = document.getElementById("closeTrackingModal");

    if (openBtn) {
      openBtn.onclick = () => modal.style.display = "block";
    }

    if (closeBtn) {
      closeBtn.onclick = () => modal.style.display = "none";
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

// -------------------------------
// BOOTSTRAP THE APP
// -------------------------------
if (promptLogin()) {
  startApp();
}
