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
  // each number sits at its own place (D16): "přijedeš" left before the line at the end of the dark part,
  // "odjedeš" right after the line at the end of the light part, "nabiješ" over the light part
  assert.ok(Math.abs(pct(elArr, 'right') - (100 - arr)) <= 0.5, `${label}: „${text(elArr)}“ končí čárou na ${arr} % (${elArr.getAttribute('style')})`);
  assert.match(styleOf(elArr), /border-right/, `${label}: „${text(elArr)}“ má čáru vpravo, na hranici tmavé části`);
  assert.ok(Math.abs(pct(elDep, 'left') - dep) <= 0.5, `${label}: „${text(elDep)}“ začíná čárou na ${dep} % (${elDep.getAttribute('style')})`);
  assert.match(styleOf(elDep), /border-left/, `${label}: „${text(elDep)}“ má čáru vlevo, na konci světlé části`);
  const centred = Math.abs(pct(elChg, 'left') - (arr + dep) / 2) <= 0.5 && /translateX\(-50%\)/.test(styleOf(elChg));
  assert.ok(centred || touches(elChg, arr) || touches(elChg, dep), `${label}: „${text(elChg)}“ je nad světlou částí (${elChg.getAttribute('style')})`);
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

// A narrow card (laid out by hand: jsdom has no layout). A label that would stick out of the card goes to the other
// side of its own line, and if it then covers the other label, one row lower.
function narrowCard(W, LW) {
  const PAD = 12, IN = W - 2 * PAD;
  const rect = (l, r) => ({ left: l, right: r, width: r - l, top: 0, bottom: 20, height: 20, x: l, y: 0 });
  return (w) => {
    w.Element.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('stop-card')) return rect(0, W);
      if (this.matches('.bar-legend > span')) {
        const st = this.getAttribute('style') || '', l = st.match(/left:\s*([\d.]+)%/), r = st.match(/right:\s*([\d.]+)%/);
        if (r) { const right = PAD + IN * (1 - r[1] / 100); return rect(right - LW, right); }
        if (l) { const left = PAD + IN * l[1] / 100; return rect(left, left + LW); }
      }
      return rect(PAD, W - PAD);
    };
  };
}
for (const [W, LW] of [[240, 60], [240, 80]]) {
  test(`[R32] pruh baterie v úzké kartě (${W} px, nápis ${LW} px): nápis zůstane v kartě, u své čárky a nic se nepřekrývá`, async () => {
    const { d, api } = await search({ 'round-trip': true }, { soc0: 100, setup: narrowCard(W, LW) });
    const stops = api.lastRun().plan.stops.filter((s) => !s.empty), cards = [...d.querySelectorAll('.stop-card')];
    let flipped = 0;
    stops.forEach((st, i) => {
      if (!(st.kwh > 0)) return;
      const a = Math.round(st.arrive), b = Math.round(st.target), name = `zastávka ${i + 1} (${a} → ${b} %)`;
      const elArr = cards[i].querySelector('.bar-legend').children[0], elDep = cards[i].querySelector('.bar-legend').children[1];
      const fitsArr = 12 + (W - 24) * a / 100 - LW >= 0, fitsDep = 12 + (W - 24) * b / 100 + LW <= W;
      // preferred side when it fits, the other side of the same line when it does not
      if (fitsArr) assert.ok(Math.abs(pct(elArr, 'right') - (100 - a)) <= 0.5, `${name}: přijedeš se vejde, je před čárkou`);
      else { flipped += 1; assert.ok(Math.abs(pct(elArr, 'left') - a) <= 0.5, `${name}: přijedeš se nevejde, je hned za čárkou ${a} % (${elArr.getAttribute('style')})`); }
      if (fitsDep) assert.ok(Math.abs(pct(elDep, 'left') - b) <= 0.5, `${name}: odjedeš se vejde, je za čárkou`);
      else { flipped += 1; assert.ok(Math.abs(pct(elDep, 'right') - (100 - b)) <= 0.5, `${name}: odjedeš se nevejde, je hned před čárkou ${b} % (${elDep.getAttribute('style')})`); }
      const rA = elArr.getBoundingClientRect(), rD = elDep.getBoundingClientRect();
      for (const [el, r] of [[elArr, rA], [elDep, rD]]) assert.ok(r.left >= 0 && r.right <= W, `${name}: „${text(el)}“ je celý v kartě (${r.left}–${r.right})`);
      const rowA = elArr.getAttribute('data-row'), rowD = elDep.getAttribute('data-row');
      assert.ok(rowA != null && rowD != null, `${name}: nápisy mají řádek`);
      if (rowA === rowD) assert.ok(rA.right + 4 <= rD.left || rD.right + 4 <= rA.left, `${name}: na stejném řádku se nápisy nepřekrývají`);
      if (rowA !== '0' || rowD !== '0') assert.match(styleOf(rowA !== '0' ? elArr : elDep), /padding-top/, `${name}: nápis o řádek níž má čáru až k pruhu`);
    });
    assert.ok(flipped >= 1, 'v úzké kartě se aspoň jeden nápis nevešel na svou stranu');
  });
}
