"""WO-52 — the gate that stops the boilerplate growing back.

The prune this test guards was needed because nobody was counting. Fifty-one
work orders each added one reasonable sentence to a shared template, nothing
ever removed one, and by 2026-09-02 the measurement was:

    33 blocks were 5,547,155 of the site's 7,752,480 prose word-instances
    85% of the words on a place page were blocks repeated site-wide
    median place page: 350 words of prose, of which 51 were about the place
    median 132 words of chrome between the <h1> and the first fact

Every one of those sentences was written in good faith. That is exactly why a
test has to hold the line instead of taste: the next reasonable sentence will
also be written in good faith, and the page cannot afford it.

What it FAILS on is furniture and reachability. What it REPORTS is the
medians — Nan, 2026-09-08: "report the medians, don't cap them." The three
numbers this file used to fail at (30 / 60 / 180) were nobody's decision but a
past session's, arrived at the same way the 10 MB index ceiling was; see
notes/gate-audit-2026-09-08.txt. They are printed now, beside what they were
last measured at, so a regression is visible without a line nobody agreed to.

The checks, in the order they matter:

1. NOTHING REPEATED STANDS BEFORE THE FIRST FACT. A reader who opened a
   hospital page came for the hospital. A block that appears on 500+ other
   pages cannot, by construction, be about this one.
2. A PLACE PAGE'S MEDIANS ARE PRINTED — repeated prose, all prose, and
   everything visible, each against what it was on 2026-09-07. Fails on
   nothing.
3. A LONG NOTE IS REACHABLE BY THUMB. `title=` does not open on touch and
   this site is phone-first, so a long title must have a tap-sheet (mark())
   beside it — see build.mark() and the .mk rules in CSS.

Run against docs/ if it is built, else a scratch build is not attempted: this
is a gate on the artefact, and it says so rather than quietly passing.
"""

import os
import random
import re
import sys
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = Path(os.environ.get("MD_DOCS") or (ROOT / "docs"))

# WHAT THE MEDIANS WERE WHEN LAST MEASURED. Not caps — see check 2. These are
# observations with a date on them, so that a number moving is visible in the
# build log, and they are the only thing to compare against: WO-52
# landed the site at 101 words of prose and 10 of lead-in, and the three
# grades below were measured on 2026-09-07.
# `of` is the number of place pages the site held when this was measured. It
# is part of the observation, not decoration: the sample is seeded (the same
# 400 pages every run) but it is seeded over the POPULATION, so when the site
# gains or loses pages the same seed draws a different 400. Two runs an hour
# apart during a build reported different medians for that reason alone, and
# a report that calls that "drift" is telling the reader something untrue.
BASELINE = {"repeated": 21, "prose": 37, "total": 159,
            "on": "2026-09-07", "of": 25889}

# The one cap here that is HERS. It was a session's number like the rest until
# 2026-09-08, when the lot was put to Nan with their provenance and she kept
# this one: "max lead in words ok." So it stays, and it fails a build, and the
# next session to wonder where it came from has the answer on this line rather
# than a file birth time. notes/gate-audit-2026-09-08.txt.
MAX_LEAD_IN_WORDS = 25
REPEAT_THRESHOLD = 500          # a block on this many pages is furniture
SAMPLE = 400
# THE NAV COUNTS ARE GONE. They were caps — 6 in the header and 36 on the
# front page — set the same way as everything else here. Nan, 2026-09-08:
# "nav links too, report/describe don't cap."
#
# The manner of their going is the argument for it. Between reading this file
# and writing to it this morning, another session raised the header cap from
# 6 to 8 with a comment explaining why the new links were fine. That is what a
# cap nobody agreed to actually does: it does not hold a line, it makes every
# session that crosses it stop, write a justification, and move it. The header
# and the front page are DESCRIBED now — the links themselves, printed — and a
# fourth door is something a person notices by reading the list, which is the
# only way anyone was ever going to notice it.

BLOCK_RE = re.compile(
    r"(?is)<(p|li|h1|h2|h3|h4|summary|figcaption|blockquote|dd)\b([^>]*)>(.*?)</\1>")
NESTED_RE = re.compile(r"(?is)<(p|li|ul|ol|table|div)\b")
DROP_RE = re.compile(r"(?is)<(script|style|svg|template|noscript)\b.*?</\1>")
# A closed <details> shows its <summary> and hides the note. Measure what the
# reader actually meets on load, not what the markup contains.
NOTE_RE = re.compile(r'(?is)<span class="mknote">.*?</span>\s*</details>')
# NOT <main>: on this site <main> wraps the masthead and the footer too, so a
# measurement anchored on it is a measurement of the whole page. The record is
# what stands between the name and the footer.
H1_RE = re.compile(r"(?is)<h1\b")
FOOT_RE = re.compile(r"(?is)<footer\b")
# 100 characters, not 60: every note on this site is bilingual, so a one-line
# Thai gloss and its English twin legitimately run to ~90.
TITLE_RE = re.compile(r'(?is)<([a-z0-9]+)\b([^>]*)\stitle="([^"]{101,})"[^>]*>')


def words(text):
    """Thai has no spaces, so count its characters and scale. Rough on
    purpose: this is a budget, not a linguistics claim."""
    thai = len(re.findall(r"[฀-๿]", text))
    latin = len(re.findall(r"[A-Za-z]+", text))
    return latin + thai // 4


# The block that closes every record by design: where the facts came from
# (build.prov_line). It is repeated site-wide, belongs at the tail, and on a
# record thin enough to hold nothing else it is the only prose on the page — so
# a lead-in check that counted it would be measuring thinness, not clutter.
TAIL_CLASSES = ("prov",)


def visible_blocks(html, tags=None, skip_tail=False):
    """Blocks a reader meets on load. `tags` narrows to certain elements."""
    html = DROP_RE.sub(" ", html)
    html = NOTE_RE.sub("</details>", html)
    out = []
    for m in BLOCK_RE.finditer(html):
        inner = m.group(3)
        if NESTED_RE.search(inner):
            continue
        if tags and m.group(1).lower() not in tags:
            continue
        if skip_tail:
            cls = re.search(r'class="([^"]*)"', m.group(2) or "")
            if cls and set(cls.group(1).split()) & set(TAIL_CLASSES):
                continue
        t = re.sub(r"(?s)<[^>]+>", " ", inner)
        t = re.sub(r"&[a-z#0-9]+;", " ", t)
        t = re.sub(r"\s+", " ", t).strip()
        if t:
            out.append(t)
    return out


def all_pages():
    skip = {"fonts", "glyphs", "data", "api"}
    for root, dirs, files in os.walk(DOCS):
        dirs[:] = [d for d in dirs if d not in skip]
        for f in files:
            if f.endswith(".html"):
                yield Path(root) / f


class PageWeight(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not DOCS.exists():
            raise unittest.SkipTest(
                "no built site at %s — build first, or point MD_DOCS at a "
                "scratch build" % DOCS)
        cls.pages = list(all_pages())
        if len(cls.pages) < 100:
            raise unittest.SkipTest("site looks unbuilt (%d pages)" % len(cls.pages))
        counts = Counter()
        probe = cls("test_place_page_medians_are_reported")
        for p in cls.pages:
            for t in set(visible_blocks(probe._record(p), tags={"p", "blockquote"},
                                        skip_tail=True)):
                if words(t) >= 6:
                    counts[t] += 1
        cls.repeated = {t for t, c in counts.items() if c > REPEAT_THRESHOLD}
        places = [p for p in cls.pages if os.sep + "p" + os.sep in str(p)]
        random.Random(52).shuffle(places)
        cls.population = places
        cls.sample = places[:SAMPLE]

    def _record(self, path):
        """The part of the page that is about this place: <h1> to <footer>."""
        html = DROP_RE.sub(" ", path.read_text(encoding="utf-8", errors="replace"))
        html = NOTE_RE.sub("</details>", html)
        m = H1_RE.search(html)
        if not m:
            return ""
        f = FOOT_RE.search(html, m.start())
        return html[m.start():f.start() if f else len(html)]

    def test_no_repeated_block_before_the_first_fact(self):
        """Check 1. Whatever a place page opens with must be about the place.

        The <h1> is exempt: it is the name, and a handful of names really do
        repeat across branches of a chain.
        """
        # Only PROSE counts here. A <dd> holding "Schools & Education" or
        # "OpenStreetMap · Google Maps" repeats across thousands of pages and
        # is still a fact about this one — repetition makes a value shared,
        # not empty. What cannot be about this place is a PARAGRAPH that reads
        # the same on 500 others.
        worst = []
        for path in self.sample:
            run = 0
            for text in visible_blocks(self._record(path), tags={"p", "blockquote"}):
                w = words(text)
                if text not in self.repeated and w >= 4:
                    break
                run += w
            if run > MAX_LEAD_IN_WORDS:
                worst.append((run, path))
        worst.sort(reverse=True)
        self.assertFalse(
            worst[:5],
            "boilerplate stands between the name and the first fact on %d of "
            "%d place pages (cap %d words). Worst:\n  %s\n"
            "A block repeated on 500+ pages is furniture: move it below the "
            "record, put it behind build.mark(), or cut it."
            % (len(worst), len(self.sample), MAX_LEAD_IN_WORDS,
               "\n  ".join("%d words — %s" % (n, p.relative_to(DOCS))
                           for n, p in worst[:5])))

    def test_place_page_medians_are_reported(self):
        """Check 2. The median place page, MEASURED AND PRINTED — never capped.

        Nan, 2026-09-08: *"report the medians, don't cap them."*

        This used to fail a build at 30 / 60 / 180. She had not asked for any
        of those numbers, and they were set the way the 10 MB index ceiling
        was set — measure where the site happens to stand, draw the line just
        above it, and let every later session inherit a number nobody chose.
        Her instruction is the standing one and it is not a threshold: reduce
        the words, everywhere, always. A median printed beside what it was
        last time says whether that is happening. A median in an assertion
        says only that somebody once picked a number.

        WHAT THIS COUNTS, AND WHY IT CHANGED ON 2026-09-07. Until today this
        was one number: every visible word between the name and the footer,
        capped at 140 against the 101 WO-52 left. That was a proxy, and the
        thesis at the top of this file says what it was a proxy FOR — "85% of
        the words on a place page were blocks repeated site-wide". The proxy
        and the thesis part company as soon as a page carries more DATA: a
        bearings line ("580 m from Chang Phueak Gate") and five neighbours
        with their metres are 40 words that are different on all 25,800
        pages, and they are the opposite of the disease. WO-69/71 added both
        and the single number read 159.
        
        So it now counts the disease directly, in three grades:
          · REPEATED prose — a paragraph on 500+ pages, the thing this file
            was written to stop. Median 21 today.
          · ALL prose — <p> and <blockquote>, sentences of any kind. 37.
          · everything visible, as a backstop against a wall of anything. 159.
        A new sentence on the shared template still lands on the first two,
        which is where it always landed; a per-place fact no longer does.
        """
        rec = [self._record(p) for p in self.sample]
        prose = [list(visible_blocks(r, tags={"p", "blockquote"})) for r in rec]

        def med(v):
            v = sorted(v)
            return v[len(v) // 2]

        now = {
            "repeated": med(sum(words(t) for t in b if t in self.repeated)
                            for b in prose),
            "prose": med(sum(words(t) for t in b) for b in prose),
            "total": med(sum(words(t) for t in visible_blocks(r)) for r in rec),
        }
        rows = (
            ("repeated", "prose repeated on 500+ pages — the disease WO-52 "
                         "was written to stop"),
            ("prose", "all prose between the name and the footer"),
            ("total", "everything visible"),
        )
        pop = len(self.population)
        same_corpus = pop == BASELINE["of"]
        out = ["", "  MEDIAN PLACE PAGE — reported, not capped",
               "  %d sampled of %s place pages (%s held %s)"
               % (len(self.sample), f"{pop:,}", BASELINE["on"],
                  f"{BASELINE['of']:,}"),
               "  %-9s %6s %8s   %s" % ("", "now", BASELINE["on"], "")]
        for key, what in rows:
            was = BASELINE[key]
            d = now[key] - was
            out.append("  %-9s %6d %8d  %+5d   %s"
                       % (key, now[key], was, d, what))
        out.append("")
        if not same_corpus:
            # Say it plainly and draw no arrow. The seeded sample is drawn
            # over the whole population, so a site that gained 99,523 pages
            # is not the site this baseline was taken on, and the two columns
            # are two different measurements rather than a before and after.
            out.append("  ^ the site has %s pages, not the %s this baseline "
                       "was taken over," % (f"{pop:,}", f"{BASELINE['of']:,}"))
            out.append("    so these are two measurements, not a trend. "
                       "Re-take the baseline when the corpus settles.")
            out.append("")
            print("\n".join(out))
            return
        moved = [k for k, _ in rows if now[k] > BASELINE[k]]
        if moved:
            # Said out loud, and it still passes. Something got wordier; a
            # person decides whether that is a regression or a fact the page
            # gained. A sentence added to the shared template lands on
            # `repeated` and `prose`; a per-place fact lands only on `total`.
            out.append("  ^ up since %s: %s. If a sentence went onto the shared"
                       % (BASELINE["on"], ", ".join(moved)))
            out.append("    template, it is on every page — count it before "
                       "printing it.")
            out.append("")
        print("\n".join(out))

    def test_a_long_note_is_reachable_by_thumb(self):
        """Check 3. No long explanation hides where a phone cannot open it.

        `title=` is a mouse affordance. Short ones are fine — a label, a
        date, a one-line gloss. A long one is a paragraph in hiding, and on a
        phone-first Thai directory it is simply lost.
        """
        offenders = []
        for path in self.sample:
            html = path.read_text(encoding="utf-8", errors="replace")
            for m in TITLE_RE.finditer(html):
                tag, attrs, note = m.group(1).lower(), m.group(2), m.group(3)
                # A summary's title IS the tap-sheet's pointer twin — the
                # same words sit in the .mknote beside it.
                if tag == "summary":
                    continue
                # A tag pill's provenance is listed, per page, in the tap-sheet
                # on the row's own 🏷 label (tags_layer.pills). The pill keeps
                # its title for a pointer; nothing is only there.
                if 'class="tag"' in attrs:
                    continue
                offenders.append((len(note), path, note[:70]))
        offenders.sort(reverse=True)
        self.assertFalse(
            offenders[:5],
            "%d long title= attributes have no tap-sheet. `title` does not "
            "open on touch and this stylesheet has one @media (hover:hover) "
            "rule, for the marks. Wrap it in build.mark() instead. Worst:\n  %s"
            % (len(offenders),
               "\n  ".join("%d chars in <%s> — %s… (%s)"
                           % (n, "tag", t, p.relative_to(DOCS))
                           for n, p, t in offenders[:5])))

    # ---- WO-65 (2026-09-06): NOW · NEAR --------------------------------
    # Beer's rule: every page leads with what is happening now and what is
    # near; the furniture goes behind ☰. Before that work the header carried
    # 35 links above a place's name and the front page 168 links in 24 bands.
    # Those two facts are why anyone looks at this; the two caps that used to
    # sit here were a session's guess at where the line should fall.

    LINK_RE = re.compile(r"(?is)<a\s[^>]*>(.*?)</a>")

    def _open_links(self, html):
        """The links a reader meets on load: outside every <details>."""
        html = DROP_RE.sub(" ", html)
        html = re.sub(r"(?is)<details\b.*?</details>", " ", html)
        out = []
        for inner in self.LINK_RE.findall(html):
            t = " ".join(re.sub(r"(?is)<[^>]+>", " ", inner).split())
            out.append(t or "·")          # a bare glyph or an image link
        return out

    def test_the_doors_are_described(self):
        """The header and the front page, said out loud. Fails on nothing.

        What a reader meets before they have scrolled or opened anything is
        worth looking at every build. It is not worth a number: "6" cannot
        tell you that the sixth link is a fourth door rather than a language
        toggle, and the useful question — is this still map, calendar and the
        box? — is answered by reading the list.
        """
        shapes = {}
        for path in self.sample:
            html = path.read_text(encoding="utf-8", errors="replace")
            m = re.search(r'(?is)<header class="site[^"]*">(.*?)</header>', html)
            if not m:
                continue
            links = self._open_links(m.group(1))
            shapes.setdefault(" · ".join(links), 0)
            shapes[" · ".join(links)] += 1

        out = ["", "  THE HEADER, on %d sampled place pages — described, not capped"
               % len(self.sample)]
        if not shapes:
            out.append("    no <header class=\"site\"> found — is docs/ built?")
        for shape, n in sorted(shapes.items(), key=lambda x: -x[1]):
            out.append("    %4d pages   %d links   %s"
                       % (n, len(shape.split(" · ")), shape))

        home = DOCS / "index.html"
        out.append("")
        if not home.exists():
            # Said, not raised. A half-written docs/ is a fact about the tree,
            # not a failure of the front page.
            out.append("  THE FRONT PAGE: docs/index.html is not on disk — "
                       "mid-build, or not built.")
        else:
            html = home.read_text(encoding="utf-8", errors="replace")
            above = html[: html.find("<footer")] if "<footer" in html else html
            links = self._open_links(above)
            out.append("  THE FRONT PAGE — %d links open above the footer, "
                       "outside every fold:" % len(links))
            line = "    "
            for t in links:
                t = t if len(t) <= 24 else t[:23] + "…"
                if len(line) + len(t) > 76:
                    out.append(line)
                    line = "    "
                line += t + " · "
            out.append(line.rstrip(" ·"))
        out.append("")
        print("\n".join(out))


if __name__ == "__main__":
    unittest.main(verbosity=2)
