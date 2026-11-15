# Srovnání: ABRP, WattBox a náš Nabíjecí plánovač

Stav 15. 11. 2026. Zkoušel jsem:
- **ABRP:** web abetterrouteplanner.com, verze 8.0, bez přihlášení.
- **WattBox:** wattbox.cz, přihlášený.

V obou stejné auto (Mercedes CLA Shooting Brake 350 4MATIC, 85 kWh) a stejná trasa Ostrava → Praha se 100 %.

## Co umí ABRP bez přihlášení

**Auto**
- Fotka auta, typ konektoru (CCS), základní spotřeba (výchozí 155 Wh/km), nejvyšší rychlost, „relativní rychlost“ v %, opotřebení baterie v %.
- Živá data z auta a historie jízd jen s účtem.

**Baterie na startu:** velký zelený posuvník na kartě auta.

**Nabíjení**
- Karty. E.ON Drive (CZ) tam je, ORLEN ani ČEZ jsem nenašel.
- Preferované a vyloučené sítě, vyloučené nabíječky, nejmenší počet stojanů, strop nabíjení.
- Přepínače WC, přívěs, pes, rodina.
- Rezerva při příjezdu zvlášť na nabíječku a zvlášť do cíle.

**Trasa**
- Počet zastávek jako tři tlačítka: optimálně, méně, co nejméně.
- Vyhnout se mýtu, hranicím, dálnicím a trajektům.
- Živá doprava, „zpomalit, aby to dojelo“.
- Počasí: živé, podle ročního období, nebo ručně.

**Plán**
- Varianty trasy jako štítky (3 h 29 / 3 h 41 / 3 h 42) a na mapě („+12 min, ušetří energii“).
- Souhrn ikonami: jízda, nabíjení, km, počet zastávek, kWh, mýto, cena.
- Na mapě vlajky s % baterie na startu a v cíli.

**Řádek zastávky** (skoro bez textu)
- Výkon jako blesky (⚡⚡⚡ 400 kW).
- Živé volno (zelená tečka 14/15).
- Čas, logo sítě a ikona baterie „18–40 %“ s minutami.
- Hvězdičky hodnocení a ikony WC, jídla a kávy.

**Tabulka plánu:** baterie při příjezdu a odjezdu, cena, karta, doba nabíjení, km, doba jízdy.

**Úprava zastávky**
- Posuvník „baterie při příjezdu“ s předvolbami 5 / 10 / 15 %.
- Nabíjení „podle plánu“ nebo „ručně“: výkon stojanu tlačítky 50 / 200 / 300 / 400 kW, pak posuvník „nabít do“ nebo délka.
- Odjezd „podle plánu“, „odjet v“ nebo „zůstat X min“.
- Vyměnit nabíječku, nepoužívat ji v plánu.

**Nabíječky po trase**
- Karty s velkými fotkami, km od startu, výkon, volno, hodnocení a ikony služeb.
- Filtry jako štítky: řazení, výkon, počet stojanů, sítě, karty, služby, konektory.

**Detail nabíječky**
- Otevírací doba, „otevřeno všem“, „naposledy úspěšně nabíjeno před 2 h“.
- Volno po jednotlivých konektorech.
- Ceník po výkonech a moje karty (v USD, měna jde přepnout).
- Služby s hlasy (jídlo, WC, pes), hodnocení, fotky, nabíječky a služby v okolí.
- Preferovat nebo vyhnout se síti, záložka, sdílení, nahlášení chyby.

**Jízda:** navigace s rychlostí, omezením a radary.

**Uložení a sdílení plánu:** jen s účtem pro více zařízení.

**Co vyšlo na trase Ostrava → Praha**
- **Výchozí spotřeba (155 Wh/km):** bez zastávky, ze 100 % na 11 %, 72 kWh. Náš plánovač počítá zimních 23,8 kWh/100 km a zastávku potřebuje.
- **Spotřeba 200 Wh/km:** jedna zastávka ČEZ Herálec 400 kW po 2 h 18 min, nabíjení 18 → 40 % za 5 minut.

## Srovnání

| Funkce | ABRP | WattBox | My |
|---|---|---|---|
| Spotřeba ze skutečného auta | jen s účtem a živými daty | ne, model auta | ano (Home Assistant, pokles baterie) |
| Křivka nabíjení | model auta | model auta | model + kalibrace ze skutečných nabíjení |
| Okno zastávky (čas nebo km ± tolerance) | ne | přestávka po 1–2 h | ano, závazné (R2) |
| Oblíbené pumpy, jen na pumpě | ne | ne | ano |
| Stojan podle baterie při příjezdu | ne | ne | ano |
| Nejmenší dobití 8 %, nad 80 % ne | ne (plánuje i 5 min) | ne (plánuje i 2 min) | ano |
| Ceny mých českých karet | jen E.ON, v USD | ano, všech 10 | ano |
| Cena podle hodiny příjezdu | ne | ano | ano |
| Cesta zpět týž den | ne | ne | ano |
| Moje cesty, zápis skutečného nabíjení, srovnání s naftou | historie s účtem | srovnání s benzínem | ano |
| Počasí a kopce ve spotřebě | ano | ano | ne → **D7** |
| Živé volno, fotky, hodnocení | ano | ano (část sítí) | ne → **D8** (odkaz) |
| Služby u stanice, otevírací doba | ano | do 300 m | ne → **D9** |
| Poplatky za minuty | ne | ano | ne → **D10** |
| Posuvníky místo čísel (baterie, rezerva) | ano | ne | ne → **D11** |
| Posuvník „nabít do“ u zastávky | ano | ne | ne, jen výměna stanice → **D12** |
| Ikony místo textu (výkon, baterie, služby) | ano | částečně | částečně → **D13** |
| Baterie po trase jako obrázek | % na mapě a v řádcích | ne | pruh u zastávky, souhrn číslem → **D14** |
| Varianty trasy (rychlejší, úspornější) | ano | ano | ne, schválně (jen nejrychlejší) |
| Navigace v appce, radary | ano | ne | ne, předá do Google Map |
| CarPlay, Android Auto | ano | ano | ne (webová appka) |

## Co z ABRP dává smysl

- **Posuvníky a tlačítka místo čísel a rozbalovacích seznamů:** baterie na startu, „přijet s alespoň“, interval, tolerance, objížďka. Uživatel to výslovně chce. → **D11**
- **Posuvník „nabít do“ u každé zastávky:** zbytek plánu se přepočítá jako u každé změny zastávky (D5). → **D12**
- **Ikony místo textu v plánu:** výkon jako blesky, baterie jako ikona s náplní, počet stojanů, služby. % baterie na mapě u každého bodu. → **D13**
- **Baterie po trase jako graf:** kolik % kde bude, s vyznačenými okny zastávek a čárou rezervy. ABRP to dřív mělo, my bychom k tomu přidali okna. → **D14**
- **Počasí, živé volno a služby:** to samé nabízí WattBox. Řeší to D7–D9, nová rozhodnutí nejsou potřeba.

## Co z ABRP nedává smysl

- **Varianty trasy, vyhnout se dálnici nebo mýtu:** uživatel jezdí jen nejrychlejší trasu. Dálniční známku mají elektroauta zdarma.
- **Navigace, radary, CarPlay:** navigaci dělá Google Mapy a auto, webová appka do CarPlay nejde.
- **Rezerva zvlášť pro zastávky a pro cíl:** u nás platí jedno „přijet s alespoň“ pro všechno (R13). Na nabíječce ráno nic nehrozí a jedno číslo je jednodušší.
- **Volby „méně zastávek“:** naše zastávky dělá pravidlo kávy a záchodu po čase nebo km, ne baterie.
- **Výchozí spotřeba 155 Wh/km:** na zimu příliš optimistická. My bereme skutečnou spotřebu z auta.
- **Živá data z auta přes ABRP:** jen s účtem a placenou verzí. My máme vlastní data z Home Assistantu.
