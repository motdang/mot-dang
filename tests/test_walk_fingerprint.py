#!/usr/bin/env python3
"""The standing walk's change gate: what counts as news (importers/walk_fingerprint.py).

    python3 tests/test_walk_fingerprint.py
"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "importers"))
import walk_fingerprint as wf  # noqa: E402

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("  %s %s%s" % ("ok  " if cond else "FAIL", name, "" if cond else "  — " + detail))


def main():
    tmp = Path(tempfile.mkdtemp())
    try:
        (tmp / "data").mkdir()
        (tmp / "data" / "air.json").write_text(json.dumps({"generated": "d1", "pm25": 40}))
        (tmp / "data" / "air.meta.json").write_text(json.dumps({"row_count": 9}))
        (tmp / "data" / "weather.json").write_text(json.dumps({"generated": "d1", "temp": 30}))
        (tmp / "data" / "tags.json").write_text(json.dumps({"t": 1}))
        a = wf.manifest(tmp)
        check("a new air reading is not in the gate", "data/air.json" not in a and "data/air.meta.json" not in a, str(sorted(a)))
        check("the other data files are", "data/weather.json" in a and "data/tags.json" in a)
        (tmp / "data" / "air.json").write_text(json.dumps({"generated": "d2", "pm25": 90}))
        (tmp / "data" / "air.meta.json").write_text(json.dumps({"row_count": 10}))
        b = wf.manifest(tmp)
        check("so a changed reading changes nothing the gate sees", a == b)
        (tmp / "data" / "weather.json").write_text(json.dumps({"generated": "d2", "temp": 33}))
        check("a changed weather file still does", wf.manifest(tmp) != a)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("\n%d passed, %d failed" % (len(PASS), len(FAIL)))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
