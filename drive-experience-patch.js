'use strict';

(() => {
  const VERSION = '0.4.1';
  const WEATHER_REFRESH_MS = 10 * 60 * 1000;

  const ux = {
    mapBound: false,
    previewing: false,
    lastVisualHeading: null,
    lastWeatherRefresh: Date.now(),
    weatherRefreshing: false,
    testWeatherUntil: 0,
    testWeatherTimer: null,
  };

  const $x = id => document.getElementById(id);
  const ui = {
    recenter: $x('recenterMapBtn'),
    previewHint: $x('routePreviewHint'),
    routeOverview: $x('routeOverviewBtn'),
    weatherTest: $x('weatherTestBtn'),
    weatherRefreshStatus: $x('weatherRefreshStatus'),
  };

  function shortestAngle(from, to) {
    return ((to - from + 540) % 360) - 180;
  }

  function smoothHeading(next) {
    const value = Number.isFinite(Number(next)) ? Number(next) : 0;
    if (ux.lastVisualHeading == null) {
      ux.lastVisualHeading = value;
      return value;
    }
    const delta = shortestAngle(ux.lastVisualHeading, value);
    const factor = Math.abs(delta) > 55 ? 0.72 : 0.42;
    ux.lastVisualHeading = (ux.lastVisualHeading + delta * factor + 360) % 360;
    return ux.lastVisualHeading;
  }

  // Replace the triangle/emoji with a top-down car that rotates to travel heading.
  vehicleIcon = function(heading, demoMode) {
    const h = smoothHeading(heading);
    const body = demoMode ? '#78b2ff' : '#2f80ed';
    return L.divIcon({
      className: '',
      html: `
        <div class="drive-car-wrap">
          <div class="drive-car-heading" style="transform:rotate(${h.toFixed(1)}deg)">
            <svg class="drive-car-svg" viewBox="0 0 48 58" aria-hidden="true">
              <path d="M24 1 L30 8 H18 Z" fill="#ffffff" stroke="#0b1f3a" stroke-width="1.5"/>
              <rect x="10" y="7" width="28" height="45" rx="9" fill="${body}" stroke="#ffffff" stroke-width="3"/>
              <path d="M15 16 Q24 11 33 16 L31 25 H17 Z" fill="#bfe0ff" stroke="#0b1f3a" stroke-width="1.2"/>
              <path d="M16 34 H32 L34 43 Q24 48 14 43 Z" fill="#10345f" opacity=".88"/>
              <rect x="6" y="14" width="5" height="12" rx="2.5" fill="#0b1f3a"/>
              <rect x="37" y="14" width="5" height="12" rx="2.5" fill="#0b1f3a"/>
              <rect x="6" y="34" width="5" height="12" rx="2.5" fill="#0b1f3a"/>
              <rect x="37" y="34" width="5" height="12" rx="2.5" fill="#0b1f3a"/>
              <circle cx="17" cy="12" r="2" fill="#fff6b8"/>
              <circle cx="31" cy="12" r="2" fill="#fff6b8"/>
            </svg>
          </div>
          <div class="drive-car-label">YOU</div>
        </div>`,
      iconSize: [68, 80],
      iconAnchor: [34, 31],
    });
  };

  function setPreviewMode(on) {
    ux.previewing = !!on;
    if (state.driveActive && on) {
      state.driveFollow = false;
      try { updateFollowButton(); } catch {}
    }
    ui.recenter?.classList.toggle('hidden', !on || !state.driveActive);
    ui.previewHint?.classList.toggle('hidden', !on || !state.driveActive);
    ui.routeOverview?.classList.toggle('preview-active', !!on);
  }

  function bindMapPreview() {
    if (!state.map || ux.mapBound) return;
    ux.mapBound = true;

    state.map.on('dragstart', () => {
      if (state.driveActive) setPreviewMode(true);
    });

    state.map.on('zoomstart', e => {
      if (state.driveActive && e?.originalEvent) setPreviewMode(true);
    });
  }

  const priorRenderMap041 = renderMap;
  renderMap = function(...args) {
    const result = priorRenderMap041(...args);
    bindMapPreview();
    return result;
  };

  function recenter() {
    if (!state.driveActive) return;
    state.driveFollow = true;
    try { updateFollowButton(); } catch {}
    setPreviewMode(false);
    if (state.driveProgress && state.map) {
      const p = state.driveProgress.offRoute > 200 && !state.driveDemo
        ? state.driveProgress.raw
        : state.driveProgress.snapped;
      state.map.invalidateSize({ pan: false, animate: false });
      state.map.setView([p.lat, p.lon], Math.max(15, state.map.getZoom()), { animate: true });
    }
  }

  function routeOverview() {
    if (!state.driveActive || !state.trip || !state.map) return;
    setPreviewMode(true);
    const route = state.trip.route;
    const idx = Math.max(0, state.driveProgress?.segmentIndex || 0);
    const remaining = route.points.slice(idx);
    if (remaining.length < 2) return;
    const bounds = L.latLngBounds(remaining.map(p => [p.lat, p.lon]));
    state.map.invalidateSize({ pan: false, animate: false });
    state.map.fitBounds(bounds, { padding: [34, 34], animate: true, maxZoom: 14 });
  }

  function weatherStatus(text) {
    if (ui.weatherRefreshStatus) ui.weatherRefreshStatus.textContent = text;
  }

  function checkpointLabel(i, count) {
    if (i === 0) return 'Current position';
    if (i === count - 1) return state.destination?.name || 'Destination';
    return `Weather ahead ${i}`;
  }

  async function refreshDriveWeather(force = false) {
    if (!state.driveActive || !state.trip || ux.weatherRefreshing) return;
    if (!force && Date.now() - ux.lastWeatherRefresh < WEATHER_REFRESH_MS) return;

    ux.weatherRefreshing = true;
    weatherStatus('🌦️ Refreshing weather along the road ahead…');
    try {
      const route = state.trip.route;
      const current = Math.min(0.995, Math.max(0, state.driveProgress?.progress || 0));
      const count = 6;
      const progresses = Array.from({ length: count }, (_, i) =>
        current + (1 - current) * (i / (count - 1))
      );
      const points = progresses.map(p => pointAtProgress(route, p));
      const targets = progresses.map(p =>
        new Date(Date.now() + route.duration * Math.max(0, p - current) * 1000)
      );
      const weather = await getWeatherAtPoints(points, targets);

      state.trip.checkpoints = progresses.map((progress, i) => ({
        point: points[i],
        progress,
        eta: targets[i],
        weather: weather[i],
        label: checkpointLabel(i, count),
      }));

      ux.lastWeatherRefresh = Date.now();
      const when = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date());
      weatherStatus(`🌦️ Live route weather refreshed ${when} • next refresh in 10 min`);

      try { renderAlert(route, state.trip.checkpoints); } catch {}
      try { renderTimeline(route, state.trip.checkpoints); } catch {}
      if (state.driveProgress) {
        try { updateDriveAlert(state.driveProgress, state.driveDemo); } catch {}
      }
    } catch (err) {
      console.warn('RoadCast live weather refresh failed.', err);
      weatherStatus('🌦️ Weather refresh delayed • RoadCast will try again');
    } finally {
      ux.weatherRefreshing = false;
    }
  }

  function testWeatherAlert() {
    if (!state.driveActive) return;
    ux.testWeatherUntil = Date.now() + 10000;
    clearTimeout(ux.testWeatherTimer);

    ui.weatherTest?.classList.add('testing');
    if (els.driveOverlay) els.driveOverlay.classList.remove('hidden');
    if (els.driveOverlayIcon) els.driveOverlayIcon.textContent = '🌩️';
    if (els.driveOverlayTitle) els.driveOverlayTitle.textContent = 'TEST • Heavy rain ahead';
    if (els.driveOverlayDetail) els.driveOverlayDetail.textContent = '8.0 mi ahead • RoadCast weather warning test';
    els.driveOverlay?.classList.add('severe');

    window.RoadCastVoice?.speak(
      'Weather test. Heavy rain begins approximately 8 miles ahead. RoadCast estimates you will reach it in about 10 minutes.',
      { priority: true, dedupeMs: 1000 }
    );

    ux.testWeatherTimer = setTimeout(() => {
      ux.testWeatherUntil = 0;
      ui.weatherTest?.classList.remove('testing');
      if (state.driveActive && state.driveProgress) {
        try { updateDriveAlert(state.driveProgress, state.driveDemo); } catch {}
      }
    }, 10000);
  }

  const priorDriveAlert041 = updateDriveAlert;
  updateDriveAlert = function(located, demoMode) {
    if (Date.now() < ux.testWeatherUntil) return;
    return priorDriveAlert041(located, demoMode);
  };

  const priorStartRoadCast041 = startRoadCast;
  startRoadCast = function(demoMode) {
    ux.lastVisualHeading = null;
    ux.lastWeatherRefresh = Date.now();
    const result = priorStartRoadCast041(demoMode);
    bindMapPreview();
    setPreviewMode(false);
    weatherStatus('🌦️ Route weather loaded • refreshes every 10 min while driving');
    return result;
  };

  ui.recenter?.addEventListener('click', recenter);
  ui.routeOverview?.addEventListener('click', routeOverview);
  ui.weatherTest?.addEventListener('click', testWeatherAlert);

  document.getElementById('followDriveBtn')?.addEventListener('click', () => {
    setTimeout(() => {
      if (state.driveFollow) setPreviewMode(false);
    }, 0);
  });

  setInterval(() => refreshDriveWeather(false), 60 * 1000);

  const badge = document.querySelector('.badge');
  if (badge) badge.textContent = 'MVP 0.4.1';

  console.info(`RoadCast drive experience patch ${VERSION} loaded.`);
})();
