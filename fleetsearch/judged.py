#!/usr/bin/env python3
"""What readers said about /find results pages, turned into work and a score.

Nan, 2026-10-20: "Motdang search results still 'bad' 90% of the time. Would
like to provide feedback directly after a bad search. … simple for users and
provide machines with the kind of data they need to do better."

The page's good / not-it line (judgePanel in publish/fleetsearch.js) posts to
/api/find/judge, one row per send in motdang-search `judged`
(publish/findlearn.js, fleetsearch/learn.sql). This script:

  pull     new rows → _incoming/find-judged/judged.jsonl (append; marks them seen)
  report   every bad send replayed against live /find now, with a lane per miss:
             corpus     the thing is not in the index (want finds nothing)
             ranking    the right page is in the index but not on top
             words      the words were misread (thesaurus, segmentation, intent)
             geo        too far for where the reader was
             fresh      closed or out of date
             kind       the wrong kind of thing came back
           → _incoming/find-judged/report.txt
  score    the cases a ranking change is held to: each ✓ in the top 3, no ✕
           in the top 3, and a page called good keeps its top 3 in the top 10.
           --base https://<preview>.workers.dev scores a version before it ships.

  python3 fleetsearch/judged.py            # pull + report + score
  python3 fleetsearch/judged.py score --base https://motdang.net
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLISH = ROOT / "publish"
OUT = ROOT / "_incoming" / "find-judged"
LOG = OUT / "judged.jsonl"
REPORT = OUT / "report.txt"
CASES = OUT / "cases.json"
DB = "motdang-search"
BASE = "https://motdang.net"
UA = "motdang-judged/1 (+https://motdang.net/find)"
TOP = 3

WHY_LANE = {"missing": "corpus", "kind": "kind", "far": "geo", "closed": "fresh",
            "buried": "ranking", "words": "words"}
WHY_TEXT = {"missing": "not here", "kind": "wrong kind", "far": "too far", "closed": "closed or old",
            "buried": "right one buried", "words": "misread my words"}
PASS = ("sort", "in", "site", "kind", "sec", "from", "to")


def d1(sql: str) -> list[dict]:
    out = subprocess.run(["npx", "wrangler", "d1", "execute", DB, "--remote", "--json", "--command", sql],
                         cwd=PUBLISH, capture_output=True, text=True, timeout=300)
    if out.returncode:
        raise RuntimeError(out.stderr[-600:])
    return json.loads(out.stdout)[0]["results"]


def clean(r: dict) -> dict | None:
    """One row in the shape the report reads, or None when it cannot be."""
    if not isinstance(r, dict) or not isinstance(r.get("id"), int) or not isinstance(r.get("q"), str):
        return None
    for k in ("yes", "no", "snap"):
        if isinstance(r.get(k), str):
            try:
                r[k] = json.loads(r[k]) if r[k] else None
            except ValueError:
                r[k] = None
    strs = lambda v: [x for x in v if isinstance(x, str)] if isinstance(v, list) else []
    r["yes"], r["no"] = strs(r.get("yes")), strs(r.get("no"))
    snap = r.get("snap") if isinstance(r.get("snap"), dict) else {}
    snap["rows"] = [x for x in snap.get("rows") or [] if isinstance(x, list) and len(x) == 2
                    and isinstance(x[0], int) and isinstance(x[1], str)] if isinstance(snap.get("rows"), list) else []
    for k in ("said", "has"):
        snap[k] = strs(snap.get(k))
    if not (isinstance(snap.get("near"), list) and len(snap["near"]) >= 2
            and all(isinstance(x, (int, float)) for x in snap["near"][:2])):
        snap.pop("near", None)
    r["snap"] = snap
    for k in ("why", "want", "who", "at", "verdict"):
        r[k] = r[k] if isinstance(r.get(k), str) else ""
    return r


def read_log() -> list[dict]:
    if not LOG.exists():
        return []
    out = []
    for x in LOG.read_text().splitlines():
        try:
            r = clean(json.loads(x))
        except ValueError:
            r = None
        if r:
            out.append(r)
    return out


def pull() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = read_log()
    last = max((r["id"] for r in rows), default=0)
    new = d1(f"SELECT * FROM judged WHERE id > {int(last)} ORDER BY id LIMIT 5000")
    with LOG.open("a") as f:
        for r in new:
            r = clean(r)
            if r:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    if new:
        d1(f"UPDATE judged SET seen = datetime('now') WHERE id <= {int(new[-1]['id'])} AND seen IS NULL")
    return len(new)


def find(base: str, q: str, snap: dict | None = None, n: int = 50) -> dict:
    p = {"q": q, "fmt": "json", "n": str(n)}
    for k in PASS:
        if snap and snap.get(k) and not (k == "sort" and snap[k] == "rank") and not (k == "in" and snap[k] == "all"):
            p[k] = str(snap[k])
    if snap and snap.get("has"):
        p["has"] = ",".join(snap["has"])
    if snap and snap.get("near"):
        p["near"] = f"{snap['near'][0]},{snap['near'][1]}"
    url = f"{base}/find?{urllib.parse.urlencode(p)}"
    req = urllib.request.Request(url, headers={"user-agent": UA, "cache-control": "no-cache"})
    for wait in (0, 5, 20):
        time.sleep(wait)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 — a page that will not answer is reported, not fatal
            err = str(e)
    return {"error": err, "results": [], "total": 0}


def rank_of(res: dict, u: str) -> int:
    for i, r in enumerate(res.get("results") or [], 1):
        if r.get("url") == u:
            return i
    return 0


def diagnose(row: dict, base: str) -> dict:
    snap = row.get("snap") or {}
    q = row["q"]
    now = find(base, q, snap)
    lanes: list[str] = [WHY_LANE[w] for w in (row.get("why") or "").split(",") if w in WHY_LANE]
    lines: list[str] = []
    if now.get("error"):
        lines.append(f"replay failed: {now['error'][:120]}")
    for u in row.get("yes") or []:
        r = rank_of(now, u)
        lines.append(f"✓ {u} — now {'#' + str(r) if r else 'not in top 50'}")
        if not r or r > TOP:
            lanes.append("ranking")
    for u in row.get("no") or []:
        r = rank_of(now, u)
        lines.append(f"✕ {u} — now {'#' + str(r) if r else 'gone from top 50'}")
        if r and r <= TOP:
            lanes.append("ranking")
    want = (row.get("want") or "").strip()
    if want:
        if want.startswith("http"):
            if "motdang.net" in want:
                r = rank_of(now, want)
                lines.append(f"wanted {want} — now {'#' + str(r) if r else 'not in top 50'}")
                lanes.append("ranking")
            else:
                lines.append(f"wanted (outside link, resolve to a place): {want}")
                lanes.append("corpus")
        else:
            w = find(base, want, None, 10)
            hits = (w.get("results") or [])[:3]
            if hits:
                lines.append(f"wanted “{want}” — the index holds:")
                lines += [f"    {h.get('title', '')[:80]} · {h.get('url')} — for this query "
                          f"{'#' + str(rank_of(now, h.get('url'))) if rank_of(now, h.get('url')) else 'not in top 50'}"
                          for h in hits]
                lanes.append("ranking")
            else:
                lines.append(f"wanted “{want}” — nothing in the index")
                lanes.append("corpus")
    if not snap.get("total") and not lanes:
        lanes.append("corpus")
    lanes = list(dict.fromkeys(lanes)) or ["unsaid"]
    return {"id": row["id"], "at": row["at"], "q": q, "lanes": lanes, "lines": lines,
            "then": snap.get("total"), "now": now.get("total"), "match": snap.get("match"),
            "note": snap.get("note"), "said": snap.get("said"), "who": row.get("who"),
            "why": [WHY_TEXT[w] for w in (row.get("why") or "").split(",") if w in WHY_TEXT],
            "top_then": [u for _, u in (snap.get("rows") or [])[:TOP]],
            "top_now": [r.get("url") for r in (now.get("results") or [])[:TOP]]}


def cases(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        if r.get("who") != "human":
            continue
        snap = r.get("snap") or {}
        c = {"id": r["id"], "q": r["q"], "snap": {k: snap.get(k) for k in PASS + ("has", "near") if snap.get(k)}}
        if r["verdict"] == "good":
            keep = [u for _, u in (snap.get("rows") or [])[:TOP]]
            if keep:
                out.append({**c, "keep": keep})
        elif r.get("yes") or r.get("no"):
            out.append({**c, "yes": r.get("yes") or [], "no": r.get("no") or []})
    return out


def score(base: str, cs: list[dict]) -> tuple[int, int, list[str]]:
    ok, fails = 0, []
    for c in cs:
        now = find(base, c["q"], c["snap"])
        bad = [f"✓ #{rank_of(now, u) or '-'} {u}" for u in c.get("yes", []) if not 0 < rank_of(now, u) <= TOP]
        bad += [f"✕ #{rank_of(now, u)} {u}" for u in c.get("no", []) if 0 < rank_of(now, u) <= TOP]
        bad += [f"kept? #{rank_of(now, u) or '-'} {u}" for u in c.get("keep", []) if not 0 < rank_of(now, u) <= 10]
        if bad:
            fails.append(f"#{c['id']} {c['q']}: " + " · ".join(bad))
        else:
            ok += 1
    return ok, len(cs), fails


def report(base: str) -> str:
    rows = read_log()
    bad = [r for r in rows if r["verdict"] == "bad"]
    good = [r for r in rows if r["verdict"] == "good"]
    ds = [diagnose(r, base) for r in reversed(bad)]
    cs = cases(rows)
    CASES.write_text(json.dumps(cs, ensure_ascii=False, indent=1))
    ok, n, fails = score(base, cs)
    lane_n: dict[str, int] = {}
    for d in ds:
        for l in d["lanes"]:
            lane_n[l] = lane_n.get(l, 0) + 1
    people = sum(1 for r in rows if r.get("who") == "human")
    head = [
        f"FIND — what readers said · {time.strftime('%Y-%m-%d %H:%M')} · replayed against {base}",
        f"sends {len(rows)} (people {people}) · not it {len(bad)} · good {len(good)}",
        "lanes: " + (" · ".join(f"{k} {v}" for k, v in sorted(lane_n.items(), key=lambda x: -x[1])) or "none yet"),
        f"cases held: {ok}/{n} pass (✓ in top {TOP}, ✕ out of top {TOP}, good pages keep their top {TOP})",
        "",
    ]
    body = []
    for d in ds:
        body.append(f"#{d['id']} {d['at']} · {d['q']} · {d['who']} · {' '.join(d['lanes'])}")
        if d["why"]:
            body.append(f"  said: {', '.join(d['why'])}")
        body.append(f"  then {d['then']} pages · now {d['now']} pages"
                    + (f" · step: {d['note']}" if d.get("note") else "")
                    + (f" · lifted: {', '.join(d['said'])}" if d.get("said") else ""))
        if d.get("match"):
            body.append(f"  match: {d['match'][:200]}")
        body += [f"  {x}" for x in d["lines"]]
        if d["top_then"] != d["top_now"]:
            body.append(f"  top {TOP} then: {' · '.join(d['top_then']) or '—'}")
            body.append(f"  top {TOP} now:  {' · '.join(d['top_now']) or '—'}")
        body.append("")
    if fails:
        body += ["CASES FAILING", *fails, ""]
    text = "\n".join(head + body)
    OUT.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(text)
    return text


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", nargs="?", default="all", choices=["all", "pull", "report", "score"])
    ap.add_argument("--base", default=BASE)
    a = ap.parse_args()
    if a.cmd in ("all", "pull"):
        print(f"pulled {pull()}")
    if a.cmd in ("all", "report"):
        print("\n".join(report(a.base).splitlines()[:4]))
    if a.cmd == "score":
        cs = json.loads(CASES.read_text()) if CASES.exists() else cases(read_log())
        ok, n, fails = score(a.base, cs)
        print(f"cases held: {ok}/{n}")
        print("\n".join(fails))
        sys.exit(0 if ok == n else 1)


if __name__ == "__main__":
    main()
