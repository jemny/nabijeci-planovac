// R35 Data nabíječek: aktualizace stahuje data desítky minut. Když mezitím někdo pošle commit na main,
// prosté „git push“ na konci selže (nalezeno 16. 11. 2026 při ručním spuštění) a nová data se neuloží.
// Krok „Uložit změny“ proto nejdřív vezme novější commity z main (rebase) a teprve pak pushne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const yml = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'update-data.yml'), 'utf8');

test('[R35] aktualizace dat: před uložením vezme novější commity z main, aby push nových dat neselhal', () => {
  const step = yml.split(/\n\s*- name: /).find((s) => s.startsWith('Uložit změny'));
  assert.ok(step, 'krok „Uložit změny“ chybí');
  const pull = step.indexOf('git pull --rebase'), push = step.indexOf('git push');
  assert.ok(pull >= 0, 'krok nebere novější commity (git pull --rebase)');
  assert.ok(push > pull, 'git push musí být až po git pull --rebase');
});

test('[R35] aktualizace dat: log stahování je vidět průběžně, i když se běh přeruší', () => {
  assert.match(yml, /build-data:[\s\S]*?PYTHONUNBUFFERED:\s*"1"[\s\S]*?build_db\.py/, 'Python v build-data musí psát log hned (PYTHONUNBUFFERED)');
});
