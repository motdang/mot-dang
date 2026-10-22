#!/usr/bin/env python3
"""ทิศทาง — bearings: where a place stands in relation to the things people
steer by. WO-64. Nan, 2026-09-06:

    "My house is 5 km due east of Tha Phae gate. Chiang Mai Plastics is right
    across the street from Wararot Market. Things are inside (and in a
    quadrant of) the old city, near a gate, outside the old city (in a
    direction), close to the airport ... until we run out of places. This
    should not be ABOVE the most important information of a listing, but it
    should be available. Orientation in comparison to other objects is this
    site's actual secret sauce. That and romanization."

WHAT A BEARING IS. A short structured line, never a paragraph (Nan 2026-09-06:
no blurbs), of the form a resident says out loud: which side of the water,
which quarter, which gate, what it is at or across from, how far and which way
from the one point everybody in town measures from. Each line carries its
Thai, its English and the RTGS reading of the landmark it names — the reading
is the second half of the secret sauce.

WHERE THE FACTS COME FROM. Three inputs and nothing else:
  1. the record's own pin (lat/lng, geoPrecision, attrs.pinUncertaintyM);
  2. data/curated/landmarks.json — a register of RECORDS (by id, or by an
     element in cache/osm-worship/ for the temples not yet folded in); the
     coordinate is read from the record at build time, never typed here;
  3. the record's address string, parsed for "ตรงข้าม / ข้าง / หลัง / ใกล้ /
     ชั้น 3 <landmark>" — and a parse is PUBLISHED ONLY WHEN THE PIN AGREES.
     Nan named the risk herself: "a bad parse attaches a business to a temple
     it isn't at". So an address relation with an exact pin more than 1.5×
     the landmark's reach away is a contradiction: it goes to the audit, not
     the page. A record with no pin at all may carry its address relation
     alone, marked `from: address`, because then it is the only thing we know.

THE PIN GATE. A pin looser than LOOSE_PIN_M (400 m — the same line the
assistant's withDistance() draws) never yields a metre distance. It still gets
the coarse truths — which side of the moat, which direction from the gate in
whole kilometres, which zone — each marked approximate. A ±806 m pin does not
get to say "230 m from Wat Sri Suphan".

WHAT IS NOT HERE, AND WHY (forks for Nan, in notes/bearings-2026-09-06.txt):
the flight path (needs the runway line — one Overpass fetch of aeroway=runway;
network fetches are confirmed with Nan first), east/west of the Ping (needs
the river line, same), a bearing chip on listing rows and in the search index.

Entry points:
    ctx()                         the loaded register + moat + zones (cached)
    bearings(r, c=None)           -> list of line dicts (see LINE FIELDS)
    row_html(r, bi, esc, href=None, c=None)  -> one <dt>/<dd> row or ""
    parse_address(address, c, prov) -> (relation, landmark) or None
    emit(g, data)                 -> /landmarks.html + docs/data/landmarks.json

LINE FIELDS: kind (moat|at|near|address|city|airport|zone), th, en, roman,
landmark (register key or None), m (metres, int or None), dir (8-point EN or
None), due (bool), from ('pin'|'address'), approx (bool).
"""
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LANDMARKS_PATH = ROOT / "data" / "curated" / "landmarks.json"
ZONES_PATH = ROOT / "data" / "curated" / "zones.json"
WORSHIP_DIR = ROOT / "cache" / "osm-worship"
CANONICAL_DIR = ROOT / "data" / "canonical"

# Mirrors build.MOAT_CORNER_IDS — tests/test_bearings.py checks the two agree
# when build is importable. Duplicated rather than imported so the audit and
# the test can run in a second without loading the whole site.
MOAT_CORNER_IDS = {
    "nw": "cm-osm-way-317516852",   # แจ่งหัวลิน
    "ne": "cm-osm-way-263459882",   # แจ่งศรีภูมิ
    "se": "cm-osm-way-791602197",   # แจ่งก๊ะต๊ำ
    "sw": "cm-osm-way-317516851",   # แจ่งกู่เฮือง
}

RING_REACH_M = 2500      # "outside the moat, to the east" stops meaning much past this
CITY_MAX_KM = 200        # beyond this the zone circle is the whole truth
LOOSE_PIN_M = 400        # no metre distance from a pin looser than this
DUE_DEG = 7.5            # within this of a cardinal => "due east" (a 15° cone)
CENTRE_M = 110           # inside the moat and this close to the middle => "the centre"
CORROBORATE_SLACK = 1.5  # an address relation must sit within reach × this of its pin

DEFAULT_UNC = {"exact": 0, "block": 150, "approx": 1000}

DIRS_TH = ["เหนือ", "ตะวันออกเฉียงเหนือ", "ตะวันออก", "ตะวันออกเฉียงใต้",
           "ใต้", "ตะวันตกเฉียงใต้", "ตะวันตก", "ตะวันตกเฉียงเหนือ"]
DIRS_EN = ["north", "north-east", "east", "south-east",
           "south", "south-west", "west", "north-west"]
DIRS_RO = ["nuea", "tawan-ok chiang nuea", "tawan-ok", "tawan-ok chiang tai",
           "tai", "tawan-tok chiang tai", "tawan-tok", "tawan-tok chiang nuea"]
QUAD = {"NE": ("มุมตะวันออกเฉียงเหนือ", "north-east quarter"),
        "NW": ("มุมตะวันตกเฉียงเหนือ", "north-west quarter"),
        "SE": ("มุมตะวันออกเฉียงใต้", "south-east quarter"),
        "SW": ("มุมตะวันตกเฉียงใต้", "south-west quarter"),
        "C": ("กลางเวียง", "the centre")}

# Address relation words. Thai first (matched as the run of characters just
# before the landmark alias), then Latin (the word or two before it). Each
# maps to (key, th, en). Order matters within each list: longer first.
REL_TH = [
    ("ฝั่งตรงข้าม", "opposite", "ฝั่งตรงข้าม", "across the road from"),
    ("ตรงข้าม", "opposite", "ตรงข้าม", "opposite"),
    ("ติดกับ", "beside", "ติดกับ", "right beside"),
    ("ข้างๆ", "beside", "ข้าง", "beside"),
    ("ข้าง", "beside", "ข้าง", "beside"),
    ("ติด", "beside", "ติด", "right by"),
    ("ด้านหลัง", "behind", "หลัง", "behind"),
    ("หลัง", "behind", "หลัง", "behind"),
    ("ด้านหน้า", "front", "หน้า", "in front of"),
    ("หน้า", "front", "หน้า", "in front of"),
    ("ใกล้", "near", "ใกล้", "near"),
    ("ภายใน", "inside", "ใน", "inside"),
    ("บริเวณ", "at", "บริเวณ", "at"),
    ("ทางเข้า", "entrance", "ทางเข้า", "at the entrance of"),
    ("ใน", "inside", "ใน", "inside"),
]
REL_EN = [
    ("across the street from", "opposite", "ตรงข้าม", "across the street from"),
    ("across the road from", "opposite", "ตรงข้าม", "across the road from"),
    ("across from", "opposite", "ตรงข้าม", "across from"),
    ("opposite", "opposite", "ตรงข้าม", "opposite"),
    ("in front of", "front", "หน้า", "in front of"),
    ("next to", "beside", "ข้าง", "next to"),
    ("beside", "beside", "ข้าง", "beside"),
    ("behind", "behind", "หลัง", "behind"),
    ("inside", "inside", "ใน", "inside"),
    ("near", "near", "ใกล้", "near"),
    ("at", "at", "ที่", "at"),
    ("in", "inside", "ใน", "in"),
]
# A floor number is an "inside" with a detail: "ชั้น 3 เมญ่า" / "3rd floor, Maya".
FLOOR_TH = re.compile(r"ชั้น\s*([0-9GLMB]+|[๐-๙]+)")
FLOOR_EN = re.compile(r"\b(\d+)(?:st|nd|rd|th)?\s*(?:floor|fl\.?)\b|\bfloor\s*(\d+)\b|\b([GLMB])\s*floor\b", re.I)

# The alias is being used as a ROAD or an ADMIN AREA, not the landmark:
# "ถ.ท่าแพ" is Tha Phae Road, "ต.วัดเกต" is the subdistrict, "Airport Rd".
# The marker may sit a road-name away: "ถ.ดอยสะเก็ด-บ่อสร้าง" is the road to
# Bo Sang, and only Thai letters, spaces, digits and hyphens lie between the
# marker and the alias, with at most one space right after the marker: a
# second space means a new word ("ต.ช้างม่อย ใกล้ประตูท่าแพ" is near the gate).
ROAD_BEFORE = re.compile(r"(?:ถนน|ถ\.|ซอย|ซ\.|ตรอก|ตำบล|ต\.|อำเภอ|อ\.|แขวง|เขต|จังหวัด|จ\.) ?[ก-๙0-9\-–]*$")
ROAD_BEFORE_EN = re.compile(r"\b(?:soi|tambon|amphoe|t\.|a\.|chang wat|road|rd|lane|alley)\s*$", re.I)
ROAD_AFTER_EN = re.compile(r"^\s*(?:rd\b|road\b|soi\b|lane\b|alley\b|st\b|street\b|junction\b|intersection\b)", re.I)
ROAD_AFTER_TH = re.compile(r"^\s*(?:ซอย|ซ\.|แยก|สี่แยก)")
THAI = re.compile(r"[ก-๙]")


# ---------------------------------------------------------------- geometry --

def metres(a_lat, a_lng, b_lat, b_lng):
    """Great-circle metres (haversine); the same answer near.js gives."""
    R = 6371000.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = p2 - p1
    dl = math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def bearing_deg(a_lat, a_lng, b_lat, b_lng):
    """Initial bearing FROM a TO b, degrees clockwise from north, 0..360."""
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dl = math.radians(b_lng - a_lng)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def compass(deg):
    """-> (index 0..7, due: bool). Due when within DUE_DEG of a cardinal."""
    i = int(((deg + 22.5) % 360) // 45)
    cardinal = i % 2 == 0
    off = abs(((deg - i * 45) + 180) % 360 - 180)
    return i, bool(cardinal and off <= DUE_DEG)


def point_in_poly(lat, lng, poly):
    """Ray-casting; poly is [[lat,lng], ...]."""
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        yi, xi = poly[i]
        yj, xj = poly[j]
        if (xi > lng) != (xj > lng):
            if lat < (yj - yi) * (lng - xi) / ((xj - xi) or 1e-12) + yi:
                inside = not inside
        j = i
    return inside


def dist_to_segment_m(lat, lng, a, b, kx):
    """Metres from a point to the segment a-b, in a local flat frame."""
    px, py = (lng - a[1]) * 111320 * kx, (lat - a[0]) * 111320
    bx, by = (b[1] - a[1]) * 111320 * kx, (b[0] - a[0]) * 111320
    L2 = bx * bx + by * by
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, (px * bx + py * by) / L2))
    return math.hypot(px - t * bx, py - t * by)


def fmt_dist(m):
    """-> (th, en). Nearest 10 m under a kilometre, one decimal to 20 km."""
    if m < 1000:
        v = int(round(m / 10.0) * 10) or 10
        return f"{v} ม.", f"{v} m"
    km = m / 1000.0
    if km < 20:
        return f"{km:.1f} กม.", f"{km:.1f} km"
    return f"{int(round(km))} กม.", f"{int(round(km))} km"


# ------------------------------------------------------------------ loading --

def _norm_latin(s):
    return re.sub(r"[^a-z0-9ก-๙]+", " ", s.lower()).strip()


class Ctx:
    """Everything a bearing needs, resolved once."""

    def __init__(self, landmarks, moat_poly, zones, by_id):
        self.landmarks = landmarks          # {prov: [entries with lat/lng]}
        self.moat_poly = moat_poly          # [[lat,lng]×4] nw,ne,se,sw or None
        self.zones = zones                  # zones.json minus _ keys
        self.by_id = by_id                  # id -> record (for links)
        self.origin = {p: next((l for l in ls if l.get("origin")), None)
                       for p, ls in landmarks.items()}
        self.unresolved = []                # (prov, key, why)
        if moat_poly:
            self.moat_c = (sum(p[0] for p in moat_poly) / 4, sum(p[1] for p in moat_poly) / 4)
            self.kx = math.cos(math.radians(self.moat_c[0]))
        else:
            self.moat_c, self.kx = None, 1.0
        # alias index per province, longest alias first
        self.alias_idx = {}
        for p, ls in landmarks.items():
            rows = []
            for l in ls:
                for a in l.get("aliases", []):
                    rows.append((a, l))
            rows.sort(key=lambda t: -len(t[0]))
            self.alias_idx[p] = rows


def _worship_elements():
    out = {}
    if not WORSHIP_DIR.exists():
        return out
    for f in WORSHIP_DIR.glob("*.json"):
        try:
            d = json.loads(f.read_text())
        except Exception:
            continue
        for e in (d.get("elements", []) if isinstance(d, dict) else d):
            la = e.get("lat") or (e.get("center") or {}).get("lat")
            ln = e.get("lon") or (e.get("center") or {}).get("lon")
            if la is None or ln is None:
                continue
            out[f"{e['type']}/{e['id']}"] = (la, ln, (e.get("tags") or {}).get("name"))
    return out


def _load_canonical():
    by_id = {}
    for f in CANONICAL_DIR.glob("*.json"):
        try:
            for r in json.loads(f.read_text()):
                by_id[r["id"]] = r
        except Exception:
            continue
    return by_id


_CTX = None


def ctx(by_id=None, moat_poly=None, force=False):
    """The register resolved against the catalogue. Cached per process."""
    global _CTX
    if _CTX is not None and not force:
        return _CTX
    doc = json.loads(LANDMARKS_PATH.read_text()) if LANDMARKS_PATH.exists() else {}
    if by_id is None:
        by_id = _load_canonical()
    worship = None
    landmarks = {}
    unresolved = []
    for prov, entries in doc.items():
        if prov.startswith("_"):
            continue
        keep = []
        for e in entries:
            e = dict(e)
            la = ln = None
            if e.get("id"):
                r = by_id.get(e["id"])
                if not r:
                    unresolved.append((prov, e["key"], f"no record {e['id']}"))
                    continue
                if r.get("lat") is None or r.get("geoPrecision") not in ("exact", "block"):
                    unresolved.append((prov, e["key"], f"{e['id']} is {r.get('geoPrecision')}"))
                    continue
                la, ln = r["lat"], r["lng"]
                e["record"] = r
            elif e.get("osm"):
                if worship is None:
                    worship = _worship_elements()
                got = worship.get(e["osm"])
                if not got:
                    unresolved.append((prov, e["key"], f"{e['osm']} not in cache/osm-worship"))
                    continue
                la, ln, _ = got
                e["record"] = None
            else:
                unresolved.append((prov, e["key"], "neither id nor osm"))
                continue
            e["lat"], e["lng"] = la, ln
            e.setdefault("reach_m", 500)
            e.setdefault("at_m", 60)
            keep.append(e)
        landmarks[prov] = keep
    if moat_poly is None:
        pts = [by_id.get(MOAT_CORNER_IDS[k]) for k in ("nw", "ne", "se", "sw")]
        if all(p and p.get("lat") is not None for p in pts):
            moat_poly = [[p["lat"], p["lng"]] for p in pts]
    zones = {}
    if ZONES_PATH.exists():
        zones = {k: v for k, v in json.loads(ZONES_PATH.read_text()).items()
                 if not k.startswith("_")}
    c = Ctx(landmarks, moat_poly, zones, by_id)
    c.unresolved = unresolved
    _CTX = c
    return c


# ----------------------------------------------------------- address parse --

# Thai has no word gaps, so the run of Thai letters touching an alias is
# either a relation word ("ข้าง", "ตรงข้าม"), one of these harmless prefixes,
# or the sign that the alias is part of a LONGER name — โรงแรมวัดเกตโฮเทล is a
# hotel, not the temple; ตำบลวัดเกต is the subdistrict. Anything not listed
# rejects the match. Learned from the first run over the catalogue.
PREFIX_OK_TH = {"", "สาขา", "ริม", "แถว", "ฝั่ง", "ด้าน", "ที่", "ตรง", "ทาง", "ตลาด", "ใกล้ๆ", "แถวๆ", "บริเวณ", "ซอย"}
SUFFIX_OK_TH = {"", "ฯ"}
THAI_RUN_END = re.compile(r"[ก-๙]+$")
THAI_RUN_START = re.compile(r"^[ก-๙]+")
# An explicit relation outranks a bare mention, which outranks "near".
REL_RANK = {"opposite": 0, "beside": 0, "behind": 0, "front": 0, "inside": 0,
            "entrance": 0, "at": 1, "names": 2, "near": 3}


def _rel_before_th(before):
    """The LAST relation word in the Thai run that touches the alias, with
    only Thai letters, spaces or ฯ between it and the alias — "ตรงข้ามคณะเภสัชฯ
    ม.ช." is opposite CMU's pharmacy faculty, which is opposite CMU."""
    tail = before[-24:]
    best = None
    for word, key, th, en in REL_TH:
        i = tail.rfind(word)
        if i < 0:
            continue
        between = tail[i + len(word):]
        if re.fullmatch(r"[ก-๙ ฯ.]*", between) and (best is None or i > best[0]):
            best = (i, (key, th, en))
    return best[1] if best else None


def parse_address(address, c, prov):
    """-> {"rel": key, "rel_th", "rel_en", "landmark": entry, "floor": str|None,
    "alias": str} or None. Every alias present is found; an explicit relation
    ("ตรงข้าม", "next to") outranks a bare mention, which outranks "near", and
    the longest alias breaks ties. An alias used as a road or subdistrict
    name, or buried inside a longer name, is not a landmark."""
    if not address:
        return None
    rows = c.alias_idx.get(prov) or []
    text = address
    low = text.lower()
    found = []
    # Thai aliases first: an alias the Thai half of the address uses as a
    # subdistrict or road ("ตำบลวัดเกต Wat ket") disqualifies the landmark
    # for the Latin half too — the same word, the same sense.
    admin_rejected = set()
    thai_rows = [t for t in rows if THAI.search(t[0])]
    latin_rows = [t for t in rows if not THAI.search(t[0])]
    for alias, lm in thai_rows + latin_rows:
        if THAI.search(alias):
            pos = text.find(alias)
            if pos < 0:
                continue
            before = text[:pos]
            after = text[pos + len(alias):]
            if ROAD_BEFORE.search(before[-24:]) or ROAD_AFTER_TH.match(after):
                admin_rejected.add(lm["key"])
                continue
            run_b = (THAI_RUN_END.search(before) or [""])[0]
            run_a = (THAI_RUN_START.search(after) or [""])[0]
            if run_a not in SUFFIX_OK_TH:
                continue
            rel = _rel_before_th(before)
            if rel is None:
                if run_b not in PREFIX_OK_TH:
                    continue
                rel = ("names", "ที่", "at")
            floor = None
            fm = FLOOR_TH.search(before[-10:]) or FLOOR_TH.search(after[:10])
            if fm:
                floor = fm.group(1)
                rel = ("inside", "ใน", "inside")
        else:
            if lm["key"] in admin_rejected:
                continue
            m = re.search(r"(?<![a-z0-9])" + re.escape(alias.lower()) + r"(?![a-z0-9])", low)
            if not m:
                continue
            before = text[:m.start()]
            after = text[m.end():]
            if (ROAD_BEFORE_EN.search(before[-12:]) or ROAD_AFTER_EN.match(after)
                    or ROAD_BEFORE.search(before[-24:])):
                continue
            rel = ("names", "ที่", "at")
            tail = before[-28:].lower().rstrip(" ,")
            for word, key, th, en in REL_EN:
                if tail.endswith(word):
                    rel = (key, th, en)
                    break
            floor = None
            fm = FLOOR_EN.search(before[-16:]) or FLOOR_EN.search(after[:16])
            if fm:
                floor = next(g for g in fm.groups() if g)
                rel = ("inside", "ใน", "inside")
        found.append((REL_RANK.get(rel[0], 2), -len(alias),
                      {"rel": rel[0], "rel_th": rel[1], "rel_en": rel[2],
                       "landmark": lm, "floor": floor, "alias": alias}))
    if not found:
        return None
    found.sort(key=lambda t: (t[0], t[1]))
    return found[0][2]


# ----------------------------------------------------------------- bearings --

def pin_uncertainty(r):
    a = r.get("attrs") or {}
    u = a.get("pinUncertaintyM")
    if isinstance(u, (int, float)):
        return float(u)
    prec = r.get("geoPrecision") or "exact"
    if prec == "needs-pin" or r.get("lat") is None:
        return None
    return float(DEFAULT_UNC.get(prec, 1000))


def _lm_name(lm):
    return lm["th"], lm["en"], lm.get("roman") or ""


def _zone_of(c, r, prov):
    z = c.zones.get(prov)
    if not z or r.get("lat") is None:
        return None
    la, ln = r["lat"], r["lng"]
    for b in z.get("boxes", []):
        if b["lat"][0] <= la <= b["lat"][1] and b["lng"][0] <= ln <= b["lng"][1]:
            return b
    for k in z.get("circles", []):
        if math.hypot((la - k["lat"]) * 111.0, (ln - k["lng"]) * 105.0) <= k["r_km"]:
            return k
    return None


# Address relations the pin refused: read by importers/audit_bearings.py.
# Each is either a wrong parse or a wrong pin, and the audit says which it
# thinks; neither reaches a page.
CONTRADICTIONS = []


def _line(kind, th, en, roman="", landmark=None, m=None, d=None, due=False,
          src="pin", approx=False):
    return {"kind": kind, "th": th, "en": en, "roman": roman,
            "landmark": landmark, "m": None if m is None else int(round(m)),
            "dir": None if d is None else DIRS_EN[d], "due": bool(due),
            "from": src, "approx": bool(approx)}


def bearings(r, c=None):
    """The ordered lines for one record. Deterministic; pure on (r, register)."""
    c = c or ctx()
    prov = r.get("province") or (r.get("id") or "")[:2]
    lms = c.landmarks.get(prov) or []
    out = []
    lat, lng = r.get("lat"), r.get("lng")
    unc = pin_uncertainty(r)
    pinned = lat is not None and lng is not None and (r.get("geoPrecision") or "exact") != "needs-pin"
    loose = pinned and unc is not None and unc > LOOSE_PIN_M

    # 1. the address's own relation, gated by the pin
    addr = parse_address(r.get("address"), c, prov)
    addr_key = None
    addr_line = None
    if addr:
        lm = addr["landmark"]
        ok, src = True, "address"
        if pinned:
            d = metres(lat, lng, lm["lat"], lm["lng"])
            allow = lm["reach_m"] * CORROBORATE_SLACK
            if loose:
                allow = max(allow, unc)
            ok = d <= allow
            src = "pin+address"
        if ok:
            fl_th = f" ชั้น {addr['floor']}" if addr.get("floor") else ""
            fl_en = f", floor {addr['floor']}" if addr.get("floor") else ""
            th, en, ro = _lm_name(lm)
            addr_line = _line("address", f"{addr['rel_th']}{th}{fl_th}",
                              f"{addr['rel_en']} {en}{fl_en}", ro,
                              landmark=lm["key"], src=src)
            addr_key = lm["key"]
        else:
            CONTRADICTIONS.append({"id": r.get("id"), "landmark": lm["key"],
                                   "alias": addr["alias"], "m": int(d),
                                   "unc": unc, "address": r.get("address")})

    if not pinned:
        return [addr_line] if addr_line else []

    # 2. the moat: inside (quarter + nearest crossing) or outside (side + gate)
    moat_done = False
    inside = False
    gate_named = None
    if c.moat_poly and prov == "cm":
        cla, cln = c.moat_c
        d_ring = min(dist_to_segment_m(lat, lng, c.moat_poly[i], c.moat_poly[(i + 1) % 4], c.kx)
                     for i in range(4))
        inside = point_in_poly(lat, lng, c.moat_poly)
        crossings = [l for l in lms if l["kind"] in ("gate", "corner")]
        gates = [l for l in lms if l["kind"] == "gate"]
        if inside and loose:
            # a ±1 km pin cannot name a quarter of a 1.5 km square
            out.append(_line("moat", "ในเวียง (โดยประมาณ)", "Inside the old city (approximate)",
                             "nai wiang", approx=True))
            moat_done = True
        elif inside:
            dx = (lng - cln) * 111320 * c.kx
            dy = (lat - cla) * 111320
            if abs(dx) <= CENTRE_M and abs(dy) <= CENTRE_M:
                q = "C"
            else:
                q = ("N" if dy >= 0 else "S") + ("E" if dx >= 0 else "W")
            qth, qen = QUAD[q]
            th = f"ในเวียง {qth}"
            en = f"Inside the old city, {qen}"
            ro = "nai wiang"
            near = None
            if crossings:
                near = min(crossings, key=lambda l: metres(lat, lng, l["lat"], l["lng"]))
                dm = metres(lat, lng, near["lat"], near["lng"])
                dth, den = fmt_dist(dm)
                th += f" · ใกล้{near['th']} {dth}"
                en += f" · {den} from {near['en']}"
                ro += f" · {near.get('roman', '')}"
                gate_named = near["key"]
                out.append(_line("moat", th, en, ro, landmark=near["key"], m=dm, approx=loose))
            else:
                out.append(_line("moat", th, en, ro, approx=loose))
            moat_done = True
        elif d_ring <= RING_REACH_M and not loose:
            # (a loose pin outside the ring gets the city line instead: one
            # direction from one point, not two directions from two)
            deg = bearing_deg(cla, cln, lat, lng)
            i, _ = compass(deg)
            if True:
                dth, den = fmt_dist(d_ring)
                th = f"นอกเวียง ทาง{DIRS_TH[i]} ห่างคูเมือง {dth}"
                en = f"Outside the moat to the {DIRS_EN[i]}, {den} from the water"
                ro = f"nok wiang · {DIRS_RO[i]}"
                near = None
                if gates:
                    g = min(gates, key=lambda l: metres(lat, lng, l["lat"], l["lng"]))
                    gm = metres(lat, lng, g["lat"], g["lng"])
                    if gm <= g["reach_m"]:
                        gth, gen = fmt_dist(gm)
                        th += f" · ใกล้{g['th']} {gth}"
                        en += f" · {gen} from {g['en']}"
                        ro += f" · {g.get('roman', '')}"
                        near, gate_named = g, g["key"]
                out.append(_line("moat", th, en, ro, landmark=near and near["key"],
                                 m=d_ring, d=i))
            moat_done = True

    # 3. the landmarks within reach — at most two, different kinds, most
    #    specific first (closest relative to its own reach)
    if not loose:
        cands = []
        for l in lms:
            if l["kind"] in ("gate", "corner"):
                continue
            if l["key"] == addr_key:
                continue
            if l.get("record") and l["record"].get("id") == r.get("id"):
                continue            # a landmark is not "at" itself
            d = metres(lat, lng, l["lat"], l["lng"])
            if d <= l["reach_m"]:
                cands.append((d / float(l["reach_m"]), d, l))
        cands.sort(key=lambda t: t[0])
        kinds = set()
        for ratio, d, l in cands:
            if l["kind"] in kinds or len(kinds) >= 2:
                continue
            kinds.add(l["kind"])
            th, en, ro = _lm_name(l)
            if l["at_m"] and d <= l["at_m"]:
                if l["kind"] == "temple":
                    out.append(_line("at", f"ในบริเวณ{th}", f"in the grounds of {en}", ro, l["key"], m=d))
                else:
                    out.append(_line("at", f"ที่{th}", f"at {en}", ro, l["key"], m=d))
            else:
                deg = bearing_deg(l["lat"], l["lng"], lat, lng)
                i, due = compass(deg)
                dth, den = fmt_dist(d)
                kind = "airport" if l["kind"] == "airport" else "near"
                if l["at_m"]:
                    th_s, en_s = f"ห่าง{th} {dth} ไปทาง{DIRS_TH[i]}", \
                                 f"{den} {'due ' if due else ''}{DIRS_EN[i]} of {en}"
                else:
                    # an area — a campus, an airfield, a hospital compound —
                    # is measured from its middle, and the line says so
                    th_s, en_s = f"ห่างกลาง{th} {dth} ไปทาง{DIRS_TH[i]}", \
                                 f"{den} {'due ' if due else ''}{DIRS_EN[i]} of the middle of {en}"
                out.append(_line(kind, th_s, en_s, f"{ro} · {DIRS_RO[i]}", l["key"],
                                 m=d, d=i, due=due))

    # 4. the city bearing, from the one point the province measures from
    if not inside:
        o = c.origin.get(prov)
        if o and not (moat_done and not loose and any(x["kind"] == "moat" and x["m"] is not None for x in out)):
            d = metres(o["lat"], o["lng"], lat, lng)
            # (a loose pin has no landmark line to stand in for this one, so
            # it gets the city line however close it sits)
            if d / 1000.0 <= CITY_MAX_KM and (d > o["reach_m"] or loose):
                deg = bearing_deg(o["lat"], o["lng"], lat, lng)
                i, due = compass(deg)
                oth, oen, oro = _lm_name(o)
                if loose:
                    km = max(1, int(round(d / 1000.0)))
                    out.append(_line("city", f"ห่าง{oth}ราว {km} กม. ทาง{DIRS_TH[i]} (โดยประมาณ)",
                                     f"about {km} km {DIRS_EN[i]} of {oen} (approximate)",
                                     f"{oro} · {DIRS_RO[i]}", o["key"], m=d, d=i, due=due, approx=True))
                else:
                    dth, den = fmt_dist(d)
                    out.append(_line("city", f"ห่าง{oth} {dth} ทาง{DIRS_TH[i]}",
                                     f"{den} {'due ' if due else ''}{DIRS_EN[i]} of {oen}",
                                     f"{oro} · {DIRS_RO[i]}", o["key"], m=d, d=i, due=due))

    # 5. the zone (WO-36), with two guards the zone file cannot give itself:
    #    the old-city BOX is wider than the moat, so a place the moat line
    #    just put 30 m outside the water is not re-filed "in the moat"; and an
    #    amphoe CIRCLE (Chom Thong's is 60 km across) never labels a place
    #    within 6 km of the moat — the airport is not in Chom Thong.
    z = _zone_of(c, r, prov)
    if z and not inside:
        near_town = bool(c.moat_c) and prov == "cm" and \
            metres(lat, lng, c.moat_c[0], c.moat_c[1]) <= 6000
        if z.get("key") == "mueang-kao" or ("r_km" in z and near_town):
            z = None
    if z and not inside:
        out.append(_line("zone", f"ย่าน{z['th']}", z["en"], "", None,
                         src="pin", approx=False))

    if addr_line:
        # the address's own words are the strongest statement: they lead
        out.insert(0, addr_line)
    return out


# ------------------------------------------------------------------- render --

def _lm_html(l, esc, href, from_prov):
    """The landmark's name as it appears in a line: linked when it has a page."""
    en = esc(l["en"])
    if href and l.get("record"):
        h = href(l["record"], from_prov)
        if h:
            return f'<a href="{h}">{en}</a>'
    return en


def row_html(r, bi, esc, href=None, c=None, lines=None):
    """<dt>ทิศทาง · Bearings</dt><dd>…</dd>, or "" when nothing can be said.

    `href(record, from_prov)` returns a relative link to a landmark's page or
    None; the build passes one built on place_slug(). Each line is bi(th, en)
    so the language toggle works."""
    c = c or ctx()
    lines = bearings(r, c) if lines is None else lines
    if not lines:
        return ""
    prov = r.get("province") or (r.get("id") or "")[:2]
    by_key = {l["key"]: l for l in c.landmarks.get(prov, [])}
    parts = []
    for ln in lines:
        en = esc(ln["en"])
        lm = by_key.get(ln["landmark"]) if ln.get("landmark") else None
        if lm:
            en = en.replace(esc(lm["en"]), _lm_html(lm, esc, href, prov), 1)
        parts.append(bi(esc(ln["th"]), en, raw=True))
    unc = pin_uncertainty(r)
    if unc is not None and unc > LOOSE_PIN_M:
        parts.append('<span class="tinynote">'
                     + bi(f"หมุด ±{int(unc):,} ม.", f"pin ±{int(unc):,} m")
                     + "</span>")
    return (f"<dt>{bi('ทิศทาง', 'Bearings')}</dt><dd>" + "<br>".join(parts) + "</dd>")


def for_json(r, c=None):
    """The machine twin, for the .json sidecar and /api/v1."""
    return [{k: v for k, v in ln.items()} for ln in bearings(r, c or ctx())]


# --------------------------------------------------------------------- emit --

KINDS_TH = {"gate": "ประตูเมือง", "corner": "แจ่ง", "market": "ตลาด", "mall": "ห้าง",
            "hospital": "โรงพยาบาล", "university": "มหาวิทยาลัย", "airport": "สนามบิน",
            "temple": "วัด", "monument": "อนุสาวรีย์และที่ทำการ", "park": "สวน",
            "bridge": "สะพาน", "terminal": "สถานีขนส่ง", "craft-village": "หมู่บ้านหัตถกรรม",
            "waterfall": "น้ำตก"}
KINDS_EN = {"gate": "City gates", "corner": "Moat corners", "market": "Markets", "mall": "Malls",
            "hospital": "Hospitals", "university": "Universities", "airport": "Airports",
            "temple": "Temples", "monument": "Monuments and halls", "park": "Parks",
            "bridge": "Bridges", "terminal": "Bus terminals", "craft-village": "Craft villages",
            "waterfall": "Waterfalls"}


def emit(g, data):
    """/landmarks.html — the register as a page — and docs/data/landmarks.json."""
    page, bi, esc = g["page"], g["bi"], g["esc"]
    DOCS = g["DOCS"]
    bi_text = g.get("bi_text") or (lambda th, en: f"{th} · {en}")
    place_slug = g.get("place_slug")
    c = ctx(force=True)
    records = list(c.by_id.values())
    pinned = [r for r in records if r.get("lat") is not None
              and (r.get("geoPrecision") or "exact") != "needs-pin"]

    def within(l):
        return sum(1 for r in pinned if r.get("province") == l["_prov"]
                   and metres(r["lat"], r["lng"], l["lat"], l["lng"]) <= l["reach_m"])

    sections = []
    total = 0
    export = {}
    for prov, ls in c.landmarks.items():
        for l in ls:
            l["_prov"] = prov
        by_kind = {}
        for l in ls:
            by_kind.setdefault(l["kind"], []).append(l)
        rows = []
        for kind in KINDS_EN:
            if kind not in by_kind:
                continue
            items = []
            for l in by_kind[kind]:
                n = within(l)
                total += 1
                link = ""
                if l.get("record") and place_slug:
                    link = f'{prov}/p/{place_slug(l["record"])}.html'
                name = (f'<a href="{esc(link)}">{esc(l["en"])}</a>' if link else esc(l["en"]))
                items.append(
                    f'<li><span class="th solo" lang="th">{esc(l["th"])}</span> '
                    f'<span class="en" lang="en">{name}</span> '
                    f'<span class="roman">{esc(l.get("roman", ""))}</span>'
                    f' <span class="tinynote">'
                    + bi(f"บอกทางได้ในรัศมี {l['reach_m']:,} ม. · {n:,} แห่ง",
                         f"reach {l['reach_m']:,} m · {n:,} places")
                    + ("" if l.get("record") else " · " + bi("ยังไม่มีหน้าของตัวเอง", "no page of its own yet"))
                    + ("" if not l.get("origin") else " · " + bi("จุดวัดของจังหวัด", "the province's origin"))
                    + "</span></li>")
                export.setdefault(prov, []).append({
                    "key": l["key"], "kind": l["kind"], "th": l["th"], "en": l["en"],
                    "roman": l.get("roman", ""), "lat": round(l["lat"], 6), "lng": round(l["lng"], 6),
                    "reach_m": l["reach_m"], "origin": bool(l.get("origin")),
                    "id": (l.get("record") or {}).get("id"), "osm": l.get("osm"),
                    "places_within_reach": n})
            rows.append(f"<h3>{bi(KINDS_TH[kind], KINDS_EN[kind])}</h3><ul>{''.join(items)}</ul>")
        ptitle = {"cm": ("เชียงใหม่", "Chiang Mai"), "cr": ("เชียงราย", "Chiang Rai")}.get(prov, (prov, prov))
        sections.append(f"<section><h2>{bi(*ptitle)}</h2>{''.join(rows)}</section>")

    missing = ""
    if c.unresolved:
        missing = ("<p class=\"tinynote\">" + bi("ยังหาพิกัดไม่ได้", "no coordinate yet") + ": "
                   + esc(", ".join(f"{p}/{k}" for p, k, _ in c.unresolved)) + "</p>")

    body = (
        f"<h1>{bi('ที่หมายตา', 'Landmarks')}</h1>"
        + "<p>" + bi(
            "ทุกหน้าสถานที่บอกว่าอยู่ตรงไหนเทียบกับที่เหล่านี้ — ในเวียงมุมไหน ใกล้ประตูใด "
            "ห่างประตูท่าแพกี่กิโลไปทางทิศใด ตรงข้ามหรือข้างอะไร พิกัดทุกจุดอ่านจากระเบียนของที่นั้นเอง",
            "Every place page says where it stands in relation to these: which quarter "
            "inside the moat, which gate, how far from Tha Phae Gate and which way, opposite "
            "or beside what. Each coordinate is read from the landmark's own record.")
        + "</p>"
        + "".join(sections) + missing)
    (DOCS / "data").mkdir(parents=True, exist_ok=True)
    (DOCS / "data" / "landmarks.json").write_text(json.dumps(export, ensure_ascii=False, indent=1))
    (DOCS / "landmarks.html").write_text(page(
        "ที่หมายตา · Landmarks", body, depth=0, path="landmarks.html",
        desc=bi_text("ที่หมายตาที่ทุกหน้าในมดแดงใช้บอกทิศทาง — ประตูเมือง ตลาด วัด ห้าง โรงพยาบาล สนามบิน",
                     "The landmarks every Mot Dang page measures from — gates, markets, temples, malls, hospitals, airports"),
        crumbs='<a href="index.html">' + bi("หน้าแรก", "Home") + "</a> › " + bi("ที่หมายตา", "Landmarks")))
    return f"{total} landmarks · {len(c.unresolved)} unresolved"


if __name__ == "__main__":
    import sys
    c = ctx()
    for p, ls in c.landmarks.items():
        print(p, len(ls), "landmarks;", "origin:", (c.origin.get(p) or {}).get("key"))
    for u in c.unresolved:
        print("  unresolved:", u)
    ids = sys.argv[1:]
    for i in ids:
        r = c.by_id.get(i)
        if not r:
            print(i, "not on this disk")
            continue
        print(i, r.get("name"), "|", r.get("nameEn"), "|", r.get("address"))
        for ln in bearings(r, c):
            print("   ", ln["kind"].ljust(8), ln["th"], "|", ln["en"], "|", ln["roman"])
