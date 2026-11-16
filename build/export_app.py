#!/usr/bin/env python3
"""Export the station database into compact JSON files for the web app (app/data/).

  stations.json     DC charging sites only (what matters for a stop), column layout to keep it small
  prices.json       the user's card prices per network and power tier (day / night)
  calibration.json  charging-curve model: reference curve + k per SoC band (no personal session data)
  meta.json         when and from what the data was built

Usage: python3 build/export_app.py [--calibration PATH]
"""
import argparse
import datetime as dt
import json
import os
import re
import sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))
APP_DATA = os.path.join(os.path.dirname(HERE), "app", "data")
DEFAULT_CAL = os.path.join(os.path.dirname(os.path.dirname(HERE)), ".claude", "skills", "ev-trip-cost",
                           "data", "calibration.json")

# canonical pump brands (OSM brand/name strings vary a lot)
FUEL_BRANDS = [
    ("MOL", r"\bmol\b"), ("ORLEN", r"orlen|benzina|unipetrol"), ("Shell", r"\bshell\b"), ("OMV", r"\bomv\b"),
    ("EuroOil", r"euro\s*oil|čepro|cepro"), ("Tank ONO", r"tank\s*ono"), ("Robin Oil", r"robin\s*oil"),
    ("Globus", r"globus"), ("Makro", r"makro"), ("Kaufland", r"kaufland"), ("Tesco", r"tesco"),
    ("Prim", r"\bprim\b"), ("Avia", r"\bavia\b"), ("Agip / Eni", r"agip|\beni\b"), ("Lukoil", r"lukoil"),
    ("Slovnaft", r"slovnaft"), ("Hruška", r"hruška|hruska"), ("Benzina Plus", r"benzina plus"),
]

def _t(*bands):
    """bands: (max_kw, day, night, label) -> list of dicts"""
    return [{"max": m, "day": d, "night": n, "label": lab} for m, d, n, lab in bands]


DC_UFC = lambda dc, ufc, lab_dc="DC do 149 kW", lab_ufc="UFC od 150 kW": _t(  # noqa: E731
    (149, dc, dc, lab_dc), (9999, ufc, ufc, lab_ufc))
FLAT = lambda p, lab="jedna cena": _t((9999, p, p, lab))  # noqa: E731


def _fee(tiers, *fees):
    """Time fee per tier, same order as tiers: (free_min, czk_min) or (free_min, czk_min, czk_min_night), None = no fee.
    free_min = minutes free from the start of charging, czk_min = Kč for each further minute (R35 for R44, D10).
    Only from verified price lists; where unknown the fields are left out."""
    out = [dict(t) for t in tiers]
    for t, f in zip(out, fees):
        if f:
            t["free_min"], t["czk_min"] = f[0], f[1]
            if len(f) > 2:
                t["czk_min_night"] = f[2]
    return out


# time fees: E.ON Drive ceník od 18. 6. 2026 (eon-drive.cz): 120 / 60 / 30 free minutes, then 2 Kč/min; up to 100 kW free at night
EON_FEES = ((120, 2, 0), (60, 2), (30, 2))
EON_REG = _fee(_t((100, 9.5, 8.0, "pásmo do 100 kW"), (200, 13.0, 10.0, "pásmo 101–200 kW"), (400, 16.9, 12.0, "pásmo 201–400 kW")), *EON_FEES)
EON_ADHOC = _fee(_t((100, 10.5, 8.5, "pásmo do 100 kW"), (200, 14.5, 11.0, "pásmo 101–200 kW"), (400, 20.0, 14.0, "pásmo 201–400 kW")), *EON_FEES)
# ČEZ ceník od 1. 11. 2026 (all tariffs): DC do 149 kW from the 91st minute, UFC from the 46th, 2 Kč/min
CEZ_FEES = ((90, 2), (45, 2))
# PRE POINT ceník od 1. 12. 2025 (DC do 149 kW / UFC nad 149 kW)
PRE_START_FEES, PRE_SILVER_FEES, PRE_PLATINUM_FEES = ((60, 2), (30, 2)), ((60, 1), (30, 2)), ((90, 1), (60, 2))
# PRE customers on other operators' stations in CZ (PRE ceník platný od 1. 7. 2026, with its time fees)
# PRE customers abroad (same price list): Slovakia ZSE, GreenWay (SK/PL), Shell abroad
PRE_ABROAD = {"ZSE Drive": DC_UFC(15, 15), "GreenWay": _fee(FLAT(25), (60, 3)), "Shell": _fee(FLAT(23), (45, 2))}
PRE_ROAM = {"E.ON": _fee(DC_UFC(18, 21), (60, 3), (45, 4)), "ČEZ": _fee(DC_UFC(19, 26), (60, 2), (60, 2)),
            "IONITY": _fee(FLAT(25), (60, 3)), "Teplárny Brno": _fee(DC_UFC(17, 18), (60, 1), (60, 1)),
            "Lidl": _fee(FLAT(13.2, "DC"), (60, 1)), "Shell": _fee(FLAT(17), (45, 2)), "ORLEN": FLAT(13),
            "Chargee": _fee(DC_UFC(25, 27), (90, 2), (60, 2))}

# Charging cards / tariffs available in CZ (WattBox srovnání, aktualizováno 11. 11. 2026; E.ON ceník od 1. 4. 2026;
# PRE roaming ceník od 1. 7. 2026; Shell shell.cz). "own" = networks where the price applies,
# "anywhere" = roams on (almost) every station: price known (tiers) or unknown (None).
CARDS = [
    {"id": "cez-basic", "group": "ČEZ", "name": "ČEZ Basic", "fee": 0, "own": {"ČEZ": _fee(DC_UFC(12.9, 15.9), *CEZ_FEES)}},
    {"id": "cez-standard", "group": "ČEZ", "name": "ČEZ Standard", "fee": 100, "own": {"ČEZ": _fee(DC_UFC(12.4, 12.4), *CEZ_FEES)}},
    {"id": "cez-premium", "group": "ČEZ", "name": "ČEZ Premium", "fee": 300, "own": {"ČEZ": _fee(DC_UFC(11.4, 11.4), *CEZ_FEES)}},
    {"id": "cez-adhoc", "group": "ČEZ", "name": "ČEZ bez registrace", "fee": 0, "own": {"ČEZ": DC_UFC(16.9, 22.9)}},
    {"id": "eon", "group": "E.ON", "name": "E.ON Drive (registrace)", "fee": 0, "own": {"E.ON": EON_REG}},
    {"id": "eon-adhoc", "group": "E.ON", "name": "E.ON bez registrace (QR/terminál)", "fee": 0, "own": {"E.ON": EON_ADHOC}},
    {"id": "pre-start", "group": "PRE", "name": "PRE Start", "fee": 0, "own": {"PRE": _fee(DC_UFC(12, 14), *PRE_START_FEES)}, "roam": PRE_ROAM, "abroad": PRE_ABROAD},
    {"id": "pre-silver", "group": "PRE", "name": "PRE Silver", "fee": 150, "note": "0 Kč pro zákazníky PRE",
     "own": {"PRE": _fee(DC_UFC(11, 13), *PRE_SILVER_FEES)}, "roam": PRE_ROAM, "abroad": PRE_ABROAD},
    {"id": "pre-gold", "group": "PRE", "name": "PRE Gold (jen zákazníci PRE)", "fee": 150, "own": {"PRE": _fee(DC_UFC(10, 12), *PRE_SILVER_FEES)}, "roam": PRE_ROAM, "abroad": PRE_ABROAD},
    {"id": "pre-platinum", "group": "PRE", "name": "PRE Platinum", "fee": 300, "own": {"PRE": _fee(DC_UFC(10, 11), *PRE_PLATINUM_FEES)}, "roam": PRE_ROAM, "abroad": PRE_ABROAD},
    {"id": "pre-adhoc", "group": "PRE", "name": "PRE bez registrace", "fee": 0, "own": {"PRE": DC_UFC(13, 15)}},
    {"id": "mol", "group": "MOL", "name": "MOL Plugee (registrace)", "fee": 0, "own": {"MOL": DC_UFC(13, 14)}},
    {"id": "mol-adhoc", "group": "MOL", "name": "MOL bez registrace", "fee": 0, "own": {"MOL": DC_UFC(14.5, 15.5)}},
    {"id": "orlen", "group": "ORLEN", "name": "ORLEN Charge", "fee": 0, "own": {"ORLEN": FLAT(11)}},
    {"id": "shell-adhoc", "group": "Shell", "name": "Shell – platební karta u stojanu", "fee": 0, "own": {"Shell": FLAT(15, "ad hoc")}},
    {"id": "ionity-direct", "group": "IONITY", "name": "IONITY Direct (bez registrace)", "fee": 0, "own": {"IONITY": FLAT(21)}},
    {"id": "ionity-go", "group": "IONITY", "name": "IONITY Go", "fee": 0, "own": {"IONITY": FLAT(19.95)}},
    {"id": "ionity-motion", "group": "IONITY", "name": "IONITY Motion", "fee": 142, "own": {"IONITY": FLAT(15)}},
    {"id": "ionity-power", "group": "IONITY", "name": "IONITY Power", "fee": 305, "own": {"IONITY": FLAT(12)}},
    {"id": "tesla-non", "group": "Tesla", "name": "Tesla nečlen", "fee": 0,
     "own": {"Tesla": _t((9999, 21.1, 13.8, "špička 18,60–23,60 / mimo 8,80–18,80, podle stanice"))}},
    {"id": "tesla-member", "group": "Tesla", "name": "Tesla člen", "fee": 290,
     "own": {"Tesla": _t((9999, 14.0, 9.9, "špička 13,10–14,90 / mimo 6,30–13,40, podle stanice"))}},
    {"id": "chargee", "group": "Chargee", "name": "Chargee (registrace)", "fee": 0,
     "own": {"Chargee": DC_UFC(9, 14), "Teplárny Brno": DC_UFC(9, 14)}},
    {"id": "lidl-plus", "group": "Lidl", "name": "Lidl Plus", "fee": 0, "own": {"Lidl": FLAT(10, "DC")}},
    {"id": "lidl-noapp", "group": "Lidl", "name": "Lidl bez aplikace", "fee": 0, "own": {"Lidl": FLAT(11.9, "DC")}},
    {"id": "elli-premium", "group": "Škoda Powerpass / Elli", "name": "Powerpass Charge Premium", "fee": 429,
     "own": {"IONITY": FLAT(12.5)}, "anywhere": FLAT(16, "DC kdekoli")},
    {"id": "elli-basic", "group": "Škoda Powerpass / Elli", "name": "Powerpass Charge Basic", "fee": 0, "anywhere": None},
    {"id": "mbcharge", "group": "Mercedes", "name": "MB.CHARGE Public", "fee": 0, "anywhere": None,
     "note": "roaming téměř všude, cenu ukáže aplikace Mercedes"},
]
# what the user has today (memory user-charging-cards) – the app's default selection
DEFAULT_CARDS = ["cez-basic", "eon", "chargee", "lidl-noapp", "mbcharge", "orlen", "pre-start", "mol", "tesla-non",
                 "ionity-go", "shell-adhoc"]

PRICES = {  # legacy single-card table (CLI / query.py); the app uses CARDS
    "night_hours": [20, 8],
    "networks": {
        "E.ON": {"card": "E.ON Drive", "tiers": EON_REG},
        "ČEZ": {"card": "ČEZ Basic", "tiers": _fee([
            {"max": 149, "day": 12.9, "night": 12.9, "label": "DC 50–149 kW"},
            {"max": 9999, "day": 15.9, "night": 15.9, "label": "UFC od 150 kW"}], *CEZ_FEES)},
        "PRE": {"card": "PRE Start", "tiers": _fee([
            {"max": 149, "day": 12.0, "night": 12.0, "label": "DC (hranice pásma neověřena)"},
            {"max": 9999, "day": 14.0, "night": 14.0, "label": "UFC (hranice pásma neověřena)"}], *PRE_START_FEES)},
        "MOL": {"card": "MOL", "tiers": [
            {"max": 149, "day": 13.0, "night": 13.0, "label": "DC (hranice pásma neověřena)"},
            {"max": 9999, "day": 14.0, "night": 14.0, "label": "UFC (hranice pásma neověřena)"}]},
        "Chargee": {"card": "Chargee", "tiers": [
            {"max": 149, "day": 9.0, "night": 9.0, "label": "DC (hranice pásma neověřena)"},
            {"max": 9999, "day": 14.0, "night": 14.0, "label": "UFC (hranice pásma neověřena)"}]},
        "ORLEN": {"card": "ORLEN", "tiers": [{"max": 9999, "day": 11.0, "night": 11.0, "label": "jedna cena"}]},
        "Shell": {"card": "platební karta u stojanu", "tiers": [
            {"max": 9999, "day": 15.0, "night": 15.0, "label": "ad hoc, bez karty"}]},
        "IONITY": {"card": "IONITY Go", "tiers": [{"max": 9999, "day": 19.95, "night": 19.95, "label": "jedna cena"}]},
        "Tesla": {"card": "Tesla nečlen", "tiers": [
            {"max": 9999, "day": 20.3, "night": 10.3, "label": "špička / mimo špičku (orientačně)"}]},
        "Lidl": {"card": "Lidl", "tiers": [{"max": 9999, "day": 11.9, "night": 11.9, "label": "DC"}]},
    },
    "source": "ceníky ověřené 2026-11-14 (E.ON od 1. 4. 2026, ČEZ dle Autohledu, ostatní WattBox, Shell shell.cz); "
              "poplatky za minuty: E.ON ceník od 18. 6. 2026, ČEZ ceník od 1. 11. 2026, PRE POINT ceník od 1. 12. 2025 a PRE roaming od 1. 7. 2026 (ověřeno 2026-11-16)",
}

REF_CURVE = [[0, 200], [5, 300], [10, 330], [11, 336], [15, 322], [20, 316], [25, 310], [30, 278], [35, 245],
             [40, 222], [45, 202], [50, 192], [55, 181], [60, 151], [65, 134], [70, 126], [75, 118], [80, 105],
             [85, 90], [90, 68], [95, 45], [100, 15]]


def fuel_brand(raw):
    if not raw:
        return None
    low = raw.lower()
    for name, rx in FUEL_BRANDS:
        if re.search(rx, low):
            return name
    return raw.strip()[:30]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--calibration", default=DEFAULT_CAL)
    ap.add_argument("--db", default=os.path.join(HERE, "nabijecky.sqlite"))
    a = ap.parse_args()
    os.makedirs(APP_DATA, exist_ok=True)

    con = sqlite3.connect(a.db)
    con.row_factory = sqlite3.Row
    meta = dict(con.execute("SELECT key, value FROM meta").fetchall())
    cols = ["lat", "lon", "op", "name", "kw", "ccs", "fuel", "fd", "use", "place", "src", "cc", "oh", "svc"]
    rows = []
    for r in con.execute("SELECT * FROM stations WHERE has_dc = '1' OR has_dc = 1"):
        if (r["cc"] or "CZ") not in ("CZ", "SK") and not (r["dc_kw"] and r["dc_kw"] >= 100):
            continue  # abroad (PL/AT/DE): only fast DC with known power, keeps stations.json small
        place = ", ".join(x for x in (r["address"], r["city"]) if x) or None
        rows.append([round(r["lat"], 5), round(r["lon"], 5), r["operator"], r["name"],
                     round(r["dc_kw"]) if r["dc_kw"] else None, int(r["ccs_count"] or 0) or None,
                     fuel_brand(r["fuel_brand"]), int(r["fuel_dist_m"]) if r["fuel_dist_m"] is not None else None,
                     r["usable_cla"], place, r["source"], r["cc"] or "CZ",
                     (r["fuel_oh"] if "fuel_oh" in r.keys() else None) if r["fuel_brand"] else None,
                     (r["fuel_svc"] if "fuel_svc" in r.keys() else None) if r["fuel_brand"] else None])
    with open(os.path.join(APP_DATA, "stations.json"), "w", encoding="utf-8") as f:
        json.dump({"cols": cols, "rows": rows}, f, ensure_ascii=False, separators=(",", ":"))

    with open(os.path.join(APP_DATA, "prices.json"), "w", encoding="utf-8") as f:
        json.dump(PRICES, f, ensure_ascii=False, indent=1)
    with open(os.path.join(APP_DATA, "cards.json"), "w", encoding="utf-8") as f:
        json.dump({"night_hours": [20, 8], "default": DEFAULT_CARDS, "cards": CARDS,
                   "source": "WattBox srovnání karet (11. 11. 2026), E.ON ceník od 1. 4. 2026, PRE roaming od 1. 7. 2026, shell.cz; "
                             "poplatky za minuty: E.ON ceník od 18. 6. 2026, ČEZ ceník od 1. 11. 2026, PRE POINT ceník od 1. 12. 2025 a PRE roaming od 1. 7. 2026 (ověřeno 16. 11. 2026)"},
                  f, ensure_ascii=False, indent=1)

    cal = {"k_median": 0.72, "bands": [], "updated": None}
    try:
        with open(a.calibration, encoding="utf-8") as f:
            c = json.load(f)
        cal = {"k_median": c["k_median"], "updated": c.get("updated"), "n": c.get("n"),
               "bands": [{"from": b["from"], "to": b["to"], "k": b["k"], "measured": b.get("measured", False)}
                         for b in c.get("bands", [])]}
    except (OSError, ValueError, KeyError):
        app_cal = os.path.join(APP_DATA, "calibration.json")
        if os.path.exists(app_cal):  # in CI the skill folder is absent: keep the committed copy
            cal = json.load(open(app_cal, encoding="utf-8"))
    # keep what the nightly Home Assistant collector (ev-trip-cost/scripts/ha_collect.py) adds
    try:
        with open(os.path.join(APP_DATA, "calibration.json"), encoding="utf-8") as f:
            prev_app = json.load(f)
        for k in ("cons_recent", "car_limit"):
            if k in prev_app and k not in cal:
                cal[k] = prev_app[k]
    except (OSError, ValueError):
        pass
    cal.update({"ref_curve": REF_CURVE, "kwh_per_pct": 0.98, "battery_kwh": 85,
                "source": "fdrive.cz test CLA 250+ 85 kWh × k z vlastních nabíjení"})
    with open(os.path.join(APP_DATA, "calibration.json"), "w", encoding="utf-8") as f:
        json.dump(cal, f, ensure_ascii=False, indent=1)

    importers = {}
    if meta.get("importers"):
        try:
            importers = json.loads(meta["importers"])
        except ValueError:
            pass
    try:  # per country: date of the OSM data and whether it was downloaded now or reused from the last run (D24)
        osm_cc = json.loads(meta.get("osm_countries") or "{}")
    except ValueError:
        osm_cc = {}
    out_meta = {"exported": dt.datetime.now().isoformat(timespec="minutes"), "osm_base": meta.get("osm_base"),
                "osm_countries": osm_cc,
                "ocm_export_date": meta.get("ocm_export_date"), "dc_stations": len(rows),
                "fast_150": sum(1 for r in rows if r[4] and r[4] >= 150), "importers": importers,
                "license": meta.get("license")}
    with open(os.path.join(APP_DATA, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(out_meta, f, ensure_ascii=False, indent=1)
    size = os.path.getsize(os.path.join(APP_DATA, "stations.json"))
    print(json.dumps({**out_meta, "stations_json_kb": round(size / 1024)}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
