/* Nabíjecí plánovač – finds charging stops along a route for a CLA 350 4MATIC (800 V, 85 kWh).
   Data: data/*.json (built weekly by build/). Route: OSRM demo server. Place search: Photon (komoot). */
(() => {
  'use strict';

  // ------------------------------------------------------------------ constants & prefs
  const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  const METEO = 'https://api.open-meteo.com/v1/forecast';   // R45: free, no key
  const WX_STEP_KM = 25, WX_EDGE_KM = 3, WX_DAYS = 16;
  const PHOTON = 'https://photon.komoot.io/api/';
  const BREAK_FIRST = 10, BREAK_NEXT = 5;   // R17: first stop of the day 10 min, every further stop 5 min
  const RESERVE_DEFAULT = 10;    // arrive home / at destination with at least this (user can change)
  const MAX_TARGET = 90;         // don't plan charging above this in one stop
  const SOFT_MIN = 10;           // also show stops up to 10 min outside the window (marked)
  const FAV_DETOUR_KM = 3;       // a favourite pump this far off the route is still offered (never picked) next to a stop
  const APP_VERSION = '2026-11-16r';
  const PREFS_KEY = 'np.prefs.v1';
  const DEFAULT_FAVS = ['MOL', 'ORLEN'];
  const GENERIC_BRANDS = new Set(['pumpa', 'Pumpa', 'Innogy', 'CNG zemní plyn']);

  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs = {}, ...kids) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) { if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }
    for (const kid of kids.flat(Infinity)) if (kid != null) e.append(kid);
    return e;
  };
  const fmt = (n, d = 0) => Number(n).toLocaleString('cs-CZ', { minimumFractionDigits: d, maximumFractionDigits: d });
  const hm = (min) => { const m = Math.round(min); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  const clock = (date) => date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  const ll = (p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

  function sanitizePrefs(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
    for (const k of ['hidden', 'places', 'favs', 'cards']) if (k in p && !Array.isArray(p[k])) delete p[k];
    if (p.places) { p.places = p.places.filter((x) => x && typeof x === 'object'); if (p.places.length < 2) delete p.places; }
    if (p.hidden) p.hidden = p.hidden.filter((h) => h && typeof h.k === 'string');
    if (p.favs) p.favs = p.favs.filter((f) => typeof f === 'string');
    if (p.home && (typeof p.home !== 'object' || !Number.isFinite(p.home.lat) || !Number.isFinite(p.home.lon))) delete p.home;
    // D18: a car list stored before 16. 11. 2026 holds a car the user removed; back to the defaults, prices stay.
    // Lists saved since then carry cmpV 2 (savePrefs) and stay as they are.
    if (p.cmp && typeof p.cmp === 'object' && 'cars' in p.cmp && p.cmpV !== 2) { delete p.cmp.cars; p.cmpV = 2; cmpMigrated = true; }
    return p;
  }
  let cmpMigrated = false;
  let prefs = {}, freshInstall = false;
  try {
    const rawPrefs = localStorage.getItem(PREFS_KEY);
    freshInstall = !rawPrefs;
    prefs = sanitizePrefs(JSON.parse(rawPrefs || '{}'));
  } catch (e) { prefs = {}; }
  let persistAsked = false;
  const savePrefs = () => {
    if (prefs.cmp) prefs.cmpV = 2;                                   // D18: comparison settings saved after the cleanup
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ }
    // ask the browser not to evict our storage (granted silently for installed apps on Android; iOS home-screen apps keep it anyway)
    if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().then(renderStorageInfo, () => {}); }
  };
  if (cmpMigrated) savePrefs();
  const stationKey = (s) => `${(+s.lat).toFixed(5)},${(+s.lon).toFixed(5)}`;
  const stopKey = (st) => `${st.leg}:${stationKey(st.c.s)}`;
  // Moje cesty: saved plans (with logged real charging) live in their own key, so a big history never touches prefs
  const TRIPS_KEY = 'np.trips.v1';
  let trips = [];
  try { trips = JSON.parse(localStorage.getItem(TRIPS_KEY) || '[]'); } catch (e) { trips = []; }
  if (!Array.isArray(trips)) trips = [];
  trips = trips.filter((t) => t && typeof t === 'object' && t.id && t.input && Array.isArray(t.input.places) && t.input.places.length >= 2);
  let curTrip = null;              // the trip shown in the results (saved or not)
  let targets = {};                // R39: "Nabít do" the user set, per stop (stopKey → %); saved with the trip stops
  let reroute = null;              // "Jedu jinudy": re-planning the rest of curTrip from a new point
  const hiddenList = () => (prefs.hidden || []).map((h) => {
    if (Number.isFinite(h.lat)) return h;
    const [lat, lon] = h.k.split(',').map(Number); return { ...h, lat, lon };
  });

  // ------------------------------------------------------------------ data
  let STATIONS = [], CARDS = null, CAL = null, META = null;
  let selCards = new Set();
  const dataReady = Promise.all(['stations', 'cards', 'calibration', 'meta'].map((n) =>
    fetch(`data/${n}.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(n); return r.json(); })))
    .then(([st, cards, cal, meta]) => {
      STATIONS = st.rows.map((r) => Object.fromEntries(st.cols.map((c, i) => [c, r[i]])));
      CARDS = cards; CAL = cal; META = meta;
      const known = new Set(CARDS.cards.map((c) => c.id));
      selCards = new Set((prefs.cards || CARDS.default).filter((id) => known.has(id)));
      renderDataInfo(); renderBrands(); renderCards();
      // measured in the car (Home Assistant → nightly collector → calibration.json): defaults unless set by hand
      if (CAL.car_limit && !prefs.carLimit) $('car-limit').value = String(CAL.car_limit);
      if (CAL.cons_recent && CAL.cons_recent.kwh_100km && !prefs.consCustom) $('cons').value = String(CAL.cons_recent.kwh_100km);
      renderConsHint(); renderPeek();
    })
    .catch(() => setStatus('Nepodařilo se načíst data nabíječek. Zkus stránku obnovit.', true));

  function renderDataInfo() {
    const d = META.exported ? new Date(META.exported) : null;
    $('data-date').textContent = d ? `${d.toLocaleDateString('cs-CZ')} · ${fmt(META.dc_stations)} DC stanic, ${fmt(META.fast_150)} od 150 kW` : '–';
    const bands = (CAL.bands || []).map((b) => `${b.from}–${b.to} % k ${fmt(b.k, 2)}${b.measured ? '' : ' (odhad)'}`).join(', ');
    $('model-info').textContent = `křivka testu fdrive × k ${fmt(CAL.k_median, 2)}${bands ? ` (${bands})` : ''}`;
  }

  // ------------------------------------------------------------------ charging model (same as ev-trip-cost/evcalc.py)
  function pRef(s) {
    const c = CAL.ref_curve; s = Math.max(0, Math.min(100, s));
    for (let i = 0; i < c.length - 1; i++) {
      const [a, pa] = c[i], [b, pb] = c[i + 1];
      if (s >= a && s <= b) return pa + (pb - pa) * (s - a) / (b - a);
    }
    return c[c.length - 1][1];
  }
  function kAt(s) {
    for (const b of CAL.bands || []) if ((s >= b.from && s < b.to) || (b.to >= 100 && s >= b.from)) return b.k;
    return CAL.k_median || 0.72;
  }
  function chargeMinutes(from, to, chargerKw) {
    let t = 0, s = from;
    const kwhPct = CAL.kwh_per_pct || 0.98;
    while (s < to - 1e-9) {
      const ds = Math.min(0.2, to - s), mid = s + ds / 2;
      const p = Math.min(chargerKw, pRef(mid) * kAt(mid));
      t += kwhPct * ds / p * 60; s += ds;
    }
    return t;
  }
  // R46 (D9 = B): is the pump open at `date` by its OSM opening_hours? true / false / null = unknown format.
  // Covers the usual "24/7", "Mo-Fr 06:00-22:00; Sa,Su 07:00-21:00", ranges past midnight and "off"; PH is ignored.
  const OH_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  function parseOh(oh) {
    const src = String(oh || '').trim().replace(/\s*-\s*/g, '-').replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ');
    if (!src) return null;
    if (src === '24/7') return [{ days: null, ranges: [[0, 1440]] }];
    const rules = [];
    // rules are split by ';' and by ',' between a time and a day name ("Mo-Fr 06:00-22:00, Sa 07:00-22:00", not "Su,PH")
    for (const part of src.split(/;|(?<=\d),(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/).map((x) => x.trim()).filter(Boolean)) {
      const m = part.match(/^(?:((?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*) ?)?(off|closed|\d\d?:\d\d-\d\d?:\d\d(?:,\d\d?:\d\d-\d\d?:\d\d)*)$/);
      if (!m) return null;
      let days = null;
      if (m[1]) {
        days = new Set();
        for (const tok of m[1].split(',')) {
          if (tok === 'PH') continue;
          const [a, b] = tok.split('-').map((x) => OH_DAYS.indexOf(x));
          for (let k = a; ; k = (k + 1) % 7) { days.add(k); if (b == null || b < 0 || k === b) break; }
        }
        if (!days.size) continue;                       // a rule only for public holidays
      }
      const ranges = /^(off|closed)$/.test(m[2]) ? [] : m[2].split(',').map((r) => {
        const [x, y] = r.split('-').map((t) => { const [h, mi] = t.split(':').map(Number); return h * 60 + mi; });
        return [x, y <= x ? y + 1440 : y];              // "05:00-00:00", "22:00-06:00", "00:00-00:00" run past midnight
      });
      rules.push({ days, ranges });
    }
    return rules.length ? rules : null;
  }
  function isOpen(oh, date) {
    const rules = parseOh(oh);
    if (!rules) return null;
    const dayRule = (wd) => { let r = null; for (const x of rules) if (!x.days || x.days.has(wd)) r = x; return r; };   // later rules win
    const wd = (date.getDay() + 6) % 7, min = date.getHours() * 60 + date.getMinutes();
    const today = dayRule(wd), yesterday = dayRule((wd + 6) % 7);
    if (today && today.ranges.some(([a, b]) => min >= a && min < b)) return true;
    if (yesterday && yesterday.ranges.some(([, b]) => b > 1440 && min < b - 1440)) return true;   // still open from yesterday
    return false;
  }

  // R44: minutes over the free time × Kč per minute (null when there is nothing to pay)
  function minuteFee(pr, min) {
    if (!pr || !pr.fee || !(pr.fee.czk > 0) || !(min > pr.fee.free)) return null;
    const extra = Math.ceil(min - pr.fee.free);
    return { free: pr.fee.free, min: extra, rate: pr.fee.czk, czk: extra * pr.fee.czk };
  }
  /* Best price among the selected cards for a station {op, kw, cc} at `date`.
     Returns {czk|null, card, label, night, unknownKw, others:[…]} or null when no selected card works there. */
  function price(st, date, only) {
    if (!CARDS) return null;
    const op = st.op, kw = st.kw, abroad = st.cc && st.cc !== 'CZ';
    const h = date.getHours(), [nFrom, nTo] = CARDS.night_hours;
    const night = h >= nFrom || h < nTo;
    const opts = [];
    for (const card of CARDS.cards) {
      if (only ? !only.has(card.id) : !selCards.has(card.id)) continue;
      let tiers, how = 'vlastní síť';
      if (abroad) {  // CZ price lists don't apply abroad: known roaming prices, otherwise "price in the app"
        if (card.abroad && card.abroad[op]) { tiers = card.abroad[op]; how = 'roaming v zahraničí'; }
        else if ((card.own && card.own[op]) || 'anywhere' in card) {
          opts.push({ czk: null, card: card.name, label: 'cena v zahraničí podle aplikace', how: 'zahraničí' }); continue;
        } else continue;
      } else if (card.own && card.own[op]) tiers = card.own[op];
      else if (card.roam && card.roam[op]) { tiers = card.roam[op]; how = 'roaming'; }
      else if ('anywhere' in card) { tiers = card.anywhere; how = 'roaming'; } else continue;
      if (!tiers) { opts.push({ czk: null, card: card.name, label: card.note || 'cena v aplikaci', how }); continue; }
      const t = kw ? (tiers.find((x) => kw <= x.max) || tiers[tiers.length - 1]) : tiers[tiers.length - 1];
      // R44: a fee for the time on the stand over the free minutes, where the price list has one
      const fee = t.free_min != null && t.czk_min != null ? { free: t.free_min, czk: night && t.czk_min_night != null ? t.czk_min_night : t.czk_min } : null;
      opts.push({ czk: night ? t.night : t.day, card: card.name, label: t.label, how, unknownKw: !kw && tiers.length > 1,
        dayNight: t.day !== t.night, fee });
    }
    if (!opts.length) return null;
    opts.sort((a, b) => (a.czk == null) - (b.czk == null) || (a.czk || 0) - (b.czk || 0));
    return { ...opts[0], night, others: opts.slice(1) };
  }

  function renderCards() {
    const box = $('cards'); box.textContent = '';
    const groups = {};
    CARDS.cards.forEach((c) => { (groups[c.group] = groups[c.group] || []).push(c); });
    Object.entries(groups).forEach(([g, list]) => {
      box.append(el('div', { class: 'card-group' }, el('p', { class: 'card-group-name', text: g }),
        list.map((c) => {
          const id = `card-${c.id}`;
          const fee = c.fee ? `${fmt(c.fee)} Kč/měs` : 'bez paušálu';
          const net = c.own ? Object.keys(c.own).join(', ') : '';
          const extra = [fee, c.roam ? `+ roaming ${Object.keys(c.roam).length} sítí` : null, 'anywhere' in c ? 'roaming téměř všude' : null,
            c.note].filter(Boolean).join(' · ');
          return el('label', { class: 'check inline card-opt', for: id },
            el('input', { type: 'checkbox', id, checked: selCards.has(c.id), onchange: (e) => {
              if (e.target.checked) selCards.add(c.id); else selCards.delete(c.id);
              prefs.cards = [...selCards]; savePrefs(); renderCardsSummary(); replan();
            } }),
            el('span', {}, el('b', { text: c.name }), el('small', { text: [net, extra].filter(Boolean).join(' · ') })));
        })));
    });
    renderCardsSummary();
  }
  function renderCardsSummary() {
    const names = CARDS.cards.filter((c) => selCards.has(c.id)).map((c) => c.name);
    $('cards-count').textContent = `${names.length}`;
    $('cards-names').textContent = names.length ? names.join(' · ') : 'Žádná karta není vybraná.';
    renderPeek();
  }
  $('cards-default').addEventListener('click', () => {
    selCards = new Set(CARDS.default); prefs.cards = [...selCards]; savePrefs(); renderCards(); replan();
  });

  // ------------------------------------------------------------------ places UI
  const placesBox = $('places');
  let places = prefs.places && prefs.places.length >= 2 ? prefs.places : [{ role: 'from' }, { role: 'to' }];
  if (!places[0].lat && prefs.home) places[0] = { role: 'from', ...prefs.home };

  function renderPlaces() {
    placesBox.textContent = '';
    places.forEach((p, i) => {
      const node = $('tpl-place').content.firstElementChild.cloneNode(true);
      const role = i === 0 ? 'from' : i === places.length - 1 ? 'to' : 'via';
      p.role = role;
      node.classList.add(`is-${role}`);
      const id = `place-${i}`;
      const label = node.querySelector('.place-label');
      label.textContent = role === 'from' ? 'Odkud' : role === 'to' ? 'Kam' : `Přes (${i}.)`;
      label.setAttribute('for', id);
      const input = node.querySelector('input');
      input.id = id;
      input.placeholder = role === 'to' ? 'Místo, adresa nebo GPS 49.28, 17.02' : 'Místo, adresa nebo GPS';
      input.value = p.label || '';
      const picked = node.querySelector('.picked');
      showPicked(picked, p);
      wireAutocomplete(node, input, i, picked);
      node.querySelector('.gps').addEventListener('click', () => useGps(i));
      node.querySelector('.home').addEventListener('click', () => {
        if (!prefs.home) { setStatus('Domů zatím není uložené. Otevři ☰ Moje nastavení → Domů a ulož ho tam.', true); return; }
        places[i] = { role, ...prefs.home }; renderPlaces();
      });
      node.querySelector('.del').addEventListener('click', () => { places.splice(i, 1); renderPlaces(); });
      node.querySelector('.up').addEventListener('click', () => {
        if (i > 1) { [places[i - 1], places[i]] = [places[i], places[i - 1]]; renderPlaces(); }
      });
      placesBox.append(node);
    });
  }
  function showPicked(picked, p) {
    picked.textContent = p.lat ? `✓ ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : '';
    picked.classList.toggle('ok', !!p.lat);
  }
  $('add-via').addEventListener('click', () => { places.splice(places.length - 1, 0, { role: 'via' }); renderPlaces(); });

  function parseCoords(text) {
    const m = String(text).replace(/,(?=\d)/g, '.').match(/(-?\d{1,2}\.\d{2,})\s*[,;\s]\s*(-?\d{1,3}\.\d{2,})/);
    if (!m) return null;
    const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }

  function wireAutocomplete(node, input, i, picked) {
    const list = node.querySelector('.suggest');
    let timer = null, ctrl = null, items = [], active = -1;
    const close = () => { list.hidden = true; active = -1; };
    const choose = (it) => {
      places[i] = { role: places[i].role, label: it.label, lat: it.lat, lon: it.lon };
      input.value = it.label; showPicked(picked, places[i]); close();
    };
    input.addEventListener('input', () => {
      places[i] = { role: places[i].role, label: input.value };
      showPicked(picked, places[i]);
      const c = parseCoords(input.value);
      if (c) { places[i] = { role: places[i].role, label: `GPS ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`, ...c }; showPicked(picked, places[i]); close(); return; }
      clearTimeout(timer);
      if (input.value.trim().length < 3) { close(); return; }
      timer = setTimeout(async () => {
        if (ctrl) ctrl.abort();
        ctrl = new AbortController();
        try {
          const q = new URLSearchParams({ q: input.value.trim(), limit: '7', lat: '49.8', lon: '15.5', location_bias_scale: '0.6' });
          const r = await fetch(`${PHOTON}?${q}`, { signal: ctrl.signal });
          const j = await r.json();
          items = (j.features || []).map((f) => {
            const p = f.properties, [lon, lat] = f.geometry.coordinates;
            const street = [p.street, p.housenumber].filter(Boolean).join(' ');
            const main = p.name || street || p.city || '';
            const sub = [p.name && street, p.city !== main ? p.city : null, p.county, p.countrycode !== 'CZ' ? p.country : null]
              .filter(Boolean).join(', ');
            return { label: [main, p.city && p.city !== main ? p.city : null].filter(Boolean).join(', '), sub, lat, lon, cz: p.countrycode === 'CZ' };
          }).sort((a, b) => b.cz - a.cz);
          list.textContent = '';
          items.forEach((it, k) => list.append(el('li', { role: 'option', onmousedown: (e) => { e.preventDefault(); choose(it); },
            onclick: () => choose(it), 'aria-selected': k === active ? 'true' : null }, el('span', { text: it.label }), it.sub ? el('small', { text: it.sub }) : null)));
          list.hidden = items.length === 0;
        } catch (e) { if (e.name !== 'AbortError') close(); }
      }, 300);
    });
    input.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        [...list.children].forEach((li, k) => li.setAttribute('aria-selected', k === active ? 'true' : 'false'));
      } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); } else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
  }

  function useGps(i) {
    if (!navigator.geolocation) { setStatus('Tenhle prohlížeč polohu neumí. Zadej místo nebo souřadnice.', true); return; }
    setStatus('Zjišťuji polohu…');
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      places[i] = { role: places[i].role, label: `Moje poloha (${lat.toFixed(4)}, ${lon.toFixed(4)})`, lat, lon };
      renderPlaces(); setStatus('');
    }, () => setStatus('Polohu se nepodařilo zjistit. Povol ji pro tuhle stránku, nebo zadej místo ručně.', true),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }


  // ------------------------------------------------------------------ other inputs
  const intTime = $('int-time'), tolTime = $('tol-time');
  for (let m = 30; m <= 240; m += 15) intTime.append(el('option', { value: m, text: hm(m) }));
  [0, 5, 10, 15, 20, 30, 45, 60].forEach((m) => tolTime.append(el('option', { value: m, text: `${m} min` })));
  intTime.value = String(prefs.intTime || 60); tolTime.value = String(prefs.tolTime != null ? prefs.tolTime : 15);
  $('int-km').value = String(prefs.intKm || 130); $('tol-km').value = String(prefs.tolKm != null ? prefs.tolKm : 20);
  if (prefs.stopBy === 'km') $('by-km').checked = true;
  const pad = (n) => String(n).padStart(2, '0');
  const nowLocal = () => { const d = new Date(Date.now() + 5 * 60000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  $('depart').value = nowLocal();
  $('ret-time').value = prefs.retTime || '16:00';
  for (const id of ['at-pump', 'round-trip', 'only-fav', 'my-cards', 'unknown-kw']) if (prefs[id] != null) $(id).checked = prefs[id];
  if (prefs.detour) $('detour').value = String(prefs.detour);
  if (prefs.minKw) $('min-kw').value = String(prefs.minKw);
  if (prefs.cons && prefs.consCustom) $('cons').value = String(prefs.cons);
  const carLimit = () => Math.max(50, Math.min(100, +$('car-limit').value || 80));
  if (prefs.carLimit) $('car-limit').value = String(prefs.carLimit);
  // before a long trip the user charges to 100 % (start stays 100); leaving above the limit means it was raised
  const effLimit = (o) => Math.max(o.carLimit || 100, o.soc0 || 0);
  const resDest = (o) => (Number.isFinite(o.reserveDest) ? o.reserveDest : o.reserve);   // R42: arrive at the destination (and home) with
  if (prefs.tempo) $('tempo').value = String(prefs.tempo);
  $('reserve').value = String(prefs.reserve != null ? prefs.reserve : RESERVE_DEFAULT);
  // R42: older settings have one reserve for everything → the destination starts with the same number
  $('reserve-dest').value = String(prefs.reserveDest != null ? prefs.reserveDest : prefs.reserve != null ? prefs.reserve : RESERVE_DEFAULT);
  let favs = new Set(prefs.favs || DEFAULT_FAVS);

  const stopBy = () => (document.querySelector('input[name="stop-by"]:checked') || {}).value || 'time';
  function syncStopUi() {
    const byKm = stopBy() === 'km';
    $('row-time').hidden = byKm; $('row-km').hidden = !byKm;
    const I = byKm ? +$('int-km').value : +intTime.value, T = byKm ? +$('tol-km').value : +tolTime.value;
    const f = (v) => (byKm ? `${fmt(Math.max(0, v))} km` : hm(Math.max(0, v)));
    $('win-hint').textContent = `První zastávka ${f(I - T)}–${f(I + T)} od startu.`;
    $('ret-field').hidden = !$('round-trip').checked;
  }
  ['by-time', 'by-km', 'int-time', 'tol-time', 'int-km', 'tol-km', 'round-trip'].forEach((id) => $(id).addEventListener('input', syncStopUi));
  ['by-time', 'by-km', 'round-trip'].forEach((id) => $(id).addEventListener('change', syncStopUi));
  syncStopUi();

  // ---- R41 (D11 = A): sliders next to the number fields, preset buttons for the reserve, interval, tolerance and detour.
  // The fields keep their ids; a slider or a button only sets the field and tells it changed.
  const ranges = [...document.querySelectorAll('input[type=range][data-for]')];
  const presetBoxes = [...document.querySelectorAll('.presets[data-for]')];
  const presetLabel = (id, v) => (id === 'int-time' ? hm(v) : id === 'tol-time' ? `${v} min` : id === 'reserve' ? `${v} %` : `${fmt(v, v % 1 ? 1 : 0)} km`);
  const touch = (ctl) => { ctl.dispatchEvent(new Event('input', { bubbles: true })); ctl.dispatchEvent(new Event('change', { bubbles: true })); };
  function syncControls() {
    ranges.forEach((r) => { const n = $(r.dataset.for); if (n.value !== '') r.value = n.value; });
    presetBoxes.forEach((box) => {
      const ctl = $(box.dataset.for), v = parseFloat(ctl.value), wrap = ctl.closest('.other-wrap');
      const chips = [...box.querySelectorAll('.chip[data-v]')], hit = chips.some((c) => +c.dataset.v === v);
      chips.forEach((c) => c.setAttribute('aria-pressed', String(+c.dataset.v === v)));
      const other = box.querySelector('.chip[data-other]');
      if (other) other.setAttribute('aria-pressed', String(!hit));
      if (wrap) wrap.hidden = !(other && (!hit || box.dataset.open === '1'));
    });
  }
  presetBoxes.forEach((box) => {
    const id = box.dataset.for, ctl = $(id);
    box.dataset.values.split(',').map(Number).forEach((v) => {
      const opt = ctl.tagName === 'SELECT' ? [...ctl.options].find((x) => +x.value === v) : null;
      box.append(el('button', { type: 'button', class: 'chip', 'data-v': v, 'aria-pressed': 'false', title: opt ? opt.textContent : null, text: presetLabel(id, v),
        onclick: () => { ctl.value = String(v); delete box.dataset.open; touch(ctl); syncControls(); } }));
    });
    if ('other' in box.dataset) box.append(el('button', { type: 'button', class: 'chip', 'data-other': '', 'aria-pressed': 'false', text: 'Jiný',
      onclick: () => { box.dataset.open = '1'; syncControls(); ctl.focus(); } }));
    ['input', 'change'].forEach((t) => ctl.addEventListener(t, syncControls));
  });
  ranges.forEach((r) => {
    const n = $(r.dataset.for);
    r.addEventListener('input', () => { n.value = r.value; touch(n); });
    ['input', 'change'].forEach((t) => n.addEventListener(t, () => { if (n.value !== '') r.value = n.value; syncControls(); }));
  });
  syncControls();

  // ---- R36: the form in three steps, all of them always open (D17: "drž je rozbalené")
  const formSteps = [...document.querySelectorAll('#form .form-step')];
  function showStep(n) {
    const st = formSteps.find((x) => x.dataset.step === String(n));
    if (st) st.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderBrands() {
    const counts = {};
    STATIONS.forEach((s) => { if (s.fuel && !GENERIC_BRANDS.has(s.fuel)) counts[s.fuel] = (counts[s.fuel] || 0) + 1; });
    const brands = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([b]) => b);
    favs.forEach((f) => { if (!brands.includes(f)) brands.unshift(f); });
    const box = $('brands'); box.textContent = '';
    brands.forEach((b) => box.append(el('button', {
      type: 'button', class: 'chip', 'aria-pressed': favs.has(b) ? 'true' : 'false',
      onclick: (e) => {
        if (favs.has(b)) favs.delete(b); else favs.add(b);
        e.currentTarget.setAttribute('aria-pressed', favs.has(b) ? 'true' : 'false');
        prefs.favs = [...favs]; savePrefs(); renderPeek(); replan();
      },
    }, b, el('small', { text: counts[b] ? `${counts[b]}` : '' }))));
  }

  // ------------------------------------------------------------------ "Moje nastavení" panel: right column on wide screens, ☰ drawer on the phone
  const drawerMq = window.matchMedia('(max-width: 1099px)');
  let menuOpener = null;
  function setMenu(open, opener) {
    const p = $('prefs'), wasOpen = p.classList.contains('open');
    if (!drawerMq.matches) open = false;               // wide screen: the panel is always visible
    p.classList.toggle('open', open);
    $('scrim').hidden = !open;
    $('main').inert = open; document.querySelector('.actionbar').inert = open;
    document.body.classList.toggle('menu-open', open);
    $('btn-menu').setAttribute('aria-expanded', String(open));
    if (open) { menuOpener = opener || $('btn-menu'); $('btn-menu-close').focus(); }
    else if (wasOpen && menuOpener) { if (drawerMq.matches) menuOpener.focus(); menuOpener = null; }
  }
  const openMenu = (e) => { if (drawerMq.matches) setMenu(true, e && e.currentTarget); else $('prefs').focus(); };
  $('btn-menu').addEventListener('click', openMenu);
  $('prefs-peek').addEventListener('click', openMenu);
  $('btn-menu-close').addEventListener('click', () => setMenu(false));
  $('scrim').addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('prefs').classList.contains('open')) setMenu(false); });
  drawerMq.addEventListener('change', () => setMenu(false));

  function renderConsHint() {
    const r = CAL && CAL.cons_recent;
    // R47: one short sentence
    $('cons-hint').textContent = r && r.kwh_100km
      ? `Naměřeno v autě: ${fmt(r.kwh_100km, 1)} kWh/100 km (${r.days} dní)${prefs.consCustom ? ', počítám s tvou hodnotou' : ''}.`
      : 'Zimní horší případ při 130 km/h.';
  }
  function renderPeek() {
    const parts = [favs.size ? `★ ${[...favs].join(', ')}` : 'bez oblíbených pump'];
    if (CARDS) parts.push(`${selCards.size} ${selCards.size === 1 ? 'karta' : selCards.size < 5 ? 'karty' : 'karet'}`);
    const nh = (prefs.hidden || []).length;
    if (nh) parts.push(`${nh} skryt${nh === 1 ? 'á' : 'é'}`);
    parts.push(`spotřeba ${fmt(parseFloat(String($('cons').value).replace(',', '.')) || 23.8, 1)}`);
    $('peek-text').textContent = parts.join(' · ');
  }

  // panel inputs take effect immediately
  ['only-fav', 'my-cards', 'unknown-kw', 'min-kw', 'cons', 'tempo', 'car-limit'].forEach((id) => $(id).addEventListener('change', () => {
    const v = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
    if (id === 'min-kw') prefs.minKw = +v;
    else if (id === 'car-limit') { prefs.carLimit = carLimit(); $('car-limit').value = String(prefs.carLimit); }
    else if (id === 'cons') { prefs.cons = Math.min(35, Math.max(12, parseFloat(String(v).replace(',', '.')) || 23.8)); prefs.consCustom = true; $('cons').value = String(prefs.cons); renderConsHint(); }
    else if (id === 'tempo') prefs.tempo = parseFloat(v) || 0.93; else prefs[id] = v;
    savePrefs(); renderPeek(); replan();
  }));

  function renderHidden() {
    const list = prefs.hidden || [];
    $('hidden-count').textContent = list.length ? `${list.length}` : '';
    $('hidden-empty').hidden = list.length > 0;
    const ul = $('hidden-list'); ul.textContent = '';
    list.forEach((h) => ul.append(el('li', {},
      el('span', {}, el('b', { text: h.name || 'Stanice' }), h.place ? el('small', { class: 'muted', text: h.place }) : null),
      el('button', { type: 'button', class: 'linkish', text: 'Vrátit', onclick: () => unhideStation(h.k) }))));
    renderPeek();
  }
  function hideStation(s) {
    const k = stationKey(s);
    prefs.hidden = (prefs.hidden || []).filter((h) => h.k !== k);
    prefs.hidden.push({ k, lat: +s.lat, lon: +s.lon, name: [s.fuel, s.op, s.kw ? `${s.kw} kW` : null].filter(Boolean).join(' · '), place: s.place || s.name || '' });
    forceAuto = true;
    savePrefs(); renderHidden(); replan();
    const name = prefs.hidden[prefs.hidden.length - 1].name;
    const st = $('status'); st.textContent = ''; st.classList.remove('err');
    st.append(`Skryto: ${name}. `, el('button', { type: 'button', class: 'link-btn', text: 'Vrátit zpět', onclick: () => { unhideStation(k); setStatus(''); } }));
  }
  function unhideStation(k) {
    prefs.hidden = (prefs.hidden || []).filter((h) => h.k !== k);
    savePrefs(); renderHidden(); replan();
  }

  const renderHome = () => { $('home-label').textContent = prefs.home ? prefs.home.label : 'neuloženo'; };
  renderHome();
  $('home-from-start').addEventListener('click', () => {
    const p = places[0];
    if (!p.lat) { setStatus('Nejdřív vyber místo v poli Odkud.', true); return; }
    prefs.home = { label: p.label, lat: p.lat, lon: p.lon }; savePrefs(); renderHome(); setStatus('Domů uloženo v tomhle zařízení.');
  });

  // backup: the whole prefs object as a small JSON file (new phone, or Safari → home-screen app on iPhone)
  const isIOS = !/Android/.test(navigator.userAgent) && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  async function renderStorageInfo() {
    let persisted = null;
    try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (e) { /* ignore */ }
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    let txt;
    // R47: one short sentence; the Safari warning stays, it is the one that matters
    if (standalone) txt = 'Uloženo v appce.';
    else if (isIOS) txt = 'Safari po týdnu bez otevření nastavení smaže, přidej appku na plochu.';
    else txt = `Uloženo v tomhle zařízení${persisted ? ' natrvalo' : ''}.`;
    const lb = prefs.lastBackup ? Math.floor((Date.now() - new Date(prefs.lastBackup)) / 86400000) : null;
    txt += ` Záloha: ${lb == null ? 'žádná' : lb < 1 ? 'dnes' : lb === 1 ? 'včera' : `před ${lb} dny`}.`;
    $('storage-info').textContent = txt;
  }
  $('btn-export').addEventListener('click', async () => {
    const data = JSON.stringify({ app: 'nabijeci-planovac', version: 2, saved: new Date().toISOString(), prefs, trips }, null, 1);
    const name = 'nabijeci-planovac-nastaveni.json';
    const file = new File([data], name, { type: 'application/json' });
    const done = () => { prefs.lastBackup = new Date().toISOString(); savePrefs(); renderStorageInfo(); };
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); done(); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = el('a', { href: URL.createObjectURL(file), download: name });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    done();
  });
  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    let p, j;
    try {
      j = JSON.parse(await f.text());
      if (!j || j.app !== 'nabijeci-planovac' || !j.prefs || typeof j.prefs !== 'object' || Array.isArray(j.prefs)) throw new Error('format');
      p = sanitizePrefs(j.prefs);
    } catch (err) { setMenu(false); setStatus('Tohle není záloha z Nabíjecího plánovače.', true); return; }
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
      if (Array.isArray(j.trips)) localStorage.setItem(TRIPS_KEY, JSON.stringify(j.trips.filter((t) => t && t.id && t.input)));
    } catch (err) { setMenu(false); setStatus('Zálohu se nepodařilo uložit (soukromé okno nebo plné úložiště?).', true); return; }
    location.reload();
  });
  $('app-version').textContent = APP_VERSION;

  function setStatus(msg, err) { const s = $('status'); s.textContent = msg; s.classList.toggle('err', !!err); }

  // ------------------------------------------------------------------ route geometry
  async function route(pts) {
    const coords = pts.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const r = await fetch(`${OSRM}${coords}?overview=full&geometries=geojson&annotations=duration,distance&steps=false`);
    if (!r.ok) throw new Error(`OSRM ${r.status}`);
    const j = await r.json();
    if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error(j.message || 'Trasa nenalezena');
    const rt = j.routes[0];
    const line = rt.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
    const cumT = [0], cumD = [0];
    rt.legs.forEach((leg) => {
      const dur = (leg.annotation && leg.annotation.duration) || [], dist = (leg.annotation && leg.annotation.distance) || [];
      dur.forEach((d, k) => { cumT.push(cumT[cumT.length - 1] + d); cumD.push(cumD[cumD.length - 1] + (dist[k] || 0)); });
    });
    if (cumT.length !== line.length) { // fallback: spread totals by straight-line distance
      cumT.length = 1; cumD.length = 1;
      for (let k = 1; k < line.length; k++) cumD.push(cumD[k - 1] + hav(line[k - 1], line[k]));
      const f = rt.duration / (cumD[cumD.length - 1] || 1);
      for (let k = 1; k < line.length; k++) cumT.push(cumD[k] * f);
    }
    return { line, cumT, cumD, duration: rt.duration, distance: rt.distance };
  }
  function hav(a, b) {
    const R = 6371000, p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
    const dp = p2 - p1, dl = (b.lon - a.lon) * Math.PI / 180;
    const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  // nearest point on the route: {dist m, t s, d m} (equirectangular, fine for a few km)
  function nearestOnRoute(rt, p) {
    const kx = 111320 * Math.cos(p.lat * Math.PI / 180), ky = 110540;
    let best = { dist: Infinity, t: 0, d: 0 };
    const L = rt.line;
    for (let i = 0; i < L.length - 1; i++) {
      const ax = (L[i].lon - p.lon) * kx, ay = (L[i].lat - p.lat) * ky;
      const bx = (L[i + 1].lon - p.lon) * kx, by = (L[i + 1].lat - p.lat) * ky;
      if (Math.min(Math.abs(ax), Math.abs(bx)) > best.dist && (ax * bx > 0)) continue;
      if (Math.min(Math.abs(ay), Math.abs(by)) > best.dist && (ay * by > 0)) continue;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const u = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      const cx = ax + u * dx, cy = ay + u * dy, dist = Math.hypot(cx, cy);
      if (dist < best.dist) {
        best = { dist, t: rt.cumT[i] + u * (rt.cumT[i + 1] - rt.cumT[i]), d: rt.cumD[i] + u * (rt.cumD[i + 1] - rt.cumD[i]),
          // which side of the direction of travel (A → B) the station is on, and whether this is a motorway-speed segment
          right: dy * ax - dx * ay < 0,
          fast: (rt.cumD[i + 1] - rt.cumD[i]) / Math.max(1e-3, rt.cumT[i + 1] - rt.cumT[i]) > 22 };
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ search → plan
  let lastRun = null;
  function readOptions() {
    const byKm = stopBy() === 'km';
    const depart = $('depart').value ? new Date($('depart').value) : new Date();
    const [rh, rm] = ($('ret-time').value || '16:00').split(':').map(Number);
    const retDepart = new Date(depart); retDepart.setHours(rh, rm, 0, 0);
    const o = {
      depart, retDepart, byKm,
      interval: byKm ? Math.max(20, +$('int-km').value || 130) : +intTime.value,
      tol: byKm ? Math.max(0, +$('tol-km').value || 0) : +tolTime.value,
      soc0: Math.max(5, Math.min(100, parseFloat($('soc0').value) || 100)),
      detourKm: parseFloat($('detour').value) || 1.5,
      atPump: $('at-pump').checked, roundTrip: $('round-trip').checked,
      onlyFav: $('only-fav').checked, myCards: $('my-cards').checked, unknownKw: $('unknown-kw').checked,
      minKw: +$('min-kw').value, cons: Math.min(35, Math.max(12, parseFloat(String($('cons').value).replace(',', '.')) || 23.8)),
      tempo: parseFloat($('tempo').value) || 0.93, carLimit: carLimit(),
      reserve: Math.max(0, Math.min(80, parseFloat($('reserve').value))),
      reserveDest: Math.max(0, Math.min(80, parseFloat($('reserve-dest').value))),
    };
    if (!Number.isFinite(o.reserve)) o.reserve = RESERVE_DEFAULT;
    if (!Number.isFinite(o.reserveDest)) o.reserveDest = o.reserve;
    return o;
  }
  // OSRM is ~7 % slower than Google at ~130 km/h → scale its times by the chosen tempo
  const withTempo = (raw, tempo) => ({ ...raw, cumT: raw.cumT.map((t) => t * tempo), duration: raw.duration * tempo });
  function runPlan(raw, pts, o, fixed, overrides = []) {
    const rt = withTempo(raw, o.tempo);
    const cands = candidates(rt, o);
    const isFixed = !!(fixed && fixed.length);
    const plan = isFixed ? planFromStops(rt, cands, o, fixed) : makePlan(rt, cands, o, overrides);
    lastRun = { raw, rt, pts, o, cands, plan, fixed: isFixed, overrides: isFixed ? [] : overrides,
      excluded: { hidden: cands.hiddenNear || 0, wrongSide: cands.filter((c) => !sideOk(c, 'A')).length } };
    if (curTrip && !(fixed && fixed.length)) { curTrip.stops = tripStops(plan); if (curTrip.saved) persistTrip(true); }
    lastRun.wx = { state: 'loading' };
    render();
    $('btn-map').disabled = false;
    if (!$('map-wrap').hidden) drawMap();
    loadWeather(lastRun);
  }
  // settings changed in the panel → recompute the plan for the same route (no new routing request)
  function replan() {
    if (!lastRun || !STATIONS.length) return;
    const f = readOptions();
    // a saved trip (or one being driven) keeps its stations; only prices, times and battery are recomputed
    const fixed = curTrip && (curTrip.saved || hasActuals(curTrip)) && !forceAuto ? curTrip.stops : null;
    forceAuto = false;
    runPlan(lastRun.raw, lastRun.pts, { ...lastRun.o, onlyFav: f.onlyFav, myCards: f.myCards, unknownKw: f.unknownKw, minKw: f.minKw, cons: f.cons, tempo: f.tempo, carLimit: f.carLimit },
      fixed, lastRun.overrides || []);
  }
  let forceAuto = false;

  // after a search the form folds into one line (design 1); "Upravit" opens it again
  function setFormCollapsed(c) {
    $('form').hidden = c; $('trip-chip').hidden = !c;
    $('btn-go').hidden = c; $('btn-nav').hidden = !c;
    if (c && lastRun) {
      const { o, pts } = lastRun;
      $('chip-title').textContent = `${shortName(pts[0].label, 'Start')} → ${shortName(pts[pts.length - 1].label, 'Cíl')}${o.roundTrip ? ' a zpět' : ''}`;
      const day = o.depart.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' });
      $('chip-sub').textContent = `${day.charAt(0).toUpperCase()}${day.slice(1)} ${clock(o.depart)} · ${fmt(o.soc0)} % · ` +
        (o.byKm ? `zastávka každých ${fmt(o.interval)} ± ${fmt(o.tol)} km` : `zastávka každou ${hm(o.interval)} ± ${o.tol}`);
    }
  }
  $('trip-chip').addEventListener('click', () => { setFormCollapsed(false); $('form').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('btn-nav').addEventListener('click', (e) => { e.preventDefault(); const x = $('export'); if (x) x.scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await dataReady;
    if (!STATIONS.length) return;
    const pts = places.filter((p) => p.lat != null);
    if (!places[0].lat || !places[places.length - 1].lat) { showStep(1); setStatus('Vyber místo v poli Odkud i Kam (ze seznamu, polohou nebo souřadnicemi).', true); return; }
    const o = readOptions();
    Object.assign(prefs, { places, stopBy: o.byKm ? 'km' : 'time', intTime: +intTime.value, tolTime: +tolTime.value,
      intKm: +$('int-km').value, tolKm: +$('tol-km').value, retTime: $('ret-time').value, detour: o.detourKm,
      'at-pump': o.atPump, 'round-trip': o.roundTrip, 'only-fav': o.onlyFav, 'my-cards': o.myCards, 'unknown-kw': o.unknownKw,
      minKw: o.minKw, tempo: o.tempo, reserve: o.reserve, reserveDest: o.reserveDest, favs: [...favs] });
    savePrefs();

    setStatus('Počítám trasu…'); $('btn-go').disabled = true;
    let raw;
    try {
      raw = await route(pts);
    } catch (err) {
      setStatus(`Trasu se nepodařilo spočítat (${err.message}). Zkus to za chvíli, nebo uprav místa.`, true);
      $('btn-go').disabled = false; return;
    }
    $('btn-go').disabled = false;
    setStatus('');
    if (reroute && curTrip && curTrip.id === reroute.tripId) {
      archivePart(reroute.old, pts[0]);
      curTrip.input = tripInput(o, pts); curTrip.stops = []; curTrip.actual = {}; curTrip.status = 'plan'; delete curTrip.finish;
      endReroute();
    } else {
      endReroute();
      curTrip = { id: newTripId(), saved: false, status: 'plan', input: tripInput(o, pts), stops: [], actual: {} };
    }
    targets = {};
    runPlan(raw, pts, o);
    setFormCollapsed(true);
    $('summary').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const WIDE_KM = 15;
  function candidates(rt, o) {
    const lats = rt.line.map((p) => p.lat), lons = rt.line.map((p) => p.lon);
    const pad = WIDE_KM / 100 + 0.02;
    const box = [Math.min(...lats) - pad, Math.max(...lats) + pad, Math.min(...lons) - pad * 1.5, Math.max(...lons) + pad * 1.5];
    const out = [], hidden = hiddenList(), hiddenHit = new Set();
    for (const s of STATIONS) {
      if (s.lat < box[0] || s.lat > box[1] || s.lon < box[2] || s.lon > box[3]) continue;
      const h = hidden.length ? hidden.find((x) => Math.abs(x.lat - s.lat) < 0.003 && hav(x, s) < 150) : null;
      if (h) { if (!hiddenHit.has(h.k) && nearestOnRoute(rt, s).dist <= WIDE_KM * 1000) hiddenHit.add(h.k); continue; }
      if (o.atPump && !s.fuel) continue;
      if (o.onlyFav && !favs.has(s.fuel)) continue;
      if (o.myCards && !price(s, o.depart)) continue;
      if (s.kw == null ? !o.unknownKw : s.kw < o.minKw) continue;
      const n = nearestOnRoute(rt, s);
      if (n.dist > WIDE_KM * 1000) continue;
      out.push({ s, n, detourMin: (2 * n.dist / 1000) / 40 * 60, detourKm: 2 * n.dist / 1000 });
    }
    // dedupe: same operator within 150 m (OSM + operator data duplicates), keep the more powerful
    out.sort((a, b) => (b.s.kw || 0) - (a.s.kw || 0));
    const kept = [];
    for (const c of out) if (!kept.some((k) => k.s.op === c.s.op && hav(k.s, c.s) < 150)) kept.push(c);
    kept.hiddenNear = hiddenHit.size;
    return kept;
  }

  // position of a candidate on a leg, in the unit of the interval (min or km)
  function measure(c, leg, rt, o) {
    const t = leg === 'A' ? c.n.t : rt.duration - c.n.t, d = leg === 'A' ? c.n.d : rt.distance - c.n.d;
    return o.byKm ? d / 1000 : t / 60 + c.detourMin / 2;
  }
  /* Battery on arrival at trip-km x and the top-up a stop there would need. The plan charges at each stop only
     enough for the next leg + reserve, so until the first real charge you arrive with soc0 − used, and after it
     with about the reserve. That is exact enough to apply the charger-tier rule while picking stations. */
  function socModel(rt, o) {
    const D = rt.distance / 1000, CAP = CAL.battery_kwh || 85;
    const pct = (km) => km * o.cons / CAP;
    const endX = o.roundTrip ? 2 * D : D;
    const stepKm = o.byKm ? o.interval : o.interval * D / (rt.duration / 60);
    return (x) => {
      const arrive = Math.max(o.reserve, o.soc0 - pct(x));
      const need = Math.min(MAX_TARGET, pct(Math.min(stepKm, Math.max(0, endX - x))) + o.reserve);
      return { arrive, add: need - arrive > 2 ? Math.max(need, Math.min(80, arrive + 8)) - arrive : 0 };
    };
  }
  const tripKm = (c, leg, rt) => (leg === 'A' ? c.n.d / 1000 : 2 * rt.distance / 1000 - c.n.d / 1000);

  /* A station right next to a motorway (rest area) is reachable only from its own carriageway: on the way there
     (leg A) it must be on the right of the direction of travel, on the way back (leg B) on the left of it. */
  const sideOk = (c, leg) => !(c.n.fast && c.n.dist < 300) || (leg === 'A') === c.n.right;

  /* Ranking inside one window. tier: 0 favourite pump in the window, 1 favourite slightly outside / small detour,
     2 any other. All candidates are judged from ONE reference point (the middle of the window), so a later
     position doesn't look like a slower charger and the order is transitive. Then the charger-tier rule
     (memory: charger-tier-rule): arriving with ≥ 50 % the car takes ≤ ~145 kW, so any ≥ 150 kW stand is as fast
     and the cheaper tier wins (E.ON 101–200 kW 13 Kč vs 201+ 16,90 Kč); below 50 % the faster stand wins
     unless it saves ≤ 2 min, then price. Coffee-only stops: closest to the plan. */
  function rankWindow(pool, leg, rt, o, center, soc) {
    const xs = pool.map((p) => tripKm(p.c, leg, rt)).sort((a, b) => a - b);
    const ref = soc(xs[Math.floor(xs.length / 2)]);
    const charge = ref.add > 0, slow = ref.arrive < 50;
    const t0 = leg === 'A' ? o.depart : o.retDepart;
    pool.forEach((p) => {
      p.off = Math.abs(measure(p.c, leg, rt, o) - center);
      p.min = charge ? chargeMinutes(ref.arrive, Math.min(MAX_TARGET, ref.arrive + ref.add), p.c.s.kw || 100) : 0;
      const pr = charge ? price(p.c.s, new Date(t0.getTime() + measureT(p.c, leg, rt) * 60000)) : null;
      p.czk = pr && pr.czk != null ? pr.czk : 99;
    });
    const fastest = Math.min(...pool.map((p) => p.min));
    const key = (p) => [p.tier,
      !charge ? 0 : slow ? (p.min > fastest + 2 ? p.min : 0) : ((p.c.s.kw || 0) >= 150 ? 0 : 1),
      charge ? p.czk : 0, p.off, p.c.n.dist];
    const cmp = (a, b) => { const A = key(a), B = key(b); for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return A[i] - B[i]; return 0; };
    pool.sort(cmp);
    // R24: say why this one won
    const best = pool[0];
    if (pool.length === 1) best.why = 'V okně je jediná vhodná stanice.';
    else if (best.tier === 0 && pool.some((p) => p.tier > 0)) best.why = 'Oblíbená pumpa má v okně přednost.';
    else if (!charge) best.why = 'Tady se nenabíjí, jen přestávka: vybraná je stanice nejblíž plánu.';
    else if (!slow) best.why = (best.c.s.kw || 0) >= 150
      ? `Přijedeš s ~${fmt(ref.arrive)} %: auto víc než ~145 kW nevezme, takže stačí 150 kW stojan a vybraný je levnější.`
      : `Přijedeš s ~${fmt(ref.arrive)} %: rychlejší stojan by tu nepomohl, vybraný je levnější.`;
    else if (pool.some((p) => p.min > best.min + 2)) best.why = `Přijedeš pod 50 % (~${fmt(ref.arrive)} %): vybraný je nejrychlejší stojan.`;
    else best.why = 'Přijedeš pod 50 %: stojany jsou stejně rychlé (rozdíl do 2 min), vybraný je levnější.';
    return pool;
  }

  /* Stops are picked ONLY inside the window the user set (interval ± tolerance) and within the detour setting.
     Nothing there → the window stays empty and the nearest options before/after it (or a bit further off the
     route) are only offered for the user to pick. A favourite pump just outside the window is offered the same
     way next to the chosen stop. (User, 2026-11-15: "zadal jsem 100 ± 20 km a nabídneš 136 km – přímý rozpor".) */
  /* overrides: the user's choices per window on this leg ({leg, win, key, note, why} = this station,
     {leg, win, tol} = only this window widened). Every later window follows from the stop actually used (R2, D5). */
  function pickStops(leg, rt, cands, o, soc, overrides = []) {
    const legEnd = o.byKm ? rt.distance / 1000 : rt.duration / 60;
    const tightM = o.detourKm * 1000;
    const own = cands.filter((c) => sideOk(c, leg));
    const stops = [];
    const f = (v) => (o.byKm ? `${fmt(v)} km` : hm(v));
    let prev = 0;
    for (let win = 0; win < 40; win++) {
      if (legEnd - prev <= o.interval + o.tol) break;            // destination is within reach of this interval
      const center = prev + o.interval;
      const ov = overrides.find((x) => x.leg === leg && x.win === win) || null;
      const tol = ov && ov.tol != null ? ov.tol : o.tol;
      const lo = center - tol, hi = center + tol;
      if (ov && ov.key) {                                         // the user picked this station for this window
        const c = cands.find((x) => stationKey(x.s) === ov.key);
        if (c) {
          stops.push({ leg, win, c, alts: [], note: ov.note || null, lo, hi, pickWhy: ov.why || null });
          prev = measure(c, leg, rt, o);
          continue;
        }
      }
      const pool = own.filter((c) => { const m = measure(c, leg, rt, o); return c.n.dist <= tightM && m >= lo && m <= hi && m > prev + 1; })
        .map((c) => ({ c, tier: favs.has(c.s.fuel) ? 0 : 2 }));
      if (!pool.length) {
        const suggest = outsideOptions(own, leg, rt, o, lo, hi, prev, false);
        // D1 = C: offer to widen just this window so that the nearest station before/after it falls inside
        const nearest = suggest.filter((x) => x.why !== 'detour').sort((a, b) => a.off - b.off)[0];
        const widen = nearest ? Math.ceil((tol + nearest.off) / 5 + 1e-9) * 5 : null;
        stops.push({ leg, win, empty: true, lo, hi, center, suggest, widen });
        prev = center; continue;
      }
      rankWindow(pool, leg, rt, o, center, soc);
      const best = pool[0];
      const favNear = best.tier === 0 ? null : (outsideOptions(own, leg, rt, o, lo, hi, prev, true)[0] || null);
      const widened = ov && ov.tol != null;
      stops.push({ leg, win, c: best.c, alts: pool.slice(1, 6).map((p) => p.c), note: widened ? 'okno rozšířeno' : null, lo, hi, favNear,
        pickWhy: widened ? `Okno jsi rozšířil na ${f(lo)}–${f(hi)} (± ${o.byKm ? `${fmt(tol)} km` : `${fmt(tol)} min`}), ostatní okna drží ± ${o.byKm ? `${fmt(o.tol)} km` : `${fmt(o.tol)} min`}. ${best.why}` : best.why });
      prev = measure(best.c, leg, rt, o);
    }
    return stops;
  }
  // Options OUTSIDE the window, for the user to pick: nearest before / after it (same detour limit) and in the
  // window but further off the route (up to WIDE_KM). onlyFav → only favourite pumps (for the hint next to a stop).
  function outsideOptions(own, leg, rt, o, lo, hi, prev, onlyFav) {
    // empty window: the nearest station before and after it, however far; favourite hint: only "a bit" outside
    const tightM = o.detourKm * 1000, span = onlyFav ? Math.max(o.tol, o.byKm ? 20 : 15) : Infinity;
    const before = [], after = [], detour = [];
    for (const c of own) {
      if (onlyFav && !favs.has(c.s.fuel)) continue;
      const m = measure(c, leg, rt, o);
      if (m <= prev + 1) continue;
      const inWin = m >= lo && m <= hi;
      if (inWin && c.n.dist > tightM && c.n.dist <= (onlyFav ? Math.max(o.detourKm, FAV_DETOUR_KM) : WIDE_KM) * 1000) detour.push({ c, why: 'detour', off: c.n.dist / 1000 });
      else if (!inWin && c.n.dist <= tightM && m >= lo - span && m < lo) before.push({ c, why: 'before', off: lo - m });
      else if (!inWin && c.n.dist <= tightM && m > hi && m <= hi + span) after.push({ c, why: 'after', off: m - hi });
    }
    const pick = (list) => list.sort((x, y) => (favs.has(y.c.s.fuel) - favs.has(x.c.s.fuel)) || (x.off - y.off) || ((y.c.s.kw || 0) - (x.c.s.kw || 0)))[0];
    return [pick(before), pick(after), pick(detour)].filter(Boolean).sort((x, y) => x.off - y.off);
  }
  const measureT = (c, leg, rt) => (leg === 'A' ? c.n.t : rt.duration - c.n.t) / 60 + c.detourMin / 2;

  // km along the whole trip (there, then back)
  function tripX(st, rt) {
    const D = rt.distance / 1000;
    if (st.empty) return st.x;
    return st.leg === 'A' ? st.c.n.d / 1000 : D + (D - st.c.n.d / 1000);
  }
  function kmAtMinutes(rt, min) {  // driving minutes from the start of a leg -> km (for empty-window markers)
    const t = min * 60, T = rt.cumT; let lo = 0, hi = T.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] < t) lo = mid; else hi = mid; }
    return rt.cumD[hi] / 1000;
  }

  function makePlan(rt, cands, o, overrides = []) {
    const D = rt.distance / 1000;
    const soc = socModel(rt, o);
    const stops = pickStops('A', rt, cands, o, soc, overrides);
    if (o.roundTrip) stops.push(...pickStops('B', rt, cands, o, soc, overrides));
    stops.forEach((st) => {
      if (!st.empty) return;
      const k = o.byKm ? (st.lo + st.hi) / 2 : kmAtMinutes(rt, (st.lo + st.hi) / 2);
      st.x = st.leg === 'A' ? k : D + k;
    });
    return fixRange(rt, cands, o, energize(rt, stops, o));
  }

  /* If a gap is too long for the battery (e.g. a long interval around the destination of a round trip), insert an
     extra stop between the problem and the point the battery has to reach (the next stop, the destination or the end)
     and re-plan. A few rounds at most. Used for a new plan and after every change of a planned stop (R39), also for a
     saved trip. An extra stop that ends up charging nothing is dropped again; no two stops at the same place. */
  function fixRange(rt, cands, o, plan) {
    const D = rt.distance / 1000, endX = o.roundTrip ? 2 * D : D;
    const ppk = o.cons / (CAL.battery_kwh || 85);   // % of battery per km
    const legs = o.roundTrip ? ['A', 'B'] : ['A'];
    const useless = (s) => s.note === 'kvůli dojezdu' && !s.done && !s.userTarget && !(s.kwh > 0);
    for (let k = 0; k < 6 && plan.stops.some(useless); k++) plan = energize(rt, plan.stops.filter((s) => !useless(s)), o);
    const skip = new Set();                          // problems no station can fix: report them, but keep fixing the rest
    for (let round = 0; round < 12; round++) {
      const real = plan.stops.filter((s) => !s.empty);
      let prob = null;
      for (let i = 0; i < real.length && !prob; i++) {
        const s = real[i], key = `${s.leg}:${stationKey(s.c.s)}`;
        if (skip.has(key)) continue;
        if (s.short) { const from = tripX(s, rt); prob = { key, from, reach: from + (MAX_TARGET - o.reserve) / ppk, limit: s.needX }; }
        else if (s.arrive < o.reserve - 3) {
          const p = real[i - 1], from = p ? tripX(p, rt) : 0;
          prob = { key, from, reach: from + ((p ? p.target : o.soc0) - o.reserve) / ppk, limit: tripX(s, rt) };
        }
      }
      if (!prob && !skip.has('dest') && o.roundTrip && plan.socDest < resDest(o) - 3) {   // R42: the destination of a round trip
        const before = real.filter((s) => s.leg === 'A'), p = before[before.length - 1], from = p ? tripX(p, rt) : 0;
        prob = { key: 'dest', from, reach: from + ((p ? p.target : o.soc0) - o.reserve) / ppk, limit: D };
      }
      if (!prob && !skip.has('end') && (o.roundTrip ? plan.socEnd : plan.socDest) < resDest(o) - 3) {
        const p = real[real.length - 1], from = p ? tripX(p, rt) : 0;
        prob = { key: 'end', from, reach: from + ((p ? p.target : o.soc0) - o.reserve) / ppk, limit: endX };
      }
      if (!prob) break;
      const used = new Set(real.map((s) => `${s.leg}:${stationKey(s.c.s)}`));
      const busy = (c, leg) => real.some((s) => s.leg === leg && hav(s.c.s, c.s) < 500);   // another stop at the same place
      const upTo = Math.min(prob.reach, prob.limit != null ? prob.limit : Infinity);
      // tier 0 = by the route, 1 = a small detour, 2 = anything up to 15 km away
      const tiers = [o.detourKm, Math.max(o.detourKm, FAV_DETOUR_KM), WIDE_KM];
      const pool = [];
      for (const c of cands) {
        const tier = tiers.findIndex((r) => c.n.dist <= r * 1000);
        if (tier < 0) continue;
        for (const leg of legs) {
          const x = tripKm(c, leg, rt);
          if (sideOk(c, leg) && x > prob.from + 10 && x + c.detourKm / 2 < upTo - 3 && !used.has(`${leg}:${stationKey(c.s)}`) && !busy(c, leg)) pool.push({ c, leg, x, tier });
        }
      }
      if (!pool.length) { skip.add(prob.key); continue; }
      // far enough (the last 40 % of the reachable stretch, so that one extra stop is enough) by the route or with a small
      // detour first; a 15 km detour only when nothing else; then the favourite pump, a ≥ 150 kW stand (you arrive low)
      // and as far as the battery allows
      const farFrom = prob.from + 0.6 * (upTo - prob.from);
      const rank = (p) => (p.tier === 2 ? 16 : 0) + (p.x >= farFrom ? 0 : 8) + (p.tier === 1 ? 4 : 0) + (favs.has(p.c.s.fuel) ? 0 : 2) + ((p.c.s.kw || 0) >= 150 ? 0 : 1);
      pool.sort((a, b) => rank(a) - rank(b) || b.x - a.x);
      const best = pool[0];
      const added = { leg: best.leg, c: best.c, alts: pool.slice(1, 5).filter((p) => p.leg === best.leg).map((p) => p.c), note: 'kvůli dojezdu' };
      const next = energize(rt, [...plan.stops, added].sort((a, b) => tripX(a, rt) - tripX(b, rt)), o);
      if (!(added.kwh > 0)) { skip.add(prob.key); continue; }   // it would charge nothing: it does not solve this problem
      plan = next;
    }
    return plan;
  }

  /* Walk the trip (there + back) and charge at each stop only what is needed to reach the NEXT stop
     (or home / destination) with the reserve. Charging is fastest at low SoC, so this keeps stops short.
     Logged real charging (curTrip.actual) replaces the plan at that stop, and the battery % really used so far
     re-scales the consumption for the rest of the trip – so the remaining plan shows whether it still works. */
  function energize(rt, stops, o) {
    const CAP = CAL.battery_kwh || 85, D = rt.distance / 1000, T = rt.duration / 60, KPP = CAL.kwh_per_pct || 0.98;
    const acts = (curTrip && curTrip.actual) || {};
    const histStops = curTrip && Array.isArray(curTrip.history) ? curTrip.history.reduce((a, h) => a + (h.stops || []).length, 0) : 0;
    let consF = 1, baseUsed = 0, realUsed = 0;
    const pctBase = (km) => km * o.cons / CAP;
    const pct = (km) => pctBase(km) * consF;
    const xOf = (st) => (st.leg === 'A' ? st.c.n.d / 1000 : D + (D - st.c.n.d / 1000));
    const endX = o.roundTrip ? 2 * D : D;
    const real = stops.filter((st) => !st.empty);
    let soc = o.soc0, prevX = 0, clockA = 0, clockB = 0, socDest = null, retDepart = null;
    // the way back can't start before you get there (+ a break at the destination)
    const backAt = () => { if (!retDepart) retDepart = new Date(Math.max(o.retDepart.getTime(), o.depart.getTime() + (T + clockA + BREAK_FIRST) * 60000)); return retDepart; };
    let totalMin = 0, totalCzk = 0, totalKwh = 0, priceUnknown = false, short = false, logged = 0;
    for (let i = 0; i < real.length; i++) {
      const st = real[i], x = xOf(st), next = real[i + 1];
      const act = acts[stopKey(st)] || null;
      st.actual = act;
      st.why = [];                                            // R24: every decision the app takes here, in words
      if (st.pickWhy) st.why.push(st.pickWhy);
      if (st.note === 'kvůli dojezdu') st.why.push('Zastávka navíc mimo tvé okno: bez ní by baterie nestačila.');
      if (st.note === 'vybráno mimo okno') st.why.push('Tuhle stanici jsi vybral sám mimo okno.');
      if (st.leg === 'B' && socDest == null) socDest = soc - pct(D - prevX);
      st.planArrive = soc - pct(x - prevX) - pct(st.c.detourKm / 2);
      if (act && Number.isFinite(act.socFrom)) {
        const base = pctBase(x - prevX + st.c.detourKm / 2), used = soc - act.socFrom;
        if (base > 3) { baseUsed += base; realUsed += used; consF = Math.min(1.6, Math.max(0.6, realUsed / baseUsed)); }
        st.arrive = act.socFrom;
      } else st.arrive = st.planArrive;
      const nextX = next ? xOf(next) : endX;
      st.need = pct(nextX - x) + pct(st.c.detourKm / 2) + (next ? o.reserve + pct(next.c.detourKm / 2) : resDest(o));
      st.needX = nextX;                                        // the point this stop has to get you to
      // R42: on a round trip, the last stop before the destination also has to get you there with "Do cíle dojet s"
      if (o.roundTrip && st.leg === 'A' && (!next || next.leg === 'B')) {
        const toDest = pct(D - x) + pct(st.c.detourKm / 2) + resDest(o);
        if (toDest > st.need) { st.need = toDest; st.needX = D; }
      }
      st.done = !!(act && Number.isFinite(act.socTo));
      if (st.done) {
        st.target = act.socTo;
        st.kwh = Number.isFinite(act.kwh) ? act.kwh : Math.max(0, st.target - st.arrive) * KPP;
        st.chargeMin = Number.isFinite(act.min) ? act.min : (st.target > st.arrive ? chargeMinutes(Math.max(0, st.arrive), st.target, st.c.s.kw || 100) : 0);
        st.short = false;
        st.nextArrive = st.target - (st.need - (next ? o.reserve : resDest(o)));   // what the logged charge leaves for the next leg
        logged += 1;
      } else {
        const whyAuto = [];
        st.short = st.need > MAX_TARGET;
        st.target = Math.round(Math.max(st.arrive, Math.min(st.need, MAX_TARGET)));
        const needR = st.target;
        if (st.target - st.arrive <= 2) {                      // a 1–2 % top-up isn't worth plugging in: a break only
          if (st.need > st.arrive + 0.5) whyAuto.push(`Chybí jen ~${fmt(st.need - st.arrive)} %, nabíjení se nevyplatí: jen přestávka.`);
          st.target = st.arrive;
        } else if (st.target - st.arrive < 8) {
          // if plugging in, take at least 8 % – but never push past 80 % just for that: above 80 % it charges at ~60–80 kW
          const wanted = Math.round(st.arrive + 8), cap = Math.min(80, o.carLimit || 80);
          st.target = Math.min(MAX_TARGET, Math.max(st.target, Math.min(cap, wanted)));
          if (st.target > needR) whyAuto.push(wanted > cap && st.target === cap
            ? `Minimum 8 % by šlo nad ${cap} %, kde se nabíjí pomalu: nabij jen na ${cap} % (potřeba je ${fmt(st.need)} %).`
            : `Nabíjíš aspoň o 8 %, aby se zastávka vyplatila (potřeba je jen ${fmt(st.need)} %).`);
        }
        st.planTarget = st.target;
        const ut = targets[stopKey(st)];
        st.userTarget = Number.isFinite(ut);
        if (st.userTarget) {                                   // R39: the user's number counts exactly (no 8 % minimum, up to 100 %)
          st.target = ut > st.arrive + 0.5 ? Math.min(100, Math.round(ut)) : st.arrive;
          st.short = false;
          st.why.push(ut > st.arrive + 0.5 ? `Plán navrhl ${fmt(st.planTarget)} %, nastavil jsi ${fmt(st.target)} %.`
            : `Plán navrhl ${fmt(st.planTarget)} %, nastavil jsi ${fmt(ut)} %, ale přijedeš už s ~${fmt(st.arrive)} %, takže se tu nenabíjí.`);
        } else st.why.push(...whyAuto);
        const kw = st.c.s.kw || 100;
        st.chargeMin = st.target > st.arrive ? chargeMinutes(Math.max(0, st.arrive), st.target, kw) : 0;
        st.kwh = Math.max(0, st.target - st.arrive) * KPP;
        st.nextArrive = null;
      }
      // R17: first stop of the day 10 min, every further stop 5 min
      st.breakMin = i === 0 && !histStops ? BREAK_FIRST : BREAK_NEXT;
      st.stopMin = Math.max(st.breakMin, st.chargeMin > 0 ? st.chargeMin + (st.done ? 0 : 2) : 0);
      const tDrive = measureT(st.c, st.leg, rt);
      if (st.leg === 'A') { st.at = new Date(o.depart.getTime() + (tDrive + clockA) * 60000); clockA += st.stopMin + st.c.detourMin; }
      else { st.at = new Date(backAt().getTime() + (tDrive + clockB) * 60000); clockB += st.stopMin + st.c.detourMin; }
      st.tDrive = tDrive;
      st.km = st.leg === 'A' ? st.c.n.d / 1000 : D - st.c.n.d / 1000;
      st.pr = price(st.c.s, st.at);
      st.fee = st.done || st.pr == null || st.pr.czk == null ? null : minuteFee(st.pr, st.chargeMin);
      st.cost = st.done && Number.isFinite(act.czk) ? act.czk : st.pr && st.pr.czk != null ? st.kwh * st.pr.czk + (st.fee ? st.fee.czk : 0) : null;
      if (st.fee) st.why.push(`Nabíjení ~${fmt(st.chargeMin)} min je déle než ${st.fee.free} min zdarma: + ${fmt(st.fee.czk)} Kč za ${st.fee.min} min navíc (${fmt(st.fee.rate)} Kč/min, ${st.pr.card}).`);
      if (st.kwh > 0 && st.cost == null) priceUnknown = true;
      st.alt = st.done ? null : altStand(st);
      totalMin += st.chargeMin; totalCzk += st.cost || 0; totalKwh += st.kwh; short = short || st.short;
      soc = st.target; prevX = x;
    }
    if (socDest == null) socDest = soc - pct(D - prevX);
    const socEnd = soc - pct(endX - prevX);
    real.forEach((st, i) => {
      if (!st.done) return;
      const nx = real[i + 1];
      st.nextArrive = nx ? nx.arrive : (o.roundTrip ? socEnd : socDest);
      st.nextIs = nx ? 'stop' : o.roundTrip ? 'home' : 'dest';                    // where the logged charge has to get you
      st.destArrive = o.roundTrip && st.leg === 'A' && (!nx || nx.leg === 'B') ? socDest : null;   // R42: also the destination
    });
    const arriveDest = new Date(o.depart.getTime() + (T + clockA) * 60000);
    const arriveHome = o.roundTrip ? new Date(backAt().getTime() + (T + clockB) * 60000) : null;
    return { stops, D, T, socDest, socEnd, arriveDest, arriveHome, totalMin, totalCzk, totalKwh, priceUnknown, short,
      retDepart: o.roundTrip ? backAt() : null, retLate: o.roundTrip && backAt().getTime() > o.retDepart.getTime() + 60000,
      noChargeEnd: o.soc0 - pctBase(endX), logged, consReal: baseUsed > 3 ? o.cons * consF : null };
  }

  function altStand(st) {
    const s = st.c.s;
    if (s.op !== 'E.ON' || !(st.kwh > 0) || !st.pr || st.pr.czk == null || !s.kw) return null;
    if (s.kw > 200 && st.arrive >= 50) {
      const p2 = price({ ...s, kw: 150 }, st.at), m2 = chargeMinutes(st.arrive, st.target, 150);
      const f2 = minuteFee(p2, m2), czk2 = p2 && p2.czk != null ? st.kwh * p2.czk + (f2 ? f2.czk : 0) : null;
      if (czk2 != null && czk2 < st.cost) return { kind: 'cheaper', czk: czk2, min: m2, unit: p2.czk };
    }
    return null;
  }

  // ------------------------------------------------------------------ rendering
  function render() {
    const { rt, o, plan } = lastRun;
    renderSummary(rt, o, plan);
    renderPlan(o, plan);
  }

  // ---- results in the "Palubní deska" layout (design 1): tiles + battery strip, timeline with time column, stop cards
  const shortName = (label, fallback) => String(label || fallback || '').split(',')[0].replace(/^Moje poloha.*/, 'Moje poloha');
  const townOf = (s) => {
    const p = String(s.place || '').split(',').map((x) => x.trim()).filter(Boolean);
    return (p.length ? p[p.length - 1] : '').replace(/^\d{3}\s?\d{2}\s+/, '').replace(/\s*--\s*$/, '');
  };
  const stopName = (s) => { const town = townOf(s); return `${s.fuel || 'Stanice'}${town && !(s.fuel || '').includes(town) ? ` ${town}` : ''}`; };
  function renderSummary(rt, o, plan) {
    const box = $('summary'); box.textContent = ''; box.className = 'summary';
    const low = (v) => v < resDest(o) - 0.5;
    const tile = (big, small) => el('div', { class: 'tile' }, el('b', { text: big }), el('span', { text: small }));
    const destN = shortName(lastRun.pts[lastRun.pts.length - 1].label, 'cíl');
    box.append(
      tile(fmt(plan.D), o.roundTrip ? 'km tam' : 'km'),
      tile(`${fmt(plan.totalMin)} min`, 'nabíjení'),
      tile(`${fmt(plan.totalCzk)} Kč`, plan.priceUnknown ? 'za proud na cestě, část bez ceny' : 'za proud na cestě'),
      el('div', { class: `battery-strip${low(plan.socDest) || (o.roundTrip && low(plan.socEnd)) ? ' warn' : ''}` },
        el('div', { class: 'bs-head' }, el('span', { text: 'Baterie podle plánu' }), el('span', { text: resDest(o) !== o.reserve ? `rezerva: zastávky ${fmt(o.reserve)} %, cíl ${fmt(resDest(o))} %` : `rezerva ${fmt(o.reserve)} %` })),
        el('div', { class: 'bs-vals' },
          el('b', { class: 'acc', text: `${fmt(plan.socDest)} %` }), el('span', { text: destN }),
          o.roundTrip ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }) : null,
          o.roundTrip ? el('b', { text: `${fmt(plan.socEnd)} %` }) : null,
          o.roundTrip ? el('span', { text: 'doma' }) : null)),
      socChart(rt, o, plan, destN),
      el('p', { class: 'summary-note', text:
        wholePrice(o, plan) +
        (plan.short ? 'Pozor: některý úsek je na jedno nabití moc dlouhý, zkrať interval. ' : '') +
        (() => { const n = plan.stops.filter((s) => !s.empty && !s.done && s.kwh > 0 && s.target > effLimit(o)).length;
          return n ? `Na ${n} ${n === 1 ? 'zastávce' : 'zastávkách'} nabíjíš nad limit v autě ${fmt(effLimit(o))} %, před nabíjením ho zvedni. ` : ''; })() +
        (plan.consReal ? `Podle zapsaných nabíjení jezdíš za ~${fmt(plan.consReal, 1)} kWh/100 km (plán ${fmt(o.cons, 1)}), zbytek plánu je podle toho přepočítaný. ` : '') +
        (CAL.cons_recent && !prefs.consCustom && Math.abs(o.cons - CAL.cons_recent.kwh_100km) < 0.05
          ? `Spotřebu ${fmt(o.cons, 1)} kWh/100 km beru naměřenou v autě (posledních ${CAL.cons_recent.days || 30} dní), změníš v ☰. ` : '') +
        (() => { const n = (lastRun.excluded || {}).hidden || 0;
          return n ? `${n} ${n === 1 ? 'skrytou stanici' : n < 5 ? 'skryté stanice' : 'skrytých stanic'} u trasy appka nenabízí (☰ → Skryté stanice). ` : ''; })() +
        (() => { const n = (lastRun.excluded || {}).wrongSide || 0;
          return n ? `${n} ${n === 1 ? 'odpočívadlo' : n < 5 ? 'odpočívadla' : 'odpočívadel'} v protisměru appka na cestě tam vynechala. ` : ''; })() +
        (plan.retLate ? `Zpátky v ${clock(o.retDepart)} nestihneš, do cíle dojedeš až v ${clock(plan.arriveDest)}. Počítám s odjezdem ${clock(plan.retDepart)}.` : '') }),
      wxNote(lastRun.wx),
    );
  }

  // ---- R45 (D7 = B): weather warnings on the route. Only warnings: the plan's consumption stays as it is.
  // Points every 25 km, none closer than 3 km (straight line) to the start, the destination or a "přes" place, rounded to
  // 0.01° (≈ 1 km), so no home address leaves the phone.
  const r2 = (v) => Math.round(v * 100) / 100;
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function wxSamples(rt, o, plan) {
    const D = rt.distance / 1000, out = [];
    const idxAt = (m) => { let lo = 0, hi = rt.cumD.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rt.cumD[mid] < m) lo = mid; else hi = mid; } return hi; };
    const stopsBefore = (leg, k) => plan.stops.filter((s) => !s.empty && s.leg === leg && s.km < k).reduce((a, s) => a + (s.stopMin || 0) + (s.c.detourMin || 0), 0);
    const places = ((lastRun && lastRun.pts) || []).filter((x) => x && Number.isFinite(x.lat));
    for (let k = WX_EDGE_KM; k <= D - WX_EDGE_KM; k += WX_STEP_KM) {
      const i = idxAt(k * 1000), p = rt.line[i], lat = r2(p.lat), lon = r2(p.lon);
      if (places.some((x) => hav(x, p) < WX_EDGE_KM * 1000 || hav(x, { lat, lon }) < WX_EDGE_KM * 1000)) continue;   // the sent (rounded) point too
      out.push({ lat, lon, km: k, at: new Date(o.depart.getTime() + (rt.cumT[i] / 60 + stopsBefore('A', k)) * 60000) });
      if (o.roundTrip && plan.retDepart) {
        const kb = D - k;                                   // km from the destination on the way back
        out.push({ lat, lon, km: D + kb, back: true, at: new Date(plan.retDepart.getTime() + ((rt.duration - rt.cumT[i]) / 60 + stopsBefore('B', kb)) * 60000) });
      }
    }
    return out.sort((a, b) => a.km - b.km);
  }
  function wxHazard(code, temp, prec) {
    if ([56, 57, 66, 67].includes(code)) return 'mrznoucí déšť';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'sníh';
    if (temp <= 1 && prec > 0) return 'náledí';
    if (code === 45 || code === 48) return 'mlha';
    return null;
  }
  const wxCache = new Map();          // the same request (places and days) is answered from memory, e.g. after "Nabít do"
  async function loadWeather(run) {
    const { rt, o, plan } = run;
    const seq = run.wxSeq = (run.wxSeq || 0) + 1;    // only the newest lookup for the newest plan may write the note
    const done = (wx) => { if (lastRun !== run || run.wxSeq !== seq) return; run.wx = wx; const n = $('wx-note'); if (n) n.replaceWith(wxNote(wx)); };
    try {
      const samples = wxSamples(rt, o, plan);
      if (!samples.length) return done({ state: 'none' });
      const last = Math.max(...samples.map((x) => x.at.getTime()));
      if (last > Date.now() + (WX_DAYS - 1) * 864e5) return done({ state: 'far' });
      const uniq = [...new Map(samples.map((x) => [`${x.lat},${x.lon}`, x])).values()];
      const first = Math.min(...samples.map((x) => x.at.getTime()));
      // Open-Meteo has days from today − 92 to today + 15: ask for the trip ± 1 day inside that range
      const maxEnd = Date.now() + (WX_DAYS - 1) * 864e5, minStart = Date.now() - 92 * 864e5;
      const end = Math.min(last + 864e5, maxEnd), start = Math.max(first - 864e5, Math.min(minStart, end));
      const url = `${METEO}?latitude=${uniq.map((x) => x.lat).join(',')}&longitude=${uniq.map((x) => x.lon).join(',')}` +
        `&hourly=temperature_2m,precipitation,weather_code&timeformat=unixtime&timezone=GMT` +
        `&start_date=${ymd(new Date(start))}&end_date=${ymd(new Date(end))}`;
      let j = wxCache.get(url);
      if (!j) {
        // no answer in 10 s (weak signal in the car) → say so instead of "Načítám…" forever
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        let timer;
        const late = new Promise((_, no) => { timer = setTimeout(() => { if (ctl) ctl.abort(); no(new Error('timeout')); }, 10000); });
        try {
          const r = await Promise.race([fetch(url, ctl ? { signal: ctl.signal } : undefined), late]);
          if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
          j = await Promise.race([r.json(), late]);
        } finally { clearTimeout(timer); }
        wxCache.set(url, j);
        if (wxCache.size > 20) wxCache.delete(wxCache.keys().next().value);
      }
      const list = Array.isArray(j) ? j : [j];
      const byKey = new Map(uniq.map((x, i) => [`${x.lat},${x.lon}`, list[i]]));
      const hits = [];
      for (const x of samples) {
        const h = (byKey.get(`${x.lat},${x.lon}`) || {}).hourly;
        if (!h || !h.time) continue;
        const t = x.at.getTime() / 1000;
        let best = -1;
        h.time.forEach((v, i) => { if (Math.abs(v - t) <= 5400 && (best < 0 || Math.abs(v - t) < Math.abs(h.time[best] - t))) best = i; });
        if (best < 0) continue;
        const hz = wxHazard(h.weather_code[best], h.temperature_2m[best], h.precipitation[best]);
        if (!hz) continue;
        const prev = hits[hits.length - 1];
        if (prev && prev.hz === hz && prev.back === !!x.back && x.km - prev.to <= WX_STEP_KM + 1) { prev.to = x.km; prev.temp = Math.min(prev.temp, h.temperature_2m[best]); }
        else hits.push({ hz, from: x.km, to: x.km, at: x.at, back: !!x.back, temp: h.temperature_2m[best] });
      }
      done({ state: 'ok', hits });
    } catch (e) { done({ state: 'error' }); }
  }
  function wxNote(wx) {
    const w = wx || { state: 'loading' };
    let t = '', warn = false;
    if (w.state === 'loading') t = 'Načítám předpověď počasí na trase…';
    else if (w.state === 'far') t = `Předpověď počasí na trase bude až ${WX_DAYS} dní před cestou.`;
    else if (w.state === 'error') t = 'Předpověď počasí na trase se nepodařilo načíst.';
    else if (w.state === 'none') t = '';
    else if (!w.hits.length) t = '';                    // R47 / D23: fine weather → the summary stays silent
    else {
      warn = true;
      // on the way back the km count from the destination, as in the stop cards
      const D = lastRun && lastRun.plan ? lastRun.plan.D : 0;
      const part = (h) => {
        const a = h.back ? h.from - D : h.from, b = h.back ? h.to - D : h.to, leg = h.back ? ' cesty zpět' : '';
        return `${h.hz}${h.hz === 'náledí' ? ` (${fmt(h.temp)} °C a srážky)` : ''} ` +
          `${Math.round(a) === Math.round(b) ? `u ${fmt(a)}. km${leg}` : `mezi ${fmt(a)}. a ${fmt(b)}. km${leg}`} kolem ${clock(h.at)}`;
      };
      t = `Počasí na trase (předpověď Open-Meteo): ${w.hits.map(part).join('; ')}. Spotřebu to nemění, jen upozorňuje.`;
    }
    return el('p', { class: `summary-note wx-note${warn ? ' warn' : ''}`, id: 'wx-note', text: t, hidden: !t });
  }

  // R40 (D14 = A): battery % along the trip – a jump at every charging stop, the stop windows as bands, the reserve dashed
  function socChart(rt, o, plan, destN) {
    const D = plan.D, KM = o.roundTrip ? 2 * D : D, T = rt.duration / 60;
    const W = 340, H = 150, x0 = 38, x1 = W - 10, y0 = 14, y1 = H - 22;
    const X = (km) => +(x0 + Math.max(0, Math.min(KM, km)) / KM * (x1 - x0)).toFixed(1);
    const Y = (p) => +(y1 - Math.max(0, Math.min(100, p)) / 100 * (y1 - y0)).toFixed(1);
    // a window edge (minutes or km from the start of its leg) → km along the whole trip
    const winKm = (leg, v) => {
      const k = o.byKm ? v : leg === 'A' ? kmAtMinutes(rt, v) : D - kmAtMinutes(rt, Math.max(0, T - v));
      return leg === 'A' ? k : D + k;
    };
    const stops = plan.stops.filter((s) => !s.empty);
    const pts = [[0, o.soc0]];
    stops.forEach((st) => { const x = tripX(st, rt); pts.push([x, st.arrive]); if (st.target > st.arrive + 0.5) pts.push([x, st.target]); });
    const end = o.roundTrip ? plan.socEnd : plan.socDest;
    pts.push([KM, end]);
    const r = (v) => Math.round(Math.max(0, Math.min(100, v)));
    const label = `Baterie po trase: start ${r(o.soc0)} %, ` + stops.map((st, i) => `zastávka ${i + 1} ${st.target > st.arrive + 0.5 ? `${r(st.arrive)} % → ${r(st.target)} %` : `${r(st.arrive)} %`}`).join(', ') +
      `, ${o.roundTrip ? `v cíli ${r(plan.socDest)} %, doma` : 'v cíli'} ${r(end)} %. Rezerva na zastávky ${r(o.reserve)} %, do cíle ${r(resDest(o))} %.`;
    const svg = sv('svg', { class: 'soc-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label, 'data-plot': `${x0} ${y0} ${x1} ${y1}`, 'data-km': KM.toFixed(2) },
      plan.stops.filter((s) => s.win != null && s.lo != null).map((st) => {
        const a = X(winKm(st.leg, st.lo)), b = X(winKm(st.leg, st.hi));
        return sv('rect', { class: `soc-win${st.empty ? ' empty' : ''}`, x: Math.min(a, b), y: y0, width: Math.max(1, Math.abs(b - a)), height: y1 - y0 });
      }),
      [0, 50, 100].map((p) => [sv('line', { class: 'soc-grid', x1: x0, x2: x1, y1: Y(p), y2: Y(p) }),
        sv('text', { class: 'soc-ax', x: x0 - 4, y: Y(p) + 3, 'text-anchor': 'end', text: `${p} %` })]),
      o.roundTrip ? [sv('line', { class: 'soc-dest-mark', x1: X(D), x2: X(D), y1: y0 - 6, y2: y1 }),
        sv('text', { class: 'soc-ax', x: X(D), y: y0 - 8 + 2, 'text-anchor': 'middle', text: destN })] : null,
      sv('line', { class: 'soc-reserve', x1: x0, x2: x1, y1: Y(o.reserve), y2: Y(o.reserve), 'stroke-dasharray': '4 3' }),
      resDest(o) !== o.reserve ? sv('line', { class: 'soc-dest', x1: x0, x2: x1, y1: Y(resDest(o)), y2: Y(resDest(o)), 'stroke-dasharray': '1 3' }) : null,
      sv('polyline', { class: 'soc-line', points: pts.map(([k, p]) => `${X(k)},${Y(p)}`).join(' ') }),
      stops.filter((st) => st.kwh > 0).map((st) => sv('circle', { class: 'soc-dot', cx: X(tripX(st, rt)), cy: Y(st.target), r: 2.5 })),
      [[0, 'start'], [KM, 'end']].map(([k, anchor]) => sv('text', { class: 'soc-ax', x: X(k), y: H - 6, 'text-anchor': anchor, text: `${fmt(k)} km` })));
    return el('figure', { class: 'soc-fig' }, svg);
  }

  // R37: the tile says what you pay on the way; the whole trip also uses the battery charged at home
  function wholePrice(o, plan) {
    const r = comparison(o, plan);
    if (!(r.homeCzk >= 0.5)) return '';
    return `Celá cesta ${fmt(r.ev)} Kč, z toho ${fmt(r.homeCzk)} Kč elektřina z domu. `;   // R47: the breakdown is in the comparison
  }
  const tlRow = (time, kind, content) => el('li', { class: `tl ${kind}` }, el('span', { class: 'tl-time', text: time || '' }), content);
  const tlText = (head, sub) => el('span', { class: 'tl-text' }, el('b', { text: head }), sub ? el('span', { class: 'muted', text: ` · ${sub}` }) : null);
  function renderPlan(o, plan) {
    const box = $('results'); box.textContent = '';
    if (curTrip) box.append(tripCard());
    const pts = lastRun.pts;
    const ol = el('ol', { class: 'timeline' });
    ol.append(tlRow(clock(o.depart), 'start', tlText(`Start · ${shortName(pts[0].label, 'Start')}`, `${fmt(o.soc0)} %`)));
    let k = 0, destDone = false;
    plan.stops.forEach((st, i) => {
      if (st.leg === 'B' && !destDone) { ol.append(destRow(o, plan)); destDone = true; }
      if (st.empty) { ol.append(tlRow('', 'empty', emptyStop(st, o, i))); return; }
      k += 1;
      ol.append(tlRow(clock(st.at), `stop${st.kwh > 0 ? ' charge' : ''}`, stopCard(st, k, i, o)));
    });
    if (!destDone) ol.append(destRow(o, plan));
    if (o.roundTrip) ol.append(tlRow(clock(plan.arriveHome), 'home', tlText(`Domů · ${shortName(pts[0].label, 'Start')}`, `${fmt(plan.socEnd)} %`)));
    box.append(ol, planExport());
    if (curTrip) box.append(finishCard(o, plan));
    box.append(compareCard(o, plan));
    fitBarLabels(); watchBars();
  }
  function destRow(o, plan) {
    return tlRow(clock(plan.arriveDest), 'dest', tlText(`Cíl · ${shortName(lastRun.pts[lastRun.pts.length - 1].label, 'Cíl')}`,
      `${fmt(plan.socDest)} %${o.roundTrip ? ` · zpět v ${clock(plan.retDepart)}${plan.retLate ? ' (dřív to nestihneš)' : ''}` : ''}`));
  }
  // R24: where an offered station lies relative to the window, in plain Czech: "o 9 minut dále", "o 3 minuty dříve",
  // "o 8 km dále", "o 8 km blíže", "2,4 km od trasy"
  function offText(opt, o) {
    if (opt.why === 'detour') return `${fmt(opt.off, 1)} km od trasy`;
    const before = opt.why === 'before';
    if (o.byKm) return `o ${fmt(opt.off)} km ${before ? 'blíže' : 'dále'}`;
    const n = Math.max(1, Math.round(opt.off));
    return `o ${n} ${n === 1 ? 'minutu' : n <= 4 ? 'minuty' : 'minut'} ${before ? 'dříve' : 'dále'}`;
  }
  const optName = (c) => `${c.s.fuel || 'Stanice'} ${townOf(c.s)} · ${[c.s.op, c.s.kw ? `${c.s.kw} kW` : null].filter(Boolean).join(' ')}`.replace(/\s+·/, ' ·');
  function emptyStop(st, o, idx) {
    const f = (v) => (o.byKm ? `${fmt(v)} km` : hm(v));
    const sug = st.suggest || [];
    return el('div', { class: 'status err empty-window' },
      el('p', { text: `${st.leg === 'B' ? 'Zpět: v' : 'V'} okně ${f(st.lo)}–${f(st.hi)} není nabíječka.` +
        (sug.length ? ' Tady jsou nejbližší, i když jsou daleko:' : ' Zkus delší toleranci nebo objížďku.') }),
      st.widen ? el('button', { type: 'button', class: 'linkish strong widen-btn', onclick: () => widenWindow(idx),
        text: `Rozšířit tohle okno na ${f(st.center - st.widen)}–${f(st.center + st.widen)} (± ${o.byKm ? `${fmt(st.widen)} km` : `${fmt(st.widen)} min`})` }) : null,
      sug.length ? el('div', { class: 'alts' }, sug.map((opt) => el('div', { class: 'alt' },
        el('div', {}, el('b', { text: `${favs.has(opt.c.s.fuel) ? '★ ' : ''}${optName(opt.c)}` }), el('small', { class: 'muted', text: offText(opt, o) })),
        el('button', { type: 'button', class: 'linkish', text: 'Vybrat', onclick: () => pickOutside(idx, opt.c) })))) : null);
  }
  /* The user changed a stop (widened its window, picked another station). Remember it for that window, forget the
     user's choices in later windows of the same leg and plan everything after again (D5: "přepočítat i vše potom").
     A saved trip (fixed stations) first turns its stations into choices, so what comes before stays as saved. */
  function changeStop(st, ov) {
    const { rt, o, plan } = lastRun;
    if (ov.key && st.c) delete targets[stopKey(st)];  // R39: a new station starts from the plan (an empty window has none)
    let base = lastRun.overrides || [];
    if (lastRun.fixed) {
      base = plan.stops.filter((x) => !x.empty && x.win != null && (x.leg !== st.leg || x.win < st.win))
        .map((x) => ({ leg: x.leg, win: x.win, key: stationKey(x.c.s), note: x.note, why: x.pickWhy }));
    }
    const overrides = base.filter((x) => !(x.leg === st.leg && x.win >= st.win)).concat({ leg: st.leg, win: st.win, ...ov });
    lastRun.overrides = overrides; lastRun.fixed = false;
    lastRun.plan = makePlan(rt, lastRun.cands, o, overrides);
    if (curTrip) { curTrip.stops = tripStops(lastRun.plan); if (curTrip.saved) persistTrip(true); }
    render();
    if (!$('map-wrap').hidden) drawMap();
    loadWeather(lastRun);
  }
  // the user picked a station outside the window (or further off the route): use it, marked as their choice
  function pickOutside(idx, c) {
    changeStop(lastRun.plan.stops[idx], { key: stationKey(c.s), note: 'vybráno mimo okno' });
  }
  function widenWindow(idx) {
    const st = lastRun.plan.stops[idx];
    changeStop(st, { tol: st.widen });
  }
  // R32: each number sits at its own place on the bar: "nabiješ" above the light part, "přijedeš" before the line at
  // the end of the dark part, "odjedeš" after the line at the end of the light part (D16).
  function batteryBar(from, to, done) {
    const a = Math.max(0, Math.min(100, Math.round(from))), b = Math.max(a, Math.min(100, Math.round(to))), mid = (a + b) / 2;
    const w = done ? ['příjezd', 'nabito', 'odjezd'] : ['přijedeš', 'nabiješ', 'odjedeš'];
    const [chgPos, chgCls] = mid < 15 ? [`left:${a}%`, 'bl-start'] : mid > 85 ? [`right:${100 - b}%`, 'bl-end'] : [`left:${mid}%`, 'bl-mid'];
    const label = (cls, p, word, val, ic) => el('span', { class: cls, 'data-p': p }, el('small', {}, ic ? icon(ic) : null, word), el('b', { text: val }));
    const arr = label('bl-arr', a, w[0], `${a} %`, 'batt'), dep = label('bl-dep', b, w[2], `${b} %`);
    placeLabel(arr, 'end'); placeLabel(dep, 'start');
    return el('div', { class: 'bar-wrap' },
      el('div', { class: 'bar-top' }, el('span', { class: `bl-chg ${chgCls}`, style: chgPos }, `${w[1]} `, el('b', { text: `+${b - a} %` }))),
      el('div', { class: 'bar', role: 'img', 'aria-label': `Baterie: ${w[0]} ${a} %, ${w[1]} ${b - a} %, ${w[2]} ${b} %` },
        el('span', { class: 'bar-base', style: `width:${a}%` }), el('span', { class: 'bar-add', style: `left:${a}%;width:${b - a}%` })),
      el('div', { class: 'bar-legend', 'data-rows': '1' }, arr, dep));
  }
  // side 'end': the label ends at its line (text before it); 'start': it begins at its line (text after it)
  function placeLabel(lab, side, row = 0) {
    const p = Number(lab.getAttribute('data-p'));
    lab.setAttribute('style', side === 'end' ? `right:${100 - p}%` : `left:${p}%`);
    lab.classList.toggle('bl-end', side === 'end'); lab.classList.toggle('bl-start', side !== 'end');
    lab.setAttribute('data-row', String(row));
  }
  // D16: a label that would stick out of its card goes to the other side of its own line, and one row lower if it
  // then covers the other label. Needs the real layout, so it runs after rendering and when the size changes.
  function fitBarLabels() {
    for (const leg of document.querySelectorAll('.bar-legend')) {
      const card = leg.closest('.stop-card'), box = card && card.getBoundingClientRect();
      if (!box || !(box.width > 0)) continue;                                  // hidden, or no layout (tests)
      const placed = [];
      [[leg.children[0], 'end', 'start'], [leg.children[1], 'start', 'end']].forEach(([lab, pref, other]) => {
        placeLabel(lab, pref);
        let r = lab.getBoundingClientRect();
        if (r.left < box.left || r.right > box.right) { placeLabel(lab, other); r = lab.getBoundingClientRect(); }
        let row = 0;
        while (placed.some((q) => q.row === row && q.r.left < r.right + 4 && r.left < q.r.right + 4)) row += 1;
        lab.setAttribute('data-row', String(row));
        placed.push({ row, r });
      });
      leg.setAttribute('data-rows', String(Math.max(...placed.map((q) => q.row)) + 1));
    }
  }
  let barsWatched = false;
  function watchBars() {
    if (barsWatched) return;
    barsWatched = true;
    window.addEventListener('resize', fitBarLabels);
    if (window.ResizeObserver) new window.ResizeObserver(() => fitBarLabels()).observe($('results'));
  }
  function stopCard(st, k, idx, o) {
    const s = st.c.s;
    const charge = st.kwh > 0;
    const name = stopName(s);
    const fav = favs.has(s.fuel);
    const flags = [
      st.note === 'mimo okno' ? 'mimo okno (v okně nic)' : null,
      st.note === 'objížďka' ? 'jen s objížďkou' : null,
      st.note === 'kvůli dojezdu' ? 'mimo okno: jinak by baterie nestačila' : null,
      st.note === 'vybráno mimo okno' ? 'mimo okno, vybral jsi' : null,
      st.note === 'okno rozšířeno' ? 'okno rozšířené tvým klepnutím' : null,
      st.note === 'oblíbená mimo okno' ? 'kousek mimo okno' : null,
      st.note === 'oblíbená objížďka' ? 'malá objížďka' : null,
      s.fuel ? null : 'bez pumpy',
      warn800(s)].filter(Boolean);
    const subParts = [st.c.n.dist < 300 ? 'přímo u trasy' : `${fmt(st.c.n.dist / 1000, 1)} km od trasy`, s.ccs ? [icon('plug'), `${s.ccs}× CCS`] : null,
      s.fuel && s.fd != null ? `pumpa ${s.fd} m` : null, s.cc && s.cc !== 'CZ' ? s.cc : null, `po ${hm(st.tDrive)} jízdy · ${fmt(st.km)} km`].filter(Boolean);
    const sub = subParts.flatMap((p, i) => (i ? [' · ', p] : [p])).flat();
    const adv = st.done ? null : advice(st);
    const tiles = charge ? el('div', { class: 'tiles3' },
      el('div', { class: 'tile' }, el('b', { text: `${st.done ? '' : '~'}${fmt(st.chargeMin)} min` }), el('span', {}, icon('clock'), 'nabíjení')),
      el('div', { class: 'tile' }, el('b', { text: st.cost != null ? `${fmt(st.cost)} Kč` : '? Kč' }), el('span', { text: `${fmt(st.kwh, 1)} kWh` })),
      el('div', { class: 'tile' }, el('b', { text: st.pr && st.pr.czk != null ? fmt(st.pr.czk, 2) : '–' }), el('span', { text: 'Kč/kWh' }))) : null;
    const alts = st.alts && st.alts.length ? el('div', { class: 'alts' }, el('p', { class: 'lbl', text: `Jiné možnosti v tomhle okně (${st.alts.length})` }),
      st.alts.map((a) => {
        const at = new Date((st.leg === 'A' ? o.depart : lastRun.plan.retDepart).getTime() + measureT(a, st.leg, lastRun.rt) * 60000);
        const p = price(a.s, at);
        return el('div', { class: 'alt' },
          el('div', {}, el('b', { text: `${a.s.fuel || 'Stanice'} ${townOf(a.s)} · ${a.s.op || '?'} ${a.s.kw ? a.s.kw + ' kW' : ''}` }),
            el('small', { class: 'muted', text: `za ${hm(measureT(a, st.leg, lastRun.rt))} · ${p && p.czk != null ? fmt(p.czk, 2) + ' Kč/kWh (' + p.card + ')' : p ? p.card : 'bez karty'}${a.n.dist >= 300 ? ` · ${fmt(a.n.dist / 1000, 1)} km od trasy` : ''}` })),
          el('button', { type: 'button', class: 'linkish', text: 'Vybrat', onclick: () => swapStop(idx, a) }));
      })) : null;
    // R47 / D23 (C1): why the app chose this lives under "Víc o zastávce"; what you set yourself and money stay in sight
    const own = (st.why || []).filter((t) => /nastavil jsi|min zdarma/.test(t));
    const more = el('details', { class: 'more-export stop-more' },
      el('summary', { text: 'Víc o zastávce' }),
      (st.why || []).length ? el('ul', { class: 'why' }, st.why.map((t) => el('li', { text: t }))) : null,
      el('dl', { class: 'facts' },
        el('dt', { text: 'Místo' }), el('dd', { text: [s.name, s.place].filter(Boolean).join(' – ') || '–' }),
        el('dt', { text: 'Cena' }), el('dd', { text: priceText(st) }),
        st.pr && st.pr.others.length ? el('dt', { text: 'Jiné karty' }) : null,
        st.pr && st.pr.others.length ? el('dd', { text: st.pr.others.slice(0, 3).map((p) => `${p.card} ${p.czk != null ? fmt(p.czk, 2) + ' Kč' : '(cena v appce)'}`).join(' · ') }) : null,
        el('dt', { text: 'Zastávka' }), el('dd', { text: `${fmt(st.stopMin)} min (přestávka ${st.breakMin} min)` })),
      alts,
      el('button', { type: 'button', class: 'link-btn hide-btn', text: 'Tuhle nechci (už nenabízet)', onclick: () => hideStation(s) }));
    return el('article', { class: `stop-card${charge ? ' charge' : ''}${st.done ? ' done' : ''}` },
      el('div', { class: 'stop-head' },
        el('div', { class: 'stop-title' },
          el('span', { class: 'eyebrow', text: `Zastávka ${k}${st.leg === 'B' ? ' · zpět' : ''} · ${st.done ? 'zapsáno' : charge ? 'nabíjení' : 'bez nabíjení'}` }),
          el('h3', {}, `${name} `, el('span', { class: 'op' }, `· ${s.op ? `${s.op} ` : ''}`, s.kw ? icon('bolt') : null, s.kw ? `${s.kw} kW` : 'výkon ?'))),
        fav ? el('span', { class: 'fav-tag', text: '★ oblíbená' }) : null),
      el('p', { class: 'stop-sub' }, sub),
      flags.length ? el('div', { class: 'badges' }, flags.map((f) => el('span', { class: 'badge warn', text: f }))) : null,
      charge ? batteryBar(st.arrive, st.target, st.done) : el('p', { class: 'stop-line' }, icon('batt'), `Přijedeš s ~${fmt(st.arrive)} %`),
      st.done ? null : chargeTo(st),
      tiles,
      own.length ? el('ul', { class: 'why-own' }, own.map((t) => el('li', { text: t }))) : null,
      adv ? el('p', { class: `advice${adv.warn ? ' warn' : ''}`, text: adv.text }) : null,
      loggedNote(st, o),
      st.done ? null : pumpClosed(st, idx, o),
      st.favNear && !st.done ? el('div', { class: 'fav-near' },
        el('span', { text: `★ Oblíbená ${optName(st.favNear.c)} je ${offText(st.favNear, o)}.` }),
        el('button', { type: 'button', class: 'linkish', text: 'Vybrat', onclick: () => pickOutside(idx, st.favNear.c) })) : null,
      el('div', { class: 'cand-actions' },
        el('a', { class: 'go', href: wazeUrl(s), target: '_blank', rel: 'noopener', text: 'Waze → sem' }),
        el('a', { href: gPlace(s), target: '_blank', rel: 'noopener', text: 'Google Mapy' })),
      curTrip ? actualBox(st) : null,
      more);
  }

  // R43 (D13 = B): small icons next to the facts in a stop card; the words stay, the icons are decoration only
  const ICONS = {
    bolt: [['path', { d: 'M13 2 4 14h7l-1 8 9-12h-7z', fill: 'currentColor', stroke: 'none' }]],
    plug: [['path', { d: 'M9 2v5M15 2v5M6 7h12v3a6 6 0 0 1-12 0zM12 16v6' }]],
    clock: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
    batt: [['rect', { x: 2, y: 7, width: 18, height: 10, rx: 2 }], ['path', { d: 'M22 10v4' }], ['rect', { x: 4, y: 9, width: 7, height: 6, fill: 'currentColor', stroke: 'none' }]],
  };
  const icon = (name) => sv('svg', { class: `ic ic-${name}`, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    ICONS[name].map(([tag, attrs]) => sv(tag, attrs)));

  // R46 (D9 = B): the pump's shop is closed when you arrive → say so and offer pumps in the window that are open; never swap by itself
  function pumpClosed(st, idx, o) {
    const s = st.c.s;
    if (!s.fuel || !s.oh || !st.at || isOpen(s.oh, st.at) !== false) return null;
    const legStart = st.leg === 'A' ? o.depart : lastRun.plan.retDepart;
    const open = (st.alts || []).filter((a) => a.s.fuel && a.s.oh && legStart)
      .map((a) => ({ a, at: new Date(legStart.getTime() + measureT(a, st.leg, lastRun.rt) * 60000) }))
      .filter((x) => isOpen(x.a.s.oh, x.at) === true);
    const nonstop = open.some((x) => /24\/7/.test(x.a.s.oh));
    return el('div', { class: 'pump-closed' },
      el('p', { text: `Pumpa ${s.fuel} má v ${clock(st.at)} podle otevírací doby zavřeno (${s.oh}).` +
        (open.length ? ' V okně má otevřeno:' : ' V okně není jiná pumpa, která má v tu dobu otevřeno.') }),
      open.slice(0, 3).map((x) => el('div', { class: 'alt' },
        el('div', {}, el('b', { text: `${x.a.s.fuel} ${townOf(x.a.s)}` }), el('small', { class: 'muted', text: `otevřeno v ${clock(x.at)} (${x.a.s.oh}) · ${x.a.s.op || '?'} ${x.a.s.kw ? x.a.s.kw + ' kW' : ''}` })),
        el('button', { type: 'button', class: 'linkish', text: 'Vybrat', onclick: () => swapStop(idx, x.a) }))),
      nonstop ? el('p', { class: 'small muted', text: '24/7 v OpenStreetMap u pump často znamená jen tankování kartou, obchod může mít zavřeno.' }) : null);
  }

  // R39 (D12 = A): "Nabít do" slider; letting it go recomputes the rest of the plan (D5)
  function chargeTo(st) {
    const min = Math.max(0, Math.round(st.arrive)), val = Math.max(min, Math.round(st.target));
    const out = el('b', { class: 'ct-val', text: `${val} %` });
    const input = el('input', { type: 'range', class: 'charge-to', min, max: 100, step: 1, value: val, 'aria-label': 'Nabít do',
      'aria-valuetext': `${val} %`, 'data-key': stopKey(st) });
    input.addEventListener('input', () => { out.textContent = `${input.value} %`; input.setAttribute('aria-valuetext', `${input.value} %`); });
    input.addEventListener('change', () => setTarget(st, +input.value));
    return el('div', { class: 'charge-to-row' },
      el('label', { class: 'ct-label' }, el('span', { text: 'Nabít do' }), out, input),
      st.userTarget ? el('button', { type: 'button', class: 'linkish', text: 'Vrátit na plán', onclick: () => setTarget(st, null) }) : null);
  }
  function setTarget(st, val) {
    const key = stopKey(st);
    if (val == null) delete targets[key]; else targets[key] = val;
    const { rt, o } = lastRun;
    // the same stations (also ones you picked by hand), recomputed; an extra stop is added or dropped as the battery needs
    lastRun.plan = fixRange(rt, lastRun.cands, o, energize(rt, lastRun.plan.stops, o));
    if (curTrip) { curTrip.stops = tripStops(lastRun.plan); if (curTrip.saved) persistTrip(true); }
    render();
    // keep the keyboard / VoiceOver focus on the same slider after the cards were drawn again
    const again = [...document.querySelectorAll('input.charge-to')].find((x) => x.dataset.key === key);
    if (again) again.focus();
    if (!$('map-wrap').hidden) drawMap();
    loadWeather(lastRun);                              // R45: the times moved a little
  }

  function swapStop(idx, alt) {
    const { rt, o, plan } = lastRun;
    const st = plan.stops[idx];
    if (st.win != null) { changeStop(st, { key: stationKey(alt.s), why: 'Tuhle stanici jsi vybral ze seznamu v okně.' }); return; }
    delete targets[stopKey(st)];
    st.alts = [st.c, ...st.alts.filter((a) => a !== alt)];
    st.c = alt; st.note = null; st.pickWhy = 'Tuhle stanici jsi vybral ze seznamu v okně.';
    plan.stops.sort((a, b) => tripX(a, rt) - tripX(b, rt));
    lastRun.plan = fixRange(rt, lastRun.cands, o, energize(rt, plan.stops, o));
    if (curTrip) { curTrip.stops = tripStops(lastRun.plan); if (curTrip.saved) persistTrip(true); }
    render();
    if (!$('map-wrap').hidden) drawMap();
    loadWeather(lastRun);
  }

  function priceText(st) {
    const p = st.pr;
    if (!p) return 'žádná z vybraných karet tu nefunguje';
    if (p.czk == null) return `${p.card}: ${p.label}`;
    return `${st.kwh > 0 ? fmt(st.cost) + ' Kč · ' : ''}${fmt(p.czk, 2)} Kč/kWh (${p.card}${p.how !== 'vlastní síť' ? ', ' + p.how : ''}, ${p.label}${p.dayNight ? (p.night ? ', noční cena' : ', denní cena') : ''})` +
      (st.fee ? ` + ${fmt(st.fee.czk)} Kč za ${st.fee.min} min nad ${st.fee.free} min zdarma` : p.fee && p.fee.czk > 0 ? ` · ${p.fee.free} min zdarma, pak ${fmt(p.fee.czk)} Kč/min` : '') +
      (p.unknownKw ? ' – pásmo podle skutečného výkonu' : '');
  }

  function warn800(s) {
    if (s.op === 'Tesla') return 'Tesla: ověř 800 V';
    if (s.kw && s.kw < 150) return 'pod 150 kW: ověř 800 V';
    if (!s.kw) return 'výkon neznámý';
    return null;
  }

  function advice(st) {
    const parts = [];
    let warn = false;
    if (st.short) { parts.push(`Další úsek je na jedno nabití moc dlouhý (potřeba ~${fmt(st.need)} %). Nabij na ${fmt(st.target)} % a zkrať interval zastávek.`); warn = true; }
    const lim = lastRun && effLimit(lastRun.o);
    if (lim && st.kwh > 0 && st.target > lim) { parts.push(`Nabíjíš na ${fmt(st.target)} %, ale limit v autě je ${fmt(lim)} %. Před nabíjením ho zvedni (v autě Nabíjení → max. nabití, nebo v aplikaci Mercedes), jinak nabíjení skončí na ${fmt(lim)} %.`); warn = true; }
    if (st.arrive < 5) { parts.push('Sem dojedeš skoro na nulu, zkrať interval nebo zastav dřív.'); warn = true; }
    // R47: the routine advice in short phrases; warnings above stay sentences
    const tips = [];
    if (st.kwh > 0) tips.push(st.arrive >= 50 ? 'Stačí 150kW stojan' : 'Nejrychlejší volný stojan');
    if (st.alt && st.alt.kind === 'cheaper') {
      tips.push(`stojan E.ON do 200 kW: ~${fmt(st.alt.min)} min, o ${fmt(st.cost - st.alt.czk)} Kč levněji`);
    } else if (st.alt && st.alt.kind === 'faster' && st.chargeMin - st.alt.min > 1) {
      tips.push(`stojan nad 200 kW: o ~${fmt(st.chargeMin - st.alt.min)} min rychleji, o ${fmt(st.alt.czk - st.cost)} Kč dráž`);
    }
    if (st.kwh > 0 && st.pr && !/MB\.CHARGE/.test(st.pr.card) && st.c.s.op !== 'Tesla') tips.push(`karta ${st.pr.card}`, 'vypni Plug & Charge');
    if (st.kwh > 0 && st.pr && /Shell/.test(st.pr.card)) tips.push('Shell: kartou u stojanu, blokace 500 Kč');
    if (tips.length) parts.push(tips.join(' · '));
    return parts.length ? { text: parts.join(' '), warn } : null;
  }

  // ------------------------------------------------------------------ export of the whole plan: Waze, Google Maps → Mercedes, GPX, share
  const wazeUrl = (p) => `https://waze.com/ul?ll=${p.lat.toFixed(6)},${p.lon.toFixed(6)}&navigate=yes&zoom=17`;
  const gPlace = (p) => `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  function gDir(origin, dest, waypoints) {
    const q = new URLSearchParams({ api: '1', origin: ll(origin), destination: ll(dest), travelmode: 'driving' });
    if (waypoints.length) q.set('waypoints', waypoints.slice(0, 9).map(ll).join('|'));
    return `https://www.google.com/maps/dir/?${q}`;
  }
  function sequence() {  // every point in driving order after the start
    const { rt, pts, plan, o } = lastRun;
    const vias = pts.slice(1, -1).map((p) => ({ p, name: (p.label || 'Přes').split(',')[0], t: nearestOnRoute(rt, p).t, leg: 'A' }));
    const stopsA = plan.stops.filter((s) => !s.empty && s.leg === 'A').map((s) => ({ p: s.c.s, name: `Nabíjení ${s.c.s.fuel || s.c.s.op || ''}`.trim(), t: s.c.n.t, leg: 'A', stop: true }));
    const there = [...vias, ...stopsA].sort((a, b) => a.t - b.t);
    const dest = { p: pts[pts.length - 1], name: 'Cíl', dest: true };
    const seq = [...there, dest];
    if (o.roundTrip) {
      const viasB = vias.map((v) => ({ ...v, leg: 'B' }));
      const stopsB = plan.stops.filter((s) => !s.empty && s.leg === 'B').map((s) => ({ p: s.c.s, name: `Nabíjení ${s.c.s.fuel || s.c.s.op || ''}`.trim(), t: s.c.n.t, leg: 'B', stop: true }));
      seq.push(...[...viasB, ...stopsB].sort((a, b) => b.t - a.t), { p: pts[0], name: 'Domů', home: true });
    }
    return { seq, there, back: seq.slice(there.length + 1, -1) };
  }
  function planExport() {
    const { pts, o } = lastRun;
    const { seq, there, back } = sequence();
    const waze = seq.map((st, k) => el('a', { class: 'waze', href: wazeUrl(st.p), target: '_blank', rel: 'noopener',
      text: `${k + 1}. ${st.name}` }));
    return el('section', { class: 'card export', id: 'export' },
      el('h2', { text: 'Do navigace' }),
      el('div', { class: 'cand-actions' },
        el('a', { class: 'nav', href: gDir(pts[0], pts[pts.length - 1], there.map((x) => x.p)), target: '_blank', rel: 'noopener', text: 'Google Mapy: tam' }),
        o.roundTrip ? el('a', { class: 'nav', href: gDir(pts[pts.length - 1], pts[0], back.map((x) => x.p)), target: '_blank', rel: 'noopener', text: 'Google Mapy: zpět' }) : null),
      el('p', { class: 'small muted', text: 'Waze přes odkaz neumí víc zastávek najednou. Klepni na krok, po zastávce na další:' }),
      el('div', { class: 'cand-actions multi' }, waze),
      el('details', { class: 'more-export' }, el('summary', { text: 'Mercedes, GPX, sdílení' }),
        el('p', { class: 'small muted', text: 'Do Mercedesu: Google Mapy → Sdílet → Mercedes-Benz → Odeslat do vozidla.' }),
        el('div', { class: 'cand-actions multi' },
          el('button', { type: 'button', class: 'linkish', onclick: downloadGpx, text: 'Stáhnout GPX' }),
          navigator.share ? el('button', { type: 'button', class: 'linkish', onclick: shareTrip, text: 'Sdílet plán…' }) : null)));
  }

  const xml = (s) => String(s).replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]));
  function gpx() {
    const { rt, pts, o } = lastRun;
    const steps = [{ p: pts[0], name: pts[0].label || 'Start' }, ...sequence().seq];
    const wpt = steps.map((st) => `<wpt lat="${st.p.lat.toFixed(6)}" lon="${st.p.lon.toFixed(6)}"><name>${xml(st.name)}</name></wpt>`).join('\n');
    const rte = steps.map((st) => `<rtept lat="${st.p.lat.toFixed(6)}" lon="${st.p.lon.toFixed(6)}"><name>${xml(st.name)}</name></rtept>`).join('\n');
    const L = rt.line, step = Math.max(1, Math.floor(L.length / 1500));
    const pick = L.filter((_, k) => k % step === 0 || k === L.length - 1);
    const seg = (arr) => `<trkseg>${arr.map((p) => `<trkpt lat="${p.lat.toFixed(5)}" lon="${p.lon.toFixed(5)}"/>`).join('')}</trkseg>`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Nabíjecí plánovač" xmlns="http://www.topografix.com/GPX/1/1">\n${wpt}\n` +
      `<rte><name>Trasa s nabíjením</name>\n${rte}\n</rte>\n<trk><name>Tam</name>${seg(pick)}</trk>\n` +
      (o.roundTrip ? `<trk><name>Zpět</name>${seg([...pick].reverse())}</trk>\n` : '') + '</gpx>\n';
  }
  async function downloadGpx() {
    const { pts } = lastRun;
    const name = `trasa-${(pts[pts.length - 1].label || 'cil').split(',')[0].replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.gpx`;
    const file = new File([gpx()], name, { type: 'application/gpx+xml' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = el('a', { href: URL.createObjectURL(file), download: name });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function shareTrip() {
    const { pts, plan } = lastRun;
    const lines = plan.stops.filter((s) => !s.empty).map((s, k) => `${k + 1}. ${clock(s.at)} ${s.c.s.fuel || ''} ${s.c.s.op || ''} ${s.c.s.kw ? s.c.s.kw + ' kW' : ''}: ${s.kwh > 0 ? `nabít ${fmt(s.arrive)} → ${fmt(s.target)} %` : 'bez nabíjení'}`);
    const { there } = sequence();
    try { await navigator.share({ title: 'Trasa s nabíjením', text: lines.join('\n'), url: gDir(pts[0], pts[pts.length - 1], there.map((x) => x.p)) }); } catch (e) { /* cancelled */ }
  }

  // ------------------------------------------------------------------ Moje cesty: plan at home, open on the phone, log real charging, finish + compare
  const newTripId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const hasActuals = (t) => !!(t && t.actual && Object.keys(t.actual).length);
  const r5 = (v) => Math.round(+v * 1e5) / 1e5;
  function tripInput(o, pts) {
    return { places: pts.map((p) => ({ label: String(p.label || '').slice(0, 60), lat: r5(p.lat), lon: r5(p.lon) })),
      depart: $('depart').value, soc0: o.soc0, reserve: o.reserve, reserveDest: resDest(o), stopBy: o.byKm ? 'km' : 'time',
      intTime: +intTime.value, tolTime: +tolTime.value, intKm: +$('int-km').value, tolKm: +$('tol-km').value,
      detour: o.detourKm, atPump: o.atPump, roundTrip: o.roundTrip, retTime: $('ret-time').value };
  }
  const tripStops = (plan) => plan.stops.filter((s) => !s.empty).map((s) => ({ leg: s.leg, lat: r5(s.c.s.lat), lon: r5(s.c.s.lon),
    op: s.c.s.op, kw: s.c.s.kw, fuel: s.c.s.fuel, name: s.c.s.name, place: s.c.s.place, cc: s.c.s.cc, ccs: s.c.s.ccs, fd: s.c.s.fd,
    to: Number.isFinite(targets[stopKey(s)]) ? targets[stopKey(s)] : undefined }));
  function tripName(inp) {
    const a = (inp.places[0].label || 'Start').split(',')[0], b = (inp.places[inp.places.length - 1].label || 'Cíl').split(',')[0];
    const d = inp.depart ? new Date(inp.depart) : null;
    return `${a} → ${b}${inp.roundTrip ? ' a zpět' : ''}${d && !isNaN(d) ? ` · ${d.getDate()}. ${d.getMonth() + 1}.` : ''}`;
  }
  function persistTrip(quiet) {
    if (!curTrip) return;
    curTrip.saved = true; curTrip.updated = new Date().toISOString();
    curTrip.name = curTrip.name || tripName(curTrip.input);
    if (lastRun && lastRun.plan) {
      const h = histTotals(curTrip);
      curTrip.sum = { czk: Math.round(lastRun.plan.totalCzk + h.czk), min: Math.round(lastRun.plan.totalMin + h.min) };
    }
    const i = trips.findIndex((t) => t.id === curTrip.id);
    if (i >= 0) trips[i] = curTrip; else trips.unshift(curTrip);
    trips = trips.slice(0, 80);
    try { localStorage.setItem(TRIPS_KEY, JSON.stringify(trips)); } catch (e) { if (!quiet) setStatus('Cestu se nepodařilo uložit (plné úložiště?).', true); }
    renderTrips();
  }
  function deleteTrip(t) {
    if (!confirm(`Smazat cestu „${t.name || tripName(t.input)}“ i se zapsaným nabíjením?`)) return;
    trips = trips.filter((x) => x.id !== t.id);
    try { localStorage.setItem(TRIPS_KEY, JSON.stringify(trips)); } catch (e) { /* ignore */ }
    if (curTrip && curTrip.id === t.id) { curTrip.saved = false; if (lastRun) render(); }
    renderTrips();
  }
  function tripMeta(t) {
    const st = t.status === 'done' ? 'dokončeno' : hasActuals(t) ? 'probíhá' : 'plán';
    const czk = t.finish && Number.isFinite(t.finish.czk) ? t.finish.czk : t.sum ? t.sum.czk : null;
    return [st, czk != null ? `${fmt(czk)} Kč` : null, t.stops ? `${t.stops.length} zastáv${t.stops.length === 1 ? 'ka' : t.stops.length < 5 ? 'ky' : 'ek'}` : null].filter(Boolean).join(' · ');
  }
  function renderTrips() {
    const ul = $('trips-list'); ul.textContent = '';
    $('trips-empty').hidden = trips.length > 0;
    $('trips-count').textContent = trips.length ? `${trips.length}` : '';
    trips.forEach((t) => ul.append(el('li', {},
      el('button', { type: 'button', class: 'trip-open', onclick: () => openTrip(t) },
        el('b', { text: t.name || tripName(t.input) }), el('small', { class: 'muted', text: tripMeta(t) })),
      el('button', { type: 'button', class: 'linkish', text: 'Smazat', 'aria-label': `Smazat ${t.name || ''}`, onclick: () => deleteTrip(t) }))));
    const up = trips.filter((t) => t.status !== 'done').slice(0, 4);
    const strip = $('trips-strip'); strip.textContent = ''; strip.hidden = !up.length;
    if (up.length) strip.append(el('span', { class: 'lbl', text: 'Moje cesty' }),
      el('div', { class: 'chips' }, up.map((t) => el('button', { type: 'button', class: 'chip', text: t.name || tripName(t.input), onclick: () => openTrip(t) }))));
  }
  function applyInput(inp) {
    places = inp.places.map((p, i) => ({ role: i === 0 ? 'from' : i === inp.places.length - 1 ? 'to' : 'via', label: p.label, lat: p.lat, lon: p.lon }));
    renderPlaces();
    if (inp.depart) $('depart').value = inp.depart;
    if (Number.isFinite(+inp.soc0)) $('soc0').value = String(inp.soc0);
    if (Number.isFinite(+inp.reserve)) $('reserve').value = String(inp.reserve);
    $('reserve-dest').value = String(Number.isFinite(+inp.reserveDest) && inp.reserveDest != null ? inp.reserveDest : $('reserve').value);
    $(inp.stopBy === 'km' ? 'by-km' : 'by-time').checked = true;
    intTime.value = String(inp.intTime || 60); if (!intTime.value) intTime.value = '60';
    tolTime.value = String(inp.tolTime != null ? inp.tolTime : 15); if (!tolTime.value) tolTime.value = '15';
    $('int-km').value = String(inp.intKm || 130); $('tol-km').value = String(inp.tolKm != null ? inp.tolKm : 20);
    $('detour').value = String(inp.detour || 1.5); if (!$('detour').value) $('detour').value = '1.5';
    $('at-pump').checked = inp.atPump !== false; $('round-trip').checked = !!inp.roundTrip;
    $('ret-time').value = inp.retTime || '16:00';
    syncStopUi();
    syncControls();
  }
  async function openTrip(t, fromLink) {
    await dataReady;
    if (!STATIONS.length) return;
    curTrip = t;
    targets = {};
    applyInput(t.input);
    setMenu(false);
    setStatus('Počítám trasu…');
    const pts = places.filter((p) => p.lat != null);
    let raw;
    try { raw = await route(pts); } catch (err) { setStatus(`Trasu se nepodařilo spočítat (${err.message}). Zkus to za chvíli.`, true); return; }
    setStatus(fromLink ? 'Cesta z odkazu. Ulož si ji tlačítkem „Uložit cestu“, ať ji máš v telefonu i bez odkazu.' : '');
    runPlan(raw, pts, readOptions(), t.stops);
    setFormCollapsed(true);
    $('summary').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // rebuild a saved plan: same stations, recomputed battery/time/price; alternatives come from a fresh search
  function planFromStops(rt, cands, o, fixed) {
    const stops = fixed.map((f) => {
      let c = cands.find((x) => Math.abs(x.s.lat - f.lat) < 0.003 && hav(x.s, f) < 150);
      if (!c) {
        const s = { lat: f.lat, lon: f.lon, op: f.op || null, name: f.name || 'Stanice', kw: f.kw || null, fuel: f.fuel || null,
          place: f.place || null, cc: f.cc || 'CZ', ccs: f.ccs || null, fd: f.fd || null };
        const n = nearestOnRoute(rt, s);
        c = { s, n, detourMin: (2 * n.dist / 1000) / 40 * 60, detourKm: 2 * n.dist / 1000 };
      }
      const leg = f.leg === 'B' && o.roundTrip ? 'B' : 'A';
      if (Number.isFinite(f.to)) targets[`${leg}:${stationKey(c.s)}`] = f.to;      // R39: the saved "Nabít do"
      return { leg, c, alts: [], note: null, pickWhy: 'Stanice z uložené cesty.' };
    });
    stops.sort((a, b) => tripX(a, rt) - tripX(b, rt));
    const nWin = { A: 0, B: 0 }, prev = { A: 0, B: 0 };
    stops.forEach((st) => {
      st.win = nWin[st.leg]++;
      const center = prev[st.leg] + o.interval;          // R40: the window this stop sits in, like pickStops
      st.lo = center - o.tol; st.hi = center + o.tol;
      prev[st.leg] = measure(st.c, st.leg, rt, o);
    });
    try {
      const auto = makePlan(rt, cands, o).stops.filter((s) => !s.empty);
      stops.forEach((st) => {
        const near = auto.filter((a) => a.leg === st.leg).sort((a, b) => Math.abs(tripX(a, rt) - tripX(st, rt)) - Math.abs(tripX(b, rt) - tripX(st, rt)))[0];
        if (near) st.alts = [near.c, ...near.alts].filter((c) => stationKey(c.s) !== stationKey(st.c.s)).slice(0, 5);
      });
    } catch (e) { /* alternatives are optional */ }
    return energize(rt, stops, o);
  }

  // link for the phone: the trip inputs + chosen stations in the URL fragment (never sent to the server)
  const b64u = {
    enc: (str) => { let bin = ''; new TextEncoder().encode(str).forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
    dec: (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))),
  };
  function tripLink(t) {
    const data = { v: 1, i: t.input, s: (t.stops || []).map((s) => (Number.isFinite(s.to) ? [s.leg, s.lat, s.lon, s.to] : [s.leg, s.lat, s.lon])) };
    return `${location.origin}${location.pathname}#cesta=${b64u.enc(JSON.stringify(data))}`;
  }
  function tripFromHash() {
    const m = location.hash.match(/^#cesta=([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    try {
      const d = JSON.parse(b64u.dec(m[1]));
      if (!d || d.v !== 1 || !d.i || !Array.isArray(d.i.places)) return null;
      const pl = d.i.places.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)
        .map((p) => ({ label: String(p.label || '').slice(0, 60), lat: p.lat, lon: p.lon }));
      if (pl.length < 2) return null;
      const i = d.i;
      const input = { places: pl, depart: typeof i.depart === 'string' ? i.depart.slice(0, 16) : '', soc0: +i.soc0 || 100, reserve: Number.isFinite(+i.reserve) ? +i.reserve : 10,
        reserveDest: i.reserveDest != null && Number.isFinite(+i.reserveDest) ? Math.max(0, Math.min(80, +i.reserveDest)) : (Number.isFinite(+i.reserve) ? +i.reserve : 10),
        stopBy: i.stopBy === 'km' ? 'km' : 'time', intTime: +i.intTime || 60, tolTime: Number.isFinite(+i.tolTime) ? +i.tolTime : 15,
        intKm: +i.intKm || 130, tolKm: Number.isFinite(+i.tolKm) ? +i.tolKm : 20, detour: +i.detour || 1.5,
        atPump: i.atPump !== false, roundTrip: !!i.roundTrip, retTime: /^\d{2}:\d{2}$/.test(i.retTime) ? i.retTime : '16:00' };
      const stops = (Array.isArray(d.s) ? d.s : []).filter((s) => Array.isArray(s) && (s[0] === 'A' || s[0] === 'B') && Number.isFinite(s[1]) && Number.isFinite(s[2]))
        .slice(0, 30).map(([leg, lat, lon, to]) => ({ leg, lat, lon, to: Number.isFinite(to) && to >= 0 && to <= 100 ? to : undefined }));
      return { id: newTripId(), saved: false, status: 'plan', input, stops, actual: {} };
    } catch (e) { return null; }
  }
  let qrLoading = null;
  function loadQr() {
    if (window.qrcode) return Promise.resolve();
    if (!qrLoading) qrLoading = new Promise((resolve, reject) => {
      const s = el('script', { src: 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js' });
      s.onload = resolve; s.onerror = () => { qrLoading = null; reject(new Error('qr')); };
      document.head.append(s);
    });
    return qrLoading;
  }
  async function showSend(box) {
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false; box.textContent = '';
    const url = tripLink(curTrip);
    const input = el('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Odkaz na cestu' });
    const qrBox = el('div', { class: 'qr', 'aria-label': 'QR kód odkazu', role: 'img' });
    box.append(
      el('p', { class: 'small muted', text: 'Naskenuj QR kód mobilem, nebo si odkaz pošli. V mobilu pak dej „Uložit cestu“. Odkaz obsahuje místa trasy, posílej ho jen sobě.' }),
      qrBox, input,
      el('div', { class: 'cand-actions multi' },
        el('button', { type: 'button', class: 'linkish', text: 'Kopírovat odkaz', onclick: async (e) => {
          try { await navigator.clipboard.writeText(url); e.currentTarget.textContent = 'Zkopírováno ✓'; } catch (err) { input.select(); }
        } }),
        navigator.share ? el('button', { type: 'button', class: 'linkish', text: 'Sdílet…', onclick: () => navigator.share({ title: curTrip.name || tripName(curTrip.input), url }).catch(() => {}) }) : null));
    try {
      await loadQr();
      const qr = window.qrcode(0, 'L'); qr.addData(url); qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
    } catch (e) { qrBox.textContent = 'QR kód se nepodařilo vytvořit, použij odkaz.'; }
  }
  function tripCard() {
    const t = curTrip;
    const status = !t.saved ? 'Neuložená cesta' : t.status === 'done' ? 'Dokončená cesta' : hasActuals(t) ? 'Probíhající cesta' : 'Uloženo v Moje cesty';
    const sendBox = el('div', { class: 'send-box', hidden: true });
    const hist = Array.isArray(t.history) ? t.history : [];
    return el('section', { class: 'card trip' },
      el('div', {}, el('p', { class: 'eyebrow', text: status }), el('h2', { text: t.name || tripName(t.input) })),
      hist.length ? el('div', { class: 'trip-hist' },
        el('p', { class: 'lbl', text: 'Už odjeto' }),
        hist.map((h) => {
          const czk = h.stops.reduce((a, x) => a + (x.czk || 0), 0), nCh = h.stops.filter((x) => x.kwh > 0).length;
          return el('p', { class: 'small' }, el('b', { text: `${h.from} → ${h.to}` }),
            ` · ${fmt(h.km)} km · ${nCh} ${nCh === 1 ? 'nabíjení' : 'nabíjení'} · ${fmt(czk)} Kč` +
            (h.stops.length ? ` (${h.stops.map((x) => `${x.name}${x.kwh > 0 ? ` ${x.socFrom}→${x.socTo} %` : ''}${x.logged ? '' : ' plán'}`).join(', ')})` : ''));
        }),
        el('p', { class: 'small muted', text: 'Níž je přeplánovaný zbytek cesty. Srovnání na konci počítá celou cestu.' })) : null,
      el('div', { class: 'cand-actions multi' },
        t.saved ? null : el('button', { type: 'button', class: 'linkish strong', text: 'Uložit cestu', onclick: () => { persistTrip(); render(); setStatus('Uloženo. Najdeš ji v ☰ → Moje cesty i nahoře na hlavní obrazovce.'); } }),
        el('button', { type: 'button', class: 'linkish', text: 'Poslat do mobilu', onclick: () => showSend(sendBox) }),
        t.status === 'done' ? null : el('button', { type: 'button', class: 'linkish', text: 'Jedu jinudy / přidat zastávku', onclick: startReroute })),
      sendBox);
  }

  // ---- logged real charging: text from the charging app or a screenshot → numbers → the rest of the plan is recomputed
  function parseChargeText(text) {
    const s = String(text).replace(/ /g, ' ');
    const num = (x) => parseFloat(String(x).replace(/\s/g, '').replace(',', '.'));
    const out = {};
    const kwh = [...s.matchAll(/(\d+(?:[.,]\d+)?)\s*kWh/gi)].map((m) => num(m[1])).filter((v) => v > 0 && v < 120);
    if (kwh.length) out.kwh = Math.max(...kwh);
    const czk = [...s.matchAll(/(\d{1,3}(?: \d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:Kč|CZK|,-)(?!\s*\/)/gi)]
      .map((m) => num(m[1])).filter((v) => v > 0 && v < 20000);
    if (czk.length) out.czk = Math.max(...czk);
    let m;
    if ((m = s.match(/\b(\d{1,2}):(\d{2}):(\d{2})\b/))) out.min = +m[1] * 60 + +m[2] + +m[3] / 60;
    else if ((m = s.match(/(\d+)\s*h(?:od)?\.?\s*(\d+)\s*min/i))) out.min = +m[1] * 60 + +m[2];
    else if ((m = s.match(/(\d+)\s*min(?:ut)?\.?\s*(\d+)\s*s/i))) out.min = +m[1] + +m[2] / 60;
    else if ((m = s.match(/\b(\d{1,3}):(\d{2})\s*min/i))) out.min = +m[1] + +m[2] / 60;
    else if ((m = s.match(/(\d+(?:[.,]\d+)?)\s*min/i))) out.min = num(m[1]);
    else if ((m = s.match(/\b(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})\b/))) {
      const d = (+m[3] * 60 + +m[4]) - (+m[1] * 60 + +m[2]); if (d > 0 && d < 300) out.min = d;
    }
    const pcts = [...s.matchAll(/(\d{1,3})\s*%/g)].filter((x) => !/DPH|VAT/i.test(s.slice(Math.max(0, x.index - 10), x.index)))
      .map((x) => +x[1]).filter((v) => v >= 0 && v <= 100);
    if (pcts.length >= 2) { out.socFrom = Math.min(pcts[0], pcts[1]); out.socTo = Math.max(pcts[0], pcts[1]); }
    else if (pcts.length === 1) out.socTo = pcts[0];
    return out;
  }
  let tessLoading = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (!tessLoading) tessLoading = new Promise((resolve, reject) => {
      const s = el('script', { src: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js' });
      s.onload = resolve; s.onerror = () => { tessLoading = null; reject(new Error('ocr')); };
      document.head.append(s);
    });
    return tessLoading;
  }
  // OCR runs in this browser; the screenshot never leaves the phone (only the OCR engine is downloaded, ~4 MB once)
  async function ocrImage(file, onStatus) {
    onStatus('Načítám čtečku textu (poprvé ~4 MB)…');
    await loadTesseract();
    const worker = await window.Tesseract.createWorker('ces', 1, { logger: (m) => {
      if (m.status === 'recognizing text') onStatus(`Čtu screenshot… ${Math.round(m.progress * 100)} %`);
    } });
    try { const { data } = await worker.recognize(file); return data.text || ''; } finally { worker.terminate(); }
  }
  function actualBox(st) {
    const a = st.actual || {};
    const KPP = CAL.kwh_per_pct || 0.98;
    const fields = {};
    const field = (k, label, val, plan, suffix) => {
      fields[k] = el('input', { type: 'text', inputmode: 'decimal', value: val != null ? String(val).replace('.', ',') : '', placeholder: plan != null ? `plán ${plan}` : '' });
      return el('label', { class: 'field' }, el('span', { text: label }), el('span', { class: 'suffix' }, fields[k], el('i', { text: suffix })));
    };
    const ta = el('textarea', { rows: 3, placeholder: 'Vlož text z aplikace nebo e-mailu, např. „40,8 kWh · 00:18:12 · 814 Kč · 29 % → 71 %“' });
    const note = el('p', { class: 'small muted', 'aria-live': 'polite' });
    const fill = (p) => {
      const found = [];
      if (p.socFrom != null) { fields.socFrom.value = String(p.socFrom); found.push(`${p.socFrom} %`); }
      if (p.socTo != null) { fields.socTo.value = String(p.socTo); found.push(`→ ${p.socTo} %`); }
      if (p.kwh != null) { fields.kwh.value = fmt(p.kwh, 2); found.push(`${fmt(p.kwh, 2)} kWh`); }
      if (p.min != null) { fields.min.value = fmt(p.min, 1); found.push(`${fmt(p.min, 1)} min`); }
      if (p.czk != null) { fields.czk.value = fmt(p.czk, 2).replace(/\s/g, ''); found.push(`${fmt(p.czk, 2)} Kč`); }
      note.textContent = found.length ? `Našel jsem: ${found.join(', ')}. Zkontroluj a ulož.` : 'Žádná čísla jsem nenašel, vyplň je ručně.';
    };
    const fileIn = el('input', { type: 'file', accept: 'image/*', class: 'sr', onchange: async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { const text = await ocrImage(f, (m) => { note.textContent = m; }); ta.value = text.trim(); fill(parseChargeText(text)); }
      catch (err) { note.textContent = 'Screenshot se nepodařilo přečíst (bez internetu se čtečka nenačte). Vyplň čísla ručně.'; }
    } });
    const num = (k) => { const v = parseFloat(String(fields[k].value).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(v) ? v : undefined; };
    const save = () => {
      const r = { socFrom: num('socFrom'), socTo: num('socTo'), kwh: num('kwh'), min: num('min'), czk: num('czk'), at: new Date().toISOString() };
      for (const k of ['socFrom', 'socTo']) if (r[k] != null && (r[k] < 0 || r[k] > 100)) { note.textContent = 'Baterie musí být 0–100 %.'; return; }
      if (r.socTo == null && r.kwh != null) r.socTo = Math.min(100, Math.round((r.socFrom != null ? r.socFrom : st.planArrive) + r.kwh / KPP));
      if (r.socFrom == null && r.socTo == null) { note.textContent = 'Vyplň aspoň baterii při příjezdu nebo po nabití.'; return; }
      Object.keys(r).forEach((k) => r[k] === undefined && delete r[k]);
      curTrip.actual = curTrip.actual || {};
      curTrip.actual[stopKey(st)] = r;
      persistTrip(true);
      replan();
      setStatus('Zapsáno. Zbytek plánu je přepočítaný podle skutečnosti.');
    };
    return el('details', { class: 'more-export actual-box' },
      el('summary', { text: st.done || st.actual ? 'Upravit zápis z nabíjení' : 'Zapsat, jak to dopadlo' }),
      el('div', { class: 'actual-form' },
        ta,
        el('div', { class: 'cand-actions multi' },
          el('button', { type: 'button', class: 'linkish', text: 'Načíst z textu', onclick: () => fill(parseChargeText(ta.value)) }),
          el('button', { type: 'button', class: 'linkish', text: 'Ze screenshotu…', onclick: () => fileIn.click() }), fileIn),
        note,
        el('div', { class: 'grid2 even' },
          field('socFrom', 'Baterie při příjezdu', a.socFrom, Math.round(st.planArrive), '%'),
          field('socTo', 'Nabito na', a.socTo, st.kwh > 0 && !st.done ? st.target : null, '%'),
          field('kwh', 'Nabito', a.kwh, st.kwh > 0 && !st.done ? fmt(st.kwh, 1) : null, 'kWh'),
          field('min', 'Doba', a.min, st.chargeMin > 0 && !st.done ? fmt(st.chargeMin) : null, 'min'),
          field('czk', 'Cena', a.czk, st.cost && !st.done ? fmt(st.cost) : null, 'Kč')),
        el('div', { class: 'cand-actions multi' },
          el('button', { type: 'button', class: 'linkish strong', text: 'Uložit a přepočítat', onclick: save }),
          st.actual ? el('button', { type: 'button', class: 'linkish', text: 'Smazat zápis', onclick: () => {
            delete curTrip.actual[stopKey(st)]; persistTrip(true); replan(); setStatus('Zápis smazán.');
          } }) : null)));
  }
  function loggedNote(st, o) {
    const a = st.actual;
    if (!a) return null;
    const parts = [];
    if (Number.isFinite(a.socFrom)) parts.push(`přijel jsi s ${fmt(a.socFrom)} % (plán ${fmt(st.planArrive)} %)`);
    if (st.done) parts.push(`nabito na ${fmt(st.target)} %${Number.isFinite(a.kwh) ? `, ${fmt(a.kwh, 1)} kWh` : ''}${Number.isFinite(a.min) ? `, ${fmt(a.min)} min` : ''}${Number.isFinite(a.czk) ? `, ${fmt(a.czk)} Kč` : ''}`);
    let check = '', warn = false;
    if (st.done && st.nextArrive != null) {
      // R42: the next stop needs "Na zastávku přijet s alespoň", the destination and home "Do cíle dojet s"
      const toStop = (st.nextIs || 'stop') === 'stop', min = toStop ? o.reserve : resDest(o);
      const where = toStop ? 'na další zastávku' : st.nextIs === 'home' ? 'domů' : 'do cíle';
      const probs = [], short = (w, v, m) => (v < 0.5 ? `${w} nedojedeš (chybí ~${fmt(m - v)} %)` : `${w} přijedeš jen s ~${fmt(v)} % (chceš aspoň ${fmt(m)} %)`);
      if (st.destArrive != null && st.destArrive < resDest(o) - 1) probs.push(short('do cíle', st.destArrive, resDest(o)));
      if (st.nextArrive < min - 1) probs.push(short(where, st.nextArrive, min));
      if (probs.length) { check = ` Nestačí to: ${probs.join(' a ')}. Nabij ještě na ~${fmt(Math.min(MAX_TARGET, st.need))} %, nebo zastav dřív.`; warn = true; }
      else check = ` Plán platí, ${where} přijedeš s ~${fmt(st.nextArrive)} %.`;
    }
    return el('p', { class: `advice logged${warn ? ' warn' : ''}`, text: `Skutečnost: ${parts.join(', ')}.${check}` });
  }

  // ---- "Jedu jinudy": the rest of the trip is re-planned from a new point; the part already driven is kept
  function histTotals(t) {
    const hist = t && Array.isArray(t.history) ? t.history : [];
    const stops = hist.flatMap((x) => x.stops || []);
    return { km: hist.reduce((a, x) => a + (x.km || 0), 0), driveMin: hist.reduce((a, x) => a + (x.driveMin || 0), 0),
      czk: stops.reduce((a, x) => a + (x.czk || 0), 0), min: stops.reduce((a, x) => a + (x.min || 0), 0),
      pct: stops.reduce((a, x) => a + Math.max(0, (x.socTo || 0) - (x.socFrom || 0)), 0),
      stopMins: stops.map((x) => x.min || 0), soc0: hist.length ? hist[0].soc0 : null };
  }
  function archivePart(old, p) {
    const { rt, o, plan, pts } = old;
    const D = rt.distance / 1000;
    const n = nearestOnRoute(rt, p);
    const nearDest = hav(p, pts[pts.length - 1]) < 3000;
    let x;                                   // trip km already driven when re-planning
    if (nearDest) x = D;
    else if (n.dist > 20000) x = new Date() >= plan.arriveDest ? D : n.d / 1000;   // far off the old route: best guess
    else x = o.roundTrip && new Date() >= plan.arriveDest ? 2 * D - n.d / 1000 : n.d / 1000;
    const stops = plan.stops.filter((s) => !s.empty && tripX(s, rt) <= x + 1).map((s) => ({
      name: `${s.c.s.fuel || 'Stanice'} ${townOf(s.c.s)}`.trim(), op: s.c.s.op || null, kw: s.c.s.kw || null, at: s.at.toISOString(),
      logged: !!s.actual, socFrom: Math.round(s.arrive), socTo: Math.round(s.target), kwh: +s.kwh.toFixed(2), min: +s.chargeMin.toFixed(1),
      czk: s.cost != null ? Math.round(s.cost) : 0 }));
    curTrip.history = (curTrip.history || []).concat({ at: new Date().toISOString(), from: shortName(pts[0].label, 'Start'),
      to: shortName(p.label, 'sem'), km: Math.round(x), driveMin: Math.round(x * (rt.duration / 60) / D), soc0: o.soc0, stops });
  }
  const socLabel = () => $('soc0').closest('label').querySelector('span');
  function startReroute() {
    if (!curTrip || !lastRun) return;
    if (!curTrip.saved) persistTrip(true);
    const { o, plan, pts, rt } = lastRun;
    const start = pts[0], dest = pts[pts.length - 1];
    const atDest = o.roundTrip;              // the usual case: in the destination deciding how to get home
    places = [
      atDest ? { role: 'from', label: dest.label, lat: dest.lat, lon: dest.lon } : { role: 'from' },
      { role: 'via' },
      { role: 'to', label: (o.roundTrip ? start : dest).label, lat: (o.roundTrip ? start : dest).lat, lon: (o.roundTrip ? start : dest).lon }];
    renderPlaces();
    $('depart').value = nowLocal();
    $('soc0').value = String(Math.max(0, Math.round(atDest ? plan.socDest : o.soc0)));
    syncControls();
    socLabel().textContent = 'Baterie teď';
    $('round-trip').checked = false; syncStopUi();
    reroute = { tripId: curTrip.id, old: { rt, o, plan, pts } };
    setFormCollapsed(false);
    const st = $('status'); st.textContent = ''; st.classList.remove('err');
    st.append('Přeplánuj zbytek cesty. V kroku 1 zkontroluj, odkud jedeš (◎ = kde jsi teď), a přidej místo, kudy pojedeš nebo kde se zastavíte. V kroku 2 nastav baterii teď. Už odjetá část zůstane uložená v cestě. ',
      el('button', { type: 'button', class: 'link-btn', text: 'Zrušit', onclick: () => { applyInput(curTrip.input); endReroute(); setFormCollapsed(true); setStatus(''); } }));
    st.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function endReroute() { reroute = null; socLabel().textContent = 'Baterie na startu'; }

  // ---- finish the trip + comparison with fuel cars (same method as the ev-trip-cost skill)
  const CMP_DEFAULT = { home: 6.61, loss: 0.10, diesel: 47.99, petrol: 42.35,
    cars: [{ name: 'Renault Talisman diesel', fuel: 'diesel', l: 6.5 }, { name: 'Benzínové auto', fuel: 'petrol', l: 8.0 }] };
  function cmpPrefs() {
    const c = { ...CMP_DEFAULT, ...(prefs.cmp && typeof prefs.cmp === 'object' ? prefs.cmp : {}) };
    if (!Array.isArray(c.cars) || !c.cars.length) c.cars = CMP_DEFAULT.cars;
    return c;
  }
  function renderCmpPrefs() {
    const c = cmpPrefs(), box = $('cmp-box'); box.textContent = '';
    const numIn = (val, onv, label, suffix) => el('label', { class: 'field' }, el('span', { text: label }),
      el('span', { class: 'suffix' }, el('input', { type: 'text', inputmode: 'decimal', value: String(val).replace('.', ','), onchange: (e) => {
        const v = parseFloat(String(e.target.value).replace(',', '.')); if (Number.isFinite(v) && v > 0) { onv(v); savePrefs(); if (lastRun) render(); }
      } }), el('i', { text: suffix })));
    const set = (k) => (v) => { prefs.cmp = { ...cmpPrefs(), [k]: v }; };
    box.append(el('div', { class: 'grid2 even' },
      numIn(c.diesel, set('diesel'), 'Nafta', 'Kč/l'), numIn(c.petrol, set('petrol'), 'Benzín', 'Kč/l'),
      numIn(c.home, set('home'), 'Elektřina doma', 'Kč/kWh')));
    c.cars.forEach((car, i) => box.append(el('div', { class: 'cmp-car' },
      el('input', { type: 'text', value: car.name, 'aria-label': `Auto ${i + 1}`, onchange: (e) => {
        const cars = cmpPrefs().cars.map((x) => ({ ...x })); cars[i].name = e.target.value.slice(0, 40) || `Auto ${i + 1}`; prefs.cmp = { ...cmpPrefs(), cars }; savePrefs(); if (lastRun) render();
      } }),
      el('select', { 'aria-label': `Palivo auta ${i + 1}`, onchange: (e) => {
        const cars = cmpPrefs().cars.map((x) => ({ ...x })); cars[i].fuel = e.target.value; prefs.cmp = { ...cmpPrefs(), cars }; savePrefs(); if (lastRun) render();
      } }, el('option', { value: 'diesel', text: 'nafta', selected: car.fuel === 'diesel' }), el('option', { value: 'petrol', text: 'benzín', selected: car.fuel === 'petrol' })),
      el('span', { class: 'suffix' }, el('input', { type: 'text', inputmode: 'decimal', value: String(car.l).replace('.', ','), 'aria-label': `Spotřeba auta ${i + 1}`, onchange: (e) => {
        const v = parseFloat(String(e.target.value).replace(',', '.')); if (!(v > 0)) return;
        const cars = cmpPrefs().cars.map((x) => ({ ...x })); cars[i].l = v; prefs.cmp = { ...cmpPrefs(), cars }; savePrefs(); if (lastRun) render();
      } }), el('i', { text: 'l/100' })))));
  }
  function comparison(o, plan) {
    const c = cmpPrefs(), CAP = CAL.battery_kwh || 85;
    const fin = curTrip && curTrip.status === 'done' && curTrip.finish ? curTrip.finish : null;
    const h = histTotals(curTrip);
    const km = fin && Number.isFinite(fin.km) ? fin.km : h.km + (o.roundTrip ? 2 : 1) * plan.D;
    const socEnd = fin && Number.isFinite(fin.socEnd) ? fin.socEnd : (o.roundTrip ? plan.socEnd : plan.socDest);
    const real = plan.stops.filter((s) => !s.empty);
    const pubCzk = h.czk + real.reduce((a, s) => a + (s.cost || 0), 0);
    const pubPct = h.pct + real.reduce((a, s) => a + Math.max(0, s.target - s.arrive), 0);
    const soc0 = h.soc0 != null ? h.soc0 : o.soc0;                  // battery when the whole trip started
    const kwhBat = Math.max(0, soc0 - socEnd) / 100 * CAP, kwhSocket = kwhBat / (1 - c.loss);
    const homeCzk = kwhSocket * c.home;
    const where = fin ? 'na konci (zapsané)' : o.roundTrip ? 'po návratu domů' : 'v cíli';
    const charges = real.filter((s) => s.kwh > 0).map((s) => ({ name: stopName(s.c.s), czk: s.cost }));
    const ev = pubCzk + homeCzk;
    const allHome = Math.max(0, soc0 - socEnd + pubPct) / 100 * CAP / (1 - c.loss) * c.home;
    const driveMin = h.driveMin + (o.roundTrip ? 2 : 1) * plan.T;
    let evStops = 0, iceStops = 0;
    [...h.stopMins, ...real.map((s) => s.chargeMin || 0)].forEach((m, i) => { const brk = i === 0 ? BREAK_FIRST : BREAK_NEXT; iceStops += brk; evStops += Math.max(brk, m); });
    const cars = c.cars.map((car) => { const litres = km * car.l / 100; return { ...car, litres, czk: litres * (car.fuel === 'diesel' ? c.diesel : c.petrol) }; });
    return { fin, km, soc0, socEnd, where, kwhBat, kwhSocket, charges, histCzk: h.czk, pubCzk, homeCzk, ev, allHome, evTotal: driveMin + evStops, iceTotal: driveMin + iceStops, wait: evStops - iceStops, cars, c };
  }
  function compareCard(o, plan) {
    const r = comparison(o, plan);
    const row = (name, sub, czk, min, cls) => el('tr', { class: cls || '' },
      el('th', { scope: 'row' }, el('b', { text: name }), sub ? el('small', { class: 'muted', text: sub }) : null),
      el('td', { text: `${fmt(czk)} Kč` }), el('td', { text: fmt(czk / r.km, 2) }), el('td', { text: hm(min) }));
    const cheaper = r.cars.map((x) => x.czk - r.ev);
    return el('section', { class: 'card compare' },
      el('h2', { text: `Srovnání s auty na palivo${r.fin ? '' : ' (podle plánu)'}` }),
      el('p', { class: 'small muted', text: `${fmt(r.km)} km · na konci ${fmt(r.socEnd)} %` }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'cmp' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Auto' }), el('th', { scope: 'col', text: 'Cena' }), el('th', { scope: 'col', text: 'Kč/km' }), el('th', { scope: 'col', text: 'Na cestě' }))),
        el('tbody', {},
          row('Elektro', `na cestě ${fmt(r.pubCzk)} Kč + z domu ${fmt(r.homeCzk)} Kč`, r.ev, r.evTotal, 'ev'),
          r.cars.map((x) => row(x.name, `${fmt(x.l, 1)} l/100 km · ${fmt(x.litres, 1)} l`, x.czk, r.iceTotal))))),
      el('details', { class: 'more-export cmp-more' }, el('summary', { text: 'Rozpis ceny elektra' }), el('p', { class: 'small cmp-sum', text: `Elektro ${fmt(r.ev)} Kč = nabíjení na cestě ${fmt(r.pubCzk)} Kč (` +
        [...r.charges.map((x) => `${x.name} ${x.czk != null ? fmt(x.czk) + ' Kč' : 'cena ?'}`), r.histCzk ? `už odjeto ${fmt(r.histCzk)} Kč` : null]
          .filter(Boolean).join(', ') + (r.charges.length || r.histCzk ? '' : 'nikde nenabíjíš') + ') + ' +
        (r.homeCzk >= 0.5
          ? `elektřina z domu ${fmt(r.homeCzk)} Kč: baterie ${fmt(r.soc0)} % na startu → ${fmt(r.socEnd)} % ${r.where} = ${fmt(r.soc0 - r.socEnd)} % ` +
            `= ${fmt(r.kwhBat)} kWh v baterii, ${fmt(r.kwhSocket)} kWh ze zásuvky (${fmt(r.c.loss * 100)} % se ztratí) × ${fmt(r.c.home, 2)} Kč/kWh.`
          : `elektřina z domu 0 Kč: baterie ${fmt(r.socEnd)} % ${r.where} není pod ${fmt(r.soc0)} % na startu.`) })),
      el('p', { class: 'small', text: `Elektro vychází o ${cheaper.map((d, i) => `${fmt(Math.abs(d))} Kč ${d >= 0 ? 'levněji' : 'dráž'} než ${r.cars[i].name}`).join(', ')}. ` +
        `Čekáním na nabíječce navíc ${fmt(Math.max(0, r.wait))} min. Kdyby se všechno nabilo doma: ${fmt(r.allHome)} Kč.` }),
      el('p', { class: 'small muted', text: `Doma ${fmt(r.c.home, 2)} Kč/kWh + ${fmt(r.c.loss * 100)} % ztráty, nafta ${fmt(r.c.diesel, 2)}, benzín ${fmt(r.c.petrol, 2)} Kč/l. Změníš v ☰ → Srovnání s palivem.` }));
  }
  function finishCard(o, plan) {
    const t = curTrip, fin = t.status === 'done' ? t.finish || {} : null;
    const planEnd = o.roundTrip ? plan.socEnd : plan.socDest, planKm = histTotals(t).km + (o.roundTrip ? 2 : 1) * plan.D;
    const socIn = el('input', { type: 'text', inputmode: 'numeric', value: fin && Number.isFinite(fin.socEnd) ? String(fin.socEnd) : '', placeholder: `plán ${fmt(planEnd)}` });
    const kmIn = el('input', { type: 'text', inputmode: 'numeric', value: fin && Number.isFinite(fin.km) ? String(fin.km) : '', placeholder: `plán ${fmt(planKm)}` });
    const note = el('p', { class: 'small muted', 'aria-live': 'polite' });
    const save = () => {
      const soc = parseFloat(String(socIn.value).replace(',', '.')), km = parseFloat(String(kmIn.value).replace(',', '.'));
      if (!(soc >= 0 && soc <= 100)) { note.textContent = 'Vyplň baterii na konci (0–100 %).'; return; }
      t.status = 'done';
      t.finish = { socEnd: soc, km: km > 0 ? km : Math.round(planKm), at: new Date().toISOString() };
      persistTrip(true);
      t.finish.czk = Math.round(comparison(o, plan).ev);
      persistTrip(true);
      render();
      setStatus('Cesta je dokončená a uložená v ☰ → Moje cesty.');
    };
    return el('section', { class: 'card finish' },
      el('h2', { text: fin ? `Dokončeno ${new Date(fin.at || Date.now()).toLocaleDateString('cs-CZ')}` : 'Dokončit cestu' }),
      fin ? el('p', { class: 'small muted', text: 'Čísla níž počítají se skutečností. Můžeš je opravit.' }) : null,
      el('div', { class: 'grid2 even' },
        el('label', { class: 'field' }, el('span', { text: o.roundTrip ? 'Baterie doma' : 'Baterie v cíli' }), el('span', { class: 'suffix' }, socIn, el('i', { text: '%' }))),
        el('label', { class: 'field' }, el('span', { text: 'Najeto' }), el('span', { class: 'suffix' }, kmIn, el('i', { text: 'km' })))),
      note,
      el('button', { type: 'button', class: 'linkish strong', text: fin ? 'Uložit opravu' : 'Dokončit a uložit', onclick: save }));
  }

  // ------------------------------------------------------------------ map (lazy Leaflet)
  let map = null, layer = null, leafletLoading = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletLoading) return leafletLoading;
    leafletLoading = new Promise((resolve, reject) => {
      const css = el('link', { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' });
      const js = el('script', { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' });
      js.onload = resolve; js.onerror = reject;
      document.head.append(css, js);
    });
    return leafletLoading;
  }
  async function drawMap() {
    if (!lastRun) return;
    await loadLeaflet();
    if (!map) {
      map = L.map('map', { zoomControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
    }
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    const line = L.polyline(lastRun.rt.line.map((p) => [p.lat, p.lon]), { color: '#005EA8', weight: 5, opacity: 0.85 }).addTo(layer);
    lastRun.pts.forEach((p, i) => L.circleMarker([p.lat, p.lon], { radius: 7, color: '#1B1F24', fillColor: i === lastRun.pts.length - 1 ? '#005EA8' : '#fff', fillOpacity: 1 })
      .bindTooltip(p.label || '').addTo(layer));
    let k = 0;
    lastRun.plan.stops.forEach((st) => {
      if (st.empty) return;
      k += 1;
      L.marker([st.c.s.lat, st.c.s.lon], { icon: L.divIcon({ className: 'pin', html: String(k), iconSize: [28, 28] }) })
        .bindPopup(`<b>${k}. ${xml(st.c.s.fuel || '')} ${xml(st.c.s.op || '')} ${st.c.s.kw ? st.c.s.kw + ' kW' : ''}</b><br>${clock(st.at)} · ${st.kwh > 0 ? 'nabít ' + fmt(st.arrive) + ' → ' + fmt(st.target) + ' %' : 'bez nabíjení'}`)
        .addTo(layer);
    });
    setTimeout(() => { map.invalidateSize(); map.fitBounds(line.getBounds(), { padding: [24, 24] }); }, 60);
  }
  $('btn-map').addEventListener('click', async () => {
    const w = $('map-wrap'); w.hidden = !w.hidden;
    $('btn-map').textContent = w.hidden ? 'Mapa' : 'Seznam';
    if (!w.hidden) { await drawMap(); w.scrollIntoView({ behavior: 'smooth' }); } else $('results').scrollIntoView({ behavior: 'smooth' });
  });

  // ------------------------------------------------------------------ boot
  renderPlaces(); renderHidden(); renderStorageInfo(); renderTrips(); renderCmpPrefs();
  const linked = tripFromHash();
  if (linked) { history.replaceState(null, '', location.pathname + location.search); openTrip(linked, true); }
  else if (freshInstall) {
    const st = $('status'); st.textContent = '';
    st.append('Máš uloženou zálohu nastavení z jiného telefonu nebo ze Safari? ',
      el('button', { type: 'button', class: 'link-btn', text: 'Načíst zálohu', onclick: () => $('import-file').click() }));
  }
  let swReg = null, lastCheck = 0;
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').then((reg) => { swReg = reg; reg.update(); }).catch(() => {});
  }
  // A home-screen app is usually resumed, not reloaded: check for a new version whenever it comes back to the foreground.
  async function checkVersion() {
    if (Date.now() - lastCheck < 5 * 60000) return;
    lastCheck = Date.now();
    if (swReg) swReg.update().catch(() => {});
    try {
      const v = await fetch('version.json', { cache: 'no-store' }).then((r) => r.json());
      if (v && v.version && v.version !== APP_VERSION) $('update-banner').hidden = false;
    } catch (e) { /* offline */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
  $('btn-reload').addEventListener('click', () => location.reload());

  // Test hook: tests/harness.mjs sets window.__NP_TEST__ before loading this script. Nothing happens in the real app.
  if (window.__NP_TEST__) Object.assign(window.__NP_TEST__, { ready: dataReady, route, withTempo, candidates, makePlan,
    energize, measure, sideOk, tripX, chargeMinutes, parseChargeText, price, MAX_TARGET, WIDE_KM, rankWindow, advice,
    comparison, tripLink, tripFromHash, sanitizePrefs, minuteFee, isOpen, BREAK_FIRST, BREAK_NEXT, lastRun: () => lastRun, curTrip: () => curTrip,
    setFavs: (list) => { favs = new Set(list); }, data: () => ({ STATIONS, CARDS, CAL }) });
})();
