'use strict';

(() => {
  const VERSION = '0.4.4';
  const rotation = {
    bound: false,
    directionUp: true,
    lastHeading: 0,
    lastDemo: false,
    touching: false,
  };

  // Critical fix: leaflet-rotate checks the options passed directly into L.map().
  // Inject rotate/touchRotate into the constructor before RoadCast creates its map.
  if (window.L?.map && !L.__roadcastRotationConstructorFixed) {
    L.__roadcastRotationConstructorFixed = true;
    const originalMapFactory = L.map;
    L.map = function(id, options = {}) {
      return originalMapFactory.call(L, id, {
        ...options,
        rotate: true,
        bearing: Number(options.bearing || 0),
        touchZoom: true,
        touchRotate: true,
        bounceAtZoomLimits: false,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
      });
    };
  }

  function bearing() {
    try { return Number(state?.map?.getBearing?.() || 0); }
    catch { return 0; }
  }

  function setBearing(value) {
    try {
      if (!state?.map?.setBearing) return;
      state.map.setBearing(Number(value || 0));
      if (state.driveCarMarker) {
        state.driveCarMarker.setIcon(vehicleIcon(rotation.lastHeading, rotation.lastDemo));
      }
    } catch (err) {
      console.warn('RoadCast rotation command failed', err);
    }
  }

  function updateModeButton() {
    const btn = document.getElementById('directionUp044');
    if (!btn) return;
    btn.textContent = rotation.directionUp ? '⬆ Direction Up' : '🧭 Free Rotate';
    btn.classList.toggle('primary', rotation.directionUp);
  }

  function releaseDirectionUp() {
    rotation.directionUp = false;
    updateModeButton();
  }

  function applyDirectionUp() {
    if (!rotation.directionUp || !state?.driveActive || !state?.driveFollow) return;
    setBearing(-Number(rotation.lastHeading || 0));
  }

  function ensureControls() {
    const wrap = document.querySelector('.map-wrap');
    if (!wrap || document.getElementById('rotateControls044')) return;

    const controls = document.createElement('div');
    controls.id = 'rotateControls044';
    controls.className = 'rotate-controls-044 hidden';
    controls.innerHTML = `
      <button id="rotateLeft044" type="button" aria-label="Rotate map left">↺</button>
      <button id="directionUp044" type="button">⬆ Direction Up</button>
      <button id="rotateRight044" type="button" aria-label="Rotate map right">↻</button>
    `;
    wrap.appendChild(controls);

    const style = document.createElement('style');
    style.textContent = `
      #map.leaflet-container { touch-action: none !important; }
      .rotate-controls-044 {
        position:absolute; z-index:742; left:62px; bottom:10px;
        display:flex; align-items:center; gap:5px;
      }
      .rotate-controls-044 button {
        padding:8px 10px; border-radius:999px;
        background:rgba(8,20,35,.96); color:#fff;
        border:1px solid rgba(255,255,255,.35);
        box-shadow:0 4px 14px rgba(0,0,0,.30); font-size:11px;
      }
      .rotate-controls-044 #rotateLeft044,
      .rotate-controls-044 #rotateRight044 {
        width:38px; height:38px; padding:0; font-size:20px;
      }
      @media (max-width:620px) {
        .rotate-controls-044 { left:58px; bottom:8px; gap:4px; }
        .rotate-controls-044 button { padding:7px 8px; font-size:10px; }
        .rotate-controls-044 #rotateLeft044,
        .rotate-controls-044 #rotateRight044 { width:35px; height:35px; font-size:18px; }
      }
    `;
    document.head.appendChild(style);

    document.getElementById('rotateLeft044').addEventListener('click', () => {
      releaseDirectionUp();
      setBearing(bearing() - 15);
    });

    document.getElementById('rotateRight044').addEventListener('click', () => {
      releaseDirectionUp();
      setBearing(bearing() + 15);
    });

    document.getElementById('directionUp044').addEventListener('click', () => {
      rotation.directionUp = !rotation.directionUp;
      updateModeButton();
      if (rotation.directionUp) applyDirectionUp();
    });

    updateModeButton();
  }

  function bindMap() {
    if (!state?.map || rotation.bound) return;
    rotation.bound = true;
    ensureControls();

    try {
      state.map.touchZoom?.enable?.();
      state.map.touchRotate?.enable?.();
      state.map.touchGestures?.enable?.();
      if (state.map.touchGestures) {
        state.map.touchGestures.zoom = true;
        state.map.touchGestures.rotate = true;
      }
    } catch (err) {
      console.warn('RoadCast touch rotation setup skipped', err);
    }

    const container = state.map.getContainer?.();
    if (container) {
      container.addEventListener('touchstart', event => {
        if (event.touches?.length === 2) {
          rotation.touching = true;
          releaseDirectionUp();
        }
      }, { passive: true });
      container.addEventListener('touchend', () => {
        setTimeout(() => { rotation.touching = false; }, 120);
      }, { passive: true });
    }
  }

  const priorRenderMap044 = renderMap;
  renderMap = function(...args) {
    const result = priorRenderMap044(...args);
    bindMap();
    return result;
  };

  const priorStart044 = startRoadCast;
  startRoadCast = function(demoMode) {
    rotation.directionUp = true;
    const result = priorStart044(demoMode);
    bindMap();
    document.getElementById('rotateControls044')?.classList.remove('hidden');
    updateModeButton();
    setTimeout(applyDirectionUp, 500);
    return result;
  };

  const priorUpdate044 = updateDrivePosition;
  updateDrivePosition = function(raw, gpsHeading, speedMps, demoMode) {
    const result = priorUpdate044(raw, gpsHeading, speedMps, demoMode);

    if (state?.driveProgress) {
      const validGps = Number.isFinite(Number(gpsHeading)) && Number(gpsHeading) >= 0 && Number(speedMps || 0) > 1.2;
      rotation.lastHeading = validGps ? Number(gpsHeading) : Number(state.driveProgress.heading || rotation.lastHeading || 0);
      rotation.lastDemo = !!demoMode;
      if (!rotation.touching) applyDirectionUp();
    }

    return result;
  };

  // RECENTER returns to the forward navigation view.
  document.getElementById('recenterMapBtn')?.addEventListener('click', () => {
    setTimeout(() => {
      if (!state?.driveActive) return;
      rotation.directionUp = true;
      updateModeButton();
      applyDirectionUp();
    }, 30);
  });

  const badge = document.querySelector('.badge');
  if (badge) badge.textContent = 'MVP 0.4.4';

  console.info(`RoadCast rotation constructor fix ${VERSION} loaded.`);
})();
