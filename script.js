const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";

const map = L.map("map").setView([8.48, -13.23], 13);

// Add map tiles
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors"
}).addTo(map);

let vehicleMarkers = {};

// Add your location
document.getElementById("locateMeBtn").addEventListener("click", () => {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords;
      L.marker([latitude, longitude], {
        icon: L.icon({
          iconUrl: "https://cdn-icons-png.flaticon.com/512/64/64113.png",
          iconSize: [24, 24]
        })
      }).addTo(map).bindPopup("You are here").openPopup();
      map.setView([latitude, longitude], 14);
    });
  }
});

// Fetch vehicles and update map
async function fetchVehicles() {
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
            iconSize: [28, 28]
          })
        }).addTo(map).bindPopup(`🚐 <b>${id}</b><br>ETA: ${eta_min} min`);
        vehicleMarkers[id] = marker;
      }
    }
  } catch (error) {
    console.error("Error fetching vehicle data:", error);
  }
}

fetchVehicles();
setInterval(fetchVehicles, 10000); // Refresh every 10 seconds

// Fix for broken tiles on initial load
setTimeout(() => {
  map.invalidateSize();
}, 100);



