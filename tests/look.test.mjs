// R34 Vzhled. Nahlášená chyba (uživatel 15. 11. 2026): pole „Zpátky vyrážím v“ (čas) mělo šedé systémové
// pozadí místo tmavého jako „Baterie na startu“ („jinak je to hnusné“). Každé pole, do kterého se píše
// nebo vybírá, má stejný vzhled; pole s časem i na iPhonu, kde Safari jinak kreslí vlastní šedé pole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadApp, ROUTES } from './harness.mjs';

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'style.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].split(',').map((s) => s.trim()), body: m[2] }));
const matches = (el, sel) => { try { return el.matches(sel); } catch { return false; } };
// the shared field look: own background (surface), border, rounded corners
const fieldRule = rules.find((r) => /background\s*:\s*var\(--surface\)/.test(r.body) && /border-radius/.test(r.body) && r.sel.includes('select'));
const praha = [{ role: 'from', ...ROUTES['ostrava-praha'].from }, { role: 'to', ...ROUTES['ostrava-praha'].to }];
const NOT_FIELDS = ['checkbox', 'radio', 'file', 'hidden', 'button', 'submit'];

test('[R34] každé pole (i čas návratu a odjezd) má stejné tmavé podbarvení jako Baterie na startu', async () => {
  assert.ok(fieldRule, 'style.css má společné pravidlo pro pole s pozadím var(--surface)');
  const { w } = await loadApp({ prefs: { places: praha } }), d = w.document;
  const fields = [...d.querySelectorAll('input, select, textarea')].filter((el) => !NOT_FIELDS.includes(el.type));
  for (const id of ['ret-time', 'depart', 'soc0']) assert.ok(fields.includes(d.getElementById(id)), `${id} je mezi poli`);
  for (const el of fields) {
    const name = el.id || `${el.tagName.toLowerCase()}[type=${el.type}]`;
    assert.ok(fieldRule.sel.some((s) => matches(el, s)), `${name} má společný vzhled polí`);
    for (const r of rules) {
      if (r === fieldRule || !r.sel.some((s) => matches(el, s))) continue;
      const bg = r.body.match(/background(?:-color)?\s*:\s*([^;]+)/);
      assert.ok(!bg || /var\(--surface\)/.test(bg[1]), `${name}: pravidlo ${r.sel.join(',')} mu mění pozadí na ${bg && bg[1]}`);
    }
  }
});

test('[R34] pole s časem a datem nekreslí systémový šedý vzhled (iPhone Safari)', () => {
  for (const type of ['time', 'datetime-local']) {
    const own = rules.filter((r) => r.sel.some((s) => s === `input[type=${type}]`));
    assert.ok(own.some((r) => /-webkit-appearance\s*:\s*none/.test(r.body) && /(^|[;\s])appearance\s*:\s*none/.test(r.body)),
      `input[type=${type}] má appearance:none i -webkit-appearance:none`);
  }
});

// User, 15. 11. 2026: "ta tmavá varianta se mi moc líbí, neměň ji" – the approved dark palette is pinned here.
test('[R34] tmavá varianta zůstává, jak ji uživatel schválil', () => {
  const raw = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'style.css'), 'utf8');
  const block = raw.match(/@media \(prefers-color-scheme: dark\)\{\s*:root\{([^}]*)\}/);
  assert.ok(block, 'style.css má tmavou variantu v @media (prefers-color-scheme: dark)');
  const tokens = Object.fromEntries([...block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  assert.deepEqual(tokens, {
    '--bg': '#14171B', '--surface': '#1C2026', '--ink': '#E8EBEF', '--muted': '#A1A9B3', '--line': '#2F3640',
    '--ev': '#6AA9E0', '--ev-ink': '#0B1622', '--ev-soft': '#1A2A3A', '--warn': '#E3A646', '--warn-soft': '#372A13', '--bad': '#F2867E',
    '--surface-2': '#232830', '--base': '#2A4A6A', '--dim': '#5A636E', '--step-bg': '#222831',
  });
  assert.match(block[1], /color-scheme\s*:\s*dark/);
  const html = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'index.html'), 'utf8');
  assert.match(html, /<meta name="theme-color" content="#14171B" media="\(prefers-color-scheme: dark\)">/, 'lišta prohlížeče v tmavé variantě');
});

// User, 16. 11. 2026: "ano, později uděláme pár změn" – the approved light palette is pinned here too (D21).
test('[R34] světlá varianta zůstává, jak ji uživatel schválil', () => {
  const raw = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'style.css'), 'utf8');
  const block = raw.match(/^:root\{([^}]*)\}/m);
  assert.ok(block, 'style.css má světlou variantu v prvním :root');
  const tokens = Object.fromEntries([...block[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9A-Fa-f]{3,8})\s*;/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(tokens, {
    '--bg': '#EEF1F4', '--surface': '#FFFFFF', '--ink': '#1B1F24', '--muted': '#59636E', '--line': '#D3D9DF',
    '--ev': '#005EA8', '--ev-ink': '#FFFFFF', '--ev-soft': '#DCE8F4', '--warn': '#A9680B', '--warn-soft': '#F5E8D2', '--bad': '#B3261E',
    '--surface-2': '#E9EDF1', '--base': '#C5DDF2', '--dim': '#9AA4AE', '--step-bg': '#E6ECF3',
  });
  assert.match(block[1], /color-scheme\s*:\s*light/);
  const html = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'index.html'), 'utf8');
  assert.match(html, /<meta name="theme-color" content="#EEF1F4" media="\(prefers-color-scheme: light\)">/, 'lišta prohlížeče ve světlé variantě');
});
