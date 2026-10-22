#!/usr/bin/env python3
"""🔌 The public API — the baked half.

The site has published its whole corpus for as long as it has existed:
places.json, a .json beside every place page, per-category GeoJSON, llms.txt.
All of it was reachable only by something that could make a server-side
request, because no response carried an Access-Control-Allow-Origin, and all
of it was whole-file, because there was nothing to ask a question of. So the
licence said "reuse it, train on it, quote it" and a person who wanted the
clinics open right now within two kilometres had to download twenty-five
megabytes and write the filter themselves. That is a dump, not an API.

This module bakes the four files that turn it into one:

    docs/api/v1/index.json    the query index the Worker holds in memory
    docs/api/v1/schema.json   the frozen key contract, generated not written
    docs/api/v1/openapi.json  the spec, generated from the same lists
    docs/api/index.html       the page a person reads
    docs/terms.html           the terms: take it, credit us, that is all

The query logic itself is publish/api.js — it runs at the edge, not here.

WHY THE INDEX IS A BAKED FILE
-----------------------------
No database. The Worker already had an R2 binding and nothing else, and the
corpus changes once per build, so a file the isolate parses once and answers
thousands of requests from is both the simplest thing and the fastest. A D1
table would add a binding, a migration, a second source of truth, and a way
for a field to mean one thing on a page and another in the API. This cannot
drift that way: it is written by the build that writes the pages, in the same
pass, from the same records, through the same helpers. And it carries every
record — see the "nothing is filtered out" note in build_index() for why an
invisible filter is the one thing an API must not do to a caller.

THE THREE CONVENTIONS, CARRIED INTO THE JSON
--------------------------------------------
1. Absence is absence. A place whose hours nobody holds is absent from the
   schedule table, and the API answers `openNow: null` for it — never false.
   A place with no pin has no lat/lng and drops out of a near= query rather
   than being placed somewhere plausible.
2. Provenance travels. Every row says its confidence and whether it is
   OSM-derived, because the second one decides which licence the reader is
   standing under and they cannot be expected to guess.
3. Keys are a promise. v1's response keys are frozen and locked by
   tests/test_api.py. They may be added to. They are never removed, renamed
   or retyped; that is what v2 is for.

Entry point:
    emit(g, data, photos, tags)   after the lens layer, before the sitemap
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# THE FROZEN CONTRACT. Nothing below is edited without cutting /api/v2/.
# tests/test_api.py asserts every one of these against the built artefacts and
# against publish/api.js, so the four places that state the shape cannot drift.
# ---------------------------------------------------------------------------
SCHEMA_VERSION = 1

# Keys on every result of GET /api/v1/places.
RESULT_KEYS = [
    "id", "url", "apiUrl", "province", "name", "nameEn",
    "categories", "subcategories", "lat", "lng", "geoPrecision",
    "hours", "openNow", "antRank", "has", "tags", "lenses", "facets",
    "confidence", "osmDerived", "updatedAt", "photoUrl",
]
# Present only when the question was asked: distance needs a near=.
RESULT_KEYS_CONDITIONAL = ["distanceM"]

# The envelope around a list response.
ENVELOPE_KEYS = [
    "schemaVersion", "generated", "query", "total", "count", "limit", "offset",
    "results", "attribution", "licence", "terms",
]

# Keys on a row of the bulk index. Short because each travels 13,000 times.
# A row OMITS a key whose value would be null or empty — the reader is told
# so in schema.json, and it is the same rule the rest of the site follows:
# nothing is written down to say "we have nothing".
INDEX_ROW_KEYS = [
    "id", "slug", "province", "name", "nameEn", "cat", "sub", "lat", "lng",
    "geoPrecision", "antRank", "has", "hours", "sched", "tags", "lenses",
    "facets", "confidence", "osmDerived", "updatedAt", "photo", "q",
]

# The ant bits, which are also the vocabulary of ?has=. Named here rather than
# derived from a dict's key order, so the accepted values are a stated list.
HAS_VALUES = ["nameTh", "nameEn", "phone", "line", "hours", "web", "photo",
              "claimed", "fresh"]

ATTRIBUTION = "มดแดง Mot Dang · motdang.net"

# The semantic endpoint is not ours to re-implement and not ours to hide: it
# lives on the reader-assistant Worker, it is already open to every origin, and
# a person who wants meaning rather than substrings should be sent straight to
# it instead of being left to discover it.
SEMANTIC_SEARCH = "https://ask.motdang.net/api/search"


def _licence_block(base):
    return {
        "compilation": "CC-BY-4.0",
        "compilationUrl": "https://creativecommons.org/licenses/by/4.0/",
        "osmDerivedRows": "ODbL-1.0",
        "osmUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
        "photos": "not included — each carries its own credit on its page",
        "attribution": ATTRIBUTION,
        "terms": base + "terms.html",
    }


# ---------------------------------------------------------------------------
# the index
# ---------------------------------------------------------------------------

def _schedule_table(g):
    """Opening hours as minute-of-week intervals, from the file that already
    parses them.

    importers/build_open_lamps.py reads 4,375 hours strings, stands behind
    4,343 of them and refuses to guess at the other 32 — and it deduplicates
    the result down to 876 distinct weekly schedules, because a great many
    shops keep the same hours. Reusing its output means the API's idea of
    "open" is the same one the nitnoy map draws, to the minute, and that the
    32 it could not read stay unreadable here rather than being guessed at a
    second time by a second parser."""
    src = ROOT / "data" / "open_lamps.json"
    if not src.exists():
        return [], {}, "MISSING data/open_lamps.json — openNow is null everywhere"
    lamps = json.loads(src.read_text())
    by_id = {p["id"]: p["k"] for p in lamps.get("places", [])}
    return lamps.get("schedules", []), by_id, ""


# THE PROVINCE IS A WORD ON every ROW (Nan, 2026-09-10). "river tavern chiang
# rai" tested two words no row carried and answered nothing; the edge row now
# carries its city in both scripts, so the words land whether or not api.js
# lifts them into the province filter.
PROVINCE_WORDS = {"cm": ["เชียงใหม่", "chiang mai", "chiangmai"],
                  "cr": ["เชียงราย", "chiang rai", "chiangrai"]}


def _match_blob(g, r, tag_slugs):
    """The lowercased haystack ?q= tests against.

    Everything a person might type at a place that is not already a separate
    filter: both names, the other names a mapper wrote for readers of other
    scripts, the address (so "นิมมาน" finds the road), and the category and
    tag words in both languages. Thai is left exactly as it is — no case, no
    spaces, so a substring test is the right primitive and any tokenizer here
    would only be a worse copy of search-core's."""
    bi_parts = []
    th, en = g["name_pair"](r)
    attrs = r.get("attrs") or {}
    bi_parts += [r.get("name"), th, en, r.get("nameTh"), r.get("nameEn"),
                 r.get("address")]
    bi_parts += list(attrs.get("altNames") or [])
    bi_parts += list((attrs.get("namesOther") or {}).values())
    bi_parts += PROVINCE_WORDS.get(r.get("province") or "", [])
    for c in r.get("cat") or []:
        cd = g["CATS"].get(c)
        if cd:
            bi_parts += [cd.get("th"), cd.get("en"), c]
    bi_parts += list(r.get("sub") or [])
    bi_parts += list(tag_slugs or [])
    seen, out = set(), []
    for part in bi_parts:
        if not part:
            continue
        s = str(part).lower().strip()
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return " ".join(out)


def build_index(g, data, photos, tags):
    """Every published place, as one row the edge can filter in memory."""
    schedules, sched_by_id, sched_note = _schedule_table(g)
    lens_rows = g.get("LENS_ROWS") or {}
    claims = g.get("CLAIMS") or {}
    by_id = (tags or {}).get("by_id") or {}

    rows = []
    tag_seen, lens_seen, facet_seen = set(), set(), set()
    for p in g["PROVINCES"]:
        for r in data[p["key"]]:
            # NOTHING IS FILTERED OUT HERE, and that is the decision (Nan,
            # 2026-09-05): "give them the raw information and let them run
            # their own filters, whenever there's ambiguity."
            #
            # The first draft skipped held() records — no pin and two facts or
            # fewer, 1,711 of them — because the site's own search index skips
            # them. But held() never withheld a PAGE: those records have place
            # pages, sit on their shelves, and ship in the Hugging Face
            # dataset. Inheriting the search exclusion meant ?cat=realestate
            # answered 147 condos where the shelf itself lists 348, and left a
            # silent 1,711-row gap between our own dataset and our own API —
            # which reads as a bug in whichever of the two a caller trusts
            # less.
            #
            # A filter applied here is invisible: a caller cannot widen it and
            # cannot tell it happened. A filter EXPOSED costs them one query
            # parameter. So every record travels, and the fields that let a
            # caller thin it themselves travel with it — `antRank` with
            # ?min_ants=, and `geoPrecision`, which says "needs-pin" on
            # exactly the records the search index holds back.
            #
            # Raw means complete, not padded: this is not licence to invent a
            # value to fill a column. openNow stays null where hours are
            # unknown, and an unpinned record still has no coordinates.
            bits = g["ant_bits"](r)
            has = [k for k in HAS_VALUES if bits.get(k)]
            tag_slugs = sorted(by_id.get(r["id"]) or [])
            lens_keys = sorted({ln["key"] for ln, _row in (lens_rows.get(r["id"]) or [])})
            facet_keys = sorted((g["facet_bits"](r) or {}))
            tag_seen.update(tag_slugs)
            lens_seen.update(lens_keys)
            facet_seen.update(facet_keys)
            th, en = g["name_pair"](r)
            row = {
                "id": r["id"],
                "slug": g["place_slug"](r),
                "province": r["province"],
                "name": th or en or g["name_of"](r),
                "cat": list(r.get("cat") or []),
                "geoPrecision": r.get("geoPrecision") or "needs-pin",
                "antRank": g["ant_rank"](r),
                "groundTruth": g["ground_truth"](r),
                "has": has,
                "confidence": r.get("confidence"),
                # Which licence the reader is standing under, stated per row
                # rather than left to be worked out from the sources list.
                "osmDerived": any((s or {}).get("type") == "osm"
                                  for s in (r.get("sources") or [])),
                "updatedAt": r.get("updatedAt"),
                "q": _match_blob(g, r, tag_slugs),
            }
            # Omitted rather than nulled — 13,000 rows of "nameEn": null is a
            # megabyte spent saying nothing. schema.json states the rule.
            if en:
                row["nameEn"] = en
            if r.get("sub"):
                row["sub"] = list(r["sub"])
            if r.get("lat") is not None:
                row["lat"], row["lng"] = r["lat"], r["lng"]
            if r.get("hours"):
                row["hours"] = r["hours"]
            # No schedule for a shut or moved place (data/curated/status.json):
            # openNow stays null for it, the same as unknown hours.
            _st = r.get("status") if isinstance(r.get("status"), dict) else {}
            if r["id"] in sched_by_id and _st.get("state") not in ("closed", "moved"):
                row["sched"] = sched_by_id[r["id"]]
            if tag_slugs:
                row["tags"] = tag_slugs
            if lens_keys:
                row["lenses"] = lens_keys
            if facet_keys:
                row["facets"] = facet_keys
            # Only the real, credited photographs — never the wat.svg an
            # unphotographed listing wears, which would make `photoUrl` mean
            # "we have a picture" on 13,000 records that have none.
            _pf = (photos or {}).get(r["id"])
            if _pf:
                row["photo"] = _pf
            rows.append(row)

    base = g["BASE"]
    cats = [{"key": c, "th": g["CATS"][c]["th"], "en": g["CATS"][c]["en"],
             "subcategories": sorted({s for row in rows if c in row["cat"]
                                      for s in row.get("sub") or []}),
             "count": sum(1 for row in rows if c in row["cat"])}
            for c in g["CAT_ORDER"] if c in g["CATS"]]

    index = {
        "schemaVersion": SCHEMA_VERSION,
        "generated": g["BUILD_DATE"],
        "base": base,
        "terms": base + "terms.html",
        "docs": base + "api/",
        "attribution": ATTRIBUTION,
        "licence": _licence_block(base),
        "count": len(rows),
        # WHICH population `count` counts, said out loud — so a caller who
        # also holds the bulk dataset never has to work out a difference from
        # a mismatch. There is no difference: this is every record.
        "population": {
            "counted": "every record the directory holds — nothing is filtered out",
            "note": ("The site's own search box answers a narrower set: it "
                     "hides records with no pin and two facts or fewer. This "
                     "API does not, because you can apply that yourself and "
                     "we cannot un-apply it for you. min_ants= and "
                     "geoPrecision are the fields to do it with."),
            "thinRecords": ("?min_ants=3 drops the thinnest; "
                            "geoPrecision=needs-pin marks the unpinned"),
            "sameRecordsAs": base + "data/places.json",
        },
        "endpoints": {
            "descriptor": base + "api/v1/",
            "places": base + "api/v1/places",
            "place": base + "api/v1/places/{idOrSlug}",
            "search": base + "api/v1/search",
            "categories": base + "api/v1/categories",
            "tags": base + "api/v1/tags",
            "health": base + "api/v1/health",
            "openapi": base + "api/v1/openapi.json",
            "schema": base + "api/v1/schema.json",
            "bulk": base + "api/v1/index.json",
        },
        "alsoAvailable": {
            "everyField": base + "data/places.json",
            "perPlace": base + "{province}/p/{slug}.json",
            "geojsonPerCategory": base + "data/{province}-{category}.geojson",
            "plainText": base + "llms-full.txt",
            "semanticSearch": SEMANTIC_SEARCH + "?q={query}&n={1-20}",
        },
        "limits": {
            "key": "none — there is no key and no sign-up",
            "rateLimit": "none; please cache and send If-None-Match",
            "limitDefault": 20, "limitMax": 200,
            "radiusDefaultM": 2000, "radiusMaxM": 50000,
        },
        "hours": {
            "timezone": "Asia/Bangkok",
            "weekMinutes": 7 * 1440,
            "withKnownHours": sum(1 for row in rows if "sched" in row),
            "note": ("A place absent from the schedule table has UNKNOWN hours. "
                     "openNow is null for it, never false, and open_now=1 "
                     "excludes it rather than calling it shut. A place marked "
                     "shut or moved is absent from it too."),
        },
        "provinces": [{"key": p["key"], "th": p["th"], "en": p["en"],
                       "mode": p.get("mode"),
                       "count": sum(1 for row in rows if row["province"] == p["key"])}
                      for p in g["PROVINCES"]],
        "categories": cats,
        "tags": sorted(tag_seen),
        "lenses": sorted(lens_seen),
        "facets": sorted(facet_seen),
        "has": HAS_VALUES,
        "schedules": schedules,
        "places": rows,
    }
    if sched_note:
        index["hours"]["warning"] = sched_note  # stylecheck: allow — code key
    return index


# ---------------------------------------------------------------------------
# the spec and the schema, generated from the lists above
# ---------------------------------------------------------------------------

_PARAMS = [
    ("q", "string", "Substring match over name, other names, address, category "
                    "and tag words, in Thai or English. Space-separated terms "
                    "are ANDed. For meaning rather than letters use the "
                    "semantic endpoint named in the descriptor."),
    ("province", "string", "cm | cr"),
    ("cat", "string", "Comma-separated category keys; a place matching ANY of them."),
    ("sub", "string", "Comma-separated subcategory keys; ANY."),
    ("tag", "string", "Comma-separated tag slugs; ANY. See /api/v1/tags."),
    ("lens", "string", "Comma-separated lens keys; ANY."),
    ("facet", "string", "Comma-separated facet keys; ALL — each is a requirement."),
    ("has", "string", "Comma-separated from: " + ", ".join(HAS_VALUES) + "; ALL."),
    ("min_ants", "integer", "0–9. The ant rank is nine completeness checks, "
                            "not a quality score."),
    ("near", "string", "lat,lng. Places with no pin cannot answer this and drop "
                       "out of the result rather than being placed."),
    ("radius", "integer", "Metres from near=. Default 2000, max 50000."),
    ("bbox", "string", "west,south,east,north in degrees — the viewport as a question. "
             "Pinned rows inside the box; rows with no pin leave the answer."),
    ("open_now", "boolean", "Restrict to places open at this moment in "
                            "Asia/Bangkok. Unknown hours are EXCLUDED, not "
                            "called closed."),
    ("open_at", "string", "A time instead of now, e.g. 'Sa 18:30'. Wins over "
                          "open_now when both are given."),
    ("sort", "string", "distance | ants | name | relevance. Defaults to "
                       "distance with near=, relevance with q=, else ants."),
    ("limit", "integer", "Default 20, max 200. Asking for more gets the cap, "
                         "not an error."),
    ("offset", "integer", "For paging. total says how many matched."),
]


def openapi(base):
    def qp(name, typ, desc):
        return {"name": name, "in": "query", "required": False,
                "description": desc, "schema": {"type": typ}}
    result_props = {k: {} for k in RESULT_KEYS + RESULT_KEYS_CONDITIONAL}
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "มดแดง Mot Dang — Chiang Mai & Chiang Rai city directory",
            "version": f"1.0.0",
            "summary": "A Thai-first open directory, queryable. No key, no sign-up.",
            "description": (
                "Every place the site publishes, filterable by category, tag, "
                "facet, completeness, proximity and opening hours.\n\n"
                "Take the data. The only thing asked in return is attribution "
                "to มดแดง Mot Dang (motdang.net). Full terms: "
                + base + "terms.html"),
            "license": {"name": "CC BY 4.0 (compilation); ODbL 1.0 on OSM-derived rows",
                        "url": base + "terms.html"},
            "contact": {"url": base + "api/"},
        },
        "servers": [{"url": base + "api/v1"}],
        "paths": {
            "/": {"get": {"summary": "What this API is, and every endpoint in it",
                          "responses": {"200": {"description": "Service descriptor"}}}},
            "/places": {"get": {
                "summary": "Query places",
                "parameters": [qp(*p) for p in _PARAMS],
                "responses": {"200": {"description": "A page of results", "content": {
                    "application/json": {"schema": {"type": "object", "properties": {
                        "schemaVersion": {"type": "integer"},
                        "generated": {"type": "string"},
                        "query": {"type": "object"},
                        "total": {"type": "integer"},
                        "count": {"type": "integer"},
                        "limit": {"type": "integer"},
                        "offset": {"type": "integer"},
                        "results": {"type": "array", "items": {
                            "type": "object", "properties": result_props}},
                        "attribution": {"type": "string"},
                        "licence": {"type": "object"},
                        "terms": {"type": "string"},
                    }}}}}}}},
            "/places/{idOrSlug}": {"get": {
                "summary": "One place, every field",
                "description": "The same object the place page serves "
                               "at its own URL with .json — one generator, so the "
                               "API and the page cannot disagree.",
                "parameters": [{"name": "idOrSlug", "in": "path", "required": True,
                                "schema": {"type": "string"},
                                "description": "The stable id or the page slug. The id is "
                                               "unique; a page slug can be shared by two "
                                               "records, and a shared one is answered with "
                                               "300 and the candidate ids rather than a guess."}],
                "responses": {"200": {"description": "The full record"},
                              "300": {"description": "The page slug is shared by more than "
                                                     "one record; `candidates` lists them by "
                                                     "id. Ask again by id."},  # stylecheck: allow — API documentation for developers
                              "404": {"description": "No such place"}}}},
            # publish/worker.js searchHandler(): searchcore over the shards
            # under api/v1/edge/. limit and offset travel inside `query` here.
            "/search": {"get": {
                "summary": "Places ranked by words, as the site's search box ranks them",
                "parameters": [
                    qp("q", "string", "Words in Thai or English. A city named here "
                                      "narrows to its province."),
                    qp("province", "string", "cm | cr"),
                    qp("limit", "integer", "Default 20, max 200."),
                    qp("offset", "integer", "For paging. total says how many matched."),
                ],
                "responses": {
                    "200": {"description": "A page of ranked results", "content": {
                        "application/json": {"schema": {"type": "object", "properties": {
                            "schemaVersion": {"type": "integer"},
                            "generated": {"type": "string"},
                            "engine": {"type": "string"},
                            "query": {"type": "object"},
                            "total": {"type": "integer"},
                            "count": {"type": "integer"},
                            "tier": {"type": ["string", "null"],
                                     "description": "exact | thesaurus | loose | partial, "
                                                    "of the first result"},
                            "notes": {"type": "array", "items": {"type": "string"},
                                      "description": "How q was read: mended, segmented, "
                                                     "stopwords, widened, intent"},
                            "results": {"type": "array", "items": {
                                "type": "object", "properties": dict(
                                    result_props, score={"type": "number"},
                                    tier={"type": "string"})}},
                            "attribution": {"type": "string"},
                            "licence": {"type": "object"},
                            "terms": {"type": "string"},
                        }}}}},
                    "500": {"description": "The engine broke on this query; /places?q= answers"},
                    "503": {"description": "The search shards are not published; /places?q= answers"},
                }}},
            "/categories": {"get": {"summary": "The category tree with live counts",
                                    "responses": {"200": {"description": "Categories"}}}},
            "/tags": {"get": {"summary": "Every tag, lens and facet key in use",
                              "responses": {"200": {"description": "Vocabularies"}}}},
            "/health": {"get": {"summary": "Is the index loaded, and how old is it",
                                "responses": {"200": {"description": "OK"},
                                              "503": {"description": "Index unavailable"}}}},
            "/index.json": {"get": {
                "summary": "The whole query index in one file",
                "description": "Take this instead of paging if you want more than "
                               "a few hundred rows. It is the same data the "
                               "endpoints answer from.",
                "responses": {"200": {"description": "Bulk index"}}}},
        },
    }


def schema(base):
    return {
        "schemaVersion": SCHEMA_VERSION,
        "stability": {
            "promise": ("Keys listed here are frozen for the life of /api/v1/. "
                        "Keys may be ADDED to v1. None is ever removed, renamed "
                        "or retyped — a change that would break a reader gets "
                        "/api/v2/ at a different address, and v1 keeps running "
                        "beside it for at least twelve months after v2 opens."),
            "lockedBy": "tests/test_api.py, which fails the build if this drifts",
            "versionIn": "the URL path, not a header",
        },
        "envelope": ENVELOPE_KEYS,
        "result": {
            "always": RESULT_KEYS,
            "conditional": {
                "distanceM": "only when near= was given",
            },
            "nullMeansUnknown": [
                "openNow — null when nobody holds this place's hours, or when the "
                "place is marked shut or moved. Never "
                "false-because-unknown.",
                "lat / lng — null when the place is known but not yet pinned; "
                "geoPrecision says which.",
                "nameEn, hours, updatedAt — null when the record does not carry one.",
            ],
        },
        "bulkIndexRow": {
            "keys": INDEX_ROW_KEYS,
            "omissionRule": ("A row OMITS any key whose value would be null or "
                             "an empty list. Absent means unknown or none — it "
                             "never means false. `sched` indexes the top-level "
                             "`schedules` table; absent means unknown hours."),
        },
        "vocabularies": {
            "has": HAS_VALUES,
            "geoPrecision": ["exact", "block", "approx", "needs-pin"],
            "province": ["cm", "cr"],
            "sort": ["distance", "ants", "name", "relevance"],
            "liveKeys": base + "api/v1/tags",
        },
        "fullRecord": {
            "url": base + "api/v1/places/{idOrSlug}",
            "note": ("The full record is the place page's own .json sibling, "
                     "which carries every field including sources, channels, "
                     "retiredLinks, antBits, facets, lenses and licence. Its "
                     "optional keys follow the same omission rule."),
        },
        "terms": base + "terms.html",
        "attribution": ATTRIBUTION,
    }


# ---------------------------------------------------------------------------
# the two pages a person reads
# ---------------------------------------------------------------------------

def _terms_page(g):
    bi = g["bi"]
    base = g["BASE"]

    def h2(th, en):
        return f'<h2>{bi(th, en)}</h2>'

    def ul(pairs):
        return "<ul>" + "".join(f"<li>{bi(th, en)}</li>" for th, en in pairs) + "</ul>"

    body = (
        f'<h1>{bi("เงื่อนไขการใช้ข้อมูล", "Terms of use")}</h1>'
        f'<p class="lead">{bi("เอาไปใช้ได้เลย ให้เครดิตกลับมาที่ มดแดง ก็พอ", "Take it. Credit มดแดง Mot Dang. That is the whole deal.")}</p>'

        + h2("สิ่งที่ทำได้ ไม่ต้องขอ", "Allowed, without asking")
        + ul([
            ("ใช้ ทำสำเนา ดัดแปลง แปล และเผยแพร่ต่อ",
             "Use, copy, adapt, translate and redistribute it"),
            ("ใช้ในเชิงพาณิชย์ ขายสินค้าหรือบริการที่สร้างจากข้อมูลนี้ได้",
             "Use it commercially — sell a product or a service built on it"),
            ("ใช้ฝึกโมเดล AI ทั้งชุด ไม่มีข้อยกเว้น",
             "Train a model on it, the whole corpus, no carve-outs"),
            ("ใส่ในแอป ในเว็บ ในสิ่งพิมพ์ ในแผนที่ ในงานวิจัย",
             "Put it in an app, a site, a print run, a map, a paper"),
            ("ดึงข้อมูลผ่าน API หรือโหลดไฟล์ทั้งชุดไปเก็บไว้เองก็ได้",
             "Call the API, or take the bulk file and never call us again"),
        ])
        + f'<p>{bi("ไม่ต้องสมัคร ไม่มีคีย์ ไม่มีค่าธรรมเนียม ไม่ต้องทำสัญญา", "No sign-up, no key, no fee, no contract.")}</p>'

        + h2("เครดิต", "Attribution")
        + ul([
            ("ถ้าข้อมูลปรากฏให้คนเห็น ให้เครดิต “มดแดง Mot Dang” พร้อมลิงก์ไปที่ motdang.net ตรงหน้านั้น หรือในหน้าเกี่ยวกับ/เครดิตของแอป",
             "Where the data is visible, credit “มดแดง Mot Dang” with a link to motdang.net — on the page, or in an app's About/Credits screen"),
            ("ถ้าใช้ฝึกโมเดล ให้ระบุในเอกสารชุดข้อมูลหรือ model card",
             "If you train on it, name it in the dataset lineage or model card"),
            ("ถ้าเผยแพร่ข้อมูลต่อ ให้เก็บฟิลด์ sources ของแต่ละรายการไว้ด้วย — นั่นคือเครดิตของคนอื่น ไม่ใช่ของเรา",
             "If you republish the records, keep each one's `sources` field — that credit belongs to other people, not to us"),
        ])

        + h2("สองสัญญาอนุญาต", "The two licences")
        + f'<p>{bi("การรวบรวม การจัดหมวดหมู่ อันดับมด ป้ายและคำอ่านไทย-อังกฤษ และข้อมูลที่เราออกไปเก็บเอง อยู่ภายใต้ CC BY 4.0", "The compilation — the selection, the categories, the ant rank, the Thai and English labels and readings, and every field we went and collected ourselves — is CC BY 4.0.")} '
        f'<a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a></p>'
        f'<p>{bi("ฟิลด์ที่มาจากแผนที่ยังเป็นของ © OpenStreetMap contributors ภายใต้ ODbL 1.0 — ทุกรายการมีฟิลด์ osmDerived บอกไว้ ถ้าคุณเผยแพร่ ‘ฐานข้อมูล’ ที่สร้างต่อจากรายการเหล่านั้น ฐานข้อมูลนั้นก็ติด ODbL ไปด้วย", "Map-derived fields remain © OpenStreetMap contributors under ODbL 1.0. Every record carries an osmDerived flag saying whether it is one. If you publish a derived DATABASE built on those rows, that database carries ODbL too — share-alike applies to the database, not to a work you make with it.")} '
        f'<a href="https://opendatacommons.org/licenses/odbl/1-0/" rel="noopener">ODbL 1.0</a></p>'
        f'<p>{bi("ภาพถ่ายไม่รวมอยู่ในนี้ — แต่ละภาพมีเครดิตและสัญญาอนุญาตของตัวเองอยู่ที่หน้าภาพ", "Photos are NOT covered by this. Each one carries its own credit and licence beside it; see the pictures page.")}</p>'

        + h2("ข้อจำกัด", "Limits")
        + ul([
            ("เวลาเปิด-ปิดและเบอร์โทรเปลี่ยนได้ตลอด ร้านปิดกิจการไปแล้วก็มี",
             "Hours and phone numbers change; a place may have closed since we last looked"),
            ("การมีชื่ออยู่ในสารบัญไม่ใช่การรับรอง",
             "Being listed is not an endorsement"),
            ("อย่าใช้เป็นแหล่งเดียวสำหรับเหตุฉุกเฉิน การตัดสินใจทางการแพทย์ หรือที่อยู่ทางกฎหมาย",  # stylecheck: allow — API terms of use
             "Do not use it as the only source for an emergency, a medical decision, or a legal address"),  # stylecheck: allow — API terms of use
            ("ข้อมูลให้ตามสภาพ ไม่มีการรับประกันใด ๆ ทั้งสิ้น",
             "Provided as-is, with no warranty of any kind"),
        ])

        + h2("อย่าทำ", "Not allowed")  # stylecheck: allow — API terms of use
        + ul([
            ("อย่าทำให้เข้าใจว่ามดแดงรับรองคุณ หรือว่าข้อเท็จจริงที่คุณเพิ่มเองมาจากเรา",  # stylecheck: allow — API terms of use
             "Do not imply that Mot Dang endorses you, or that a fact you added came from us"),  # stylecheck: allow — API terms of use
            ("อย่าลบที่มาของข้อมูลแล้วเผยแพร่เหมือนเป็นการสำรวจของคุณเอง",  # stylecheck: allow — API terms of use
             "Do not strip the provenance and republish it as your own survey"),  # stylecheck: allow — API terms of use
            ("ข้อมูลติดต่อที่เจ้าของร้านกรอกเองให้ไว้สำหรับสารบัญ ไม่ใช่สำหรับทำรายชื่อส่งโฆษณา",
             "Owner-supplied contact details were given for a directory listing, not for a marketing list"),
        ])

        + h2("มารยาทในการเรียกใช้", "Caller etiquette")
        + f'<p>{bi("ขอแค่ช่วยกันประหยัด", "Two things that keep it cheap to serve:")}</p>'
        + ul([
            ("แคชคำตอบไว้ และส่ง If-None-Match มาด้วย — ทุกคำตอบมี ETag",
             "Cache, and send If-None-Match — every response carries an ETag"),
            ("ถ้าต้องการเกินไม่กี่ร้อยรายการ โหลดไฟล์ชุดเดียวจบไปเลย ดีกว่ายิงทีละหน้า",
             "If you want more than a few hundred rows, take the bulk file instead of paging"),
            ("ใส่ชื่อและวิธีติดต่อใน User-Agent เผื่อมีอะไรเปลี่ยน เราจะได้บอกได้",
             "Put a name and a contact in your User-Agent, so we can tell you if something changes"),
        ])

        + h2("คีย์ของ /api/v1/", "The /api/v1/ keys")
        + f'<p>{bi("ทุกคีย์ที่รุ่นนี้ออก", "Every key this version emits")} '
        f'<a href="api/v1/schema.json"><code>api/v1/schema.json</code></a>.</p>'

        f'<p class="count">{bi("ปรับปรุงล่าสุด", "Last updated")} {g["BUILD_DATE"]} · '
        f'<a href="api/">{bi("เอกสาร API", "API documentation")}</a> · '
        f'<a href="source/">{bi("โค้ดและข้อมูลดิบ", "source and raw data")}</a></p>'
        + g["share_block"](base + "terms.html", "เงื่อนไขการใช้ข้อมูล · Terms of use")
    )
    return g["page"](
        "เงื่อนไขการใช้ข้อมูล", body, depth=0, path="terms.html",
        desc="เอาข้อมูลมดแดงไปใช้ได้เลย CC BY 4.0 — ขอแค่ให้เครดิต motdang.net")


def _api_page(g, index):
    bi = g["bi"]
    base = g["BASE"]
    ex = lambda url, th, en: (
        f'<li><code><a href="{url}">{url.replace(base, "/")}</a></code><br>'
        f'<span class="count">{bi(th, en)}</span></li>')

    params_rows = "".join(
        f'<tr><td><code>{n}</code></td><td>{g["esc"](d)}</td></tr>'
        for n, _t, d in _PARAMS)

    body = (
        f'<h1>{bi("API สาธารณะ", "The public API")} '
        f'<span class="count">({index["count"]:,} {bi("แห่ง", "places")})</span></h1>'
        f'<p class="lead">{bi("ไม่ต้องสมัคร ไม่มีคีย์ เรียกจากเบราว์เซอร์ได้เลย (CORS เปิดทุก origin)", "No sign-up, no key, open to every origin — call it straight from a browser.")}</p>'

        f'<h2>{bi("ลองเลย", "Try it")}</h2>'
        f'<ul class="dir">'
        + ex(base + "api/v1/places?q=ก๋วยเตี๋ยว&limit=5",
             "ค้นด้วยคำไทย", "search in Thai")
        + ex(base + "api/v1/places?cat=medical&open_now=1&near=18.7883,98.9853&radius=3000",
             "คลินิกที่เปิดอยู่ตอนนี้ ในรัศมี 3 กม. จากประตูท่าแพ",
             "medical, open right now, within 3 km of Tha Phae Gate")
        + ex(base + "api/v1/places?cat=wat&province=cm&sort=ants&limit=10",
             "วัดในเชียงใหม่ เรียงตามความครบของข้อมูล",
             "Chiang Mai wats, most completely known first")
        + ex(base + "api/v1/categories", "หมวดหมู่ทั้งหมดพร้อมจำนวนจริง",
             "the category tree with live counts")
        + ex(base + "api/v1/", "บอกว่า API นี้มีอะไรบ้าง", "what this API is and every endpoint in it")
        + f'</ul>'

        f'<h2>{bi("ปลายทาง", "Endpoints")}</h2>'
        f'<ul class="dir">'
        f'<li><code>GET /api/v1/places</code> <span class="count">· {bi("ค้นและกรอง", "query and filter")}</span></li>'
        f'<li><code>GET /api/v1/places/{{id หรือ slug}}</code> <span class="count">· {bi("รายการเดียว ครบทุกฟิลด์", "one place, every field")}</span></li>'
        f'<li><code>GET /api/v1/categories</code> · <code>GET /api/v1/tags</code> <span class="count">· {bi("คำศัพท์ที่ใช้กรองได้", "the filter vocabularies")}</span></li>'
        f'<li><code>GET /api/v1/index.json</code> <span class="count">· {bi("ดัชนีทั้งชุดในไฟล์เดียว — เอาไปเลย ไม่ต้องเรียกซ้ำ", "the whole index in one file — take it and stop calling us")}</span></li>'
        f'<li><code>GET /api/v1/openapi.json</code> · <code>GET /api/v1/schema.json</code> · <code>GET /api/v1/health</code></li>'
        f'</ul>'

        f'<h2>{bi("พารามิเตอร์ของ /places", "Parameters for /places")}</h2>'
        f'<table class="credits"><thead><tr><th>{bi("ชื่อ", "name")}</th><th>{bi("ความหมาย", "meaning")}</th></tr></thead>'
        f'<tbody>{params_rows}</tbody></table>'

        f'<h2>{bi("กฎที่สำคัญที่สุดสามข้อ", "The three rules that matter most")}</h2>'
        f'<ol>'
        f'<li><b>{bi("ไม่มีข้อมูล ไม่เท่ากับ ไม่มีอยู่", "Absent is not false")}</b> — '
        f'{bi("ร้านที่เราไม่มีเวลาเปิด-ปิด จะได้ openNow เป็น null ไม่ใช่ false และ open_now=1 จะคัดออก ไม่ใช่บอกว่าปิด", "a place whose hours nobody holds gets openNow: null, never false — and open_now=1 excludes it rather than calling it shut")} '
        f'<span class="count">({index["hours"]["withKnownHours"]:,} {bi("แห่งมีเวลาเปิดปิดที่อ่านได้", "have hours we can stand behind")})</span></li>'
        f'<li><b>{bi("ยังไม่ปักหมุด ก็ตอบคำถามระยะทางไม่ได้", "No pin, no distance answer")}</b> — '
        f'{bi("รายการที่ยังไม่มีพิกัดจะหลุดออกจากคำค้นแบบ near= แทนที่จะถูกวางมั่ว ๆ ดู geoPrecision", "a record with no coordinates drops out of a near= query rather than being placed plausibly; geoPrecision says which kind it is")}</li>'
        f'<li><b>{bi("คีย์ไม่เปลี่ยน", "The keys hold still")}</b> — '
        f'{bi("คีย์ใน v1 เพิ่มได้ แต่ไม่ลบ ไม่เปลี่ยนชื่อ ไม่เปลี่ยนชนิด", "v1 keys may be added to; none is removed, renamed or retyped")} · '
        f'<a href="v1/schema.json"><code>schema.json</code></a></li>'
        f'<li><b>{bi("ข้อมูลดิบ กรองเอง", "Raw, and you do the filtering")}</b> — '
        f'{bi("API ส่งทุกรายการที่สารบัญมี ไม่กรองอะไรออกก่อน ช่องค้นหาบนเว็บซ่อนรายการที่ยังไม่ปักหมุดและมีข้อมูลไม่เกินสองอย่าง แต่ API ไม่ซ่อน เพราะคุณกรองเองได้ แต่กรองคืนไม่ได้ ใช้ min_ants= กับ geoPrecision", "the API returns every record the directory holds. The site search box hides records with no pin and two facts or fewer; this does not, because you can apply that yourself and cannot un-apply ours. min_ants= and geoPrecision are the fields for it")}</li>'
        f'</ol>'

        f'<h2>{bi("อยากได้ความหมาย ไม่ใช่ตัวอักษร", "Meaning, not letters")}</h2>'
        f'<p>{bi("ตัวกรอง q= จับตัวอักษรตรง ๆ ถ้าอยากได้การค้นเชิงความหมายสองภาษา ใช้", "The q= filter matches letters. For bilingual semantic search, use")} '
        f'<code><a href="{SEMANTIC_SEARCH}?q=นวดแผนไทย&amp;n=5">{SEMANTIC_SEARCH}?q=…&amp;n=…</a></code> — '
        f'{bi("เปิดทุก origin เหมือนกัน ไม่ต้องใช้คีย์", "same open origin policy, no key")}.</p>'

        f'<h2>{bi("ทางอื่นที่เอาข้อมูลไปได้", "Other ways to take it")}</h2>'
        f'<ul class="dir">'
        f'<li><code><a href="../data/places.json">/data/places.json</a></code> <span class="count">· {bi("ทุกสถานที่ ทุกฟิลด์", "every place, every field")}</span></li>'
        f'<li><code>/{{cm|cr}}/p/{{slug}}.json</code> <span class="count">· {bi("ไฟล์คู่ของทุกหน้าสถานที่ เดา URL ได้ถูกทุกครั้ง", "a .json beside every place page — guess the URL and you are right")}</span></li>'
        f'<li><code>/data/{{cm|cr}}-{{หมวด}}.geojson</code> <span class="count">· {bi("แยกตามหมวด พร้อมใช้กับแผนที่", "per category, ready for a map")}</span></li>'
        f'<li><code><a href="../llms-full.txt">/llms-full.txt</a></code> <span class="count">· {bi("ทุกแห่ง บรรทัดละหนึ่ง ไม่ต้องแกะอะไร", "every place, one line each, nothing to strip")}</span></li>'
        f'</ul>'

        f'<h2>{bi("เงื่อนไข", "Terms")}</h2>'
        f'<p>{bi("เอาไปใช้ได้เลย รวมถึงเชิงพาณิชย์และการฝึกโมเดล ขอแค่ให้เครดิต “มดแดง Mot Dang” พร้อมลิงก์ ฟิลด์ที่มาจากแผนที่ยังเป็นของ OpenStreetMap ภายใต้ ODbL", "Take it — commercially, for training, for anything. Credit “มดแดง Mot Dang” with a link. Map-derived fields stay © OpenStreetMap contributors under ODbL.")} '
        f'<a class="pill" href="../terms.html">{bi("อ่านเงื่อนไขฉบับเต็ม", "Read the full terms")}</a></p>'
        f'<p class="licence">{bi(g["LICENSE_LINE_TH"], g["LICENSE_LINE_EN"])}</p>'
        + g["share_block"](base + "api/", "API สาธารณะของมดแดง · The Mot Dang public API")
    )
    return g["page"](
        "API สาธารณะ", body, depth=1, path="api/index.html",
        desc=f"API สารบัญเชียงใหม่-เชียงราย {index['count']:,} แห่ง ไม่ต้องสมัคร ไม่มีคีย์ CC BY 4.0")


# ---------------------------------------------------------------------------

def emit(g, data, photos, tags):
    """Write the API's four files and the terms page. Returns a status line."""
    docs = g["DOCS"]
    base = g["BASE"]
    v1 = docs / "api" / "v1"
    v1.mkdir(parents=True, exist_ok=True)

    index = build_index(g, data, photos, tags)
    (v1 / "index.json").write_text(json.dumps(index, ensure_ascii=False))
    (v1 / "schema.json").write_text(
        json.dumps(schema(base), ensure_ascii=False, indent=1))
    (v1 / "openapi.json").write_text(
        json.dumps(openapi(base), ensure_ascii=False, indent=1))
    (docs / "api" / "index.html").write_text(_api_page(g, index))
    (docs / "terms.html").write_text(_terms_page(g))

    mb = (v1 / "index.json").stat().st_size / 1e6
    return (f'{index["count"]:,} places · {len(index["schedules"])} schedules · '
            f'{index["hours"]["withKnownHours"]:,} with hours · index {mb:.1f} MB'
            + _emit_grid(g, docs) + _emit_rows(docs))


def _drop_rows(docs):
    """A failed emit leaves no older rows beside the new index."""
    import shutil
    shutil.rmtree(docs / "api" / "v1" / "rows", ignore_errors=True)


def _emit_rows(docs):
    """api/v1/rows/ beside index.json (publish/emit_rows.mjs): the packed rows
    /api/v1/search keeps in the isolate. Without it the search reads index.json
    again on every question, 7-15 s."""
    import subprocess
    script = ROOT / "publish" / "emit_rows.mjs"
    try:
        r = subprocess.run(["node", "--max-old-space-size=4096", str(script), str(docs)],
                           capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.TimeoutExpired) as e:
        _drop_rows(docs)
        return f"\n  ! rows not written ({e.__class__.__name__}) — /api/v1/search reads the index"
    if r.returncode:
        _drop_rows(docs)
        return (f"\n  ! rows not written (node exit {r.returncode}) — /api/v1/search reads the index\n"
                + r.stderr.strip()[-400:])
    return "\n" + r.stdout.rstrip()


def _emit_grid(g, docs):
    """api/v1/grid/ beside index.json (publish/emit_grid.mjs). Without it the
    Worker answers ?bbox= by walking the index, seconds per call."""
    import subprocess
    script = ROOT / "publish" / "emit_grid.mjs"
    try:
        r = subprocess.run(["node", "--max-old-space-size=4096", str(script), str(docs)],
                           capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.TimeoutExpired) as e:
        return f"\n  ! grid not written ({e.__class__.__name__}) — ?bbox= walks the index"
    if r.returncode:
        return (f"\n  ! grid not written (node exit {r.returncode}) — ?bbox= walks the index\n"
                + r.stderr.strip()[-400:])
    return "\n" + r.stdout.rstrip()
