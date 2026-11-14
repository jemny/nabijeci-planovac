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

PRICES = {  # Kč/kWh incl. VAT with the user's own cards; night = 20–8 where it differs (memory user-charging-cards)
    "night_hours": [20, 8],
    "networks": {
        "E.ON": {"card": "E.ON Drive", "tiers": [
            {"max": 100, "day": 9.5, "night": 8.0, "label": "pásmo do 100 kW"},
            {"max": 200, "day": 13.0, "night": 10.0, "label": "pásmo 101–200 kW"},
            {"max": 400, "day": 16.9, "night": 12.0, "label": "pásmo 201–400 kW"}]},
        "ČEZ": {"card": "ČEZ Basic", "tiers": [
            {"max": 149, "day": 12.9, "night": 12.9, "label": "DC 50–149 kW"},
            {"max": 9999, "day": 15.9, "night": 15.9, "label": "UFC od 150 kW"}]},
        "PRE": {"card": "PRE Start", "tiers": [
            {"max": 149, "day": 12.0, "night": 12.0, "label": "DC (hranice pásma neověřena)"},
            {"max": 9999, "day": 14.0, "night": 14.0, "label": "UFC (hranice pásma neověřena)"}]},
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
    "source": "ceníky ověřené 2026-11-14 (E.ON od 1. 4. 2026, ČEZ dle Autohledu, ostatní WattBox, Shell shell.cz)",
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
    cols = ["lat", "lon", "op", "name", "kw", "ccs", "fuel", "fd", "use", "place", "src"]
    rows = []
    for r in con.execute("SELECT * FROM stations WHERE has_dc = '1' OR has_dc = 1"):
        place = ", ".join(x for x in (r["address"], r["city"]) if x) or None
        rows.append([round(r["lat"], 5), round(r["lon"], 5), r["operator"], r["name"],
                     round(r["dc_kw"]) if r["dc_kw"] else None, int(r["ccs_count"] or 0) or None,
                     fuel_brand(r["fuel_brand"]), int(r["fuel_dist_m"]) if r["fuel_dist_m"] is not None else None,
                     r["usable_cla"], place, r["source"]])
    with open(os.path.join(APP_DATA, "stations.json"), "w", encoding="utf-8") as f:
        json.dump({"cols": cols, "rows": rows}, f, ensure_ascii=False, separators=(",", ":"))

    with open(os.path.join(APP_DATA, "prices.json"), "w", encoding="utf-8") as f:
        json.dump(PRICES, f, ensure_ascii=False, indent=1)

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
    out_meta = {"exported": dt.datetime.now().isoformat(timespec="minutes"), "osm_base": meta.get("osm_base"),
                "ocm_export_date": meta.get("ocm_export_date"), "dc_stations": len(rows),
                "fast_150": sum(1 for r in rows if r[4] and r[4] >= 150), "importers": importers,
                "license": meta.get("license")}
    with open(os.path.join(APP_DATA, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(out_meta, f, ensure_ascii=False, indent=1)
    size = os.path.getsize(os.path.join(APP_DATA, "stations.json"))
    print(json.dumps({**out_meta, "stations_json_kb": round(size / 1024)}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
