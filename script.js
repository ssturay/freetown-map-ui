const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, userMarker = null, vehicleMarkers = {}, vehiclesData = [];

function $id(id) { return document.getElementById(id); }

function getIcon(mode) {
  const iconMap = {
    "podapoda": "https://cdn-icons-png.flaticon.com/512/743/743007.png",
    "taxi": "https://cdn-icons-png.flaticon.com/512/190/190671.png",
    "keke": "https://cdn-icons-png.flaticon.com/512/2967/2967037.png",
    "paratransit bus": "https://cdn-icons-png.flaticon.com/512/61/61221.png",
    "waka fine bus": "https://cdn-icons-png.flaticon.com/512/861/861060.png",
    "motorbike": "https://cdn-icons-png.flaticon.com/512/4721/4721203.png"
  };
  return L.icon({ iconUrl: iconMap[mode] || iconMap["podapoda"], iconSize: [30, 30], iconAnchor: [15, 30] });
}

function initMap() {
  map = L.map("map").setView([8.48, -13.22], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" }).addTo(map);
  fetchVehicles();
  setInterval(fetchVehicles, 2000);
}

async function fetchVehicles() {
  try {
    const stopFilter = $id("stopSelect").value;
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    const payload = await res.json();
    vehiclesData = payload.vehicles || [];

    vehiclesData
      .filter(v => !stopFilter || v.stop === stopFilter)
      .forEach(v => {
        if (!v.id || !v.lat || !v.lon) return;
        if (vehicleMarkers[v.id]) {
          vehicleMarkers[v.id].setLatLng([v.lat, v.lon]);
        } else {
          vehicleMarkers[v.id] = L.marker([v.lat, v.lon], { icon: getIcon(v.mode) })
            .bindPopup(`<b>${v.id}</b> (${v.mode})<br>Stop: ${v.stop}`)
            .addTo(map);
        }
      });

    $id("lastUpdated").textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    console.error(err);
  }
}

function shareLocation() {
  if (!navigator.geolocation) return alert("Geolocation not supported");
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const role = $id("roleSelect").value;
    const stop = $id("stopSelect").value || "Unknown";
    const id = prompt("Enter your Vehicle or Passenger ID:");
    if (!id) return;

    await fetch(`${BACKEND_URL}/api/update_location`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, id, lat, lon, stop })
    });
    alert("Location shared!");
  }, err => {
    console.error(err);
    alert("Unable to get location");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  $id("locateMeBtn").addEventListener("click", () => {
    if (!navigator.geolocation) return alert("Geolocation not supported");
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      if (!userMarker) {
        userMarker = L.marker([lat, lon], { icon: L.icon({ iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png", iconSize: [25, 25] }) }).addTo(map);
      } else {
        userMarker.setLatLng([lat, lon]);
      }
      map.setView([lat, lon], 15);
    });
  });
  $id("shareLocationBtn").addEventListener("click", shareLocation);
  $id("toggleSidebarBtn").addEventListener("click", () => $id("sidebar").classList.toggle("open"));
});
