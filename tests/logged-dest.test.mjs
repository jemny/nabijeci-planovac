// Nález nezávislé kontroly (16. 11. 2026): zapsaná zastávka (R15) hodnotila zbytek cesty podle rezervy na zastávky,
// ne podle „Do cíle dojet s“ (R42), a i u poslední zastávky psala „na další zastávku“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search, wait } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const real = (api) => api.lastRun().plan.stops.filter((s) => !s.empty);
const btn = (root, re) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent));
async function log(d, i, from, to) {
  const card = d.querySelectorAll('.stop-card')[i];
  const inputs = card.querySelectorAll('.actual-form .grid2 input');
  inputs[0].value = String(from); inputs[1].value = String(to);
  btn(card, /Uložit a přepočítat/).click();
  await wait();
  return d.querySelectorAll('.stop-card')[i];
}

test('[R42][R15] jen tam: zapsaná poslední zastávka porovná příjezd do cíle s „Do cíle dojet s“ a řekne „do cíle“', async () => {
  const { d, api } = await search({ 'round-trip': false, reserve: 10, reserveDest: 40 }, { soc0: 100 });
  const i = real(api).length - 1;
  const st = real(api)[i];
  // charge a little less than the plan wants: arrival in the destination ends between the two reserves
  const to = Math.round(st.target) - 15;
  const card = await log(d, i, Math.round(st.arrive), to);
  const end = api.lastRun().plan.socDest;
  assert.ok(end >= 10 && end < 40 - 1, `do cíle ${end.toFixed(0)} % (mezi rezervou 10 % a cílem 40 %)`);
  const t = text(card.querySelector('.advice.logged'));
  assert.match(t, /[Dd]o cíle/, 'píše o cíli, ne o další zastávce');
  assert.doesNotMatch(t, /na další zastávku/);
  assert.doesNotMatch(t, /Plán platí/, 'nehlásí, že plán platí');
  assert.ok(card.querySelector('.advice.logged.warn'), 'je to varování');
});

test('[R42][R15] tam i zpět: zapsaná poslední zastávka před cílem hlídá i příjezd do cíle', async () => {
  const { d, api } = await search({ 'round-trip': true, reserve: 10, reserveDest: 40 }, { soc0: 100 });
  const { rt, plan } = api.lastRun();
  const stops = real(api), i = stops.map((s, k) => (s.leg === 'A' ? k : -1)).filter((k) => k >= 0).pop();
  const st = stops[i];
  const card = await log(d, i, Math.round(st.arrive), Math.max(Math.round(st.arrive) + 1, Math.round(st.target) - 20));
  const dest = api.lastRun().plan.socDest;
  if (dest < 40 - 1) {
    const t = text(card.querySelector('.advice.logged'));
    assert.match(t, /[Dd]o cíle/, `příjezd do cíle ${dest.toFixed(0)} % je pod 40 %, karta to řekne`);
    assert.ok(card.querySelector('.advice.logged.warn'));
  }
  assert.ok(rt && plan);
});
