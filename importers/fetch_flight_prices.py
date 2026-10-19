#!/usr/bin/env python3
"""Cached nonstop fares for the weekend finder on /flights → data/flight_prices.json.

Travelpayouts Data API (aviasales/v3/prices_for_dates): the cheapest fares
Aviasales users found in the last days, about one per route and day, each with
its airline, flight number and departure time. flights_layer.py puts a price on
a leg whose airline and departure time match one, and hides prices once the
file is past shelflife.MAX_DAYS["fares"] (Nan, 2026-10-19, option b).

Routes are the finder's places (flights_layer.trip_data), both ways, this month
and the next two. Token: $TRAVELPAYOUTS_TOKEN or ~/.tokens/TRAVELPAYOUTS_TOKEN.
On a failure the file on disk stays as it was.

    python3 importers/fetch_flight_prices.py
"""
import datetime
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import flights_layer  # noqa: E402

OUT = ROOT / "data" / "flight_prices.json"
API = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates"
BKK = datetime.timezone(datetime.timedelta(hours=7))


def token():
    t = os.environ.get("TRAVELPAYOUTS_TOKEN", "").strip()
    f = Path.home() / ".tokens" / "TRAVELPAYOUTS_TOKEN"
    if not t and f.exists():
        t = f.read_text().strip()
    return t


def months(today, n=3):
    y, m = today.year, today.month
    for _ in range(n):
        yield f"{y}-{m:02d}"
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def fetch(tok, origin, dest, month):
    q = urllib.parse.urlencode({
        "origin": origin, "destination": dest, "departure_at": month,
        "one_way": "true", "direct": "true", "currency": "thb", "market": "th",
        "sorting": "price", "unique": "false", "limit": 1000})
    req = urllib.request.Request(f"{API}?{q}", headers={"X-Access-Token": tok,
                                                         "Accept-Encoding": "identity"})
    doc = json.loads(urllib.request.urlopen(req, timeout=30).read())
    if not doc.get("success"):
        raise RuntimeError(doc.get("error") or "no success")
    return doc.get("data") or []


def main():
    tok = token()
    if not tok:
        sys.exit("fetch_flight_prices: no TRAVELPAYOUTS_TOKEN (token list)")
    now = datetime.datetime.now(BKK)
    rows, asked, failed = {}, 0, []
    for p in flights_layer.trip_data()["places"]:
        for o, d in ((p["from"], p["to"]), (p["to"], p["from"])):
            for month in months(now.date()):
                asked += 1
                try:
                    got = fetch(tok, o, d, month)
                except Exception as e:  # one route down is not the file down
                    failed.append(f"{o}-{d} {month}: {e}")
                    continue
                for x in got:
                    if x.get("transfers") or not x.get("departure_at"):
                        continue
                    dep = x["departure_at"][:16]
                    if dep < now.strftime("%Y-%m-%dT%H:%M"):
                        continue
                    r = {"o": x.get("origin_airport") or o, "d": x.get("destination_airport") or d,
                         "al": x.get("airline", ""), "no": f'{x.get("airline", "")}{x.get("flight_number", "")}',
                         "dep": dep, "thb": int(x["price"])}
                    k = (r["o"], r["d"], r["al"], r["dep"])
                    if k not in rows or r["thb"] < rows[k]["thb"]:
                        rows[k] = r
                time.sleep(0.2)
    if len(failed) == asked:
        sys.exit("fetch_flight_prices: every request failed, file kept\n  " + "\n  ".join(failed[:5]))
    doc = {"generated": now.isoformat(timespec="minutes"),
           "source": "Travelpayouts Data API, aviasales/v3/prices_for_dates (Aviasales search cache)",
           "rows": sorted(rows.values(), key=lambda r: (r["o"], r["d"], r["dep"]))}
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=0))
    tmp.replace(OUT)
    print(f"flight prices: {len(doc['rows'])} fares from {asked - len(failed)} of {asked} requests")
    for f in failed[:5]:
        print("  failed", f)


if __name__ == "__main__":
    main()
