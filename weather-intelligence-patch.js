'use strict';

(() => {
  const VERSION = '0.7.0';
  const REFRESH_MS = 2 * 60 * 1000;
  const MIN_POINTS = 7;
  const MAX_POINTS = 18;
  const WEATHER_LAYER_KEY = 'liveWeatherLayer061';

  const wx = {
    timer: null,
    refreshing: false,
    lastAlertKey: '',
    lastAlertAt: 0,
    lastWetNow: false,
    lastSummaryText: '',
  };

  const wetCodes = new Set([51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99]);

  function nearestIndex(times, target) {
    if (!Array.isArray(times) || !times.length) return 0;
    const targetMs = target.getTime();
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const t = new Date(`${times[i]}Z`).getTime();
      const diff = Math.abs(t - targetMs);
      if (diff < bestDiff) {
        best = i;
        bestDiff = diff;
      }
    }
    return best;
  }

  function sampleProgresses(current, route) {
    const remainingMeters = Math.max(1, route.distance * (1 - current));
    const remainingMiles = remainingMeters / 1609.344;
    const count = Math.max(MIN_POINTS, Math.min(MAX_POINTS, Math.ceil(remainingMiles / 3) + 1));
    return Array.from({ length: count }, (_, i) => current + (1 - current) * (i / (count - 1)));
  }

  async function fetchSmartWeather(points, targets) {
    const q = new URLSearchParams({
      latitude: points.map(p => p.lat).join(','),
      longitude: points.map(p => p.lon).join(','),
      current: 'temperature_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m',
      minutely_15: 'temperature_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m,visibility',
      hourly: 'precipitation_probability,weather_code',
      forecast_minutely_15: '48',
      forecast_hours: '24',
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      precipitation_unit: 'inch',
      timezone: 'GMT',
    });

    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (!res.ok) throw new Error(`Live weather service returned ${res.status}.`);
    const decoded = await res.json();
    const locations = Array.isArray(decoded) ? decoded : [decoded];

    return locations.map((data, i) => {
      const minute = data.minutely_15 || {};
      const hourly = data.hourly || {};
      const mi = nearestIndex(minute.time || [], targets[i]);
      const hi = nearestIndex(hourly.time || [], targets[i]);
      const current = data.current || {};
      const etaSoon = Math.abs(targets[i].getTime() - Date.now()) < 12 * 60 * 1000;

      const precip15 = Number(minute.precipitation?.[mi] ?? 0);
      const rain15 = Number(minute.rain?.[mi] ?? 0);
      const code15 = Number(minute.weather_code?.[mi] ?? 0);
      const currentPrecip = Number(current.precipitation ?? 0);
      const currentRain = Number(current.rain ?? 0);
      const currentCode = Number(current.weather_code ?? 0);

      return {
        time: targets[i],
        temp: Number(minute.temperature_2m?.[mi] ?? current.temperature_2m ?? 0),
        feels: Number(minute.apparent_temperature?.[mi] ?? current.apparent_temperature ?? 0),
        rainChance: Number(hourly.precipitation_probability?.[hi] ?? 0),
        rain: etaSoon ? Math.max(rain15, currentRain) : rain15,
        precip: etaSoon ? Math.max(precip15, currentPrecip) : precip15,
        code: etaSoon && wetCodes.has(currentCode) ? currentCode : code15,
        wind: Number(minute.wind_speed_10m?.[mi] ?? current.wind_speed_10m ?? 0),
        gust: Number(minute.wind_gusts_10m?.[mi] ?? current.wind_gusts_10m ?? 0),
        visibility: Number(minute.visibility?.[mi] ?? 99999),
        currentPrecip,
        currentRain,
        currentCode,
      };
    });
  }

  function isWet(w) {
    return wetCodes.has(Number(w.code)) ||
      Number(w.precip || 0) >= 0.005 ||
      Number(w.rain || 0) >= 0.005 ||
      Number(w.rainChance || 0) >= 45;
  }

  function severity(w) {
    const [, , codeSeverity] = codeInfo(Number(w.code || 0));
    let score = codeSeverity * 30;
    score += Math.min(35, Number(w.rainChance || 0) * 0.35);
    score += Number(w.precip || 0) >= 0.08 ? 25 : Number(w.precip || 0) >= 0.02 ? 12 : 0;
    score += Number(w.gust || 0) >= 40 ? 30 : Number(w.gust || 0) >= 30 ? 15 : 0;
    score += Number(w.visibility || 99999) < 1600 ? 25 : 0;
    return score;
  }

  function description(w) {
    const [icon, label] = codeInfo(Number(w.code || 0));
    if (Number(w.precip || 0) >= 0.08 && /rain|shower|drizzle/i.test(label)) {
      return [icon, `Heavy ${label.toLowerCase()}`];
    }
    return [icon, label];
  }

  function updateLiveMarkers(checkpoints) {
    if (!state?.map || !state.driveActive) return;

    if (state[WEATHER_LAYER_KEY]) {
      try { state.map.removeLayer(state[WEATHER_LAYER_KEY]); } catch {}
    }

    const layer = L.layerGroup().addTo(state.map);
    state[WEATHER_LAYER_KEY] = layer;

    checkpoints.slice(1).forEach((c, i) => {
      if (i % 2 && checkpoints.length > 10) return;
      const [icon] = description(c.weather);
      const markerIcon = L.divIcon({
        className: '',
        html: `<div style="width:34px;height:34px;border-radius:50%;background:rgba(7,17,31,.94);border:2px solid white;display:grid;place-items:center;font-size:18px;box-shadow:0 3px 10px #0007">${icon}</div>`,
        iconSize: [34,34],
        iconAnchor: [17,17]
      });
      L.marker([c.point.lat, c.point.lon], { icon: markerIcon, zIndexOffset: 350 })
        .bindPopup(`${Math.round(c.weather.temp)}°F • Rain ${Math.round(c.weather.rainChance)}%`)
        .addTo(layer);
    });
  }

  function buildWeatherSummary(checkpoints, currentProgress, route) {
    if (!Array.isArray(checkpoints) || !checkpoints.length) {
      return 'Weather monitoring is active. I will check the route every two minutes.';
    }

    const now = checkpoints[0].weather || {};
    const destinationWeather = checkpoints[checkpoints.length - 1]?.weather || now;
    const [, nowLabel] = description(now);
    const temp = Math.round(Number(now.temp || 0));
    const destinationTemp = Math.round(Number(destinationWeather.temp || temp));
    const firstWet = checkpoints.slice(1).find(c => isWet(c.weather || {}));

    let text = `Weather check. It is ${temp} degrees and ${String(nowLabel || 'steady').toLowerCase()} where you are.`;

    if (firstWet) {
      const fractionAhead = Math.max(0, firstWet.progress - currentProgress);
      const miAhead = (route.distance * fractionAhead) / 1609.344;
      const minutesAhead = Math.max(1, Math.round(route.duration * fractionAhead / 60));
      const [, wetLabel] = description(firstWet.weather || {});
      text += ` ${wetLabel} is showing about ${miAhead.toFixed(miAhead < 10 ? 1 : 0)} miles ahead, roughly ${minutesAhead} minutes away.`;
    } else {
      text += ' No significant weather is showing on the route right now.';
    }

    text += ` Destination temperature is about ${destinationTemp} degrees. I will check again in two minutes.`;
    return text;
  }

  function speakWeatherSummary(checkpoints = state.trip?.checkpoints, currentProgress = state.driveProgress?.progress || 0, route = state.trip?.route, options = {}) {
    if (!route || !checkpoints?.length) {
      const fallback = 'RoadCast weather monitoring is on. I will keep checking the route every two minutes.';
      wx.lastSummaryText = fallback;
      window.RoadCastVoice?.speak(fallback, { category: 'weather', dedupeMs: 5000, force: !!options.force });
      return fallback;
    }

    const text = buildWeatherSummary(checkpoints, currentProgress, route);
    wx.lastSummaryText = text;
    window.RoadCastVoice?.speak(text, { category: 'weather', dedupeMs: 5000, force: !!options.force });
    return text;
  }

  function announceWeather(checkpoints, currentProgress, route) {
    if (!checkpoints.length) return;

    const nowPoint = checkpoints[0];
    const wetNow = isWet(nowPoint.weather) &&
      (nowPoint.weather.currentPrecip > 0 || wetCodes.has(nowPoint.weather.currentCode));

    if (wetNow && !wx.lastWetNow) {
      wx.lastWetNow = true;
      window.RoadCastVoice?.speak(
        'Rain has reached your current part of the route. Roads may be slick, so give yourself a little extra space.',
        { category: 'safety', dedupeMs: 180000 }
      );
    } else if (!wetNow) {
      wx.lastWetNow = false;
    }

    const firstWet = checkpoints.slice(1).find(c => isWet(c.weather));
    if (!firstWet) return;

    const fractionAhead = Math.max(0, firstWet.progress - currentProgress);
    const miAhead = (route.distance * fractionAhead) / 1609.344;
    const minutesAhead = Math.max(1, Math.round(route.duration * fractionAhead / 60));
    const [icon, label] = description(firstWet.weather);

    let bucket = 'far';
    if (miAhead <= 2) bucket = '2';
    else if (miAhead <= 5) bucket = '5';
    else if (miAhead <= 10) bucket = '10';
    else if (miAhead <= 20) bucket = '20';

    const key = `${label}|${bucket}`;
    if (key === wx.lastAlertKey && Date.now() - wx.lastAlertAt < 10 * 60 * 1000) return;

    wx.lastAlertKey = key;
    wx.lastAlertAt = Date.now();

    if (els.driveOverlay) els.driveOverlay.classList.remove('hidden');
    if (els.driveOverlayIcon) els.driveOverlayIcon.textContent = icon;
    if (els.driveOverlayTitle) els.driveOverlayTitle.textContent = `${label} ahead`;
    if (els.driveOverlayDetail) {
      els.driveOverlayDetail.textContent =
        `${miAhead.toFixed(miAhead < 10 ? 1 : 0)} mi ahead • roughly ${minutesAhead} min • rain ${Math.round(firstWet.weather.rainChance)}%`;
    }
    els.driveOverlay?.classList.toggle('severe', severity(firstWet.weather) >= 65);

    const phrase =
      `${label} is showing about ${miAhead.toFixed(miAhead < 10 ? 1 : 0)} miles ahead. ` +
      `At your current route pace, you should reach it in about ${minutesAhead} minutes.`;

    window.RoadCastVoice?.speak(
      phrase,
      { category: severity(firstWet.weather) >= 65 ? 'safety' : 'weather', dedupeMs: 300000 }
    );
  }

  async function refresh(reason = 'timer') {
    if (wx.refreshing || !state?.driveActive || !state?.trip || !state?.driveProgress) return;
    wx.refreshing = true;

    const status = document.getElementById('weatherRefreshStatus');
    if (status) status.textContent = '🌦️ Checking 15-minute weather along the road ahead…';

    try {
      const route = state.trip.route;
      const current = Math.max(0, Math.min(0.999, state.driveProgress.progress || 0));
      const progresses = sampleProgresses(current, route);
      const points = progresses.map(p => pointAtProgress(route, p));
      const targets = progresses.map(p =>
        new Date(Date.now() + route.duration * Math.max(0, p - current) * 1000)
      );

      const weather = await fetchSmartWeather(points, targets);

      const checkpoints = progresses.map((progress, i) => ({
        point: points[i],
        progress,
        eta: targets[i],
        weather: weather[i],
        label: i === 0
          ? 'Current position'
          : i === progresses.length - 1
            ? (state.destination?.name || 'Destination')
            : `Weather ahead ${i}`,
      }));

      state.trip.checkpoints = checkpoints;

      const t = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date());
      if (status) {
        status.textContent = `🌦️ 15-min road weather checked ${t} • refreshes every 2 min`;
      }

      try { renderAlert(route, checkpoints); } catch {}
      try { renderTimeline(route, checkpoints); } catch {}
      updateLiveMarkers(checkpoints);

      if (reason === 'start' && !window.__roadcastRerouting) {
        speakWeatherSummary(checkpoints, current, route);
      } else {
        announceWeather(checkpoints, current, route);
      }
    } catch (err) {
      console.warn('RoadCast smart weather refresh failed.', err);
      if (status) status.textContent = '🌦️ Live road weather check delayed • retrying';
      if (reason === 'start' && !window.__roadcastRerouting) {
        const message = 'RoadCast weather monitoring is on, but the first live weather refresh was delayed. I will try again in two minutes.';
        wx.lastSummaryText = message;
        window.RoadCastVoice?.speak(message, { category: 'weather', dedupeMs: 5000 });
      }
    } finally {
      wx.refreshing = false;
    }
  }

  const priorStartWeather050 = startRoadCast;
  startRoadCast = function(demoMode) {
    const result = priorStartWeather050(demoMode);
    clearInterval(wx.timer);
    wx.lastAlertKey = '';
    wx.lastWetNow = false;
    setTimeout(() => refresh('start'), 1000);
    wx.timer = setInterval(() => refresh('timer'), REFRESH_MS);
    return result;
  };

  const priorStopWeather050 = stopDrive;
  stopDrive = function(...args) {
    clearInterval(wx.timer);
    wx.timer = null;
    if (state?.map && state[WEATHER_LAYER_KEY]) {
      try { state.map.removeLayer(state[WEATHER_LAYER_KEY]); } catch {}
      state[WEATHER_LAYER_KEY] = null;
    }
    return priorStopWeather050(...args);
  };

  window.RoadCastWeather = {
    summaryText() {
      if (wx.lastSummaryText) return wx.lastSummaryText;
      if (state.trip?.route && state.trip?.checkpoints?.length) {
        wx.lastSummaryText = buildWeatherSummary(
          state.trip.checkpoints,
          state.driveProgress?.progress || 0,
          state.trip.route
        );
      }
      return wx.lastSummaryText || 'RoadCast weather monitoring is active.';
    },
    speakSummary(options = {}) {
      return speakWeatherSummary(state.trip?.checkpoints, state.driveProgress?.progress || 0, state.trip?.route, options);
    },
    refresh() {
      return refresh('manual');
    },
  };

  const badge = document.querySelector('.badge');
  if (badge) badge.textContent = 'MVP 0.7';
  console.info(`RoadCast 15-minute weather intelligence ${VERSION} loaded.`);
})();
