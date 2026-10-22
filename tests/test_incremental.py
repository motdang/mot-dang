#!/usr/bin/env python3
"""Tests for incremental.py: which place pages a round draws and which it carries.

    python3 tests/test_incremental.py

The planner is run on a small town of invented places with a fake host standing
in for build.py: five places, one id table (claims), one nearby query each. The
last part imports the real build.py and runs its _place_chunk over fake files,
to see that a carried page is moved and not drawn.
"""
import datetime as dt
import json
import os
import shutil
import sys
import tempfile
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("MD_JOBS", "1")

import incremental as inc  # noqa: E402

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("  %s %s%s" % ("ok  " if cond else "FAIL", name, "" if cond else "  — " + detail))


NOW = dt.datetime(2026, 10, 22, 12, 0, tzinfo=dt.timezone.utc)


# ---------------------------------------------------------------- the town
class Town:
    """Places a..e on a line; each page names its two nearest."""

    def __init__(self):
        self.recs = {i: {"id": i, "name": i.upper(), "phone": "053-%03d" % n,
                         "lat": 18.0 + n * 0.001, "lng": 99.0}
                     for n, i in enumerate("abcde")}
        self.claims = {}
        self.written = {}       # rel -> bytes, "what is in last build's docs/"
        self.date = "2026-10-22"
        self.skip = ()

    def slug(self, r):
        return r["id"]

    def all_ids(self):
        return self.recs.keys()

    def namespaces(self):
        return {"town": {"CLAIMS": self.claims, "WORDS": {"x": 1}, "NAMES": {"a": 1, "zz": 2}}}

    def replay(self, args, exclude_id):
        lat = args[0]
        near = sorted((r for r in self.recs.values() if r["id"] != exclude_id),
                      key=lambda r: abs(r["lat"] - lat))
        return near[:args[4]]

    # what the build wrote last time
    def last_digest(self, rel):
        raw = self.written.get(rel)
        return inc.bytes_digest(raw) if raw is not None else None

    def last_bytes(self, rel):
        return self.written.get(rel)

    def draw(self, r, photo):
        """A page is its record, its claim and its two nearest names."""
        near = self.replay([r["lat"], r["lng"], 0, 0, 2], r["id"])
        html = "%s|%s|%s|%s" % (r["name"], r["phone"], self.claims.get(r["id"]),
                                ",".join(n["name"] for n in near))
        return html, json.dumps(r, sort_keys=True)


def run_round(town, state, files, photos=None, canary=0, check_dates=True):
    """One build over the town: what a round draws, and the state it leaves."""
    inc.CANARY = canary
    rnd = inc.Round(town, now=NOW, state=state)
    records = list(town.recs.values())
    photos = photos or {}
    # settle(), with the file list given instead of read
    ids = {r["id"] for r in records}
    rnd.tables = inc.find_tables(town.namespaces(), ids, town.skip)
    rnd.sizes = {lab: len(t) for lab, t in rnd.tables}
    rnd.files = files
    rnd.decision = inc.decide(state, files, town.date, NOW, off=False, full_now=False)
    rnd.tally.decision = rnd.decision
    plan = rnd.province("cm", records, photos)
    rnd.canary(plan, records, photos, town.draw, "seed")
    drawn = sorted(k for k, pg in plan.items() if not pg.carry)
    for r in records:
        pk = "cm/p/" + town.slug(r)
        pg = plan[pk]
        if not pg.carry:
            near = []
            trace = [[r["lat"], r["lng"], 0, 0, 2]]
            rnd.note_drawn(pk, pg.base, rnd.nearby(r, trace), pg.rec, trace)
            html, js = town.draw(r, None)
            town.written[pk + ".html"] = html.encode()
            town.written[pk + ".json"] = js.encode()
    rnd.tally.drawn = len(drawn)
    return rnd, plan, drawn


def main():
    print("decide")
    f1 = {"build.py": "aa", "data/tags.json": "bb"}
    st = {"v": 1, "files": dict(f1), "date": "2026-10-22", "full_at": "2026-10-20T00:00:00+00:00"}
    d = inc.decide(None, f1, "2026-10-22", NOW, off=False, full_now=False)
    check("no state: full", d.full and "no state" in d.reason, repr(d))
    d = inc.decide(st, f1, "2026-10-22", NOW, off=True, full_now=False)
    check("MD_INCREMENTAL=0: full", d.full and "MD_INCREMENTAL=0" in d.reason, repr(d))
    d = inc.decide(st, f1, "2026-10-22", NOW, off=False, full_now=True)
    check("cache/full-now: full, and checked", d.full and d.check, repr(d))
    d = inc.decide(st, f1, "2026-10-22", NOW, off=False, full_now=False)
    check("same code, data, date: incremental", not d.full, repr(d))
    d = inc.decide(st, dict(f1, **{"build.py": "zz"}), "2026-10-22", NOW, off=False, full_now=False)
    check("a code change forces full, names the file",
          d.full and "build.py" in d.reason and not d.check, repr(d))
    d = inc.decide(st, dict(f1, **{"data/tags.json": "zz"}), "2026-10-22", NOW, off=False, full_now=False)
    check("a data change forces full", d.full and "data/tags.json" in d.reason, repr(d))
    d = inc.decide(st, {"build.py": "aa"}, "2026-10-22", NOW, off=False, full_now=False)
    check("a file the last build read and this one cannot find forces full",
          d.full and "data/tags.json" in d.reason, repr(d))
    d = inc.decide(st, dict(f1, **{"data/new.json": "q"}), "2026-10-22", NOW, off=False, full_now=False)
    check("a file read for the first time is recorded, not compared", not d.full, repr(d))
    d = inc.decide(st, f1, "2026-10-23", NOW, off=False, full_now=False)
    check("a new day alone is not a reason (pages with a date in their record are drawn)", not d.full, repr(d))
    old = dict(st, full_at="2026-10-10T00:00:00+00:00")
    d = inc.decide(old, f1, "2026-10-22", NOW, off=False, full_now=False)
    check("a state 12 days old is still incremental (the audit draws every page instead)", not d.full, repr(d))

    print("id tables")
    ids = {"a", "b", "c", "d", "e"}
    ns = {"m": {"BY": {"a": 1, "b": 2}, "OTHER": {"x": 1, "y": 2}, "_rank_cache": {"a": 1},
                "SET": {"c", "d"}, "LOADER": ({"rows": 1}, {"a": 0, "e": 1}), "EMPTY": {},
                "SKIPME": {"a": 1}}}
    skip = [id(ns["m"]["SKIPME"])]
    got = dict(inc.find_tables(ns, ids, skip))
    check("a dict keyed by place ids is a table", "m.BY" in got, str(list(got)))
    check("a set of place ids is a table", "m.SET" in got, str(list(got)))
    check("a table inside a loader's tuple is found", "m.LOADER[1]" in got, str(list(got)))
    check("a dict with other keys is not", "m.OTHER" not in got, str(list(got)))
    check("a cache is not (its contents depend on what was drawn)", "m._rank_cache" not in got)
    check("a table the host hashes another way is skipped", "m.SKIPME" not in got)

    print("one town, three builds")
    town = Town()
    rnd1, plan1, drawn1 = run_round(town, None, f1)
    check("first build: no state, every page drawn", rnd1.decision.full and len(drawn1) == 5, str(drawn1))
    state1 = rnd1.state_out()
    check("the state keeps a base, a nearby digest, a record digest and the queries per page",
          all(len(v) == 4 and v[3] for v in state1["pages"].values()), str(list(state1["pages"].values())[:1]))
    state1["full_at"] = NOW.isoformat()

    rnd2, plan2, drawn2 = run_round(town, state1, f1)
    check("nothing changed: nothing drawn", not rnd2.decision.full and drawn2 == [], str(drawn2))
    check("nothing changed: every page carried", all(pg.carry for pg in plan2.values()))
    state2 = rnd2.state_out()
    check("the full build's date is kept through a carried round", state2["full_at"] == state1["full_at"])

    # a phone changes: a nearby list does not show it, so that page alone
    town.recs["c"] = dict(town.recs["c"], phone="053-999")
    rnd3, plan3, drawn3 = run_round(town, state2, f1)
    check("a changed phone draws that page and nothing else", drawn3 == ["cm/p/c"], str(drawn3))
    check("only one page has a changed record",
          [k for k, pg in plan3.items() if pg.rec != plan2[k].rec] == ["cm/p/c"])
    state3 = rnd3.state_out()
    # a name changes: that page and the pages that name it
    town.recs["c"] = dict(town.recs["c"], name="Cee")
    rnd3b, plan3b, drawn3b = run_round(town, state3, f1)
    named_c = sorted("cm/p/" + town.slug(r) for r in town.recs.values()
                     if r["id"] != "c" and "c" in [n["id"] for n in town.replay([r["lat"], 0, 0, 0, 2], r["id"])])
    check("a changed name draws that page and the pages that name it, nothing more",
          drawn3b == sorted(["cm/p/c"] + named_c), "drew %s, wanted c + %s" % (drawn3b, named_c))
    state3 = rnd3b.state_out()

    # an id table entry (a claim) changes: that page only
    town.claims["a"] = {"confirmedAt": "2026-10-22"}
    rnd4, plan4, drawn4 = run_round(town, state3, f1)
    check("a changed id-table entry draws that page", drawn4 == ["cm/p/a"], str(drawn4))
    state4 = rnd4.state_out()

    # the date moves: only a page whose record holds a date can count from it
    town.recs["d"] = dict(town.recs["d"], confirmedAt="2026-10-01")
    rnd4b, _, drawn4b = run_round(town, state4, f1)
    state4 = rnd4b.state_out()
    town.date = "2026-10-23"
    rnd5, plan5, drawn5 = run_round(town, state4, f1)
    check("a new day draws the page whose record holds a date, and no other",
          not rnd5.decision.full and drawn5 == ["cm/p/d"], "%r %s" % (rnd5.decision, drawn5))
    check("record_info says which records hold a date",
          inc.record_info({"a": "x", "confirmedAt": "2026-10-01"})[1] and not inc.record_info({"a": "2026"})[1])
    state4 = rnd5.state_out()
    town.date = "2026-10-22"

    # a code change
    rnd6, plan6, drawn6 = run_round(town, state4, dict(f1, **{"build.py": "changed"}))
    check("a code change draws every page", rnd6.decision.full and len(drawn6) == 5 and not rnd6.decision.check)

    # a removed place
    del town.recs["e"]
    rnd7, plan7, drawn7 = run_round(town, state4, f1)
    check("a removed place is named", rnd7.removed("cm", plan7) == ["cm/p/e"], str(rnd7.removed("cm", plan7)))
    check("a removed place does not stop the others being carried",
          all(pg.carry for k, pg in plan7.items() if k not in drawn7))
    check("a removed place is gone from the next state", "cm/p/e" not in rnd7.state_out()["pages"])
    town.recs["e"] = {"id": "e", "name": "E", "phone": "053-004", "lat": 18.004, "lng": 99.0}

    # the canary
    town2 = Town()
    r1, _, _ = run_round(town2, None, f1)
    s1 = r1.state_out()
    town2.written["cm/p/b.html"] = b"something the last build never wrote"
    r2, plan, drawn = run_round(town2, s1, f1, canary=100)
    check("a canary page that moved turns the round full", r2.decision.full and len(drawn) == 5
          and "canary" in r2.decision.reason, "%r drawn %s" % (r2.decision, drawn))
    check("the page that moved is named", any("cm/p/b." in x for x in r2.tally.canary_bad), str(r2.tally.canary_bad))

    # an id table that grows while pages are drawn (a set of "shown" ids, say)
    town3 = Town()
    town3.claims["a"] = {"x": 1}
    r1, _, _ = run_round(town3, None, f1)
    s1 = r1.state_out()
    rnd = inc.Round(town3, now=NOW, state=s1)
    rnd.tables = inc.find_tables(town3.namespaces(), set(town3.recs), ())
    rnd.sizes = {lab: len(t) for lab, t in rnd.tables}
    rnd.files = f1
    rnd.decision = inc.decide(s1, f1, town3.date, NOW, off=False, full_now=False)
    rnd.tally.decision = rnd.decision
    recs3 = list(town3.recs.values())
    plan = rnd.province("cm", recs3, {})

    def growing(r, photo):
        town3.claims["zz-" + r["id"]] = 1
        return town3.draw(r, photo)
    inc.CANARY = 100
    rnd.canary(plan, recs3, {}, growing, "seed")
    check("an id table that changes size while pages are drawn turns the round full",
          rnd.decision.full and any("changed while pages were drawn" in x for x in rnd.tally.canary_bad),
          "%r %s" % (rnd.decision, rnd.tally.canary_bad))

    # the audit: once a week every page about to be carried is drawn and compared
    town4 = Town()
    r1, _, _ = run_round(town4, None, f1)
    s1 = r1.state_out()
    check("a full build counts as the last audit", s1["audited_at"] == s1["full_at"])
    r2, plan, drawn = run_round(town4, s1, f1, canary=1)
    check("inside the week, the sample is the canary's", r2.tally.sampled == 1 and not r2.audit_due(), str(r2.tally.sampled))
    old_state = dict(s1, full_at="2026-10-10T00:00:00+00:00", audited_at="2026-10-10T00:00:00+00:00")
    town4.written["cm/p/d.html"] = b"drifted since it was written"
    r3, plan, drawn = run_round(town4, old_state, f1, canary=1)
    check("a week on, the page that drifted is found by drawing every one, and named",
          r3.decision.full and "audit" in r3.decision.reason and any("cm/p/d" in x for x in r3.tally.canary_bad),
          "%r %s" % (r3.decision, r3.tally.canary_bad))
    town5 = Town()
    r1, _, _ = run_round(town5, None, f1)
    old_state = dict(r1.state_out(), full_at="2026-10-10T00:00:00+00:00", audited_at="2026-10-10T00:00:00+00:00")
    r4, plan, drawn = run_round(town5, old_state, f1, canary=1)
    s4 = r4.state_out()
    check("an audit that finds nothing moves audited_at on, and the round stays incremental",
          not r4.decision.full and r4.tally.sampled == 5 and r4.tally.audit and s4["audited_at"] > old_state["audited_at"]
          and s4["full_at"] == old_state["full_at"], "%r %s %s" % (r4.decision, r4.tally.sampled, s4["audited_at"]))

    # the tally
    t = rnd3.tally
    t.carried, t.drawn, t.own = 3, 2, 1
    line = t.line()
    check("the log line says carried and drawn", "3 carried" in line and "2 drawn" in line, line)

    print("input stamp")
    tmp = Path(tempfile.mkdtemp())
    try:
        (tmp / "data" / "canonical").mkdir(parents=True)
        (tmp / "data" / "curated").mkdir(parents=True)
        (tmp / "assets" / "sites" / "x").mkdir(parents=True)
        (tmp / "cache").mkdir()
        (tmp / "data" / "canonical" / "cm.json").write_text("[1]")
        (tmp / "data" / "streets.json").write_text('{"counts": 1}')
        (tmp / "data" / "air.json").write_text('{"a": 1}')
        (tmp / "data" / "curated" / "kinds.json").write_text('{"k": 1}')
        (tmp / "data" / "tags.json").write_text('{"generated": "2026-10-22", "t": 1}')
        (tmp / "assets" / "ticker.js").write_text("var a;")
        (tmp / "assets" / "sites" / "x" / "index.html").write_text("<html>")
        (tmp / "cache" / "place-pages-kept.json").write_text("{}")
        (tmp / "docs.next").mkdir()
        (tmp / "docs.next" / "a.html").write_text("x")
        inc.STAMPS = tmp / "cache" / "incremental-stamps.json"
        read = [str(tmp / p) for p in (
            "data/canonical/cm.json", "data/streets.json", "data/air.json", "data/curated/kinds.json",
            "data/tags.json", "assets/ticker.js", "assets/sites/x/index.html",
            "cache/place-pages-kept.json", "docs.next/a.html")]
        files = inc.input_files(root=tmp, read=read, modules=[])
        check("a curated data file is an input", "data/curated/kinds.json" in files, str(sorted(files)))
        check("a file straight in assets/ is an input", "assets/ticker.js" in files)
        check("records are not (the fingerprint hashes them)", "data/canonical/cm.json" not in files)
        check("files derived from records are not", "data/streets.json" not in files)
        check("live readings are not (they go up on their own)", "data/air.json" not in files)
        check("a minisite copied whole is not", "assets/sites/x/index.html" not in files)
        check("what the build writes is not",
              not any(k.startswith(("docs.next", "cache/")) for k in files), str(sorted(files)))
        (tmp / "data" / "tags.json").write_text('{"generated": "2026-10-23", "t": 1}')
        files2 = inc.input_files(root=tmp, read=read, modules=[])
        check("a stamped date alone is not a change", files2["data/tags.json"] == files["data/tags.json"])
        (tmp / "data" / "tags.json").write_text('{"generated": "2026-10-23", "t": 2}')
        files3 = inc.input_files(root=tmp, read=read, modules=[])
        check("a changed value is", files3["data/tags.json"] != files["data/tags.json"])
        files4 = inc.input_files(root=tmp, read=[], modules=[], extra=["data/tags.json"])
        check("a file the last state names is read from disk even if not opened this time",
              "data/tags.json" in files4)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("stable digests")
    check("a set is written in order", inc.stable({"a": {3, 1, 2}}) == '{"a":["1","2","3"]}', inc.stable({"a": {3, 1, 2}}))
    check("an object's address is not in the digest", inc.digest({"o": object()}) == inc.digest({"o": object()}))
    check("keys of mixed kinds do not raise", isinstance(inc.stable({("a", 1): 1, "b": 2}), str))

    print("date forms")
    check("ISO and Buddhist-era", inc.date_forms("2026-10-22") == ["2026-10-22", "2569-10-22"])
    check("normalise takes the date out",
          inc.normalise(b"as of 2026-10-22 / 2569-10-22", inc.date_forms("2026-10-22")) == b"as of <d> / <d>")

    print("build.py")
    build_checks()

    print("\n%d passed, %d failed" % (len(PASS), len(FAIL)))
    sys.exit(1 if FAIL else 0)


def build_checks():
    """The real build.py: a carried page is moved from last build's docs/ and not drawn."""
    import build
    tmp = Path(tempfile.mkdtemp())
    try:
        final, new = tmp / "docs", tmp / "docs.next"
        for d in (final, new):
            (d / "cm" / "p").mkdir(parents=True)
        recs = [{"id": i, "name": i, "province": "cm", "lat": 18.0, "lng": 99.0}
                for i in ("a", "b", "c")]
        for r in recs:
            for ext, body in (("html", "<html>%s</html>" % r["id"]), ("json", '{"id": "%s"}' % r["id"])):
                (final / "cm" / "p" / f"{r['id']}.{ext}").write_text(body)
        kept = {}
        for f in (final / "cm" / "p").iterdir():
            raw = f.read_bytes()
            st = f.stat()
            kept["cm/p/" + f.name] = [inc.bytes_digest(raw), st.st_size, st.st_mtime_ns]
        # b's html is touched after it was written (a layer added a band): not carryable
        (final / "cm" / "p" / "b.html").write_text("<html>b with a band</html>")

        drawn = []
        saved = {k: getattr(build, k) for k in ("DOCS", "_FINAL_DOCS", "place_slug", "_draw_place", "name_text")}
        build.DOCS, build._FINAL_DOCS = new, final
        build._KEPT_WAS.clear()
        build._KEPT_WAS.update(kept)
        build.place_slug = lambda r: r["id"]
        build.name_text = lambda r: r["name"]

        def fake_draw(r, p, key, photo, slug):
            drawn.append(r["id"])
            return "<html>drawn %s</html>" % r["id"], "{}"
        build._draw_place = fake_draw
        try:
            plan = {}
            for r in recs:
                pk = "cm/p/" + r["id"]
                plan[pk] = inc.Page(pk, "base", "rec", True, True, [])
            class StubRound:
                decision = inc.Decision(False, "same")
                state = None
                B = type("B", (), {"date": "2026-10-22", "last_bytes": staticmethod(lambda rel: None)})

                @staticmethod
                def nearby(r, trace):
                    return "nearby"
            build._PP.update(records=recs, pdir=new / "cm", key="cm", p={}, photos={}, parent=os.getpid(),
                             plan=plan, round=StubRound)
            out = build._place_chunk(list(range(3)))
            images, unknown, written, moved, inputs, fresh, misses, carried, own = out
            check("two pages are carried, one drawn", carried == 2 and drawn == ["b"], "carried %d drawn %s" % (carried, drawn))
            check("a carried page is moved, not copied",
                  (new / "cm" / "p" / "a.html").exists() and not (final / "cm" / "p" / "a.html").exists()
                  and (new / "cm" / "p" / "a.json").read_text() == '{"id": "a"}')
            check("the file that was touched after it was written is drawn fresh",
                  (new / "cm" / "p" / "b.html").read_text() == "<html>drawn b</html>")
            check("the page that is drawn says so for the state", list(fresh) == ["cm/p/b"], str(list(fresh)))
            check("every page keeps its input hash for the weekly round",
                  set(inputs) == {"cm/p/%s.%s" % (i, e) for i in "abc" for e in ("html", "json")})
        finally:
            build._PP.clear()
            for k, v in saved.items():
                setattr(build, k, v)
            build._KEPT_WAS.clear()
        # near_view() says what a page takes from a place it names nearby; the two blocks that
        # draw the nearby list and the map must take nothing else
        import inspect
        import re
        calls, keys = set(), set()
        for fn in (build.place_map, build.detail_page):
            src = inspect.getsource(fn)
            calls |= set(re.findall(r"\b(\w+)\(\s*(?:nb|_x)\s*[,)]", src))
            keys |= set(re.findall(r'\b(?:nb|_x)\[\s*["\'](\w+)["\']\s*\]', src))
            keys |= set(re.findall(r'\b(?:nb|_x)\.get\(\s*["\'](\w+)["\']', src))
        view = inspect.getsource(build._IncrHost.near_view)
        viewed = set(re.findall(r"\b(\w+)\(r\)", view)) | set(re.findall(r'r\.get\("(\w+)"\)', view))
        check("the nearby list and the map call only functions near_view calls",
              calls and calls <= viewed, "also call %s" % sorted(calls - viewed))
        check("and read only fields near_view reads", keys <= viewed | {"lat", "lng"},
              "also read %s" % sorted(keys - viewed - {"lat", "lng"}))
        # the sitemap does not read a page it already knows
        page = tmp / "p.html"
        page.write_text('<html><link rel="canonical" href="https://motdang.net/cm/p/x.html">hello</html>')
        st = page.stat()
        fingerprint = lambda text: "fp-" + str(len(text))
        got = build.sitemap_page(page, "cm/p/x.html", st, None, "v1", fingerprint)
        check("a page not seen before is read: its fingerprint and its canonical address",
              got == ("fp-" + str(len(page.read_text())), "https://motdang.net/cm/p/x.html"), str(got))
        page.write_text("changed behind the cache's back, same size and mtime claimed")
        entry = [got[0], "2026-10-01", st.st_size, st.st_mtime_ns, got[1], "v1"]
        check("a page with the size and mtime it had is not read",
              build.sitemap_page(page, "cm/p/x.html", st, entry, "v1", fingerprint) == got)
        check("a different method hash reads it again",
              build.sitemap_page(page, "cm/p/x.html", st, entry, "v2", fingerprint)[0] == "fp-" + str(len(page.read_text())))
        page.write_text('<html><meta name="robots" content="noindex">x</html>')
        check("a noindex page has no address",
              build.sitemap_page(page, "cm/p/x.html", page.stat(), None, "v1", fingerprint) == (None, None))
        noindex = [None, "", page.stat().st_size, page.stat().st_mtime_ns, None, "v1"]
        page.write_text("<html>indexable now, but the entry is trusted</html>")
        check("and a cached noindex stays one while the file is as it was",
              build.sitemap_page(page, "cm/p/x.html", types.SimpleNamespace(st_size=noindex[2], st_mtime_ns=noindex[3]),
                                 noindex, "v1", fingerprint) == (None, None))
        check("the traced query list is off outside a draw", build._NB_TRACE is None)
        build._NB_TRACE = []
        build.neighbours_in(18.0, 99.0, 0.001, 0.001, "zz", limit=5)
        got, build._NB_TRACE = build._NB_TRACE, None
        check("a nearby query is recorded while a page is drawn", got == [[18.0, 99.0, 0.001, 0.001, 5]], str(got))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
