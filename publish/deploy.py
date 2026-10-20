#!/usr/bin/env python3
"""Publish the built site to R2. Stdlib + rclone, and nothing else in the path.

    python3 publish/deploy.py            # dry run, prints exactly what would change
    python3 publish/deploy.py --yes      # actually sync
    python3 publish/deploy.py --only listings --yes
                                         # publish ONE subtree of docs/ and
                                         # leave the rest of the site alone
    python3 publish/deploy.py --files hom.html hom.css --yes
                                         # publish exactly these files of
                                         # docs/ (rclone copy: deletes nothing)
    python3 publish/deploy.py --tiles    # also push the tile archives (~280 MB:
                                         # basemap + terrain DEM, whatever
                                         # data/basemap.json declares)
    python3 publish/deploy.py --yes --prune
                                         # allow a deletion of more than
                                         # safety.DELETE_CEILING live objects.
                                         # Needed only when a large retirement
                                         # is genuinely intended; without it a
                                         # mass deletion stops and shows itself.
    python3 publish/deploy.py --yes --prune-up-to 6000
                                         # allow up to 6,000 deletions, and
                                         # only when docs/ passed the
                                         # whole-site check. The bounded form
                                         # the standing walk passes unattended,
                                         # so ordinary churn retires on its own
                                         # while a tree missing limbs still
                                         # stops. Above the bound it refuses.
    python3 publish/deploy.py --yes --defer-deletions
                                         # when the deletion check refuses,
                                         # upload new and changed files and
                                         # delete nothing (the standing walk)
    python3 publish/deploy.py --yes --no-delete
                                         # upload new and changed files,
                                         # delete nothing
    python3 publish/safety.py            # is docs/ a whole site? (no network)
    python3 publish/safety.py --smoke    # is the LIVE site answering?

WHY A WRAPPER AND NOT JUST `rclone sync`
----------------------------------------
`rclone sync` makes the destination match the source, which means it DELETES
whatever is in the bucket and not in docs/. That is the behaviour we want —
retired pages should stop being served — and it is also one bad build away from
emptying the site. build.py wipes docs/ at the start of every run, so a build
that dies halfway leaves a real directory holding a handful of files, and a
sync of that would be indistinguishable from "the operator meant to delete
27,000 pages".

So this refuses to sync a suspiciously small tree, refuses to sync one with
local paths in it, and shows the deletions before it makes them. The floor is a
count, not a guess: a healthy build is ~27,500 files, and anything under FLOOR
is a broken build rather than a small site.

THE FLOOR WAS NOT ENOUGH — 2026-09-08
-------------------------------------
It is a TOTAL count, and docs/cm/ alone is 77,107 files. A docs/ holding
nothing but cm/ and data/ clears a 20,000-file floor four times over while
missing the front page, 404.html, map.js, both vendored libraries, all four
glyph ranges, the whole of cr/ and the API index — and that is exactly the
tree that got mirrored onto the live site that morning. Everything it did not
contain was deleted from the bucket, and motdang.net answered 404 for its own
front page.

publish/safety.py now asks the question the count could not: not "is this
tree big" but "is this tree THE SITE". It carries the required-path set, the
per-subtree floors, a deletion preview computed by listing both sides, and a
smoke test that puts a question to the live origin AFTER the upload. Read its
docstring before loosening anything here.

CREDENTIALS
-----------
Never in the repo. Either export them:

    export R2_ACCOUNT_ID=...        # Cloudflare account id
    export R2_ACCESS_KEY_ID=...     # R2 > Manage API tokens > Create (Object R+W)
    export R2_SECRET_ACCESS_KEY=...

or put them in ~/.mot-dang-r2.json as {"accountId":…,"accessKeyId":…,"secretAccessKey":…},
the same arrangement as ~/.mot-dang-showtimes.json and the LINE channel token.
"""

import atexit
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import safety                                    # noqa: E402  (same directory)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import holdback                                  # noqa: E402  pages held back this round
import placeround                                # noqa: E402  the weekly place round

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
BASEMAP = ROOT / "data" / "basemap.json"
BUCKET = "mot-dang-site"
BUILD_LOCK = ROOT / "cache" / "build.lock"
DEPLOY_LOG = ROOT / "cache" / "deploy.log"
# The deletions a publish put off (--defer-deletions, --no-delete): one key
# per line, rewritten by every full publish, absent when none were put off.
DEFERRED = Path(os.environ.get("MD_DEFERRED") or (ROOT / "cache" / "deferred-deletions.txt"))
_lock_held = False


def note(line):
    """Append one line to cache/deploy.log, and say it.

    Added 2026-09-08. When the front page went to 404 there was no record on
    this machine that a publish had ever run — not when, not from where, not
    what it deleted — so the outage had to be diagnosed backwards from the
    live site's own 404s. A publish is the most destructive thing this repo
    does and it was the only thing that left no trace.
    """
    stamp = datetime.datetime.now().isoformat(timespec="seconds")
    print(line)
    try:
        DEPLOY_LOG.parent.mkdir(parents=True, exist_ok=True)
        with DEPLOY_LOG.open("a") as fh:
            fh.write("%s  pid=%s  %s\n" % (stamp, os.getpid(), line.strip()))
    except OSError:
        pass                                     # a log that cannot be written
                                                 # must never stop a publish

# A healthy build is ~27,577 files. Anything much under this is a broken or
# half-finished build, and syncing it would delete most of the site.
FLOOR = 20000


def creds():
    c = {"accountId": os.environ.get("R2_ACCOUNT_ID"),
         "accessKeyId": os.environ.get("R2_ACCESS_KEY_ID"),
         "secretAccessKey": os.environ.get("R2_SECRET_ACCESS_KEY")}
    if not all(c.values()):
        p = Path.home() / ".mot-dang-r2.json"
        if p.exists():
            try:
                f = json.loads(p.read_text())
                for k in c:
                    c[k] = c[k] or f.get(k)
            except (ValueError, OSError):
                pass
    missing = [k for k, v in c.items() if not v]
    if missing:
        sys.exit("missing R2 credentials: %s\n(see the docstring at the top of "
                 "this file)" % ", ".join(missing))
    return c


def _lock_holder():
    """(pid, started) from cache/build.lock, or None if it is unreadable."""
    try:
        lines = BUILD_LOCK.read_text().splitlines()
        return int(lines[0].strip()), (lines[1].strip() if len(lines) > 1 else "?")
    except (OSError, ValueError, IndexError):
        return None


def _alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def hold_docs(patience_s=600):
    """Take build.py's OWN lock for the length of the mirror.

    WHY A PUBLISH TAKES THE *BUILD* LOCK. `rclone sync` is a mirror: it reads
    docs/ as it goes and deletes from the bucket whatever has stopped existing
    locally. build.py opens by wiping docs/. Those two together are how the
    site went to 2,479 objects on 2026-08-19 — a build started at 11:56:34
    while a sync fired at 11:50:41 was still walking the tree, and rclone
    faithfully mirrored the disappearance of 25,000 pages.

    build.take_build_lock() already refuses to start when cache/build.lock is
    held by a live pid, and already treats a lock whose process is gone as
    stale. So holding that same file, in that same format, is all it takes:
    a build launched mid-publish now refuses itself, by its own existing rule,
    with no change to build.py at all.

    The standing walk's own guards are not enough here — they serialise walk
    ROUNDS against each other, and the build that did the damage was run
    directly, outside any walk.
    """
    global _lock_held
    BUILD_LOCK.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + patience_s
    while True:
        try:
            fd = os.open(str(BUILD_LOCK), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            held = _lock_holder()
            if held is None:
                BUILD_LOCK.unlink(missing_ok=True)   # unreadable: stale
                continue
            pid, started = held
            if not _alive(pid):
                print("  note: clearing a stale build lock from pid %s (started %s)"
                      % (pid, started))
                BUILD_LOCK.unlink(missing_ok=True)
                continue
            if time.time() > deadline:
                sys.exit("REFUSING: pid %s has been building since %s. Publishing "
                         "now would mirror a half-written docs/ onto the bucket "
                         "and delete the live site. Wait for that build."
                         % (pid, started))
            print("  waiting for pid %s to finish building (started %s)…"
                  % (pid, started))
            time.sleep(10)
        else:
            os.write(fd, ("%d\n%s\n" % (
                os.getpid(),
                datetime.datetime.now().isoformat(timespec="seconds"))).encode())
            os.close(fd)
            _lock_held = True
            atexit.register(release_docs)
            print("  docs/ held for the mirror (build lock, pid %d)" % os.getpid())
            return


def release_docs():
    """atexit, so Ctrl-C and a crash both give it back; SIGKILL does not, which
    is what the stale check above is for."""
    global _lock_held
    if not _lock_held:
        return
    _lock_held = False
    held = _lock_holder()
    if held is not None and held[0] != os.getpid():
        return                                   # somebody else's now; leave it
    BUILD_LOCK.unlink(missing_ok=True)


def gate(scope=None):
    """The same checks a human is supposed to run before publishing, made
    impossible to forget. Both have bitten this project before.

    `scope` narrows both checks to one subtree, for --only. The whole-tree
    FLOOR is a deletion guard — it asks "is docs/ big enough that mirroring it
    will not empty the bucket" — and that question is meaningless when the sync
    can only ever touch one prefix. Applied anyway it does real harm: it makes
    the listings nightly fail for the whole of any hour in which somebody else
    is rebuilding the site, which is a build's business and not a listing's.
    The local-path check is about what gets PUBLISHED and so applies either
    way, just narrowed to the files actually going up.
    """
    if not DOCS.is_dir():
        sys.exit("no docs/ — run python3 build.py first")
    root = DOCS / scope if scope else DOCS
    n = sum(1 for p in root.rglob("*") if p.is_file())
    print("  files in %s: %s" % (root.name + "/" if scope else "docs/", f"{n:,}"))
    if scope:
        if not n:
            sys.exit("REFUSING: %s holds no files, and syncing an empty "
                     "directory would delete what is there now." % root)
    elif n < FLOOR:
        sys.exit("REFUSING: only %s files, floor is %s. That is a broken build, "
                 "not a small site — syncing it would delete the rest of the "
                 "bucket. Rebuild, then try again." % (f"{n:,}", f"{FLOOR:,}"))
    hits = subprocess.run(["grep", "-rl", "/Users/", str(root)],
                          capture_output=True, text=True).stdout.strip()
    # A page held back this round (tools/holdback.py) is not uploaded.
    hits = "\n".join(h for h in hits.splitlines()
                     if not holdback.held(Path(h).relative_to(DOCS).as_posix()))
    if hits:
        sys.exit("REFUSING: local paths in the output —\n" +
                 "\n".join(hits.splitlines()[:5]))
    print("  no local paths, count sane")

    # THE CHECK THE COUNT ABOVE CANNOT DO (added 2026-09-08, after the outage).
    # FLOOR is a total, and docs/cm/ alone is 77,107 files — four times the
    # floor — so a tree missing the front page, both vendored libraries, all
    # four glyph ranges, the whole of cr/ and the API index sails through it.
    # A site is not a file count; it is a set of paths. safety.py holds the
    # set, and the reasoning, and the story of the day this was learned.
    #
    # Scoped to whole-tree publishes: --only deliberately touches one subtree
    # and cannot delete anything outside it, so asking it for a whole site
    # would break the listings nightly for no gain.
    if not scope:
        problems = safety.check_tree(DOCS)
        if problems:
            sys.exit("\nREFUSING:\n\n" + "\n\n".join(problems) +
                     "\n\nThat is a half-built or half-deleted docs/, not a "
                     "small site.\nRun a build to completion, then publish.\n"
                     "To see this check alone: python3 publish/safety.py")
    return n


def declared_archives():
    """(local file, bucket key) for every tile archive data/basemap.json
    declares — the basemap under "url", the elevation DEM under "terrain.url",
    the doodle engine's north archive under "doodle.url".

    The config is what the built pages actually fetch, so --tiles pushes
    exactly that set and nothing hardcoded here. This function replaced a
    single hardcoded path the day after the DEM shipped dark: the terrain
    archive was declared on 2026-08-27, built, symlinked, rendered locally —
    and went un-uploaded, because --tiles only knew the basemap. Every reader
    of /doi.html got a 404ing relief while every deploy reported success.

    A key is the declared relative url verbatim; the local copy sits under
    assets/ at the same path (assets/tiles/x.pmtiles ↔ tiles/x.pmtiles, the
    pairing build.py's docs/tiles symlinks already rely on). An empty url is
    the documented off switch and asks for nothing; an absolute url is hosted
    elsewhere and is not ours to upload.
    """
    try:
        cfg = json.loads(BASEMAP.read_text())
    except (OSError, ValueError) as e:
        sys.exit("cannot read %s: %s" % (BASEMAP, e))
    out = []
    for u in (cfg.get("url"), (cfg.get("terrain") or {}).get("url"),
              (cfg.get("doodle") or {}).get("url"),
              # a province's own archive (Pathum Thani, 2026-10-12)
              *((r or {}).get("url") for r in cfg.get("regions") or [])):
        if not u or "://" in u:
            continue
        key = u.lstrip("./")
        pair = (ROOT / "assets" / key, key)
        if pair not in out:
            out.append(pair)
    return out


def audit_tiles(env, dest):
    """Compare the bucket's copy of each declared archive against assets/.

    Advisory on purpose: a missing or stale archive never blocks the page
    sync — 27,000 pages should not be held hostage to a 161 MB upload — but
    it is named, every deploy, until somebody runs --tiles. The failure this
    catches is the one above: a declared archive with nothing behind it is a
    404 the site serves in silence, and the standing walk's log is the one
    place a person would see it.

    `rclone lsjson` of a missing prefix on R2 answers exit 0 and an empty
    list (verified 2026-08-28), so absence parses like presence; a non-zero
    exit is a real can't-check (network, credentials) and says only that.
    """
    declared = declared_archives()
    if not declared:
        return
    by_dir = {}
    for local, key in declared:
        d = key.rsplit("/", 1)[0] if "/" in key else ""
        by_dir.setdefault(d, []).append((local, key))
    for d, pairs in sorted(by_dir.items()):
        p = subprocess.run(["rclone", "lsjson", "%s/%s" % (dest, d)],
                           env=env, capture_output=True, text=True)
        if p.returncode != 0:
            print("  (could not check %s/ against the bucket)" % (d or "."))
            continue
        try:
            sizes = {o["Path"]: o.get("Size") for o in json.loads(p.stdout)}
        except (ValueError, TypeError, KeyError):
            print("  (could not read the bucket listing for %s/)" % (d or "."))
            continue
        for local, key in pairs:
            have = sizes.get(key.rsplit("/", 1)[-1])
            want = local.stat().st_size if local.exists() else None
            if have is None:
                print("  NOTE: %s is declared in data/basemap.json but absent "
                      "from the bucket — the live site 404s on it until "
                      "publish/deploy.py --yes --tiles runs." % key)
            elif want is not None and want != have:
                print("  NOTE: %s is %s bytes in the bucket, %s in assets/ — "
                      "a re-extracted archive that --tiles has not pushed yet."
                      % (key, f"{have:,}", f"{want:,}"))


def media_excludes():
    """--exclude pairs for the four media prefixes, while MD_MEDIA_BUCKET=1."""
    if os.environ.get("MD_MEDIA_BUCKET") != "1":
        return []
    return [a for p in safety.MEDIA_PREFIXES for a in ("--exclude", "/" + p + "**")]


def rclone_env(c):
    """rclone configured entirely through the environment, so no credential
    ever lands in a config file on disk."""
    e = dict(os.environ)
    e.update({
        "RCLONE_CONFIG_R2_TYPE": "s3",
        "RCLONE_CONFIG_R2_PROVIDER": "Cloudflare",
        "RCLONE_CONFIG_R2_ACCESS_KEY_ID": c["accessKeyId"],
        "RCLONE_CONFIG_R2_SECRET_ACCESS_KEY": c["secretAccessKey"],
        "RCLONE_CONFIG_R2_ENDPOINT":
            "https://%s.r2.cloudflarestorage.com" % c["accountId"],
        # R2 ignores ACLs; setting one makes it 400.
        "RCLONE_CONFIG_R2_NO_CHECK_BUCKET": "true",
    })
    return e


def run(args, env, quiet=False):
    p = subprocess.run(args, env=env, text=True,
                       capture_output=quiet)
    if p.returncode != 0:
        if quiet:
            sys.stderr.write(p.stdout or "")
            sys.stderr.write(p.stderr or "")
        sys.exit("rclone failed (%d)" % p.returncode)
    return p.stdout or ""


def rclone_stats(line):
    """The structured stats object off one --use-json-log line, or None.

    rclone logs its stats at every --stats tick and once more when it is
    done; under --use-json-log each of those lines carries, beside the text,
    the same object the rc `core/stats` call answers. The last one seen is
    the whole run. Numbers, not the wording of a progress line — safety.py
    says why that matters.
    """
    try:
        s = json.loads(line).get("stats")
    except (ValueError, AttributeError):
        return None
    return s if isinstance(s, dict) else None


def rclone_text(line):
    """A --use-json-log line as rclone prints it plain, so the terminal and
    the tower log read as before. A line that is not JSON (a panic, a stray
    print) comes back as it is."""
    try:
        d = json.loads(line)
        msg = d["msg"]
    except (ValueError, KeyError, TypeError):
        return line.rstrip("\n")
    stamp = str(d.get("time", ""))[:19].replace("T", " ")
    return "%s %s: %s" % (stamp, str(d.get("level", "")).upper(),
                          str(msg).rstrip("\n"))


def _size(n):
    """Bytes in rclone's own units, so the log and its progress lines agree."""
    n = float(n)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if n < 1024 or unit == "TiB":
            return ("%d %s" if unit == "B" else "%.1f %s") % (n, unit)
        n /= 1024


def _elapsed(secs):
    secs = int(round(float(secs)))
    h, m, s = secs // 3600, secs % 3600 // 60, secs % 60
    if h:
        return "%dh %02dm %02ds" % (h, m, s)
    return "%dm %02ds" % (m, s) if m else "%ds" % s


def rclone_summary(stats, scope=""):
    """The one deploy.log line per sync: files, bytes, elapsed, rate, errors.

    Before 2026-09-10 the log held the deletion count and "site synced" and
    nothing rclone itself measured, so whether a change to --transfers had
    helped could not be read back. The rates are whole-run averages
    computed here: rclone's own `speed` is a trailing window and reads 0 by
    the time the final line is written. Files per second is the number that
    matters on this line — the sync is bound by round trips, not bytes.
    """
    head = "  rclone%s:" % (" (%s/)" % scope if scope else "")
    if not stats:
        return head + " no stats line seen"
    n = int(stats.get("transfers") or 0)
    nbytes = int(stats.get("bytes") or 0)
    secs = float(stats.get("elapsedTime") or 0)
    errs = int(stats.get("errors") or 0)
    per_s = ("%.1f" % (n / secs)) if secs else "?"
    rate = _size(nbytes / secs) if secs else "?"
    line = ("%s transferred %s file(s) / %s in %s, %s/s, %s file(s)/s, "
            "deleted %s, %s error(s)"
            % (head, f"{n:,}", _size(nbytes), _elapsed(secs), rate, per_s,
               f"{int(stats.get('deletes') or 0):,}", f"{errs:,}"))
    if errs and stats.get("lastError"):
        line += " — last: %s" % stats["lastError"]
    return line


def mirror(args, env, scope=""):
    """One real rclone sync: streamed to the terminal, summarised into the
    log, fatal on failure. The summary is written before the exit so a
    failed sync leaves its error count behind, which is the run that most
    needs one."""
    p = subprocess.Popen(args + ["--use-json-log"], env=env, text=True,
                         stderr=subprocess.PIPE)
    stats = None
    for line in p.stderr:
        s = rclone_stats(line)
        if s is not None:
            stats = s
        print(rclone_text(line))
    p.wait()
    note(rclone_summary(stats, scope))
    if p.returncode != 0:
        sys.exit("rclone failed (%d)" % p.returncode)


def only_prefix():
    """--only <dir>: publish one subtree instead of mirroring the whole site.

    The Listing Sheet's nightly needs this. A listing arriving through the form
    changes exactly one directory, and the alternative — rebuild 27,000 pages
    and mirror the lot — costs twenty minutes and, worse, publishes whatever
    ELSE happens to be half-finished in docs/ at 08:40. A scoped sync cannot do
    that: rclone is pointed at docs/<prefix> and the bucket's <prefix>, so
    nothing outside it is read, written, or deleted.

    The whole-tree FLOOR guard does not apply here and a different one does:
    the prefix must exist and hold files. An empty local directory synced onto
    a populated remote one is still a deletion, just a smaller one.
    """
    if "--only" not in sys.argv:
        return None
    i = sys.argv.index("--only")
    if i + 1 >= len(sys.argv):
        sys.exit("--only needs a directory under docs/, e.g. --only listings")
    rel = sys.argv[i + 1].strip("/")
    local = DOCS / rel
    if not local.is_dir():
        sys.exit("no %s — build it before publishing it" % local)
    return rel, local, sum(1 for f in local.rglob("*") if f.is_file())


def only_files():
    """--files <path> ...: publish these files of docs/ and nothing else.

    For a fix to a handful of top-level pages, where --only has no directory
    to point at and a whole-tree sync would carry whatever else is
    half-finished in docs/. `rclone copy --files-from` uploads the named
    files and cannot delete anything, here or anywhere else in the bucket.
    Every path must exist under docs/.
    """
    if "--files" not in sys.argv:
        return None
    i = sys.argv.index("--files")
    names = []
    for a in sys.argv[i + 1:]:
        if a.startswith("--"):
            break
        names.append(a.strip("/"))
    if not names:
        sys.exit("--files needs one or more paths under docs/, e.g. --files hom.html hom.css")
    missing = [n for n in names if not (DOCS / n).is_file()]
    if missing:
        sys.exit("not in docs/: " + ", ".join(missing))
    unsourced = [n for n in names if not in_source(n)]
    if unsourced:
        sys.exit("REFUSING: the build makes these from assets/, and assets/ does not "
                 "have them —\n  %s\nThe next whole publish would delete them. Install "
                 "the site into assets/ first (build.py copies those folders whole)."
                 % "\n  ".join(unsourced))
    return names


# Folders build.py copies whole from assets/<name>/ to docs/<name>/ (its
# copytree block, "/sites/<slug>/ — one business's own minisite each").
MIRRORED = ("brief", "field", "ghost", "logo", "loop", "markets", "muay-thai",
            "roads", "roadworks", "served", "sites", "the-plan", "voight-kampff",
            "chiang-rai")


def keep_young(young, gone, places):
    """Keep the live copies of `young`: (exclude globs, gone, places) with
    them neither uploaded over, deleted, nor sent by the place round."""
    # --exclude-from reads globs; escape so a key matches only itself.
    globs = ["/" + re.sub(r"([*?\[\]{}\\])", r"\\\1", k) for k in young]
    kept = set(young)
    gone = [k for k in gone if k not in kept]
    if places:
        places = (places[0], [k for k in places[1] if k not in kept])
    return globs, gone, places


def record_direct_uploads(keys, when):
    """Tell motdang-server what --files just uploaded, so a round building
    from an older source keeps these live copies (safety.direct_uploads_since
    says why). Only while the site builds there (cache/build-on-server). A
    ledger that cannot be written is said, never a failed publish."""
    if not (ROOT / "cache" / "build-on-server").exists():
        return
    dest = safety.DIRECT_UPLOADS_PATH
    try:
        p = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
             safety.DIRECT_UPLOADS_HOST,
             "mkdir -p %s && cat >> %s" % (os.path.dirname(dest), dest)],
            input=safety.direct_upload_lines(keys, when), text=True,
            capture_output=True, timeout=30)
        ok, why = p.returncode == 0, (p.stderr or "").strip()[-200:]
    except (OSError, subprocess.TimeoutExpired) as e:
        ok, why = False, str(e)
    if ok:
        note("  %d upload(s) noted in %s:%s" % (len(keys), safety.DIRECT_UPLOADS_HOST, dest))
    else:
        note("  NOT NOTED in %s:%s (%s): a server round building now puts its older "
             "copies back; publish these again once it has published"
             % (safety.DIRECT_UPLOADS_HOST, dest, why or "no reason given"))


def in_source(rel):
    """False for a file under a MIRRORED folder whose site is not in assets/.

    /ghost went live on 21 Sept by a direct upload with no copy in assets/,
    and the next whole-tree sync deleted it. A file inside an installed site
    passes even when the build wrote it (sites/city-live/data/kinds.json):
    the site's folder in assets/ is what makes the build carry it.
    """
    parts = rel.split("/")
    if parts[0] not in MIRRORED or len(parts) == 1:
        return True
    return (ROOT / "assets" / Path(*parts[:2 if len(parts) > 2 else 1])).exists()


def prune_bound():
    """--prune-up-to N: allow up to N deletions, for a tree that passed the
    whole-site check. None when the flag is absent.

    The ceiling stops a mass deletion and asks; --prune lifts it outright.
    Neither suits the standing walk: it runs unattended and cannot type
    --prune, so the night the churn reached 4,115 objects it could not have
    published at all. A bound says how much retirement is ordinary here
    while a tree missing limbs still refuses — safety.deletion_verdict
    applies it only when check_tree passed.
    """
    # Both spellings. --prune-up-to=6000 read as an unknown word would have
    # left the 2,000 ceiling standing and said nothing.
    for a in sys.argv:
        if a.startswith("--prune-up-to="):
            n = a.split("=", 1)[1]
            if not n.isdigit():
                sys.exit("--prune-up-to needs a whole number of deletions, "
                         "e.g. --prune-up-to 6000")
            return int(n)
    if "--prune-up-to" not in sys.argv:
        return None
    i = sys.argv.index("--prune-up-to")
    if i + 1 >= len(sys.argv) or not sys.argv[i + 1].isdigit():
        sys.exit("--prune-up-to needs a whole number of deletions, "
                 "e.g. --prune-up-to 6000")
    return int(sys.argv[i + 1])


def asset_versions(skip=()):
    """docs/data/asset-versions.json: every top-level .js and .css with the
    first 10 hex of its md5. The Worker adds ?v=<that> to each page's
    reference, and a ?v= address is kept by the browser for good, so a
    changed script reaches a reader on their next page view rather than the
    one after (gemba 2, Nan 2026-10-20). A file in `skip` (one this round
    keeps at its live copy) is left out, so no page names a hash the bucket
    does not hold. Returns the file's name under docs/."""
    import hashlib, json
    out = {}
    for f in sorted(list(DOCS.glob("*.js")) + list(DOCS.glob("*.css"))):
        if f.name not in skip:
            out[f.name] = hashlib.md5(f.read_bytes()).hexdigest()[:10]
    dest = DOCS / "data" / "asset-versions.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out, sort_keys=True, separators=(",", ":"))
    if not dest.exists() or dest.read_text() != text:
        dest.write_text(text)
    return "data/asset-versions.json"


def main():
    go = "--yes" in sys.argv
    with_tiles = "--tiles" in sys.argv
    prune = "--prune" in sys.argv
    prune_up_to = prune_bound()
    only = only_prefix()
    files = only_files()

    if not subprocess.run(["which", "rclone"], capture_output=True).returncode == 0:
        sys.exit("rclone not installed — brew install rclone")

    if files:
        # a top-level script or stylesheet sent alone takes its new hash with
        # it — uploaded after the files, so no page names a hash first
        av_after = any("/" not in n and n.endswith((".js", ".css")) for n in files)
        print("mot-dang → r2://%s" % BUCKET)
        hits = [n for n in files if "/Users/" in (DOCS / n).read_text(errors="ignore")]
        if hits:
            sys.exit("REFUSING: local paths in " + ", ".join(hits))
        env = rclone_env(creds())
        listing = Path(tempfile.mkstemp(suffix=".txt")[1])
        listing.write_text("\n".join(files) + "\n")
        cmd = ["rclone", "copy", str(DOCS), "R2:%s" % BUCKET, "--files-from", str(listing),
               "--checksum", "--s3-no-head", "--stats-one-line",
               "--stats-log-level", "NOTICE", "-v"]
        print("  %d file(s), copy only — nothing is deleted" % len(files))
        if not go:
            print("\n  DRY RUN — nothing will change. Add --yes to do it.\n")
            run(cmd + ["--dry-run"], env)
            return
        sent_at = datetime.datetime.now(datetime.timezone.utc)
        run(cmd, env)
        if av_after:
            av = asset_versions()
            run(["rclone", "copyto", str(DOCS / av), "R2:%s/%s" % (BUCKET, av), "--checksum", "--s3-no-head"], env)
        record_direct_uploads(files, sent_at)
        print("\n  asking the live site…")
        bad = safety.smoke(say=note)
        if bad:
            sys.exit("  SMOKE FAILED on %d URL(s)" % len(bad))
        note("  %d file(s) published" % len(files))
        return

    print("mot-dang → r2://%s" % BUCKET)
    gate(only[0] if only else None)
    c = creds()
    env = rclone_env(c)
    dest = "R2:%s" % BUCKET

    # Content types are NOT set here on purpose: the Worker derives them from
    # the key's extension, so the bucket can stay dumb and a wrong guess at
    # upload time cannot mis-serve a page.
    common = ["--checksum",           # compare by hash, not mtime — build.py
                                      # rewrites every file every run
              # The tile archives are NOT part of the site sync and must
              # survive it. `sync` is a mirror: anything in the bucket with no
              # counterpart under docs/ is deleted, and the archives (basemap
              # + terrain DEM, ~280 MB together) are uploaded by --tiles below
              # rather than built into docs/ — so without this line the first
              # ordinary content deploy after the basemap went live would
              # quietly delete it, and every map page would pull a megabyte of
              # MapLibre and then 404 on the tiles. Re-uploading is ~280 MB
              # and nobody would connect the two events.
              "--exclude", "tiles/**",
              # The picture folders in mot-dang-media (media_layer.py,
              # publish/media_sync.py, worker-media/) when the build left them
              # out of docs/: this sync neither uploads nor deletes them, and
              # the copies already in this bucket stay where they are.
              *media_excludes(),
              # 96 in flight, and no HEAD after each PUT (Nan, 2026-09-10).
              # Measured that night: one object round trip ~1 s from here,
              # the sync moving 27 files/s with the line 88% idle — bound by
              # round trips, not bytes. The next sync's checksum pass
              # verifies what the skipped HEAD would have.
              "--transfers", "96", "--checkers", "32", "--s3-no-head",
              "--fast-list", "--stats", "10s", "--stats-one-line",
              # rclone logs its stats at INFO and runs at NOTICE by default,
              # so without this line the stats lines above went nowhere —
              # not to the terminal, not to the log (found 2026-09-10, when
              # nothing could say whether --transfers 96 had helped).
              "--stats-log-level", "NOTICE"]

    if only:
        rel, local, n = only
        scoped = "%s/%s" % (dest, rel)
        print("  scoped to %s/ — %s file(s); nothing outside it is touched"
              % (rel, f"{n:,}"))
        if not go:
            print("\n  DRY RUN — nothing will change. Add --yes to do it.\n")
            run(["rclone", "sync", str(local), scoped, "--dry-run", "-v"]
                + common, env)
            return
        mirror(["rclone", "sync", str(local), scoped] + common, env, scope=rel)
        print("  %s/ synced" % rel)
        return

    if not go:
        print("\n  DRY RUN — nothing will change. Add --yes to do it.\n")
        run(["rclone", "sync", str(DOCS), dest, "--dry-run", "-v"] + common, env)
        print("\n  (lines above marked 'Skipped' are what would happen)")
        audit_tiles(env, dest)
        return

    hold_docs()
    n_after = sum(1 for p in DOCS.rglob("*") if p.is_file())
    if n_after < FLOOR:
        sys.exit("REFUSING: docs/ fell to %s files while taking the lock — "
                 "something wiped it. Rebuild, then try again." % f"{n_after:,}")
    # Re-run the structural check under the lock, for the same reason the
    # count above is re-run: everything checked before the lock was checked
    # against a tree somebody else could still be rewriting.
    problems = safety.check_tree(DOCS, say=lambda *_: None)
    if problems:
        sys.exit("\nREFUSING: docs/ stopped being a whole site while the lock "
                 "was being taken —\n\n" + "\n\n".join(problems))
    # Both checks above exit on failure, so this is True here by
    # construction. It is passed rather than assumed so the verdict carries
    # the condition: a caller that skips the checks gets the ceiling, not
    # the bound.
    tree_ok = n_after >= FLOOR and not problems

    # WHAT WILL THIS DELETE? Asked out loud, before anything is destroyed.
    # The outage deleted the front page, /vendor/, /glyphs/, all of /cr/ and
    # the API index without one word of warning, because a sync's deletions
    # were never counted or shown. Now they are, and a mass deletion needs
    # --prune said out loud, or a bound (--prune-up-to N) that the
    # whole-site check has earned.
    print("\n  listing the bucket to see what this would delete…")
    gone, added = safety.diff_preview(dest, env, run)
    # What the change said would come and go (publish/expected.json).
    announced, said = safety.load_expected()
    for line in said + safety.additions_lines(added, announced):
        note(line)
    # Files uploaded after this build's source was taken are newer than the
    # build: it keeps its hands off them (safety.uploaded_since says why).
    since, how = safety.source_time()
    young = safety.uploaded_since(dest, env, run, gone, since)
    # And files deploy.py --files put up after the source, which the build
    # would overwrite as well as delete (safety.direct_uploads_since).
    # The server's walk names the ledger; a walk started by the previous
    # round's copy of server_walk.sh may not yet, so its path is the default
    # (absent on the laptop: nothing held).
    young = sorted(set(young) | set(safety.direct_uploads_since(
        os.environ.get("MD_DIRECT_UPLOADS") or safety.DIRECT_UPLOADS_PATH, since)))
    keep_list = None
    # Held back this round (tools/holdback.py, Nan 2026-10-11): a page or site
    # a gate failed on keeps its live version — not uploaded, not deleted.
    hold = holdback.excludes()
    if hold:
        note("  holding back %d page(s) or site(s) at their live version: %s"
             % (len(hold), ", ".join(sorted(holdback.load()))))
        gone = [k for k in gone if not holdback.held(k)]
    # The weekly place round (publish/placeround.py, Nan 2026-10-13): between
    # full rounds, place pages go up only when their own record changed.
    places = placeround.plan()
    if places:
        hold += places[0]
        n_gone = len(gone)
        gone = [k for k in gone if not placeround.covered(k)]
        note("  place pages: %s with changed records go up; the rest wait for the "
             "weekly round%s" % (f"{len(places[1]):,}",
                                 ", as do %d deletion(s)" % (n_gone - len(gone)) if n_gone > len(gone) else ""))
    else:
        note("  place pages: full round — %s" % placeround.why_full())
    if young:
        note("  keeping %d live file(s) uploaded after this build's source "
             "(%s, %s): %s%s"
             % (len(young), since.isoformat(timespec="seconds"), how,
                ", ".join(young[:5]), " …" if len(young) > 5 else ""))
        globs, gone, places = keep_young(young, gone, places)
        hold += globs
    # the script versions go up last, after the scripts they name, and leave
    # out any script this round keeps at its live copy
    av_rel = asset_versions(skip={k for k in young if "/" not in k})
    hold.append("/" + av_rel)
    if hold:
        keep_list = Path(tempfile.mkstemp(suffix=".txt")[1])
        atexit.register(keep_list.unlink, missing_ok=True)
        keep_list.write_text("".join(g + "\n" for g in hold))
    ok, msg = safety.deletion_verdict(gone, prune=prune, prune_up_to=prune_up_to,
                                      tree_ok=tree_ok, announced=announced)
    # DEFER, DO NOT REFUSE (Nan, 2026-10-11). Deleting is the only part of a
    # publish a refused deletion check speaks to; new and changed files go up
    # with `rclone copy`, which deletes nothing, and the deletions wait in
    # DEFERRED for a round that passes. --no-delete: the caller's own check
    # refused (importers/server_walk.sh, pre_deploy). --defer-deletions: defer
    # instead of refusing here, for a tree that passed check_tree.
    defer = "--no-delete" in sys.argv or (
        not ok and tree_ok and "--defer-deletions" in sys.argv)
    if not ok and not defer:
        sys.exit("\n" + msg + "\n")
    note(msg)
    DEFERRED.unlink(missing_ok=True)
    keep = ["--exclude-from", str(keep_list)] if keep_list else []
    if defer:
        DEFERRED.write_text("".join(k + "\n" for k in gone))
        note("\n  DELETIONS DEFERRED — uploading new and changed files only; "
             "%s live file(s) kept, listed in %s"
             % (f"{len(gone):,}", DEFERRED))
        mirror(["rclone", "copy", str(DOCS), dest] + common + keep, env)
        note("  site copied, nothing deleted")
    else:
        used = safety.expected_used(safety.expected_split(gone, announced)[1])
        note("\n  syncing… (%s local files, %s deletions)"
             % (f"{n_after:,}", f"{len(gone):,}"))
        mirror(["rclone", "sync", str(DOCS), dest] + common + keep, env)
        note("  site synced")
        if used:
            safety.mark_expected_done(used)
            note("  announced cuts done, no longer applied: %s" % ", ".join(used))
    if places and places[1]:
        # --files-from refuses other filters, so this copy takes the flags alone.
        ups = Path(tempfile.mkstemp(suffix=".txt")[1])
        atexit.register(ups.unlink, missing_ok=True)
        ups.write_text("".join(k + "\n" for k in places[1]))
        mirror(["rclone", "copy", str(DOCS), dest, "--files-from", str(ups), "--checksum",
                "--transfers", "96", "--checkers", "32", "--s3-no-head", "--stats", "10s",
                "--stats-one-line", "--stats-log-level", "NOTICE"], env)
        note("  place pages with changed records copied")
    run(["rclone", "copyto", str(DOCS / av_rel), "%s/%s" % (dest, av_rel), "--checksum", "--s3-no-head"], env)
    note("  script versions published")
    placeround.record(full=places is None, uploaded=places[1] if places else ())

    if with_tiles:
        archives = declared_archives()
        if not archives:
            print("\n  --tiles: data/basemap.json declares no archives to push")
        for local, key in archives:
            if not local.exists():
                sys.exit("no %s — data/basemap.json declares %s but the file "
                         "is not on this machine (that file says how each "
                         "archive is made)" % (local, key))
        for local, key in archives:
            mb = local.stat().st_size / 1e6
            print("\n  uploading %s (%.0f MB, only changes when re-extracted)…"
                  % (key, mb))
            run(["rclone", "copyto", str(local), "%s/%s" % (dest, key),
                 "--checksum", "--stats", "10s", "--stats-one-line",
                 "--stats-log-level", "NOTICE"], env)
        if archives:
            print("  tile archives uploaded — data/basemap.json already "
                  "points the site at them")
    else:
        audit_tiles(env, dest)

    # ASK THE LIVE SITE. A publish that prints "done" while the front page
    # 404s is precisely what happened on 2026-09-08, and it stood for hours
    # because nothing ever put a question to the origin afterwards. R2 is
    # read-after-write consistent, so this needs no settling delay; a failure
    # here is a real failure, not a race.
    print("\n  asking the live site…")
    bad = safety.smoke(say=note)
    if bad:
        note("  SMOKE FAILED on %d URL(s) — the site is NOT whole" % len(bad))
        print("\n  The upload finished but the site does not answer. Do not\n"
              "  walk away from this. Re-check docs/ (python3 publish/safety.py),\n"
              "  rebuild if it is short, and publish again.\n")
        sys.exit(1)
    note("\ndone. https://motdang.net/")


if __name__ == "__main__":
    main()
