"""Redraw only the place pages whose inputs changed.

build.py drew all ~92,000 place pages (html and json) on every hand-off: about
16 of the 48 minutes a round takes on motdang-build, to write pages that were
byte for byte the last build's. A round changes a few records. This module
says which pages a round has to draw and which it carries over.

A page is carried when four things match what the last build saw:

  inputs   the code and data files the build read, less FEEDS (files that hold
           records) and LIVE (files no place page reads). Found by watching
           what the build opens, so a file the build starts to read joins the
           stamp without a list to edit.
  record   the page's own record and its photo, and what the host computes
           from the record and the clock (own_view: the ant rank counts a
           date as fresh for 180 days from today, so it flips on a day no
           record changed).
  tables   what each id-keyed table in the build holds for it: claims, streets,
           events, tags, inside-members, ... Found by looking for dicts and
           sets keyed by place ids, not from a list.
  nearby   the places the page named last time, by record and page address.
           The queries are recorded while a page is drawn and asked again.

When the code or an input changed, there is no state, or cache/full-now exists,
every page is drawn. A forced full build with the same code also checks the
model: a page whose four things matched but whose bytes moved is a miss, counted
and named in cache/incremental-last.json.

Not seen: a layer that reads other places' records through a call rather than a
table, and anything else that counts from the clock. (Drawn on two dates three
days apart, 3,000 pages were byte for byte the same on 2026-10-22; the events a
page lists reach it through PLACE_EVENTS, a table.) So a sample of the pages about to be carried
is drawn anyway (CANARY, four times that on the first build of a new day) and
compared with the last build's bytes, and once AUDIT_DAYS have passed since every
page was last drawn, all of them are: the weekly full draw, inside an incremental
round, as the check. A page that moved turns that round into a full one and is
named in cache/incremental-last.json.

    python3 incremental.py            # what cache/incremental-state.json holds
"""
import datetime as dt
import hashlib
import json
import os
import random
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERSION = 1
STATE = Path(os.environ.get("MD_INCR_STATE") or (ROOT / "cache" / "incremental-state.json"))
LAST = Path(os.environ.get("MD_INCR_LAST") or (ROOT / "cache" / "incremental-last.json"))
STAMPS = Path(os.environ.get("MD_INCR_STAMPS") or (ROOT / "cache" / "incremental-stamps.json"))
FULL_NOW = Path(os.environ.get("MD_INCR_FULL_NOW") or (ROOT / "cache" / "full-now"))
AUDIT_DAYS = 7
CANARY = int(os.environ.get("MD_INCR_CANARY", "600"))
WARM = 300

# Files that hold records, or that importers derive from them one to one. A
# place's slice reaches its page through its record, the nearby queries and the
# id tables, which the fingerprint hashes itself; a change in one is not a
# reason to redraw everything. streets.json and open_lamps.json change every
# round only in their counts (parse.records, counts).
FEEDS = ("data/canonical/", "data/streets.json", "data/open_lamps.json", "data/claims.json")
# Live readings baked into front pages and fetched by place pages in the
# browser (nownear_layer.strip: "a change in the sky rewrote every page"). They
# go up on their own: tools/publish_data.py.
LIVE = ("data/air.json", "data/weather.json", "data/flightboard.json",
        "data/air.meta.json", "data/weather.meta.json", "data/traffic_now.json")

# What a page shows of a place it names nearby, when the host does not say (the host
# gives near_view(): the values of the functions the page applies to the place).
NEAR_FIELDS = ("id", "lat", "lng", "name", "nameTh", "nameEn", "geoPrecision", "cat", "province")

# Never inputs: what the build writes, and the state of this module.
SKIP_TOP = {"docs", "docs.next", "docs.prev", ".git", ".claude", "__pycache__",
            "node_modules", "tiles", "_incoming"}
SKIP_FILES = {"cache/place-pages-kept.json", "cache/place-inputs.json",
              "cache/incremental-state.json", "cache/incremental-last.json",
              "cache/incremental-stamps.json", "cache/sitemap-lastmod.json",
              "cache/build.lock", "cache/place-published.json", "cache/full-now",
              "cache/layers.json"}
BINARY = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mov", ".woff", ".woff2",
          ".pmtiles", ".ico", ".pdf", ".zip", ".gz", ".tar", ".mp3", ".ogg", ".apk",
          ".heic", ".avif", ".svgz", ".bin", ".pyc", ".so"}
BIG = 6 * 1024 * 1024


def _h(data, n=12):
    return hashlib.blake2b(data, digest_size=n).hexdigest()


def _plain(o):
    """A value json cannot write: its repr, unless the repr carries a memory
    address, which differs in every process."""
    if isinstance(o, (set, frozenset)):
        return sorted(map(repr, o))
    r = repr(o)
    return type(o).__name__ if " at 0x" in r else r


def stable(obj):
    try:
        return json.dumps(obj, sort_keys=True, ensure_ascii=False, default=_plain,
                          separators=(",", ":"))
    except (TypeError, ValueError):     # keys of mixed kinds, a cycle
        return re.sub(r" at 0x[0-9a-f]+", "", repr(obj))


def digest(obj):
    return _h(stable(obj).encode("utf-8"))


def record_digest(r, photo_file=None):
    """What a place's own data was: the 16 hex deploy's weekly place round keeps."""
    return hashlib.sha1(json.dumps([r, photo_file], sort_keys=True, default=str,
                                   ensure_ascii=False).encode()).hexdigest()[:16]


def bytes_digest(raw):
    """How build.py's kept-pages table digests a file it wrote."""
    return hashlib.blake2b(raw, digest_size=16).hexdigest()


# ------------------------------------------------------------ what was read
_READ = set()
_WATCHING = [False]


def watch(root=ROOT):
    """Note every file under `root` the process opens for reading. build.py
    calls this first, so the files it reads at import count."""
    if _WATCHING[0]:
        return
    _WATCHING[0] = True
    top = str(root) + os.sep
    write_flags = os.O_WRONLY | os.O_RDWR | os.O_CREAT

    def hook(event, args):
        if event != "open":
            return
        p = args[0]
        if not isinstance(p, (str, bytes)) and not hasattr(p, "__fspath__"):
            return
        flags = args[2] if len(args) > 2 else 0
        if isinstance(flags, int) and flags & write_flags:
            return
        try:
            p = os.path.normpath(os.fsdecode(p))
        except (TypeError, ValueError):
            return
        if p.startswith(top):
            _READ.add(p)

    sys.addaudithook(hook)


def reads():
    return sorted(_READ)


def under(rel, prefixes):
    return any(rel == q or (q.endswith("/") and rel.startswith(q)) for q in prefixes)


def counts_as_input(rel):
    """Whether a file under the repo is read for its words rather than carried."""
    parts = rel.split("/")
    if parts[0] in SKIP_TOP or rel in SKIP_FILES:
        return False
    if under(rel, FEEDS) or under(rel, LIVE):
        return False
    if parts[-1].startswith(".") or os.path.splitext(rel)[1].lower() in BINARY:
        return False
    # assets/<folder>/ is copied to docs/ whole; a file straight in assets/ is read
    if parts[0] == "assets" and len(parts) > 2:
        return False
    return True


def _digest_file(path, cache):
    try:
        st = path.stat()
    except OSError:
        return None
    key = str(path)
    hit = cache.get(key)
    if hit and hit[0] == st.st_size and hit[1] == st.st_mtime_ns:
        return hit[2]
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    if path.suffix == ".json":
        try:
            sys.path.insert(0, str(ROOT / "importers"))
            import walk_fingerprint
            d = walk_fingerprint.digest(path)[:20]
            cache[key] = [st.st_size, st.st_mtime_ns, d]
            return d
        except Exception:
            pass
    d = _h(raw, 10)
    cache[key] = [st.st_size, st.st_mtime_ns, d]
    return d


def input_files(root=ROOT, read=None, modules=None, extra=()):
    """{relative path: digest} for the code and data this build read, and for
    `extra` (the files the last build recorded, read or not this time)."""
    cache = {}
    try:
        cache = json.loads(STAMPS.read_text())
    except (OSError, ValueError):
        pass
    paths = set(read if read is not None else _READ)
    for m in (sys.modules.values() if modules is None else modules):
        f = getattr(m, "__file__", None)
        if f:
            paths.add(os.path.normpath(os.path.abspath(f)))
    for rel in extra:
        paths.add(os.path.join(str(root), rel))
    out = {}
    for p in paths:
        path = Path(p)
        try:
            rel = path.relative_to(root).as_posix()
        except ValueError:
            continue
        if not counts_as_input(rel) or not path.is_file():
            continue
        try:
            if path.stat().st_size > BIG:
                continue
        except OSError:
            continue
        d = _digest_file(path, cache)
        if d:
            out[rel] = d
    try:
        STAMPS.parent.mkdir(parents=True, exist_ok=True)
        keep = {k: v for k, v in cache.items() if os.path.exists(k)}
        STAMPS.write_text(json.dumps(keep, separators=(",", ":")))
    except OSError:
        pass
    return out


# --------------------------------------------------------------- id tables
def find_tables(namespaces, ids, skip=()):
    """[(label, table)] for every dict or set in `namespaces` ({module name:
    vars}) keyed by place ids, and for such a table held inside a short tuple
    or list (a loader's cache). `skip` is object ids already hashed another way."""
    skipped = set(skip)
    out = []

    def keyed(v):
        if not isinstance(v, (dict, set, frozenset)) or id(v) in skipped:
            return False
        n = hit = 0
        try:
            for k in v:
                n += 1
                if isinstance(k, str) and k in ids:
                    hit += 1
                if n >= 60:
                    break
        except RuntimeError:
            return False
        return hit >= 1 and hit >= n // 5

    for mname in sorted(namespaces):
        ns = namespaces[mname]
        for name in sorted(ns):
            if name.startswith("__") or "cache" in name.lower():
                continue
            v = ns[name]
            label = "%s.%s" % (mname, name)
            if keyed(v):
                out.append((label, v))
            elif isinstance(v, (tuple, list)) and 0 < len(v) <= 8:
                for i, x in enumerate(v):
                    if keyed(x):
                        out.append(("%s[%d]" % (label, i), x))
    return out


def table_values(tables, i):
    parts = []
    for label, t in tables:
        if isinstance(t, dict):
            v = t.get(i)
            if v is not None:
                parts.append((label, stable(v)))
        elif i in t:
            parts.append((label, 1))
    return parts


# -------------------------------------------------------- state and decision
def load_state(path=None):
    try:
        s = json.loads(Path(path or STATE).read_text())
    except (OSError, ValueError):
        return None
    return s if isinstance(s, dict) and s.get("v") == VERSION else None


def save_state(state, path=None):
    path = Path(path or STATE)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, separators=(",", ":")))
    tmp.replace(path)


class Decision:
    def __init__(self, full, reason, check=False, changed=()):
        self.full, self.reason, self.check, self.changed = full, reason, check, list(changed)

    def __repr__(self):
        return "Decision(full=%r, reason=%r, check=%r)" % (self.full, self.reason, self.check)


def _age_days(iso, now):
    try:
        t = dt.datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return 10 ** 6
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return (now - t).total_seconds() / 86400.0


def decide(state, files, date, now, off=None, full_now=None):
    """Full or incremental, and why. `files` is input_files() over the files
    the state names too; `now` is an aware datetime."""
    if off is None:
        off = os.environ.get("MD_INCREMENTAL", "1") == "0"
    if full_now is None:
        full_now = FULL_NOW.exists()
    if off:
        return Decision(True, "MD_INCREMENTAL=0")
    if full_now:
        return Decision(True, "asked for (cache/full-now)", check=True)
    if state is None:
        return Decision(True, "no state from a last build")
    # A file the last build recorded and this one finds different, or gone. A
    # file read for the first time is recorded, not compared: which lazy files a
    # sample of pages opens varies from build to build.
    was = state.get("files", {})
    changed = sorted(k for k in was if files.get(k) != was[k])
    if changed:
        return Decision(True, "inputs changed: %s%s" % (
            ", ".join(changed[:4]), " (+%d)" % (len(changed) - 4) if len(changed) > 4 else ""),
            changed=changed)
    return Decision(False, "same code and inputs as the last build")


def date_forms(iso):
    """A build date as pages print it: ISO and the Buddhist-era twin."""
    if not iso or len(iso) != 10:
        return [iso] if iso else []
    return [iso, str(int(iso[:4]) + 543) + iso[4:]]


def normalise(raw, dates):
    """A page with the build's date taken out, for the model check."""
    for d in dates:
        if d:
            raw = raw.replace(d.encode("utf-8"), b"<d>")
    return raw


class Page:
    """What this build knows of one place page before it draws anything."""
    __slots__ = ("key", "base", "rec", "carry", "clean", "trace")

    def __init__(self, key, base, rec, carry, clean, trace):
        self.key, self.base, self.rec = key, base, rec
        self.carry = carry          # leave the last build's file where it is
        self.clean = clean          # the model says the bytes did not move
        self.trace = trace          # nearby queries the last draw made


class Round:
    """One build's use of the state.

    `B` supplies what only build.py knows:
      B.date              BUILD_DATE
      B.namespaces()      {module name: vars dict} to look for id tables in
      B.skip              object ids of tables already hashed (the record table)
      B.slug(r)           a place's page address
      B.replay(a, id)     the places a recorded nearby query names now
      B.last_bytes(rel)   the last build's file, or None when it cannot be carried
      B.last_digest(rel)  its digest when the build wrote it
    """

    def __init__(self, B, now=None, state=None, files=None):
        self.B = B
        self.now = now or dt.datetime.now(dt.timezone.utc)
        self.state = state if state is not None else load_state()
        self.files = files
        self.decision = None
        self.tables = []
        self.tally = Tally(self)
        self.pages = {}             # key -> [base, nearby, rec, trace] for the next state
        self.own_keys = []          # pages drawn this build for a changed (or new) record
        self.audited = False        # every carried page was drawn and matched
        self.plan = {}
        self.t0 = time.time()
        self._nb = {}

    # ---- the stamp, once, after a few pages have been drawn
    def settle(self, records, photos, draw):
        """Draw a sample of pages (their lazy loads and caches settle), find the
        id tables that hold still across it, take the stamp and decide."""
        B = self.B
        ids = set(B.all_ids()) if hasattr(B, "all_ids") else {r["id"] for r in records}
        found = find_tables(B.namespaces(), ids, B.skip)
        sample = sample_of([r["id"] for r in records], WARM, "warm" + B.date)
        by = {r["id"]: r for r in records}
        before = {i: table_values(found, i) for i in sample}
        sizes = {lab: len(t) for lab, t in found}
        for i in sample:
            draw(by[i], photos.get(i))
        after = {i: table_values(found, i) for i in sample}
        moved = {lab for lab, t in found if len(t) != sizes[lab]}
        moved |= {lab for lab, _ in found
                  if any([x for x in before[i] if x[0] == lab] != [x for x in after[i] if x[0] == lab]
                         for i in sample)}
        self.tables = [(lab, t) for lab, t in found if lab not in moved]
        self.sizes = {lab: len(t) for lab, t in self.tables}
        self.unstable = sorted(moved)
        extra = list((self.state or {}).get("files", {}))
        self.files = input_files(extra=extra)
        self.decision = decide(self.state, self.files, B.date, self.now)
        self.tally.decision = self.decision

    def tables_held(self):
        """False when an id table grew or shrank since the fingerprints were taken."""
        return all(len(t) == self.sizes.get(lab, len(t)) for lab, t in self.tables)

    # ---- fingerprints
    def _near(self, rec):
        i = rec["id"]
        d = self._nb.get(i)
        if d is None:
            view = (self.B.near_view(rec) if hasattr(self.B, "near_view")
                    else {k: rec.get(k) for k in NEAR_FIELDS})
            d = self._nb[i] = (digest(view), self.B.slug(rec))
        return d

    def nearby(self, r, trace):
        got, asked = [], {}
        for args in trace:
            k = tuple(args)
            if k not in asked:      # the map asks the same question twice
                asked[k] = [self._near(n) + (n["id"],) for n in self.B.replay(args, r["id"])]
            got.append(asked[k])
        return digest(got)

    def base(self, r, rec_dg):
        own = self.B.own_view(r) if hasattr(self.B, "own_view") else ""
        return digest([rec_dg, own, table_values(self.tables, r["id"])])

    def province(self, key, records, photos):
        """Plan the pages of one province: {page key: Page}."""
        t = time.time()
        self.sizes = {lab: len(tb) for lab, tb in self.tables}
        was = (self.state or {}).get("pages", {})
        plan = {}
        full = self.decision.full
        for r in records:
            slug = self.B.slug(r)
            pk = "%s/p/%s" % (key, slug)
            rec_dg = record_digest(r, photos.get(r["id"]))
            base = self.base(r, rec_dg)
            old = was.get(pk)
            clean = False
            trace = []
            if old:
                trace = old[3]
                clean = old[0] == base and old[1] == self.nearby(r, trace)
            carry = clean and not full
            if carry and not (self.B.last_digest(pk + ".html") and self.B.last_digest(pk + ".json")):
                carry = False
            plan[pk] = Page(pk, base, rec_dg, carry, clean, trace)
        self.plan.update(plan)
        self.tally.plan_s += time.time() - t
        return plan

    def removed(self, key, plan):
        """Pages this province had last time and has no record for now."""
        was = (self.state or {}).get("pages", {})
        return sorted(k for k in was if k.startswith(key + "/p/") and k not in plan)

    # ---- the canary
    def audit_due(self):
        """True once AUDIT_DAYS have passed since every page was last drawn."""
        st = self.state or {}
        last = max(str(st.get("full_at") or ""), str(st.get("audited_at") or ""))
        return bool(last) and _age_days(last, self.now) >= AUDIT_DAYS

    def canary(self, plan, records, photos, draw, seed):
        """Draw a sample of the pages about to be carried (all of them when an
        audit is due) and compare them with the last build's bytes. True when
        every one matched."""
        if self.decision.full or CANARY <= 0:
            return True
        by = {self.B.slug(r): r for r in records}
        cand = [k for k, pg in plan.items() if pg.carry]
        audit = self.audit_due()
        new_day = (self.state or {}).get("date") != self.B.date
        n = len(cand) if audit else CANARY * (4 if new_day else 1)
        bad = []
        for pk in sample_of(cand, n, seed):
            r = by[pk.rsplit("/", 1)[1]]
            html, js = draw(r, photos.get(r["id"]))
            for ext, text in (("html", html), ("json", js)):
                want = self.B.last_digest("%s.%s" % (pk, ext))
                if want and bytes_digest(text.encode("utf-8")) != want:
                    bad.append("%s.%s" % (pk, ext))
        self.tally.canary_bad += bad
        self.tally.sampled += min(n, len(cand))
        if audit and not bad:
            self.audited = True
            self.tally.audit = True
        if not self.tables_held():
            moved = [lab for lab, t in self.tables if len(t) != self.sizes.get(lab, len(t))]
            bad.append("id table %s changed while pages were drawn" % moved[0])
            self.tally.canary_bad += bad[-1:]
        if bad:
            self.audited = False
            self.decision = Decision(True, "%s: %d of %d drawn pages moved, e.g. %s"
                                     % ("audit" if audit else "canary", len(bad), min(n, len(cand)), bad[0]), check=True)
            self.tally.decision = self.decision
            for pg in plan.values():
                pg.carry = False
            return False
        return True

    # ---- after the build
    def note_drawn(self, pk, base, nearby, rec_dg, trace):
        self.pages[pk] = [base, nearby, rec_dg, trace]

    def state_out(self):
        """The state to save: carried pages keep their entries, drawn ones the new."""
        was = (self.state or {}).get("pages", {})
        pages = {}
        for pk, pg in self.plan.items():
            if pk in self.pages:
                pages[pk] = self.pages[pk]
            elif pk in was:
                pages[pk] = was[pk]
        full = self.decision.full
        old = self.state or {}
        stamp = self.now.isoformat(timespec="seconds")
        return {"v": VERSION, "date": self.B.date, "files": self.files,
                "full_at": stamp if full else old.get("full_at", stamp),
                "audited_at": stamp if (full or self.audited) else old.get("audited_at", old.get("full_at", stamp)),
                "built_at": stamp, "pages": pages}


def sample_of(keys, n, seed):
    """n of `keys`, the same for the same seed."""
    keys = sorted(keys)
    if len(keys) <= n:
        return keys
    return random.Random(seed).sample(keys, n)


class Tally:
    """What one build did with the place pages, for the log and for cache/."""

    def __init__(self, rnd=None):
        self.decision = Decision(True, "not started")
        self.carried = self.drawn = self.own = 0
        self.removed = []
        self.misses = []
        self.canary_bad = []
        self.sampled = 0
        self.audit = False
        self.plan_s = 0.0
        self.t0 = time.time()

    def line(self):
        d = self.decision
        mode = "full (%s)" % d.reason if d.full else "incremental"
        s = ("place pages: %s — %s carried, %s drawn (%s with a changed record)"
             % (mode, f"{self.carried:,}", f"{self.drawn:,}", f"{self.own:,}"))
        if self.removed:
            s += ", %s gone" % f"{len(self.removed):,}"
        if d.check and d.full:
            s += ", model check: %d miss%s" % (len(self.misses), "" if len(self.misses) == 1 else "es")
        if not d.full and self.sampled:
            s += ", %s: %s drawn again, %d moved" % ("audit" if self.audit else "canary",
                                                   f"{self.sampled:,}", len(self.canary_bad))
        s += ", planned in %.0f s" % self.plan_s
        return s

    def write(self, path=None):
        d = self.decision
        doc = {"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "full": d.full, "reason": d.reason,
               "check": d.check, "audit": self.audit, "sampled": self.sampled, "carried": self.carried, "drawn": self.drawn,
               "own_record": self.own, "removed": self.removed[:200],
               "removed_n": len(self.removed), "misses": self.misses[:200],
               "misses_n": len(self.misses), "canary_bad": self.canary_bad[:50],
               "plan_seconds": round(self.plan_s, 1),
               "seconds": round(time.time() - self.t0, 1)}
        path = Path(path or LAST)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(doc, indent=1, ensure_ascii=False))
        except OSError:
            pass
        return doc


if __name__ == "__main__":
    s = load_state()
    if not s:
        print("no state at %s" % STATE)
    else:
        print("state: %d pages, date %s, last full %s, %d input files" % (
            len(s.get("pages", {})), s.get("date"), s.get("full_at"), len(s.get("files", {}))))
        try:
            print(json.dumps(json.loads(LAST.read_text()), indent=1, ensure_ascii=False)[:1500])
        except (OSError, ValueError):
            pass
