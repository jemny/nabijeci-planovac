// R46 Zavřená pumpa v čase příjezdu (D9 = B, uživatel 16. 11. 2026, ze srovnání s WattBoxem): když má obchod pumpy
// u zastávky v čase příjezdu zavřeno, karta to řekne a nabídne pumpu v okně, která má otevřeno. Sama nic nemění.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, search } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const at = (iso) => new Date(iso);   // 2026-11-16 is a Monday, 2026-11-21 a Saturday, 2026-11-22 a Sunday

test('[R46] otevírací doba z OSM: běžné zápisy, přes půlnoc, neznámý zápis = nevím', async () => {
  const { api } = await loadApp();
  const cases = [
    ['24/7', '2026-11-16T03:00', true],
    ['Mo-Su 06:00-22:00', '2026-11-16T05:40', false],
    ['Mo-Su 06:00-22:00', '2026-11-16T12:00', true],
    ['Mo-Su 06:00-22:00', '2026-11-16T22:30', false],
    ['06:00-22:00', '2026-11-22T21:59', true],
    ['Mo-Fr 06:00-22:00; Sa 07:00-22:00', '2026-11-22T12:00', false],
    ['Mo-Fr 06:00-22:00; Sa 07:00-22:00', '2026-11-21T06:30', false],
    ['Mo-Fr 06:00-22:00; Sa 07:00-22:00', '2026-11-21T07:30', true],
    ['Mo-Sa 05:00-24:00; Su,PH 06:00-23:00', '2026-11-22T05:30', false],
    ['Mo-Sa 05:00-24:00; Su,PH 06:00-23:00', '2026-11-21T23:59', true],
    ['Mo-Su 05:00-00:00', '2026-11-16T23:30', true],
    ['Mo-Su 22:00-06:00', '2026-11-17T02:00', true],
    ['Mo-Su 22:00-06:00', '2026-11-17T12:00', false],
    ['Mo-Fr 06:00-22:00, Sa 07:00-22:00; Su 08:00-22:00', '2026-11-21T08:00', true],
    ['Mo-Su 05:00 - 22:00', '2026-11-16T04:00', false],
    ['PH,Mo-Su 00:00-24:00', '2026-11-16T03:00', true],
    ['Mo-Su,PH 00:00-00:00', '2026-11-16T03:00', true],
    ['Mo-Fr 06:00-20:00, Sa 07:00-17:00; PH,Su off', '2026-11-22T10:00', false],
    ['Mar-Oct 06:00-21:00; Nov-Feb 06:00-20:00', '2026-11-16T12:00', null],
    ['Mo-Sa 07:00-21:30 "Laden" || "Nur Tankautomat"', '2026-11-16T12:00', null],
  ];
  for (const [oh, when, want] of cases) assert.equal(api.isOpen(oh, at(when)), want, `${oh} v ${when}`);
});

// make a stop's pump closed on arrival and one other pump in its window open (24/7), then plan again
// (round trip: the stops on the way back have other pumps in their windows)
async function closedFirstStop() {
  const r = await search({ 'round-trip': true }, { depart: '2026-11-16T03:30' });
  const { w, d, api } = r;
  const stops = api.lastRun().plan.stops.filter((s) => !s.empty);
  const i = stops.findIndex((s) => s.c.s.fuel && s.alts && s.alts.some((a) => a.s.fuel));
  assert.ok(i >= 0, 'zastávka u pumpy s jinou pumpou v okně');
  const st = stops[i], alt = st.alts.find((a) => a.s.fuel);
  st.c.s.oh = `Mo-Su ${String((st.at.getHours() + 2) % 24).padStart(2, '0')}:00-23:00`;   // opens 2 h after arrival
  alt.s.oh = '24/7';
  st.alts.filter((a) => a !== alt).forEach((a) => { a.s.oh = null; });
  const box = d.getElementById('only-fav'); box.dispatchEvent(new w.Event('change'));     // re-plan, same stations
  return { ...r, i, alt };
}

test('[R46] pumpa u zastávky má v čase příjezdu zavřeno: karta to řekne a nabídne otevřenou pumpu v okně', async () => {
  const { d, api, i, alt } = await closedFirstStop();
  const st = api.lastRun().plan.stops.filter((s) => !s.empty)[i];
  const card = [...d.querySelectorAll('.stop-card')][i];
  const box = card.querySelector('.pump-closed');
  assert.ok(box, 'upozornění na zavřenou pumpu');
  assert.match(text(box), /zavřeno/);
  assert.match(text(box), new RegExp(st.c.s.fuel));
  assert.match(text(box), new RegExp(alt.s.fuel), 'nabídne otevřenou pumpu');
  assert.match(text(box), /otevřeno/);
  assert.equal(api.lastRun().plan.stops.filter((s) => !s.empty)[i].c.s, st.c.s, 'appka sama stanici nevyměnila');
  [...box.querySelectorAll('button')].find((b) => /Vybrat/.test(b.textContent)).click();
  assert.equal(api.lastRun().plan.stops.filter((s) => !s.empty)[i].c.s, alt.s, 'po Vybrat je zastávkou otevřená pumpa');
});

test('[R46] bez otevírací doby v datech karta o pumpě nic neříká', async () => {
  const { w, d, api } = await search({ 'round-trip': false }, { depart: '2026-11-16T03:30' });
  for (const st of api.lastRun().plan.stops.filter((s) => !s.empty)) { st.c.s.oh = null; (st.alts || []).forEach((a) => { a.s.oh = null; }); }
  d.getElementById('only-fav').dispatchEvent(new w.Event('change'));
  assert.equal(d.querySelectorAll('.pump-closed').length, 0);
});
