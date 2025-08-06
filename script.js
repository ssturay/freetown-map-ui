const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";

let map;
let vehicleMarkers = {};

window.addEventListener("load", () => {
  // Initialize the map
  map = L.map("map").setView([8.48, -13.23], 13);

  // Add OpenStreetMap tile layer
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  // Fix for leaflet sizing issues on load
  setTimeout(() => map.invalidateSize(), 100);

  // Start fetching vehicles
  fetchVehicles();
  setInterval(fetchVehicles, 10000);
});

// ✅ Load and add stops to the map
  fetch('/data/stops.geojson')  // Adjust this path if needed
    .then(res => res.json())
    .then(stopsGeoJSON => {
      stopsGeoJSON.features.forEach((feature) => {
        const [lng, lat] = feature.geometry.coordinates;
        const stopName = feature.properties.name;

        L.circleMarker([lat, lng], {
          radius: 5,
          fillColor: "#000",
          color: "#fff",
          weight: 1,
          opacity: 1,
          fillOpacity: 0.9,
        })
          .addTo(map)
          .bindPopup(`<b>${stopName}</b>`);
      });
    })
    .catch(err => {
      console.error('Failed to load stops.geojson:', err);
    });
});

// Locate Me button click handler
document.getElementById("locateMeBtn").addEventListener("click", () => {
  if (navigator.geolocation && map) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        L.marker([latitude, longitude], {
          icon: L.icon({
            iconUrl: "https://cdn-icons-png.flaticon.com/512/64/64113.png",
            iconSize: [24, 24],
          }),
        })
          .addTo(map)
          .bindPopup("You are here")
          .openPopup();
        map.setView([latitude, longitude], 14);
      },
      (err) => {
        alert("Geolocation error: " + err.message);
      }
    );
  } else {
    alert("Geolocation is not supported by your browser.");
  }
});

async function fetchVehicles() {
  if (!map) return;

  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    const data = await res.json();

    document.getElementById("lastUpdated").innerText = new Date().toLocaleTimeString();

    for (const [id, info] of Object.entries(data)) {
      const { lat, lon, eta_min } = info;

      if (vehicleMarkers[id]) {
        vehicleMarkers[id].setLatLng([lat, lon]);
        vehicleMarkers[id].setPopupContent(`🚐 <b>${id}</b><br>ETA: ${eta_min} min`);
      } else {
        const marker = L.marker([lat, lon], {
          icon: L.icon({
            iconUrl: "https://cdn-icons-png.flaticon.com/512/61/61200.png",
            iconSize: [28, 28],
          }),
        })
          .addTo(map)
          .bindPopup(`🚐 <b>${id}</b><br>ETA: ${eta_min} min`);
        vehicleMarkers[id] = marker;
      }
    }
  } catch (error) {
    console.error("Error fetching vehicle data:", error);
  }
}
