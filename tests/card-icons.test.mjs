// R43 Ikony v kartě zastávky (D13 = B, uživatel 16. 11. 2026, ze srovnání s ABRP): výkon bleskem, počet stojanů
// zástrčkou, doba nabíjení hodinami, baterie při příjezdu baterií. Text u nich zůstává, na mapě se nic nemění.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const icon = (root, name) => root && root.querySelector(`svg.ic.ic-${name}`);

test('[R43] karta zastávky: blesk u výkonu, zástrčka u počtu stojanů, hodiny u doby nabíjení, text zůstává', async () => {
  const { d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const stops = api.lastRun().plan.stops.filter((s) => !s.empty), cards = [...d.querySelectorAll('.stop-card')];
  let charged = 0;
  stops.forEach((st, i) => {
    const c = cards[i], name = `zastávka ${i + 1}`;
    const op = c.querySelector('.op');
    if (st.c.s.kw) {
      assert.ok(icon(op, 'bolt'), `${name}: blesk u výkonu`);
      assert.match(text(op), new RegExp(`${st.c.s.kw} kW`), `${name}: výkon zůstává napsaný`);
    }
    const sub = c.querySelector('.stop-sub');
    if (st.c.s.ccs) {
      assert.ok(icon(sub, 'plug'), `${name}: zástrčka u počtu stojanů`);
      assert.match(text(sub), new RegExp(`${st.c.s.ccs}× CCS`), `${name}: počet stojanů zůstává napsaný`);
    }
    if (st.kwh > 0) {
      charged += 1;
      const t = c.querySelector('.tiles3 .tile:first-child');
      assert.ok(icon(t, 'clock'), `${name}: hodiny u doby nabíjení`);
      assert.match(text(t.querySelector('b')), /\d+ min/, `${name}: minuty zůstávají napsané`);
    }
  });
  assert.ok(charged >= 1, 'aspoň jedna nabíjecí zastávka');
});

test('[R43] zastávka bez nabíjení: baterie u příjezdu a text zůstává', async () => {
  const { d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const stops = api.lastRun().plan.stops.filter((s) => !s.empty), cards = [...d.querySelectorAll('.stop-card')];
  const i = stops.findIndex((s) => !(s.kwh > 0));
  assert.ok(i >= 0, 'plán má zastávku bez nabíjení (ze 100 % je první jen přestávka)');
  const line = cards[i].querySelector('.stop-line');
  assert.ok(icon(line, 'batt'), 'baterie u příjezdu');
  assert.match(text(line), /Přijedeš s ~\d+ %/);
});

test('[R43] ikony jsou jen ozdoba: čtečka je přeskočí (aria-hidden)', async () => {
  const { d } = await search({ 'round-trip': true }, { soc0: 100 });
  const icons = [...d.querySelectorAll('.stop-card svg.ic')];
  assert.ok(icons.length >= 4, `ikon v kartách: ${icons.length}`);
  for (const s of icons) assert.equal(s.getAttribute('aria-hidden'), 'true');
});
