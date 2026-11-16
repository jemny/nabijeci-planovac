// R41 Posuvníky a tlačítka ve formuláři (D11 = A, uživatel 16. 11. 2026, ze srovnání s ABRP: „např. nastavení, na kolik
// nabíjet, je posuvník“). Baterie a obě rezervy posuvníkem s číslem, do kterého jde napsat přesně; interval, tolerance
// a objížďka tlačítky s předvolbami, „Jiný“ ukáže dosavadní pole. Pole mají stejná id jako dřív.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, search, ROUTES, submit, wait } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const praha = [{ role: 'from', ...ROUTES['ostrava-praha'].from }, { role: 'to', ...ROUTES['ostrava-praha'].to }];
const range = (d, id) => d.querySelector(`input[type=range][data-for="${id}"]`);
const chipsOf = (d, id) => [...d.querySelectorAll(`.presets[data-for="${id}"] .chip`)];
const chip = (d, id, re) => chipsOf(d, id).find((c) => re.test(text(c)));
const pressed = (d, id) => chipsOf(d, id).filter((c) => c.getAttribute('aria-pressed') === 'true').map(text);
const shown = (el) => { for (let n = el; n; n = n.parentElement) if (n.hidden) return false; return true; };
const fire = (w, el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));

test('[R41] baterie na startu a obě rezervy mají posuvník se stejným rozsahem a hodnotou jako pole s číslem', async () => {
  const { w } = await loadApp({ prefs: { places: praha, reserve: 15, reserveDest: 25 } }), d = w.document;
  for (const [id, val] of [['soc0', '100'], ['reserve', '15'], ['reserve-dest', '25']]) {
    const r = range(d, id), n = d.getElementById(id);
    assert.ok(r, `${id}: posuvník`);
    assert.ok(d.getElementById('step-2').contains(r), `${id}: posuvník je v kroku 2`);
    assert.equal(n.type, 'number', `${id}: pole s číslem zůstává (dá se napsat přesně)`);
    assert.equal(r.min, n.min, `${id}: stejné minimum`); assert.equal(r.max, n.max, `${id}: stejné maximum`);
    assert.equal(r.value, val, `${id}: posuvník ukazuje uloženou hodnotu`);
  }
});

test('[R41] posuvník a číslo se drží stejné hodnoty oběma směry', async () => {
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  const r = range(d, 'soc0'), n = d.getElementById('soc0');
  r.value = '64'; fire(w, r, 'input');
  assert.equal(n.value, '64', 'posuvník → číslo');
  n.value = '37'; fire(w, n, 'input');
  assert.equal(r.value, '37', 'číslo → posuvník');
});

test('[R41] rezerva na zastávky má předvolby 10 / 15 / 20 %', async () => {
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  assert.deepEqual(chipsOf(d, 'reserve').map(text), ['10 %', '15 %', '20 %']);
  assert.deepEqual(pressed(d, 'reserve'), ['10 %']);
  chip(d, 'reserve', /^20 %/).click();
  assert.equal(d.getElementById('reserve').value, '20');
  assert.equal(range(d, 'reserve').value, '20');
  assert.deepEqual(pressed(d, 'reserve'), ['20 %']);
});

const PRESETS = [
  ['int-time', ['0:45', '1:00', '1:15', '1:30', '2:00', 'Jiný'], true],
  ['tol-time', ['0 min', '10 min', '15 min', '20 min', '30 min', 'Jiný'], true],
  ['int-km', ['100 km', '130 km', '150 km', '200 km', 'Jiný'], true],
  ['tol-km', ['10 km', '20 km', '30 km', 'Jiný'], true],
  ['detour', ['0,5 km', '1 km', '1,5 km', '5 km', '15 km'], false],
];
test('[R41] interval, tolerance a objížďka jsou tlačítka s předvolbami, vybraná je zmáčknutá', async () => {
  const { w } = await loadApp({ prefs: { places: praha, stopBy: 'time' } }), d = w.document;
  for (const [id, labels] of PRESETS) assert.deepEqual(chipsOf(d, id).map(text), labels, `${id}: tlačítka`);
  assert.deepEqual(pressed(d, 'int-time'), ['1:00']);
  assert.deepEqual(pressed(d, 'tol-time'), ['15 min']);
  assert.deepEqual(pressed(d, 'detour'), ['1,5 km']);
  assert.equal(shown(d.getElementById('int-time')), false, 'pole intervalu je schované, dokud stačí předvolby');
  assert.equal(shown(d.getElementById('detour')), false, 'objížďka má jen tlačítka');
});

test('[R41] klepnutí na tlačítko nastaví pole a plán ho použije', async () => {
  const { w, d, api } = await search({ 'round-trip': false });
  chip(d, 'int-time', /^1:30$/).click();
  chip(d, 'tol-time', /^20 min$/).click();
  chip(d, 'detour', /^5 km$/).click();
  assert.equal(d.getElementById('int-time').value, '90');
  assert.equal(d.getElementById('tol-time').value, '20');
  assert.equal(d.getElementById('detour').value, '5');
  assert.deepEqual(pressed(d, 'int-time'), ['1:30']);
  assert.match(text(d.getElementById('win-hint')), /1:10–1:50/, 'nápověda okna se přepočítá');
  await submit(w);
  const o = api.lastRun().o;
  assert.equal(o.interval, 90); assert.equal(o.tol, 20); assert.equal(o.detourKm, 5);
});

test('[R41] Jiný ukáže dosavadní pole; jiná hodnota než předvolba zmáčkne Jiný', async () => {
  const { w } = await loadApp({ prefs: { places: praha, intTime: 105 } }), d = w.document;
  assert.deepEqual(pressed(d, 'int-time'), ['Jiný'], 'uložených 1:45 není předvolba');
  assert.equal(shown(d.getElementById('int-time')), true, 'a pole je vidět');
  chip(d, 'int-time', /^1:00$/).click();
  assert.equal(shown(d.getElementById('int-time')), false);
  chip(d, 'int-time', /^Jiný$/).click();
  assert.equal(shown(d.getElementById('int-time')), true, 'Jiný ukáže pole');
  const sel = d.getElementById('int-time'); sel.value = '150'; fire(w, sel, 'change');
  assert.deepEqual(pressed(d, 'int-time'), ['Jiný']);
});

test('[R41] otevřená cesta nastaví i posuvníky a tlačítka', async () => {
  const { api } = await loadApp({ prefs: { places: praha } });
  const input = { places: praha.map(({ label, lat, lon }) => ({ label, lat, lon })), depart: '2026-11-16T08:00', soc0: 60, reserve: 15, reserveDest: 25,
    stopBy: 'time', intTime: 75, tolTime: 10, intKm: 130, tolKm: 20, detour: 1, atPump: true, roundTrip: false, retTime: '16:00' };
  const link = api.tripLink({ input, stops: [] });
  const { w } = await loadApp({ prefs: { places: praha }, url: link }), d = w.document;
  for (let i = 0; i < 100 && !d.querySelector('#results .timeline'); i++) await wait();
  assert.equal(range(d, 'soc0').value, '60'); assert.equal(range(d, 'reserve').value, '15'); assert.equal(range(d, 'reserve-dest').value, '25');
  assert.deepEqual(pressed(d, 'reserve'), ['15 %']);
  assert.deepEqual(pressed(d, 'int-time'), ['1:15']); assert.deepEqual(pressed(d, 'tol-time'), ['10 min']); assert.deepEqual(pressed(d, 'detour'), ['1 km']);
});

// D22 = C (uživatel 16. 11. 2026): „Do cíle dojet s“ zůstane bez předvoleb, jen posuvník a číslo.
test('[R41] Do cíle dojet s má jen posuvník a číslo, bez tlačítek s předvolbami', async () => {
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  assert.ok(range(d, 'reserve-dest'), 'posuvník je');
  assert.equal(chipsOf(d, 'reserve-dest').length, 0, 'žádné předvolby');
  const field = d.getElementById('reserve-dest').closest('.slider-field');
  assert.equal(field.querySelectorAll('.chip').length, 0, 'ani jiná tlačítka u pole');
});
