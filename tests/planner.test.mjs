// Rules the planner must keep, checked on real station data and fixed routes.
// Run: cd tests && npm ci && npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, options, plan } from './harness.mjs';

let api;
before(async () => { ({ api } = await loadApp()); });

const favList = ['MOL', 'ORLEN', 'Shell'];
const name = (st) => `${st.c.s.fuel || '?'} ${st.c.s.op || '?'} ${st.c.s.kw || '?'} kW (${st.c.s.place || st.c.s.name || ''})`;
// stops the planner picked by itself for a window (not ones the user picked, not emergency stops for the battery)
const windowStops = (p) => p.stops.filter((s) => !s.empty && s.note !== 'kvůli dojezdu' && s.note !== 'vybráno mimo okno');

function checkRules(res, o, label, favs = favList) {
  const { rt, plan: p } = res;
  const unit = o.byKm ? 'km' : 'min';
  for (const st of windowStops(p)) {
    const m = api.measure(st.c, st.leg, rt, o);
    assert.ok(m >= st.lo - 1e-6 && m <= st.hi + 1e-6,
      `${label}: ${name(st)} je na ${m.toFixed(1)} ${unit}, mimo zadané okno ${st.lo.toFixed(0)}–${st.hi.toFixed(0)} ${unit}`);
    assert.ok(st.c.n.dist <= o.detourKm * 1000 + 1,
      `${label}: ${name(st)} je ${(st.c.n.dist / 1000).toFixed(1)} km od trasy, objížďka je nastavená na ${o.detourKm} km`);
    if (o.atPump) assert.ok(st.c.s.fuel, `${label}: ${name(st)} není u pumpy`);
    if (o.onlyFav) assert.ok(favs.includes(st.c.s.fuel), `${label}: ${name(st)} není oblíbená pumpa`);
    assert.ok(api.sideOk(st.c, st.leg), `${label}: ${name(st)} je odpočívadlo v protisměru`);
  }
  for (const st of p.stops.filter((s) => !s.empty)) {
    assert.ok(st.target <= api.MAX_TARGET + 1e-9, `${label}: ${name(st)} nabíjí na ${st.target} % (víc než ${api.MAX_TARGET} %)`);
    if (st.target > st.arrive + 0.5 && st.target > 80.5) {
      assert.ok(st.target <= Math.ceil(st.need) + 1,
        `${label}: ${name(st)} nabíjí na ${st.target} %, ale potřeba je ${st.need.toFixed(0)} % (minimum 8 % nesmí jít nad 80 %)`);
    }
    if (st.kwh > 0) assert.ok(st.target - st.arrive >= 2, `${label}: ${name(st)} nabíjí jen ${(st.target - st.arrive).toFixed(1)} %`);
  }
  // with the reserve kept, unless a leg is impossible (flagged)
  if (!p.short) {
    for (const st of p.stops.filter((s) => !s.empty)) {
      assert.ok(st.arrive >= o.reserve - 3, `${label}: na ${name(st)} přijedeš s ${st.arrive.toFixed(0)} %, rezerva je ${o.reserve} %`);
    }
  }
}

const scenarios = [
  ['po km 100 ± 20, rezerva 20, jen tam (hlášená chyba)', 'ostrava-praha', { byKm: true, interval: 100, tol: 20, reserve: 20 }],
  ['po čase 1:00 ± 15, tam i zpět', 'ostrava-praha', { roundTrip: true }],
  ['po km 200 ± 30, tam i zpět', 'ostrava-praha', { byKm: true, interval: 200, tol: 30, roundTrip: true }],
  ['po čase 1:00 ± 15, Brno tam i zpět', 'ostrava-brno', { roundTrip: true }],
  ['po čase 0:45 ± 15, Žilina', 'ostrava-zilina', { interval: 45 }],
  ['objížďka 0,5 km', 'ostrava-praha', { byKm: true, interval: 100, tol: 20, detourKm: 0.5 }],
  ['objížďka 5 km', 'ostrava-praha', { detourKm: 5, roundTrip: true }],
  ['jen oblíbené pumpy', 'ostrava-praha', { onlyFav: true, roundTrip: true }],
  ['start 60 %, rezerva 15', 'ostrava-praha', { soc0: 60, reserve: 15, roundTrip: true }],
];

for (const [label, route, over] of scenarios) {
  test(`pravidla: ${label}`, async () => {
    api.setFavs(favList);
    const o = options(over);
    checkRules(await plan(api, route, o), o, label);
  });
}

test('hlášená chyba: při 100 ± 20 km žádná zastávka, kterou appka vybere sama, není za 120 km', async () => {
  api.setFavs(favList);
  const o = options({ byKm: true, interval: 100, tol: 20, reserve: 20 });
  const { rt, plan: p } = await plan(api, 'ostrava-praha', o);
  const first = p.stops[0];
  if (first.empty) {
    assert.ok(Array.isArray(first.suggest), 'prázdné okno má nabídnout možnosti k výběru');
  } else if (first.note !== 'kvůli dojezdu') {
    const km = api.measure(first.c, first.leg, rt, o);
    assert.ok(km <= 120 + 1e-6, `první zastávka je na ${km.toFixed(0)} km (${name(first)})`);
  }
});

test('prázdné okno: možnosti mimo okno se jen nabídnou, nevyberou', async () => {
  api.setFavs(favList);
  const o = options({ byKm: true, interval: 100, tol: 5, detourKm: 0.5 });   // tight on purpose: empty windows
  const { rt, plan: p } = await plan(api, 'ostrava-praha', o);
  const empties = p.stops.filter((s) => s.empty);
  for (const e of empties) {
    for (const s of e.suggest || []) {
      const m = api.measure(s.c, e.leg, rt, o);
      const inWin = m >= e.lo && m <= e.hi && s.c.n.dist <= o.detourKm * 1000;
      assert.ok(!inWin, 'nabídka v prázdném okně musí být opravdu mimo okno nebo s větší objížďkou');
    }
  }
});

test('nabíjecí model: nad 80 % se nabíjí pomaleji než zespodu', () => {
  const low = api.chargeMinutes(10, 18, 300), high = api.chargeMinutes(80, 88, 300);
  assert.ok(high > 2 * low, `80→88 % ${high.toFixed(1)} min, 10→18 % ${low.toFixed(1)} min`);
});

test('čtení textu z aplikace: %, kWh, čas a cena, bez DPH', () => {
  const r = api.parseChargeText('Relace ukončena\nNabito 33,52 kWh\nDoba nabíjení 00:16:40\nCelkem 668,72 Kč\nCena 19,95 Kč/kWh\nDPH 21 %\nStav baterie 24 % → 58 %');
  assert.equal(r.kwh, 33.52); assert.equal(r.czk, 668.72);
  assert.ok(Math.abs(r.min - 16.667) < 0.01); assert.equal(r.socFrom, 24); assert.equal(r.socTo, 58);
});
