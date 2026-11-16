// R44 Poplatek za minuty na stojanu (D10 = A, uživatel 16. 11. 2026, ze srovnání s WattBoxem): když síť účtuje čas nad
// volné minuty (free_min / czk_min v ceníku) a nabíjení podle plánu trvá déle, cena zastávky ho započítá a řekne to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, options } from './harness.mjs';

const whyOf = (st) => (st.why || []).join(' ');
// one stop at x km of a D km trip (10 h), 23,8 kWh/100 km → 0,28 % per km
function stopAt(xKm, D, s) {
  return { leg: 'A', c: { s: { kw: 300, op: 'E.ON', fuel: 'MOL', lat: 49.5, lon: 16.5, cc: 'CZ', name: 'E.ON', place: 'Test', ...s },
    n: { dist: 0, d: xKm * 1000, t: xKm / D * 36000 }, detourKm: 0, detourMin: 0 } };
}
async function charge(xKm, D, s) {
  const { api } = await loadApp();
  const st = api.energize({ distance: D * 1000, duration: 36000 }, [stopAt(xKm, D, s)], options({ cons: 23.8, reserve: 10, soc0: 100 })).stops[0];
  return { st, api };
}

test('[R44] E.ON nad 200 kW: nabíjení déle než 30 min zdarma → cena zastávky přičte 2 Kč za každou další minutu a řekne to', async () => {
  const { st } = await charge(350, 700);                      // ~2 % → 90 %, ~40 min na 300 kW, ve dne
  assert.ok(st.chargeMin > 30, `nabíjí ${st.chargeMin.toFixed(1)} min`);
  const extra = Math.ceil(st.chargeMin - 30), fee = extra * 2;
  assert.ok(Math.abs(st.cost - (st.kwh * st.pr.czk + fee)) < 0.01, `cena ${st.cost.toFixed(2)} = ${st.kwh.toFixed(1)} kWh × ${st.pr.czk} + ${fee} Kč za minuty`);
  assert.equal(st.fee.czk, fee); assert.equal(st.fee.min, extra); assert.equal(st.fee.free, 30);
  assert.match(whyOf(st), new RegExp(`30 min zdarma`)); assert.match(whyOf(st), new RegExp(`${fee} Kč`));
});

test('[R44] kratší nabíjení než minuty zdarma: žádný poplatek', async () => {
  const { st } = await charge(200, 400);                      // ~44 % → 66 %, ~10 min
  assert.ok(st.chargeMin > 0 && st.chargeMin < 30, `nabíjí ${st.chargeMin.toFixed(1)} min`);
  assert.equal(st.fee, null);
  assert.ok(Math.abs(st.cost - st.kwh * st.pr.czk) < 0.01);
  assert.doesNotMatch(whyOf(st), /zdarma/);
});

test('[R44] síť bez poplatku v ceníku: jen cena energie i při dlouhém nabíjení', async () => {
  const { st } = await charge(350, 700, { op: 'ORLEN', fuel: 'ORLEN' });
  assert.ok(st.chargeMin > 30);
  assert.equal(st.fee, null);
  assert.ok(Math.abs(st.cost - st.kwh * st.pr.czk) < 0.01);
});

test('[R44] ceník: E.ON do 100 kW má v noci minuty zdarma, ve dne 2 Kč po 120 min', async () => {
  const { api } = await loadApp();
  const day = api.price({ op: 'E.ON', kw: 50, cc: 'CZ' }, new Date('2026-11-16T12:00:00'));
  const night = api.price({ op: 'E.ON', kw: 50, cc: 'CZ' }, new Date('2026-11-16T23:00:00'));
  assert.deepEqual({ ...day.fee }, { free: 120, czk: 2 });
  assert.deepEqual({ ...night.fee }, { free: 120, czk: 0 });
});
