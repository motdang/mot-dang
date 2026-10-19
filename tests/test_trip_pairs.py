#!/usr/bin/env python3
"""The weekend finder on /flights (flights_layer.TRIP_CORE) against data/flights.json.

Runs the page's own pairing code under node, on the data the page bakes:

  - CNX → Bangkok, out Sat 24 Oct 16:00 – Sun 25 11:00, back Sun 25 18:00 – Mon 26 11:00,
    at least 12 h there, at most 48 h: the first pair is Nok DD123 06:45 Sunday out,
    DD142 21:35 Sunday back, 13 h 35 m there, no hotel night (Nok's winter rows
    start 25 Oct, so Saturday has none).
  - nights: a stay that covers 02:00 there is one night.
  - a leg into a +8 city lands in that city's time.
  - a cached fare lands on the leg with its airports, airline and departure,
    and fares past shelflife's three days are dropped.

    python3 tests/test_trip_pairs.py
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import flights_layer  # noqa: E402

DRIVER = r"""
const D = __DATA__, T = mdTrip, bad = [];
function eq(a, b, what) { if (JSON.stringify(a) !== JSON.stringify(b)) bad.push(what + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); }
const P = D.places.find(p => p.k === 'CNX-BKK');
if (!P) bad.push('no CNX-BKK place');
else {
  const R = T.pairs(P, {outLo: '2026-10-24T16:00', outHi: '2026-10-25T11:00',
                        backLo: '2026-10-25T18:00', backHi: '2026-10-26T11:00', min: 12, max: 48});
  const p = R.pairs[0] || {out: {f: {}}, back: {f: {}}};
  eq([p.out.f.no, p.out.day, p.out.f.dep], ['DD123', '2026-10-25', '06:45'], 'first out');
  eq([p.back.f.no, p.back.day, p.back.f.dep], ['DD142', '2026-10-25', '21:35'], 'first back');
  eq(Math.round(p.ground * 60), 13 * 60 + 35, 'minutes there');
  eq(p.nights, 0, 'nights');
  eq(R.outs.some(o => o.day === '2026-10-24'), false, 'a Saturday leg before the winter rows begin');
  eq(R.pairs.some(x => x.nights === 1), true, 'a one-night pair (Monday morning back)');
  eq(T.pick(R.pairs, 1).some(x => x.nights === 1), true, 'pick keeps the best one-night pair');
}
if (P) {
  const R = T.pairs(P, {outLo: '2026-10-25T06:00', outHi: '2026-10-25T07:00',
                        backLo: '2026-10-25T21:00', backHi: '2026-10-25T22:00', min: 0, max: 48});
  const F = {asof: '2026-10-19', max: 3, thb: {'CNX>DMK DD 2026-10-25T06:45': 1459, 'DMK>CNX DD 2026-10-25T21:35': 1200}};
  eq([T.price(F, P, R.pairs[0].out, false), T.price(F, P, R.pairs[0].back, true)], [1459, 1200], 'cached fares land on their legs');
  eq(T.price(null, P, R.pairs[0].out, false), 0, 'no fares, no price');
  eq([T.fresh(F, Date.parse('2026-10-22T12:00:00+07:00')), T.fresh(F, Date.parse('2026-10-23T00:30:00+07:00'))], [true, false], 'fares past three days are dropped');
}
const h = Date.parse('2026-10-25T00:00:00Z');
eq(T.nights(h + 20 * 36e5, h + 26 * 36e5, 0), 1, 'a stay across 02:00 is a night');
eq(T.nights(h + 3 * 36e5, h + 22 * 36e5, 0), 0, 'a day stay is no night');
const X = D.places.find(p => p.tz === 8 && p.legs.some(l => l.d === 'out' && !l.on));
if (X) {
  const f = X.legs.find(l => l.d === 'out' && !l.on);
  const from = (f.valid.split('/')[0] || '2026-11-01');
  const L = T.legs({...X, legs: [{...f, days: '1234567', valid: '/'}]}, 'out', from + 'T00:00', from + 'T23:59')[0];
  const flown = (L.arr - L.dep) / 6e4;
  if (!(flown > 60 && flown < 600)) bad.push(X.k + ' ' + f.no + ': ' + flown + ' minutes in the air, the +8 offset is off');
}
if (bad.length) { console.log('trip pairs FAILED\n  ' + bad.join('\n  ')); process.exit(1); }
console.log('trip pairs: ok (' + D.places.length + ' places)');
"""


def main():
    node = shutil.which("node")
    if not node:
        print("trip pairs: no node on this host, nothing checked")
        return 0
    data = json.dumps(flights_layer.trip_data(), ensure_ascii=False)
    src = flights_layer.TRIP_CORE + DRIVER.replace("__DATA__", data)
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
        fh.write(src)
    try:
        return subprocess.run([node, fh.name]).returncode
    finally:
        Path(fh.name).unlink()


if __name__ == "__main__":
    sys.exit(main())
