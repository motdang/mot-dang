#!/usr/bin/env python3
"""How long a perishable figure may stay on a page.

Nan, 2026-09-25, choosing (b) of two: hide a figure once it is past its age,
rather than print it with its date. The site had shown a 10 September exchange
rate and a three-week-old river until then.

Two checks, because pages are static and are read long after they are built:
  - at build time, guard() draws nothing for a figure already past its age;
  - at view time, the block it draws carries its date and the limit, and a
    few bytes of inline script hide it once the reader's clock passes the
    limit (and show the stale_html beside it, when one is given). No shared
    script is needed, so it works on pages that load none.

The limits are days since the figure's own stamp, in Bangkok. fx and gold get
six because the Bank of Thailand and the gold association publish nothing on
weekends and Thai holidays. cf-sentinel/feed_watch.py and
importers/watch_data.py keep their own tables for gathering and alerting;
this one is only about what a reader sees.
"""
import datetime

MAX_DAYS = {
    "river": 1,       # data/ping.json generated
    "weather": 2,     # data/weather.json generated
    "air": 2,         # data/air.json generated
    "crypto": 2,      # data/finance.json crypto.asOf
    "showtimes": 3,   # data/showtimes.json generated
    "fx": 6,          # data/finance.json fx.date
    "gold": 6,        # data/finance.json gold.asOf
    "fares": 3,       # data/flight_prices.json generated (flights_layer weekend finder)
}

BKK = datetime.timezone(datetime.timedelta(hours=7))

# currentScript is the <script> itself; the block is the element just before it.
# display:contents keeps a wrapped tile in its parent's grid, so hiding sets
# style.display rather than [hidden] (which display:contents would override).
_JS = ("(function(s){var e=s.previousElementSibling,a=Date.parse(e.dataset.asof+'T00:00:00+07:00');"
       "if(a&&(Date.now()-a)/864e5>=+e.dataset.maxage+1){e.style.display='none';"
       "var n=s.nextElementSibling;if(n&&n.classList.contains('shelflife-stale'))n.hidden=false}"
       "})(document.currentScript)")


def day(stamp):
    """The calendar date a stamp names, or None."""
    try:
        return datetime.date.fromisoformat(str(stamp)[:10])
    except (TypeError, ValueError):
        return None


def today():
    return datetime.datetime.now(BKK).date()


def age_days(stamp, on=None):
    d = day(stamp)
    return None if d is None else ((on or today()) - d).days


def fresh(kind, stamp, on=None):
    """True when the figure is within its limit. No readable stamp is not fresh."""
    a = age_days(stamp, on)
    return a is not None and a <= MAX_DAYS[kind]


def guard(kind, stamp, html, stale_html="", on=None):
    """html wrapped so it disappears once past its age; "" if it already is.

    stale_html, when given, is drawn hidden beside it and shown in its place —
    or drawn alone when the figure is already too old at build time."""
    if not fresh(kind, stamp, on):
        return stale_html
    if not html:
        return ""
    d = day(stamp).isoformat()
    after = (f'<div class="shelflife-stale" hidden>{stale_html}</div>' if stale_html else "")
    return (f'<div class="shelflife" style="display:contents" data-asof="{d}" '
            f'data-maxage="{MAX_DAYS[kind]}">{html}</div><script>{_JS}</script>{after}')


if __name__ == "__main__":
    t = datetime.date(2026, 9, 25)
    assert fresh("river", "2026-09-24T18:00", t) and not fresh("river", "2026-09-23", t)
    assert fresh("fx", "2026-09-19", t) and not fresh("fx", "2026-09-18", t)
    assert not fresh("air", "", t) and not fresh("air", None, t)
    assert guard("fx", "2026-09-10", "<b>x</b>", on=t) == ""
    assert guard("fx", "2026-09-10", "<b>x</b>", "old", on=t) == "old"
    g = guard("fx", "2026-09-24", "<b>x</b>", "old", on=t)
    assert 'data-asof="2026-09-24"' in g and 'data-maxage="6"' in g and "shelflife-stale" in g
    print("shelflife ok")
