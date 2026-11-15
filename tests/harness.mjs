// Loads the real app (index.html + app.js + app/data/*.json) into jsdom. OSRM is answered from tests/fixtures,
// so every run plans exactly the same routes; the station data is the live app/data (tests check rules, not names).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TextEncoder, TextDecoder } from 'node:util';
import { JSDOM } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..', 'app');
const FIX = path.join(HERE, 'fixtures');

export const ROUTES = {
  'ostrava-praha': { from: { label: 'Ostrava', lat: 49.8209, lon: 18.2625 }, to: { label: 'Praha', lat: 50.0755, lon: 14.4378 } },
  'ostrava-brno': { from: { label: 'Ostrava', lat: 49.8209, lon: 18.2625 }, to: { label: 'Brno', lat: 49.1951, lon: 16.6068 } },
  'ostrava-zilina': { from: { label: 'Ostrava', lat: 49.8209, lon: 18.2625 }, to: { label: 'Žilina', lat: 49.2231, lon: 18.7394 } },
  'praha-ostrava': { from: { label: 'Praha', lat: 50.0755, lon: 14.4378 }, to: { label: 'Ostrava', lat: 49.8209, lon: 18.2625 } },
};
const key = (p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
const byCoords = Object.fromEntries(Object.entries(ROUTES).map(([name, r]) => [`${key(r.from)};${key(r.to)}`, name]));

function response(body, ok = true) {
  return { ok, status: ok ? 200 : 404, json: async () => body, text: async () => JSON.stringify(body) };
}

export async function loadApp({ prefs = {}, url = 'https://planovac.test/', storage = null } = {}) {
  const html = readFileSync(path.join(APP, 'index.html'), 'utf8')
    .replace(/<script src="app\.js"[^>]*><\/script>/, '')          // we run app.js ourselves, after the stubs
    .replace(/<link[^>]+fonts\.googleapis[^>]*>/g, '');
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.Element.prototype.scrollIntoView = function () {};
  w.confirm = () => true;                       // "Smazat cestu?" etc.
  w.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith('data/')) return response(JSON.parse(readFileSync(path.join(APP, u.split('?')[0]), 'utf8')));
    if (u.includes('router.project-osrm.org')) {
      const coords = u.split('/driving/')[1].split('?')[0];
      const name = byCoords[coords];
      if (!name) throw new Error(`no route fixture for ${coords}`);
      return response(JSON.parse(readFileSync(path.join(FIX, `route-${name}.json`), 'utf8')));
    }
    if (u.startsWith('version.json')) return response({ version: 'test' });
    throw new Error(`unexpected fetch in tests: ${u}`);
  };
  w.localStorage.setItem('np.prefs.v1', JSON.stringify(prefs));
  for (const [k, v] of Object.entries(storage || {})) w.localStorage.setItem(k, v);   // e.g. saved trips
  w.__NP_TEST__ = {};
  w.eval(readFileSync(path.join(APP, 'app.js'), 'utf8'));
  const api = w.__NP_TEST__;
  await api.ready;
  return { w, api };
}

// Same shape as readOptions() in app.js; tests override what they need.
export function options(over = {}) {
  const depart = new Date('2026-11-16T08:00:00');
  const retDepart = new Date('2026-11-16T16:00:00');
  return { depart, retDepart, byKm: false, interval: 60, tol: 15, soc0: 100, detourKm: 1.5, atPump: true, roundTrip: false,
    onlyFav: false, myCards: true, unknownKw: false, minKw: 100, cons: 23.8, tempo: 0.93, reserve: 10, carLimit: 80, ...over };
}

export async function plan(api, routeName, o) {
  const r = ROUTES[routeName];
  const raw = await api.route([r.from, r.to]);
  const rt = api.withTempo(raw, o.tempo);
  const cands = api.candidates(rt, o);
  return { rt, cands, plan: api.makePlan(rt, cands, o) };
}
