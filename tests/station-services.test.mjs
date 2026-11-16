// R51 Služby u stanice ikonou (D27 N3, uživatel 16. 11. 2026, ze srovnání s ABRP a WattBoxem; data D28 = C:
// sloupec „svc“ ze služeb pumpy, w = WC, f = jídlo, s = obchod). V kartě jen ikony, bez textu (R47).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const real = (api) => api.lastRun().plan.stops.filter((s) => !s.empty);
// stations.json with "svc" set for every station that has a pump (the real file otherwise)
const withSvc = (value) => (w) => {
  const realFetch = w.fetch;
  w.fetch = async (u, o) => {
    const r = await realFetch(u, o);
    if (!String(u).startsWith('data/stations.json')) return r;
    const j = await r.json();
    const svc = j.cols.indexOf('svc'), fuel = j.cols.indexOf('fuel');
    for (const row of j.rows) row[svc] = row[fuel] != null ? value : null;
    return { ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) };
  };
};
const NAMES = { w: 'WC', f: 'jídlo', s: 'obchod' };

for (const svc of ['wfs', 'ws', 's']) {
  test(`[R51] služby „${svc}“: v kartě ikony bez textu a čtečka je pojmenuje`, async () => {
    const { d, api } = await search({ 'round-trip': false }, { setup: withSvc(svc) });
    const stops = real(api), cards = [...d.querySelectorAll('.stop-card')];
    let n = 0;
    stops.forEach((st, i) => {
      if (!st.c.s.fuel) return;
      n += 1;
      const box = cards[i].querySelector('.svc');
      assert.ok(box, `zastávka ${i + 1}: služby`);
      const icons = [...box.querySelectorAll('svg.ic')].map((x) => x.getAttribute('class').match(/ic-(wc|food|shop)/)[1]);
      assert.deepEqual(icons, [...svc].map((c) => ({ w: 'wc', f: 'food', s: 'shop' })[c]), `zastávka ${i + 1}: ikony v pořadí WC, jídlo, obchod`);
      assert.equal(text(box), '', 'bez textu');
      assert.equal(box.getAttribute('role'), 'img');
      assert.equal(box.getAttribute('aria-label'), [...svc].map((c) => NAMES[c]).join(', '));
    });
    assert.ok(n >= 1, 'v plánu je zastávka u pumpy');
  });
}

test('[R51] bez údaje o službách karta nic neukazuje', async () => {
  const { d } = await search({ 'round-trip': false }, { setup: withSvc(null) });
  assert.equal(d.querySelectorAll('.stop-card .svc').length, 0);
});
