// D27 (uživatel 16. 11. 2026, ze srovnání s dalšími appkami): N1 předehřev baterie (R49), N2 nabíječky poblíž (R50).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const real = (api) => api.lastRun().plan.stops.filter((s) => !s.empty);
const km = (a, b) => {
  const R = 6371, p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((b.lon - a.lon) * Math.PI / 360) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const TIP = 'naviguj sem v autě, předehřeje baterii';

test('[R49] pod 50 % na stojanu od 100 kW: rada řekne, ať naviguje autem kvůli předehřevu baterie', async () => {
  const { d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const stops = real(api), cards = [...d.querySelectorAll('.stop-card')];
  let low = 0, high = 0;
  stops.forEach((st, i) => {
    const adv = text(cards[i].querySelector('.advice:not(.logged)'));
    const want = st.kwh > 0 && st.arrive < 50 && (st.c.s.kw || 0) >= 100;
    if (want) { low += 1; assert.ok(adv.includes(TIP), `zastávka ${i + 1} (${Math.round(st.arrive)} %, ${st.c.s.kw} kW): „${adv}“`); }
    else { if (st.kwh > 0) high += 1; assert.ok(!adv.includes(TIP), `zastávka ${i + 1} (${Math.round(st.arrive)} %): předehřev tu není potřeba`); }
  });
  assert.ok(low >= 1, 'v plánu je nabíjení pod 50 %');
});

test('[R49] přijedeš nad 50 %: o předehřevu nic', async () => {
  const { d, api } = await search({ 'round-trip': false }, { soc0: 100 });
  const stops = real(api), cards = [...d.querySelectorAll('.stop-card')];
  stops.forEach((st, i) => { if (st.arrive >= 50) assert.ok(!text(cards[i]).includes(TIP)); });
});

test('[R50] pod Víc o zastávce: až 3 nejbližší další nabíječky do 5 km se vzdáleností, podle vzdálenosti', async () => {
  const { d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const stops = real(api), cards = [...d.querySelectorAll('.stop-card')];
  let any = 0;
  stops.forEach((st, i) => {
    const near = cards[i].querySelector('details.stop-more .near');
    if (!near) return;
    const rows = [...near.querySelectorAll('.alt[data-key]')];
    assert.ok(rows.length >= 1 && rows.length <= 3, `zastávka ${i + 1}: ${rows.length} nabíječek poblíž`);
    let prev = -1;
    for (const r of rows) {
      const [lat, lon] = r.getAttribute('data-key').split(',').map(Number);
      const dist = km(st.c.s, { lat, lon });
      assert.ok(dist <= 5.05, `zastávka ${i + 1}: nabíječka ${dist.toFixed(1)} km daleko`);
      assert.ok(dist > 0.01, 'není to ta samá stanice');
      assert.ok(dist >= prev - 0.01, 'seřazené od nejbližší');
      assert.match(text(r), /km odsud/);
      assert.ok(r.querySelector('button'), 'Vybrat');
      prev = dist;
    }
    any += 1;
  });
  assert.ok(any >= 1, 'aspoň jedna zastávka má nabíječky poblíž');
});

test('[R50] Vybrat u nabíječky poblíž ji použije jako zastávku', async () => {
  const { d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const cards = [...d.querySelectorAll('.stop-card')];
  const i = cards.findIndex((c) => c.querySelector('details.stop-more .near .alt[data-key]'));
  assert.ok(i >= 0);
  const row = cards[i].querySelector('details.stop-more .near .alt[data-key]');
  const key = row.getAttribute('data-key');
  row.querySelector('button').click();
  const st = real(api)[i];
  assert.equal(`${(+st.c.s.lat).toFixed(5)},${(+st.c.s.lon).toFixed(5)}`, key, 'zastávka je teď vybraná nabíječka');
});
