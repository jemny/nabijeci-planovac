// R35 Data nabíječek: data pro R44 (D10 = A, poplatek za minuty) a R46 (D9 = B, zavřená pumpa).
// stations.json má sloupec „oh“ = otevírací doba (OSM opening_hours) té pumpy, která je u stanice jako „fuel“.
// cards.json a prices.json mají u pásma „free_min“ (minuty zdarma od začátku nabíjení) a „czk_min“ (Kč za každou další
// minutu ve dne), „czk_min_night“ jen tam, kde je noc jiná. Jen z ověřených ceníků, jinde pole chybí:
//   E.ON Drive ceník od 18. 6. 2026 (eon-drive.cz), ČEZ ceník od 1. 11. 2026 (cez.cz / futurego.cz),
//   PRE POINT ceník od 1. 12. 2025 a PRE roaming od 1. 7. 2026 (pre.cz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = (n) => JSON.parse(readFileSync(path.join(ROOT, 'app', 'data', n), 'utf8'));

function python(code) {
  return new Promise((resolve) => {
    const p = spawn('python3', ['-c', code], { timeout: 60000 });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => resolve({ ok: c === 0, out, err }));
  });
}

test('[R35] otevírací doba: stanice dostane otevírací dobu té pumpy, kterou má jako pumpu', async () => {
  // a generic CNG stand is nearer, the branded MOL pump 30 m further is the station's pump (and its hours)
  const r = await python(`
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'build'))})
import build_db
assert hasattr(build_db, "attach_pumps"), "build_db nemá funkci attach_pumps (párování stanice s pumpou)"
st = [{"lat": 50.0, "lon": 14.0}, {"lat": 50.1, "lon": 14.1}, {"lat": 50.2, "lon": 14.2}]
pumps = [
  {"lat": 50.0002, "lon": 14.0, "brand": "CNG", "opening_hours": "24/7"},
  {"lat": 50.0005, "lon": 14.0, "brand": "MOL", "opening_hours": "Mo-Su 06:00-22:00"},
  {"lat": 50.2003, "lon": 14.2, "brand": "Shell", "opening_hours": None},
]
build_db.attach_pumps(st, pumps)
print("RESULT " + json.dumps([[s["fuel_brand"], s["fuel_oh"]] for s in st]))
`);
  assert.ok(r.ok, r.err);
  const got = JSON.parse(r.out.split('\n').find((l) => l.startsWith('RESULT ')).slice(7));
  assert.deepEqual(got, [['MOL', 'Mo-Su 06:00-22:00'], [null, null], ['Shell', null]]);
});

test('[R35] stations.json: sloupec „oh“ má otevírací dobu pumpy u stanice z OSM', () => {
  const st = data('stations.json');
  const oh = st.cols.indexOf('oh'), fuel = st.cols.indexOf('fuel');
  assert.ok(oh >= 0, 'stations.json nemá sloupec oh');
  let withFuel = 0, withOh = 0;
  for (const r of st.rows) {
    assert.equal(r.length, st.cols.length);
    if (r[fuel] == null) assert.equal(r[oh], null, 'bez pumpy není otevírací doba');
    else withFuel++;
    if (r[oh] != null) { assert.equal(typeof r[oh], 'string'); assert.ok(r[oh].trim().length > 0); withOh++; }
  }
  // OSM has hours for 40–59 % of all pumps in CZ/SK/PL/AT/DE (16. 11. 2026); a share near zero means a broken export
  assert.ok(withOh / withFuel >= 0.35, `otevírací doba jen u ${withOh} z ${withFuel} stanic s pumpou`);
});

const card = (id) => data('cards.json').cards.find((c) => c.id === id);
const fees = (tiers) => tiers.map((t) => [t.free_min, t.czk_min]);

test('[R35] cards.json: poplatek za minuty v síti E.ON podle ceníku od 18. 6. 2026', () => {
  for (const id of ['eon', 'eon-adhoc']) {
    const t = card(id).own['E.ON'];
    assert.deepEqual(fees(t), [[120, 2], [60, 2], [30, 2]], id);
    assert.equal(t[0].czk_min_night, 0, `${id}: do 100 kW se v noci minuty neplatí`);
    assert.equal(t[1].czk_min_night, undefined);
    assert.equal(t[2].czk_min_night, undefined);
  }
});

test('[R35] cards.json: poplatek za minuty ČEZ (od 1. 11. 2026) a PRE (od 1. 12. 2025, roaming od 1. 7. 2026)', () => {
  for (const id of ['cez-basic', 'cez-standard', 'cez-premium']) assert.deepEqual(fees(card(id).own['ČEZ']), [[90, 2], [45, 2]], id);
  assert.deepEqual(fees(card('pre-start').own.PRE), [[60, 2], [30, 2]]);
  for (const id of ['pre-silver', 'pre-gold']) assert.deepEqual(fees(card(id).own.PRE), [[60, 1], [30, 2]], id);
  assert.deepEqual(fees(card('pre-platinum').own.PRE), [[90, 1], [60, 2]]);
  const roam = card('pre-start').roam, abroad = card('pre-start').abroad;
  assert.deepEqual(fees(roam['E.ON']), [[60, 3], [45, 4]]);
  assert.deepEqual(fees(roam['ČEZ']), [[60, 2], [60, 2]]);
  assert.deepEqual(fees(roam.IONITY), [[60, 3]]);
  assert.deepEqual(fees(roam['Teplárny Brno']), [[60, 1], [60, 1]]);
  assert.deepEqual(fees(roam.Lidl), [[60, 1]]);
  assert.deepEqual(fees(roam.Shell), [[45, 2]]);
  assert.deepEqual(fees(roam.Chargee), [[90, 2], [60, 2]]);
  assert.deepEqual(fees(roam.ORLEN), [[undefined, undefined]], 'ORLEN v roamingu PRE poplatek nemá');
  assert.deepEqual(fees(abroad.GreenWay), [[60, 3]]);
  assert.deepEqual(fees(abroad.Shell), [[45, 2]]);
  assert.deepEqual(fees(abroad['ZSE Drive']), [[undefined, undefined], [undefined, undefined]]);
});

test('[R35] cards.json: poplatek za minuty jen z ověřeného ceníku, free_min a czk_min vždy spolu', () => {
  const verified = new Set(['eon', 'eon-adhoc', 'cez-basic', 'cez-standard', 'cez-premium', 'pre-start', 'pre-silver', 'pre-gold', 'pre-platinum']);
  for (const c of data('cards.json').cards) {
    for (const where of ['own', 'roam', 'abroad', 'anywhere']) {
      const v = c[where];
      if (!v) continue;
      const lists = Array.isArray(v) ? [v] : Object.values(v).filter(Boolean);
      for (const t of lists.flat()) {
        const has = 'free_min' in t || 'czk_min' in t;
        if (!verified.has(c.id)) assert.equal(has, false, `${c.id}: poplatek bez ověřeného ceníku`);
        if (!has) continue;
        assert.ok(Number.isInteger(t.free_min) && t.free_min >= 0, `${c.id}: free_min`);
        assert.ok(typeof t.czk_min === 'number' && t.czk_min > 0, `${c.id}: czk_min`);
      }
    }
  }
  assert.match(data('cards.json').source, /poplatk/i, 'zdroj poplatků je uvedený');
});

test('[R35] prices.json: stejné poplatky za minuty u E.ON, ČEZ a PRE', () => {
  const n = data('prices.json').networks;
  assert.deepEqual(fees(n['E.ON'].tiers), [[120, 2], [60, 2], [30, 2]]);
  assert.equal(n['E.ON'].tiers[0].czk_min_night, 0);
  assert.deepEqual(fees(n['ČEZ'].tiers), [[90, 2], [45, 2]]);
  assert.deepEqual(fees(n.PRE.tiers), [[60, 2], [30, 2]]);
  assert.deepEqual(fees(n.ORLEN.tiers), [[undefined, undefined]]);
});
