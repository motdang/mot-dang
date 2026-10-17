#!/usr/bin/env python3
"""One minisite live in minutes, without waiting for the full build.

    python3 tools/publish_now.py bum-gun            # assets/sites/bum-gun/ → motdang.net/sites/bum-gun/
    python3 tools/publish_now.py sites/bum-gun      # the same
    python3 tools/publish_now.py muay-thai          # assets/muay-thai/ → motdang.net/muay-thai/
    python3 tools/publish_now.py bum-gun --dry      # checks only, uploads nothing

The full round (build ~60 min, gates, a 270,000-file sync) carries every site,
and one failing page anywhere held them all back. This publishes one folder:
copy it, stamp it the way build.py does, run the publish gate's checks on that
folder alone, upload new and changed files (rclone copy, nothing deleted), then
fetch the live page.

The next full round carries the same folder from assets/, and its sync leaves
alone files uploaded after its hand-off began, so the two do not undo each other.
Commit the folder so that round has it.

Ledger: ~/.claude/state/publish-now.tsv
"""
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "publish"))
sys.path.insert(0, str(ROOT / "tests"))
LEDGER = pathlib.Path.home() / ".claude" / "state" / "publish-now.tsv"
SITE = "https://motdang.net"
REF = re.compile(r'(?:href|src)="([^"#?]+)')
LEAK = re.compile(r"/Users/|/home/nan/|/srv/mot-dang")


def resolve(arg):
    """(source folder, path under docs/) for a name or sites/<slug>."""
    name = arg.strip("/")
    slug = name[len("sites/"):] if name.startswith("sites/") else name
    if (ROOT / "assets" / "sites" / slug).is_dir():
        return ROOT / "assets" / "sites" / slug, "sites/" + slug
    top = ROOT / "assets" / name
    build = (ROOT / "build.py").read_text(encoding="utf-8")
    if top.is_dir() and re.search(r'ROOT / "assets" / "%s"' % re.escape(name), build):
        return top, name
    sys.exit("no folder for %r: looked in assets/sites/%s/ and assets/%s/ "
             "(one build.py installs)" % (arg, slug, name))


def stamp(tmp, rel):
    """What build.py does to an installed site after copying it."""
    import feedback_layer
    import mappins_layer
    if rel.startswith("sites/"):
        # the slot loads /feedback.js; a page pointing at a file the live site
        # lacks waits for the full round to stamp it
        if live_ok(SITE + "/feedback.js", missing_is_ok=False):
            feedback_layer.stamp_sites(tmp)
        if rel == "sites/doodle-map":
            mappins_layer.stamp_doodle(tmp)


def finish(tmp, rel):
    """What the full round adds last, after the checks: the net block (its links are the
    full round's, checked there) and the Send button that share.inject puts on pages
    without md.js."""
    carry_net(tmp, rel)
    import share_layer
    share_layer.inject(tmp)


def carry_net(tmp, rel):
    """The Mot Dang net block (sitenet_layer) is written by the full round from the
    whole docs/ tree, which the Mac does not hold; a page live with the block keeps
    the live block. A page not yet live gets it from the next round. (2026-10-17:
    republishing sites/long-stay had dropped it.)"""
    import sitenet_layer
    for f in sorted((tmp / rel).rglob("*.html"))[:50]:
        text = f.read_text(encoding="utf-8")
        if sitenet_layer.MARK.search(text):
            continue
        path = f.relative_to(tmp).as_posix()
        url = "%s/%s" % (SITE, path[:-len("index.html")] if path.endswith("index.html") else path)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 publish_now"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                live = r.read().decode("utf-8", "replace")
        except Exception:
            continue
        m = sitenet_layer.MARK.search(live)
        if m:
            sitenet_layer._put(f, m.group(0))
            print("  net   %s keeps the live net block" % path)


def live_ok(url, missing_is_ok=True):
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "publish_now"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status < 400
    except urllib.error.HTTPError as e:
        return e.code < 400
    except Exception:
        return missing_is_ok    # the network, not the page


def check(tmp, rel):
    """(refusals, notes). Refusals are the publish gate's own: a path leak, a
    link to a URL check_links.py found dead, no card in the register."""
    site = tmp / rel
    refuse, notes = [], []
    if not (site / "index.html").is_file():
        refuse.append("%s/index.html is missing" % rel)
    links = json.loads((ROOT / "data" / "linkhealth.json").read_text())["links"]
    from test_publish_gate import ALIVE  # noqa: E402
    dead = {u.rstrip("/") for u, v in links.items() if v.get("status") not in ALIVE}
    outside = set()
    for p in site.rglob("*"):
        if p.suffix not in (".html", ".js", ".css", ".json") or not p.is_file():
            continue
        text = p.read_text(errors="ignore")
        name = p.relative_to(tmp).as_posix()
        if LEAK.search(text):
            refuse.append("%s carries a local path (%s)" % (name, LEAK.search(text).group(0)))
        if p.suffix != ".html":
            continue
        for href in REF.findall(text):
            if href.rstrip("/") in dead:
                refuse.append("%s links a dead URL: %s" % (name, href))
            if href.startswith(("http:", "https:", "mailto:", "tel:", "data:", "javascript:", "//")):
                continue
            target = (tmp / href.lstrip("/")) if href.startswith("/") else (p.parent / href)
            target = pathlib.Path(str(target.resolve()))
            if target.is_dir():
                target = target / "index.html"
            if target.exists():
                continue
            try:
                outside.add("/" + target.relative_to(tmp.resolve()).as_posix())
            except ValueError:
                notes.append("%s: %s points outside the site root" % (name, href))
    for path in sorted(outside)[:200]:
        if path.startswith("/" + rel + "/"):
            notes.append("missing in the folder: %s" % path)
        elif not live_ok(SITE + path):
            notes.append("not on motdang.net: %s" % path)
    if rel.startswith("sites/"):
        import sites_layer
        reg = sites_layer.load(ROOT / "docs")
        known = {c["href"] for c in reg["cards"]} | set(reg.get("not_sites", []))
        if rel + "/" not in known:
            refuse.append("%s/ has no card: add assets/%s/card.json, or a card in "
                          "data/curated/sites.json" % (rel, rel))
    return refuse, notes


def upload(tmp, rel):
    import deploy
    env = deploy.rclone_env(deploy.creds())
    dest = "r2:%s/%s" % (deploy.BUCKET, rel)
    p = subprocess.run(["rclone", "copy", str(tmp / rel), dest, "--checksum",
                        "--transfers", "16", "--stats-one-line", "--stats", "0", "-v"],
                       env=env, text=True, capture_output=True)
    sent = len(re.findall(r": Copied \(", p.stderr))
    if p.returncode:
        sys.stderr.write(p.stderr[-2000:])
    return p.returncode, sent


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry" in sys.argv
    if len(args) != 1:
        sys.exit(__doc__)
    t0 = time.time()
    src, rel = resolve(args[0])
    with tempfile.TemporaryDirectory(prefix="publish-now-") as d:
        tmp = pathlib.Path(d)
        shutil.copytree(src, tmp / rel, ignore=shutil.ignore_patterns(".DS_Store", "__pycache__"))
        stamp(tmp, rel)
        refuse, notes = check(tmp, rel)
        for n in notes:
            print("  note  " + n)
        if refuse:
            print("\nNOT PUBLISHED — fix these, then run it again:")
            for r in refuse:
                print("  " + r)
            return 1
        finish(tmp, rel)
        files = sum(1 for p in (tmp / rel).rglob("*") if p.is_file())
        if dry:
            print("checks pass: %s/ (%d files) would go to %s/%s/" % (rel, files, SITE, rel))
            return 0
        rc, sent = upload(tmp, rel)
    if rc:
        print("upload FAILED (rclone exit %d) — the live site is unchanged" % rc)
        return 1
    url = "%s/%s/" % (SITE, rel)
    up = live_ok(url)
    secs = round(time.time() - t0)
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    new = not LEDGER.exists()
    with LEDGER.open("a") as f:
        if new:
            f.write("at\tpath\tfiles\tsent\tseconds\tlive\n")
        f.write("%s\t%s\t%d\t%d\t%d\t%s\n" % (time.strftime("%Y-%m-%dT%H:%M:%S"), rel,
                                              files, sent, secs, "ok" if up else "not answering"))
    print("LIVE %s — %d file(s) sent of %d, %ds%s" % (url, sent, files, secs,
          "" if up else "; the page did not answer yet"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
