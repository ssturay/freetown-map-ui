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
let passengerMarkers = {};
let routeLayers = L.featureGroup();
let stopsLayer;
let vehiclesData = [];
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
function getIcon(role) {
  let key = (role || "").toLowerCase().trim();
  if (key.endsWith(" driver")) key = key.replace(" driver","").trim();
  return L.icon({ iconUrl: iconMap[key] || iconMap["podapoda"], iconSize:[32,32], iconAnchor:[16,32] });
}
const passengerIcon = L.icon({ iconUrl:"https://cdn-icons-png.flaticon.com/512/1077/1077012.png", iconSize:[20,20], iconAnchor:[10,20] });

// ================== HELPERS ==================
function computeETA(lat1, lon1, lat2, lon2){
  const R = 6371e3;
  const φ1 = lat1*Math.PI/180, φ2 = lat2*Math.PI/180;
  const Δφ = (lat2-lat1)*Math.PI/180, Δλ=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const c=2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  const d = R*c;
  return { distance: Math.round(d), eta: Math.round(d/1.4/60) };
}
function $id(id){return document.getElementById(id)}

// ================== MAP INIT ==================
function initMap(){
  map = L.map("map").setView([8.48,-13.22],12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
  routeLayers.addTo(map);
  loadRoutes();
  loadStops();
  addLocateMeButton();
  fetchVehicles();
  setInterval(fetchVehicles,2000);
}

// ================== LOAD ROUTES ==================
async function loadRoutes(){
  try {
    const res = await fetch("data/routes.geojson");
    if (!res.ok) throw new Error();
    const geo = await res.json();
    routeLayers.clearLayers();
    L.geoJSON(geo,{style:{color:"#3388ff",weight:5,opacity:0.7}}).addTo(routeLayers);
  } catch(e){console.error(e)}
}

// ================== LOAD STOPS ==================
async function loadStops(){
  try {
    const res = await fetch("data/stops.geojson");
    stopsGeoJSON = await res.json();
    if (stopsLayer) stopsLayer.clearLayers();
    stopsLayer = L.geoJSON(stopsGeoJSON,{
      pointToLayer: (feature, latlng)=>{
        const marker = L.circleMarker(latlng,{radius:6,fillColor:"#f00",color:"#800",weight:1,fillOpacity:0.8});
        marker.bindPopup(`<b>${feature.properties.name}</b>`);
        marker.on("click",()=>{
          const [lon,lat]=feature.geometry.coordinates;
          selectedStopCoords={lat,lon};
          selectedRouteId=feature.properties.route_id;
          $id("stopSelect").value=feature.properties.name;
          if (selectedStopMarker) map.removeLayer(selectedStopMarker);
          selectedStopMarker=L.marker([lat,lon]).addTo(map);
          selectedStopMarker.bindPopup(`<b>${feature.properties.name}</b>`).openPopup();
          updateRouteDisplay();
          map.setView([lat,lon],16);
          updateETAs();
          updateAlerts();
          startDriverTracking();
          maybeStartPassengerPresence();
        });
        return marker;
      }
    }).addTo(map);

    const stopSelect = $id("stopSelect");
    stopSelect.innerHTML = `<option value="">-- Select Stop --</option>`;
    stopsGeoJSON.features.forEach(f=>{
      stopSelect.innerHTML += `<option value="${f.properties.name}" data-route="${f.properties.route_id}">${f.properties.name}</option>`;
    });

    stopSelect.addEventListener("change",()=>{
      const val=stopSelect.value;
      if (val){
        const f = stopsGeoJSON.features.find(x=>x.properties.name===val);
        const [lon,lat]=f.geometry.coordinates;
        selectedStopCoords={lat,lon};
        selectedRouteId=f.properties.route_id;
        if (selectedStopMarker) map.removeLayer(selectedStopMarker);
        selectedStopMarker=L.marker([lat,lon]).addTo(map);
        selectedStopMarker.bindPopup(`<b>${f.properties.name}</b>`).openPopup();
        map.setView([lat,lon],16);
        updateRouteDisplay();
        startDriverTracking();
        maybeStartPassengerPresence();
      } else {
        selectedStopCoords=null;
        selectedRouteId=null;
        if (selectedStopMarker) { map.removeLayer(selectedStopMarker); selectedStopMarker=null; }
        updateRouteDisplay();
        stopPassengerPresence();
      }
      updateETAs();
      updateAlerts();
    });
  } catch(e){console.error(e);}
}

// ================== FETCH VEHICLES ==================
async function fetchVehicles(){
  try{
    let url=`${BACKEND_URL}/api/vehicles`;
    if (selectedRouteId) url+=`?route_id=${encodeURIComponent(selectedRouteId)}`;
    const res = await fetch(url);
    const payload = await res.json();
    vehiclesData = payload.vehicles || [];

    // Vehicles + Passengers markers
    const liveIds = new Set();
    vehiclesData.forEach(v=>{
      if (!v.lat||!v.lon) return;
      let icon = v.role.toLowerCase().includes("passenger") ? passengerIcon : getIcon(v.role);
      const popup = v.role.toLowerCase().includes("passenger")
        ? (v.stop_name ? `🧍 Passenger at <b>${v.stop_name}</b>` : "🧍 Passenger waiting")
        : `<b>${v.id}</b><br>${v.role}`;
      if (v.role.toLowerCase().includes("passenger")){
        liveIds.add(v.id);
        if (passengerMarkers[v.id]) passengerMarkers[v.id].setLatLng([v.lat,v.lon]).setPopupContent(popup);
        else passengerMarkers[v.id]=L.marker([v.lat,v.lon],{icon:passengerIcon}).bindPopup(popup).addTo(map);
      } else {
        if (vehicleMarkers[v.id]) vehicleMarkers[v.id].setLatLng([v.lat,v.lon]).setPopupContent(popup);
        else vehicleMarkers[v.id]=L.marker([v.lat,v.lon],{icon}).bindPopup(popup).addTo(map);
      }
    });
    Object.keys(passengerMarkers).forEach(id=>{ if(!liveIds.has(id)){ map.removeLayer(passengerMarkers[id]); delete passengerMarkers[id]; } });

    autoTrackNearestVehicle();
    updateETAs();
    updateAlerts();
    if ($id("lastUpdated")) $id("lastUpdated").textContent=new Date().toLocaleTimeString();
  } catch(e){console.error(e);}
}

// ================== UPDATE ETAS + PASSENGER SIDEBAR ==================
function updateETAs(){
  const el = $id("etaList"); el.innerHTML="";
  let list = vehiclesData.filter(v=>!v.role.toLowerCase().includes("passenger"));
  if (selectedStopCoords) list=list.filter(v=>computeETA(selectedStopCoords.lat,selectedStopCoords.lon,v.lat,v.lon).distance<=STOP_FILTER_RADIUS);
  list.forEach(v=>{
    const {distance,eta}=selectedStopCoords
      ? computeETA(selectedStopCoords.lat,selectedStopCoords.lon,v.lat,v.lon)
      : (userMarker ? computeETA(userMarker.getLatLng().lat,userMarker.getLatLng().lng,v.lat,v.lon) : {distance:"?",eta:"?"});
    el.innerHTML += `<div><img src="${iconMap[(v.role||"").toLowerCase().replace(' driver','').trim()]}" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;">${v.id} (${v.role}) — ${distance} m, ETA ~${eta} min</div>`;
  });
  updatePassengerSidebar();
}

function updatePassengerSidebar(){
  const el = $id("passengerList");
  if (!el) return;
  const passengers = vehiclesData.filter(v=>v.role.toLowerCase().includes("passenger") && v.sharing);
  const grouped={};
  passengers.forEach(p=>{
    const stop=p.stop_name||"Waiting passengers";
    if (!grouped[stop]) grouped[stop]=[];
    grouped[stop].push(p.id);
  });
  el.innerHTML="";
  Object.keys(grouped).forEach(stop=>{
    el.innerHTML+=`<div style="margin-bottom:8px;"><b>${stop}</b>: ${grouped[stop].join(", ")}</div>`;
  });
  if (Object.keys(grouped).length===0) el.innerHTML="<p>No passengers currently sharing</p>";
}

// ================== AUTO TRACK NEAREST VEHICLE ==================
function autoTrackNearestVehicle(){
  if (!selectedStopCoords) return;
  let nearest=null, minDist=Infinity;
  vehiclesData.forEach(v=>{
    if(v.role.toLowerCase().includes("passenger")) return;
    const {distance}=computeETA(selectedStopCoords.lat,selectedStopCoords.lon,v.lat,v.lon);
    if(distance<minDist){ minDist=distance; nearest=v; }
  });
  if(nearest) map.setView([nearest.lat,nearest.lon],15);
}

// ================== DRIVER TRACKING ==================
function startDriverTracking(){
  if(!$id("roleSelect").value.toLowerCase().includes("driver")) return;
  if(!selectedRouteId) return;
  if(driverWatcher) navigator.geolocation.clearWatch(driverWatcher);
  driverWatcher = navigator.geolocation.watchPosition(pos=>{
    const lat=pos.coords.latitude, lon=pos.coords.longitude;
    if(driverMarker) driverMarker.setLatLng([lat,lon]);
    else { driverMarker=L.marker([lat,lon],{icon:getIcon($id("roleSelect").value)}).addTo(map); driverMarker.bindPopup("You are here (Driver)").openPopup(); }
    fetch(`${BACKEND_URL}/api/update_vehicle`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({id:driverId,role:$id("roleSelect").value,lat,lon,route_id:selectedRouteId,sharing:true})
    });
  });
}

// ================== PASSENGER PRESENCE ==================
function maybeStartPassengerPresence(){
  const role=$id("roleSelect").value.toLowerCase();
  if(!role.includes("passenger") || !selectedStopCoords || !selectedRouteId){ stopPassengerPresence(); return; }
  if(!passengerId) passengerId="passenger_"+Math.floor(Math.random()*100000);
  const send=()=>fetch(`${BACKEND_URL}/api/update_vehicle`,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({id:passengerId,role:"passenger",lat:selectedStopCoords.lat,lon:selectedStopCoords.lon,route_id:selectedRouteId,stop_name:$id("stopSelect").value,sharing:true})
  }).catch(()=>{});
  send();
  if(passengerInterval) clearInterval(passengerInterval);
  passengerInterval=setInterval(send,10000);
}
function stopPassengerPresence(){
  if(passengerInterval){ clearInterval(passengerInterval); passengerInterval=null; }
  if(passengerId){
    fetch(`${BACKEND_URL}/api/remove_passenger`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:passengerId})}).catch(()=>{});
  }
}

// ================== UI ==================
function updateRouteDisplay(){ $id("currentRoute").textContent = selectedRouteId ? `📍 Current Route: ${selectedRouteId}` : ""; }
function addLocateMeButton(){
  const btn=$id("locateMeBtn");
  btn.addEventListener("click",()=>{
    navigator.geolocation.getCurrentPosition(pos=>{
      const lat=pos.coords.latitude, lon=pos.coords.longitude;
      if(userMarker) userMarker.setLatLng([lat,lon]);
      else userMarker=L.marker([lat,lon],{icon:L.icon({iconUrl:"https://cdn-icons-png.flaticon.com/512/684/684908.png",iconSize:[25,25]})}).addTo(map);
      snapToNearestStop(lat,lon);
    },()=>alert("Location unavailable"));
  });
}
function snapToNearestStop(lat,lon){
  if(!stopsGeoJSON) return;
  let nearest=null,min=Infinity;
  stopsGeoJSON.features.forEach(f=>{
    const [slon,slat]=f.geometry.coordinates;
    const {distance}=computeETA(lat,lon,slat,slon);
    if(distance<min){ min=distance; nearest=f; }
  });
  if(nearest){
    const [slon,slat]=nearest.geometry.coordinates;
    selectedStopCoords={lat:slat,lon:slon};
    selectedRouteId=nearest.properties.route_id;
    $id("stopSelect").value=nearest.properties.name;
    updateRouteDisplay();
    if(selectedStopMarker) map.removeLayer(selectedStopMarker);
    selectedStopMarker=L.marker([slat,slon]).addTo(map);
    selectedStopMarker.bindPopup(`<b>${nearest.properties.name}</b>`).openPopup();
    map.setView([slat,slon],16);
    startDriverTracking();
    maybeStartPassengerPresence();
  }
}

// ================== INIT ==================
document.addEventListener("DOMContentLoaded",()=>{
  if(!promptLogin()) return;
  initMap();
  driverId="driver_"+Math.floor(Math.random()*100000);

  $id("toggleSidebarBtn").addEventListener("click",()=>$id("sidebar").classList.toggle("open"));
  $id("clearBtn").addEventListener("click",()=>{
    selectedStopCoords=null; selectedRouteId=null;
    if(selectedStopMarker){ map.removeLayer(selectedStopMarker); selectedStopMarker=null; }
    $id("stopSelect").value="";
    updateRouteDisplay();
    $id("etaList").innerHTML=""; $id("passengerList").innerHTML="<p>No passengers currently sharing</p>";
    stopPassengerPresence(); Object.keys(passengerMarkers).forEach(id=>{ map.removeLayer(passengerMarkers[id]); });
    passengerMarkers={};
    map.setView([8.48,-13.22],12);
  });

  $id("roleSelect").addEventListener("change",()=>{
    if($id("roleSelect").value.toLowerCase().includes("passenger")){ maybeStartPassengerPresence(); if(driverWatcher){ navigator.geolocation.clearWatch(driverWatcher); driverWatcher=null; } }
    else{ stopPassengerPresence(); startDriverTracking(); }
  });

  startDriverTracking();
  window.addEventListener("beforeunload",stopPassengerPresence);
});
