// D1 = C and D5 = A (user, 15. 11. 2026): an empty window offers "Rozšířit tohle okno" (only that window,
// the setting stays) + nearest stations; after ANY change of a stop everything after it is recomputed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const btn = (root, re) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent));
const near = (a, b) => Math.abs(a - b) < 1e-6;

// every window on the leg is centred interval after the previous stop (R2), whatever the user changed
function assertChain(api, leg) {
  const { rt, plan: p, o } = api.lastRun();
  let prev = 0;
  for (const st of p.stops.filter((s) => s.leg === leg && s.note !== 'kvůli dojezdu')) {
    assert.ok(near((st.lo + st.hi) / 2, prev + o.interval), `okno ${st.lo.toFixed(1)}–${st.hi.toFixed(1)} nenavazuje na zastávku na ${prev.toFixed(1)}`);
    prev = st.empty ? (st.lo + st.hi) / 2 : api.measure(st.c, leg, rt, o);
  }
}
const emptySearch = () => search({ favs: ['MOL', 'ORLEN'], stopBy: 'km', intKm: 100, tolKm: 5, detour: 0.5, 'round-trip': false });

test('[R3][R24] prázdné okno: tlačítko „Rozšířit tohle okno“ s rozsahem, který obsáhne nejbližší stanici', async () => {
  const { d, api } = await emptySearch();
  const st = api.lastRun().plan.stops.find((s) => s.empty && (s.suggest || []).some((x) => x.why !== 'detour'));
  assert.ok(st, 'je prázdné okno s nejbližší stanicí před nebo za ním');
  const b = btn(d.querySelector('.tl.empty'), /Rozšířit tohle okno/);
  assert.ok(b, 'prázdné okno má tlačítko Rozšířit tohle okno');
  assert.match(text(b), /\d+.*–.*\d+/, 'tlačítko ukazuje nový rozsah okna');
});

test('[R3][R24] po Rozšířit: okno má zastávku v rozšířeném okně, je označená a nastavení zůstalo', async () => {
  const { d, api } = await emptySearch();
  const o = api.lastRun().o;
  const idx = api.lastRun().plan.stops.findIndex((s) => s.empty && (s.suggest || []).some((x) => x.why !== 'detour'));
  const before = api.lastRun().plan.stops[idx];
  const nearest = before.suggest.filter((x) => x.why !== 'detour').sort((a, b) => a.off - b.off)[0];
  btn(d.querySelector('.tl.empty'), /Rozšířit tohle okno/).click();
  const after = api.lastRun().plan.stops.find((s) => s.leg === before.leg && s.win === before.win);
  assert.ok(after && !after.empty, 'rozšířené okno už není prázdné');
  const tol = (after.hi - after.lo) / 2;
  assert.ok(tol >= o.tol + nearest.off - 1e-6, `rozšířeno na ± ${tol}, nejbližší stanice je ${nearest.off} za hranicí`);
  const m = api.measure(after.c, after.leg, api.lastRun().rt, o);
  assert.ok(m >= after.lo - 1e-6 && m <= after.hi + 1e-6, 'zastávka je uvnitř rozšířeného okna');
  assert.equal(d.getElementById('tol-km').value, '5', 'nastavení tolerance zůstalo');
  for (const s of api.lastRun().plan.stops.filter((x) => x !== after && x.note !== 'kvůli dojezdu' && x.win !== undefined)) {
    assert.ok(near(s.hi - s.lo, 2 * o.tol), 'ostatní okna mají dál zadanou toleranci');
  }
  assert.ok([...d.querySelectorAll('.stop-card')].some((c) => /okno rozšířené tvým klepnutím/.test(text(c))), 'zastávka je tak označená');
});

test('[R2][R3] po Rozšířit: všechna další okna navazují na novou zastávku', async () => {
  const { d, api } = await emptySearch();
  btn(d.querySelector('.tl.empty'), /Rozšířit tohle okno/).click();
  assertChain(api, 'A');
});

test('[R2][R3] po Vybrat mimo okno: všechna další okna navazují na vybranou stanici', async () => {
  const { d, api } = await emptySearch();
  const empty = d.querySelector('.tl.empty');
  btn(empty.querySelector('.alts'), /Vybrat/).click();
  assertChain(api, 'A');
});

test('[R2][R33] po výběru jiné možnosti v okně: všechna další okna navazují na ni', async () => {
  const { d, api } = await search({ stopBy: 'time', intTime: 60, tolTime: 15, 'round-trip': true });
  const { plan: p, rt, o } = api.lastRun();
  const idx = p.stops.findIndex((s, i) => !s.empty && s.win !== undefined && (s.alts || []).some((a) => Math.abs(api.measure(a, s.leg, rt, o) - api.measure(s.c, s.leg, rt, o)) > 2)
    && p.stops.slice(i + 1).some((x) => x.leg === s.leg));
  assert.ok(idx >= 0, 'zastávka s jinou možností o víc než 2 min dál a dalším oknem za ní');
  const st = p.stops[idx];
  const alt = st.alts.find((a) => Math.abs(api.measure(a, st.leg, rt, o) - api.measure(st.c, st.leg, rt, o)) > 2);
  const k = p.stops.slice(0, idx).filter((s) => !s.empty).length;
  const card = d.querySelectorAll('.stop-card')[k];
  const altRow = [...card.querySelectorAll('.stop-more .alt')][st.alts.indexOf(alt)];
  btn(altRow, /Vybrat/).click();
  assert.ok(api.lastRun().plan.stops.some((s) => !s.empty && s.c === alt), 'vybraná stanice je v plánu');
  assertChain(api, st.leg);
});

test('[R2][R5] po Vybrat oblíbené mimo okno: všechna další okna navazují na ni', async () => {
  const { d, api } = await search({ favs: ['MOL'], stopBy: 'time', intTime: 60, tolTime: 15, detour: 1.5, 'round-trip': false });
  const hint = d.querySelector('.stop-card .fav-near');
  assert.ok(hint, 'první zastávka nabízí oblíbenou mimo okno');
  btn(hint, /Vybrat/).click();
  assert.match(text(d.querySelector('.stop-card h3')), /^MOL /);
  assertChain(api, 'A');
});
