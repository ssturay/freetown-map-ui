// ================== LOGIN ==================
function promptLogin() {
  if (localStorage.getItem("loggedIn") === "true") return true;
  const username = prompt("Enter username:");
  const password = prompt("Enter password:");
  if (username !== "admin" || password !== "mypassword") {
    alert("Access denied");
    document.body.innerHTML = "<h2 style='text-align:center; padding: 2rem;'>Access Denied</h2>";
    return false;
  }
  localStorage.setItem("loggedIn", "true");
  return true;
}

// ================== GLOBALS ==================
const BACKEND_URL = "https://freetown-pt-tracker-backend.onrender.com";
let map, userMarker = null;
let vehicleMarkers = {};
let routeLayers = L.featureGroup();
let stopsLayer;
let vehiclesData = [];
let selectedStopCoords = null;
const STOP_FILTER_RADIUS = 500;
let stopsGeoJSON = null;
let selectedStopMarker = null; // for stop popup marker
let driverWatchId = null; // for live GPS tracking

// ================== ICONS ==================
const iconMap = {
  "podapoda": "assets/icons/podapoda.png",
  "keke": "assets/icons/keke.png",
  "taxi": "assets/icons/taxi.png",
  "paratransit bus": "assets/icons/paratransit_bus.png",
  "waka fine bus": "assets/icons/waka_fine_bus.png",
  "motorbike": "assets/icons/motorbike.png"
};
function getIcon(mode) {
  let key = (mode || "").toLowerCase().trim();
  if (key.endsWith(" driver")) {
    key = key.replace(" driver", "").trim();
  }
  return L.icon({
    iconUrl: iconMap[key] || iconMap["podapoda"],
    iconSize: [32, 32],
    iconAnchor: [16, 32]
  });
}

// ================== HELPERS ==================
function computeETA(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(Δφ/2)**2 +
            Math.cos(φ1)*Math.cos(φ2) *
            Math.sin(Δλ/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const d = R * c;
  return { distance: Math.round(d), eta: Math.round(d / 1.4 / 60) };
}
function $id(id){return document.getElementById(id)}

// ================== MAP INIT ==================
function initMap() {
  map = L.map("map").setView([8.48, -13.22], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
  routeLayers.addTo(map);
  loadRoutes();
  loadStops();
  addLocateMeButton();
  fetchVehicles();
  setInterval(fetchVehicles, 2000);
}

// ================== LOAD ROUTES ==================
async function loadRoutes(){
  try {
    const res = await fetch("data/routes.geojson");
    if (!res.ok) throw new Error();
    const geo = await res.json();
    routeLayers.clearLayers();
    L.geoJSON(geo, { style:{ color:"#3388ff", weight:5, opacity:0.7 } }).addTo(routeLayers);
  } catch(e){console.error(e)}
}

// ================== LOAD STOPS ==================
async function loadStops(){
  try {
    const res = await fetch("data/stops.geojson");
    stopsGeoJSON = await res.json();

    if (stopsLayer) stopsLayer.clearLayers();

    stopsLayer = L.geoJSON(stopsGeoJSON, {
      pointToLayer: (feature, latlng) => {
        const marker = L.circleMarker(latlng, {
          radius: 6,
          fillColor: "#f00",
          color: "#800",
          weight: 1,
          fillOpacity: 0.8
        });

        marker.bindPopup(`<b>${feature.properties.name}</b>`);

        marker.on("click", () => {
          const [lon, lat] = feature.geometry.coordinates;
          selectedStopCoords = { lat, lon };

          if (selectedStopMarker) map.removeLayer(selectedStopMarker);

          selectedStopMarker = L.marker([lat, lon]).addTo(map);
          selectedStopMarker.bindPopup(`<b>${feature.properties.name}</b>`).openPopup();

          map.setView([lat, lon], 16);

          $id("stopSelect").value = feature.properties.name;

          updateETAs();
          updateAlerts();
        });

        return marker;
      }
    }).addTo(map);

    const stopSelect = $id("stopSelect");
    stopSelect.innerHTML = `<option value="">-- Select Stop --</option>`;
    stopsGeoJSON.features.forEach(f => {
      stopSelect.innerHTML += `<option value="${f.properties.name}">${f.properties.name}</option>`;
    });

    stopSelect.addEventListener("change", () => {
      const val = stopSelect.value;
      if (val){
        const f = stopsGeoJSON.features.find(x => x.properties.name === val);
        const [lon, lat] = f.geometry.coordinates;
        selectedStopCoords = { lat, lon };

        if (selectedStopMarker) map.removeLayer(selectedStopMarker);

        selectedStopMarker = L.marker([lat, lon]).addTo(map);
        selectedStopMarker.bindPopup(`<b>${f.properties.name}</b>`).openPopup();

        map.setView([lat, lon], 16);
      } else {
        selectedStopCoords = null;
        if (selectedStopMarker) {
          map.removeLayer(selectedStopMarker);
          selectedStopMarker = null;
        }
      }
      updateETAs();
      updateAlerts();
    });

  } catch(e){ console.error(e); }
}

// ================== FETCH VEHICLES ==================
async function fetchVehicles(){
  try {
    const res = await fetch(`${BACKEND_URL}/api/vehicles`);
    const payload = await res.json();
    vehiclesData = payload.vehicles || [];
    vehiclesData.forEach(v=>{
      if (!v.lat||!v.lon) return;
      let icon = getIcon(v.mode);
      let content = `<b>${v.id}</b><br>${v.mode}`;
      if (userMarker){
        const {distance,eta} = computeETA(userMarker.getLatLng().lat,userMarker.getLatLng().lng,v.lat,v.lon);
        content += `<br>${distance}m ~${eta}min`;
      }
      if (vehicleMarkers[v.id]){
        vehicleMarkers[v.id].setLatLng([v.lat,v.lon]).setPopupContent(content);
      } else {
        vehicleMarkers[v.id] = L.marker([v.lat,v.lon],{icon}).bindPopup(content).addTo(map);
      }
    });
    autoTrackNearestVehicle();
    updateETAs();
    updateAlerts();
    if ($id("lastUpdated")) $id("lastUpdated").textContent = new Date().toLocaleTimeString();
  } catch(e){console.error(e)}
}

// ================== AUTO TRACK NEAREST VEHICLE ==================
function autoTrackNearestVehicle(){
  if (!selectedStopCoords) return;
  let nearest = null;
  let minDist = Infinity;
  vehiclesData.forEach(v=>{
    const {distance} = computeETA(selectedStopCoords.lat,selectedStopCoords.lon,v.lat,v.lon);
    if (distance < minDist){
      minDist = distance;
      nearest = v;
    }
  });
  if (nearest) map.setView([nearest.lat,nearest.lon],15);
}

// ================== UI UPDATES ==================
function updateETAs(){
  const el = $id("etaList");
  el.innerHTML = "";
  let list = vehiclesData;
  if (selectedStopCoords){
    list = list.filter(v=>computeETA(selectedStopCoords.lat,selectedStopCoords.lon,v.lat,v.lon).distance <= STOP_FILTER_RADIUS);
  }
  list.forEach(v=>{
    const {distance,eta} = userMarker ? computeETA(userMarker.getLatLng().lat,userMarker.getLatLng().lng,v.lat,v.lon) : {distance:"?",eta:"?"};
    el.innerHTML += `<div><img src="${iconMap[(v.mode || "").toLowerCase().replace(' driver','').trim()]}" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;">${v.id} (${v.mode}) — ${distance} m, ETA ~${eta} min</div>`;
  });
}
function updateAlerts(){
  const el = $id("alertSidebar");
  el.innerHTML = "";
  let found = false;
  vehiclesData.forEach(v=>{
    const {eta} = selectedStopCoords ? computeETA(selectedStopCoords.lat,selectedStopCoords.lon,v.lat,v.lon) : {eta:999};
    if (eta <= 3){
      el.innerHTML += `<div>⚠️ ${v.id} arriving in ~${eta} min</div>`;
      found = true;
    }
  });
  if (!found) el.innerHTML = "<p>No nearby vehicles</p>";
}

// ================== LOCATION ==================
function addLocateMeButton(){
  const btn = $id("locateMeBtn");
  btn.addEventListener("click",()=>{
    navigator.geolocation.getCurrentPosition(pos=>{
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      if (userMarker){userMarker.setLatLng([lat,lon])}
      else {
        userMarker = L.marker([lat,lon],{icon:L.icon({iconUrl:"https://cdn-icons-png.flaticon.com/512/684/684908.png",iconSize:[25,25]})}).addTo(map);
      }
      snapToNearestStop(lat,lon);
    },()=>alert("Location unavailable"));
  });
}
function snapToNearestStop(lat,lon){
  if (!stopsGeoJSON) return;
  let nearest=null, min=Infinity;
  stopsGeoJSON.features.forEach(f=>{
    const [slon,slat] = f.geometry.coordinates;
    const {distance} = computeETA(lat,lon,slat,slon);
    if (distance<min){min=distance;nearest=f}
  });
  if (nearest){
    const [slon,slat] = nearest.geometry.coordinates;
    selectedStopCoords = {lat:slat,lon:slon};
    $id("stopSelect").value = nearest.properties.name;

    if (selectedStopMarker) map.removeLayer(selectedStopMarker);
    selectedStopMarker = L.marker([slat, slon]).addTo(map);
    selectedStopMarker.bindPopup(`<b>${nearest.properties.name}</b>`).openPopup();

    map.setView([slat,slon],16);
  }
}

// ================== DRIVER TRACKING ==================
function startDriverTracking(mode) {
  if (!navigator.geolocation) {
    alert("Geolocation not supported on this device.");
    return;
  }

  const driverId = `${mode.replace(" Driver","")}_${Date.now()}`;

  if (driverWatchId !== null) {
    navigator.geolocation.clearWatch(driverWatchId);
  }

  driverWatchId = navigator.geolocation.watchPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      fetch(`${BACKEND_URL}/api/update_vehicle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: driverId,
          mode: mode,
          lat: lat,
          lon: lon
        })
      }).catch(err => console.error("Location update failed:", err));

      if (userMarker) {
        userMarker.setLatLng([lat, lon]);
      } else {
        userMarker = L.marker([lat, lon], { icon: getIcon(mode) }).addTo(map);
      }
    },
    err => console.error("Geolocation error:", err),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
  );
}
function stopDriverTracking() {
  if (driverWatchId !== null) {
    navigator.geolocation.clearWatch(driverWatchId);
    driverWatchId = null;
  }
}

// ================== INIT ==================
document.addEventListener("DOMContentLoaded",()=>{
  if (!promptLogin()) return;
  initMap();

  const toggleBtn = $id("toggleSidebarBtn");
  const sidebar = $id("sidebar");
  toggleBtn.addEventListener("click",()=>sidebar.classList.toggle("open"));

  const roleSelect = $id("roleSelect");
  roleSelect.addEventListener("change", () => {
    const role = roleSelect.value;
    if (role.toLowerCase().includes("driver")) {
      startDriverTracking(role);
    } else {
      stopDriverTracking();
    }
  });
});
