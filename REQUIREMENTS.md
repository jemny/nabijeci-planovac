# Požadavky na Nabíjecí plánovač

Tohle je závazný seznam toho, co appka dělá. Každý požadavek má číslo a testy, které ho hlídají (štítek `[Rn]`
v názvu testu). `tests/requirements.test.mjs` kontroluje, že každý požadavek má test a každý test patří k požadavku.
Požadavek se mění jen zadáním uživatele. Postup změn je v [CLAUDE.md](CLAUDE.md).

## Požadavky

### R0 — Každý požadavek má test
Každý požadavek tady má aspoň jeden test se štítkem `[Rn]` a každý test patří k požadavku. Testy jsou závazné: nemění se, aby kód prošel. Nasazuje se jen přes zelené testy (GitHub Actions). Totéž platí pro rozhodnutí: každé rozhodnutí v „Rozhodnutí“ odkazuje na požadavek, který má test, nebo je výslovně označené „(bez funkce v appce)“, a stejné číslo D není v souboru dvakrát (uživatel 16. 11. 2026). Rozhodnutí, na kterém se ještě pracuje, je v „Rozpracované“ i se svým požadavkem. Kontroluje `tests/requirements.test.mjs`.

### R1 — Trasa a hledání
Odkud, Přes (víc míst za sebou, přidat, odebrat, posunout) a Kam. Místo jde najít vyhledáním (našeptávač), vzít z GPS (◎), napsat jako souřadnice nebo vzít uložený Domov (⌂). Bez Odkud nebo Kam appka řekne, co chybí. Po hledání se formulář sbalí do řádku s cestou a „Upravit“ ho otevře.

### R2 — Okno zastávek je závazné
Zastavovat se po čase jízdy (např. 1:00 ± 15 min) nebo po km (např. 100 ± 20 km), opakovaně po celé trase. Každé další okno se počítá od předchozí zastávky, na cestě zpět od odjezdu z cíle. Když je cíl blíž než interval + tolerance, další zastávka se neplánuje. **Zastávku appka sama vybere jen uvnitř okna a jen v nastavené objížďce** (uživatel 15. 11. 2026: „zadal jsem 100 ± 20 km a nabídneš 136 km, to je v přímém rozporu“). **Když zastávku změníš** (rozšíření okna, Vybrat mimo okno, jiná možnost v okně, oblíbená mimo okno), všechna další okna na té cestě se přepočítají od nové zastávky (uživatel 15. 11. 2026: „musí se tím pádem přepočítat i vše potom… budeme zastavovat buď dřív, nebo později“).

### R3 — Prázdné okno
Když v okně nic nevyhovuje, appka tam zastávku nevybere a řekne to. Nabídne tlačítko **Rozšířit tohle okno** tak, aby nejbližší stanice padla dovnitř: rozšíří se jen tohle okno, nastavení zůstane. K tomu nabídne nejbližší možnosti mimo okno (před ním, za ním, dál od trasy) s tlačítkem Vybrat. Vybraná je označená „mimo okno, vybral jsi“, rozšířené okno „okno rozšířené tvým klepnutím“. Viz rozhodnutí D1 a D5.

### R4 — Jen na pumpách
Zastávky jen u čerpacích stanic, výchozí zapnuto.

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
Na každé zastávce jen tolik, abys na další přijel s alespoň „Na zastávku přijet s alespoň“ % a do cíle (při cestě zpět i domů) s alespoň „Do cíle dojet s“ % (R42). Chybí-li ≤ 2 %, jen přestávka bez nabíjení. Když už nabíjíš, tak aspoň o 8 %, ale kvůli tomu minimu nikdy nad 80 %. Nad 80 % jen když to další úsek opravdu potřebuje, nejvýš 90 %. Zastávka navíc mimo okno jen když by jinak baterie nestačila, a je tak označená.

### R14 — Dokončit cestu a srovnání
Po cestě zapsat baterii na konci a km. Srovnání s auty na palivo (Talisman 6,5 l a benzín 8 l, ceny se dají upravit): elektro = veřejné nabíjení + dobití doma (6,61 Kč/kWh + 10 % ztráty), čas navíc na nabíječkách.

Jedno dřív srovnávané auto je vyřazené i se svými údaji (uživatel 16. 11. 2026: „odstraň odevšad … a jeho údaje“). Neukáže se ani z nastavení uloženého v telefonu: seznam aut uložený před 16. 11. 2026 se nahradí výchozím, ceny paliv zůstanou (D18).
### R15 — Zápis skutečného nabíjení
U zastávky „Zapsat, jak to dopadlo“: text z aplikace, screenshot (čte se v telefonu) nebo ručně. Zbytek plánu se přepočítá i podle skutečné spotřeby a appka varuje, když to na další úsek nestačí.

### R16 — Jedu jinudy
Přeplánovat zbytek cesty z nového místa (cíl nebo poloha) přes nová místa. Odjetá část zůstane v cestě i ve srovnání. Zrušit vrátí původní cestu.

### R17 — Přestávky
První zastávka dne 10 min, každá další 5 min. Elektro stojí, dokud nabíjí.

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
Co appka rozhodne sama, to řekne: proč vybrala tuhle stanici, proč nabíjí právě tolik (minimum 8 %, strop 80 %, jen přestávka), že nabízí stanice mimo okno a jak daleko, že je zastávka navíc kvůli baterii, že počítá se spotřebou naměřenou v autě, že některé stanice skryla nebo vynechala (protisměr), že posunula odjezd zpět. (Uživatel 15. 11. 2026: „žádné rozhodnutí za něj nesmí být tiché“.) U zastávky jsou vysvětlení pod „Víc o zastávce“; hned vidět je jen to, co jsi nastavil sám (Nabít do), a poplatek za minuty (D23).

**Jak daleko je nabízená stanice** se píše normální češtinou: „je o 9 minut dále“, „o 3 minuty dříve“, „o 8 km dále“, „o 8 km blíže“, „2,4 km od trasy“ (uživatel 16. 11. 2026: „je 9 min za oknem“ není dobrá čeština).
### R25 — Souhrn
Km, minuty nabíjení, Kč za proud na cestě (a celková cena cesty, R37), baterie podle plánu v cíli → doma, rezerva.

### R37 — Každá koruna se dá dohledat
Nahlášená chyba (uživatel 16. 11. 2026): „na druhé natankuju za 455, ale na konci píšeš, že celá cesta bude stát 953 Kč, tzn. někde počítáš s tím, že budu ještě nabíjet, ale neukazuješ to“. Rozdíl byla elektřina z domu, appka ale neřekla, odkud je.
- **Srovnání** rozepíše cenu elektra: nabíjení na zastávkách (každá nabíjecí zastávka jménem a cenou, stejnou jako v kartě) + elektřina z domu. Součet je cena v tabulce.
- **Elektřina z domu** se vysvětlí: baterie na startu → na konci (v cíli, doma nebo zapsaná), kolik % a kWh to je v baterii, kolik kWh ze zásuvky i se ztrátami a za kolik Kč/kWh.
- **Souhrn nahoře** u Kč za proud napíše, že je to jen nabíjení na cestě, a uvede celou cenu cesty i s elektřinou z domu, stejnou jako ve srovnání.

Hlídá to tests/costs.test.mjs.

### R38 — Bez soukromých poznámek
Appka nepíše, co uživatel dělá na zastávce. Jsou to jeho soukromé poznámky (uživatel 16. 11. 2026: „tyto texty odstraň, to jsou mé soukromé poznámky“). Zastávka bez nabíjení je „bez nabíjení“, krátká zastávka „přestávka“. Platí pro appku i pro její zdrojové soubory. Hlídá to tests/private-notes.test.mjs.

### R36 — Formulář ve třech krocích
Zadání je ve třech očíslovaných, podbarvených blocích pod sebou:
- **1 Trasa:** odkud, přes, kam, + přidat místo.
- **2 Kdy a baterie:** odjezd, baterie na startu, na zastávku přijet s alespoň, do cíle dojet s, počítat i cestu zpět, zpátky vyrážím v.
- **3 Zastávky:** po čase nebo po km, interval ± tolerance, objížďka, jen na pumpách.

**Všechny tři bloky jsou pořád rozbalené**, nic v nich není schované a nadpis bloku je jen nadpis, ťuknutím se nic nesbalí (D17). Když chybí odkud nebo kam, appka řekne, co chybí, a posune se ke kroku 1. (Uživatel 15. 11. 2026, D6 = B: „když dáš těm blokům nějaké podbarvení, takže bude lépe vidět, že tam jsou“. Uživatel 16. 11. 2026: „těch boxů není vidět, že by něco skrývaly, dokud se na ně neťukne… drž je rozbalené“.)

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
**Tmavá varianta je schválená** (uživatel 15. 11. 2026: „ta tmavá varianta se mi moc líbí, neměň ji“). Její barvy se nemění, dokud uživatel neřekne jinak. Hlídá to test v tests/look.test.mjs. **Světlá varianta je schválená** (uživatel 16. 11. 2026: „ano, později uděláme pár změn“, D21). Její barvy se mění jen zadáním uživatele. Hlídá to test v tests/look.test.mjs.
Všechna pole, do kterých se píše nebo vybírá (i čas návratu a odjezd), mají stejný vzhled jako „Baterie na startu“: vlastní podbarvení, rámeček, zaoblení, i na iPhonu (uživatel 15. 11. 2026: šedé pole času „je hnusné“). Ověření: tests/look.test.mjs.

### R35 — Data nabíječek
DC stanice v CZ, SK, PL, AT a DE z OSM, OCM, mapy E.ON a Tesly, s aktualizací každé pondělí a na vyžádání.
Když hlavní server OpenStreetMap (Overpass) nejede, stahování zkusí záložní servery se stejnými daty (D20). Odpověď s chybou se nikdy neuloží jako data. Když nejede žádný server, běh skončí chybou a appka zůstane s posledními daty. Ověření: tests/osm-download.test.mjs (záložní servery, falešné servery bez internetu). Počet stanic se kontroluje ručně v `meta.json`.
Data pro R44 a R46 (D9, D10): `stations.json` má sloupec `oh` s otevírací dobou (OSM `opening_hours`) té pumpy, která je u stanice jako `fuel`. Bez pumpy nebo bez údaje v OSM je prázdný. Pásma cen v `cards.json` a `prices.json` mají `free_min` (minuty zdarma od začátku nabíjení) a `czk_min` (Kč za každou další minutu ve dne), `czk_min_night` jen tam, kde se v noci platí jinak. Poplatky jsou jen z ověřených ceníků: E.ON od 18. 6. 2026, ČEZ od 1. 11. 2026, PRE POINT od 1. 12. 2025 a roaming PRE od 1. 7. 2026. U ostatních sítí pole chybí. Ověření: tests/data-fees-hours.test.mjs.
Uložení nových dat na GitHubu nejdřív vezme commity, které na main mezitím přibyly, a teprve pak data pošle. Log stahování je vidět průběžně. Ověření: tests/data-workflow.test.mjs.
Když soubor OSM nedodá žádný server ani v opakovaných kolech, dokud nevyprší čas na stahování (5,5 hodiny, D26), použijí se data z posledního běhu (D24). Německo se stahuje po 9 kusech mapy. Každou noc se běh pustí znovu, když poslední stahování selhalo nebo má některý stát jen data z minula. Useknutá nebo prázdná odpověď serveru se bere jako výpadek. Na GitHubu se předávají jako artefakt „osm-raw“, který vydrží 90 dní a uloží se i po neúspěšném běhu. Bez dat z minula běh skončí chybou jako dřív. `meta.json` má `osm_countries`: u každého státu datum dat OSM (starší z nabíječek a pump) a `fresh` (stažené teď / z minula). Stahování dat neblokuje nasazení appky. Nasadí se jen `app/`, která prošla testy. Pondělní běh je v 03:17 UTC. Ověření: tests/osm-fallback.test.mjs, tests/osm-robust.test.mjs, tests/osm-pieces.test.mjs.

### R39 — Na kolik nabít u zastávky
U každé zastávky, která ještě není zapsaná, je posuvník „Nabít do“: od % při příjezdu do 100 %, výchozí je návrh plánu. Po puštění posuvníku se zbytek plánu přepočítá (D5). Karta napíše „Plán navrhl X %, nastavil jsi Y %“ a má tlačítko „Vrátit na plán“. Tvoje číslo platí přesně, minimum 8 % a strop z R13 jsou jen pro návrh plánu. Když pak baterie na další úsek nestačí, appka přidá zastávku „kvůli dojezdu“ (R13). Nastavení patří k té stanici: když stanici vyměníš, platí zase plán. Uloží se s cestou. (D12 = A)

### R40 — Graf baterie po trase
V souhrnu je graf: % baterie podle km od startu po cíl (při cestě zpět až domů). U nabíjecí zastávky svislý skok z příjezdu na odjezd, okna zastávek jako podbarvené pruhy, čárkovaně rezerva na zastávky a „Do cíle dojet s“. Graf má i popis slovy (pro čtečku obrazovky). (D14 = A)

### R42 — Rezerva na zastávky a do cíle zvlášť
„Na zastávku přijet s alespoň“ (výchozí 10 %) platí pro příjezd na každou zastávku. „Do cíle dojet s“ (výchozí 10 %, u starého nastavení stejně jako rezerva, aby se uložené plány samy nezměnily) platí pro příjezd do cíle, a když jedeš i zpátky, i pro příjezd domů. (D19 = A)

### R41 — Posuvníky a tlačítka ve formuláři
Baterie na startu, Na zastávku přijet s alespoň a Do cíle dojet s mají posuvník. Číslo vedle posuvníku je pole, do kterého jde napsat přesně, a oba se drží stejné hodnoty. U rezervy na zastávky jsou předvolby 10 / 15 / 20 %, „Do cíle dojet s“ má jen posuvník a číslo (D22). Interval, tolerance a objížďka jsou tlačítka s předvolbami. Tlačítko „Jiný“ ukáže dosavadní pole pro jinou hodnotu. Pole mají stejná `id` jako dřív. (D11 = A)
Jezdec každého posuvníku (i „Nabít do“ u zastávky, R39) jede přes celou šířku čáry: na nejmenší hodnotě (např. 0 %) je úplně vlevo, na 100 % úplně vpravo (nahlášená chyba, uživatel 16. 11. 2026). Test hlídá každý posuvník v appce, i nově přidaný do index.html nebo app.js (uživatel: „Ano, rozšiř“). Ověření: tests/slider-ends.test.mjs.

### R43 — Ikony v kartě zastávky
V kartě zastávky jsou u údajů ikony: výkon bleskem, počet stojanů zástrčkou, doba nabíjení hodinami, baterie při příjezdu baterií. Text u nich zůstává. Na mapě se nic nemění. (D13 = B)

### R45 — Varování před počasím na trase
Appka zjistí předpověď na trase v čase, kdy tam pojedeš (Open-Meteo, zdarma, bez klíče): mlha, sníh, mrznoucí déšť a náledí (teplota do 1 °C se srážkami). Spotřebu nemění. Varování je v souhrnu s místem a časem. Když je počasí v pořádku, souhrn o něm mlčí (D23). Body na trase jsou zaokrouhlené na 0,01° a žádný není blíž než 3 km vzdušnou čarou od startu, cíle a míst „přes“, aby se neposílala adresa domova. Na cestě zpět se km počítají od cíle, stejně jako v kartách zastávek. Když předpověď nejde načíst (nebo nepřijde do 10 s) nebo je cesta dál než 16 dní, souhrn to řekne. (D7 = B)

### R44 — Poplatek za minuty na stojanu
Když síť účtuje poplatek za čas nad volné minuty (údaj v ceníku `prices.json`) a nabíjení podle plánu trvá déle, cena zastávky ho započítá a karta napíše, kolik to je a za kolik minut. Bez údaje v ceníku jen cena energie. (D10 = A)

### R46 — Zavřená pumpa v čase příjezdu
Když má obchod pumpy u zastávky v čase příjezdu podle otevírací doby zavřeno, karta to řekne a nabídne pumpu v okně, která má otevřeno, s tlačítkem Vybrat. Sama nic nemění. Bez otevírací doby v datech nic neříká. (D9 = B)

### R47 — Co nejméně textu
Na stránce je jen text, který je nutný (uživatel 16. 11. 2026: „snažím se co to jde mít co nejméně textu na té stránce, takže odstraňuju, co kde není nutné“). Podle review textů (D23):
- **Formulář:** bez řádku s autem nad nadpisem, bez vysvětlivek pod rezervami, pod „Počítat i cestu zpět“, pod „Jen na pumpách“ a pod objížďkou; nápověda okna jen „První zastávka … od startu.“; zdroje dat jsou v ☰ → O appce.
- **☰ Moje nastavení:** u bloku nejvýš jedna krátká věta, prázdný seznam jen „Zatím žádné.“
- **Souhrn:** celá cena jednou větou (R37), vynechaná odpočívadla krátce (R18); počasí jen když varuje (R45).
- **Karta zastávky:** vysvětlení pod „Víc o zastávce“ (R24), rada ke stojanu a placení heslovitě, bez nabíjení jen „Přijedeš s ~X %“, prázdné okno krátce.
- **Do navigace, Dokončit cestu, Srovnání:** Mercedes jedním řádkem, bez věty nad poli dokončení, pod nadpisem srovnání jen km a baterie na konci, rozpis ceny elektra na klepnutí.
Ponechané: krátká věta o počasí (nahrazená mlčením), věta o Waze, věty pod tabulkou srovnání. Hlídá to tests/less-text.test.mjs.

### R48 — Stát se staršími daty
Když se data státu při aktualizaci nepodaří stáhnout a appka používá data z dřívějšího běhu (D24, `osm_countries` v `meta.json` s `fresh: false`), ☰ → O appce u řádku Data napíše např. „DE: data z 9. 11.“. Souhrn to napíše jen tehdy, když trasa nebo zastávka vede tím státem (D25 = A). Hlídá to tests/stale-country.test.mjs.

## Rozpracované

Nic. Schválený požadavek, na kterém se pracuje, je tady i se svým rozhodnutím, dokud nemá testy; pak se přesune do „Požadavky“ a „Rozhodnutí“.

## Rozhodnutí

Volby, které padly mezi variantami. Mění se jen zadáním uživatele.

- **D1 (15. 11. 2026, uživatel vybral C):** „prázdné okno nabídne tlačítko na rozšíření okna a nejbližší stanice“. Tlačítko okno roztáhne tak, aby nejbližší stanice padla dovnitř, a plán přepočítá. Pod ním zůstanou nejbližší stanice před oknem a za ním (i daleko) s Vybrat. Varianty byly nakreslené: A jen nabídka, B jen kousek mimo okno, C nabídka + rozšíření. Požadavek R3.
- **D2 (15. 11. 2026):** oblíbená pumpa mimo okno se jen nabízí, nikdy se nevybere sama (R2, R5). Nahradilo dřívější „oblíbená vyhraje i kousek mimo okno“.
- **D3 (15. 11. 2026):** spotřeba pro plán se počítá z poklesu baterie, ne z palubního počítače, který ukazuje méně. (bez funkce v appce: spotřebu z poklesu baterie počítá noční sběrač do `calibration.json`, appka ji jen čte, R7.)
- **D4 (15. 11. 2026):** živé čtení baterie z auta v telefonu (varianta C) zatím ne. Data z auta jdou přes noční sběrač. (bez funkce v appce)

- **D5 (15. 11. 2026, uživatel vybral A):** rozšíří se jen to jedno prázdné okno, tvoje nastavení (např. 100 ± 20 km) zůstane. „Musí se tím pádem přepočítat i vše potom.“ Další okna navazují na novou zastávku. Platí pro každou změnu zastávky (R2). Starší test `[R3] … po Vybrat … „mimo okno, vybral jsi“` čekal, že ubude právě jedno prázdné okno. Podle D5 je upravený: kontroluje, že vybrané okno má tvou stanici (uživatel: „to rozhodnutí už bylo udělané dřív“).

- **D6 (15. 11. 2026, uživatel vybral B):** formulář ve třech krocích (R36) s podbarvenými bloky. Rozdělení polí do kroků je odvozené z nakreslené varianty (krok 2 i cesta zpět, krok 3 i objížďka a pumpy). Další krok se sám neotevírá. Sbalování kroků nahradilo D17.

- **D15 (16. 11. 2026, uživatel vybral A):** dlaždice s Kč nahoře ukazuje jen nabíjení na cestě („za proud na cestě“, to, co zaplatíš kartou na zastávkách). Celá cena i s elektřinou z domu je ve větě pod ní a rozepsaná ve srovnání (R37). Varianta B (celá cena v dlaždici) nevybrána.
- **D16 (16. 11. 2026, uživatel):** u pruhu baterie „přijedeš 30 % dej doleva před [čárku] a odjedeš 71 % doprava za čárku, jinak to vypadá dobře“. Slovo a číslo jsou pod sebou, aby se nápis vešel i na užším telefonu. Kvůli tomu se změnil test `[R32] pruh baterie: přijedeš X %, nabiješ +Y %, odjedeš Z %…`: dřív dovoloval nápis na kterékoli straně čárky a odjezd chtěl o řádek níž. Teď chce příjezd před čárkou a odjezd za ní na stejném řádku. Nový test hlídá případ, kdy se nápis nevejde.
- **D17 (16. 11. 2026, uživatel):** bloky 1, 2, 3 formuláře jsou pořád rozbalené („těch boxů není vidět, že by něco skrývaly, dokud se na ně neťukne… drž je rozbalené“). Rozhodl jsem k tomu sám: nadpisy bloků už nejsou tlačítka a zmizelo shrnutí u zavřeného bloku, protože žádný zavřený blok není. Celý formulář se po hledání dál sbalí do řádku s cestou (R1). Kvůli tomu se změnily testy v tests/form-steps.test.mjs: `[R36] na začátku je otevřený krok 1, klepnutí na jiný krok ho otevře a ostatní zavře` je nahrazený testem, že jsou všechny tři pořád rozbalené. `[R36] zavřené kroky ukazují shrnutí…` je smazaný. Pomocná kontrola „krok je otevřený“ už nečte `aria-expanded`, protože nadpis není tlačítko.
- **D18 (16. 11. 2026, uživatel):** jedno ze srovnávaných aut je vyřazené ze srovnání i se svými údaji („odstraň odevšad … a jeho údaje“). Rozhodl jsem k tomu sám: seznam aut uložený v telefonu před 16. 11. 2026 se nahradí výchozím (Talisman a benzínové auto), protože obsahoval i tohle auto. Ceny paliv a elektřiny zůstanou. Kdo si pak auta přejmenuje, tomu zůstanou. Ve zdrojích ani v testech jméno auta není. Kvůli tomu se změnily testy `[R14] dokončit cestu + srovnání…` a `[R14] Srovnání s palivem: změna ceny nafty…`: počítají s Talismanem (6,5 l) místo vyřazeného auta. U nového textu „o 9 minut dále“ jsem pro stanici před oknem zvolil „o 3 minuty dříve“ (čas) a „o 8 km blíže“ (km). Test `[R24][R3] prázdné okno…` teď čeká nové znění místo „před oknem / za oknem“.

- **D8 (16. 11. 2026, uživatel vybral C):** odkaz na WattBox u zastávky nebude. (bez funkce v appce)
- **D12 (16. 11. 2026, uživatel vybral A):** posuvník „Nabít do“ v kartě zastávky (R39). Rozhodl jsem k tomu sám: tvoje číslo platí přesně (bez minima 8 % a stropu 90 %), posuvník jde do 100 %.
- **D20 (16. 11. 2026, uživatel vybral A):** pondělní aktualizace dat selhala, protože hlavní server OpenStreetMap 19 minut vracel chyby 502/504. Teď se při výpadku zkusí záložní servery (R35). Nevybráno: B (navíc použít minulá data státu, který nejde stáhnout nikde, a ukázat v appce jejich datum) a C (jen zopakovat běh v úterý). Rozhodl jsem k tomu sám: záložní jsou overpass.private.coffee a overpass.kumi.systems (veřejné servery ze seznamu na wiki OSM). Zkouší se 4 kola po všech serverech, mezi koly pauza 30, 60 a 90 s, jeden dotaz čeká nejvýš 5 minut. Odpověď „runtime error“ (vypršel čas, chybí data) se bere jako výpadek, aby se neuložil stát bez stanic.
- **D14 (16. 11. 2026, uživatel vybral A):** graf baterie po trase v souhrnu (R40).
- **D19 (16. 11. 2026, uživatel vybral A, v relaci „Posuvník úrovně nabití do cíle“):** dva posuvníky, „Na zastávku přijet s alespoň“ a zvlášť „Do cíle dojet s“; když jedeš i zpátky, platí cíl i pro příjezd domů (R42). Mění R13, kde dřív platilo jedno číslo pro všechno. Rozhodl jsem k tomu sám: výchozí „Do cíle dojet s“ je 10 % jako rezerva (obrázek ukazoval 30 % jen pro ilustraci), u uloženého nastavení se převezme rezerva. „I pro příjezd domů“ chápu tak, že platí v cíli i doma.
- **D11 (16. 11. 2026, uživatel vybral A):** posuvníky a tlačítka ve formuláři (R41). Rozhodl jsem k tomu sám: předvolby intervalu 0:45, 1:00, 1:15, 1:30, 2:00 (po km 100, 130, 150, 200), tolerance 0, 10, 15, 20, 30 min (po km 10, 20, 30), objížďka všech pět dosavadních hodnot. Ostatní hodnoty přes „Jiný“.
- **D13 (16. 11. 2026, uživatel vybral B):** ikony jen v kartách, ne na mapě (R43). Rozhodl jsem k tomu sám: text u ikon zůstává, ikony ho jen doplní.
- **D7 (16. 11. 2026, uživatel vybral B):** jen varování před počasím, spotřeba zůstane (R45). Varianty A (spotřeba podle počasí a kopců) a C (nic) nevybrány. Rozhodl jsem k tomu sám (nezávislá kontrola to správně chtěla zapsat): místo „bez prvních a posledních 3 km trasy“ platí přísněji „žádný poslaný bod blíž než 3 km vzdušnou čarou od startu, cíle a míst přes“, měřeno u zaokrouhleného bodu, protože silnice se může k domovu vracet.
- **D10 (16. 11. 2026, uživatel vybral A):** poplatek za minuty nad volné minuty se započítá do ceny a napíše (R44). Data dodá datové vlákno do `prices.json`.
- **D9 (16. 11. 2026, uživatel vybral B):** zavřená pumpa se jen hlásí a nabídne otevřenou, appka sama nevybírá (R46). Data otevírací doby dodá datové vlákno.
- **D21 (16. 11. 2026, uživatel):** světlá varianta je schválená („ano, později uděláme pár změn“). Její barvy hlídá test jako u tmavé (R34). Změny, které uživatel chystá, přijdou jako nové zadání a test se upraví s nimi.
- **D22 (16. 11. 2026, uživatel vybral C):** „Do cíle dojet s“ zůstane bez předvoleb, jen posuvník a číslo (R41). Nevybráno: A (10 / 15 / 20 % jako zastávky), B (10 / 20 / 30 / 50 %).
- **D23 (16. 11. 2026, uživatel vybral z review textů):** odstranit nebo zkrátit F1–F7, S1, U1, U3, C1–C4, E2, X1, P1, P2; ponechat U2, E1, P3 (R47). Mění R24 (vysvětlení u zastávky na klepnutí) a R45 (počasí v pořádku = ticho). Kvůli tomu se změnily testy: `[R45] bez mlhy, sněhu a náledí souhrn řekne…` teď čeká, že souhrn mlčí, a `[R41] objížďka: pod tlačítky je vysvětlení…` teď čeká, že vysvětlivka není.
- **D24 (16. 11. 2026, uživatel vybral A):** stát, jehož data OSM nedodá žádný server, použije data z posledního úspěšného běhu a appka u něj ukáže, ze kterého dne jsou (R35). Důvod: ruční běh 16. 11. 2026 stáhl 9 z 10 souborů, u pump v Německu vracely všechny tři servery chyby a běh nestihl 60 minut. Nevybráno: B (menší dotazy pro DE a PL), C (A i B), D (nechat jak je). Rozhodl jsem k tomu sám: data se mezi běhy předávají jako artefakt GitHub Actions s výdrží 90 dní (ne jako soubor v repu, aby nerostlo, a ne jako cache, kterou GitHub maže po 7 dnech nepoužívání). Na stahování je dohromady 30 minut. Pak se soubor bez dat z minula zkusí u každého serveru už jen jednou, aby běh skončil v limitu a stažená data se uložila. Datum státu je to starší z nabíječek a pump. Po nezávislé kontrole: data z minula se skládají z posledních 5 artefaktů, nepovedené uložení artefaktu nezastaví uložení dat a nasazení proběhne jen tehdy, když je `app/` na main stejná jako v otestovaném commitu (jinak ji nasadí běh novějšího commitu). Po ručních bězích 16. 11. 2026: soubory bez dat z minula se stahují první, jinak na ně po souborech s náhradou nezbyl čas (AT a DE se tehdy nestáhly ani jednou). Zámek „pages“ drží jen nasazení. Pondělní běh je v 03:17 UTC místo 03:00. Kde to appka ukáže, je D25 v plánovacím vlákně.
- **D25 (16. 11. 2026, uživatel vybral A):** stát se staršími daty ukáže ☰ → O appce vždy a souhrn jen, když trasa nebo zastávka vede tím státem (R48). Nevybráno: B (jen v ☰), C (v souhrnu vždy).
- **D26 (16. 11. 2026, uživatel):** „nastartuj si počítač v noci, dělej to po kusech, neomezuj se na 30 minut“. Důvod: tři ruční běhy 16. 11. 2026 stáhly 8 z 10 souborů, ale dotaz na celé Německo hlavní server odmítal hned a záložní servery na něj 5 minut nic nevracely (R35). Německo se stahuje po 9 obdélnících mapy (3 × 3). Prvek na hranici obdélníků se počítá jen jednou. Soubory, které nejdou, se zkoušejí v dalších kolech, dokud nevyprší čas na stahování. Rozhodl jsem k tomu sám: čas na stahování jsou 4 hodiny a limit jobu 300 minut (GitHub dovolí nejvýš 360). V jednom kole má každý soubor 2 pokusy u každého serveru, mezi koly je pauza 2, 4, 6 až 10 minut. Server, jehož dotaz selhal až po minutě čekání, se na 15 minut přeskočí. Počítač v noci startovat nemusí, protože aktualizace běží na serverech GitHubu. Naplánované probuzení Macu by navíc potřebovalo heslo správce. Proto je na GitHubu noční běh každý den ve 22:47 UTC. Když poslední stahování prošlo a všechny státy jsou čerstvé, hned skončí bez testů a nasazení. Kvůli tomu se změnil test `[R35] stahování OSM: s daty z minula čeká jeden dotaz nejvýš do konce času na stahování`: dřív chtěl čas na stahování nejvýš 30 minut (kvůli limitu jobu 60 minut), teď chce, aby z limitu jobu zbylo aspoň 30 minut na zbytek běhu. Uživatel pak 16. 11. 2026: „vše stahovat bez limitu 30 min, nechápu, proč tam ten limit je“. Čas na stahování je proto 5,5 hodiny a limit jobu 360 minut, což je maximum GitHubu. Zbylých 30 minut je na data z minula, databázi a uložení, protože běh ukončený GitHubem by neuložil nic. Po nezávislé kontrole: noční krok hledá poslední stahování jen mezi naplánovanými a ručními běhy, protože push běhy appky ho dřív zakryly. Stahování začíná z aktuálního main, ne z commitu, kdy byl běh naplánovaný, aby se dva běhy s daty nestřetly při ukládání.

## Otevřené rozpory

Návrhy z WattBoxu a ABRP (D7–D14) jsou rozhodnuté výše, celé srovnání je v [docs/srovnani-abrp-wattbox.md](docs/srovnani-abrp-wattbox.md).
- **Nedoporučuju:** nejlevnější a nejkratší trasa (pravidlo jen nejrychlejší), CarPlay, widgety a upozornění do telefonu (webová appka bez serveru to neumí), Apple Mapy a Mapy.com (pravidlo Google Mapy), katalog aut, STK, doklady.

## Fronta (až bude vše hotové a popsané)

- ~~**WattBox:** podívat se, co WattBox nabízí, a říct, co by se plánovači hodilo (uživatel 15. 11. 2026).~~ Hotovo, návrhy D7–D10 v „Otevřené rozpory“.
