'use strict';

/*
 RoadCast MVP 0.3 patch
 - Adds user-triggered business / POI / street-address search using Nominatim.
 - Biases results near the current GPS location.
 - Does NOT implement autocomplete. Searches happen only when the user presses Find/Enter.
 - Rate-limits prototype searches to respect the public Nominatim usage policy.
 - Adds automatic rerouting after a sustained off-route condition.
*/

(() => {
  const VERSION = '0.3.0';
  const SEARCH_MIN_INTERVAL_MS = 1200;
  const OFF_ROUTE_THRESHOLD_METERS = 400;     // ~0.25 mi
  const OFF_ROUTE_SUSTAIN_MS = 12000;
  const REROUTE_COOLDOWN_MS = 60000;

  let lastSearchAt = 0;
  const searchCache = new Map();
  let offRouteSince = null;
  let rerouting = false;
  let lastRerouteAt = 0;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function currentViewbox() {
    if (!state.start || !Number.isFinite(state.start.lat) || !Number.isFinite(state.start.lon)) return null;
    const latPad = 0.80;
    const lonPad = 1.00;
    const left = state.start.lon - lonPad;
    const top = state.start.lat + latPad;
    const right = state.start.lon + lonPad;
    const bottom = state.start.lat - latPad;
    return `${left},${top},${right},${bottom}`;
  }

  function normalizedName(p) {
    const a = p.address || {};
    return (
      p.name ||
      p.namedetails?.name ||
      a.shop ||
      a.amenity ||
      a.tourism ||
      a.leisure ||
      a.building ||
      String(p.display_name || '').split(',')[0] ||
      'Destination'
    ).trim();
  }

  function normalizePlace(p) {
    const a = p.address || {};
    const lat = Number(p.lat);
    const lon = Number(p.lon);
    const name = normalizedName(p);
    const city = a.city || a.town || a.village || a.hamlet || a.county || '';
    const stateName = a.state || '';
    const country = a.country || '';
    const postcode = a.postcode || '';
    const road = a.road || a.pedestrian || a.neighbourhood || '';
    const house = a.house_number || '';
    const street = [house, road].filter(Boolean).join(' ');
    const shortAddress = [street, city, stateName, postcode].filter(Boolean).join(', ');
    const display = p.display_name || [name, shortAddress, country].filter(Boolean).join(', ');
    const distance = state.start && Number.isFinite(lat) && Number.isFinite(lon)
      ? haversine(state.start, { lat, lon })
      : Infinity;

    return {
      name,
      latitude: lat,
      longitude: lon,
      lat,
      lon,
      admin1: stateName,
      country,
      city,
      postcode,
      street,
      display_name: display,
      short_address: shortAddress,
      source: 'nominatim',
      class: p.class,
      type: p.type,
      importance: Number(p.importance || 0),
      _distance: distance,
    };
  }

  function resultSubtitle(p) {
    if (p.short_address) return p.short_address;
    return p.display_name || [p.city, p.admin1, p.country].filter(Boolean).join(', ');
  }

  function renderPlaceResults() {
    els.searchResults.innerHTML = state.searchResults.map((p, i) => {
      const distance = Number.isFinite(p._distance) && p._distance < 160934
        ? ` • ${(p._distance / 1609.344).toFixed(p._distance < 16093 ? 1 : 0)} mi away`
        : '';
      return `<div class="result" data-place-index="${i}">
        <strong>📍 ${htmlEscape(p.name)}</strong>
        <small>${htmlEscape(resultSubtitle(p))}${distance}</small>
      </div>`;
    }).join('');

    els.searchResults.querySelectorAll('[data-place-index]').forEach(row => {
      row.addEventListener('click', () => selectPlace(Number(row.dataset.placeIndex)));
    });
  }

  function selectPlace(index) {
    const p = state.searchResults[index];
    if (!p) return;

    state.destination = {
      name: p.name,
      lat: p.latitude,
      lon: p.longitude,
      admin1: p.admin1,
      country: p.country,
      address: p.display_name,
      source: p.source,
    };

    const display = p.short_address
      ? `${p.name} — ${p.short_address}`
      : p.display_name || p.name;

    els.destinationInput.value = display;
    els.searchResults.innerHTML = '';
    els.selectedDestination.classList.remove('hidden');
    els.selectedDestination.innerHTML =
      `<strong>📍 Destination selected</strong>
       <div class="check-sub">${htmlEscape(p.name)}</div>
       <div class="check-sub">${htmlEscape(resultSubtitle(p))}</div>`;
    setStatus('');
  }

  async function searchPlaces() {
    stopDrive();

    const query = els.destinationInput.value.trim();
    if (query.length < 2) return;

    state.destination = null;
    state.trip = null;
    els.tripSection.classList.add('hidden');
    els.selectedDestination.classList.add('hidden');
    els.findBtn.disabled = true;
    els.findBtn.textContent = 'Finding...';
    setStatus('Searching nearby businesses, addresses and places...');

    try {
      const cacheKey = `${query.toLowerCase()}|${state.start ? state.start.lat.toFixed(2)+','+state.start.lon.toFixed(2) : ''}`;
      let rows = searchCache.get(cacheKey);

      if (!rows) {
        const elapsed = Date.now() - lastSearchAt;
        if (elapsed < SEARCH_MIN_INTERVAL_MS) await sleep(SEARCH_MIN_INTERVAL_MS - elapsed);

        const params = new URLSearchParams({
          q: query,
          format: 'jsonv2',
          addressdetails: '1',
          namedetails: '1',
          limit: '10',
          countrycodes: 'us',
          layer: 'address,poi',
          dedupe: '1'
        });

        const viewbox = currentViewbox();
        if (viewbox) {
          params.set('viewbox', viewbox);
          params.set('bounded', '0');
        }

        lastSearchAt = Date.now();
        const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
          headers: { 'Accept': 'application/json' }
        });

        if (!res.ok) throw new Error(`Place search returned ${res.status}.`);
        const data = await res.json();
        rows = (Array.isArray(data) ? data : [])
          .map(normalizePlace)
          .filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

        // The viewbox already biases Nominatim toward the user's area.
        // Give exact/near-exact name matches another boost, then prefer nearby results.
        const qLower = query.toLowerCase();
        rows.sort((a, b) => {
          const aExact = a.name.toLowerCase() === qLower ? 0 : a.name.toLowerCase().includes(qLower) ? 1 : 2;
          const bExact = b.name.toLowerCase() === qLower ? 0 : b.name.toLowerCase().includes(qLower) ? 1 : 2;
          if (aExact !== bExact) return aExact - bExact;
          if (Number.isFinite(a._distance) && Number.isFinite(b._distance)) return a._distance - b._distance;
          return (b.importance || 0) - (a.importance || 0);
        });

        searchCache.set(cacheKey, rows);
      }

      state.searchResults = rows.slice(0, 8);
      renderPlaceResults();

      if (!state.searchResults.length) {
        setStatus('No match found. Try the business plus city, or enter the full street address.', true);
      } else {
        setStatus('Choose the exact destination from the results.');
      }
    } catch (err) {
      console.error('RoadCast place search error', err);
      setStatus(err.message || String(err), true);
    } finally {
      els.findBtn.disabled = false;
      els.findBtn.textContent = 'Find';
    }
  }

  async function rebuildTripFrom(raw) {
    if (rerouting || !state.destination || !state.driveActive || state.driveDemo) return;
    rerouting = true;
    lastRerouteAt = Date.now();

    try {
      els.driveOverlay.classList.remove('hidden', 'severe');
      els.driveOverlayIcon.textContent = '🔄';
      els.driveOverlayTitle.textContent = 'Rerouting from your current location';
      els.driveOverlayDetail.textContent = 'Rebuilding the route and weather ahead...';
      els.driveStatus.textContent = 'LIVE GPS • rerouting';

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
        c.label = i === 0 ? 'Current location' :
                  i === count - 1 ? state.destination.name :
                  `Road checkpoint ${i}`;
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

      els.driveOverlay.classList.remove('hidden', 'severe');
      els.driveOverlayIcon.textContent = '✅';
      els.driveOverlayTitle.textContent = 'Route updated';
      els.driveOverlayDetail.textContent = `New route to ${state.destination.name} is active.`;

      setTimeout(() => {
        if (state.driveActive) updateDriveAlert(state.driveProgress, false);
      }, 2500);
    } catch (err) {
      console.error('RoadCast reroute error', err);
      els.driveOverlay.classList.remove('hidden');
      els.driveOverlayIcon.textContent = '⚠️';
      els.driveOverlayTitle.textContent = 'Could not reroute yet';
      els.driveOverlayDetail.textContent = 'RoadCast will keep following your GPS and try again later.';
    } finally {
      rerouting = false;
      offRouteSince = null;
    }
  }

  // Replace the existing destination-search click/Enter behavior in capture phase,
  // before the old city-only handler receives the event.
  els.findBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    searchPlaces();
  }, true);

  els.destinationInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    searchPlaces();
  }, true);

  // Wrap live GPS processing with sustained off-route rerouting.
  const originalUpdateDrivePosition = updateDrivePosition;
  updateDrivePosition = function(raw, gpsHeading, speedMps, demoMode) {
    originalUpdateDrivePosition(raw, gpsHeading, speedMps, demoMode);

    if (demoMode || !state.driveActive || !state.trip || !raw || rerouting) {
      offRouteSince = null;
      return;
    }

    const located = state.driveProgress || locateOnRoute(state.trip.route, raw);
    if (!located) return;

    if (located.offRoute > OFF_ROUTE_THRESHOLD_METERS) {
      if (!offRouteSince) offRouteSince = Date.now();

      const sustained = Date.now() - offRouteSince >= OFF_ROUTE_SUSTAIN_MS;
      const cooledDown = Date.now() - lastRerouteAt >= REROUTE_COOLDOWN_MS;

      if (sustained && cooledDown) {
        rebuildTripFrom(raw);
      }
    } else {
      offRouteSince = null;
    }
  };

  // Add a visible build indicator for troubleshooting.
  const badge = document.querySelector('.badge');
  if (badge) badge.textContent = 'MVP 0.3';

  console.info(`RoadCast patch ${VERSION} loaded`);
})();
