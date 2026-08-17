'use strict';

(() => {
  const VERSION = '0.7.0';
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

  const ATTITUDE_KEY = 'roadcast_attitude_level_v1';

  const rerouteLines = {
    chill: [
      'No problem. I am finding another route.',
      'Route changed. Recalculating from here.',
    ],
    playful: [
      'Plot twist. We are going this way now.',
      'You found the scenic option. I am adjusting the route.',
      'That was not the road I picked, but we can work with it.',
      'RoadCast has accepted your creative interpretation of the route.',
    ],
    spicy: [
      'I said turn. You heard adventure. Fine. We are recalculating.',
      'Interesting. The route and you appear to be seeing other roads.',
      'That was a bold interpretation of stay on this road.',
      'Fine. We will do it your way. Again.',
      'The highlighted line was apparently more of a suggestion.',
      'You missed it with confidence. I respect the commitment.',
    ],
    maximum: [
      'You ignored the turn with remarkable confidence. I am almost impressed.',
      'I can calculate routes. I cannot calculate why you ignored that turn.',
      'At this point I am less navigation and more crisis management.',
      'Another route change. My imaginary blood pressure is excellent, thanks for asking.',
      'Wonderful. The highlighted line was apparently decorative.',
      'You and the route are currently in a long-distance relationship. Recalculating.',
      'I had directions. You had a vision. Apparently the vision won.',
      'That turn had one job. So did you. We are moving on.',
    ],
  };

  function attitudeLevel() {
    const level = localStorage.getItem(ATTITUDE_KEY) || 'spicy';
    return rerouteLines[level] ? level : 'spicy';
  }

  function nextRerouteLine() {
    const lines = rerouteLines[attitudeLevel()] || rerouteLines.spicy;
    if (!lines.length) return '';
    let index = Math.floor(Math.random() * lines.length);
    if (index === lastJokeIndex && lines.length > 1) index = (index + 1) % lines.length;
    lastJokeIndex = index;
    return lines[index];
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

      window.RoadCastVoice?.speak('Rerouting.', { category: 'reroute', dedupeMs: 1000 });

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
        { category: 'reroute', dedupeMs: 3000 }
      );

      const personalityLine = nextRerouteLine();
      if (personalityLine) {
        setTimeout(() => {
          window.RoadCastVoice?.speak(
            personalityLine,
            { category: 'personality', dedupeMs: 1000 }
          );
        }, 1800);
      }
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
  if (badge) badge.textContent = 'MVP 0.7';
  console.info(`RoadCast personality reroute ${VERSION} loaded.`);
})();
