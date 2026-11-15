// R36 / D6 = B (user, 15. 11. 2026): the form is three numbered, tinted steps; one open at a time; closed show a summary.
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
const isOpen = (st) => !body(st).hidden && head(st).getAttribute('aria-expanded') === 'true';

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

test('[R36] na začátku je otevřený krok 1, klepnutí na jiný krok ho otevře a ostatní zavře', async () => {
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  const [s1, s2, s3] = steps(d);
  assert.ok(isOpen(s1)); assert.ok(!isOpen(s2)); assert.ok(!isOpen(s3));
  head(s3).click();
  assert.ok(!isOpen(s1)); assert.ok(!isOpen(s2)); assert.ok(isOpen(s3));
  head(s2).click();
  assert.ok(!isOpen(s1)); assert.ok(isOpen(s2)); assert.ok(!isOpen(s3));
});

test('[R36] zavřené kroky ukazují shrnutí a mění se s nastavením', async () => {
  const { w } = await loadApp({ prefs: { places: praha, stopBy: 'time', intTime: 60, tolTime: 15, detour: 1.5 } }), d = w.document;
  const [s1, s2, s3] = steps(d);
  d.getElementById('depart').value = '2026-11-16T08:00';
  d.getElementById('depart').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.match(text(s1.querySelector('.step-sum')), /Ostrava → Praha/);
  assert.match(text(s2.querySelector('.step-sum')), /8:00/); assert.match(text(s2.querySelector('.step-sum')), /100 %/);
  assert.match(text(s3.querySelector('.step-sum')), /1:00 ± 15/);
  d.getElementById('soc0').value = '80';
  d.getElementById('soc0').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.match(text(s2.querySelector('.step-sum')), /80 %/);
  d.getElementById('by-km').checked = true;
  d.getElementById('by-km').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.match(text(s3.querySelector('.step-sum')), /130 ± 20 km/);
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
