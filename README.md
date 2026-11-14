# Nabíjecí plánovač

Osobní mobilní webová appka: kde po cestě nabít elektroauto (CLA 350 4MATIC, 85 kWh, jen 800V DC).

**Appka:** https://jemny.github.io/nabijeci-planovac/ (na mobilu: Sdílet → Přidat na plochu)

## Co umí
- Odkud / přes / kam: hledání míst, „moje poloha“ nebo GPS souřadnice. Uložené místo Domů zůstává jen v telefonu.
- Okno zastávky (třeba 0:45–1:15 jízdy), nabíjení jen po cestě, jen na pumpách, oblíbené značky pump.
- U každé zastávky: s kolika % přijedeš, na kolik nabít (do cíle i zpět s rezervou 10 %), jak dlouho a za kolik podle sítě, výkonového pásma a denní doby, jaký stojan vybrat a odkaz na navigaci v Google Mapách.

## Data
| Zdroj | Co dává |
|---|---|
| OpenStreetMap (Overpass) | nabíječky a pumpy, ODbL |
| Open Charge Map export | doplňkové stanice, CC BY 4.0 |
| Mapa E.ON Drive (veřejné API mapy) | stanice E.ON i roamingových partnerů s výkonem konektorů |
| supercharge.info | Tesla Superchargery |
| `build/doplnky.csv` | ručně ověřené stanice |

Trasu počítá veřejný server [OSRM](https://project-osrm.org/), místa hledá [Photon](https://photon.komoot.io/). Časy se upravují na tempo podle Google Map (×0,93). Ceny jsou orientační podle mých karet, platí cena v aplikaci u stojanu.

## Aktualizace
GitHub Actions (`.github/workflows/update-data.yml`) stáhne data každé pondělí ve 3:00 UTC a znovu nasadí stránku. Ručně: Actions → „Aktualizace dat nabíječek“ → Run workflow (jde i z mobilní appky GitHub).

## Lokálně
```bash
python3 build/build_db.py            # stáhne data (poprvé ~15 min kvůli detailům stanic E.ON)
python3 build/export_app.py          # app/data/*.json
python3 build/query.py --near 49.28,17.02 --radius 15 --min-kw 100 --pumpa
python3 -m http.server 8765 --directory app
```
