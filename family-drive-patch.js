'use strict';

(() => {
  const VERSION = '0.7.0';
  const DEFAULT_VOICE_ID = '4hgEYmHo3owVoJYwXakA';
  const PROFILE_KEY = 'roadcast_voice_profiles_v1';
  const SELECTED_KEY = 'roadcast_voice_profile_selected_v1';
  const ATTITUDE_KEY = 'roadcast_attitude_level_v1';
  const WAKE_KEY = 'roadcast_keep_awake_v1';

  let wakeLock = null;

  function slug(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `voice-${Date.now()}`;
  }

  function profiles() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) || '[]');
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}

    const seed = [{ id: 'my-voice', name: 'My Voice', voiceId: DEFAULT_VOICE_ID }];
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
    return rows.find(row => row.id === id) || rows[0];
  }

  function selectProfile(id) {
    const row = profiles().find(p => p.id === id);
    if (!row) return false;
    localStorage.setItem(SELECTED_KEY, row.id);

    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('roadcast_voice_config_v1') || '{}') || {}; } catch {}
    if (cfg.projectUrl && cfg.token) localStorage.setItem('roadcast_voice_mode_v1', 'myvoice');

    document.dispatchEvent(new CustomEvent('roadcast:voiceprofilechanged', { detail: row }));
    window.RoadCastVoice?.refreshUi?.();
    updateProfileUi();
    return true;
  }

  function normalize(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function selectProfileByName(name) {
    const wanted = normalize(name);
    if (!wanted) return { ok: false };
    const row = profiles().find(p => {
      const candidate = normalize(p.name);
      return candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate);
    });
    if (!row) return { ok: false };
    selectProfile(row.id);
    return { ok: true, name: row.name, voiceId: row.voiceId };
  }

  function attitudeLevel() {
    return localStorage.getItem(ATTITUDE_KEY) || 'spicy';
  }

  const attitudeLines = {
    chill: [
      'I am behaving today. Please enjoy this suspiciously professional moment.',
      'No commentary. Just directions. I know, shocking.',
    ],
    playful: [
      'I provide directions. You provide plot twists.',
      'We make a great team. I calculate, you improvise.',
      'My route is highlighted for a reason, but I admire your independence.',
      'RoadCast is judging absolutely nothing. The logs, however, have seen things.',
    ],
    spicy: [
      'I provide directions. Whether you follow them is apparently a separate subscription.',
      'I am one missed turn away from requesting hazard pay.',
      'You drive. I recalculate. Nature is healing.',
      'The route is blue. Your interpretation of it is apparently abstract art.',
      'I have GPS satellites on my side and somehow this is still a negotiation.',
      'I am not saying you are lost. I am saying the destination has concerns.',
    ],
    maximum: [
      'You have turned navigation into an improv class and I did not audition.',
      'At this point the route is less a plan and more a strongly worded suggestion.',
      'I know exactly where we are. I am less certain why we are here.',
      'The satellites and I have formed a support group.',
      'I keep recalculating because apparently optimism is one of my core features.',
      'If confidence were turn accuracy, we would already be there.',
      'RoadCast would like to remind the driver that blue lines are not decorative.',
      'This trip has more plot twists than the directions department approved.',
    ],
  };

  function randomAttitudeLine() {
    const list = attitudeLines[attitudeLevel()] || attitudeLines.spicy;
    return list[Math.floor(Math.random() * list.length)];
  }

  function wakeEnabled() {
    const raw = localStorage.getItem(WAKE_KEY);
    return raw === null ? true : raw === 'true';
  }

  function setWakeStatus(text, good = false) {
    const el = document.getElementById('wakeStatus070');
    if (!el) return;
    el.textContent = text;
    el.dataset.good = good ? 'true' : 'false';
  }

  async function requestWakeLock() {
    if (!wakeEnabled() || !state?.driveActive || document.visibilityState !== 'visible') return;

    if (!('wakeLock' in navigator)) {
      setWakeStatus('💤 Keep-awake unavailable in this browser');
      return;
    }

    if (wakeLock && !wakeLock.released) {
      setWakeStatus('☀️ Screen stays awake while RoadCast is active', true);
      return;
    }

    try {
      wakeLock = await navigator.wakeLock.request('screen');
      setWakeStatus('☀️ Screen stays awake while RoadCast is active', true);
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        if (state?.driveActive && wakeEnabled()) {
          setWakeStatus('💤 Screen wake lock released • will retry when visible');
        } else {
          setWakeStatus('💤 Normal screen timeout restored');
        }
      });
    } catch (err) {
      console.warn('RoadCast screen wake lock unavailable.', err);
      setWakeStatus('💤 Could not keep screen awake • check battery saver');
    }
  }

  async function releaseWakeLock() {
    if (wakeLock && !wakeLock.released) {
      try { await wakeLock.release(); } catch {}
    }
    wakeLock = null;
    setWakeStatus('💤 Normal screen timeout restored');
  }

  function addStyles() {
    if (document.getElementById('familyDriveStyles070')) return;
    const style = document.createElement('style');
    style.id = 'familyDriveStyles070';
    style.textContent = `
      .family-settings-070 {
        margin-top:14px; padding:14px; border:1px solid var(--border);
        border-radius:16px; background:rgba(10,25,42,.66);
      }
      .family-settings-head-070 {
        display:flex; align-items:center; justify-content:space-between;
        gap:10px; margin-bottom:10px; flex-wrap:wrap;
      }
      .family-grid-070 {
        display:grid; grid-template-columns:repeat(2,minmax(0,1fr));
        gap:9px;
      }
      .family-grid-070 label { display:grid; gap:5px; font-size:12px; color:var(--muted); }
      .family-grid-070 input,.family-grid-070 select { min-width:0; width:100%; }
      .family-actions-070 { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
      .family-note-070 { color:var(--muted); font-size:11px; margin-top:8px; line-height:1.4; }
      .family-drive-options-070 {
        margin-top:10px; display:flex; align-items:center; justify-content:space-between;
        gap:10px; flex-wrap:wrap;
      }
      .family-drive-options-070 label {
        display:flex; align-items:center; gap:7px; font-size:12px;
      }
      .family-drive-options-070 input[type="checkbox"] { width:18px; height:18px; }
      #wakeStatus070 {
        margin-top:8px; font-size:12px; color:var(--muted);
      }
      #wakeStatus070[data-good="true"] { color:#8fe0b2; }
      @media (max-width:620px) { .family-grid-070 { grid-template-columns:1fr; } }
    `;
    document.head.appendChild(style);
  }

  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ensureUi() {
    addStyles();

    const setupPanel = document.getElementById('voiceSetupPanel');
    const chip = setupPanel?.querySelector('.voice-id-chip');
    if (setupPanel && chip && !document.getElementById('familySettings070')) {
      const panel = document.createElement('div');
      panel.id = 'familySettings070';
      panel.className = 'family-settings-070';
      panel.innerHTML = `
        <div class="family-settings-head-070">
          <div>
            <strong>👨‍👩‍👦 Family Voice Profiles</strong>
            <div class="check-sub">Save several approved ElevenLabs voices and choose who navigates.</div>
          </div>
        </div>

        <div class="family-grid-070">
          <label>
            <span>Active voice</span>
            <select id="familyVoiceSelect070"></select>
          </label>
          <label>
            <span>Attitude</span>
            <select id="attitudeSelect070">
              <option value="chill">Chill</option>
              <option value="playful">Playful</option>
              <option value="spicy">Spicy 🌶️</option>
              <option value="maximum">Maximum attitude 🔥</option>
            </select>
          </label>
          <label>
            <span>Profile name</span>
            <input id="familyVoiceName070" placeholder="Example: Mom" autocomplete="off">
          </label>
          <label>
            <span>ElevenLabs voice ID</span>
            <input id="familyVoiceId070" placeholder="Paste the approved voice ID" autocomplete="off">
          </label>
        </div>

        <div class="family-actions-070">
          <button id="saveFamilyVoice070" class="primary" type="button">Save voice profile</button>
          <button id="removeFamilyVoice070" type="button">Remove selected</button>
        </div>

        <div class="family-drive-options-070">
          <label><input id="keepAwake070" type="checkbox"> Keep screen awake during RoadCast</label>
        </div>

        <div id="familyVoiceStatus070" class="family-note-070">
          Only add a cloned voice that the speaker has agreed to use.
        </div>
      `;
      chip.insertAdjacentElement('afterend', panel);

      document.getElementById('familyVoiceSelect070')?.addEventListener('change', event => {
        selectProfile(event.target.value);
      });

      document.getElementById('attitudeSelect070')?.addEventListener('change', event => {
        localStorage.setItem(ATTITUDE_KEY, event.target.value);
        const labels = { chill:'Chill', playful:'Playful', spicy:'Spicy', maximum:'Maximum attitude' };
        document.getElementById('familyVoiceStatus070').textContent =
          `${labels[event.target.value] || 'Spicy'} selected. Personality waits behind navigation and safety messages.`;
      });

      document.getElementById('keepAwake070')?.addEventListener('change', async event => {
        localStorage.setItem(WAKE_KEY, String(!!event.target.checked));
        if (event.target.checked) await requestWakeLock();
        else await releaseWakeLock();
      });

      document.getElementById('saveFamilyVoice070')?.addEventListener('click', () => {
        const nameEl = document.getElementById('familyVoiceName070');
        const voiceEl = document.getElementById('familyVoiceId070');
        const status = document.getElementById('familyVoiceStatus070');
        const name = String(nameEl?.value || '').trim();
        const voiceId = String(voiceEl?.value || '').trim();

        if (!name || !voiceId) {
          if (status) status.textContent = 'Enter both a profile name and an ElevenLabs voice ID.';
          return;
        }

        const rows = profiles();
        const existing = rows.find(row => normalize(row.name) === normalize(name));
        if (existing) {
          existing.name = name;
          existing.voiceId = voiceId;
          saveProfiles(rows);
          selectProfile(existing.id);
        } else {
          let id = slug(name);
          let n = 2;
          while (rows.some(row => row.id === id)) id = `${slug(name)}-${n++}`;
          const row = { id, name, voiceId };
          rows.push(row);
          saveProfiles(rows);
          selectProfile(id);
        }

        if (nameEl) nameEl.value = '';
        if (voiceEl) voiceEl.value = '';
        if (status) status.textContent = `${name} saved. Use Test My Voice above to hear the selected profile.`;
        updateProfileUi();
      });

      document.getElementById('removeFamilyVoice070')?.addEventListener('click', () => {
        const rows = profiles();
        if (rows.length <= 1) {
          document.getElementById('familyVoiceStatus070').textContent =
            'Keep at least one RoadCast voice profile.';
          return;
        }
        const current = selectedProfile();
        const remaining = rows.filter(row => row.id !== current.id);
        saveProfiles(remaining);
        localStorage.setItem(SELECTED_KEY, remaining[0].id);
        document.dispatchEvent(new CustomEvent('roadcast:voiceprofilechanged', { detail: remaining[0] }));
        updateProfileUi();
        document.getElementById('familyVoiceStatus070').textContent =
          `${current.name} removed from this device.`;
      });
    }

    const drivePanel = document.getElementById('drivePanel');
    if (drivePanel && !document.getElementById('wakeStatus070')) {
      const status = document.createElement('div');
      status.id = 'wakeStatus070';
      status.textContent = wakeEnabled() ? '☀️ Keep-awake ready' : '💤 Normal screen timeout';
      const weatherStatus = document.getElementById('weatherRefreshStatus');
      if (weatherStatus) weatherStatus.insertAdjacentElement('afterend', status);
      else drivePanel.appendChild(status);
    }

    updateProfileUi();
  }

  function updateProfileUi() {
    const rows = profiles();
    const current = selectedProfile();
    const select = document.getElementById('familyVoiceSelect070');
    if (select) {
      select.innerHTML = rows.map(row => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');
      select.value = current?.id || rows[0]?.id || '';
    }

    const attitude = document.getElementById('attitudeSelect070');
    if (attitude) attitude.value = attitudeLevel();

    const awake = document.getElementById('keepAwake070');
    if (awake) awake.checked = wakeEnabled();

    const chip = document.querySelector('.voice-id-chip');
    if (chip && current) {
      chip.innerHTML = `Active profile: <strong>${esc(current.name)}</strong> • Voice ID: <strong>${esc(current.voiceId)}</strong>`;
    }

    window.RoadCastVoice?.refreshUi?.();
  }

  const priorStartFamily070 = startRoadCast;
  startRoadCast = function(demoMode) {
    const result = priorStartFamily070(demoMode);
    ensureUi();
    if (wakeEnabled()) setTimeout(requestWakeLock, 50);
    return result;
  };

  const priorStopFamily070 = stopDrive;
  stopDrive = function(...args) {
    releaseWakeLock();
    return priorStopFamily070(...args);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state?.driveActive && wakeEnabled()) {
      requestWakeLock();
    }
  });

  window.addEventListener('pagehide', () => releaseWakeLock());
  document.addEventListener('roadcast:voiceprofilechanged', updateProfileUi);

  window.RoadCastFamily = {
    profiles,
    selectedProfile,
    selectProfileByName,
    attitudeLevel,
    randomAttitudeLine,
    wakeEnabled,
    requestWakeLock,
  };

  ensureUi();

  const badge = document.querySelector('.badge');
  if (badge) badge.textContent = 'MVP 0.7';

  console.info(`RoadCast Family Drive ${VERSION} loaded.`);
})();
