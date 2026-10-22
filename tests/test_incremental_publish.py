#!/usr/bin/env python3
"""Tests for publish/incpublish.py and deploy.py --incremental, against a folder
standing in for the bucket (an rclone remote of type local).

    python3 tests/test_incremental_publish.py

What has to hold: a changed phone number sends two files and reads no listing of
the bucket; a removed place's pages are deleted through the same deletion check
as before, which still refuses a mass deletion and still defers on request; a live
copy newer than the build's source is not overwritten, with or without the ledger;
the weekly place round still decides which place pages go up between rounds.
"""
import datetime
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PUBLISH = Path(__file__).resolve().parent.parent / "publish"
sys.path.insert(0, str(PUBLISH))
sys.path.insert(0, str(PUBLISH.parent / "tools"))
import safety        # noqa: E402
import incpublish    # noqa: E402
import early         # noqa: E402


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


deploy = _load("deploy_inc", PUBLISH / "deploy.py")
import placeround    # noqa: E402

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("  %s %s%s" % ("ok  " if cond else "FAIL", name, "" if cond else "  — " + detail))


def write(root, rel, text):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
    return p


def tree(root):
    root = Path(root)
    return {str(p.relative_to(root)): p.read_text() for p in sorted(root.rglob("*")) if p.is_file()}


def site(docs, phone="053-111"):
    """A small site: the front page, scripts, data, and ten places."""
    write(docs, "index.html", "<html>front</html>")
    write(docs, "404.html", "<html>404</html>")
    write(docs, "style.css", "body{}")
    write(docs, "md.js", "var md;")
    write(docs, "data/index.json", "[]")
    write(docs, "api/v1/grid/c0000.json", "{}")
    for n in range(10):
        write(docs, "cm/p/%d.html" % n, "<html>place %d %s</html>" % (n, phone if n == 7 else ""))
        write(docs, "cm/p/%d.json" % n, '{"id": %d, "phone": "%s"}' % (n, phone if n == 7 else ""))


class Bucket:
    """deploy.main() pointed at a local folder, with the checks that need a real site left out."""

    def __init__(self, tmp):
        self.tmp = Path(tmp)
        self.docs = self.tmp / "docs"
        self.bucket = self.tmp / "bucket"
        self.bucket.mkdir()
        self.cache = self.tmp / "cache"
        self.cache.mkdir()
        self.listed = 0
        env = dict(os.environ, RCLONE_CONFIG_R2_TYPE="local")
        deploy.DOCS = safety.DOCS = self.docs
        deploy.BUCKET = str(self.bucket)
        deploy.DEPLOY_LOG = self.tmp / "deploy.log"
        deploy.DEFERRED = self.tmp / "deferred.txt"
        deploy.FLOOR = 1
        deploy.gate = lambda scope=None: None
        deploy.creds = lambda: {}
        deploy.rclone_env = lambda c: env
        deploy.hold_docs = lambda *a, **k: None
        deploy.audit_tiles = lambda env, dest: None
        deploy.record_direct_uploads = lambda keys, when: None
        safety.check_tree = lambda root=None, say=print: []
        safety.smoke = lambda say=print, extra=(): []
        real_diff = safety.diff_preview

        def counted(*a, **k):
            self.listed += 1
            return real_diff(*a, **k)
        safety.diff_preview = counted
        incpublish.MANIFEST = self.cache / "published-manifest.json"
        placeround.INPUTS = self.cache / "place-inputs.json"
        placeround.PUBLISHED = self.cache / "place-published.json"
        placeround.FULL_NOW = self.cache / "place-full-now"
        os.environ["MD_HOLD_BACK"] = str(self.cache / "held-back.txt")
        os.environ.pop("MD_SOURCE_AT", None)
        os.environ.pop("MD_MEDIA_BUCKET", None)

    def publish(self, *flags):
        sys.argv = ["deploy.py", "--yes"] + list(flags)
        self.listed = 0
        try:
            deploy.main()
            return 0
        except SystemExit as e:
            return e.code if e.code is not None else 0

    def live(self):
        return tree(self.bucket)

    def log(self):
        try:
            return deploy.DEPLOY_LOG.read_text()
        except OSError:
            return ""


def mtimes(root):
    return {k: (Path(root) / k).stat().st_mtime_ns for k in tree(root)}


def main():
    if not shutil.which("rclone"):
        print("rclone is not installed: nothing to test against")
        return
    tmp = Path(tempfile.mkdtemp())
    try:
        b = Bucket(tmp)
        site(b.docs)

        print("the first publish, in full, writes the manifest")
        rc = b.publish("--incremental")
        live = b.live()
        want = {k: v for k, v in tree(b.docs).items()}
        check("the first publish ran", rc == 0, str(rc))
        check("it listed the bucket (no manifest to go by)", b.listed == 1, str(b.listed))
        check("the bucket holds the site", all(live.get(k) == v for k, v in want.items() if k != "data/asset-versions.json"),
              str(sorted(set(want) - set(live))))
        man = incpublish.load()
        check("a manifest of the files now live was written", man is not None and "cm/p/7.html" in man,
              str(man and len(man)))
        check("the script versions file is not in it", "data/asset-versions.json" not in man)

        print("one phone number changes")
        before = mtimes(b.bucket)
        time.sleep(0.05)
        write(b.docs, "cm/p/7.html", "<html>place 7 053-999</html>")
        write(b.docs, "cm/p/7.json", '{"id": 7, "phone": "053-999"}')
        rc = b.publish("--incremental")
        after = mtimes(b.bucket)
        moved = sorted(k for k in after if before.get(k) != after[k])
        check("it ran", rc == 0, str(rc))
        check("it did not list the bucket", b.listed == 0, "listed %d times" % b.listed)
        check("the new page is live", "053-999" in b.live()["cm/p/7.html"] and "053-999" in b.live()["cm/p/7.json"])
        check("exactly those two files were written",
              [k for k in moved if k != "data/asset-versions.json"] == ["cm/p/7.html", "cm/p/7.json"], str(moved))
        check("the log says what it sent", "sending 2 changed file(s)" in b.log(), b.log()[-600:])

        print("nothing changes")
        before = mtimes(b.bucket)
        rc = b.publish("--incremental")
        check("a publish with nothing new writes nothing",
              rc == 0 and mtimes(b.bucket) == before, str(rc))

        print("a place is removed")
        (b.docs / "cm/p/9.html").unlink()
        (b.docs / "cm/p/9.json").unlink()
        rc = b.publish("--incremental")
        live = b.live()
        check("its two pages are deleted", "cm/p/9.html" not in live and "cm/p/9.json" not in live, str(sorted(live)))
        check("the others stay", "cm/p/8.html" in live and "index.html" in live)
        check("the deletion went through the check", "deletions: 2 object(s)" in b.log(), b.log()[-500:])

        print("a mass deletion")
        safety.DELETE_CEILING = 3
        for n in range(0, 6):
            (b.docs / ("cm/p/%d.html" % n)).unlink()
        rc = b.publish("--incremental")
        check("is refused", rc not in (0, None) and "cm/p/0.html" in b.live(), "rc=%r" % (rc,))
        rc = b.publish("--incremental", "--defer-deletions")
        check("is deferred when asked: nothing deleted", rc == 0 and "cm/p/0.html" in b.live(), "rc=%r" % (rc,))
        check("the deferred keys are listed", "cm/p/0.html" in deploy.DEFERRED.read_text())
        rc = b.publish("--incremental", "--defer-deletions")
        check("and stay waiting the next round", "cm/p/0.html" in b.live() and "cm/p/0.html" in deploy.DEFERRED.read_text())
        rc = b.publish("--incremental", "--prune")
        check("--prune lifts the ceiling", rc == 0 and "cm/p/0.html" not in b.live(), "rc=%r" % (rc,))
        safety.DELETE_CEILING = 2000
        # api/ is never pruned
        (b.docs / "api/v1/grid/c0000.json").unlink()
        rc = b.publish("--incremental", "--prune")
        check("api/ is refused even with --prune",
              "api/v1/grid/c0000.json" in b.live() or rc != 0, "rc=%r" % (rc,))
        write(b.docs, "api/v1/grid/c0000.json", "{}")
        b.publish("--incremental")

        print("a live copy newer than the build's source")
        now = datetime.datetime.now(datetime.timezone.utc)
        os.environ["MD_SOURCE_AT"] = (now - datetime.timedelta(hours=5)).isoformat()
        write(b.bucket, "sites/hot/index.html", "direct upload, just now")
        write(b.bucket, "sites/old/index.html", "direct upload, long ago")
        old = (now - datetime.timedelta(hours=20)).timestamp()
        os.utime(b.bucket / "sites/old/index.html", (old, old))
        write(b.docs, "sites/hot/index.html", "the build's older copy")
        write(b.docs, "sites/old/index.html", "the build's copy")
        rc = b.publish("--incremental")
        live = b.live()
        check("the newer live file is kept", live["sites/hot/index.html"] == "direct upload, just now", live["sites/hot/index.html"])
        check("an older live file is overwritten", live["sites/old/index.html"] == "the build's copy")
        check("the log names what it kept", "sites/hot/index.html" in b.log())
        man = incpublish.load()
        check("the kept file has no entry, so it is asked again", "sites/hot/index.html" not in man)
        os.environ["MD_SOURCE_AT"] = (now + datetime.timedelta(hours=3)).isoformat()
        rc = b.publish("--incremental")
        check("a later round, sourced after the upload, sends the build's copy",
              b.live()["sites/hot/index.html"] == "the build's older copy", b.live()["sites/hot/index.html"])
        os.environ.pop("MD_SOURCE_AT", None)
        keys3 = ["sites/hot/index.html", "sites/old/index.html", "index.html", "cm/p/nothing.html"]
        env3 = deploy.rclone_env({})
        one = incpublish.young_keys("R2:%s" % b.bucket, env3, deploy.run, keys3, now - datetime.timedelta(hours=5), {}, {})
        incpublish.LOOKUP_MAX = 1
        many = incpublish.young_keys("R2:%s" % b.bucket, env3, deploy.run, keys3, now - datetime.timedelta(hours=5), {}, {})
        incpublish.LOOKUP_MAX = 2000
        check("past LOOKUP_MAX one listing of what is recent answers the same", one == many and "sites/hot/index.html" in one, "%s / %s" % (one, many))
        mine = {"sites/hot/index.html": [0, 0, incpublish._md5(b.bucket / "sites/hot/index.html")]}
        check("a live copy that is the one this publisher put there is not young",
              "sites/hot/index.html" not in incpublish.young_keys("R2:%s" % b.bucket, env3, deploy.run, keys3,
                                                                  now - datetime.timedelta(hours=5), mine, {}))

        print("the weekly place round")
        # records: place 3 changed its record; place 4 only its template. Between full rounds,
        # only 3 goes up (publish/placeround.py)
        placeround.INPUTS.write_text(json.dumps({"cm/p/3.html": "new", "cm/p/3.json": "new",
                                                 "cm/p/8.html": "same", "cm/p/8.json": "same"}))
        placeround.PUBLISHED.write_text(json.dumps({
            "full_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "hashes": {"cm/p/3.html": "old", "cm/p/3.json": "old", "cm/p/8.html": "same", "cm/p/8.json": "same"}}))
        write(b.docs, "cm/p/3.html", "<html>place 3 new record</html>")
        write(b.docs, "cm/p/3.json", '{"id": 3, "new": 1}')
        write(b.docs, "cm/p/8.html", "<html>place 8 new template</html>")
        write(b.docs, "cm/p/6.html", "<html>place 6 new template</html>")
        rc = b.publish("--incremental")
        live = b.live()
        check("a place whose record changed goes up", "new record" in live["cm/p/3.html"])
        check("a place whose template changed waits for the weekly round",
              "new template" not in live["cm/p/8.html"] and "new template" not in live["cm/p/6.html"])
        man = incpublish.load()
        check("a page that waits keeps its old manifest entry (asked again next round)",
              man["cm/p/6.html"][2] != incpublish._md5(b.docs / "cm/p/6.html")
              and man["cm/p/8.html"][2] != incpublish._md5(b.docs / "cm/p/8.html"))
        (b.docs / "cm/p/7.html").unlink()
        (b.docs / "cm/p/7.json").unlink()
        rc = b.publish("--incremental")
        check("a removed place's pages wait for the weekly round, as before",
              "cm/p/7.html" in b.live() and "cm/p/7.html" in incpublish.load(), "")
        placeround.FULL_NOW.write_text("")
        rc = b.publish("--incremental")
        live = b.live()
        check("a forced full place round sends them", "new template" in live["cm/p/8.html"]
              and "new template" in live["cm/p/6.html"])
        check("and deletes the removed place", "cm/p/7.html" not in live and "cm/p/7.json" not in live
              and "cm/p/7.html" not in incpublish.load(), str(sorted(k for k in live if "p/7." in k)))
        check("the full round recorded itself", not placeround.FULL_NOW.exists())

        print("an early push of the pages a round drew")
        page = "<html><head><title>ร้าน</title></head><body>%s</body></html>" % ("x" * 600)
        write(b.docs, "cm/p/2.html", page.replace("x", "a", 1))
        write(b.docs, "cm/p/2.json", '{"id": 2, "phone": "053-222"}')
        write(b.docs, "cm/p/3.html", page + "/Users/annikapeacock/x")
        write(b.docs, "cm/p/3.json", "{}")
        got = early.push(b.docs, ["cm/p/2.html", "cm/p/2.json"], say=lambda m: None, deploy=deploy)
        check("pages that pass are live at once", got["sent"] == 2 and b.live()["cm/p/2.json"] == '{"id": 2, "phone": "053-222"}', str(got))
        check("and the bucket was not listed", b.listed == 0)
        got = early.push(b.docs, ["cm/p/3.html", "cm/p/3.json"], say=lambda m: None, deploy=deploy)
        check("a page with a local path is not sent", got["sent"] == 0 and "local path" in (got["refused"] or ""), str(got))
        check("it is not live", "053-" not in b.live().get("cm/p/3.json", "") and b.live().get("cm/p/3.html", "") != page + "/Users/annikapeacock/x")
        write(b.docs, "cm/p/5.html", "<html>short</html>")
        write(b.docs, "cm/p/5.json", "{not json")
        got = early.push(b.docs, ["cm/p/5.html", "cm/p/5.json"], say=lambda m: None, deploy=deploy)
        check("a stub or a broken json is not sent", got["sent"] == 0 and got["refused"], str(got))
        many = []
        for n in range(early.MAX_FILES + 1):
            write(b.docs, "cm/p/m%d.json" % n, "{}")
            many.append("cm/p/m%d.json" % n)
        got = early.push(b.docs, many, say=lambda m: None, deploy=deploy)
        check("more than MAX_FILES is not a small change", got["sent"] == 0 and "more than an early push takes" in got["refused"])
        now = datetime.datetime.now(datetime.timezone.utc)
        os.environ["MD_SOURCE_AT"] = (now - datetime.timedelta(hours=5)).isoformat()
        write(b.bucket, "cm/p/2.json", "a direct upload, just now")
        write(b.docs, "cm/p/2.json", '{"id": 2, "phone": "053-333"}')
        got = early.push(b.docs, ["cm/p/2.json"], say=lambda m: None, deploy=deploy)
        check("a live file newer than the source is left alone",
              got["sent"] == 0 and got["kept"] == ["cm/p/2.json"] and b.live()["cm/p/2.json"] == "a direct upload, just now", str(got))
        os.environ.pop("MD_SOURCE_AT", None)
        check("the flag file turns it on", not early.enabled())
        early.FLAG = tmp / "early-places"
        early.FLAG.write_text("")
        check("and its absence off", early.enabled())
        early.FLAG.unlink()
        for k in list(many) + ["cm/p/3.html", "cm/p/3.json", "cm/p/5.html", "cm/p/5.json"]:
            (b.docs / k).unlink(missing_ok=True)

        print("a manifest a week old")
        doc = json.loads(incpublish.MANIFEST.read_text())
        doc["full_at"] = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=8)).isoformat()
        incpublish.MANIFEST.write_text(json.dumps(doc))
        check("is not used", incpublish.load() is None)
        write(b.docs, "index.html", "<html>front, again</html>")
        rc = b.publish("--incremental")
        check("the publish lists the bucket, sends the change and dates the manifest anew",
              rc == 0 and b.listed == 1 and "front, again" in b.live()["index.html"]
              and incpublish.load() is not None, "listed %d" % b.listed)
        before = json.loads(incpublish.MANIFEST.read_text())["full_at"]
        write(b.docs, "index.html", "<html>front, third</html>")
        rc = b.publish("--incremental")
        check("a publish that went by the manifest keeps its date",
              b.listed == 0 and json.loads(incpublish.MANIFEST.read_text())["full_at"] == before)

        print("a manifest that does not parse")
        incpublish.MANIFEST.write_text("{not json")
        write(b.docs, "index.html", "<html>front, new</html>")
        rc = b.publish("--incremental")
        check("falls back to the listing and writes a new manifest",
              rc == 0 and b.listed == 1 and incpublish.load() is not None and "front, new" in b.live()["index.html"],
              "rc=%r listed %d manifest=%s index=%r\n%s" % (rc, b.listed, incpublish.load() is not None, b.live()["index.html"], b.log()[-900:]))

        print("incpublish functions")
        a = {"x": [1, 1, "aa"], "y": [1, 1, "bb"], "z": [1, 1, "cc"]}
        c = {"x": [1, 2, "aa"], "y": [1, 1, "zz"], "w": [1, 1, "dd"]}
        changed, gone, added = incpublish.diff(a, c)
        check("diff: a key whose md5 is the same is not changed (a new mtime alone is nothing)",
              "x" not in changed)
        check("diff: changed, gone, added", changed == ["w", "y"] and gone == ["z"] and added == ["w"],
              "%s %s %s" % (changed, gone, added))
        m = incpublish.next_manifest(a, c, kept={"y", "w"}, deferred=["z"])
        check("next_manifest: a kept key keeps its old entry, a new kept key has none, a deferred key stays",
              m["y"] == a["y"] and "w" not in m and m["z"] == a["z"] and m["x"] == c["x"], str(m))
        d = tmp / "scan"
        write(d, "a.txt", "one")
        write(d, "tiles/b.bin", "two")
        s1 = incpublish.scan(d, None, skip=("tiles/",))
        check("scan: skips the prefixes a publish leaves alone", list(s1) == ["a.txt"], str(list(s1)))
        s1["a.txt"][2] = "stale-but-same-stat"
        s2 = incpublish.scan(d, s1)
        check("scan: a file with the size and mtime it had is not read again",
              s2["a.txt"][2] == "stale-but-same-stat", str(s2["a.txt"]))

        print("the ledger of direct uploads")
        notes, calls = [], []
        real_run = subprocess.run
        deploy2 = _load("deploy_inc2", PUBLISH / "deploy.py")

        class Done:
            def __init__(self, rc, err=""):
                self.returncode, self.stderr, self.stdout = rc, err, ""
        repo = tmp / "repo"
        (repo / "cache").mkdir(parents=True)
        (repo / "cache" / "build-on-server").write_text("")
        deploy2.ROOT = repo
        deploy2.PENDING_UPLOADS = repo / "cache" / "direct-uploads.pending.tsv"
        deploy2.RETRY_PAUSE = 0
        deploy2.note = notes.append
        at = datetime.datetime(2026, 10, 20, 0, 0, tzinfo=datetime.timezone.utc)

        def timeout_twice(args, **kw):
            calls.append(args)
            if len(calls) < 3:
                raise subprocess.TimeoutExpired(args, 30)
            return Done(0)
        deploy2.subprocess.run = timeout_twice
        deploy2.record_direct_uploads(["data/air.json"], at)
        check("two timeouts, then the third try lands", len(calls) == 3 and notes[-1].lstrip().startswith("1 upload(s) noted"),
              "%d calls, %s" % (len(calls), notes[-1:]))
        check("nothing is left pending", not deploy2.PENDING_UPLOADS.exists())
        calls.clear()
        deploy2.subprocess.run = lambda args, **kw: (calls.append(args), Done(255, "timed out"))[1]
        deploy2.record_direct_uploads(["data/air.json", "data/weather.json"], at)
        check("three tries, then NOT NOTED", len(calls) == 3 and notes[-1].lstrip().startswith("NOT NOTED"), notes[-1])
        check("the lines wait in cache/ for the next walk",
              deploy2.PENDING_UPLOADS.read_text() == safety.direct_upload_lines(["data/air.json", "data/weather.json"], at),
              repr(deploy2.PENDING_UPLOADS.read_text() if deploy2.PENDING_UPLOADS.exists() else None))
        subprocess.run = real_run
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n%d passed, %d failed" % (len(PASS), len(FAIL)))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
