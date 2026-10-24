#!/usr/bin/env python3
"""Fold the existing corpora into Mot Dang canonical records. Zero network.

Sources (all sibling repos under ~/Developer/claude code projects/):
  thai-answers/catalog.db                          316 massage venues   -> cm/massage
  cm-womens-health/data/crawled/osm-health.json    258 health places    -> cm/medical (+essentials for pharmacies)
  mueang-map/data/canonical/osm.json               378 CM lens points   -> cm/wat, cm/food, cm/sights
  mueang-map/data/canonical/osm-chiang-rai.json    289 CR wats          -> cr/wat  (wireframe seed)
  data/curated/featured-chiang-rai.json            hand-entered field truth (never overwritten)
  data/curated/additions-chiang-mai.json           CM places no crawl carries, each with dated sources
  data/curated/additions-chiang-rai.json           CR places no crawl carries, same bar as the CM file
  data/curated/names.json                          names a crawl left empty, each with its source
  data/curated/story_hooks.json                    one line of history per marquee place, each with its source
  data/curated/shelves.json                        extra cat/sub for places OSM's one primary tag hid
  data/curated/merges.json                         duplicate records folded, human-confirmed pairs only
  data/curated/wat_registry.json                   รหัสวัด + founding year + nikaya, from importers/import_wat_registry.py
  data/curated/condo_register.json                 the Treasury's registered อาคารชุด + assessed value, from importers/harvest_condo_register.py
  data/curated/status.json                         places shut or moved, by id, each with who reported it and when

Output: data/canonical/cm.json, data/canonical/cr.json, and the same records in
data/places.sqlite (placedb.py), one row a place
Curated/field records always win over crawled ones with the same source ref.
"""
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECTS = ROOT.parent

LENS_TO_CAT = {
    "wat": ["wat"],
    "spirit-house": ["wat"],
    "pad-krapow": ["food"],
    # "tattoo" mapped to sights from before the tattoo category existed; the
    # Overpass crawl then filed the same 31 points under tattoo/studio, so
    # every studio rode both shelves (WO-14, 2026-08-19). All 31 mueang-map
    # tattoo points are inside cache/overpass/cm/tattoo.json, so pointing the
    # lens at its own category loses nothing and empties nothing.
    "tattoo": ["tattoo"],
    "library": ["sights"],
    "art-studio": ["sights"],
    "views": ["sights"],
}


def rec(id, province, cat, name, name_th=None, name_en=None, lat=None, lng=None,
        precision="exact", address=None, phone=None, website=None, hours=None,
        attrs=None, sources=None, confidence="crawled"):
    return {
        "id": id, "province": province, "cat": cat,
        "name": name, "nameTh": name_th, "nameEn": name_en,
        "lat": lat, "lng": lng, "geoPrecision": precision,
        "address": address, "phone": phone, "website": website, "hours": hours,
        "attrs": attrs or {}, "featured": False, "landmark": False,
        "sources": sources or [], "confidence": confidence,
        "updatedAt": "2026-07-27",
    }


def import_thai_answers():
    db = PROJECTS / "thai-answers" / "catalog.db"
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    out = []
    for r in con.execute("select * from venues"):
        ref = f"{r['osm_type']}/{r['osm_id']}"
        name = r["name"] or r["name_en"]
        if not name:  # a directory has no shelf for the nameless; a named re-crawl restores them
            continue
        out.append(rec(
            id=f"cm-osm-{r['osm_type']}-{r['osm_id']}", province="cm", cat=["massage"],
            name=name, name_en=r["name_en"], lat=r["lat"], lng=r["lon"],
            phone=r["phone"], website=r["website"], hours=r["opening_hours"],
            attrs={"inOldCity": bool(r["in_old_city"])},
            sources=[{"type": "osm", "ref": ref, "fetched": (r["fetched_at"] or "")[:10],
                      "via": "thai-answers"}],
        ))
    con.close()
    return out


def import_womens_health():
    data = json.loads((PROJECTS / "cm-womens-health" / "data" / "crawled" / "osm-health.json").read_text())
    out = []
    for r in data:
        a = r.get("attrs", {})
        ftype = a.get("facilityType") or "clinic"
        # A ร้านขายยา is on both shelves and always was. It is where most
        # people here go FIRST with a fever — medical — and it is also one of
        # the handful of shops a neighbourhood cannot do without, beside the
        # bank and the post office. It used to be filed under essentials only,
        # which meant somebody browsing for medicine never met one.
        cat = ["essentials", "medical"] if ftype == "pharmacy" else ["medical"]
        src = (r.get("sources") or [{}])[0]
        ref = src.get("ref", f"cmwh/{r['id']}")
        if not (r.get("nameTh") or r.get("name") or r.get("nameEn")):
            continue
        out.append(rec(
            id="cm-osm-" + ref.replace("/", "-"), province="cm", cat=cat,
            name=r.get("nameTh") or r.get("name") or r.get("nameEn"),
            name_th=r.get("nameTh"), name_en=r.get("nameEn"),
            lat=r.get("lat"), lng=r.get("lng"), precision=r.get("geoPrecision", "exact"),
            phone=a.get("phone"), website=a.get("website"), hours=a.get("openingHours"),
            attrs={"facilityType": ftype, "obgyn": a.get("obgyn"), "operator": a.get("operator")},
            sources=[{"type": src.get("type", "osm"), "ref": ref,
                      "fetched": src.get("fetched", ""), "via": "cm-womens-health"}],
        ))
    return out


def import_mueang_map(fname, province):
    data = json.loads((PROJECTS / "mueang-map" / "data" / "canonical" / fname).read_text())
    out = []
    for r in data:
        lenses = r.get("lens", [])
        cats = sorted({c for l in lenses for c in LENS_TO_CAT.get(l, [])}) or ["sights"]
        src = (r.get("sources") or [{}])[0]
        ref = src.get("ref", f"mm/{r['id']}")
        if not (r.get("name") or r.get("nameRoman")):
            continue
        out.append(rec(
            id=f"{province}-osm-" + ref.replace("/", "-"), province=province, cat=cats,
            name=r.get("name") or r.get("nameRoman"),
            name_en=r.get("nameRoman"),
            lat=r.get("lat"), lng=r.get("lng"), precision=r.get("geoPrecision", "exact"),
            address=r.get("address"),
            attrs=dict(r.get("attrs", {}), lens=lenses),
            sources=[{"type": src.get("type", "osm"), "ref": ref,
                      "fetched": src.get("fetched", ""), "via": "mueang-map"}],
            confidence=r.get("confidence", "crawled"),
        ))
    return out


def apply_specialty(records, province):
    """Fill attrs.specialty on medical records, from the tag or the sign.

    Run after the merge so it sees every source at once — a CITIZENinfo
    hospital and a crawled clinic get read the same way. See
    importers/specialty.py for why this is a field and not a shelf tree.
    """
    import specialty as _sp
    tags = {}
    cache = ROOT / "cache" / "overpass" / province
    if cache.exists():
        for f in sorted(cache.glob("*.json")):
            for el in json.loads(f.read_text()).get("elements", []):
                if el.get("tags"):
                    tags[f"{el['type']}/{el['id']}"] = el["tags"]
    n = 0
    for r in records:
        if "medical" not in (r.get("cat") or []):
            continue
        ref = (r.get("sources") or [{}])[0].get("ref", "")
        got, how = _sp.of(r, tags.get(ref))
        if got:
            r.setdefault("attrs", {})["specialty"] = got
            r["attrs"]["specialtyVia"] = how
            n += 1
    return n


def apply_lgbtq(records, province):
    """Carry lgbtq welcome tags from the crawl into attrs.

    OpenStreetMap lets a mapper state that a venue welcomes or primarily
    serves the LGBTQ+ community (lgbtq=welcome/primary, lgbtq:trans=welcome).
    The crawl has held a few of these all along and import dropped them —
    found while building /trans-health.html (WO-26), which is what reads
    them. A tag is a MAPPER's statement, not the venue's own sign, and the
    page says which. Same cache read as apply_specialty; any category, since
    a bar or a cafe is exactly where the tag lives.
    """
    tags = {}
    cache = ROOT / "cache" / "overpass" / province
    if cache.exists():
        for f in sorted(cache.glob("*.json")):
            for el in json.loads(f.read_text()).get("elements", []):
                if el.get("tags"):
                    tags[f"{el['type']}/{el['id']}"] = el["tags"]
    n = 0
    for r in records:
        ref = (r.get("sources") or [{}])[0].get("ref", "")
        t = tags.get(ref) or {}
        got = False
        if t.get("lgbtq"):
            r.setdefault("attrs", {})["lgbtq"] = t["lgbtq"]
            got = True
        if t.get("lgbtq:trans"):
            r.setdefault("attrs", {})["lgbtqTrans"] = t["lgbtq:trans"]
            got = True
        if got:
            n += 1
    return n


def apply_curated_pins(records):
    """Coordinates from data/curated/pins.json, applied after the merge.

    2,116 records carried geoPrecision "needs-pin" — real, addressed, and on
    no map. 945 of them were temples from the ONAB register, which states a
    ตำบล and an อำเภอ and no coordinate at all. Two passes fill what can
    defensibly be filled: importers/pin_from_osm.py matches a record to a
    SURVEYED OpenStreetMap point by name within its province, refusing any
    name that answers to more than one place; importers/geocode_gaps.py
    infers a point from the written address with importers/geocode_local.py,
    using only this catalogue's own ground.

    A SURVEYED PIN ALWAYS WINS. This only ever fills an empty one — it never
    argues with a point somebody walked to.

    Every pin brought in here is stamped attrs.pinVia, which is also how
    geocode_local knows to keep it OUT of its own gazetteer: a centroid built
    from inferred points would site the next inference on the last one, and
    the error would compound quietly, run after run.
    """
    path = ROOT / "data" / "curated" / "pins.json"
    if not path.exists():
        # SAY SO. This file went missing once and the only symptom was a
        # silent zero: the import ran clean, the pins were simply not there,
        # and the site rebuilt without them. An absent overlay is a fact worth
        # one line, because the alternative is finding out from a map.
        gaps = sum(1 for r in records
                   if (r.get("geoPrecision") or "exact") == "needs-pin")
        print(f"  no data/curated/pins.json — {gaps} record(s) stay unpinned "
              f"(regenerate: importers/geocode_gaps.py --write, "
              f"then importers/pin_from_osm.py --write)")
        return 0
    pins = (json.loads(path.read_text()) or {}).get("pins") or {}
    by_id = {r["id"]: r for r in records}
    n = 0
    for rid, p in pins.items():
        r = by_id.get(rid)
        if not r:
            continue
        if r.get("lat") and (r.get("geoPrecision") or "exact") != "needs-pin":
            continue
        r["lat"], r["lng"] = p["lat"], p["lng"]
        # NOTHING THAT COMES THROUGH THIS FILE IS "exact", INCLUDING THE OSM
        # MATCHES. pin_from_osm.py's own header argues the other way — "these
        # are surveyed points, not inferences, and they should not be dressed
        # as approximations" — and it is half right: the COORDINATE is
        # surveyed. What is derived is the claim that it belongs to THIS
        # record, and that claim is a name match. tests/test_pins.py states
        # the same idea from the other side: a record carrying a pinVia has
        # had its pin derived from something, and "exact" means nobody derived
        # it. The two contracts had never met until 2026-09-05, because
        # pins.json had never once been written. This is the reading that
        # survives both: the reader is told (โดยประมาณ), the receipt says
        # which OSM element and how, and geocode_local still keeps every one
        # of them out of its own gazetteer so the error cannot compound.
        r["geoPrecision"] = "approx"
        a = r.setdefault("attrs", {})
        # THE MARK THAT MAKES THIS RE-RUNNABLE. A record pinned from here is
        # `approx`, not `needs-pin`, so it no longer looks like a gap — and the
        # pass that pinned it would skip it forever after, silently measuring a
        # smaller problem every run. pinSource says "this pin was inferred by
        # the curated overlay", which is a fact about the RECORD and survives
        # wherever the overlay file happens to be.
        a["pinSource"] = "curated-pins"
        a["pinVia"] = p.get("via", "")
        a["pinUncertaintyM"] = str(p.get("uncertainty_m", ""))
        a["pinFrom"] = str(p.get("from", ""))
        r.setdefault("sources", []).append({
            "type": "osm" if p.get("tier") == "osm" else "derived",
            "ref": str(p.get("from", "")),
            "fetched": p.get("fetched", ""),
            "via": p.get("source", ""),
        })
        n += 1
    return n


def apply_curated_shelves(records):
    """Extra shelves from data/curated/shelves.json, applied after the merge.

    OSM allows one primary tag per place, so the crawl files Hub 53 under
    hotel/guesthouse and never sees the coworking floor that is the other half
    of its name. Entries here union cat/sub onto an existing record by id and
    append their source to its provenance. They add shelves only — a curated
    shelf never removes or argues with a crawled one.
    """
    path = ROOT / "data" / "curated" / "shelves.json"
    if not path.exists():
        return 0
    fixes = (json.loads(path.read_text()) or {}).get("shelves") or {}
    by_id = {r["id"]: r for r in records}
    n = 0
    for rid, fix in fixes.items():
        r = by_id.get(rid)
        if not r:
            continue
        before = (set(r.get("cat") or []), set(r.get("sub") or []),
                  dict(r.get("attrs") or {}))
        r["cat"] = sorted(set(r.get("cat") or []) | set(fix.get("add_cat") or []))
        r["sub"] = sorted(set(r.get("sub") or []) | set(fix.get("add_sub") or []))
        # add_lens is the same union for shelves that claim records by a lens
        # (food/made-to-order reads attrs.lens for "pad-krapow", sights/library
        # for "library"). Before 2026-09-05 the only way to put a record on such
        # a shelf from here was set_attrs, which REPLACES the whole lens list.
        if fix.get("add_lens"):
            a = r.setdefault("attrs", {})
            a["lens"] = sorted(set(a.get("lens") or []) | set(fix["add_lens"]))
        # set_attrs is for shelves that match on an attr (medical/dentist and
        # essentials/pharmacy match attrs.facilityType, not sub). Curated truth
        # wins over a crawled value — same tier rule as the record merge — and
        # the appended source line says where the new value came from.
        for k, v in (fix.get("set_attrs") or {}).items():
            r.setdefault("attrs", {})[k] = v
        # add_offers is what a place OFFERS, as against what it IS. A massage
        # shop's sub says thai-traditional because that is the trade on its
        # sign; ตอกเส้น is a line on the menu inside. Both are true, and until
        # this key existed the only way to record the second was to claim it
        # was the first. Each item carries its own provenance — where it was
        # read and when — because an offer read off a third-party listing is a
        # weaker thing than one read off the shop's own page, and a reader is
        # owed the difference. Merged by key, never overwritten: the first
        # source to state an offer keeps its receipt.
        if fix.get("add_offers"):
            a = r.setdefault("attrs", {})
            have = {o.get("k") for o in (a.get("offers") or [])}
            for off in fix["add_offers"]:
                if off.get("k") in have:
                    continue
                a.setdefault("offers", []).append({
                    "k": off["k"],
                    "via": off.get("via", "web-listing"),
                    "seen": off.get("seen") or fix.get("fetched", ""),
                    "url": off.get("url") or fix.get("source", ""),
                })
        after = (set(r["cat"]), set(r["sub"]), dict(r.get("attrs") or {}))
        if after != before:
            r.setdefault("sources", []).append(
                {"type": "curated", "ref": fix.get("source", ""),
                 "fetched": fix.get("fetched", ""), "via": "data/curated/shelves.json"})
            n += 1
    return n


def apply_curated_retags(records):
    """Shelves taken away from a record, from data/curated/retags.json.

    shelves.json only ever adds, and that is right for what it is — a second
    identity OSM's one primary tag could not hold. This file is the other,
    rarer case: the primary tag itself is wrong about the door. หรรษา
    มินิกอล์ฟ / Hansa Minigolf is mapped shop=tattoo and sat on the tattoo
    shelf for three weeks with its name saying minigolf in three languages.
    A curated reading outranks a crawled tag (the tier rule), but only with a
    receipt: every entry names the evidence a person read, the date, and the
    shelves it removes — nothing is taken away silently, and the fix ledger
    (data/fixes.json) carries the same correction for readers. Fix upstream in
    OSM as well when you can; this file is the interim, not the answer.

    {
      "retags": {
        "<id>": {"drop_cat": [...], "drop_sub": [...],
                 "add_cat": [...], "add_sub": [...],
                 "evidence": "…", "fetched": "YYYY-MM-DD", "note": "…"}
      }
    }
    """
    path = ROOT / "data" / "curated" / "retags.json"
    if not path.exists():
        return 0
    fixes = (json.loads(path.read_text()) or {}).get("retags") or {}
    by_id = {r["id"]: r for r in records}
    n = 0
    for rid, fix in fixes.items():
        r = by_id.get(rid)
        if not r:
            continue
        if not fix.get("evidence"):
            raise SystemExit(f"retags.json: {rid} has no evidence line — "
                             "a shelf is not removed without one")
        before = (set(r.get("cat") or []), set(r.get("sub") or []))
        cats = (set(r.get("cat") or []) - set(fix.get("drop_cat") or [])) | set(fix.get("add_cat") or [])
        if not cats:
            # A record is never left shelfless by a correction; name the
            # shelf it should stand on, or do not drop the last one.
            raise SystemExit(f"retags.json: {rid} would be left with no "
                             "category — add add_cat or drop less")
        r["cat"] = sorted(cats)
        r["sub"] = sorted((set(r.get("sub") or []) - set(fix.get("drop_sub") or []))
                          | set(fix.get("add_sub") or []))
        after = (set(r["cat"]), set(r["sub"]))
        if after != before:
            r.setdefault("sources", []).append(
                {"type": "curated", "ref": fix.get("evidence", ""),
                 "fetched": fix.get("fetched", ""), "via": "data/curated/retags.json"})
            n += 1
    return n


def apply_curated_status(records, path=None):
    """Shut or moved, from data/curated/status.json, applied after the merge.

    {"status": {id: {"state": "closed"|"moved", "since": "YYYY-MM-DD",
    "to": "<url or text>", "source": "<who>", "reported": "YYYY-MM-DD"}}};
    `since` is when the place shut or moved, `reported` when someone told us.
    A file with the ids at the
    top level reads the same. The record keeps every shelf and page it had —
    build.py prints the state under the name and lights no open-now lamp.
    Any other state is left alone. The appended source line says who
    reported it and, when `reported` is held, when — never `since`, which
    would print a closing date as the day the source was read. `path` is for
    the test.
    """
    path = path or ROOT / "data" / "curated" / "status.json"
    if not path.exists():
        return 0
    doc = json.loads(path.read_text()) or {}
    fixes = doc.get("status") if isinstance(doc.get("status"), dict) else \
        {k: v for k, v in doc.items() if not k.startswith("_")}
    by_id = {r["id"]: r for r in records}
    n = 0
    for rid, fix in fixes.items():
        r = by_id.get(rid)
        if not r or not isinstance(fix, dict) or fix.get("state") not in ("closed", "moved"):
            continue
        status = {"state": fix["state"], "since": fix.get("since", ""),
                  "source": fix.get("source", "")}
        if fix.get("to"):
            status["to"] = fix["to"]
        r["status"] = status
        r.setdefault("sources", []).append(
            {"type": "curated", "ref": fix.get("source", ""),
             "fetched": fix.get("reported", ""), "via": "data/curated/status.json"})
        n += 1
    return n


def apply_curated_merges(records):
    """Fold duplicate records from data/curated/merges.json: {keep_id: [drop_ids]}.

    The crawl can hold one venue twice — mapped as both a node and a way, or
    caught by two groups (The Social Club: one record filed hotel, one filed
    coworking). Each merge keeps keep_id's record, unions the dropped record's
    shelves and sources into it, and fills only fields keep_id lacks. Merging
    is a curated decision because near-same-name-nearby is not proof: a
    restaurant inside its hotel is two separate records, not a dupe.
    """
    path = ROOT / "data" / "curated" / "merges.json"
    if not path.exists():
        return records, 0
    merges = (json.loads(path.read_text()) or {}).get("merges") or {}
    drop_to_keep = {d: k for k, drops in merges.items() for d in drops}
    by_id = {r["id"]: r for r in records}
    n = 0
    for drop_id, keep_id in drop_to_keep.items():
        dr, kr = by_id.get(drop_id), by_id.get(keep_id)
        if not dr or not kr:
            continue
        kr["cat"] = sorted(set(kr.get("cat") or []) | set(dr.get("cat") or []))
        kr["sub"] = sorted(set(kr.get("sub") or []) | set(dr.get("sub") or []))
        for k in ("nameTh", "nameEn", "phone", "website", "hours", "address"):
            kr[k] = kr.get(k) or dr.get(k)
        # The kept record keeps its own pin, so the dropped record's account of
        # how ITS pin was made (pinVia, pinUncertaintyM, ...) stays behind with
        # it. Carried over, a postcode centroid's ±2,504 m was sitting on
        # Overture's own coordinate, marked exact (tests/test_pins.py, 10/10).
        d_attrs = dict(dr.get("attrs") or {})
        if kr.get("lat") is not None:
            for k in [k for k in d_attrs if k.startswith("pin")]:
                del d_attrs[k]
        kr["attrs"] = {**d_attrs, **(kr.get("attrs") or {})}
        kr["sources"] = (kr.get("sources") or []) + (dr.get("sources") or []) + [
            {"type": "curated", "ref": f"merged duplicate {drop_id}",
             "fetched": "", "via": "data/curated/merges.json"}]
        del by_id[drop_id]
        n += 1
    return sorted(by_id.values(), key=lambda r: r["id"]), n


def apply_curated_names(records):
    """Hand-filled names from data/curated/names.json, applied last.

    A crawl can leave a place with a name in one language and nothing in the
    other. On the ไหว้พระ ๙ วัด rounds that included Wat Chedi Luang, Wat
    Chiang Man and Wat Phan Tao carrying no Thai at all on a Thai-first site —
    while the Thai name sat unused in each record's own attrs.summary, the
    title of the th.wikipedia article already fetched for it.

    Only the `names` block is applied, and only over an empty field: a curated
    name fills a gap, it never argues with a crawled one. Leads live in
    `unverified` and are never rendered, for the same reason honours.json keeps
    its own — a name is the thing on the page that most has to be right.
    """
    path = ROOT / "data" / "curated" / "names.json"
    if not path.exists():
        return 0
    fixes = (json.loads(path.read_text()) or {}).get("names") or {}
    by_id = {r["id"]: r for r in records}
    n = 0
    for rid, fix in fixes.items():
        r = by_id.get(rid)
        if not r:
            continue
        for field in ("nameTh", "nameEn", "name"):
            if fix.get(field) and not r.get(field):
                r[field] = fix[field]
                r.setdefault("sources", []).append(
                    {"type": "curated", "ref": fix.get("source", ""),
                     "fetched": "", "via": "data/curated/names.json"})
                n += 1
    return n


def apply_curated_story_hooks(records):
    """Hand-written story hooks from data/curated/story_hooks.json.

    A marquee place — the Three Kings, the wat that held the city pillar —
    reaches the crawl as a bare name and a pin, when the one thing a reader
    wants from it is the line of history that makes it matter. Hooks land as
    blurb_th/blurb_en, the fields the place page and its meta description
    already render, and only over an empty field: a curated story fills a
    gap, it never argues with a blurb already on the record. Same sourcing
    rule as names.json — every hook carries a fetched URL, and a story a
    chronicle carries but primary documents do not is worded as tradition.
    """
    # Nan, 2026-09-06: no blurbs on the site. The hooks stay on disk as
    # sourced material and are NOT applied; tests/test_no_blurbs.py holds it.
    return 0
    path = ROOT / "data" / "curated" / "story_hooks.json"
    if not path.exists():
        return 0
    fixes = (json.loads(path.read_text()) or {}).get("hooks") or {}
    by_id = {r["id"]: r for r in records}
    n = 0
    for rid, fix in fixes.items():
        r = by_id.get(rid)
        if not r:
            continue
        filled = False
        for field in ("blurb_th", "blurb_en"):
            if fix.get(field) and not r.get(field):
                r[field] = fix[field]
                filled = True
        if filled:
            r.setdefault("sources", []).append(
                {"type": "curated", "ref": fix.get("source", ""),
                 "fetched": fix.get("fetched", ""),
                 "via": "data/curated/story_hooks.json"})
            n += 1
    return n


def apply_wat_registry(records):
    """The ONAB temple register, joined by importers/import_wat_registry.py.

    Every wat on the shelf reached us as a name and a pin. The register holds
    what a temple actually is on paper — its permanent รหัสวัด, the year it was
    founded, its nikaya, its rank, its wisung-khamsima date and the ตำบล/อำเภอ
    it stands in. That is the whole of the ancientness sort and most of the
    by-neighbourhood grouping.

    `sect` is the one field the crawl also carries, and it reads "unknown" on
    all 588 of them, so the register fills rather than argues. Contact fields
    fill only an empty one, as every curated source does — though the register
    holds a phone for six temples in the country and none of them are here.
    """
    path = ROOT / "data" / "curated" / "wat_registry.json"
    if not path.exists():
        return 0
    joined = (json.loads(path.read_text()) or {}).get("wats") or {}
    by_id = {r["id"]: r for r in records}
    fields = (("code", "watCode"), ("rank", "watRank"), ("sect", "sect"),
              ("founded_be", "foundedBE"), ("founded_ce", "foundedCE"),
              ("wisung", "wisung"), ("wisung_date", "wisungDate"),
              ("tambon_th", "tambon"), ("amphoe_th", "amphoe"),
              ("name_th", "watRegisterName"))
    n = 0
    for rid, reg in joined.items():
        r = by_id.get(rid)
        if not r:
            continue
        attrs = r.setdefault("attrs", {})
        for src, dest in fields:
            if reg.get(src) in (None, ""):
                continue
            # the crawl's placeholder is not an answer, so it does not defend
            if attrs.get(dest) in (None, "", "unknown"):
                attrs[dest] = reg[src]
        for field in ("phone", "website"):
            if reg.get(field) and not r.get(field):
                r[field] = reg[field]
        r.setdefault("sources", []).append(
            {"type": "register", "ref": reg["code"], "fetched": "",
             "via": "data/curated/wat_registry.json", "note": reg.get("matched_how", "")})
        n += 1
    return n


def apply_parking_locators(records, prov):
    """Give every SYNTHESISED parking name the one fact that tells it apart.

    WO-67. 1,711 of the 1,796 parking features in these two provinces carry no
    name, so import_overpass names them from their tags — and the tags say the
    same thing about nearly all of them. Left there, the shelf is 1,229 rows
    reading ที่จอดรถ, which is a worse answer than none: a reader cannot pick.

    What tells one car park from another is WHERE IT IS, and bearings_layer
    (WO-64) already computes exactly that sentence from the pin. Every one of
    the 1,796 gets at least one line, and the ones that matter most get the
    best line: there are lots 80 m and 100 m from Tha Phae Gate, and they can
    say so.

        ที่จอดรถ · ใกล้ประตูท่าแพ 80 ม.      Parking · 80 m from Tha Phae Gate
        ลานจอดรถ · ย่านแม่ริม                Car park · Mae Rim
        ที่จอดมอเตอร์ไซค์ Nim city           (an operator already named it)

    Done here rather than in the importer because a bearing needs the merged
    record — the curated pin passes run first, and a pin corrected by hand
    should move the name that quotes it.

    A NAME A MAPPER WROTE IS NEVER TOUCHED. The test is the provenance grade
    the importer stamped, not a guess from the string: `derived` means we
    wrote it, `stated` means they did. That is the whole reason the grade is
    written at the moment the name is made.
    """
    import sys as _sys
    if str(ROOT) not in _sys.path:
        _sys.path.insert(0, str(ROOT))
    import bearings_layer
    park = [r for r in records
            if "parking" in (r.get("sub") or [])
            and ((r.get("provenance") or {}).get("name") or {}).get("how") == "derived"]
    if not park:
        return 0
    c = bearings_layer.ctx(by_id={r["id"]: r for r in records}, force=True)
    # In order of how much a person standing in the street can use it. A gate
    # or a landmark beats a district name; a district name beats a distance
    # from a gate ten kilometres away, which is true and nearly useless on its
    # own — but it is what we have for a lot in Chom Thong, so it is what that
    # lot says.
    ORDER = ("at", "address", "moat", "near", "zone", "city")
    done = 0
    for r in park:
        lines = {l["kind"]: l for l in bearings_layer.bearings(r, c)}
        line = next((lines[k] for k in ORDER if k in lines), None)
        if not line:
            continue
        # The moat line is "quarter · N m from the gate"; the gate half is the
        # half a person navigates by, so take it when it is there.
        th = line["th"].split(" · ")[-1].strip()
        en = line["en"].split(" · ")[-1].strip()
        if not th or not en:
            continue
        # The name BEFORE the bearing, kept so the search index can match on it
        # instead of on the whole string. A bearing is for a reader's eye: it
        # says which car park this is. Matched as text it made every lot near
        # Tha Phae Gate answer to the gate's own name, so typing ประตูท่าแพ
        # returned 179 rows of car parks and put the gate itself fourth.
        # Display keeps the bearing; the index matches the base. The landmark
        # sort is what answers "near the gate", and it does it with metres.
        a = r.setdefault("attrs", {})
        a["nameBase"] = r["name"]
        if r.get("nameEn"):
            a["nameBaseEn"] = r["nameEn"]
        r["name"] = f'{r["name"]} · {th}'
        if r.get("nameTh"):
            r["nameTh"] = f'{r["nameTh"]} · {th}'
        if r.get("nameEn"):
            r["nameEn"] = f'{r["nameEn"]} · {en}'
        done += 1
    return done


def write_places(prov, final, f):
    """The province's rows in data/places.sqlite, after its JSON file (placedb.py,
    ticket 82). If this fails the JSON stands, and build.py reads that instead."""
    import sys as _sys
    if str(ROOT) not in _sys.path:
        _sys.path.insert(0, str(ROOT))
    try:
        import placedb
        new, moved, gone = placedb.write(prov, final, f)
        if new or moved or gone:
            print(f"{prov}: places database: {new} new, {moved} changed, {gone} gone")
    except Exception as e:
        print(f"{prov}: places database not written ({type(e).__name__}: {e}); the build reads the JSON")


def drop_places(prov):
    import sys as _sys
    if str(ROOT) not in _sys.path:
        _sys.path.insert(0, str(ROOT))
    try:
        import placedb
        placedb.drop(prov)
    except Exception as e:
        print(f"{prov}: places database not updated ({type(e).__name__}: {e})")


# Provinces crawled beyond the first two: Pathum Thani (Nan 2026-10-12). Each
# is merged by finish_crawled() and written to data/canonical/ only once its
# data/coverage.json entry carries "release": true; until then to
# cache/staging/, where nothing the build reads will find it.
CRAWLED = {"pth"}


def extract_records(prov):
    """A province answered from a Geofabrik extract (importers/osm_extract.py):
    the crawl groups through import_overpass, restamped with the extract's
    date, and the wats from wats.extra — CM and CR take their wats from
    mueang-map, which has no Pathum Thani."""
    import import_overpass
    cache = ROOT / "cache" / "overpass" / prov
    meta = cache / "EXTRACT"
    if not meta.exists():
        return import_overpass.records(prov)
    fname, stamp, _ = (meta.read_text().strip().split("\t") + ["", ""])[:3]
    day = stamp[:10] or __import__("datetime").date.today().isoformat()
    out = import_overpass.records(prov)
    for r in out:
        for src in r.get("sources") or []:
            if src.get("via") == "mot-dang overpass":
                src["fetched"] = day
                src["via"] = f"geofabrik {fname}"
    wats = cache / "wats.extra"
    if wats.exists():
        for el in json.loads(wats.read_text()).get("elements", []):
            t = el.get("tags", {})
            name = t.get("name") or t.get("name:th")
            if not name:
                continue
            c = el.get("center") or el
            ref = f"{el['type']}/{el['id']}"
            out.append(rec(
                id=f"{prov}-osm-{el['type']}-{el['id']}", province=prov, cat=["wat"],
                name=name, name_th=t.get("name:th"), name_en=t.get("name:en"),
                lat=c.get("lat"), lng=c.get("lon"),
                address=" ".join(x for x in (t.get("addr:housenumber"), t.get("addr:street"),
                                             t.get("addr:subdistrict"), t.get("addr:district"))
                                 if x) or None,
                phone=t.get("phone") or t.get("contact:phone"),
                website=t.get("website") or t.get("contact:website"),
                attrs={"lens": ["wat"]},
                sources=[{"type": "osm", "ref": ref, "fetched": day,
                          "via": f"geofabrik {fname}"}]))
    return out


def finish_crawled(prov, records, outdir, entry):
    """A crawled province that has no registers yet: the tier merge, facets,
    the hand-kept passes and derive. The cm/cr registers (schools, condos,
    Overture, open data) are keyed to those two and are not run."""
    import sys as _sys
    if str(ROOT) not in _sys.path:
        _sys.path.insert(0, str(ROOT))
    import facts as _facts
    import import_fixtures
    tier = {"third-party": -1, "crawled": 0, "official": 1, "curated": 2, "field": 3}
    by_id = {}
    for r in sorted(records, key=lambda r: tier[r.get("confidence", "curated")]):
        r.setdefault("sub", [])
        r.setdefault("attrs", {})
        ex = by_id.get(r["id"])
        if ex:
            r["cat"] = sorted(set(ex["cat"]) | set(r["cat"]))
            r["sub"] = sorted(set(ex.get("sub", [])) | set(r.get("sub", [])))
            for k in ("phone", "website", "hours", "address"):
                r[k] = r.get(k) or ex.get(k)
            r["attrs"] = {**ex.get("attrs", {}), **r.get("attrs", {})}
        by_id[r["id"]] = r
    final = sorted(by_id.values(), key=lambda r: r["id"])
    # A shelf the site does not have (the extract answers groups CM and CR
    # never asked, `reading` → "read") is taken off; a record left with none
    # is not written. build.py has no page for either.
    shelves = {c["key"] for c in json.loads(
        (ROOT / "data" / "categories.json").read_text())["categories"]}
    dropped = {}
    for r in final:
        for c in r["cat"]:
            if c not in shelves:
                dropped[c] = dropped.get(c, 0) + 1
        r["cat"] = [c for c in r["cat"] if c in shelves]
    final = [r for r in final if r["cat"]]
    if dropped:
        print(f"{prov}: shelves the site does not have, taken off: "
              + ", ".join(f"{k} {v}" for k, v in sorted(dropped.items())))
    import_fixtures.apply(final, prov)
    apply_curated_names(final)
    apply_curated_story_hooks(final)
    _facts.apply(final, _facts.load_all(ROOT / "data" / "curated"))
    apply_curated_pins(final)
    apply_curated_shelves(final)
    apply_curated_retags(final)
    apply_curated_status(final)
    final, _ = apply_curated_merges(final)
    import derive as _derive
    _derive.TODAY = __import__("datetime").date.today().isoformat()
    counts = {}
    for name, fn in _derive.PASSES:
        try:
            fn(final, prov, counts)
        except Exception as e:  # a pass keyed to cm/cr; the record keeps its field empty
            print(f"{prov}: derive {name} skipped ({type(e).__name__}: {e})")
    if entry.get("release"):
        f = outdir / f"{prov}.json"
    else:
        f = ROOT / "cache" / "staging" / f"{prov}.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        stale = outdir / f"{prov}.json"
        if stale.exists():
            stale.unlink()
        drop_places(prov)
    f.write_text(json.dumps(final, ensure_ascii=False, indent=1), encoding="utf-8")
    if entry.get("release"):
        write_places(prov, final, f)
    print(f"{prov}: {len(final)} records → {f.relative_to(ROOT)}"
          f"{'' if entry.get('release') else ' (staged, not released)'}")


def write_passive(outdir, passive, coverage):
    """The provinces we do not crawl, one canonical file each, only while it
    holds a record: build.py gives a province its pages when its file is
    there and not empty. No register, Overture or derive pass runs on these —
    they are keyed to the two crawled provinces — only the hand-kept ones."""
    import sys as _sys
    if str(ROOT) not in _sys.path:
        _sys.path.insert(0, str(ROOT))
    import facts as _facts
    for pk in sorted(coverage - {"cm", "cr"} - CRAWLED):
        f = outdir / f"{pk}.json"
        records = passive.get(pk)
        if not records:
            if f.exists():
                f.unlink()
                print(f"{pk}: nothing held — canonical file removed")
            drop_places(pk)
            continue
        by_id = {}
        for r in records:
            r.setdefault("sub", [])
            r.setdefault("attrs", {})
            r.setdefault("confidence", "curated")
            by_id[r["id"]] = r
        final = sorted(by_id.values(), key=lambda r: r["id"])
        _facts.apply(final, _facts.load_all(ROOT / "data" / "curated"))
        apply_curated_names(final)
        apply_curated_pins(final)
        apply_curated_status(final)
        final, _ = apply_curated_merges(final)
        f.write_text(json.dumps(final, ensure_ascii=False, indent=1), encoding="utf-8")
        write_places(pk, final, f)
        print(f"{pk}: {len(final)} records (passive — not crawled)")


def main():
    import import_overpass
    import import_fixtures
    import aircon_stated
    import import_weedth
    import import_citizeninfo
    import import_obec
    import import_opec
    import import_opendata
    cm, cr = [], []
    # Names and addresses of cannabis shops the map has never held, with a pin
    # inferred from the address where one could be — and none where it could
    # not. See importers/harvest_weedth.py for what was taken and what was
    # refused, and importers/geocode_local.py for how sure a pin is.
    weedth = import_weedth.records()
    # The state's own health facilities, with the state's own pins — 469 รพ.สต.
    # and 45 hospitals that no crawl had ever asked for. This is the single
    # biggest thing the medical shelf was missing, and it is the whole reason
    # Chiang Rai had three medical records. CC-BY, credited per record.
    moph = import_citizeninfo.records()
    print(f"citizeninfo: {len(moph)} state health facilities "
          f"(cm {sum(1 for r in moph if r['province']=='cm')}, "
          f"cr {sum(1 for r in moph if r['province']=='cr')})")
    cm += [r for r in moph if r["province"] == "cm"]
    cr += [r for r in moph if r["province"] == "cr"]
    # The state's register of its own schools — 1,302 across the two
    # provinces, against the FOURTEEN the directory held before it, all of
    # them international because that is the only kind the crawl asked for.
    # 87% carry a telephone, which makes this the most contactable shelf on
    # the site by a distance. See importers/import_obec.py for the pin test
    # and why a flat distance rule would have thrown away the highland
    # schools it exists to protect.
    obec = import_obec.records()
    print(f"obec: {len(obec)} government schools "
          f"(cm {sum(1 for r in obec if r['province']=='cm')}, "
          f"cr {sum(1 for r in obec if r['province']=='cr')})")
    cm += [r for r in obec if r["province"] == "cm"]
    cr += [r for r in obec if r["province"] == "cr"]
    cm += import_thai_answers()
    cm += import_womens_health()
    cm += import_mueang_map("osm.json", "cm")
    cm += import_overpass.records("cm")
    cm += json.loads((ROOT / "data" / "curated" / "additions-chiang-mai.json").read_text())
    cm += json.loads((ROOT / "data" / "curated" / "landmarks-chiang-mai.json").read_text())
    cm += [r for r in weedth if r["province"] == "cm"]
    cr += import_mueang_map("osm-chiang-rai.json", "cr")
    cr += import_overpass.records("cr")
    cr += json.loads((ROOT / "data" / "curated" / "featured-chiang-rai.json").read_text())
    cr += json.loads((ROOT / "data" / "curated" / "additions-chiang-rai.json").read_text())
    cr += [r for r in weedth if r["province"] == "cr"]
    # WO-16's open lists: the ONAB temple register fold (the wat-shelf move
    # that schools and medical already made), Chiang Rai's attraction lists
    # with their phone numbers, the police stations, the LPG shops, the
    # SAT-certified camps. Derived fresh each run from data/curated/
    # datagoth.json + the register on disk; dedup and review rules in
    # importers/import_opendata.py.
    odata = import_opendata.records()
    cm += [r for r in odata if r["province"] == "cm"]
    cr += [r for r in odata if r["province"] == "cr"]
    # Nan 2026-09-29: coverage is all of northern Thailand. We crawl CM and CR
    # only; the other fifteen provinces hold what arrives on its own — a
    # reader's suggestion, an owner, a field drop — kept by hand in
    # additions-north.json with the province key from data/coverage.json.
    coverage = {p["key"] for p in json.loads(
        (ROOT / "data" / "coverage.json").read_text())["provinces"]}
    north_file = ROOT / "data" / "curated" / "additions-north.json"
    north = json.loads(north_file.read_text()) if north_file.exists() else []
    passive = {}
    crawled = {pk: [] for pk in CRAWLED}
    for pk in CRAWLED:
        crawled[pk] += extract_records(pk)
        # the state's health facilities and schools, as for cm/cr above
        crawled[pk] += [r for r in moph + obec if r["province"] == pk]
    for r in north:
        pk = r.get("province")
        if pk == "cm":
            cm.append(r)
        elif pk == "cr":
            cr.append(r)
        elif pk in crawled:
            crawled[pk].append(r)
        elif pk in coverage and r.get("id", "").startswith(pk + "-"):
            passive.setdefault(pk, []).append(r)
        else:
            print(f"additions-north: {r.get('id')} refused — province {pk!r} is not "
                  f"a data/coverage.json key, or the id does not start with it")

    outdir = ROOT / "data" / "canonical"
    outdir.mkdir(parents=True, exist_ok=True)
    write_passive(outdir, passive, coverage)
    entries = {p["key"]: p for p in json.loads(
        (ROOT / "data" / "coverage.json").read_text())["provinces"]}
    for pk, records in sorted(crawled.items()):
        finish_crawled(pk, records, outdir, entries.get(pk, {}))
    for prov, records in (("cm", cm), ("cr", cr)):
        # field/curated truth wins over crawled truth; same place from two
        # sources keeps the stronger record and unions its shelves
        # A third-party directory is the weakest witness here and sorts below
        # our own crawl: it is somebody else's account of a shop, taken on
        # trust, with no pin of its own. Where it and OpenStreetMap describe
        # the same id, OSM's surveyed record wins every field.
        # `official` is a government register — CITIZENinfo's state health
        # facilities, with the state's own surveyed coordinates. It outranks
        # our crawl on the facilities it covers, because on those it IS the
        # authority; it still sits below anything a person curated or walked
        # to, because a register knows what was true when it was published and
        # a person knows what is true at the door.
        tier = {"third-party": -1, "crawled": 0, "official": 1,
                "curated": 2, "field": 3}
        by_id = {}
        for r in sorted(records, key=lambda r: tier[r["confidence"]]):
            ex = by_id.get(r["id"])
            if ex:
                r["cat"] = sorted(set(ex["cat"]) | set(r["cat"]))
                r["sub"] = sorted(set(ex.get("sub", [])) | set(r.get("sub", [])))
                for k in ("phone", "website", "hours", "address"):
                    r[k] = r.get(k) or ex.get(k)
                r["attrs"] = {**ex.get("attrs", {}), **r.get("attrs", {})}
            by_id[r["id"]] = r
        final = sorted(by_id.values(), key=lambda r: r["id"])
        # The private-school licence register, applied on the MERGED list
        # because it joins by name and needs to see everything we hold before
        # it decides a school is missing. It stamps what we have — official
        # type, who holds the licence, the levels, the founding year — and
        # returns only the schools nobody has mapped, pinless and saying so.
        # This is where the international schools come from: 25 of them in the
        # register against the 14 the crawl could find.
        stamped, unmapped = import_opec.apply(final, prov)
        if stamped or unmapped:
            print(f"{prov}: {stamped} school(s) stamped from the private "
                  f"register, {len(unmapped)} named there but not held")
            final = sorted(final + unmapped, key=lambda r: r["id"])
        # The Treasury's condominium register, on the same terms and for the
        # same reason (WO-27): it joins by name, so it must see everything we
        # hold first. It stamps the assessed spread onto buildings we already
        # have — the register IS the authority on its own valuation — and
        # returns the registered buildings nobody has mapped, pinless and
        # saying so. 53 condominium buildings were held against 366 the
        # government registers in Chiang Mai alone.
        import import_condo_register
        c_stamped, c_unmapped = import_condo_register.apply(final, prov)
        if c_stamped or c_unmapped:
            print(f"{prov}: {c_stamped} condo(s) stamped from the Treasury "
                  f"register, {len(c_unmapped)} registered but not held")
            final = sorted(final + c_unmapped, key=lambda r: r["id"])
        # People's own pages (sites.motdang.net, importers/own_pages.py), before
        # Overture because a place's own words are the first witness: the facts
        # a page states fill what the record lacks, never over a value it has,
        # each with its receipt. A page with a pin and no record is only a
        # proposal in data/curated/own_pages.json until its entry says admit.
        import own_pages
        op_filled, op_new = own_pages.apply(final, prov)
        if op_filled or op_new:
            print(f"{prov}: {op_filled} record(s) gained facts from their own page, "
                  f"{len(op_new)} page(s) admitted as a place")
            final = sorted(final + op_new, key=lambda r: r["id"])
        # Overture Places, on the merged list and for the same reason the two
        # registers above are: it joins by name and proximity, so it has to see
        # everything we hold before it decides a place is missing. Two jobs in
        # one pass — a contact fact onto a record that lacks one, and a record
        # for a shop nobody here held. It never overwrites, never moves a pin,
        # and nothing it touches is giveable to OpenStreetMap. Measurements and
        # refusals: importers/import_overture.py, notes/overture-2026-09-07.txt.
        import import_overture
        o_enriched, o_new = import_overture.apply(final, prov)
        if o_enriched or o_new:
            print(f"{prov}: {o_enriched} record(s) gained a contact from Overture, "
                  f"{len(o_new)} place(s) admitted that nothing here held")
            final = sorted(final + o_new, key=lambda r: r["id"])

        # Facets last, on the merged records: the ATM join needs the final
        # coordinates, and the tag lift needs whichever source ref survived.
        facets = import_fixtures.apply(final, prov)
        named = apply_curated_names(final)
        if named:
            print(f"{prov}: {named} curated name(s) filled in")
        storied = apply_curated_story_hooks(final)
        if storied:
            print(f"{prov}: {storied} curated story hook(s) filled in")
        # Air-con by Nan's word (2026-09-28), after the curated names so a
        # renamed 7-Eleven is still found by its name.
        cooled = aircon_stated.apply(final)
        if cooled:
            print(f"{prov}: air-con by her word on {sum(cooled.values())} place(s) "
                  + "(" + ", ".join(f"{k} {v}" for k, v in sorted(cooled.items())) + ")")
        # Reader-supplied facts approved by hand (facts.py / apply_facts.py).
        import sys as _sys
        if str(ROOT) not in _sys.path:
            _sys.path.insert(0, str(ROOT))
        import facts as _facts
        _fn = _facts.apply(final, _facts.load_all(ROOT / "data" / "curated"))
        if _fn:
            print(f"{prov}: {_fn} reader/gleaned fact(s) applied")
        pinned = apply_curated_pins(final)
        if pinned:
            print(f"{prov}: {pinned} curated pin(s) applied to records that had none")
        shelved = apply_curated_shelves(final)
        if shelved:
            print(f"{prov}: {shelved} curated shelf addition(s) applied")
        retagged = apply_curated_retags(final)
        if retagged:
            print(f"{prov}: {retagged} curated retag(s) applied — a shelf taken away, with its receipt")
        statused = apply_curated_status(final)
        if statused:
            print(f"{prov}: {statused} record(s) marked shut or moved, with the receipt")
        specialised = apply_specialty(final, prov)
        if specialised:
            print(f"{prov}: {specialised} medical record(s) state a specialty")
        welcomed = apply_lgbtq(final, prov)
        if welcomed:
            print(f"{prov}: {welcomed} place(s) carry an lgbtq welcome tag from the map")
        registered = apply_wat_registry(final)
        if registered:
            print(f"{prov}: {registered} wat(s) stamped from the temple register")
        satted = import_opendata.apply(final, prov)
        if satted:
            print(f"{prov}: {satted} muay thai camp(s) stamped SAT-certified")
        # Government lists filling contacts a held record leaves empty —
        # Nan's call 2026-08-20. Phone/website/hours only, never over a value
        # already there; an owner's claim still wins at build time.
        hosted = import_opendata.apply_monastic(final, prov)
        if hosted:
            print(f"{prov}: {hosted} temple(s) now name the monastic school they host")
        enriched = import_opendata.enrich(final, prov)
        if enriched:
            print(f"{prov}: {enriched} record(s) gained a contact from a government list")
        final, merged = apply_curated_merges(final)
        if merged:
            print(f"{prov}: {merged} duplicate record(s) folded")
        # WO-56: a building the Treasury's register names is a condominium —
        # after the merges, so a footprint a person folded a register row
        # into is re-filed by the register's word, not the mapper's tag.
        settled = import_condo_register.settle_sub(final)
        if settled:
            print(f"{prov}: {settled} building(s) filed condo by the Treasury's register")
        # WO-67, and it runs LAST of the record passes: a parking name that
        # quotes a bearing has to quote the pin the curated passes settled on,
        # not the one the crawl arrived with.
        located = apply_parking_locators(final, prov)
        if located:
            print(f"{prov}: {located} unnamed car park(s) now say where they are")
        # SOFT EYES, LAST. derive.py reads what the record's own address, name,
        # phone and neighbours already say and writes it into fields nothing was
        # reading — the อำเภอ inside an address string, the branch after สาขา,
        # the chain a repeated name makes. It runs after every apply_* pass on
        # purpose: it is first-writer-loses by design, so a register's fact, a
        # curated correction and an owner's claim have all had their turn before
        # a reading of ours is allowed near an empty field.
        import derive as _derive
        _derive.TODAY = __import__("datetime").date.today().isoformat()
        _dcounts: dict = {}
        _derived = sum(fn(final, prov, _dcounts) for _, fn in _derive.PASSES)
        if _derived:
            print(f"{prov}: {_derived} field(s) derived from what the records already say")
            for _k in sorted(_dcounts):
                print(f"        {_k:<44} {_dcounts[_k]:>7,}")
        (outdir / f"{prov}.json").write_text(
            json.dumps(final, ensure_ascii=False, indent=1), encoding="utf-8")
        write_places(prov, final, outdir / f"{prov}.json")
        got = sum(1 for r in final if (r.get("attrs") or {}).get("facets"))
        extra = (f" · {got} with facets ("
                 + ", ".join(f"{k} {v}" for k, v in sorted(facets.items())) + ")") if got else ""
        print(f"{prov}: {len(final)} records{extra}")


if __name__ == "__main__":
    main()
