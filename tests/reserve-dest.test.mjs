// R42 Rezerva na zastávky a do cíle zvlášť (D19 = A, uživatel 16. 11. 2026 v relaci „Posuvník úrovně nabití do cíle“):
// „Na zastávku přijet s alespoň“ platí pro zastávky, „Do cíle dojet s“ pro cíl, a když jedeš i zpátky, i pro příjezd domů.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, search, ROUTES } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const praha = [{ role: 'from', ...ROUTES['ostrava-praha'].from }, { role: 'to', ...ROUTES['ostrava-praha'].to }];
const prefsOf = (w) => JSON.parse(w.localStorage.getItem('np.prefs.v1') || '{}');
const real = (api) => api.lastRun().plan.stops.filter((s) => !s.empty);
const labelOf = (d, id) => text(d.getElementById(id).closest('label'));
// "Do cíle dojet s" comes from the saved settings, as after the last search
async function searchDest(prefs, v, soc0 = 100) {
  const r = await search({ ...prefs, reserveDest: v }, { soc0 });
  return r;
}

test('[R42] krok 2 má dvě pole: Na zastávku přijet s alespoň a Do cíle dojet s, obě výchozí 10 %', async () => {
  const { w } = await loadApp({ prefs: null }), d = w.document;
  assert.match(labelOf(d, 'reserve'), /Na zastávku přijet s alespoň/);
  assert.match(labelOf(d, 'reserve-dest'), /Do cíle dojet s/);
  assert.equal(d.getElementById('reserve').value, '10');
  assert.equal(d.getElementById('reserve-dest').value, '10');
  assert.ok(d.querySelector('#step-2').contains(d.getElementById('reserve-dest')), '„Do cíle dojet s“ je v kroku 2');
});

test('[R42] staré nastavení bez „Do cíle“ převezme rezervu, aby se uložené plány samy nezměnily', async () => {
  const { w } = await loadApp({ prefs: { places: praha, reserve: 15 } }), d = w.document;
  assert.equal(d.getElementById('reserve-dest').value, '15');
  const { w: w2 } = await loadApp({ prefs: { places: praha, reserve: 15, reserveDest: 25 } });
  assert.equal(w2.document.getElementById('reserve-dest').value, '25');
});

test('[R42] jen tam: do cíle dojedeš aspoň s „Do cíle dojet s“, na zastávky stačí rezerva', async () => {
  const { api: low } = await searchDest({ 'round-trip': false, reserve: 10 }, 10);
  const { api, w } = await searchDest({ 'round-trip': false, reserve: 10 }, 35);
  const p = api.lastRun().plan;
  assert.equal(api.lastRun().o.reserveDest, 35);
  assert.ok(p.socDest >= 35 - 1, `do cíle dojedeš s ${p.socDest.toFixed(0)} % (chceš 35 %)`);
  assert.ok(p.socDest > low.lastRun().plan.socDest + 10, 's vyšším „Do cíle“ přijedeš do cíle s víc %');
  for (const st of real(api)) assert.ok(st.arrive >= 10 - 3, `na zastávku stačí rezerva 10 % (${st.arrive.toFixed(0)} %)`);
  assert.equal(prefsOf(w).reserveDest, 35, 'uloží se do nastavení');
});

test('[R42] tam i zpět: „Do cíle dojet s“ platí v cíli i doma', async () => {
  const { api } = await searchDest({ 'round-trip': true, reserve: 10 }, 30);
  const p = api.lastRun().plan;
  assert.ok(p.socDest >= 30 - 1, `v cíli ${p.socDest.toFixed(0)} % (chceš 30 %)`);
  assert.ok(p.socEnd >= 30 - 1, `doma ${p.socEnd.toFixed(0)} % (chceš 30 %)`);
});

test('[R42][R24] souhrn řekne obě hodnoty a graf má čáru pro cíl', async () => {
  const { d } = await searchDest({ 'round-trip': true, reserve: 10 }, 30);
  const box = d.getElementById('summary');
  assert.match(text(box.querySelector('.battery-strip')), /zastávky 10 %/);
  assert.match(text(box.querySelector('.battery-strip')), /cíl 30 %/);
  const svg = box.querySelector('svg.soc-chart');
  const [, y0, , y1] = svg.getAttribute('data-plot').split(/\s+/).map(Number);
  const line = svg.querySelector('line.soc-dest');
  assert.ok(line, 'čára „Do cíle dojet s“');
  const pct = (y1 - +line.getAttribute('y1')) / (y1 - y0) * 100;
  assert.ok(Math.abs(pct - 30) <= 0.5, `čára cíle na 30 % (${pct.toFixed(1)})`);
});

test('[R42] cesta si „Do cíle dojet s“ pamatuje (uložená i v odkazu)', async () => {
  const { api } = await searchDest({ 'round-trip': true, reserve: 10 }, 30);
  const t = api.curTrip();
  assert.equal(t.input.reserveDest, 30);
  const link = api.tripLink(t);
  const { w, api: a2 } = await loadApp({ prefs: { places: praha }, url: link });     // the app opens the trip from the link
  for (let i = 0; i < 100 && !w.document.querySelector('#results .timeline'); i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(a2.curTrip().input.reserveDest, 30, 'cesta z odkazu má „Do cíle dojet s“');
  assert.equal(w.document.getElementById('reserve-dest').value, '30', 'a formulář ho ukazuje');
});
