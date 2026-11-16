// Nálezy nezávislé kontroly (16. 11. 2026) k vzhledu a přístupnosti: (6) posuvník Nabít do ztratil po jednom kroku
// fokus (klávesnice, VoiceOver); (7) uložená cesta neměla v grafu pruhy oken; (10) baterie u příjezdu chyběla
// u nabíjecích zastávek, objížďka ztratila vysvětlení, „nastavil jsi“ ukazovalo příjezd místo tvého čísla.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, search, ROUTES, wait } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const real = (api) => api.lastRun().plan.stops.filter((s) => !s.empty);
const cards = (d) => [...d.querySelectorAll('.stop-card')];
const btn = (root, re) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent));
const praha = [{ role: 'from', ...ROUTES['ostrava-praha'].from }, { role: 'to', ...ROUTES['ostrava-praha'].to }];
function slide(w, input, value) {
  input.value = String(value);
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
}

test('[R39] posuvník Nabít do zůstane po kroku zaměřený a čtečka slyší hodnotu v %', async () => {
  const { w, d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const i = real(api).findIndex((s) => s.kwh > 0);
  const r = cards(d)[i].querySelector('input.charge-to');
  assert.match(r.getAttribute('aria-valuetext') || '', /^\d+ %$/);
  r.focus();
  slide(w, r, +r.value + 1);
  const now = d.activeElement;
  assert.ok(now && now.matches('input.charge-to'), `fokus je na ${now && now.tagName}`);
  assert.equal(now, cards(d)[i].querySelector('input.charge-to'), 'na posuvníku té samé zastávky');
  assert.equal(now.getAttribute('aria-valuetext'), `${now.value} %`);
  btn(cards(d)[i], /Vrátit na plán/).click();
  assert.ok(d.activeElement && d.activeElement.matches('input.charge-to'), 'po Vrátit na plán je fokus zase na posuvníku');
});

test('[R39] tvoje číslo pod příjezdem: karta ho ukáže a řekne, že přijedeš s víc', async () => {
  const { w, d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const i = real(api).findIndex((s) => s.kwh > 0);
  const k = i + 1;   // the next stop: set its number just above its arrival, then charge more before it
  const mine = Math.round(real(api)[k].arrive) + 3;
  slide(w, cards(d)[k].querySelector('input.charge-to'), mine);
  slide(w, cards(d)[i].querySelector('input.charge-to'), Math.min(100, Math.round(real(api)[i].target) + 25));
  const st = real(api)[k];
  assert.ok(st.arrive > mine + 1, `na další zastávku teď přijedeš s ${st.arrive.toFixed(0)} %, víc než tvých ${mine} %`);
  const t = text(cards(d)[k].querySelector('.why'));
  assert.match(t, new RegExp(`nastavil jsi ${mine} %`), t);
  assert.match(t, /přijedeš už s/, t);
});

test('[R40] otevřená uložená cesta má v grafu pruhy oken jako nová', async () => {
  const { w, d } = await search({ 'round-trip': true }, { soc0: 100 });
  const before = d.querySelectorAll('#summary rect.soc-win').length;
  assert.ok(before >= 2, `nová cesta: pruhů ${before}`);
  btn(d.querySelector('.card.trip'), /Uložit cestu/).click();
  const storage = { 'np.trips.v1': w.localStorage.getItem('np.trips.v1') };
  const fresh = await loadApp({ prefs: { places: praha }, storage });
  const d2 = fresh.w.document;
  d2.querySelector('#trips-list .trip-open').click();
  for (let k = 0; k < 100 && !d2.querySelector('#results .timeline'); k++) await wait();
  const after = d2.querySelectorAll('#summary rect.soc-win').length;
  assert.ok(after >= real(fresh.api).length, `otevřená cesta: pruhů ${after}, zastávek ${real(fresh.api).length}`);
});

test('[R43] nabíjecí zastávka: baterie u příjezdu i v pruhu baterie', async () => {
  const { d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const i = real(api).findIndex((s) => s.kwh > 0);
  const arr = cards(d)[i].querySelector('.bar-legend .bl-arr');
  assert.ok(arr.querySelector('svg.ic.ic-batt'), 'ikona baterie u „přijedeš“');
  assert.match(text(arr), /přijedeš\s*\d+ %/);
});

test('[R41] objížďka: pod tlačítky je vysvětlení vybrané hodnoty', async () => {
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  const hint = d.querySelector('.presets[data-for="detour"] ~ .preset-hint');
  assert.ok(hint, 'vysvětlení objížďky');
  assert.match(text(hint), /sjezdy z dálnice/);
  [...d.querySelectorAll('.presets[data-for="detour"] .chip')].find((c) => /^0,5 km$/.test(text(c))).click();
  assert.match(text(hint), /jen přímo u trasy/);
});

test('[R41] posuvníky ve formuláři čtečka pojmenuje podle nadpisu pole (i při Jedu jinudy)', async () => {
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  for (const id of ['soc0', 'reserve', 'reserve-dest']) {
    const r = d.querySelector(`input[type=range][data-for="${id}"]`);
    const ref = r.getAttribute('aria-labelledby');
    assert.ok(ref && d.getElementById(ref), `${id}: posuvník má aria-labelledby`);
    assert.equal(d.getElementById(ref), d.getElementById(id).closest('label').querySelector('span'), `${id}: odkazuje na nadpis pole`);
  }
});
