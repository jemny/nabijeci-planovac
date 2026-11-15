# Pravidla pro AI (a každého programátora) v Nabíjecím plánovači

Uživatel tento postup odsouhlasil 15. 11. 2026. Platí pro každou změnu, i drobnou.

## Zdroj pravdy
- **[REQUIREMENTS.md](REQUIREMENTS.md)**: očíslované požadavky (R0, R1…), rozhodnutí (D1…) a otevřené rozpory. Co tam není, appka dělat nemá. Co tam je, nesmí přestat fungovat.
- **`tests/`**: testy jsou závazné. Každý test má v názvu číslo požadavku `[Rn]`.
  - **Na testy se nesahá:** nemění se, nevypínají, neoslabují ani neobcházejí, aby kód prošel. Mění je jen nové zadání od uživatele.
  - Když se test zdá špatně, neopravuj ho. Řekni to uživateli a zeptej se, jestli se má změnit funkce.

## Postup u každé změny
1. **Zadání → požadavky.** Přepiš zadání na očíslované požadavky v REQUIREMENTS.md (nové číslo, nebo upravený existující). Ukaž je uživateli. U větší změny přidej krátký plán.
2. **Kontrola dopadu před kódem.** Projdi REQUIREMENTS.md a testy, kterých se změna dotkne.
   - Když nový požadavek narazí na existující požadavek nebo rozhodnutí, **zastav se**. Dej uživateli varianty (AskUserQuestion) a nic nedělej, dokud nerozhodne.
   - Rozhodnutí zapiš do „Rozhodnutí“, nevyřešené do „Otevřené rozpory“.
3. **TDD.** Nejdřív testy se štítkem požadavku. Musí selhat ze správného důvodu. Teprve pak kód. Pak musí projít **celá** sada (`cd tests && npm test`).
4. **Nahlášená chyba** dostane nejdřív test, který ji zopakuje. Až potom oprava.
5. **Nezávislá kontrola u větší změny:** druhý model (subagent) projde diff proti REQUIREMENTS.md a hledá, co se může rozbít. Nálezy oprav, ale testy podle bodu výše neměň.
6. **Malé kroky:** jeden commit = jedna změna. Nasazuje se jen přes zelené testy (GitHub Actions: test → deploy).
7. **Na konci:** aktualizuj REQUIREMENTS.md a paměť. Uživateli napiš, co je ověřené (testy, CI, náhled) a co ne (např. skutečný telefon).

## Žádné tiché rozhodnutí (R24)
- **V appce:** co appka rozhodne sama, to v kartě nebo souhrnu řekne slovy (`st.why`, poznámka v souhrnu). Nové automatické rozhodnutí = nový řádek vysvětlení + test.
- **V práci AI:** když v zadání něco chybí nebo jde udělat víc způsoby, zeptej se. Když už něco rozhodneš sám, řekni to výslovně a zapiš do „Rozhodnutí“ jako návrh k potvrzení.

## Definice hotového
- Požadavek je v REQUIREMENTS.md a má testy, celá sada je zelená lokálně i na GitHubu.
- Zvýšená verze: `APP_VERSION` v `app/app.js`, `app/version.json`, `VERSION` v `app/sw.js`.
- Nasazeno na https://jemny.github.io/nabijeci-planovac/ a `version.json` vrací novou verzi.
- Uživateli napsáno, co je ověřené a co ne.

## Další pravidla
- **Testy s pevnými daty:** trasy z `tests/fixtures` (OSRM), skutečná data stanic z `app/data`. Testy kontrolují pravidla, ne konkrétní jména stanic, pokud to jde.
- **Osobní data nikdy do repa** (veřejné na GitHubu): domácí adresa, VIN, poloha, záznamy z Home Assistantu, osobní cesty. Fixtures jsou mezi středy měst.
- **Vlastnictví souborů mezi vlákny:**
  - `app/` a `tests/` mění plánovací vlákno.
  - `build/` a `app/data/` mění datové vlákno. Kalibraci (`app/data/calibration.json`) píše noční sběrač ze skillu ev-trip-cost.
  - Před zásahem do cizí části napiš vlastníkovi.
- **Spuštění testů:** `cd tests && npm ci && npm test`. Test-harness (`tests/harness.mjs`) spouští celou appku v jsdom. Když mu chybí funkce prohlížeče, doplň ji tam, nikdy ne do testu.
- **Commit:** končí řádkem `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
