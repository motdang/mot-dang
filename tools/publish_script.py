#!/usr/bin/env python3
"""One shared map script live in seconds, without waiting for the full round.

    python3 tools/publish_script.py mapfirst.js          # mapfirst_layer.py → motdang.net/mapfirst.js
    python3 tools/publish_script.py mapfirst.js coords.js
    python3 tools/publish_script.py mapfirst.js --dry    # build and check, upload nothing

Gemba 2 (Nan, 2026-10-20): a map fix waited over an hour, because the round
waits until no file in the tree has changed for several minutes and other
sessions were working. publish_now.py does this for one minisite; this does it
for the top-level scripts whose whole source is one layer file. md.js and the
others built from many layers inside build.py still go with the round.

Builds the file the way the build does, stops on a file that does not parse
or carries a local path, uploads it (rclone copy, nothing deleted), sets its
hash in data/asset-versions.json so pages ask for the new copy (deploy.py
asset_versions; the Worker adds ?v=), and fetches it back from the live site.
The next round carries the same source, so the two agree. Commit the layer.

Ledger: ~/.claude/state/publish-now.tsv
"""
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "publish"))
SITE = "https://motdang.net"
LEDGER = pathlib.Path.home() / ".claude" / "state" / "publish-now.tsv"
LEAK = re.compile(r"/Users/|/home/nan/|/srv/mot-dang")


def build_mapfirst(d):
    import mapfirst_layer
    mapfirst_layer.emit(d)          # also appends to explore.css here; only mapfirst.js goes up


def build_coords(d):
    import coords_layer
    coords_layer.emit(d)


BUILDERS = {"mapfirst.js": build_mapfirst, "coords.js": build_coords}


def fetch(url):
    req = urllib.request.Request(url + ("&" if "?" in url else "?") + "r=%d" % time.time(),
                                 headers={"user-agent": "motdang-publish-script/1", "cache-control": "no-cache"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def upload(tmp, names):
    import deploy
    env = deploy.rclone_env(deploy.creds())
    listing = tmp / "files.txt"
    listing.write_text("\n".join(names) + "\n")
    p = subprocess.run(["rclone", "copy", str(tmp), "R2:%s" % deploy.BUCKET, "--files-from", str(listing),
                        "--checksum", "--s3-no-head", "-v"], env=env, text=True, capture_output=True)
    if p.returncode:
        sys.stderr.write(p.stderr[-2000:])
    else:
        # a server round building from an older source keeps these (publish/deploy.py)
        import datetime
        deploy.record_direct_uploads(list(names), datetime.datetime.now(datetime.timezone.utc))
    return p.returncode


def main():
    names = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry" in sys.argv
    bad = [n for n in names if n not in BUILDERS]
    if not names or bad:
        sys.exit(__doc__ + ("\nnot one of %s: %s" % (", ".join(BUILDERS), ", ".join(bad)) if bad else ""))
    t0 = time.time()
    with tempfile.TemporaryDirectory(prefix="publish-script-") as d:
        tmp = pathlib.Path(d)
        (tmp / "data").mkdir()
        hashes = {}
        for n in names:
            BUILDERS[n](tmp)
            f = tmp / n
            text = f.read_text()
            if LEAK.search(text):
                sys.exit("NOT PUBLISHED — %s carries a local path" % n)
            chk = subprocess.run(["node", "--check", str(f)], capture_output=True, text=True)
            if chk.returncode:
                sys.exit("NOT PUBLISHED — %s does not parse:\n%s" % (n, chk.stderr[-800:]))
            hashes[n] = hashlib.md5(f.read_bytes()).hexdigest()[:10]
        # the live list, kept whole; only a list not yet published (404) starts empty
        try:
            av = json.loads(fetch(SITE + "/data/asset-versions.json"))
        except urllib.error.HTTPError as e:
            if e.code != 404:
                sys.exit("NOT PUBLISHED — the live data/asset-versions.json did not answer (%d)" % e.code)
            av = {}
        except Exception as e:
            sys.exit("NOT PUBLISHED — the live data/asset-versions.json could not be read: %s" % e)
        if not isinstance(av, dict):
            sys.exit("NOT PUBLISHED — the live data/asset-versions.json is not a list of hashes")
        changed = [n for n in names if av.get(n) != hashes[n]]
        av.update(hashes)
        (tmp / "data" / "asset-versions.json").write_text(json.dumps(av, sort_keys=True, separators=(",", ":")))
        if dry:
            print("checks pass: %s (%s)" % (", ".join(names), ", ".join("%s %s" % (n, hashes[n]) for n in names)))
            return 0
        # the scripts first, the list that names them after
        if upload(tmp, names):
            print("upload FAILED — the live site is unchanged")
            return 1
        if upload(tmp, ["data/asset-versions.json"]):
            print("the scripts went up; their hashes did not — pages load them unversioned until the next round")
            return 1
    live = {}
    for n in names:
        try:
            live[n] = hashlib.md5(fetch("%s/%s" % (SITE, n))).hexdigest()[:10] == hashes[n]
        except Exception:
            live[n] = False
    secs = round(time.time() - t0)
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    new = not LEDGER.exists()
    with LEDGER.open("a") as f:
        if new:
            f.write("at\tpath\tfiles\tsent\tseconds\tlive\n")
        for n in names:
            f.write("%s\t%s\t1\t%d\t%d\t%s\n" % (time.strftime("%Y-%m-%dT%H:%M:%S"), n, int(n in changed), secs,
                                                 "ok" if live[n] else "not yet"))
    for n in names:
        print("LIVE %s/%s %s%s" % (SITE, n, hashes[n], "" if live[n] else " — the live copy does not match yet"))
    return 0 if all(live.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
