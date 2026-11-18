// R52 Chybějící cena (uživatel 18. 11. 2026: „když nemáme všechny ceny, tak nemůžeme říkat, kolik bude stát celá
// cesta peněz“). Zastávka bez ceny se nepočítá jako 0 Kč; souhrn i srovnání ji jmenují a celek neukazují jako přesný.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const real = (api) => api.lastRun().plan.stops.filter((s) => !s.empty);
// price list without any IONITY price: an IONITY stop then has no price (as IONITY in Slovakia today)
const noIonityPrice = (w) => {
  const realFetch = w.fetch;
  w.fetch = async (u, o) => {
    const r = await realFetch(u, o);
    if (!String(u).startsWith('data/cards.json')) return r;
    const j = await r.json();
    for (const c of j.cards) for (const k of ['own', 'roam', 'abroad']) if (c[k]) delete c[k].IONITY;
    return { ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) };
  };
};
async function plan() {
  const r = await search({ 'round-trip': true }, { soc0: 100, setup: noIonityPrice });
  const st = real(r.api).find((s) => s.kwh > 0 && (s.cost == null || s.est));
  assert.ok(st, 'v plánu je nabíjecí zastávka bez ceny (IONITY)');
  return { ...r, st };
}
const amounts = (s) => [...s.matchAll(/(\d{1,3}(?:[\s  ]\d{3})*)\s*Kč(?!\/)/g)].map((m) => Number(m[1].replace(/[\s  ]/g, '')));

test('[R52] souhrn: celou cenu neukáže jako přesnou a řekne, která zastávka je bez ceny', async () => {
  const { d, api, st } = await plan();
  const note = text(d.querySelector('#summary .summary-note'));
  assert.ok(note.includes(st.c.s.fuel || 'Stanice'), `souhrn jmenuje zastávku bez ceny (${note})`);
  assert.doesNotMatch(note, /Celá cesta \d[\d\s  ]* Kč,/, `celá cena není jako přesné číslo (${note})`);
  const tile = [...d.querySelectorAll('#summary .tile')].find((t) => /na cestě/.test(text(t)));
  assert.doesNotMatch(text(tile.querySelector('b')), /^\d[\d\s  ]* Kč$/, `dlaždice není jako přesná částka (${text(tile)})`);
  assert.ok(api.lastRun().plan.priceUnknown || api.lastRun().plan.priceEstimated);
});

test('[R52] srovnání: elektro bez přesné ceny a bez tvrzení, o kolik je levnější nebo dražší', async () => {
  const { d, st } = await plan();
  const cmp = d.querySelector('.card.compare');
  const ev = text(cmp.querySelector('tr.ev td'));
  assert.doesNotMatch(ev, /^\d[\d\s  ]* Kč$/, `řádek Elektro není jako přesná částka (${ev})`);
  assert.ok(text(cmp).includes(st.c.s.fuel || 'Stanice'), 'srovnání jmenuje zastávku bez ceny');
  assert.doesNotMatch(text(cmp), /Elektro vychází o \d/, 'žádné „vychází o X Kč levněji“ z neúplné ceny');
});

test('[R52] když jsou všechny ceny, nic se nemění: přesná celá cena jako dřív', async () => {
  const { d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  assert.equal(api.lastRun().plan.priceUnknown, false);
  assert.match(text(d.querySelector('#summary .summary-note')), /Celá cesta \d[\d\s  ]* Kč, z toho/);
});

// D30 = B (uživatel 18. 11. 2026): cena se odhadne podle stejné sítě v ČR a označí „~“.
// IONITY stations moved to Slovakia: abroad the price is unknown, in CZ IONITY has a price with your cards.
const ionityInSK = (w) => {
  const realFetch = w.fetch;
  w.fetch = async (u, o) => {
    const r = await realFetch(u, o);
    if (!String(u).startsWith('data/stations.json')) return r;
    const j = await r.json();
    const op = j.cols.indexOf('op'), cc = j.cols.indexOf('cc');
    for (const row of j.rows) if (row[op] === 'IONITY') row[cc] = 'SK';
    return { ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) };
  };
};

test('[R52] odhad podle stejné sítě v ČR: karta „~N Kč“, souhrn řekne odhadem kolik a podle čeho, srovnání „~“ a „asi o“', async () => {
  const { d, api } = await search({ 'round-trip': true }, { soc0: 100, setup: ionityInSK });
  const stops = real(api), i = stops.findIndex((s) => s.est);
  assert.ok(i >= 0, 'zastávka s odhadnutou cenou');
  const st = stops[i];
  const cz = api.price({ ...st.c.s, cc: 'CZ' }, st.at);
  assert.equal(st.est.unit, cz.czk, `odhad ${st.est.unit} Kč/kWh = cena IONITY v ČR ${cz.czk}`);
  assert.ok(Math.abs(st.cost - st.kwh * cz.czk) < 0.01);
  const card = d.querySelectorAll('.stop-card')[i];
  assert.equal(text(card.querySelector('.tiles3 .tile:nth-child(2) b')), `~${Math.round(st.cost).toLocaleString('cs-CZ')} Kč`.replace(/\s+/g, ' '));
  const note = text(d.querySelector('#summary .summary-note'));
  assert.match(note, /Celá cesta ~\d/);
  assert.ok(note.includes(st.c.s.fuel), 'souhrn jmenuje zastávku s odhadem');
  assert.match(note, /odhadem 19,95 Kč\/kWh jako IONITY v ČR/);
  assert.match(text([...d.querySelectorAll('#summary .tile b')].find((b) => /Kč/.test(text(b)))), /^~/);
  const cmp = d.querySelector('.card.compare');
  assert.match(text(cmp.querySelector('tr.ev td')), /^~\d/);
  assert.match(text(cmp), /Elektro vychází asi o \d/);
});

test('[R52] síť bez ceny ani v ČR: odhad podle nejdražší zastávky s cenou na téže cestě', async () => {
  const { d, api } = await search({ 'round-trip': true }, { soc0: 100, setup: noIonityPrice });
  const stops = real(api), st = stops.find((s) => s.est);
  assert.ok(st, 'zastávka s odhadem');
  const max = Math.max(...stops.filter((s) => !s.est && s.pr && s.pr.czk != null && s.kwh > 0).map((s) => s.pr.czk));
  assert.equal(st.est.unit, max);
  assert.match(text(d.querySelector('#summary .summary-note')), /jako nejdražší zastávka cesty/);
});

test('[R52] není z čeho odhadnout (žádná cena na cestě): souhrn i srovnání „od“ a jmenují zastávky bez ceny', async () => {
  const noPrices = (w) => {
    const realFetch = w.fetch;
    w.fetch = async (u, o) => {
      const r = await realFetch(u, o);
      if (!String(u).startsWith('data/cards.json')) return r;
      const j = await r.json();
      for (const c of j.cards) { for (const k of ['own', 'roam', 'abroad']) if (c[k]) for (const op of Object.keys(c[k])) c[k][op] = null; if ('anywhere' in c) c.anywhere = null; }
      return { ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) };
    };
  };
  const { d, api } = await search({ 'round-trip': true, 'my-cards': false }, { soc0: 100, setup: noPrices });
  const stops = real(api).filter((s) => s.kwh > 0);
  assert.ok(stops.length && stops.every((s) => s.cost == null && !s.est), 'žádná zastávka nemá cenu ani odhad');
  const note = text(d.querySelector('#summary .summary-note'));
  assert.match(note, /Celá cesta od \d/);
  assert.match(note, /bez ceny: /);
  for (const s of stops) assert.ok(note.includes(s.c.s.fuel || 'Stanice'), `jmenuje ${s.c.s.fuel}`);
  const cmp = d.querySelector('.card.compare');
  assert.match(text(cmp.querySelector('tr.ev td')), /^od \d/);
  assert.match(text(cmp), /nejde přesně porovnat/);
});
