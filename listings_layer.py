#!/usr/bin/env python3
"""The Listing Sheet, wired in — offers, building facts and pictures on the
place page, and the sheet itself under /listings/.

WHAT CROSSES (client 2026-09-27: "Motdang needs a real estate section" and
"we should be gleaning things that people send us for use EVERYWHERE, not
just stovepiped to real estate"). Until then only a COUNT and a LINK crossed,
under the Laila proposal's fine print; her word on 9/27 retired that. A place
page now carries, for its building:

  offers    live / sold / let counts, the sale and monthly-rent range, the
            latest as-of date, and the link to the rows on the sheet
  facts     what listers stated about the BUILDING (juristic office, year
            built, storeys, shared amenities), each with who said it and when
  pictures  listing photos whose lister gave CC BY 4.0 reuse consent, credited

Offers come from the sheet's join.json; facts, pictures and ranges come from
glean.py's data/gleaned/buildings.json. Either may be absent — no checkout, no
build, no glean run — and the page then shows whatever is left, down to
nothing.

WHAT THIS LAYER DOES.
  1. Copies the built sheet into DOCS/listings/ so motdang.net serves it.
  2. Writes DOCS/data/listings.json — the same counts, for the client.
  3. Answers place_row(r) for the place page.

    LS_ROOT=/path/to/listing-sheet   override the location
"""
from __future__ import annotations

import html
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Sibling by default: both live under ~/Developer/claude code projects/.
SHEET = Path(os.environ.get("LS_ROOT", ROOT.parent / "listing-sheet"))

_join = None          # {building_ref: {n, live, sold, other}} — loaded once
_gleaned = None       # {building_ref: {facts, pictures, offers}} — glean.py
GLEANED = ROOT / "data" / "gleaned" / "buildings.json"


def _load():
    """Read the sheet's join index. Cached; absence is a normal answer."""
    global _join
    if _join is not None:
        return _join
    _join = {}
    path = SHEET / "out" / "join.json"
    if path.exists():
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
            _join = doc.get("buildings") or {}
        except (json.JSONDecodeError, OSError):
            _join = {}
    return _join


def for_ref(ref):
    """Counts for one building id, or None. Called from the place page."""
    if not ref:
        return None
    return _load().get(ref)


def gleaned(ref):
    """glean.py's summary for one building id, or None. Cached."""
    global _gleaned
    if _gleaned is None:
        _gleaned = {}
        if GLEANED.exists():
            try:
                doc = json.loads(GLEANED.read_text(encoding="utf-8"))
                _gleaned = doc.get("buildings", doc) if isinstance(doc, dict) else {}
            except (json.JSONDecodeError, OSError):
                _gleaned = {}
    return _gleaned.get(ref) if ref else None


# Building-level fields glean.py may carry, in the order a reader asks them.
# A field glean emits that is missing here is not rendered — add its label.
FACT_LABELS = [
    ("juristic_name", "นิติบุคคล", "Juristic office"),
    ("juristic_phone", "โทรนิติบุคคล", "Juristic office phone"),
    ("year_built", "ปีที่สร้าง", "Year built"),
    ("storeys", "จำนวนชั้น", "Storeys"),
    ("amenities", "ส่วนกลาง", "Shared facilities"),
    ("short_lets", "ให้เช่ารายวัน-รายสัปดาห์", "Short lets"),
    ("foreign_quota", "โควตาต่างชาติ", "Foreign quota"),
]


def _baht(n):
    n = float(n)
    if n >= 1_000_000:
        return "฿" + (f"{n / 1_000_000:.2f}".rstrip("0").rstrip(".")) + "M"
    return "฿" + f"{n:,.0f}"


def _range(pair):
    if not pair or pair[0] is None:
        return ""
    lo, hi = pair[0], pair[-1]
    return _baht(lo) if hi is None or lo == hi else f"{_baht(lo)}–{_baht(hi)}"


_svc = None


def _amenity_words():
    """{code: (thai, english)} from the sheet's own vocabulary, or {}."""
    global _svc
    if _svc is None:
        _svc = {}
        try:
            import importlib.util
            specs = {}
            for mod in ("facets", "th"):
                spec = importlib.util.spec_from_file_location(f"_ls_{mod}", SHEET / f"{mod}.py")
                m = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(m)
                specs[mod] = m
            en = specs["facets"].SERVICE_WORDS
            _svc = {k: (specs["th"].SVC.get(k), en.get(k, k)) for k in en}
        except Exception:
            _svc = {}
    return _svc


def _fact_value(v, bi, esc):
    if isinstance(v, dict) and "status" in v:
        # foreign_quota: a dated juristic statement, never a standing fact
        when = f" ({bi('ณ', 'as of')} {esc(str(v['as_of']))})" if v.get("as_of") else ""
        return _fact_value(v["status"], bi, esc) + when
    if isinstance(v, list):
        words = _amenity_words()
        return ", ".join(bi(esc(words[x][0]), esc(words[x][1])) if x in words and words[x][0]
                         else esc(str(x)) for x in v)
    if v in ("allowed", "not_allowed", "open", "full"):
        return bi(*{"allowed": ("ได้", "allowed"), "not_allowed": ("ไม่ได้", "not allowed"),
                    "open": ("ยังมีที่ว่าง", "has room"), "full": ("เต็ม", "full")}[v])
    return esc(str(v))


def _join_live():
    """data/config.json listerJoin: the Worker's join door is live (realestate_layer reads the same flag)."""
    try:
        return bool(json.loads((ROOT / "data" / "config.json").read_text(encoding="utf-8")).get("listerJoin"))
    except (OSError, ValueError):
        return False


def place_row(r, bi, esc, base=""):
    """The real-estate rows for a place page, or "" if there are none.

    `bi` is build.py's bilingual helper. Returns one or more <dt>/<dd> pairs.
    """
    ref = r.get("id")
    e = for_ref(ref) or {}
    gl = gleaned(ref) or {}
    off = gl.get("offers") or {}
    live = off.get("live", e.get("live", 0)) or 0
    sold = off.get("sold", e.get("sold", 0)) or 0
    let = off.get("let", 0) or 0
    href = f"{base}listings/#{esc(e.get('id') or '')}" if e.get("id") else f"{base}listings/"
    out = []

    parts = []
    if live:
        sale, rent = _range(off.get("sale_thb")), _range(off.get("rent_month_thb"))
        if sale:
            parts.append(bi(f"ขาย {sale}", f"for sale {sale}"))
        if rent:
            parts.append(bi(f"เช่า {rent}/เดือน", f"to rent {rent}/month"))
        if not parts:
            parts.append(bi(f"ประกาศอยู่ {live} รายการ", f"{live} live offer{'s' if live != 1 else ''}"))
        else:
            parts.insert(0, bi(f"{live} รายการ", f"{live} live"))
    if sold:
        parts.append(bi(f"ขายแล้ว {sold}", f"{sold} sold"))
    if let:
        parts.append(bi(f"ปล่อยเช่าแล้ว {let}", f"{let} let"))
    if parts:
        asof = off.get("as_of")
        when = f" <small>{bi('ณ', 'as of')} {esc(asof)}</small>" if asof else ""
        out.append(f"<dt>{bi('ประกาศ', 'Listings')}</dt>"
                   f"<dd><a href=\"{href}\">{' · '.join(parts)}</a>{when}</dd>")
    elif "realestate" in (r.get("cat") or []):
        # A housing page with nothing on the sheet: the way to the sheet, and the
        # way onto it for whoever has a unit here (Nan 2026-10-12, "B").
        out.append(f"<dt>{bi('ประกาศ', 'Listings')}</dt>"
                   f"<dd><a href=\"{base}listings/\">{bi('กระดานประกาศเช่า-ขาย', 'the Listing Sheet')}</a>"
                   + (f" · <a href=\"{base}listings/join\">{bi('ลงประกาศห้องในตึกนี้', 'list a unit here')}</a>"
                      if _join_live() else "") + "</dd>")

    facts = gl.get("facts") or {}
    seen = set()
    for key, th, en in FACT_LABELS:
        f = facts.get(key)
        if not f or en in seen:
            continue
        seen.add(en)
        v = f.get("value") if isinstance(f, dict) else f
        if v in (None, "", []):
            continue
        who = None
        if isinstance(f, dict):
            who = f.get("from") or str(f.get("source") or "").removeprefix("lister:").replace("-", " ") or None
        at = f.get("at") if isinstance(f, dict) else None
        cite = " · ".join(esc(str(x)) for x in (who, at) if x)
        cite = f" <small>{bi('จากผู้ลงประกาศ', 'per lister')} {cite}</small>" if cite else ""
        out.append(f"<dt>{bi(th, en)}</dt><dd>{_fact_value(v, bi, esc)}{cite}</dd>")

    # The building's page in the sheet's register (listing-sheet register.py),
    # for every housing record, offers or not.
    if (set(r.get("sub") or []) & {"condo", "apartment", "dorm", "moobaan"}
            and "realestate" in (r.get("cat") or [])
            and (SHEET / "out" / "b" / f"{ref}.html").exists()):
        from urllib.parse import quote
        out.append(f"<dt>{bi('ทะเบียนตึก', 'Register')}</dt>"
                   f"<dd><a href=\"{base}listings/b/{quote(ref)}.html\">"
                   f"{bi('แฟ้มของตึกนี้', 'This building’s file')}</a></dd>")

    pics = [p for p in (gl.get("pictures") or []) if p.get("src") and p.get("licence")][:6]
    if pics:
        imgs = "".join(
            f"<a href=\"{base}{esc(p['src'])}\"><img src=\"{base}{esc(p['src'])}\" "
            f"alt=\"\" loading=\"lazy\" width=\"120\" height=\"90\" "
            f"style=\"object-fit:cover;margin:0 4px 4px 0\"></a>" for p in pics)
        credits = sorted({p.get("credit") for p in pics if p.get("credit")})
        lic = sorted({p.get("licence") for p in pics})
        cap = esc(", ".join(credits)) + (" · " if credits else "") + esc(", ".join(lic))
        out.append(f"<dt>{bi('ภาพจากประกาศ', 'Listing photos')}</dt>"
                   f"<dd>{imgs}<br><small>{cap}</small></dd>")
    return "".join(out)


_SITE_A = re.compile(r'<a href="([^"]+)" rel="nofollow">[^<]*</a>')


def _refresh_websites(bdir):
    """Re-apply today's link verdicts to the register's building pages.

    The sheet writes b/ only when it is rebuilt, and publish.sh rebuilds it
    only when a listing arrives. A building site check_links finds dead after
    that kept its live link here, and the publish gate held 15 pages back for
    it (2026-10-17, condo domains gone 13-17 Oct; out/ last built 12 Oct). So
    each anchor the sheet wrote for a website is asked again, in the sheet's
    own words (register.website_html), and replaced where the answer changed.
    Run in the sheet's directory as its own process: register.py imports
    sibling modules by bare name (buildings, facets, th). Returns pages changed.
    """
    pages = sorted(bdir.glob("*.html")) if bdir.is_dir() else []
    texts = {p: p.read_text(encoding="utf-8") for p in pages}
    urls = sorted({html.unescape(m.group(1))
                   for t in texts.values() for m in _SITE_A.finditer(t)})
    if not urls:
        return 0
    # Only what is now dead or moved: a live link keeps the label the sheet
    # gave it ("Facebook", a LINE id), which website_html would not.
    ask = ("import json, sys, register as R\n"
           "out = {}\n"
           "for u in json.load(sys.stdin):\n"
           "    st = R.link_verdict(u).get('status')\n"
           "    if st in R.BROKEN or st == 'moved-social':\n"
           "        out[u] = R.website_html(u)\n"
           "print(json.dumps(out))")
    try:
        done = subprocess.run([sys.executable, "-c", ask], cwd=SHEET,
                              input=json.dumps(urls), capture_output=True,
                              text=True, timeout=300, check=True)
        now = json.loads(done.stdout)
    except (subprocess.SubprocessError, OSError, ValueError) as e:
        print(f"  listings: link verdicts not re-applied to b/ ({e})")
        return 0
    n = 0
    for p, t in texts.items():
        new = _SITE_A.sub(lambda m: now.get(html.unescape(m.group(1)), m.group(0)), t)
        if new != t:
            p.write_text(new, encoding="utf-8")
            n += 1
    return n


def emit(g, data):
    """Copy the sheet in and publish the counts. Returns a one-line status."""
    docs = g["DOCS"]
    out = SHEET / "out"
    if not (out / "index.html").exists():
        return (f"sheet not built at {out} — no /listings/ this build "
                f"(run sheet.py in listing-sheet/)")

    # AN ALLOWLIST, NOT A COPY OF THE DIRECTORY. out/ also holds out/sample/ —
    # eight INVENTED listings built to exercise the filters, each carrying
    # schema.org RealEstateListing markup. Published, they would be fabricated
    # offers on a live domain that machines read as genuine. A denylist would
    # be one new sub-directory away from shipping them, so only these names
    # ever cross.
    SHIPS = ("index.html", "add.html", "sheet.json", "join.json",
             # What the add form types against: Mot Dang's own building names,
             # so a lister picks the building instead of typing six fields
             # about where it is. Counts and names only — the same thing that
             # crosses the line anywhere else here.
             "buildings.json",
             # The CSV an agency downloads, fills, and drops back on the form.
             "template.csv")
    # The directories and the feeds ride along, because index.html LINKS to
    # them — reso/ is the MLS-shaped copy of the same rows (reso.py), and
    # register/ + b/ are the building register (register.py): <a href="feed.xml"> in the footer and a per-building page behind
    # every row. Shipping the page without them put two broken links on a live
    # domain for every listing the sheet held. The sheet sweeps both sets at
    # the start of each build, so nothing stale can arrive here.
    SHIP_GLOBS = ("feed*.xml",)
    # map/ holds the map blocks' script and the register's pins
    # (listing-sheet/mapblock.py); every page with a block fetches from it.
    SHIP_DIRS = ("b", "reso", "register", "map")
    dest = docs / "listings"
    dest.mkdir(parents=True, exist_ok=True)
    for name in SHIPS:
        src = out / name
        if src.exists():
            shutil.copyfile(src, dest / name)
    for pattern in SHIP_GLOBS:
        for src in out.glob(pattern):
            if src.is_file():
                shutil.copyfile(src, dest / src.name)
    for name in SHIP_DIRS:
        src = out / name
        if src.is_dir():
            shutil.copytree(src, dest / name, dirs_exist_ok=True)
    stale = _refresh_websites(dest / "b")
    photos = out / "photos"
    if photos.is_dir():
        shutil.copytree(photos, dest / "photos", dirs_exist_ok=True)
    assert not (dest / "sample").exists(), "sample data must never ship"
    # The entry form ships with it: an agency that follows the door from a
    # building page can add that building without being sent anywhere else.
    join = _load()

    (docs / "data").mkdir(parents=True, exist_ok=True)
    (docs / "data" / "listings.json").write_text(
        json.dumps({"buildings": join}, ensure_ascii=False),
        encoding="utf-8")

    # NEAR-MISS STUBS. /listings works; /listing and /listings.html did not —
    # the singular is what a person types and the .html form is what a link
    # drops a character into, and the site Worker looks up a path containing a
    # dot literally, so /listings.html was a 404 on a page that exists.
    #
    # A 301 in publish/worker.js is the right answer and it is written there.
    # These stubs exist because a Worker deploy and a content deploy are
    # different acts with different credentials, and the content one is the
    # one that can happen today. When the Worker next ships, its redirect
    # fires first and these become unreachable — harmless, and still correct
    # for anyone who saved the file.
    for name in ("listing.html", "listings.html", "add-a-listing.html"):
        (docs / name).write_text(
            '<!doctype html><meta charset="utf-8">'
            '<meta http-equiv="refresh" content="0;url=/listings/">'
            '<link rel="canonical" href="https://motdang.net/listings/">'
            '<title>The Listing Sheet</title>'
            '<p><a href="/listings/">The Listing Sheet &#8594;</a>',
            encoding="utf-8")

    live = sum(e.get("live", 0) for e in join.values())
    n = sum(e.get("n", 0) for e in join.values())
    known = sum(1 for ref in join if ref in (g.get("BY_ID") or {}))
    return (f"/listings/ copied · {n} offer(s) on {len(join)} building(s), "
            f"{live} live · {known} of those buildings are on our register"
            + (f" · {stale} building page(s) given today's link verdicts" if stale else ""))


if __name__ == "__main__":
    # Publishing ONE new listing should not cost a 27,000-page rebuild. The
    # sheet is its own instrument and its output is self-contained, so the
    # nightly (listing-sheet/publish.sh) runs this to copy the built sheet into
    # docs/listings/ and then deploys that one prefix. Same allowlist as the
    # full build uses — there is no second copy of the rule about what ships.
    #
    # What this does NOT update is the cross-reference line on a place page:
    # "two offers stand on this building" is written by build.py from
    # join.json, so a new count appears at the next full site build. A stale
    # count is a smaller wrong than a nightly that republishes the whole site.
    print(emit({"DOCS": ROOT / "docs", "BY_ID": {}}, None))
