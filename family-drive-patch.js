'use strict';

(() => {
  const VERSION = '0.7.1';
  const DEFAULT_VOICE_ID = '4hgEYmHo3owVoJYwXakA';

  const PROFILE_KEY = 'roadcast_voice_profiles_v1';
  const SELECTED_KEY = 'roadcast_voice_profile_selected_v1';
  const ATTITUDE_KEY = 'roadcast_attitude_level_v1';
  const WAKE_KEY = 'roadcast_keep_awake_v1';
  const MAP_KEY = 'roadcast_map_view_v1';

  let wakeLock = null;
  let baseLayer = null;
  const $r = id => document.getElementById(id);

  function esc(v) {
    return String(v || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function slug(v) {
    return String(v || '').toLowerCase()
      .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')
      || `voice-${Date.now()}`;
  }

  function normalize(v) {
    return String(v || '').toLowerCase()
      .replace(/[^a-z0-9]+/g,' ').trim();
  }

  function profiles() {
    try {
      const rows = JSON.parse(localStorage.getItem(PROFILE_KEY) || '[]');
      if (Array.isArray(rows) && rows.length) return rows;
    } catch {}
    const seed = [{id:'my-voice',name:'My Voice',voiceId:DEFAULT_VOICE_ID}];
    localStorage.setItem(PROFILE_KEY, JSON.stringify(seed));
    localStorage.setItem(SELECTED_KEY, seed[0].id);
    return seed;
  }

  function saveProfiles(rows) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(rows));
  }

  function selectedProfile() {
    const rows = profiles();
    const id = localStorage.getItem(SELECTED_KEY) || rows[0]?.id;
    return rows.find(r => r.id === id) || rows[0];
  }

  function selectProfile(id) {
    const row = profiles().find(r => r.id === id);
    if (!row) return false;
    localStorage.setItem(SELECTED_KEY, row.id);

    try {
      const cfg = JSON.parse(localStorage.getItem('roadcast_voice_config_v1') || '{}') || {};
      if (cfg.projectUrl && cfg.token) {
        localStorage.setItem('roadcast_voice_mode_v1','myvoice');
      }
    } catch {}

    document.dispatchEvent(new CustomEvent('roadcast:voiceprofilechanged',{detail:row}));
    window.RoadCastVoice?.refreshUi?.();
    updateUi();
    return true;
  }

  function selectProfileByName(name) {
    const wanted = normalize(name);
    const row = profiles().find(r => {
      const n = normalize(r.name);
      return n === wanted || n.includes(wanted) || wanted.includes(n);
    });
    if (!row) return {ok:false};
    selectProfile(row.id);
    return {ok:true,name:row.name,voiceId:row.voiceId};
  }

  function attitudeLevel() {
    const v = localStorage.getItem(ATTITUDE_KEY) || 'spicy';
    return ['chill','playful','spicy','maximum'].includes(v) ? v : 'spicy';
  }

  const attitudeLines = {
    chill: [
      'I am behaving today. Please enjoy this suspiciously professional moment.',
      'No commentary. Just directions. I know, shocking.'
    ],
    playful: [
      'I provide directions. You provide plot twists.',
      'We make a great team. I calculate, you improvise.',
      'My route is highlighted for a reason, but I admire your independence.'
    ],
    spicy: [
      'I provide directions. Whether you follow them is apparently a separate subscription.',
      'I am one missed turn away from requesting hazard pay.',
      'The route is blue. Your interpretation of it is apparently abstract art.',
      'I am not saying you are lost. I am saying the destination has concerns.'
    ],
    maximum: [
      'You have turned navigation into an improv class and I did not audition.',
      'The satellites and I have formed a support group.',
      'If confidence were turn accuracy, we would already be there.',
      'RoadCast would like to remind the driver that blue lines are not decorative.',
      'This trip has more plot twists than the directions department approved.'
    ]
  };

  function randomAttitudeLine() {
    const list = attitudeLines[attitudeLevel()] || attitudeLines.spicy;
    return list[Math.floor(Math.random() * list.length)];
  }

  function wakeEnabled() {
    const raw = localStorage.getItem(WAKE_KEY);
    return raw === null ? true : raw === 'true';
  }

  function mapView() {
    return localStorage.getItem(MAP_KEY) === 'satellite' ? 'satellite' : 'street';
  }

  function setWakeStatus(text, good=false) {
    for (const id of ['settingsWakeStatus071','wakeStatus070']) {
      const el = $r(id);
      if (el) {
        el.textContent = text;
        el.dataset.good = good ? 'true' : 'false';
      }
    }
  }

  async function requestWakeLock() {
    if (!wakeEnabled() || !state?.driveActive || document.visibilityState !== 'visible') return;

    if (!('wakeLock' in navigator)) {
      setWakeStatus('💤 Keep-awake unavailable in this browser');
      return;
    }

    if (wakeLock && !wakeLock.released) {
      setWakeStatus('☀️ Screen stays awake during RoadCast', true);
      return;
    }

    try {
      wakeLock = await navigator.wakeLock.request('screen');
      setWakeStatus('☀️ Screen stays awake during RoadCast', true);
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        if (state?.driveActive && wakeEnabled()) {
          setWakeStatus('💤 Wake lock released • will retry when visible');
        } else {
          setWakeStatus('☀️ Keep-awake ready');
        }
      });
    } catch (err) {
      console.warn('RoadCast wake lock unavailable.', err);
      setWakeStatus('💤 Could not keep screen awake • check battery saver');
    }
  }

  async function releaseWakeLock() {
    if (wakeLock && !wakeLock.released) {
      try { await wakeLock.release(); } catch {}
    }
    wakeLock = null;
    setWakeStatus(wakeEnabled() ? '☀️ Keep-awake ready' : '💤 Normal screen timeout');
  }

  function roadCastTile(layer) {
    if (!(layer instanceof L.TileLayer)) return false;
    const url = String(layer._url || '');
    return url.includes('tile.openstreetmap.org') ||
           url.includes('World_Imagery/MapServer/tile');
  }

  function applyMapView() {
    const mode = mapView();
    const select = $r('settingsMapView071');
    const status = $r('settingsMapStatus071');
    if (select) select.value = mode;

    if (!state?.map || typeof L === 'undefined') {
      if (status) {
        status.textContent = mode === 'satellite'
          ? '🛰️ Satellite selected • applies when map opens'
          : '🗺️ Street map';
      }
      return;
    }

    state.map.eachLayer(layer => {
      if (roadCastTile(layer)) {
        try { state.map.removeLayer(layer); } catch {}
      }
    });

    if (mode === 'satellite') {
      baseLayer = L.tileLayer(
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom:19,
          attribution:'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
          updateWhenIdle:false,
          updateWhenZooming:false,
          keepBuffer:4
        }
      ).addTo(state.map);
      if (status) status.textContent = '🛰️ Satellite view';
    } else {
      baseLayer = L.tileLayer(
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          maxZoom:19,
          attribution:'&copy; OpenStreetMap contributors',
          updateWhenIdle:false,
          updateWhenZooming:false,
          keepBuffer:4
        }
      ).addTo(state.map);
      if (status) status.textContent = '🗺️ Street map';
    }

    try { baseLayer.bringToBack(); } catch {}
  }

  function voiceReady() {
    try {
      const cfg = JSON.parse(localStorage.getItem('roadcast_voice_config_v1') || '{}') || {};
      return !!(cfg.projectUrl && cfg.token);
    } catch {
      return false;
    }
  }

  function openVoiceConnection() {
    const panel = $r('voiceSetupPanel');
    if (!panel) return;
    panel.classList.remove('hidden');
    panel.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  function addStyles() {
    if ($r('familyDriveStyles071')) return;
    const style = document.createElement('style');
    style.id = 'familyDriveStyles071';
    style.textContent = `
      .roadcast-settings-card-071{display:grid;gap:12px}
      .roadcast-settings-grid-071{
        display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px
      }
      .roadcast-settings-grid-071 label{
        display:grid;gap:6px;min-width:0;color:var(--muted);font-size:12px
      }
      .roadcast-settings-grid-071 select,
      .roadcast-settings-grid-071 input{width:100%;min-width:0}
      .roadcast-check-row-071{
        display:flex!important;flex-direction:row!important;align-items:center;
        align-self:end;padding:11px 10px;border:1px solid var(--border);
        border-radius:12px;color:#dce8f6!important
      }
      .roadcast-check-row-071 input{width:19px!important;height:19px;flex:0 0 auto}
      .roadcast-settings-status-071{
        display:flex;flex-wrap:wrap;gap:8px 14px;color:var(--muted);font-size:12px
      }
      #settingsWakeStatus071[data-good="true"],#wakeStatus070[data-good="true"]{color:#8fe0b2}
      .family-voice-details-071{border-top:1px solid var(--border);padding-top:11px}
      .family-voice-details-071 summary{cursor:pointer;font-weight:700;color:#eaf3ff;padding:5px 0}
      .family-profile-copy-071{margin:8px 0 10px;color:var(--muted);font-size:12px}
      .roadcast-settings-actions-071{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
      #wakeStatus070{margin-top:8px;color:var(--muted);font-size:12px}
      @media(max-width:620px){.roadcast-settings-grid-071{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function updateUi() {
    const rows = profiles();
    const current = selectedProfile();

    const voice = $r('settingsActiveVoice071');
    if (voice) {
      voice.innerHTML = rows.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
      voice.value = current?.id || rows[0]?.id || '';
    }

    if ($r('settingsAttitude071')) $r('settingsAttitude071').value = attitudeLevel();
    if ($r('settingsKeepAwake071')) $r('settingsKeepAwake071').checked = wakeEnabled();
    if ($r('settingsMapView071')) $r('settingsMapView071').value = mapView();

    const chip = document.querySelector('.voice-id-chip');
    if (chip && current) {
      chip.innerHTML = `Active profile: <strong>${esc(current.name)}</strong> • Voice ID: <strong>${esc(current.voiceId)}</strong>`;
    }

    window.RoadCastVoice?.refreshUi?.();
  }

  function bind(id, event, handler) {
    const el = $r(id);
    if (!el || el.dataset.bound071) return;
    el.dataset.bound071 = 'true';
    el.addEventListener(event, handler);
  }

  function bindUi() {
    addStyles();
    updateUi();
    applyMapView();

    if (!$r('wakeStatus070') && $r('drivePanel')) {
      const el = document.createElement('div');
      el.id = 'wakeStatus070';
      const weather = $r('weatherRefreshStatus');
      if (weather) weather.insertAdjacentElement('afterend',el);
      else $r('drivePanel').appendChild(el);
    }

    setWakeStatus(wakeEnabled() ? '☀️ Keep-awake ready' : '💤 Normal screen timeout');

    bind('settingsActiveVoice071','change',e => {
      selectProfile(e.target.value);
      const c = selectedProfile();
      if ($r('settingsFamilyStatus071') && c) {
        $r('settingsFamilyStatus071').textContent = `${c.name} selected as the RoadCast voice.`;
      }
    });

    bind('settingsAttitude071','change',e => {
      localStorage.setItem(ATTITUDE_KEY,e.target.value);
      if ($r('settingsFamilyStatus071')) {
        $r('settingsFamilyStatus071').textContent =
          `${e.target.options[e.target.selectedIndex].text} selected. Personality still waits behind navigation and safety.`;
      }
    });

    bind('settingsMapView071','change',e => {
      localStorage.setItem(MAP_KEY,e.target.value === 'satellite' ? 'satellite' : 'street');
      applyMapView();
    });

    bind('settingsKeepAwake071','change',async e => {
      localStorage.setItem(WAKE_KEY,String(!!e.target.checked));
      if (e.target.checked) {
        if (state?.driveActive) await requestWakeLock();
        else setWakeStatus('☀️ Keep-awake ready');
      } else {
        await releaseWakeLock();
        setWakeStatus('💤 Normal screen timeout');
      }
    });

    bind('settingsSaveVoice071','click',() => {
      const name = String($r('settingsProfileName071')?.value || '').trim();
      const voiceId = String($r('settingsVoiceId071')?.value || '').trim();
      const status = $r('settingsFamilyStatus071');

      if (!name || !voiceId) {
        if (status) status.textContent = 'Enter both a profile name and an ElevenLabs voice ID.';
        return;
      }

      const rows = profiles();
      const existing = rows.find(r => normalize(r.name) === normalize(name));

      if (existing) {
        existing.name = name;
        existing.voiceId = voiceId;
        saveProfiles(rows);
        selectProfile(existing.id);
      } else {
        let id = slug(name), n = 2;
        while (rows.some(r => r.id === id)) id = `${slug(name)}-${n++}`;
        rows.push({id,name,voiceId});
        saveProfiles(rows);
        selectProfile(id);
      }

      if ($r('settingsProfileName071')) $r('settingsProfileName071').value = '';
      if ($r('settingsVoiceId071')) $r('settingsVoiceId071').value = '';
      if (status) status.textContent = `${name} saved and selected.`;
      updateUi();
    });

    bind('settingsRemoveVoice071','click',() => {
      const rows = profiles();
      const status = $r('settingsFamilyStatus071');

      if (rows.length <= 1) {
        if (status) status.textContent = 'Keep at least one voice profile.';
        return;
      }

      const current = selectedProfile();
      const remaining = rows.filter(r => r.id !== current.id);
      saveProfiles(remaining);
      localStorage.setItem(SELECTED_KEY,remaining[0].id);
      document.dispatchEvent(new CustomEvent('roadcast:voiceprofilechanged',{detail:remaining[0]}));
      if (status) status.textContent = `${current.name} removed from this device.`;
      updateUi();
    });

    bind('settingsTestVoice071','click',() => {
      const current = selectedProfile();
      const status = $r('settingsFamilyStatus071');

      if (!voiceReady()) {
        if (status) status.textContent = 'Open Voice connection once so RoadCast can use your saved Supabase voice service.';
        openVoiceConnection();
        return;
      }

      localStorage.setItem('roadcast_voice_mode_v1','myvoice');
      window.RoadCastVoice?.refreshUi?.();
      window.RoadCastVoice?.speak(
        `${current.name} is selected. RoadCast Family Drive is ready.`,
        {category:'info',force:true,dedupeMs:1000}
      );
      if (status) status.textContent = `Testing ${current.name}…`;
    });

    bind('settingsVoiceConnection071','click',openVoiceConnection);
  }

  const priorRenderTrip071 = renderTrip;
  renderTrip = function(...args) {
    const result = priorRenderTrip071(...args);
    setTimeout(() => {
      bindUi();
      applyMapView();
    },0);
    return result;
  };

  const priorStartFamily071 = startRoadCast;
  startRoadCast = function(demoMode) {
    const result = priorStartFamily071(demoMode);
    bindUi();
    applyMapView();
    if (wakeEnabled()) setTimeout(requestWakeLock,80);
    return result;
  };

  const priorStopFamily071 = stopDrive;
  stopDrive = function(...args) {
    releaseWakeLock();
    return priorStopFamily071(...args);
  };

  document.addEventListener('visibilitychange',() => {
    if (document.visibilityState === 'visible' && state?.driveActive && wakeEnabled()) {
      requestWakeLock();
    }
  });

  document.addEventListener('roadcast:voiceprofilechanged',updateUi);
  window.addEventListener('pagehide',releaseWakeLock);

  window.RoadCastFamily = {
    profiles,selectedProfile,selectProfileByName,
    attitudeLevel,randomAttitudeLine,wakeEnabled,
    requestWakeLock,mapView,applyMapView
  };

  bindUi();

  const badge = document.querySelector('.hero .badge');
  if (badge) badge.textContent = 'MVP 0.7.1';

  console.info(`RoadCast visible settings + satellite ${VERSION} loaded.`);
})();
