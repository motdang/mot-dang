#!/usr/bin/env python3
"""A bearing never says more than the pin knows, and never less than the
address says when the pin agrees. WO-64.

    python3 tests/test_bearings.py                 # ~2 s, reads data/ only
    BEARINGS_TEST_BUILD=1 python3 tests/test_bearings.py   # also checks the
                                                   # moat ids against build.py

Nan's two sentences are the first two checks, as synthetic pins:
  "My house is 5 km due east of Tha Phae gate."
  "Chiang Mai Plastics is right across the street from Wararot Market."
(Chiang Mai Plastics is not on this disk under that name; the check plants a
record 40 m east of the market with an address that says so.)
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import bearings_layer as B  # noqa: E402

FAILED = []


def check(label, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}" + (f"  — {detail}" if detail else ""))
    if not ok:
        FAILED.append(label)


def kinds(ls):
    return [x["kind"] for x in ls]


def main():
    c = B.ctx(force=True)
    lm = {p: {l["key"]: l for l in ls} for p, ls in c.landmarks.items()}

    print("register")
    check("every landmark resolved to a coordinate", not c.unresolved, str(c.unresolved))
    check("cm has an origin (Tha Phae Gate)", (c.origin.get("cm") or {}).get("key") == "tha-phae-gate")
    check("cr has an origin (the clock tower)", (c.origin.get("cr") or {}).get("key") == "clock-tower")
    check("moat polygon read from the four corner records", bool(c.moat_poly) and len(c.moat_poly) == 4)
    keys = [l["key"] for ls in c.landmarks.values() for l in ls]
    check("landmark keys unique", len(keys) == len(set(keys)))
    for p, ls in c.landmarks.items():
        for l in ls:
            check(f"{p}/{l['key']} has th, en, roman, aliases",
                  all(l.get(k) for k in ("th", "en", "roman")) and l.get("aliases"))
    # A landmark's pin is inside its own province's box of the world: a wrong
    # id silently pointing at Chiang Rai would put every Chiang Mai bearing
    # 150 km out and look fine on the page.
    for l in c.landmarks.get("cm", []):
        check(f"cm/{l['key']} pin is in Chiang Mai (17.8–20.2 N, 98.0–99.6 E)",
              17.8 <= l["lat"] <= 20.2 and 98.0 <= l["lng"] <= 99.6, f"{l['lat']},{l['lng']}")
    for l in c.landmarks.get("cr", []):
        check(f"cr/{l['key']} pin is in Chiang Rai (19.2–20.5 N, 99.3–100.6 E)",
              19.2 <= l["lat"] <= 20.5 and 99.3 <= l["lng"] <= 100.6, f"{l['lat']},{l['lng']}")

    if os.environ.get("BEARINGS_TEST_BUILD"):
        import build
        check("moat corner ids mirror build.MOAT_CORNER_IDS", B.MOAT_CORNER_IDS == build.MOAT_CORNER_IDS)
        check("moat polygon equals build.MOAT_POLY", c.moat_poly == build.MOAT_POLY)

    tp = lm["cm"]["tha-phae-gate"]
    wr = lm["cm"]["warorot"]

    print("Nan's house: 5 km due east of Tha Phae Gate")
    dlng = 5000.0 / (111320.0 * B.math.cos(B.math.radians(tp["lat"])))
    house = {"id": "cm-test-house", "province": "cm", "name": "บ้านแนน", "geoPrecision": "exact",
             "lat": tp["lat"], "lng": tp["lng"] + dlng, "address": "", "attrs": {}}
    ls = B.bearings(house, c)
    city = next((x for x in ls if x["kind"] == "city"), None)
    check("a city line is given", city is not None, str(kinds(ls)))
    check("it reads '5.0 km due east of Tha Phae Gate'",
          city and city["en"] == "5.0 km due east of Tha Phae Gate", city and city["en"])
    check("Thai half names ประตูท่าแพ and ตะวันออก",
          city and "ประตูท่าแพ" in city["th"] and "ตะวันออก" in city["th"], city and city["th"])
    check("the reading rides with it", city and "pratu tha phae" in city["roman"], city and city["roman"])
    check("no moat line 5 km out", "moat" not in kinds(ls))

    print("Chiang Mai Plastics: across the street from Warorot Market")
    dlng = 40.0 / (111320.0 * B.math.cos(B.math.radians(wr["lat"])))
    shop = {"id": "cm-test-plastics", "province": "cm", "name": "Chiang Mai Plastics", "geoPrecision": "exact",
            "lat": wr["lat"], "lng": wr["lng"] + dlng, "attrs": {},
            "address": "across the street from Warorot Market, Wichayanon Rd"}
    ls = B.bearings(shop, c)
    addr = next((x for x in ls if x["kind"] == "address"), None)
    check("the address relation leads", ls and ls[0]["kind"] == "address", str(kinds(ls)))
    check("it reads 'across the street from Warorot Market'",
          addr and addr["en"] == "across the street from Warorot Market", addr and addr["en"])
    check("Thai says ตรงข้ามตลาดวโรรส", addr and addr["th"].startswith("ตรงข้ามตลาดวโรรส"), addr and addr["th"])
    check("Warorot is not repeated as a second 'at' line",
          sum(1 for x in ls if x.get("landmark") == "warorot") == 1)
    check("moat line says outside, to the east", any(x["kind"] == "moat" and x["dir"] == "east" for x in ls))

    print("inside the old city")
    tk = c.by_id.get("cm-osm-node-1619287904")   # Three Kings Monument
    ls = B.bearings(tk, c)
    moat = next((x for x in ls if x["kind"] == "moat"), None)
    check("Three Kings: inside, north-east quarter", moat and "north-east quarter" in moat["en"], moat and moat["en"])
    check("nearest crossing named with metres", moat and moat["m"] is not None and "Gate" in moat["en"] or "corner" in (moat or {}).get("en", ""))
    check("a landmark is not 'at' itself", not any(x["kind"] == "at" and x["landmark"] == "three-kings" for x in ls))
    check("no city line inside the moat", "city" not in kinds(ls))
    check("no zone line inside the moat", "zone" not in kinds(ls))

    print("the pin gate")
    loose = {"id": "cm-test-loose", "province": "cm", "name": "x", "geoPrecision": "approx",
             "lat": wr["lat"], "lng": wr["lng"] + dlng, "attrs": {"pinUncertaintyM": 806}, "address": ""}
    ls = B.bearings(loose, c)
    check("±806 m pin gets no 'at'/'near' line", not any(x["kind"] in ("at", "near") for x in ls), str(kinds(ls)))
    check("±806 m pin gets no metre figure in any line",
          not any(" ม." in x["th"] or " m " in x["en"] + " " for x in ls), [x["en"] for x in ls])
    check("every line it does get is marked approximate", all(x["approx"] for x in ls if x["kind"] != "zone"))
    check("still says roughly where, from the origin", any(x["kind"] == "city" and "approximate" in x["en"] for x in ls))

    print("the address gate")
    B.CONTRADICTIONS.clear()
    far = {"id": "cm-test-far", "province": "cm", "name": "x", "geoPrecision": "exact",
           "lat": tp["lat"], "lng": tp["lng"] + dlng * 100, "attrs": {},
           "address": "ตรงข้ามตลาดวโรรส ถ.วิชยานนท์"}
    ls = B.bearings(far, c)
    check("an exact pin 4 km from the landmark the address names: no address line",
          "address" not in kinds(ls), str(kinds(ls)))
    check("…and the contradiction is recorded for the audit",
          any(x["id"] == "cm-test-far" and x["landmark"] == "warorot" for x in B.CONTRADICTIONS))
    nopin = {"id": "cm-test-nopin", "province": "cm", "name": "x", "geoPrecision": "needs-pin",
             "attrs": {}, "address": "ข้างวัดศรีสุพรรณ ถ.วัวลาย"}
    ls = B.bearings(nopin, c)
    check("no pin at all: the address relation alone, marked from address",
          kinds(ls) == ["address"] and ls[0]["from"] == "address" and ls[0]["landmark"] == "wat-sri-suphan",
          str(ls))

    print("the address parser")
    P = lambda a: B.parse_address(a, c, "cm")  # noqa: E731
    check("ถ.ท่าแพ is a road, not the gate", P("12 ถ.ท่าแพ ต.ช้างม่อย") is None)
    check("Tha Phae Rd is a road, not the gate", P("25 Tha Phae Rd, Chang Moi") is None)
    check("ต.วัดเกต is a subdistrict, not the temple", P("ถ.บำรุงราษฎร์ ต.วัดเกต, เมือง") is None)
    check("ตำบลวัดเกต + 'Wat ket' in the Latin half: still the subdistrict",
          P("186/4 ถนนเจริญราษฎร์ ตำบลวัดเกต Wat ket อำเภอเมือง") is None)
    check("โรงแรมวัดเกตโฮเทล is a hotel, not the temple", P("ข้างโรงแรมวัดเกตโฮเทล ถ.บำรุงราษฎร์") is None)
    check("ถ.สนามบิน is Airport Road, not the airport", P("ซอย 4 ถ.สนามบิน ต.สุเทพ") is None)
    check("ถ. ดอยสะเก็ด-บ่อสร้าง is the road to Bo Sang, not Bo Sang", P("522/1 ต.เชิงดอย ถ. ดอยสะเก็ด-บ่อสร้าง 50220") is None)
    got = P("ต.ช้างม่อย ใกล้ประตูท่าแพ")
    check("ต.ช้างม่อย ใกล้ประตูท่าแพ is still near the gate", got and got["landmark"]["key"] == "tha-phae-gate" and got["rel"] == "near")
    got = P("ชั้น 3 เมญ่า ถ.ห้วยแก้ว")
    check("ชั้น 3 เมญ่า → inside Maya, floor 3", got and got["rel"] == "inside" and got["floor"] == "3"
          and got["landmark"]["key"] == "maya", str(got and (got["rel"], got["floor"])))
    got = P("ตรงข้ามคณะเภสัชฯ ม.ช. ถ.สุเทพ")
    check("ตรงข้ามคณะเภสัชฯ ม.ช. → opposite CMU", got and got["rel"] == "opposite" and got["landmark"]["key"] == "cmu")
    got = P("Wat Mahawan, Tha Phae Rd beside Soi 4, near Tha Phae Gate")
    check("a bare mention outranks a 'near'", got and got["landmark"]["key"] == "wat-mahawan", got and got["landmark"]["key"])
    got = P("ชาตรามือ สาขาตลาดวโรรส")
    check("สาขาตลาดวโรรส → at Warorot", got and got["landmark"]["key"] == "warorot" and got["rel"] == "names")

    print("wording")
    check("fmt_dist rounds to 10 m under a km", B.fmt_dist(234) == ("230 ม.", "230 m"))
    check("fmt_dist one decimal to 20 km", B.fmt_dist(1460) == ("1.5 กม.", "1.5 km"))
    check("fmt_dist whole km past 20", B.fmt_dist(23400) == ("23 กม.", "23 km"))
    check("compass: 90° is due east", B.compass(90.0) == (2, True))
    check("compass: 100° is east, not due (the cone is 15°)", B.compass(100.0) == (2, False))
    check("compass: 95° is due east", B.compass(95.0) == (2, True))
    check("compass: 350° is north", B.compass(350.0)[0] == 0)
    check("compass: 45° is north-east, never 'due'", B.compass(45.0) == (1, False))

    print("determinism")
    a = B.bearings(c.by_id["cm-osm-node-6972562985"], c)
    b = B.bearings(c.by_id["cm-osm-node-6972562985"], c)
    check("the same record gives the same lines twice", a == b)

    print("render")
    esc = lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")  # noqa: E731

    def bi(th, en, sep=" · ", raw=False):
        e = (lambda s: s) if raw else esc
        return f'<span class="bi"><span class="th">{e(th)}</span><span class="en">{e(en)}</span></span>'

    html = B.row_html(shop, bi, esc, href=lambda rec, prov: f"{rec['id']}.html", c=c)
    check("row renders a dt/dd", html.startswith("<dt>") and "</dd>" in html)
    check("landmark is linked to its own page", 'href="cm-osm-way-89039067.html"' in html, html[:200])
    check("no reading line under a bearing", 'class="roman"' not in html)
    check("a record with nothing to say renders nothing",
          B.row_html({"id": "cm-test-empty", "province": "cm", "geoPrecision": "needs-pin", "attrs": {}}, bi, esc, c=c) == "")

    print()
    if FAILED:
        print(f"FAILED {len(FAILED)}:")
        for f in FAILED:
            print("  -", f)
        sys.exit(1)
    print("all bearings checks pass")


if __name__ == "__main__":
    main()
