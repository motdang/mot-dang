#!/usr/bin/env python3
"""List places that probably appear twice, as a sheet a person labels.

A place often has one page per data source (an OSM point, a directory row, a
register row). The finder pairs records that share a phone number or a name
and stand close together, ranks the pairs, and writes an .xlsx a person can
fill in on a phone: Same / Different / Not sure in the first column.

A pair is listed when one of these holds (all need pins on both records):

  phone     the same phone number, within 150 m
  name      the same name (any of name, nameTh, nameEn), within 60 m, or 120 m
            when four or fewer records carry that name
  similar   names that read alike once the Thai one is romanised (Khamsaen
            Cafe / คำแสน คาเฟ่), within 40 m; numbered names that differ
            (Tower 7 / Tower 9) are left out

Already joined pairs (data/curated/merges.json), pairs called different
(data/curated/not_same.json) and pairs listed on an earlier sheet are not
listed again, so a weekly run writes only what is new.

    python3 importers/find_dupes.py                  # writes the sheet
    python3 importers/find_dupes.py --dry            # counts only
    python3 importers/find_dupes.py --apply returned.xlsx --by Michael

--apply reads the labels back: "Same" pairs go into merges.json as
{keep_id: [drop_ids]}, "Different" pairs into not_same.json. build.py then
forwards the dropped record's old page address to the kept page
(write_moved_stubs). The sheet lives in _incoming/dupes/ with ledger.tsv,
the list of pairs already put on a sheet.

--data DIR reads data/ and cache/ from another checkout (this repo's own by
default). --paths FILE or --server takes page addresses from a place_paths.json
(the server's copy is the one the live site was built from).
"""
import argparse
import collections
import datetime
import difflib
import itertools
import json
import math
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://motdang.net/"
SERVER = "nan@motdang-server"
SERVER_PATHS = "/srv/mot-dang/cache/place_paths.json"

PHONE_M = 150     # same phone, pins this close
NAME_M = 60       # same name, pins this close
NAME_WIDE_M = 120 # ... when 4 or fewer records carry the name (a gate drawn as a point and as an outline)
DISTINCT = 4
LIKE_M = 40       # similar name, pins this close
LIKE_MIN = 0.85   # romanised-name ratio
MAX_GROUP = 400   # a phone or name shared by more records than this is skipped
SHARED_PHONE = 4  # a phone on this many records is a switchboard, not a clue
COMMON_NAME = 12  # a name on this many records is a common name

SAME = "ที่เดียวกัน · Same"
DIFF = "คนละที่ · Different"
UNSURE = "ไม่แน่ใจ · Not sure"

THAI = re.compile(r"[฀-๿]")
ID_IN_TEXT = re.compile(r'"((?:cm|cr|pth|lpn)-[^"\n]{3,160})"')


# ---------------------------------------------------------------- helpers

def phone_keys(s):
    """National numbers in a phone string: 8 digits (landline) or 9 (mobile)."""
    out = set()
    for part in re.split(r"[,;/]|หรือ|\bor\b", s or ""):
        d = re.sub(r"\D", "", part)
        if d.startswith("66") and len(d) >= 10:
            d = d[2:]
        elif d.startswith("0"):
            d = d[1:]
        if len(d) in (8, 9):
            out.add(d)
    return out


def name_key(s):
    s = unicodedata.normalize("NFC", s or "").lower()
    return re.sub(r"[^a-z0-9ก-๙]+", "", s)


def metres(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lng"], b["lat"], b["lng"]))
    h = (math.sin((la2 - la1) / 2) ** 2
         + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2)
    return 6371000 * 2 * math.asin(math.sqrt(h))


def pair_id(a, b):
    return "|".join(sorted((a, b)))


def id_source(rid):
    """cm-ovt-<uuid> -> ovt; cm-curated-mend-14114 -> curated/mend."""
    p = rid.split("-")
    if len(p) < 2:
        return ""
    return p[1] + ("/" + p[2] if p[1] == "curated" and len(p) > 2 else "")


def slim(r):
    th = (r.get("nameTh") or "").strip()
    en = (r.get("nameEn") or "").strip()
    nm = (r.get("name") or "").strip()
    if not th and THAI.search(nm):
        th = nm
    if not en and nm and not THAI.search(nm):
        en = nm
    shown = " · ".join(dict.fromkeys(x for x in (th, en) if x)) or nm or r["id"]
    attrs = r.get("attrs") or {}
    src = next((s for s in (r.get("sources") or []) if s.get("type") != "derived"), {})
    cats = sorted(set((r.get("cat") or []) + (r.get("sub") or [])))
    fields = sum(1 for k in ("nameTh", "nameEn", "phone", "website", "hours", "address")
                 if r.get(k))
    pinned = r.get("lat") is not None and r.get("lng") is not None
    return {
        "id": r["id"], "prov": r.get("province") or r["id"].split("-")[0],
        "shown": shown, "names": [x for x in (nm, th, en) if x],
        "lat": r.get("lat") if pinned else None, "lng": r.get("lng") if pinned else None,
        "phone": r.get("phone") or "", "phones": phone_keys(r.get("phone")),
        "cats": cats, "prec": r.get("geoPrecision") or "",
        "centroid": "centroid" in str(attrs.get("pinVia") or ""),
        "fields": fields,
        "source": " · ".join(dict.fromkeys(
            x for x in (src.get("type"), src.get("via"), id_source(r["id"])) if x)),
    }


def load_records(data_root):
    out = []
    for f in sorted((data_root / "data" / "canonical").glob("*.json")):
        out += [slim(r) for r in json.loads(f.read_text(encoding="utf-8"))]
    return out


def load_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def load_paths(data_root, paths_file, server):
    if server:
        try:
            cp = subprocess.run(
                ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", SERVER,
                 "cat " + SERVER_PATHS], capture_output=True, timeout=180)
            if cp.returncode == 0:
                return json.loads(cp.stdout.decode("utf-8"))
            print("  server paths: ssh failed, using the local file", file=sys.stderr)
        except (OSError, ValueError, subprocess.SubprocessError):
            print("  server paths: not reachable, using the local file", file=sys.stderr)
    return load_json(paths_file or data_root / "cache" / "place_paths.json", {})


def curated_refs(data_root, wanted):
    """{id: number of curated files, apart from the merge files and additions-*,
    that name it}. A record other curated files point at is the better keeper."""
    refs = collections.defaultdict(set)
    for f in sorted((data_root / "data" / "curated").glob("*.json")):
        if f.name in ("merges.json", "not_same.json") or f.name.startswith("additions-"):
            continue
        try:
            text = f.read_text(encoding="utf-8")
        except OSError:
            continue
        for rid in set(ID_IN_TEXT.findall(text)):
            if rid in wanted:
                refs[rid].add(f.name)
    return refs


# ---------------------------------------------------------- name likeness

class Likeness:
    """How alike two records' names read, Thai names romanised by namejoin."""

    def __init__(self, data_root):
        self.ok = False
        self.cache = {}
        try:
            sys.path.insert(0, str(data_root))
            import namejoin  # noqa: E402
            self.nj = namejoin
            self.ok = True
        except Exception as e:  # missing module or lexicon: the reason is off
            print(f"  similar names off: {e}", file=sys.stderr)

    def variants(self, r):
        v = self.cache.get(r["id"])
        if v is None:
            v = []
            for s in dict.fromkeys(r["names"]):
                rom = self.nj.romanise(s).lower()
                words = [w for w in re.findall(r"[a-z0-9]+", rom) if w not in self.nj.GENERIC]
                v.append((name_key(s), "".join(words), set(re.findall(r"\d+", s))))
            self.cache[r["id"]] = v
        return v

    def ratio(self, a, b):
        """0..1; 1 when a name matches exactly, 0 when the digits disagree."""
        if not self.ok:
            return 0.0
        best = 0.0
        for ka, ra, da in self.variants(a):
            for kb, rb, db in self.variants(b):
                if len(ka) >= 4 and ka == kb:
                    return 1.0
                if da and db and da != db:
                    continue
                if len(ra) < 4 or len(rb) < 4:
                    continue
                if ra == rb:
                    s = 0.97
                else:
                    sm = difflib.SequenceMatcher(None, ra, rb)
                    if sm.real_quick_ratio() < LIKE_MIN or sm.quick_ratio() < LIKE_MIN:
                        continue
                    s = sm.ratio()
                best = max(best, s)
        return best


# -------------------------------------------------------------- the pairs

def near(a, b, m):
    """Cheap box test, then the exact distance. None when farther than m."""
    if abs(a["lat"] - b["lat"]) > m / 111000.0 + 1e-6:
        return None
    if abs(a["lng"] - b["lng"]) > m / 104000.0 + 1e-6:
        return None
    d = metres(a, b)
    return d if d <= m else None


def find_pairs(recs, skip):
    """{pair_id: {a, b, d, why: set}} plus a tally of what was skipped."""
    pairs = {}
    skipped = collections.Counter()
    by_phone = collections.defaultdict(list)
    by_name = collections.defaultdict(list)
    pinned = [r for r in recs if r["lat"] is not None]
    for r in pinned:
        for p in r["phones"]:
            by_phone[p].append(r)
        if not r["centroid"]:
            for k in {name_key(n) for n in r["names"]}:
                if len(k) >= 4:
                    by_name[k].append(r)

    def put(a, b, d, why, note=None):
        pid = pair_id(a["id"], b["id"])
        if pid in skip or a["id"] == b["id"] or a["prov"] != b["prov"]:
            return
        e = pairs.get(pid)
        if e is None:
            a, b = (a, b) if a["id"] < b["id"] else (b, a)
            e = pairs[pid] = {"a": a, "b": b, "d": d, "why": set(), "note": {}}
        e["why"].add(why)
        if note:
            e["note"][why] = note

    for p, group in by_phone.items():
        if len(group) > MAX_GROUP:
            skipped["phone shared by over %d records" % MAX_GROUP] += 1
            continue
        for a, b in itertools.combinations(group, 2):
            d = near(a, b, PHONE_M)
            if d is not None:
                put(a, b, d, "phone", (p, len(group)))
    for k, group in by_name.items():
        if len(group) > MAX_GROUP:
            skipped["name on over %d records" % MAX_GROUP] += 1
            continue
        reach = NAME_WIDE_M if len(group) <= DISTINCT else NAME_M
        for a, b in itertools.combinations(group, 2):
            d = near(a, b, reach)
            if d is not None:
                put(a, b, d, "name", len(group))
    return pairs, skipped, pinned, put


def find_similar(pairs, pinned, like, put):
    """Add pairs within LIKE_M whose names read alike; score the rest."""
    if not like.ok:
        return
    for e in pairs.values():
        e["sim"] = like.ratio(e["a"], e["b"])
    cell = 0.0004
    grid = collections.defaultdict(list)
    for r in pinned:
        if not r["centroid"]:
            grid[(int(r["lat"] / cell), int(r["lng"] * 0.95 / cell))].append(r)
    for (i, j), here in grid.items():
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                there = grid.get((i + di, j + dj))
                if not there:
                    continue
                for a in here:
                    for b in there:
                        if a["id"] >= b["id"]:
                            continue
                        if pair_id(a["id"], b["id"]) in pairs:
                            continue
                        d = near(a, b, LIKE_M)
                        if d is None:
                            continue
                        s = like.ratio(a, b)
                        if s >= LIKE_MIN:
                            put(a, b, d, "similar")
                            e = pairs.get(pair_id(a["id"], b["id"]))
                            if e is not None:
                                e["sim"] = s


def keeper_score(r, paths, refs):
    return (r["fields"] * 2 + (3 if r["prec"] == "exact" else 0)
            + (2 if r["id"] in paths else 0) + 2 * min(3, len(refs.get(r["id"], ()))))


def pick_keeper(a, b, paths, refs):
    """'A' or 'B': the record that holds more, then the lower id."""
    sa, sb = keeper_score(a, paths, refs), keeper_score(b, paths, refs)
    if sa != sb:
        return "A" if sa > sb else "B"
    return "A" if a["id"] < b["id"] else "B"


def score(e, paths):
    """Points toward 'the same place', and the words for them."""
    a, b, d, why = e["a"], e["b"], e["d"], e["why"]
    pts, words = 0, []
    if "phone" in why:
        num, n = e["note"]["phone"]
        pts += 45 if n < SHARED_PHONE else 25
        words.append("เบอร์เดียวกัน · same phone" + (f" (on {n} records)" if n >= SHARED_PHONE else ""))
    if "name" in why:
        n = e["note"]["name"]
        pts += 45 if n < COMMON_NAME else 15
        words.append("ชื่อเหมือนกัน · same name" + (f" (a common name, {n} records)" if n >= COMMON_NAME else ""))
    elif e.get("sim", 0) >= 1.0:
        pts += 40
        words.append("ชื่อเหมือนกัน · same name")
    elif e.get("sim", 0) >= LIKE_MIN:
        pts += 30 if e["sim"] >= 0.97 else 25 if e["sim"] >= 0.9 else 20
        words.append("ชื่อคล้ายกัน · similar name")
    pts += 15 if d <= 5 else 12 if d <= 15 else 8 if d <= 30 else 4 if d <= 60 else 0
    if a["cats"] and b["cats"]:
        pts += 5 if set(a["cats"]) & set(b["cats"]) else -8
    if a["centroid"] or b["centroid"]:
        words.append("หมุดเป็นจุดกลางตำบล · a pin is a district centre")
    pa, pb = paths.get(a["id"]), paths.get(b["id"])
    if pa and pa == pb:
        words.append("นำเข้าซ้ำ ใช้หน้าเดียวกันอยู่แล้ว · imported twice, already one page address")
    return pts, words


def band(pts):
    if pts >= 85:
        return "แน่นอน · Sure"
    if pts >= 60:
        return "น่าจะ · Likely"
    return "อาจใช่ · Maybe"


# ----------------------------------------------------------------- ledger

LEDGER_HEAD = ["pair", "first_seen", "sheet", "why", "score", "label", "labeled"]


def read_ledger(path):
    rows = {}
    if Path(path).exists():
        lines = Path(path).read_text(encoding="utf-8").splitlines()
        for ln in lines[1:]:
            f = ln.split("\t")
            f += [""] * (len(LEDGER_HEAD) - len(f))
            rows[f[0]] = dict(zip(LEDGER_HEAD, f))
    return rows


def write_ledger(path, rows):
    out = ["\t".join(LEDGER_HEAD)]
    for k in sorted(rows):
        out.append("\t".join(str(rows[k].get(h, "")) for h in LEDGER_HEAD))
    Path(path).write_text("\n".join(out) + "\n", encoding="utf-8")


# ------------------------------------------------------------------ sheet

COLUMNS = [  # (Thai, English, width)
    ("ตอบ", "Label", 22), ("ลำดับ", "#", 6), ("ความมั่นใจ", "Match", 14),
    ("ชื่อ A", "Name A", 36), ("ชื่อ B", "Name B", 36), ("ห่างกัน (ม.)", "Metres apart", 11),
    ("โทร A", "Phone A", 18), ("โทร B", "Phone B", 18),
    ("หน้า A", "Page A", 12), ("หน้า B", "Page B", 12), ("แผนที่", "Map", 12),
    ("แหล่ง A", "Source A", 22), ("แหล่ง B", "Source B", 22),
    ("ประเภท A", "Kind A", 22), ("ประเภท B", "Kind B", 22),
    ("ทำไมดูเหมือนกัน", "Why it looks the same", 40),
    ("หน้าที่เก็บไว้", "Page kept if same", 12), ("หมายเหตุ", "Note", 28),
    ("id A", "id A", 30), ("id B", "id B", 30),
]
HOWTO = [
    "เปิดหน้า A และหน้า B แล้วเลือกคำตอบในคอลัมน์แรก · Open Page A and Page B, then pick an answer in the first column.",
    "ที่เดียวกัน · Same: one shop or place. คนละที่ · Different: two places (a café inside its hotel is two). ไม่แน่ใจ · Not sure: leave it for later.",
    "แผนที่ แสดงหมุดทั้งสองเป็น A และ B · Map shows both pins as A and B.",
    "เริ่มจากแถวบนสุด คู่ที่น่าจะใช่ที่สุดอยู่บน · Start at the top; the surest pairs come first.",
    "ถ้าตอบว่า Same หน้า A หรือ B ที่ระบุในคอลัมน์ 'หน้าที่เก็บไว้' จะอยู่ต่อ อีกหน้าจะพาไปที่หน้านั้น · If Same, the page named in 'Page kept if same' stays and the other address opens it.",
]


def page_url(paths, rid):
    p = paths.get(rid)
    return BASE + p.lstrip("/") if p else ""


def map_url(a, b):
    mid = ((a["lat"] + b["lat"]) / 2, (a["lng"] + b["lng"]) / 2)
    return ("https://www.google.com/maps/dir/%.6f,%.6f/%.6f,%.6f/@%.6f,%.6f,19z"
            % (a["lat"], a["lng"], b["lat"], b["lng"], mid[0], mid[1]))


def write_xlsx(path, rows):
    try:
        from openpyxl import Workbook
        from openpyxl.formatting.rule import FormulaRule
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
        from openpyxl.worksheet.datavalidation import DataValidation
    except ImportError:
        sys.exit("openpyxl is missing: pip3 install --user openpyxl")
    wb = Workbook()
    ws = wb.active
    ws.title = "Pairs"
    head_font = Font(bold=True, size=12)
    head_fill = PatternFill("solid", fgColor="E7E6E6")
    wrap = Alignment(wrap_text=True, vertical="top")
    ws.append([f"{th}\n{en}" if th != en else th for th, en, _ in COLUMNS])
    for i, (_, _, w) in enumerate(COLUMNS, 1):
        c = ws.cell(row=1, column=i)
        c.font, c.fill = head_font, head_fill
        c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[1].height = 36
    link_font = Font(color="0563C1", underline="single", size=12)
    body = Font(size=12)
    for n, r in enumerate(rows, 1):
        a, b = r["a"], r["b"]
        ws.append([
            "", n, r["band"], a["shown"], b["shown"], round(r["d"]),
            a["phone"], b["phone"], "", "", "",
            a["source"], b["source"], " / ".join(a["cats"]), " / ".join(b["cats"]),
            r["words"], r["keep"], "", a["id"], b["id"]])
        row = n + 1
        for col in range(1, len(COLUMNS) + 1):
            c = ws.cell(row=row, column=col)
            c.alignment = wrap
            c.font = body
            if c.data_type == "f":      # a name that starts with "=" must stay text
                c.data_type = "s"
            if isinstance(c.value, str) and c.value and c.value[0] in "=+-@":
                c.quotePrefix = True
        for col, text, url in ((9, "เปิด A · open", r["url_a"]), (10, "เปิด B · open", r["url_b"]),
                               (11, "แผนที่ · map", r["map"])):
            c = ws.cell(row=row, column=col)
            if url:
                c.value, c.hyperlink, c.font = text, url, link_font
            else:
                c.value = "(ยังไม่มีหน้า · no page)"
    last = len(rows) + 1
    ws.freeze_panes = "B2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(COLUMNS))}{last}"
    dv = DataValidation(type="list", formula1=f'"{SAME},{DIFF},{UNSURE}"', allow_blank=True,
                        showErrorMessage=True, errorTitle="เลือกจากรายการ · Pick from the list",
                        error="เลือกจากรายการ · Pick one from the list")
    ws.add_data_validation(dv)
    dv.add(f"A2:A{max(last, 2)}")
    for text, color in (("Same", "C6EFCE"), ("Different", "F8CBAD"), ("Not sure", "FFEB9C")):
        ws.conditional_formatting.add(
            f"A2:A{max(last, 2)}",
            FormulaRule(formula=[f'ISNUMBER(SEARCH("{text}",$A2))'],
                        fill=PatternFill("solid", bgColor=color, fgColor=color)))
    hw = wb.create_sheet("How", 0)
    for line in HOWTO:
        hw.append([line])
    hw.column_dimensions["A"].width = 120
    for row in hw.iter_rows():
        row[0].alignment = Alignment(wrap_text=True, vertical="top")
        row[0].font = Font(size=13)
    wb.active = 1
    wb.save(path)


# ------------------------------------------------------------------ build

def build_rows(pairs, paths, refs):
    rows = []
    for pid, e in pairs.items():
        a, b = e["a"], e["b"]
        pts, words = score(e, paths)
        rows.append({
            "pid": pid, "a": a, "b": b, "d": e["d"], "pts": pts, "band": band(pts),
            "words": " · ".join(words), "why": sorted(e["why"]),
            "keep": pick_keeper(a, b, paths, refs),
            "url_a": page_url(paths, a["id"]), "url_b": page_url(paths, b["id"]),
            "map": map_url(a, b)})
    rows.sort(key=lambda r: (-r["pts"], r["d"], r["pid"]))
    return rows


def known_skips(data_root):
    skip = set()
    merges = (load_json(data_root / "data" / "curated" / "merges.json", {}).get("merges") or {})
    for keeper, drops in merges.items():
        grp = [keeper] + list(drops)
        for x, y in itertools.combinations(grp, 2):
            skip.add(pair_id(x, y))
    for x, y in (load_json(data_root / "data" / "curated" / "not_same.json", {}).get("pairs") or []):
        skip.add(pair_id(x, y))
    return skip


def run_find(args):
    data_root = Path(args.data).resolve()
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    ledger_path = out_dir / "ledger.tsv"
    ledger = read_ledger(ledger_path)
    recs = load_records(data_root)
    print(f"{len(recs)} records, {sum(1 for r in recs if r['lat'] is not None)} with a pin")
    skip = known_skips(data_root)
    pairs, skipped, pinned, put = find_pairs(recs, skip)
    find_similar(pairs, pinned, Likeness(data_root), put)
    for e in pairs.values():
        e.setdefault("sim", 0)
    tally = collections.Counter("+".join(sorted(e["why"])) for e in pairs.values())
    print(f"{len(pairs)} likely pairs (merged and called-different pairs left out)")
    for k, n in sorted(tally.items(), key=lambda x: -x[1]):
        print(f"  {n:5d}  {k}")
    for k, n in skipped.items():
        print(f"  skipped: {n} x {k}")
    if not args.all:
        pairs = {k: v for k, v in pairs.items() if k not in ledger}
        print(f"{len(pairs)} not on an earlier sheet")
    if not pairs:
        print("nothing new; no sheet written")
        return
    paths = load_paths(data_root, args.paths, args.server)
    refs = curated_refs(data_root, {r["id"] for e in pairs.values() for r in (e["a"], e["b"])})
    rows = build_rows(pairs, paths, refs)
    bands = collections.Counter(r["band"] for r in rows)
    print("  " + " · ".join(f"{k} {v}" for k, v in bands.most_common()))
    print(f"  no page address for {sum(1 for r in rows if not r['url_a'] or not r['url_b'])} pairs; "
          f"already one page address for {sum(1 for r in rows if r['url_a'] and r['url_a'] == r['url_b'])}")
    if args.dry:
        return
    today = datetime.date.today().isoformat()
    name = f"dupes-{today}.xlsx"
    n = 2
    while (out_dir / name).exists():
        name = f"dupes-{today}-{n}.xlsx"
        n += 1
    write_xlsx(out_dir / name, rows)
    for r in rows:
        ledger[r["pid"]] = {"pair": r["pid"], "first_seen": today, "sheet": name,
                            "why": "+".join(r["why"]), "score": r["pts"], "label": "", "labeled": ""}
    write_ledger(ledger_path, ledger)
    print(f"wrote {out_dir / name} ({len(rows)} pairs)")


# ------------------------------------------------------------------ apply

def read_labels(xlsx):
    """[(label, id_a, id_b, keep)] for every row with an answer, plus a list of
    answers that could not be read."""
    from openpyxl import load_workbook
    wb = load_workbook(xlsx, read_only=True, data_only=True)
    ws = wb["Pairs"] if "Pairs" in wb.sheetnames else wb.worksheets[-1]
    it = ws.iter_rows(values_only=True)
    head = [str(h or "").split("\n")[-1].strip().lower() for h in next(it)]
    try:
        ci = {k: head.index(k) for k in ("label", "id a", "id b", "page kept if same")}
    except ValueError:
        sys.exit("the sheet's header row is not the one find_dupes.py writes")
    got, unread = [], []
    for row in it:
        row = list(row) + [None] * 30
        raw = str(row[ci["label"]] or "").strip()
        a, b = row[ci["id a"]], row[ci["id b"]]
        if not raw or not a or not b:
            continue
        low = raw.lower()
        if "not sure" in low or "ไม่แน่ใจ" in low or low in ("unsure", "?"):
            lab = "unsure"
        elif "different" in low or "คนละที่" in low:
            lab = "different"
        elif "same" in low or "ที่เดียวกัน" in low:
            lab = "same"
        else:
            unread.append((raw, a, b))
            continue
        got.append((lab, str(a), str(b), str(row[ci["page kept if same"]] or "").strip()))
    return got, unread


class Groups:
    def __init__(self):
        self.up = {}

    def find(self, x):
        self.up.setdefault(x, x)
        while self.up[x] != x:
            self.up[x] = self.up[self.up[x]]
            x = self.up[x]
        return x

    def join(self, x, y):
        self.up[self.find(x)] = self.find(y)


def write_json(path, doc):
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def run_apply(args):
    data_root = Path(args.data).resolve()
    out_dir = Path(args.out).resolve()
    cur = data_root / "data" / "curated"
    got, unread = read_labels(args.apply)
    count = collections.Counter(g[0] for g in got)
    print(f"{len(got)} answers: " + ", ".join(f"{k} {v}" for k, v in count.items()))
    for raw, a, b in unread:
        print(f"  could not read the answer {raw!r} ({a} / {b}); left out")
    ids = set()
    for f in (data_root / "data" / "canonical").glob("*.json"):
        ids |= {r["id"] for r in json.loads(f.read_text(encoding="utf-8"))}
    today = datetime.date.today().isoformat()
    sheet = Path(args.apply).name

    # same -> one group per place; the kept record is the one the sheet named
    g = Groups()
    votes = collections.Counter()
    gone = []
    for lab, a, b, keep in got:
        if lab != "same":
            continue
        if a not in ids or b not in ids:
            gone.append((a, b))
            continue
        g.join(a, b)
        votes[a if keep == "A" else b] += 1
    comps = collections.defaultdict(set)
    for x in list(g.up):
        comps[g.find(x)].add(x)
    mdoc = load_json(cur / "merges.json", {"_readme": "", "merges": {}, "_why": {}})
    merges = mdoc.setdefault("merges", {})
    drop_to_keep = {d: k for k, ds in merges.items() for d in ds}
    ndoc = load_json(cur / "not_same.json", {
        "_readme": "Pairs a person looked at and called two places. importers/find_dupes.py leaves them off the next sheet. The build does not read this file.",
        "pairs": [], "_why": {}})
    # Same and Different must not contradict each other, counting merges already
    # on disk. Checked before anything is written.
    joined = Groups()
    for keeper, drops in merges.items():
        for d in drops:
            joined.join(keeper, d)
    for members in comps.values():
        for m in members:
            joined.join(m, next(iter(members)))
    touched = {m for members in comps.values() for m in members}
    clash = [tuple(sorted((a, b))) for lab, a, b, _ in got
             if lab == "different" and joined.find(a) == joined.find(b)]
    clash += [tuple(sorted((a, b))) for a, b in ndoc["pairs"]
              if (a in touched or b in touched) and joined.find(a) == joined.find(b)]
    if clash:
        sys.exit("Same and Different contradict each other; nothing written:\n"
                 + "\n".join("  %s / %s" % c for c in sorted(set(clash))))
    added = []
    for members in comps.values():
        keeper = sorted(members, key=lambda m: (-votes[m], m))[0]
        keeper = drop_to_keep.get(keeper, keeper)          # follow an older merge
        for m in sorted(members):
            root = drop_to_keep.get(m, m)                   # m may sit under another keeper
            if root == keeper:
                continue
            older = merges.pop(root, [])                    # root held others: they move too
            slot = merges.setdefault(keeper, [])
            for d in [root] + older:
                if d != keeper and d not in slot:
                    slot.append(d)
                    drop_to_keep[d] = keeper
                    added.append((keeper, d))
    seen = {pair_id(x, y) for x, y in ndoc["pairs"]}
    diffs = []
    for lab, a, b, _ in got:
        if lab == "different" and pair_id(a, b) not in seen:
            seen.add(pair_id(a, b))
            diffs.append(sorted((a, b)))
    ndoc["pairs"] = sorted(ndoc["pairs"] + diffs)
    by = f" by {args.by}" if args.by else ""
    if added:
        mdoc.setdefault("_why", {})[f"{today} dupe sheet"] = (
            f"{len(added)} records folded into a kept record after a person{by} labeled the pair "
            f"Same on {sheet}. The kept record is the one the sheet named.")
    if diffs:
        ndoc.setdefault("_why", {})[f"{today} dupe sheet"] = (
            f"{len(diffs)} pairs labeled Different{by} on {sheet}.")
    print(f"merges.json: {len(added)} records folded into {len({k for k, _ in added})} kept records")
    print(f"not_same.json: {len(diffs)} pairs added")
    for a, b in gone:
        print(f"  not in the data any more, left out: {a} / {b}")
    # a dropped id that other curated files still name
    dropped = {d for _, d in added}
    if dropped:
        named = curated_refs(data_root, dropped)
        for d in sorted(named):
            print(f"  {d} is also named in: {', '.join(sorted(named[d]))}")
    if args.dry:
        print("dry run: nothing written")
        return
    if added:
        write_json(cur / "merges.json", mdoc)
    if diffs:
        write_json(cur / "not_same.json", ndoc)
    ledger_path = out_dir / "ledger.tsv"
    ledger = read_ledger(ledger_path)
    for lab, a, b, _ in got:
        pid = pair_id(a, b)
        row = ledger.setdefault(pid, {"pair": pid, "first_seen": today, "sheet": sheet,
                                      "why": "", "score": ""})
        row["label"], row["labeled"] = lab, today
    out_dir.mkdir(parents=True, exist_ok=True)
    write_ledger(ledger_path, ledger)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--data", default=str(ROOT), help="checkout whose data/ and cache/ are read")
    ap.add_argument("--out", default=None, help="sheet folder (default <data>/_incoming/dupes)")
    ap.add_argument("--paths", default=None, help="a place_paths.json for page addresses")
    ap.add_argument("--server", action="store_true", help="read place_paths.json from the server")
    ap.add_argument("--all", action="store_true", help="list every open pair, not only new ones")
    ap.add_argument("--dry", action="store_true", help="count; write nothing")
    ap.add_argument("--apply", metavar="SHEET.xlsx", help="read a labeled sheet back in")
    ap.add_argument("--by", default="", help="who labeled the sheet (kept in merges.json)")
    args = ap.parse_args()
    if args.out is None:
        args.out = str(Path(args.data) / "_incoming" / "dupes")
    run_apply(args) if args.apply else run_find(args)


if __name__ == "__main__":
    main()
