/* Nabíjecí plánovač – finds charging stops along a route for a CLA 350 4MATIC (800 V, 85 kWh).
   Data: data/*.json (built weekly by build/). Route: OSRM demo server. Place search: Photon (komoot). */
(() => {
  'use strict';

  // ------------------------------------------------------------------ constants & prefs
  const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  const PHOTON = 'https://photon.komoot.io/api/';
  const STOP_MIN = 12;           // coffee + párek + toilet (user rule)
  const RESERVE_DEFAULT = 10;    // arrive home / at destination with at least this (user can change)
  const MAX_TARGET = 90;         // don't plan charging above this in one stop
  const SOFT_MIN = 10;           // also show stops up to 10 min outside the window (marked)
  const FAV_EXTRA_MIN = 10, FAV_EXTRA_KM = 15, FAV_DETOUR_KM = 3;  // a favourite pump may be this far outside the window / off the route
  const APP_VERSION = '2026-11-15';
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
    return p;
  }
  let prefs = {}, freshInstall = false;
  try {
    const rawPrefs = localStorage.getItem(PREFS_KEY);
    freshInstall = !rawPrefs;
    prefs = sanitizePrefs(JSON.parse(rawPrefs || '{}'));
  } catch (e) { prefs = {}; }
  let persistAsked = false;
  const savePrefs = () => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ }
    // ask the browser not to evict our storage (granted silently for installed apps on Android; iOS home-screen apps keep it anyway)
    if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().then(renderStorageInfo, () => {}); }
  };
  const stationKey = (s) => `${(+s.lat).toFixed(5)},${(+s.lon).toFixed(5)}`;
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
      opts.push({ czk: night ? t.night : t.day, card: card.name, label: t.label, how, unknownKw: !kw && tiers.length > 1,
        dayNight: t.day !== t.night });
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
        if (!prefs.home) { setStatus('Domů zatím není uložené. Otevři ⚙︎ Nastavení.', true); return; }
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
  if (prefs.cons) $('cons').value = String(prefs.cons);
  if (prefs.tempo) $('tempo').value = String(prefs.tempo);
  $('reserve').value = String(prefs.reserve != null ? prefs.reserve : RESERVE_DEFAULT);
  let favs = new Set(prefs.favs || DEFAULT_FAVS);

  const stopBy = () => (document.querySelector('input[name="stop-by"]:checked') || {}).value || 'time';
  function syncStopUi() {
    const byKm = stopBy() === 'km';
    $('row-time').hidden = byKm; $('row-km').hidden = !byKm;
    const I = byKm ? +$('int-km').value : +intTime.value, T = byKm ? +$('tol-km').value : +tolTime.value;
    const f = (v) => (byKm ? `${fmt(Math.max(0, v))} km` : hm(Math.max(0, v)));
    $('win-hint').textContent = `První zastávka ${f(I - T)}–${f(I + T)} od startu, každá další zase zhruba po ${f(I)}. Na každé se dobije jen na další úsek.`;
    $('ret-field').hidden = !$('round-trip').checked;
  }
  ['by-time', 'by-km', 'int-time', 'tol-time', 'int-km', 'tol-km', 'round-trip'].forEach((id) => $(id).addEventListener('input', syncStopUi));
  ['by-time', 'by-km', 'round-trip'].forEach((id) => $(id).addEventListener('change', syncStopUi));
  syncStopUi();

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

  function renderPeek() {
    const parts = [favs.size ? `★ ${[...favs].join(', ')}` : 'bez oblíbených pump'];
    if (CARDS) parts.push(`${selCards.size} ${selCards.size === 1 ? 'karta' : selCards.size < 5 ? 'karty' : 'karet'}`);
    const nh = (prefs.hidden || []).length;
    if (nh) parts.push(`${nh} skryt${nh === 1 ? 'á' : 'é'}`);
    parts.push(`spotřeba ${fmt(parseFloat(String($('cons').value).replace(',', '.')) || 23.8, 1)}`);
    $('peek-text').textContent = parts.join(' · ');
  }

  // panel inputs take effect immediately
  ['only-fav', 'my-cards', 'unknown-kw', 'min-kw', 'cons', 'tempo'].forEach((id) => $(id).addEventListener('change', () => {
    const v = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
    if (id === 'min-kw') prefs.minKw = +v;
    else if (id === 'cons') { prefs.cons = Math.min(35, Math.max(12, parseFloat(String(v).replace(',', '.')) || 23.8)); $('cons').value = String(prefs.cons); }
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
    if (standalone) txt = 'Nastavení zůstává v téhle appce i po restartu telefonu. Smaže se, jen když appku odstraníš z plochy.';
    else if (isIOS) txt = 'Pozor: v Safari se nastavení smaže, když stránku týden neotevřeš. Přidej appku na plochu (Sdílet → Přidat na plochu) nebo si ulož zálohu.';
    else txt = `Nastavení zůstává v tomhle zařízení i po restartu${persisted ? ', prohlížeč ho nesmaže ani při nedostatku místa' : ''}. Smaže se jen s daty prohlížeče.`;
    const lb = prefs.lastBackup ? Math.floor((Date.now() - new Date(prefs.lastBackup)) / 86400000) : null;
    txt += ` Poslední záloha: ${lb == null ? 'žádná' : lb < 1 ? 'dnes' : lb === 1 ? 'včera' : `před ${lb} dny`}.`;
    $('storage-info').textContent = txt;
  }
  $('btn-export').addEventListener('click', async () => {
    const data = JSON.stringify({ app: 'nabijeci-planovac', version: 1, saved: new Date().toISOString(), prefs }, null, 1);
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
    let p;
    try {
      const j = JSON.parse(await f.text());
      if (!j || j.app !== 'nabijeci-planovac' || !j.prefs || typeof j.prefs !== 'object' || Array.isArray(j.prefs)) throw new Error('format');
      p = sanitizePrefs(j.prefs);
    } catch (err) { setMenu(false); setStatus('Tohle není záloha z Nabíjecího plánovače.', true); return; }
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (err) { setMenu(false); setStatus('Zálohu se nepodařilo uložit (soukromé okno nebo plné úložiště?).', true); return; }
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
      tempo: parseFloat($('tempo').value) || 0.93,
      reserve: Math.max(0, Math.min(80, parseFloat($('reserve').value))),
    };
    if (!Number.isFinite(o.reserve)) o.reserve = RESERVE_DEFAULT;
    return o;
  }
  // OSRM is ~7 % slower than Google at ~130 km/h → scale its times by the chosen tempo
  const withTempo = (raw, tempo) => ({ ...raw, cumT: raw.cumT.map((t) => t * tempo), duration: raw.duration * tempo });
  function runPlan(raw, pts, o) {
    const rt = withTempo(raw, o.tempo);
    const cands = candidates(rt, o);
    lastRun = { raw, rt, pts, o, cands, plan: makePlan(rt, cands, o) };
    render();
    $('btn-map').disabled = false;
    if (!$('map-wrap').hidden) drawMap();
  }
  // settings changed in the panel → recompute the plan for the same route (no new routing request)
  function replan() {
    if (!lastRun || !STATIONS.length) return;
    const f = readOptions();
    runPlan(lastRun.raw, lastRun.pts, { ...lastRun.o, onlyFav: f.onlyFav, myCards: f.myCards, unknownKw: f.unknownKw, minKw: f.minKw, cons: f.cons, tempo: f.tempo });
  }

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await dataReady;
    if (!STATIONS.length) return;
    const pts = places.filter((p) => p.lat != null);
    if (!places[0].lat || !places[places.length - 1].lat) { setStatus('Vyber místo v poli Odkud i Kam (ze seznamu, polohou nebo souřadnicemi).', true); return; }
    const o = readOptions();
    Object.assign(prefs, { places, stopBy: o.byKm ? 'km' : 'time', intTime: +intTime.value, tolTime: +tolTime.value,
      intKm: +$('int-km').value, tolKm: +$('tol-km').value, retTime: $('ret-time').value, detour: o.detourKm,
      'at-pump': o.atPump, 'round-trip': o.roundTrip, 'only-fav': o.onlyFav, 'my-cards': o.myCards, 'unknown-kw': o.unknownKw,
      minKw: o.minKw, cons: o.cons, tempo: o.tempo, reserve: o.reserve, favs: [...favs] });
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
    runPlan(raw, pts, o);
    $('summary').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const WIDE_KM = 15;
  function candidates(rt, o) {
    const lats = rt.line.map((p) => p.lat), lons = rt.line.map((p) => p.lon);
    const pad = WIDE_KM / 100 + 0.02;
    const box = [Math.min(...lats) - pad, Math.max(...lats) + pad, Math.min(...lons) - pad * 1.5, Math.max(...lons) + pad * 1.5];
    const out = [], hidden = hiddenList();
    for (const s of STATIONS) {
      if (s.lat < box[0] || s.lat > box[1] || s.lon < box[2] || s.lon > box[3]) continue;
      if (hidden.length && hidden.some((h) => Math.abs(h.lat - s.lat) < 0.003 && hav(h, s) < 150)) continue;
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
      return { arrive, add: need - arrive > 2 ? Math.max(8, need - arrive) : 0 };
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
    return pool.sort(cmp);
  }

  function pickStops(leg, rt, cands, o, soc) {
    const legEnd = o.byKm ? rt.distance / 1000 : rt.duration / 60;
    const tightM = o.detourKm * 1000, favM = Math.max(o.detourKm, FAV_DETOUR_KM) * 1000;
    const favExtra = o.byKm ? FAV_EXTRA_KM : FAV_EXTRA_MIN;
    const gap = Math.max(o.interval - o.tol - favExtra, o.interval / 2);   // never two stops closer than this (a favourite may come a bit early)
    const own = cands.filter((c) => sideOk(c, leg));
    const stops = [];
    let prev = 0;
    for (let guard = 0; guard < 40; guard++) {
      if (legEnd - prev <= o.interval + o.tol) break;            // destination is within reach of this interval
      const center = prev + o.interval;
      const lo = center - o.tol, hi = center + o.tol;
      const within = (c, a, b) => { const m = measure(c, leg, rt, o); return m >= a && m <= b && (prev === 0 || m >= prev + gap) && m > prev + 1; };
      let pool = [], note = null;
      for (const c of own) {
        const fav = favs.has(c.s.fuel);
        if (c.n.dist <= tightM && within(c, lo, hi)) pool.push({ c, tier: fav ? 0 : 2 });
        else if (fav && c.n.dist <= favM && within(c, lo - favExtra, hi + favExtra)) pool.push({ c, tier: 1 });
      }
      const tierOf = (c) => ({ c, tier: favs.has(c.s.fuel) ? 0 : 2 });
      if (!pool.length) {
        pool = own.filter((c) => within(c, lo, hi)).map(tierOf);
        if (pool.length) note = 'objížďka';
      }
      if (!pool.length) {
        const extra = Math.max(o.tol, o.byKm ? 20 : 15);
        pool = own.filter((c) => c.n.dist <= tightM && within(c, lo - extra, hi + extra)).map(tierOf);
        if (pool.length) note = 'mimo okno';
      }
      if (!pool.length) { stops.push({ leg, empty: true, lo, hi }); prev = center; continue; }
      rankWindow(pool, leg, rt, o, center, soc);
      const best = pool[0];
      if (!note && best.tier === 1) note = within(best.c, lo, hi) ? 'oblíbená objížďka' : 'oblíbená mimo okno';
      stops.push({ leg, c: best.c, alts: pool.slice(1, 6).map((p) => p.c), note, lo, hi });
      prev = measure(best.c, leg, rt, o);
    }
    return stops;
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

  function makePlan(rt, cands, o) {
    const D = rt.distance / 1000;
    const soc = socModel(rt, o);
    const stops = pickStops('A', rt, cands, o, soc);
    if (o.roundTrip) stops.push(...pickStops('B', rt, cands, o, soc));
    stops.forEach((st) => {
      if (!st.empty) return;
      const k = o.byKm ? (st.lo + st.hi) / 2 : kmAtMinutes(rt, (st.lo + st.hi) / 2);
      st.x = st.leg === 'A' ? k : D + k;
    });
    let plan = energize(rt, stops, o);
    // If a gap is too long for the battery (e.g. a long interval around the destination of a round trip),
    // insert an extra stop inside the reachable part of that gap and re-plan. A few rounds at most.
    const ppk = o.cons / (CAL.battery_kwh || 85);   // % of battery per km
    const legs = o.roundTrip ? ['A', 'B'] : ['A'];
    const skip = new Set();                          // problems no station can fix: report them, but keep fixing the rest
    for (let round = 0; round < 12; round++) {
      const real = plan.stops.filter((s) => !s.empty);
      let prob = null;
      for (let i = 0; i < real.length && !prob; i++) {
        const s = real[i], key = `${s.leg}:${stationKey(s.c.s)}`;
        if (skip.has(key)) continue;
        if (s.short) { const from = tripX(s, rt); prob = { key, from, reach: from + (MAX_TARGET - o.reserve) / ppk }; }
        else if (s.arrive < o.reserve - 3) {
          const p = real[i - 1], from = p ? tripX(p, rt) : 0;
          prob = { key, from, reach: from + ((p ? p.target : o.soc0) - o.reserve) / ppk };
        }
      }
      if (!prob && !skip.has('end') && (o.roundTrip ? plan.socEnd : plan.socDest) < o.reserve - 3) {
        const p = real[real.length - 1], from = p ? tripX(p, rt) : 0;
        prob = { key: 'end', from, reach: from + ((p ? p.target : o.soc0) - o.reserve) / ppk };
      }
      if (!prob) break;
      const used = new Set(real.map((s) => `${s.leg}:${stationKey(s.c.s)}`));
      let pool = [];
      // stations by the route first, then a small detour, then anything up to 15 km away
      for (const r of [o.detourKm, Math.max(o.detourKm, FAV_DETOUR_KM), WIDE_KM]) {
        for (const c of cands) {
          if (c.n.dist > r * 1000) continue;
          for (const leg of legs) {
            const x = tripKm(c, leg, rt);
            if (sideOk(c, leg) && x > prob.from + 10 && x + c.detourKm / 2 < prob.reach - 3 && !used.has(`${leg}:${stationKey(c.s)}`)) pool.push({ c, leg, x });
          }
        }
        if (pool.length) break;
      }
      if (!pool.length) { skip.add(prob.key); continue; }
      // favourite pump first; you arrive low here, so a ≥ 150 kW stand; then as far as the battery allows (fewer stops)
      const rank = (p) => (favs.has(p.c.s.fuel) ? 0 : 2) + ((p.c.s.kw || 0) >= 150 ? 0 : 1);
      pool.sort((a, b) => rank(a) - rank(b) || b.x - a.x);
      const best = pool[0];
      plan.stops.push({ leg: best.leg, c: best.c, alts: pool.slice(1, 5).filter((p) => p.leg === best.leg).map((p) => p.c), note: 'kvůli dojezdu' });
      plan.stops.sort((a, b) => tripX(a, rt) - tripX(b, rt));
      plan = energize(rt, plan.stops, o);
    }
    return plan;
  }

  /* Walk the trip (there + back) and charge at each stop only what is needed to reach the NEXT stop
     (or home / destination) with the reserve. Charging is fastest at low SoC, so this keeps stops short. */
  function energize(rt, stops, o) {
    const CAP = CAL.battery_kwh || 85, D = rt.distance / 1000, T = rt.duration / 60;
    const pct = (km) => km * o.cons / CAP;
    const xOf = (st) => (st.leg === 'A' ? st.c.n.d / 1000 : D + (D - st.c.n.d / 1000));
    const endX = o.roundTrip ? 2 * D : D;
    const real = stops.filter((st) => !st.empty);
    let soc = o.soc0, prevX = 0, clockA = 0, clockB = 0, socDest = null, retDepart = null;
    // the way back can't start before you get there (+ the planned coffee break at the destination)
    const backAt = () => { if (!retDepart) retDepart = new Date(Math.max(o.retDepart.getTime(), o.depart.getTime() + (T + clockA + STOP_MIN) * 60000)); return retDepart; };
    let totalMin = 0, totalCzk = 0, totalKwh = 0, priceUnknown = false, short = false;
    for (let i = 0; i < real.length; i++) {
      const st = real[i], x = xOf(st), next = real[i + 1];
      if (st.leg === 'B' && socDest == null) socDest = soc - pct(D - prevX);
      st.arrive = soc - pct(x - prevX) - pct(st.c.detourKm / 2);
      const nextX = next ? xOf(next) : endX;
      st.need = pct(nextX - x) + pct(st.c.detourKm / 2) + o.reserve + (next ? pct(next.c.detourKm / 2) : 0);
      st.short = st.need > MAX_TARGET;
      st.target = Math.round(Math.max(st.arrive, Math.min(st.need, MAX_TARGET)));
      if (st.target - st.arrive <= 2) st.target = st.arrive;   // a 1–2 % top-up isn't worth plugging in: coffee only
      else if (st.target - st.arrive < 8) st.target = Math.min(MAX_TARGET, Math.round(st.arrive + 8));  // if plugging in, take at least 8 %
      const kw = st.c.s.kw || 100;
      st.chargeMin = st.target > st.arrive ? chargeMinutes(Math.max(0, st.arrive), st.target, kw) : 0;
      st.kwh = Math.max(0, st.target - st.arrive) * (CAL.kwh_per_pct || 0.98);
      st.stopMin = Math.max(STOP_MIN, st.chargeMin > 0 ? st.chargeMin + 2 : 0);
      const tDrive = measureT(st.c, st.leg, rt);
      if (st.leg === 'A') { st.at = new Date(o.depart.getTime() + (tDrive + clockA) * 60000); clockA += st.stopMin + st.c.detourMin; }
      else { st.at = new Date(backAt().getTime() + (tDrive + clockB) * 60000); clockB += st.stopMin + st.c.detourMin; }
      st.tDrive = tDrive;
      st.km = st.leg === 'A' ? st.c.n.d / 1000 : D - st.c.n.d / 1000;
      st.pr = price(st.c.s, st.at);
      st.cost = st.pr && st.pr.czk != null ? st.kwh * st.pr.czk : null;
      if (st.kwh > 0 && st.cost == null) priceUnknown = true;
      st.alt = altStand(st);
      totalMin += st.chargeMin; totalCzk += st.cost || 0; totalKwh += st.kwh; short = short || st.short;
      soc = st.target; prevX = x;
    }
    if (socDest == null) socDest = soc - pct(D - prevX);
    const socEnd = soc - pct(endX - prevX);
    const arriveDest = new Date(o.depart.getTime() + (T + clockA) * 60000);
    const arriveHome = o.roundTrip ? new Date(backAt().getTime() + (T + clockB) * 60000) : null;
    return { stops, D, T, socDest, socEnd, arriveDest, arriveHome, totalMin, totalCzk, totalKwh, priceUnknown, short,
      retDepart: o.roundTrip ? backAt() : null, retLate: o.roundTrip && backAt().getTime() > o.retDepart.getTime() + 60000,
      noChargeEnd: o.soc0 - pct(endX) };
  }

  function altStand(st) {
    const s = st.c.s;
    if (s.op !== 'E.ON' || !(st.kwh > 0) || !st.pr || st.pr.czk == null || !s.kw) return null;
    if (s.kw > 200 && st.arrive >= 50) {
      const p2 = price({ ...s, kw: 150 }, st.at), m2 = chargeMinutes(st.arrive, st.target, 150);
      if (p2 && p2.czk != null && p2.czk < st.pr.czk) return { kind: 'cheaper', czk: st.kwh * p2.czk, min: m2, unit: p2.czk };
    }
    return null;
  }

  // ------------------------------------------------------------------ rendering
  function render() {
    const { rt, o, plan } = lastRun;
    renderSummary(rt, o, plan);
    renderPlan(o, plan);
  }

  function renderSummary(rt, o, plan) {
    const box = $('summary'); box.textContent = ''; box.className = 'summary';
    const nStops = plan.stops.filter((s) => !s.empty).length, nCharge = plan.stops.filter((s) => !s.empty && s.kwh > 0).length;
    const low = (v) => v < o.reserve - 0.5;
    const endTxt = o.roundTrip ? `${fmt(plan.socDest)} → ${fmt(plan.socEnd)} %` : `${fmt(plan.socDest)} %`;
    box.append(
      el('div', { class: 'stat' }, el('b', { text: `${fmt(plan.D)} km` }), el('span', { text: o.roundTrip ? 'tam (a stejně zpět)' : 'trasa' })),
      el('div', { class: 'stat' }, el('b', { text: hm(plan.T) }), el('span', { text: 'jízda tam bez zastávek' })),
      el('div', { class: 'stat' }, el('b', { text: `${nStops}` }), el('span', { text: `zastávek, nabíjení na ${nCharge}` })),
      el('div', { class: 'stat' }, el('b', { text: `${fmt(plan.totalMin)} min` }), el('span', { text: 'nabíjení celkem' })),
      el('div', { class: 'stat' }, el('b', { text: `${fmt(plan.totalCzk)} Kč` }), el('span', { text: plan.priceUnknown ? 'nabíjení (část bez ceny)' : 'za nabíjení' })),
      el('div', { class: `stat${low(plan.socDest) || (o.roundTrip && low(plan.socEnd)) ? ' warn' : ''}` },
        el('b', { text: endTxt }), el('span', { text: o.roundTrip ? 'v cíli → doma, podle plánu' : 'v cíli, podle plánu' })),
      el('p', { class: 'summary-note', text:
        (plan.noChargeEnd >= o.reserve ? `Bez nabíjení bys ${o.roundTrip ? 'domů' : 'do cíle'} dojel s ~${fmt(plan.noChargeEnd)} %, takže zastávky jsou hlavně na kávu. `
          : `Celkem potřebuješ cestou dobít asi ${fmt(o.reserve - plan.noChargeEnd)} % baterie (~${fmt((o.reserve - plan.noChargeEnd) * (CAL.battery_kwh || 85) / 100)} kWh). `) +
        `Na každé zastávce se dobije jen tolik, abys na další přijel s alespoň ${fmt(o.reserve)} %.` +
        (plan.short ? ' Pozor: některý úsek je na jedno nabití moc dlouhý, zkrať interval.' : '') +
        (plan.retLate ? ` Zpátky v ${clock(o.retDepart)} nestihneš, do cíle dojedeš až v ${clock(plan.arriveDest)}. Počítám s odjezdem ${clock(plan.retDepart)}.` : '') }),
    );
  }

  function renderPlan(o, plan) {
    const box = $('results'); box.textContent = '';
    box.append(planExport());
    const pts = lastRun.pts;
    box.append(stepRow('start', `Start · ${clock(o.depart)}`, pts[0].label || 'Start', `baterie ${fmt(o.soc0)} %`));
    let k = 0;
    plan.stops.forEach((st, i) => {
      if (st.leg === 'B' && !box.querySelector('.step.dest')) box.append(destRow(o, plan));
      if (st.empty) { box.append(emptyStop(st, o)); return; }
      k += 1;
      box.append(stopCard(st, k, i, o));
    });
    if (!box.querySelector('.step.dest')) box.append(destRow(o, plan));
    if (o.roundTrip) box.append(stepRow('home', `Domů · ${clock(plan.arriveHome)}`, pts[0].label || 'Start', `dojedeš s ~${fmt(plan.socEnd)} %`));
  }
  function destRow(o, plan) {
    return stepRow('dest', `Cíl · ${clock(plan.arriveDest)}`, lastRun.pts[lastRun.pts.length - 1].label || 'Cíl',
      `přijedeš s ~${fmt(plan.socDest)} %${o.roundTrip ? ` · zpět vyrážíš ${clock(plan.retDepart)}${plan.retLate ? ' (dřív to nestihneš)' : ''}` : ''}`);
  }
  function stepRow(kind, head, name, sub) {
    return el('div', { class: `step ${kind}` }, el('b', { text: head }), el('span', { text: name }), el('small', { class: 'muted', text: sub }));
  }
  function emptyStop(st, o) {
    const f = (v) => (o.byKm ? `${fmt(v)} km` : hm(v));
    return el('div', { class: 'status err', text: `${st.leg === 'B' ? 'Zpět: ' : ''}v okně ${f(st.lo)}–${f(st.hi)} není nabíječka podle tvých filtrů. Zkus větší objížďku, vypnout „Jen na pumpách“ nebo „jen oblíbené“, nebo jiný interval.` });
  }

  function stopCard(st, k, idx, o) {
    const s = st.c.s;
    const title = [s.fuel || 'Stanice', [s.op, s.kw ? `${s.kw} kW` : 'výkon ?'].filter(Boolean).join(' ')].join(' · ');
    const place = [s.name, s.place, s.cc && s.cc !== 'CZ' ? s.cc : null].filter(Boolean).join(' – ');
    const badges = el('div', { class: 'badges' },
      st.note === 'mimo okno' ? el('span', { class: 'badge warn', text: 'mimo okno (v okně nic)' }) : null,
      st.note === 'objížďka' ? el('span', { class: 'badge warn', text: 'jen s objížďkou' }) : null,
      st.note === 'kvůli dojezdu' ? el('span', { class: 'badge warn', text: 'navíc, jinak by baterie nestačila' }) : null,
      favs.has(s.fuel) ? el('span', { class: 'badge fav', text: st.note === 'oblíbená mimo okno' ? '★ oblíbená, kousek mimo okno'
        : st.note === 'oblíbená objížďka' ? '★ oblíbená, malá objížďka' : '★ oblíbená pumpa' }) : null,
      s.fuel ? el('span', { class: 'badge', text: `u pumpy ${s.fd} m` }) : el('span', { class: 'badge warn', text: 'bez pumpy' }),
      el('span', { class: 'badge', text: st.c.n.dist < 300 ? 'přímo u trasy' : `${fmt(st.c.n.dist / 1000, 1)} km od trasy` }),
      s.ccs ? el('span', { class: 'badge', text: `${s.ccs}× CCS` }) : null,
      warn800(s) ? el('span', { class: 'badge warn', text: warn800(s) }) : null);
    const facts = el('dl', { class: 'facts' },
      el('dt', { text: 'Baterie' }), el('dd', { text: st.kwh > 0 ? `přijedeš s ~${fmt(st.arrive)} % → nabij na ${fmt(st.target)} %` : `přijedeš s ~${fmt(st.arrive)} %, nabíjet nemusíš (jen káva)` }),
      st.kwh > 0 ? el('dt', { text: 'Nabíjení' }) : null,
      st.kwh > 0 ? el('dd', { text: `~${fmt(st.chargeMin)} min · ${fmt(st.kwh, 1)} kWh` }) : null,
      el('dt', { text: 'Cena' }), el('dd', { text: priceText(st) }),
      st.pr && st.pr.others.length ? el('dt', { text: 'Jiné karty' }) : null,
      st.pr && st.pr.others.length ? el('dd', { class: 'small', text: st.pr.others.slice(0, 3)
        .map((p) => `${p.card} ${p.czk != null ? fmt(p.czk, 2) + ' Kč' : '(cena v appce)'}`).join(' · ') }) : null,
      el('dt', { text: 'Zastávka' }), el('dd', { text: `${fmt(st.stopMin)} min` }));
    const adv = advice(st);
    const alts = st.alts && st.alts.length ? el('details', { class: 'more-export' },
      el('summary', { text: `Jiné možnosti v tomhle okně (${st.alts.length})` }),
      el('div', { class: 'alts' }, st.alts.map((a) => {
        const at = new Date((st.leg === 'A' ? o.depart : lastRun.plan.retDepart).getTime() + measureT(a, st.leg, lastRun.rt) * 60000);
        const p = price(a.s, at);
        return el('div', { class: 'alt' },
          el('div', {}, el('b', { text: `${a.s.fuel || 'Stanice'} · ${a.s.op || '?'} ${a.s.kw ? a.s.kw + ' kW' : ''}` }),
            el('small', { class: 'muted', text: `za ${hm(measureT(a, st.leg, lastRun.rt))} · ${p && p.czk != null ? fmt(p.czk, 2) + ' Kč/kWh (' + p.card + ')' : p ? p.card : 'bez karty'}${a.n.dist >= 300 ? ` · ${fmt(a.n.dist / 1000, 1)} km od trasy` : ''}` })),
          el('button', { type: 'button', class: 'linkish', text: 'Vybrat', onclick: () => swapStop(idx, a) }));
      }))) : null;
    return el('article', { class: 'cand' },
      el('div', { class: 'cand-head' },
        el('div', {}, el('p', { class: 'eyebrow', text: `Zastávka ${k}${st.leg === 'B' ? ' · cesta zpět' : ''}` }),
          el('h3', { text: title }), place ? el('p', { class: 'small muted', text: place }) : null),
        el('div', { class: 'when' }, clock(st.at), el('small', { text: `po ${hm(st.tDrive)} jízdy · ${fmt(st.km)} km` }))),
      badges, facts,
      adv ? el('p', { class: `advice${adv.warn ? ' warn' : ''}`, text: adv.text }) : null,
      el('div', { class: 'cand-actions' },
        el('a', { class: 'waze', href: wazeUrl(s), target: '_blank', rel: 'noopener', text: 'Waze → sem' }),
        el('a', { href: gPlace(s), target: '_blank', rel: 'noopener', text: 'Google Mapy → sem' })),
      alts,
      el('button', { type: 'button', class: 'link-btn hide-btn', text: 'Tuhle nechci (už nenabízet)', onclick: () => hideStation(s) }));
  }

  function swapStop(idx, alt) {
    const { rt, o, plan } = lastRun;
    const st = plan.stops[idx];
    st.alts = [st.c, ...st.alts.filter((a) => a !== alt)];
    st.c = alt; st.note = null;
    plan.stops.sort((a, b) => tripX(a, rt) - tripX(b, rt));
    lastRun.plan = energize(rt, plan.stops, o);
    render();
    if (!$('map-wrap').hidden) drawMap();
  }

  function priceText(st) {
    const p = st.pr;
    if (!p) return 'žádná z vybraných karet tu nefunguje';
    if (p.czk == null) return `${p.card}: ${p.label}`;
    return `${st.kwh > 0 ? fmt(st.cost) + ' Kč · ' : ''}${fmt(p.czk, 2)} Kč/kWh (${p.card}${p.how !== 'vlastní síť' ? ', ' + p.how : ''}, ${p.label}${p.dayNight ? (p.night ? ', noční cena' : ', denní cena') : ''})` +
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
    if (st.arrive < 5) { parts.push('Sem dojedeš skoro na nulu, zkrať interval nebo zastav dřív.'); warn = true; }
    if (st.kwh > 0) {
      if (st.arrive >= 50) parts.push('Přijedeš nad 50 %, auto tu vezme nejvýš ~110–140 kW. Stačí 150kW stojan.');
      else parts.push('Přijedeš pod 50 %, ber nejrychlejší volný stojan.');
    }
    if (st.alt && st.alt.kind === 'cheaper') {
      parts.push(`Je-li tu i stojan E.ON do 200 kW, vezmi ten: ~${fmt(st.alt.min)} min místo ~${fmt(st.chargeMin)} min, o ${fmt(st.cost - st.alt.czk)} Kč levněji (${fmt(st.alt.unit, 2)} Kč/kWh).`);
    } else if (st.alt && st.alt.kind === 'faster' && st.chargeMin - st.alt.min > 1) {
      parts.push(`Na stojanu nad 200 kW by to bylo o ~${fmt(st.chargeMin - st.alt.min)} min rychlejší za ${fmt(st.alt.czk - st.cost)} Kč navíc.`);
    }
    if (st.kwh > 0 && st.pr && !/MB\.CHARGE/.test(st.pr.card) && st.c.s.op !== 'Tesla') parts.push(`Plať kartou ${st.pr.card} a vypni Plug & Charge, jinak to naúčtuje MB.CHARGE.`);
    if (st.kwh > 0 && st.pr && /Shell/.test(st.pr.card)) parts.push('Shell: zaplať kartou u stojanu (blokace 500 Kč). Když neprojde, je hned vedle často ČEZ.');
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
    return el('section', { class: 'card export' },
      el('h2', { text: 'Do navigace' }),
      el('div', { class: 'cand-actions' },
        el('a', { class: 'nav', href: gDir(pts[0], pts[pts.length - 1], there.map((x) => x.p)), target: '_blank', rel: 'noopener', text: 'Google Mapy: tam' }),
        o.roundTrip ? el('a', { class: 'nav', href: gDir(pts[pts.length - 1], pts[0], back.map((x) => x.p)), target: '_blank', rel: 'noopener', text: 'Google Mapy: zpět' }) : null),
      el('p', { class: 'small muted', text: 'Waze přes odkaz neumí víc zastávek najednou. Klepni na krok, po zastávce na další:' }),
      el('div', { class: 'cand-actions multi' }, waze),
      el('details', { class: 'more-export' }, el('summary', { text: 'Mercedes, GPX, sdílení' }),
        el('p', { class: 'small muted', text: 'Do Mercedesu: otevři trasu v Google Mapách, dej Sdílet → Mercedes-Benz → Odeslat do vozidla (Send2Car). Mercedes převezme cíl. Když nevezme mezizastávky, pošli si zastávky postupně tlačítkem „Google Mapy → sem“ u každé zastávky.' }),
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
    const lines = plan.stops.filter((s) => !s.empty).map((s, k) => `${k + 1}. ${clock(s.at)} ${s.c.s.fuel || ''} ${s.c.s.op || ''} ${s.c.s.kw ? s.c.s.kw + ' kW' : ''}: ${s.kwh > 0 ? `nabít ${fmt(s.arrive)} → ${fmt(s.target)} %` : 'jen káva'}`);
    const { there } = sequence();
    try { await navigator.share({ title: 'Trasa s nabíjením', text: lines.join('\n'), url: gDir(pts[0], pts[pts.length - 1], there.map((x) => x.p)) }); } catch (e) { /* cancelled */ }
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
    const line = L.polyline(lastRun.rt.line.map((p) => [p.lat, p.lon]), { color: '#0A7F6C', weight: 5, opacity: 0.8 }).addTo(layer);
    lastRun.pts.forEach((p, i) => L.circleMarker([p.lat, p.lon], { radius: 7, color: '#13201E', fillColor: i === lastRun.pts.length - 1 ? '#0A7F6C' : '#fff', fillOpacity: 1 })
      .bindTooltip(p.label || '').addTo(layer));
    let k = 0;
    lastRun.plan.stops.forEach((st) => {
      if (st.empty) return;
      k += 1;
      L.marker([st.c.s.lat, st.c.s.lon], { icon: L.divIcon({ className: 'pin', html: String(k), iconSize: [28, 28] }) })
        .bindPopup(`<b>${k}. ${xml(st.c.s.fuel || '')} ${xml(st.c.s.op || '')} ${st.c.s.kw ? st.c.s.kw + ' kW' : ''}</b><br>${clock(st.at)} · ${st.kwh > 0 ? 'nabít ' + fmt(st.arrive) + ' → ' + fmt(st.target) + ' %' : 'jen káva'}`)
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
  renderPlaces(); renderHidden(); renderStorageInfo();
  if (freshInstall) {
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
})();
