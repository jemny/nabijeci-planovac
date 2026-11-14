"""Operator / roaming sources that fill the gaps of OSM + OCM (power, missing fast hubs).

Each importer returns a list of station dicts in the same shape as build_db.parse_osm().
Importers are independent: an exception is caught in build_db and reported in meta.

* eon_map   – public station map of E.ON Drive (www.eon-drive.cz/mapa), which shows E.ON's own
              stations plus all roaming partners (ČEZ, PRE, MOL, ORLEN, IONITY, …) with per-connector kW.
              robots.txt allows it. Details are cached (build/cache/eon_details.json) and only new or
              >28-day-old stations are re-fetched, with a pause between requests.
* tesla     – supercharge.info community API (OPEN Czech sites, stall count, max kW).
"""
import datetime as dt
import json
import os
import time
import urllib.request

UA = "Mozilla/5.0 (compatible; nabijeci-planovac/0.1; personal trip planner, weekly)"
CZ_BBOX = {"latMax": 51.06, "latMin": 48.55, "longMax": 18.87, "longMin": 12.09}
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")


def _get(url, data=None, timeout=90):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


def eon_map(near_cz, canon_operator, log=print, max_stale=300, pause=0.25):
    """near_cz(lat, lon) -> bool : cheap pre-filter so we don't fetch details for Vienna or Munich."""
    body = json.dumps({"boundingBox": CZ_BBOX, "powerType": "", "chargingPower": "", "connectorType": "",
                       "country": "", "search": "", "stationOperator": "", "operatorName": ""}).encode()
    raw = _get("https://www.eon-drive.cz/api/search", data=body)
    pins = []
    for chunk in raw.split("\n"):
        chunk = chunk.strip()
        if chunk:
            pins += json.loads(chunk)
    cand = [p for p in pins if (p.get("isDC") or p.get("isUFC")) and near_cz(float(p["latitude"]), float(p["longitude"]))]

    os.makedirs(CACHE, exist_ok=True)
    cache_path = os.path.join(CACHE, "eon_details.json")
    cache = json.load(open(cache_path, encoding="utf-8")) if os.path.exists(cache_path) else {}
    today = dt.date.today()
    fetched = refreshed = 0
    for p in cand:
        key = str(p["id"])
        c = cache.get(key)
        if c and (today - dt.date.fromisoformat(c["_fetched"])).days < 28:
            continue
        if c:  # stale: refresh a slice per run so weekly builds stay short
            if refreshed >= max_stale:
                continue
            refreshed += 1
        try:
            d = json.loads(_get(f"https://www.eon-drive.cz/api/stations/{p['id']}", timeout=30))
            d["_fetched"] = today.isoformat()
            cache[key] = d
            fetched += 1
            time.sleep(pause)
        except Exception as e:  # keep going, one station is not worth failing the build
            log(f"eon_map: {p['id']} {e}")
    live_ids = {str(p["id"]) for p in pins}
    cache = {k: v for k, v in cache.items() if k in live_ids}  # drop stations removed from the map
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, separators=(",", ":"))

    out = []
    for p in cand:
        d = cache.get(str(p["id"]))
        if not d or d.get("country") != "CZ" or d.get("isRemoved"):
            continue
        dc_kw, ccs, chademo = None, 0, 0
        for e in d.get("evses") or []:
            for c in e.get("connectors") or []:
                if c.get("currentType") == "DC":
                    kw = c.get("maxKw")
                    if kw:
                        dc_kw = max(dc_kw or 0, float(kw))
                    if (c.get("type") or "").upper().startswith("CCS"):
                        ccs += 1
                    if "CHADEMO" in (c.get("type") or "").upper():
                        chademo += 1
        if not (dc_kw or ccs or chademo):
            continue
        op_raw = d.get("operatorName") or ("E.ON" if d.get("isEon") else None)
        out.append({
            "id": f"eon:{d['id']}", "osm_id": None, "ocm_id": None, "name": d.get("name"),
            "operator": canon_operator(op_raw, d.get("name")), "operator_raw": op_raw,
            "lat": float(d["latitude"]), "lon": float(d["longitude"]),
            "address": d.get("address"), "city": d.get("city"), "has_dc": 1, "dc_kw": dc_kw,
            "ccs_count": ccs, "chademo_count": chademo, "ac_kw": None, "capacity": len(d.get("evses") or []) or None,
            "opening_hours": None, "evse_ref": ((d.get("evses") or [{}])[0] or {}).get("evseId"), "fee": None,
            "check_date": (cache.get(str(p["id"])) or {}).get("_fetched"), "source": "eon-map",
        })
    log(f"eon_map: {len(pins)} pins, {len(cand)} DC near CZ, {fetched} details fetched, {len(out)} CZ DC stations")
    return out


def tesla(log=print):
    data = json.loads(_get("https://supercharge.info/service/supercharge/allSites", timeout=120))
    out = []
    for s in data:
        if (s.get("address") or {}).get("country") not in ("Czech Republic", "Czechia") or s.get("status") != "OPEN":
            continue
        g = s.get("gps") or {}
        out.append({
            "id": f"tesla:{s['id']}", "osm_id": None, "ocm_id": None, "name": f"Tesla Supercharger {s.get('name', '')}",
            "operator": "Tesla", "operator_raw": "Tesla", "lat": g.get("latitude"), "lon": g.get("longitude"),
            "address": (s.get("address") or {}).get("street"), "city": (s.get("address") or {}).get("city"),
            "has_dc": 1, "dc_kw": float(s["powerKilowatt"]) if s.get("powerKilowatt") else None,
            "ccs_count": s.get("stallCount"), "chademo_count": 0, "ac_kw": None, "capacity": s.get("stallCount"),
            "opening_hours": None, "evse_ref": None, "fee": None, "check_date": s.get("dateModified", "")[:10] or None,
            "source": "supercharge.info",
        })
    log(f"tesla: {len(out)} open CZ sites")
    return out
