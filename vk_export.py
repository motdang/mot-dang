#!/usr/bin/env python3
"""Voight-Kampff data: the request log, one Chiang Mai day a file, for anyone to download.

Her ask 2026-11-26: "give downloadable data that's surprisingly granular (I'm open about
traffic and most things I do)". Her pick the same day: people as counts only.

    python3 vk_export.py                              # every day missing from the index, yesterday included
    python3 vk_export.py --from 2026-09-08 --to 2026-11-25
    python3 vk_export.py --index                      # rebuild index.json from the bucket
    python3 vk_export.py --day 2026-11-25 --no-upload # files stay in data/voight-kampff/export/

Reads traffic_eye (Analytics Engine, 90 days) with the fleet token, the same rows vk_report.py
counts. Writes, per day (Chiang Mai, UTC+7):

  bots/<day>.parquet      every row the classifier does not call a browser: one request (or one
  bots/<day>.csv.gz       event) a row, to the second, with network, Cloudflare city, TLS
                          fingerprints and round-trip time
  people/<day>.csv.gz     rows it calls a browser, as counts: hour, site, page, country
  index.json              every day, its files, sizes, rows, sha256
  README.txt, fields.json, LICENSE.txt

to the R2 bucket motdang-vk-data, served at https://motdang.net/voight-kampff/data/ by
vk-data/ (its own Worker: the site deploy mirrors voight-kampff/ and would delete these).
"""
from __future__ import annotations

import concurrent.futures as cf
import csv
import datetime as dt
import gzip
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from traffic import sql  # noqa: E402

ICT = dt.timezone(dt.timedelta(hours=7))
OUT = ROOT / "data" / "voight-kampff" / "export"
BUCKET = "motdang-vk-data"
PREFIX = "voight-kampff/data"
BASE = "https://motdang.net/voight-kampff/data"
FIRST = dt.date(2026, 9, 8)
LIMIT = 400000

# ── fields ────────────────────────────────────────────────────────────────────
# (name, type, what it is). The order is the file's column order.
BOT_FIELDS = [
    ("time", "TIMESTAMP", "when the Worker saw the request, UTC, to the second"),
    ("site", "VARCHAR", "host asked for: motdang.net, hongdam.net, www., side ports (motdang.net:8443)"),
    ("kind", "VARCHAR", "the classifier's call (publish/classify.js): ai, search, seo, social, monitor, tool, other (unnamed or a data-centre network), none (no user-agent), ours"),
    ("caller", "VARCHAR", "the name the classifier gives it: GPTBot, meta-externalagent, Go-http-client, or the browser it claims to be"),
    ("path", "VARCHAR", "page or file asked for, no query string, cut at 96 characters"),
    ("country", "VARCHAR", "Cloudflare's country for the caller's address (XX = none, T1 = Tor)"),
    ("status", "INTEGER", "HTTP status the site answered with"),
    ("referrer", "VARCHAR", "host of the Referer header; (same site) when it was motdang.net itself"),
    ("method", "VARCHAR", "GET, HEAD, POST… or SHARE / FIND on the event rows below"),
    ("row", "VARCHAR", "request (an arrival), or an event the site wrote beside one: share, find, crawlpay, map, event"),
    ("f9", "VARCHAR", "request rows: 'search' on /api/v1/search · crawlpay rows: 'crawlpay' · share/find rows: the event"),
    ("f10", "VARCHAR", "search: the map cell searched (lat,lng to 2 places) · crawlpay: which arm · share codes left out"),
    ("f11", "VARCHAR", "search: the words, when they found nothing · crawlpay: the price it offered · share: channel"),
    ("f12", "VARCHAR", "crawlpay: its signature agent · share: page · find: what was judged"),
    ("f13", "VARCHAR", "event rows only"),
    ("f14", "VARCHAR", "event rows only"),
    ("asn", "INTEGER", "the network's number (autonomous system), from 26 Nov 2026"),
    ("network", "VARCHAR", "who owns that network, as registered, from 26 Nov 2026"),
    ("colo", "VARCHAR", "the Cloudflare data centre that answered, by airport code, from 26 Nov 2026"),
    ("connection", "VARCHAR", "HTTP version, TLS version and cipher, from 26 Nov 2026"),
    ("ciphers_sha1", "VARCHAR", "SHA-1 of the cipher list the caller offered: a fingerprint of its software, from 26 Nov 2026"),
    ("extensions_sha1", "VARCHAR", "SHA-1 of the TLS extensions it sent, in order; Chrome shuffles these on every connection, from 26 Nov 2026"),
    ("worker_ms", "DOUBLE", "time the site's Worker took, ms (request rows)"),
    ("d4", "DOUBLE", "search: map box width in degrees · find: rank · varies by row"),
    ("d5", "DOUBLE", "search: results · varies by row"),
    ("rtt_ms", "DOUBLE", "TCP round trip between the caller and that data centre, ms; empty when unknown and on HTTP/3, from 26 Nov 2026"),
    ("hello_bytes", "DOUBLE", "length of the caller's TLS hello, bytes; empty when unknown, from 26 Nov 2026"),
    ("counted", "INTEGER", "1 on an arrival, 0 on an event row; SUM(weight * counted) = requests"),
    ("weight", "INTEGER", "how many requests this row stands for: Analytics Engine stores one row in N when busy"),
]
PEOPLE_FIELDS = [
    ("hour", "TIMESTAMP", "start of the hour, UTC"),
    ("site", "VARCHAR", "host asked for"),
    ("path", "VARCHAR", "page or file asked for, no query string"),
    ("country", "VARCHAR", "Cloudflare's country for the reader's address"),
    ("requests", "INTEGER", "requests from browsers the classifier counts as people, weighted"),
]

COLS = ("timestamp, _sample_interval, blob1, blob2, blob3, blob4, blob5, blob6, blob7, blob8, blob9, blob10, "
        "blob11, blob12, blob13, blob14, blob15, blob16, blob17, blob18, blob19, blob20, "
        "double1, double3, double4, double5, double6, double7")


def utc_bounds(day: dt.date) -> tuple[dt.datetime, dt.datetime]:
    a = dt.datetime(day.year, day.month, day.day) - dt.timedelta(hours=7)
    return a, a + dt.timedelta(days=1)


def ts(x: dt.datetime) -> str:
    return x.strftime("%Y-%m-%d %H:%M:%S")


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")


def fetch(a: dt.datetime, b: dt.datetime, where: str) -> list[dict]:
    """Rows in [a, b). An answer that fills LIMIT is cut in half and asked again."""
    rows = sql(f"SELECT {COLS} FROM traffic_eye WHERE timestamp >= toDateTime('{ts(a)}') "
               f"AND timestamp < toDateTime('{ts(b)}') AND {where} LIMIT {LIMIT}")
    if len(rows) >= LIMIT and (b - a).total_seconds() > 60:
        m = a + (b - a) / 2
        m = m.replace(microsecond=0)
        return fetch(a, m, where) + fetch(m, b, where)
    return rows


def row_kind(r: dict) -> str:
    if float(r["double1"] or 0) >= 1:
        return "request"
    m, f9 = r["blob8"], r["blob9"]
    if m == "SHARE":
        return "share"
    if m == "FIND":
        return "find"
    if f9 == "crawlpay":
        return "crawlpay"
    if r["blob4"] == "/api/map":
        return "map"
    return "event"


def num(x) -> str:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return ""
    return str(int(v)) if v == int(v) else repr(round(v, 3))


def bot_row(r: dict) -> list[str]:
    kind = row_kind(r)
    f = [r[f"blob{i}"] for i in range(9, 15)]
    if kind == "share":  # a share code is the sharer's; the event, channel and page stay
        f[1] = ""
        f[4] = f[5] = ""
    wired = bool(r["blob17"] or r["blob15"])
    rtt = float(r["double6"] or 0) if wired else -1
    if r["blob18"].startswith("HTTP/3") and rtt == 0:  # QUIC: Cloudflare gives no TCP round trip, the row reads 0
        rtt = -1
    hello = float(r["double7"] or 0) if wired else -1
    t = r["timestamp"].replace(" ", "T") + "Z"
    return [t, r["blob1"], r["blob2"], r["blob3"], r["blob4"], r["blob5"], r["blob6"], r["blob7"], r["blob8"],
            kind, *f, r["blob15"], r["blob16"], r["blob17"], r["blob18"], r["blob19"], r["blob20"],
            num(r["double3"]), num(r["double4"]), num(r["double5"]),
            num(rtt) if rtt >= 0 else "", num(hello) if hello > 0 else "",
            num(r["double1"]), num(r["_sample_interval"])]


def people(a: dt.datetime, b: dt.datetime) -> list[list[str]]:
    rows = sql(
        "SELECT toStartOfHour(timestamp) h, blob1 s, blob4 p, blob5 c, SUM(_sample_interval * double1) n "
        f"FROM traffic_eye WHERE timestamp >= toDateTime('{ts(a)}') AND timestamp < toDateTime('{ts(b)}') "
        "AND blob2 = 'human' AND double1 >= 1 GROUP BY h, s, p, c ORDER BY h, s, p, c LIMIT 1000000")
    return [[r["h"].replace(" ", "T") + "Z", r["s"], r["p"], r["c"], num(r["n"])] for r in rows if float(r["n"]) > 0]


def duck_types(fields) -> str:
    return "{" + ", ".join(f"'{n}': '{t}'" for n, t, _ in fields) + "}"


def export_day(day: dt.date) -> dict:
    a, b = utc_bounds(day)
    hours = [(a + dt.timedelta(hours=h), a + dt.timedelta(hours=h + 1)) for h in range(24)]
    with cf.ThreadPoolExecutor(6) as ex:
        parts = list(ex.map(lambda w: fetch(w[0], w[1], "blob2 != 'human'"), hours))
    rows = [bot_row(r) for part in parts for r in part]
    rows.sort(key=lambda x: (x[0], x[1], x[3], x[4]))
    ppl = people(a, b)

    d = day.isoformat()
    (OUT / "bots").mkdir(parents=True, exist_ok=True)
    (OUT / "people").mkdir(parents=True, exist_ok=True)
    gz = OUT / "bots" / f"{d}.csv.gz"
    with gzip.open(gz, "wt", newline="", encoding="utf-8", compresslevel=9) as f:
        w = csv.writer(f)
        w.writerow([n for n, _, _ in BOT_FIELDS])
        w.writerows(rows)
    pq = OUT / "bots" / f"{d}.parquet"
    import duckdb
    con = duckdb.connect()
    con.execute(f"COPY (SELECT * FROM read_csv('{esc(str(gz))}', header=true, columns={duck_types(BOT_FIELDS)}, "
                f"nullstr='', quote='\"', escape='\"', strict_mode=false)) "
                f"TO '{esc(str(pq))}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 50000)")
    pg = OUT / "people" / f"{d}.csv.gz"
    with gzip.open(pg, "wt", newline="", encoding="utf-8", compresslevel=9) as f:
        w = csv.writer(f)
        w.writerow([n for n, _, _ in PEOPLE_FIELDS])
        w.writerows(ppl)
    check = con.execute(f"SELECT COUNT(*), SUM(weight * counted) FROM '{esc(str(pq))}'").fetchone()
    assert check[0] == len(rows), (check, len(rows))
    reqs = sum(int(x[-1]) * int(x[-2] or 0) for x in rows)
    return {"day": d, "rows": len(rows), "requests": reqs, "people_rows": len(ppl),
            "people_requests": sum(int(x[-1]) for x in ppl),
            "files": {k: {"path": f"{sub}/{d}.{ext}", "bytes": p.stat().st_size, "sha256": sha(p)}
                      for k, sub, ext, p in (("parquet", "bots", "parquet", pq), ("csv", "bots", "csv.gz", gz),
                                             ("people", "people", "csv.gz", pg))}}


def sha(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ── R2 ────────────────────────────────────────────────────────────────────────

def rclone_env() -> dict:
    c = json.loads((Path.home() / ".mot-dang-r2.json").read_text())
    return {**os.environ, "RCLONE_CONFIG_R2_TYPE": "s3", "RCLONE_CONFIG_R2_PROVIDER": "Cloudflare",
            "RCLONE_CONFIG_R2_ACCESS_KEY_ID": c["accessKeyId"], "RCLONE_CONFIG_R2_SECRET_ACCESS_KEY": c["secretAccessKey"],
            "RCLONE_CONFIG_R2_ENDPOINT": f"https://{c['accountId']}.r2.cloudflarestorage.com",
            "RCLONE_CONFIG_R2_NO_CHECK_BUCKET": "true"}


def put(local: Path, rel: str) -> None:
    subprocess.run(["rclone", "copyto", str(local), f"R2:{BUCKET}/{PREFIX}/{rel}", "--s3-no-head", "-q"],
                   env=rclone_env(), check=True)


def get_json(rel: str):
    r = subprocess.run(["rclone", "cat", f"R2:{BUCKET}/{PREFIX}/{rel}", "-q"], env=rclone_env(), capture_output=True)
    return json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else None


# ── index and the files beside it ─────────────────────────────────────────────

def readme(index: dict) -> str:
    days = index["days"]
    span = f"{days[0]['day']} to {days[-1]['day']}" if days else "none yet"
    rows = sum(x["rows"] for x in days)
    lines = [
        "Voight-Kampff data: every bot request to motdang.net and hongdam.net",
        "",
        f"Days: {span} ({len(days)} days, {rows:,} rows). One Chiang Mai day (UTC+7) a file. A new day lands each night.",
        "",
        "Where: " + BASE + "/",
        "  index.json              every day, its files, sizes, rows, sha256",
        "  bots/<day>.parquet      one row per request, to the second (zstd Parquet)",
        "  bots/<day>.csv.gz       the same rows as gzipped CSV",
        "  people/<day>.csv.gz     browsers the classifier counts as people, as counts per hour, site, page and country",
        "  fields.json             the fields below, as JSON",
        "",
        "Who is in bots/: every row the site's classifier (publish/classify.js in github.com/motdang/mot-dang) does not call a browser,",
        "plus browsers on data-centre networks, which it calls 'other'. People appear only as counts, in people/.",
        "",
        "The log is Cloudflare Workers Analytics Engine, written by the site's own Worker on every request. It stores 90 days;",
        "these files carry them past that. When the site is busy, Analytics Engine stores one row in N and says so in `weight`:",
        "requests = SUM(weight * counted).",
        "",
        "Network, data centre, TLS fingerprints and round-trip time start on 26 Nov 2026; earlier rows leave them empty.",
        "No addresses are logged.",
        "",
        "Fields, bots/:",
        *[f"  {n:<16} {t:<9} {w}" for n, t, w in BOT_FIELDS],
        "",
        "Fields, people/:",
        *[f"  {n:<16} {t:<9} {w}" for n, t, w in PEOPLE_FIELDS],
        "",
        "Try it in DuckDB:",
        f"  SELECT caller, SUM(weight*counted) n FROM '{BASE}/bots/{days[-1]['day'] if days else '2026-11-25'}.parquet'",
        "  GROUP BY caller ORDER BY n DESC LIMIT 20;",
        "Or in the page itself: https://motdang.net/voight-kampff/#ask",
        "",
        "Licence: CC BY 4.0. Credit: motdang.net Voight-Kampff, https://motdang.net/voight-kampff/",
        "",
    ]
    return "\n".join(lines)


LICENSE = """Voight-Kampff data, motdang.net. Licensed under Creative Commons Attribution 4.0 International (CC BY 4.0).
https://creativecommons.org/licenses/by/4.0/
Credit: motdang.net Voight-Kampff, https://motdang.net/voight-kampff/
"""


def write_index(new: list[dict]) -> dict:
    old = get_json("index.json") or {"days": []}
    by = {x["day"]: x for x in old["days"]}
    for x in new:
        by[x["day"]] = x
    days = sorted(by.values(), key=lambda x: x["day"])
    index = {"title": "Voight-Kampff data, motdang.net", "licence": "CC BY 4.0",
             "credit": "motdang.net Voight-Kampff, https://motdang.net/voight-kampff/",
             "base": BASE + "/", "updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
             "fields": {"bots": [{"name": n, "type": t, "what": w} for n, t, w in BOT_FIELDS],
                        "people": [{"name": n, "type": t, "what": w} for n, t, w in PEOPLE_FIELDS]},
             "days": days}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1))
    (OUT / "fields.json").write_text(json.dumps(index["fields"], ensure_ascii=False, indent=1))
    (OUT / "README.txt").write_text(readme(index))
    (OUT / "LICENSE.txt").write_text(LICENSE)
    for f in ("index.json", "fields.json", "README.txt", "LICENSE.txt"):
        put(OUT / f, f)
    return index


# ── monthly release on GitHub ─────────────────────────────────────────────────

REPO = "NaNoBotCo/voight-kampff-data"


def release(month: str) -> bool:
    """One Parquet and one people CSV for a whole month, attached to release <month> on GitHub."""
    ix = get_json("index.json") or {"days": []}
    days = [d for d in ix["days"] if d["day"].startswith(month)]
    if not days:
        return False
    if subprocess.run(["gh", "release", "view", month, "-R", REPO], capture_output=True).returncode == 0:
        return False
    import duckdb
    work = OUT / "release" / month
    work.mkdir(parents=True, exist_ok=True)
    for d in days:
        for f in ("parquet", "people"):
            rel = d["files"][f]["path"]
            local = work / rel.replace("/", "-")
            if not local.exists():
                subprocess.run(["rclone", "copyto", f"R2:{BUCKET}/{PREFIX}/{rel}", str(local), "-q"], env=rclone_env(), check=True)
    con = duckdb.connect()
    bots = work / f"voight-kampff-bots-{month}.parquet"
    ppl = work / f"voight-kampff-people-{month}.csv.gz"
    con.execute(f"COPY (SELECT * FROM read_parquet('{esc(str(work))}/bots-*.parquet') ORDER BY time) "
                f"TO '{esc(str(bots))}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)")
    con.execute(f"COPY (SELECT * FROM read_csv('{esc(str(work))}/people-*.csv.gz', header=true) ORDER BY hour) "
                f"TO '{esc(str(ppl))}' (FORMAT csv, HEADER, COMPRESSION gzip)")
    rows = sum(d["rows"] for d in days)
    notes = (f"Every bot request to motdang.net and hongdam.net, {days[0]['day']} to {days[-1]['day']} "
             f"({len(days)} Chiang Mai days, {rows:,} rows), one row each, to the second; people as hourly counts.\n\n"
             f"Daily files and the field list: {BASE}/ · Ask it in the page: https://motdang.net/voight-kampff/#ask\n\n"
             "Licence: CC BY 4.0. Credit: motdang.net Voight-Kampff, https://motdang.net/voight-kampff/")
    readme = work / "README.txt"
    readme.write_text(readme_text())
    subprocess.run(["gh", "release", "create", month, "-R", REPO, "--title", f"Voight-Kampff data, {month}",
                    "--notes", notes, str(bots), str(ppl), str(readme)], check=True)
    for f in work.iterdir():
        f.unlink()
    work.rmdir()
    print(f"release {month}: {rows:,} rows, {len(days)} days")
    return True


def readme_text() -> str:
    return (OUT / "README.txt").read_text() if (OUT / "README.txt").exists() else readme(get_json("index.json") or {"days": []})


def release_due() -> None:
    """Each month that has ended and is in the index gets its release once."""
    if subprocess.run(["gh", "repo", "view", REPO], capture_output=True).returncode != 0:
        return
    ix = get_json("index.json") or {"days": []}
    this = dt.datetime.now(ICT).strftime("%Y-%m")
    for m in sorted({d["day"][:7] for d in ix["days"]}):
        if m < this:
            release(m)


def main() -> None:
    args = sys.argv[1:]
    upload = "--no-upload" not in args
    if "--index" in args:
        write_index([])
        return
    if "--release" in args:
        release(args[args.index("--release") + 1])
        return
    if "--day" in args:
        days = [dt.date.fromisoformat(args[args.index("--day") + 1])]
    elif "--from" in args:
        a = dt.date.fromisoformat(args[args.index("--from") + 1])
        b = dt.date.fromisoformat(args[args.index("--to") + 1]) if "--to" in args else dt.datetime.now(ICT).date() - dt.timedelta(days=1)
        days = [a + dt.timedelta(days=i) for i in range((b - a).days + 1)]
    else:  # every day not yet in the index that the log still holds, yesterday included
        y = dt.datetime.now(ICT).date() - dt.timedelta(days=1)
        have = {x["day"] for x in (get_json("index.json") or {}).get("days", [])}
        a = max(FIRST, y - dt.timedelta(days=88))
        days = [a + dt.timedelta(days=i) for i in range((y - a).days + 1) if (a + dt.timedelta(days=i)).isoformat() not in have]
        if not days:
            release_due()
            return
    done = []
    for day in days:
        if day < FIRST:
            continue
        t0 = dt.datetime.now()
        x = export_day(day)
        if upload:
            for f in x["files"].values():
                put(OUT / f["path"], f["path"])
                (OUT / f["path"]).unlink()
        done.append(x)
        print(f"{x['day']}: {x['rows']:,} rows, {x['requests']:,} requests, people {x['people_requests']:,}; "
              f"parquet {x['files']['parquet']['bytes'] / 1e6:.1f} MB, csv {x['files']['csv']['bytes'] / 1e6:.1f} MB "
              f"({(dt.datetime.now() - t0).seconds}s)", flush=True)
        if upload and len(done) % 5 == 0:
            write_index(done)
    if upload and done:
        write_index(done)
        release_due()


if __name__ == "__main__":
    main()
