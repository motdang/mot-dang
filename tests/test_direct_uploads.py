#!/usr/bin/env python3
"""Tests for the direct-upload ledger (publish/safety.py direct_uploads_since,
publish/deploy.py record_direct_uploads and keep_young).

Run as a script:  python3 tests/test_direct_uploads.py

THE TEST THAT MATTERS is the 2026-10-19 roadworks case: publish-site put the
฿5 bounty live at 08:20, a server round whose source was sent at 07:03 would
OVERWRITE it (not delete it), and the round must keep the live copy. The last
part runs a real rclone sync with the exclude list deploy.py builds, so the
check is what rclone does, not what the list looks like.
"""

import datetime
import importlib.util
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PUBLISH = Path(__file__).resolve().parent.parent / "publish"
sys.path.insert(0, str(PUBLISH))
import safety                                                    # noqa: E402


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


deploy = _load("deploy_du", PUBLISH / "deploy.py")
UTC = datetime.timezone.utc
BKK = datetime.timezone(datetime.timedelta(hours=7))

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("  %s %s%s" % ("ok  " if cond else "FAIL", name,
                         "" if cond else "  — " + detail))


def main():
    print("direct-upload ledger")
    tmp = Path(tempfile.mkdtemp())
    try:
        # ---- the ledger lines ---------------------------------------------
        at = datetime.datetime(2026, 10, 19, 8, 20, 5, tzinfo=BKK)
        lines = safety.direct_upload_lines(["roadworks/bots.txt", "roadworks/sandbox.json"], at)
        check("a line is <utc iso>\\t<key>",
              lines == "2026-10-19T01:20:05+00:00\troadworks/bots.txt\n"
                       "2026-10-19T01:20:05+00:00\troadworks/sandbox.json\n", repr(lines))

        # ---- which keys a round keeps ------------------------------------
        source = datetime.datetime(2026, 10, 19, 7, 3, 26, tzinfo=BKK)
        ledger = tmp / "direct-uploads.tsv"
        ledger.write_text(
            lines
            + "2026-10-19T00:30:00Z\tsites/grace/index.html\n"        # 33 min before source
            + "2026-10-18T20:00:00+00:00\tsites/old/index.html\n"     # 4 h before source
            + "not a time\tsites/garbled/index.html\n"
            + "2026-10-19T02:00:00+00:00\t\n"
            + "2026-10-19T02:00:00\tsites/naive/index.html\n")        # no zone: UTC
        kept = safety.direct_uploads_since(str(ledger), source)
        check("the 08:20 upload is kept from the 07:03 round",
              "roadworks/bots.txt" in kept and "roadworks/sandbox.json" in kept, str(kept))
        check("an upload inside SOURCE_GRACE_S before the source is kept",
              "sites/grace/index.html" in kept, str(kept))
        check("an upload older than the grace is not kept",
              "sites/old/index.html" not in kept, str(kept))
        check("a line whose time does not parse is skipped",
              "sites/garbled/index.html" not in kept, str(kept))
        check("a line with no key is skipped", "" not in kept, str(kept))
        check("a time with no zone reads as UTC", "sites/naive/index.html" in kept, str(kept))
        check("a later round, sent after the upload + grace, keeps none of it",
              safety.direct_uploads_since(
                  str(ledger), datetime.datetime(2026, 10, 19, 12, 0, tzinfo=BKK)) == [])
        check("no ledger set: nothing held", safety.direct_uploads_since(None, source) == [])
        check("ledger missing: nothing held",
              safety.direct_uploads_since(str(tmp / "absent.tsv"), source) == [])

        # ---- keep_young: overwrite and delete alike -----------------------
        young = ["roadworks/bots.txt", "sites/[x]/a.html"]
        gone = ["sites/[x]/a.html", "sites/really-gone.html"]
        places = (["/cm/p/**"], ["cm/p/one.html", "roadworks/bots.txt"])
        globs, gone2, places2 = deploy.keep_young(young, gone, places)
        check("an overwritten key gets an exclude", "/roadworks/bots.txt" in globs, str(globs))
        check("a glob character is escaped", "/sites/\\[x\\]/a.html" in globs, str(globs))
        check("a deleted key leaves gone, the rest stay",
              gone2 == ["sites/really-gone.html"], str(gone2))
        check("the place round does not send a kept key",
              places2 == (["/cm/p/**"], ["cm/p/one.html"]), str(places2))
        check("no place round stays None", deploy.keep_young(young, [], None)[2] is None)

        # ---- rclone honours it ---------------------------------------------
        if shutil.which("rclone"):
            build, live = tmp / "build", tmp / "live"
            for root, bots, gone_file in ((build, "฿10\n", False), (live, "฿5\n", True)):
                (root / "roadworks").mkdir(parents=True)
                (root / "roadworks" / "bots.txt").write_text(bots)
                (root / "roadworks" / "index.html").write_text("page " + bots)
                (root / "sites" / "[x]").mkdir(parents=True)
                if gone_file:
                    (root / "sites" / "[x]" / "a.html").write_text("young")
                    (root / "stale.html").write_text("old")
            excl = tmp / "keep.txt"
            excl.write_text("".join(g + "\n" for g in deploy.keep_young(
                ["roadworks/bots.txt", "sites/[x]/a.html"], [], None)[0]))
            p = subprocess.run(["rclone", "sync", str(build), str(live), "--checksum",
                                "--exclude-from", str(excl), "-q"],
                               capture_output=True, text=True)
            check("rclone sync ran", p.returncode == 0, p.stderr[-300:])
            check("rclone kept the ฿5 upload over the build's ฿10",
                  (live / "roadworks/bots.txt").read_text() == "฿5\n")
            check("rclone kept a young file the build lacks",
                  (live / "sites/[x]/a.html").exists())
            check("rclone still sent the build's other changes",
                  (live / "roadworks/index.html").read_text() == "page ฿10\n"
                  and not (live / "stale.html").exists())
        else:
            print("  (rclone not installed: the rclone part is skipped)")

        # ---- record_direct_uploads ----------------------------------------
        calls, notes = [], []
        real_run, real_note, real_root = deploy.subprocess.run, deploy.note, deploy.ROOT

        class Done:
            def __init__(self, rc, err=""):
                self.returncode, self.stderr, self.stdout = rc, err, ""

        try:
            deploy.note = notes.append
            deploy.ROOT = tmp / "repo"
            (deploy.ROOT / "cache").mkdir(parents=True)

            def fake_ok(args, **kw):
                calls.append((args, kw))
                return Done(0)
            deploy.subprocess.run = fake_ok
            deploy.record_direct_uploads(["roadworks/bots.txt"], at)
            check("without cache/build-on-server: no ssh", calls == [], str(calls))

            (deploy.ROOT / "cache" / "build-on-server").write_text("")
            deploy.record_direct_uploads(["roadworks/bots.txt"], at)
            args, kw = calls[-1] if calls else ([], {})
            check("with it: one ssh in BatchMode with a timeout",
                  args[:1] == ["ssh"] and "BatchMode=yes" in args and kw.get("timeout"), str(args))
            check("to the server's ledger, appended",
                  safety.DIRECT_UPLOADS_HOST in args
                  and args[-1].endswith("cat >> /srv/state/direct-uploads.tsv"), str(args))
            check("the lines go on stdin",
                  kw.get("input") == "2026-10-19T01:20:05+00:00\troadworks/bots.txt\n",
                  repr(kw.get("input")))

            deploy.subprocess.run = lambda args, **kw: Done(255, "ssh: connect timed out")
            deploy.record_direct_uploads(["roadworks/bots.txt"], at)
            check("ssh refused: said, no exception",
                  notes and notes[-1].lstrip().startswith("NOT NOTED"), str(notes[-1:]))

            def boom(args, **kw):
                raise subprocess.TimeoutExpired(args, 30)
            deploy.subprocess.run = boom
            deploy.record_direct_uploads(["roadworks/bots.txt"], at)
            check("ssh hangs: said, no exception",
                  notes[-1].lstrip().startswith("NOT NOTED"), str(notes[-1:]))
        finally:
            deploy.subprocess.run, deploy.note, deploy.ROOT = real_run, real_note, real_root
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n%d passed, %d failed" % (len(PASS), len(FAIL)))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
