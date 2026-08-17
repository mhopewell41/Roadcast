'use strict';

(() => {
  const VERSION = '0.6.2';
  const ROADCAST_VOICE_ID = '4hgEYmHo3owVoJYwXakA';
  const CONFIG_KEY = 'roadcast_voice_config_v1';
  const MODE_KEY = 'roadcast_voice_mode_v1';

  const nav = {
    currentStepKey: null,
    announcedStages: new Map(),
    voiceQueue: Promise.resolve(),
    activeAudio: null,
    activeResolve: null,
    speechItems: [],
    speechRunning: false,
    lastSpeech: new Map(),
    lastWeatherSpeechKey: '',
    lastWeatherSpeechAt: 0,
    audioContext: null,
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

  function finishActiveSpeech() {
    const done = nav.activeResolve;
    nav.activeResolve = null;
    if (done) {
      try { done(); } catch {}
    }
  }

  function stopSpeech(clearPending = false) {
    try { speechSynthesis.cancel(); } catch {}
    if (nav.activeAudio) {
      try { nav.activeAudio.pause(); } catch {}
      nav.activeAudio = null;
    }
    finishActiveSpeech();
    if (clearPending) nav.speechItems.length = 0;
  }

  function standardSpeak(text) {
    return new Promise(resolve => {
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
        resolve();
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.98;
      u.pitch = 1.0;
      u.volume = 1.0;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (nav.activeResolve === finish) nav.activeResolve = null;
        resolve();
      };
      nav.activeResolve = finish;
      u.onend = finish;
      u.onerror = finish;
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
        // A short leading break gives Bluetooth/car audio time to wake before
        // the first spoken word. The RoadCast UI still keeps the clean text.
        text: `<break time="0.40s" />${text}`,
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

    return new Promise(async (resolve, reject) => {
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.volume = 1.0;
      nav.activeAudio = audio;

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        URL.revokeObjectURL(url);
        if (nav.activeAudio === audio) nav.activeAudio = null;
        if (nav.activeResolve === finish) nav.activeResolve = null;
        resolve();
      };
      nav.activeResolve = finish;

      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          if (!nav.audioContext) nav.audioContext = new AudioCtx();
          if (nav.audioContext.state === 'suspended') await nav.audioContext.resume();
          const source = nav.audioContext.createMediaElementSource(audio);
          const gain = nav.audioContext.createGain();
          gain.gain.value = 1.32;
          source.connect(gain);
          gain.connect(nav.audioContext.destination);
        }
      } catch (err) {
        console.warn('RoadCast voice boost unavailable; using normal volume.', err);
      }

      audio.onended = finish;
      audio.onerror = () => {
        if (finished) return;
        finished = true;
        URL.revokeObjectURL(url);
        if (nav.activeAudio === audio) nav.activeAudio = null;
        if (nav.activeResolve === finish) nav.activeResolve = null;
        reject(new Error('Could not play the generated voice audio.'));
      };

      audio.play().catch(err => {
        if (finished) return;
        finished = true;
        URL.revokeObjectURL(url);
        if (nav.activeAudio === audio) nav.activeAudio = null;
        if (nav.activeResolve === finish) nav.activeResolve = null;
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

  async function runSpeechQueue() {
    if (nav.speechRunning) return;
    nav.speechRunning = true;

    try {
      while (nav.speechItems.length) {
        const item = nav.speechItems.shift();
        try {
          await speakNow(item.text, item.opts);
        } catch (err) {
          console.warn('RoadCast speech item failed.', err);
        }
        await new Promise(resolve => setTimeout(resolve, 120));
      }
    } finally {
      nav.speechRunning = false;
    }
  }

  function splitSpeechText(text, maxChars = 175) {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned || cleaned.length <= maxChars) return cleaned ? [cleaned] : [];

    const sentences = cleaned.match(/[^.!?]+[.!?]?/g) || [cleaned];
    const parts = [];
    let current = '';

    for (const sentenceRaw of sentences) {
      const sentence = sentenceRaw.trim();
      if (!sentence) continue;

      if ((current + ' ' + sentence).trim().length <= maxChars) {
        current = (current + ' ' + sentence).trim();
        continue;
      }

      if (current) parts.push(current);
      current = '';

      if (sentence.length <= maxChars) {
        current = sentence;
        continue;
      }

      const words = sentence.split(/\s+/);
      let chunk = '';
      for (const word of words) {
        if ((chunk + ' ' + word).trim().length > maxChars && chunk) {
          parts.push(chunk);
          chunk = word;
        } else {
          chunk = (chunk + ' ' + word).trim();
        }
      }
      if (chunk) current = chunk;
    }

    if (current) parts.push(current);
    return parts;
  }

  function enqueueSpeechItem(cleaned, opts = {}) {
    const now = Date.now();
    const dedupeKey = cleaned.toLowerCase();
    const previous = nav.lastSpeech.get(dedupeKey) || 0;
    const dedupeMs = opts.dedupeMs ?? 15000;
    if (!opts.force && now - previous < dedupeMs) return;
    nav.lastSpeech.set(dedupeKey, now);

    // Priority changes queue order only. It never cuts off speech already
    // playing. This prevents weather, navigation and reroute personality from
    // talking over one another.
    if (opts.priority) nav.speechItems.unshift({ text: cleaned, opts });
    else nav.speechItems.push({ text: cleaned, opts });
  }

  function queueSpeech(text, opts = {}) {
    const parts = splitSpeechText(text);
    if (!parts.length) return;

    // Preserve sentence order for priority speech while still placing the
    // whole group ahead of normal chatter.
    if (opts.priority && parts.length > 1) {
      for (let i = parts.length - 1; i >= 0; i--) enqueueSpeechItem(parts[i], opts);
    } else {
      parts.forEach(part => enqueueSpeechItem(part, opts));
    }

    runSpeechQueue();
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

  function numberToWords(value) {
    const n = Math.max(0, Math.round(Number(value || 0)));
    if (n === 0) return 'zero';

    const ones = ['','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
    const tens = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];

    function underThousand(x) {
      const words = [];
      if (x >= 100) {
        words.push(`${ones[Math.floor(x / 100)]} hundred`);
        x %= 100;
      }
      if (x >= 20) {
        words.push(tens[Math.floor(x / 10)]);
        if (x % 10) words.push(ones[x % 10]);
      } else if (x > 0) {
        words.push(ones[x]);
      }
      return words.join(' ');
    }

    if (n < 1000) return underThousand(n);
    if (n < 10000) {
      const thousands = Math.floor(n / 1000);
      const rest = n % 1000;
      return `${underThousand(thousands)} thousand${rest ? ` ${underThousand(rest)}` : ''}`;
    }
    return String(n);
  }

  function spokenDistance(meters) {
    if (meters < 305) {
      const feet = Math.max(50, Math.round((meters * 3.28084) / 50) * 50);
      return `${numberToWords(feet)} feet`;
    }

    const mi = meters / 1609.344;
    if (mi < 0.35) return 'about three tenths of a mile';
    if (mi < 0.45) return 'about four tenths of a mile';
    if (mi < 0.70) return 'about half a mile';
    if (mi < 1.25) return 'about one mile';
    return `about ${numberToWords(Math.max(1, Math.round(mi)))} miles`;
  }

  function expandRoadName(value) {
    let road = String(value || '').trim();
    if (!road) return '';

    // Expand road suffixes only near the end of a road name so a name such as
    // "Dr Martin Luther King" is not mistakenly changed to "Drive Martin...".
    const suffixes = [
      ['Dr', 'Drive'], ['Rd', 'Road'], ['St', 'Street'], ['Ave', 'Avenue'],
      ['Blvd', 'Boulevard'], ['Ln', 'Lane'], ['Ct', 'Court'], ['Cir', 'Circle'],
      ['Pkwy', 'Parkway'], ['Hwy', 'Highway'], ['Ter', 'Terrace'], ['Pl', 'Place']
    ];

    for (const [abbr, full] of suffixes) {
      const re = new RegExp(`\\b${abbr}\\.?\\s*(N|S|E|W|NE|NW|SE|SW)?$`, 'i');
      road = road.replace(re, (_, dir = '') => `${full}${dir ? ` ${dir}` : ''}`);
    }

    road = road
      .replace(/\bNW\b/g, 'Northwest')
      .replace(/\bNE\b/g, 'Northeast')
      .replace(/\bSW\b/g, 'Southwest')
      .replace(/\bSE\b/g, 'Southeast')
      .replace(/\bN\b$/g, 'North')
      .replace(/\bS\b$/g, 'South')
      .replace(/\bE\b$/g, 'East')
      .replace(/\bW\b$/g, 'West');

    return road.replace(/\s+/g, ' ').trim();
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

  function baseInstruction(step) {
    const man = step?.maneuver || {};
    const type = String(man.type || '').toLowerCase();
    const mod = String(man.modifier || '').toLowerCase();
    const road = expandRoadName(step?.name || step?.ref || '');
    let action = '';

    if (type === 'arrive') action = 'Arrive at your destination';
    else if (type === 'merge') action = `Merge ${mod.includes('left') ? 'left' : mod.includes('right') ? 'right' : 'ahead'}`;
    else if (type === 'on ramp') action = `Take the ${mod.includes('left') ? 'left' : mod.includes('right') ? 'right' : ''} ramp`.replace(/\s+/g, ' ').trim();
    else if (type === 'off ramp') action = `Take the ${mod.includes('left') ? 'left' : mod.includes('right') ? 'right' : ''} exit`.replace(/\s+/g, ' ').trim();
    else if (type === 'fork') action = `Keep ${mod.includes('left') ? 'left' : mod.includes('right') ? 'right' : 'ahead'} at the fork`;
    else if (type === 'new name') action = road ? `Continue onto ${road}` : 'Continue straight';
    else if (mod.includes('uturn')) action = 'Make a U-turn';
    else if (mod.includes('left')) action = mod.includes('slight') ? 'Bear left' : mod.includes('sharp') ? 'Make a sharp left' : 'Turn left';
    else if (mod.includes('right')) action = mod.includes('slight') ? 'Bear right' : mod.includes('sharp') ? 'Make a sharp right' : 'Turn right';
    else action = 'Continue straight';

    if (road && type !== 'arrive' && type !== 'new name') action += ` onto ${road}`;
    return action.replace(/\s+/g, ' ').trim();
  }

  function humanInstruction(step, includeDistance = false, meters = 0) {
    const action = baseInstruction(step);
    const type = String(step?.maneuver?.type || '').toLowerCase();
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

  function followingStep(route, step) {
    if (!route?.steps?.length || !Number.isFinite(step?._progress)) return null;
    ensureStepProgress(route);
    const candidates = route.steps.filter(candidate =>
      candidate !== step &&
      Number.isFinite(candidate._progress) &&
      String(candidate?.maneuver?.type || '').toLowerCase() !== 'depart' &&
      candidate._progress > step._progress + 0.00005
    );
    candidates.sort((a, b) => a._progress - b._progress);
    return candidates[0] || null;
  }

  function quickTurnFollowUp(route, step) {
    const next = followingStep(route, step);
    if (!next) return '';
    const routeMeters = route.polylineDistance || route.distance || 0;
    const gapMeters = Math.max(0, (next._progress - step._progress) * routeMeters);
    if (!routeMeters || gapMeters > 260 || gapMeters < 8) return '';
    const nextAction = baseInstruction(next).replace(/[.]+$/, '').toLowerCase();
    return ` Then, in ${spokenDistance(gapMeters)}, ${nextAction}.`;
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
      // First guidance lands in the requested 0.3 to 0.5 mile window. If a
      // route starts closer than that, say it as soon as we safely can.
      if (meters <= 805 && meters > 55 && !stages.has('far')) {
        queueSpeech(humanInstruction(step, true, meters), { dedupeMs: 45000 });
        stages.add('far');
      }

      // Final preparation is around 100 feet. If another maneuver follows very
      // quickly, include it in the same sentence so the driver is not surprised.
      if (meters <= 38 && meters > 12 && !stages.has('near')) {
        const phrase = humanInstruction(step, true, meters).replace(/[.]+$/, '') + quickTurnFollowUp(route, step);
        queueSpeech(phrase, { priority: true, dedupeMs: 45000 });
        stages.add('near');
      }

      // GPS can jump past the 100-foot window. In that case, give one concise
      // maneuver call, but never interrupt audio already playing.
      if (meters <= 12 && !stages.has('now')) {
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
    stopSpeech(true);
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
      stopSpeech(true);
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
    stopSpeech(true);
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
    stop(clearPending = true) { stopSpeech(clearPending); },
    mode() { return getVoiceMode(); },
    busy() { return nav.speechRunning || !!nav.activeAudio || nav.speechItems.length > 0; },
    voiceId: ROADCAST_VOICE_ID,
    gain: 1.32,
  };

  const badge = document.querySelector('.badge');
  if (badge) badge.textContent = 'MVP 0.6.2';

  console.info(`RoadCast navigation + voice patch ${VERSION} loaded with voice ${ROADCAST_VOICE_ID}`);
})();
