// R35 Data nabíječek, rozhodnutí D26 (uživatel 16. 11. 2026: „dělej to po kusech, neomezuj se na 30 minut“ a v noci).
// Ruční běhy 16. 11. 2026: dotaz na celé Německo (nabíječky 19 MB) hlavní server odmítal hned (502), záložní
// servery nechaly dotaz 5 minut čekat. Teď:
// - Německo se stahuje po 9 obdélnících mapy (3 × 3), ostatní státy celé,
// - soubory, které nejdou, se zkoušejí znovu v dalších kolech, dokud nevyprší čas (hodiny, ne 30 minut),
// - server, jehož dotaz dlouho čekal a pak selhal, se na chvíli přeskočí,
// - každou noc se běh pustí znovu, když poslední stahování selhalo nebo má některý stát jen data z minula.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const el = (id) => ({ type: 'node', id, lat: 50.1, lon: 8.6, tags: { amenity: 'fuel' } });
const answer = (ids) => ({ osm3s: { timestamp_osm_base: '2026-11-16T22:00:00Z' }, elements: ids.map(el) });

async function fakeServers() {
  const hits = [];
  let flaky = 0;
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      hits.push(req.url);
      if (req.url === '/down') { res.writeHead(502); res.end('<html>502</html>'); return; }
      if (req.url === '/slow') { setTimeout(() => { res.writeHead(504); res.end('<html>504</html>'); }, 200); return; }
      if (req.url === '/flaky' && ++flaky <= 3) { res.writeHead(502); res.end('<html>502</html>'); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer([1, 2])));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { hits, url: (p) => base + p, close: () => new Promise((r) => srv.close(r)) };
}

function python(code) {
  return new Promise((resolve) => {
    const p = spawn('python3', ['-c', `import json, sys, os, time\nsys.path.insert(0, ${JSON.stringify(BUILD)})\nimport build_db\nbuild_db.time.sleep = lambda s: None\n${code}`], { timeout: 60000 });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => {
      const line = out.split('\n').find((l) => l.startsWith('RESULT '));
      resolve({ ok: c === 0, res: line ? JSON.parse(line.slice(7)) : null, out: out + err });
    });
  });
}
const tmp = () => mkdtempSync(path.join(tmpdir(), 'osm-'));

test('[R35] Německo se stahuje po 9 kusech mapy, které ho celé pokryjí, ostatní státy celé', async () => {
  const r = await python(`
assert hasattr(build_db, "tiles"), "build_db nemá tiles (kusy státu)"
de = build_db.tiles("DE")
print("RESULT " + json.dumps({"de": de, "cz": build_db.tiles("CZ"), "q": build_db.q_amenity("DE", "fuel", de[0][1]), "qcz": build_db.q_amenity("CZ", "fuel")}))
`);
  assert.ok(r.ok, r.out);
  const { de, cz, q, qcz } = r.res;
  assert.equal(de.length, 9);
  assert.deepEqual(de.map((t) => t[0]), ['-1', '-2', '-3', '-4', '-5', '-6', '-7', '-8', '-9']);
  // together they cover Germany (OSM data 15. 11. 2026: lat 47.38–55.02, lon 5.88–15.00) without gaps
  const s = Math.min(...de.map((t) => t[1][0])), w = Math.min(...de.map((t) => t[1][1]));
  const n = Math.max(...de.map((t) => t[1][2])), e = Math.max(...de.map((t) => t[1][3]));
  assert.ok(s <= 47.38 && w <= 5.88 && n >= 55.02 && e >= 15.0, `pokrytí ${s},${w},${n},${e}`);
  const area = de.reduce((a, t) => a + (t[1][2] - t[1][0]) * (t[1][3] - t[1][1]), 0);
  assert.ok(Math.abs(area - (n - s) * (e - w)) < 1e-6, 'kusy se nepřekrývají a nemají mezery');
  assert.deepEqual(cz, [['', null]]);
  assert.ok(q.includes(`(area.a)(${de[0][1].join(',')})`), q);
  assert.ok(qcz.includes('(area.a);'), qcz);
});

test('[R35] kusy jednoho státu se spojí: prvek na hranici kusů jen jednou, datum to starší', async () => {
  const r = await python(`
a = {"osm3s": {"timestamp_osm_base": "2026-11-16T22:00:00Z"}, "elements": [{"type": "way", "id": 7}, {"type": "node", "id": 1}]}
b = {"osm3s": {"timestamp_osm_base": "2026-11-16T21:00:00Z"}, "elements": [{"type": "way", "id": 7}, {"type": "node", "id": 7}]}
m = build_db.merge_parts([a, b])
print("RESULT " + json.dumps([m["osm3s"]["timestamp_osm_base"], [[e["type"], e["id"]] for e in m["elements"]]]))
`);
  assert.ok(r.ok, r.out);
  assert.deepEqual(r.res, ['2026-11-16T21:00:00Z', [['way', 7], ['node', 1], ['node', 7]]]);
});

test('[R35] data OSM po státech počítají i kusy Německa', async () => {
  const r = await python(`
src = {"osm_charging_DE-1.json": {"fresh": True, "date": "2026-11-16"}, "osm_charging_DE-2.json": {"fresh": False, "date": "2026-11-09"},
       "osm_fuel_DE-1.json": {"fresh": True, "date": "2026-11-16"}, "osm_fuel_DE.json": {"fresh": True, "date": "2026-11-16"}}
print("RESULT " + json.dumps(build_db.osm_countries(src, ["DE"])))
`);
  assert.ok(r.ok, r.out);
  assert.deepEqual(r.res, { DE: { date: '2026-11-09', fresh: false } });
});

test('[R35] stahování: soubor, který nejde, se zkouší znovu v dalších kolech, dokud nevyprší čas', async () => {
  const s = await fakeServers();
  try {
    const d = tmp();
    const r = await python(`
assert hasattr(build_db, "download_all"), "build_db nemá download_all (opakovaná kola)"
build_db.OVERPASS_SERVERS = [${JSON.stringify(s.url('/flaky'))}]
build_db.OVERPASS_DEADLINE = time.monotonic() + 60
res = build_db.download_all({os.path.join(${JSON.stringify(d)}, "osm_fuel_DE-1.json"): "q"}, True)
print("RESULT " + json.dumps([len(v["elements"]) for v in res.values()]))
`);
    assert.ok(r.ok, r.out);
    assert.deepEqual(r.res, [2]);
    assert.equal(s.hits.length, 4, 'tři odmítnutí, čtvrtý pokus vyjde (v dalším kole)');
  } finally { await s.close(); }
});

test('[R35] stahování: po vypršení času soubor s daty z minula je použije, soubor bez nich běh zastaví', async () => {
  const s = await fakeServers();
  try {
    const d = tmp();
    const r = await python(`
build_db.OVERPASS_SERVERS = [${JSON.stringify(s.url('/down'))}]
build_db.OVERPASS_DEADLINE = 0
old = os.path.join(${JSON.stringify(d)}, "osm_fuel_DE-1.json")
open(old, "w").write(json.dumps({"osm3s": {"timestamp_osm_base": "2026-11-09T03:00:00Z"}, "elements": [{"type": "node", "id": 1}]}))
res = build_db.download_all({old: "q"}, True)
out = [len(res[old]["elements"]), build_db.OSM_SOURCES["osm_fuel_DE-1.json"]]
try:
    build_db.download_all({os.path.join(${JSON.stringify(d)}, "osm_fuel_DE-2.json"): "q"}, True)
    out.append("no error")
except RuntimeError as e:
    out.append("Overpass failed" if "Overpass failed" in str(e) else str(e))
print("RESULT " + json.dumps(out))
`);
    assert.ok(r.ok, r.out);
    assert.deepEqual(r.res, [1, { fresh: false, date: '2026-11-09' }, 'Overpass failed']);
  } finally { await s.close(); }
});

test('[R35] stahování: server, jehož dotaz dlouho čekal a pak selhal, se na chvíli přeskočí', async () => {
  const s = await fakeServers();
  try {
    const d = tmp();
    const r = await python(`
assert hasattr(build_db, "SLOW_FAIL_S"), "build_db nemá SLOW_FAIL_S (pomalé selhání)"
build_db.SLOW_FAIL_S = 0.1
build_db.OVERPASS_SERVERS = [${JSON.stringify(s.url('/slow'))}, ${JSON.stringify(s.url('/ok'))}]
for n in ("osm_fuel_DE-1.json", "osm_fuel_DE-2.json"):
    build_db.overpass("q", os.path.join(${JSON.stringify(d)}, n), True)
print("RESULT 1")
`);
    assert.ok(r.ok, r.out);
    assert.deepEqual(s.hits, ['/slow', '/ok', '/ok'], 'druhý soubor už pomalý server nečeká');
  } finally { await s.close(); }
});

const yml = readFileSync(path.join(ROOT, '.github', 'workflows', 'update-data.yml'), 'utf8');
const jobs = yml.split(/\njobs:\n/)[1] || '';
const job = (name) => (jobs.split(/\n(?= {2}[\w-]+:\n)/).find((j) => j.trimStart().startsWith(`${name}:`)) || '');

test('[R35] aktualizace dat: každou noc se běh pustí znovu, jen když je co opakovat', () => {
  const crons = [...yml.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1].split(/\s+/));
  assert.ok(crons.some((c) => c[4] === '1'), 'pondělní běh zůstává');
  assert.ok(crons.some((c) => c[2] === '*' && c[3] === '*' && c[4] === '*' && c[0] !== '0'), 'noční běh každý den, ne v celou hodinu');
  const b = job('build-data');
  const need = b.indexOf('id: need'), dl = b.indexOf('build_db.py');
  assert.ok(need >= 0 && need < dl, 'před stahováním se zjistí, jestli je co opakovat');
  const step = b.slice(need, dl);
  assert.match(step, /Stáhnout data a postavit databázi/, 'podívá se, jak dopadlo poslední stahování');
  assert.match(step, /fresh/, 'a jestli má některý stát jen data z minula (osm_countries)');
  assert.match(step, /workflow_dispatch/, 'ruční spuštění stahuje vždy');
  assert.match(b, /if:\s*steps\.need\.outputs\.run == 'yes'[\s\S]*build_db\.py/, 'stahování běží jen když je potřeba');
  assert.match(job('test'), /needs\.build-data\.outputs\.run != 'no'/, 'prázdný noční běh nespouští testy ani nasazení');
});

test('[R35] aktualizace dat: na stahování jsou hodiny, ne 30 minut, a běh to stihne', () => {
  const minutes = +(job('build-data').match(/timeout-minutes:\s*(\d+)/) || [])[1];
  assert.ok(minutes >= 240 && minutes <= 360, `limit jobu ${minutes} min (GitHub dovolí nejvýš 360)`);
});

// Nezávislá kontrola D26: 16. 11. 2026 bylo 30 posledních dokončených běhů z 24 push běhů, takže noční krok
// poslední stahování nenašel a stahoval by zbytečně. A běh čekající ve frontě stahoval z commitu, kdy byl naplánovaný,
// takže se při ukládání střetl s daty předchozího běhu.
test('[R35] aktualizace dat: noční běh hledá poslední stahování jen mezi běhy s daty, push běhy ho nezakryjí', () => {
  const b = job('build-data');
  const step = b.slice(b.indexOf('id: need'), b.indexOf('build_db.py'));
  assert.match(step, /event=schedule/, 'naplánované běhy se hledají přímo');
  assert.match(step, /event=workflow_dispatch/, 'ruční běhy taky');
});

test('[R35] aktualizace dat: stahování začíná z aktuálního main, ne z commitu, kdy byl běh naplánovaný', () => {
  const b = job('build-data');
  const checkout = b.slice(b.indexOf('actions/checkout'), b.indexOf('id: need'));
  assert.match(checkout, /ref:\s*main/);
});
