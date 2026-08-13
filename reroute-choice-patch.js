'use strict';

(() => {
  const VERSION = '0.4.4';
  const OFF_ROUTE_THRESHOLD_METERS = 120;
  const OFF_ROUTE_SUSTAIN_MS = 6000;
  const REROUTE_COOLDOWN_MS = 30000;

  let offRouteSince = null;
  let rerouting = false;
  let lastRerouteAt = 0;
  let noticeShown = false;

  async function rebuildFromCurrentGps(raw) {
    if (rerouting || !state?.destination || !state?.driveActive || state.driveDemo) return;

    rerouting = true;
    lastRerouteAt = Date.now();
    offRouteSince = null;
    noticeShown = false;
    const destinationName = state.destination?.name || 'your destination';

    try {
      els.driveOverlay?.classList.remove('hidden', 'severe');
      if (els.driveOverlayIcon) els.driveOverlayIcon.textContent = '🔄';
      if (els.driveOverlayTitle) els.driveOverlayTitle.textContent = 'Different road detected — rerouting';
      if (els.driveOverlayDetail) els.driveOverlayDetail.textContent = `Finding a new route from here to ${destinationName}...`;
      if (els.driveStatus) els.driveStatus.textContent = 'LIVE GPS • rerouting';

      window.RoadCastVoice?.speak(
        `Rerouting. I am finding another way to ${destinationName}.`,
        { priority: true, dedupeMs: 5000 }
      );

      const route = await getRoute(raw, state.destination);
      buildRouteMetrics(route);

      const departure = new Date();
      const count = Math.max(4, Math.min(8, Math.ceil(route.duration / 2700) + 1));
      const points = sampleRoute(route.points, count);
      const checkpoints = points.map((point, i) => {
        const progress = i / (count - 1);
        return {
          point,
          progress,
          eta: new Date(departure.getTime() + route.duration * progress * 1000)
        };
      });

      const weather = await getWeatherAtPoints(
        checkpoints.map(c => c.point),
        checkpoints.map(c => c.eta)
      );

      checkpoints.forEach((c, i) => {
        c.weather = weather[i];
        c.label = i === 0 ? 'Current location' : i === count - 1 ? destinationName : `Road checkpoint ${i}`;
      });

      state.start = { lat: raw.lat, lon: raw.lon };
      state.route = route;
      state.trip = {
        route,
        checkpoints,
        departure,
        arrival: new Date(departure.getTime() + route.duration * 1000)
      };

      renderTrip();
      startRoadCast(false);

      if (els.driveOverlay) els.driveOverlay.classList.remove('hidden', 'severe');
      if (els.driveOverlayIcon) els.driveOverlayIcon.textContent = '✅';
      if (els.driveOverlayTitle) els.driveOverlayTitle.textContent = 'New route active';
      if (els.driveOverlayDetail) els.driveOverlayDetail.textContent = 'RoadCast adjusted to the way you chose.';

      window.RoadCastVoice?.speak(
        'Route updated. Continue on the highlighted route.',
        { priority: false, dedupeMs: 5000 }
      );

      setTimeout(() => {
        if (state.driveActive && state.driveProgress) {
          try { updateDriveAlert(state.driveProgress, false); } catch {}
        }
      }, 2500);
    } catch (err) {
      console.error('RoadCast fast reroute error', err);
      if (els.driveOverlay) els.driveOverlay.classList.remove('hidden');
      if (els.driveOverlayIcon) els.driveOverlayIcon.textContent = '⚠️';
      if (els.driveOverlayTitle) els.driveOverlayTitle.textContent = 'Reroute delayed';
      if (els.driveOverlayDetail) els.driveOverlayDetail.textContent = 'RoadCast will keep using your GPS and try again shortly.';
    } finally {
      rerouting = false;
      offRouteSince = null;
    }
  }

  const priorUpdateReroute044 = updateDrivePosition;
  updateDrivePosition = function(raw, gpsHeading, speedMps, demoMode) {
    const result = priorUpdateReroute044(raw, gpsHeading, speedMps, demoMode);

    if (demoMode || rerouting || !state?.driveActive || !state?.trip || !raw) {
      offRouteSince = null;
      noticeShown = false;
      return result;
    }

    const located = state.driveProgress || locateOnRoute(state.trip.route, raw);
    if (!located) return result;

    const moving = Number(speedMps || 0) > 2.0;
    const farEnough = located.offRoute > OFF_ROUTE_THRESHOLD_METERS;

    if (farEnough && (moving || located.offRoute > 220)) {
      if (!offRouteSince) offRouteSince = Date.now();
      const elapsed = Date.now() - offRouteSince;
      const cooledDown = Date.now() - lastRerouteAt >= REROUTE_COOLDOWN_MS;

      if (elapsed >= 2500 && !noticeShown) {
        noticeShown = true;
        if (els.driveStatus) els.driveStatus.textContent = 'LIVE GPS • alternate road detected';
      }

      if (elapsed >= OFF_ROUTE_SUSTAIN_MS && cooledDown) {
        rebuildFromCurrentGps(raw);
      }
    } else {
      offRouteSince = null;
      noticeShown = false;
    }

    return result;
  };

  const badge = document.querySelector('.badge');
  if (badge) badge.textContent = 'MVP 0.4.4';

  console.info(`RoadCast alternate-route reroute patch ${VERSION} loaded.`);
})();
