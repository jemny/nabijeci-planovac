// R38 Bez soukromých poznámek. Uživatel 16. 11. 2026: texty o tom, co dělá na zastávce, jsou jeho soukromé
// poznámky a v appce nemají být („tyto texty odstraň, to jsou mé soukromé poznámky“).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { search } from './harness.mjs';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const PRIVATE = /káv|kafe|párek|párk/i;
const around = (s) => { const m = s.match(new RegExp(`.{0,40}(?:${PRIVATE.source}).{0,40}`, 'i')); return m && m[0]; };

test('[R38] plán ani formulář nepíšou soukromé poznámky o zastávce', async () => {
  const { d } = await search({ 'round-trip': false }, { soc0: 100 });
  const cards = [...d.querySelectorAll('.stop-card')];
  assert.ok(cards.some((c) => !c.querySelector('.tiles3')), 'v plánu je zastávka bez nabíjení');
  // what the app writes itself (station names come from the data and are not checked here)
  const own = ['.eyebrow', '.stop-line', '.why li', '.advice', '.summary-note', '#form .check', '#form .hint-top', '#status']
    .flatMap((sel) => [...d.querySelectorAll(sel)]).map((el) => el.textContent).join(' | ');
  assert.equal(around(own), null, `appka píše „${around(own)}“`);
  const noCharge = cards.find((c) => !c.querySelector('.tiles3'));
  assert.match(noCharge.querySelector('.eyebrow').textContent, /bez nabíjení/, 'zastávka bez nabíjení se tak jmenuje');
});

test('[R38] zdrojové soubory appky soukromé poznámky neobsahují', () => {
  for (const f of readdirSync(APP).filter((x) => /\.(js|html|css|webmanifest)$/.test(x))) {
    const hit = around(readFileSync(path.join(APP, f), 'utf8'));
    assert.equal(hit, null, `app/${f}: „${hit}“`);
  }
});
