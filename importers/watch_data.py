#!/usr/bin/env python3
"""Check that the morning's gathering actually gathered something.

The walk has always checked exit codes, and an exit code is a poor witness. A
fetcher that loses its source, gets a 403, or parses a page whose markup moved
will often write the file it promised, stamp it with today's date, and exit 0 —
with nothing inside. On 2026-08-16 all three of these were true at once and had
been for a while:

    events.json      75 events -> 0, refetched every morning
    showtimes.json   183 screenings -> 0 cinemas
    finance.json     {"generated": today} and nothing else

The site published all three. Every page said "updated today" and meant it. The
festival harvester, meanwhile, had not run since 2026-07-29 because nothing in
the walk called it, and nothing was watching for its silence either.

So this asks two questions of every file the walk is responsible for: is the
stamp recent enough for how often that source actually changes, and is there
anything in it. A source that has gone quiet is reported by name. Exit is
non-zero if anything is stale or hollow, so the walk can say so out loud
instead of moving on.

    python3 importers/watch_data.py           # report, exit 1 if anything is wrong
    python3 importers/watch_data.py --quiet   # only complain, say nothing when well
    python3 importers/watch_data.py --heal    # re-run the fetcher of anything stale or
                                              # hollow, then report; exit 1 if still wrong

WHY --heal (2026-09-25). Reporting was the whole failsafe, and a report lands in
a log. finance, showtimes, lottery, events and festival dates are fetched only
by the morning walk, which stood down every day from 09-13 on a held lock, and
ping.json had no caller at all from 09-04: the site printed a 10 September
exchange rate and a three-week-old river while this file said so, daily, to
nobody. Now each watched file names the fetcher that refreshes it (FETCHERS),
the standing walk runs --heal every round, and tests/test_feeds_have_a_runner.py
fails if a watched file names none. A fetcher that keeps failing is retried at
most every HEAL_EVERY_H hours (cache/heal-attempts.json), so a dead source is
not hit every twenty minutes.
"""
import json
import os
import subprocess
import sys
import time
from datetime import date, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

# file, stamp key(s), how many days may pass before silence is suspicious, and
# what must not be empty. max_age follows how often the SOURCE really changes,
# not how often we would like it to: the lottery draws twice a month, link
# health is a slow sweep, and the sky is baked half a year ahead.
CHECKS = [
    ("weather.json",        ["generated"],              2,  [("cities", 1)]),
    ("air.json",            ["generated"],              2,  [("places", 1)]),
    # WO-57. The river moves by the hour in flood season and the page prints
    # a timestamp, so a stale ping.json is a page lying about the present.
    # The clean-air register is a register: it changes with the season, and
    # 120 days of silence from it is normal rather than suspicious.
    ("ping.json",           ["generated"],              1,  [("stations", 1)]),
    ("cleanrooms.json",     ["generated"],            120,  [("rooms", 1)]),
    ("finance.json",        ["generated"],              3,  [("fx.rates", 1),
                                                             ("gold", 1),
                                                             ("crypto", 1)]),
    ("events.json",         ["generated"],              3,  [("events", 1)]),
    # each event's link, checked (importers/event_links.py); the build trusts it for three days
    ("event_links.json",    ["generated"],              3,  [("judged", 1)]),
    ("showtimes.json",      ["generated"],              3,  [("cinemas", 1)]),
    ("festival_dates.json", ["generated"],             10,  [("rows", 1)]),
    ("lottery.json",        ["draw.date", "generated"], 35, [("draw", 1)]),
    ("linkhealth.json",     ["generated"],             45,  [("links", 1)]),
    ("fortune.json",        ["generated"],             60,  [("days", 1)]),
    ("sky.json",            ["generated"],             60,  [("days", 1)]),
    # A claim count of zero is a true fact about the world, not a broken
    # fetcher — only its freshness is checked.
    ("claims.json",         ["generated"],              3,  []),
    # cached fares for the weekend finder on /flights; the page hides them after 3 days
    ("flight_prices.json",  ["generated"],              1,  [("rows", 1)]),
]


# What refreshes each watched file, and how long it may take. A file listed in
# CHECKS with no entry here is a feed nothing can heal — the test refuses that.
FETCHERS = {
    "weather.json":        (["importers/make_weather.py"], 300),
    "air.json":            (["importers/make_air.py"], 300),
    "ping.json":           (["importers/make_ping.py"], 300),
    "cleanrooms.json":     (["importers/fetch_cleanrooms.py"], 1800),
    "finance.json":        (["importers/make_finance.py"], 300),
    "events.json":         (["importers/harvest_events.py", "--refetch"], 1800),
    "event_links.json":    (["importers/event_links.py"], 900),
    "showtimes.json":      (["importers/make_showtimes.py"], 600),
    "festival_dates.json": (["importers/harvest_festivals.py"], 900),
    "lottery.json":        (["importers/make_lottery.py"], 300),
    "linkhealth.json":     (["importers/check_links.py", "--max", "800", "--wayback-max", "150"], 3600),
    "fortune.json":        (["importers/make_fortune.py"], 600),
    "sky.json":            (["importers/make_sky.py"], 900),
    "claims.json":         (["importers/sync_claims.py"], 300),
    "flight_prices.json":  (["importers/fetch_flight_prices.py"], 600),
}
HEAL_EVERY_H = 6
ATTEMPTS = os.path.join(ROOT, "cache", "heal-attempts.json")


def dig(doc, path):
    v = doc
    for part in path.split("."):
        v = v.get(part) if isinstance(v, dict) else None
    return v


def size(v):
    if v is None:
        return 0
    if isinstance(v, (list, dict, str)):
        return len(v)
    return 1


def age_days(stamp):
    if not stamp:
        return None
    s = str(stamp)[:10]
    try:
        return (date.today() - datetime.strptime(s, "%Y-%m-%d").date()).days
    except ValueError:
        return None


def check():
    """(problems, lines, bad) — bad is the set of file names that need a fetch."""
    problems, lines, bad = [], [], set()

    for fname, stamps, max_age, required in CHECKS:
        path = os.path.join(DATA, fname)
        if not os.path.exists(path):
            problems.append(f"{fname} is missing entirely")
            bad.add(fname)
            continue
        try:
            doc = json.load(open(path, encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            problems.append(f"{fname} will not parse ({type(e).__name__})")
            bad.add(fname)
            continue

        stamp = next((dig(doc, k) for k in stamps if dig(doc, k)), None)
        days = age_days(stamp)
        notes = []
        if days is None:
            problems.append(f"{fname} carries no readable date stamp")
            notes.append("no stamp")
        elif days > max_age:
            problems.append(f"{fname} has gone quiet — {days} days old, "
                            f"expected within {max_age}")
            notes.append(f"{days}d old")

        for path_key, least in required:
            n = size(dig(doc, path_key))
            if n < least:
                problems.append(f"{fname} is hollow — {path_key} holds {n}, "
                                f"expected at least {least}")
                notes.append(f"{path_key}={n}")

        if notes:
            bad.add(fname)
        mark = "✗" if notes else "✓"
        lines.append(f"  {mark} {fname:22} {str(stamp)[:10]:12} "
                     f"{'· '.join(notes)}")

    return problems, lines, bad


def heal(bad):
    """Run the fetcher of every bad file not tried in the last HEAL_EVERY_H hours."""
    try:
        tried = json.load(open(ATTEMPTS, encoding="utf-8"))
    except (OSError, ValueError):
        tried = {}
    now = time.time()
    for fname in sorted(bad):
        if fname not in FETCHERS:
            print(f"   · {fname}: no fetcher is named for it")
            continue
        last = tried.get(fname, 0)
        if now - last < HEAL_EVERY_H * 3600:
            print(f"   · {fname}: tried {int((now - last) / 60)} min ago — next try after {HEAL_EVERY_H} h")
            continue
        argv, limit = FETCHERS[fname]
        tried[fname] = now
        print(f"   ↻ {fname}: {' '.join(argv)}")
        try:
            r = subprocess.run([sys.executable] + argv, cwd=ROOT, timeout=limit,
                               capture_output=True, text=True)
            tail = (r.stdout + r.stderr).strip().splitlines()[-1:] or [""]
            print(f"     exit {r.returncode} · {tail[0][:160]}")
        except subprocess.TimeoutExpired:
            print(f"     gave up after {limit} s")
    os.makedirs(os.path.dirname(ATTEMPTS), exist_ok=True)
    with open(ATTEMPTS, "w", encoding="utf-8") as f:
        json.dump(tried, f, indent=1)


def main():
    quiet = "--quiet" in sys.argv
    problems, lines, bad = check()
    if "--heal" in sys.argv and bad:
        print(f"🐜 healing {len(bad)} source(s)")
        heal(bad)
        problems, lines, bad = check()

    if not quiet or problems:
        print("🐜 what the walk brought home")
        print("\n".join(lines))
    if problems:
        print(f"\n🐜 {len(problems)} thing(s) need a look:")
        for p in problems:
            print(f"   - {p}")
        return 1
    if not quiet:
        print("\n🐜 every source spoke today")
    return 0


if __name__ == "__main__":
    sys.exit(main())
