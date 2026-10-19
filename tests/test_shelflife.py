#!/usr/bin/env python3
"""A perishable figure past its age is not shown (shelflife.py; Nan, 2026-09-25, "b").

Run as a script: python3 tests/test_shelflife.py

Three things: the age rule, the few bytes of script that hide a block when a
reader opens the page after its limit (run in node against a stub page), and
that each surface drawing a feed still passes it through the guard.
"""
import datetime
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import shelflife  # noqa: E402

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("  %s %s%s" % ("ok  " if cond else "FAIL", name, "" if cond else "  — %s" % (detail,)))


def main():
    t = datetime.date(2026, 9, 25)
    check("a river reading from yesterday is shown", shelflife.fresh("river", "2026-09-24T18:00", t))
    check("a river reading from two days ago is not", not shelflife.fresh("river", "2026-09-23T23:00", t))
    check("the 10 September rate is not shown on the 25th", shelflife.guard("fx", "2026-09-10", "<b>1</b>", on=t) == "")
    check("a stale block with a stand-in draws the stand-in",
          shelflife.guard("river", "2026-09-04", "<b>1</b>", "<p>see RID</p>", on=t) == "<p>see RID</p>")
    check("no readable stamp is not fresh", shelflife.guard("air", "", "<b>1</b>", on=t) == "")

    node = shutil.which("node")
    if node:
        stub = r"""
const [asof, maxage, stale] = process.argv.slice(1);  // under node -e, arguments begin at 1
const block = {dataset: {asof, maxage}, style: {}};
const after = {hidden: true, classList: {contains: (c) => c === 'shelflife-stale'}};
const script = {previousElementSibling: block, nextElementSibling: stale === '1' ? after : null};
global.document = {currentScript: script};
eval(JS);
console.log(JSON.stringify({shown: block.style.display !== 'none', standIn: !after.hidden}));
"""
        def run(asof, maxage, stale="1"):
            r = subprocess.run([node, "-e", "const JS=" + json.dumps(shelflife._JS) + ";" + stub,
                                asof, str(maxage), stale], capture_output=True, text=True)
            return json.loads(r.stdout or "{}")
        today = shelflife.today()
        old = (today - datetime.timedelta(days=5)).isoformat()
        new = today.isoformat()
        check("in the browser, a block past its limit hides and its stand-in shows",
              run(old, 1) == {"shown": False, "standIn": True}, run(old, 1))
        check("in the browser, a block inside its limit stays",
              run(new, 1) == {"shown": True, "standIn": False}, run(new, 1))
    else:
        print("  skip: node not found, the view-time check was not run")

    uses = {
        "build.py": ['shelflife.guard("weather"', 'shelflife.guard("air"', 'shelflife.guard("showtimes"',
                     'shelflife.guard("fx"', 'shelflife.guard("gold"', 'shelflife.guard("crypto"'],
        "home_next.py": ['shelflife.guard("air"'],
        "flights_layer.py": ['shelflife.fresh("fares"'],
        "nam_layer.py": ['shelflife.guard("river"'],
        "foon_layer.py": ['shelflife.guard("air"'],
        "chuai_layer.py": ['shelflife.guard("air"'],
        "home_layer.py": ['shelflife.fresh("weather"', 'shelflife.fresh("air"'],
    }
    for f, needles in uses.items():
        src = (ROOT / f).read_text(encoding="utf-8")
        missing = [n for n in needles if n not in src]
        check("%s passes its feeds through the guard" % f, not missing, missing)

    print("\n%d passed, %d failed" % (len(PASS), len(FAIL)))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
