// R37 Každá koruna se dá dohledat. Nahlášená chyba (uživatel 16. 11. 2026): na zastávce „natankuju za 455 Kč“,
// nahoře „455 Kč za proud“, ale srovnání píše, že cesta stojí 953 Kč („někde počítáš s tím, že budu ještě nabíjet,
// ale neukazuješ to“). Rozdíl je elektřina z domu (baterie nabitá doma před cestou), appka ale neřekla, odkud je.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ') : '');
const num = (s) => Number(String(s).replace(/[\s  ]/g, '').replace(',', '.'));
// every "N Kč" in a text (not "Kč/kWh"), as numbers; Czech thousands use a (narrow) no-break space
const amounts = (s) => [...s.matchAll(/(\d{1,3}(?:[\s  ]\d{3})*)\s*Kč(?!\/)/g)].map((m) => num(m[1]));
const has = (s, n) => amounts(s).some((a) => Math.abs(a - n) <= 1);

async function plan() {
  const r = await search({ 'round-trip': false }, { soc0: 100 });
  const { d, api } = r;
  const charging = [...d.querySelectorAll('.stop-card')].filter((c) => c.querySelector('.tiles3'))
    .map((c) => ({ name: c.querySelector('h3').firstChild.textContent.trim(), czk: amounts(text(c.querySelector('.tiles3 .tile:nth-child(2) b')))[0] }));
  assert.ok(charging.length >= 1, 'Ostrava → Praha ze 100 % má aspoň jednu nabíjecí zastávku');
  const { o, plan: p } = api.lastRun();
  return { ...r, charging, cmp: api.comparison(o, p), card: d.querySelector('.card.compare') };
}

test('[R37] srovnání: cena elektra = nabíjení na zastávkách (jménem a cenou jako v kartách) + elektřina z domu', async () => {
  const { charging, card } = await plan();
  const row = card.querySelector('tr.ev'), all = text(card);
  const total = amounts(text(row.querySelector('td')))[0];
  const pub = charging.reduce((a, c) => a + c.czk, 0);
  for (const c of charging) {
    assert.ok(all.includes(c.name), `ve srovnání chybí zastávka ${c.name}`);
    assert.ok(has(all, c.czk), `ve srovnání chybí cena zastávky ${c.name} ${c.czk} Kč`);
  }
  const home = amounts(text(row.querySelector('th small'))).find((a) => Math.abs(a + pub - total) <= 2);
  assert.ok(home != null, `řádek Elektro (${text(row)}) nerozepíše ${total} Kč na zastávky ${pub} Kč + elektřinu z domu`);
});

test('[R37] elektřina z domu: řekne, že je to baterie ze startu, kolik % a kWh a za kolik Kč/kWh', async () => {
  const { card, cmp } = await plan();
  const all = text(card), soc0 = 100, end = Math.round(cmp.socEnd);
  const kwhBat = (soc0 - cmp.socEnd) / 100 * 85, kwhSocket = kwhBat / (1 - 0.1);
  assert.match(all, new RegExp(`${soc0} % na startu → ${end} % v cíli`), 'odkud je elektřina z domu (baterie start → cíl)');
  assert.match(all, new RegExp(`${soc0 - end} %`), 'kolik % baterie to je');
  assert.match(all, new RegExp(`${Math.round(kwhBat)} kWh v baterii`), 'kolik kWh v baterii');
  assert.match(all, new RegExp(`${Math.round(kwhSocket)} kWh ze zásuvky`), 'kolik kWh ze zásuvky i se ztrátami');
  assert.match(all, /6,61 Kč\/kWh/, 'cena elektřiny doma');
  assert.ok(has(all, cmp.homeCzk), `částka za elektřinu z domu ${Math.round(cmp.homeCzk)} Kč`);
});

test('[R37] souhrn nahoře: Kč za proud je jen nabíjení na cestě a vedle je celá cena cesty jako ve srovnání', async () => {
  const { d, charging, cmp } = await plan();
  const box = d.getElementById('summary');
  const pub = charging.reduce((a, c) => a + c.czk, 0);
  const tile = [...box.querySelectorAll('.tile')].find((t) => has(text(t.querySelector('b')), pub));
  assert.ok(tile, `dlaždice s ${pub} Kč za proud`);
  assert.match(text(tile.querySelector('span')), /na cestě/, 'dlaždice řekne, že je to jen nabíjení na cestě');
  const note = text(box.querySelector('.summary-note'));
  assert.ok(has(note, cmp.ev), `souhrn uvede celou cenu cesty ${Math.round(cmp.ev)} Kč (srovnání ukazuje stejnou)`);
  assert.ok(has(note, cmp.homeCzk), `souhrn uvede elektřinu z domu ${Math.round(cmp.homeCzk)} Kč`);
  assert.match(note, /z domu/, 'souhrn řekne, že rozdíl je elektřina z domu');
});
