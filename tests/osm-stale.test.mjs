// R35 Data nabíječek. Nalezeno 17. 11. 2026 v nočním běhu: záložní server overpass.private.coffee má mapu z 31. 5. 2026.
// Data Rakouska z něj přepsala data z 15. 11. a v meta.json byla jako čerstvá. Odpověď se starší mapou se proto
// nepoužije: když je starší než data z minulého běhu, nebo o víc než 2 dny starší než nejnovější mapa, kterou už v tomto
// běhu poslal jiný server. Takový server se do konce běhu přeskakuje.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString().replace(/\.\d+Z$/, 'Z');
const DAY = 864e5;
const answer = (base, n = 1) => ({ osm3s: { timestamp_osm_base: base }, elements: Array.from({ length: n }, (_, i) => ({ type: 'node', id: i + 1, lat: 47.5, lon: 14.5, tags: {} })) });

async function fakeServers(routes) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      hits.push(req.url);
      const body = routes[req.url];
      if (!body) { res.writeHead(502); res.end('<html>502</html>'); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { hits, url: (p) => base + p, close: () => new Promise((r) => srv.close(r)) };
}

function python(code) {
  return new Promise((resolve) => {
    const p = spawn('python3', ['-c', `import json, sys, os\nsys.path.insert(0, ${JSON.stringify(BUILD)})\nimport build_db\nbuild_db.time.sleep = lambda s: None\n${code}`], { timeout: 60000 });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => {
      const line = out.split('\n').find((l) => l.startsWith('RESULT '));
      resolve({ ok: c === 0, res: line ? JSON.parse(line.slice(7)) : null, out: out + err });
    });
  });
}

const fetchFiles = (servers, names, dir) => python(`
build_db.OVERPASS_SERVERS = ${JSON.stringify(servers)}
out = []
for n in ${JSON.stringify(names)}:
    d = build_db.overpass("q", os.path.join(${JSON.stringify(dir)}, n), True)
    out.append([len(d["elements"]), build_db.OSM_SOURCES[n]])
print("RESULT " + json.dumps(out))
`);

test('[R35] stahování OSM: odpověď o měsíce starší než od jiného serveru se nepoužije a ten server se pak přeskakuje', async () => {
  const now = iso(3600e3), may = '2026-05-31T20:00:00Z';
  const s = await fakeServers({ '/main-cz': answer(now, 2), '/stale': answer(may, 5), '/main': answer(now, 3) });
  try {
    const dir = mkdtempSync(path.join(tmpdir(), 'osm-'));
    // CZ from the main server sets the newest map of this run; then the main server refuses AT once
    const r = await python(`
build_db.OVERPASS_SERVERS = [${JSON.stringify(s.url('/main-cz'))}]
build_db.overpass("q", os.path.join(${JSON.stringify(dir)}, "osm_charging_CZ.json"), True)
build_db.OVERPASS_SERVERS = [${JSON.stringify(s.url('/down'))}, ${JSON.stringify(s.url('/stale'))}, ${JSON.stringify(s.url('/main'))}]
out = []
for n in ("osm_charging_AT.json", "osm_fuel_AT.json"):
    d = build_db.overpass("q", os.path.join(${JSON.stringify(dir)}, n), True)
    out.append(len(d["elements"]))
print("RESULT " + json.dumps(out))
`);
    assert.ok(r.ok, r.out);
    assert.deepEqual(r.res, [3, 3], 'data jsou ze serveru s aktuální mapou');
    assert.deepEqual(s.hits, ['/main-cz', '/down', '/stale', '/main', '/down', '/main'], 'zastaralý server se po prvním zjištění už neptá');
  } finally { await s.close(); }
});

test('[R35] stahování OSM: data se nevrátí ke starší mapě, než měl minulý běh, použijí se data z minula', async () => {
  const prevBase = iso(3600e3), older = iso(2 * DAY);
  const s = await fakeServers({ '/older': answer(older, 7) });
  try {
    const dir = mkdtempSync(path.join(tmpdir(), 'osm-'));
    writeFileSync(path.join(dir, 'osm_charging_AT.json'), JSON.stringify(answer(prevBase, 4)));
    const r = await fetchFiles([s.url('/older')], ['osm_charging_AT.json'], dir);
    assert.ok(r.ok, r.out);
    assert.equal(r.res[0][0], 4, 'zůstanou data z minulého běhu');
    assert.deepEqual(r.res[0][1], { fresh: false, date: prevBase.slice(0, 10) });
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'osm_charging_AT.json'), 'utf8')).elements.length, 4, 'soubor se nepřepíše');
  } finally { await s.close(); }
});

test('[R35] stahování OSM: mapa o pár hodin starší od jiného serveru je v pořádku', async () => {
  const s = await fakeServers({ '/a': answer(iso(600e3), 2), '/b': answer(iso(5 * 3600e3), 6) });
  try {
    const dir = mkdtempSync(path.join(tmpdir(), 'osm-'));
    const r = await python(`
build_db.OVERPASS_SERVERS = [${JSON.stringify(s.url('/a'))}]
build_db.overpass("q", os.path.join(${JSON.stringify(dir)}, "osm_charging_CZ.json"), True)
build_db.OVERPASS_SERVERS = [${JSON.stringify(s.url('/b'))}]
d = build_db.overpass("q", os.path.join(${JSON.stringify(dir)}, "osm_fuel_CZ.json"), True)
print("RESULT " + json.dumps(len(d["elements"])))
`);
    assert.ok(r.ok, r.out);
    assert.equal(r.res, 6);
  } finally { await s.close(); }
});
