'use strict';

const state = {
  start: null,
  currentWeather: null,
  destination: null,
  searchResults: [],
  route: null,
  trip: null,
  map: null,
  routeLayer: null,
  markerLayer: null,
  installPrompt: null,
  mapResizeObserver: null,

  driveActive: false,
  driveDemo: false,
  drivePaused: false,
  driveFollow: true,
  driveWatchId: null,
  driveTimer: null,
  driveProgress: null,
  driveCarMarker: null,
  drivePassedLayer: null,
  driveRemainingLayer: null,
  demoFraction: 0,
};

const $ = id => document.getElementById(id);
const els = {
  locationCard: $('locationCard'),
  locationFallback: $('locationFallback'),
  retryLocationBtn: $('retryLocationBtn'),
  demoLocationBtn: $('demoLocationBtn'),
  destinationInput: $('destinationInput'),
  findBtn: $('findBtn'),
  searchResults: $('searchResults'),
  selectedDestination: $('selectedDestination'),
  departureInput: $('departureInput'),
  departureLabel: $('departureLabel'),
  nowBtn: $('nowBtn'),
  tripBtn: $('tripBtn'),
  status: $('status'),
  tripSection: $('tripSection'),
  tripStats: $('tripStats'),
  tripNavStrip: $('tripNavStrip'),
  tripNavOrigin: $('tripNavOrigin'),
  tripNavDestination: $('tripNavDestination'),
  weatherAlert: $('weatherAlert'),
  timeline: $('timeline'),
  installBtn: $('installBtn'),

  driveLaunch: $('driveLaunch'),
  startDriveBtn: $('startDriveBtn'),
  simulateDriveBtn: $('simulateDriveBtn'),
  drivePanel: $('drivePanel'),
  driveDestination: $('driveDestination'),
  driveStatus: $('driveStatus'),
  driveRemaining: $('driveRemaining'),
  driveEta: $('driveEta'),
  driveSpeed: $('driveSpeed'),
  driveProgressBar: $('driveProgressBar'),
  followDriveBtn: $('followDriveBtn'),
  pauseDemoBtn: $('pauseDemoBtn'),
  stopDriveBtn: $('stopDriveBtn'),
  driveOverlay: $('driveOverlay'),
  driveOverlayIcon: $('driveOverlayIcon'),
  driveOverlayTitle: $('driveOverlayTitle'),
  driveOverlayDetail: $('driveOverlayDetail'),
  map: $('map'),
};

const weatherCodes = {
  0: ['☀️', 'Clear sky', 0], 1: ['🌤️', 'Mainly clear', 0], 2: ['⛅', 'Partly cloudy', 0], 3: ['☁️', 'Overcast', 0],
  45: ['🌫️', 'Fog', 2], 48: ['🌫️', 'Fog', 2], 51: ['🌦️', 'Drizzle', 1], 53: ['🌦️', 'Drizzle', 1], 55: ['🌦️', 'Drizzle', 1],
  56: ['🧊', 'Freezing drizzle', 3], 57: ['🧊', 'Freezing drizzle', 3], 61: ['🌦️', 'Light rain', 1], 63: ['🌧️', 'Rain', 2], 65: ['🌧️', 'Heavy rain', 3],
  66: ['🧊', 'Freezing rain', 4], 67: ['🧊', 'Freezing rain', 4], 71: ['🌨️', 'Snow', 2], 73: ['🌨️', 'Snow', 2], 75: ['❄️', 'Heavy snow', 4], 77: ['❄️', 'Snow grains', 3],
  80: ['🌦️', 'Rain showers', 2], 81: ['🌦️', 'Rain showers', 2], 82: ['🌧️', 'Heavy showers', 3], 85: ['🌨️', 'Snow showers', 2], 86: ['❄️', 'Heavy snow showers', 4],
  95: ['⛈️', 'Thunderstorm', 4], 96: ['⛈️', 'Thunderstorm with hail', 5], 99: ['⛈️', 'Thunderstorm with hail', 5],
};

function codeInfo(code) { return weatherCodes[code] || ['🌡️', 'Weather', 0]; }
function fmtTime(date) { return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(date); }
function fmtDateTime(date) { return new Intl.DateTimeFormat([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date); }
function miles(meters) { return meters / 1609.344; }
function durationText(seconds) {
  const minutes = Math.round(seconds / 60); const h = Math.floor(minutes / 60); const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m} min`;
}
function setStatus(text, error = false) { els.status.textContent = text || ''; els.status.classList.toggle('error', error); }
function htmlEscape(value) { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function destinationScore(p) {
  const code = String(p.feature_code || '').toUpperCase();
  let score = 0;
  if (code.startsWith('PPLA')) score += 5000;
  else if (code === 'PPL' || code.startsWith('PPL')) score += 3500;
  if (Number.isFinite(Number(p.population))) score += Math.log10(Math.max(1, Number(p.population))) * 500;
  if (p.admin1) score += 100;
  return score;
}

function weatherCardHtml(title, subtitle, w) {
  const [icon, label] = codeInfo(w.code);
  return `<div class="weather-row"><div class="weather-icon">${icon}</div><div><strong>${htmlEscape(title)}</strong><div class="check-sub">${htmlEscape(subtitle)}</div><div class="weather-main">${Math.round(w.temp)}°F • ${label}</div><div class="weather-meta"><span>Feels ${Math.round(w.feels)}°</span><span>Rain ${w.rainChance}%</span><span>Wind ${Math.round(w.wind)} mph</span></div></div></div>`;
}

async function loadLocation() {
  els.locationCard.classList.add('loading');
  els.locationCard.textContent = 'Getting your location and current weather...';
  els.locationFallback.classList.add('hidden');
  try {
    const coords = await new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('This device does not provide browser location.'));
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        e => reject(new Error(e.message || 'Location permission was not granted.')),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      );
    });
    await useStart(coords);
  } catch (err) {
    els.locationCard.classList.remove('loading');
    els.locationCard.innerHTML = `<strong>Location unavailable</strong><div class="check-sub">${htmlEscape(err.message || err)}</div>`;
    els.locationFallback.classList.remove('hidden');
  }
}

async function useStart(point) {
  state.start = point;
  const w = await getCurrentWeather(point);
  state.currentWeather = w;
  els.locationCard.classList.remove('loading');
  els.locationCard.innerHTML = weatherCardHtml('Current location', `${point.lat.toFixed(3)}, ${point.lon.toFixed(3)}`, w);
  els.locationFallback.classList.add('hidden');
}

async function getCurrentWeather(point) {
  const q = new URLSearchParams({
    latitude: point.lat, longitude: point.lon,
    current: 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
    hourly: 'precipitation_probability', temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch', timezone: 'GMT', forecast_days: '2'
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!res.ok) throw new Error(`Weather service returned ${res.status}.`);
  const data = await res.json();
  const time = new Date(`${data.current.time}Z`);
  const idx = nearestTimeIndex(data.hourly.time, time);
  return {
    time, temp: data.current.temperature_2m, feels: data.current.apparent_temperature,
    rainChance: Number(data.hourly.precipitation_probability?.[idx] ?? 0),
    rain: Number(data.current.precipitation ?? 0), code: Number(data.current.weather_code ?? 0), wind: Number(data.current.wind_speed_10m ?? 0)
  };
}

function nearestTimeIndex(times, target) {
  let best = 0, bestDiff = Infinity;
  times.forEach((t, i) => {
    const d = Math.abs(new Date(`${t}Z`) - target);
    if (d < bestDiff) { best = i; bestDiff = d; }
  });
  return best;
}

async function searchDestination() {
  stopDrive();
  const query = els.destinationInput.value.trim();
  if (query.length < 2) return;
  state.destination = null; state.trip = null; els.tripSection.classList.add('hidden'); els.selectedDestination.classList.add('hidden');
  els.findBtn.disabled = true; els.findBtn.textContent = 'Finding...'; setStatus('');
  try {
    const q = new URLSearchParams({ name: query, count: '7', language: 'en', format: 'json' });
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${q}`);
    if (!res.ok) throw new Error(`Destination search returned ${res.status}.`);
    const data = await res.json();
    state.searchResults = (data.results || []).slice().sort((a, b) => destinationScore(b) - destinationScore(a));
    renderSearchResults();
    if (!state.searchResults.length) setStatus('No destination found. Try a city and state, such as Nashville, TN.', true);
  } catch (err) { setStatus(err.message || String(err), true); }
  finally { els.findBtn.disabled = false; els.findBtn.textContent = 'Find'; }
}

function renderSearchResults() {
  els.searchResults.innerHTML = state.searchResults.map((p, i) => {
    const display = [p.name, p.admin1, p.country].filter(Boolean).join(', ');
    return `<div class="result" data-index="${i}"><strong>${htmlEscape(p.name)}</strong><small>${htmlEscape(display)}</small></div>`;
  }).join('');
  els.searchResults.querySelectorAll('.result').forEach(el => el.addEventListener('click', () => selectDestination(Number(el.dataset.index))));
}

function selectDestination(index) {
  const p = state.searchResults[index];
  state.destination = { name: p.name, lat: p.latitude, lon: p.longitude, admin1: p.admin1, country: p.country };
  const display = [p.name, p.admin1, p.country].filter(Boolean).join(', ');
  els.destinationInput.value = display;
  els.searchResults.innerHTML = '';
  els.selectedDestination.classList.remove('hidden');
  els.selectedDestination.innerHTML = `<strong>📍 Destination selected</strong><div class="check-sub">${htmlEscape(display)}</div>`;
}

function setDepartureNow() {
  els.departureInput.value = '';
  els.departureLabel.textContent = 'Leaving now';
}
function selectedDeparture() {
  return els.departureInput.value ? new Date(els.departureInput.value) : new Date();
}
function updateDepartureLabel() {
  if (!els.departureInput.value) return setDepartureNow();
  const d = new Date(els.departureInput.value);
  els.departureLabel.textContent = d > new Date() ? fmtDateTime(d) : 'Leaving now';
  if (d <= new Date()) els.departureInput.value = '';
}

async function buildTrip() {
  stopDrive();
  if (!state.start) return setStatus('RoadCast needs your starting location first.', true);
  if (!state.destination) return setStatus('Choose a destination from the search results first.', true);
  const departure = selectedDeparture();
  if (departure - new Date() > 15 * 24 * 3600 * 1000) return setStatus('Choose a departure within the next 15 days for this MVP.', true);

  els.tripBtn.disabled = true; els.tripBtn.textContent = 'Building your route forecast...'; setStatus('Calculating route, arrival times, and weather checkpoints...');
  try {
    const route = await getRoute(state.start, state.destination);
    buildRouteMetrics(route);
    const count = Math.max(4, Math.min(8, Math.ceil(route.duration / 2700) + 1));
    const points = sampleRoute(route.points, count);
    const checkpoints = points.map((point, i) => {
      const progress = i / (count - 1);
      return { point, progress, eta: new Date(departure.getTime() + route.duration * progress * 1000) };
    });
    const weather = await getWeatherAtPoints(checkpoints.map(c => c.point), checkpoints.map(c => c.eta));
    checkpoints.forEach((c, i) => {
      c.weather = weather[i];
      c.label = i === 0 ? 'Start' : i === count - 1 ? state.destination.name : `Road checkpoint ${i}`;
    });
    state.route = route;
    state.trip = { route, checkpoints, departure, arrival: new Date(departure.getTime() + route.duration * 1000) };
    renderTrip(); setStatus('');
  } catch (err) { setStatus(err.message || String(err), true); }
  finally { els.tripBtn.disabled = false; els.tripBtn.textContent = '🚗 CHECK MY TRIP'; }
}

async function getRoute(start, dest) {
  const coords = `${start.lon},${start.lat};${dest.lon},${dest.lat}`;
  const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`);
  if (!res.ok) throw new Error(`Routing service returned ${res.status}.`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.message || 'No driving route was found.');
  const r = data.routes[0];
  return { distance: r.distance, duration: r.duration, points: r.geometry.coordinates.map(([lon, lat]) => ({lat, lon})) };
}

function haversine(a, b) {
  const R = 6371000, rad = d => d * Math.PI / 180;
  const lat1 = rad(a.lat), lat2 = rad(b.lat), dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}

function bearing(a, b) {
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const lat1 = rad(a.lat), lat2 = rad(b.lat), dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

function buildRouteMetrics(route) {
  route.cumulative = [0];
  let total = 0;
  for (let i = 1; i < route.points.length; i++) {
    total += haversine(route.points[i - 1], route.points[i]);
    route.cumulative.push(total);
  }
  route.polylineDistance = total;
}

function sampleRoute(route, count) {
  const cumulative = [0]; let total = 0;
  for (let i = 1; i < route.length; i++) { total += haversine(route[i-1], route[i]); cumulative.push(total); }
  const out = [];
  for (let n = 0; n < count; n++) {
    const target = total * (n / (count - 1)); let s = 1;
    while (s < cumulative.length && cumulative[s] < target) s++;
    if (s >= route.length) { out.push(route.at(-1)); continue; }
    const before = cumulative[s-1], after = cumulative[s], len = after - before;
    const f = len === 0 ? 0 : (target - before) / len, a = route[s-1], b = route[s];
    out.push({ lat: a.lat + (b.lat-a.lat)*f, lon: a.lon + (b.lon-a.lon)*f });
  }
  return out;
}

async function getWeatherAtPoints(points, targets) {
  const q = new URLSearchParams({
    latitude: points.map(p => p.lat).join(','), longitude: points.map(p => p.lon).join(','),
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch', timezone: 'GMT', forecast_days: '16'
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!res.ok) throw new Error(`Route weather service returned ${res.status}.`);
  const decoded = await res.json(); const locations = Array.isArray(decoded) ? decoded : [decoded];
  return locations.map((data, i) => {
    const idx = nearestTimeIndex(data.hourly.time, targets[i]); const h = data.hourly;
    return {
      time: new Date(`${h.time[idx]}Z`), temp: Number(h.temperature_2m[idx] ?? 0), feels: Number(h.apparent_temperature[idx] ?? 0),
      rainChance: Number(h.precipitation_probability[idx] ?? 0), rain: Number(h.precipitation[idx] ?? 0), code: Number(h.weather_code[idx] ?? 0), wind: Number(h.wind_speed_10m[idx] ?? 0)
    };
  });
}

function renderTrip() {
  const { route, checkpoints, arrival } = state.trip;
  els.tripSection.classList.remove('hidden');
  els.driveLaunch.classList.remove('hidden');
  els.tripStats.innerHTML = `<span class="pill">🛣️ ${miles(route.distance).toFixed(0)} mi</span><span class="pill">⏱️ ${durationText(route.duration)}</span><span class="pill">🏁 Arrive ${fmtTime(arrival)}</span>`;
  els.tripNavStrip?.classList.remove('hidden');
  if (els.tripNavOrigin) els.tripNavOrigin.textContent = 'Your location';
  if (els.tripNavDestination) els.tripNavDestination.textContent = state.destination?.name || 'Destination';
  renderMap(route, checkpoints); renderAlert(route, checkpoints); renderTimeline(route, checkpoints);
  els.tripSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderMap(route, checkpoints) {
  if (!state.map) {
    state.map = L.map('map', {
      zoomControl: true,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      inertia: false,
      trackResize: true
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
      updateWhenIdle: false,
      updateWhenZooming: false,
      keepBuffer: 4
    }).addTo(state.map);
    if (typeof ResizeObserver !== 'undefined') {
      state.mapResizeObserver = new ResizeObserver(() => {
        if (!state.map) return;
        requestAnimationFrame(() => state.map?.invalidateSize({ pan: false, animate: false }));
      });
      state.mapResizeObserver.observe(els.map);
    }
    state.map.on('dragstart', () => {
      if (state.driveActive) {
        state.driveFollow = false;
        updateFollowButton();
      }
    });
  }
  if (state.routeLayer) state.map.removeLayer(state.routeLayer);
  if (state.markerLayer) state.map.removeLayer(state.markerLayer);
  const latlngs = route.points.map(p => [p.lat, p.lon]);
  state.routeLayer = L.polyline(latlngs, { color: '#2f80ed', weight: 6, opacity: .95 }).addTo(state.map);
  state.markerLayer = L.layerGroup().addTo(state.map);
  checkpoints.forEach(c => {
    const [icon, label] = codeInfo(c.weather.code);
    const markerIcon = L.divIcon({ className: '', html: `<div style="width:46px;height:46px;border-radius:50%;background:#fff;border:3px solid #0b1f3a;display:grid;place-items:center;font-size:23px;box-shadow:0 4px 12px #0005">${icon}</div>`, iconSize: [46,46], iconAnchor: [23,23] });
    L.marker([c.point.lat, c.point.lon], { icon: markerIcon }).bindPopup(`<strong>${htmlEscape(c.label)}</strong><br>${fmtTime(c.eta)}<br>${Math.round(c.weather.temp)}°F • ${label}<br>Rain ${c.weather.rainChance}%`).addTo(state.markerLayer);
  });
  const firstPoint = route.points[0];
  const lastPoint = route.points.at(-1);
  const startIcon = L.divIcon({
    className: '',
    html: `<div class="route-endpoint"><div class="route-endpoint-pin">📍</div><div class="route-endpoint-label">START / YOU</div></div>`,
    iconSize: [100, 58], iconAnchor: [50, 29]
  });
  const destinationIcon = L.divIcon({
    className: '',
    html: `<div class="route-endpoint destination"><div class="route-endpoint-pin">🏁</div><div class="route-endpoint-label">${htmlEscape(state.destination?.name || 'DESTINATION')}</div></div>`,
    iconSize: [150, 58], iconAnchor: [75, 29]
  });
  L.marker([firstPoint.lat, firstPoint.lon], { icon: startIcon, zIndexOffset: 900 }).addTo(state.markerLayer);
  L.marker([lastPoint.lat, lastPoint.lon], { icon: destinationIcon, zIndexOffset: 900 }).addTo(state.markerLayer);
  const previewBounds = state.routeLayer.getBounds();
  requestAnimationFrame(() => {
    state.map.invalidateSize({ pan: false, animate: false });
    state.map.fitBounds(previewBounds, { padding: [28,28], animate: false });
    setTimeout(() => {
      state.map.invalidateSize({ pan: false, animate: false });
      state.map.fitBounds(previewBounds, { padding: [28,28], animate: false });
    }, 250);
  });
}

function renderAlert(route, checkpoints) {
  let best = null, bestScore = -1;
  checkpoints.slice(1).forEach(c => {
    const [, , severity] = codeInfo(c.weather.code);
    const score = severity * 30 + c.weather.rainChance + (c.weather.wind >= 30 ? 30 : 0);
    if (score > bestScore) { bestScore = score; best = c; }
  });
  if (!best) return;
  const [icon, label, severity] = codeInfo(best.weather.code);
  const warn = severity >= 2 || best.weather.rainChance >= 60 || best.weather.wind >= 30;
  els.weatherAlert.classList.toggle('severe', warn && severity >= 3);
  if (!warn) {
    els.weatherAlert.innerHTML = '<strong>✅ Road weather looks fairly calm</strong><div class="check-sub">RoadCast did not find a major weather concern on this route forecast.</div>';
  } else {
    const mi = miles(route.distance) * best.progress;
    const extra = best.weather.wind >= 30 ? `Winds near ${Math.round(best.weather.wind)} mph are forecast.` : `Rain chance is ${best.weather.rainChance}%.`;
    els.weatherAlert.innerHTML = `<strong>${icon} ${label} ahead</strong><div class="check-sub">Around mile ${Math.round(mi)} of your trip near ${fmtTime(best.eta)}. ${extra}</div>`;
  }
}

function renderTimeline(route, checkpoints) {
  els.timeline.innerHTML = checkpoints.map((c, i) => {
    const [icon, label] = codeInfo(c.weather.code), mi = miles(route.distance) * c.progress;
    return `<div class="checkpoint"><div class="check-marker"><div class="dot"></div>${i < checkpoints.length-1 ? '<div class="line"></div>' : ''}</div><div class="check-card"><div class="check-icon">${icon}</div><div><div class="check-title">${htmlEscape(c.label)}</div><div class="check-sub">${fmtTime(c.eta)} • ${Math.round(mi)} mi from start</div><div>${Math.round(c.weather.temp)}°F • ${label} • Rain ${c.weather.rainChance}% • Wind ${Math.round(c.weather.wind)} mph</div></div></div></div>`;
  }).join('');
}

function locateOnRoute(route, raw) {
  if (!route.cumulative) buildRouteMetrics(route);
  const R = 6371000;
  const rad = d => d * Math.PI / 180;
  const cosLat = Math.max(0.01, Math.abs(Math.cos(rad(raw.lat))));
  let best = { distance: Infinity, point: route.points[0], along: 0, segmentIndex: 0, heading: 0 };

  for (let i = 0; i < route.points.length - 1; i++) {
    const a = route.points[i], b = route.points[i + 1];
    const ax = rad(a.lon - raw.lon) * R * cosLat;
    const ay = rad(a.lat - raw.lat) * R;
    const bx = rad(b.lon - raw.lon) * R * cosLat;
    const by = rad(b.lat - raw.lat) * R;
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;
    const t = len2 ? clamp((-(ax * vx + ay * vy)) / len2, 0, 1) : 0;
    const cx = ax + vx * t, cy = ay + vy * t;
    const distance = Math.hypot(cx, cy);
    if (distance >= best.distance) continue;

    const point = {
      lat: raw.lat + (cy / R) * 180 / Math.PI,
      lon: raw.lon + (cx / (R * cosLat)) * 180 / Math.PI,
    };
    const segmentMeters = route.cumulative[i + 1] - route.cumulative[i];
    best = {
      distance,
      point,
      along: route.cumulative[i] + segmentMeters * t,
      segmentIndex: i,
      heading: bearing(a, b),
    };
  }

  const progress = route.polylineDistance ? clamp(best.along / route.polylineDistance, 0, 1) : 0;
  return {
    raw,
    snapped: best.point,
    progress,
    segmentIndex: best.segmentIndex,
    heading: best.heading,
    offRoute: best.distance,
    remaining: route.distance * (1 - progress),
  };
}

function pointAtProgress(route, progress) {
  if (!route.cumulative) buildRouteMetrics(route);
  const target = route.polylineDistance * clamp(progress, 0, 1);
  let s = 1;
  while (s < route.cumulative.length && route.cumulative[s] < target) s++;
  if (s >= route.points.length) return route.points.at(-1);
  const before = route.cumulative[s - 1], after = route.cumulative[s], len = after - before;
  const f = len ? (target - before) / len : 0;
  const a = route.points[s - 1], b = route.points[s];
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

function routeHeadingAtProgress(route, progress) {
  const point = pointAtProgress(route, progress);
  return locateOnRoute(route, point).heading;
}

function vehicleIcon(heading, demo) {
  const symbol = demo ? '🚗' : '▲';
  const size = demo ? 25 : 27;
  return L.divIcon({
    className: '',
    html: `<div class="drive-vehicle-wrap"><div class="drive-vehicle"><div class="drive-arrow" style="font-size:${size}px;transform:rotate(${heading}deg)">${symbol}</div></div><div class="drive-vehicle-label">YOU</div></div>`,
    iconSize: [66, 76], iconAnchor: [33, 27]
  });
}

function startRoadCast(demoMode) {
  if (!state.trip || !state.map) return;
  stopDrive(false);
  state.driveActive = true;
  state.driveDemo = demoMode;
  state.drivePaused = false;
  state.driveFollow = true;
  state.demoFraction = 0;

  els.driveLaunch.classList.add('hidden');
  els.drivePanel.classList.remove('hidden');
  els.driveOverlay.classList.remove('hidden');
  els.pauseDemoBtn.classList.toggle('hidden', !demoMode);
  els.pauseDemoBtn.textContent = '⏸ Pause simulation';
  els.driveDestination.textContent = `YOU → ${state.destination?.name || 'Destination'}`;
  els.driveStatus.textContent = demoMode ? 'SIMULATED DRIVE • 45-second route demo' : 'LIVE GPS • location locked • waiting for movement';
  els.map.classList.add('driving');
  setTimeout(() => {
    state.map.invalidateSize({ pan: false, animate: false });
    const first = state.driveProgress?.snapped || state.trip.route.points[0];
    state.map.setView([first.lat, first.lon], 15, { animate: false });
  }, 320);

  if (state.routeLayer) {
    state.map.removeLayer(state.routeLayer);
    state.routeLayer = null;
  }
  state.drivePassedLayer = L.polyline([], { color: '#65758a', weight: 7, opacity: .72 }).addTo(state.map);
  state.driveRemainingLayer = L.polyline([], { color: '#2f80ed', weight: 8, opacity: 1 }).addTo(state.map);
  state.driveCarMarker = L.marker([state.trip.route.points[0].lat, state.trip.route.points[0].lon], {
    icon: vehicleIcon(0, demoMode), zIndexOffset: 1000,
  }).addTo(state.map);

  updateFollowButton();

  if (demoMode) {
    state.demoFraction = 0;
    state.driveTimer = setInterval(() => {
      if (!state.driveActive || state.drivePaused) return;
      state.demoFraction = clamp(state.demoFraction + (0.25 / 45), 0, 1);
      const point = pointAtProgress(state.trip.route, state.demoFraction);
      const heading = routeHeadingAtProgress(state.trip.route, state.demoFraction);
      const avgSpeed = state.trip.route.duration > 0 ? state.trip.route.distance / state.trip.route.duration : 0;
      updateDrivePosition(point, heading, avgSpeed, true);
      if (state.demoFraction >= .999) {
        clearInterval(state.driveTimer);
        state.driveTimer = null;
      }
    }, 250);
    updateDrivePosition(state.trip.route.points[0], routeHeadingAtProgress(state.trip.route, 0), 0, true);
  } else if (navigator.geolocation) {
    state.driveWatchId = navigator.geolocation.watchPosition(
      pos => {
        const raw = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        updateDrivePosition(raw, pos.coords.heading, pos.coords.speed, false);
      },
      err => {
        els.driveStatus.textContent = `GPS unavailable: ${err.message || 'location error'}. Try Simulate Drive.`;
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
    navigator.geolocation.getCurrentPosition(
      pos => {
        const raw = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        updateDrivePosition(raw, pos.coords.heading, pos.coords.speed, false);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
    );
  } else {
    els.driveStatus.textContent = 'This browser does not provide live GPS. Use Simulate Drive.';
  }

  els.map.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updateDrivePosition(raw, gpsHeading, speedMps, demoMode) {
  if (!state.driveActive || !state.trip) return;
  const route = state.trip.route;
  const located = locateOnRoute(route, raw);
  state.driveProgress = located;

  const validGpsHeading = Number.isFinite(gpsHeading) && gpsHeading >= 0 && Number(speedMps || 0) > 1.2;
  const heading = validGpsHeading ? gpsHeading : located.heading;
  const displayPoint = (!demoMode && located.offRoute > 200) ? raw : located.snapped;

  if (state.driveCarMarker) {
    state.driveCarMarker.setLatLng([displayPoint.lat, displayPoint.lon]);
    state.driveCarMarker.setIcon(vehicleIcon(heading, demoMode));
  }

  const passed = route.points.slice(0, located.segmentIndex + 1).concat([located.snapped]);
  const remaining = [located.snapped].concat(route.points.slice(located.segmentIndex + 1));
  state.drivePassedLayer?.setLatLngs(passed.map(p => [p.lat, p.lon]));
  state.driveRemainingLayer?.setLatLngs(remaining.map(p => [p.lat, p.lon]));

  if (state.driveFollow) {
    state.map.invalidateSize({ pan: false, animate: false });
    state.map.setView([displayPoint.lat, displayPoint.lon], 15, { animate: false });
  }

  const remainingSeconds = route.duration * (1 - located.progress);
  const eta = new Date(Date.now() + remainingSeconds * 1000);
  els.driveRemaining.textContent = `${miles(located.remaining).toFixed(miles(located.remaining) < 10 ? 1 : 0)} mi`;
  els.driveEta.textContent = fmtTime(eta);
  els.driveSpeed.textContent = `${Math.max(0, Number(speedMps || 0) * 2.236936).toFixed(0)} mph`;
  els.driveProgressBar.style.width = `${(located.progress * 100).toFixed(1)}%`;

  if (located.progress >= .997 || located.remaining < 90) {
    els.driveStatus.textContent = `ARRIVED • ${state.destination?.name || 'Destination'}`;
  } else if (demoMode) {
    els.driveStatus.textContent = state.drivePaused ? 'SIMULATION PAUSED' : 'SIMULATED DRIVE • movement preview';
  } else {
    const motion = Number(speedMps || 0) > 0.5 ? 'moving' : 'waiting for movement';
    els.driveStatus.textContent = `LIVE GPS • ${located.offRoute < 120 ? 'on route' : 'checking route'} • ${motion}`;
  }

  updateDriveAlert(located, demoMode);
}

function updateDriveAlert(located, demoMode) {
  if (!state.trip) return;
  let icon = '✅', title = 'Road weather ahead looks calm', detail = 'No major weather concern is showing on the remaining checkpoints.', severe = false;

  if (!demoMode && located.offRoute > 120) {
    icon = '↗️'; title = 'You appear to be off the planned route';
    detail = `${miles(located.offRoute).toFixed(1)} mi from the route. RoadCast is showing your actual GPS position.`;
    severe = true;
  } else if (located.progress >= .997) {
    icon = '🏁'; title = 'You have arrived'; detail = `Welcome to ${state.destination?.name || 'your destination'}.`;
  } else {
    for (const c of state.trip.checkpoints) {
      if (c.progress <= located.progress + .01) continue;
      const [candidateIcon, label, severity] = codeInfo(c.weather.code);
      const warn = severity >= 2 || c.weather.rainChance >= 60 || c.weather.wind >= 30;
      if (!warn) continue;
      const fractionAhead = c.progress - located.progress;
      const miAhead = miles(state.trip.route.distance) * fractionAhead;
      const encounter = new Date(Date.now() + state.trip.route.duration * fractionAhead * 1000);
      icon = candidateIcon; title = `${label} ahead`; severe = severity >= 3;
      detail = c.weather.wind >= 30
        ? `${miAhead.toFixed(miAhead < 10 ? 1 : 0)} mi ahead • about ${fmtTime(encounter)} • wind ${Math.round(c.weather.wind)} mph`
        : `${miAhead.toFixed(miAhead < 10 ? 1 : 0)} mi ahead • about ${fmtTime(encounter)} • rain ${c.weather.rainChance}%`;
      break;
    }
  }

  els.driveOverlayIcon.textContent = icon;
  els.driveOverlayTitle.textContent = title;
  els.driveOverlayDetail.textContent = detail;
  els.driveOverlay.classList.toggle('severe', severe);
}

function updateFollowButton() {
  els.followDriveBtn.textContent = state.driveFollow ? '◎ Following' : '◎ Follow me';
  els.followDriveBtn.classList.toggle('primary', state.driveFollow);
}

function followDrive() {
  state.driveFollow = true;
  updateFollowButton();
  if (state.driveProgress) {
    const p = state.driveProgress.offRoute > 200 && !state.driveDemo ? state.driveProgress.raw : state.driveProgress.snapped;
    state.map.invalidateSize({ pan: false, animate: false });
    state.map.setView([p.lat, p.lon], 15, { animate: false });
  }
}

function toggleDemoPause() {
  if (!state.driveDemo) return;
  state.drivePaused = !state.drivePaused;
  els.pauseDemoBtn.textContent = state.drivePaused ? '▶ Resume simulation' : '⏸ Pause simulation';
  els.driveStatus.textContent = state.drivePaused ? 'SIMULATION PAUSED' : 'SIMULATED DRIVE • movement preview';
}

function stopDrive(renderPreview = true) {
  if (state.driveWatchId != null && navigator.geolocation) navigator.geolocation.clearWatch(state.driveWatchId);
  if (state.driveTimer) clearInterval(state.driveTimer);
  state.driveWatchId = null;
  state.driveTimer = null;

  if (state.map) {
    if (state.driveCarMarker) state.map.removeLayer(state.driveCarMarker);
    if (state.drivePassedLayer) state.map.removeLayer(state.drivePassedLayer);
    if (state.driveRemainingLayer) state.map.removeLayer(state.driveRemainingLayer);
  }
  state.driveCarMarker = null;
  state.drivePassedLayer = null;
  state.driveRemainingLayer = null;
  state.driveActive = false;
  state.driveDemo = false;
  state.drivePaused = false;
  state.driveProgress = null;
  state.driveFollow = true;

  els.drivePanel.classList.add('hidden');
  els.driveOverlay.classList.add('hidden');
  els.map.classList.remove('driving');
  els.driveLaunch.classList.toggle('hidden', !state.trip);
  setTimeout(() => state.map?.invalidateSize({ pan: false, animate: false }), 260);

  if (renderPreview && state.trip && state.map) renderMap(state.trip.route, state.trip.checkpoints);
}

els.retryLocationBtn.addEventListener('click', loadLocation);
els.demoLocationBtn.addEventListener('click', () => useStart({ lat: 35.9606, lon: -83.9207 }).catch(err => setStatus(err.message, true)));
els.findBtn.addEventListener('click', searchDestination);
els.destinationInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchDestination(); });
els.destinationInput.addEventListener('input', () => { stopDrive(); state.destination = null; els.selectedDestination.classList.add('hidden'); els.tripSection.classList.add('hidden'); });
els.nowBtn.addEventListener('click', setDepartureNow);
els.departureInput.addEventListener('change', updateDepartureLabel);
els.tripBtn.addEventListener('click', buildTrip);
els.startDriveBtn.addEventListener('click', () => startRoadCast(false));
els.simulateDriveBtn.addEventListener('click', () => startRoadCast(true));
els.stopDriveBtn.addEventListener('click', () => stopDrive());
els.followDriveBtn.addEventListener('click', followDrive);
els.pauseDemoBtn.addEventListener('click', toggleDemoPause);

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installPrompt = e; els.installBtn.classList.remove('hidden'); });
els.installBtn.addEventListener('click', async () => {
  if (!state.installPrompt) return;
  state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; els.installBtn.classList.add('hidden');
});

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));

(function init() {
  const now = new Date(), max = new Date(now.getTime() + 15*24*3600*1000), pad = n => String(n).padStart(2,'0');
  const localValue = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  els.departureInput.min = localValue(now); els.departureInput.max = localValue(max);
  loadLocation();
})();
