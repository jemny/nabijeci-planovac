// R35 Data nabíječek, rozhodnutí D28 (uživatel vybral C, 16. 11. 2026): služby u stanice jen z údajů pumpy, bez nových
// dotazů na OpenStreetMap. stations.json má sloupec „svc“ (pro ikony v plánovacím vlákně): písmena v tomto pořadí
// w = WC (toilets=yes|customers), f = jídlo (cuisine, food/fast_food/cafe/restaurant=yes), s = obchod (shop, ne „no“),
// u té pumpy, která je u stanice jako „fuel“. Bez pumpy nebo bez údajů null.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function python(code) {
  return new Promise((resolve) => {
    const p = spawn('python3', ['-c', `import json, sys\nsys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'build'))})\nimport build_db\n${code}`], { timeout: 60000 });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => {
      const line = out.split('\n').find((l) => l.startsWith('RESULT '));
      resolve({ ok: c === 0, res: line ? JSON.parse(line.slice(7)) : null, out: out + err });
    });
  });
}

test('[R35] služby u stanice: WC, jídlo a obchod z údajů té pumpy, která je u stanice', async () => {
  const r = await python(`
pump = lambda i, lat, **tags: {"type": "node", "id": i, "lat": lat, "lon": 14.0, "tags": dict(amenity="fuel", brand="MOL", **tags)}
pumps = build_db.parse_fuel([
  pump(1, 50.0, toilets="yes", shop="convenience"),
  pump(2, 50.1, toilets="customers", cuisine="coffee_shop"),
  pump(3, 50.2, toilets="no", shop="no"),
  pump(4, 50.3, fast_food="yes"),
  pump(5, 50.4),
])
st = [{"lat": p["lat"], "lon": 14.0} for p in pumps] + [{"lat": 51.0, "lon": 15.0}]
build_db.attach_pumps(st, pumps)
assert "fuel_svc" in st[0], "stanice nemá fuel_svc (služby pumpy)"
print("RESULT " + json.dumps([s["fuel_svc"] for s in st]))
`);
  assert.ok(r.ok, r.out);
  assert.deepEqual(r.res, ['ws', 'wf', null, 'f', null, null]);
});

test('[R35] stations.json: sloupec „svc“ se službami pumpy u stanice', () => {
  const st = JSON.parse(readFileSync(path.join(ROOT, 'app', 'data', 'stations.json'), 'utf8'));
  const svc = st.cols.indexOf('svc'), fuel = st.cols.indexOf('fuel');
  assert.ok(svc >= 0, 'stations.json nemá sloupec svc');
  let withFuel = 0, withSvc = 0;
  for (const r of st.rows) {
    if (r[fuel] == null) assert.equal(r[svc], null, 'bez pumpy nejsou služby');
    else withFuel++;
    if (r[svc] != null) { assert.match(r[svc], /^(?=.)w?f?s?$/, `svc „${r[svc]}“`); withSvc++; }
  }
  // OSM 15. 11. 2026: WC nebo obchod má uvedené 1–13 % pump podle státu; nula znamená rozbitý export
  assert.ok(withSvc / withFuel >= 0.03, `služby jen u ${withSvc} z ${withFuel} stanic s pumpou`);
});
