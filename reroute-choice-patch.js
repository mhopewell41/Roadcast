'use strict';

(() => {
  const VERSION = '0.6.1';
  const SOFT_OFF_ROUTE_METERS = 45;
  const NORMAL_OFF_ROUTE_METERS = 75;
  const HARD_OFF_ROUTE_METERS = 150;
  const HEADING_DIVERGENCE_DEGREES = 38;
  const REROUTE_COOLDOWN_MS = 20000;

  let offRouteSince = null;
  let rerouteReason = '';
  let rerouting = false;
  let lastRerouteAt = 0;
  let noticeShown = false;
  let lastJokeIndex = -1;

  const rerouteLines = [
    'I see we are freelancing the route today. No problem. Recalculating.',
    'Bold choice. You have selected the scenic option. Rerouting.',
    'That was not the road I picked, but I admire the confidence. Recalculating.',
    'Plot twist. We are going this way now. Rerouting.',
    'You clearly had your own plan. Respect. Finding another route.',
    'RoadCast has noted your creative interpretation of directions. Recalculating.',
    'Well, that turn was optional apparently. Let me find us another way.',
    'I had a route. You had a vision. Rerouting.',
    'Unexpected road choice detected. I will pretend we planned that. Recalculating.',
    'All right, captain. Your road it is. Finding a new route.',
  ];

  function nextRerouteLine() {
    if (rerouteLines.length === 1) return rerouteLines[0];
    let index = Math.floor(Math.random() * rerouteLines.length);
    if (index === lastJokeIndex) index = (index + 1) % rerouteLines.length;
    lastJokeIndex = index;
    return rerouteLines[index];
  }

  async function rebuildFromCurrentGps(raw) {
    if (rerouting || !state?.destination || !state?.driveActive || state.driveDemo) return;

    rerouting = true;
    window.__roadcastRerouting = true;
    lastRerouteAt = Date.now();
    offRouteSince = null;
    noticeShown = false;

    const destinationName = state.destination?.name || 'your destination';

    try {
      if (els.driveOverlay) els.driveOverlay.classList.remove('hidden', 'severe');
      if (els.driveOverlayIcon) els.driveOverlayIcon.textContent = '🔄';
      if (els.driveOverlayTitle) els.driveOverlayTitle.textContent = 'Different road detected — rerouting';
      if (els.driveOverlayDetail) {
        els.driveOverlayDetail.textContent = `Finding a new route from here to ${destinationName}...`;
      }
      if (els.driveStatus) els.driveStatus.textContent = 'LIVE GPS • rerouting';

      window.RoadCastVoice?.speak(nextRerouteLine(), { priority: true, dedupeMs: 1000 });

      const route = await getRoute(raw, state.destination);
      buildRouteMetrics(route);

      const departure = new Date();
      const count = Math.max(5, Math.min(10, Math.ceil(route.duration / 1800) + 1));
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
        c.label = i === 0
          ? 'Current location'
          : i === count - 1
            ? destinationName
            : `Road checkpoint ${i}`;
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
      if (els.driveOverlayDetail) {
        els.driveOverlayDetail.textContent = 'RoadCast adjusted to the route you chose.';
      }

      window.RoadCastVoice?.speak(
        'New route is ready. Continue on the highlighted road.',
        { dedupeMs: 3000 }
      );
    } catch (err) {
      console.error('RoadCast fast reroute error', err);
      if (els.driveOverlay) els.driveOverlay.classList.remove('hidden');
      if (els.driveOverlayIcon) els.driveOverlayIcon.textContent = '⚠️';
      if (els.driveOverlayTitle) els.driveOverlayTitle.textContent = 'Reroute delayed';
      if (els.driveOverlayDetail) {
        els.driveOverlayDetail.textContent = 'RoadCast will keep following your GPS and try again.';
      }
    } finally {
      rerouting = false;
      offRouteSince = null;
      rerouteReason = '';
      setTimeout(() => { window.__roadcastRerouting = false; }, 1200);
    }
  }

  function angleDifference(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return Math.abs(((a - b + 540) % 360) - 180);
  }

  const priorUpdateReroute061 = updateDrivePosition;
  updateDrivePosition = function(raw, gpsHeading, speedMps, demoMode) {
    const result = priorUpdateReroute061(raw, gpsHeading, speedMps, demoMode);

    if (demoMode || rerouting || !state?.driveActive || !state?.trip || !raw) {
      offRouteSince = null;
      rerouteReason = '';
      noticeShown = false;
      return result;
    }

    const located = state.driveProgress || locateOnRoute(state.trip.route, raw);
    if (!located) return result;

    const speed = Number(speedMps || 0);
    const moving = speed > 2.0;
    const off = Number(located.offRoute || 0);
    const routeHeading = Number(located.heading);
    const userHeading = Number(gpsHeading);
    const headingDelta = angleDifference(userHeading, routeHeading);
    const headingValid = Number.isFinite(userHeading) && userHeading >= 0 && moving;
    const diverging = headingValid && headingDelta >= HEADING_DIVERGENCE_DEGREES;

    let candidate = false;
    let sustainMs = 4500;
    let reason = '';

    if (off >= HARD_OFF_ROUTE_METERS) {
      candidate = true;
      sustainMs = 1700;
      reason = 'well off route';
    } else if (off >= NORMAL_OFF_ROUTE_METERS) {
      candidate = true;
      sustainMs = diverging ? 2400 : 4000;
      reason = diverging ? 'different direction' : 'alternate road';
    } else if (off >= SOFT_OFF_ROUTE_METERS && diverging) {
      candidate = true;
      sustainMs = 2800;
      reason = 'missed turn';
    }

    if (candidate && moving) {
      if (!offRouteSince || rerouteReason !== reason) {
        offRouteSince = Date.now();
        rerouteReason = reason;
        noticeShown = false;
      }

      const elapsed = Date.now() - offRouteSince;
      const cooledDown = Date.now() - lastRerouteAt >= REROUTE_COOLDOWN_MS;

      if (elapsed >= 1600 && !noticeShown) {
        noticeShown = true;
        if (els.driveStatus) els.driveStatus.textContent = 'LIVE GPS • alternate road detected';
      }

      if (elapsed >= sustainMs && cooledDown) {
        rebuildFromCurrentGps(raw);
      }
    } else {
      offRouteSince = null;
      rerouteReason = '';
      noticeShown = false;
    }

    return result;
  };

  const badge = document.querySelector('.badge');
  if (badge) badge.textContent = 'MVP 0.6.1';
  console.info(`RoadCast personality reroute ${VERSION} loaded.`);
})();
