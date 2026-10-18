#!/usr/bin/env python3
"""Leads for motdang.net/roadworks, found in the news each Monday.

Nan, 2026-10-18, after Briefcraft Lab's emailed San Pa Tong row: "maybe create
a bot like this for myself". This is the finding half. It asks Google News
(Thai and English, last 30 days) for roadworks, closures, underpasses and
junction bridges in Chiang Mai and Chiang Rai, drops what it has seen before
and what the stub already links, and writes the rest to
_incoming/roadworks_scout/<date>.txt. When there are leads and no scout line
is waiting, it puts one "say go" line in QUEUE A. On go, a session opens each
lead, finds the primary notice (thaigov.go.th, Rural Roads, Highways, the
province) and adds the rows that hold to assets/roadworks/stub.html and
index.html. Nothing here publishes.

    python3 importers/roadworks_scout.py          # Mondays only (pull_inbox.sh)
    python3 importers/roadworks_scout.py --now    # any day
    python3 importers/roadworks_scout.py --dry    # print leads, write nothing
"""
import datetime, os, re, subprocess, sys, urllib.parse
import xml.etree.ElementTree as ET

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUB = os.path.join(REPO, "assets", "roadworks", "stub.html")
OUT = os.path.join(REPO, "_incoming", "roadworks_scout")
SEEN = os.path.expanduser("~/.claude/state/roadworks-scout-seen.tsv")
QUEUE = os.path.expanduser("~/Desktop/1 — NEXT UP/QUEUE.txt")
A_HEADER = "A — SAY GO."
MARK = "ROADWORKS SCOUT"

PLACES = {"เชียงใหม่": "Chiang Mai", "เชียงราย": "Chiang Rai"}
TH_TERMS = ["ก่อสร้าง ถนน", "ปิดการจราจร", "ทางลอด", "สะพานข้ามแยก", "ทางแยกต่างระดับ", "ซ่อมถนน", "ขยายถนน"]
EN_TERMS = ["road closure", "roadworks", "underpass", "flyover"]
# a title must name the work, and the place unless the source is local
WORK = re.compile(r"ก่อสร้าง|ทางลอด|สะพาน|ต่างระดับ|ปิดการจราจร|ปิดถนน|ซ่อมถนน|ซ่อมแซม|ขยายถนน|ขยายช่องจราจร|ผิวจราจร|road ?works|road closure|underpass|flyover|construction", re.I)
NOISE = re.compile(r"รถไฟ|คอนโด|บ้านเดี่ยว|โครงการบ้าน|รีวิว|ไหว้|โรงพยาบาล|รพ\.|ห้าง|มอลล์|รถชน|ชนกัน|ถูกชน|พลิกคว่ำ|เสียชีวิต|ยาบ้า|ท่วม|พายุ|อุบัติเหตุ|train|condo|temple|crash", re.I)


def fetch(q, lang):
    hl, gl, ceid = ("th", "TH", "TH:th") if lang == "th" else ("en", "TH", "TH:en")
    url = "https://news.google.com/rss/search?q=%s&hl=%s&gl=%s&ceid=%s" % (
        urllib.parse.quote(q + " when:30d"), hl, gl, ceid)
    # curl, not urllib: Google answers python-urllib's user agent unevenly
    r = subprocess.run(["curl", "-s", "-m", "20", "-A", "Mozilla/5.0", url],
                       capture_output=True)
    try:
        root = ET.fromstring(r.stdout)
    except ET.ParseError:
        return []
    items = []
    for i in root.iter("item"):
        items.append({
            "title": (i.findtext("title") or "").strip(),
            "link": (i.findtext("link") or "").strip(),
            "source": (i.findtext("source") or "").strip(),
            "date": (i.findtext("pubDate") or "")[5:16],
        })
    return items


def leads():
    found = {}
    for th, en in PLACES.items():
        qs = [(th + " " + t, "th", th) for t in TH_TERMS] + [(en + " " + t, "en", en) for t in EN_TERMS]
        for q, lang, place in qs:
            for it in fetch(q, lang):
                t = it["title"]
                if not WORK.search(t) or NOISE.search(t):
                    continue
                if th not in t and en.lower() not in t.lower():
                    continue
                key = re.sub(r"\s+-\s+[^-]+$", "", t)[:90]   # same story, other outlet
                if key not in found:
                    it["place"] = PLACES.get(place, place)
                    found[key] = it
    return list(found.values())


def main():
    dry = "--dry" in sys.argv
    if not (dry or "--now" in sys.argv) and datetime.date.today().weekday() != 0:
        return 0
    seen = set()
    if os.path.exists(SEEN):
        seen = {l.split("\t")[0] for l in open(SEEN, encoding="utf-8") if l.strip()}
    stub = open(STUB, encoding="utf-8").read()
    new = [l for l in leads() if l["link"] not in seen and l["title"][:60] not in seen
           and l["link"] not in stub]
    # a Facebook post is a lead, never a source for the page; list them last
    new.sort(key=lambda l: (l["source"] == "Facebook", l["place"], l["date"]))
    if dry:
        for l in new:
            print("%s | %s | %s | %s" % (l["date"], l["place"], l["source"], l["title"][:100]))
        return 0
    if not new:
        return 0
    today = datetime.date.today().isoformat()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, today + ".txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write("Roadworks leads %s. Open each, find the primary notice, add what holds.\n\n" % today)
        for n, l in enumerate(new, 1):
            f.write("%d. %s · %s · %s\n   %s\n   %s\n\n" % (n, l["date"], l["place"], l["source"], l["title"], l["link"]))
    with open(SEEN, "a", encoding="utf-8") as f:
        for l in new:
            f.write("%s\t%s\n%s\t%s\n" % (l["link"], today, l["title"][:60], today))
    q = open(QUEUE, encoding="utf-8").read().split("\n")
    if any(MARK in l and "SHIPPED" not in l for l in q):
        return 0   # last week's line is still waiting; this week's file sits beside it
    i = next(n for n, l in enumerate(q) if l.startswith(A_HEADER))
    q[i + 2:i + 2] = ["- %s (added %s, her ask 2026-10-18). %d news leads for motdang.net/roadworks "
                      "in mot-dang/_incoming/roadworks_scout/. Say go and I check each against its "
                      "government notice and put the rows that hold live, with their links."
                      % (MARK, today, len(new))]
    open(QUEUE, "w", encoding="utf-8").write("\n".join(q))
    return 0


if __name__ == "__main__":
    sys.exit(main())
