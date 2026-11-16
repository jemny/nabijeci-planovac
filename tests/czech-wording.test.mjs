// R24 Jak daleko je nabízená stanice, normální češtinou. Uživatel 16. 11. 2026: „toto není dobrá čeština:
// je 9 min za oknem. Lepší je například: je o 9 minut dále.“
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const minutes = (n) => (n === 1 ? 'minutu' : n >= 2 && n <= 4 ? 'minuty' : 'minut');

test('[R24] oblíbená pumpa mimo okno: „je o N minut dále“ (nebo dříve) se správným tvarem slova minuta', async () => {
  // MOL Vyškov (oblíbená) je pár minut za oknem 0:45–1:15; v okně je jiná stanice
  const { d } = await search({ favs: ['MOL'], stopBy: 'time', intTime: 60, tolTime: 15, detour: 1.5, 'round-trip': false });
  const hint = d.querySelector('.stop-card .fav-near');
  assert.ok(hint, 'u zastávky je nabídka oblíbené pumpy mimo okno');
  const t = text(hint);
  const m = t.match(/je o (\d+) (minutu|minuty|minut) (dále|dříve)\./);
  assert.ok(m, `„${t}“ má říct „je o N minut dále“`);
  assert.equal(m[2], minutes(Number(m[1])), `${m[1]} ${m[2]}: správný tvar je „${m[1]} ${minutes(Number(m[1]))}“`);
  assert.doesNotMatch(t, /oknem|\d+ min\b/, 'už ne „N min za oknem“');
});

test('[R24] po km: „je o N km dále“ (nebo blíže), ne „km za oknem“', async () => {
  const { d } = await search({ stopBy: 'km', intKm: 100, tolKm: 5, detour: 0.5, 'round-trip': false });
  const all = [...d.querySelectorAll('.tl.empty .alt, .fav-near')].map(text);
  assert.ok(all.length, 'plán nabízí stanice mimo okno');
  for (const t of all) {
    assert.doesNotMatch(t, /oknem/, `„${t}“`);
    assert.match(t, /(o [\d,]+ km (dále|blíže)|[\d,]+ km od trasy)/, `„${t}“`);
  }
});
