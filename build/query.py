#!/usr/bin/env python3
"""Search the local charger database (build it first with build_db.py).

Examples
  # around a point (lat,lon), only fast DC usable by the CLA, at a fuel station
  python3 nabijecky/query.py --near 49.28,17.02 --radius 15 --min-kw 100 --pumpa
  # along a route given by waypoints (straight lines between them), 3 km corridor
  python3 nabijecky/query.py --route "49.84,18.16;49.28,17.02;49.20,16.62" --corridor 3 --min-kw 150 --pumpa
  # one operator
  python3 nabijecky/query.py --near 49.82,18.26 --radius 30 --operator ORLEN

Output: markdown table sorted by distance (or by km along the route) with a Google Maps link for each.
Coverage note: OSM/OCM miss some new hubs and many power values; check doplnky.csv and the real map.
"""
import argparse
import math
import os
import sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))


def hav_km(a, b):
    r = 6371.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(x))


def to_xy(p, lat0):
    return (math.radians(p[1]) * 6371.0 * math.cos(math.radians(lat0)), math.radians(p[0]) * 6371.0)


def route_pos(pt, route):
    """(distance from route km, km along route) using straight segments between waypoints."""
    lat0 = sum(p[0] for p in route) / len(route)
    P = to_xy(pt, lat0)
    best, along, acc = None, None, 0.0
    for a, b in zip(route, route[1:]):
        A, B = to_xy(a, lat0), to_xy(b, lat0)
        dx, dy = B[0] - A[0], B[1] - A[1]
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L2))
        C = (A[0] + t * dx, A[1] + t * dy)
        d = math.hypot(P[0] - C[0], P[1] - C[1])
        if best is None or d < best:
            best, along = d, acc + t * math.sqrt(L2)
        acc += math.sqrt(L2)
    return best, along


def parse_pt(s):
    lat, lon = (float(x) for x in s.replace(" ", "").split(","))
    return lat, lon


def fmt_price(r):
    if r["price_day"] is None:
        return "–"
    d, n = r["price_day"], r["price_night"]
    p = f"{d:.2f}".replace(".", ",") if d == n else f"{d:.2f} / {n:.2f}".replace(".", ",")
    return f"{p} ({r['price_card']})"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--near", help="lat,lon")
    ap.add_argument("--radius", type=float, default=10, help="km (with --near)")
    ap.add_argument("--route", help="'lat,lon;lat,lon;...' waypoints")
    ap.add_argument("--corridor", type=float, default=3, help="km from the route line")
    ap.add_argument("--min-kw", type=float, default=0, help="minimum DC power (unknown power is excluded when > 0)")
    ap.add_argument("--pumpa", action="store_true", help="only stations ≤200 m from a fuel station")
    ap.add_argument("--operator", help="e.g. E.ON, ČEZ, ORLEN, MOL, Shell, PRE, IONITY")
    ap.add_argument("--include-unknown", action="store_true", help="keep DC stations with unknown power")
    ap.add_argument("--limit", type=int, default=25)
    ap.add_argument("--db", default=os.path.join(HERE, "nabijecky.sqlite"))
    a = ap.parse_args()
    if not (a.near or a.route):
        ap.error("use --near or --route")

    con = sqlite3.connect(a.db)
    con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute("SELECT * FROM stations")]
    meta = dict(con.execute("SELECT key, value FROM meta").fetchall())

    out = []
    route = [parse_pt(p) for p in a.route.split(";")] if a.route else None
    center = parse_pt(a.near) if a.near else None
    for r in rows:
        if a.operator and (r["operator"] or "").lower() != a.operator.lower():
            continue
        if a.pumpa and not r["fuel_brand"]:
            continue
        if a.min_kw:
            if not r["has_dc"] or str(r["has_dc"]) == "0":
                continue
            if r["dc_kw"] is None:
                if not a.include_unknown:
                    continue
            elif r["dc_kw"] < a.min_kw:
                continue
        pt = (r["lat"], r["lon"])
        if route:
            d, along = route_pos(pt, route)
            if d > a.corridor:
                continue
            r["_sort"], r["_dist"], r["_along"] = along, d, along
        else:
            d = hav_km(center, pt)
            if d > a.radius:
                continue
            r["_sort"], r["_dist"] = d, d
        out.append(r)
    out.sort(key=lambda r: r["_sort"])

    head = "| " + ("km po trase | od trasy" if route else "vzdálenost") + \
           " | stanice | provozovatel | DC kW | CCS | Bělouš | pumpa | cena Kč/kWh den / noc |"
    print(head)
    print("|" + "---|" * (head.count("|") - 1))
    for r in out[: a.limit]:
        name = (r["name"] or r["operator"] or "?").replace("|", "/")
        place = ", ".join(x for x in (r["address"], r["city"]) if x)
        link = f"[{name}{' – ' + place if place else ''}]({r['gmaps']})"
        kw = f"{r['dc_kw']:.0f}" if r["dc_kw"] else ("?" if str(r["has_dc"]) == "1" else "AC")
        pumpa = f"{r['fuel_brand']} ({r['fuel_dist_m']} m)" if r["fuel_brand"] else "–"
        dist = (f"{r['_along']:.0f} | {r['_dist']:.1f} km" if route else f"{r['_dist']:.1f} km")
        print(f"| {dist} | {link} | {r['operator'] or '?'} | {kw} | {r['ccs_count'] or '–'} | "
              f"{r['usable_cla']} | {pumpa} | {fmt_price(r)} |")
    print(f"\n{len(out)} nalezeno, zobrazeno {min(len(out), a.limit)}. "
          f"Data: OSM {meta.get('osm_base', '?')[:10]}, OCM export {meta.get('ocm_export_date')}, "
          f"databáze {meta.get('built')}.")


if __name__ == "__main__":
    main()
