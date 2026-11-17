// R45 nálezy nezávislé kontroly (16. 11. 2026): (3) cesta za ~15 dní žádala o předpověď za den, který Open-Meteo
// nemá (end_date nejvýš dnes + 15); (8) vzdálenost 3 km se měřila před zaokrouhlením, poslaný bod mohl být blíž;
// (9) varování na cestě zpět počítalo km od startu celé cesty, karty zastávek zpět je počítají od cíle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search, weatherBody, ROUTES, wait } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
async function settled(d) {
  for (let i = 0; i < 100 && /Načítám/.test(text(d.getElementById('wx-note'))); i++) await wait(20);
  return text(d.getElementById('wx-note'));
}
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const km = (a, b) => {
  const R = 6371, p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((b.lon - a.lon) * Math.PI / 360) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

test('[R45] cesta za 15 dní: dotaz nechce den za hranicí předpovědi (nejvýš dnes + 15)', async () => {
  const day = new Date(Date.now() + 15 * 864e5);
  const { w, d } = await search({ 'round-trip': false }, { depart: `${ymd(day)}T06:00` });
  await settled(d);
  const urls = w.__wxUrls || [];
  assert.equal(urls.length, 1, 'dotaz se pošle');
  const q = new URL(urls[0]).searchParams;
  assert.ok(q.get('end_date') <= ymd(day), `end_date ${q.get('end_date')} je nejvýš ${ymd(day)}`);
  assert.ok(q.get('start_date') <= q.get('end_date'));
});

test('[R45] každý poslaný (zaokrouhlený) bod je aspoň 3 km vzdušnou čarou od startu i cíle', async () => {
  const { w, d } = await search({ 'round-trip': true });
  await settled(d);
  const q = new URL(w.__wxUrls[0]).searchParams;
  const lats = q.get('latitude').split(','), lons = q.get('longitude').split(',');
  const { from, to } = ROUTES['ostrava-praha'];
  lats.forEach((la, i) => {
    const p = { lat: +la, lon: +lons[i] };
    assert.ok(km(p, from) >= 3 && km(p, to) >= 3, `bod ${la},${lons[i]}: ${km(p, from).toFixed(2)} km od startu, ${km(p, to).toFixed(2)} km od cíle`);
  });
});

test('[R45] varování na cestě zpět počítá km od cíle jako karty zastávek zpět', async () => {
  const back = Date.parse('2026-11-16T15:30:00') / 1000;      // the way back leaves at 16:00 (and later)
  const setup = (w) => { w.__weather = (u) => weatherBody(u, (i, t) => (t >= back ? { code: 45 } : {})); };
  const { d, api } = await search({ 'round-trip': true }, { setup });
  const t = await settled(d);
  assert.match(t, /mlha/);
  assert.match(t, /cesty zpět/);
  const D = api.lastRun().plan.D;
  const nums = [...t.matchAll(/(\d[\d\s ]*)\. km cesty zpět|mezi (\d+)\. a (\d+)\. km cesty zpět/g)].flatMap((m) => m.slice(1).filter(Boolean)).map((x) => +x.replace(/\s/g, ''));
  assert.ok(nums.length, `km u varování zpět (${t})`);
  for (const n of nums) assert.ok(n <= D + 1, `km ${n} cesty zpět je od cíle (cesta má ${D.toFixed(0)} km)`);
});

// Nahlášená chyba (datové vlákno 17. 11. 2026): ráno v 8:15 UTC se pro odjezd dnes + 15 dní v 6:00 dotaz na počasí
// neposlal. Appka brala hranici předpovědi jako „teď + 15 × 24 h“, Open-Meteo ale má celý den dnes + 15.
test('[R45] poslední den předpovědi: dotaz se pošle i ráno, rozhoduje den, ne hodina', async () => {
  const now = new Date('2026-11-17T08:15:00').getTime();
  const setup = (w) => { w.Date.now = () => now; };
  const { w, d } = await search({ 'round-trip': false }, { depart: '2026-12-02T06:00', setup });
  await settled(d);
  const urls = w.__wxUrls || [];
  assert.equal(urls.length, 1, 'dotaz se pošle (2. 12. je dnes + 15 dní)');
  assert.equal(new URL(urls[0]).searchParams.get('end_date'), '2026-12-02', 'nejvýš dnes + 15');
});
