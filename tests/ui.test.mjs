// What the user sees: the whole app (form → search → results) in jsdom, OSRM from fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, ROUTES } from './harness.mjs';

const praha = [{ role: 'from', ...ROUTES['ostrava-praha'].from }, { role: 'to', ...ROUTES['ostrava-praha'].to }];

async function search(prefs) {
  const { w } = await loadApp({ prefs: { places: praha, ...prefs } });
  const d = w.document;
  d.getElementById('depart').value = '2026-11-16T08:00';
  d.getElementById('form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  for (let i = 0; i < 100 && !d.querySelector('#results .timeline'); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(d.querySelector('#results .timeline'), 'po hledání se ukáže časová osa');
  return { w, d };
}
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ') : '');

test('[R3] prázdné okno: appka nic nevybere sama, ukáže nabídku s tlačítkem Vybrat', async () => {
  const { d } = await search({ favs: ['MOL', 'ORLEN'], stopBy: 'km', intKm: 100, tolKm: 5, detour: 0.5, 'round-trip': false });
  const empty = d.querySelector('.tl.empty');
  assert.ok(empty, 'při úzkém okně (100 ± 5 km, objížďka 0,5 km) je aspoň jedno okno prázdné');
  assert.match(text(empty), /není/, 'prázdné okno řekne, že v něm nic není');
  const pick = [...empty.querySelectorAll('button')].find((b) => /Vybrat/.test(b.textContent));
  assert.ok(pick, 'prázdné okno nabízí možnosti mimo okno s tlačítkem Vybrat');
});

test('[R3] prázdné okno: po Vybrat je ze stanice zastávka označená „mimo okno, vybral jsi“', async () => {
  const { d } = await search({ favs: ['MOL', 'ORLEN'], stopBy: 'km', intKm: 100, tolKm: 5, detour: 0.5, 'round-trip': false });
  const before = d.querySelectorAll('.tl.empty').length;
  const empty = d.querySelector('.tl.empty');
  [...empty.querySelectorAll('button')].find((b) => /Vybrat/.test(b.textContent)).click();
  assert.equal(d.querySelectorAll('.tl.empty').length, before - 1, 'vybrané okno už není prázdné');
  const picked = [...d.querySelectorAll('.stop-card')].find((c) => /vybral jsi/.test(text(c)));
  assert.ok(picked, 'zastávka vybraná mimo okno je tak označená');
});

test('[R5] oblíbená pumpa kousek za oknem: jen se nabídne u zastávky, po Vybrat se použije', async () => {
  // MOL Vyškov (oblíbená) je pár minut za oknem 0:45–1:15; v okně je jiná stanice
  const { d } = await search({ favs: ['MOL'], stopBy: 'time', intTime: 60, tolTime: 15, detour: 1.5, 'round-trip': false });
  const first = d.querySelector('.stop-card');
  assert.ok(first, 'první zastávka existuje');
  assert.doesNotMatch(text(first.querySelector('h3')), /^MOL /, 'oblíbená mimo okno se sama nevybere');
  const hint = first.querySelector('.fav-near');
  assert.ok(hint, 'u zastávky je nabídka oblíbené pumpy mimo okno');
  assert.match(text(hint), /MOL/);
  [...hint.querySelectorAll('button')].find((b) => /Vybrat/.test(b.textContent)).click();
  const now = d.querySelector('.stop-card');
  assert.match(text(now.querySelector('h3')), /^MOL /, 'po Vybrat je první zastávka oblíbená MOL');
  assert.match(text(now), /vybral jsi/, 'a je označená jako vybraná mimo okno');
});
