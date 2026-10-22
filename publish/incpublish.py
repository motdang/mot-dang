"""Publish what changed since the last publish, without listing the bucket.

deploy.py lists all ~270,000 objects twice (8 and 16 minutes on motdang-server,
2026-10-22) and then compares them with docs/ to find the few hundred files a
round changed. A publish that knows what the last one left live does not need
the bucket to tell it.

cache/published-manifest.json holds, for every file this publisher put live,
its size, its mtime and its md5 (a file that still has the size and mtime it had
is not read again; build.py's carried place pages keep both). A publish scans
docs/, compares, and sends the files whose md5 moved with `rclone copy
--files-from`; the keys that left docs/ go through the same deletion check as
before (publish/safety.py deletion_verdict).

The manifest says what this publisher did, not what the bucket holds. A direct
upload (deploy.py --files, tools/publish_now.py, tools/publish_script.py) can
put a newer copy in the bucket after the build's source was taken, and a file
this publish would overwrite is looked up there (young_keys) before it is sent.
That look is one request per file sent, not a listing, and it does not depend on
the ledger a direct upload writes over ssh.

A full publish (deploy.py without --incremental) lists and syncs as before and
writes the manifest when it ends; that round also sets it right after anything
that reached the bucket another way.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import safety  # noqa: E402

ROOT = HERE.parent
MANIFEST = Path(os.environ.get("MD_PUBLISHED_MANIFEST") or (ROOT / "cache" / "published-manifest.json"))
VERSION = 1
LOOKUP_MAX = 2000      # keys looked up one by one; more than this, one listing of what is recent


def _md5(path, chunk=1 << 20):
    import hashlib
    h = hashlib.md5()
    with open(path, "rb") as fh:
        while True:
            b = fh.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def load(path=None):
    """{key: [size, mtime_ns, md5]} of what the last publish left live, or None."""
    try:
        doc = json.loads(Path(path or MANIFEST).read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or doc.get("v") != VERSION:
        return None
    return doc.get("files")


def save(files, path=None):
    path = Path(path or MANIFEST)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"v": VERSION, "files": files}, separators=(",", ":")))
    tmp.replace(path)


def scan(docs, prev=None, skip=()):
    """{key: [size, mtime_ns, md5]} for every file under `docs`, reading only
    the files whose size or mtime differ from `prev`. `skip` is key prefixes a
    publish leaves alone (tiles/, the media folders)."""
    prev = prev or {}
    docs = str(docs)
    out = {}
    stack = [docs]
    while stack:
        d = stack.pop()
        try:
            it = os.scandir(d)
        except OSError:
            continue
        with it:
            for e in it:
                try:
                    if e.is_dir(follow_symlinks=False):
                        stack.append(e.path)
                        continue
                    if not e.is_file():
                        continue
                    st = e.stat()
                except OSError:
                    continue
                key = os.path.relpath(e.path, docs).replace(os.sep, "/")
                if skip and key.startswith(tuple(skip)):
                    continue
                was = prev.get(key)
                if was and was[0] == st.st_size and was[1] == st.st_mtime_ns:
                    out[key] = was
                else:
                    out[key] = [st.st_size, st.st_mtime_ns, _md5(e.path)]
    return out


def diff(prev, cur):
    """(keys to send, keys to delete, keys sent for the first time)."""
    changed = sorted(k for k, v in cur.items() if k not in prev or prev[k][2] != v[2])
    gone = sorted(k for k in prev if k not in cur)
    added = [k for k in changed if k not in prev]
    return changed, gone, added


def young_keys(dest, env, run, keys, since, prev, cur, ledger=None):
    """Keys among `keys` whose live copy somebody else put there after the
    build's source was taken: a direct upload the build cannot know.

    The bucket's own upload time is not enough. A round's source is taken while
    the round before is still building, and that round's publish finishes after
    it: every file it changed is "newer than the source" by time, and judged by
    time alone this round would keep them over its own newer copies. So a live
    copy whose md5 is what this publisher last put there (`prev`), or what it is
    about to put there (`cur`), is ours and is not young. What is left is a
    copy written by something else; objects the bucket gives no md5 for stay
    young, which keeps more, not less.
    """
    import datetime
    import re
    keys = set(keys)
    if not keys:
        return []
    cut = since - datetime.timedelta(seconds=safety.SOURCE_GRACE_S)
    if len(keys) <= LOOKUP_MAX:
        lst = _keys_file(sorted(keys))
        try:
            out = run(["rclone", "lsjson", "-R", "--files-only", "--no-mimetype", "--hash",
                       "--use-server-modtime", "--files-from", lst, dest], env, quiet=True)
        finally:
            os.unlink(lst)
    else:
        # A request per key is slow past a few thousand (the weekly place round sends
        # all of them): one listing of what was written since the cut instead.
        age = max(60, int((datetime.datetime.now(datetime.timezone.utc) - cut).total_seconds()))
        out = run(["rclone", "lsjson", "-R", "--files-only", "--no-mimetype", "--hash",
                   "--use-server-modtime", "--max-age", "%ds" % age, dest], env, quiet=True)
    young = set()
    for o in json.loads(out or "[]"):
        if o.get("Path") not in keys:
            continue
        m = re.sub(r"(\.\d{6})\d+", r"\1", str(o.get("ModTime", "")))
        m = m[:-1] + "+00:00" if m.endswith("Z") else m
        try:
            t = datetime.datetime.fromisoformat(m)
        except ValueError:
            young.add(o["Path"])
            continue
        if t.tzinfo is None:
            t = t.replace(tzinfo=datetime.timezone.utc)
        if t < cut:
            continue
        key, md5 = o["Path"], (o.get("Hashes") or {}).get("md5")
        if md5 and ((prev.get(key) or [0, 0, None])[2] == md5 or (cur.get(key) or [0, 0, None])[2] == md5):
            continue
        young.add(key)
    if ledger:
        young |= set(safety.direct_uploads_since(ledger, since)) & set(keys)
    return sorted(young)


def _keys_file(keys):
    fd, path = tempfile.mkstemp(suffix=".txt")
    with os.fdopen(fd, "w") as fh:
        fh.write("".join(k + "\n" for k in keys))
    return path


def send(docs, dest, env, run, keys, transfers="96"):
    """rclone copy of exactly `keys`; nothing else is read or written."""
    if not keys:
        return
    lst = _keys_file(keys)
    try:
        run(["rclone", "copy", str(docs), dest, "--files-from", lst, "--checksum",
             "--transfers", transfers, "--checkers", "32", "--s3-no-head",
             "--stats", "10s", "--stats-one-line", "--stats-log-level", "NOTICE"], env)
    finally:
        os.unlink(lst)


def delete(dest, env, run, keys):
    """rclone delete of exactly `keys`."""
    if not keys:
        return
    lst = _keys_file(keys)
    try:
        run(["rclone", "delete", dest, "--files-from", lst, "--s3-no-head"], env)
    finally:
        os.unlink(lst)


def next_manifest(prev, cur, kept=(), deferred=()):
    """What is live after a publish that left `kept` keys alone (a newer copy
    live, a page waiting for the weekly round) and did not delete `deferred`.
    A kept key keeps its old entry, or none: the next scan sees it as changed
    and asks again."""
    out = {}
    skip = set(kept)
    for k, v in cur.items():
        if k in skip:
            if k in prev:
                out[k] = prev[k]
            continue
        out[k] = v
    for k in deferred:
        if k in prev:
            out[k] = prev[k]
    return out
