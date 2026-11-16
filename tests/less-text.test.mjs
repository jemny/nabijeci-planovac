// R47 Co nejméně textu (uživatel 16. 11. 2026: „snažím se co to jde mít co nejméně textu na té stránce“).
// Review textů, D23: odstranit nebo zkrátit F1–F7, S1, U1, U3, C1–C4, E2, X1, P1, P2; ponechat U2, E1, P3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, search, ROUTES, wait } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const praha = [{ role: 'from', ...ROUTES['ostrava-praha'].from }, { role: 'to', ...ROUTES['ostrava-praha'].to }];
const real = (api) => api.lastRun().plan.stops.filter((s) => !s.empty);
const outsideDetails = (card, sel) => [...card.querySelectorAll(sel)].filter((x) => !x.closest('details'));

test('[R47] formulář: bez řádku s autem, bez vysvětlivek pod poli, krátká nápověda okna, zdroje dat v ☰', async () => {
  const { w } = await loadApp({ prefs: { places: praha, stopBy: 'time', intTime: 60, tolTime: 15 } }), d = w.document;
  assert.doesNotMatch(text(d.querySelector('header') || d.body), /CLA 350 · 85 kWh/, 'F1: řádek s autem nad nadpisem');
  assert.equal(d.querySelector('#form .hint-top'), null, 'F2: vysvětlivka pod rezervami');
  assert.equal(d.getElementById('round-trip').closest('label').querySelector('small'), null, 'F3: pod Počítat i cestu zpět');
  assert.equal(d.getElementById('at-pump').closest('label').querySelector('small'), null, 'F4: pod Jen na pumpách');
  assert.equal(text(d.getElementById('win-hint')), 'První zastávka 0:45–1:15 od startu.', 'F5: krátká nápověda okna');
  assert.equal(d.querySelector('.preset-hint'), null, 'F6: vysvětlivka objížďky');
  const main = d.querySelector('main');
  assert.doesNotMatch(text(main), /OpenStreetMap/, 'F7: zdroje dat nejsou pod formulářem');
  assert.match(text(d.getElementById('prefs')), /OpenStreetMap/, 'F7: zdroje dat jsou v ☰ → O appce');
});

test('[R47] ☰ nastavení: u bloku nejvýš jedna krátká věta, prázdný seznam jen „Zatím žádné.“', async () => {
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  assert.equal(text(d.getElementById('trips-empty')), 'Zatím žádné.');
  assert.equal(text(d.getElementById('hidden-empty')), 'Zatím žádné.');
  for (const sec of d.querySelectorAll('#prefs .pref-sec')) {
    const notes = [...sec.querySelectorAll('p.small.muted')].filter((p) => !p.hidden && text(p));
    assert.ok(notes.length <= 1, `${text(sec.querySelector('h3'))}: ${notes.length} vysvětlivky (${notes.map(text).join(' | ')})`);
    for (const p of notes) assert.ok(text(p).length <= 110, `${text(sec.querySelector('h3'))}: „${text(p)}“ má ${text(p).length} znaků`);
  }
  assert.ok(![...d.querySelectorAll('#prefs > p')].some((p) => /Ukládá se v tomhle zařízení/.test(text(p))), 'věta pod nadpisem nastavení');
});

test('[R47] souhrn: celá cena jednou větou, odpočívadla krátce, bez opakování dlaždic a grafu', async () => {
  const { d } = await search({ 'round-trip': true }, { soc0: 100 });
  const note = text(d.querySelector('#summary .summary-note'));
  for (const re of [/Jízda tam/, /Cestou potřebuješ/, /Bez nabíjení bys/, /rozpis ve srovnání/, /na každé zastávce jen/]) assert.doesNotMatch(note, re, `U1: ${re}`);
  assert.match(note, /Celá cesta/);
  assert.match(note, /v protisměru/);
  assert.ok(note.length <= 160, `U1: souhrn má ${note.length} znaků: ${note}`);
});

test('[R47][R45] souhrn o počasí mlčí, když je v pořádku', async () => {
  const { d } = await search({ 'round-trip': false });
  for (let i = 0; i < 100 && /Načítám/.test(text(d.getElementById('wx-note'))); i++) await wait(20);
  const n = d.getElementById('wx-note');
  assert.ok(!n || n.hidden || !text(n), `U3: „${text(n)}“`);
});

test('[R47][R24] karta zastávky: vysvětlení pod Víc o zastávce, rada heslovitě, bez nabíjení jen příjezd', async () => {
  const { d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const stops = real(api), cards = [...d.querySelectorAll('.stop-card')];
  stops.forEach((st, i) => {
    const c = cards[i], more = c.querySelector('details.stop-more');
    assert.equal(outsideDetails(c, '.why li').length, 0, `C1: zastávka ${i + 1} ukazuje vysvětlení mimo Víc o zastávce`);
    for (const line of st.why || []) assert.ok(text(more).includes(line), `C1: „${line}“ je pod Víc o zastávce`);
    const adv = outsideDetails(c, '.advice:not(.logged)').map(text).join(' ');
    if (st.kwh > 0) {
      assert.match(adv, /Plug & Charge/, 'C2: rada k placení zůstává');
      assert.doesNotMatch(adv, /jinak to naúčtuje|ber nejrychlejší volný stojan\./, `C2: rada je heslovitě (${adv})`);
    } else {
      assert.match(text(c.querySelector('.stop-line')), /^Přijedeš s ~\d+ %$/, 'C3: bez nabíjení jen příjezd');
    }
  });
});

test('[R47] prázdné okno: krátce, nejbližší stanice i když jsou daleko', async () => {
  const { d } = await search({ stopBy: 'km', intKm: 100, tolKm: 5, detour: 0.5, 'round-trip': false });
  const p = d.querySelector('.tl.empty .empty-window p');
  assert.ok(p, 'prázdné okno');
  assert.ok(text(p).length <= 90, `C4: ${text(p).length} znaků: ${text(p)}`);
  assert.match(text(p), /nejbližší/); assert.match(text(p), /i když jsou daleko/);
});

test('[R47] Do navigace, Dokončit a Srovnání: Mercedes jedním řádkem, bez věty nad poli, krátký řádek pod nadpisem, rozpis na klepnutí', async () => {
  const { d } = await search({ 'round-trip': true }, { soc0: 100 });
  const exp = text(d.getElementById('export'));
  assert.doesNotMatch(exp, /Send2Car|Když nevezme mezizastávky/, 'E2');
  assert.match(exp, /Do Mercedesu: Google Mapy → Sdílet → Mercedes-Benz → Odeslat do vozidla\./, 'E2: jedním řádkem');
  assert.match(exp, /Waze přes odkaz neumí víc zastávek najednou/, 'E1 zůstává');
  assert.doesNotMatch(text(d.querySelector('.card.finish')), /Až dojedeš/, 'X1');
  const cmp = d.querySelector('.card.compare');
  assert.match(text(cmp.querySelector('h2 + p')), /^\d[\d\s ]* km · na konci \d+ %$/, 'P1');
  const sum = cmp.querySelector('.cmp-sum');
  assert.ok(sum && sum.closest('details'), 'P2: rozpis ceny je na klepnutí');
  assert.match(text(sum.closest('details').querySelector('summary')), /Rozpis ceny/);
  assert.match(text(cmp), /Kdyby se všechno nabilo doma/, 'P3 zůstává');
});
