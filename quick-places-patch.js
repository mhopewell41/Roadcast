'use strict';

(() => {
  const VERSION = '0.7.2';
  const HOME_KEY = 'roadcast_home_place_v1';
  const WORK_KEY = 'roadcast_work_place_v1';
  const RECENTS_KEY = 'roadcast_recent_places_v1';
  const MAX_RECENTS = 6;

  const $q = id => document.getElementById(id);

  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function placeKey(place) {
    if (!place) return '';
    const lat = Number(place.lat);
    const lon = Number(place.lon);
    return `${lat.toFixed(5)}|${lon.toFixed(5)}`;
  }

  function normalizePlace(place) {
    if (!place) return null;
    const lat = Number(place.lat ?? place.latitude);
    const lon = Number(place.lon ?? place.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return {
      name: String(place.name || place.display_name || 'Saved place').trim(),
      lat,
      lon,
      admin1: String(place.admin1 || '').trim(),
      country: String(place.country || '').trim(),
      address: String(place.address || place.display || '').trim(),
      savedAt: Date.now()
    };
  }

  function readPlace(key) {
    try {
      return normalizePlace(JSON.parse(localStorage.getItem(key) || 'null'));
    } catch {
      return null;
    }
  }

  function writePlace(key, place) {
    const normalized = normalizePlace(place);
    if (!normalized) return false;
    localStorage.setItem(key, JSON.stringify(normalized));
    return true;
  }

  function getRecents() {
    try {
      const rows = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
      if (!Array.isArray(rows)) return [];
      return rows.map(normalizePlace).filter(Boolean);
    } catch {
      return [];
    }
  }

  function saveRecents(rows) {
    localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify(rows.slice(0, MAX_RECENTS))
    );
  }

  function rememberRecent(place) {
    const normalized = normalizePlace(place);
    if (!normalized) return;

    const key = placeKey(normalized);
    const rows = getRecents()
      .filter(row => placeKey(row) !== key);

    rows.unshift(normalized);
    saveRecents(rows);
    renderQuickPlaces();
  }

  function displayName(place) {
    if (!place) return '';
    const bits = [place.name, place.admin1].filter(Boolean);
    return bits.join(', ');
  }

  function selectSavedPlace(place, source = 'Saved place') {
    const normalized = normalizePlace(place);
    if (!normalized) return false;

    if (state?.driveActive) {
      try { stopDrive(); } catch {}
    }

    state.destination = {
      name: normalized.name,
      lat: normalized.lat,
      lon: normalized.lon,
      admin1: normalized.admin1,
      country: normalized.country
    };

    const display = displayName(normalized);
    if (els.destinationInput) els.destinationInput.value = display;
    if (els.searchResults) els.searchResults.innerHTML = '';

    if (els.selectedDestination) {
      els.selectedDestination.classList.remove('hidden');
      els.selectedDestination.innerHTML =
        `<strong>📍 ${esc(source)}</strong>` +
        `<div class="check-sub">${esc(display)}</div>`;
    }

    $q('savePlaceActions072')?.classList.remove('hidden');

    if (els.tripSection) els.tripSection.classList.add('hidden');
    state.trip = null;

    if (typeof setStatus === 'function') {
      setStatus(`${source} selected. Tap CHECK MY TRIP when ready.`);
    }

    rememberRecent(normalized);
    return true;
  }

  function selectedDestinationPlace() {
    return normalizePlace(state?.destination);
  }

  function saveAs(key, label) {
    const place = selectedDestinationPlace();
    if (!place) {
      if (typeof setStatus === 'function') {
        setStatus(`Choose a destination first, then save it as ${label}.`, true);
      }
      return;
    }

    writePlace(key, place);
    rememberRecent(place);
    renderQuickPlaces();

    if (typeof setStatus === 'function') {
      setStatus(`${displayName(place)} saved as ${label}.`);
    }
  }

  function recentButton(place, index) {
    const label = displayName(place);
    return `
      <button type="button"
              class="recent-place-btn-072"
              data-recent072="${index}"
              title="${esc(label)}">
        <span>🕘</span>
        <span>${esc(place.name)}</span>
      </button>`;
  }

  function renderQuickPlaces() {
    const home = readPlace(HOME_KEY);
    const work = readPlace(WORK_KEY);
    const recents = getRecents();

    const homeBtn = $q('homePlaceBtn072');
    const workBtn = $q('workPlaceBtn072');
    const recentHost = $q('recentPlaces072');
    const status = $q('quickPlacesStatus072');

    if (homeBtn) {
      homeBtn.classList.toggle('saved', !!home);
      homeBtn.innerHTML = home
        ? `<span>🏠</span><span><strong>Home</strong><small>${esc(home.name)}</small></span>`
        : `<span>🏠</span><span><strong>Home</strong><small>Not set</small></span>`;
      homeBtn.title = home
        ? `Go to ${displayName(home)}`
        : 'Choose a destination, then tap Save as Home';
    }

    if (workBtn) {
      workBtn.classList.toggle('saved', !!work);
      workBtn.innerHTML = work
        ? `<span>💼</span><span><strong>Work</strong><small>${esc(work.name)}</small></span>`
        : `<span>💼</span><span><strong>Work</strong><small>Not set</small></span>`;
      workBtn.title = work
        ? `Go to ${displayName(work)}`
        : 'Choose a destination, then tap Save as Work';
    }

    if (recentHost) {
      if (!recents.length) {
        recentHost.innerHTML =
          '<div class="recent-empty-072">Recent destinations will appear here automatically.</div>';
      } else {
        recentHost.innerHTML =
          `<div class="recent-label-072">Recent</div>` +
          recents.map(recentButton).join('') +
          `<button id="clearRecents072" class="clear-recents-072" type="button">Clear</button>`;

        recentHost.querySelectorAll('[data-recent072]').forEach(button => {
          button.addEventListener('click', () => {
            const index = Number(button.dataset.recent072);
            const row = getRecents()[index];
            if (row) selectSavedPlace(row, 'Recent destination');
          });
        });

        $q('clearRecents072')?.addEventListener('click', () => {
          localStorage.removeItem(RECENTS_KEY);
          renderQuickPlaces();
          if (typeof setStatus === 'function') {
            setStatus('Recent destinations cleared.');
          }
        });
      }
    }

    if (status) {
      const parts = [];
      if (home) parts.push('Home ready');
      if (work) parts.push('Work ready');
      if (recents.length) parts.push(`${recents.length} recent`);
      status.textContent = parts.length
        ? parts.join(' • ')
        : 'Choose a destination to set Home or Work';
    }
  }

  function addStyles() {
    if ($q('quickPlacesStyles072')) return;

    const style = document.createElement('style');
    style.id = 'quickPlacesStyles072';
    style.textContent = `
      .quick-places-072 {
        margin-top:12px;
        padding:12px;
        border:1px solid var(--border);
        border-radius:16px;
        background:rgba(10,25,42,.58);
      }

      .quick-places-title-072 {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        flex-wrap:wrap;
        margin-bottom:9px;
      }

      .quick-places-title-072 span {
        color:var(--muted);
        font-size:11px;
      }

      .quick-place-main-072 {
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:8px;
      }

      .quick-place-main-072 button {
        display:flex;
        align-items:center;
        gap:9px;
        text-align:left;
        min-width:0;
        padding:10px 12px;
      }

      .quick-place-main-072 button > span:first-child {
        font-size:20px;
      }

      .quick-place-main-072 button > span:last-child {
        display:grid;
        min-width:0;
      }

      .quick-place-main-072 small {
        display:block;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        color:var(--muted);
        font-size:10px;
      }

      .quick-place-main-072 button.saved {
        border-color:#5fa8ff;
        background:rgba(47,128,237,.13);
      }

      .save-place-actions-072 {
        display:flex;
        flex-wrap:wrap;
        gap:7px;
        margin:8px 0 3px;
      }

      .recent-places-072 {
        display:flex;
        align-items:center;
        gap:6px;
        overflow-x:auto;
        padding-top:9px;
        scrollbar-width:thin;
      }

      .recent-label-072 {
        flex:0 0 auto;
        color:var(--muted);
        font-size:11px;
        padding-right:2px;
      }

      .recent-place-btn-072 {
        flex:0 0 auto;
        display:flex;
        align-items:center;
        gap:5px;
        max-width:145px;
        padding:7px 9px;
        font-size:11px;
      }

      .recent-place-btn-072 span:last-child {
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      .recent-empty-072 {
        color:var(--muted);
        font-size:11px;
        padding:2px 0;
      }

      .clear-recents-072 {
        flex:0 0 auto;
        padding:7px 9px;
        font-size:10px;
        opacity:.8;
      }

      @media(max-width:520px) {
        .quick-place-main-072 {
          grid-template-columns:1fr 1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function bindUi() {
    addStyles();
    renderQuickPlaces();

    const homeBtn = $q('homePlaceBtn072');
    if (homeBtn && !homeBtn.dataset.bound072) {
      homeBtn.dataset.bound072 = 'true';
      homeBtn.addEventListener('click', () => {
        const home = readPlace(HOME_KEY);

        if (home) {
          selectSavedPlace(home, 'Home');
          return;
        }

        const selected = selectedDestinationPlace();
        if (selected) {
          saveAs(HOME_KEY, 'Home');
          return;
        }

        if (typeof setStatus === 'function') {
          setStatus('Home is not set yet. Search for your home destination, select it, then tap Save as Home.', true);
        }
        els.destinationInput?.focus();
      });
    }

    const workBtn = $q('workPlaceBtn072');
    if (workBtn && !workBtn.dataset.bound072) {
      workBtn.dataset.bound072 = 'true';
      workBtn.addEventListener('click', () => {
        const work = readPlace(WORK_KEY);

        if (work) {
          selectSavedPlace(work, 'Work');
          return;
        }

        const selected = selectedDestinationPlace();
        if (selected) {
          saveAs(WORK_KEY, 'Work');
          return;
        }

        if (typeof setStatus === 'function') {
          setStatus('Work is not set yet. Search for your work destination, select it, then tap Save as Work.', true);
        }
        els.destinationInput?.focus();
      });
    }

    const saveHome = $q('saveHome072');
    if (saveHome && !saveHome.dataset.bound072) {
      saveHome.dataset.bound072 = 'true';
      saveHome.addEventListener('click', () => saveAs(HOME_KEY, 'Home'));
    }

    const saveWork = $q('saveWork072');
    if (saveWork && !saveWork.dataset.bound072) {
      saveWork.dataset.bound072 = 'true';
      saveWork.addEventListener('click', () => saveAs(WORK_KEY, 'Work'));
    }
  }

  // Existing destination selection should reveal save actions and remember
  // the selected location as a recent place.
  if (typeof selectDestination === 'function') {
    const priorSelectDestination072 = selectDestination;
    selectDestination = function(index) {
      const result = priorSelectDestination072(index);
      const place = selectedDestinationPlace();
      if (place) {
        $q('savePlaceActions072')?.classList.remove('hidden');
        rememberRecent(place);
      }
      return result;
    };
  }

  // Nominatim patch may replace selectDestination with its own place selection,
  // so also observe changes to state.destination when a trip is actually built.
  if (typeof buildTrip === 'function') {
    const priorBuildTrip072 = buildTrip;
    buildTrip = async function(...args) {
      const place = selectedDestinationPlace();
      if (place) rememberRecent(place);
      return priorBuildTrip072(...args);
    };
  }

  // Search resets should hide the save buttons until a new destination is chosen.
  if (typeof searchDestination === 'function') {
    const priorSearchDestination072 = searchDestination;
    searchDestination = async function(...args) {
      $q('savePlaceActions072')?.classList.add('hidden');
      return priorSearchDestination072(...args);
    };
  }

  // Catch later destination mutations from the POI search patch.
  let lastDestinationKey = '';
  setInterval(() => {
    const place = selectedDestinationPlace();
    const key = placeKey(place);

    if (key && key !== lastDestinationKey) {
      lastDestinationKey = key;
      $q('savePlaceActions072')?.classList.remove('hidden');
      rememberRecent(place);
    } else if (!key) {
      lastDestinationKey = '';
    }
  }, 800);

  window.RoadCastPlaces = {
    home: () => readPlace(HOME_KEY),
    work: () => readPlace(WORK_KEY),
    recents: getRecents,
    selectSavedPlace,
    rememberRecent,
    saveHome() { saveAs(HOME_KEY, 'Home'); },
    saveWork() { saveAs(WORK_KEY, 'Work'); }
  };

  bindUi();

  const badge = document.querySelector('.hero .badge');
  if (badge) badge.textContent = 'MVP 0.7.2';

  console.info(`RoadCast Quick Places ${VERSION} loaded.`);
})();
