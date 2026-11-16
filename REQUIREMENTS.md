# Požadavky na Nabíjecí plánovač

Tohle je závazný seznam toho, co appka dělá. Každý požadavek má číslo a testy, které ho hlídají (štítek `[Rn]`
v názvu testu). `tests/requirements.test.mjs` kontroluje, že každý požadavek má test a každý test patří k požadavku.
Požadavek se mění jen zadáním uživatele. Postup změn je v [CLAUDE.md](CLAUDE.md).

## Požadavky

### R0 — Každý požadavek má test
Každý požadavek tady má aspoň jeden test se štítkem `[Rn]` a každý test patří k požadavku. Testy jsou závazné: nemění se, aby kód prošel. Nasazuje se jen přes zelené testy (GitHub Actions). Kontroluje `tests/requirements.test.mjs`.

### R1 — Trasa a hledání
Odkud, Přes (víc míst za sebou, přidat, odebrat, posunout) a Kam. Místo jde najít vyhledáním (našeptávač), vzít z GPS (◎), napsat jako souřadnice nebo vzít uložený Domov (⌂). Bez Odkud nebo Kam appka řekne, co chybí. Po hledání se formulář sbalí do řádku s cestou a „Upravit“ ho otevře.

### R2 — Okno zastávek je závazné
Zastavovat se po čase jízdy (např. 1:00 ± 15 min) nebo po km (např. 100 ± 20 km), opakovaně po celé trase. Každé další okno se počítá od předchozí zastávky, na cestě zpět od odjezdu z cíle. Když je cíl blíž než interval + tolerance, další zastávka se neplánuje. **Zastávku appka sama vybere jen uvnitř okna a jen v nastavené objížďce** (uživatel 15. 11. 2026: „zadal jsem 100 ± 20 km a nabídneš 136 km, to je v přímém rozporu“). **Když zastávku změníš** (rozšíření okna, Vybrat mimo okno, jiná možnost v okně, oblíbená mimo okno), všechna další okna na té cestě se přepočítají od nové zastávky (uživatel 15. 11. 2026: „musí se tím pádem přepočítat i vše potom… budeme zastavovat buď dřív, nebo později“).

### R3 — Prázdné okno
Když v okně nic nevyhovuje, appka tam zastávku nevybere a řekne to. Nabídne tlačítko **Rozšířit tohle okno** tak, aby nejbližší stanice padla dovnitř: rozšíří se jen tohle okno, nastavení zůstane. K tomu nabídne nejbližší možnosti mimo okno (před ním, za ním, dál od trasy) s tlačítkem Vybrat. Vybraná je označená „mimo okno, vybral jsi“, rozšířené okno „okno rozšířené tvým klepnutím“. Viz rozhodnutí D1 a D5.

### R4 — Jen na pumpách
Zastávky jen u čerpacích stanic (káva, párek, záchod), výchozí zapnuto.

### R5 — Oblíbené pumpy
Oblíbené značky (výchozí MOL, ORLEN) mají v okně přednost. Oblíbená kousek mimo okno se u zastávky jen nabídne, sama se nevybere. Volba „jen oblíbené“. Oblíbené se nastavují v ☰.

### R6 — Karty a tarify
Cena podle nejlevnější z vybraných karet (E.ON, ČEZ, PRE, MOL, ORLEN, Shell, IONITY… včetně denních a nočních pásem a roamingu). Volba „jen stanice, kde zaplatím vybranou kartou“. Karty se vybírají v ☰.

### R7 — Auto a jízda
Min. výkon (≥ 100 kW), spotřeba (ručně, nebo naměřená v autě), časy jízdy (tempo ×0,93 jako Google), stanice bez známého výkonu, limit nabití v autě. Když vyjíždíš pod limitem a zastávka nabíjí nad něj, appka připomene limit zvednout.

### R8 — Tuhle nechci
Stanice (i její dvojče do 150 m) se skryje natrvalo. Seznam skrytých je v ☰ s tlačítkem Vrátit.

### R9 — Stojan podle baterie při příjezdu
Přijedeš s ≥ 50 % → stačí 150 kW a vyhraje levnější pásmo (E.ON 101–200 kW). Pod 50 % → nejrychlejší stojan, při rozdílu do 2 min rozhodne cena.

### R10 — Cesta tam i zpět
Volitelně i cesta zpět stejnou trasou v ten samý den. Zpátky nejdřív po příjezdu do cíle, a když zadaný čas nestihneš, appka to řekne.

### R11 — Moje cesty
Uložit cestu do telefonu, seznam v ☰ a rozjeté cesty nahoře na hlavní obrazovce, otevřít, smazat.

### R12 — Poslat do mobilu
Odkaz s cestou (místa a vybrané stanice v `#cesta=`, neposílá se na server), QR kód, kopírovat a sdílet. Odkaz otevře stejnou cestu se stejnými zastávkami.

### R13 — Kolik nabíjet
Na každé zastávce jen tolik, abys na další (nebo domů / do cíle) přijel s alespoň „Přijet s alespoň“ %. Chybí-li ≤ 2 %, jen káva. Když už nabíjíš, tak aspoň o 8 %, ale kvůli tomu minimu nikdy nad 80 %. Nad 80 % jen když to další úsek opravdu potřebuje, nejvýš 90 %. Zastávka navíc mimo okno jen když by jinak baterie nestačila, a je tak označená.

### R14 — Dokončit cestu a srovnání
Po cestě zapsat baterii na konci a km. Srovnání s auty na palivo (Volvo diesel 5 l, Talisman 6,5 l, benzín 8 l, ceny se dají upravit): elektro = veřejné nabíjení + dobití doma (6,61 Kč/kWh + 10 % ztráty), čas navíc na nabíječkách.

### R15 — Zápis skutečného nabíjení
U zastávky „Zapsat, jak to dopadlo“: text z aplikace, screenshot (čte se v telefonu) nebo ručně. Zbytek plánu se přepočítá i podle skutečné spotřeby a appka varuje, když to na další úsek nestačí.

### R16 — Jedu jinudy
Přeplánovat zbytek cesty z nového místa (cíl nebo poloha) přes nová místa. Odjetá část zůstane v cestě i ve srovnání. Zrušit vrátí původní cestu.

### R17 — Přestávky
První zastávka dne 10 min (káva, párek, záchod), každá další 5 min. Elektro stojí, dokud nabíjí.

### R18 — Strana dálnice
Odpočívadla přímo u dálnice jen na straně, kterou jedeš.

### R19 — Baterie na startu
Výchozí 100 % (před dlouhou cestou nabíjí na 100 %).

### R20 — Moje nastavení (☰)
Na širokém displeji vpravo, v mobilu menu ☰ (zavřít ✕, Escape, klepnutím vedle). Ve formuláři řádek se shrnutím nastavení, který panel otevře.

### R21 — Domů
Uložit „Odkud“ jako Domov, tlačítko ⌂ ho vyplní.

### R22 — Záloha a uložení
Nastavení i cesty se ukládají v zařízení. Záloha do souboru a načtení (neplatný soubor appka odmítne). Při prvním spuštění nabídne načíst zálohu.

### R23 — Nová verze appky
Po návratu do appky ukáže „Je tu nová verze“ a tlačítko Načíst. Stará cache nesmí držet starou verzi.

### R24 — Žádné tiché rozhodnutí
Co appka rozhodne sama, to řekne: proč vybrala tuhle stanici, proč nabíjí právě tolik (minimum 8 %, strop 80 %, jen káva), že nabízí stanice mimo okno a jak daleko, že je zastávka navíc kvůli baterii, že počítá se spotřebou naměřenou v autě, že některé stanice skryla nebo vynechala (protisměr), že posunula odjezd zpět. (Uživatel 15. 11. 2026: „žádné rozhodnutí za něj nesmí být tiché“.)

### R25 — Souhrn
Km, minuty nabíjení, Kč za proud na cestě (a celková cena cesty, R37), baterie podle plánu v cíli → doma, rezerva.

### R37 — Každá koruna se dá dohledat
Nahlášená chyba (uživatel 16. 11. 2026): „na druhé natankuju za 455, ale na konci píšeš, že celá cesta bude stát 953 Kč, tzn. někde počítáš s tím, že budu ještě nabíjet, ale neukazuješ to“. Rozdíl byla elektřina z domu, appka ale neřekla, odkud je.
- **Srovnání** rozepíše cenu elektra: nabíjení na zastávkách (každá nabíjecí zastávka jménem a cenou, stejnou jako v kartě) + elektřina z domu. Součet je cena v tabulce.
- **Elektřina z domu** se vysvětlí: baterie na startu → na konci (v cíli, doma nebo zapsaná), kolik % a kWh to je v baterii, kolik kWh ze zásuvky i se ztrátami a za kolik Kč/kWh.
- **Souhrn nahoře** u Kč za proud napíše, že je to jen nabíjení na cestě, a uvede celou cenu cesty i s elektřinou z domu, stejnou jako ve srovnání.

Hlídá to tests/costs.test.mjs.

### R36 — Formulář ve třech krocích
Zadání je ve třech očíslovaných, podbarvených blocích pod sebou:
- **1 Trasa:** odkud, přes, kam, + přidat místo.
- **2 Kdy a baterie:** odjezd, baterie na startu, přijet s alespoň, počítat i cestu zpět, zpátky vyrážím v.
- **3 Zastávky:** po čase nebo po km, interval ± tolerance, objížďka, jen na pumpách.

Otevřený je vždy jen jeden krok, ten, na který klepneš. Zavřené ukazují shrnutí toho, co je v nich nastavené. Když chybí odkud nebo kam, otevře se krok 1. (Uživatel 15. 11. 2026, D6 = B: „když dáš těm blokům nějaké podbarvení, takže bude lépe vidět, že tam jsou“.)

### R29 — Nabíjecí model
Doba nabíjení podle křivky (fdrive.cz) × k z vlastních měření. Čím plnější baterie, tím pomaleji. Data z auta (Home Assistant) model zpřesňují.

### R30 — Mapa
Tlačítko Mapa ukáže trasu se zastávkami, Seznam se vrátí.

### R31 — Do navigace
Google Mapy tam a zpět přes zastávky (pro Send2Car do Mercedesu), Waze po krocích, GPX, sdílení plánu. Tlačítko Do navigace na export skočí.

### R32 — Karta zastávky
Waze a Google Mapy přímo na stanici, rada ke stojanu a k placení (vypnout Plug & Charge).
**Pruh baterie** u nabíjecí zastávky ukáže tři věci, každou pod svým kusem pruhu: nad světlou částí kolik % nabiješ, „přijedeš X %“ vlevo před čárkou na konci tmavé části, „odjedeš Z %“ vpravo za čárkou na konci světlé části (D16). Když se nápis do karty nevejde, je hned na druhé straně své čárky, a kdyby se pak překrýval s druhým nápisem, posune se o řádek níž. Čísla na sebe sedí (přijedeš + nabiješ = odjedeš). U zapsané zastávky „příjezd, nabito, odjezd“. (Nahlášená chyba, uživatel 16. 11. 2026: vlevo 23 %, úplně vpravo 50 %, mezi tím +27 %, „ty modré čáry prostě nejsou dobře, musí tam být vidět, s kolika % přijedu, kolik % načerpám a kolik budu mít při odjezdu“.)

### R33 — Jiné možnosti v okně
U zastávky seznam dalších stanic v okně s tlačítkem Vybrat.

### R34 — Vzhled
Rozvržení podle návrhu 1 (Palubní deska), barvy 1H (grafit a ocelově modrá), světlá i tmavá podle telefonu. Ověření: ručně (návrhy na plátně https://claude.ai/artifact/TFCJ4Q9NLwG3febS42GZen).
**Tmavá varianta je schválená** (uživatel 15. 11. 2026: „ta tmavá varianta se mi moc líbí, neměň ji“). Její barvy se nemění, dokud uživatel neřekne jinak. Hlídá to test v tests/look.test.mjs. Světlou variantu uživatel zhodnotí 16. 11. 2026.
Všechna pole, do kterých se píše nebo vybírá (i čas návratu a odjezd), mají stejný vzhled jako „Baterie na startu“: vlastní podbarvení, rámeček, zaoblení, i na iPhonu (uživatel 15. 11. 2026: šedé pole času „je hnusné“). Ověření: tests/look.test.mjs.

### R35 — Data nabíječek
DC stanice v CZ, SK, PL, AT a DE z OSM, OCM, mapy E.ON a Tesly, s aktualizací každé pondělí a na vyžádání. Ověření: ručně (build v `build/`, kontroluje se počtem stanic v `meta.json`).

## Rozhodnutí

Volby, které padly mezi variantami. Mění se jen zadáním uživatele.

- **D1 (15. 11. 2026, uživatel vybral C):** „prázdné okno nabídne tlačítko na rozšíření okna a nejbližší stanice“. Tlačítko okno roztáhne tak, aby nejbližší stanice padla dovnitř, a plán přepočítá. Pod ním zůstanou nejbližší stanice před oknem a za ním (i daleko) s Vybrat. Varianty byly nakreslené: A jen nabídka, B jen kousek mimo okno, C nabídka + rozšíření.
- **D2 (15. 11. 2026):** oblíbená pumpa mimo okno se jen nabízí, nikdy se nevybere sama (R2, R5). Nahradilo dřívější „oblíbená vyhraje i kousek mimo okno“.
- **D3 (15. 11. 2026):** spotřeba pro plán se počítá z poklesu baterie, ne z palubního počítače, který ukazuje méně.
- **D4 (15. 11. 2026):** živé čtení baterie z auta v telefonu (varianta C) zatím ne. Data z auta jdou přes noční sběrač.

- **D5 (15. 11. 2026, uživatel vybral A):** rozšíří se jen to jedno prázdné okno, tvoje nastavení (např. 100 ± 20 km) zůstane. „Musí se tím pádem přepočítat i vše potom.“ Další okna navazují na novou zastávku. Platí pro každou změnu zastávky (R2). Starší test `[R3] … po Vybrat … „mimo okno, vybral jsi“` čekal, že ubude právě jedno prázdné okno. Podle D5 je upravený: kontroluje, že vybrané okno má tvou stanici (uživatel: „to rozhodnutí už bylo udělané dřív“).

- **D6 (15. 11. 2026, uživatel vybral B):** formulář ve třech krocích (R36) s podbarvenými bloky. Rozdělení polí do kroků je odvozené z nakreslené varianty (krok 2 i cesta zpět, krok 3 i objížďka a pumpy). Další krok se sám neotevírá.

- **D15 (16. 11. 2026, uživatel vybral A):** dlaždice s Kč nahoře ukazuje jen nabíjení na cestě („za proud na cestě“, to, co zaplatíš kartou na zastávkách). Celá cena i s elektřinou z domu je ve větě pod ní a rozepsaná ve srovnání (R37). Varianta B (celá cena v dlaždici) nevybrána.
- **D16 (16. 11. 2026, uživatel):** u pruhu baterie „přijedeš 30 % dej doleva před [čárku] a odjedeš 71 % doprava za čárku, jinak to vypadá dobře“. Slovo a číslo jsou pod sebou, aby se nápis vešel i na užším telefonu. Kvůli tomu se změnil test `[R32] pruh baterie: přijedeš X %, nabiješ +Y %, odjedeš Z %…`: dřív dovoloval nápis na kterékoli straně čárky a odjezd chtěl o řádek níž. Teď chce příjezd před čárkou a odjezd za ní na stejném řádku. Nový test hlídá případ, kdy se nápis nevejde.

## Otevřené rozpory

### Návrhy z WattBoxu k rozhodnutí (15. 11. 2026, čekají na uživatele)
Prošel jsem wattbox.cz (plánovač, mapa, detail stanice, aplikace). Varianty jsou nakreslené v rozhovoru, doporučená je u každého A.
- **D7 Počasí a kopce v plánu:** A spotřeba po úsecích podle teploty, větru a stoupání + varování (mlha, sníh, náledí); B jen varování, spotřeba zůstane; C nic. Data: Open-Meteo (zdarma, bez klíče), bez prvních a posledních 3 km trasy.
- **D8 Odkaz na WattBox u zastávky:** A tlačítko „Volno a fotky na WattBoxu“ v kartě zastávky (živé volno, fotky, zkušenosti, kdy bývá plno); B i u každé jiné možnosti; C nic. Živé volno sami získat nejde: veřejná mapa E.ON stav nemá, volné API není.
- **D9 Otevřená pumpa v čase příjezdu:** A když je obchod pumpy v čase příjezdu zavřený, appka vybere jinou v okně a napíše proč; B jen varuje a nabídne otevřenou; C nic. OSM má otevírací dobu u 84 % pump MOL, OMV, Shell, Benzina a EuroOil. Potřebuje export v datovém vlákně.
- **D10 Poplatky za minuty na stojanu:** A cena zastávky započítá poplatek za čas nad volné minuty (E.ON od 201 kW po 30 min 2 Kč/min) a napíše to; B jen cena energie jako dnes.
- **Nedoporučuju:** nejlevnější a nejkratší trasa (pravidlo jen nejrychlejší), CarPlay, widgety a upozornění do telefonu (webová appka bez serveru to neumí), Apple Mapy a Mapy.com (pravidlo Google Mapy), katalog aut, STK, doklady.

### Návrhy z ABRP k rozhodnutí (15. 11. 2026, čekají na uživatele)
Prošel jsem ABRP bez přihlášení. Celé srovnání ABRP, WattBoxu a našeho plánovače je v [docs/srovnani-abrp-wattbox.md](docs/srovnani-abrp-wattbox.md). Uživatel chce grafické prvky místo textu („např. nastavení, na kolik nabíjet, je posuvník“). Varianty jsou nakreslené v rozhovoru, doporučená je u každého A.
- **D11 Formulář s posuvníky a tlačítky:** A baterie a rezerva posuvníkem (ťuknutím na číslo jde napsat přesně), interval, tolerance a objížďka jako tlačítka; B posuvník jen u baterie a rezervy; C jako dnes. Pole si nechají stejné `id`, takže testy zůstanou.
- **D12 Na kolik nabít u zastávky:** A posuvník „Nabít do“ v kartě zastávky, zbytek plánu se přepočítá (D5) a karta napíše „plán navrhl X %, nastavil jsi Y %“ (R24); B jako A a k tomu „Zůstanu 30 min / 45 min / 1 h“; C jako dnes (R13 určí sám).
- **D13 Ikony místo textu:** A výkon bleskem, počet stojanů, baterie a minuty ikonou, na mapě % baterie u každého bodu; B ikony jen v kartách; C jako dnes.
- **D14 Graf baterie po trase:** A graf v souhrnu (% podle km, okna zastávek, čára rezervy); B graf až na klepnutí; C jako dnes.

## Fronta (až bude vše hotové a popsané)

- ~~**WattBox:** podívat se, co WattBox nabízí, a říct, co by se plánovači hodilo (uživatel 15. 11. 2026).~~ Hotovo, návrhy D7–D10 v „Otevřené rozpory“.
