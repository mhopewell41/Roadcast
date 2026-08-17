'use strict';

(() => {
  const VERSION = '0.7.0';
  const CONFIG_KEY = 'roadcast_voice_config_v1';
  const OPTIONS_KEY = 'roadcast_route_options_v1';

  const traffic = {
    fallbackGetRoute: getRoute,
    routes: [],
    usingGoogle: false,
    lastError: '',
    selectedIndex: 0,
    trafficLayer: null,
    alternateLayer: null,
    announcedTripKey: '',
  };

  function getBackendConfig() {
    try {
      const cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') || {};
      return {
        projectUrl: String(cfg.projectUrl || '').replace(/\/+$/, ''),
        token: String(cfg.token || ''),
      };
    } catch {
      return { projectUrl: '', token: '' };
    }
  }

  function getRouteOptions() {
    try {
      return {
        avoidTolls: false,
        avoidHighways: false,
        avoidFerries: false,
        ...(JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}') || {}),
      };
    } catch {
      return { avoidTolls: false, avoidHighways: false, avoidFerries: false };
    }
  }

  function saveRouteOptions(options) {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  }

  function seconds(value) {
    if (typeof value === 'number') return value;
    const match = String(value || '').match(/^([\d.]+)s$/);
    return match ? Number(match[1]) : 0;
  }

  function geoPoints(route) {
    const coords = route?.polyline?.geoJsonLinestring?.coordinates;
    if (!Array.isArray(coords)) return [];
    return coords
      .filter(c => Array.isArray(c) && c.length >= 2)
      .map(c => ({ lat: Number(c[1]), lon: Number(c[0]) }))
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  }

  function instructionRoadName(instruction) {
    const text = String(instruction || '')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Only accept a road name when the instruction explicitly introduces one.
    // Landmarks and POIs such as "turn at Pizza Inn" are intentionally ignored.
    const patterns = [
      /\bonto\s+(.+?)(?:\s+\(|,|;|$)/i,
      /\btoward\s+(.+?)(?:\s+\(|,|;|$)/i,
      /\bon\s+(.+?)(?:\s+\(|,|;|$)/i,
    ];

    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (!m?.[1]) continue;
      const road = m[1]
        .replace(/\([^)]*\)/g, '')
        .replace(/\bthen\b.*$/i, '')
        .replace(/[.,;]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (road && road.length <= 80) return road;
    }
    return '';
  }

  function googleManeuver(maneuver) {
    const m = String(maneuver || '').toUpperCase();
    if (m === 'DESTINATION') return { type: 'arrive', modifier: '' };
    if (m === 'DEPART') return { type: 'depart', modifier: 'straight' };
    if (m === 'TURN_LEFT') return { type: 'turn', modifier: 'left' };
    if (m === 'TURN_RIGHT') return { type: 'turn', modifier: 'right' };
    if (m === 'TURN_SLIGHT_LEFT') return { type: 'turn', modifier: 'slight left' };
    if (m === 'TURN_SLIGHT_RIGHT') return { type: 'turn', modifier: 'slight right' };
    if (m === 'TURN_SHARP_LEFT') return { type: 'turn', modifier: 'sharp left' };
    if (m === 'TURN_SHARP_RIGHT') return { type: 'turn', modifier: 'sharp right' };
    if (m === 'UTURN_LEFT') return { type: 'turn', modifier: 'uturn left' };
    if (m === 'UTURN_RIGHT') return { type: 'turn', modifier: 'uturn right' };
    if (m === 'MERGE') return { type: 'merge', modifier: 'straight' };
    if (m === 'FORK_LEFT') return { type: 'fork', modifier: 'left' };
    if (m === 'FORK_RIGHT') return { type: 'fork', modifier: 'right' };
    if (m === 'RAMP_LEFT') return { type: 'on ramp', modifier: 'left' };
    if (m === 'RAMP_RIGHT') return { type: 'on ramp', modifier: 'right' };
    if (m === 'ROUNDABOUT_LEFT') return { type: 'turn', modifier: 'left' };
    if (m === 'ROUNDABOUT_RIGHT') return { type: 'turn', modifier: 'right' };
    if (m === 'NAME_CHANGE') return { type: 'new name', modifier: 'straight' };
    if (m === 'STRAIGHT') return { type: 'continue', modifier: 'straight' };
    return { type: 'continue', modifier: 'straight' };
  }

  function normalizeStep(step) {
    const nav = step?.navigationInstruction || {};
    const mapped = googleManeuver(nav.maneuver);
    const ll = step?.startLocation?.latLng || {};
    const instructions = String(nav.instructions || '').replace(/\n+/g, ' ').trim();
    return {
      distance: Number(step?.distanceMeters || 0),
      duration: seconds(step?.staticDuration),
      name: instructionRoadName(instructions),
      ref: '',
      maneuver: {
        type: mapped.type,
        modifier: mapped.modifier,
        location: [Number(ll.longitude || 0), Number(ll.latitude || 0)],
      },
      _googleInstruction: instructions,
      _googleManeuver: nav.maneuver || '',
    };
  }

  function normalizeGoogleRoute(route, index) {
    const points = geoPoints(route);
    const steps = (route?.legs || []).flatMap(leg => (leg?.steps || []).map(normalizeStep));
    const duration = seconds(route?.duration);
    const staticDuration = seconds(route?.staticDuration);
    const intervals = route?.travelAdvisory?.speedReadingIntervals || [];
    const normalized = {
      distance: Number(route?.distanceMeters || 0),
      duration,
      staticDuration,
      points,
      steps,
      trafficIntervals: intervals.map(x => ({
        start: Number(x.startPolylinePointIndex || 0),
        end: Number(x.endPolylinePointIndex || 0),
        speed: String(x.speed || 'NORMAL'),
      })),
      routeLabels: Array.isArray(route?.routeLabels) ? route.routeLabels : [],
      source: 'google-traffic',
      googleIndex: index,
      trafficDelay: Math.max(0, duration - staticDuration),
    };
    buildRouteMetrics(normalized);
    return normalized;
  }

  async function fetchTrafficRoutes(start, dest, alternatives = true) {
    const cfg = getBackendConfig();
    if (!cfg.projectUrl || !cfg.token) throw new Error('RoadCast traffic backend is not configured.');

    const routeOptions = getRouteOptions();
    const response = await fetch(`${cfg.projectUrl}/functions/v1/roadcast-routes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-roadcast-token': cfg.token,
      },
      body: JSON.stringify({
        origin: { lat: Number(start.lat), lon: Number(start.lon) },
        destination: { lat: Number(dest.lat), lon: Number(dest.lon) },
        alternatives: !!alternatives,
        avoidTolls: !!routeOptions.avoidTolls,
        avoidHighways: !!routeOptions.avoidHighways,
        avoidFerries: !!routeOptions.avoidFerries,
      }),
    });

    if (!response.ok) {
      let detail = `Traffic routing returned ${response.status}.`;
      try {
        const j = await response.json();
        if (j?.error) detail = j.error;
      } catch {}
      throw new Error(detail);
    }

    const data = await response.json();
    const rows = (data?.routes || []).map(normalizeGoogleRoute)
      .filter(r => r.points.length >= 2 && r.distance > 0 && r.duration > 0);
    if (!rows.length) throw new Error('Traffic routing returned no usable route.');
    return rows;
  }

  function trafficStatus(text, stateName = '') {
    const el = document.getElementById('trafficStatus060');
    if (!el) return;
    el.textContent = text;
    el.dataset.state = stateName;
  }

  function ensureTrafficUi() {
    if (document.getElementById('routeOptions060')) return;
    const tripButton = document.getElementById('tripBtn');
    if (!tripButton) return;

    const panel = document.createElement('div');
    panel.id = 'routeOptions060';
    panel.className = 'route-options-060';
    panel.innerHTML = `
      <div class="route-options-title">
        <strong>🚦 Traffic-aware routing</strong>
        <span id="trafficStatus060">Standard routing available</span>
      </div>
      <div class="route-option-checks">
        <label><input id="avoidTolls060" type="checkbox"> Avoid tolls</label>
        <label><input id="avoidHighways060" type="checkbox"> Avoid highways</label>
        <label><input id="avoidFerries060" type="checkbox"> Avoid ferries</label>
      </div>`;
    tripButton.parentNode.insertBefore(panel, tripButton);

    const opts = getRouteOptions();
    document.getElementById('avoidTolls060').checked = !!opts.avoidTolls;
    document.getElementById('avoidHighways060').checked = !!opts.avoidHighways;
    document.getElementById('avoidFerries060').checked = !!opts.avoidFerries;

    ['avoidTolls060', 'avoidHighways060', 'avoidFerries060'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        saveRouteOptions({
          avoidTolls: document.getElementById('avoidTolls060').checked,
          avoidHighways: document.getElementById('avoidHighways060').checked,
          avoidFerries: document.getElementById('avoidFerries060').checked,
        });
        trafficStatus('Options changed • tap CHECK MY TRIP to recalculate', 'changed');
      });
    });

    const cfg = getBackendConfig();
    trafficStatus(
      cfg.projectUrl && cfg.token ? 'Ready for live traffic' : 'Traffic setup not finished • using standard routing',
      cfg.projectUrl && cfg.token ? 'ready' : 'fallback'
    );
  }

  const routeMinutes = route => Math.max(1, Math.round(Number(route?.duration || 0) / 60));
  const delayMinutes = route => Math.max(0, Math.round(Number(route?.trafficDelay || 0) / 60));
  const routeMiles = route => Number(route?.distance || 0) / 1609.344;
  const fastestDuration = () => traffic.routes.length ? Math.min(...traffic.routes.map(r => r.duration)) : 0;

  function clearTrafficLayers() {
    if (!state?.map) return;
    if (traffic.trafficLayer) {
      try { state.map.removeLayer(traffic.trafficLayer); } catch {}
      traffic.trafficLayer = null;
    }
    if (traffic.alternateLayer) {
      try { state.map.removeLayer(traffic.alternateLayer); } catch {}
      traffic.alternateLayer = null;
    }
  }

  function drawTrafficSegments(route) {
    clearTrafficLayers();
    if (!state?.map || route?.source !== 'google-traffic') return;

    traffic.alternateLayer = L.layerGroup().addTo(state.map);
    traffic.routes.forEach((alt, i) => {
      if (i === traffic.selectedIndex) return;
      L.polyline(alt.points.map(p => [p.lat, p.lon]), {
        color: '#8a96a8', weight: 5, opacity: .50, dashArray: '9 10'
      }).addTo(traffic.alternateLayer);
    });

    traffic.trafficLayer = L.layerGroup().addTo(state.map);
    const intervals = Array.isArray(route.trafficIntervals) ? route.trafficIntervals : [];
    if (!intervals.length) {
      L.polyline(route.points.map(p => [p.lat, p.lon]), {
        color: '#2f80ed', weight: 8, opacity: .95
      }).addTo(traffic.trafficLayer);
      return;
    }

    intervals.forEach(interval => {
      const start = Math.max(0, interval.start);
      const end = Math.min(route.points.length, Math.max(start + 2, interval.end + 1));
      const pts = route.points.slice(start, end);
      if (pts.length < 2) return;
      let color = '#37b26c';
      let weight = 8;
      if (interval.speed === 'SLOW') color = '#f3a52b';
      if (interval.speed === 'TRAFFIC_JAM') { color = '#e65353'; weight = 9; }
      L.polyline(pts.map(p => [p.lat, p.lon]), { color, weight, opacity: .95 })
        .addTo(traffic.trafficLayer);
    });
  }

  async function selectRoute(index) {
    if (state.driveActive) return;
    const route = traffic.routes[index];
    if (!route) return;
    traffic.selectedIndex = index;

    const departure = state.trip?.departure || selectedDeparture() || new Date();
    const count = Math.max(5, Math.min(10, Math.ceil(route.duration / 1800) + 1));
    const points = sampleRoute(route.points, count);
    const checkpoints = points.map((point, i) => {
      const progress = i / (count - 1);
      return { point, progress, eta: new Date(departure.getTime() + route.duration * progress * 1000) };
    });

    try {
      const weather = await getWeatherAtPoints(checkpoints.map(c => c.point), checkpoints.map(c => c.eta));
      checkpoints.forEach((c, i) => {
        c.weather = weather[i];
        c.label = i === 0 ? 'Start' : i === count - 1 ? state.destination.name : `Road checkpoint ${i}`;
      });
    } catch (err) {
      console.warn('RoadCast weather refresh for alternate route failed.', err);
      return;
    }

    state.route = route;
    state.trip = {
      route, checkpoints, departure,
      arrival: new Date(departure.getTime() + route.duration * 1000),
    };
    renderTrip();
  }

  function renderTrafficChoices() {
    let host = document.getElementById('trafficRoutes060');
    const stats = document.getElementById('tripStats');
    if (!stats) return;
    if (!host) {
      host = document.createElement('div');
      host.id = 'trafficRoutes060';
      host.className = 'traffic-routes-060';
      stats.parentNode.insertBefore(host, stats.nextSibling);
    }

    if (!traffic.usingGoogle || !traffic.routes.length) {
      host.innerHTML = `<div class="traffic-fallback-060"><strong>🛣️ Standard RoadCast route</strong><span>${traffic.lastError ? 'Live traffic unavailable right now.' : 'Live traffic is not configured yet.'}</span></div>`;
      return;
    }

    const fastest = fastestDuration();
    host.innerHTML = `
      <div class="traffic-legend-060">
        <span><i class="normal"></i> Moving</span>
        <span><i class="slow"></i> Slow</span>
        <span><i class="jam"></i> Jam</span>
      </div>
      <div class="traffic-route-cards-060">
        ${traffic.routes.map((route, i) => {
          const extra = Math.max(0, Math.round((route.duration - fastest) / 60));
          const delay = delayMinutes(route);
          const isDefault = route.routeLabels.includes('DEFAULT_ROUTE');
          const selected = i === traffic.selectedIndex;
          const label = isDefault ? 'Recommended' : extra ? `+${extra} min` : 'Similar ETA';
          return `<button class="traffic-route-card-060 ${selected ? 'selected' : ''}" data-route060="${i}" ${state.driveActive ? 'disabled' : ''}>
            <span class="route-card-label">${label}</span>
            <strong>${routeMinutes(route)} min</strong>
            <span>${routeMiles(route).toFixed(routeMiles(route) < 10 ? 1 : 0)} mi</span>
            <small>${delay ? `Traffic adds about ${delay} min` : 'Little traffic delay'}</small>
          </button>`;
        }).join('')}
      </div>`;

    host.querySelectorAll('[data-route060]').forEach(button => {
      button.addEventListener('click', () => selectRoute(Number(button.dataset.route060)));
    });
  }

  function maybeAnnounceTraffic(route) {
    if (!state.driveActive || route?.source !== 'google-traffic') return;
    const delay = delayMinutes(route);
    const key = `${state.destination?.name || ''}|${routeMinutes(route)}|${delay}`;
    if (traffic.announcedTripKey === key) return;
    traffic.announcedTripKey = key;
    if (delay >= 8) {
      window.RoadCastVoice?.speak(`Traffic is adding about ${delay} minutes to this trip. I will keep watching for a faster route.`, { category: 'traffic', dedupeMs: 300000 });
    } else if (delay >= 4) {
      window.RoadCastVoice?.speak(`There is some traffic ahead, adding roughly ${delay} minutes.`, { category: 'traffic', dedupeMs: 300000 });
    }
  }

  const priorGetRoute060 = getRoute;
  getRoute = async function(start, dest) {
    const wantAlternatives = !state.driveActive;
    try {
      trafficStatus('Checking live traffic…', 'loading');
      const rows = await fetchTrafficRoutes(start, dest, wantAlternatives);
      traffic.routes = rows;
      traffic.usingGoogle = true;
      traffic.lastError = '';
      traffic.selectedIndex = 0;
      trafficStatus(wantAlternatives && rows.length > 1 ? `${rows.length} traffic-aware routes found` : 'Traffic-aware route ready', 'ready');
      return rows[0];
    } catch (err) {
      console.warn('RoadCast Google traffic routing unavailable; falling back.', err);
      traffic.routes = [];
      traffic.usingGoogle = false;
      traffic.lastError = err?.message || String(err);
      traffic.selectedIndex = 0;
      trafficStatus('Live traffic unavailable • using standard routing', 'fallback');
      return priorGetRoute060(start, dest);
    }
  };

  const priorRenderTrip060 = renderTrip;
  renderTrip = function(...args) {
    const result = priorRenderTrip060(...args);
    renderTrafficChoices();
    drawTrafficSegments(state.trip?.route);
    return result;
  };

  const priorStartRoadCast060 = startRoadCast;
  startRoadCast = function(demoMode) {
    const result = priorStartRoadCast060(demoMode);
    renderTrafficChoices();
    drawTrafficSegments(state.trip?.route);
    maybeAnnounceTraffic(state.trip?.route);
    return result;
  };

  const priorStopDrive060 = stopDrive;
  stopDrive = function(...args) {
    clearTrafficLayers();
    traffic.announcedTripKey = '';
    return priorStopDrive060(...args);
  };

  ensureTrafficUi();
  const badge = document.querySelector('.badge');
  if (badge) badge.textContent = 'MVP 0.7';
  console.info(`RoadCast traffic-aware routing ${VERSION} loaded.`);
})();
