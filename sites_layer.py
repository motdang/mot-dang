#!/usr/bin/env python3
"""The register — every minisite and capability on motdang.net, one card each.

data/curated/sites.json holds the cards (see its _readme). Everything that used
to keep a hand list of minisites reads this instead:

    best(n)            the front page's six: Nan's picks, the newest, the most read
    directory_body()   /sites/ — the whole register, by group, Term (count)
    shelf_band()       the cards that head a shelf page
    net_site()         the card a net points at, for every member page
    place_band()       the card a place names, at the head of that place's page
    search_rows()      docs/data/sites.json — the Worker answers site cards from it
    sitemap_urls()     the Worker-served cards, which have no page under docs/
    llms_section()     the register, for machines
    unregistered()     the publish gate: a site under docs/ with no card

A card can travel with its site as assets/sites/<slug>/card.json; build copies
assets/sites into docs/sites, and load() reads both, the folder filling in href.

data/sites_traffic.json ({href: people visits, 30 days}) is written by
importers/sites_traffic.py from the browser beacon; without it, "most read"
contributes nothing and the other two fill the six.
"""
import datetime
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
REGISTER = ROOT / "data" / "curated" / "sites.json"
TRAFFIC = ROOT / "data" / "sites_traffic.json"
# The roster's own copy (the index repo, which every new site is added to)
# when it is on this disk; data/curated/fleet.json had stopped at 43 of 62
# sites on 2026-09-27 and nothing copied it forward (gemba 2026-10-03).
_FLEET_INDEX = ROOT.parent / "index" / "data" / "fleet.json"
FLEET = _FLEET_INDEX if _FLEET_INDEX.exists() else ROOT / "data" / "curated" / "fleet.json"
BASE = "https://motdang.net/"
NEW_DAYS = 14

REFUSAL = """
REFUSED — {n} site(s) under docs/ carry no card:
{paths}

To the bot that posted this: fix yourself and return recombobulated.

Every new site carries a card (Nan, 2026-09-28). Add one to
data/curated/sites.json "cards", or ship card.json inside assets/sites/<slug>/:

  {{"id": "<slug>", "href": "<path>/", "th": "<ชื่อไทย>", "en": "<English name>",
   "line_th": "<หนึ่งบรรทัด>", "line_en": "<one line>", "icon": "i-<name>",
   "shipped": "{today}", "group": "<{groups}>", "where": "cm|cr|both",
   "shelves": [], "words": [], "served": "docs"}}

A path that is not a site (a form, a tool, a data folder) goes in "not_sites".
Then build again.
"""

CSS = """
/* ---- the register: a minisite at the head of its shelf ---------------- */
.siteband{display:flex;flex-wrap:wrap;gap:.5rem;margin:.6rem 0 .9rem}
.siteband a{display:flex;gap:.55rem;align-items:center;flex:1 1 16rem;padding:.55rem .75rem;
border:2px solid var(--ant-dark,#8e1b12);border-radius:.7rem;background:#fffaf0;
text-decoration:none;color:inherit;box-shadow:3px 3px 0 #f1c40f}
.siteband a:hover{background:#fdebd0}
.siteband b{display:block}
.siteband small{display:block;color:var(--mute,#666);line-height:1.4}
.siteband .kick{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--mute,#666)}
@media(max-width:34rem){.siteband{gap:.35rem}.siteband a{flex-basis:100%;padding:.35rem .6rem;box-shadow:2px 2px 0 #f1c40f}
.siteband small,.siteband .kick{display:none}}
.net .netsite{margin:.3rem 0 .5rem;font-weight:600}
.placesite{margin:.6rem 0 .9rem}
.placesite a.ps{display:block;border:2px solid var(--ant-dark,#8e1b12);border-radius:.7rem;overflow:hidden;
background:#fffaf0;text-decoration:none;color:inherit;box-shadow:3px 3px 0 #f1c40f}
.placesite a.ps img{display:block;width:100%;height:auto;aspect-ratio:1200/630;object-fit:cover}
.placesite a.ps span.t{display:block;padding:.5rem .75rem}
.placesite b{display:block}
.placesite small{display:block;color:var(--mute,#666);line-height:1.4}
.placesite .kick{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--mute,#666)}
.placesite .psnet{margin:.4rem 0 0;font-weight:600}
.sitesdir .groups{line-height:2}
.sitesdir h2 .count,.sitesdir .groups .count{font-weight:400;color:var(--mute,#666)}
.sitesdir ul.cards{list-style:none;padding:0;margin:.4rem 0 1.2rem}
.sitesdir ul.cards li{display:flex;gap:.6rem;align-items:flex-start;padding:.45rem 0;
border-bottom:1px dashed var(--soft,#ddd)}
.sitesdir ul.cards li .sub{display:block;font-size:.92rem;color:var(--mute,#666)}
.sitesdir .new{font-size:.72rem;background:#c0392b;color:#fff;border-radius:.3rem;
padding:0 .35rem;margin-left:.35rem;vertical-align:middle}
.sitesdir ul.pages{columns:2 16rem;padding-left:1.1rem;margin:.2rem 0 1.4rem}
"""

_REG = None


def _today():
    return datetime.date.today()


def load(docs=None):
    """The register, with any card.json shipped inside assets/sites/<slug>/ merged in."""
    global _REG
    if _REG is not None:
        return _REG
    reg = json.loads(REGISTER.read_text(encoding="utf-8"))
    # a card staged for Nan's word carries "hold": true and reaches no reader
    cards = [c for c in reg.get("cards", []) if not c.get("hold")]
    have = {c["href"] for c in cards}
    for folder in (ROOT / "assets" / "sites", (docs or ROOT / "docs") / "sites"):
        if not folder.is_dir():
            continue
        for cj in sorted(folder.glob("*/card.json")):
            href = "sites/%s/" % cj.parent.name
            if href in have:
                continue
            try:
                c = json.loads(cj.read_text(encoding="utf-8"))
            except ValueError:
                continue
            c.setdefault("id", cj.parent.name)
            c["href"] = href
            c.setdefault("served", "docs")
            cards.append(c)
            have.add(href)
    # A folder installed whole at the top level (assets/parking/ → /parking/)
    # ships its card beside its index.html. Until 2026-10-18 only sites/<slug>/
    # was read, so parking/'s card, written with the site on 10-13, never
    # registered and the gate held the site back.
    for cj in sorted((ROOT / "assets").glob("*/card.json")):
        href = "%s/" % cj.parent.name
        if cj.parent.name == "sites" or href in have \
                or not (cj.parent / "index.html").exists():
            continue
        try:
            c = json.loads(cj.read_text(encoding="utf-8"))
        except ValueError:
            continue
        c.setdefault("id", cj.parent.name)
        c["href"] = href
        c.setdefault("served", "docs")
        cards.append(c)
        have.add(href)
    reg["cards"] = cards
    _REG = reg
    return reg


def cards():
    return load()["cards"]


def groups():
    return load()["groups"]


def visits():
    try:
        return json.loads(TRAFFIC.read_text(encoding="utf-8")).get("visits", {})
    except (OSError, ValueError):
        return {}


def url_of(card, prefix=""):
    h = card["href"]
    return h if h.startswith("http") else prefix + h


def is_new(card, today=None):
    s = card.get("shipped")
    if not s:
        return False
    try:
        d = datetime.date.fromisoformat(s)
    except ValueError:
        return False
    return ((today or _today()) - d).days <= NEW_DAYS


def timing(card, today=None):
    """Where today sits in a card's window: "out" when it has passed or is out of
    season, "now" inside a window, None for a card with no window.

    until   YYYY-MM-DD — the day after it stops being news (an opening, an exhibition's end)
    season  ["MM-DD", "MM-DD"] — the stretch of each year it belongs to; may wrap the new year
    Nan, 2026-10-02: the smoky season is good for spring and untimely in October."""
    today = today or _today()
    u = card.get("until")
    if u:
        try:
            if datetime.date.fromisoformat(u) < today:
                return "out"
        except ValueError:
            pass
    sn = card.get("season")
    if sn:
        md, (a, b) = today.strftime("%m-%d"), sn
        if not (a <= md <= b if a <= b else md >= a or md <= b):
            return "out"
    return "now" if (u or sn) else None


def on_disk(card, docs):
    """A docs-served card whose page the build has not written yet (a card can land
    before its page does) is left off the front page and /sites/ until it has."""
    if docs is None or card.get("served") != "docs" or card["href"].startswith("http"):
        return True
    h = card["href"]
    return (docs / h / "index.html").exists() if h.endswith("/") else (docs / h).exists()


def best(n=6, today=None, skip=(), docs=None):
    """What is on now, Nan's picks, the newest and the most read, taken in turn until
    n are chosen. A card out of its window (timing) is left off.

    Round-robin rather than one blended score, so each of the three reasons always
    gets its share of the row and a quiet week of traffic cannot push out the new."""
    cs = [c for c in cards() if c["href"] not in skip and on_disk(c, docs)
          and timing(c, today) != "out"]
    timely = sorted((c for c in cs if timing(c, today) == "now"), key=lambda c: c.get("until") or "9999")
    favs = [c for c in cs if c.get("fav")]
    dated = sorted((c for c in cs if c.get("shipped")),
                   key=lambda c: c["shipped"], reverse=True)
    v = visits()
    read = sorted((c for c in cs if v.get(c["href"], 0) > 0),
                  key=lambda c: -v.get(c["href"], 0))
    lanes = [timely, favs, dated, read]
    out, seen = [], set()
    while len(out) < n and any(lanes):
        for lane in lanes:
            while lane:
                c = lane.pop(0)
                if c["href"] not in seen:
                    seen.add(c["href"])
                    out.append(c)
                    break
            if len(out) >= n:
                break
    return out


# ---------------------------------------------------------------- pages as entries

_H1 = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S)


def _page_label(path):
    """(th, en, line_th, line_en) from a page's own <h1>, split on ' · ' and ' — '."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    m = _H1.search(text)
    if not m:
        return None
    t = html.unescape(re.sub(r"<[^>]+>", " ", m.group(1)))
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s*\([\d,]+\)\s*$", "", t)
    t = re.sub(r"^[^\w฀-๿]+", "", t)
    # The English half starts at the first ' · ' followed by a Latin letter:
    # Thai halves carry their own dots ("เชียงใหม่ · เชียงราย").
    m2 = re.search(r" · (?=[A-Za-z])", t)
    th, en = (t[:m2.start()], t[m2.end():]) if m2 else (t, "")
    th_name, _, th_line = th.partition(" — ")
    en_name, _, en_line = en.partition(" — ")
    return th_name.strip(), en_name.strip(), th_line.strip(), en_line.strip()


def page_entries(docs):
    out = []
    for href, g in load().get("pages", []):
        lab = _page_label(docs / href)
        if not lab or not (lab[0] or lab[1]):
            continue
        th, en, lth, len_ = lab
        out.append({"href": href, "group": g, "th": th, "en": en,
                    "line_th": lth, "line_en": len_})
    return out


# ---------------------------------------------------------------- the gate

def _is_site_dir(d):
    return d.is_dir() and (d / "index.html").exists()


def unregistered(docs):
    """Paths under docs/ that look like a site and appear nowhere in the register."""
    reg = load(docs)
    known = {c["href"] for c in reg["cards"]} | {h for h, _ in reg.get("pages", [])} \
        | set(reg.get("not_sites", []))
    cov_path = docs.parent / "data" / "coverage.json"
    if cov_path.exists():
        try:
            cov = json.loads(cov_path.read_text())
            known |= {f"{p['key']}/" for p in cov.get("provinces", [])}
        except Exception:
            pass
    missing = []
    for p in sorted(docs.iterdir()):
        if p.name.startswith("."):
            continue
        if p.is_file() and p.suffix == ".html":
            if p.name not in known:
                missing.append(p.name)
        elif _is_site_dir(p) and p.name + "/" not in known:
            missing.append(p.name + "/")
    sites = docs / "sites"
    if sites.is_dir():
        for p in sorted(sites.iterdir()):
            if _is_site_dir(p) and "sites/%s/" % p.name not in known:
                missing.append("sites/%s/" % p.name)
    return missing


def refusal(missing, today=None):
    return REFUSAL.format(n=len(missing), paths="\n".join("  " + m for m in missing),
                          today=(today or _today()).isoformat(),
                          groups="|".join(g["key"] for g in groups()))


# ---------------------------------------------------------------- html

def _e(s):
    return html.escape(str(s or ""), quote=True)


def _bi(th, en):
    if th and en:
        return (f'<span class="th" lang="th">{_e(th)}</span>'
                f'<span class="th" lang="th"> · </span><span class="en" lang="en">{_e(en)}</span>')
    return _e(th or en)


def front_cards(icon, prefix, today=None, n=6, skip=(), docs=None):
    """The front page's six, in the kit's .card.pin markup, and the way to the rest."""
    out = []
    for c in best(n, today, skip, docs):
        ext = c["href"].startswith("http")
        rel = ' rel="noopener"' if ext else ""
        mark = (f'<span class="out" title="another site">{icon("i-arrow", 14)}</span>' if ext else "")
        new = ('<span class="newtag">ใหม่ · new</span>' if is_new(c, today) else "")
        out.append(f'<div class="card pin"><h3>{icon(c.get("icon") or "i-star", 22)}'
                   f'<a href="{_e(url_of(c, prefix))}"{rel}>{_e(c["en"])}{mark}</a>{new}</h3>'
                   f'<p class="th" lang="th">{_e(c["th"])}</p>'
                   f'<p>{_e(c.get("line_en", ""))}</p></div>')
    return f'<div class="grid pins">{"".join(out)}</div>'


def count(docs=None):
    """Cards plus listed pages — read off the register, so it does not depend on
    which pages the build has written yet."""
    return len(cards()) + len(load().get("pages", []))


def directory_body(docs, icon, prefix="../", today=None):
    """/sites/ — the register as a 1997 directory: groups with counts, cards first,
    then the pages that live under the same group, then the rest of the fleet."""
    today = today or _today()
    pages = page_entries(docs)
    by_g = {g["key"]: ([], []) for g in groups()}
    for c in cards():
        if on_disk(c, docs):
            by_g.setdefault(c.get("group", "behind"), ([], []))[0].append(c)
    for p in pages:
        by_g.setdefault(p["group"], ([], []))[1].append(p)
    for cs, _ in by_g.values():
        cs.sort(key=lambda c: c.get("shipped") or "", reverse=True)

    total = sum(len(a) + len(b) for a, b in by_g.values())
    gl = " · ".join(
        f'<a href="#{_e(g["key"])}">{_bi(g["th"], g["en"])}</a> '
        f'<span class="count">({len(by_g[g["key"]][0]) + len(by_g[g["key"]][1])})</span>'
        for g in groups() if by_g.get(g["key"]) and any(by_g[g["key"]]))
    newest = [c for c in sorted(cards(), key=lambda c: c.get("shipped") or "", reverse=True)
              if is_new(c, today) and on_disk(c, docs)]

    parts = ['<div class="sitesdir">',
             f'<h1>{_bi("ทุกเว็บในมดแดง", "Every site on Mot Dang")} '
             f'<span class="count">({total})</span></h1>',
             f'<p class="groups">{gl}</p>']
    if newest:
        parts.append(f'<h2 id="new">{_bi("ใหม่", "New")} <span class="count">({len(newest)})</span></h2>')
        parts.append(_card_list(newest, icon, prefix, today))
    for g in groups():
        cs, ps = by_g.get(g["key"], ([], []))
        if not cs and not ps:
            continue
        parts.append(f'<h2 id="{_e(g["key"])}">{icon(g.get("icon") or "i-star", 22)}'
                     f'{_bi(g["th"], g["en"])} <span class="count">({len(cs) + len(ps)})</span></h2>')
        if cs:
            parts.append(_card_list(cs, icon, prefix, today))
        if ps:
            parts.append('<ul class="pages">' + "".join(
                f'<li><a href="{_e(prefix + p["href"])}">{_bi(p["th"], p["en"])}</a></li>'
                for p in ps) + "</ul>")
    parts.append(_fleet_block(prefix))
    parts.append("</div>")
    return "".join(parts)


def _card_list(cs, icon, prefix, today):
    rows = []
    for c in cs:
        ext = c["href"].startswith("http")
        new = '<span class="new">ใหม่ new</span>' if is_new(c, today) else ""
        rows.append(f'<li>{icon(c.get("icon") or "i-star", 26)}<span>'
                    f'<a href="{_e(url_of(c, prefix))}"{" rel=noopener" if ext else ""}>'
                    f'{_bi(c["th"], c["en"])}</a>{new}'
                    f'<span class="sub">{_bi(c.get("line_th", ""), c.get("line_en", ""))}</span>'
                    f'</span></li>')
    return '<ul class="cards">' + "".join(rows) + "</ul>"


def _fleet():
    try:
        return json.loads(FLEET.read_text(encoding="utf-8")).get("sites", [])
    except (OSError, ValueError):
        return []


def _fleet_block(prefix):
    mine = {url_of(c, BASE) for c in cards()}
    rows = [s for s in _fleet()
            if s.get("lane") in ("directory", "product", "company", "meta")
            and s["id"] != "motdang" and s["url"] not in mine
            and not s["url"].startswith(BASE)]
    if not rows:
        return ""
    lis = "".join(f'<li><a href="{_e(s["url"])}" rel="noopener">{_bi(s.get("th", ""), s["name"])}</a>'
                  f'<span class="sub">{_e(s.get("note", ""))}</span></li>' for s in rows)
    return (f'<h2 id="elsewhere">{_bi("ที่อื่นของเรา", "Elsewhere")} '
            f'<span class="count">({len(rows)})</span></h2>'
            f'<ul class="pages">{lis}</ul>'
            f'<p><a href="{prefix}elsewhere.html">{_bi("ทั้งหมด", "the whole roster")} →</a></p>')


def shelf_band(shelf, prov, prefix):
    """The cards that head this shelf, for this province."""
    hits = [c for c in cards() if shelf in (c.get("shelves") or [])
            and c.get("where", "both") in ("both", prov)]
    if not hits:
        return ""
    out = []
    for c in hits:
        out.append(f'<a href="{_e(url_of(c, prefix))}">'
                   f'<span><span class="kick">{_bi("เว็บของหมวดนี้", "this shelf’s site")}</span>'
                   f'<b>{_bi(c["th"], c["en"])}</b>'
                   f'<small>{_bi(c.get("line_th", ""), c.get("line_en", ""))}</small></span></a>')
    return f'<nav class="siteband" aria-label="sites">{"".join(out)}</nav>'


def net_site(net_key):
    for c in cards():
        if c.get("net") == net_key:
            return c
    return None


def place_card(pid):
    """The card whose "place" names this record id."""
    for c in cards():
        if pid and c.get("place") == pid:
            return c
    return None


def place_band(pid, prefix, docs=None, net_href=""):
    """The minisite a place's card names, as the picture at the head of its page,
    with a line down to the net that site belongs to."""
    c = place_card(pid)
    if not c:
        return ""
    href = url_of(c, prefix)
    pic = ""
    if not c["href"].startswith("http"):
        for base in ((docs or ROOT / "docs"), ROOT / "assets"):
            if (base / c["href"] / "card.jpg").is_file():
                pic = (f'<img src="{_e(href)}card.jpg" width="1200" height="630" loading="lazy" '
                       f'alt="{_e(c["th"] + " · " + c["en"])}">')
                break
    net = ""
    if c.get("net") and net_href:
        net = (f'<p class="psnet"><a href="{_e(net_href)}">'
               f'{_bi("ร้อยไว้ในตาข่ายเดียวกัน", "Strung in the same net")} ↓</a></p>')
    return (f'<div class="placesite"><a class="ps" href="{_e(href)}">{pic}<span class="t">'
            f'<span class="kick">{_bi("มินิไซต์", "minisite")}</span>'
            f'<b>{_bi(c["th"], c["en"])}</b>'
            f'<small>{_bi(c.get("line_th", ""), c.get("line_en", ""))}</small></span></a>{net}</div>')


def net_line(net_key, prefix):
    c = net_site(net_key)
    if not c:
        return ""
    return (f'<p class="netsite"><a href="{_e(url_of(c, prefix))}">'
            f'{_bi("เว็บของตาข่ายนี้: " + c["th"], "This net’s site: " + c["en"])} →</a></p>')


# ---------------------------------------------------------------- machines

def search_rows(docs):
    """What the Worker reads to put a site card above the page hits."""
    rows = []
    for c in cards():
        rows.append({"u": url_of(c, BASE), "th": c["th"], "en": c["en"],
                     "lt": c.get("line_th", ""), "le": c.get("line_en", ""),
                     "ic": c.get("icon", "i-star"), "w": c.get("words", []),
                     "d": c.get("shipped") or ""})
    for p in page_entries(docs):
        rows.append({"u": BASE + p["href"], "th": p["th"], "en": p["en"],
                     "lt": p["line_th"], "le": p["line_en"], "ic": "", "w": [], "d": ""})
    seen = {r["u"] for r in rows}
    for s in _fleet():
        if s.get("lane") == "support" or s["url"] in seen:
            continue
        rows.append({"u": s["url"], "th": s.get("th", ""), "en": s["name"],
                     "lt": "", "le": s.get("note", ""), "ic": "i-globe", "w": [], "d": ""})
    return {"generated": _today().isoformat(), "sites": rows}


def sitemap_urls():
    return [BASE + c["href"] for c in cards() if c.get("served") == "worker"]


def llms_section(docs):
    lines = ["", "## Sites on motdang.net", "",
             "The register of minisites and capabilities: " + BASE + "sites/ (JSON: "
             + BASE + "data/sites.json).", ""]
    for c in sorted(cards(), key=lambda c: c.get("shipped") or "", reverse=True):
        lines.append("- [%s · %s](%s): %s" % (c["en"], c["th"], url_of(c, BASE), c.get("line_en", "")))
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    docs = ROOT / "docs"
    miss = unregistered(docs)
    print("cards %d, pages %d, best six: %s" % (
        len(cards()), len(page_entries(docs)), ", ".join(c["id"] for c in best())))
    if miss:
        print(refusal(miss))
        raise SystemExit(1)
