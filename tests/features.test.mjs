// Every feature the user asked for, one test (or more) each. These tests define the app's behaviour:
// never change them to make code pass — only a new specification from the user changes them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, options, plan, ROUTES } from './harness.mjs';

const praha = [{ role: 'from', ...ROUTES['ostrava-praha'].from }, { role: 'to', ...ROUTES['ostrava-praha'].to }];
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ') : '');
const tick = () => new Promise((r) => setTimeout(r, 50));

async function search(prefs = {}, { soc0, depart = '2026-11-16T08:00', storage } = {}) {
  const loaded = await loadApp({ prefs: { places: praha, favs: ['MOL', 'ORLEN'], ...prefs }, storage });
  const { w } = loaded, d = w.document;
  d.getElementById('depart').value = depart;
  if (soc0 != null) d.getElementById('soc0').value = String(soc0);
  d.getElementById('form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  for (let i = 0; i < 100 && !d.querySelector('#results .timeline'); i++) await tick();
  assert.ok(d.querySelector('#results .timeline'), 'po hledání se ukáže časová osa');
  return { ...loaded, d };
}
const button = (root, re) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent));

// ---------------------------------------------------------------- choosing the station inside a window
function cand(kw, op, fuel, tMin) {
  return { s: { kw, op, fuel, lat: 49.5, lon: 16.5, cc: 'CZ', name: `${op} ${kw}`, place: 'Test' },
    n: { dist: 100, t: tMin * 60, d: tMin * 1000, fast: false, right: true }, detourMin: 0, detourKm: 0 };
}
const rtSyn = { distance: 300000, duration: 3 * 3600 };

test('stojan: přijedeš s ≥ 50 % → stačí 150 kW, vyhraje levnější pásmo (E.ON 101–200 kW)', async () => {
  const { api } = await loadApp();
  api.setFavs([]);
  const o = options({ depart: new Date('2026-11-16T10:00:00') });
  const pool = [{ c: cand(400, 'E.ON', 'OMV', 60), tier: 2 }, { c: cand(150, 'E.ON', 'OMV', 61), tier: 2 }];
  api.rankWindow(pool, 'A', rtSyn, o, 60, () => ({ arrive: 60, add: 20 }));
  assert.equal(pool[0].c.s.kw, 150);
});

test('stojan: přijedeš pod 50 % → nejrychlejší, když ušetří víc než 2 min', async () => {
  const { api } = await loadApp();
  api.setFavs([]);
  const o = options({ depart: new Date('2026-11-16T10:00:00') });
  const pool = [{ c: cand(150, 'E.ON', 'OMV', 60), tier: 2 }, { c: cand(400, 'E.ON', 'OMV', 61), tier: 2 }];
  api.rankWindow(pool, 'A', rtSyn, o, 60, () => ({ arrive: 15, add: 50 }));
  assert.equal(pool[0].c.s.kw, 400);
});

test('stojan: pod 50 %, rozdíl do 2 min → rozhodne cena', async () => {
  const { api } = await loadApp();
  api.setFavs([]);
  const o = options({ depart: new Date('2026-11-16T10:00:00') });
  const pool = [{ c: cand(300, 'E.ON', 'OMV', 60), tier: 2 }, { c: cand(200, 'E.ON', 'OMV', 61), tier: 2 }];
  api.rankWindow(pool, 'A', rtSyn, o, 60, () => ({ arrive: 45, add: 15 }));
  assert.equal(pool[0].c.s.kw, 200);
});

test('oblíbená pumpa v okně má přednost před neoblíbenou', async () => {
  const { api } = await loadApp();
  api.setFavs(['MOL']);
  const o = options({ depart: new Date('2026-11-16T10:00:00') });
  const pool = [{ c: cand(400, 'E.ON', 'OMV', 60), tier: 2 }, { c: cand(150, 'E.ON', 'MOL', 70), tier: 0 }];
  api.rankWindow(pool, 'A', rtSyn, o, 60, () => ({ arrive: 15, add: 50 }));
  assert.equal(pool[0].c.s.fuel, 'MOL');
});

// ---------------------------------------------------------------- how much to charge
function stopAt(xKm, D) {
  return { leg: 'A', c: { s: { kw: 300, op: 'E.ON', fuel: 'MOL', lat: 49.5, lon: 16.5, cc: 'CZ', name: 'E.ON', place: 'Test' },
    n: { dist: 0, d: xKm * 1000, t: xKm / D * 36000 }, detourKm: 0, detourMin: 0 } };
}
async function charge(xKm, D) {          // cons 8,5 kWh/100 km on 85 kWh = 1 % per 10 km, reserve 10 %
  const { api } = await loadApp();
  const o = options({ cons: 8.5, reserve: 10, soc0: 100 });
  return api.energize({ distance: D * 1000, duration: 36000 }, [stopAt(xKm, D)], o).stops[0];
}

test('nabíjení: když už nabíjíš, tak aspoň o 8 % (30 % → 38 %, potřeba 34 %)', async () => {
  const st = await charge(700, 940);
  assert.equal(Math.round(st.arrive), 30); assert.equal(st.target, 38);
});
test('nabíjení: minimum 8 % nikdy nad 80 % (72 % → 80 %, ne 82 %)', async () => {
  const st = await charge(280, 960);
  assert.equal(Math.round(st.arrive), 72); assert.equal(st.target, 80);
});
test('nabíjení: chybí ≤ 2 % → jen káva, nenabíjí se (85 %, potřeba 87 %)', async () => {
  const st = await charge(150, 920);
  assert.equal(st.target, st.arrive); assert.equal(st.kwh, 0);
});
test('nabíjení: nad 80 % jen když to další úsek opravdu potřebuje (74 % → 86 %)', async () => {
  const st = await charge(260, 1020);
  assert.equal(Math.round(st.arrive), 74); assert.equal(st.target, 86);
});

// ---------------------------------------------------------------- stops in time
test('přestávky: první zastávka dne 10 min, každá další 5 min', async () => {
  const { api } = await loadApp();
  api.setFavs(['MOL', 'ORLEN']);
  const { plan: p } = await plan(api, 'ostrava-praha', options({ roundTrip: true }));
  const real = p.stops.filter((s) => !s.empty);
  assert.ok(real.length >= 2);
  assert.equal(real[0].breakMin, api.BREAK_FIRST); assert.equal(api.BREAK_FIRST, 10);
  for (const s of real.slice(1)) assert.equal(s.breakMin, 5);
  for (const s of real) assert.ok(s.stopMin >= s.breakMin);
});

test('cesta zpět nezačne dřív, než dojedeš do cíle (a appka to řekne)', async () => {
  const { api } = await loadApp();
  const o = options({ roundTrip: true, depart: new Date('2026-11-16T08:00:00'), retDepart: new Date('2026-11-16T09:00:00') });
  const { plan: p } = await plan(api, 'ostrava-praha', o);
  assert.ok(p.retLate);
  assert.ok(p.retDepart >= p.arriveDest);
  for (const s of p.stops.filter((x) => !x.empty && x.leg === 'B')) assert.ok(s.at >= p.arriveDest);
});

// ---------------------------------------------------------------- filters
test('filtry: jen u pumpy, min. výkon, jen sítě s mými kartami', async () => {
  const { api } = await loadApp();
  const o = options({ atPump: true, minKw: 150, myCards: true });
  const { cands } = await plan(api, 'ostrava-praha', o);
  assert.ok(cands.length > 0);
  for (const c of cands) {
    assert.ok(c.s.fuel, 'u pumpy'); assert.ok(c.s.kw >= 150, 'výkon');
    assert.ok(api.price(c.s, o.depart), 'zaplatím vybranou kartou');
  }
});

// ---------------------------------------------------------------- "Tuhle nechci"
test('Tuhle nechci: stanice (i její dvojče do 150 m) se už nenabídne a pamatuje se', async () => {
  const { w, d, api } = await search({ stopBy: 'time', intTime: 60, tolTime: 15, 'round-trip': false });
  const first = d.querySelector('.stop-card');
  const s0 = api.lastRun().plan.stops.find((s) => !s.empty).c.s;
  button(first, /Tuhle nechci/).click();
  const hidden = JSON.parse(w.localStorage.getItem('np.prefs.v1')).hidden || [];
  assert.ok(hidden.some((h) => Math.abs(h.lat - s0.lat) < 1e-4 && Math.abs(h.lon - s0.lon) < 1e-4), 'uloženo v nastavení');
  const near = (s) => Math.hypot((s.lat - s0.lat) * 111000, (s.lon - s0.lon) * 72000) < 150;
  assert.ok(!api.lastRun().cands.some((c) => near(c.s)), 'mezi kandidáty už není');
  assert.ok(!api.lastRun().plan.stops.some((s) => !s.empty && near(s.c.s)), 'v plánu už není');
});

// ---------------------------------------------------------------- car charge limit
test('limit v autě: vyjíždíš pod limitem a zastávka nabíjí nad něj → připomene zvednout limit', async () => {
  const { d } = await search({ carLimit: 50, stopBy: 'time', intTime: 120, tolTime: 15, 'round-trip': true }, { soc0: 50 });
  assert.ok([...d.querySelectorAll('.stop-card .advice')].some((a) => /limit v autě je 50 %/.test(text(a))));
});
test('limit v autě: vyjíždíš se 100 % (limit jsi zvedl) → nepřipomíná', async () => {
  const { d } = await search({ carLimit: 50, stopBy: 'time', intTime: 120, tolTime: 15, 'round-trip': true }, { soc0: 100 });
  assert.ok(![...d.querySelectorAll('.stop-card .advice')].some((a) => /limit v autě/.test(text(a))));
});
test('baterie na startu je výchozí 100 % (před dlouhou cestou nabíjíš na 100)', async () => {
  const { d } = await loadApp({ prefs: { carLimit: 80 } }).then(({ w }) => ({ d: w.document }));
  assert.equal(d.getElementById('soc0').value, '100');
});

// ---------------------------------------------------------------- summary
test('souhrn: baterie podle plánu „v cíli → doma“ u cesty tam a zpět', async () => {
  const { d } = await search({ 'round-trip': true });
  const s = text(d.querySelector('.battery-strip'));
  assert.match(s, /→/); assert.match(s, /doma/);
});

// ---------------------------------------------------------------- Moje cesty
test('uložit cestu: je v Moje cesty i v telefonu (localStorage)', async () => {
  const { w, d } = await search({ 'round-trip': true });
  button(d.querySelector('.card.trip'), /Uložit cestu/).click();
  const trips = JSON.parse(w.localStorage.getItem('np.trips.v1'));
  assert.equal(trips.length, 1);
  assert.equal(trips[0].stops.length, d.querySelectorAll('.stop-card').length);
  assert.match(text(d.getElementById('trips-list')), /Ostrava → Praha/);
});

test('poslat do mobilu: odkaz otevře stejnou cestu se stejnými zastávkami', async () => {
  const { api } = await search({ 'round-trip': true });
  const t = api.curTrip();
  const url = api.tripLink(t).replace(/^.*#/, 'https://planovac.test/#');
  const other = await loadApp({ url });
  const d2 = other.w.document;
  for (let i = 0; i < 100 && !d2.querySelector('#results .timeline'); i++) await tick();
  const t2 = other.api.curTrip();
  // compared as JSON: objects from the app (jsdom window) and from the test (Node) never pass a strict deepEqual
  assert.equal(JSON.stringify(t2.input.places.map((p) => p.label)), JSON.stringify(['Ostrava', 'Praha']));
  assert.equal(JSON.stringify(t2.stops.map((s) => [s.leg, s.lat, s.lon])), JSON.stringify(t.stops.map((s) => [s.leg, s.lat, s.lon])));
});

test('zápis nabíjení: skutečnost se uloží a zbytek plánu se přepočítá', async () => {
  const { w, d, api } = await search({ stopBy: 'time', intTime: 60, tolTime: 15, 'round-trip': true });
  const p0 = api.lastRun().plan.stops.filter((s) => !s.empty);
  const i = p0.findIndex((s) => s.kwh > 0 && p0[p0.indexOf(s) + 1]);
  assert.ok(i >= 0, 'v plánu je nabíjecí zastávka s další zastávkou za ní');
  const nextBefore = p0[i + 1].arrive, lower = p0[i].target - 10;
  const card = d.querySelectorAll('.stop-card')[i];
  const inputs = card.querySelectorAll('.actual-form .grid2 input');
  inputs[0].value = String(Math.round(p0[i].arrive)); inputs[1].value = String(lower);
  button(card, /Uložit a přepočítat/).click();
  const p1 = api.lastRun().plan.stops.filter((s) => !s.empty);
  assert.equal(p1[i].target, lower);
  assert.ok(Math.abs(p1[i + 1].arrive - (nextBefore - 10)) <= 1.5, `další zastávka: ${p1[i + 1].arrive} vs ${nextBefore - 10}`);
  assert.match(text(d.querySelectorAll('.stop-card')[i]), /Skutečnost/);
  assert.ok(Object.keys(JSON.parse(w.localStorage.getItem('np.trips.v1'))[0].actual).length === 1, 'zápis je uložený v cestě');
});

test('dokončit cestu + srovnání: elektro = veřejné nabíjení + dobití doma, auta = km × spotřeba × cena', async () => {
  const { d, api } = await search({ 'round-trip': false });
  const fin = d.querySelector('.card.finish');
  const [soc, km] = fin.querySelectorAll('input');
  soc.value = '30'; km.value = '400';
  button(fin, /Dokončit a uložit/).click();
  assert.equal(api.curTrip().status, 'done');
  const { o, plan: p } = api.lastRun();
  const r = api.comparison(o, p);
  assert.equal(r.km, 400);
  assert.ok(Math.abs(r.homeCzk - (100 - 30) / 100 * 85 / 0.9 * 6.61) < 0.01);
  assert.ok(Math.abs(r.ev - (r.pubCzk + r.homeCzk)) < 0.01);
  const volvo = r.cars.find((c) => /Volvo/.test(c.name));
  assert.ok(Math.abs(volvo.czk - 400 * 5 / 100 * 47.99) < 0.01);
  assert.match(text(d.querySelector('.card.compare')), /400 km/);
});

test('jedu jinudy: zbytek se přeplánuje z cíle, odjetá část zůstane v cestě a ve srovnání', async () => {
  const { w, d, api } = await search({ 'round-trip': true });
  button(d.querySelector('.card.trip'), /Uložit cestu/).click();
  button(d.querySelector('.card.trip'), /Jedu jinudy/).click();
  const vals = [...d.querySelectorAll('.place input')].map((i) => i.value);
  assert.equal(vals[0], 'Praha'); assert.equal(vals[vals.length - 1], 'Ostrava');
  assert.equal(d.getElementById('round-trip').checked, false);
  assert.match(text(d.getElementById('soc0').closest('label')), /Baterie teď/);
  d.getElementById('form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  for (let i = 0; i < 100 && !(api.curTrip().history || []).length; i++) await tick();
  for (let i = 0; i < 40; i++) await tick();
  const t = api.curTrip();
  assert.equal(t.history.length, 1);
  assert.ok(Math.abs(t.history[0].km - 370) <= 5, `odjeto ${t.history[0].km} km`);
  const { o, plan: p } = api.lastRun();
  assert.ok(Math.abs(api.comparison(o, p).km - (t.history[0].km + p.D)) < 1);
  assert.match(text(d.querySelector('.card.trip')), /Už odjeto/);
});

// ---------------------------------------------------------------- settings
test('oblíbené pumpy: klepnutí v nastavení se uloží', async () => {
  const { w } = await loadApp({ prefs: { favs: ['MOL'] } });
  const chip = [...w.document.querySelectorAll('#brands .chip')].find((c) => /^ORLEN/.test(c.textContent));
  chip.click();
  assert.ok(JSON.parse(w.localStorage.getItem('np.prefs.v1')).favs.includes('ORLEN'));
});
test('záloha: poškozené nastavení se při načtení vyčistí, appka nespadne', async () => {
  const { api } = await loadApp();
  const p = api.sanitizePrefs({ hidden: 'x', places: [1], favs: [1, 'MOL'], home: { lat: 'a' } });
  assert.deepEqual(p, { favs: ['MOL'] });
});
