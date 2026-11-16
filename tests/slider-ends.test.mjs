// Nahlášená chyba (uživatel 16. 11. 2026, screenshot z iPhonu): „slidery nejezdí až do konce, když je to 0 % nebo
// 100 %, očekával bych, že budou až na konci“. Čára posuvníku vede přes celou šířku pole, ale jezdec jezdil jen
// uvnitř vnitřního okraje (padding 0 12px), takže na 0 % i na 100 % zůstal kus před koncem čáry.
// jsdom nepočítá rozložení, tak test hlídá příčinu: posuvník nemá vlevo ani vpravo vnitřní okraj.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadApp, search, ROUTES } from './harness.mjs';

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'style.css'), 'utf8');
const praha = [{ role: 'from', ...ROUTES['ostrava-praha'].from }, { role: 'to', ...ROUTES['ostrava-praha'].to }];

// the app's real style.css applied to the jsdom page, so getComputedStyle follows the same cascade as the browser
function withStyles(w) {
  const s = w.document.createElement('style');
  s.textContent = css;
  w.document.head.appendChild(s);
}
const zero = (v) => /^0(px)?$/.test(v);
function assertEdgeToEdge(w, input, name) {
  const cs = w.getComputedStyle(input);
  assert.ok(zero(cs.paddingLeft), `${name}: vlevo žádný vnitřní okraj, na nejmenší hodnotě je jezdec úplně vlevo (je ${cs.paddingLeft})`);
  assert.ok(zero(cs.paddingRight), `${name}: vpravo žádný vnitřní okraj, na 100 % je jezdec úplně vpravo (je ${cs.paddingRight})`);
}

test('[R41] posuvníky ve formuláři jedou až na konec čáry: 0 % úplně vlevo, 100 % úplně vpravo', async () => {
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  withStyles(w);
  for (const id of ['soc0', 'reserve', 'reserve-dest']) {
    const r = d.querySelector(`input[type=range][data-for="${id}"]`);
    assert.ok(r, `${id}: posuvník`);
    assertEdgeToEdge(w, r, id);
  }
});

test('[R39] posuvník Nabít do v kartě zastávky jede až na konec čáry (100 % úplně vpravo)', async () => {
  const { w, d } = await search({ 'round-trip': true }, { soc0: 100 });
  withStyles(w);
  const sliders = [...d.querySelectorAll('.stop-card input[type=range].charge-to')];
  assert.ok(sliders.length >= 1, 'aspoň jedna zastávka má posuvník Nabít do');
  sliders.forEach((r, i) => assertEdgeToEdge(w, r, `zastávka ${i + 1}`));
});

// Uživatel 16. 11. 2026 („Ano, rozšiř“): hlídat každý posuvník v appce, i ty, které přibudou později.
// Posuvníky vznikají na dvou místech: napevno v index.html, nebo až za běhu v app.js. Oba zdroje test čte sám,
// takže nový posuvník nemůže projít bez kontroly.
const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const noComments = (src) => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('[R41] každý posuvník napevno ve stránce (i nově přidaný do index.html) jede až na konec čáry', async () => {
  const html = noComments(readFileSync(path.join(appDir, 'index.html'), 'utf8'));
  const inHtml = (html.match(/<input\b[^>]*\btype\s*=\s*["']?range\b/gi) || []).length;
  assert.ok(inHtml >= 3, 'index.html má aspoň tři posuvníky (baterie a obě rezervy)');
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  withStyles(w);
  const all = [...d.querySelectorAll('input[type=range]')];
  assert.ok(all.length >= inHtml, `všech ${inHtml} posuvníků z index.html je na stránce (našel jsem ${all.length})`);
  all.forEach((r, i) => assertEdgeToEdge(w, r, r.dataset.for || r.className || `posuvník ${i + 1}`));
});

// Jak v appce ukázat posuvník, který app.js vytváří až za běhu. Nový posuvník = nový řádek tady (kontrolu nemazat).
const SHOW = {
  'charge-to': () => search({ 'round-trip': true }, { soc0: 100 }), // R39 Nabít do: karta zastávky po naplánování
};
// every place in app.js that makes an <input type=range>, with its class (selectors like input[type=range] are skipped)
function rangeSitesInApp() {
  const src = noComments(readFileSync(path.join(appDir, 'app.js'), 'utf8'));
  const re = /(?<!\[)\btype\s*[:=]\s*['"]?range\b|['"]type['"]\s*,\s*['"]range['"]/g;
  return [...src.matchAll(re)].map((m) => {
    // the class is read only from the same object literal, el('input', { type: 'range', class: … }); x.type = 'range' has none
    const literal = /^type\s*:/.test(m[0]);
    const obj = literal ? src.slice(src.lastIndexOf('{', m.index), src.indexOf('}', m.index)) : '';
    const cls = (obj.match(/\bclass\s*:\s*['"]([\w-]+)/) || [])[1] || null;
    return { line: src.slice(0, m.index).split('\n').length, cls };
  });
}

test('[R41] každý posuvník, který appka vytváří až za běhu (i nový v app.js), jede až na konec čáry', async () => {
  const sites = rangeSitesInApp();
  assert.ok(sites.some((s) => s.cls === 'charge-to'), 'test najde v app.js posuvník Nabít do (R39)');
  for (const s of sites) {
    assert.ok(s.cls, `app.js (asi řádek ${s.line}): posuvník nemá u sebe class, test ho nepozná. Vytvoř ho jako el('input', { type: 'range', class: '…' }) a přidej ho do SHOW.`);
    assert.ok(SHOW[s.cls], `app.js (asi řádek ${s.line}): nový posuvník .${s.cls}. Přidej do SHOW v tomhle testu, jak ho v appce ukázat (kontrolu nemaž).`);
    const { w, d } = await SHOW[s.cls]();
    withStyles(w);
    const own = d.querySelectorAll(`input[type=range].${s.cls}`);
    assert.ok(own.length >= 1, `posuvník .${s.cls} se v ukázce opravdu objevil`);
    [...d.querySelectorAll('input[type=range]')].forEach((r, i) => assertEdgeToEdge(w, r, `.${s.cls} ukázka, ${r.dataset.for || r.className || `posuvník ${i + 1}`}`));
  }
});
