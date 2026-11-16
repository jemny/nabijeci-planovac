// R35 Data nabíječek, rozhodnutí D24 (uživatel vybral A, 16. 11. 2026): stát, jehož data OSM nejdou stáhnout
// ani ze záložních serverů, použije svoje data z posledního úspěšného běhu. meta.json u každého státu říká,
// ze kterého dne data jsou a jestli jsou čerstvá (appka to ukáže). Nalezeno: ruční běh 16. 11. 2026 stáhl 9 z 10
// souborů, u pump v Německu vracely všechny tři servery chyby a běh nestihl limit 60 minut.
// GitHub Actions si data OSM předává mezi běhy jako artefakt „osm-raw“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const node = (id) => ({ type: 'node', id, lat: 50.087, lon: 14.421, tags: { amenity: 'charging_station' } });
const NEW = { osm3s: { timestamp_osm_base: '2026-11-16T10:00:00Z' }, elements: [node(1), node(2)] };
const OLD = { osm3s: { timestamp_osm_base: '2026-11-09T03:20:00Z' }, elements: [node(1)] };

async function fakeServers() {
  const hits = [];
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      hits.push(req.url);
      if (req.url === '/down') { res.writeHead(502); res.end('<html>502 Bad Gateway</html>'); return; }
      if (req.url === '/timeout') { res.writeHead(200); res.end(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out' })); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(NEW));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { hits, url: (p) => base + p, close: () => new Promise((r) => srv.close(r)) };
}

function python(code) {
  return new Promise((resolve) => {
    const p = spawn('python3', ['-c', `import json, sys\nsys.path.insert(0, ${JSON.stringify(BUILD)})\nimport build_db\n${code}`], { timeout: 60000 });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => {
      const line = out.split('\n').find((l) => l.startsWith('RESULT '));
      resolve({ ok: c === 0, res: line ? JSON.parse(line.slice(7)) : null, out: out + err });
    });
  });
}

// downloads one file with the given servers; prev = what is in the file from the last run (object, string or none)
async function download(servers, { prev, deadlinePassed = false } = {}) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'osm-')), 'osm_charging_PL.json');
  if (prev !== undefined) writeFileSync(file, typeof prev === 'string' ? prev : JSON.stringify(prev));
  const r = await python(`
assert hasattr(build_db, "OSM_SOURCES"), "build_db nezapisuje, odkud jsou data OSM (OSM_SOURCES)"
build_db.OVERPASS_SERVERS = ${JSON.stringify(servers)}
build_db.time.sleep = lambda s: None
build_db.OVERPASS_DEADLINE = ${deadlinePassed ? '0' : 'None'}
data = build_db.overpass("[out:json];node(1);out;", ${JSON.stringify(file)}, True)
print("RESULT " + json.dumps({"n": len(data["elements"]), "src": build_db.OSM_SOURCES.get("osm_charging_PL.json")}))
`);
  let saved = null;
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none or not JSON */ }
  return { ...r, saved };
}

test('[R35] stahování OSM: když nejede žádný server, použijí se data státu z minulého běhu a zapíše se, že nejsou čerstvá', async () => {
  const s = await fakeServers();
  try {
    const r = await download([s.url('/down'), s.url('/timeout')], { prev: OLD });
    assert.ok(r.ok, r.out);
    assert.equal(r.res.n, 1, 'data z minulého běhu');
    assert.deepEqual(r.res.src, { fresh: false, date: '2026-11-09' });
    assert.deepEqual(r.saved, OLD, 'minulá data zůstanou beze změny');
    assert.ok(s.hits.length >= 2, 'nejdřív se zkoušejí servery');
  } finally { await s.close(); }
});

test('[R35] stahování OSM: když server odpoví, jsou data čerstvá a minulá se přepíšou', async () => {
  const s = await fakeServers();
  try {
    const r = await download([s.url('/down'), s.url('/ok')], { prev: OLD });
    assert.ok(r.ok, r.out);
    assert.equal(r.res.n, 2);
    assert.deepEqual(r.res.src, { fresh: true, date: '2026-11-16' });
    assert.deepEqual(r.saved, NEW);
  } finally { await s.close(); }
});

test('[R35] stahování OSM: minulá data s chybou serveru se nepoužijí a běh skončí chybou', async () => {
  const s = await fakeServers();
  try {
    const r = await download([s.url('/down')], { prev: JSON.stringify({ elements: [], remark: 'runtime error: Query timed out' }) });
    assert.equal(r.ok, false, r.out);
    assert.match(r.out, /Overpass failed/);
  } finally { await s.close(); }
});

test('[R35] stahování OSM: po vyčerpání času na stahování se rovnou použijí minulá data', async () => {
  const s = await fakeServers();
  try {
    const r = await download([s.url('/ok')], { prev: OLD, deadlinePassed: true });
    assert.ok(r.ok, r.out);
    assert.deepEqual(s.hits, [], 'po vyčerpání času se servery už neptají');
    assert.deepEqual(r.res.src, { fresh: false, date: '2026-11-09' });
  } finally { await s.close(); }
});

test('[R35] stahování OSM: po vyčerpání času bez minulých dat se servery pořád zkoušejí', async () => {
  const s = await fakeServers();
  try {
    const r = await download([s.url('/ok')], { deadlinePassed: true });
    assert.ok(r.ok, r.out);
    assert.deepEqual(s.hits, ['/ok']);
    assert.deepEqual(r.res.src, { fresh: true, date: '2026-11-16' });
  } finally { await s.close(); }
});

test('[R35] data OSM po státech: datum je to starší z nabíječek a pump, čerstvé jen když jsou čerstvé obě', async () => {
  const r = await python(`
src = {"osm_charging_CZ.json": {"fresh": True, "date": "2026-11-16"}, "osm_fuel_CZ.json": {"fresh": True, "date": "2026-11-16"},
       "osm_charging_DE.json": {"fresh": True, "date": "2026-11-16"}, "osm_fuel_DE.json": {"fresh": False, "date": "2026-11-09"}}
print("RESULT " + json.dumps(build_db.osm_countries(src, ["CZ", "DE"])))
`);
  assert.ok(r.ok, r.out);
  assert.deepEqual(r.res, { CZ: { date: '2026-11-16', fresh: true }, DE: { date: '2026-11-09', fresh: false } });
});

test('[R35] meta.json: u každého státu je datum dat OSM a jestli jsou čerstvá', () => {
  const meta = JSON.parse(readFileSync(path.join(ROOT, 'app', 'data', 'meta.json'), 'utf8'));
  assert.ok(meta.osm_countries, 'meta.json nemá osm_countries');
  assert.deepEqual(Object.keys(meta.osm_countries).sort(), ['AT', 'CZ', 'DE', 'PL', 'SK']);
  for (const [cc, v] of Object.entries(meta.osm_countries)) {
    assert.match(v.date, /^\d{4}-\d{2}-\d{2}$/, cc);
    assert.equal(typeof v.fresh, 'boolean', cc);
  }
});

const yml = readFileSync(path.join(ROOT, '.github', 'workflows', 'update-data.yml'), 'utf8');
const jobs = yml.split(/\njobs:\n/)[1] || '';
const job = (name) => (jobs.split(/\n(?= {2}[\w-]+:\n)/).find((j) => j.trimStart().startsWith(`${name}:`)) || '');

test('[R35] aktualizace dat: před stahováním vezme data OSM z minulého běhu a po něm je uloží, i když běh selže', () => {
  const b = job('build-data');
  const restore = b.indexOf('osm-raw'), build = b.indexOf('build_db.py');
  assert.ok(restore >= 0 && restore < build, 'data z minulého běhu (artefakt osm-raw) se obnoví před stahováním');
  const up = b.slice(b.indexOf('actions/upload-artifact'));
  assert.ok(b.includes('actions/upload-artifact'), 'data OSM se uloží jako artefakt');
  assert.match(up, /name:\s*osm-raw/);
  assert.match(up, /if:\s*always\(\)|always\(\)/, 'uloží se i po neúspěšném běhu (co se stáhlo, to se příště hodí)');
  assert.ok(+(up.match(/retention-days:\s*(\d+)/) || [])[1] >= 30, 'artefakt vydrží aspoň 30 dní');
  assert.match(yml, /actions:\s*read/, 'běh smí číst artefakty');
});

test('[R35] aktualizace dat: stahování neblokuje nasazení appky (zámek „pages“ jen u nasazení)', () => {
  const head = yml.split(/\njobs:\n/)[0];
  assert.doesNotMatch(head, /concurrency:/, 'zámek nad celým během blokuje nasazení, dokud se stahují data');
  assert.match(job('deploy'), /concurrency:[\s\S]*?group:\s*pages/);
  assert.doesNotMatch(job('build-data'), /group:\s*pages/);
});

test('[R35] aktualizace dat: pondělní běh není naplánovaný na celou hodinu', () => {
  const cron = yml.match(/cron:\s*"([^"]+)"/)[1].split(/\s+/);
  assert.notEqual(cron[0], '0', 'GitHub pouští běhy v celou hodinu se zpožděním (16. 11. 2026 skoro 8 h)');
  assert.equal(cron[4], '1', 'pořád v pondělí');
});
