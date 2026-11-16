// R40 Graf baterie po trase (D14 = A, uživatel 16. 11. 2026, ze srovnání s ABRP): v souhrnu % baterie podle km,
// u nabíjecí zastávky svislý skok, okna zastávek jako podbarvené pruhy, čárkovaně rezerva.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from './harness.mjs';

const real = (plan) => plan.stops.filter((s) => !s.empty);
const clamp = (v) => Math.max(0, Math.min(100, v));

// the chart in plan units: km along the trip and % battery, from the SVG coordinates
function chartOf(d) {
  const svg = d.querySelector('#summary svg.soc-chart');
  assert.ok(svg, 'v souhrnu je graf baterie');
  const [x0, y0, x1, y1] = svg.getAttribute('data-plot').split(/\s+/).map(Number), KM = +svg.getAttribute('data-km');
  const km = (x) => (x - x0) / (x1 - x0) * KM, pct = (y) => (y1 - y) / (y1 - y0) * 100;
  const pts = svg.querySelector('polyline.soc-line').getAttribute('points').trim().split(/\s+/)
    .map((p) => p.split(',').map(Number)).map(([x, y]) => ({ km: km(x), soc: pct(y) }));
  const wins = [...svg.querySelectorAll('rect.soc-win')].map((r) => ({ from: km(+r.getAttribute('x')), to: km(+r.getAttribute('x') + +r.getAttribute('width')) }));
  const lines = (cls) => [...svg.querySelectorAll(`line.${cls}`)].map((l) => ({ soc: pct(+l.getAttribute('y1')), flat: l.getAttribute('y1') === l.getAttribute('y2'), dash: !!l.getAttribute('stroke-dasharray') || /dash/.test(l.getAttribute('class')) }));
  return { svg, pts, wins, lines, KM };
}
// what the plan says: start, every stop (arrival, and departure where it charges), end
function expected(api) {
  const { rt, o, plan } = api.lastRun();
  const out = [{ km: 0, soc: o.soc0 }];
  for (const st of real(plan)) {
    const x = api.tripX(st, rt);
    out.push({ km: x, soc: clamp(st.arrive) });
    if (st.target > st.arrive + 0.5) out.push({ km: x, soc: clamp(st.target) });
  }
  out.push(o.roundTrip ? { km: 2 * plan.D, soc: clamp(plan.socEnd) } : { km: plan.D, soc: clamp(plan.socDest) });
  return out;
}

for (const roundTrip of [true, false]) {
  test(`[R40] graf baterie (${roundTrip ? 'tam i zpět' : 'jen tam'}): čára jde přes start, příjezd a odjezd z každé zastávky a konec`, async () => {
    const { d, api } = await search({ 'round-trip': roundTrip }, { soc0: 100 });
    const { pts, KM } = chartOf(d), exp = expected(api);
    const { plan } = api.lastRun();
    assert.ok(Math.abs(KM - (roundTrip ? 2 : 1) * plan.D) < 1, `osa km jde až ${roundTrip ? 'domů' : 'do cíle'} (${KM})`);
    assert.equal(pts.length, exp.length, `bodů ${pts.length}, plán jich má ${exp.length}`);
    exp.forEach((e, i) => {
      assert.ok(Math.abs(pts[i].km - e.km) <= 1.5 && Math.abs(pts[i].soc - e.soc) <= 1,
        `bod ${i + 1}: graf ${pts[i].km.toFixed(0)} km / ${pts[i].soc.toFixed(0)} %, plán ${e.km.toFixed(0)} km / ${e.soc.toFixed(0)} %`);
    });
  });
}

test('[R40] graf baterie: okna zastávek jako pruhy a každá zastávka v okně leží ve svém pruhu', async () => {
  const { d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const { rt, plan } = api.lastRun();
  const { wins } = chartOf(d);
  const windowed = plan.stops.filter((s) => s.win != null && s.lo != null);
  assert.ok(windowed.length >= 2, 'plán má okna');
  assert.equal(wins.length, windowed.length, `pruhů ${wins.length}, oken ${windowed.length}`);
  for (const st of windowed.filter((s) => !s.empty)) {
    const x = api.tripX(st, rt);
    assert.ok(wins.some((w) => x >= w.from - 2 && x <= w.to + 2), `zastávka na ${x.toFixed(0)} km leží v pruhu svého okna`);
  }
});

test('[R40] graf baterie: rezerva je vodorovná čárkovaná čára a graf má popis slovy', async () => {
  const { d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const { o, plan } = api.lastRun();
  const { svg, lines } = chartOf(d);
  const res = lines('soc-reserve');
  assert.ok(res.some((l) => l.flat && l.dash && Math.abs(l.soc - o.reserve) <= 0.5), `čára rezervy na ${o.reserve} % (${JSON.stringify(res)})`);
  assert.equal(svg.getAttribute('role'), 'img');
  const label = svg.getAttribute('aria-label') || '';
  assert.match(label, /100 %/, 'popis: start');
  assert.match(label, new RegExp(`${Math.round(plan.socEnd)} %`), 'popis: konec');
  for (const st of real(plan).filter((s) => s.kwh > 0)) assert.match(label, new RegExp(`${Math.round(st.arrive)} % → ${Math.round(st.target)} %`), 'popis: nabíjení na zastávce');
});
