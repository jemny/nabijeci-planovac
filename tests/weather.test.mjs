// R45 Varování před počasím na trase (D7 = B, uživatel 16. 11. 2026): mlha, sníh, mrznoucí déšť a náledí podle
// předpovědi Open-Meteo v čase, kdy tam pojedeš. Spotřebu nemění. Body zaokrouhlené na 0,01°, bez prvních
// a posledních 3 km trasy (adresa domova se neposílá).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search, weatherBody, ROUTES, wait } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const note = (d) => d.getElementById('wx-note');
async function settled(d) {
  for (let i = 0; i < 100 && /Načítám/.test(text(note(d))); i++) await wait(20);
  return text(note(d));
}
const km = (a, b) => {
  const R = 6371, p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((b.lon - a.lon) * Math.PI / 360) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

test('[R45] dotaz na počasí: body zaokrouhlené na 0,01°, žádný blíž než 3 km vzdušnou čarou od startu a cíle, jen tvoje datum', async () => {
  const { w, d } = await search({ 'round-trip': true });
  await settled(d);
  const urls = w.__wxUrls || [];
  assert.equal(urls.length, 1, 'jeden dotaz na Open-Meteo');
  const q = new URL(urls[0]).searchParams;
  const lats = q.get('latitude').split(','), lons = q.get('longitude').split(',');
  assert.ok(lats.length >= 5, `bodů na trase: ${lats.length}`);
  for (const v of [...lats, ...lons]) assert.match(v, /^-?\d+(\.\d{1,2})?$/, `souřadnice ${v} je zaokrouhlená na 0,01°`);
  const { from, to } = ROUTES['ostrava-praha'];
  lats.forEach((la, i) => {
    const p = { lat: +la, lon: +lons[i] };
    assert.ok(km(p, from) > 2 && km(p, to) > 2, `bod ${la},${lons[i]} je dál než 3 km od startu i cíle (po zaokrouhlení aspoň 2 km)`);
  });
  assert.ok(!urls[0].includes('49.8209') && !urls[0].includes('18.2625'), 'přesný start se neposílá');
  assert.equal(q.get('start_date') <= '2026-11-16' && q.get('end_date') >= '2026-11-16', true, 'datum cesty');
});

test('[R45] bez mlhy, sněhu a náledí souhrn řekne, že je počasí v pořádku', async () => {
  const { d } = await search({ 'round-trip': false });
  assert.match(await settled(d), /bez mlhy, sněhu a náledí/);
});

test('[R45] mlha a náledí: souhrn řekne co, kde (km) a kdy; plán se nezmění', async () => {
  const clear = await search({ 'round-trip': true });
  await settled(clear.d);
  const setup = (w) => {
    w.__weather = (u) => weatherBody(u, (i) => (i === 1 ? { code: 45 } : i === 3 ? { temp: -2, prec: 0.4, code: 61 } : {}));
  };
  const { d, api } = await search({ 'round-trip': true }, { setup });
  const t = await settled(d);
  assert.match(t, /mlha/); assert.match(t, /náledí/);
  assert.match(t, /\d+\. km/, 'místo jako km trasy');
  assert.match(t, /kolem \d{1,2}:\d{2}/, 'čas průjezdu');
  assert.match(t, /−2 °C|-2 °C/, 'u náledí teplota');
  assert.match(t, /Spotřebu to nemění/);
  assert.ok(note(d).classList.contains('warn'), 'varování je zvýrazněné');
  const a = api.lastRun().plan, b = clear.api.lastRun().plan;
  const targets = (p) => Array.from(p.stops.filter((s) => !s.empty), (s) => Math.round(s.target));   // two jsdom windows → plain arrays
  assert.deepEqual(targets(a), targets(b), 'stejné nabíjení');
  assert.equal(Math.round(a.socEnd), Math.round(b.socEnd), 'stejná baterie na konci');
});

test('[R45] předpověď nejde načíst: souhrn to řekne', async () => {
  const setup = (w) => { w.__weather = () => { throw new Error('Open-Meteo nejede'); }; };
  const { d } = await search({ 'round-trip': false }, { setup });
  assert.match(await settled(d), /nepodařilo načíst/);
});

test('[R45] cesta za víc než 16 dní: předpověď ještě není, souhrn to řekne a nic se neposílá', async () => {
  const later = new Date(Date.now() + 20 * 864e5);
  const pad = (n) => String(n).padStart(2, '0');
  const depart = `${later.getFullYear()}-${pad(later.getMonth() + 1)}-${pad(later.getDate())}T08:00`;
  const { w, d } = await search({ 'round-trip': false }, { depart });
  assert.match(await settled(d), /16 dní/);
  assert.equal((w.__wxUrls || []).length, 0);
});
