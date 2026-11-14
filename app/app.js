/* Nabíjecí plánovač – finds charging stops along a route for a CLA 350 4MATIC (800 V, 85 kWh).
   Data: data/*.json (built weekly by build/). Route: OSRM demo server. Place search: Photon (komoot). */
(() => {
  'use strict';

  // ------------------------------------------------------------------ constants & prefs
  const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  const PHOTON = 'https://photon.komoot.io/api/';
  const STOP_MIN = 12;           // coffee + párek + toilet (user rule)
  const RESERVE_PCT = 10;        // arrive home / at destination with at least this
  const MAX_TARGET = 90;         // don't plan charging above this in one stop
  const SOFT_MIN = 10;           // also show stops up to 10 min outside the window (marked)
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

  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (e) { prefs = {}; }
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ } };

  // ------------------------------------------------------------------ data
  let STATIONS = [], PRICES = null, CAL = null, META = null;
  const dataReady = Promise.all(['stations', 'prices', 'calibration', 'meta'].map((n) =>
    fetch(`data/${n}.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(n); return r.json(); })))
    .then(([st, pr, cal, meta]) => {
      STATIONS = st.rows.map((r) => Object.fromEntries(st.cols.map((c, i) => [c, r[i]])));
      PRICES = pr; CAL = cal; META = meta;
      renderDataInfo(); renderBrands();
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
  function price(op, kw, date) {
    const net = PRICES && PRICES.networks[op];
    if (!net) return null;
    const h = date.getHours(), [nFrom, nTo] = PRICES.night_hours;
    const night = h >= nFrom || h < nTo;
    const tier = net.tiers.find((t) => (kw || 0) <= t.max) || net.tiers[net.tiers.length - 1];
    return { czk: night ? tier.night : tier.day, label: tier.label, card: net.card, night, unknownKw: !kw && net.tiers.length > 1 };
  }

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
  const winFrom = $('win-from'), winTo = $('win-to');
  for (let m = 15; m <= 240; m += 5) { winFrom.append(el('option', { value: m, text: hm(m) })); winTo.append(el('option', { value: m, text: hm(m) })); }
  winFrom.value = String(prefs.winFrom || 45); winTo.value = String(prefs.winTo || 75);
  const pad = (n) => String(n).padStart(2, '0');
  const nowLocal = () => { const d = new Date(Date.now() + 5 * 60000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  $('depart').value = nowLocal();
  for (const id of ['en-route', 'at-pump', 'round-trip', 'only-fav', 'my-cards', 'unknown-kw']) if (prefs[id] != null) $(id).checked = prefs[id];
  if (prefs.minKw) $('min-kw').value = String(prefs.minKw);
  if (prefs.cons) $('cons').value = String(prefs.cons);
  if (prefs.tempo) $('tempo').value = String(prefs.tempo);
  let favs = new Set(prefs.favs || DEFAULT_FAVS);

  function renderBrands() {
    const counts = {};
    STATIONS.forEach((s) => { if (s.fuel && !GENERIC_BRANDS.has(s.fuel)) counts[s.fuel] = (counts[s.fuel] || 0) + 1; });
    const brands = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([b]) => b);
    favs.forEach((f) => { if (!brands.includes(f)) brands.unshift(f); });
    const box = $('brands'); box.textContent = '';
    brands.forEach((b) => box.append(el('button', {
      type: 'button', class: 'chip', 'aria-pressed': favs.has(b) ? 'true' : 'false',
      onclick: (e) => {
        if (favs.has(b)) favs.delete(b); else favs.add(b);
        e.currentTarget.setAttribute('aria-pressed', favs.has(b) ? 'true' : 'false');
        prefs.favs = [...favs]; savePrefs();
      },
    }, b, el('small', { text: counts[b] ? `${counts[b]}` : '' }))));
  }

  $('btn-settings').addEventListener('click', (e) => {
    const s = $('settings'); s.hidden = !s.hidden; e.currentTarget.setAttribute('aria-expanded', String(!s.hidden));
  });
  const renderHome = () => { $('home-label').textContent = prefs.home ? prefs.home.label : 'neuloženo'; };
  renderHome();
  $('home-from-start').addEventListener('click', () => {
    const p = places[0];
    if (!p.lat) { setStatus('Nejdřív vyber místo v poli Odkud.', true); return; }
    prefs.home = { label: p.label, lat: p.lat, lon: p.lon }; savePrefs(); renderHome(); setStatus('Domů uloženo v tomhle telefonu.');
  });

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
      if (dist < best.dist) best = { dist, t: rt.cumT[i] + u * (rt.cumT[i + 1] - rt.cumT[i]), d: rt.cumD[i] + u * (rt.cumD[i + 1] - rt.cumD[i]) };
    }
    return best;
  }

  // ------------------------------------------------------------------ search
  let lastRun = null;
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await dataReady;
    if (!STATIONS.length) return;
    const pts = places.filter((p) => p.lat != null);
    if (!places[0].lat || !places[places.length - 1].lat) { setStatus('Vyber místo v poli Odkud i Kam (ze seznamu, polohou nebo souřadnicemi).', true); return; }
    const opts = {
      depart: $('depart').value ? new Date($('depart').value) : new Date(),
      soc0: Math.max(5, Math.min(100, parseFloat($('soc0').value) || 100)),
      winFrom: +winFrom.value, winTo: Math.max(+winTo.value, +winFrom.value),
      enRoute: $('en-route').checked, atPump: $('at-pump').checked, roundTrip: $('round-trip').checked,
      onlyFav: $('only-fav').checked, myCards: $('my-cards').checked, unknownKw: $('unknown-kw').checked,
      minKw: +$('min-kw').value, cons: parseFloat(String($('cons').value).replace(',', '.')) || 23.8,
      tempo: parseFloat($('tempo').value) || 0.93,
    };
    prefs.tempo = opts.tempo;
    Object.assign(prefs, { places, winFrom: opts.winFrom, winTo: opts.winTo, 'en-route': opts.enRoute, 'at-pump': opts.atPump,
      'round-trip': opts.roundTrip, 'only-fav': opts.onlyFav, 'my-cards': opts.myCards, 'unknown-kw': opts.unknownKw,
      minKw: opts.minKw, cons: opts.cons, favs: [...favs] });
    savePrefs();

    setStatus('Počítám trasu…'); $('btn-go').disabled = true;
    let rt;
    try {
      rt = await route(pts);
      const f = opts.tempo;   // OSRM is ~7 % slower than Google Maps at the user's ~130 km/h
      rt.cumT = rt.cumT.map((t) => t * f); rt.duration *= f;
    } catch (err) {
      setStatus(`Trasu se nepodařilo spočítat (${err.message}). Zkus to za chvíli, nebo uprav místa.`, true);
      $('btn-go').disabled = false; return;
    }
    $('btn-go').disabled = false;
    const res = findStops(rt, pts, opts);
    lastRun = { rt, pts, opts, res };
    setStatus('');
    renderSummary(rt, opts, res);
    renderResults(res, opts, pts);
    $('btn-map').disabled = false;
    if (!$('map-wrap').hidden) drawMap();
    $('summary').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  function findStops(rt, pts, o) {
    const CAP = CAL.battery_kwh || 85;
    const corridor = o.enRoute ? 1500 : 10000;
    const totalKm = rt.distance / 1000, totalMin = rt.duration / 60;
    const lats = rt.line.map((p) => p.lat), lons = rt.line.map((p) => p.lon);
    const pad = corridor / 100000 + 0.02;
    const box = [Math.min(...lats) - pad, Math.max(...lats) + pad, Math.min(...lons) - pad * 1.5, Math.max(...lons) + pad * 1.5];
    const out = [];
    for (const s of STATIONS) {
      if (s.lat < box[0] || s.lat > box[1] || s.lon < box[2] || s.lon > box[3]) continue;
      if (o.atPump && !s.fuel) continue;
      if (o.onlyFav && !favs.has(s.fuel)) continue;
      if (o.myCards && !(PRICES.networks[s.op])) continue;
      if (s.kw == null ? !o.unknownKw : s.kw < o.minKw) continue;
      const n = nearestOnRoute(rt, s);
      if (n.dist > corridor) continue;
      const detourMin = (2 * n.dist / 1000) / 40 * 60;      // there and back at ~40 km/h
      const atMin = n.t / 60 + detourMin / 2;
      if (atMin < o.winFrom - SOFT_MIN || atMin > o.winTo + SOFT_MIN) continue;
      const c = evaluate(s, n, atMin, detourMin, totalKm, totalMin, CAP, o);
      c.outside = atMin < o.winFrom ? atMin - o.winFrom : atMin > o.winTo ? atMin - o.winTo : 0;
      out.push(c);
    }
    // dedupe: same operator within 150 m (OSM + operator data duplicates)
    out.sort((a, b) => (b.s.kw || 0) - (a.s.kw || 0));
    const kept = [];
    for (const c of out) if (!kept.some((k) => k.s.op === c.s.op && hav(k.s, c.s) < 150)) kept.push(c);
    kept.sort((a, b) => ((a.outside !== 0) - (b.outside !== 0)) || (b.fav - a.fav) || (b.fast - a.fast) || (a.cost - b.cost) || (a.atMin - b.atMin));
    return { cands: kept, totalKm, totalMin, inWindow: kept.filter((c) => c.outside === 0).length };
  }

  function evaluate(s, n, atMin, detourMin, totalKm, totalMin, CAP, o) {
    const kmAt = n.d / 1000;
    const arrive = Math.max(0, o.soc0 - kmAt * o.cons / CAP);
    const remainKm = (totalKm - kmAt) + (o.roundTrip ? totalKm : 0) + (2 * n.dist / 1000);
    const need = remainKm * o.cons / CAP + RESERVE_PCT;
    let target = Math.max(arrive, Math.min(need, MAX_TARGET));
    target = Math.round(target);
    const short = need > MAX_TARGET;
    const kw = s.kw || 150;
    const chargeMin = target > arrive ? chargeMinutes(arrive, target, kw) : 0;
    const kwh = Math.max(0, target - arrive) * (CAL.kwh_per_pct || 0.98);
    const at = new Date(o.depart.getTime() + atMin * 60000);
    const pr = price(s.op, s.kw, at);
    const cost = pr ? kwh * pr.czk : Infinity;
    const stopMin = Math.max(STOP_MIN, chargeMin + 2);
    const arriveDest = new Date(o.depart.getTime() + (totalMin + detourMin + stopMin) * 60000);
    const socDest = target - (totalKm - kmAt) * o.cons / CAP;
    const socHome = o.roundTrip ? socDest - totalKm * o.cons / CAP : null;
    // alternative stand per the user's tier rule
    let alt = null;
    if (s.op === 'E.ON' && kwh > 0) {
      if (s.kw && s.kw > 200 && arrive >= 50) {
        const p2 = price('E.ON', 150, at), m2 = chargeMinutes(arrive, target, 150);
        alt = { kind: 'cheaper', czk: kwh * p2.czk, min: m2, label: p2.label, unit: p2.czk };
      } else if (s.kw && s.kw <= 200 && arrive < 50) {
        const p3 = price('E.ON', 300, at), m3 = chargeMinutes(arrive, target, 300);
        alt = { kind: 'faster', czk: kwh * p3.czk, min: m3, label: p3.label, unit: p3.czk };
      }
    }
    return { s, n, atMin, at, detourMin, kmAt, arrive, target, need, short, chargeMin, kwh, pr, cost, stopMin,
      arriveDest, socDest, socHome, alt, fav: favs.has(s.fuel) ? 1 : 0, fast: (s.kw || 0) >= 150 ? 1 : 0 };
  }

  // ------------------------------------------------------------------ rendering
  function renderSummary(rt, o, res) {
    const CAP = CAL.battery_kwh || 85;
    const destNo = o.soc0 - res.totalKm * o.cons / CAP;
    const homeNo = destNo - res.totalKm * o.cons / CAP;
    const box = $('summary'); box.textContent = '';
    box.className = 'summary';
    box.append(
      el('div', { class: 'stat' }, el('b', { text: `${fmt(res.totalKm)} km` }), el('span', { text: 'trasa tam' })),
      el('div', { class: 'stat' }, el('b', { text: hm(res.totalMin) }), el('span', { text: 'jízda tam (bez zastávek)' })),
      el('div', { class: 'stat' }, el('b', { text: `${fmt(Math.max(destNo, -99))} %` }), el('span', { text: 'v cíli bez nabíjení' })),
      el('p', { class: 'summary-note', text:
        (o.roundTrip ? (homeNo >= RESERVE_PCT ? `Tam i zpět dojedeš bez nabíjení (domů s ~${fmt(homeNo)} %). Zastávka je jen na kávu a dotlačení kWh.`
          : `Bez nabíjení bys domů dojel s ${fmt(homeNo)} %. Potřebuješ dobít asi ${fmt(RESERVE_PCT - homeNo)} % baterie.`)
          : (destNo >= RESERVE_PCT ? 'Do cíle dojedeš i bez nabíjení.' : `Do cíle potřebuješ dobít asi ${fmt(RESERVE_PCT - destNo)} %.`)) +
        ` Okno zastávky ${hm(o.winFrom)}–${hm(o.winTo)}: ${res.inWindow} v okně` +
        (res.cands.length > res.inWindow ? `, ${res.cands.length - res.inWindow} do ${SOFT_MIN} min mimo.` : '.') }),
    );
  }

  function navUrl(c, pts) {
    const origin = pts[0], dest = pts[pts.length - 1];
    const vias = pts.slice(1, -1).map((p) => ({ p, t: nearestOnRoute(lastRun.rt, p).t }));
    vias.push({ p: c.s, t: c.n.t });
    vias.sort((a, b) => a.t - b.t);
    const q = new URLSearchParams({ api: '1', origin: ll(origin), destination: ll(dest), travelmode: 'driving',
      waypoints: vias.map((v) => ll(v.p)).join('|') });
    return `https://www.google.com/maps/dir/?${q}`;
  }

  function renderResults(res, o, pts) {
    const box = $('results'); box.textContent = '';
    if (!res.cands.length) {
      box.append(el('div', { class: 'status err', text: 'V tomhle okně nic nevyhovuje. Zkus rozšířit čas zastávky, vypnout „Jen na pumpách“ nebo „Ukázat jen oblíbené“, snížit min. výkon, případně zapnout stanice bez známého výkonu.' }));
      return;
    }
    const show = (list) => list.forEach((c, i) => box.append(card(c, i, pts)));
    show(res.cands.slice(0, 6));
    if (res.cands.length > 6) {
      const more = el('button', { type: 'button', class: 'btn ghost more-results', text: `Ukázat další (${res.cands.length - 6})`,
        onclick: () => { more.remove(); show(res.cands.slice(6)); } });
      box.append(more);
    }
  }

  function card(c, i, pts) {
    const s = c.s;
    const title = [s.fuel || 'Stanice', [s.op, s.kw ? `${s.kw} kW` : 'výkon ?'].filter(Boolean).join(' ')].join(' · ');
    const badges = el('div', { class: 'badges' },
      c.outside ? el('span', { class: 'badge warn', text: c.outside > 0 ? `o ${fmt(c.outside)} min po okně` : `o ${fmt(-c.outside)} min před oknem` }) : null,
      c.fav ? el('span', { class: 'badge fav', text: '★ oblíbená pumpa' }) : null,
      s.fuel ? el('span', { class: 'badge', text: `u pumpy ${s.fd} m` }) : el('span', { class: 'badge warn', text: 'bez pumpy' }),
      el('span', { class: 'badge', text: c.n.dist < 300 ? 'přímo u trasy' : `${fmt(c.n.dist / 1000, 1)} km od trasy` }),
      s.ccs ? el('span', { class: 'badge', text: `${s.ccs}× CCS` }) : null,
      warn800(s) ? el('span', { class: 'badge warn', text: warn800(s) }) : null,
    );
    const facts = el('dl', { class: 'facts' },
      el('dt', { text: 'Baterie' }), el('dd', { text: c.kwh > 0 ? `přijedeš s ~${fmt(c.arrive)} % → nabij na ${fmt(c.target)} %` : `přijedeš s ~${fmt(c.arrive)} %, nabíjet nemusíš` }),
      c.kwh > 0 ? el('dt', { text: 'Nabíjení' }) : null,
      c.kwh > 0 ? el('dd', { text: `~${fmt(c.chargeMin)} min · ${fmt(c.kwh, 1)} kWh` }) : null,
      el('dt', { text: 'Cena' }),
      el('dd', { text: c.pr ? `${c.kwh > 0 ? fmt(c.cost) + ' Kč · ' : ''}${fmt(c.pr.czk, 2)} Kč/kWh (${c.pr.card}, ${c.pr.label}${c.pr.night ? ', noc' : ''})${c.pr.unknownKw ? ' – pásmo podle skutečného výkonu' : ''}` : 'bez vlastní karty (MB.CHARGE / ad hoc)' }),
      el('dt', { text: 'Zastávka' }), el('dd', { text: `${fmt(c.stopMin)} min · v cíli ${clock(c.arriveDest)}` }),
      el('dt', { text: c.socHome != null ? 'Dojezd' : 'V cíli' }),
      el('dd', { text: c.socHome != null ? `v cíli ~${fmt(c.socDest)} %, domů ~${fmt(c.socHome)} %` : `~${fmt(c.socDest)} %` }),
    );
    const adv = advice(c);
    const place = [s.name, s.place].filter(Boolean).join(' – ');
    return el('article', { class: `cand${i === 0 ? ' best' : ''}` },
      el('div', { class: 'cand-head' },
        el('div', {}, el('h3', { text: `${i + 1}. ${title}` }), place ? el('p', { class: 'small muted', text: place }) : null),
        el('div', { class: 'when' }, `za ${hm(c.atMin)}`, el('small', { text: `${clock(c.at)} · ${fmt(c.kmAt)} km` }))),
      badges, facts,
      adv ? el('p', { class: `advice${adv.warn ? ' warn' : ''}`, text: adv.text }) : null,
      el('div', { class: 'cand-actions' },
        el('a', { class: 'nav', href: navUrl(c, pts), target: '_blank', rel: 'noopener', text: 'Navigovat přes zastávku' }),
        el('a', { href: `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`, target: '_blank', rel: 'noopener', text: 'Místo v Mapách' })),
    );
  }

  function warn800(s) {
    if (s.op === 'Tesla') return 'Tesla: ověř 800 V';
    if (s.kw && s.kw < 150) return 'pod 150 kW: ověř 800 V';
    if (!s.kw) return 'výkon neznámý';
    return null;
  }

  function advice(c) {
    const parts = [];
    let warn = false;
    if (c.short) { parts.push(`Na jedno nabití to nevyjde (potřeba ~${fmt(c.need)} %). Nabij na ${fmt(c.target)} % a počítej s další zastávkou, nejlépe na zpáteční cestě.`); warn = true; }
    if (c.kwh > 0) {
      if (c.arrive >= 50) parts.push('Přijedeš nad 50 %, auto tu vezme nejvýš ~110–140 kW. Stačí 150kW stojan.');
      else parts.push('Přijedeš pod 50 %, ber nejrychlejší volný stojan.');
    }
    if (c.alt && c.alt.kind === 'cheaper') {
      parts.push(`Je-li tu i stojan E.ON do 200 kW, vezmi ten: ~${fmt(c.alt.min)} min místo ~${fmt(c.chargeMin)} min, o ${fmt(c.cost - c.alt.czk)} Kč levněji (${fmt(c.alt.unit, 2)} Kč/kWh).`);
    } else if (c.alt && c.alt.kind === 'faster' && c.chargeMin - c.alt.min > 1) {
      parts.push(`Na stojanu nad 200 kW by to bylo o ~${fmt(c.chargeMin - c.alt.min)} min rychlejší za ${fmt(c.alt.czk - c.cost)} Kč navíc.`);
    }
    if (c.s.op && c.s.op !== 'Tesla' && PRICES.networks[c.s.op]) parts.push('Vypni Plug & Charge, jinak to naúčtuje MB.CHARGE.');
    if (c.pr && c.pr.card === 'platební karta u stojanu') parts.push('Shell: zaplať kartou u stojanu (blokace 500 Kč). Když neprojde, je hned vedle často ČEZ.');
    return parts.length ? { text: parts.join(' '), warn } : null;
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
    lastRun.res.cands.forEach((c, i) => L.marker([c.s.lat, c.s.lon], { icon: L.divIcon({ className: 'pin', html: String(i + 1), iconSize: [28, 28] }) })
      .bindPopup(`<b>${i + 1}. ${(c.s.fuel || '')} ${c.s.op || ''} ${c.s.kw ? c.s.kw + ' kW' : ''}</b><br>za ${hm(c.atMin)} · ${c.pr ? fmt(c.pr.czk, 2) + ' Kč/kWh' : ''}`)
      .addTo(layer));
    setTimeout(() => { map.invalidateSize(); map.fitBounds(line.getBounds(), { padding: [24, 24] }); }, 60);
  }
  $('btn-map').addEventListener('click', async () => {
    const w = $('map-wrap'); w.hidden = !w.hidden;
    $('btn-map').textContent = w.hidden ? 'Mapa' : 'Seznam';
    if (!w.hidden) { await drawMap(); w.scrollIntoView({ behavior: 'smooth' }); } else $('results').scrollIntoView({ behavior: 'smooth' });
  });

  // ------------------------------------------------------------------ boot
  renderPlaces();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
