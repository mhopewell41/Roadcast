'use strict';

(() => {
  const VERSION = '0.4.1';
  const ROADCAST_VOICE_ID = '4hgEYmHo3owVoJYwXakA';
  const CONFIG_KEY = 'roadcast_voice_config_v1';
  const MODE_KEY = 'roadcast_voice_mode_v1';

  const nav = {
    currentStepKey: null,
    announcedStages: new Map(),
    voiceQueue: Promise.resolve(),
    activeAudio: null,
    lastSpeech: new Map(),
    lastWeatherSpeechKey: '',
    lastWeatherSpeechAt: 0,
  };

  const $v = id => document.getElementById(id);
  const ui = {
    nextTurnCard: $v('nextTurnCard'),
    nextTurnIcon: $v('nextTurnIcon'),
    nextTurnDistance: $v('nextTurnDistance'),
    nextTurnText: $v('nextTurnText'),
    nextTurnRoad: $v('nextTurnRoad'),
    voiceModeLabel: $v('voiceModeLabel'),
    voiceToggleBtn: $v('voiceToggleBtn'),
    voiceSetupBtn: $v('voiceSetupBtn'),
    voiceSetupPanel: $v('voiceSetupPanel'),
    closeVoiceSetupBtn: $v('closeVoiceSetupBtn'),
    voiceProjectUrl: $v('voiceProjectUrl'),
    voiceClientToken: $v('voiceClientToken'),
    saveVoiceSetupBtn: $v('saveVoiceSetupBtn'),
    testVoiceBtn: $v('testVoiceBtn'),
    useStandardVoiceBtn: $v('useStandardVoiceBtn'),
    voiceSetupStatus: $v('voiceSetupStatus'),
  };

  function getVoiceConfig() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function saveVoiceConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function getVoiceMode() {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'myvoice' || saved === 'standard' || saved === 'silent') return saved;
    return getVoiceConfig().projectUrl && getVoiceConfig().token ? 'myvoice' : 'standard';
  }

  function setVoiceMode(mode) {
    localStorage.setItem(MODE_KEY, mode);
    updateVoiceUi();
  }

  function updateVoiceUi() {
    if (!ui.voiceModeLabel) return;
    const mode = getVoiceMode();
    ui.voiceModeLabel.textContent =
      mode === 'myvoice' ? 'My RoadCast voice' :
      mode === 'silent' ? 'Voice off' :
      'Standard voice';
    ui.voiceToggleBtn.textContent = mode === 'silent' ? '🔇 Voice off' : '🔊 Voice on';
  }

  function stopSpeech() {
    try { speechSynthesis.cancel(); } catch {}
    if (nav.activeAudio) {
      try { nav.activeAudio.pause(); } catch {}
      nav.activeAudio = null;
    }
  }

  function standardSpeak(text) {
    return new Promise(resolve => {
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
        resolve();
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      u.pitch = 1.0;
      u.volume = 1.0;
      u.onend = resolve;
      u.onerror = resolve;
      speechSynthesis.speak(u);
    });
  }

  async function clonedSpeak(text) {
    const cfg = getVoiceConfig();
    if (!cfg.projectUrl || !cfg.token) throw new Error('My Voice is not configured yet.');

    const base = cfg.projectUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/functions/v1/roadcast-voice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-roadcast-token': cfg.token,
      },
      body: JSON.stringify({
        text,
        voice_id: ROADCAST_VOICE_ID,
      }),
    });

    if (!res.ok) {
      let message = `Voice service returned ${res.status}.`;
      try {
        const j = await res.json();
        if (j?.error) message = j.error;
      } catch {}
      throw new Error(message);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      nav.activeAudio = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (nav.activeAudio === audio) nav.activeAudio = null;
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (nav.activeAudio === audio) nav.activeAudio = null;
        reject(new Error('Could not play the generated voice audio.'));
      };
      audio.play().catch(err => {
        URL.revokeObjectURL(url);
        if (nav.activeAudio === audio) nav.activeAudio = null;
        reject(err);
      });
    });
  }

  async function speakNow(text, { fallback = true } = {}) {
    const mode = getVoiceMode();
    if (mode === 'silent' || !text) return;

    if (mode === 'myvoice') {
      try {
        await clonedSpeak(text);
        return;
      } catch (err) {
        console.warn('RoadCast cloned voice failed, using standard voice.', err);
        if (ui.voiceSetupStatus) {
          ui.voiceSetupStatus.textContent = `My Voice unavailable: ${err.message}. Standard voice used instead.`;
        }
        if (!fallback) throw err;
      }
    }

    await standardSpeak(text);
  }

  function queueSpeech(text, opts = {}) {
    const now = Date.now();
    const dedupeKey = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
    const previous = nav.lastSpeech.get(dedupeKey) || 0;
    const dedupeMs = opts.dedupeMs ?? 15000;
    if (now - previous < dedupeMs) return;
    nav.lastSpeech.set(dedupeKey, now);

    if (opts.priority) {
      stopSpeech();
      nav.voiceQueue = Promise.resolve().then(() => speakNow(text, opts)).catch(() => {});
    } else {
      nav.voiceQueue = nav.voiceQueue.then(() => speakNow(text, opts)).catch(() => {});
    }
  }

  function normalizeProjectUrl(value) {
    let v = String(value || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
    return v.replace(/\/+$/, '');
  }

  function showVoiceSetup() {
    const cfg = getVoiceConfig();
    ui.voiceProjectUrl.value = cfg.projectUrl || '';
    ui.voiceClientToken.value = cfg.token || '';
    ui.voiceSetupPanel.classList.remove('hidden');
    ui.voiceSetupPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function testMyVoice() {
    const projectUrl = normalizeProjectUrl(ui.voiceProjectUrl.value);
    const token = ui.voiceClientToken.value.trim();

    if (!projectUrl || !token) {
      ui.voiceSetupStatus.textContent = 'Enter your Supabase project URL and RoadCast voice token first.';
      return;
    }

    saveVoiceConfig({ projectUrl, token, voiceId: ROADCAST_VOICE_ID });
    setVoiceMode('myvoice');
    ui.testVoiceBtn.disabled = true;
    ui.testVoiceBtn.textContent = 'Testing...';
    ui.voiceSetupStatus.textContent = 'Contacting your RoadCast voice service...';

    try {
      await speakNow("RoadCast is ready. Let's hit the road.", { fallback: false });
      ui.voiceSetupStatus.textContent = '✅ Your RoadCast voice is working.';
    } catch (err) {
      ui.voiceSetupStatus.textContent = `❌ ${err.message}`;
    } finally {
      ui.testVoiceBtn.disabled = false;
      ui.testVoiceBtn.textContent = '▶ Test My Voice';
    }
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return '';
    if (meters < 305) {
      const feet = Math.max(50, Math.round((meters * 3.28084) / 50) * 50);
      return `${feet} ft`;
    }
    const mi = meters / 1609.344;
    if (mi < 10) return `${mi.toFixed(mi < 1 ? 1 : 1)} mi`;
    return `${Math.round(mi)} mi`;
  }

  function spokenDistance(meters) {
    if (meters < 305) {
      const feet = Math.max(50, Math.round((meters * 3.28084) / 50) * 50);
      return `${feet} feet`;
    }
    const mi = meters / 1609.344;
    if (mi < 0.85) return 'half a mile';
    if (mi < 1.25) return 'one mile';
    return `${Math.max(1, Math.round(mi))} miles`;
  }

  function turnIcon(type, modifier) {
    const mod = String(modifier || '').toLowerCase();
    const t = String(type || '').toLowerCase();
    if (t === 'arrive') return '🏁';
    if (t === 'merge') return mod.includes('left') ? '↖️' : '↗️';
    if (t.includes('ramp')) return mod.includes('left') ? '↖️' : '↗️';
    if (t === 'fork') return mod.includes('left') ? '↖️' : '↗️';
    if (mod.includes('uturn')) return '↩️';
    if (mod.includes('sharp left')) return '↙️';
    if (mod.includes('sharp right')) return '↘️';
    if (mod.includes('left')) return '⬅️';
    if (mod.includes('right')) return '➡️';
    if (mod.includes('straight') || t === 'continue' || t === 'new name') return '⬆️';
    return '⬆️';
  }

  function humanInstruction(step, includeDistance = false, meters = 0) {
    const man = step?.maneuver || {};
    const type = String(man.type || '').toLowerCase();
    const mod = String(man.modifier || '').toLowerCase();
    const road = String(step?.name || step?.ref || '').trim();
    let action = '';

    if (type === 'arrive') action = 'Arrive at your destination';
    else if (type === 'merge') action = `Merge ${mod || 'ahead'}`;
    else if (type === 'on ramp') action = `Take the ${mod || ''} ramp`.replace(/\s+/g, ' ').trim();
    else if (type === 'off ramp') action = `Take the ${mod || ''} exit`.replace(/\s+/g, ' ').trim();
    else if (type === 'fork') action = `Keep ${mod || 'ahead'} at the fork`;
    else if (type === 'end of road') action = `At the end of the road, turn ${mod || ''}`.trim();
    else if (mod.includes('uturn')) action = 'Make a U-turn';
    else if (mod.includes('left')) action = mod.includes('slight') ? 'Bear left' : mod.includes('sharp') ? 'Make a sharp left' : 'Turn left';
    else if (mod.includes('right')) action = mod.includes('slight') ? 'Bear right' : mod.includes('sharp') ? 'Make a sharp right' : 'Turn right';
    else action = 'Continue straight';

    if (road && type !== 'arrive') action += ` onto ${road}`;
    if (includeDistance && type !== 'arrive') return `In ${spokenDistance(meters)}, ${action.toLowerCase()}.`;
    return `${action}.`;
  }

  function stepKey(step) {
    const loc = step?.maneuver?.location || [];
    return [
      step?.maneuver?.type || '',
      step?.maneuver?.modifier || '',
      step?.name || step?.ref || '',
      loc[0] ?? '',
      loc[1] ?? ''
    ].join('|');
  }

  function ensureStepProgress(route) {
    if (!route?.steps?.length || !route.cumulative?.length) return;
    for (const step of route.steps) {
      if (Number.isFinite(step._progress)) continue;
      const loc = step?.maneuver?.location;
      if (!Array.isArray(loc) || loc.length < 2) continue;
      const point = { lat: Number(loc[1]), lon: Number(loc[0]) };
      const found = locateOnRoute(route, point);
      step._progress = found?.progress ?? null;
    }
  }

  function findNextStep(route, located) {
    if (!route?.steps?.length || !located) return null;
    ensureStepProgress(route);
    const candidates = route.steps.filter(step =>
      Number.isFinite(step._progress) &&
      String(step?.maneuver?.type || '').toLowerCase() !== 'depart' &&
      step._progress >= located.progress - 0.0004
    );
    candidates.sort((a, b) => a._progress - b._progress);
    return candidates[0] || null;
  }

  function updateTurnUi(located) {
    if (!state.driveActive || !state.trip || !located) {
      ui.nextTurnCard?.classList.add('hidden');
      return;
    }

    const route = state.trip.route;
    const step = findNextStep(route, located);

    if (!step) {
      ui.nextTurnCard?.classList.remove('hidden');
      ui.nextTurnIcon.textContent = '🏁';
      ui.nextTurnDistance.textContent = 'Destination ahead';
      ui.nextTurnText.textContent = state.destination?.name || 'Destination';
      ui.nextTurnRoad.textContent = '';
      return;
    }

    const meters = Math.max(0, (step._progress - located.progress) * (route.polylineDistance || route.distance || 0));
    const key = stepKey(step);
    const type = String(step?.maneuver?.type || '').toLowerCase();

    ui.nextTurnCard.classList.remove('hidden');
    ui.nextTurnIcon.textContent = turnIcon(step?.maneuver?.type, step?.maneuver?.modifier);
    ui.nextTurnDistance.textContent = type === 'arrive' ? formatDistance(meters) : `In ${formatDistance(meters)}`;
    ui.nextTurnText.textContent = humanInstruction(step, false).replace(/\.$/, '');
    ui.nextTurnRoad.textContent = step.name || step.ref || '';

    if (nav.currentStepKey !== key) {
      nav.currentStepKey = key;
      if (!nav.announcedStages.has(key)) nav.announcedStages.set(key, new Set());
    }

    const stages = nav.announcedStages.get(key) || new Set();

    if (type === 'arrive') {
      if (meters <= 250 && !stages.has('arrive')) {
        queueSpeech(`Your destination, ${state.destination?.name || 'your destination'}, is ahead.`, { priority: true, dedupeMs: 60000 });
        stages.add('arrive');
      }
    } else {
      if (meters <= 1200 && meters > 320 && !stages.has('far')) {
        queueSpeech(humanInstruction(step, true, meters), { dedupeMs: 45000 });
        stages.add('far');
      }
      if (meters <= 300 && meters > 75 && !stages.has('near')) {
        queueSpeech(humanInstruction(step, true, meters), { priority: true, dedupeMs: 45000 });
        stages.add('near');
      }
      if (meters <= 70 && !stages.has('now')) {
        queueSpeech(humanInstruction(step, false, meters), { priority: true, dedupeMs: 45000 });
        stages.add('now');
      }
    }

    nav.announcedStages.set(key, stages);
  }

  // Upgrade OSRM requests to include turn-by-turn RouteStep objects.
  getRoute = async function(start, dest) {
    const coords = `${start.lon},${start.lat};${dest.lon},${dest.lat}`;
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coords}` +
      `?overview=full&geometries=geojson&steps=true`
    );

    if (!res.ok) throw new Error(`Routing service returned ${res.status}.`);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) {
      throw new Error(data.message || 'No driving route was found.');
    }

    const r = data.routes[0];
    const steps = (r.legs || []).flatMap(leg => leg.steps || []);

    return {
      distance: r.distance,
      duration: r.duration,
      points: r.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
      steps
    };
  };

  // Add navigation updates after the existing GPS / reroute stack has processed the point.
  const priorUpdateDrivePosition = updateDrivePosition;
  updateDrivePosition = function(raw, gpsHeading, speedMps, demoMode) {
    priorUpdateDrivePosition(raw, gpsHeading, speedMps, demoMode);
    if (state.driveActive && state.driveProgress) updateTurnUi(state.driveProgress);
  };

  // Speak meaningful weather warnings, but not the calm-status message.
  const priorUpdateDriveAlert = updateDriveAlert;
  updateDriveAlert = function(located, demoMode) {
    priorUpdateDriveAlert(located, demoMode);

    if (!state.driveActive || !els.driveOverlayTitle) return;
    const title = String(els.driveOverlayTitle.textContent || '').trim();
    const detail = String(els.driveOverlayDetail.textContent || '').trim();
    const lower = `${title} ${detail}`.toLowerCase();

    const meaningful = /rain|snow|storm|thunder|fog|ice|wind|hail|weather ahead|severe/.test(lower)
      && !/looks calm|fairly calm|no major weather/.test(lower);

    if (!meaningful) return;

    const key = `${title}|${detail}`;
    const now = Date.now();
    if (key === nav.lastWeatherSpeechKey && now - nav.lastWeatherSpeechAt < 120000) return;

    nav.lastWeatherSpeechKey = key;
    nav.lastWeatherSpeechAt = now;

    let spoken = `${title}.`;
    const mi = detail.match(/(\d+(?:\.\d+)?)\s*mi/i);
    if (mi) {
      const miAhead = Number(mi[1]);
      spoken += ` About ${miAhead} miles ahead.`;
      const totalMi = state?.trip?.route?.distance ? state.trip.route.distance / 1609.344 : 0;
      if (totalMi > 0 && state?.trip?.route?.duration) {
        const minutes = Math.max(1, Math.round((state.trip.route.duration * (miAhead / totalMi)) / 60));
        spoken += ` RoadCast estimates you will reach it in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
      }
    }
    queueSpeech(spoken, { priority: /severe|thunder|hail|ice/.test(lower), dedupeMs: 120000 });
  };

  // Reset / intro behavior around drive mode.
  const priorStartRoadCast = startRoadCast;
  startRoadCast = function(demoMode) {
    priorStartRoadCast(demoMode);
    nav.currentStepKey = null;
    nav.announcedStages.clear();
    ui.nextTurnCard?.classList.remove('hidden');
    setTimeout(() => {
      if (state.driveActive && state.driveProgress) updateTurnUi(state.driveProgress);
    }, 300);
    queueSpeech(
      demoMode
        ? 'RoadCast simulation started.'
        : `RoadCast started. Navigating to ${state.destination?.name || 'your destination'}.`,
      { dedupeMs: 5000 }
    );
  };

  const priorStopDrive = stopDrive;
  stopDrive = function(...args) {
    const result = priorStopDrive(...args);
    stopSpeech();
    ui.nextTurnCard?.classList.add('hidden');
    return result;
  };

  // Voice controls.
  ui.voiceToggleBtn?.addEventListener('click', () => {
    const mode = getVoiceMode();
    if (mode === 'silent') {
      const cfg = getVoiceConfig();
      setVoiceMode(cfg.projectUrl && cfg.token ? 'myvoice' : 'standard');
      queueSpeech('Voice guidance on.', { priority: true, dedupeMs: 1000 });
    } else {
      stopSpeech();
      setVoiceMode('silent');
    }
  });

  ui.voiceSetupBtn?.addEventListener('click', showVoiceSetup);
  ui.closeVoiceSetupBtn?.addEventListener('click', () => ui.voiceSetupPanel.classList.add('hidden'));

  ui.saveVoiceSetupBtn?.addEventListener('click', () => {
    const projectUrl = normalizeProjectUrl(ui.voiceProjectUrl.value);
    const token = ui.voiceClientToken.value.trim();
    if (!projectUrl || !token) {
      ui.voiceSetupStatus.textContent = 'Enter both fields before saving.';
      return;
    }
    saveVoiceConfig({ projectUrl, token, voiceId: ROADCAST_VOICE_ID });
    setVoiceMode('myvoice');
    ui.voiceSetupStatus.textContent = '✅ Saved on this device. Tap Test My Voice.';
  });

  ui.testVoiceBtn?.addEventListener('click', testMyVoice);

  ui.useStandardVoiceBtn?.addEventListener('click', () => {
    stopSpeech();
    setVoiceMode('standard');
    ui.voiceSetupStatus.textContent = 'Standard phone voice selected.';
    queueSpeech('Standard RoadCast voice selected.', { priority: true, dedupeMs: 1000 });
  });

  // Fill saved config and initial UI.
  const savedConfig = getVoiceConfig();
  if (ui.voiceProjectUrl) ui.voiceProjectUrl.value = savedConfig.projectUrl || '';
  if (ui.voiceClientToken) ui.voiceClientToken.value = savedConfig.token || '';
  updateVoiceUi();

  // Small public API for RoadCast feature patches such as the weather test button.
  window.RoadCastVoice = {
    speak(text, options = {}) { queueSpeech(text, options); },
    stop() { stopSpeech(); },
    mode() { return getVoiceMode(); },
    voiceId: ROADCAST_VOICE_ID,
  };

  const badge = document.querySelector('.badge');
  if (badge) badge.textContent = 'MVP 0.4.1';

  console.info(`RoadCast navigation + voice patch ${VERSION} loaded with voice ${ROADCAST_VOICE_ID}`);
})();
