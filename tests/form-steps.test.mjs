// R36 / D6 = B (user, 15. 11. 2026): the form is three numbered, tinted steps.
// D17 (user, 16. 11. 2026): "drž je rozbalené" – all three stay open, the heading is only a heading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadApp, ROUTES, wait } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const praha = [{ role: 'from', ...ROUTES['ostrava-praha'].from }, { role: 'to', ...ROUTES['ostrava-praha'].to }];
const steps = (d) => [...d.querySelectorAll('#form .form-step')];
const head = (st) => st.querySelector('.step-head');
const body = (st) => st.querySelector('.step-body');
const isOpen = (st) => !st.hidden && !body(st).hidden;

test('[R36] formulář má tři očíslované kroky: 1 Trasa, 2 Kdy a baterie, 3 Zastávky', async () => {
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  const s = steps(d);
  assert.equal(s.length, 3);
  assert.match(text(head(s[0])), /^1\s*Trasa/); assert.match(text(head(s[1])), /^2\s*Kdy a baterie/); assert.match(text(head(s[2])), /^3\s*Zastávky/);
});

test('[R36][R1] pole jsou ve správných krocích', async () => {
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  const [s1, s2, s3] = steps(d);
  for (const id of ['places', 'add-via']) assert.ok(body(s1).contains(d.getElementById(id)), `${id} je v kroku 1`);
  for (const id of ['depart', 'soc0', 'reserve', 'round-trip', 'ret-time']) assert.ok(body(s2).contains(d.getElementById(id)), `${id} je v kroku 2`);
  for (const id of ['by-time', 'by-km', 'int-time', 'tol-time', 'int-km', 'tol-km', 'detour', 'at-pump']) assert.ok(body(s3).contains(d.getElementById(id)), `${id} je v kroku 3`);
});

test('[R36] všechny tři kroky jsou pořád rozbalené, ťuknutí na nadpis nic neschová (D17)', async () => {
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  const s = steps(d);
  assert.ok(s.every(isOpen), 'na začátku jsou otevřené všechny tři');
  for (const st of s) {
    head(st).click();
    assert.ok(s.every(isOpen), `po ťuknutí na „${text(head(st))}“ jsou dál otevřené všechny tři`);
  }
  for (const st of s) {
    assert.notEqual(head(st).tagName, 'BUTTON', `nadpis „${text(head(st))}“ není tlačítko, nic neslibuje`);
    assert.equal(head(st).getAttribute('aria-expanded'), null, `nadpis „${text(head(st))}“ se netváří jako rozbalovací`);
  }
});

test('[R36][R1] když chybí cíl, otevře se krok 1 a appka řekne, co chybí', async () => {
  const { w } = await loadApp({ prefs: { places: [praha[0], { role: 'to' }] } }), d = w.document;
  const [s1, , s3] = steps(d);
  head(s3).click();
  d.getElementById('form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await wait(50);
  assert.ok(isOpen(s1), 'krok 1 je otevřený');
  assert.match(text(d.getElementById('status')), /Vyber místo v poli Odkud i Kam/);
});

test('[R36] bloky kroků jsou podbarvené (styl)', () => {
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'style.css'), 'utf8');
  const rule = css.match(/\.form-step\s*\{[^}]*\}/);
  assert.ok(rule, 'style.css má pravidlo pro .form-step');
  assert.match(rule[0], /background\s*:\s*var\(--step-bg\)/, 'krok má podbarvení');
  assert.match(css, /--step-bg\s*:/, 'barva podbarvení je definovaná (světlá i tmavá)');
});
