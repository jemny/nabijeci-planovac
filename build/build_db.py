#!/usr/bin/env python3
"""Build a local database of public EV charging stations in Czechia.

Sources (free, no account):
  * OpenStreetMap via Overpass API: amenity=charging_station (+ amenity=fuel for "is it at a pump")
  * Open Charge Map export (github.com/openchargemap/ocm-export, data/CZ, refreshed ~monthly)

Output (next to this script):
  nabijecky.sqlite   table `stations` (one row per site) + table `meta`
  nabijecky.csv      same rows for Excel / Numbers
  nabijecky.geojson  for map viewers

Each station gets: operator (normalised), max DC / AC power, CCS count, nearest fuel station
(brand + distance), whether the CLA 350 4MATIC (800 V only, no 400 V booster) can fast-charge
there, and the price with the user's own cards (tiers from memory/user-charging-cards).

Usage:  python3 nabijecky/build_db.py [--refresh] [--ocm PATH_TO_ocm-export]
  --refresh   re-download OSM data even if raw/ has today's copy
"""
import argparse
import sys
import time
import csv
import datetime as dt
import glob
import json
import math
import os
import re
import sqlite3
import subprocess
import urllib.parse
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
RAW = os.path.join(HERE, "raw")
OVERPASS = "https://overpass-api.de/api/interpreter"
UA = "elektroauta-chargers-db/0.1 (personal, non-commercial)"
COUNTRIES = ["CZ", "SK", "PL", "AT", "DE"]  # neighbours for trips abroad (OSM + OCM; E.ON map only CZ/SK)


def q_amenity(cc, amenity):
    return (f'[out:json][timeout:240];area["ISO3166-1"="{cc}"][admin_level=2]->.a;'
            f'(nwr["amenity"="{amenity}"](area.a););out center tags;')

# ---------------------------------------------------------------- helpers
def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


class Grid:
    """Tiny spatial index (≈1 km cells) for nearest-neighbour lookups."""
    def __init__(self, items, cell=0.01):
        self.cell, self.g = cell, {}
        for it in items:
            self.g.setdefault(self.key(it["lat"], it["lon"]), []).append(it)

    def key(self, lat, lon):
        return (int(lat / self.cell), int(lon / self.cell))

    def near(self, lat, lon, max_m):
        kx, ky = self.key(lat, lon)
        best = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for it in self.g.get((kx + dx, ky + dy), []):
                    d = haversine_m(lat, lon, it["lat"], it["lon"])
                    if d <= max_m:
                        best.append((d, it))
        best.sort(key=lambda x: x[0])
        return best


def overpass(query, path, refresh):
    if os.path.exists(path) and not refresh:
        age = dt.date.today() - dt.date.fromtimestamp(os.path.getmtime(path))
        if age.days < 1:
            try:
                return json.load(open(path, encoding="utf-8"))
            except ValueError:
                pass  # a cached error page: download again
    data = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(6):  # Overpass answers an HTML error page when busy: wait and retry, never cache it
        req = urllib.request.Request(OVERPASS, data=data, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                body = r.read()
        except urllib.error.HTTPError as e:
            body = b""
            print(f"overpass HTTP {e.code}")
        except urllib.error.URLError:  # old local Python/LibreSSL can fail the TLS handshake: fall back to curl
            body = subprocess.run(["curl", "-s", "-m", "600", "-A", UA, "--data-urlencode", f"data={query}", OVERPASS],
                                  capture_output=True).stdout
        try:
            parsed = json.loads(body)
        except ValueError:
            wait = 30 * (attempt + 1)
            print(f"overpass busy for {os.path.basename(path)}, retry in {wait}s")
            time.sleep(wait)
            continue
        with open(path, "wb") as f:
            f.write(body)
        time.sleep(3)
        return parsed
    raise RuntimeError(f"Overpass failed for {path}")


def ensure_ocm(path):
    """Sparse-clone only data/<country> of the OCM export (small JSON files per POI)."""
    dirs = [f"data/{cc}" for cc in COUNTRIES]
    if os.path.isdir(os.path.join(path, ".git")):
        subprocess.run(["git", "-C", path, "sparse-checkout", "set", *dirs], check=False)
        subprocess.run(["git", "-C", path, "pull", "-q", "--depth", "1"], check=False)
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subprocess.run(["git", "clone", "-q", "--depth", "1", "--filter=blob:none", "--no-checkout",
                    "https://github.com/openchargemap/ocm-export.git", path], check=True)
    subprocess.run(["git", "-C", path, "sparse-checkout", "init", "--cone"], check=True)
    subprocess.run(["git", "-C", path, "sparse-checkout", "set", *dirs], check=True)
    subprocess.run(["git", "-C", path, "checkout", "-q"], check=True)
    return path


NUM = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kw|w)?", re.I)


def parse_kw(value):
    """'150 kW;50 kW' -> 150.0, '22000 W' -> 22.0, 'yes' -> None"""
    if not value:
        return None
    best = None
    for n, unit in NUM.findall(str(value)):
        v = float(n.replace(",", "."))
        if (unit or "").lower() == "w" or v > 1000:
            v = v / 1000
        if 0 < v <= 1000:
            best = v if best is None else max(best, v)
    return best


def count(value):
    if value is None:
        return 0
    m = re.match(r"\s*(\d+)", str(value))
    return int(m.group(1)) if m else 1  # 'yes' -> at least 1


# ---------------------------------------------------------------- operators & prices
OPERATORS = [  # (canonical, regex on operator/network/brand/name, lower-case)
    ("PRE", r"pražsk[áa] energetika|\bpre\b|pre point"),
    ("ČEZ", r"\bčez\b|\bcez\b|futurego"),
    ("E.ON", r"e\.on|\beon\b|innogy"),
    ("Tesla", r"tesla"),
    ("IONITY", r"ionity"),
    ("ORLEN", r"orlen|unipetrol|benzina"),
    ("MOL", r"\bmol\b|mol česká"),
    ("Shell", r"\bshell\b"),
    ("OMV", r"\bomv\b"),
    ("Lidl", r"\blidl\b"),
    ("Kaufland", r"kaufland"),
    ("Chargee", r"chargee"),
    ("Teplárny Brno", r"teplárny brno|teplarny brno"),
    ("EVMAPA", r"evmapa"),
    ("Powerbox", r"powerbox"),
    ("Polyfazer", r"polyfazer"),
    ("Olife Energy", r"olife"),
    ("ChargeUp", r"chargeup"),
    ("Ledeos", r"ledeos"),
    ("ZSE Drive", r"\bzse\b|západoslovensk|zapadoslovensk"),
    ("GreenWay", r"greenway|green way"),
    ("Slovnaft", r"slovnaft"),
]


def canon_operator(*texts):
    blob = " | ".join(t for t in texts if t).lower()
    for name, rx in OPERATORS:
        if re.search(rx, blob):
            return name
    for t in texts:
        if t and not t.startswith("("):
            return t.strip()
    return None


def card_price(op, dc_kw, has_dc):
    """Best price with the user's own cards (Kč/kWh incl. VAT) -> (day, night, card, note).
    Source: memory user-charging-cards + charger-tier-rule (checked 2026-11-14)."""
    kw = dc_kw if has_dc else None
    if op == "E.ON":  # tier by station power, day 8-20 / night 20-8, registered
        if kw is None or kw <= 100:
            return 9.5, 8.0, "E.ON Drive", "pásmo do 100 kW" if kw else "pásmo podle výkonu stanice (neznámý)"
        if kw <= 200:
            return 13.0, 10.0, "E.ON Drive", "pásmo 101–200 kW"
        return 16.9, 12.0, "E.ON Drive", "pásmo 201–400 kW"
    if op == "ČEZ":
        if not has_dc:
            return 9.9, 9.9, "ČEZ Basic", "AC"
        if kw is not None and kw >= 150:
            return 15.9, 15.9, "ČEZ Basic", "UFC od 150 kW"
        return 12.9, 12.9, "ČEZ Basic", "DC 50–149 kW" if kw else "DC/UFC podle výkonu (neznámý)"
    if op == "PRE":
        if not has_dc:
            return 9.0, 9.0, "PRE Start", "AC"
        if kw is not None and kw >= 150:
            return 14.0, 14.0, "PRE Start", "UFC (hranice pásma neověřena)"
        return 12.0, 12.0, "PRE Start", "DC (hranice pásma neověřena)"
    if op == "MOL":
        if not has_dc:
            return 8.3, 8.3, "MOL", "AC"
        if kw is not None and kw >= 150:
            return 14.0, 14.0, "MOL", "UFC (hranice pásma neověřena)"
        return 13.0, 13.0, "MOL", "DC (hranice pásma neověřena)"
    if op == "ORLEN":
        return 11.0, 11.0, "ORLEN", "jedna cena DC/UFC"
    if op == "Shell":
        return 15.0, 15.0, "platební karta u stojanu", "Shell ad hoc, bez karty"
    if op == "IONITY":
        return 19.95, 19.95, "IONITY Go", "jedna cena"
    if op == "Tesla":
        return 20.3, 10.3, "Tesla nečlen", "špička / mimo špičku"
    if op == "Chargee":
        if not has_dc:
            return 8.0, 8.0, "Chargee", "AC"
        if kw is not None and kw >= 150:
            return 14.0, 14.0, "Chargee", "UFC (hranice pásma neověřena)"
        return 9.0, 9.0, "Chargee", "DC (hranice pásma neověřena)"
    if op == "Lidl":
        return (11.9, 11.9, "Lidl", "DC") if has_dc else (8.9, 8.9, "Lidl", "AC")
    return None, None, None, "bez vlastní karty – MB.CHARGE roaming nebo ad hoc"


def usable_for_cla(op, has_dc, dc_kw):
    """CLA 350 4MATIC: 800 V DC only (no 400 V booster), 22 kW AC on board."""
    if not has_dc:
        return "jen AC"
    if op == "Tesla":
        return "nejisté (Tesla V3 jen do 500 V)"
    if dc_kw is None:
        return "neznámý výkon DC"
    if dc_kw >= 150:
        return "ano"
    if dc_kw >= 100:
        return "nejspíš (ověř 800 V)"
    return "nejisté (starší DC bývá jen 400–500 V)"


# ---------------------------------------------------------------- parse sources
BIKE_ONLY = {"bosch_3pin", "bosch_5pin", "shimano_steps_5pin", "xlr_3pin_cable", "rosenberger_magnetic",
             "panasonic", "ebike"}


def parse_osm(elements, cc="CZ"):
    out = []
    for e in elements:
        t = e.get("tags", {})
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        if lat is None:
            continue
        sockets = {k.split(":")[1] for k in t if k.startswith("socket:") and k.count(":") == 1}
        car_socket = sockets - BIKE_ONLY - {"schuko"}
        if t.get("motorcar") == "no" or (not car_socket and (t.get("bicycle") == "yes" or sockets & BIKE_ONLY)):
            continue  # e-bike / scooter stations
        ccs_n, ccs_kw = count(t.get("socket:type2_combo")), parse_kw(t.get("socket:type2_combo:output"))
        cha_n, cha_kw = count(t.get("socket:chademo")), parse_kw(t.get("socket:chademo:output"))
        tsl_n = count(t.get("socket:tesla_supercharger")) + count(t.get("socket:tesla_supercharger_ccs"))
        t2_kw = max(filter(None, [parse_kw(t.get("socket:type2:output")),
                                  parse_kw(t.get("socket:type2_cable:output"))]), default=None)
        has_dc = bool(ccs_n or cha_n or tsl_n or ccs_kw or cha_kw)
        dc_kw = max(filter(None, [ccs_kw, cha_kw, parse_kw(t.get("socket:tesla_supercharger_ccs:output"))]),
                    default=None)
        op = canon_operator(t.get("operator"), t.get("network"), t.get("brand"), t.get("name"),
                            t.get("operator:short"))
        street = " ".join(x for x in (t.get("addr:street") or t.get("addr:place"), t.get("addr:housenumber")) if x)
        out.append({
            "id": f"osm:{e['type']}/{e['id']}", "osm_id": f"{e['type']}/{e['id']}", "ocm_id": None,
            "name": t.get("name") or t.get("brand") or t.get("operator") or None,
            "operator": op, "operator_raw": t.get("operator") or t.get("network") or t.get("brand"),
            "lat": lat, "lon": lon, "address": street or None, "city": t.get("addr:city"),
            "has_dc": int(has_dc), "dc_kw": dc_kw, "ccs_count": ccs_n or (1 if ccs_kw else 0),
            "chademo_count": cha_n, "ac_kw": t2_kw, "capacity": count(t.get("capacity")) or None,
            "opening_hours": t.get("opening_hours"), "evse_ref": t.get("ref:EU:EVSE"),
            "fee": t.get("fee"), "check_date": t.get("check_date"), "source": "osm", "cc": cc,
        })
    return out


def parse_ocm(path):
    ref = json.load(open(os.path.join(path, "data", "referencedata.json"), encoding="utf-8"))
    ops = {o["ID"]: o["Title"] for o in ref["Operators"]}
    out = []
    files = [(cc, fn) for cc in COUNTRIES for fn in glob.glob(os.path.join(path, "data", cc, "*.json"))]
    for cc, fn in files:
        p = json.load(open(fn, encoding="utf-8"))
        a = p.get("AddressInfo") or {}
        if p.get("StatusTypeID") in (100, 150, 200):  # not operational / removed
            continue
        dc_kw = ac_kw = None
        ccs = cha = 0
        for c in p.get("Connections") or []:
            kw, ctype, qty = c.get("PowerKW"), c.get("ConnectionTypeID"), c.get("Quantity") or 1
            is_dc = c.get("CurrentTypeID") == 30 or ctype in (2, 32, 33, 27, 30)
            if ctype in (32, 33):
                ccs += qty
            if ctype == 2:
                cha += qty
            if kw:
                if is_dc:
                    dc_kw = max(dc_kw or 0, kw)
                else:
                    ac_kw = max(ac_kw or 0, kw)
        has_dc = bool(ccs or cha or dc_kw)
        op_raw = ops.get(p.get("OperatorID"))
        out.append({
            "id": f"ocm:{p['ID']}", "osm_id": None, "ocm_id": p["ID"],
            "name": (a.get("Title") or "").strip() or None,
            "operator": canon_operator(op_raw, a.get("Title")), "operator_raw": op_raw,
            "lat": a.get("Latitude"), "lon": a.get("Longitude"),
            "address": a.get("AddressLine1"), "city": a.get("Town"),
            "has_dc": int(has_dc), "dc_kw": dc_kw, "ccs_count": ccs, "chademo_count": cha, "ac_kw": ac_kw,
            "capacity": p.get("NumberOfPoints"), "opening_hours": None, "evse_ref": None, "fee": None,
            "check_date": (p.get("DateLastVerified") or p.get("DateLastStatusUpdate") or "")[:10] or None,
            "source": "ocm", "cc": cc,
        })
    return out


def merge(osm, ocm, max_m=80):
    grid = Grid(osm)
    added = 0
    for o in ocm:
        if o["lat"] is None:
            continue
        hits = [it for d, it in grid.near(o["lat"], o["lon"], max_m)
                if not (o["operator"] and it["operator"] and o["operator"] != it["operator"])]
        if hits:
            s = hits[0]
            s["ocm_id"] = o["ocm_id"]
            s["source"] = "osm+ocm"
            for k in ("dc_kw", "ac_kw"):
                if o[k] and (s[k] is None or o[k] > s[k]):
                    s[k] = o[k]
            s["has_dc"] = int(s["has_dc"] or o["has_dc"])
            s["ccs_count"] = max(s["ccs_count"] or 0, o["ccs_count"] or 0)
            s["operator"] = s["operator"] or o["operator"]
            s["city"] = s["city"] or o["city"]
            s["address"] = s["address"] or o["address"]
        else:
            osm.append(o)
            added += 1
    return osm, added


def merge_import(stations, rows, same_op_m=120, any_m=35):
    """Operator data is newer than OSM/OCM: on a match it overwrites power and fills gaps.
    Match = same operator within same_op_m, or any DC/unknown-operator station within any_m."""
    grid = Grid(stations)
    updated = added = 0
    for r in rows:
        if r.get("lat") is None:
            continue
        hits = [it for d, it in grid.near(r["lat"], r["lon"], same_op_m)
                if it["operator"] and it["operator"] == r["operator"]]
        if not hits:
            hits = [it for d, it in grid.near(r["lat"], r["lon"], any_m)
                    if not it["operator"] or (it["has_dc"] and not it["dc_kw"])]
        if hits:
            s = hits[0]
            if r["dc_kw"]:
                s["dc_kw"] = r["dc_kw"]
            s["has_dc"] = 1
            s["ccs_count"] = max(s.get("ccs_count") or 0, r.get("ccs_count") or 0)
            for k in ("operator", "operator_raw", "name", "address", "city", "evse_ref"):
                s[k] = s.get(k) or r.get(k)
            s["check_date"] = r.get("check_date") or s.get("check_date")
            if r["source"] not in (s.get("source") or ""):
                s["source"] = f"{s.get('source')}+{r['source']}"
            updated += 1
        else:
            stations.append(dict(r))
            grid.g.setdefault(grid.key(r["lat"], r["lon"]), []).append(stations[-1])
            added += 1
    return updated, added


def apply_overrides(stations, path):
    """doplnky.csv = stations verified by hand (photos, Google Maps, real sessions).
    Same operator within match_radius_m -> update power/CCS; otherwise add a new row."""
    if not os.path.exists(path):
        return 0, 0
    grid = Grid(stations)
    fixed = added = 0
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            lat, lon = float(r["lat"]), float(r["lon"])
            kw = float(r["dc_kw"]) if r.get("dc_kw") else None
            hits = [it for d, it in grid.near(lat, lon, float(r.get("match_radius_m") or 60))
                    if it["operator"] == r["operator"] and it["has_dc"]]
            if hits:
                s = max(hits, key=lambda it: it["dc_kw"] or 0)
                fixed += 1
            else:
                s = {"id": f"manual:{lat:.5f},{lon:.5f}", "osm_id": None, "ocm_id": None, "operator_raw": r["operator"],
                     "lat": lat, "lon": lon, "address": None, "city": None, "ac_kw": None, "capacity": None,
                     "opening_hours": None, "evse_ref": None, "fee": None, "chademo_count": 0, "cc": r.get("cc") or "CZ"}
                stations.append(s)
                added += 1
            s.update({"name": r["name"], "operator": r["operator"], "has_dc": 1, "dc_kw": kw,
                      "ccs_count": int(r["ccs_count"]) if r.get("ccs_count") else s.get("ccs_count"),
                      "check_date": dt.date.today().isoformat(),
                      "source": (s.get("source") + "+ručně" if s.get("source") else "ručně ověřeno")})
    return fixed, added


def parse_fuel(elements):
    out = []
    for e in elements:
        t = e.get("tags", {})
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        if lat is None:
            continue
        brand = t.get("brand") or t.get("name") or t.get("operator") or "pumpa"
        out.append({"lat": lat, "lon": lon, "brand": brand.strip(), "name": t.get("name"),
                    "shop": t.get("shop") or ("yes" if t.get("compressed_air") else None)})
    return out


# ---------------------------------------------------------------- main
COLUMNS = ["id", "name", "operator", "operator_raw", "lat", "lon", "address", "city", "has_dc", "dc_kw",
           "ccs_count", "chademo_count", "ac_kw", "capacity", "usable_cla", "price_day", "price_night",
           "price_card", "price_note", "fuel_brand", "fuel_dist_m", "opening_hours", "evse_ref", "fee",
           "check_date", "osm_id", "ocm_id", "source", "gmaps", "cc"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--ocm", default=os.path.join(RAW, "ocm-export"))
    ap.add_argument("--no-ocm", action="store_true")
    ap.add_argument("--no-import", action="store_true", help="skip operator importers (offline / quick run)")
    a = ap.parse_args()
    os.makedirs(RAW, exist_ok=True)

    stations, fuel_elements, osm_base = [], [], None
    for cc in COUNTRIES:
        charging = overpass(q_amenity(cc, "charging_station"), os.path.join(RAW, f"osm_charging_{cc}.json"), a.refresh)
        fuel_cc = overpass(q_amenity(cc, "fuel"), os.path.join(RAW, f"osm_fuel_{cc}.json"), a.refresh)
        stations += parse_osm(charging["elements"], cc)
        fuel_elements += fuel_cc["elements"]
        osm_base = charging.get("osm3s", {}).get("timestamp_osm_base") or osm_base
    fuel = {"elements": fuel_elements}
    n_osm = len(stations)
    ocm_added, ocm_date = 0, None
    if not a.no_ocm:
        ensure_ocm(a.ocm)
        ocm = parse_ocm(a.ocm)
        stations, ocm_added = merge(stations, ocm)
        ocm_date = subprocess.run(["git", "-C", a.ocm, "log", "-1", "--format=%cs"],
                                  capture_output=True, text=True).stdout.strip()

    pumps = parse_fuel(fuel["elements"])
    importers = {}
    if not a.no_import:
        import operators
        cz_points = Grid([{"lat": s["lat"], "lon": s["lon"]} for s in stations if s["source"].startswith("osm")] + pumps,
                         cell=0.2)
        near_cz = lambda lat, lon: bool(cz_points.near(lat, lon, 15000))  # noqa: E731
        for name, fn in (("eon_map", lambda: operators.eon_map(near_cz, canon_operator)),
                         ("tesla", operators.tesla)):
            try:
                rows = fn()
                upd, add = merge_import(stations, rows)
                importers[name] = {"ok": True, "rows": len(rows), "updated": upd, "added": add}
            except Exception as e:  # one broken source must not stop the weekly build
                importers[name] = {"ok": False, "error": str(e)[:200]}
                print(f"importer {name} failed: {e}")

    n_fixed, n_added_manual = apply_overrides(stations, os.path.join(HERE, "doplnky.csv"))

    pgrid = Grid(pumps)
    for s in stations:
        near = pgrid.near(s["lat"], s["lon"], 200)
        s["fuel_brand"], s["fuel_dist_m"] = (near[0][1]["brand"], round(near[0][0])) if near else (None, None)
        s["usable_cla"] = usable_for_cla(s["operator"], s["has_dc"], s["dc_kw"])
        s["price_day"], s["price_night"], s["price_card"], s["price_note"] = card_price(
            s["operator"], s["dc_kw"], bool(s["has_dc"]))
        s["gmaps"] = f"https://www.google.com/maps/search/?api=1&query={s['lat']:.6f},{s['lon']:.6f}"

    db_path = os.path.join(HERE, "nabijecky.sqlite")
    if os.path.exists(db_path):
        os.remove(db_path)
    con = sqlite3.connect(db_path)
    con.execute(f"CREATE TABLE stations ({', '.join(c + (' REAL' if c in ('lat','lon','dc_kw','ac_kw','price_day','price_night') else ' TEXT') for c in COLUMNS)})")
    con.executemany(f"INSERT INTO stations VALUES ({','.join('?' * len(COLUMNS))})",
                    [[s.get(c) for c in COLUMNS] for s in stations])
    con.execute("CREATE INDEX idx_latlon ON stations(lat, lon)")
    meta = {"built": dt.datetime.now().isoformat(timespec="minutes"),
            "osm_base": osm_base, "countries": ",".join(COUNTRIES),
            "ocm_export_date": ocm_date, "stations": len(stations), "from_osm": n_osm,
            "added_from_ocm": ocm_added, "manual_fixed": n_fixed, "manual_added": n_added_manual,
            "fuel_stations": len(pumps), "importers": json.dumps(importers, ensure_ascii=False),
            "license": "OSM data © OpenStreetMap contributors (ODbL); OCM data CC BY 4.0; "
                       "E.ON Drive map (roaming stations); supercharge.info"}
    con.execute("CREATE TABLE meta (key TEXT, value TEXT)")
    con.executemany("INSERT INTO meta VALUES (?,?)", [(k, str(v)) for k, v in meta.items()])
    con.commit()
    con.close()

    with open(os.path.join(HERE, "nabijecky.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(stations)
    with open(os.path.join(HERE, "nabijecky.geojson"), "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [s["lon"], s["lat"]]},
             "properties": {c: s.get(c) for c in COLUMNS if c not in ("lat", "lon")}} for s in stations]},
            f, ensure_ascii=False)

    print(json.dumps(meta, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
