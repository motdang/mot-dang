"""A share card of its own for each main page (Nan 2026-10-20: all her sites carry unique share cards).

    data/curated/sharecards.json   {"cards": {"/adhd.html": {...}, "/sites/krathong/th/": {...}}}
    assets/og/p/<slug>.jpg         the 1200x630 cards, drawn by share-cards/render.mjs

An entry names a page by its path under the site root. A trailing slash means
its index.html. An entry with "img" points the page at og/p/<img>; an entry
without one keeps the page's own og:image and adds what its tags lack (the alt
text, the size, summary_large_image). "alt" says what the card shows; "w" and
"h" are the picture's size; "title" is the page's title the card was drawn for; "desc" is the description for a page that has none.

emit(docs) runs last in build(), after every layer has written its pages, so
the tags survive whatever generated the page: build.py's page(), a minisite
copied from assets/sites/, /ghost, /full-moon, /chiang-rai. The pictures ride
through media_layer (docs/og/p/, or mot-dang-media when it is on).
"""

import html
import json
import re
import urllib.parse
from pathlib import Path

import media_layer

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "data" / "curated" / "sharecards.json"
SRC = ROOT / "assets" / "og" / "p"
BASE = "https://motdang.net/"

_KEYS = r"og:image(?::(?:width|height|alt|type|secure_url|url))?|twitter:image(?::alt)?|twitter:card"
_OLD = re.compile(r'[ \t]*<meta\s+[^>]*(?:property|name)\s*=\s*["\'](?:' + _KEYS + r')["\'][^>]*>[ \t]*\n?', re.I)
_OG_IMAGE = re.compile(r'<meta\s+[^>]*(?:property|name)\s*=\s*["\']og:image["\'][^>]*>', re.I)
_CONTENT = re.compile(r'content\s*=\s*"([^"]*)"|content\s*=\s*\'([^\']*)\'', re.I)
_ANCHOR = (re.compile(r'<meta\s+[^>]*property\s*=\s*["\']og:description["\'][^>]*>', re.I),
           re.compile(r'<meta\s+[^>]*property\s*=\s*["\']og:title["\'][^>]*>', re.I))
_TITLE = re.compile(r"<title>(.*?)</title>", re.I | re.S)
_OG_TITLE = re.compile(r'<meta\s+[^>]*property\s*=\s*["\']og:title["\'][^>]*content\s*=\s*"([^"]*)"', re.I)
_OG_DESC = re.compile(r'<meta\s+[^>]*property\s*=\s*["\']og:description["\']', re.I)
_DESC = re.compile(r'<meta\s+[^>]*name\s*=\s*["\']description["\'][^>]*>', re.I)
_BODY = re.compile(r"<(?:body|header|main|nav|div|section|article|aside|footer|h1|h2|p)\b", re.I)


def load():
    try:
        return json.loads(MANIFEST.read_text(encoding="utf-8")).get("cards", {})
    except (OSError, ValueError):
        return {}


def target(docs, key):
    k = key.lstrip("/")
    if k == "" or k.endswith("/"):
        k += "index.html"
    return Path(docs) / k


def tags(image, alt, w, h):
    a, i = html.escape(alt, quote=True), html.escape(image, quote=True)
    t = "image/png" if urllib.parse.urlparse(image).path.lower().endswith(".png") else "image/jpeg"
    return (f'<meta property="og:image" content="{i}">'
            f'<meta property="og:image:width" content="{w}"><meta property="og:image:height" content="{h}">'
            f'<meta property="og:image:type" content="{t}"><meta property="og:image:alt" content="{a}">'
            f'<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="{i}">'
            f'<meta name="twitter:image:alt" content="{a}">')


def own_image(text, page_url):
    """The page's og:image as an absolute URL, or None."""
    m = _OG_IMAGE.search(text)
    c = _CONTENT.search(m.group(0)) if m else None
    if not c:
        return None
    return urllib.parse.urljoin(page_url, html.unescape(c.group(1) or c.group(2) or ""))


def _basics(head, desc=None):
    """og:title and og:description from the page's own <title> and description, for a page with none."""
    out = ""
    if not _OG_TITLE.search(head):
        t = _TITLE.search(head)
        if t and t.group(1).strip():
            out += '<meta property="og:title" content="%s">' % re.sub(r"\s+", " ", t.group(1)).strip().replace('"', "&quot;")
    if not _OG_DESC.search(head):
        d = _DESC.search(head)
        c = _CONTENT.search(d.group(0)) if d else None
        if c and (c.group(1) or c.group(2)):
            out += '<meta property="og:description" content="%s">' % (c.group(1) or c.group(2)).replace('"', "&quot;")
        elif desc:
            out += '<meta property="og:description" content="%s">' % html.escape(desc, quote=True)
    return out


def _head_end(text):
    """Where the head stops: at </head>, or on a page that leaves the tag out
    (/ghost, /served), at the first element that only a body holds."""
    m = re.search(r"</head\s*>", text, re.I)
    if m:
        return m.start()
    t = re.search(r"<title\b", text, re.I)
    b = _BODY.search(text, t.end() if t else 0)
    return b.start() if b else None


def stamp(text, image, alt, w=1200, h=630, desc=None):
    end = _head_end(text)
    if end is None:
        return text
    head, rest = text[:end], text[end:]
    head = _OLD.sub("", head)
    block = _basics(head, desc) + tags(image, alt, w, h)
    for rx in _ANCHOR:
        m = rx.search(head)
        if m:
            return head[:m.end()] + "\n" + block + head[m.end():] + rest
    return head.rstrip() + "\n" + block + "\n" + rest


def _titled(text, title):
    """True when the page still carries the title the card was drawn for."""
    seen = [m for m in (_TITLE.search(text), _OG_TITLE.search(text)) if m]
    return not seen or any(title in re.sub(r"\s+", " ", html.unescape(m.group(1))) for m in seen)


def emit(docs):
    """Stamp every page the manifest names. Returns (stamped, missing, stale)."""
    docs = Path(docs)
    stamped, missing, stale, undrawn = 0, [], [], []
    for key, e in sorted(load().items()):
        f = target(docs, key)
        if not f.is_file():
            missing.append(key)
            continue
        text = f.read_text(encoding="utf-8")
        page_url = BASE + (key.lstrip("/"))
        if e.get("img"):
            src = SRC / e["img"]
            if not src.is_file():
                undrawn.append(key)
                continue
            media_layer.put(src, docs, "og/p/" + e["img"])
            image = BASE + "og/p/" + e["img"]
        else:
            image = own_image(text, page_url)
            if not image:
                undrawn.append(key)
                continue
        if e.get("title") and not _titled(text, e["title"]):
            stale.append(key)
        new = stamp(text, image, e["alt"], e.get("w", 1200), e.get("h", 630), e.get("desc"))
        if new != text:
            f.write_text(new, encoding="utf-8")
            stamped += 1
    if missing:
        print("  share cards: no page for %d entr%s: %s" % (len(missing), "y" if len(missing) == 1 else "ies", ", ".join(missing[:6])))
    if undrawn:
        print("  share cards: no picture for %d: %s" % (len(undrawn), ", ".join(undrawn[:6])))
    if stale:
        print("  share cards: %d drawn for an older title: %s" % (len(stale), ", ".join(stale[:6])))
    return stamped, len(missing), len(stale)
