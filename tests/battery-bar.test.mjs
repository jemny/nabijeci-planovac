// R32 Pruh baterie v kartě zastávky. Nahlášená chyba (uživatel 16. 11. 2026): vlevo 23 %, úplně vpravo 50 %,
// mezi tím +27 %, ale pruh končí v polovině, „ty modré čáry prostě nejsou dobře, musí tam být vidět, s kolika %
// přijedu, kolik % načerpám a kolik budu mít při odjezdu“. Každé číslo patří pod svůj kus pruhu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { search } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const pct = (el, prop) => { const m = (el.getAttribute('style') || '').match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([\\d.]+)%`)); return m ? Number(m[1]) : NaN; };
const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'style.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].split(',').map((s) => s.trim()), body: m[2] }));
const styleOf = (el) => rules.filter((r) => r.sel.some((s) => { try { return el.matches(s); } catch { return false; } })).map((r) => r.body).join(';');

// a label touches its boundary p: it starts there (left:p%) or ends there (right:100-p%)
const touches = (el, p) => Math.abs(pct(el, 'left') - p) <= 0.5 || Math.abs(pct(el, 'right') - (100 - p)) <= 0.5;

function checkBar(card, words, label) {
  const wrap = card.querySelector('.bar-wrap'), bar = wrap.querySelector('.bar');
  const base = bar.querySelector('.bar-base'), add = bar.querySelector('.bar-add');
  const labels = [...wrap.querySelectorAll('span')].filter((s) => !bar.contains(s));
  assert.equal(labels.length, 3, `${label}: u pruhu jsou tři údaje (${labels.map(text).join(' | ')})`);
  const find = (re, what) => { const el = labels.find((x) => re.test(text(x))); assert.ok(el, `${label}: chybí „${what}“ (${labels.map(text).join(' | ')})`); return el; };
  const elArr = find(new RegExp(`^${words[0]}\\s*\\d+ %$`), `${words[0]} N %`);
  const elChg = find(new RegExp(`^${words[1]}\\s*\\+\\d+ %$`), `${words[1]} +N %`);
  const elDep = find(new RegExp(`^${words[2]}\\s*\\d+ %$`), `${words[2]} N %`);
  const [arr, chg, dep] = [elArr, elChg, elDep].map((x) => Number(text(x).match(/(\d+) %$/)[1]));
  assert.equal(arr + chg, dep, `${label}: ${words[0]} ${arr} % + ${words[1]} ${chg} % = ${words[2]} ${dep} %`);
  // the bar itself: dark part up to the arrival, light part from arrival to departure
  const wBase = pct(base, 'width'), left = pct(add, 'left'), wAdd = pct(add, 'width');
  assert.ok(Math.abs(wBase - arr) <= 0.5 && Math.abs(left - arr) <= 0.5, `${label}: tmavá část končí na ${arr} % (${wBase} %, ${left} %)`);
  assert.ok(Math.abs(left + wAdd - dep) <= 0.5, `${label}: světlá část končí na ${dep} % (${left + wAdd} %)`);
  // each number sits at its own place: arrival at the end of the dark part, departure at the end of the light part,
  // "nabiješ" over the light part (centred on it, or at one of its ends near the card edge)
  assert.ok(touches(elArr, arr), `${label}: „${text(elArr)}“ stojí na hranici tmavé části ${arr} % (${elArr.getAttribute('style')})`);
  assert.ok(touches(elDep, dep), `${label}: „${text(elDep)}“ stojí na konci světlé části ${dep} % (${elDep.getAttribute('style')})`);
  const centred = Math.abs(pct(elChg, 'left') - (arr + dep) / 2) <= 0.5 && /translateX\(-50%\)/.test(styleOf(elChg));
  assert.ok(centred || touches(elChg, arr) || touches(elChg, dep), `${label}: „${text(elChg)}“ je nad světlou částí (${elChg.getAttribute('style')})`);
  // a label that ends at its boundary is aligned to it (text to the right edge), one that starts there to the left
  for (const x of [elArr, elDep]) {
    if (!Number.isNaN(pct(x, 'right'))) assert.match(styleOf(x), /border-right|text-align\s*:\s*right/, `${label}: „${text(x)}“ končí čárou na hranici`);
    else assert.match(styleOf(x), /border-left|text-align\s*:\s*left/, `${label}: „${text(x)}“ začíná čárou na hranici`);
  }
  // arrival and departure are on different rows, so they never overlap however close they are
  assert.match(styleOf(elDep), /align-items\s*:\s*flex-end/, `${label}: odjezd je o řádek níž než příjezd`);
}

test('[R32] pruh baterie: přijedeš X %, nabiješ +Y %, odjedeš Z %, každé číslo pod svým kusem pruhu', async () => {
  const { d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const stops = api.lastRun().plan.stops.filter((s) => !s.empty), cards = [...d.querySelectorAll('.stop-card')];
  let n = 0;
  stops.forEach((st, i) => {
    if (!(st.kwh > 0)) return;
    n += 1;
    checkBar(cards[i], ['přijedeš', 'nabiješ', 'odjedeš'], `zastávka ${i + 1}`);
    const legend = text(cards[i].querySelector('.bar-legend'));
    assert.match(legend, new RegExp(`přijedeš\\s*${Math.round(st.arrive)} %`), `zastávka ${i + 1}: přijedeš podle plánu`);
    assert.match(legend, new RegExp(`odjedeš\\s*${Math.round(st.target)} %`), `zastávka ${i + 1}: odjedeš podle plánu`);
  });
  assert.ok(n >= 2, `tam i zpět jsou aspoň dvě nabíjecí zastávky (${n})`);
});

test('[R32] pruh baterie u zapsané zastávky: příjezd, nabito, odjezd podle zápisu', async () => {
  const { w, d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const stops = api.lastRun().plan.stops.filter((s) => !s.empty);
  const i = stops.findIndex((s) => s.kwh > 0);
  const card = d.querySelectorAll('.stop-card')[i];
  const inputs = card.querySelectorAll('.actual-form .grid2 input');
  inputs[0].value = '18'; inputs[1].value = '61';
  [...card.querySelectorAll('button')].find((b) => /Uložit a přepočítat/.test(b.textContent)).click();
  await new Promise((r) => w.setTimeout(r, 50));
  const after = d.querySelectorAll('.stop-card')[i];
  checkBar(after, ['příjezd', 'nabito', 'odjezd'], 'zapsaná zastávka');
  const all = text(after.querySelector('.bar-wrap'));
  for (const re of [/příjezd\s*18 %/, /nabito\s*\+43 %/, /odjezd\s*61 %/]) assert.match(all, re);
});
