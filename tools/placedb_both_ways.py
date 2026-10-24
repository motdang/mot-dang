#!/usr/bin/env python3.13
"""Ticket 82's check: place pages drawn from the JSON files and from
data/places.sqlite, compared byte for byte.

Each way is a whole build into a scratch folder (no lock, no swap, docs/ left
alone) that draws only the sampled place pages: MD_PLACES=json for the first,
the database file for the second. cache/ and data/ are put back as they were
between the two, so the second build starts where the first did.

    python3 tools/placedb_both_ways.py                 # 200 places
    python3 tools/placedb_both_ways.py --n 500 --keep  # keep the two folders

A test build runs on motdang-build (Nan, 2026-10-24), in a copy of the tree,
under /srv/state/docs.lock so the walk's build waits. Needs 8 GB free for the
builds (the first is cut to its place pages before the second starts), and on
Linux the size of cache/ and data/ as well, since they are copied, not cloned.
On 2026-10-24 a sample build there wrote more than 16 GB, 13 GB of it street
photos; MD_MEDIA_BUCKET=1 (below) lists the pictures instead of copying them.
"""
import argparse
import filecmp
import json
import os
import random
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
SCRATCH_ROOM = 8 * 1024 ** 3     # a sample build: 1.3 GB on the Mac; on motdang-build 3 GB and more besides its pictures


def draw(way, out, ids_file):
    """In a child: the build, drawing only the places named in ids_file."""
    os.environ["MD_JOBS"] = "1"
    # pictures listed, not copied, as the server's builds do (media_layer.py):
    # copied, the street photos took 13 GB of a scratch build (2026-10-24)
    os.environ.setdefault("MD_MEDIA_BUCKET", "1")
    if way == "json":
        os.environ["MD_PLACES"] = "json"
    else:
        os.environ.pop("MD_PLACES", None)
    os.chdir(ROOT)
    sys.path.insert(0, str(ROOT))
    import build
    want = set(json.loads(Path(ids_file).read_text()))
    whole = build._place_chunk

    def only_sample(chunk):
        recs = build._PP["records"]
        return whole([i for i in chunk if recs[i]["id"] in want])

    build._place_chunk = only_sample

    def room():
        # build.check_room asks for a whole docs/ tree plus 5 GB; this build
        # draws 200 place pages, not 92,000
        free = shutil.disk_usage(out.parent).free
        if free < SCRATCH_ROOM:
            raise SystemExit(f"{free / 1024 ** 3:.1f} GB free: not enough for a sample build")

    build.check_room = room
    out = Path(out)
    build.DOCS = out
    build.build()
    print("PLACES_FROM", json.dumps(build.PLACES_FROM))


def copy(src, dst):
    """src copied to dst: a clone on macOS (cp -c), a plain copy that keeps
    times and links on Linux (motdang-build, ext4: --reflink=auto copies)."""
    flags = ["-c", "-R"] if sys.platform == "darwin" else ["-a", "--reflink=auto"]
    subprocess.run(["cp", *flags, str(src), str(dst)], check=True)


def clone(src, dst):
    if dst.exists():
        shutil.rmtree(dst)
    copy(src, dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seed", default="ticket-82")
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--draw", nargs=3, metavar=("WAY", "OUT", "IDS"), help=argparse.SUPPRESS)
    a = ap.parse_args()
    if a.draw:
        return draw(*a.draw)

    import placedb
    con = placedb.reader()
    if con is None:
        sys.exit("no data/places.sqlite: run importers/import_all.py first")
    rows = sorted(con.execute("SELECT id, province FROM place"))
    con.close()
    # a sampled place with no page of its own (a merged duplicate, a record the
    # build leaves out) draws nothing either way; pages are counted at the end.
    # One place of each province first: 200 drawn at random from 92,064 held
    # none of lpn's one (2026-10-24).
    rng = random.Random(a.seed)
    by_prov = {}
    for i, prov in rows:
        by_prov.setdefault(prov, []).append(i)
    sample = [rng.choice(by_prov[k]) for k in sorted(by_prov)][:a.n]
    rest = sorted(set(i for i, _ in rows) - set(sample))
    sample += rng.sample(rest, a.n - len(sample))
    work = ROOT / "cache" / "placedb-both-ways"
    work.mkdir(parents=True, exist_ok=True)
    need = SCRATCH_ROOM
    if sys.platform != "darwin":
        need += sum(f.stat().st_size for d in ("cache", "data") for f in (ROOT / d).rglob("*")
                    if f.is_file() and not f.is_symlink() and work not in f.parents)
    free = shutil.disk_usage(work).free
    if free < need:
        sys.exit(f"{free / 1024 ** 3:.1f} GB free, {need / 1024 ** 3:.1f} GB needed")
    ids_file = work / "sample.json"
    ids_file.write_text(json.dumps(sample, ensure_ascii=False))
    data_before = work / "data.before"
    clone(ROOT / "data", data_before)
    keep_cache = work / "cache.before"
    if keep_cache.exists():
        shutil.rmtree(keep_cache)
    keep_cache.mkdir()
    for p in (ROOT / "cache").iterdir():
        if p.name != work.name:
            copy(p, keep_cache / p.name)

    def put_back():
        """cache/ and data/ as they were before the first way."""
        for p in (ROOT / "cache").iterdir():
            if p.name != work.name:
                shutil.rmtree(p) if p.is_dir() and not p.is_symlink() else p.unlink()
        for p in keep_cache.iterdir():
            copy(p, ROOT / "cache" / p.name)
        shutil.rmtree(ROOT / "data")
        copy(data_before, ROOT / "data")

    outs = {}
    for way in ("json", "database"):
        out = work / way
        if out.exists():
            shutil.rmtree(out)
        t = time.time()
        log = work / f"{way}.log"
        try:
            with open(log, "w") as fh:
                rc = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--draw", way, str(out),
                                     str(ids_file)], stdout=fh, stderr=subprocess.STDOUT).returncode
            print(f"{way}: build {'ok' if rc == 0 else 'FAILED, see ' + str(log)} in {time.time() - t:.0f} s")
            if rc:
                sys.exit(1)
            outs[way] = out
            if way == "json":       # room for the second: keep only what is compared
                for q in list(out.iterdir()):
                    if not (q.is_dir() and (q / "p").is_dir()):
                        shutil.rmtree(q) if q.is_dir() else q.unlink()
                        continue
                    for sub in list(q.iterdir()):
                        if sub.name != "p":
                            shutil.rmtree(sub) if sub.is_dir() else sub.unlink()
        finally:
            put_back()          # for the next way, and after a failed build

    froms = {}
    for way in outs:
        for line in (work / f"{way}.log").read_text().splitlines():
            if line.startswith("PLACES_FROM "):
                froms[way] = json.loads(line[len("PLACES_FROM "):])
    print("read from:", json.dumps(froms, ensure_ascii=False))

    a_root, b_root = outs["json"], outs["database"]
    pages = sorted(p.relative_to(a_root).as_posix() for p in a_root.glob("*/p/*")
                   if p.suffix in (".html", ".json"))
    other = sorted(p.relative_to(b_root).as_posix() for p in b_root.glob("*/p/*")
                   if p.suffix in (".html", ".json"))
    same = [r for r in pages if (b_root / r).exists() and filecmp.cmp(a_root / r, b_root / r, shallow=False)]
    differ = [r for r in pages if (b_root / r).exists() and r not in set(same)]
    only = sorted(set(pages) ^ set(other))
    html = [r for r in pages if r.endswith(".html")]
    # a province compared here that the second way read from the JSON proves nothing
    provs = sorted({r.split("/", 1)[0] for r in pages} & set(froms.get("database", {})))
    not_db = [k for k in provs if froms.get("database", {}).get(k) != "database"]
    report = {
        "sampled places": len(sample),
        "place pages drawn (html)": len(html),
        "place files compared (html + json)": len(pages),
        "identical": len(same),
        "different": differ[:50],
        "drawn one way only": only[:50],
        "provinces compared": provs,
        "compared but not read from the database": not_db,
        "read from": froms,
    }
    (work / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1))
    rows = [r for r in html if r in set(same)]
    (work / "pages.txt").write_text("".join(f"https://motdang.net/{r}\n" for r in rows))
    print(json.dumps(report, ensure_ascii=False, indent=1))
    if not a.keep:
        for p in outs.values():
            shutil.rmtree(p, ignore_errors=True)
    shutil.rmtree(data_before, ignore_errors=True)
    shutil.rmtree(keep_cache, ignore_errors=True)
    sys.exit(1 if differ or only or not_db or "database" not in froms else 0)


if __name__ == "__main__":
    main()
