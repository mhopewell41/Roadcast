'use strict';

(() => {
  const VERSION = '0.4.3';

  const gesture = {
    mapBound: false,
    lastHeading: 0,
    lastDemo: false,
    lastBearing: 0,
  };

  // leaflet-rotate adds these options to Leaflet. Merge them into defaults
  // before RoadCast creates the map for the first trip.
  if (window.L?.Map?.mergeOptions) {
    L.Map.mergeOptions({
      rotate: true,
      bearing: 0,
      touchZoom: true,
      touchRotate: true,
      rotateControl: false,
      shiftKeyRotate: false,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      bounceAtZoomLimits: false,
    });
  }

  function currentBearing() {
    try {
      return state?.map?.getBearing ? Number(state.map.getBearing() || 0) : 0;
    } catch {
      return 0;
    }
  }

  function normalizeBearing(value) {
    let v = Number(value || 0) % 360;
    if (v < 0) v += 360;
    return v;
  }

  function refreshCarForMapBearing() {
    if (!state?.driveCarMarker || typeof state.driveCarMarker.setIcon !== 'function') return;
    try {
      state.driveCarMarker.setIcon(vehicleIcon(gesture.lastHeading, gesture.lastDemo));
    } catch (err) {
      console.warn('RoadCast could not refresh vehicle rotation.', err);
    }
  }

  // The car already rotates to its geographic travel heading.
  // When the map itself is rotated, add the map bearing so the car remains
  // visually aligned with the rotated road.
  const priorVehicleIcon043 = vehicleIcon;
  vehicleIcon = function(heading, demoMode) {
    gesture.lastHeading = Number.isFinite(Number(heading)) ? Number(heading) : 0;
    gesture.lastDemo = !!demoMode;

    const icon = priorVehicleIcon043(heading, demoMode);
    const bearing = currentBearing();

    try {
      if (icon?.options?.html && Math.abs(bearing) > 0.01) {
        icon.options.html = icon.options.html.replace(
          /transform:rotate\(([-+]?\d+(?:\.\d+)?)deg\)/,
          (_, deg) => {
            const adjusted = Number(deg) + bearing;
            return `transform:rotate(${adjusted.toFixed(1)}deg)`;
          }
        );
      }
    } catch (err) {
      console.warn('RoadCast car bearing adjustment skipped.', err);
    }
    return icon;
  };

  function ensureInteractionUi() {
    const wrap = document.querySelector('.map-wrap');
    if (!wrap) return;

    if (!document.getElementById('mapCompassBtn')) {
      const btn = document.createElement('button');
      btn.id = 'mapCompassBtn';
      btn.type = 'button';
      btn.className = 'map-compass-btn hidden';
      btn.setAttribute('aria-label', 'Reset map so north is up');
      btn.innerHTML = '<span class="map-compass-arrow">↑</span><span class="map-compass-n">N</span>';
      wrap.appendChild(btn);

      btn.addEventListener('click', () => {
        if (!state?.map?.setBearing) return;
        state.map.setBearing(0);
        gesture.lastBearing = 0;
        updateCompass();
        refreshCarForMapBearing();
      });
    }

    if (!document.getElementById('gestureHint')) {
      const hint = document.createElement('div');
      hint.id = 'gestureHint';
      hint.className = 'gesture-hint hidden';
      hint.textContent = 'Two fingers: pinch to zoom • twist to rotate';
      wrap.appendChild(hint);
    }

    if (!document.getElementById('roadcastGestureStyles')) {
      const style = document.createElement('style');
      style.id = 'roadcastGestureStyles';
      style.textContent = `
        .map-compass-btn {
          position: absolute;
          z-index: 735;
          left: 10px;
          bottom: 14px;
          width: 48px;
          height: 48px;
          padding: 0;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: rgba(8,20,35,.96);
          border: 2px solid rgba(255,255,255,.84);
          color: #fff;
          box-shadow: 0 5px 18px rgba(0,0,0,.38);
        }
        .map-compass-arrow {
          position: absolute;
          font-size: 24px;
          line-height: 1;
          transform-origin: 50% 58%;
          transition: transform .12s linear;
        }
        .map-compass-n {
          position: absolute;
          top: 4px;
          right: 6px;
          font-size: 9px;
          font-weight: 900;
          opacity: .9;
        }
        .gesture-hint {
          position: absolute;
          z-index: 725;
          left: 66px;
          bottom: 18px;
          max-width: calc(100% - 210px);
          padding: 7px 10px;
          border-radius: 999px;
          background: rgba(8,20,35,.90);
          border: 1px solid rgba(255,255,255,.16);
          color: #e8f1ff;
          font-size: 11px;
          pointer-events: none;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @media (max-width: 620px) {
          .map-compass-btn {
            left: 8px;
            bottom: 10px;
            width: 46px;
            height: 46px;
          }
          .gesture-hint {
            left: 61px;
            right: 118px;
            bottom: 13px;
            max-width: none;
          }
        }
      `;
      document.head.appendChild(style);
    }
  }

  function updateCompass() {
    const btn = document.getElementById('mapCompassBtn');
    const arrow = btn?.querySelector('.map-compass-arrow');
    const bearing = normalizeBearing(currentBearing());
    gesture.lastBearing = bearing;

    if (arrow) {
      // Arrow continues to indicate geographic north as the map turns.
      arrow.style.transform = `rotate(${-bearing}deg)`;
    }

    if (btn) {
      btn.title = Math.abs(bearing) < 0.5
        ? 'North is up'
        : `Map rotated ${Math.round(bearing)}°. Tap to reset north.`;
      btn.classList.toggle('hidden', !state?.map);
    }
  }

  function releaseFollowForGesture() {
    if (!state?.driveActive) return;

    state.driveFollow = false;
    try { updateFollowButton(); } catch {}

    document.getElementById('recenterMapBtn')?.classList.remove('hidden');
    const previewHint = document.getElementById('routePreviewHint');
    if (previewHint) {
      previewHint.textContent = 'Map adjusted • tap Recenter to resume forward following';
      previewHint.classList.remove('hidden');
    }
  }

  function bindMapInteractions() {
    if (!state?.map || gesture.mapBound) return;
    gesture.mapBound = true;

    ensureInteractionUi();

    // Confirm handlers are enabled even if a mobile browser changed defaults.
    try {
      state.map.touchZoom?.enable?.();
      state.map.touchRotate?.enable?.();
    } catch {}

    state.map.on('rotate', () => {
      updateCompass();
      refreshCarForMapBearing();
    });

    state.map.on('zoomstart', () => {
      if (state.driveActive) releaseFollowForGesture();
    });

    const container = state.map.getContainer?.();
    if (container) {
      container.addEventListener('touchstart', event => {
        if (event.touches?.length === 2) {
          releaseFollowForGesture();
          const hint = document.getElementById('gestureHint');
          hint?.classList.remove('hidden');
          setTimeout(() => hint?.classList.add('hidden'), 3000);
        }
      }, { passive: true });
    }

    updateCompass();
  }

  // renderMap is where the Leaflet map is first created.
  const priorRenderMap043 = renderMap;
  renderMap = function(...args) {
    const result = priorRenderMap043(...args);
    bindMapInteractions();
    updateCompass();
    return result;
  };

  // Keep gesture UI available in Drive Mode.
  const priorStartRoadCast043 = startRoadCast;
  startRoadCast = function(demoMode) {
    const result = priorStartRoadCast043(demoMode);
    bindMapInteractions();

    document.getElementById('mapCompassBtn')?.classList.remove('hidden');

    const hint = document.getElementById('gestureHint');
    if (hint) {
      hint.classList.remove('hidden');
      setTimeout(() => hint.classList.add('hidden'), 4500);
    }

    return result;
  };

  // A normal GPS position update should remember the latest heading so a
  // manual map rotation can redraw the car correctly even between GPS ticks.
  const priorUpdateDrivePosition043 = updateDrivePosition;
  updateDrivePosition = function(raw, gpsHeading, speedMps, demoMode) {
    const result = priorUpdateDrivePosition043(raw, gpsHeading, speedMps, demoMode);

    if (state?.driveProgress) {
      const validGps = Number.isFinite(Number(gpsHeading)) &&
        Number(gpsHeading) >= 0 &&
        Number(speedMps || 0) > 1.2;

      gesture.lastHeading = validGps
        ? Number(gpsHeading)
        : Number(state.driveProgress.heading || gesture.lastHeading || 0);

      gesture.lastDemo = !!demoMode;
    }

    return result;
  };

  const badge = document.querySelector('.badge');
  if (badge) badge.textContent = 'MVP 0.4.3';

  console.info(`RoadCast pinch zoom + rotation patch ${VERSION} loaded.`);
})();
