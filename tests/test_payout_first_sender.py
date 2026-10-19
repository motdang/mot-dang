#!/usr/bin/env python3
"""payout_shoup.py accept refuses a row whose link a different sender sent first.

    python3 tests/test_payout_first_sender.py

The case that happened (Nan 2026-10-19): dot sent the Samoeng junction row on
17 Oct 23:19 Bangkok through /suggest (suggestion 236cf186), linking the
Highways Office notice chiangmai.doh.go.th/content/9895-<Thai slug>. Briefcraft
Lab emailed the same row on 18 Oct; it was accepted as bc-samoeng and paid, and
nobody looked at the queue. Held here, on scratch copies of the ledger, the
link file and the queue:

  1. the slugged and bare links are one link;
  2. accepting bc-samoeng refuses, naming dot and the time dot sent it;
  3. --also-credited dot records it, links and all;
  4. with dot credited first, bc-samoeng goes in as a second credit;
  5. the wall counts table rows: six ledger entries, five rows;
  6. bounty_ask.py's go line for a later sender of the link says dot came first.
"""
import contextlib
import io
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "importers"))
import payout_shoup as ps   # noqa: E402
import bounty_ask           # noqa: E402

SLUG = ("https://chiangmai.doh.go.th/content/9895-แจ้งเบี่ยงการจราจร-บริเวณสี่แยกสะเมิง-"
        "จุดตัดทางหลวงหมายเลข-121-ตัด-ทางหลวงหมายเลข-108")
BARE = "https://chiangmai.doh.go.th/content/9895"
DOT = {"id": "236cf186-013e-48c4-8a6a-5fcfbc4995f0", "kind": "other", "page": "/roadworks/",
       "what": "+<tr><td>แยกสะเมิง ทล.121 / ทล.108</td><td><a href=\"%s\">Office of Highways 1</a></td></tr>" % SLUG,
       "from": "bot:dot address-withheld; payout address to follow if used",
       "status": "new", "createdAt": "2026-10-17T16:19:27.939Z"}
BC = [("bc-san-pa-tong", "แยกสันป่าตอง ทล.108 · San Pa Tong junction", "https://www.thaigov.go.th/th/news/167134"),
      ("bc-route-131", "ถนนเชื่อม ทล.131 เชียงราย · Route 131 connector, Chiang Rai", "https://www.thaigov.go.th/th/news/166434"),
      ("bc-ton-pao", "แยกต้นเปาพัฒนา ทล.121×1006 · Ton Pao Phatthana junction", "https://chiangmai.doh.go.th/content/8546"),
      ("bc-nam-lat", "ซอยน้ำลัด 1 เชียงราย · Nam Lat Soi 1, Chiang Rai",
       "https://chiangrai.prd.go.th/th/content/category/detail/id/9/iid/549684")]
SAMOENG = "แยกสะเมิง ทล.121×108 · Samoeng junction"


def scratch(tmp, with_dot=False):
    ps.LEDGER = os.path.join(tmp, "payouts.tsv")
    ps.SRCS = os.path.join(tmp, "payout-srcs.tsv")
    ps.SUGG = os.path.join(tmp, "suggestions.json")
    ps.SEEN = os.path.join(tmp, "roadworks-suggestions.jsonl")
    rs = [{"accepted": "2026-10-18", "program": "roadworks", "who": "Briefcraft Lab", "ref": ref, "baht": "100",
           "week": "2026-10-12", "state": "approved", "what": what} for ref, what, _ in BC]
    srcs = [(ref, url) for ref, _, url in BC]
    if with_dot:
        rs.append({"accepted": "2026-10-19", "program": "roadworks", "who": "dot", "ref": "dot-samoeng", "baht": "100",
                   "week": "2026-10-19", "state": "approved", "what": SAMOENG + " (sent first, 17 Oct)"})
        srcs.append(("dot-samoeng", SLUG))
    ps.save(rs)
    with open(ps.SRCS, "w", encoding="utf-8") as f:
        f.write("".join("%s\t%s\n" % x for x in srcs))
    with open(ps.SUGG, "w", encoding="utf-8") as f:
        json.dump({"fetched": "2026-10-19T00:00:00Z", "suggestions": []}, f)
    with open(ps.SEEN, "w", encoding="utf-8") as f:   # dot's row has left the live queue: the archive still has it
        f.write(json.dumps(DOT, ensure_ascii=False) + "\n")


def accept_bc(**kw):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        ps.accept("roadworks", "Briefcraft Lab", "bc-samoeng", SAMOENG, "100", srcs=[BARE],
                  sent="2026-10-18T09:00:00+00:00", **kw)
    return out.getvalue()


def main():
    assert ps.norm_url(SLUG) == ps.norm_url(BARE) == "chiangmai.doh.go.th/content/9895"
    assert ps.norm_url("http://www.thaigov.go.th/th/news/167134/") == ps.norm_url("https://thaigov.go.th/th/news/167134")

    with tempfile.TemporaryDirectory() as tmp:
        scratch(tmp)
        try:
            accept_bc()
            raise AssertionError("bc-samoeng was recorded with dot uncredited")
        except SystemExit as e:
            msg = str(e)
        assert "REFUSED" in msg and "bot:dot" in msg and "2026-10-17 16:19" in msg and "236cf186" in msg, msg
        assert not any(r["ref"] == "bc-samoeng" for r in ps.rows())

        try:
            accept_bc(also="Briefcraft")              # naming someone else is not naming dot
            raise AssertionError("--also-credited with the wrong name was let through")
        except SystemExit:
            pass

        out = accept_bc(also="dot")
        assert "also credited: dot" in out, out
        assert ("bc-samoeng", BARE) in ps.src_rows()

    with tempfile.TemporaryDirectory() as tmp:
        scratch(tmp, with_dot=True)
        out = accept_bc()
        assert "second credit" in out and "dot-samoeng" in out, out
        assert len(ps.rows()) == 6
        wall = ps.wall("roadworks")
        assert "%d of the rows above came from bots" % 5 in wall, wall
        assert "<b>dot</b> · 1" in wall and "<b>Briefcraft Lab</b> · 5" in wall, wall

        later = dict(DOT, id="aaaaaaaa-0000", createdAt="2026-10-18T09:00:00Z",
                     **{"from": "bot:briefcraft-lab address-withheld"})
        note = bounty_ask.first_note(later)
        assert "dot sent first on 2026-10-17" in note and "236cf186" in note, note
        assert bounty_ask.first_note(DOT) == "", bounty_ask.first_note(DOT)

    print("ok — payout first-sender check holds")


if __name__ == "__main__":
    main()
