// R35 Data nabíječek. Nahlášená chyba (16. 11. 2026): pondělní aktualizace selhala, protože hlavní server
// OpenStreetMap (Overpass) 19 minut vracel 502/504. Rozhodnutí D19 (uživatel vybral A): když hlavní server
// nejede, stahování zkusí záložní servery. Chybová odpověď se nikdy neuloží jako data.
// Test spouští skutečnou funkci overpass() z build/build_db.py proti falešným serverům na tomto počítači (bez internetu).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');
const GOOD = { osm3s: { timestamp_osm_base: '2026-11-16T10:00:00Z' }, elements: [{ type: 'node', id: 1, lat: 50.087, lon: 14.421, tags: { amenity: 'charging_station' } }] };

// fake Overpass servers: /down = 502 HTML page, /timeout = JSON with a runtime error and no data, /ok = real data
async function fakeServers() {
  const hits = [];
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      hits.push(req.url);
      if (req.url === '/down') { res.writeHead(502, { 'content-type': 'text/html' }); res.end('<html><body>502 Bad Gateway</body></html>'); return; }
      if (req.url === '/timeout') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ osm3s: {}, elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 241 seconds.' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(GOOD));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { hits, url: (p) => base + p, close: () => new Promise((r) => srv.close(r)) };
}

// runs build_db.overpass() with the given server list; waits between retries are skipped
function download(servers, file) {
  const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(BUILD)})
import build_db
assert hasattr(build_db, "OVERPASS_SERVERS"), "build_db nemá seznam záložních serverů OVERPASS_SERVERS"
build_db.OVERPASS_SERVERS = ${JSON.stringify(servers)}
build_db.time.sleep = lambda s: None
data = build_db.overpass("[out:json];node(1);out;", ${JSON.stringify(file)}, True)
print("RESULT " + json.dumps(data))
`;
  // async: the fake servers live in this process and must keep answering while Python runs
  return new Promise((resolve) => {
    const p = spawn('python3', ['-c', py], { timeout: 60000 });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      const line = out.split('\n').find((l) => l.startsWith('RESULT '));
      resolve({ ok: code === 0, data: line ? JSON.parse(line.slice(7)) : null, out: out + err });
    });
  });
}

const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), 'osm-')), 'osm_charging_PL.json');

test('[R35] stahování OSM: když hlavní server nejede (502), data přijdou ze záložního', async () => {
  const s = await fakeServers();
  try {
    const file = tmpFile();
    const r = await download([s.url('/down'), s.url('/ok')], file);
    assert.ok(r.ok, r.out);
    assert.equal(r.data.elements.length, 1, 'data ze záložního serveru');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), GOOD, 'uložená jsou data ze záložního serveru');
    assert.deepEqual(s.hits, ['/down', '/ok'], 'nejdřív hlavní server, pak záložní');
  } finally { await s.close(); }
});

test('[R35] stahování OSM: když hlavní server jede, záložní se neptá', async () => {
  const s = await fakeServers();
  try {
    const r = await download([s.url('/ok'), s.url('/down')], tmpFile());
    assert.ok(r.ok, r.out);
    assert.deepEqual(s.hits, ['/ok']);
  } finally { await s.close(); }
});

test('[R35] stahování OSM: odpověď s chybou serveru (vypršel čas, žádná data) se neuloží a zkusí se záložní', async () => {
  const s = await fakeServers();
  try {
    const file = tmpFile();
    const r = await download([s.url('/timeout'), s.url('/ok')], file);
    assert.ok(r.ok, r.out);
    assert.equal(r.data.elements.length, 1, 'stát nesmí zůstat bez stanic kvůli chybě serveru');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), GOOD);
  } finally { await s.close(); }
});

test('[R35] stahování OSM: když nejede žádný server, běh skončí chybou a nic neuloží', async () => {
  const s = await fakeServers();
  try {
    const file = tmpFile();
    const r = await download([s.url('/down'), s.url('/timeout')], file);
    assert.equal(r.ok, false, 'běh nesmí projít bez dat');
    assert.match(r.out, /Overpass failed/);
    assert.equal(existsSync(file), false, 'chybová odpověď se neuloží jako data');
    assert.ok(s.hits.filter((h) => h === '/down').length >= 2, 'zkouší se opakovaně, ne jen jednou');
  } finally { await s.close(); }
});
