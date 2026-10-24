#!/usr/bin/env python3
"""placedb: the places as rows, made-up records only.

  1. written then read: the same records, in the same order, as the JSON file
  2. written again unchanged: nothing moves
  3. a re-read that moves only dates: the row takes them, the version stays
  4. a changed detail: the version goes up and `changed` moves
  5. a place that left: its row goes
  6. the JSON edited after the database file: read says no, and why
  7. MD_PLACES=json, a removed province, a damaged file, a torn copy: read says no
  8. fetched and checked: which sources count for each
  9. a place found by its MD- code and by its id
 10. a province of one place, and of none

    python3 tests/test_placedb.py
"""
import json
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import placedb as P  # noqa: E402

failures = []


def check(label, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else ' — ' + str(detail)}")
    if not ok:
        failures.append(label)


def rec(i, name, phone=None, fetched="2026-10-01", **kw):
    r = {"id": i, "province": "cm", "cat": ["food"], "name": name, "nameTh": None,
         "lat": 18.7883, "lng": 98.9853, "phone": phone, "attrs": {},
         "sources": [{"type": "osm", "ref": "node/1", "fetched": fetched}],
         "updatedAt": fetched}
    r.update(kw)
    return r


def put(d, prov, records):
    """What import_all does: the JSON file, then the rows."""
    f = d / f"{prov}.json"
    f.write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")
    codes = {r["id"]: "C" + r["id"][-4:].upper() for r in records}
    return f, P.write(prov, records, f, path=d / "places.sqlite", codes=codes)


def row(d, i):
    return P.find(i, path=d / "places.sqlite")


with tempfile.TemporaryDirectory() as tmp:
    d = Path(tmp)
    db = d / "places.sqlite"
    rs = [rec("cm-a-0001", "ข้าวซอย ลุงประกิต", phone="053 123 456"),
          rec("cm-a-0002", "Café ☕ 2", attrs={"facets": {"wifi": "map"}, "n": 1.0000000000000002}),
          rec("cm-a-0003", "Third", lat=None, lng=None)]
    f, got = put(d, "cm", rs)
    print("1. written then read")
    check("three new rows", got == (3, 0, 0), got)
    back = P.read("cm", f, path=db)
    check("the same records as the JSON file gives", back == json.loads(f.read_text()), back)
    check("in the same order", [r["id"] for r in back] == ["cm-a-0001", "cm-a-0002", "cm-a-0003"])
    first = row(d, "cm-a-0001")
    check("version 1", first["ver"] == 1, first)

    print("2. written again unchanged")
    time.sleep(1.1)
    f, got = put(d, "cm", rs)
    check("nothing new, changed or gone", got == (0, 0, 0), got)
    check("changed stays", row(d, "cm-a-0001")["changed"] == first["changed"])

    print("3. a re-read that moves only dates")
    rs2 = [dict(rs[0], updatedAt="2026-10-20",
                sources=[{"type": "osm", "ref": "node/1", "fetched": "2026-10-20"}])] + rs[1:]
    f, got = put(d, "cm", rs2)
    r1 = row(d, "cm-a-0001")
    check("counted as no change", got == (0, 0, 0), got)
    check("the version stays 1", r1["ver"] == 1, r1)
    check("the row holds the new dates", r1["fetched"] == "2026-10-20"
          and json.loads(r1["record"])["updatedAt"] == "2026-10-20", r1)
    check("read gives the new record", P.read("cm", f, path=db) == rs2)

    print("4. a changed detail")
    rs3 = [dict(rs2[0], phone="081 111 2222")] + rs2[1:]
    f, got = put(d, "cm", rs3)
    r1 = row(d, "cm-a-0001")
    check("one changed", got == (0, 1, 0), got)
    check("version 2", r1["ver"] == 2, r1)
    check("changed moved", r1["changed"] > first["changed"], (r1["changed"], first["changed"]))
    check("the others stay at 1", row(d, "cm-a-0002")["ver"] == 1)

    print("5. a place that left")
    rs4 = [rs3[0], rs3[2]]
    f, got = put(d, "cm", rs4)
    check("one gone", got == (0, 0, 1), got)
    check("its row is gone", row(d, "cm-a-0002") is None)
    check("read gives two, in order", [r["id"] for r in P.read("cm", f, path=db)] == ["cm-a-0001", "cm-a-0003"])

    print("6. the JSON edited after the database file")
    hand = json.loads(f.read_text())
    hand[0]["phone"] = "typed by hand"
    f.write_text(json.dumps(hand, ensure_ascii=False, indent=1), encoding="utf-8")
    check("read says no", P.read("cm", f, path=db) is None)
    why = P.why_not("cm", f, path=db)
    check("and why", why and "changed after" in why, why)
    f, _ = put(d, "cm", hand)
    check("the next import puts them back in step", P.read("cm", f, path=db) == hand)

    print("7. other reasons to read the JSON")
    os.environ["MD_PLACES"] = "json"
    check("MD_PLACES=json", P.read("cm", f, path=db) is None and P.why_not("cm", f, path=db) == "MD_PLACES=json")
    del os.environ["MD_PLACES"]
    check("a province not written", P.why_not("cr", f, path=db) == "cr not in the database file")
    check("no file", P.why_not("cm", f, path=d / "none.sqlite") == "no database file")
    bad = d / "bad.sqlite"
    bad.write_bytes(b"not a database" * 100)
    check("a damaged file", P.read("cm", f, path=bad) is None and "unreadable" in P.why_not("cm", f, path=bad),
          P.why_not("cm", f, path=bad))
    import sqlite3
    torn = d / "torn.sqlite"
    torn.write_bytes(db.read_bytes())
    con = sqlite3.connect(torn)
    with con:
        con.execute("UPDATE place SET record=replace(record, 'ข้าวซอย', 'old copy') WHERE id='cm-a-0001'")
    con.close()
    check("rows that do not match their digest (a copy taken mid-write)", P.read("cm", f, path=torn) is None)
    try:
        put(d, "cm", hand + [hand[0]])
        twice = False
    except ValueError:
        twice = True
    check("an id twice: refused, and the province is left to the JSON", twice
          and P.why_not("cm", f, path=db) == "cm not in the database file", P.why_not("cm", f, path=db))
    f, _ = put(d, "cm", hand)
    P.drop("cm", path=db)
    check("a removed province", P.read("cm", f, path=db) is None and row(d, "cm-a-0001") is None)

    print("8. fetched and checked")
    r = rec("cm-a-0009", "x", sources=[
        {"type": "osm", "fetched": "2026-07-27"},
        {"type": "directory", "fetched": "2026-10-20"},
        {"type": "derived", "fetched": "2026-10-24"},
        {"type": "field", "ref": "own signboard, read on NaN's GoPro ride, 2026-09-23"},
        {"type": "field", "fetched": "2026-10-01"}])
    check("fetched: the latest source read, not derived", P.dates(r)[0] == "2026-10-20", P.dates(r))
    check("checked: the latest field visit, from fetched or the words", P.dates(r)[1] == "2026-10-01", P.dates(r))
    r = rec("cm-a-0010", "y", attrs={"checkedOn": "2025-02-09"})
    check("checked: an OSM mapper's check date", P.dates(r) == ("2026-10-01", "2025-02-09"), P.dates(r))
    check("checked: none", P.dates(rec("cm-a-0011", "z"))[1] is None)

    print("9. found by code and by id")
    f, _ = put(d, "cm", rs)
    check("by MD- code", (row(d, "MD-C0002") or {}).get("id") == "cm-a-0002", row(d, "MD-C0002"))
    check("by code, lower case", (row(d, "md-c0002") or {}).get("id") == "cm-a-0002")
    check("by id", (row(d, "cm-a-0003") or {}).get("code") == "C0003")
    check("get by ids", set(P.get(["cm-a-0001", "cm-a-0003", "cm-nope"], "cm", f, path=db)) == {"cm-a-0001", "cm-a-0003"})
    short = d / "short.sqlite"
    short.write_bytes(db.read_bytes())
    con = sqlite3.connect(short)
    with con:
        con.execute("DELETE FROM place WHERE id='cm-a-0002'")
    con.close()
    check("get on a copy that lost a row says no", P.get(["cm-a-0001"], "cm", f, path=short) is None)

    print("10. a province of one place (lpn, 2026-10-24)")
    one = [rec("lpn-a-0001", "วัดพระธาตุหริภุญชัย", province="lpn")]
    f1, got = put(d, "lpn", one)
    check("one new row", got == (1, 0, 0), got)
    check("read gives it back", P.read("lpn", f1, path=db) == json.loads(f1.read_text()), P.why_not("lpn", f1, path=db))
    f0, _ = put(d, "pth", [])
    check("a province of none reads as an empty list", P.read("pth", f0, path=db) == [])

print()
if failures:
    print(f"FAILED: {len(failures)}")
    sys.exit(1)
print("placedb: all ok")
