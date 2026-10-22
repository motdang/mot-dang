#!/usr/bin/env python3
"""Write fleetsearch/bench_cases.json, the fixed searches /find is scored on.

Nan, 2026-10-22: "motdang has systemically bad search results and coverage for
museums and libraries." The plan (notes/museums-libraries-search-2026-10-22.txt)
scores every ranking change on the same searches before it ships:

  name   a place by its own name; its page should be in the top `top`.
  kind   a kind of place (museum, hospital, วัด); a place of that kind should be
         near the top, and no page-2+ list should be in the top 10.
  spec   museums and libraries by name, spelling and alias (any of `want`).

Sources: the 262-name sample run live on 2026-10-22 (recall), the 405 known
places of the same day's audit (_incoming/search-audit-2026-10-22), and the
kind and spec lists below.

  python3 fleetsearch/bench_build.py --recall <name_recall.tsv>
"""

from __future__ import annotations

import argparse
import csv
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "fleetsearch" / "bench_cases.json"
AUDIT = ROOT / "_incoming" / "search-audit-2026-10-22" / "queries_known.json"
SITE = "https://motdang.net/"

# A kind is its shelf or its name: a wat filed under community (Overture's
# religious_organization rule) still answers "temple". Filing is scored apart.
MUSEUM = {"cat": ["museums-galleries"], "name": "museum|พิพิธภัณฑ|gallery|หอศิลป"}
WAT = {"cat": ["wat"], "name": "^(wat|วัด)|temple"}
MARKET = {"cat": ["market"], "name": "market|ตลาด|กาด"}
PHARM = {"sub": ["essentials/pharmacy", "medical/pharmacy"], "name": "pharma|drug|ร้านยา|ขายยา|เภสัช"}
SCHOOL = {"cat": ["school"], "name": "school|โรงเรียน"}
HOSP = {"sub": ["medical/hospital"], "name": "hospital|โรงพยาบาล|รพ\\."}
LIBRARY = {"name": "ห้องสมุด|หอสมุด|librar"}
CM = [18.7883, 98.9853]

# query, accept, extra (prov, params)
KINDS = [
    ("coffee", {"sub": ["food/cafe"]}), ("กาแฟ", {"sub": ["food/cafe"]}),
    ("hospital", HOSP), ("โรงพยาบาล", HOSP),
    ("pharmacy", PHARM), ("ร้านขายยา", PHARM),
    ("temple", WAT), ("วัด", WAT),
    ("dentist", {"sub": ["medical/dentist"]}), ("ทันตแพทย์", {"sub": ["medical/dentist"]}),
    ("school", SCHOOL), ("โรงเรียน", SCHOOL),
    ("gym", {"sub": ["sport/gym"]}), ("ฟิตเนส", {"sub": ["sport/gym"]}),
    ("market", MARKET), ("ตลาด", MARKET),
    ("hotel", {"cat": ["hotel"]}), ("โรงแรม", {"cat": ["hotel"]}),
    ("park", {"sub": ["parks/park"]}), ("สวนสาธารณะ", {"sub": ["parks/park"]}),
    ("bank", {"sub": ["essentials/bank"]}), ("ธนาคาร", {"sub": ["essentials/bank"]}),
    ("post office", {"sub": ["essentials/post"]}), ("ไปรษณีย์", {"sub": ["essentials/post"]}),
    ("laundry", {"sub": ["essentials/laundry"]}), ("ร้านซักรีด", {"sub": ["essentials/laundry"]}),
    ("car repair", {"sub": ["repair/auto"]}), ("อู่ซ่อมรถ", {"sub": ["repair/auto"]}),
    ("vet", {"sub": ["pets/vet"]}), ("สัตวแพทย์", {"sub": ["pets/vet"]}),
    ("massage", {"cat": ["massage"], "sub": ["beauty/beauty-spa"]}), ("นวด", {"cat": ["massage"], "sub": ["beauty/beauty-spa"]}),
    ("police station", {"name": "police|ตำรวจ"}), ("สถานีตำรวจ", {"name": "police|ตำรวจ"}),
    ("bookshop", {"name": "book|หนังสือ"}), ("ร้านหนังสือ", {"name": "book|หนังสือ"}),
    ("museum", MUSEUM), ("museums", MUSEUM), ("พิพิธภัณฑ์", MUSEUM), ("art museum", MUSEUM),
    ("art gallery", MUSEUM), ("หอศิลป์", MUSEUM), ("museum open monday", MUSEUM),
    ("museum chiang rai", MUSEUM, {"prov": "cr"}), ("พิพิธภัณฑ์ เชียงราย", MUSEUM, {"prov": "cr"}),
    ("museums near me", MUSEUM, {"params": {"near": "%.4f,%.4f" % tuple(CM)}}),
    ("library", LIBRARY), ("libraries", LIBRARY), ("ห้องสมุด", LIBRARY), ("public library", LIBRARY),
    ("library chiang rai", LIBRARY, {"prov": "cr"}), ("library open sunday", LIBRARY),
    ("coffee near me", {"sub": ["food/cafe"]}, {"params": {"near": "%.4f,%.4f" % tuple(CM)}}),
    ("hospital near me", HOSP, {"params": {"near": "%.4f,%.4f" % tuple(CM)}}),
    ("pharmacy open sunday", PHARM),
    ("temple chiang rai", WAT, {"prov": "cr"}), ("วัด เชียงราย", WAT, {"prov": "cr"}),
    ("hotel chiang rai", {"cat": ["hotel"]}, {"prov": "cr"}), ("market chiang rai", MARKET, {"prov": "cr"}),
]

P = lambda *paths: [SITE + p for p in paths]
ART = P("cm/p/chiang-mai-city-art-cultural-center-17998804.html")
DAM = P("cr/p/0118768692.html", "cr/p/baan-dam-museum-393447653.html",
        "cr/p/baandum-museum-the-black-temple-454146487841723905232.html")
NAT_CM = P("cm/p/chiang-mai-national-museum-200414775.html")
NAT_CR = P("cr/p/chiang-saen-national-museum-2313723117.html")
OPIUM = P("cr/p/1365411436.html", "cr/p/the-hall-of-opium-137648101.html")
HIST = P("cm/p/chiang-mai-historical-centre-4501920590.html", "cm/p/chiang-mai-historical-centre-4750233535.html")
CMULIB = P("cm/p/10593235393.html", "cm/p/chiang-mai-university-main-library-6012305497.html")
TCDC = P("cm/p/tcdc-chiang-mai-672587607.html")
HANGDONG = P("cm/p/1064323064999156190838.html")
NATLIB = P("cm/p/ratchamangkhalaphisek-national-library-chiang-mai-301655695.html", "cm/p/nl-cnx-82467908409490585029.html")
MFL = P("cr/p/4206198319.html", "cr/p/mae-fah-luang-art-and-culture-park-384155064.html")
MFULIB = P("cr/p/6295384389596245673.html")
RONGKHUN = P("cr/p/wat-rong-khun-white-temple-chiang-rai-thailand-1464964486495396688040.html",
             "cr/p/533081121884509825552809981.html", "cr/p/51714568845586583513182.html")

# query, want (any of), top; "all" = every url of want in the top
SPEC = [
    ("Chiang Mai City Arts and Cultural Centre", ART, 3), ("Chiang Mai City Art and Culture Center", ART, 3),
    ("หอศิลปวัฒนธรรมเมืองเชียงใหม่", ART, 3),
    ("Baan Dam", DAM, 3), ("Black House Chiang Rai", DAM, 3), ("Black House museum", DAM, 3), ("บ้านดำ", DAM, 3),
    ("national museum", NAT_CM + NAT_CR, 3, "all"), ("พิพิธภัณฑสถานแห่งชาติ", NAT_CM + NAT_CR, 3, "all"),
    ("Chiang Mai national museum", NAT_CM, 1), ("Chiang Saen National Museum", NAT_CR, 1),
    ("Highland People Discovery Museum", P("cm/p/highland-people-discovery-museum-243766515.html"), 1),
    ("Hall of Opium", OPIUM, 3), ("หอฝิ่น", OPIUM, 3),
    ("Oub Kham Museum", P("cr/p/oub-kham-museum-992101976.html"), 1),
    ("Lanna Folklife Museum", P("cm/p/lanna-folklife-museum-261338789.html"), 1),
    ("Chiang Mai Historical Centre", HIST, 3), ("Chiang Mai Historical Center", HIST, 3),
    ("Bank of Thailand Museum", P("cm/p/bank-of-thailand-museum-103286175.html"), 1),
    ("insect museum", P("cm/p/museum-of-world-insects-and-natural-wonders-481787812.html"), 3),
    ("Dara Pirom Palace", P("cm/p/dara-phirom-palace-museum-251722572.html"), 3),
    ("Mae Fah Luang Art and Culture Park", MFL, 3),
    ("Chiang Mai University library", CMULIB, 3), ("CMU library", CMULIB, 3),
    ("TCDC Chiang Mai", TCDC, 1), ("TCDC library", TCDC, 3),
    ("Hang Dong public library", HANGDONG, 3), ("ห้องสมุดประชาชนอำเภอหางดง", HANGDONG, 1),
    ("national library chiang mai", NATLIB, 3), ("Mae Fah Luang University library", MFULIB, 3),
    ("White Temple", RONGKHUN, 3), ("Wat Rong Khun", RONGKHUN, 3),
    ("CMU art museum", P("cm/p/chiang-mai-university-art-museum-21007946027679352367.html"), 3),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--recall", required=True, help="name_recall.tsv from the 2026-10-22 live run")
    ap.add_argument("--no-audit", action="store_true", help="write the set without the audit's 405 places")
    a = ap.parse_args()
    paths = json.loads((ROOT / "cache" / "place_paths.json").read_text())
    cases: list[dict] = []
    for r in csv.DictReader(open(a.recall, encoding="utf-8"), delimiter="\t"):
        if r["expected_url"]:
            cases.append({"set": "name", "q": r["q"], "want": [r["expected_url"]], "top": 1,
                          "note": r.get("settled_miss_cause") or ""})
    if not AUDIT.exists() and not a.no_audit:
        raise SystemExit(f"no {AUDIT}: a set without it scores on fewer searches; pass --no-audit to write it anyway")
    if AUDIT.exists() and not a.no_audit:
        for k in json.loads(AUDIT.read_text()):
            t = k["truth"]
            path = paths.get(t["id"]) or f"{t['prov']}/p/{t['slug']}.html"
            cases.append({"set": "audit", "q": k["q"], "want": [SITE + path], "top": 1, "note": k["kind"]})
    for row in KINDS:
        q, acc = row[0], row[1]
        extra = row[2] if len(row) > 2 else {}
        cases.append({"set": "kind", "q": q, "accept": acc, **extra})
    for row in SPEC:
        q, want, top = row[0], row[1], row[2]
        c = {"set": "spec", "q": q, "want": want, "top": top}
        if len(row) > 3:
            c["all"] = True
        cases.append(c)
    OUT.write_text(json.dumps(cases, ensure_ascii=False, indent=0) + "\n")
    by = {}
    for c in cases:
        by[c["set"]] = by.get(c["set"], 0) + 1
    print(OUT, by)


if __name__ == "__main__":
    main()
