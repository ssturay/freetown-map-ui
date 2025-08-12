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
  return L.icon({ iconUrl: iconMap[mode?.toLowerCase()] || iconMap["podapoda"], iconSize: [30, 30], iconAnchor: [15, 30] });
}

function computeETA(userLat, userLon, vehicleLat, vehicleLon) {
  const R = 6371e3; // metres
  const φ1 = userLat * Math.PI / 180;
  const φ2 = vehicleLat * Math.PI / 180;
  const Δφ = (vehicleLat - userLat) * Math.PI / 180;
  const Δλ = (vehicleLon - userLon) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) ** 2 +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // in metres
  const walkingSpeed = 1.4; // m/s

  return {
    distance: Math.round(distance),
    eta: Math.round(distance / walkingSpeed / 60) // minutes
  };
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

    // Filter by stop (if selected)
    const filtered = vehiclesData.filter(v => !stopFilter || v.stop === stopFilter);

    // Update map markers
    filtered.forEach(v => {
      if (!v.id || !v.lat || !v.lon) return;
      if (vehicleMarkers[v.id]) {
        vehicleMarkers[v.id].setLatLng([v.lat, v.lon]);
      } else {
        vehicleMarkers[v.id] = L.marker([v.lat, v.lon], { icon: getIcon(v.mode) })
          .bindPopup(`<b>${v.id}</b> (${v.mode})<br>Stop: ${v.stop}`)
          .addTo(map);
      }
    });

    updateSidebarETAs(filtered);
    updateSidebarAlerts(filtered);

    $id("lastUpdated").textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    console.error(err);
  }
}

function updateSidebarETAs(list) {
  const etaList = $id("etaList");
  etaList.innerHTML = "";

  if (!list.length) {
    etaList.innerHTML = "<p>No data available.</p>";
    return;
  }

  list.forEach(v => {
    const div = document.createElement("div");
    div.className = "sidebar-item";
    let distanceText = "";
    if (userMarker) {
      const u = userMarker.getLatLng();
      const { distance, eta } = computeETA(u.lat, u.lng, v.lat, v.lon);
      distanceText = ` — ${distance} m, ETA ~${eta} min`;
    }
    div.innerHTML = `
      <img src="${getIcon(v.mode).options.iconUrl}" style="width:18px;height:18px;margin-right:6px;vertical-align:middle;">
      ${v.id} (${v.mode || "unknown"}) ${distanceText}
    `;
    etaList.appendChild(div);
  });
}

function updateSidebarAlerts(list) {
  const alertList = $id("alertSidebar");
  alertList.innerHTML = "";
  let found = false;
  if (userMarker) {
    const u = userMarker.getLatLng();
    list.forEach(v => {
      const { eta } = computeETA(u.lat, u.lng, v.lat, v.lon);
      if (eta <= 3) {
        const div = document.createElement("div");
        div.className = "alert-item";
        div.textContent = `⚠️ ${v.id} arriving in ~${eta} min`;
        alertList.appendChild(div);
        found = true;
      }
    });
  }
  if (!found) {
    alertList.innerHTML = "<p>No nearby vehicles within alert range.</p>";
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
      fetchVehicles(); // refresh ETA after locating
    });
  });

  $id("shareLocationBtn").addEventListener("click", shareLocation);
  $id("toggleSidebarBtn").addEventListener("click", () => $id("sidebar").classList.toggle("open"));
});
