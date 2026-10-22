"""Put place pages whose record changed live as soon as build.py has drawn them.

A round is a build (25+ minutes with the place pages carried), the gates (15) and
a publish. A phone number corrected in the morning reaches the page after all of
that. When the round is an incremental one (incremental.py: same code, same
inputs, same date, a canary that matched) the pages it drew for changed records
are the pages the round will publish, drawn by the code that is already live.
They can go up in the minutes after the build has loaded and drawn them, and the
round's publish finds the bucket already holding them.

Off unless cache/early-places exists. Those pages are live before the gates have
run on this round's tree, so turning it on is Nan's word, not a default.

Each file is checked first (it parses, closes, names no local path), at most
MAX_FILES go this way (a change that touches more is not a small one), and a file
a direct upload has put in the bucket after the build's source was taken is left
alone (incpublish.young_keys). Nothing is deleted.
"""
import datetime
import json
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ROOT = HERE.parent
FLAG = Path(os.environ.get("MD_EARLY_FLAG") or (ROOT / "cache" / "early-places"))
MAX_FILES = 400
LEAK = re.compile(r"/Users/|/home/nan/|/srv/mot-dang")


def enabled():
    return FLAG.exists()


def problems(docs, rels):
    """[(rel, why)] for files that should not go up."""
    bad = []
    for rel in rels:
        p = Path(docs) / rel
        try:
            text = p.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            bad.append((rel, "unreadable: %s" % e))
            continue
        if LEAK.search(text):
            bad.append((rel, "carries a local path"))
        elif rel.endswith(".html"):
            if len(text) < 500 or "<title" not in text or "</html>" not in text[-400:].lower():
                bad.append((rel, "does not look like a whole page"))
        elif rel.endswith(".json"):
            try:
                json.loads(text)
            except ValueError:
                bad.append((rel, "does not parse"))
    return bad


def push(docs, rels, say=print, deploy=None):
    """Send `rels` (keys under docs) to the bucket. Returns a dict for the log:
    {"sent": n, "kept": [...], "refused": why or None, "seconds": s}."""
    t0 = time.time()
    rels = sorted(set(rels))
    out = {"sent": 0, "kept": [], "refused": None, "seconds": 0}
    if not rels:
        return out
    if len(rels) > MAX_FILES:
        out["refused"] = "%d files is more than an early push takes (%d); the round carries them" % (len(rels), MAX_FILES)
        say("  early: " + out["refused"])
        return out
    bad = problems(docs, rels)
    if bad:
        out["refused"] = "; ".join("%s %s" % b for b in bad[:3])
        say("  early: not sent — %s" % out["refused"])
        return out
    if deploy is None:
        import deploy
    import incpublish
    import safety
    env = deploy.rclone_env(deploy.creds())
    dest = "R2:%s" % deploy.BUCKET
    prev = incpublish.load() or {}
    cur = {k: [0, 0, incpublish._md5(Path(docs) / k)] for k in rels}
    since, _ = safety.source_time()
    young = incpublish.young_keys(dest, env, deploy.run, rels, since, prev, cur,
                                  os.environ.get("MD_DIRECT_UPLOADS"))
    send = [k for k in rels if k not in set(young)]
    out["kept"] = young
    if young:
        say("  early: %d live file(s) are newer than this build's source and stay: %s"
            % (len(young), ", ".join(young[:4])))
    incpublish.send(docs, dest, env, lambda a, e: deploy.run(a, e), send)
    out["sent"] = len(send)
    out["seconds"] = round(time.time() - t0, 1)
    say("  early: %d place page file(s) live in %.0f s" % (len(send), out["seconds"]))
    return out
