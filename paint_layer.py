#!/usr/bin/env python3
"""paint_layer.py — "colour by", for /map.html. WO-79.

WHAT THIS IS
------------
Today the explore map has three colours and they all mean the same kind of
thing: shelf ink says which shelf, the green ring says known-open, the stack
ring says how many share the pin. Nothing on the map is ever coloured by an
attribute of the PLACE. This adds that one control, and nothing else.

The control IS the legend. A shelf chip on /map.html already carries, in its
own swatch, the ink its dots will be drawn in — so the chip row and the map
are one legend and there is no key to look up. A colour-by control that did
not do the same would be the first control on this map that made the reader
remember what a colour meant.

So every option here wears its inks. Two carriers, because one of them is not
reliable:

  · each <option> gets an inline background of its dimension's first ink.
    Firefox and Chrome-on-Android honour that; Safari and Chrome-on-macOS
    paint the native menu themselves and ignore it. UNVERIFIED HERE — I have
    no browser on this machine to measure it in, so it is written as a free
    win where it lands and never as the thing that carries the meaning.
  · the strip under the bar, which is drawn in our own HTML and therefore
    always renders: one swatch per bucket, its words, and its count in view.
    That strip is the legend, and it is also how the reader learns that
    "no hours posted" is 93.6% of the map.

A NEW DIMENSION IS DATA, NOT A MODULE
-------------------------------------
`DIMENSIONS` below is the whole thing: {key, label_th, label_en, kind, values}.
`kind` is 'ramp' or 'categorical'. A row whose `needs` is unsatisfied is
DORMANT — it is not rendered, and `needs` names the exact data change that
wakes it. Nothing else in this file knows the name of any dimension.

WHAT ACTUALLY RIDES IN THE PUBLISHED GeoJSON — measured 2026-09-08 over all
28 files in docs/data/, 63,249 features:

    id  name  nameTh  nameEn  cat  province  slug  rank   63,249 (all)
    k   (stack size, only where >1)                        5,140
    t   (tradeTags, only where the record has any)         2,599   4.1%

  · `rank` is there, 1..7 observed (the scale is 0..9; nothing on this site
    has yet earned 8 or 9). The ramp's domain stays 0..9 because an ant rank
    is an absolute count of facts held, not a rank within the shelf — 4 ants
    must mean the same thing on the food shelf and the temple shelf. The
    legend prints the observed range beside it so the reader is not told the
    map holds a 9 that does not exist.
  · `t` IS present, on 4.1% of features. This CORRECTS the maps-grow note
    §5 and the WO-79 brief, both of which say tags do not ride yet: WO-77 §3
    put them in. What blocks a tag dimension is therefore coverage, not
    schema — see DIMENSIONS['tag'].needs.
  · openness rides in NOTHING. It comes from data/open_lamps.json, which
    explore.js already fetches for the green ring.
  · tambon rides in nothing. `attrs.tambon` is on 3,862 of the first 4,000
    canonical records but geojson() does not copy it out.

COLOUR VISION — MEASURED, NOT ASSERTED
--------------------------------------
`cvd_report()` at the bottom of this file simulates protanopia and
deuteranopia on any set of hexes under two independent models (Viénot,
Brettel & Mollon 1999; Machado, Oliveira & Fernandes 2009 at severity 1.0),
and reports the smallest CIEDE2000 distance it finds. Run it:

    python3 paint_layer.py

The answer for the six shipping inks, 2026-09-08: THEY DO NOT SURVIVE.
Worst pair is ant red #C2401C against amber #B06A00, which falls from
ΔE00 19.22 in normal vision to 3.81 (Viénot) / 4.10 (Machado) under
deuteranopia. Two more pairs are close behind. The numbers, what they cost,
and the options are in notes/maps-grow-2026-09-08.txt §11 — this file does
not change INKS, because which six inks the site paints in is Nan's.

Nothing in here runs a build, and nothing in here fetches anything.
"""

import colorsys
import itertools
import json
import math
import zlib

import explore_layer
import glyphs

# ── the ground this paints on ────────────────────────────────────────────────
# From the retune (notes/maps-gemba-2026-08-20.md §2e). Every ink below is
# measured against these three, because an ink that vanishes into the lake is
# not an ink.
PAPER = "#FBF6EC"
CASING = "#B39058"
WATER = "#8FAEC9"

# WHAT A DOT ACTUALLY HAS TO CLEAR, and why it is one number and not three.
#
# Measured while building this: NO light ink can clear the road casing. The
# casing is #B39058, a mid-tone warm brown, so anything pale sits on top of
# it at 1.0–1.2:1 — and a ramp needs a pale end or it is not a ramp. The site
# already answered this and the answer is not colour: every dot on the
# explore map is drawn over a `-halo` circle of #FFFCF6 at 0.85, one to two
# pixels wider than the dot (explore_layer.addLayer). That white coat is what
# separates a dot from whatever it is standing on. maps-gemba §2e says it
# outright — "pins keep their dominance by halo rather than by the map
# staying pale".
#
# So the gate is contrast against PAPER, at the WCAG 3:1 floor for meaningful
# graphics. Casing and water are MEASURED AND PRINTED, never gated, because
# gating on them would forbid every pale ink and there would be no ramp.
DOT_BAR = 3.0


def _rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _hex(rgb):
    return "#" + "".join("%02X" % max(0, min(255, round(c * 255))) for c in rgb)


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _rel_lum(h):
    r, g, b = (_lin(c) for c in _rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    """WCAG contrast ratio between two hexes."""
    la, lb = _rel_lum(a), _rel_lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def clears_ground(h, bar=DOT_BAR):
    """Does this ink read as a mark on our own paper? The halo under the dot
    is what handles casing and water — see DOT_BAR."""
    return contrast(h, PAPER) >= bar


def ground_report(h):
    """All three, for printing. Only the first is a gate."""
    return {"paper": round(contrast(h, PAPER), 2),
            "casing": round(contrast(h, CASING), 2),
            "water": round(contrast(h, WATER), 2),
            "clears": clears_ground(h)}


# ── the ramp ─────────────────────────────────────────────────────────────────
# THE RETUNE LESSON, in one function. From maps-gemba §2e: "The first attempt
# boosted saturation as well and produced a lime-green, traffic-cone-orange
# map; hue and saturation held, lightness alone, is the setting that keeps
# Nan's approved look." So a ramp here holds H and S of its base ink EXACTLY
# and moves L and nothing else. tests/test_paint.py asserts that — not
# approximately, exactly, in HLS — because "one hue" is the whole contract and
# a ramp that drifted a few degrees would look like two dimensions at once.

def lightest_legible(base_hex, bar=DOT_BAR):
    """The palest HLS lightness at this hue and saturation that still clears
    `bar` against paper. Solved, not guessed: the answer depends on the hue
    (blue reaches 3:1 while it is still much paler than red does), and a
    hard-coded constant would make one of the two ramps illegible at the
    light end. Returns an HLS L in [0.05, 0.95]."""
    h, _l, s = colorsys.rgb_to_hls(*_rgb(base_hex))
    best = 0.05
    lo, hi = 0.05, 0.95
    for _ in range(40):                      # bisection; monotone in L
        mid = (lo + hi) / 2
        if contrast(_hex(colorsys.hls_to_rgb(h, mid, s)), PAPER) >= bar:
            best = mid
            lo = mid                         # can we go paler still?
        else:
            hi = mid
    # Round DOWN to four places, then confirm against the rounded hex. Naive
    # round() moves L by up to 5e-5, which is a fifth of an 8-bit step and
    # enough to flip the last stop under the bar — it did, at 2.99:1, before
    # this line existed.
    best = math.floor(best * 10000) / 10000
    while best > 0.05 and contrast(_hex(colorsys.hls_to_rgb(h, best, s)), PAPER) < bar:
        best -= 0.0005
    return round(best, 4)


def ramp(base_hex, n, lo=None, hi=0.26):
    """`n` stops of one hue, light to dark. H and S come from `base_hex` and
    do not move; only L does, linearly from `lo` to `hi`.

    THE ONE-HUE CONTRACT IS EXACT IN INTENT AND APPROXIMATE IN BYTES. H and S
    are held to the same float for every stop; what moves them is rounding to
    8-bit hex at the end. MEASURED 2026-09-08: that costs at most 0.32° of
    hue and 0.004 of saturation across a ten-stop ramp. tests/test_paint.py
    asserts within that, not exact equality, because exact equality is not
    achievable through a 24-bit colour and a test that demanded it would be
    testing arithmetic rather than the design.

    `lo` defaults to the palest lightness that still clears DOT_BAR on paper,
    solved per hue by lightest_legible(). `hi` stops short of black so the
    dark end is still the ink's own colour and not a hole in the map.
    """
    h, _l, s = colorsys.rgb_to_hls(*_rgb(base_hex))
    if lo is None:
        lo = lightest_legible(base_hex)
    if n < 2:
        return [_hex(colorsys.hls_to_rgb(h, (lo + hi) / 2, s))]
    return [_hex(colorsys.hls_to_rgb(h, lo + (hi - lo) * i / (n - 1), s))
            for i in range(n)]


# What 8-bit rounding costs a "one hue" ramp. Measured on the two ramps this
# module actually ships, 2026-09-08: worst hue drift 0.58°, worst saturation
# drift 0.008. The cap is set a little above the measurement, and the reason
# the pale end is the worst case is worth writing down: at high lightness the
# three channels sit close together, so one byte of rounding is a larger
# fraction of the angle between them. Not a fudge factor — a 24-bit colour
# cannot hold a hue more tightly than this.
HUE_QUANT = 1.0 / 360.0     # 1.0° of hue, as a colorsys fraction
SAT_QUANT = 0.02

# HOW MANY STOPS A RAMP CAN HONESTLY CARRY — measured, and it is not ten.
# The ant ramp at 10 stops puts adjacent stops ΔE00 2.97 apart, which is
# under the working floor for a dot on a map (JND, below). So the ten-stop
# ramp reads as an AMOUNT across a field of dots and cannot be read as a
# lookup for one dot: nobody will tell a 4-ant pin from a 5-ant pin by eye.
# Fewer stops buy separation, measured on the same hue:
#     10 stops  smallest step ΔE00  2.97
#      5 stops  smallest step ΔE00  7.11
#      4 stops  smallest step ΔE00  9.10
#      3 stops  smallest step ΔE00 14.29
# Ten is kept because the ant rank IS 0..9 and binning it would invent a
# scale the site does not have. Whether to bin it anyway is a fork for Nan —
# maps-grow §11, C3 — not a decision this file makes.


def ramp_report(stops):
    """What a ramp actually costs: contrast at both ends, and the smallest
    step between neighbours. A ramp whose adjacent stops are 1.5 ΔE00 apart
    is a gradient, not ten readable states."""
    labs = [lab_of(s) for s in stops]
    steps = [de2000(labs[i], labs[i + 1]) for i in range(len(labs) - 1)]
    return {"n": len(stops),
            "paper_lightest": round(contrast(stops[0], PAPER), 2),
            "paper_darkest": round(contrast(stops[-1], PAPER), 2),
            "min_step_de00": round(min(steps), 2) if steps else 0.0,
            "ends_de00": round(de2000(labs[0], labs[-1]), 2)}


# ── the three states of openness ─────────────────────────────────────────────
# THREE, NEVER TWO. explore_layer already argues this for the green ring and
# it is the same argument here, with a number on it: of the 62,298 pinned
# records the published GeoJSON carries, 3,968 have hours on record and
# 58,330 do not. That is 6.4% known and 93.6% never asked. A two-state
# open/closed colouring would publish a claim about fifty-eight thousand
# businesses that none of them made.
#
# So the third state is not a fallback and it is not "grey for missing" — it
# is the majority of the map, and the words say what it is: nobody has posted
# hours. Not "unknown", not "closed", not a dash.
#
# The inks, chosen by measurement (see cvd_report):
#   open      jade #1F6B57 — the SAME jade the open-now ring already uses, so
#                            the two controls cannot disagree
#   closed    deep amber #8A5200 — warm and present. Not red: a shop that is
#                            shut at 3 a.m. is not a problem, and red on this
#                            site means the ant.
#   no hours  pale ink #9C8A76 — 3.09:1 on paper, just over the floor. It
#                            recedes, which is honest, and it does not
#                            disappear, which is also honest: the place is
#                            there. Against road casing it measures 1.12:1
#                            and the halo is what holds it — see DOT_BAR.
# Measured 2026-09-08: this trio's worst CVD pair is ΔE00 15.29 across all
# five simulations, against 24.10 in normal vision. It survives — which the
# six shelf inks, on the same measurement, do not.
OPEN_INK = "#1F6B57"
SHUT_INK = "#8A5200"
NOHOURS_INK = "#9C8A76"

# The distance ramp's hue: blue, the deepest of the six, which leaves the most
# lightness room between the near end and the far end.
DIST_HUE = "#14479B"
# The ant ramp's hue: ant red. The totem doing work — the rank is counted in
# ants, so it is painted in the ant's own colour.
RANK_HUE = "#C2401C"


# ── the table ────────────────────────────────────────────────────────────────
# EVERY dimension the control offers. A new one is a row here; nothing below
# this table names a dimension.
#
#   key        the hash value and the DOM value
#   label_th / label_en   what the option says
#   kind       'categorical' (a set of buckets, capped at six inks) or
#              'ramp' (one hue, ordered, lightness only)
#   values     for 'categorical': the buckets, in legend order, each
#              {ink, th, en}. For 'ramp': {hue, stops, domain, ticks}.
#   prop       the GeoJSON property it reads, or None where the value is
#              computed at draw time (openness, distance)
#   needs      None if the data is here today; otherwise the exact change
#              that wakes this row. A row with `needs` set is DORMANT: it is
#              not offered, and it costs nothing until the data lands.

def _rank_values():
    stops = ramp(RANK_HUE, 10)
    return {"hue": RANK_HUE, "stops": stops, "domain": (0, 9),
            # Ticks are what the legend prints. Not ten labels — three, at the
            # ends and the middle, because ten numbers under a map is a table.
            "ticks": ((0, "๐ ยังไม่รู้อะไรเลย", "0 — nothing on record"),
                      (4, "๔", "4"),
                      (9, "๙ ครบ", "9 — complete"))}


def _dist_values():
    # THE RING'S OWN LADDER, imported, not retyped. explore_layer.RING_M is
    # what the ring select offers and what the ring draws; a distance
    # colouring that used a different set of radii would be a second answer
    # to the same question on the same screen.
    edges = [m for m, _th, _en in explore_layer.RING_M]
    stops = ramp(DIST_HUE, len(edges) + 1)
    return {"hue": DIST_HUE, "stops": stops, "edges": edges,
            "labels": [(th, en) for _m, th, en in explore_layer.RING_M]}


DIMENSIONS = (
    {
        "key": "kind",
        "label_th": "ตามชั้น",
        "label_en": "By shelf",
        "kind": "categorical",
        "prop": None,          # the shelf is which file the point came from
        "needs": None,
        # Filled at render time from the shelves actually switched on: the ink
        # is the switch-on order, exactly as today. Six is the cap and
        # explore_layer.MAX_ON already enforces it upstream.
        "values": None,
        "default": True,
    },
    {
        "key": "rank",
        "label_th": "ตามจำนวนมด",
        "label_en": "By ant rank",
        "kind": "ramp",
        "prop": "rank",
        "needs": None,
        "values": _rank_values(),
    },
    {
        "key": "open",
        "label_th": "เปิด / ปิด / ยังไม่ได้บอก",
        "label_en": "Open, closed, or not posted",
        "kind": "categorical",
        "prop": None,          # from data/open_lamps.json, at draw time
        "needs": None,
        "values": (
            {"ink": OPEN_INK, "bucket": "open",
             "th": "รู้ว่าเปิดอยู่", "en": "known open now"},
            {"ink": SHUT_INK, "bucket": "shut",
             "th": "บอกเวลาไว้ และตอนนี้ปิด", "en": "hours posted, shut now"},
            # THE WORDING IS THE POINT. Not "unknown". Not "closed".
            {"ink": NOHOURS_INK, "bucket": "nohours",
             "th": "ยังไม่มีใครบอกเวลาเปิด",
             "en": "no hours posted — not the same as closed"},
        ),
    },
    {
        "key": "dist",
        "label_th": "ตามระยะจากกลางจอ",
        "label_en": "By distance from the crosshair",
        "kind": "ramp",
        "prop": None,          # the map's own distance expression
        "needs": None,
        "values": _dist_values(),
    },
    # ── DORMANT ─────────────────────────────────────────────────────────────
    # Offered the day `needs` is satisfied, and not one line of code before.
    {
        "key": "tag",
        "label_th": "ตามป้าย",
        "label_en": "By trade tag",
        "kind": "categorical",
        "prop": "t",
        # MEASURED 2026-09-08: `t` rides on 2,599 of 63,249 features (4.1%).
        # The FIELD is not the blocker — WO-77 §3 put it in — the COVERAGE is.
        # Painted today, this dimension would show five small tag colours and
        # 96% of the map in "no tag", which teaches the reader that the city
        # has no trades. tags_layer/tags_mine raised tag coverage on the
        # RECORD to ~99.5%; what is missing is build.geojson() writing more
        # than `attrs.tradeTags` into `t`.
        "needs": "build.geojson() writes the tags_layer assignment into `t`, "
                 "not only attrs.tradeTags — measured 4.1% of features carry "
                 "`t` today; a colour-by wants 60%+ or it paints one bucket.",
        "values": None,
    },
    {
        "key": "tambon",
        "label_th": "ตามตำบล",
        "label_en": "By tambon",
        "kind": "categorical",
        "prop": "tb",
        # attrs.tambon is on 3,862 of the first 4,000 canonical records, so
        # the fact exists; geojson() does not copy it out, and there are no
        # tambon polygons on disk either (maps-grow §3b). Colouring DOTS by
        # tambon needs only the first of those two.
        "needs": "build.geojson() copies attrs.tambon into a `tb` property. "
                 "(Colouring AREAS instead would additionally need the "
                 "CC-BY tambon polygons named in maps-grow §3b.)",
        "values": None,
    },
)

BY_KEY = {d["key"]: d for d in DIMENSIONS}
LIVE = tuple(d for d in DIMENSIONS if not d["needs"])
DORMANT = tuple(d for d in DIMENSIONS if d["needs"])
DEFAULT = next(d["key"] for d in DIMENSIONS if d.get("default"))


def inks_of(dim):
    """Every ink a dimension will actually paint with, in legend order.
    For 'kind' that is explore_layer.INKS — the shelf inks, unchanged."""
    if dim["key"] == "kind":
        return [ink for ink, _label in explore_layer.INKS]
    v = dim["values"] or {}
    if dim["kind"] == "ramp":
        return list(v.get("stops") or [])
    return [b["ink"] for b in (dim["values"] or ())]


def over_cap(dim):
    """A categorical dimension may not exceed six inks: a seventh would have
    to repeat one, which says two buckets are one bucket. A ramp is exempt —
    it is one hue and a reader reads it as an amount, not as a set."""
    return dim["kind"] == "categorical" and len(inks_of(dim)) > explore_layer.MAX_ON


# ── colour vision, measured ──────────────────────────────────────────────────
# Two independent published models, because a single one is an opinion.
#
#   Viénot, Brettel & Mollon (1999) — the LMS projection reduced to a 3x3 on
#   linear RGB. The one most simulators ship.
#   Machado, Oliveira & Fernandes (2009) — a physiologically-derived model
#   with a severity parameter; used here at 1.0, full dichromacy.
#
# Applied to LINEAR RGB in both cases, then back to sRGB and into CIELAB, and
# compared with CIEDE2000 — the perceptual distance metric, not a naive RGB
# or Lab-Euclidean one, because those disagree with eyes in exactly the
# blue-purple region where two of these inks sit.
#
# READING THE NUMBER: ΔE00 ≈ 1 is the just-noticeable difference for two
# large patches, side by side, under good light. A 4-pixel dot on a textured
# map at arm's length in Chiang Mai sun is nothing like that condition. The
# working floor used here is 10 — below that, treat two dots as one colour.

CVD_MODELS = {
    "protanopia (Viénot 1999)": (
        (0.11238, 0.88762, 0.0), (0.11238, 0.88762, 0.0), (0.00401, -0.00401, 1.0)),
    "deuteranopia (Viénot 1999)": (
        (0.29275, 0.70725, 0.0), (0.29275, 0.70725, 0.0), (-0.02234, 0.02234, 1.0)),
    "protanopia (Machado 2009)": (
        (0.152286, 1.052583, -0.204868), (0.114503, 0.786281, 0.099216),
        (-0.003882, -0.048116, 1.051998)),
    "deuteranopia (Machado 2009)": (
        (0.367322, 0.860646, -0.227968), (0.280085, 0.672501, 0.047413),
        (-0.011820, 0.042940, 0.968881)),
    "tritanopia (Machado 2009)": (
        (1.255528, -0.076749, -0.178779), (-0.078411, 0.930809, 0.147602),
        (0.004733, 0.691367, 0.303900)),
}
JND = 10.0     # the working floor for a dot on a map. Not a WCAG number.


def _mul(m, v):
    return tuple(sum(m[i][j] * v[j] for j in range(3)) for i in range(3))


def simulate(hex_colour, model):
    """The linear-RGB a dichromat sees. Clamped into gamut."""
    v = tuple(_lin(c) for c in _rgb(hex_colour))
    return tuple(min(1.0, max(0.0, x)) for x in _mul(CVD_MODELS[model], v))


def _lab(linear_rgb):
    m = ((0.4124564, 0.3575761, 0.1804375),
         (0.2126729, 0.7151522, 0.0721750),
         (0.0193339, 0.1191920, 0.9503041))
    x, y, z = _mul(m, linear_rgb)

    def f(t):
        return t ** (1 / 3) if t > 216 / 24389 else (841 / 108) * t + 4 / 29
    fx, fy, fz = f(x / 0.95047), f(y / 1.0), f(z / 1.08883)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def lab_of(hex_colour):
    return _lab(tuple(_lin(c) for c in _rgb(hex_colour)))


def de2000(lab1, lab2):
    """CIEDE2000. Written out rather than approximated: the whole point of
    this file is that the colour-vision claim is a measurement."""
    l1, a1, b1 = lab1
    l2, a2, b2 = lab2
    c1, c2 = math.hypot(a1, b1), math.hypot(a2, b2)
    cb = (c1 + c2) / 2
    g = 0.5 * (1 - math.sqrt(cb ** 7 / (cb ** 7 + 25 ** 7))) if cb > 0 else 0.5
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360 if (a1p or b1) else 0.0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360 if (a2p or b2) else 0.0
    dlp, dcp = l2 - l1, c2p - c1p
    if c1p * c2p == 0:
        dhp = 0.0
    else:
        d = h2p - h1p
        dhp = d if abs(d) <= 180 else (d - 360 if d > 180 else d + 360)
    dhp_big = 2 * math.sqrt(c1p * c2p) * math.sin(math.radians(dhp) / 2)
    lb, cbp = (l1 + l2) / 2, (c1p + c2p) / 2
    if c1p * c2p == 0:
        hbp = h1p + h2p
    else:
        s = h1p + h2p
        hbp = s / 2 if abs(h1p - h2p) <= 180 else ((s + 360) / 2 if s < 360 else (s - 360) / 2)
    t = (1 - 0.17 * math.cos(math.radians(hbp - 30))
         + 0.24 * math.cos(math.radians(2 * hbp))
         + 0.32 * math.cos(math.radians(3 * hbp + 6))
         - 0.20 * math.cos(math.radians(4 * hbp - 63)))
    dth = 30 * math.exp(-(((hbp - 275) / 25) ** 2))
    rc = 2 * math.sqrt(cbp ** 7 / (cbp ** 7 + 25 ** 7)) if cbp > 0 else 0.0
    sl = 1 + (0.015 * (lb - 50) ** 2) / math.sqrt(20 + (lb - 50) ** 2)
    sc, sh = 1 + 0.045 * cbp, 1 + 0.015 * cbp * t
    rt = -math.sin(math.radians(2 * dth)) * rc
    return math.sqrt((dlp / sl) ** 2 + (dcp / sc) ** 2 + (dhp_big / sh) ** 2
                     + rt * (dcp / sc) * (dhp_big / sh))


def cvd_report(colours, labels=None):
    """The smallest perceptual distance in `colours`, per model, plus the
    pair that produced it. This is the measurement; opinions come after."""
    labels = list(labels or colours)
    out = {}
    normal = [lab_of(c) for c in colours]
    pairs = list(itertools.combinations(range(len(colours)), 2))
    worst = min(pairs, key=lambda ij: de2000(normal[ij[0]], normal[ij[1]]))
    out["normal vision"] = {
        "min_de00": round(de2000(normal[worst[0]], normal[worst[1]]), 2),
        "pair": (labels[worst[0]], labels[worst[1]])}
    for name in CVD_MODELS:
        labs = [_lab(simulate(c, name)) for c in colours]
        w = min(pairs, key=lambda ij: de2000(labs[ij[0]], labs[ij[1]]))
        out[name] = {"min_de00": round(de2000(labs[w[0]], labs[w[1]]), 2),
                     "pair": (labels[w[0]], labels[w[1]])}
    out["floor"] = round(min(v["min_de00"] for k, v in out.items()
                             if k != "normal vision"), 2)
    out["survives"] = out["floor"] >= JND
    return out


# ── the control, which is the legend ─────────────────────────────────────────

def _swatch(ink, extra=""):
    return ('<span class="pswatch" aria-hidden="true" style="background:%s%s"></span>'
            % (ink, extra))


def _strip(dim):
    """The inks of one dimension, as a little bar — what an option wears."""
    inks = inks_of(dim)
    if dim["kind"] == "ramp":
        # A ramp is drawn as a gradient, not as ten squares: it is one thing.
        return ('<span class="pramp" aria-hidden="true" style="background:'
                'linear-gradient(to right,%s)"></span>' % ",".join(inks))
    return ('<span class="pstrip" aria-hidden="true">%s</span>'
            % "".join(_swatch(i) for i in inks))


def control_html(g):
    """The rail control and the legend strip under it.

    `g` is build.py's globals, the same bundle every layer here takes: it
    needs `bi`, `bi_text` and `att`. Nothing else.
    """
    bi, bi_text, att = g["bi"], g["bi_text"], g["att"]
    opts = []
    for d in LIVE:
        # The inline background is the best-effort half of "the option wears
        # its swatch" — see the module docstring for where it is ignored.
        first = inks_of(d)[0] if inks_of(d) else ""
        style = (' style="background:%s;color:#FFFDF8"' % first) if first else ""
        opts.append('<option value="%s"%s%s>%s</option>'
                    % (att(d["key"]), style,
                       ' selected' if d["key"] == DEFAULT else '',
                       att(bi_text(d["label_th"], d["label_en"]))))
    sel = (
        '<label class="xbtn pbtn" title="%s">%s'
        '<select id="xpaint" aria-label="%s">%s</select></label>'
        % (att(bi_text("ระบายสีตาม", "colour by")),
           glyphs.icon("i-grid", 20),
           att(bi_text("ระบายสีตาม", "colour by")),
           "".join(opts)))
    # The strip: rendered for every live dimension, one shown at a time. Built
    # server-side so a reader with no scripting still sees what the colours on
    # a shared screenshot meant, and so the first paint carries no flash.
    strips = []
    for d in LIVE:
        rows = []
        if d["kind"] == "ramp":
            v = d["values"]
            if d["key"] == "rank":
                ends = v["ticks"]
                rows.append('<span class="prow">%s%s</span>'
                            % (_strip(d), bi(" ถึง ".join(t[1] for t in (ends[0], ends[-1])),
                                             " to ".join(t[2] for t in (ends[0], ends[-1])))))
            else:
                # The arrow is DRAWN, not typed. A U+2192 is whatever font
                # the reader has; i-arrow is the same mark the rest of the
                # site's chrome uses. (tests/test_paint.py catches a typed
                # one, and did.)
                rows.append('<span class="prow">%s%s%s%s</span>'
                            % (_strip(d), bi("ใกล้", "near"),
                               glyphs.icon("i-arrow", 14),
                               bi("ไกล", "far")))
                for (ink, (th, en)) in zip(inks_of(d), v["labels"]):
                    rows.append('<span class="prow">%s%s</span>'
                                % (_swatch(ink), bi("ในระยะ " + th, "within " + en)))
        else:
            for b in (d["values"] or ()):
                rows.append('<span class="prow" data-b="%s">%s%s'
                            '<span class="pn"></span></span>'
                            % (att(b["bucket"]), _swatch(b["ink"]), bi(b["th"], b["en"])))
        if d["key"] == "kind":
            rows = ['<span class="prow quiet">%s</span>'
                    % bi("สีตามชั้นที่เปิดไว้ — ดูที่ชิป",
                         "one ink per shelf switched on — the chips are the key")]
        strips.append('<div class="pkey" data-p="%s"%s>%s</div>'
                      % (att(d["key"]), "" if d["key"] == DEFAULT else " hidden",
                         "".join(rows)))
    return sel, '<div class="pkeys">%s</div>' % "".join(strips)


CSS = """/* paint_layer — colour by. The control is the legend. */
.pbtn{display:inline-flex;align-items:center;gap:.2rem;padding-right:.5rem}
.pbtn select{font:inherit;border:0;background:transparent;color:var(--ant-dark);
  font-weight:700;min-height:40px;max-width:13rem}
.pkeys{margin:.1rem 0 .5rem}
.pkey[hidden]{display:none}
.pkey{display:flex;flex-wrap:wrap;gap:.15rem .9rem;font-size:.86rem;
  color:var(--ink-soft);align-items:center}
.prow{display:inline-flex;align-items:center;gap:.35rem}
/* Same 12px dot the shelf chips wear, for the same reason: the swatch on the
   control is the ink on the map, at the size the map draws it. */
.pswatch{width:12px;height:12px;border-radius:50%;flex:none;
  border:1px solid rgba(0,0,0,.25)}
.pstrip{display:inline-flex;gap:2px}
.pramp{width:84px;height:12px;border-radius:2px;flex:none;
  border:1px solid rgba(0,0,0,.25)}
/* The count in view, per bucket. Never hidden when zero — a bucket that says
   0 is information; a bucket that vanishes is a map that looks tidier than
   the data is. */
.pn{color:var(--gloss);font-size:.8rem;font-variant-numeric:tabular-nums}
@media print{.pkeys{display:none}}
"""

JS = r"""/* paint.js — "colour by" on /map.html. WO-79.

   Attached by explore.js through MDPAINT.attach(ctx) once its map is ready.
   It owns exactly one thing: the circle-color of every shelf's -dot layer.
   It never adds a source, never adds a layer, never fetches a shelf, and
   never touches the ring, the stacks or the open-now rings — those are
   explore.js's and they keep meaning what they meant.

   THE THREE STATES. The open-now button lights a green RING and dims
   nothing, because a place with no hours on record is not closed. This
   control paints, so it has to say something about every dot — and what it
   says about the 93.6% is "no hours posted", in its own ink, with its own
   count in the legend. That count IS the feature: a reader watching
   fifty-eight thousand pale dots learns more about this catalogue than any
   sentence would tell them. */
window.MDPAINT=(function(){
var DIMS=%DIMS%, DEFAULT=%DEFAULT%;
var ctx=null,cur=DEFAULT,sel=null,keys=null;
var lamps={open:null,hours:null};

function dim(k){for(var i=0;i<DIMS.length;i++)if(DIMS[i].key===k)return DIMS[i];return null;}

/* ---- the paint expression, per dimension --------------------------------
   Everything below returns a MapLibre paint value for circle-color. */
function colourFor(shelfKey){
  var d=dim(cur);
  if(!d)return ctx.inkFor(shelfKey)||'#C2401C';

  if(d.key==='kind')return ctx.inkFor(shelfKey)||'#C2401C';

  if(d.key==='rank'){
    /* A step, not an interpolate: a rank is a count of facts, and 3 ants is
       not "a bit more than 2.6 ants". Ten stops, one hue, lightness only. */
    var e=['step',['coalesce',['get','rank'],0],d.values.stops[0]];
    for(var i=1;i<d.values.stops.length;i++)e.push(i,d.values.stops[i]);
    return e;
  }

  if(d.key==='dist'){
    /* THE RING'S OWN DISTANCE, not a second one. explore.js filters the ring
       with ['distance',{Point}] and counts it with metres(); this uses the
       same expression against the same centre, so a dot inside the ring and
       a dot in the nearest band can never disagree. */
    var c=ctx.map.getCenter();
    var pt={type:'Point',coordinates:[c.lng,c.lat]};
    var ex=['step',['distance',pt],d.values.stops[0]];
    for(var j=0;j<d.values.edges.length;j++)ex.push(d.values.edges[j],d.values.stops[j+1]);
    return ex;
  }

  if(d.key==='open'){
    var by={};
    d.values.forEach(function(b){by[b.bucket]=b.ink;});
    if(!lamps.hours)return by.nohours;   /* not fetched yet: nobody is called shut */
    return ['case',
      ['in',['get','id'],['literal',lamps.open||[]]],by.open,
      ['in',['get','id'],['literal',lamps.hours||[]]],by.shut,
      by.nohours];
  }
  return ctx.inkFor(shelfKey)||'#C2401C';
}

function repaint(){
  if(!ctx)return;
  Object.keys(ctx.loaded||{}).forEach(function(k){
    var id=ctx.srcId(k)+'-dot';
    if(ctx.map.getLayer(id))ctx.map.setPaintProperty(id,'circle-color',colourFor(k));
  });
  showKey();
  count();
}

/* ---- the legend, counted ------------------------------------------------
   Only the categorical dimensions carry per-bucket counts; a ramp's count is
   the shelf's own count, which the chips already print. */
function bucketOf(f){
  var d=dim(cur),p=f.properties||{};
  if(!d||d.kind!=='categorical')return null;
  if(d.key==='open'){
    if(!lamps.hours)return 'nohours';
    if((lamps.open||[]).indexOf(p.id)>-1)return 'open';
    if((lamps.hours||[]).indexOf(p.id)>-1)return 'shut';
    return 'nohours';
  }
  return null;
}
function count(){
  var d=dim(cur);
  if(!keys||!d||d.kind!=='categorical'||d.key==='kind')return;
  var box=keys.querySelector('.pkey[data-p="'+cur+'"]');
  if(!box)return;
  var b=ctx.map.getBounds(),c=ctx.map.getCenter(),tally={};
  (ctx.on||[]).forEach(function(k){
    var gj=(ctx.gjs||{})[k];
    if(!gj)return;
    gj.features.forEach(function(f){
      var xy=f.geometry.coordinates;
      if(xy[0]<b.getWest()||xy[0]>b.getEast()||xy[1]<b.getSouth()||xy[1]>b.getNorth())return;
      /* the ring, when it is on — the same metres() explore.js counts with */
      if(ctx.ringRadius&&ctx.ringRadius()&&
         ctx.metres(c.lat,c.lng,xy[1],xy[0])>ctx.ringRadius())return;
      var k2=bucketOf(f);
      if(k2)tally[k2]=(tally[k2]||0)+1;
    });
  });
  box.querySelectorAll('.prow[data-b]').forEach(function(row){
    var n=tally[row.dataset.b]||0;
    var el=row.querySelector('.pn');
    /* Zero is printed. See the CSS note. */
    if(el)el.textContent=n.toLocaleString();
  });
}
function showKey(){
  if(!keys)return;
  keys.querySelectorAll('.pkey').forEach(function(k){k.hidden=k.dataset.p!==cur;});
}

/* ---- openness: three sets, from the file explore.js already fetched -----
   `openIds` is explore.js's answer to "is it open right now", computed with
   its own weekMinute() clock. This never recomputes that. What it adds is a
   DIFFERENT question that explore.js never asked: which records have hours
   on record at all. */
function takeLamps(payload,openIds){
  lamps.open=openIds||[];
  var have=[];
  ((payload&&payload.places)||[]).forEach(function(p){
    var s=((payload.schedules)||[])[p.k];
    if(s&&s.length)have.push(p.id);
  });
  lamps.hours=have;
  repaint();
}

return {
  attach:function(c){
    ctx=c;
    sel=document.getElementById('xpaint');
    keys=document.querySelector('.pkeys');
    if(c.paint&&dim(c.paint))cur=c.paint;
    if(sel){
      sel.value=cur;
      sel.addEventListener('change',function(){
        cur=sel.value||DEFAULT;
        if(cur==='open'&&!lamps.hours&&ctx.needLamps)ctx.needLamps();
        repaint();
        if(ctx.onChange)ctx.onChange(cur);
      });
    }
    showKey();
    if(cur==='open'&&ctx.needLamps)ctx.needLamps();
    repaint();
  },
  /* explore.js calls these; each is one line at its call site */
  lamps:takeLamps,
  repaint:repaint,
  moved:function(){ if(cur==='dist'||dim(cur).kind==='categorical')repaint(); },
  current:function(){return cur;},
  isDefault:function(){return cur===DEFAULT;}
};
})();
"""


def _js():
    """paint.js, exactly as it ships."""
    live = []
    for d in LIVE:
        row = {"key": d["key"], "kind": d["kind"]}
        if d["kind"] == "ramp":
            v = dict(d["values"])
            v.pop("ticks", None)
            v.pop("labels", None)
            row["values"] = v
        elif d["values"]:
            row["values"] = [dict(b) for b in d["values"]]
        live.append(row)
    return (JS.replace("%DIMS%", json.dumps(live, ensure_ascii=False))
              .replace("%DEFAULT%", json.dumps(DEFAULT)))


def version():
    """Same reason as explore_layer.version(): a week-long cache under a name
    that never changes, and a reader holding yesterday's paint.js against
    today's page is how a working map comes up in the wrong colours."""
    return "%08x" % (zlib.crc32((_js() + CSS).encode("utf-8")) & 0xFFFFFFFF)


def emit(g):
    """Write paint.css and paint.js beside explore's own. Called from
    explore_layer.emit() — see notes/maps-grow-2026-09-08.txt §11 for the
    exact hook lines, which are NOT applied here."""
    docs = g["DOCS"]
    (docs / "paint.css").write_text(CSS)
    (docs / "paint.js").write_text(_js())
    return {"dimensions": len(LIVE), "dormant": len(DORMANT),
            "inks": sum(len(inks_of(d)) for d in LIVE)}


# ── the self-check, printed ──────────────────────────────────────────────────

def _print_report():
    import sys
    w = sys.stdout.write
    w("COLOUR VISION — the six shipping inks (explore_layer.INKS)\n")
    inks = [i for i, _ in explore_layer.INKS]
    names = [lbl.split(" · ")[-1] for _, lbl in explore_layer.INKS]
    r = cvd_report(inks, names)
    for k in ("normal vision",) + tuple(CVD_MODELS):
        w("  %-28s min ΔE00 %6.2f   %s / %s\n"
          % (k, r[k]["min_de00"], r[k]["pair"][0], r[k]["pair"][1]))
    w("  FLOOR across all simulations: %.2f — %s (working floor %.0f)\n"
      % (r["floor"], "SURVIVES" if r["survives"] else "DOES NOT SURVIVE", JND))

    w("\n  each ink against our own ground (only `paper` is a gate — see DOT_BAR):\n")
    for h, lbl in explore_layer.INKS:
        gr = ground_report(h)
        w("    %s %-18s paper %5.2f:1  casing %5.2f:1  water %5.2f:1\n"
          % (h, lbl.split(" · ")[-1], gr["paper"], gr["casing"], gr["water"]))

    w("\nTHE THREE STATES OF OPENNESS\n")
    trio = [OPEN_INK, SHUT_INK, NOHOURS_INK]
    r3 = cvd_report(trio, ["open", "shut", "no hours posted"])
    w("  floor %.2f — %s\n" % (r3["floor"], "survives" if r3["survives"] else "collides"))
    for h, n in zip(trio, ("open", "shut", "no hours posted")):
        gr = ground_report(h)
        w("    %s %-16s paper %5.2f:1  casing %5.2f:1  clears: %s\n"
          % (h, n, gr["paper"], gr["casing"], "yes" if gr["clears"] else "NO"))

    w("\nRAMPS — one hue, lightness only\n")
    for d in LIVE:
        if d["kind"] != "ramp":
            continue
        stops = inks_of(d)
        rep = ramp_report(stops)
        h0, _l0, s0 = colorsys.rgb_to_hls(*_rgb(stops[0]))
        dh = max(abs(colorsys.rgb_to_hls(*_rgb(s))[0] - h0) for s in stops)
        ds = max(abs(colorsys.rgb_to_hls(*_rgb(s))[2] - s0) for s in stops)
        w("  %-6s %d stops  hue drift %.2f deg (cap %.2f)  sat drift %.4f "
          "(cap %.4f)\n" % (d["key"], rep["n"], dh * 360, HUE_QUANT * 360,
                            ds, SAT_QUANT))
        w("         ends ΔE00 %.1f  smallest step %.2f  paper %.2f:1 → %.2f:1  "
          "all stops clear: %s\n"
          % (rep["ends_de00"], rep["min_step_de00"], rep["paper_lightest"],
             rep["paper_darkest"],
             "yes" if all(clears_ground(s) for s in stops) else "NO"))
        w("         %s\n" % " ".join(stops))

    w("\nDIMENSIONS: %d live, %d dormant\n" % (len(LIVE), len(DORMANT)))
    for d in DORMANT:
        w("  %-8s needs: %s\n" % (d["key"], d["needs"]))


if __name__ == "__main__":
    _print_report()
