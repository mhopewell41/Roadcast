'use strict';

(() => {
  const VERSION = '0.6.1';
  const ENABLED_KEY = 'roadcast_handsfree_enabled_v1';
  const LISTEN_MS = 7000;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  const hf = {
    enabled: localStorage.getItem(ENABLED_KEY) === 'true',
    listening: false,
    recognition: null,
    stopTimer: null,
    lastRoadCastPhrase: '',
    lastTranscript: '',
    pendingOpen: null,
  };

  function addStyles() {
    if (document.getElementById('handsFreeStyles061')) return;
    const style = document.createElement('style');
    style.id = 'handsFreeStyles061';
    style.textContent = `
      .handsfree-status-061 {
        margin-top:8px; display:flex; align-items:center; gap:8px;
        color:var(--muted); font-size:12px;
      }
      .handsfree-dot-061 {
        width:9px; height:9px; border-radius:50%; background:#65758a;
        box-shadow:0 0 0 0 rgba(73,169,255,0);
      }
      .handsfree-status-061.listening .handsfree-dot-061 {
        background:#48a8ff;
        animation:roadcastMicPulse061 1.1s infinite;
      }
      .handsfree-status-061.heard .handsfree-dot-061 { background:#78d49e; }
      #handsFreeBtn061.active {
        border-color:#5fa8ff;
        background:rgba(47,128,237,.22);
      }
      @keyframes roadcastMicPulse061 {
        0% { box-shadow:0 0 0 0 rgba(73,169,255,.55); }
        70% { box-shadow:0 0 0 9px rgba(73,169,255,0); }
        100% { box-shadow:0 0 0 0 rgba(73,169,255,0); }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureUi() {
    addStyles();

    const toolbar = document.querySelector('.voice-toolbar-buttons');
    if (toolbar && !document.getElementById('handsFreeBtn061')) {
      const btn = document.createElement('button');
      btn.id = 'handsFreeBtn061';
      btn.type = 'button';
      toolbar.appendChild(btn);
      btn.addEventListener('click', toggleHandsFree);
    }

    const voiceToolbar = document.querySelector('.voice-toolbar');
    if (voiceToolbar && !document.getElementById('handsFreeStatus061')) {
      const status = document.createElement('div');
      status.id = 'handsFreeStatus061';
      status.className = 'handsfree-status-061';
      status.innerHTML = '<span class="handsfree-dot-061"></span><span id="handsFreeStatusText061">Hands-free replies off</span>';
      voiceToolbar.insertAdjacentElement('afterend', status);
    }

    updateUi();
  }

  function setStatus(text, cls = '') {
    const host = document.getElementById('handsFreeStatus061');
    const copy = document.getElementById('handsFreeStatusText061');
    if (copy) copy.textContent = text;
    if (host) host.className = `handsfree-status-061 ${cls}`.trim();
  }

  function updateUi() {
    const btn = document.getElementById('handsFreeBtn061');
    if (!btn) return;
    btn.textContent = hf.enabled ? '🎤 Hands-free ON' : '🎤 Hands-free';
    btn.classList.toggle('active', hf.enabled);
    if (!hf.enabled) setStatus('Hands-free replies off');
    else if (!SpeechRecognition) setStatus('Hands-free voice replies are not supported in this browser');
    else if (!hf.listening) setStatus('Ready • I listen for 7 seconds after RoadCast speaks');
  }

  async function toggleHandsFree() {
    if (!SpeechRecognition) {
      hf.enabled = false;
      localStorage.setItem(ENABLED_KEY, 'false');
      updateUi();
      return;
    }

    if (hf.enabled) {
      hf.enabled = false;
      localStorage.setItem(ENABLED_KEY, 'false');
      stopListening();
      updateUi();
      return;
    }

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      }
      hf.enabled = true;
      localStorage.setItem(ENABLED_KEY, 'true');
      updateUi();
      window.RoadCastVoice?.speak(
        'Hands-free replies are on. After I speak, you have about seven seconds to ask for weather, traffic, ETA, a repeat, or map help.',
        { dedupeMs: 1000 }
      );
    } catch (err) {
      console.warn('RoadCast microphone permission denied.', err);
      hf.enabled = false;
      localStorage.setItem(ENABLED_KEY, 'false');
      setStatus('Microphone permission is needed for hands-free replies');
      updateUi();
    }
  }

  function stopListening() {
    clearTimeout(hf.stopTimer);
    clearTimeout(hf.pendingOpen);
    if (hf.recognition) {
      try { hf.recognition.abort(); } catch {}
    }
    hf.recognition = null;
    hf.listening = false;
    updateUi();
  }

  function openListeningWindow() {
    if (!hf.enabled || !SpeechRecognition || !state?.driveActive) return;
    if (window.RoadCastVoice?.busy?.()) return;

    stopListening();

    const recognition = new SpeechRecognition();
    hf.recognition = recognition;
    hf.listening = true;

    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      hf.listening = true;
      setStatus('Listening… say weather, traffic, ETA, repeat, recenter, or help', 'listening');
    };

    recognition.onresult = event => {
      const text = String(event.results?.[0]?.[0]?.transcript || '').trim();
      hf.lastTranscript = text;
      hf.listening = false;
      setStatus(`Heard: “${text}”`, 'heard');
      handleCommand(text);
    };

    recognition.onerror = event => {
      hf.listening = false;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        hf.enabled = false;
        localStorage.setItem(ENABLED_KEY, 'false');
        setStatus('Microphone permission was blocked');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setStatus(`Hands-free listening paused: ${event.error || 'unknown error'}`);
      } else {
        updateUi();
      }
    };

    recognition.onend = () => {
      hf.listening = false;
      clearTimeout(hf.stopTimer);
      if (hf.recognition === recognition) hf.recognition = null;
      if (hf.enabled) updateUi();
    };

    try {
      recognition.start();
      hf.stopTimer = setTimeout(() => {
        try { recognition.stop(); } catch {}
      }, LISTEN_MS);
    } catch (err) {
      hf.listening = false;
      console.warn('RoadCast recognition could not start.', err);
      updateUi();
    }
  }

  function speak(text, options = {}) {
    window.RoadCastVoice?.speak(text, { dedupeMs: 1000, ...options });
  }

  function etaReply() {
    const remaining = document.getElementById('driveRemaining')?.textContent?.trim() || '';
    const eta = document.getElementById('driveEta')?.textContent?.trim() || '';
    const bits = [];
    if (remaining && !remaining.includes('--')) bits.push(`${remaining} remaining`);
    if (eta && !eta.includes('--')) bits.push(`arrival around ${eta}`);
    return bits.length ? `You have ${bits.join(', ')}.` : 'I am still calculating your remaining time.';
  }

  function trafficReply() {
    const route = state?.trip?.route;
    if (!route) return 'I do not have an active traffic route yet.';
    const delay = Math.max(0, Math.round(Number(route.trafficDelay || 0) / 60));
    const mins = Math.max(1, Math.round(Number(route.duration || 0) / 60));
    if (route.source === 'google-traffic') {
      if (delay >= 2) return `Current traffic is adding about ${delay} minutes. The route is about ${mins} minutes total.`;
      return `Traffic looks pretty light. The current route is about ${mins} minutes.`;
    }
    return 'I am using the standard route right now, so live Google traffic is not available for this trip.';
  }

  function weatherReply() {
    return window.RoadCastWeather?.summaryText?.()
      || 'RoadCast weather monitoring is active and checking the route every two minutes.';
  }

  function handleCommand(raw) {
    const text = String(raw || '').toLowerCase().replace(/[?.!,]/g, '').trim();
    if (!text) return;

    if (/\b(repeat|say that again|what did you say)\b/.test(text)) {
      speak(hf.lastRoadCastPhrase || 'There is nothing to repeat yet.');
      return;
    }

    if (/\b(weather|rain|storm|temperature|forecast)\b/.test(text)) {
      speak(weatherReply());
      return;
    }

    if (/\b(traffic|jam|delay|congestion)\b/.test(text)) {
      speak(trafficReply());
      return;
    }

    if (/\b(eta|how much longer|how long|when will|arrival|time left)\b/.test(text)) {
      speak(etaReply());
      return;
    }

    if (/\b(where are we going|destination|where am i going)\b/.test(text)) {
      speak(`We are headed to ${state.destination?.name || 'your selected destination'}.`);
      return;
    }

    if (/\b(recenter|center the map|follow me)\b/.test(text)) {
      document.getElementById('recenterMapBtn')?.click();
      speak('Recentered. I am following your position again.');
      return;
    }

    if (/\b(route overview|show the route|show route|whole route)\b/.test(text)) {
      document.getElementById('routeOverviewBtn')?.click();
      speak('Showing the remaining route.');
      return;
    }

    if (/\b(zoom in)\b/.test(text)) {
      try { state.map?.zoomIn(); } catch {}
      speak('Zooming in.');
      return;
    }

    if (/\b(zoom out)\b/.test(text)) {
      try { state.map?.zoomOut(); } catch {}
      speak('Zooming out.');
      return;
    }

    if (/\b(north up)\b/.test(text)) {
      document.getElementById('mapCompassBtn')?.click();
      speak('North is up.');
      return;
    }

    if (/\b(direction up|heading up)\b/.test(text)) {
      const btn = document.getElementById('directionUp044');
      if (btn && !btn.textContent.includes('Direction Up')) btn.click();
      speak('Direction up is active.');
      return;
    }

    if (/\b(mute|quiet|voice off)\b/.test(text)) {
      speak('Going quiet.');
      setTimeout(() => document.getElementById('voiceToggleBtn')?.click(), 1200);
      return;
    }

    if (/\b(voice on|unmute|talk again)\b/.test(text)) {
      const btn = document.getElementById('voiceToggleBtn');
      if (btn?.textContent?.includes('off')) btn.click();
      setTimeout(() => speak('I am back.'), 150);
      return;
    }

    if (/\b(help|what can i say|commands)\b/.test(text)) {
      speak('Try weather, traffic, ETA, repeat that, destination, recenter, route overview, zoom in, zoom out, north up, or mute.');
      return;
    }

    if (/\b(give me attitude|make me laugh|sarcasm|be sarcastic)\b/.test(text)) {
      const lines = [
        'I am saving the premium sarcasm for your next missed turn.',
        'RoadCast is fully prepared to judge your navigation choices respectfully.',
        'I provide directions. Whether you follow them is apparently a separate subscription.',
      ];
      speak(lines[Math.floor(Math.random() * lines.length)]);
      return;
    }

    // Unknown speech is deliberately silent so RoadCast does not become a
    // chatterbox just because passengers are talking.
    setStatus(`Heard “${raw}” • no RoadCast command`, 'heard');
  }

  document.addEventListener('roadcast:speechstart', event => {
    stopListening();
    const text = String(event.detail?.text || '').trim();
    if (text) hf.lastRoadCastPhrase = text;
  });

  document.addEventListener('roadcast:speechend', event => {
    const text = String(event.detail?.text || '').trim();
    if (text) hf.lastRoadCastPhrase = text;
    if (!hf.enabled || !state?.driveActive) return;
    clearTimeout(hf.pendingOpen);
    hf.pendingOpen = setTimeout(openListeningWindow, 380);
  });

  const priorStartHandsFree061 = startRoadCast;
  startRoadCast = function(demoMode) {
    const result = priorStartHandsFree061(demoMode);
    ensureUi();
    if (hf.enabled) setStatus('Hands-free ready • I will listen after RoadCast speaks');
    return result;
  };

  const priorStopHandsFree061 = stopDrive;
  stopDrive = function(...args) {
    stopListening();
    return priorStopHandsFree061(...args);
  };

  ensureUi();

  const badge = document.querySelector('.badge');
  if (badge) badge.textContent = 'MVP 0.6.1';

  console.info(`RoadCast hands-free reply window ${VERSION} loaded.`);
})();
