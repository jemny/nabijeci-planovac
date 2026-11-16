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
