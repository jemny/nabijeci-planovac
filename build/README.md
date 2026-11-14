# Databáze nabíječek v ČR (builder)

Lokální databáze veřejných nabíjecích stanic pro plánování zastávek CLA 350 4MATIC.

| Soubor | Co to je |
|---|---|
| `nabijecky.sqlite` | tabulka `stations` (1 řádek = 1 místo) a `meta` (stáří dat, zdroje) |
| `nabijecky.csv` | totéž pro Excel/Numbers |
| `nabijecky.geojson` | pro mapové prohlížeče (geojson.io, QGIS) |
| `doplnky.csv` | ručně ověřené stanice: opraví výkon nebo doplní chybějící místo |
| `build_db.py` | stáhne data a databázi postaví znovu |
| `query.py` | hledání kolem bodu nebo podél trasy |

## Zdroje
- **OpenStreetMap** přes Overpass API: nabíječky a pumpy, aktuální k datu stažení. Licence ODbL.
- **Open Charge Map** export z GitHubu (`openchargemap/ocm-export`, jen `data/CZ`). Aktualizuje se zhruba jednou za měsíc, poslední export je z 22. 4. 2026. Licence CC BY 4.0.
- **MPO** oficiální seznam ke stažení nenašel. **WattBox** nemá veřejné API, na ceny a kontrolu ho proto dál používej ručně.

## Co je u každé stanice
Provozovatel (sjednocený název), max. výkon DC a AC, počet CCS, nejbližší pumpa do 200 m (značka a vzdálenost), jestli na ní Bělouš rychle nabije (`usable_cla`) a cena s tvými kartami ve dne a v noci (pásma z paměti `user-charging-cards`).

`usable_cla`: `ano` = DC od 150 kW · `nejspíš (ověř 800 V)` = 100–149 kW · `nejisté` = do 100 kW nebo Tesla V3 (jen 500 V) · `neznámý výkon DC` · `jen AC`.

## Slabiny
- Otevřená data **nemají výkon u ~400 DC stanic** a **chybí v nich část nových hubů**. Třeba E.ON Mořice 400 kW a Shell Ivanovice tam nebyly, doplnil je až `doplnky.csv`.
- Ceny jsou orientační podle tvých karet. Platí cena v aplikaci u stojanu.
- Trasa v `query.py` jsou rovné úsečky mezi zadanými body. Zadávej body zhruba po 30–50 km podél dálnice.

## Použití
```bash
python3 build/build_db.py --refresh      # nová data (OSM + OCM), asi minuta
python3 build/query.py --near 49.28,17.02 --radius 15 --min-kw 100 --pumpa
python3 build/query.py --route "49.84,18.16;49.47,17.97;49.36,17.45;49.29,17.10;49.20,16.62" --corridor 4 --min-kw 100 --pumpa
```
Ověřené místo (z Google Map, fotky nebo skutečného nabíjení) přidej řádkem do `doplnky.csv` a spusť `build_db.py` znovu.
