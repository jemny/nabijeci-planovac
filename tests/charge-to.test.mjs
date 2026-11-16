// R39 Na kolik nabít u zastávky (D12 = A, uživatel 16. 11. 2026, ze srovnání s ABRP): posuvník „Nabít do“ v kartě
// zastávky, po puštění se zbytek plánu přepočítá (D5) a karta napíše „Plán navrhl X %, nastavil jsi Y %“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search, loadApp, ROUTES, wait } from './harness.mjs';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const real = (api) => api.lastRun().plan.stops.filter((s) => !s.empty);
const cards = (d) => [...d.querySelectorAll('.stop-card')];
const slider = (card) => card.querySelector('input[type=range].charge-to');
const btn = (root, re) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent));
function slide(w, input, value) {
  input.value = String(value);
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
}
// the first stop that charges, and its card (cards follow the real stops in order)
const firstCharge = (api, d) => { const i = real(api).findIndex((s) => s.kwh > 0); return { i, st: real(api)[i], card: cards(d)[i] }; };

test('[R39] každá nezapsaná zastávka má posuvník Nabít do: od příjezdu do 100 %, výchozí je plán', async () => {
  const { d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const stops = real(api), cs = cards(d);
  assert.ok(stops.length >= 2, 'tam i zpět jsou aspoň dvě zastávky');
  stops.forEach((st, i) => {
    const r = slider(cs[i]);
    assert.ok(r, `zastávka ${i + 1}: posuvník „Nabít do“`);
    assert.match(text(r.closest('label') || r.parentElement), /Nabít do/);
    assert.equal(+r.max, 100, `zastávka ${i + 1}: posuvník jde do 100 %`);
    assert.equal(+r.min, Math.max(0, Math.round(st.arrive)), `zastávka ${i + 1}: posuvník začíná na příjezdu`);
    assert.equal(+r.value, Math.round(st.target), `zastávka ${i + 1}: výchozí je návrh plánu`);
  });
});

test('[R39] posuvník výš: zastávka nabije přesně tolik, další zastávky se přepočítají a karta řekne, co navrhl plán', async () => {
  const { w, d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const { i, st } = firstCharge(api, d);
  const planned = Math.round(st.target), want = Math.min(100, planned + 15);
  const nextBefore = real(api)[i + 1] ? real(api)[i + 1].arrive : null;
  slide(w, slider(cards(d)[i]), want);
  const after = real(api)[i];
  assert.equal(Math.round(after.target), want, 'zastávka nabije přesně na nastavenou hodnotu');
  if (nextBefore != null) assert.ok(real(api)[i + 1].arrive > nextBefore + 5, 'na další zastávku přijedeš s víc % (plán se přepočítal)');
  const card = cards(d)[i];
  assert.match(text(card), new RegExp(`Plán navrhl ${planned} %, nastavil jsi ${want} %`));
  assert.ok(btn(card, /Vrátit na plán/), 'tlačítko Vrátit na plán');
  assert.equal(+slider(card).value, want, 'posuvník ukazuje tvoje číslo');
});

test('[R39] tvoje číslo platí přesně: i malé dobití pod 8 %, které by plán sám nenavrhl', async () => {
  const { w, d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const { i, st } = firstCharge(api, d);
  const want = Math.round(st.arrive) + 4;
  slide(w, slider(cards(d)[i]), want);
  assert.equal(Math.round(real(api)[i].target), want, 'žádné minimum 8 %');
});

test('[R39] Vrátit na plán vrátí návrh plánu a poznámka zmizí', async () => {
  const { w, d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const { i, st } = firstCharge(api, d);
  const planned = Math.round(st.target);
  slide(w, slider(cards(d)[i]), Math.min(100, planned + 10));
  btn(cards(d)[i], /Vrátit na plán/).click();
  assert.equal(Math.round(real(api)[i].target), planned);
  assert.doesNotMatch(text(cards(d)[i]), /nastavil jsi/);
  assert.equal(btn(cards(d)[i], /Vrátit na plán/), undefined);
});

test('[R39] posuvník níž, než je potřeba: appka to nenechá bez řešení (zastávka kvůli dojezdu nebo varování)', async () => {
  const { w, d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const { i, st } = firstCharge(api, d);
  slide(w, slider(cards(d)[i]), Math.round(st.arrive));
  const stops = real(api), plan = api.lastRun().plan;
  const extra = stops.some((s) => s.note === 'kvůli dojezdu');
  const ok = stops.every((s) => s.arrive >= 10 - 3) && plan.socEnd >= 10 - 3;
  assert.ok(extra || ok, `buď zastávka navíc, nebo všude dojedeš s rezervou (příjezdy ${stops.map((s) => Math.round(s.arrive)).join(', ')}, doma ${Math.round(plan.socEnd)})`);
  assert.match(text(cards(d)[i]), /nastavil jsi/, 'karta řekne, že je to tvoje volba');
});

test('[R39] nastavení patří ke stanici: po výběru jiné stanice v okně platí zase plán', async () => {
  const { w, d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const i = real(api).findIndex((s) => s.kwh > 0 && s.alts && s.alts.length && s.win != null);
  assert.ok(i >= 0, 'nabíjecí zastávka s jinými možnostmi v okně');
  const planned = Math.round(real(api)[i].target);
  slide(w, slider(cards(d)[i]), Math.min(100, planned + 12));
  const alt = cards(d)[i].querySelector('.alts .alt button');
  alt.click();
  assert.doesNotMatch(text(cards(d)[i]), /nastavil jsi/, 'u nové stanice žádné tvoje číslo');
});

test('[R39] nastavení se uloží s cestou a po otevření cesty platí dál', async () => {
  const { w, d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const { i, st } = firstCharge(api, d);
  const want = Math.min(100, Math.round(st.target) + 11);
  slide(w, slider(cards(d)[i]), want);
  btn(d.querySelector('.card.trip'), /Uložit cestu/).click();
  const storage = { 'np.trips.v1': w.localStorage.getItem('np.trips.v1') };
  const praha = [{ role: 'from', ...ROUTES['ostrava-praha'].from }, { role: 'to', ...ROUTES['ostrava-praha'].to }];
  const fresh = await loadApp({ prefs: { places: praha }, storage });
  const d2 = fresh.w.document;
  d2.querySelector('#trips-list .trip-open').click();
  for (let k = 0; k < 100 && !d2.querySelector('#results .timeline'); k++) await wait();
  const st2 = real(fresh.api)[i];
  assert.equal(Math.round(st2.target), want, 'otevřená cesta nabíjí na tvoje číslo');
  assert.match(text(cards(d2)[i]), new RegExp(`nastavil jsi ${want} %`));
});

test('[R39] zapsaná zastávka posuvník nemá', async () => {
  const { w, d, api } = await search({ 'round-trip': true }, { soc0: 100 });
  const { i } = firstCharge(api, d);
  const card = cards(d)[i];
  const inputs = card.querySelectorAll('.actual-form .grid2 input');
  inputs[0].value = '18'; inputs[1].value = '61';
  btn(card, /Uložit a přepočítat/).click();
  await wait();
  assert.equal(slider(cards(d)[i]), null);
});
