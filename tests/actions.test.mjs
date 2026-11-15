// Every action a user can do in the app, and what it must do. Binding: change only with a new specification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, search, submit, wait, ROUTES } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const btn = (root, re) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent));
const prefsOf = (w) => JSON.parse(w.localStorage.getItem('np.prefs.v1') || '{}');
const change = (w, el, value) => { if (value !== undefined) { if (el.type === 'checkbox' || el.type === 'radio') el.checked = value; else el.value = value; } el.dispatchEvent(new w.Event('change')); };
const input = (w, el, value) => { el.value = value; el.dispatchEvent(new w.Event('input')); };
const mobile = (w) => { w.matchMedia = (q) => ({ matches: /max-width/.test(q), addEventListener() {}, removeEventListener() {} }); };
const praha = [{ role: 'from', ...ROUTES['ostrava-praha'].from }, { role: 'to', ...ROUTES['ostrava-praha'].to }];

// ---------------------------------------------------------------- menu ☰ (Moje nastavení)
test('[R20] ☰ v mobilu otevře panel, ✕ ho zavře', async () => {
  const { w } = await loadApp({ setup: mobile }), d = w.document;
  d.getElementById('btn-menu').click();
  assert.ok(d.getElementById('prefs').classList.contains('open')); assert.equal(d.getElementById('scrim').hidden, false);
  assert.equal(d.getElementById('btn-menu').getAttribute('aria-expanded'), 'true');
  d.getElementById('btn-menu-close').click();
  assert.ok(!d.getElementById('prefs').classList.contains('open')); assert.equal(d.getElementById('scrim').hidden, true);
});
test('[R20] ☰ panel zavře i Escape a klepnutí vedle', async () => {
  const { w } = await loadApp({ setup: mobile }), d = w.document;
  d.getElementById('btn-menu').click();
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.ok(!d.getElementById('prefs').classList.contains('open'));
  d.getElementById('btn-menu').click();
  d.getElementById('scrim').click();
  assert.ok(!d.getElementById('prefs').classList.contains('open'));
});
test('[R20] řádek „Moje nastavení“ ve formuláři otevře panel a ukazuje oblíbené a karty', async () => {
  const { w } = await loadApp({ prefs: { favs: ['MOL', 'ORLEN'] }, setup: mobile }), d = w.document;
  assert.match(text(d.getElementById('peek-text')), /MOL, ORLEN/); assert.match(text(d.getElementById('peek-text')), /kar/);
  d.getElementById('prefs-peek').click();
  assert.ok(d.getElementById('prefs').classList.contains('open'));
});

// ---------------------------------------------------------------- form: places
test('[R1] + Přidat místo přidá „Přes“, ✕ ho odebere, ↑ posune výš', async () => {
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  d.getElementById('add-via').click(); d.getElementById('add-via').click();
  let rows = d.querySelectorAll('.place');
  assert.equal(rows.length, 4);
  assert.match(text(rows[1].querySelector('.place-label')), /Přes/);
  input(w, rows[1].querySelector('input'), 'A'); input(w, rows[2].querySelector('input'), 'B');
  rows[2].querySelector('.up').click();
  rows = d.querySelectorAll('.place');
  assert.equal(rows[1].querySelector('input').value, 'B'); assert.equal(rows[2].querySelector('input').value, 'A');
  rows[1].querySelector('.del').click();
  assert.equal(d.querySelectorAll('.place').length, 3);
});
test('[R1] GPS souřadnice napsané do pole se rovnou použijí', async () => {
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  const kam = d.querySelectorAll('.place')[1];
  input(w, kam.querySelector('input'), '49.1951, 16.6068');
  assert.match(text(kam.querySelector('.picked')), /49\.19510, 16\.60680/);
});
test('[R1] hledání místa: našeptávač nabídne místo, klepnutí ho vybere', async () => {
  const setup = (w) => {
    const orig = w.fetch;
    w.fetch = async (url) => (String(url).includes('photon.komoot.io')
      ? { ok: true, json: async () => ({ features: [{ properties: { name: 'Brno', city: 'Brno', countrycode: 'CZ', county: 'Jihomoravský kraj' }, geometry: { coordinates: [16.6068, 49.1951] } }] }) }
      : orig(url));
  };
  const { w } = await loadApp({ prefs: { places: praha }, setup }), d = w.document;
  const kam = d.querySelectorAll('.place')[1];
  input(w, kam.querySelector('input'), 'Brno');
  await wait(450);
  const li = kam.querySelector('.suggest li');
  assert.ok(li, 'našeptávač ukáže návrh'); assert.match(text(li), /Brno/);
  li.click();
  assert.equal(kam.querySelector('input').value, 'Brno'); assert.match(text(kam.querySelector('.picked')), /49\.19510, 16\.60680/);
});
test('[R1] ◎ vezme moji polohu', async () => {
  const setup = (w) => Object.defineProperty(w.navigator, 'geolocation', { configurable: true,
    value: { getCurrentPosition: (ok) => ok({ coords: { latitude: 49.7, longitude: 18.1 } }) } });
  const { w } = await loadApp({ prefs: { places: praha }, setup }), d = w.document;
  d.querySelectorAll('.place')[0].querySelector('.gps').click();
  assert.match(d.querySelectorAll('.place')[0].querySelector('input').value, /Moje poloha \(49\.7000, 18\.1000\)/);
});
test('[R1] ⌂ bez uloženého domova řekne, kde ho nastavit (☰)', async () => {
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  d.querySelectorAll('.place')[1].querySelector('.home').click();
  assert.match(text(d.getElementById('status')), /Domů zatím není uložené/);
  assert.match(text(d.getElementById('status')), /☰/);
});
test('[R21] Uložit „Odkud“ jako Domů, pak ⌂ vyplní domov', async () => {
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  d.getElementById('home-from-start').click();
  assert.equal(prefsOf(w).home.label, 'Ostrava'); assert.equal(text(d.getElementById('home-label')), 'Ostrava');
  d.querySelectorAll('.place')[1].querySelector('.home').click();
  assert.equal(d.querySelectorAll('.place')[1].querySelector('input').value, 'Ostrava');
});

// ---------------------------------------------------------------- form: other inputs
test('[R2] přepínač Po kilometrech ukáže km a nápovědu v km, Po čase jízdy čas', async () => {
  const { w } = await loadApp({ prefs: { intKm: 100, tolKm: 20 } }), d = w.document;
  change(w, d.getElementById('by-km'), true);
  assert.equal(d.getElementById('row-km').hidden, false); assert.equal(d.getElementById('row-time').hidden, true);
  assert.match(d.getElementById('win-hint').textContent, /80 km–120 km/);
  change(w, d.getElementById('by-time'), true);
  assert.equal(d.getElementById('row-km').hidden, true); assert.equal(d.getElementById('row-time').hidden, false);
});
test('[R10] Počítat i cestu zpět: vypnuté schová „Zpátky vyrážím v“', async () => {
  const { w } = await loadApp(), d = w.document;
  change(w, d.getElementById('round-trip'), false);
  assert.equal(d.getElementById('ret-field').hidden, true);
  change(w, d.getElementById('round-trip'), true);
  assert.equal(d.getElementById('ret-field').hidden, false);
});
test('[R1] Najít zastávky bez cíle řekne, co chybí', async () => {
  const { w } = await loadApp({ prefs: { places: [praha[0], { role: 'to' }] } }), d = w.document;
  d.getElementById('form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await wait(50);
  assert.match(text(d.getElementById('status')), /Vyber místo v poli Odkud i Kam/);
  assert.equal(d.querySelector('#results .timeline'), null);
});
test('[R1] Najít zastávky: formulář se sbalí do řádku s cestou, Upravit ho otevře', async () => {
  const { d } = await search({ 'round-trip': true });
  assert.equal(d.getElementById('form').hidden, true); assert.equal(d.getElementById('trip-chip').hidden, false);
  assert.match(text(d.getElementById('trip-chip')), /Ostrava → Praha a zpět/);
  assert.equal(d.getElementById('btn-go').hidden, true); assert.equal(d.getElementById('btn-nav').hidden, false);
  d.getElementById('trip-chip').click();
  assert.equal(d.getElementById('form').hidden, false); assert.equal(d.getElementById('btn-go').hidden, false);
});

// ---------------------------------------------------------------- results
test('[R30] Mapa ukáže mapu a tlačítko se změní na Seznam (a zpět)', async () => {
  const { d } = await search();
  d.getElementById('btn-map').click();
  assert.equal(d.getElementById('map-wrap').hidden, false); assert.equal(text(d.getElementById('btn-map')), 'Seznam');
  d.getElementById('btn-map').click();
  assert.equal(d.getElementById('map-wrap').hidden, true); assert.equal(text(d.getElementById('btn-map')), 'Mapa');
});
test('[R31] Do navigace přeskočí na export do Waze a Google Map', async () => {
  const { d } = await search();
  let scrolled = false;
  d.getElementById('export').scrollIntoView = () => { scrolled = true; };
  d.getElementById('btn-nav').click();
  assert.ok(scrolled);
});
test('[R31] export: Google Mapy tam vede do cíle přes zastávky, Waze má krok na každé místo', async () => {
  const { d, api } = await search({ 'round-trip': true });
  const p = api.lastRun().plan, stopsA = p.stops.filter((s) => !s.empty && s.leg === 'A'), stopsB = p.stops.filter((s) => !s.empty && s.leg === 'B');
  const tam = [...d.querySelectorAll('#export a.nav')].find((a) => /tam/.test(a.textContent));
  const u = new URL(tam.href);
  assert.equal(u.searchParams.get('destination'), `${ROUTES['ostrava-praha'].to.lat.toFixed(6)},${ROUTES['ostrava-praha'].to.lon.toFixed(6)}`);
  assert.equal((u.searchParams.get('waypoints') || '').split('|').filter(Boolean).length, stopsA.length);
  assert.equal(d.querySelectorAll('#export a.waze').length, stopsA.length + 1 + stopsB.length + 1);
});
test('[R31] Stáhnout GPX: soubor s body startu, zastávek a cíle', async () => {
  const setup = (w) => { w.URL.createObjectURL = (f) => { w.__file = f; return 'blob:test'; }; w.URL.revokeObjectURL = () => {}; };
  const { w, d, api } = await search({ 'round-trip': false }, { setup });
  btn(d.getElementById('export'), /Stáhnout GPX/).click();
  await wait(50);
  const gpx = await w.__file.text();
  const n = api.lastRun().plan.stops.filter((s) => !s.empty).length;
  assert.equal((gpx.match(/<wpt /g) || []).length, 1 + n + 1);
});
test('[R31] Sdílet plán pošle seznam zastávek s časy', async () => {
  const setup = (w) => { w.navigator.share = async (data) => { w.__shared = data; }; };
  const { w, d } = await search({ 'round-trip': false }, { setup });
  btn(d.getElementById('export'), /Sdílet plán/).click();
  await wait(20);
  assert.match(w.__shared.text, /^1\. \d{2}:\d{2} /);
});

// ---------------------------------------------------------------- stop card
test('[R32] karta zastávky: Waze a Google Mapy míří na stanici', async () => {
  const { d, api } = await search();
  const s = api.lastRun().plan.stops.find((x) => !x.empty).c.s;
  const card = d.querySelector('.stop-card');
  assert.match(card.querySelector('a.go').href, new RegExp(`ll=${s.lat.toFixed(6)},${s.lon.toFixed(6)}`));
  const g = [...card.querySelectorAll('a')].find((a) => /Google Mapy/.test(a.textContent));
  assert.match(g.href, new RegExp(`query=${s.lat.toFixed(6)},${s.lon.toFixed(6)}`));
});
test('[R33] Vybrat jinou možnost v okně: zastávka se vymění', async () => {
  const { d, api } = await search({ 'round-trip': true });
  const p = api.lastRun().plan;
  const idx = p.stops.findIndex((s) => !s.empty && s.alts && s.alts.length);
  assert.ok(idx >= 0, 'nějaká zastávka má jiné možnosti');
  const alt = p.stops[idx].alts[0];
  const cards = [...d.querySelectorAll('.stop-card')];
  const k = p.stops.slice(0, idx).filter((s) => !s.empty).length;
  btn(cards[k].querySelector('.stop-more'), /Vybrat/).click();
  assert.ok(api.lastRun().plan.stops.some((s) => !s.empty && s.c === alt), 'vybraná možnost je v plánu');
});
test('[R15] zápis nabíjení: Načíst z textu vyplní pole, Smazat zápis ho zruší', async () => {
  const { d, api } = await search({ 'round-trip': true });
  const card = d.querySelectorAll('.stop-card')[0];
  const form = card.querySelector('.actual-form');
  form.querySelector('textarea').value = '40 % → 65 %, 21,5 kWh, 00:12:30, 380 Kč';
  btn(form, /Načíst z textu/).click();
  assert.deepEqual([...form.querySelectorAll('.grid2 input')].map((i) => i.value), ['40', '65', '21,50', '12,5', '380,00']);
  btn(form, /Uložit a přepočítat/).click();
  assert.equal(Object.keys(api.curTrip().actual).length, 1);
  const card2 = d.querySelectorAll('.stop-card')[0];
  btn(card2.querySelector('.actual-form'), /Smazat zápis/).click();
  assert.equal(Object.keys(api.curTrip().actual).length, 0);
  assert.doesNotMatch(text(d.querySelectorAll('.stop-card')[0]), /Skutečnost:/);
});

// ---------------------------------------------------------------- trip card
test('[R12] Poslat do mobilu: odkaz s cestou + Kopírovat odkaz', async () => {
  const setup = (w) => Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { w.__clip = t; } } });
  const { w, d } = await search({}, { setup });
  btn(d.querySelector('.card.trip'), /Poslat do mobilu/).click();
  const box = d.querySelector('.card.trip .send-box');
  assert.equal(box.hidden, false);
  const link = box.querySelector('input').value;
  assert.match(link, /#cesta=[A-Za-z0-9_-]+$/);
  btn(box, /Kopírovat odkaz/).click();
  await wait(20);
  assert.equal(w.__clip, link);
});
test('[R16] Jedu jinudy → Zrušit vrátí původní cestu', async () => {
  const { d } = await search({ 'round-trip': true });
  btn(d.querySelector('.card.trip'), /Uložit cestu/).click();
  btn(d.querySelector('.card.trip'), /Jedu jinudy/).click();
  btn(d.getElementById('status'), /Zrušit/).click();
  assert.deepEqual([...d.querySelectorAll('.place input')].map((i) => i.value), ['Ostrava', 'Praha']);
  assert.equal(d.getElementById('form').hidden, true);
  assert.match(text(d.getElementById('soc0').closest('label')), /Baterie na startu/);
});
test('[R14] Dokončit cestu → Uložit opravu změní zapsané hodnoty', async () => {
  const { d, api } = await search();
  let fin = d.querySelector('.card.finish');
  let [soc, km] = fin.querySelectorAll('input'); soc.value = '30'; km.value = '400';
  btn(fin, /Dokončit a uložit/).click();
  fin = d.querySelector('.card.finish');
  [soc, km] = fin.querySelectorAll('input'); km.value = '410';
  btn(fin, /Uložit opravu/).click();
  assert.equal(api.curTrip().finish.km, 410);
});

// ---------------------------------------------------------------- Moje cesty
test('[R11] Moje cesty: otevřít uloženou cestu ze seznamu i z řádku nahoře', async () => {
  const { w, d } = await search({ 'round-trip': true });
  btn(d.querySelector('.card.trip'), /Uložit cestu/).click();
  const storage = { 'np.trips.v1': w.localStorage.getItem('np.trips.v1') };
  const fresh = await loadApp({ prefs: { places: praha }, storage });
  const d2 = fresh.w.document;
  assert.match(text(d2.getElementById('trips-strip')), /Ostrava → Praha/);
  d2.querySelector('#trips-strip .chip').click();
  for (let i = 0; i < 100 && !d2.querySelector('#results .timeline'); i++) await wait();
  assert.ok(d2.querySelector('#results .timeline'), 'cesta z řádku nahoře se otevře');
  const fresh2 = await loadApp({ prefs: { places: praha }, storage });
  fresh2.w.document.querySelector('#trips-list .trip-open').click();
  for (let i = 0; i < 100 && !fresh2.w.document.querySelector('#results .timeline'); i++) await wait();
  assert.ok(fresh2.w.document.querySelector('#results .timeline'), 'cesta ze seznamu v ☰ se otevře');
});
test('[R11] Moje cesty: Smazat cestu odebere', async () => {
  const { w, d } = await search();
  btn(d.querySelector('.card.trip'), /Uložit cestu/).click();
  btn(d.getElementById('trips-list'), /Smazat/).click();
  assert.equal(JSON.parse(w.localStorage.getItem('np.trips.v1')).length, 0);
  assert.equal(d.querySelectorAll('#trips-list li').length, 0);
});

// ---------------------------------------------------------------- settings panel
test('[R5] Ukázat jen oblíbené pumpy: v plánu jsou jen oblíbené', async () => {
  const { w, d, api } = await search({ favs: ['MOL', 'ORLEN'], 'round-trip': true });
  change(w, d.getElementById('only-fav'), true);
  assert.equal(prefsOf(w)['only-fav'], true);
  for (const s of api.lastRun().plan.stops.filter((x) => !x.empty && !x.note)) assert.ok(['MOL', 'ORLEN'].includes(s.c.s.fuel));
});
test('[R6] karty: odškrtnutí karty se uloží, Vrátit moje karty vrátí výchozí', async () => {
  const { w } = await loadApp(), d = w.document;
  const box = d.querySelector('#cards input[type=checkbox]:checked');
  change(w, box, false);
  const id = box.id.replace(/^card-/, '');
  assert.ok(!prefsOf(w).cards.includes(id));
  d.getElementById('cards-default').click();
  assert.ok(prefsOf(w).cards.includes(id));
});
test('[R6] Jen stanice, kde zaplatím vybranou kartou: přepínač se uloží', async () => {
  const { w } = await loadApp(), d = w.document;
  change(w, d.getElementById('my-cards'), false);
  assert.equal(prefsOf(w)['my-cards'], false);
});
test('[R8] Skryté stanice: Vrátit stanici zase povolí', async () => {
  const { w, d, api } = await search({ 'round-trip': false });
  const s0 = api.lastRun().plan.stops.find((s) => !s.empty).c.s;
  btn(d.querySelector('.stop-card'), /Tuhle nechci/).click();
  assert.equal(d.querySelectorAll('#hidden-list li').length, 1);
  btn(d.getElementById('hidden-list'), /Vrátit/).click();
  assert.equal((prefsOf(w).hidden || []).length, 0);
  assert.ok(api.lastRun().cands.some((c) => c.s.lat === s0.lat && c.s.lon === s0.lon), 'stanice je zase mezi kandidáty');
});
test('[R7] Min. výkon: změna se uloží a plán ji použije', async () => {
  const { w, d, api } = await search();
  change(w, d.getElementById('min-kw'), '150');
  assert.equal(prefsOf(w).minKw, 150);
  for (const c of api.lastRun().cands) assert.ok(c.s.kw >= 150);
});
test('[R7] Spotřeba: ruční hodnota se uloží jako tvoje a plán s ní počítá', async () => {
  const { w, d, api } = await search();
  change(w, d.getElementById('cons'), '20,5');
  assert.equal(prefsOf(w).cons, 20.5); assert.equal(prefsOf(w).consCustom, true);
  assert.equal(api.lastRun().o.cons, 20.5);
});
test('[R7] Časy jízdy (tempo): změna přepočítá časy plánu', async () => {
  const { w, d, api } = await search();
  const t0 = api.lastRun().plan.T;
  change(w, d.getElementById('tempo'), '1');
  assert.equal(api.lastRun().o.tempo, 1);
  assert.ok(api.lastRun().plan.T > t0);
});
test('[R7] Ukázat i stanice bez známého výkonu a Limit nabití se uloží', async () => {
  const { w } = await loadApp(), d = w.document;
  change(w, d.getElementById('unknown-kw'), true);
  change(w, d.getElementById('car-limit'), '90');
  assert.equal(prefsOf(w)['unknown-kw'], true); assert.equal(prefsOf(w).carLimit, 90);
});
test('[R14] Srovnání s palivem: změna ceny nafty přepočítá srovnání', async () => {
  const { w, d, api } = await search();
  const nafta = [...d.querySelectorAll('#cmp-box label')].find((l) => /Nafta/.test(l.textContent)).querySelector('input');
  change(w, nafta, '40');
  const { o, plan: p } = api.lastRun();
  const r = api.comparison(o, p), volvo = r.cars.find((c) => /Volvo/.test(c.name));
  assert.ok(Math.abs(volvo.czk - r.km * 5 / 100 * 40) < 0.01);
  assert.match(text(d.querySelector('.card.compare')), /nafta 40,00/);
});

// ---------------------------------------------------------------- backup
test('[R22] Uložit do souboru: záloha s nastavením i cestami, zapíše datum zálohy', async () => {
  const setup = (w) => { w.URL.createObjectURL = (f) => { w.__file = f; return 'blob:test'; }; w.URL.revokeObjectURL = () => {}; };
  const { w } = await loadApp({ prefs: { favs: ['MOL'] }, setup }), d = w.document;
  d.getElementById('btn-export').click();
  await wait(50);
  const j = JSON.parse(await w.__file.text());
  assert.equal(j.app, 'nabijeci-planovac'); assert.deepEqual(JSON.parse(JSON.stringify(j.prefs.favs)), ['MOL']);
  assert.ok(Array.isArray(j.trips)); assert.ok(prefsOf(w).lastBackup);
});
test('[R22] Načíst ze souboru: platná záloha se uloží, neplatná ohlásí chybu', async () => {
  const { w } = await loadApp({ prefs: { favs: ['MOL'] } }), d = w.document;
  const fileInput = d.getElementById('import-file');
  const load = async (content) => {
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [new w.File([content], 'z.json', { type: 'application/json' })] });
    fileInput.dispatchEvent(new w.Event('change')); await wait(50);
  };
  await load('{"nic": 1}');
  assert.match(text(d.getElementById('status')), /Tohle není záloha/);
  await load(JSON.stringify({ app: 'nabijeci-planovac', version: 2, prefs: { favs: ['Shell'] }, trips: [] }));
  assert.deepEqual(prefsOf(w).favs, ['Shell']);
});
test('[R22] první spuštění (nic uloženého) nabídne Načíst zálohu', async () => {
  const { w } = await loadApp({ prefs: null }), d = w.document;
  assert.ok(btn(d.getElementById('status'), /Načíst zálohu/));
});

// ---------------------------------------------------------------- updates
test('[R23] nová verze appky: po návratu do appky se ukáže „Je tu nová verze“', async () => {
  const { w } = await loadApp(), d = w.document;
  assert.equal(d.getElementById('update-banner').hidden, true);
  d.dispatchEvent(new w.Event('visibilitychange'));
  await wait(50);
  assert.equal(d.getElementById('update-banner').hidden, false);
});

test('[R1] po hledání jde hledat znovu s jiným nastavením (Upravit → Najít zastávky)', async () => {
  const { w, d, api } = await search({ stopBy: 'time', intTime: 60, tolTime: 15, 'round-trip': false });
  d.getElementById('trip-chip').click();
  d.getElementById('int-time').value = '90';
  await submit(w);
  assert.equal(api.lastRun().o.interval, 90);
});
