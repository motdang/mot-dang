#!/usr/bin/env python3
"""Voight-Kampff layers: Pulse, Masks, Light test, and a page for each bot.

Her ask 2026-11-26: "add even a couple more layers of computational wonder to voight kampff,
increase sharability". Her picks the same day: Pulse, Masks, Light test, Ask the log.

    python3 vk_layers.py                      # the last Chiang Mai day; splice, bot pages, publish
    python3 vk_layers.py --hours 24 --no-deploy
    python3 vk_layers.py --no-cards           # skip the headless-Chrome cards

PULSE   each big bot's requests in 10-second bins over the window, and in 1-second bins over
        its busiest hour, compared with themselves shifted in time (autocorrelation). A clock
        shows as a peak; the Fano factor (variance / mean of the bins) says clockwork (< 1),
        coin flips (≈ 1) or binges (> 1).
MASKS   the SHA-1 of the cipher list a caller offers names its software. One list under many
        names; and three tests on everything that calls itself a browser: HTTP/1.1, a hello
        under 1,000 bytes, the same extension order 1,000+ times (Chromium shuffles it).
LIGHT   light in glass fibre covers about 200 km a millisecond, so a round trip of r ms puts
        the caller within (r + 1) x 100 km of the Cloudflare data centre that answered. Where
        Cloudflare's country for the address lies farther than that, the light says no.

People (the classifier's browsers) appear only in totals. Groups listed by name are bots,
or browser names with 1,000+ requests in the window.

Geo: OurAirports (public domain) for data-centre positions by airport code; world-atlas 2.0.2
(Natural Earth, public domain; ISC) for land and countries; i18n-iso-countries 7.14.0 (MIT)
for country numbers. Built once into data/voight-kampff/geo/geo.json by --geo <dir>.
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import html
import json
import math
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import vk_weekly as vk  # noqa: E402
from traffic import sql  # noqa: E402

ICT = dt.timezone(dt.timedelta(hours=7))
DATA = ROOT / "data" / "voight-kampff"
GEO = DATA / "geo" / "geo.json"
HIST = DATA / "layers"
FIRST_SEEN = DATA / "first-seen.json"
VK = vk.VK
BOTS = VK / "bot"
W = "SUM(_sample_interval)"
KM_PER_MS = 100  # light in fibre ≈ 200 km/ms one way; a round trip covers the distance twice
TCP = "blob18 NOT LIKE 'HTTP/3%'"  # on QUIC Cloudflare gives no TCP round trip and the row reads 0
BROWSER_NAMES = {"Chrome", "Safari", "Firefox", "Edge", "Opera", "Samsung Internet", "LINE in-app",
                 "Facebook in-app", "other browser"}
CHROMIUM = {"Chrome", "Edge", "Opera", "Samsung Internet"}


def e(s) -> str:
    return html.escape(str(s), quote=True)


def c(n) -> str:
    return f"{int(round(n)):,}"


def browserish(agent: str, kind: str) -> bool:
    return kind == "human" or agent in BROWSER_NAMES or agent.startswith(("data centre", "Chrome string"))


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "unnamed"


# ── geo ───────────────────────────────────────────────────────────────────────

def topo_rings(topo: dict, obj: dict) -> list[list[list[float]]]:
    """A TopoJSON (Multi)Polygon as rings of [lon, lat]."""
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append([round(x * sx + tx, 3), round(y * sy + ty, 3)])
        arcs.append(pts)

    def ring(ids):
        out = []
        for i in ids:
            pts = arcs[i] if i >= 0 else arcs[~i][::-1]
            out.extend(pts if not out else pts[1:])
        return out

    polys = [obj["arcs"]] if obj["type"] == "Polygon" else obj["arcs"] if obj["type"] == "MultiPolygon" else []
    return [ring(r) for poly in polys for r in poly]


def build_geo(src: Path) -> None:
    iata = {}
    with (src / "airports.csv").open(encoding="utf-8") as f:
        rank = {"large_airport": 3, "medium_airport": 2, "small_airport": 1}
        for r in csv.DictReader(f):
            code = r["iata_code"]
            if not code or len(code) != 3:
                continue
            k = rank.get(r["type"], 0)
            if code not in iata or k > iata[code][4]:
                iata[code] = [round(float(r["latitude_deg"]), 3), round(float(r["longitude_deg"]), 3),
                              r["municipality"] or r["name"], r["iso_country"], k]
    for v in iata.values():
        v.pop()
    land_t = json.loads((src / "land-110m.json").read_text())
    land = [rg for g in land_t["objects"]["land"]["geometries"] for rg in topo_rings(land_t, g)]
    num2a = {n: a for a, _, n, _ in json.loads((src / "codes.json").read_text())}
    ct = json.loads((src / "countries-50m.json").read_text())
    countries = {}
    for g in ct["objects"]["countries"]["geometries"]:
        a = num2a.get(str(g.get("id", "")).zfill(3))
        if a:
            countries.setdefault(a, []).extend(topo_rings(ct, g))
    GEO.parent.mkdir(parents=True, exist_ok=True)
    GEO.write_text(json.dumps({
        "sources": {"iata": "OurAirports airports.csv, public domain",
                    "land": "world-atlas 2.0.2 land-110m (Natural Earth, public domain), ISC",
                    "countries": "world-atlas 2.0.2 countries-50m (Natural Earth, public domain), ISC; "
                                 "numbers to letters by i18n-iso-countries 7.14.0, MIT"},
        "iata": iata, "land": land, "countries": countries}, separators=(",", ":")))
    print(f"geo: {len(iata)} airport codes, {len(land)} land rings, {len(countries)} countries")


def hav(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371 * math.asin(min(1, math.sqrt(a)))


def inside(lon, lat, ring) -> bool:
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            hit = not hit
        j = i
    return hit


def country_km(geo: dict, cc: str, lat: float, lon: float):
    """Great-circle km from a point to the nearest edge of a country; 0 inside it; None if unknown."""
    rings = geo["countries"].get(cc)
    if not rings:
        return None
    if any(inside(lon, lat, r) for r in rings):
        return 0.0
    best = 1e9
    for r in rings:
        for x, y in r[::2] if len(r) > 400 else r:
            if abs(y - lat) * 111 > best:
                continue
            best = min(best, hav(lat, lon, y, x))
    return best


def circle(lat, lon, km, n=72) -> list[tuple[float, float]]:
    """A geodesic circle as [lon, lat] points."""
    d = km / 6371
    p1, l1 = math.radians(lat), math.radians(lon)
    out = []
    for i in range(n + 1):
        b = 2 * math.pi * i / n
        p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
        l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
        out.append(((math.degrees(l2) + 540) % 360 - 180, math.degrees(p2)))
    return out


# ── reading ───────────────────────────────────────────────────────────────────

def win_sql(a: dt.datetime, b: dt.datetime) -> str:
    f = "%Y-%m-%d %H:%M:%S"
    return f"timestamp >= toDateTime('{a.strftime(f)}') AND timestamp < toDateTime('{b.strftime(f)}')"


def q(s: str) -> list[dict]:
    try:
        return sql(s)
    except SystemExit as ex:
        print("sql:", ex, file=sys.stderr)
        return []


def esc_sql(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")


# ── pulse ─────────────────────────────────────────────────────────────────────

def acf(x: np.ndarray) -> np.ndarray:
    k = 31
    if len(x) > 3 * k:  # take out the slow swell of the day, keep the beat
        x = x - np.convolve(x, np.ones(k) / k, mode="same")
    x = x - x.mean()
    if not x.any():
        return np.zeros(len(x))
    f = np.fft.rfft(x, n=2 * len(x))
    r = np.fft.irfft(f * np.conj(f))[: len(x)]
    return r / r[0]


def peak(r: np.ndarray, lo: int, hi: int) -> tuple[int, float]:
    hi = min(hi, len(r) - 2)
    best_l, best_v = 0, 0.0
    cands = [(l, r[l]) for l in range(lo, hi) if r[l] > r[l - 1] and r[l] >= r[l + 1] and r[l] > 0.12]
    if not cands:
        return 0, 0.0
    best_l, best_v = max(cands, key=lambda t: t[1])
    for l, v in cands:  # the fundamental, not a multiple of it
        if l < best_l and v >= 0.85 * best_v:
            return l, float(v)
    return best_l, float(best_v)


def series(where: str, a: dt.datetime, b: dt.datetime, step: int) -> np.ndarray:
    t0 = int(a.replace(tzinfo=dt.timezone.utc).timestamp())
    n = int((b - a).total_seconds()) // step
    x = np.zeros(n)
    for r in q(f"SELECT intDiv(toUInt32(timestamp), {step}) t, {W} n FROM traffic_eye WHERE {win_sql(a, b)} "
               f"AND {where} GROUP BY t ORDER BY t LIMIT 100000"):
        i = int(r["t"]) - t0 // step
        if 0 <= i < n:
            x[i] += float(r["n"])
    return x


def path_of(vals, w=300, h=60, pad=4) -> str:
    vals = list(vals)
    if not vals:
        return ""
    top = max(vals) or 1
    step = (w - 2 * pad) / max(1, len(vals) - 1)
    pts = [f"{pad + i * step:.0f},{h - pad - (v / top) * (h - 2 * pad):.0f}" for i, v in enumerate(vals)]
    return "M" + " L".join(pts)


def pulse(a: dt.datetime, b: dt.datetime, callers: list[dict]) -> list[dict]:
    out = []
    for cl in callers:
        where = f"blob3 = '{esc_sql(cl['a'])}' AND blob2 = '{esc_sql(cl['k'])}' AND double1 >= 1"
        x10 = series(where, a, b, 10)
        if x10.sum() < 200:
            continue
        r10 = acf(x10)
        l10, v10 = peak(r10, 2, 360)
        # its busiest hour, second by second
        hour = np.convolve(x10, np.ones(360), mode="valid")
        h0 = int(hour.argmax())
        ha = a + dt.timedelta(seconds=10 * h0)
        x1 = series(where, ha, ha + dt.timedelta(hours=1), 1)
        r1 = acf(x1) if x1.sum() >= 60 else np.zeros(10)
        l1, v1 = peak(r1, 2, 300)
        period, strength, scale = (l1, v1, 1) if v1 > v10 else (l10 * 10, v10, 10)
        nz = np.nonzero(x10)[0]
        span = x10[nz[0]: nz[-1] + 1]
        fano = float(span.var() / span.mean()) if span.mean() else 0.0
        # hours of the Chiang Mai day with nothing at all
        per_hour = np.zeros(24)
        t0 = a.replace(tzinfo=dt.timezone.utc).astimezone(ICT)
        for i in nz:
            per_hour[(t0 + dt.timedelta(seconds=10 * int(i))).hour] += x10[i]
        quiet = quiet_run(per_hour) if (b - a).total_seconds() >= 23 * 3600 else False  # sleep needs a whole day
        # the busiest 15 minutes as a trace, and its echo
        q15 = np.convolve(x10, np.ones(90), mode="valid")
        s0 = int(q15.argmax())
        trace = x10[s0: s0 + 90]
        tstart = (a + dt.timedelta(seconds=10 * s0)).replace(tzinfo=dt.timezone.utc).astimezone(ICT)
        echo = np.clip(r10[:361], 0, None)
        out.append({
            "caller": cl["a"], "kind": cl["k"], "requests": int(x10.sum()),
            "per_min": round(float(x10.sum()) / ((b - a).total_seconds() / 60), 1),
            "peak_per_10s": int(x10.max()),
            "period_s": int(period), "strength": round(strength, 2), "scale_s": scale,
            "fano": round(fano, 2), "quiet": quiet,
            "trace_from": tstart.strftime("%H:%M"), "trace": [int(v) for v in trace],
            "trace_path": path_of(trace), "echo_path": path_of(echo[::3]),
        })
    return out


def quiet_run(per_hour: np.ndarray):
    if per_hour.all():
        return None
    best = (0, 0)
    for s in range(24):
        n = 0
        while n < 24 and per_hour[(s + n) % 24] == 0:
            n += 1
        if n > best[1]:
            best = (s, n)
    s, n = best
    return [s, (s + n) % 24, n] if n >= 2 else None


# ── masks ─────────────────────────────────────────────────────────────────────

def glyph(h: str, size=44) -> str:
    """A 5 x 5 mirror pattern drawn from the hash: the same fingerprint, the same picture."""
    d = hashlib.sha256(h.encode()).digest()
    pal = ["#ff4fa8", "#ffd23f", "#3fffb0", "#5fd8ff", "#ff8a3d", "#b18cff"]
    fg, bg = pal[d[0] % 6], "#120c33"
    cells = []
    for y in range(5):
        for x in range(3):
            if d[1 + y * 3 + x] & 1:
                for xx in {x, 4 - x}:
                    cells.append(f'<rect x="{1 + xx * 4}" y="{1 + y * 4}" width="4" height="4"/>')
    return (f'<svg class="glyph" viewBox="0 0 22 22" width="{size}" height="{size}" role="img" '
            f'aria-label="fingerprint {e(h[:8])}"><rect width="22" height="22" rx="4" fill="{bg}"/>'
            f'<g fill="{fg}">{"".join(cells)}</g></svg>')


def masks(a: dt.datetime, b: dt.datetime) -> dict:
    rows = q(f"SELECT blob19 c, blob3 a, blob2 k, blob15 asn, blob16 o, substring(blob18, 1, 8) pr, "
             f"COUNT(DISTINCT blob20) ex, quantileExactWeighted(0.5)(double7, _sample_interval) hb, {W} n "
             f"FROM traffic_eye WHERE {win_sql(a, b)} AND blob19 != '' AND double1 >= 1 "
             "GROUP BY c, a, k, asn, o, pr LIMIT 200000")
    # Chromium shuffles its TLS extensions on every connection: one order, again and again, across
    # three or more networks, is a program with Chrome's name
    fixed = set()
    for r in q(f"SELECT blob19 c, blob3 a, blob2 k, COUNT(DISTINCT blob20) ex, COUNT(DISTINCT blob15) nets, {W} n "
               f"FROM traffic_eye WHERE {win_sql(a, b)} AND blob19 != '' AND double1 >= 1 GROUP BY c, a, k LIMIT 100000"):
        claims_chrome = r["a"] in CHROMIUM or r["a"].startswith(("Chrome string", "data centre"))
        if claims_chrome and float(r["n"]) >= 200 and int(r["ex"]) <= 2 and int(r["nets"]) >= 3:
            fixed.add((r["c"], r["a"], r["k"]))
    by = {}
    tot = {"browser": 0, "pass": 0, "proto": 0, "hello": 0, "order": 0, "people": 0, "people_fail": 0}
    groups = {}
    for r in rows:
        n = int(float(r["n"]))
        h = by.setdefault(r["c"], {"names": {}, "nets": set(), "kinds": {}, "n": 0, "pr": {}})
        h["names"][r["a"]] = h["names"].get(r["a"], 0) + n
        h["nets"].add(r["asn"])
        h["kinds"][r["k"]] = h["kinds"].get(r["k"], 0) + n
        h["pr"][r["pr"].strip()] = h["pr"].get(r["pr"].strip(), 0) + n
        h["n"] += n
        if not browserish(r["a"], r["k"]):
            continue
        hb = float(r["hb"])
        fails = []
        r["pr"] = r["pr"].split(" ")[0]
        if r["pr"].startswith("HTTP/1"):
            fails.append("proto")
        if 0 < hb < 1000:
            fails.append("hello")
        if (r["c"], r["a"], r["k"]) in fixed:
            fails.append("order")
        tot["browser"] += n
        if r["k"] == "human":
            tot["people"] += n
            tot["people_fail"] += n if fails else 0
        for f in fails:
            tot[f] += n
        if not fails:
            tot["pass"] += n
            continue
        g = groups.setdefault((r["c"], r["a"], r["k"], r["pr"].strip()), {
            "caller": r["a"], "kind": r["k"], "proto": r["pr"].strip(), "hash": r["c"], "requests": 0,
            "nets": {}, "hb": 0.0, "fails": set()})
        g["requests"] += n
        g["nets"][r["o"] or ("AS" + r["asn"])] = g["nets"].get(r["o"] or ("AS" + r["asn"]), 0) + n
        g["hb"] += hb * n
        g["fails"].update(fails)
    costumes = []
    for g in groups.values():
        n_nets = len(g["nets"])
        # a person sits on one network: browser names are listed only as a crowd
        if (g["kind"] != "human" and g["requests"] >= 50) or (g["requests"] >= 500 and n_nets >= 3):
            costumes.append({"caller": g["caller"], "kind": g["kind"], "proto": g["proto"], "hash": g["hash"],
                             "requests": g["requests"], "hello": int(g["hb"] / g["requests"]),
                             "network": max(g["nets"], key=g["nets"].get) + (f" + {n_nets - 1} more" if n_nets > 1 else ""),
                             "fails": [f for f in ("proto", "hello", "order") if f in g["fails"]]})
    many = []
    for hsh, h in by.items():
        named = {k: v for k, v in h["names"].items()}
        if len(named) < 3 or h["n"] < 100:
            continue
        # a list worn mostly by people's browsers is a browser build, not a mask: keep it out
        if h["kinds"].get("human", 0) > 0.5 * h["n"]:
            continue
        many.append({"hash": hsh, "names": sorted(named.items(), key=lambda t: -t[1])[:8],
                     "n_names": len(named), "nets": len(h["nets"]), "requests": h["n"],
                     "kinds": sorted(h["kinds"].items(), key=lambda t: -t[1])})
    many.sort(key=lambda m: -(m["n_names"] * math.log10(m["requests"] + 10)))
    costumes.sort(key=lambda x: -x["requests"])
    return {"hashes": len(by), "many": many[:8], "costumes": costumes[:14], "tot": tot}


# ── light ─────────────────────────────────────────────────────────────────────

def light(a: dt.datetime, b: dt.datetime, geo: dict) -> dict:
    rows = q(f"SELECT blob3 a, blob2 k, blob15 asn, blob16 o, blob17 colo, blob5 cc, MIN(double6) mn, "
             f"quantileExactWeighted(0.5)(double6, _sample_interval) med, {W} n FROM traffic_eye "
             f"WHERE {win_sql(a, b)} AND blob17 != '' AND double6 >= 0 AND double1 >= 1 AND blob2 != 'human' AND {TCP} "
             "GROUP BY a, k, asn, o, colo, cc ORDER BY n DESC LIMIT 60000")
    ppl = q(f"SELECT blob17 colo, {W} n, quantileExactWeighted(0.5)(double6, _sample_interval) med FROM traffic_eye "
            f"WHERE {win_sql(a, b)} AND blob17 != '' AND double6 >= 0 AND double1 >= 1 AND blob2 = 'human' AND {TCP} GROUP BY colo")
    iata = geo["iata"]
    colos, says_no, callers = {}, [], {}
    for r in rows:
        co = r["colo"]
        if co not in iata:
            continue
        lat, lon, city, ccc = iata[co]
        n, mn, med = int(float(r["n"])), float(r["mn"]), float(r["med"])
        bound = (mn + 1) * KM_PER_MS
        cc = colos.setdefault(co, {"colo": co, "city": city, "cc": ccc, "lat": lat, "lon": lon, "bots": 0,
                                   "people": 0, "callers": {}})
        cc["bots"] += n
        k = (r["a"], r["k"])
        x = cc["callers"].setdefault(k, {"caller": r["a"], "kind": r["k"], "n": 0, "mn": 1e9})
        x["n"] += n
        x["mn"] = min(x["mn"], mn)
        y = callers.setdefault(k, {"caller": r["a"], "kind": r["k"], "n": 0, "best": None, "colos": {}, "nets": {}})
        y["n"] += n
        y["colos"][co] = y["colos"].get(co, 0) + n
        y["nets"][r["o"] or ("AS" + r["asn"])] = y["nets"].get(r["o"] or ("AS" + r["asn"]), 0) + n
        if y["best"] is None or mn < y["best"]["mn"]:
            y["best"] = {"colo": co, "city": city, "mn": mn, "km": bound}
        if n >= 20 and r["cc"] not in ("XX", "T1", "") and r["cc"] != ccc:
            d = country_km(geo, r["cc"], lat, lon)
            if d is not None and d > bound + 300:
                says_no.append({"caller": r["a"], "kind": r["k"], "network": r["o"], "asn": r["asn"],
                                "country": r["cc"], "colo": co, "city": city, "colo_cc": ccc,
                                "rtt": mn, "km": bound, "gap": round(d), "requests": n})
    for r in ppl:
        if r["colo"] in colos:
            colos[r["colo"]]["people"] += int(float(r["n"]))
        elif r["colo"] in iata:
            lat, lon, city, ccc = iata[r["colo"]]
            colos[r["colo"]] = {"colo": r["colo"], "city": city, "cc": ccc, "lat": lat, "lon": lon, "bots": 0,
                                "people": int(float(r["n"])), "callers": {}}
    merged = {}
    for s in says_no:  # one line per caller, network and claimed country
        k = (s["caller"], s["network"], s["country"])
        if k not in merged or s["requests"] > merged[k]["requests"]:
            merged[k] = {**s, "requests": s["requests"] + (merged[k]["requests"] if k in merged else 0)}
        else:
            merged[k]["requests"] += s["requests"]
    for co in colos.values():
        co["callers"] = sorted(({**v, "km": (v["mn"] + 1) * KM_PER_MS} for v in co["callers"].values()),
                               key=lambda v: -v["n"])[:8]
    return {"colos": sorted(colos.values(), key=lambda v: -(v["bots"] + v["people"])),
            "says_no": sorted(merged.values(), key=lambda v: -v["requests"])[:12],
            "callers": callers}


# ── the map ───────────────────────────────────────────────────────────────────

MW, LAT_N, LAT_S = 1000, 84.0, -58.0
MH = round((LAT_N - LAT_S) / 360 * MW)


def xy(lon, lat) -> tuple[float, float]:
    return (lon + 180) / 360 * MW, (LAT_N - lat) / 360 * MW


def ring_path(pts) -> str:
    out, last = [], None
    for lon, lat in pts:
        x, y = xy(lon, lat)
        if last is not None and abs(x - last) > MW / 2:  # wrapped round the date line
            out.append(f"M{x:.1f},{y:.1f}")
        else:
            out.append(("L" if out else "M") + f"{x:.1f},{y:.1f}")
        last = x
    return "".join(out)


def land_path(geo: dict) -> str:
    parts = []
    for r in geo["land"]:
        pts = [xy(lon, max(LAT_S, min(LAT_N, lat))) for lon, lat in r]
        if len(pts) < 4:
            continue
        simp, lx, ly = [], None, None
        for x, y in pts:
            if lx is None or abs(x - lx) + abs(y - ly) >= 1.2:
                simp.append(f"{x:.0f},{y:.0f}")
                lx, ly = x, y
        if len(simp) >= 3:
            parts.append("M" + "L".join(simp) + "Z")
    return "".join(parts)


def map_svg(geo: dict, li: dict, focus: set | None = None, says=True, mid="vkmap") -> str:
    colos = [c_ for c_ in li["colos"] if not focus or c_["colo"] in focus]
    top = max([c_["bots"] + c_["people"] for c_ in colos] or [1])
    dots, rings = [], []
    for i, c_ in enumerate(colos[:120]):
        x, y = xy(c_["lon"], c_["lat"])
        r = 2.5 + 9 * math.sqrt((c_["bots"] + c_["people"]) / top)
        share = c_["bots"] / max(1, c_["bots"] + c_["people"])
        col = "#ff4fa8" if share > 0.5 else "#5fd8ff"
        tip = f"{c_['city']} ({c_['colo']}): {c(c_['bots'])} bot, {c(c_['people'])} people"
        dots.append(f'<g class="colo" data-c="{e(c_["colo"])}" tabindex="0" role="button">'
                    f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r:.1f}" fill="{col}" fill-opacity=".75" stroke="#fff8ec" '
                    f'stroke-width=".8"/><title>{e(tip)}</title></g>')
    lines = []
    if says:
        for s in li["says_no"][:10]:
            rings_ = geo["countries"].get(s["country"])
            co = geo["iata"].get(s["colo"])
            if not rings_ or not co:
                continue
            # the claimed country's nearest corner, as an arc to the city that answered
            best, bp = 1e9, None
            for rr in rings_:
                for lon, lat in rr[::3]:
                    d = hav(co[0], co[1], lat, lon)
                    if d < best:
                        best, bp = d, (lon, lat)
            if not bp:
                continue
            (x1, y1), (x2, y2) = xy(*bp), xy(co[1], co[0])
            if abs(x1 - x2) > MW / 2:
                continue
            mx, my = (x1 + x2) / 2, min(y1, y2) - abs(x1 - x2) * 0.25 - 10
            lines.append(f'<path class="no" d="M{x1:.1f},{y1:.1f} Q{mx:.1f},{my:.1f} {x2:.1f},{y2:.1f}"><title>'
                         f'{e(s["caller"])}: Cloudflare says {e(s["country"])}, light says within {c(s["km"])} km of '
                         f'{e(s["city"])}</title></path>')
    grat = "".join(f'<path class="gr" d="M0,{xy(0, la)[1]:.0f}H{MW}"/>' for la in (60, 30, 0, -30))
    grat += "".join(f'<path class="gr" d="M{xy(lo, 0)[0]:.0f},0V{MH}"/>' for lo in range(-150, 181, 30))
    return (f'<svg id="{mid}" class="map" viewBox="0 0 {MW} {MH}" data-latn="{LAT_N}" role="img" aria-label="World map: Cloudflare data '
            f'centres that answered, sized by requests; pink mostly bots, blue mostly people">'
            f'<rect width="{MW}" height="{MH}" fill="#120c33"/>{grat}<path class="land" d="{land_path(geo)}"/>'
            f'{"".join(rings)}{"".join(lines)}{"".join(dots)}</svg>')


# ── first seen ────────────────────────────────────────────────────────────────

def first_seen() -> dict:
    fs = json.loads(FIRST_SEEN.read_text()) if FIRST_SEEN.exists() else {}
    for r in q("SELECT blob3 a, MIN(timestamp) f FROM traffic_eye WHERE blob2 != 'human' GROUP BY a LIMIT 50000"):
        t = r["f"][:10]
        if r["a"] not in fs or t < fs[r["a"]]:
            fs[r["a"]] = t
    FIRST_SEEN.write_text(json.dumps(fs, ensure_ascii=False, indent=0, sort_keys=True))
    return fs


# ── words ─────────────────────────────────────────────────────────────────────

def beat_words(p: dict) -> tuple[str, str]:
    if p["strength"] >= 0.25 and p["period_s"]:
        s = p["period_s"]
        t = f"{s} s" if s < 120 else f"{s // 60} min {s % 60} s" if s % 60 else f"{s // 60} min"
        tt = f"{s} วินาที" if s < 120 else f"{s // 60} นาที" + (f" {s % 60} วินาที" if s % 60 else "")
        return f"ทุก {tt}", f"beats every {t}"
    if p["fano"] < 0.8:
        return "สม่ำเสมอ ไม่มีจังหวะเดียว", "steady, no single beat"
    if p["fano"] > 3:
        return "มาเป็นชุด ๆ", "comes in binges"
    return "สุ่ม เหมือนโยนเหรียญ", "random, like coin flips"


def fano_words(f: float) -> tuple[str, str]:
    if f < 0.8:
        return "เหมือนนาฬิกา", "clockwork"
    if f <= 1.5:
        return "เหมือนโยนเหรียญ", "coin flips"
    return "กินเป็นมื้อ ๆ", "binges"


FAIL = {"proto": ("ใช้ HTTP/1.1", "HTTP/1.1"), "hello": ("hello เล็ก", "small hello"),
        "order": ("ลำดับเดิมทุกครั้ง", "same order")}


def owner_en(name: str) -> str:
    return vk.owner(name)[0]


def owner_th(name: str) -> str:
    return vk.owner(name)[1]


# ── the block on /voight-kampff/ ─────────────────────────────────────────────

def bot_link(name: str, pages: set) -> str:
    s = slug(name)
    return f'<a class="bn" href="/voight-kampff/bot/{s}/">{e(name)}</a>' if s in pages else f'<b class="bn">{e(name)}</b>'


def sec_pulse(pl: list[dict], pages: set) -> str:
    rows = []
    for p in pl[:10]:
        bth, ben = beat_words(p)
        fth, fen = fano_words(p["fano"])
        q_ = p["quiet"]
        sleep = ("" if q_ is False else f'<span class="tag">หลับ {q_[0]:02d}:00–{q_[1]:02d}:00 · sleeps</span>' if q_ else
                 '<span class="tag">ไม่หลับ · never sleeps</span>')
        rows.append(f"""<div class="pl" tabindex="0" role="button" aria-pressed="false" aria-label="{e(p['caller'])}: tap for its echo">
 <div class="pf">{vk.portrait(p['caller'], 52)}</div>
 <div class="pm"><div>{bot_link(p['caller'], pages)} <span class="def">{e(owner_en(p['caller']))}</span></div>
  <svg class="ecg" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true"><path class="tr" d="{p['trace_path']}"/><path class="ec" d="{p['echo_path']}"/></svg>
  <div class="pt"><b class="bpm">{p['per_min']:g}</b><span class="th">ครั้งต่อนาที</span> <span class="en i">a minute</span> · <span class="th">{e(bth)}</span> <span class="en i">{e(ben)}</span>
  <span class="tag">Fano {p['fano']:g} · {e(fth)} {e(fen)}</span>{sleep}</div></div></div>""")
    return f"""<section id="pulse" class="more layer" aria-labelledby="pul">
<h2 id="pul" class="th">ชีพจร <span class="rom">chip pha chon</span><span class="en">Pulse</span></h2>
<p class="lead th">เครื่อง Voight-Kampff ดูรูม่านตากับชีพจร ที่นี่เรานับคำขอของบอทแต่ละตัวทีละ 10 วินาทีตลอดวัน แล้วเอาเส้นนั้นมาเทียบกับตัวมันเองที่เลื่อนเวลาไป (autocorrelation: ความสัมพันธ์ของสัญญาณกับตัวเองเมื่อเลื่อนเวลา) ถ้ามีนาฬิกาอยู่ข้างใน จะเห็นเป็นยอด เส้นคือ 15 นาทีที่มันกินหนักที่สุด แตะเพื่อดูเสียงสะท้อน
<span class="en">The Voight-Kampff machine watches the pupil and the pulse. Here each bot's requests are counted in 10-second bins all day, then laid against themselves shifted in time (autocorrelation: how much a signal matches itself a moment later). A clock inside shows up as a peak. The line is its busiest 15 minutes. Tap for its echo.</span></p>
{''.join(rows)}
<p class="note th">Fano คือความแปรปรวนหารด้วยค่าเฉลี่ยของช่อง 10 วินาที: ต่ำกว่า 1 สม่ำเสมอเหมือนนาฬิกา ราว 1 สุ่มเหมือนโยนเหรียญ สูงกว่านั้นมาเป็นชุด
<span class="en">Fano: the variance of the 10-second counts over their mean. Under 1, clockwork; about 1, coin flips; above, binges.</span></p>
</section>"""


def sec_masks(m: dict, pages: set) -> str:
    t = m["tot"]
    b = t["browser"] or 1
    pct = lambda k: f"{100 * t[k] / b:.0f}%"  # noqa: E731
    many = []
    for x in m["many"][:6]:
        chips = "".join(f'<span class="tag">{e(nm)} <small>{c(n)}</small></span>' for nm, n in x["names"])
        many.append(f"""<div class="mk"><button class="gl" type="button" aria-label="show the fingerprint">{glyph(x['hash'])}<code>{e(x['hash'][:12])}…</code></button>
 <div><b class="num0">{x['n_names']}</b> <span class="th">ชื่อ</span> <span class="en i">names</span> · {x['nets']} <span class="th">เครือข่าย</span> <span class="en i">networks</span> · {c(x['requests'])} <span class="en i">requests</span><br>{chips}</div></div>""")
    cos = []
    for x in m["costumes"][:12]:
        f = " ".join(f'<span class="tag bad">{e(FAIL[k][1])}</span>' for k in x["fails"])
        cos.append(f"<tr><td>{glyph(x['hash'], 30)}</td><td>{bot_link(x['caller'], pages)}<span class=\"def\">{e(x['network'])}</span></td>"
                   f"<td>{e(x['proto'])}<span class=\"def\">{c(x['hello'])} B</span></td><td>{f}</td><td class=\"n\">{c(x['requests'])}</td></tr>")
    return f"""<section id="masks" class="more layer" aria-labelledby="msk">
<h2 id="msk" class="th">หน้ากาก <span class="rom">na kak</span><span class="en">Masks</span></h2>
<p class="lead th">โปรแกรมที่เปิดการเชื่อมต่อแบบปลอดภัย (TLS) จะบอกรายการรหัสลับที่มันพูดได้ เรียงตามแบบของมันเอง เราเก็บลายนิ้วมือของรายการนั้นไว้ (SHA-1) ชื่อที่บอทบอกเรา มันเลือกเองได้ แต่รายการนี้ติดมากับซอฟต์แวร์
<span class="en">A program opening a secure connection (TLS) lists the ciphers it can speak, in its own order. We save a fingerprint of that list (SHA-1). A bot picks the name it gives us; the list comes with its software.</span></p>
<dl class="tally wide"><div><dt class="th">ชื่อเบราว์เซอร์ <span class="en">under browser names</span></dt><dd>{c(t['browser'])}</dd></div>
<div><dt class="th">ผ่านทั้งสามข้อ <span class="en">pass all three</span></dt><dd>{pct('pass')}</dd></div>
<div><dt class="th">HTTP/1.1 <span class="en">the way scripts talk</span></dt><dd>{pct('proto')}</dd></div>
<div><dt class="th">hello ต่ำกว่า 1,000 ไบต์ <span class="en">hello under 1,000 bytes</span></dt><dd>{pct('hello')}</dd></div>
<div><dt class="th">ลำดับเดิม ข้าม 3+ เครือข่าย <span class="en">one order across 3+ networks</span></dt><dd>{pct('order')}</dd></div></dl>
<p class="note th">เบราว์เซอร์คุยกับ Cloudflare ด้วย HTTP/2 หรือ HTTP/3 · Chrome, Safari, Firefox และ Edge รุ่นปัจจุบันใส่กุญแจแบบทนคอมพิวเตอร์ควอนตัม (ML-KEM) ลงใน hello ทำให้ยาว 1,200–2,000 ไบต์ · Chrome สลับลำดับส่วนขยาย TLS ทุกการเชื่อมต่อ ชื่อ Chrome ที่ส่งลำดับเดียว 200 ครั้งขึ้นไป จากสามเครือข่ายขึ้นไป คือโปรแกรม
<span class="en">Browsers speak HTTP/2 or HTTP/3 to Cloudflare. Current Chrome, Safari, Firefox and Edge put a post-quantum key (ML-KEM) in their hello, making it 1,200–2,000 bytes. Chrome shuffles its TLS extensions on every connection: one order, 200+ times, from 3+ networks, under Chrome's name, is a program.</span></p>
<h3 class="th">ลายนิ้วมือเดียว หลายชื่อ <span class="en">One handshake, many names</span></h3>
{''.join(many) or '<p class="th">ยังไม่มี <span class="en i">none yet</span></p>'}
<h3 class="th">ชุดแต่งตัว <span class="en">Costumes</span></h3>
<div class="scroll"><table><tr><th></th><th>NAME · NETWORK</th><th>WIRE</th><th>FAILS</th><th class="r">REQUESTS</th></tr>{''.join(cos)}</table></div>
<p class="note th">คนนับรวมเท่านั้น: วันนี้ {c(t['people'])} คำขอจากเบราว์เซอร์ที่ตัวจำแนกนับเป็นคน {c(t['people_fail'])} ในนั้นสอบตกอย่างน้อยหนึ่งข้อ
<span class="en">People only in totals: {c(t['people'])} requests from browsers the classifier counts as people; {c(t['people_fail'])} of them failed at least one test.</span></p>
</section>"""


def sec_light(li: dict, geo: dict, pages: set) -> str:
    near = sorted((v for v in li["callers"].values() if v["n"] >= 200 and v["best"]), key=lambda v: (v["best"]["mn"], -v["n"]))
    near = sorted(near, key=lambda v: -v["n"])[:10]
    rows = "".join(
        f"<tr><td>{bot_link(v['caller'], pages)}<span class=\"def\">{e(max(v['nets'], key=v['nets'].get))}</span></td>"
        f"<td>{e(v['best']['city'])} <span class=\"def\">{e(v['best']['colo'])}</span></td>"
        f"<td class=\"n\">{v['best']['mn']:g} ms</td><td class=\"n\">{c(v['best']['km'])} km</td></tr>" for v in near)
    no = "".join(
        f"<tr><td>{bot_link(s['caller'], pages)}<span class=\"def\">{e(s['network'])}</span></td><td>{e(vk.land(s['country'])[0])}</td>"
        f"<td>{e(s['city'])} · {s['rtt']:g} ms<span class=\"def\">≤ {c(s['km'])} km</span></td><td class=\"n\">{c(s['gap'])} km</td></tr>"
        for s in li["says_no"][:10])
    cl = json.dumps({c_["colo"]: {"city": c_["city"], "bots": c_["bots"], "people": c_["people"], "at": [c_["lat"], c_["lon"]],
                                  "callers": [[v["caller"], v["n"], v["mn"], v["km"]] for v in c_["callers"][:6]]}
                     for c_ in li["colos"][:120]}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return f"""<section id="light" class="more layer" aria-labelledby="lgt">
<h2 id="lgt" class="th">ทดสอบด้วยแสง <span class="rom">thot sop duai saeng</span><span class="en">Light test</span></h2>
<p class="lead th">แสงในใยแก้ววิ่งได้ราว 200 กิโลเมตรต่อมิลลิวินาที ถ้าไปกลับใช้ r มิลลิวินาที ผู้เรียกต้องอยู่ห่างศูนย์ข้อมูล Cloudflare ที่ตอบไม่เกิน (r + 1) × 100 กิโลเมตร ชื่อเป็นอะไรก็ได้ แต่การไปกลับเร็วกว่าแสงไม่ได้ แตะเมืองบนแผนที่ แสงจะกระจายออกไปถึงบอทแต่ละตัว
<span class="en">Light in glass fibre covers about 200 km a millisecond. A round trip of r ms puts the caller within (r + 1) × 100 km of the Cloudflare data centre that answered. A name can be anything; a round trip can't beat light. Tap a city: the light spreads to each bot there.</span></p>
<p class="note th">แถวที่มาทาง HTTP/3 ไม่นับ: Cloudflare ไม่ให้เวลาไปกลับของ TCP ในทางนั้น
<span class="en">Rows over HTTP/3 are left out: Cloudflare gives no TCP round trip there.</span></p>
<div class="mapw">{map_svg(geo, li)}<div class="mapnote" id="vkmap-note" aria-live="polite"></div></div>
<div class="legend"><span><i style="background:#ff4fa8"></i>ส่วนมากบอท <em>mostly bots</em></span><span><i style="background:#5fd8ff"></i>ส่วนมากคน <em>mostly people</em></span><span><i style="background:none;border:2px solid #ffd23f"></i>แสงไปถึง <em>as far as light allows</em></span><span><i style="background:#ff5a4a"></i>แสงบอกว่าไม่ใช่ <em>light says no</em></span></div>
<h3 class="th">ใกล้แค่ไหน <span class="en">How close</span></h3>
<div class="scroll"><table><tr><th>BOT · NETWORK</th><th>ANSWERED IN</th><th class="r">ROUND TRIP</th><th class="r">WITHIN</th></tr>{rows}</table></div>
<h3 class="th">แสงบอกว่าไม่ใช่ <span class="en">Light says no</span></h3>
<p class="note th">Cloudflare บอกประเทศของที่อยู่นั้นไว้ แต่การไปกลับสั้นเกินกว่าจะมาจากประเทศนั้น
<span class="en">Cloudflare lists a country for the address, but the round trip was too short to come from there.</span></p>
<div class="scroll"><table><tr><th>BOT · NETWORK</th><th>CLOUDFLARE SAYS</th><th>LIGHT SAYS</th><th class="r">GAP</th></tr>{no or '<tr><td colspan="4">–</td></tr>'}</table></div>
<script type="application/json" id="vkmap-data">{cl}</script>
</section>"""


def sec_ask(index: dict | None) -> str:
    days = (index or {}).get("days") or []
    last = days[-1]["day"] if days else ""
    rows = sum(x["rows"] for x in days)
    return f"""<section id="ask" class="more layer" aria-labelledby="asq">
<h2 id="asq" class="th">ถามบันทึก <span class="rom">tham ban thuek</span><span class="en">Ask the log</span></h2>
<p class="lead th">ทุกคำขอของบอทตั้งแต่ 8 กันยายน {c(rows)} แถว วันละไฟล์ เขียน SQL ถามเองได้ในเบราว์เซอร์นี้ (DuckDB) ไม่มีอะไรส่งกลับมาที่เรา คำถามทุกข้อเป็นลิงก์ที่แชร์ได้
<span class="en">Every bot request since 8 Sept, {c(rows)} rows, one file a day. Write SQL and ask it yourself, in this browser (DuckDB). Every question becomes a link you can share.</span></p>
<div class="ask" data-last="{e(last)}">
 <div class="askq" role="group" aria-label="questions to start from"></div>
 <label class="th" for="ask-days">วัน <span class="en i">days</span></label>
 <select id="ask-days"><option value="1">ล่าสุด · last day</option><option value="7">7 วัน · 7 days</option><option value="30">30 วัน · 30 days</option><option value="all">ทั้งหมด · all</option></select>
 <textarea id="ask-sql" rows="6" spellcheck="false" aria-label="SQL">SELECT caller, kind, SUM(weight*counted) AS requests
FROM bots GROUP BY caller, kind ORDER BY requests DESC LIMIT 20</textarea>
 <p><button class="pill" id="ask-run" type="button">ถาม · Ask</button> <button class="pill alt" id="ask-link" type="button">ลิงก์ · Copy link</button> <button class="pill alt" id="ask-csv" type="button" hidden>CSV</button></p>
 <p class="src" id="ask-state">DuckDB ราว 7 MB โหลดครั้งแรกที่กด · about 7 MB, loaded on the first Ask</p>
 <div class="scroll" id="ask-out"></div>
</div>
<p class="th">ไฟล์ <span class="en i">files</span>: <a href="/voight-kampff/data/">motdang.net/voight-kampff/data/</a> · Parquet, CSV · CC BY 4.0</p>
</section>"""


def block(pl, m, li, geo, index, pages, when) -> str:
    return (f"<!-- vk:layers -->\n<div class=\"stitch\" aria-hidden=\"true\"></div>\n"
            f"<link rel=\"stylesheet\" href=\"/voight-kampff/layers.css?v={asset_v('layers.css')}\">\n"
            f"<p class=\"issue th\" id=\"layers-at\">{e(when['th'])}<span class=\"en\">{e(when['en'])}</span></p>\n"
            + sec_pulse(pl, pages) + '\n<div class="stitch" aria-hidden="true"></div>\n'
            + sec_masks(m, pages) + '\n<div class="stitch" aria-hidden="true"></div>\n'
            + sec_light(li, geo, pages) + '\n<div class="stitch" aria-hidden="true"></div>\n'
            + sec_ask(index)
            + f"\n<script src=\"/voight-kampff/layers.js?v={asset_v('layers.js')}\" defer></script>"
            + f"\n<script type=\"module\" src=\"/voight-kampff/ask.js?v={asset_v('ask.js')}\"></script>"
            + "\n<!-- /vk:layers -->")


def asset_v(name: str) -> str:
    p = VK / name
    return hashlib.md5(p.read_bytes()).hexdigest()[:10] if p.exists() else "0"


def splice(blk: str) -> None:
    p = VK / "index.html"
    s = p.read_text(encoding="utf-8")
    if "<!-- vk:layers -->" in s:
        s = re.sub(r"<!-- vk:layers -->.*?<!-- /vk:layers -->", lambda _: blk, s, flags=re.S)
    else:
        assert "<!-- /vk:floods -->" in s, "vk:floods marker missing"
        s = s.replace("<!-- /vk:floods -->", "<!-- /vk:floods -->\n\n" + blk, 1)
    if 'src="/voight-kampff/share.js' not in s:
        s = s.replace("</html>", f'<script src="/voight-kampff/share.js?v={asset_v("share.js")}" defer></script>\n</html>', 1)
    else:
        s = re.sub(r'/voight-kampff/share\.js\?v=\w+', f'/voight-kampff/share.js?v={asset_v("share.js")}', s)
    p.write_text(s, encoding="utf-8")


# ── a page for each bot ───────────────────────────────────────────────────────

def bot_pages(top: list[dict], pl: list[dict], m: dict, li: dict, geo: dict, fs: dict, week: dict,
              cards: bool, when: dict) -> set:
    pmap = {p["caller"]: p for p in pl}
    names = [t["a"] for t in top]
    BOTS.mkdir(parents=True, exist_ok=True)
    made = set()
    lineup = []
    for t in top:
        name, kind = t["a"], t["k"]
        s = slug(name)
        if s in made:
            continue
        made.add(s)
        p = pmap.get(name)
        lc = li["callers"].get((name, kind))
        mine = [x for x in m["costumes"] if x["caller"] == name]
        hashes = sorted({h for x in m["many"] for h, _ in [(x["hash"], 0)] if name in dict(x["names"])})
        inc = fs.get(name, "")
        age = (dt.datetime.now(ICT).date() - dt.date.fromisoformat(inc)).days if inc else None
        wk = week.get(name, {})
        oen, oth = owner_en(name), owner_th(name)
        facts = [("CALLER", f"<b>{e(name)}</b>" + (f"<br>{e(oen)}" if oen else "")),
                 ("KIND", '<span class="th">{}</span> <span class="en" style="display:inline">{}</span>'.format(
                     *map(e, vk.R.KIND.get(kind, (kind, kind))))),
                 ("INCEPT", (f'<span class="big">{e(inc)}</span><br><span class="th">เห็นครั้งแรกที่ motdang.net</span> '
                             f'<span class="en" style="display:inline">first seen at motdang.net · {age} days ago</span>') if inc else "–"),
                 ("APPETITE", f'<span class="big">{c(t["n"])}</span> <span class="en" style="display:inline">requests, {e(when["en"])}</span>'
                  + (f'<br>{c(wk["n"])} <span class="en" style="display:inline">in the last 7 days</span>' if wk.get("n") else ""))]
        if p:
            bth, ben = beat_words(p)
            fth, fen = fano_words(p["fano"])
            facts.append(("PULSE", f'<b class="bpm">{p["per_min"]:g}</b> <span class="en" style="display:inline">a minute · {e(ben)} · Fano {p["fano"]:g}, {e(fen)}</span>'
                          f'<svg class="ecg" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true"><path class="tr" d="{p["trace_path"]}"/><path class="ec" d="{p["echo_path"]}"/></svg>'))
        if lc and lc["best"]:
            b = lc["best"]
            nets = ", ".join(f"{e(k)}" for k, _ in sorted(lc["nets"].items(), key=lambda kv: -kv[1])[:3])
            facts.append(("LIGHT", f'<span class="th">ไม่เกิน</span> <b>{c(b["km"])} km</b> <span class="en" style="display:inline">from {e(b["city"])} ({e(b["colo"])}), round trip {b["mn"]:g} ms</span><br><span class="def">{nets}</span>'))
        if mine:
            facts.append(("MASK", "<br>".join(f'{glyph(x["hash"], 26)} {e(x["proto"])}, hello {c(x["hello"])} B · '
                                               + " ".join(f'<span class="tag bad">{e(FAIL[k][1])}</span>' for k in x["fails"])
                                               for x in mine[:3])))
        if wk.get("pages"):
            facts.append(("READS", " · ".join(f'<code>{e(pg)}</code> {c(n)}' for pg, n in wk["pages"][:5])))
        if wk.get("status"):
            facts.append(("ANSWERS", " · ".join(f'{e(st)} {c(n)}' for st, n in wk["status"][:5])))
        sqlq = (f"SELECT path, status, SUM(weight*counted) AS requests FROM bots WHERE caller = '{name.replace(chr(39), chr(39) * 2)}' "
                "GROUP BY path, status ORDER BY requests DESC LIMIT 50")
        ask = "/voight-kampff/?d=7#ask=" + b64(sqlq)
        mp = ""
        if lc and lc["colos"]:
            focus = set(lc["colos"])
            sub = {"colos": [{**c_, "callers": [v for v in c_["callers"] if v["caller"] == name] or c_["callers"][:1]}
                             for c_ in li["colos"] if c_["colo"] in focus], "says_no": [x for x in li["says_no"] if x["caller"] == name]}
            mp = f'<div class="mapw">{map_svg(geo, sub, focus, mid="vkmap")}<div class="mapnote" id="vkmap-note" aria-live="polite"></div></div>'
            cl = json.dumps({c_["colo"]: {"city": c_["city"], "bots": c_["bots"], "people": 0, "at": [c_["lat"], c_["lon"]],
                                          "callers": [[v["caller"], v["n"], v["mn"], v["km"]] for v in c_["callers"][:6]]}
                             for c_ in sub["colos"]}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
            mp += f'<script type="application/json" id="vkmap-data">{cl}</script>'
        dl = "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in facts)
        desc = f"{name} on motdang.net: {c(t['n'])} requests, {when['en']}."
        if p:
            desc += f" Pulse {p['per_min']:g} a minute, {beat_words(p)[1]}."
        if lc and lc["best"]:
            desc += f" Within {c(lc['best']['km'])} km of {lc['best']['city']}."
        page = f"""<!doctype html>
<html lang="th">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(name)} · Voight-Kampff · มดแดง</title>
<meta name="description" content="{e(desc)}">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#1a1147">
<link rel="canonical" href="https://motdang.net/voight-kampff/bot/{s}/">
<link rel="icon" href="/ant.svg">
<meta property="og:title" content="{e(name)} · Voight-Kampff">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="https://motdang.net/voight-kampff/bot/{s}/">
<meta property="og:image" content="https://motdang.net/voight-kampff/bot/{s}/card.png?v={when['day']}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{e(name)}'s Voight-Kampff file: its robot face, its pulse and how far light lets it be.">
<meta property="og:type" content="profile">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/voight-kampff/vk.css">
<link rel="stylesheet" href="/voight-kampff/layers.css?v={asset_v('layers.css')}">
<div class="rain" aria-hidden="true"></div>
<header>
 <div class="face big-face" tabindex="0" role="button" aria-label="{e(name)}">{vk.portrait(name, 140)}</div>
 <h1 class="bot-h">{e(name)}</h1>
 <p class="th">แฟ้มทดสอบ Voight-Kampff <span class="en">Voight-Kampff file</span></p>
</header>
<main>
<div class="stitch" aria-hidden="true"></div>
<section class="card" id="file"><dl class="id">{dl}</dl></section>
{mp}
<p><a class="pill th" href="{e(ask)}">ถามบันทึกเรื่องมัน · Ask the log about it</a>
<a class="pill alt th" href="/voight-kampff/bot/">บอทตัวอื่น · Other bots</a>
<a class="pill alt th" href="/voight-kampff/">Voight-Kampff</a></p>
<p class="src">{e(when['en'])}. Source: the motdang.net and hongdam.net request log; files at <a href="/voight-kampff/data/">/voight-kampff/data/</a>, CC BY 4.0.</p>
</main>
<script src="/voight-kampff/layers.js?v={asset_v('layers.js')}" defer></script>
<script src="/voight-kampff/share.js?v={asset_v('share.js')}" defer></script>
</html>
"""
        d = BOTS / s
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page, encoding="utf-8")
        lineup.append((name, s, t["n"], p, lc))
        if cards:
            bot_card(name, kind, t["n"], p, lc, inc, d / "card.png", when.get("span", "in a day"))
    lineup_page(lineup, when, cards)
    return made


def b64(s: str) -> str:
    import base64
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")


def lineup_page(lineup, when, cards) -> None:
    tiles = "".join(f'<a class="lu" href="/voight-kampff/bot/{s}/">{vk.portrait(n, 84)}<b>{e(n)}</b>'
                    f'<small>{c(req)}</small></a>' for n, s, req, _, _ in lineup)
    page = f"""<!doctype html>
<html lang="th">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>The line-up · Voight-Kampff · มดแดง</title>
<meta name="description" content="Every big bot that visited motdang.net, each with its own Voight-Kampff file: pulse, masks, light test.">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#1a1147">
<link rel="canonical" href="https://motdang.net/voight-kampff/bot/">
<link rel="icon" href="/ant.svg">
<meta property="og:title" content="The line-up · Voight-Kampff">
<meta property="og:description" content="{len(lineup)} bots that read motdang.net, each with its own file: pulse, masks, light test.">
<meta property="og:url" content="https://motdang.net/voight-kampff/bot/">
<meta property="og:image" content="https://motdang.net/voight-kampff/bot/card.png?v={when['day']}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="A line-up of small robot faces, one for each bot that read motdang.net.">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/voight-kampff/vk.css">
<link rel="stylesheet" href="/voight-kampff/layers.css?v={asset_v('layers.css')}">
<div class="rain" aria-hidden="true"></div>
<header><img src="/ant.svg" alt=""><h1>LINE-UP</h1>
<p class="th">บอทที่มาอ่าน motdang.net <span class="en">The bots that read motdang.net · {e(when['en'])}</span></p></header>
<main><div class="stitch" aria-hidden="true"></div>
<div class="lineup">{tiles}</div>
<p style="text-align:center"><a class="pill th" href="/voight-kampff/">Voight-Kampff</a> <a class="pill alt th" href="/voight-kampff/data/">ข้อมูล · Data</a></p>
</main>
<script src="/voight-kampff/layers.js?v={asset_v('layers.js')}" defer></script>
<script src="/voight-kampff/share.js?v={asset_v('share.js')}" defer></script>
</html>
"""
    (BOTS / "index.html").write_text(page, encoding="utf-8")
    if cards:
        faces = "".join(vk.portrait(n, 120) for n, *_ in lineup[:21])
        shoot(f"""<div class="c"><div class="rain"></div><div class="stitch" style="top:0"></div>
<h1 style="position:absolute;left:60px;top:44px">LINE-UP</h1>
<p class="k" style="position:absolute;left:60px;top:112px;margin:0">บอทที่มาอ่าน motdang.net<small>{len(lineup)} bots, each with its own Voight-Kampff file</small></p>
<div style="position:absolute;left:50px;top:230px;width:1100px;display:flex;flex-wrap:wrap;gap:14px 26px">{faces}</div>
<div class="url">motdang.net/voight-kampff/bot</div><div class="stitch" style="bottom:0"></div></div>""", BOTS / "card.png")


CARD_CSS = None


def shoot(inner: str, out: Path) -> None:
    fonts = (ROOT / "assets" / "fonts").as_uri()
    body = f"""<!doctype html><meta charset="utf-8"><style>
@font-face{{font-family:JBM;src:url("{fonts}/jetbrains-mono-400-latin.woff2")}}
@font-face{{font-family:Prompt;font-weight:600;src:url("{fonts}/prompt-600-thai.woff2");unicode-range:U+0E00-0E7F}}
@font-face{{font-family:Prompt;font-weight:600;src:url("{fonts}/prompt-600-latin.woff2")}}
@font-face{{font-family:Prompt;font-weight:400;src:url("{fonts}/prompt-400-thai.woff2");unicode-range:U+0E00-0E7F}}
@font-face{{font-family:Prompt;font-weight:400;src:url("{fonts}/prompt-400-latin.woff2")}}
html,body{{margin:0;width:1200px;height:630px;overflow:hidden;background:#1a1147;color:#fff8ec;font-family:Prompt}}
.c{{position:relative;width:1200px;height:630px;background:radial-gradient(ellipse 70% 90% at 25% 50%,#2a1a6e,#1a1147 60%,#0d0826)}}
.rain{{position:absolute;inset:0;opacity:.13;background-image:repeating-linear-gradient(100deg,transparent 0 22px,#5fd8ff 22px 23px,transparent 23px 60px);background-size:120px 240px}}
.stitch{{position:absolute;left:0;right:0;height:14px;background:linear-gradient(135deg,#ff4fa8 25%,transparent 25%) -7px 0/14px 14px,linear-gradient(225deg,#ffd23f 25%,transparent 25%) -7px 0/14px 14px,linear-gradient(315deg,#3fffb0 25%,transparent 25%) 0 0/14px 14px,linear-gradient(45deg,#5fd8ff 25%,transparent 25%) 0 0/14px 14px}}
h1{{font-family:JBM;font-size:56px;color:#ff4fa8;margin:0;letter-spacing:.03em;text-shadow:0 0 20px #ff4fa8;line-height:1.05;overflow-wrap:anywhere}}
.k{{font-weight:600;font-size:34px;margin:6px 0 0}} .k small{{display:block;font-weight:400;font-size:24px;color:#c9c0f0}}
.row{{font-size:28px;margin:18px 0 0;line-height:1.25}} .row b{{font-family:JBM;color:#ffd23f;font-size:44px;font-weight:400}}
.row small{{display:block;font-size:22px;color:#c9c0f0}}
svg.ecg{{width:620px;height:70px;display:block;margin-top:6px}} svg.ecg path{{fill:none;stroke:#3fffb0;stroke-width:2.5}}
.url{{position:absolute;right:40px;bottom:34px;font-family:JBM;font-size:24px;color:#5fd8ff}}
</style>{inner}"""
    import shutil
    import tempfile
    out = out.resolve()
    tmp = out.with_name("_card.html")
    tmp.write_text(body, encoding="utf-8")
    prof = tempfile.mkdtemp(prefix="vk-card-")  # its own profile: two Chromes on one profile hang
    try:
        subprocess.run([vk.CHROME, "--headless=new", "--hide-scrollbars", "--force-device-scale-factor=1",
                        f"--user-data-dir={prof}", "--window-size=1200,630", "--default-background-color=1a1147ff",
                        f"--screenshot={out}", tmp.as_uri()], check=True, capture_output=True, timeout=90)
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as ex:
        print(f"card {out.parent.name}: {type(ex).__name__}, last card stays", file=sys.stderr)
    finally:
        tmp.unlink(missing_ok=True)
        shutil.rmtree(prof, ignore_errors=True)


def bot_card(name, kind, n, p, lc, inc, out: Path, span: str = "in a day") -> None:
    oen = owner_en(name)
    rows = [f'<p class="row"><b>{c(n)}</b> requests {e(span)}<small>{("first seen " + inc) if inc else ""}</small></p>']
    if p:
        rows.append(f'<p class="row"><b>{p["per_min"]:g}</b>/min · {e(beat_words(p)[1])}'
                    f'<svg class="ecg" viewBox="0 0 300 60" preserveAspectRatio="none"><path d="{p["trace_path"]}"/></svg></p>')
    if lc and lc["best"]:
        rows.append(f'<p class="row">within <b>{c(lc["best"]["km"])} km</b><small>of {e(lc["best"]["city"])}, by the speed of light</small></p>')
    big = 64 if len(name) <= 14 else 46 if len(name) <= 24 else 34
    shoot(f"""<div class="c"><div class="rain"></div><div class="stitch" style="top:0"></div>
<div style="position:absolute;left:50px;top:150px">{vk.portrait(name, 300)}</div>
<div style="position:absolute;left:420px;top:52px;width:740px">
<p style="font-family:JBM;color:#3fffb0;font-size:22px;margin:0">VOIGHT-KAMPFF FILE</p>
<h1 style="font-size:{big}px">{e(name)}</h1>
<p class="k" style="font-size:26px;font-weight:400;color:#c9c0f0">{e(oen)}</p>{''.join(rows)}</div>
<div class="url">motdang.net/voight-kampff/bot/{slug(name)}</div><div class="stitch" style="bottom:0"></div></div>""", out)


# ── the week, for the bot pages ───────────────────────────────────────────────

def week_of(names: list[str], b: dt.datetime) -> dict:
    a = b - dt.timedelta(days=7)
    inl = "(" + ",".join(f"'{esc_sql(x)}'" for x in names) + ")"
    out = {}
    for r in q(f"SELECT blob3 a, {W} n FROM traffic_eye WHERE {win_sql(a, b)} AND blob3 IN {inl} AND double1 >= 1 GROUP BY a"):
        out.setdefault(r["a"], {})["n"] = int(float(r["n"]))
    for r in q(f"SELECT blob3 a, blob4 p, {W} n FROM traffic_eye WHERE {win_sql(a, b)} AND blob3 IN {inl} AND double1 >= 1 "
               "GROUP BY a, p ORDER BY n DESC LIMIT 20000"):
        out.setdefault(r["a"], {}).setdefault("pages", [])
        if len(out[r["a"]]["pages"]) < 5:
            out[r["a"]]["pages"].append((r["p"], int(float(r["n"]))))
    for r in q(f"SELECT blob3 a, blob6 s, {W} n FROM traffic_eye WHERE {win_sql(a, b)} AND blob3 IN {inl} AND double1 >= 1 "
               "GROUP BY a, s ORDER BY n DESC LIMIT 5000"):
        out.setdefault(r["a"], {}).setdefault("status", []).append((r["s"], int(float(r["n"]))))
    return out


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    args = sys.argv[1:]
    if "--geo" in args:
        build_geo(Path(args[args.index("--geo") + 1]))
        return
    geo = json.loads(GEO.read_text())
    now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None, microsecond=0)
    if "--hours" in args:
        h = int(args[args.index("--hours") + 1])
        b = now.replace(second=0) - dt.timedelta(minutes=5)
        a = b - dt.timedelta(hours=h)
        when = {"day": b.strftime("%Y-%m-%d"), "span": f"in {h} hours",
                "en": f"the {h} hours to {(b + dt.timedelta(hours=7)).strftime('%-d %b %Y %H:%M')} Chiang Mai time",
                "th": f"{h} ชั่วโมงถึง {(b + dt.timedelta(hours=7)).strftime('%d/%m/%Y %H:%M')} น."}
    else:
        day = dt.datetime.now(ICT).date() - dt.timedelta(days=1)
        a = dt.datetime(day.year, day.month, day.day) - dt.timedelta(hours=7)
        b = a + dt.timedelta(days=1)
        when = {"day": day.isoformat(), "en": f"{day.day} {vk.R.MON_EN[day.month - 1]} {day.year}, Chiang Mai time",
                "th": f"{day.day} {vk.R.MON_TH[day.month - 1]} {day.year}"}
    top = [{"a": r["a"], "k": r["k"], "n": int(float(r["n"]))} for r in q(
        f"SELECT blob3 a, blob2 k, {W} n FROM traffic_eye WHERE {win_sql(a, b)} AND blob2 NOT IN ('human', 'ours') "
        "AND double1 >= 1 GROUP BY a, k ORDER BY n DESC LIMIT 40")]
    pl = pulse(a, b, top[:12])
    m = masks(a, b)
    li = light(a, b, geo)
    fs = first_seen()
    week = week_of([t["a"] for t in top[:30]], b)
    index = None
    try:
        import vk_export
        index = vk_export.get_json("index.json")
    except Exception as ex:  # noqa: BLE001
        print("index:", ex, file=sys.stderr)
    pages = bot_pages(top[:30], pl, m, li, geo, fs, week, "--no-cards" not in args, when)
    splice(block(pl, m, li, geo, index, pages, when))
    HIST.mkdir(parents=True, exist_ok=True)
    keep = {"when": when, "from": a.isoformat() + "Z", "to": b.isoformat() + "Z", "pulse": pl,
            "masks": {**m, "tot": m["tot"]},
            "light": {"colos": li["colos"][:60], "says_no": li["says_no"]}, "top": top}
    (HIST / f"{when['day']}.json").write_text(json.dumps(keep, ensure_ascii=False, indent=0, default=list))
    (VK / "layers.json").write_text(json.dumps(keep, ensure_ascii=False, separators=(",", ":"), default=list))
    for p in pl[:6]:
        print(f"· pulse {p['caller']}: {p['per_min']}/min, period {p['period_s']} s ({p['strength']}), Fano {p['fano']}")
    print(f"· masks: {m['hashes']} fingerprints, {len(m['many'])} worn by 3+ names, {len(m['costumes'])} costumes")
    print(f"· light: {len(li['colos'])} data centres, {len(li['says_no'])} light-says-no")
    print(f"· bot pages: {len(pages)}")
    if "--no-deploy" not in args:
        vk.publish()


if __name__ == "__main__":
    main()
