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
let vehicleMarkers = {};   // { driverId: Marker }
let passengerMarkers = {}; // { passengerId: Marker }
let routeLayers = L.featureGroup();
let stopsLayer;
let vehiclesData = [];
let passengersData = [];
let selectedStopCoords = null;
let selectedRouteId = null;
const STOP_FILTER_RADIUS = 500;
let stopsGeoJSON = null;
let selectedStopMarker = null;
let driverId = null;
let driverMarker = null;
let driverWatcher = null;
let passengerId = null;
let passengerInterval = null;

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
  if (key.endsWith(" driver")) key = key.replace(" driver", "").trim();
  return L.icon({
    iconUrl: iconMap[key] || iconMap["podapoda"],
    iconSize: [32, 32],
    iconAnchor: [16, 32]
  });
}
const passengerIcon = L.icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/1077/1077012.png",
  iconSize: [20, 20],
  iconAnchor: [10, 20]
});

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
  fetchVehiclesAndPassengers();
  setInterval(fetchVehiclesAndPassengers, 2000);
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
        marker.on("click", () => handleStopSelection(feature));
        return marker;
      }
    }).addTo(map);

    const stopSelect = $id("stopSelect");
    stopSelect.innerHTML = `<option value="">-- Select Stop --</option>`;
    stopsGeoJSON.features.forEach(f => {
      stopSelect.innerHTML += `<option value="${f.properties.name}" data-route="${f.properties.route_id}">${f.properties.name}</option>`;
    });

    stopSelect.addEventListener("change", () => {
      const val = stopSelect.value;
      if (val) {
        const f = stopsGeoJSON.features.find(x => x.properties.name === val);
        handleStopSelection(f);
      } else {
        clearStopSelection();
      }
    });
  } catch(e){ console.error(e); }
}

function handleStopSelection(feature){
  const [lon, lat] = feature.geometry.coordinates;
  selectedStopCoords = { lat, lon };
  selectedRouteId = feature.properties.route_id;
  $id("stopSelect").value = feature.properties.name;

  if (selectedStopMarker) map.removeLayer(selectedStopMarker);
  selectedStopMarker = L.marker([lat, lon]).addTo(map);
  selectedStopMarker.bindPopup(`<b>${feature.properties.name}</b>`).openPopup();

  map.setView([lat, lon], 16);
  updateRouteDisplay();
  updateETAs();
  updateAlerts();

  startDriverTracking();
  maybeStartPassengerPresence();
}

function clearStopSelection(){
  selectedStopCoords = null;
  selectedRouteId = null;
  if (selectedStopMarker) { map.removeLayer(selectedStopMarker); selectedStopMarker = null; }
  updateRouteDisplay();
  stopPassengerPresence();
  updateETAs();
  updateAlerts();
}

// ================== FETCH VEHICLES + PASSENGERS ==================
async function fetchVehiclesAndPassengers(){
  try {
    let url = `${BACKEND_URL}/api/vehicles`;
    if (selectedRouteId) url += `?route_id=${encodeURIComponent(selectedRouteId)}`;
    const res = await fetch(url);
    const payload = await res.json();
    vehiclesData = payload.vehicles || [];
    passengersData = vehiclesData.filter(v => v.role.toLowerCase().includes("passenger")); // passengers are included in vehicles_data

    // --- DRIVERS ---
    vehiclesData.forEach(v=>{
      if (!v.lat||!v.lon) return;
      if (v.role.toLowerCase().includes("passenger")) return; // skip passengers here
      let icon = getIcon(v.role);
      let content = `<b>${v.id}</b><br>${v.role}`;
      if (selectedStopCoords){
        const {distance,eta} = computeETA(selectedStopCoords.lat,selectedStopCoords.lon,v.lat,v.lon);
        content += `<br>${distance}m ~${eta}min`;
      }
      if (vehicleMarkers[v.id]){
        vehicleMarkers[v.id].setLatLng([v.lat,v.lon]).setPopupContent(content);
      } else {
        vehicleMarkers[v.id] = L.marker([v.lat,v.lon],{icon}).bindPopup(content).addTo(map);
      }
    });
    // cleanup drivers not in feed
    Object.keys(vehicleMarkers).forEach(id=>{
      if (!vehiclesData.find(v=>v.id===id && !v.role.toLowerCase().includes("passenger"))){
        map.removeLayer(vehicleMarkers[id]);
        delete vehicleMarkers[id];
      }
    });

    // --- PASSENGERS ---
    const liveIds = new Set();
    passengersData.forEach(p=>{
      if (!p.id||!p.lat||!p.lon) return;
      liveIds.add(p.id);
      const popup = p.stop_name
        ? `🧍 Passenger at <b>${p.stop_name}</b><br>Route: ${p.route_id||""}`
        : `🧍 Passenger waiting`;
      if (passengerMarkers[p.id]){
        passengerMarkers[p.id].setLatLng([p.lat,p.lon]).setPopupContent(popup);
      } else {
        passengerMarkers[p.id] = L.marker([p.lat,p.lon], {icon: passengerIcon}).bindPopup(popup).addTo(map);
      }
    });
    Object.keys(passengerMarkers).forEach(id=>{
      if (!liveIds.has(id)){
        map.removeLayer(passengerMarkers[id]);
        delete passengerMarkers[id];
      }
    });

    // Update passenger sidebar (aggregated)
    updatePassengerSidebar();

    autoTrackNearestVehicle();
    updateETAs();
    updateAlerts();
    if ($id("lastUpdated")) $id("lastUpdated").textContent = new Date().toLocaleTimeString();
  } catch(e){console.error(e)}
}

// ================== UPDATE PASSENGER SIDEBAR ==================
function updatePassengerSidebar() {
  const el = $id("passengerList");
  el.innerHTML = "";

  const stopGroups = {};
  passengersData.forEach(p => {
    if (!p.stop_name) return;
    if (!stopGroups[p.stop_name]) stopGroups[p.stop_name] = 0;
    stopGroups[p.stop_name]++;
  });

  if (Object.keys(stopGroups).length === 0) {
    el.innerHTML = "<p>No passengers currently sharing their location</p>";
  } else {
    for (const [stop, count] of Object.entries(stopGroups)) {
      el.innerHTML += `<div>🛑 <b>${stop}</b> — ${count} Passenger${count>1?'s':''}</div>`;
    }
  }
}

// ================== AUTO TRACK NEAREST VEHICLE ==================
function autoTrackNearestVehicle(){
  if (!selectedStopCoords) return;
  let nearest=null, min=Infinity;
  vehiclesData.forEach(v=>{
    if (v.role.toLowerCase().includes("passenger")) return;
    const {distance} = computeETA(selectedStopCoords.lat,selectedStopCoords.lon,v.lat,v.lon);
    if (distance<min){min=distance;nearest=v;}
  });
  if (nearest) map.setView([nearest.lat,nearest.lon],15);
}

// ================== UI UPDATES ==================
function updateETAs(){
  const el = $id("etaList");
  el.innerHTML = "";
  let list = vehiclesData.filter(v=>!v.role.toLowerCase().includes("passenger"));
  if (selectedStopCoords){
    list = list.filter(v=>computeETA(selectedStopCoords.lat,selectedStopCoords.lon,v.lat,v.lon).distance <= STOP_FILTER_RADIUS);
  }
  list.forEach(v=>{
    const {distance,eta} = selectedStopCoords
      ? computeETA(selectedStopCoords.lat,selectedStopCoords.lon,v.lat,v.lon)
      : (userMarker ? computeETA(userMarker.getLatLng().lat,userMarker.getLatLng().lng,v.lat,v.lon) : {distance:"?",eta:"?"});
    el.innerHTML += `<div><img src="${iconMap[(v.role || "").toLowerCase().replace(' driver','').trim()]}" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;">${v.id} (${v.role}) — ${distance} m, ETA ~${eta} min</div>`;
  });
}
function updateAlerts(){
  const el = $id("alertSidebar");
  el.innerHTML = "";
  let found=false;
  vehiclesData.forEach(v=>{
    if (v.role.toLowerCase().includes("passenger")) return;
    const {eta} = selectedStopCoords ? computeETA(selectedStopCoords.lat,selectedStopCoords.lon,v.lat,v.lon) : {eta:999};
    if (eta<=3){ el.innerHTML += `<div>⚠️ ${v.id} arriving in ~${eta} min</div>`; found=true; }
  });
  if (!found) el.innerHTML="<p>No nearby vehicles</p>";
  updateBanner();
}

// ================== BANNER HANDLING ==================
function showBanner(message,color){
  const banner=$id("statusBanner");
  banner.textContent=message;
  banner.style.backgroundColor=color;
  banner.style.color="white";
  banner.style.display="block";
  banner.classList.add("fade");
  setTimeout(()=>banner.style.display="none",4000);
}
function updateBanner(){}

// ================== LOCATE ME ==================
function addLocateMeButton(){
  $id("locateMeBtn").addEventListener("click",()=>{
    if (!navigator.geolocation){showBanner("Geolocation not supported","red");return;}
    navigator.geolocation.getCurrentPosition(pos=>{
      const {latitude,longitude} = pos.coords;
      if (userMarker) userMarker.setLatLng([latitude,longitude]);
      else userMarker = L.marker([latitude,longitude]).addTo(map).bindPopup("You are here").openPopup();
      map.setView([latitude,longitude],16);
    });
  });
}

// ================== INIT ==================
if (promptLogin()) initMap();
