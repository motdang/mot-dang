"""The places, one row each, in data/places.sqlite.

Ticket 82 (2026-10-22): places lived only in data/canonical/*.json, 200 MB
rewritten whole on every import, so nothing could say which places changed or
when. importers/import_all.py now writes this file beside the JSON, and
build.py reads its places from here.

A row holds:

  id        the record id (cm-osm-node-1234567890)
  code      its short code, without "MD-" (placecode.py, append-only)
  province  cm, cr, pth, ...
  seq       its place in the province's list, so the build sees the same order
  record    the record, as the JSON file has it
  fp        a hash of the details: the record less updatedAt and each source's
            fetched date, so a re-read that finds the same details is no change
  ver       1 for a new place, one more each time fp changes
  changed   when ver last went up (UTC)
  fetched   the latest date a source was read (not derived, not field)
  checked   the latest date a person confirmed it: a field source, or an OSM
            mapper's check_date (attrs.checkedOn)

The JSON files are still written, and other tools still read them. A province
is read from here only while its row in `province` carries the sha1 of the JSON
file as it is now and a hash of its rows that the rows still match; when someone
edits the JSON by hand, the file was written without this one, or a copy of it
was taken mid-write, build.py reads the JSON and says so. MD_PLACES=json makes
the build read the JSON whatever this file holds.

    python3 placedb.py                  # what the file holds
    python3 placedb.py MD-4F2K9         # one place, by code
    python3 placedb.py cm-curated-...   # one place, by id
"""
import datetime as dt
import hashlib
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB = Path(os.environ.get("MD_PLACEDB") or (ROOT / "data" / "places.sqlite"))
DATE = re.compile(r"\b(19|20)\d\d-[01]\d-[0-3]\d\b")
NOT_FETCHED = {"derived", "field"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS place (
  id TEXT PRIMARY KEY,
  code TEXT,
  province TEXT NOT NULL,
  seq INTEGER NOT NULL,
  record TEXT NOT NULL,
  raw TEXT NOT NULL,
  fp TEXT NOT NULL,
  ver INTEGER NOT NULL,
  changed TEXT NOT NULL,
  fetched TEXT,
  checked TEXT
);
CREATE INDEX IF NOT EXISTS place_code ON place(code);
CREATE INDEX IF NOT EXISTS place_prov ON place(province, seq);
CREATE TABLE IF NOT EXISTS province (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  sha1 TEXT NOT NULL,
  size INTEGER NOT NULL,
  rows TEXT NOT NULL,
  written TEXT NOT NULL
);
"""


def _now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def connect(path=None, create=False):
    """The file for writing (made when `create`), or None when there is none."""
    p = Path(path or DB)
    if not create and not p.exists():
        return None
    p.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(p), timeout=60)
    con.execute("PRAGMA journal_mode=DELETE")
    con.executescript(SCHEMA)
    return con


def reader(path=None):
    """The file opened read-only, or None."""
    p = Path(path or DB)
    if not p.exists():
        return None
    from urllib.request import pathname2url
    return sqlite3.connect("file:%s?mode=ro" % pathname2url(str(p.resolve())), uri=True, timeout=60)


def file_sha1(path, _memo={}):
    """sha1 of a file, remembered by size and mtime for the life of the process."""
    st = os.stat(path)
    key = (str(path), st.st_size, st.st_mtime_ns)
    if key not in _memo:
        h = hashlib.sha1()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 22), b""):
                h.update(chunk)
        _memo[key] = h.hexdigest()
    return _memo[key], st.st_size


def rows_digest(rows):
    """A hash of the province's records in order: a copy taken while the file
    was being written, or a damaged one, does not match it."""
    h = hashlib.blake2b(digest_size=16)
    for rec in rows:
        h.update(rec.encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()


def details_fp(r):
    """A hash of what the place is, less the dates a re-read moves."""
    d = {k: v for k, v in r.items() if k != "updatedAt"}
    if isinstance(d.get("sources"), list):
        d["sources"] = [{k: v for k, v in s.items() if k != "fetched"} if isinstance(s, dict) else s
                        for s in d["sources"]]
    raw = json.dumps(d, sort_keys=True, ensure_ascii=False, default=str, separators=(",", ":"))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _day(v):
    m = DATE.search(v) if isinstance(v, str) else None
    return m.group(0) if m else None


def dates(r):
    """(fetched, checked): the latest day a source was read, and the latest day
    a person confirmed the place."""
    fetched, checked = [], []
    for s in r.get("sources") or []:
        if not isinstance(s, dict):
            continue
        t = s.get("type")
        if t == "field":
            text = " ".join(str(s.get(k) or "") for k in ("ref", "via", "note"))
            days = [_day(s.get("fetched"))] + [m.group(0) for m in DATE.finditer(text)]
            checked += [d for d in days if d]
        elif t not in NOT_FETCHED:
            d = _day(s.get("fetched"))
            if d:
                fetched.append(d)
    co = _day((r.get("attrs") or {}).get("checkedOn"))
    if co:
        checked.append(co)
    return (max(fetched) if fetched else None), (max(checked) if checked else None)


def write(prov, records, json_path, path=None, codes=None):
    """The province's rows, after its JSON file was written to `json_path`.
    Rows whose record is unchanged are not touched. Returns (new, changed, gone)."""
    ids = [r["id"] for r in records]
    if len(set(ids)) != len(ids):
        # one row per id cannot hold the list the JSON file holds: the build reads that
        drop(prov, path)
        raise ValueError(f"{len(ids) - len(set(ids))} id(s) twice in {Path(json_path).name}")
    con = connect(path, create=True)
    if codes is None:
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        import placecode
        codes = placecode.assign(ids)
    old = {i: (raw, fp, ver, changed, seq) for i, raw, fp, ver, changed, seq in con.execute(
        "SELECT id, raw, fp, ver, changed, seq FROM place WHERE province=?", (prov,))}
    now = _now()
    new = moved = 0
    seen = set(ids)
    with con:
        for seq, r in enumerate(records):
            i = r["id"]
            rec = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
            raw = hashlib.blake2b(rec.encode("utf-8"), digest_size=12).hexdigest()
            was = old.get(i)
            if was and was[0] == raw:
                if was[4] != seq:
                    con.execute("UPDATE place SET seq=? WHERE id=?", (seq, i))
                continue
            fp = details_fp(r)
            fetched, checked = dates(r)
            if was:
                ver, changed = (was[2], was[3]) if was[1] == fp else (was[2] + 1, now)
                moved += was[1] != fp
            else:
                ver, changed = 1, now
                new += 1
            con.execute(
                "INSERT OR REPLACE INTO place (id, code, province, seq, record, raw, fp, ver,"
                " changed, fetched, checked) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (i, codes.get(i), prov, seq, rec, raw, fp, ver, changed, fetched, checked))
        gone = [i for i in old if i not in seen]
        con.executemany("DELETE FROM place WHERE id=? AND province=?", [(i, prov) for i in gone])
        sha1, size = file_sha1(json_path)
        rows = rows_digest(rec for (rec,) in con.execute(
            "SELECT record FROM place WHERE province=? ORDER BY seq", (prov,)))
        con.execute("INSERT OR REPLACE INTO province (key, n, sha1, size, rows, written)"
                    " VALUES (?,?,?,?,?,?)", (prov, len(seen), sha1, size, rows, now))
    con.close()
    return new, moved, len(gone)


def drop(prov, path=None):
    """A province whose JSON file was removed."""
    con = connect(path)
    if con is None:
        return
    with con:
        con.execute("DELETE FROM place WHERE province=?", (prov,))
        con.execute("DELETE FROM province WHERE key=?", (prov,))
    con.close()


def why_not(prov, json_path, path=None):
    """None when the province can be read from the file; otherwise the reason."""
    if os.environ.get("MD_PLACES") == "json":
        return "MD_PLACES=json"
    con = reader(path)
    if con is None:
        return "no database file"
    try:
        row = con.execute("SELECT n, sha1, size FROM province WHERE key=?", (prov,)).fetchone()
    except sqlite3.Error as e:
        return f"database file unreadable ({e})"
    finally:
        con.close()
    if not row:
        return f"{prov} not in the database file"
    sha1, size = file_sha1(json_path)
    if (sha1, size) != (row[1], row[2]):
        return f"{Path(json_path).name} changed after the database file was written"
    return None


def read(prov, json_path, path=None):
    """The province's records in the JSON file's order, or None (see why_not)."""
    if why_not(prov, json_path, path):
        return None
    con = reader(path)
    try:
        n, want = con.execute("SELECT n, rows FROM province WHERE key=?", (prov,)).fetchone()
        rows = [rec for (rec,) in con.execute(
            "SELECT record FROM place WHERE province=? ORDER BY seq", (prov,))]
    except sqlite3.Error:
        return None
    finally:
        con.close()
    if len(rows) != n or rows_digest(rows) != want:
        return None
    if not rows:
        return []
    # one parse of the whole list (a parse per row is half again as slow), with
    # the rows let go first: the build server has 3.8 GB and a build holds 2.5
    # one after the other: with one row (lpn) rows[0] is rows[-1]
    rows[0] = "[" + rows[0]
    rows[-1] = rows[-1] + "]"
    text = ",".join(rows)
    del rows
    return json.loads(text)


def get(ids, prov, json_path, path=None):
    """{id: record} for these ids in one province, or None (see why_not)."""
    if why_not(prov, json_path, path):
        return None
    ids = list(ids)
    con = reader(path)
    try:
        q = "SELECT id, record, raw FROM place WHERE province=? AND id IN (%s)" % ",".join("?" * len(ids))
        got = con.execute(q, [prov] + ids).fetchall()
    except sqlite3.Error:
        return None
    finally:
        con.close()
    if any(hashlib.blake2b(rec.encode("utf-8"), digest_size=12).hexdigest() != raw for _, rec, raw in got):
        return None
    return {i: json.loads(rec) for i, rec, _ in got}


def find(key, path=None):
    """One row, by MD- code or by record id."""
    con = reader(path)
    if con is None:
        return None
    con.row_factory = sqlite3.Row
    k = key.strip()
    code = k[3:] if k.upper().startswith("MD-") else k
    row = (con.execute("SELECT * FROM place WHERE code=?", (code.upper(),)).fetchone()
           or con.execute("SELECT * FROM place WHERE id=?", (k,)).fetchone())
    con.close()
    return dict(row) if row else None


def main(argv):
    if argv:
        row = find(argv[0])
        if not row:
            sys.exit(f"{argv[0]}: not in {DB}")
        r = json.loads(row.pop("record"))
        row.pop("raw")
        print(f"MD-{row['code']}  {row['id']}  {r.get('name')}")
        for k in ("province", "ver", "changed", "fetched", "checked", "fp"):
            print(f"  {k:<9}{row[k]}")
        return
    con = reader()
    if con is None:
        sys.exit(f"no {DB}")
    for key, n, written in con.execute("SELECT key, n, written FROM province ORDER BY n DESC"):
        print(f"{key:<5}{n:>8,}  written {written}")
    total, coded, checked = con.execute(
        "SELECT count(*), count(code), count(checked) FROM place").fetchone()
    print(f"{total:,} places · {coded:,} with a code · {checked:,} checked by a person")
    for day, n in con.execute(
            "SELECT substr(changed,1,10) d, count(*) FROM place GROUP BY d ORDER BY d DESC LIMIT 5"):
        print(f"  changed {day}: {n:,}")
    con.close()


if __name__ == "__main__":
    main(sys.argv[1:])
