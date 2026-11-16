// R35 Data nabíječek, D24: nálezy nezávislé kontroly (16. 11. 2026) ke stahování z OSM a k workflow.
// - useknutá odpověď serveru shodila celý běh, prázdná odpověď by smazala celý stát,
// - čas na stahování šel překročit (dotaz čekal 300 s i po konci času, reset spojení zkoušel ještě curl),
// - po vypršení času bez dat z minula se zkoušely všechny 4 kola, takže běh nestihl 60 minut,
// - když se nepovedlo uložit artefakt, přeskočilo se i uložení nových dat,
// - obnova vzala jen nejnovější artefakt, i když v něm soubor chyběl,
// - push mohl nasadit commit s daty, který ještě neprošel testy.
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
const GOOD = { osm3s: { timestamp_osm_base: '2026-11-16T10:00:00Z' }, elements: [{ type: 'node', id: 1, lat: 50.087, lon: 14.421, tags: { amenity: 'fuel' } }] };

async function fakeServers() {
  const hits = [];
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      hits.push(req.url);
      if (req.url.startsWith('/down')) { res.writeHead(502); res.end('<html>502</html>'); return; }
      if (req.url === '/empty') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ osm3s: { timestamp_osm_base: '2026-11-16T10:00:00Z' }, elements: [] }));
        return;
      }
      if (req.url === '/truncated') {  // promises 100 kB, sends a little and closes the connection
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': '100000' });
        res.write('{"osm3s": {}, "elements": [');
        setTimeout(() => res.socket.destroy(), 50);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(GOOD));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { hits, url: (p) => base + p, close: () => new Promise((r) => srv.close(r)) };
}

function python(code) {
  return new Promise((resolve) => {
    const p = spawn('python3', ['-c', `import json, sys, time\nsys.path.insert(0, ${JSON.stringify(BUILD)})\nimport build_db\n${code}`], { timeout: 60000 });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => {
      const line = out.split('\n').find((l) => l.startsWith('RESULT '));
      resolve({ ok: c === 0, res: line ? JSON.parse(line.slice(7)) : null, out: out + err });
    });
  });
}

const download = (servers, deadlinePassed = false) => python(`
build_db.OVERPASS_SERVERS = ${JSON.stringify(servers)}
build_db.time.sleep = lambda s: None
build_db.OVERPASS_DEADLINE = ${deadlinePassed ? '0' : 'None'}
data = build_db.overpass("[out:json];node(1);out;", ${JSON.stringify(path.join(mkdtempSync(path.join(tmpdir(), 'osm-')), 'osm_fuel_DE.json'))}, True)
print("RESULT " + json.dumps(len(data["elements"])))
`);

test('[R35] stahování OSM: useknutá odpověď serveru nezastaví běh, zkusí se další server', async () => {
  const s = await fakeServers();
  try {
    const r = await download([s.url('/truncated'), s.url('/ok')]);
    assert.ok(r.ok, r.out);
    assert.equal(r.res, 1);
    assert.deepEqual(s.hits, ['/truncated', '/ok']);
  } finally { await s.close(); }
});

test('[R35] stahování OSM: prázdná odpověď (žádné stanice ani pumpy ve státě) se nepoužije, zkusí se další server', async () => {
  const s = await fakeServers();
  try {
    const r = await download([s.url('/empty'), s.url('/ok')]);
    assert.ok(r.ok, r.out);
    assert.equal(r.res, 1, 'stát nesmí zůstat bez dat kvůli prázdné odpovědi');
    assert.deepEqual(s.hits, ['/empty', '/ok']);
  } finally { await s.close(); }
});

test('[R35] stahování OSM: po vyčerpání času bez dat z minula se každý server zkusí jen jednou a běh skončí chybou', async () => {
  const s = await fakeServers();
  try {
    const r = await download([s.url('/down1'), s.url('/down2')], true);
    assert.equal(r.ok, false);
    assert.match(r.out, /Overpass failed/);
    assert.deepEqual(s.hits, ['/down1', '/down2'], 'jedno kolo, aby běh skončil v limitu a stažené se uložilo');
  } finally { await s.close(); }
});

test('[R35] stahování OSM: s daty z minula čeká jeden dotaz nejvýš do konce času na stahování', async () => {
  const r = await python(`
assert hasattr(build_db, "_request_timeout"), "build_db nemá _request_timeout (čas na jeden dotaz)"
build_db.OVERPASS_DEADLINE = time.monotonic() + 100
with_prev, without_prev = build_db._request_timeout(True), build_db._request_timeout(False)
build_db.OVERPASS_DEADLINE = None
print("RESULT " + json.dumps([with_prev, without_prev, build_db._request_timeout(True), build_db.OVERPASS_TIMEOUT, build_db.OVERPASS_BUDGET_S]))
`);
  assert.ok(r.ok, r.out);
  const [withPrev, withoutPrev, noDeadline, full, budget] = r.res;
  assert.ok(withPrev <= 100 && withPrev >= 60, `s daty z minula: ${withPrev} s`);
  assert.equal(withoutPrev, full, 'bez dat z minula dostane dotaz celý čas');
  assert.equal(noDeadline, full);
  assert.ok(budget <= 30 * 60, `čas na stahování ${budget} s nechá dost času na zbytek běhu (limit 60 min)`);
});

test('[R35] stahování OSM: reset spojení zkusí další server, curl jen u chyby TLS', async () => {
  const r = await python(`
import ssl, urllib.error
calls = []
def fake_run(*a, **k):
    calls.append("curl")
    class R: stdout = b'{"elements": [1]}'
    return R()
build_db.subprocess.run = fake_run
def raise_(e):
    def f(*a, **k): raise e
    return f
build_db.urllib.request.urlopen = raise_(urllib.error.URLError(ConnectionResetError("reset")))
reset = build_db._overpass_post("http://127.0.0.1:9/", "q")
build_db.urllib.request.urlopen = raise_(urllib.error.URLError(ssl.SSLError("handshake")))
tls = build_db._overpass_post("http://127.0.0.1:9/", "q")
print("RESULT " + json.dumps([reset.decode(), tls.decode(), calls]))
`);
  assert.ok(r.ok, r.out);
  assert.deepEqual(r.res, ['', '{"elements": [1]}', ['curl']]);
});

const yml = readFileSync(path.join(ROOT, '.github', 'workflows', 'update-data.yml'), 'utf8');
const jobs = yml.split(/\njobs:\n/)[1] || '';
const job = (name) => (jobs.split(/\n(?= {2}[\w-]+:\n)/).find((j) => j.trimStart().startsWith(`${name}:`)) || '');

test('[R35] aktualizace dat: když se nepovede uložit artefakt, nová data se stejně uloží', () => {
  const b = job('build-data');
  const up = b.slice(b.indexOf('actions/upload-artifact'));
  assert.match(up.split(/\n {6}- /)[0], /continue-on-error:\s*true/, 'chyba artefaktu nesmí přeskočit export a uložení dat');
  assert.match(up.split(/\n {6}- /)[0], /overwrite:\s*true/, 'opakovaný pokus („Re-run“) artefakt přepíše');
});

test('[R35] aktualizace dat: data z minula se složí z několika posledních artefaktů, novější přepíše starší', () => {
  const b = job('build-data');
  const restore = b.slice(0, b.indexOf('build_db.py'));
  assert.match(restore, /sort_by\(\.created_at\)/);
  assert.match(restore, /\bfor\b[\s\S]*unzip -o/, 'rozbalí se postupně několik artefaktů od nejstaršího');
});

test('[R35] aktualizace dat: nasadí se jen commit, který prošel testy', () => {
  assert.match(job('test'), /outputs:[\s\S]*sha:/, 'test řekne, který commit otestoval');
  assert.match(job('deploy'), /needs\.test\.outputs\.sha/, 'nasazení porovná main s otestovaným commitem');
});
