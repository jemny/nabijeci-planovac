// R24 – no silent decision: whatever the app decides by itself, it says so (user, 15. 11. 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, options, plan, search } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const whyOf = (st) => (st.why || []).join(' ');

// ---------------------------------------------------------------- how much to charge (cons 8,5 → 1 % per 10 km, reserve 10 %)
function stopAt(xKm, D) {
  return { leg: 'A', c: { s: { kw: 300, op: 'E.ON', fuel: 'MOL', lat: 49.5, lon: 16.5, cc: 'CZ', name: 'E.ON', place: 'Test' },
    n: { dist: 0, d: xKm * 1000, t: xKm / D * 36000 }, detourKm: 0, detourMin: 0 } };
}
async function charge(xKm, D) {
  const { api } = await loadApp();
  return api.energize({ distance: D * 1000, duration: 36000 }, [stopAt(xKm, D)], options({ cons: 8.5, reserve: 10, soc0: 100 })).stops[0];
}

test('[R24][R13] řekne, že nabíjí aspoň o 8 %, i když je potřeba méně', async () => {
  const st = await charge(700, 940);                 // 30 % → 38 %, potřeba 34 %
  assert.equal(st.target, 38);
  assert.match(whyOf(st), /aspoň o 8 %/); assert.match(whyOf(st), /34 %/);
});
test('[R24][R13] řekne, že minimum 8 % zastavil na 80 %, protože nad 80 % se nabíjí pomalu', async () => {
  const st = await charge(240, 930);                 // 76 % → 80 % (ne 84 %), potřeba 79 %
  assert.equal(Math.round(st.arrive), 76); assert.equal(st.target, 80);
  assert.match(whyOf(st), /80 %/); assert.match(whyOf(st), /pomal/);
});
test('[R24][R13] řekne, že nenabíjí, protože chybí jen pár procent', async () => {
  const st = await charge(150, 920);                 // 85 %, potřeba 87 %
  assert.equal(st.kwh, 0);
  assert.match(whyOf(st), /nevyplatí/); assert.match(whyOf(st), /2 %/);
});

// ---------------------------------------------------------------- which station
function cand(kw, op, fuel, tMin) {
  return { s: { kw, op, fuel, lat: 49.5, lon: 16.5, cc: 'CZ', name: `${op} ${kw}`, place: 'Test' },
    n: { dist: 100, t: tMin * 60, d: tMin * 1000, fast: false, right: true }, detourMin: 0, detourKm: 0 };
}
const rtSyn = { distance: 300000, duration: 3 * 3600 };
async function rank(arrive, add, pool, favList = []) {
  const { api } = await loadApp();
  api.setFavs(favList);
  api.rankWindow(pool, 'A', rtSyn, options({ depart: new Date('2026-11-16T10:00:00') }), 60, () => ({ arrive, add }));
  return pool[0];
}
test('[R24][R9] proč tahle stanice: nad 50 % stačí 150 kW, levnější pásmo', async () => {
  const best = await rank(60, 20, [{ c: cand(400, 'E.ON', 'OMV', 60), tier: 2 }, { c: cand(150, 'E.ON', 'OMV', 61), tier: 2 }]);
  assert.match(best.why, /150 kW/); assert.match(best.why, /levnější/);
});
test('[R24][R9] proč tahle stanice: pod 50 % nejrychlejší', async () => {
  const best = await rank(15, 50, [{ c: cand(150, 'E.ON', 'OMV', 60), tier: 2 }, { c: cand(400, 'E.ON', 'OMV', 61), tier: 2 }]);
  assert.match(best.why, /nejrychlejší/);
});
test('[R24][R9] proč tahle stanice: pod 50 % stejně rychlé do 2 min → levnější', async () => {
  const best = await rank(45, 15, [{ c: cand(300, 'E.ON', 'OMV', 60), tier: 2 }, { c: cand(200, 'E.ON', 'OMV', 61), tier: 2 }]);
  assert.match(best.why, /2 min/); assert.match(best.why, /levnější/);
});
test('[R24][R5] proč tahle stanice: oblíbená pumpa', async () => {
  const best = await rank(15, 50, [{ c: cand(400, 'E.ON', 'OMV', 60), tier: 2 }, { c: cand(150, 'E.ON', 'MOL', 70), tier: 0 }], ['MOL']);
  assert.match(best.why, /oblíbená/i);
});
test('[R24] proč tahle stanice: jediná v okně / jen káva', async () => {
  assert.match((await rank(60, 20, [{ c: cand(150, 'E.ON', 'OMV', 60), tier: 2 }])).why, /jediná/);
  assert.match((await rank(80, 0, [{ c: cand(150, 'E.ON', 'OMV', 60), tier: 2 }, { c: cand(300, 'E.ON', 'OMV', 70), tier: 2 }])).why, /káv/);
});

test('[R24][R13] zastávka navíc kvůli baterii to řekne', async () => {
  const { api } = await loadApp();
  api.setFavs(['MOL', 'ORLEN']);
  const { plan: p } = await plan(api, 'ostrava-praha', options({ soc0: 30, interval: 120, tol: 15 }));
  const extra = p.stops.find((s) => s.note === 'kvůli dojezdu');
  assert.ok(extra, 'se 30 % a zastávkou po 2 h je potřeba zastávka navíc');
  assert.match(whyOf(extra), /baterie nestačila/);
});

// ---------------------------------------------------------------- what the user sees
test('[R24] každá zastávka v plánu má vysvětlení a karta ho ukazuje', async () => {
  const { d, api } = await search({ 'round-trip': true });
  const stops = api.lastRun().plan.stops.filter((s) => !s.empty);
  const cards = [...d.querySelectorAll('.stop-card')];
  stops.forEach((st, i) => {
    assert.ok((st.why || []).length, `zastávka ${i + 1} nemá vysvětlení`);
    for (const line of st.why) assert.ok(text(cards[i]).includes(line), `karta ${i + 1} neukazuje „${line}“`);
  });
});
test('[R24][R3] prázdné okno řekne, že nabízí nejbližší stanice i daleko, a u každé jak daleko', async () => {
  const { d } = await search({ stopBy: 'km', intKm: 100, tolKm: 5, detour: 0.5, 'round-trip': false });
  const empty = d.querySelector('.tl.empty');
  assert.match(text(empty), /nejbližší/); assert.match(text(empty), /i když jsou daleko/);
  for (const alt of empty.querySelectorAll('.alt')) assert.match(text(alt), /(před oknem|za oknem|od trasy)/);
});
test('[R24][R7] souhrn řekne, že počítá se spotřebou naměřenou v autě', async () => {
  const setup = (w) => {
    const orig = w.fetch;
    w.fetch = async (url) => {
      const r = await orig(url);
      if (!String(url).startsWith('data/calibration.json')) return r;
      const j = await r.json();
      return { ok: true, json: async () => ({ ...j, cons_recent: { kwh_100km: 21.7, km: 600, days: 30, legs: 4 } }) };
    };
  };
  const { d } = await search({}, { setup });
  const note = text(d.querySelector('.summary-note'));
  assert.match(note, /21,7/); assert.match(note, /naměřen/);
});
test('[R24][R8] souhrn řekne, kolik stanic u trasy je skrytých', async () => {
  const hidden = [{ k: '49.28144,17.01991', lat: 49.28144, lon: 17.01991, name: 'MOL · E.ON · 240 kW', place: 'Vyškov' }];
  const { d } = await search({ hidden });
  assert.match(text(d.querySelector('.summary-note')), /skryt/);
});
test('[R24][R18] souhrn řekne, že odpočívadla v protisměru nenabízí', async () => {
  const { d } = await search({ 'round-trip': false });
  assert.match(text(d.querySelector('.summary-note')), /protisměr/);
});
test('[R24][R10] souhrn řekne, že odjezd zpět posunul, protože by ho nestihl', async () => {
  const { w } = await loadApp({ prefs: { places: [{ role: 'from', label: 'Ostrava', lat: 49.8209, lon: 18.2625 }, { role: 'to', label: 'Praha', lat: 50.0755, lon: 14.4378 }], 'round-trip': true, retTime: '09:00' } });
  const { submit } = await import('./harness.mjs');
  w.document.getElementById('depart').value = '2026-11-16T08:00';
  await submit(w);
  assert.match(text(w.document.querySelector('.summary-note')), /nestihneš/);
});
