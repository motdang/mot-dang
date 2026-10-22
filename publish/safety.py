#!/usr/bin/env python3
"""The checks that stand between a half-built docs/ and the live site.

WHY THIS FILE EXISTS — THE 2026-09-08 OUTAGE
--------------------------------------------
On 2026-09-08 motdang.net answered 404 for the front page, /404.html,
/map.js, /explore.js, /explore.css, /sitemap.xml, /favicon.ico, /what.html,
/toilets.html, /reach.html, the whole of /cr/, every file under /vendor/ and
/glyphs/, and /api/v1/index.json — while /cm/**, /data/**, /md.js,
/refine.js, /robots.txt, /style.css and both tile archives kept serving.

The site was not hacked and the bucket was not emptied. `rclone sync` is a
mirror, and it had been pointed at a docs/ that did not contain those files.
It deleted them, faithfully, exactly as asked.

deploy.py already had two guards against this and BOTH passed:

  1. FLOOR = 20,000 files. It is a TOTAL count, and docs/cm/ alone holds
     77,107 files. A docs/ containing nothing but cm/ and data/ clears a
     20,000-file floor by four times over while missing every root page,
     both vendored libraries, all four glyph ranges, the whole second
     province and the API index. A total count cannot see a missing root.

  2. The build lock. It refuses a publish while a build is ALIVE, and treats
     a lock whose process is gone as stale — correctly, or one SIGKILL would
     wedge the repo forever. But a build killed mid-run (this repo's own
     documented hazard: a full build now runs 30+ minutes and dies if it is
     ever launched in a foreground call that times out) leaves behind exactly
     what the lock no longer protects — a real, populated, half-written
     docs/. The lock guards against a build in progress. Nothing guarded
     against the wreckage a dead build leaves behind.

So the hole was never "somebody was careless". Both guards asked the wrong
question. They asked "is anything else running?" and "is this tree big?"
when the question that matters is "is this tree THE SITE?"

WHAT THIS FILE ASKS INSTEAD
---------------------------
  required_missing()  — is every path the site cannot be served without
                        actually present? Names them when they are not.
  subtree_shortfalls()— did a whole limb fall off? Per-directory floors,
                        because that is the failure a total cannot see.
  deletions_preview() — what would this publish DELETE from the bucket?
                        Computed by listing both sides and taking the
                        difference, not by parsing rclone's chatter.
  smoke()             — after the upload, does the live site actually
                        answer? A deploy that reports success while the
                        front page 404s is the failure this whole file is
                        about.

Every one of these is cheap, and each of them alone would have stopped the
outage before a single object was deleted.

A NOTE ON WHAT IS NOT HERE
--------------------------
The root fix is that build.py wipes docs/ in place, so a half-built site is a
real directory on disk that looks publishable for the ~30 minutes a build
takes. Building into docs.next/ and renaming it into place at the end would
mean a partial tree never exists at the published path at all, and every
check in this file would become belt to that brace. That change belongs in
build.py, which is edited by other sessions constantly, so it is written up
in notes/maps-grow-2026-09-08.txt §12 rather than made here.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
BASEMAP = ROOT / "data" / "basemap.json"


# ---------------------------------------------------------------------------
# 1. THE PATHS THE SITE CANNOT BE SERVED WITHOUT
# ---------------------------------------------------------------------------
# Every entry here was absent from the live bucket during the outage, or is
# the reason another entry matters. Keep this list SHORT and certain: a path
# that a healthy build does not always produce would block every publish, and
# a guard that cries wolf gets removed. Anything conditional goes in
# required() below, where the condition can be stated.
#
# The line number after each is where build.py writes it, so a future session
# renaming an output can find this list.
ALWAYS = [
    "index.html",       # build.py ~17016 — the front page. The one she said
                        # she should very rarely find missing.
    "404.html",         # ~13491 — served WITH status 404 by the Worker, so
                        # its absence turns every wrong URL into a bare error.
    "md.js",            # ~15913 — the site's own script; every page loads it.
    "style.css",
    "robots.txt",       # ~19739
    "sitemap.xml",      # ~19766 — the arrivals work depends on this one.
                        # An INDEX since 2026-09-20; a publish carrying it and
                        # no shard would hand every crawler an empty index.
    "sitemap-1.xml",
    "llms.txt",         # ~19808
                        # Google Search Console's ownership file. rclone sync
                        # would delete it from the bucket the first time a
                        # build forgot it, and the property would silently
                        # lose its verification.
    "googlec9c8aa711f88fa78.html",
    "cm/index.html",    # ~16456, per province
    "cr/index.html",    # the province that vanished while cm/ survived
]

# The map surfaces exist only when a basemap is configured. data/basemap.json
# documents an empty url as a SUPPORTED state (every map falls back to its
# drawn SVG), so requiring these unconditionally would refuse a legitimate
# no-basemap publish.
WHEN_BASEMAP = [
    "map.js",
    "vendor/maplibre-gl.js",
    "vendor/maplibre-gl.css",
    "vendor/pmtiles.js",
    "glyphs/NotoSans/0-255.pbf",
    "glyphs/NotoSans/3584-3839.pbf",   # the Thai range: labels vanish without
                                       # it and nothing else says so
]

# Per-subtree floors. THIS is the check the total count could not do. Each
# number is well under what a healthy build produces, so ordinary growth and
# ordinary retirement never trip it; only a limb falling off does.
SUBTREE_FLOORS = {
    "cm": 1000,
    "cr": 100,
    "data": 20,
}

# A publish that would delete more than this many live objects stops and asks.
# Ordinary retirement is a handful of pages; the outage would have deleted
# thousands. Pass --prune when a large deletion is genuinely intended, or
# --prune-up-to N for a bound that holds only when check_tree passed — the
# form the standing walk can pass unattended (2026-09-10: a hand publish
# needed 4,115 and the walk, which cannot type --prune, could not have done
# it).
DELETE_CEILING = int(os.environ.get("MD_DELETE_CEILING") or 2000)

# These prefixes are never deleted as a side effect of anything. Losing them
# does not degrade the site, it breaks it silently: no vendored MapLibre means
# every map is blank, no glyphs means every map is unlabelled, no api/v1 index
# means the Worker answers 503 to every API call.
NEVER_PRUNE = ("vendor/", "glyphs/", "api/")


def basemap_on():
    """Is a basemap configured? An absent file or an empty url means no."""
    try:
        return bool(json.loads(BASEMAP.read_text()).get("url"))
    except (OSError, ValueError):
        return False


# Every drawn icon on every page is a <use> of this one file since
# 2026-09-10; without it they all vanish, on every page, and nothing else
# says so. Conditional because a tree built before that day pasted both
# sprites inline and needs no file — the front page says which kind of tree
# is being published.
WHEN_SPRITE = ["icons.svg"]


def sprite_referenced(root=None):
    root = Path(root) if root else DOCS
    try:
        return "icons.svg" in (root / "index.html").read_text(errors="ignore")
    except OSError:
        return False


def required(root=None):
    """The full required list for this configuration and this tree."""
    return (ALWAYS + (WHEN_BASEMAP if basemap_on() else [])
            + (WHEN_SPRITE if sprite_referenced(root) else []))


def required_missing(root=None):
    """Which required paths are not in the tree about to be published."""
    root = Path(root) if root else DOCS
    return [p for p in required(root) if not (root / p).exists()]


def subtree_shortfalls(root=None):
    """[(name, found, floor)] for every limb that came back short or absent."""
    root = Path(root) if root else DOCS
    out = []
    for name, floor in sorted(SUBTREE_FLOORS.items()):
        d = root / name
        n = sum(1 for p in d.rglob("*") if p.is_file()) if d.is_dir() else 0
        if n < floor:
            out.append((name, n, floor))
    return out


# The pages whose own pictures, scripts and stylesheets are checked one by one.
# 2026-09-25: the front page went live pointing at site/map/map-dots-{light,
# dark}.png, which a build had drawn into the old docs/ and its swap deleted.
# Every check above passed: the paths were not on ALWAYS, and the tree was big.
# Reading what the page itself asks for is the check that sees it.
REFERENCING_PAGES = ["index.html", "calendar.html", "home-scenes.html"]
_ASSET_ATTR = re.compile(
    r"""<(?:img|source|script|video|audio|link|input)\b[^>]*?\s(src|srcset|href|poster)\s*=\s*["']([^"']+)["']""",
    re.I)
_SAME_ORIGIN = ("https://motdang.net/", "http://motdang.net/", "//motdang.net/")


def _local_asset_paths(html):
    for m in _ASSET_ATTR.finditer(html):
        attr, val = m.group(1).lower(), m.group(2)
        # a <link> that is a page (canonical, alternate, prev/next) is not an asset
        tag = html[m.start():m.end()].lower()
        if tag.startswith("<link") and not re.search(r"rel\s*=\s*[\"'][^\"']*(stylesheet|icon|preload|manifest|modulepreload)", tag):
            continue
        cands = [c.strip().split()[0] for c in val.split(",") if c.strip()] if attr == "srcset" else [val]
        for c in cands:
            for pre in _SAME_ORIGIN:
                if c.startswith(pre):
                    c = c[len(pre):]
            if not c or re.match(r"^([a-z][a-z0-9+.-]*:|//|#|\{)", c, re.I):
                continue
            c = c.split("#")[0].split("?")[0].lstrip("/")
            if c:
                yield c


def referenced_missing(root=None, pages=None):
    """[(page, path)] for every same-origin file a checked page asks for that
    the tree does not hold."""
    root = Path(root) if root else DOCS
    out = []
    for page in (pages or REFERENCING_PAGES):
        f = root / page
        if not f.exists():
            continue
        html = f.read_text(errors="ignore")
        for p in sorted(set(_local_asset_paths(html))):
            q = root / p
            if not (q.is_file() or (q.is_dir() and (q / "index.html").is_file())):
                out.append((page, p))
    return out


def check_tree(root=None, say=print):
    """Run both structural checks. Returns a list of complaints, empty = fine.

    Kept separate from deploy.py's exit() so tests can call it and so a
    future caller (a pre-commit, the standing walk) can ask the same question
    without publishing anything.
    """
    root = Path(root) if root else DOCS
    problems = []

    missing = required_missing(root)
    if missing:
        problems.append(
            "%d required path(s) missing from %s — this is not a whole site:\n    %s"
            % (len(missing), root.name + "/", "\n    ".join(missing)))
    else:
        say("  required paths: all %d present" % len(required(root)))

    short = subtree_shortfalls(root)
    if short:
        problems.append(
            "subtree(s) short or absent:\n    %s"
            % "\n    ".join("%s/ holds %s file(s), floor is %s"
                            % (n, f"{f:,}", f"{fl:,}") for n, f, fl in short))
    else:
        say("  subtrees: %s all above their floors"
            % ", ".join(sorted(SUBTREE_FLOORS)))

    gaps = referenced_missing(root)
    if gaps:
        problems.append(
            "%d file(s) the front pages ask for are not in %s:\n    %s"
            % (len(gaps), root.name + "/", "\n    ".join("%s → %s" % g for g in gaps)))
    else:
        say("  front-page assets: every file %s asks for is present"
            % ", ".join(REFERENCING_PAGES))

    return problems


# ---------------------------------------------------------------------------
# 2. WHAT WOULD THIS PUBLISH DELETE?
# ---------------------------------------------------------------------------
def _bucket_keys(dest, env, run):
    """Every object key in the bucket, as a set.

    `rclone lsf -R --files-only` with --fast-list is one listing pass and
    answers in seconds even at 80,000 objects. Deliberately NOT parsed out of
    a --dry-run sync's log lines: that output is human chatter whose wording
    has changed between rclone releases, and a guard that silently stops
    matching is worse than no guard.
    """
    out = run(["rclone", "lsf", "-R", "--files-only", "--fast-list", dest],
              env, quiet=True)
    return {ln.strip() for ln in out.splitlines() if ln.strip()}


def _local_keys(root=None):
    root = Path(root) if root else DOCS
    return {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()}


# The four picture folders that live in mot-dang-media instead of the site bucket
# (media_layer.py, publish/media_sync.py). With MD_MEDIA_BUCKET=1 a publish neither
# uploads nor deletes them, so the preview does not count them as missing either.
MEDIA_PREFIXES = ("streetphotos/", "photos/", "inat/", "og/")


def preview_excludes(exclude=None):
    """The key prefixes a sync leaves alone: the tile archives, and the media
    folders while the media bucket holds them (the same --exclude list deploy.py
    passes to rclone)."""
    if exclude is not None:
        return tuple(exclude)
    return ("tiles/",) + (MEDIA_PREFIXES if os.environ.get("MD_MEDIA_BUCKET") == "1" else ())


def deletions_preview(dest, env, run, root=None, exclude=None):
    """Sorted list of keys a sync would delete. The truth, both sides listed.

    `exclude` mirrors deploy.py's own --exclude: the tile archives live in the
    bucket and deliberately not under docs/, so they are not deletions, they
    are the arrangement.
    """
    return diff_preview(dest, env, run, root, exclude)[0]


def diff_preview(dest, env, run, root=None, exclude=None):
    """(keys a sync would delete, keys it would add), both sorted, from one
    listing of each side."""
    exclude = preview_excludes(exclude)
    live = _bucket_keys(dest, env, run)
    local = _local_keys(root)
    gone = {k for k in live - local
            if not any(k.startswith(x) for x in exclude)}
    return sorted(gone), sorted(local - live)


def additions_lines(added, announced=()):
    """What a publish adds: the total, the folders that add most, and each
    announced "add" against its number. Said, never refused."""
    from collections import Counter
    if not added:
        return ["  additions: none"]
    top = Counter(k.split("/")[0] + ("/" if "/" in k else "") for k in added)
    out = ["  additions: %s file(s) — %s" % (
        f"{len(added):,}", ", ".join("%s %s" % (d, f"{n:,}") for d, n in top.most_common(5)))]
    _, groups = expected_split(added, announced, side="add")
    return out + expected_lines(groups, verb="add")


# How long before its source was taken a live file still counts as newer than
# the build. A session can upload a minisite straight from docs/ and put its
# copy in assets/ a little after; an hour covers that order.
SOURCE_GRACE_S = 3600


# With no hand-off time to go by (a build made on the laptop), a live file
# uploaded in this window before the publish is treated as newer than the build.
UNKNOWN_SOURCE_S = 6 * 3600


def source_time():
    """(when this build's source was taken, how that is known).

    MD_SOURCE_AT (ISO, set by importers/server_walk.sh from the hand-off) says
    it. Without it, UNKNOWN_SOURCE_S before now: a guess on the early side,
    which keeps more live files for one round and deletes none it should keep.
    """
    import datetime
    now = datetime.datetime.now(datetime.timezone.utc)
    s = os.environ.get("MD_SOURCE_AT", "").strip()
    s = s[:-1] + "+00:00" if s[-1:] in "Zz" else s
    try:
        t = datetime.datetime.fromisoformat(s)
        return (t if t.tzinfo else t.astimezone()), "hand-off"
    except ValueError:
        return now - datetime.timedelta(seconds=UNKNOWN_SOURCE_S), "no hand-off time; 6 h back"


def uploaded_since(dest, env, run, keys, since):
    """The keys among `keys` whose live copy was uploaded at or after `since`.

    WHY — 2026-10-10. Lanna Craft went live at 21:27 by a direct upload
    (deploy.py --files) and its copy went into assets/sites/ the same minute.
    The server was by then building from source sent at 20:08, without it;
    at 21:59 that build's sync deleted all 88 files, because a sync deletes
    whatever the build lacks. A build can only speak for files that existed
    when its source was taken. A live file uploaded after that is newer than
    the build, and the next build, which has seen it, decides.

    The time is the bucket's own upload time (--use-server-modtime), not the
    mtime rclone carries over from the laptop. Only `keys` are looked up, one
    object each, so this costs seconds, not the whole-bucket walk.
    """
    import datetime
    if not keys:
        return []
    fd, path = tempfile.mkstemp(suffix=".txt")
    with os.fdopen(fd, "w") as fh:
        fh.write("".join(k + "\n" for k in keys))
    try:
        out = run(["rclone", "lsjson", "-R", "--files-only", "--no-mimetype",
                   "--use-server-modtime", "--files-from", path, dest],
                  env, quiet=True)
    finally:
        os.unlink(path)
    cut = since - datetime.timedelta(seconds=SOURCE_GRACE_S)
    young = []
    for o in json.loads(out or "[]"):
        m = str(o.get("ModTime", ""))
        m = re.sub(r"(\.\d{6})\d+", r"\1", m)          # fromisoformat takes 6 digits
        m = m[:-1] + "+00:00" if m.endswith("Z") else m
        try:
            t = datetime.datetime.fromisoformat(m)
        except ValueError:
            young.append(o["Path"])                     # unreadable: keep it
            continue
        if t >= cut:
            young.append(o["Path"])
    return sorted(young)


# Where deploy.py --files writes what it uploaded while the site builds on
# motdang-server (cache/build-on-server), and where the server reads it.
DIRECT_UPLOADS_HOST = "nan@motdang-server"
DIRECT_UPLOADS_PATH = "/srv/state/direct-uploads.tsv"


def direct_upload_lines(keys, when):
    """The ledger lines for `keys` uploaded at `when`: "<utc iso>\\t<key>"."""
    import datetime
    t = when.astimezone(datetime.timezone.utc).isoformat(timespec="seconds")
    return "".join("%s\t%s\n" % (t, k) for k in keys)


def direct_uploads_since(path, since):
    """The keys the ledger at `path` says were uploaded by deploy.py --files
    at or after `since` (less SOURCE_GRACE_S).

    WHY — 2026-10-19. The roadworks bounty stepped ฿10 → ฿5 and publish-site
    put it live at 08:20. At 09:22 a server round whose source was sent at
    07:03 published its ฿10 copies over it. uploaded_since keeps such files
    only when the build would delete them; a build that would overwrite them
    went ahead. This ledger covers both. It is a ledger, not the bucket's
    upload times, because the server's own previous publish finishes after
    the next round's source is taken: by modtime every file the last round
    changed would look newer than the build, and none would go up.

    A missing or unreadable ledger holds nothing back. A line whose time does
    not parse is skipped.
    """
    import datetime
    if not path:
        return []
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    cut = since - datetime.timedelta(seconds=SOURCE_GRACE_S)
    keys = set()
    for line in text.splitlines():
        when, _, key = line.partition("\t")
        key = key.strip()
        if not key:
            continue
        w = when.strip()
        w = w[:-1] + "+00:00" if w[-1:] in "Zz" else w
        try:
            t = datetime.datetime.fromisoformat(w)
        except ValueError:
            continue
        if not t.tzinfo:
            t = t.replace(tzinfo=datetime.timezone.utc)
        if t >= cut:
            keys.add(key)
    return sorted(keys)


# ---------------------------------------------------------------------------
# 2b. DELETIONS THE CHANGE SAID WERE COMING
# ---------------------------------------------------------------------------
# Nan, 2026-10-11: the test is whether what goes matches what the maker said
# would go, within a few percent, not whether it passes a fixed number. That
# day two cuts she had asked for (2,949 per-tag GeoJSON files, 1,212 doodle
# data shards) refused every round against a ceiling of 500, and a hand-typed
# bound of 3,300 refused them too.
#
# publish/expected.json, committed with the change that retires the files:
#
#   {"announced": [{"id": "tag-geojson", "until": "2026-10-25",
#                   "why": "one GeoJSON per province replaces one per tag",
#                   "remove": {"data/c?-tag-*.geojson": 2950},
#                   "add": {"data/": 2}}]}
#
# A pattern is a prefix, or a glob when it holds * ? or [. A live file the
# build lacks counts against the longest pattern it matches. More than
# EXPECT_TOL over the announced number refuses; fewer is said and published
# (fewer deletions harm nothing). What no announcement covers still meets the
# fixed ceiling. "add" is reported, never refused. An announcement whose cut
# landed within bounds is used up (EXPECT_DONE) and stops applying; one past
# its "until" never applies.
EXPECTED = ROOT / "publish" / "expected.json"
EXPECT_TOL = 0.10
EXPECT_SLACK = 5        # files: ±10% of 20 is 2, too tight for small cuts


def _expect_done_path():
    return Path(os.environ.get("MD_EXPECT_DONE") or (ROOT / "cache" / "expected-done.txt"))


def _today():
    import datetime
    return datetime.date.today().isoformat()


def load_expected(path=None, today=None, done=None):
    """(active announcements, lines to say). A malformed file is said, not fatal:
    without announcements the fixed ceiling applies as before."""
    path = Path(path) if path else EXPECTED
    today = today or _today()
    if done is None:
        try:
            done = set(_expect_done_path().read_text().split())
        except OSError:
            done = set()
    try:
        raw = json.loads(path.read_text())
    except OSError:
        return [], []
    except ValueError as e:
        return [], ["  ⚠️  %s unreadable (%s); no announcements apply" % (path.name, e)]
    active, said = [], []
    for a in raw.get("announced", []):
        aid, until = str(a.get("id", "")), str(a.get("until", ""))
        if not aid or not until or not isinstance(a.get("remove", {}), dict):
            said.append("  ⚠️  announcement without id/until ignored: %r" % (a,))
        elif aid in done:
            continue
        elif until < today:
            said.append("  announcement %s expired %s, not applied" % (aid, until))
        else:
            active.append(a)
    return active, said


def _match(key, pat):
    import fnmatch
    return fnmatch.fnmatchcase(key, pat) if any(c in pat for c in "*?[") else key.startswith(pat)


def _band(n):
    d = max(EXPECT_SLACK, int(n * EXPECT_TOL + 0.999))
    return max(0, n - d), n + d


def expected_split(keys, announced, side="remove"):
    """(keys no pattern covers, groups). One group per announced pattern:
    {id, pattern, expected, found, lo, hi}; a key counts once, against the
    longest pattern it matches."""
    pats = []
    for a in announced:
        for pat, n in (a.get(side) or {}).items():
            pats.append((a["id"], pat, int(n)))
    found = {(i, p): 0 for i, p, _ in pats}
    rest = []
    order = sorted(pats, key=lambda t: -len(t[1]))
    for k in keys:
        hit = next(((i, p) for i, p, _ in order if _match(k, p)), None)
        if hit:
            found[hit] += 1
        else:
            rest.append(k)
    groups = []
    for i, p, n in pats:
        lo, hi = _band(n)
        groups.append({"id": i, "pattern": p, "expected": n,
                       "found": found[(i, p)], "lo": lo, "hi": hi})
    return rest, groups


def expected_lines(groups, verb="go"):
    out = []
    for g in groups:
        mark = ("over" if g["found"] > g["hi"] else
                "under" if g["found"] < g["lo"] else "within")
        out.append("  %s %s: %s to %s, %s announced (%s)"
                   % (g["id"], g["pattern"], f"{g['found']:,}", verb,
                      f"{g['expected']:,}", mark))
    return out


def expected_used(groups):
    """Ids whose every pattern landed within its band: their cut is done."""
    ids = {g["id"] for g in groups}
    bad = {g["id"] for g in groups if not g["lo"] <= g["found"] <= g["hi"]}
    return sorted(ids - bad)


def mark_expected_done(ids):
    if not ids:
        return
    p = _expect_done_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "a") as fh:
        fh.write("".join(i + "\n" for i in ids))


def deletion_verdict(gone, prune=False, prune_up_to=None, tree_ok=False,
                     announced=None):
    """(ok, message). Refuses a mass deletion, and any deletion of the
    prefixes whose loss breaks the site silently.

    `prune` lifts the ceiling outright. `prune_up_to` lifts it to N, and
    only for a tree that passed check_tree (`tree_ok`, which a caller must
    say — the default is a failed tree): above N, or with a failed tree, it
    refuses. With neither the ceiling stands as before.

    `announced` (load_expected): deletions an announcement covers are held to
    its number instead of the ceiling; the ceiling counts the rest.
    """
    fatal = [k for k in gone if k.startswith(NEVER_PRUNE)]
    if fatal:
        return False, (
            "REFUSING: this publish would delete %d object(s) under %s.\n"
            "  Losing these does not make the site smaller, it makes every map\n"
            "  blank, unlabelled, or 503. First five:\n    %s\n"
            "  That means docs/ was built without them — rebuild, do not force."
            % (len(fatal), " / ".join(NEVER_PRUNE),
               "\n    ".join(fatal[:5])))
    total, groups = len(gone), []
    if announced and not prune:
        gone, groups = expected_split(gone, announced)
        over = [g for g in groups if g["found"] > g["hi"]]
        if over:
            return False, (
                "REFUSING: more live files would go than the change announced\n"
                "  (publish/expected.json, ±%d%%):\n%s\n"
                "  Either the cut reaches further than it was meant to, or the\n"
                "  number announced is wrong; look at the list before raising it."
                % (int(EXPECT_TOL * 100), "\n".join(expected_lines(over))))
    if prune:
        ceiling, how = None, " (--prune given)"
    elif prune_up_to is not None:
        if not tree_ok:
            return False, (
                "REFUSING: --prune-up-to %s applies only to a docs/ that passed\n"
                "  the whole-site check, and this one did not. The bound is for\n"
                "  ordinary churn from a whole tree, not for a tree missing limbs.\n"
                "  Rebuild, then publish." % f"{prune_up_to:,}")
        ceiling, how = prune_up_to, " (--prune-up-to %s)" % f"{prune_up_to:,}"
    else:
        ceiling, how = DELETE_CEILING, ""
    if ceiling is not None and len(gone) > ceiling:
        if prune_up_to is not None:
            # The tree passed check_tree, so "missing limbs" would be false
            # here: the count is simply past the bound the operator set.
            why = ("  More than the --prune-up-to bound; look at the list, then\n"
                   "  re-run with --prune or a higher bound.")
            then = ""
        else:
            why = ("  Ordinary retirement is a handful of pages; this is a tree that is\n"
                   "  missing limbs.")
            then = "\n  If the deletion is genuinely intended, re-run with --prune."
        if groups:
            why = ("  That counts only files no announcement covers; %s more are\n"
                   "  announced (publish/expected.json).\n%s"
                   % (f"{total - len(gone):,}", why))
        return False, (
            "REFUSING: this publish would delete %s live object(s), ceiling is %s.\n"
            "%s First 25:\n    %s%s"
            % (f"{len(gone):,}", f"{ceiling:,}", why,
               "\n    ".join(gone[:25]), then))
    if groups:
        return True, ("  deletions: %s object(s), %s of them announced%s\n%s"
                      % (f"{total:,}", f"{total - len(gone):,}", how,
                         "\n".join(expected_lines(groups))))
    return True, "  deletions: %s object(s)%s" % (f"{total:,}", how)


# ---------------------------------------------------------------------------
# 3. DOES THE LIVE SITE ACTUALLY ANSWER?
# ---------------------------------------------------------------------------
# A deploy that prints "done" while the front page 404s is the exact failure
# this file exists for, and it went unnoticed for hours because nothing ever
# asked the live origin a question afterwards.
ORIGIN = "https://motdang.net"

SMOKE = [
    ("/", 200),
    ("/index.html", 200),
    ("/style.css", 200),
    ("/md.js", 200),
    ("/robots.txt", 200),
    ("/sitemap.xml", 200),
    ("/sitemap-1.xml", 200),
    ("/cm/", 200),
    ("/cr/", 200),
    ("/cm/food/", 200),
    ("/api/v1/health", 200),
    # A URL that must NOT exist, so a bucket serving 200 for everything (or a
    # Worker misrouted to an index page) is caught too. The Worker serves
    # 404.html WITH status 404, so this proves 404.html is there as well.
    ("/this-page-does-not-exist-smoke-test", 404),
]

SMOKE_BASEMAP = [
    ("/map.js", 200),
    ("/vendor/maplibre-gl.js", 200),
    ("/vendor/pmtiles.js", 200),
    ("/glyphs/NotoSans/3584-3839.pbf", 200),
]


def _status(url, timeout=20):
    req = urllib.request.Request(url, method="GET",
                                 headers={"User-Agent": "motdang-smoke/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as e:                       # DNS, TLS, timeout
        return "ERR %s" % type(e).__name__


def smoke(origin=ORIGIN, say=print, extra=()):
    """Fetch the list. Returns [(path, want, got)] for every failure."""
    checks = list(SMOKE) + (list(SMOKE_BASEMAP) if basemap_on() else []) + list(extra)
    bad = []
    for path, want in checks:
        got = _status(origin + path)
        if got != want:
            bad.append((path, want, got))
            say("    FAIL %-44s want %s got %s" % (path, want, got))
    if not bad:
        say("  smoke: %d live URL(s) answered as expected" % len(checks))
    return bad


def main(argv=None):
    """Standalone: check the tree, or smoke the live site.

        python3 publish/safety.py            # check docs/ is a whole site
        python3 publish/safety.py --smoke    # ask the live site instead
    """
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--smoke" in argv:
        bad = smoke()
        if bad:
            print("\n%d live check(s) failed — the site is not whole." % len(bad))
            return 1
        print("\nlive site is answering.")
        return 0
    problems = check_tree()
    if problems:
        print("\n" + "\n\n".join(problems))
        print("\ndocs/ is NOT publishable.")
        return 1
    print("\ndocs/ looks like a whole site.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
