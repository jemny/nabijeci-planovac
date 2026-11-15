// Stopping by driving time ("Po čase jízdy"): every N minutes ± tolerance, counted from the previous stop.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, options, plan, search, wait } from './harness.mjs';

let api;
before(async () => { ({ api } = await loadApp()); });
const near = (a, b) => Math.abs(a - b) < 1e-6;
const hmToMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

test('[R2] čas: první okno je interval ± tolerance od startu (1:00 ± 15 → 0:45–1:15)', async () => {
  api.setFavs(['MOL', 'ORLEN']);
  const { plan: p } = await plan(api, 'ostrava-praha', options({ interval: 60, tol: 15 }));
  assert.ok(near(p.stops[0].lo, 45) && near(p.stops[0].hi, 75), `okno ${p.stops[0].lo}–${p.stops[0].hi}`);
});

test('[R2] čas: každé další okno se počítá od předchozí zastávky (tam i zpět)', async () => {
  api.setFavs(['MOL', 'ORLEN']);
  for (const [interval, tol] of [[45, 10], [60, 15], [90, 15], [120, 30]]) {
    const o = options({ interval, tol, roundTrip: true });
    const { rt, plan: p } = await plan(api, 'ostrava-praha', o);
    for (const leg of ['A', 'B']) {
      let prev = 0;
      for (const st of p.stops.filter((s) => s.leg === leg && s.note !== 'kvůli dojezdu')) {
        assert.ok(near(st.lo, prev + interval - tol) && near(st.hi, prev + interval + tol),
          `${interval} ± ${tol}, ${leg}: okno ${st.lo.toFixed(1)}–${st.hi.toFixed(1)}, předchozí ${prev.toFixed(1)}`);
        prev = st.empty || st.note === 'vybráno mimo okno' ? (st.lo + st.hi) / 2 : api.measure(st.c, leg, rt, o);
      }
    }
  }
});

test('[R2] čas: zastávka, kterou appka vybere sama, je vždy v okně (různé intervaly, tam i zpět)', async () => {
  api.setFavs(['MOL', 'ORLEN']);
  for (const [interval, tol] of [[45, 10], [60, 15], [75, 0], [90, 15], [120, 30]]) {
    const o = options({ interval, tol, roundTrip: true });
    const { rt, plan: p } = await plan(api, 'ostrava-praha', o);
    for (const st of p.stops.filter((s) => !s.empty && !s.note)) {
      const m = api.measure(st.c, st.leg, rt, o);
      assert.ok(m >= st.lo - 1e-6 && m <= st.hi + 1e-6, `${interval} ± ${tol}: ${st.c.s.fuel} ${st.c.s.op} na ${m.toFixed(1)} min, okno ${st.lo}–${st.hi}`);
    }
  }
});

test('[R2] čas: na cestě zpět se čas počítá od odjezdu z cíle', async () => {
  api.setFavs(['MOL', 'ORLEN']);
  const o = options({ interval: 60, tol: 15, roundTrip: true });
  const { rt, plan: p } = await plan(api, 'ostrava-praha', o);
  const firstB = p.stops.find((s) => s.leg === 'B');
  assert.ok(firstB && near(firstB.lo, 45) && near(firstB.hi, 75));
  if (!firstB.empty) {
    const fromDest = (rt.duration - firstB.c.n.t) / 60 + firstB.c.detourMin / 2;
    assert.ok(Math.abs(api.measure(firstB.c, 'B', rt, o) - fromDest) < 1e-6);
  }
});

test('[R2] čas: když je cíl blíž než interval + tolerance, další zastávka se už neplánuje', async () => {
  api.setFavs(['MOL', 'ORLEN']);
  const o = options({ interval: 60, tol: 15 });
  const { rt, plan: p } = await plan(api, 'ostrava-brno', o);    // ~1:41 jízdy
  const legA = p.stops.filter((s) => s.leg === 'A' && s.note !== 'kvůli dojezdu');
  const last = legA[legA.length - 1];
  const lastAt = last.empty ? (last.lo + last.hi) / 2 : api.measure(last.c, 'A', rt, o);
  assert.ok(rt.duration / 60 - lastAt <= o.interval + o.tol, 'za poslední zastávkou nezbývá víc než interval + tolerance');
  assert.equal(legA.length, 1);
});

test('[R2] čas: karta zastávky ukazuje čas jízdy uvnitř okna (to, co vidíš)', async () => {
  const { d } = await search({ stopBy: 'time', intTime: 60, tolTime: 15, 'round-trip': false });
  const card = d.querySelector('.stop-card');
  const m = card.textContent.match(/po (\d+:\d{2}) jízdy/);
  assert.ok(m, 'karta ukazuje „po H:MM jízdy“');
  const min = hmToMin(m[1]);
  assert.ok(min >= 45 && min <= 75, `zobrazeno ${m[1]}, okno 0:45–1:15`);
});

test('[R2] čas: nápověda pod oknem ukazuje rozsah první zastávky a mění se s nastavením', async () => {
  const { w } = await loadApp({ prefs: { stopBy: 'time', intTime: 60, tolTime: 15 } });
  const d = w.document;
  assert.match(d.getElementById('win-hint').textContent, /0:45–1:15 od startu/);
  d.getElementById('int-time').value = '90';
  d.getElementById('int-time').dispatchEvent(new w.Event('input'));
  assert.match(d.getElementById('win-hint').textContent, /1:15–1:45 od startu/);
});

test('[R3] čas: prázdné okno nic nevybere a nabídne možnosti s tlačítkem Vybrat', async () => {
  const { d } = await search({ stopBy: 'time', intTime: 30, tolTime: 0, detour: 0.5, 'round-trip': false });
  const empty = d.querySelector('.tl.empty');
  assert.ok(empty, 'při 0:30 ± 0 s objížďkou 0,5 km je aspoň jedno okno prázdné');
  assert.ok([...empty.querySelectorAll('button')].some((b) => /Vybrat/.test(b.textContent)));
  await wait(0);
});
