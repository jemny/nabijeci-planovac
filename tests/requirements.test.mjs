// Traceability: every requirement in REQUIREMENTS.md has a test, every test belongs to a requirement.
// A new requirement without a test fails here, so nothing is deployed until it is tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const md = readFileSync(path.join(HERE, '..', 'REQUIREMENTS.md'), 'utf8');
const sections = md.split(/^### /m).slice(1).map((s) => ({ id: s.match(/^(R\d+)\b/)?.[1], text: s }));
const ids = sections.map((s) => s.id).filter(Boolean);
const manual = new Set(sections.filter((s) => /Ověření: ručně/.test(s.text)).map((s) => s.id));

const files = readdirSync(HERE).filter((f) => f.endsWith('.test.mjs'));
const titles = files.flatMap((f) => [...readFileSync(path.join(HERE, f), 'utf8')
  .matchAll(/\btest\(\s*(['`"])((?:\\.|(?!\1).)*)\1/g)].map((m) => ({ file: f, title: m[2] })));
const tagsOf = (t) => t.match(/\[R\d+\]/g)?.map((x) => x.slice(1, -1)) || [];

test('[R0] požadavky: seznam má čísla a nejsou dvakrát', () => {
  assert.ok(ids.length >= 30, `požadavků: ${ids.length}`);
  assert.equal(new Set(ids).size, ids.length, 'číslo požadavku je dvakrát');
});

test('[R0] požadavky: každý test patří k existujícímu požadavku', () => {
  for (const { file, title } of titles) {
    const tags = tagsOf(title);
    assert.ok(tags.length, `${file}: test „${title}“ nemá číslo požadavku [Rn]`);
    for (const t of tags) assert.ok(ids.includes(t), `${file}: „${title}“ odkazuje na ${t}, který v REQUIREMENTS.md není`);
  }
});

test('[R0] požadavky: každý požadavek má aspoň jeden test (kromě ověřovaných ručně)', () => {
  const covered = new Set(titles.flatMap((t) => tagsOf(t.title)));
  const missing = ids.filter((id) => !manual.has(id) && !covered.has(id));
  assert.deepEqual(missing, [], `požadavky bez testu: ${missing.join(', ')}`);
});
