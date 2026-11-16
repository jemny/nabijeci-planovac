// Nálezy nezávislé kontroly (16. 11. 2026) k zastávkám „kvůli dojezdu“ (R13) s R39 a R42:
// 1) vysoké „Do cíle dojet s“ při cestě tam a zpět přidávalo zastávky za cílem, které příjezdu do cíle nepomohou,
//    a zastávky, které nic nenabíjí; 2) u uložené cesty posuvník „Nabít do“ nepřidal zastávku, i když baterie nestačila;
// 4) stanice, kterou uživatel vybral místo zastávky „kvůli dojezdu“, se po pohnutí jiným posuvníkem vrátila zpět.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, search, ROUTES, wait } from './harness.mjs';

const real = (api) => api.lastRun().plan.stops.filter((s) => !s.empty);
const cards = (d) => [...d.querySelectorAll('.stop-card')];
const btn = (root, re) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent));
const praha = [{ role: 'from', ...ROUTES['ostrava-praha'].from }, { role: 'to', ...ROUTES['ostrava-praha'].to }];
function slide(w, input, value) {
  input.value = String(value);
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
}
const near = (a, b) => Math.abs(a.lat - b.lat) < 0.004 && Math.abs(a.lon - b.lon) < 0.006;

for (const dest of [60, 70]) {
  test(`[R42][R13] tam i zpět, Do cíle ${dest} %: žádná zbytečná zastávka navíc (za cílem, nic nenabíjí, dvakrát na stejném místě)`, async () => {
    const { api } = await search({ 'round-trip': true, reserve: 10, reserveDest: dest }, { soc0: 100 });
    const { rt, plan } = api.lastRun(), D = plan.D;
    const stops = real(api), extra = stops.filter((s) => s.note === 'kvůli dojezdu');
    for (const s of extra) assert.ok(s.kwh > 0, `zastávka navíc ${s.c.s.name} nic nenabíjí`);
    assert.ok(extra.length <= 2, `zastávek navíc ${extra.length}`);
    for (let i = 1; i < stops.length; i++) {
      assert.ok(!(stops[i].leg === stops[i - 1].leg && near(stops[i].c.s, stops[i - 1].c.s)), `dvě zastávky za sebou na stejném místě (${stops[i - 1].c.s.name}, ${stops[i].c.s.name})`);
    }
    // the destination problem is fixed before the destination: nothing extra on the way back unless the way back needs it
    const extraBack = extra.filter((s) => api.tripX(s, rt) > D);
    if (plan.socDest < dest - 3) assert.equal(extraBack.length, 0, 'zastávky za cílem příjezdu do cíle nepomohou');
    assert.ok(plan.socDest >= dest - 3, `do cíle dojedeš s ${plan.socDest.toFixed(0)} % (chceš ${dest} %)`);
  });
}

test('[R39][R13] uložená cesta: posuvník Nabít do pod potřebu přidá zastávku kvůli dojezdu jako u neuložené', async () => {
  const { w, d } = await search({ 'round-trip': true }, { soc0: 100 });
  btn(d.querySelector('.card.trip'), /Uložit cestu/).click();
  const storage = { 'np.trips.v1': w.localStorage.getItem('np.trips.v1') };
  const fresh = await loadApp({ prefs: { places: praha }, storage });
  const w2 = fresh.w, d2 = w2.document, api = fresh.api;
  d2.querySelector('#trips-list .trip-open').click();
  for (let k = 0; k < 100 && !d2.querySelector('#results .timeline'); k++) await wait();
  assert.equal(api.lastRun().fixed, true, 'otevřená uložená cesta');
  const i = real(api).findIndex((s) => s.kwh > 0);
  slide(w2, cards(d2)[i].querySelector('input.charge-to'), Math.round(real(api)[i].arrive));
  const stops = real(api), plan = api.lastRun().plan;
  const extra = stops.some((s) => s.note === 'kvůli dojezdu');
  const ok = stops.every((s) => s.arrive >= 10 - 3) && plan.socDest >= 10 - 3 && plan.socEnd >= 10 - 3;
  assert.ok(extra || ok, `zastávka navíc, nebo všude s rezervou (příjezdy ${stops.map((s) => Math.round(s.arrive)).join(', ')}, cíl ${Math.round(plan.socDest)}, doma ${Math.round(plan.socEnd)})`);
  assert.ok(stops.every((s) => s.arrive > -1), 'nikde nepřijedeš pod nulu');
});

test('[R39][R33] stanice vybraná místo zastávky kvůli dojezdu zůstane i po pohnutí jiným posuvníkem', async () => {
  const { w, d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  // lower the first charging stop so that an extra stop appears
  const i = real(api).findIndex((s) => s.kwh > 0);
  slide(w, cards(d)[i].querySelector('input.charge-to'), Math.round(real(api)[i].arrive));
  const j = real(api).findIndex((s) => s.note === 'kvůli dojezdu' && s.alts && s.alts.length);
  assert.ok(j >= 0, 'zastávka navíc s jinými možnostmi');
  const alt = real(api)[j].alts[0];
  cards(d)[j].querySelector('.alts .alt button').click();
  const chosen = real(api).find((s) => s.c.s === alt.s);
  assert.ok(chosen, 'vybraná stanice je v plánu');
  // move another stop's slider
  const k = real(api).findIndex((s) => s.c.s !== alt.s && s.kwh > 0 && Math.round(s.target) < 95);
  slide(w, cards(d)[k].querySelector('input.charge-to'), Math.round(real(api)[k].target) + 3);
  assert.ok(real(api).some((s) => s.c.s === alt.s), 'tvoje vybraná stanice tam pořád je');
});
