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
