// R48 Stát se staršími daty (D24 datového vlákna: stát, který nejde stáhnout, použije data z minulého běhu;
// D25 = A, uživatel 16. 11. 2026): ☰ → O appce to řekne vždy, souhrn jen když trasa nebo zastávka vede tím státem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, search, ROUTES } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
// meta.json with the given per-country dates (the rest of the real file stays)
const withCountries = (countries) => (w) => {
  const real = w.fetch;
  w.fetch = async (u, o) => {
    const r = await real(u, o);
    if (!String(u).startsWith('data/meta.json')) return r;
    const j = await r.json();
    j.osm_countries = countries;
    return { ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) };
  };
};
const fresh = (d = '2026-11-16') => ({ date: d, fresh: true });
const old = (d = '2026-11-09') => ({ date: d, fresh: false });
const zilina = [{ role: 'from', ...ROUTES['ostrava-zilina'].from }, { role: 'to', ...ROUTES['ostrava-zilina'].to }];

test('[R48] ☰ → O appce: stát se staršími daty u řádku Data, čerstvé státy ne', async () => {
  const { w } = await loadApp({ setup: withCountries({ CZ: fresh(), SK: fresh(), PL: fresh(), AT: fresh(), DE: old() }) });
  const t = text(w.document.getElementById('data-date'));
  assert.match(t, /DE: data z 9\. 11\./);
  assert.doesNotMatch(t, /CZ: data z|SK: data z/);
});

test('[R48] všechno čerstvé: u řádku Data nic navíc', async () => {
  const { w } = await loadApp({ setup: withCountries({ CZ: fresh(), DE: fresh() }) });
  assert.doesNotMatch(text(w.document.getElementById('data-date')), /data z/);
});

test('[R48] souhrn: trasa po Česku o starých datech Německa mlčí', async () => {
  const { d } = await search({ 'round-trip': false }, { setup: withCountries({ CZ: fresh(), DE: old() }) });
  assert.doesNotMatch(text(d.querySelector('#summary .summary-note')), /data z/);
});

test('[R48] souhrn: trasa státem se staršími daty to řekne krátce', async () => {
  const { d } = await search({ 'round-trip': false }, { setup: withCountries({ CZ: old('2026-11-08'), DE: fresh() }) });
  assert.match(text(d.querySelector('#summary .summary-note')), /CZ: data z 8\. 11\./);
  const sk = await search({ places: zilina, 'round-trip': false }, { setup: withCountries({ CZ: fresh(), SK: old() }) });
  assert.match(text(sk.d.querySelector('#summary .summary-note')), /SK: data z 9\. 11\./, 'Ostrava → Žilina vede Slovenskem');
});

test('[R48] souhrn: údaj o datech končí jednou tečkou', async () => {
  const { d } = await search({ 'round-trip': false }, { setup: withCountries({ CZ: old('2026-11-08') }) });
  assert.doesNotMatch(text(d.querySelector('#summary .summary-note')), /\.\./);
});
