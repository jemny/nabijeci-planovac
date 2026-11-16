// R14 / D18 (uživatel 16. 11. 2026): jedno dřív srovnávané auto je ze srovnání vyřazené i se svými údaji,
// i z nastavení, které si telefon uložil dřív.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from './harness.mjs';

const DEFAULT = ['Renault Talisman diesel', 'Benzínové auto'];

test('[R14] srovnání má jen Talisman a benzínové auto', async () => {
  const { d, api } = await search({ 'round-trip': false });
  const { o, plan: p } = api.lastRun();
  assert.equal(JSON.stringify(api.comparison(o, p).cars.map((c) => c.name)), JSON.stringify(DEFAULT));
  const rows = [...d.querySelectorAll('.card.compare tbody tr:not(.ev) th b')].map((b) => b.textContent);
  assert.equal(JSON.stringify(rows), JSON.stringify(DEFAULT));
  assert.equal(d.querySelectorAll('#cmp-box .cmp-car').length, 2, 'v ☰ → Srovnání s palivem jsou dvě auta');
});

test('[R14] seznam aut uložený v telefonu před 16. 11. se nahradí výchozím, ceny zůstanou (D18)', async () => {
  const old = { diesel: 45.5, petrol: 41, home: 6.2,
    cars: [{ name: 'Staré auto', fuel: 'diesel', l: 5.0 }, { name: 'Renault Talisman diesel', fuel: 'diesel', l: 6.5 }, { name: 'Benzínové auto', fuel: 'petrol', l: 8.0 }] };
  const { w, api } = await search({ 'round-trip': false, cmp: old });
  const { o, plan: p } = api.lastRun();
  const r = api.comparison(o, p);
  assert.equal(JSON.stringify(r.cars.map((c) => c.name)), JSON.stringify(DEFAULT), 'staré auto ve srovnání není');
  assert.equal(r.c.diesel, 45.5); assert.equal(r.c.petrol, 41); assert.equal(r.c.home, 6.2);
  const saved = JSON.parse(w.localStorage.getItem('np.prefs.v1'));
  assert.doesNotMatch(JSON.stringify(saved), /Staré auto/, 'staré auto zmizí i z uloženého nastavení');
  assert.equal(saved.cmp.diesel, 45.5, 'cena nafty zůstane uložená');
});

test('[R14] auta přejmenovaná po 16. 11. zůstanou (D18 se týká jen starého seznamu)', async () => {
  const mine = { cmpV: 2, cmp: { cars: [{ name: 'Moje Škoda', fuel: 'petrol', l: 6.0 }] } };
  const { api } = await search({ 'round-trip': false, ...mine });
  const { o, plan: p } = api.lastRun();
  assert.equal(JSON.stringify(api.comparison(o, p).cars.map((c) => c.name)), JSON.stringify(['Moje Škoda']));
});
