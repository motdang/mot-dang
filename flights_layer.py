#!/usr/bin/env python3
"""Who flies here — the route board for CNX and CEI.

The airports keep arrival boards for the next hour. This page answers the
season-sized question: which routes come to our two airports, on which
airlines, how often, at what times of day. That changes a few times a year,
the cadence this site rebuilds at, so the page bakes flat.

Data: data/flights.json, hand-refreshed from public pages (its _comment and
`sources` list say which). Per route:

  per_month  arrivals a month (route list + counts; src.per_month names the
             month and source)
  out / in   published timetable rows, departures from and arrivals into our
             airport: flight number, local times, days (1 = Monday), aircraft,
             validity window, source id
  block_min  typical gate-to-gate minutes, our airport → destination
  status     new / resumes / ends / suspended, with start / end dates
  src        which source each route-level field came from

The departure board is built from the out / in rows. It is the published
timetable, labelled so on the page, not live status.

Fare links are referral links (Travelpayouts marker in flights.json),
declared on the page in both languages. flights.js re-dates them and drives
the board's day and airport switches.

Emits: flights.html, flights.css, flights.js, widgets/flights.html.

Entry points: emit(globals_of_build, data) from build.py, or
`python3 flights_layer.py` on its own to regenerate those files from an
existing docs/ without the full build.
"""
import datetime
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODEL = json.loads((ROOT / "data" / "flights.json").read_text())

AIRPORTS = MODEL["airports"]
AIRLINES = MODEL["airlines"]
ROUTES = MODEL["routes"]
AS_OF = MODEL["as_of"]
AFF = MODEL["affiliate"]
SOURCES = {s.get("id", s["url"]): s for s in MODEL["sources"]}

TH_MONTHS = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
             "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
EN_MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
TH_DAYS = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"]
EN_DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]


# ----------------------------------------------------------------- wording

def freq_label(bi, per_month):
    """Monthly arrivals → a sentence a reader can hold. Rounded and marked ~
    on the page; the exact count lives in the data file."""
    if per_month >= 45:                       # clearly several a day
        n = round(per_month / 30)
        return bi(f"วันละ ~{n} เที่ยว", f"~{n}/day")
    if per_month >= 26:                       # about daily
        return bi("ราววันละเที่ยว", "~daily")
    n = max(1, round(per_month / 4.35))
    return bi(f"สัปดาห์ละ ~{n} เที่ยว", f"~{n}/wk")


def date_bi(bi, iso):
    d = datetime.date.fromisoformat(iso)
    return (f"{d.day} {TH_MONTHS[d.month]} {d.year + 543}",
            f"{d.day} {EN_MONTHS[d.month]} {d.year}")


def dur_bi(minutes):
    h, m = divmod(int(minutes), 60)
    th = (f"{h} ชม. " if h else "") + (f"{m} นาที" if m else "")
    en = f"{h}h {m:02d}m" if h else f"{m}m"
    return th.strip(), en


def days_bi(days):
    if days == "1234567":
        return "ทุกวัน", "daily"
    th = " ".join(TH_DAYS[int(c) - 1] for c in days)
    en = " ".join(EN_DAYS[int(c) - 1] for c in days)
    return th, en


def marker(place):
    """Partner ID plus a SubID per placement, so Travelpayouts' reports say
    which part of the page a booking came from: 749581.motdang_routes,
    749581.motdang_weekend. A SubID takes letters, digits and _ only."""
    return f'{AFF["marker"]}_{place}'


def fare_href(origin, dest, depart):
    """Aviasales deep link, one adult, origin = our airport (the reader who
    books from this page mostly lives here). flights.js re-dates it later."""
    return (f'{AFF["host"]}/search/{origin}{depart:%d%m}{dest}1'
            f'?marker={marker("routes")}')


def airline_name(g, code, link=False):
    bi, att = g["bi"], g["att"]
    a = AIRLINES.get(code, {"th": code, "en": code})
    name = bi(a["th"], a["en"])
    if link and a.get("url"):
        return (f'<a class="al" href="{att(a["url"])}" rel="noopener" '
                f'target="_blank">{name}</a>')
    return f'<span class="al">{name}</span>'


def valid_on(f, day):
    """Is timetable row f in force on date `day`? valid = 'from/to', either
    side may be empty."""
    lo, _, hi = (f.get("valid") or "/").partition("/")
    if lo and day < datetime.date.fromisoformat(lo):
        return False
    if hi and day > datetime.date.fromisoformat(hi):
        return False
    return True


# ------------------------------------------------------------------- cards

def status_line(g, r):
    bi = g["bi"]
    st = r.get("status")
    if st in ("new", "resumes") and r.get("start"):
        th, en = date_bi(bi, r["start"])
        if st == "new":
            return bi(f"เส้นทางใหม่ เริ่ม {th}", f"New route from {en}")
        return bi(f"กลับมาบิน {th}", f"Back from {en}")
    if st == "ends" and r.get("end"):
        th, en = date_bi(bi, r["end"])
        return bi(f"เที่ยวสุดท้าย {th}", f"Last flight {en}")
    if st == "suspended":
        if r.get("end"):
            th, en = date_bi(bi, r["end"])
            return bi(f"งดบินถึง {th}", f"Paused until {en}")
        return bi("งดบินชั่วคราว", "Paused")
    return ""


def day_strip(days):
    cells = "".join(
        f'<i class="{"on" if str(i + 1) in days else ""}" title="{EN_DAYS[i]}">'
        f'{TH_DAYS[i]}</i>' for i in range(7))
    return f'<span class="days" aria-label="{days_bi(days)[1]}">{cells}</span>'


def probe_day(r, build_day):
    """The date a card describes: the build day, or the route's start date
    when it has not started yet."""
    if r.get("start") and datetime.date.fromisoformat(r["start"]) > build_day:
        return datetime.date.fromisoformat(r["start"])
    return build_day


def live_rows(r, key, build_day):
    rows = r.get(key, [])
    probe = probe_day(r, build_day)
    return [f for f in rows if valid_on(f, probe)] or rows


def out_days(r, build_day):
    s = set()
    for f in live_rows(r, "out", build_day):
        s |= set(f.get("days", ""))
    return "".join(sorted(s))


def route_eq(r, build_day):
    eq = []
    for f in live_rows(r, "out", build_day) + live_rows(r, "in", build_day):
        if f.get("eq") and f["eq"] not in eq:
            eq.append(f["eq"])
    return eq or r.get("eq") or []


def time_list(g, r, build_day):
    """Departure times from our airport, in force on the card's date,
    earliest first."""
    bi, esc = g["bi"], g["esc"]
    if not r.get("out"):
        return ""
    ts = sorted({f["dep"] for f in live_rows(r, "out", build_day)})
    if len(ts) > 8:
        shown = f'{esc(ts[0])} … {esc(ts[-1])}'
        more = bi(f" ({len(ts)} เวลา)", f" ({len(ts)} times)")
    else:
        shown, more = " · ".join(esc(t) for t in ts), ""
    code = esc(r["airport"])
    return (f'<div class="times">{bi(f"ออกจาก {code}", f"Leaves {code}")}: '
            f'<b>{shown}</b>{more}</div>')


def timetable(g, r):
    bi, esc = g["bi"], g["esc"]
    if not (r.get("out") or r.get("in")):
        return ""

    def rows(fs):
        out = []
        for f in sorted(fs, key=lambda f: (f["dep"], f["no"])):
            dth, den = days_bi(f.get("days", ""))
            lo, _, hi = (f.get("valid") or "/").partition("/")
            win = ""
            if lo or hi:
                a = date_bi(bi, lo) if lo else ("", "")
                b = date_bi(bi, hi) if hi else ("", "")
                win = bi(f"{a[0]}–{b[0]}", f"{a[1]}–{b[1]}")
            plus = '<sup>+1</sup>' if f.get("plus") else ""
            out.append(
                f'<tr><td>{esc(f["no"])}</td><td>{esc(f["dep"])}</td>'
                f'<td>{esc(f["arr"])}{plus}</td><td>{bi(dth, den)}</td>'
                f'<td>{esc(f.get("eq", ""))}</td><td class="win">{win}</td></tr>')
        return "".join(out)

    head = (f'<tr><th>{bi("เที่ยวบิน", "Flight")}</th><th>{bi("ออก", "Dep")}</th>'
            f'<th>{bi("ถึง", "Arr")}</th><th>{bi("วัน", "Days")}</th>'
            f'<th>{bi("เครื่อง", "Aircraft")}</th><th>{bi("ช่วง", "Dates")}</th></tr>')
    code, iata = esc(r["airport"]), esc(r["iata"])
    parts = []
    if r.get("out"):
        parts.append(f'<tr class="dir"><td colspan="6">{code} → {iata}</td></tr>'
                     + rows(r["out"]))
    if r.get("in"):
        parts.append(f'<tr class="dir"><td colspan="6">{iata} → {code}</td></tr>'
                     + rows(r["in"]))
    return (f'<details class="tt"><summary>{bi("ตารางบิน", "Timetable")}</summary>'
            f'<div class="ttwrap"><table>{head}{"".join(parts)}</table></div>'
            f'<p class="ttnote">{bi("เวลาท้องถิ่นของแต่ละสนามบิน", "Local time at each airport")}</p>'
            '</details>')


def changes_html(g, r):
    """Dated changes the sources announce, one line each."""
    bi, esc = g["bi"], g["esc"]
    out = []
    for c in r.get("changes", []):
        a = AIRLINES.get(c["al"], {"th": c["al"], "en": c["al"]})
        fth, fen = date_bi(bi, c["from"])
        span_th, span_en = f"ตั้งแต่ {fth}", f"from {fen}"
        if c.get("to"):
            tth, ten = date_bi(bi, c["to"])
            span_th, span_en = f"{fth} – {tth}", f"{fen} – {ten}"
        n = c.get("per_week")
        if c["kind"] == "ends":
            th, en = f"{a['th']} บินเที่ยวสุดท้าย {fth}", f"{a['en']}: last flight {fen}"
        elif c["kind"] == "resumes":
            th = f"{a['th']} กลับมาบิน {fth}" + (f" สัปดาห์ละ {n} เที่ยว" if n else "")
            en = f"{a['en']} back {fen}" + (f", {n} a week" if n else "")
        else:
            th, en = f"{a['th']} สัปดาห์ละ {n} เที่ยว {span_th}", f"{a['en']}: {n} a week, {span_en}"
        out.append(f'<li>{bi(th, en)}</li>')
    return f'<ul class="chg">{"".join(out)}</ul>' if out else ""


def seen_html(g, r):
    """Times seen on booking or current-schedule pages: not a timetable,
    so they stay off the board and say what they are."""
    bi, esc = g["bi"], g["esc"]
    rows = r.get("seen", [])
    if not rows:
        return ""
    code = r["airport"]
    items = []
    for f in sorted(rows, key=lambda f: (f["dir"], f["dep"])):
        if f["dir"] == "out":
            t = f'{code} {f["dep"]}' + (f' → {f["arr"]}' if f.get("arr") else "")
        else:
            t = f'{r["iata"]} {f["dep"]}' + (f' → {code} {f["arr"]}' if f.get("arr") else "")
        when = ", ".join(f.get("dates") or [f.get("on", "")])
        items.append(f'<span class="seen1" title="{g["att"](when)}">{esc(f["al"])} {esc(t)}</span>')
    return (f'<div class="seen"><span class="seenh">{bi("เวลาที่เห็นในหน้าจองตั๋ว/ตารางปัจจุบัน (ยังไม่ใช่ตารางเต็ม)", "Times seen on booking or current-schedule pages (not a full timetable)")}:</span> '
            + " · ".join(items) + '</div>')


def route_card(g, r, build_day):
    bi, esc, att = g["bi"], g["esc"], g["att"]
    season = r.get("season")
    upcoming = bool(season and season.get("upcoming"))
    if upcoming and r.get("start") and datetime.date.fromisoformat(r["start"]) <= build_day:
        upcoming = False
    months = (season or {}).get("months", [])
    in_season = (not season) or (build_day.month in months and not upcoming)

    chips = []
    # A route out of its season this month has a zero count, and a zero count
    # is not a frequency — the window chip alone carries those rows.
    if not upcoming and r["per_month"] > 0:
        chips.append(f'<span class="fchip">{freq_label(bi, r["per_month"])}</span>')
    if season:
        cls = "schip on" if in_season and not upcoming else "schip"
        chips.append(f'<span class="{cls}" data-months="{att(",".join(map(str, months)))}"'
                     f'{" data-upcoming" if upcoming else ""}>'
                     f'🗓 {bi(season["th"], season["en"])}</span>')
    if r.get("block_min"):
        th, en = dur_bi(r["block_min"])
        chips.append(f'<span class="bchip">⏱ {bi(f"บิน ~{th}", f"~{en} flight")}</span>')

    st = status_line(g, r)
    pw = r.get("per_week") or {}
    lines = "".join(
        airline_name(g, c) + (f'<span class="pw">{bi(f"{pw[c]}/สัปดาห์", f"{pw[c]}/wk")}</span>' if c in pw else "")
        for c in r["airlines"])
    eq = route_eq(r, build_day)
    eq_html = (f'<div class="eq">✈ {esc(" · ".join(eq))}</div>' if eq else "")
    days = out_days(r, build_day)
    days_html = day_strip(days) if days else ""

    depart = build_day + datetime.timedelta(days=21)
    fare = (f'<a class="fare" href="{att(fare_href(r["airport"], r["iata"], depart))}"'
            f' data-org="{att(r["airport"])}" data-dst="{att(r["iata"])}"'
            f' rel="nofollow sponsored noopener" target="_blank">'
            f'{bi("ราคาตั๋ว", "Fares")} ✈</a>')

    return (f'<div class="route{"" if in_season else " off"}" id="r-{att(r["airport"].lower())}-{att(r["iata"].lower())}">'
            f'<div class="rhead"><span class="dest">{bi(r["th"], r["en"])}</span>'
            f'<span class="iata">{esc(r["iata"])}</span></div>'
            + (f'<div class="rstat">{st}</div>' if st else "")
            + f'<div class="rmeta">{"".join(chips)}</div>'
            f'<div class="rlines">{lines}</div>'
            + eq_html + days_html + time_list(g, r, build_day)
            + changes_html(g, r) + seen_html(g, r)
            + timetable(g, r)
            + f'{fare}</div>')


def airport_section(g, code, build_day):
    bi = g["bi"]
    ap = AIRPORTS[code]
    routes = sorted((r for r in ROUTES if r["airport"] == code),
                    key=lambda r: -r["per_month"])
    dom = [r for r in routes if r["dom"]]
    intl = [r for r in routes if not r["dom"]]
    per_day = round(sum(r["per_month"] for r in routes) / 30)
    n_airlines = len({c for r in routes for c in r["airlines"]})

    def group(title_th, title_en, rs):
        if not rs:
            return ""
        cards = "".join(route_card(g, r, build_day) for r in rs)
        return (f'<h3 class="gtitle">{bi(title_th, title_en)} '
                f'<span class="gcount">({len(rs)})</span></h3>'
                f'<div class="routegrid">{cards}</div>')

    return (f'<section class="apsection" id="{code.lower()}">'
            f'<div class="aphead"><h2>{bi(ap["th"], ap["en"])} '
            f'<span class="apcode">{code}</span></h2>'
            f'<p class="apsum">{bi(f"{len(routes)} จุดหมาย · {n_airlines} สายการบิน · ขาเข้าราววันละ {per_day} เที่ยว", f"{len(routes)} destinations · {n_airlines} airlines · ~{per_day} arrivals a day")}</p></div>'
            + group("ในประเทศ", "Domestic", dom)
            + group("ต่างประเทศ", "International", intl)
            + '</section>')


# ------------------------------------------------------------------- board

def board(g, build_day):
    """Every timetable row as one table; flights.js shows the rows for the
    chosen airport, direction and date. Without JS the table stands whole,
    days column included."""
    bi, esc, att = g["bi"], g["esc"], g["att"]
    rows = []
    for r in ROUTES:
        for d, key in (("out", "out"), ("in", "in")):
            for f in r.get(key, []):
                rows.append((r, d, f))
    if not rows:
        return ""
    rows.sort(key=lambda x: (x[1], x[2]["dep"] if x[1] == "out" else x[2]["arr"]))
    trs = []
    for r, d, f in rows:
        lo, _, hi = (f.get("valid") or "/").partition("/")
        t = f["dep"] if d == "out" else f["arr"]
        other = f["arr"] if d == "out" else f["dep"]
        plus = '<sup>+1</sup>' if (d == "out" and f.get("plus")) else ""
        dth, den = days_bi(f.get("days", ""))
        trs.append(
            f'<tr data-ap="{att(r["airport"])}" data-dir="{d}" data-days="{att(f.get("days", ""))}"'
            f' data-from="{att(lo)}" data-to="{att(hi)}" data-t="{att(t)}">'
            f'<td class="bt">{esc(t)}</td>'
            f'<td><a href="#r-{att(r["airport"].lower())}-{att(r["iata"].lower())}">{bi(r["th"], r["en"])}</a>'
            f' <span class="iata">{esc(r["iata"])}</span></td>'
            f'<td class="bno">{esc(f["no"])}</td>'
            f'<td>{airline_name(g, f["al"])}</td>'
            f'<td class="beq">{esc(f.get("eq", ""))}</td>'
            f'<td class="bo">{esc(other)}{plus}</td>'
            f'<td class="bd">{bi(dth, den)}</td></tr>')
    n_routes = len(ROUTES)
    n_tt = sum(1 for r in ROUTES if r.get("out") or r.get("in"))
    head = (f'<tr><th>{bi("เวลา", "Time")}</th>'
            f'<th><span class="h-out">{bi("ไป", "To")}</span><span class="h-in">{bi("จาก", "From")}</span></th>'
            f'<th>{bi("เที่ยวบิน", "Flight")}</th><th>{bi("สายการบิน", "Airline")}</th>'
            f'<th>{bi("เครื่อง", "Aircraft")}</th>'
            f'<th><span class="h-out">{bi("ถึง", "Arrives")}</span><span class="h-in">{bi("ออก", "Departed")}</span></th>'
            f'<th class="bd">{bi("วัน", "Days")}</th></tr>')
    return (
        '<section class="fboard" id="board">'
        f'<h2>{bi("ตารางเที่ยวบินรายวัน", "Daily timetable")}</h2>'
        f'<p class="bnote">{bi("จากตารางบินที่สายการบินประกาศ ไม่ใช่สถานะเที่ยวบินสด เที่ยวบินอาจเลื่อนหรือยกเลิกได้ ก่อนออกเดินทางเช็คกับสายการบิน", "From the timetables the airlines publish, not live flight status. Flights move and cancel; check with the airline before you leave.")}</p>'
        '<div class="bctl">'
        '<div class="seg" role="group" data-k="ap">'
        '<button type="button" data-v="CNX" aria-pressed="true">เชียงใหม่ CNX</button>'
        '<button type="button" data-v="CEI" aria-pressed="false">เชียงราย CEI</button></div>'
        '<div class="seg" role="group" data-k="dir">'
        f'<button type="button" data-v="out" aria-pressed="true">{bi("ขาออก", "Departures")}</button>'
        f'<button type="button" data-v="in" aria-pressed="false">{bi("ขาเข้า", "Arrivals")}</button></div>'
        '<div class="seg dates" role="group" data-k="day"></div></div>'
        f'<div class="bwrap"><table class="btab" data-build="{att(build_day.isoformat())}">{head}{"".join(trs)}</table></div>'
        f'<p class="bempty" hidden>{bi("วันนี้ไม่มีเที่ยวบินในตารางที่เรามี", "No flights in our timetable rows for this day")}</p>'
        f'<p class="bnote">{bi(f"มีตารางเวลา {n_tt} จาก {n_routes} เส้นทาง เส้นทางที่เหลือดูได้ในการ์ดด้านล่าง", f"Timetable rows for {n_tt} of {n_routes} routes; the rest are in the cards below.")}</p>'
        '</section>')


def airlines_section(g):
    bi, att = g["bi"], g["att"]
    used = {c for r in ROUTES for c in r["airlines"]}
    items = []
    for code in sorted(used, key=lambda c: AIRLINES.get(c, {}).get("en", c)):
        a = AIRLINES.get(code)
        if not a:
            continue
        n = sum(1 for r in ROUTES if code in r["airlines"])
        link = (f'<a href="{att(a["url"])}" rel="noopener" target="_blank">'
                f'{bi(a["th"], a["en"])}</a>' if a.get("url") else bi(a["th"], a["en"]))
        items.append(f'<li><span class="alcode">{att(code)}</span> {link} '
                     f'<span class="gcount">{bi(f"{n} เส้นทาง", f"{n} routes")}</span></li>')
    return (f'<section class="alsec" id="airlines"><h2>{bi("สายการบิน", "Airlines")}</h2>'
            f'<ul class="allist">{"".join(items)}</ul></section>')


def today_section(g):
    """Today's flights from data/flightboard.json (AirLabs, her key, refreshed seven times a day by launchd
    net.motdang.flightboard). Baked empty; flights.js fills it from the file so it follows the refreshes."""
    bi = g["bi"]
    names = {r["iata"]: [r["th"], r["en"]] for r in MODEL["routes"]}
    names.update({"CNX": ["เชียงใหม่", "Chiang Mai"], "CEI": ["เชียงราย", "Chiang Rai"]})
    airlines = {k: [v["th"], v["en"]] for k, v in MODEL["airlines"].items()}
    tabs = "".join(f'<button type="button" data-tk="{k}" aria-pressed="{str(i == 0).lower()}">{bi(th, en)}</button>'
                   for i, (k, th, en) in enumerate([("CNX-dep", "เชียงใหม่ ขาออก", "Chiang Mai departures"),
                                                     ("CNX-arr", "เชียงใหม่ ขาเข้า", "Chiang Mai arrivals"),
                                                     ("CEI-dep", "เชียงราย ขาออก", "Chiang Rai departures"),
                                                     ("CEI-arr", "เชียงราย ขาเข้า", "Chiang Rai arrivals")]))
    return ('<section class="ftoday" id="today">'
            f'<h2>{bi("เที่ยวบินวันนี้", "Today’s flights")}</h2>'
            f'<p class="tdnote" id="tdnote">{bi("กำลังโหลด…", "Loading…")}</p>'
            f'<div class="tdtabs" role="group" aria-label="สนามบินและทิศทาง · airport and direction">{tabs}</div>'
            '<div id="tdlist"></div>'
            '<script type="application/json" id="tdnames">'
            + json.dumps({"p": names, "a": airlines}, ensure_ascii=False).replace("</", "<\\/") +
            '</script></section>')


# ------------------------------------------------------------ weekend away

# UTC offsets for the far ends of our routes (none of them keeps summer time).
# Ours, and every Thai airport, are +7.
TZ = {"PVG": 8, "TPE": 8, "CAN": 8, "XIY": 8, "CKG": 8, "KMG": 8, "HKG": 8,
      "PEK": 8, "TFU": 8, "JHG": 8, "SIN": 8, "KUL": 8, "PUS": 9, "ICN": 9,
      "KIX": 9, "RGN": 6.5, "MDL": 6.5, "AUH": 4}
# A city with two airports is one destination: land at one, leave from either.
CITY = {"DMK": ("BKK", "กรุงเทพฯ", "Bangkok"), "BKK": ("BKK", "กรุงเทพฯ", "Bangkok")}


def _plus(dep, arr):
    return 1 if arr < dep else 0


def trip_data():
    """What the weekend finder pairs: per (our airport, destination city), every
    timetable row and every dated time seen on a booking page, both ways."""
    places = {}
    for r in ROUTES:
        city, th, en = CITY.get(r["iata"], (r["iata"], r["th"], r["en"]))
        key = f'{r["airport"]}-{city}'
        p = places.setdefault(key, {"k": key, "from": r["airport"], "to": city,
                                    "th": th, "en": en, "tz": TZ.get(r["iata"], 7),
                                    "aps": [], "al": [], "legs": []})
        p["aps"].append(r["iata"])
        p["al"] += [c for c in r["airlines"] if c not in p["al"]]
        for d in ("out", "in"):
            for f in r.get(d, []):
                p["legs"].append({"d": d, "ap": r["iata"], "al": f["al"], "no": f["no"],
                                  "dep": f["dep"], "arr": f["arr"], "plus": f.get("plus", 0),
                                  "days": f.get("days", ""), "valid": f.get("valid") or "/"})
        for f in r.get("seen", []):
            on = f.get("dates") or ([f["on"]] if f.get("on") else [])
            if not (f.get("arr") and on):
                continue
            p["legs"].append({"d": f["dir"], "ap": r["iata"], "al": f["al"], "no": f.get("no", ""),
                              "dep": f["dep"], "arr": f["arr"], "plus": _plus(f["dep"], f["arr"]),
                              "on": on, "seen": 1})
    keep = [p for p in places.values()
            if any(l["d"] == "out" for l in p["legs"]) and any(l["d"] == "in" for l in p["legs"])]
    # Which airlines on the route have no full timetable in our rows.
    for p in keep:
        full = {l["al"] for l in p["legs"] if not l.get("seen")}
        p["gap"] = [c for c in p["al"] if c not in full]
    keep.sort(key=lambda p: (p["from"], p["to"] != "BKK", p["en"]))
    return {"places": keep,
            "al": {k: [v["th"], v["en"]] for k, v in AIRLINES.items()},
            "aff": {"host": AFF["host"], "marker": marker("weekend")}, "fares": fares()}


def fares():
    """Cached fares (importers/fetch_flight_prices.py), keyed origin>dest airline
    departure, or None once the file is past shelflife's "fares" limit.
    flights.js drops them too when a reader's clock passes the limit."""
    f = ROOT / "data" / "flight_prices.json"
    if not f.exists():
        return None
    import shelflife
    doc = json.loads(f.read_text())
    if not shelflife.fresh("fares", doc.get("generated")):
        return None
    return {"asof": doc["generated"][:10], "max": shelflife.MAX_DAYS["fares"],
            "thb": {f'{r["o"]}>{r["d"]} {r["al"]} {r["dep"]}': r["thb"] for r in doc["rows"]}}


def trip_section(g):
    """Out window + back window → out/back pairs with hours there and hotel
    nights. Baked as controls and data; flights.js does the pairing."""
    bi, bi_text = g["bi"], g["bi_text"]
    data = json.dumps(trip_data(), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

    def when(cls, th, en):
        return (f'<label class="tw">{bi(th, en)}'
                f'<input type="datetime-local" class="{cls}" step="900" '
                f'aria-label="{bi_text(th, en)}"></label>')
    return (
        '<section class="ftrip" id="trip">'
        f'<h2>{bi("ไปกลับสุดสัปดาห์", "A weekend away")}</h2>'
        f'<p class="bnote">{bi("เลือกที่หมาย ช่วงเวลาขาไป และช่วงเวลาขากลับ แล้วดูคู่เที่ยวบินไป–กลับ อยู่ที่นั่นกี่ชั่วโมง และต้องค้างกี่คืน ราคาอยู่ในปุ่มราคาตั๋วของแต่ละเที่ยว", "Pick a place, a window to leave and a window to come back, and see the out-and-back pairs: hours there and hotel nights. Each flight carries its own fare link.")}</p>'
        f'<p class="tnojs">{bi("ต้องเปิด JavaScript ตารางรายวันด้านล่างมีทุกเที่ยว", "This needs JavaScript; the daily timetable below lists every flight.")}</p>'
        '<div class="tform" hidden>'
        '<div class="trow">'
        '<div class="seg" role="group" data-k="from" aria-label="ออกจาก · From">'
        '<button type="button" data-v="CNX" aria-pressed="true">เชียงใหม่ CNX</button>'
        '<button type="button" data-v="CEI" aria-pressed="false">เชียงราย CEI</button></div>'
        f'<label class="tw">{bi("ไปที่", "To")}<select class="tto" aria-label="{bi_text("ไปที่", "To")}"></select></label>'
        '</div>'
        '<div class="trow">'
        + when("ol", "ขาไป ออกไม่ก่อน", "Leave from")
        + when("oh", "ไม่เกิน", "until")
        + '</div><div class="trow">'
        + when("bl", "ขากลับ ออกไม่ก่อน", "Come back from")
        + when("bh", "ไม่เกิน", "until")
        + '</div><div class="trow">'
        f'<label class="tw">{bi("อยู่ที่นั่นอย่างน้อย (ชม.)", "At least (hours there)")}'
        f'<input type="number" class="tmin" min="0" max="240" value="12" aria-label="{bi_text("อยู่ที่นั่นอย่างน้อย ชั่วโมง", "At least hours there")}"></label>'
        f'<label class="tw">{bi("ทั้งทริปไม่เกิน (ชม.)", "Whole trip at most (hours)")}'
        f'<input type="number" class="tmax" min="1" max="480" value="48" aria-label="{bi_text("ทั้งทริปไม่เกิน ชั่วโมง", "Whole trip at most hours")}"></label>'
        '</div></div>'
        '<div class="tout" aria-live="polite"></div>'
        f'<p class="bnote">{bi("จากตารางบินที่สายการบินประกาศ และเวลาที่เห็นในหน้าจองตั๋วสำหรับวันนั้น ๆ ไม่ใช่ที่นั่งว่าง ค้างคืน = อยู่ช่วงตีสองที่นั่น ปุ่มราคาตั๋วเป็นลิงก์แนะนำ ค้นทุกสายการบินในวันนั้น", "From the airlines’ published timetables and times seen on booking pages for single dates, not seat availability. A hotel night is a stay that covers 2 a.m. Fare links are referral links and search every airline on that day.")}</p>'
        f'<script type="application/json" id="tripdata">{data}</script>'
        '</section>')


ARRIVING = [  # Travelpayouts, project Motdang, sub ID "flights" (Nan, 2026-10-04)
    ("https://kiwitaxi.tpx.li/TdHDVcyJ", "i-bus", "รถรับสนามบิน", "Airport pickup", "Kiwitaxi"),
    ("https://tpx.li/AGwXCfaX", "i-bus", "รถรับสนามบิน", "Airport pickup", "Welcome Pickups"),
    ("https://yesim.tpx.li/qhsZDJvy", "i-phone", "eSIM ไทย", "Thailand eSIM", "Yesim"),
    ("https://airhelp.tpx.li/oFjSyfVF", "i-clock", "เที่ยวบินล่าช้า?", "Flight delayed?", "AirHelp"),
]


def arriving_row(g):
    bi, esc, att = g["bi"], g["esc"], g["att"]
    icon = g.get("svg_icon") or (lambda n, s=26, c="": "")
    links = "".join(
        f'<a class="arr1" href="{att(u)}" rel="sponsored nofollow noopener" target="_blank">'
        f'{icon(ic, 18, "rowicon")}{bi(th, en)} <span class="arrb">{esc(brand)}</span></a>'
        for u, ic, th, en, brand in ARRIVING)
    return ('<section class="farr" id="arriving">'
            f'<h2>{bi("เมื่อมาถึง", "Arriving")}</h2>'
            f'<div class="arrrow">{links}</div>'
            f'<p class="arrnote">{bi("ลิงก์มีค่าตอบแทน: มดแดงได้ค่าแนะนำเมื่อคุณจองผ่านลิงก์นี้", "Paid links: Mot Dang earns a fee if you book.")}</p>'
            '</section>')


def build_board(g):
    bi, esc, att = g["bi"], g["esc"], g["att"]
    page, share_block, BASE = g["page"], g["share_block"], g["BASE"]
    build_day = datetime.date.fromisoformat(g["BUILD_DATE"])
    as_of = datetime.date.fromisoformat(AS_OF)
    as_of_th = f"{as_of.day} {TH_MONTHS[as_of.month]} {as_of.year + 543}"

    lede_th = ("สายการบินไหนบินเข้า–ออกสนามบินบ้านเรา บ่อยแค่ไหน กี่โมง — "
               "เชียงใหม่และเชียงราย หน้าเดียวจบ ตามตารางฤดูกาล")
    lede_en = ("Scheduled nonstops in and out of Chiang Mai and Chiang Rai — "
               "which airlines, how often, what time — one page, kept to the "
               "season's timetable.")

    src_links = "".join(
        f'<li><a href="{att(s["url"])}" rel="noopener">{esc(s["name"])}</a></li>'
        for s in MODEL["sources"])
    foot = (
        '<div class="flightsfoot">'
        f'<p>{bi(f"ข้อมูล ณ {as_of_th} — จำนวนเที่ยวนับเฉพาะขาเข้า ทุกเส้นทางบินไป-กลับ เวลาเป็นเวลาท้องถิ่น สายการบินปรับตารางราวปีละสองครั้ง (ฤดูหนาวเริ่มปลาย ต.ค. ฤดูร้อนเริ่มปลาย มี.ค.)", f"Data as of {AS_OF}. Counts are arrivals; every route flies both ways. Times are local. Airlines re-cut timetables about twice a year (winter from late October, summer from late March).")}</p>'
        f'<details class="srcs"><summary>{bi("แหล่งข้อมูล", "Sources")} ({len(MODEL["sources"])})</summary>'
        f'<ul>{src_links}</ul></details>'
        f'<p class="affnote">{bi("ปุ่มราคาตั๋วเป็นลิงก์แนะนำ (affiliate) — ราคาที่เห็นเท่าเดิมทุกบาท ส่วนแบ่งเล็กน้อยช่วยดูแลมดแดง", "Fare buttons are referral links — the price you see is unchanged; a small share helps keep Mot Dang running.")}</p>'
        '</div>')

    body = (
        f'<h1>✈️ {bi("กระดานเที่ยวบิน เชียงใหม่ · เชียงราย", "Flights board — CNX & CEI")}</h1>'
        f'<p class="lede">{bi(lede_th, lede_en)}</p>'
        f'<nav class="apjump"><a href="#today">{bi("วันนี้", "Today")}</a><a href="#trip">{bi("ไปกลับสุดสัปดาห์", "Weekend away")}</a><a href="#board">{bi("ตารางรายวัน", "Daily timetable")}</a>'
        f'<a href="#cnx">เชียงใหม่ CNX</a><a href="#cei">เชียงราย CEI</a>'
        f'<a href="#airlines">{bi("สายการบิน", "Airlines")}</a></nav>'
        + today_section(g)
        + trip_section(g)
        + arriving_row(g)
        + board(g, build_day)
        + airport_section(g, "CNX", build_day)
        + airport_section(g, "CEI", build_day)
        + airlines_section(g)
        + foot
        + share_block(BASE + "flights.html",
                      "กระดานเที่ยวบินเชียงใหม่·เชียงราย · Mot Dang"))

    return page("กระดานเที่ยวบิน", body, depth=0, path="flights.html",
                desc=lede_th,
                extra_head='<link rel="stylesheet" href="flights.css">'
                           '<script src="flights.js" defer></script>')


# ------------------------------------------------------------- mini widget

def build_widget(g):
    """The iframe-sized board for the my.html gallery: standalone, inline
    styles, noindex. Numbers only — the full page holds the words."""
    bi_text, esc, att = g["bi_text"], g["esc"], g["att"]
    BASE = g["BASE"]
    rows = []
    for code in ("CNX", "CEI"):
        routes = sorted((r for r in ROUTES if r["airport"] == code),
                        key=lambda r: -r["per_month"])
        per_day = round(sum(r["per_month"] for r in routes) / 30)
        top = " · ".join(esc(r["th"]) for r in routes[:3])
        rows.append(
            f'<div class="ap"><div class="c"><b>{code}</b>'
            f'<span>{esc(AIRPORTS[code]["th"])}</span></div>'
            f'<div class="n">{len(routes)} จุดหมาย · ~{per_day} เที่ยว/วัน</div>'
            f'<div class="t">{top}</div></div>')
    title = bi_text("กระดานเที่ยวบิน เชียงใหม่·เชียงราย", "Flights board CNX & CEI")
    return f"""<!DOCTYPE html>
<html lang="th" translate="no"><head><meta charset="utf-8">
<meta name="google" content="notranslate">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,follow">
<title>{esc(title)}</title>
<style>
body{{margin:0;font-family:system-ui,-apple-system,'Noto Sans Thai',sans-serif;
background:#faf5ea;color:#2a1e16;padding:.6rem .7rem;font-size:.86rem}}
.ap{{background:#fffdf7;border:2px solid #2a1e16;border-radius:.6rem;
padding:.45rem .6rem;margin:0 0 .5rem;box-shadow:2px 2px 0 #e8dcc3}}
.c{{display:flex;gap:.45rem;align-items:baseline}}
.c b{{font-size:1.05rem;color:#8f2a21}} .c span{{opacity:.85}}
.n{{font-weight:600;margin:.1rem 0}} .t{{opacity:.75;font-size:.8rem}}
a{{display:inline-block;color:#8f2a21;font-weight:700;text-decoration:none;
border:2px solid #8f2a21;border-radius:2rem;padding:.2rem .8rem;
transition:transform .12s ease,background .12s ease}}
a:hover{{background:#8f2a21;color:#faf5ea;transform:translateY(-1px)}}
a:active{{transform:scale(.96)}}
</style></head><body>
<div style="font-weight:700;margin:0 0 .45rem">✈️ {esc("เที่ยวบินบ้านเรา")}</div>
{"".join(rows)}
<a href="{att(BASE)}flights.html" target="_blank" rel="noopener">เปิดกระดานเต็ม →</a>
</body></html>
"""


# --------------------------------------------------------------------- css

CSS = """/* flights.css — generated by flights_layer.py */
.lede{max-width:44rem}
.apjump{display:flex;flex-wrap:wrap;gap:.6rem;margin:.8rem 0 1.4rem}
.apjump a{border:2px solid var(--ink);border-radius:2rem;padding:.35rem 1rem;
text-decoration:none;color:var(--ink);font-weight:600;background:var(--card);
transition:transform .15s ease,background .15s ease,color .15s ease}
.apjump a:hover{background:var(--ink);color:var(--paper);transform:translateY(-2px)}
.apsection,.fboard,.alsec,.ftoday{margin:0 0 2.2rem}
.ftoday h2{margin:0 0 .3rem}
.tdnote{font-size:1rem;margin:.2rem 0 .6rem}
.tdtabs{display:flex;flex-wrap:wrap;gap:6px;margin:.3rem 0 .7rem}
.tdtabs button{min-height:2.6rem;padding:.25rem .85rem;border-radius:999px;border:1px solid var(--line,rgba(255,255,255,.3));background:transparent;color:inherit;font:inherit;font-weight:700;cursor:pointer}
.tdtabs button[aria-pressed=true]{background:#ffc266;border-color:#ffc266;color:#000}
.tdtabs button[aria-pressed=true] .en{color:#000}
.tdrow{display:grid;grid-template-columns:4.6rem minmax(0,1fr);gap:.15rem .7rem;padding:.55rem 0;border-top:1px solid currentColor;border-top-color:rgba(128,128,128,.35);align-items:baseline}
.tdrow .tm{font:800 1.15rem ui-monospace,Menlo,monospace}
.tdrow .tm s{display:block;font-size:.8em;font-weight:600;opacity:.75}
.tdrow .wh{font-size:1.02rem;line-height:1.35}
.tdrow .wh small{display:block;font-size:.9rem;opacity:.85}
.tdrow .st{grid-column:2;justify-self:start;font-weight:800;font-size:.95rem;padding:.12rem .6rem;border-radius:999px;background:#3b4350;color:#fff}
.tdrow .st .en{color:#fff}
.tdrow.ok .st{background:#1d6b3a}.tdrow.late .st{background:#9a4a00}.tdrow.bad .st{background:#a3122a}.tdrow.done .st{background:#3b4350}
.aphead h2{margin:0 0 .15rem}
.apcode{font-size:.75em;background:var(--ant-dark);color:var(--paper);
border-radius:.4rem;padding:.08em .45em;vertical-align:.12em;letter-spacing:.05em}
.apsum{margin:.1rem 0 .9rem;color:var(--ink-soft)}
.gtitle{margin:1.1rem 0 .55rem}
.gcount{color:var(--gloss);font-weight:400}
.routegrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(16.5rem,1fr));
gap:.7rem;align-items:start}
.route{position:relative;display:flex;flex-direction:column;gap:.35rem;
background:var(--card);border:2px solid var(--ink);border-radius:.7rem;
padding:.6rem .7rem .65rem;box-shadow:3px 3px 0 var(--card-alt);
transition:transform .15s ease,box-shadow .15s ease}
.route:hover{transform:translateY(-3px);box-shadow:5px 6px 0 var(--card-alt)}
.route:target{outline:3px solid var(--gold);outline-offset:2px}
.route.off{background:var(--card-alt);opacity:.85}
.rhead{display:flex;align-items:baseline;gap:.5rem;justify-content:space-between}
.dest{font-weight:700;line-height:1.25}
.iata{flex:0 0 auto;font-size:.72rem;font-weight:700;letter-spacing:.06em;
border:1.5px solid var(--ink);border-radius:.35rem;padding:.05em .35em;
color:var(--ink-soft)}
.rstat{font-size:.82rem;font-weight:700;color:var(--ant-dark)}
.rmeta{display:flex;flex-wrap:wrap;gap:.35rem}
.fchip,.schip,.bchip{font-size:.78rem;border-radius:2rem;padding:.12em .6em;
background:var(--card-alt);border:1.5px solid var(--gloss);color:var(--ink)}
.schip{border-style:dashed}
.schip.on{border-style:solid;border-color:var(--ant-dark);background:var(--card)}
.rlines{display:flex;flex-wrap:wrap;gap:.25rem .6rem;font-size:.82rem;
color:var(--ink-soft)}
.al{white-space:nowrap}
a.al{color:var(--link)}
.eq{font-size:.78rem;color:var(--ink-soft)}
.days{display:flex;gap:2px}
.days i{font-style:normal;font-size:.68rem;min-width:1.55rem;text-align:center;
border:1px solid var(--rule);border-radius:.3rem;padding:.05em 0;color:var(--gloss)}
.days i.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.times{font-size:.8rem;color:var(--ink-soft)}
.times b{color:var(--ink);font-variant-numeric:tabular-nums}
.tt summary{cursor:pointer;font-size:.8rem;font-weight:700;color:var(--ink-soft)}
.ttwrap{overflow-x:auto}
.tt table{border-collapse:collapse;font-size:.74rem;margin:.3rem 0;
font-variant-numeric:tabular-nums;width:100%}
.tt th,.tt td{text-align:left;padding:.15rem .3rem;border-bottom:1px solid var(--rule);
white-space:nowrap}
.tt tr.dir td{font-weight:700;background:var(--card-alt)}
.tt .win{color:var(--gloss)}
.ttnote{font-size:.7rem;color:var(--gloss);margin:.1rem 0 0}
.fare{align-self:flex-start;margin-top:.15rem;font-size:.85rem;font-weight:700;
color:var(--ant-dark);text-decoration:none;border:2px solid var(--ant-dark);
border-radius:2rem;padding:.22rem .85rem;background:var(--card);
transition:transform .12s ease,background .12s ease,color .12s ease}
.fare:hover{background:var(--ant-dark);color:var(--paper);transform:translateY(-1px)}
.fare:active{transform:scale(.95)}
.fboard h2{margin:0 0 .2rem}
.bnote{font-size:.82rem;color:var(--ink-soft);max-width:46rem;margin:.2rem 0 .6rem}
.bctl{display:flex;flex-wrap:wrap;gap:.5rem;margin:.4rem 0 .6rem}
.seg{display:flex;flex-wrap:wrap;gap:.25rem}
.seg button{font:inherit;font-size:.85rem;border:2px solid var(--ink);border-radius:2rem;
background:var(--card);color:var(--ink);padding:.25rem .8rem;cursor:pointer;
transition:background .12s ease,color .12s ease,transform .12s ease}
.seg button:hover{transform:translateY(-1px)}
.seg button[aria-pressed=true]{background:var(--ink);color:var(--paper)}
.seg.dates button{padding:.25rem .6rem;font-size:.8rem}
.dpick{font:inherit;font-size:.8rem;border:2px solid var(--ink);border-radius:2rem;padding:.2rem .6rem;
background:var(--card);color:var(--ink)}
.bwrap{overflow-x:auto;border:2px solid var(--ink);border-radius:.7rem;background:var(--card);
max-height:32rem;overflow-y:auto}
.btab{border-collapse:collapse;width:100%;font-size:.86rem;font-variant-numeric:tabular-nums}
.btab th{position:sticky;top:0;background:var(--ink);color:var(--paper);text-align:left;
padding:.35rem .5rem;font-weight:700;white-space:nowrap}
.btab td{padding:.3rem .5rem;border-bottom:1px solid var(--rule);vertical-align:baseline}
.btab tr:hover td{background:var(--row-hover)}
.btab .bt{font-weight:800;font-size:1rem}
.btab .bno,.btab .beq,.btab .bo{white-space:nowrap;color:var(--ink-soft)}
.btab a{color:var(--ink);font-weight:600;text-decoration:none}
.btab a:hover{text-decoration:underline}
.btab .h-in{display:none}
.fboard.js .btab .bd{display:none}
.fboard.js.in .btab .h-in{display:inline}
.fboard.js.in .btab .h-out{display:none}
.bempty{font-size:.85rem;color:var(--gloss)}
.allist{list-style:none;padding:0;margin:0;display:grid;
grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:.35rem .8rem}
.allist a{color:var(--link);font-weight:600}
.alcode{display:inline-block;min-width:2.1rem;font-size:.72rem;font-weight:700;
border:1.5px solid var(--ink);border-radius:.35rem;padding:.02em .3em;text-align:center}
.pw{font-size:.72rem;color:var(--gloss);margin-left:-.35rem}
.chg{list-style:none;margin:0;padding:0;font-size:.78rem;color:var(--ink)}
.chg li::before{content:"▸ ";color:var(--ant-dark)}
.seen{font-size:.74rem;color:var(--gloss);line-height:1.45}
.seenh{font-style:italic}
.seen1{white-space:nowrap;font-variant-numeric:tabular-nums}
.flightsfoot{margin:1.6rem 0 1rem;font-size:.85rem;color:var(--ink-soft);
max-width:46rem}
.flightsfoot a{color:var(--ink-soft)}
.srcs summary{cursor:pointer;font-weight:700}
.srcs ul{padding-left:1.1rem;margin:.3rem 0}
.affnote{border-left:3px solid var(--gold,#c9a227);padding-left:.6rem}
.farr{margin:0 0 2.2rem}
.farr h2{margin:0 0 .4rem}
.arrrow{display:flex;flex-wrap:wrap;gap:.4rem}
.arr1{display:inline-flex;align-items:center;gap:.35rem;font-size:.85rem;font-weight:700;
color:var(--ink);text-decoration:none;border:2px solid var(--ink);border-radius:2rem;
padding:.22rem .8rem;background:var(--card)}
.arr1:hover{background:var(--ink);color:var(--paper)}
.arr1 .rowicon{width:18px;height:18px}
.arrb{font-weight:400;color:var(--gloss)}
.arr1:hover .arrb{color:var(--paper)}
.arrnote{font-size:.78rem;color:var(--gloss);margin:.35rem 0 0}
.ftrip{margin:0 0 2.2rem}
.ftrip h2{margin:0 0 .2rem}
.ftrip.js .tnojs{display:none}
.trow{display:flex;flex-wrap:wrap;gap:.5rem .8rem;align-items:flex-end;margin:0 0 .55rem}
.tw{display:flex;flex-direction:column;gap:.15rem;font-size:.8rem;font-weight:700;color:var(--ink-soft);min-width:0}
.tw input,.tw select{font:inherit;font-size:.9rem;font-weight:400;border:2px solid var(--ink);border-radius:.5rem;
padding:.25rem .45rem;background:var(--card);color:var(--ink);max-width:100%}
.tw input[type=number]{width:6rem}
.tsum{font-size:.85rem;color:var(--ink-soft);margin:.3rem 0 .5rem}
.tpairs{display:grid;gap:.55rem}
.tpair{background:var(--card);border:2px solid var(--ink);border-radius:.7rem;padding:.5rem .65rem;
box-shadow:3px 3px 0 var(--card-alt)}
.tph{display:flex;flex-wrap:wrap;gap:.2rem .7rem;align-items:baseline;margin:0 0 .25rem}
.tph b{font-size:1.05rem;font-variant-numeric:tabular-nums}
.tnights{font-size:.82rem;font-weight:700;border-radius:2rem;padding:.08em .6em;background:var(--card-alt);
border:1.5px solid var(--gloss)}
.tleg{display:flex;flex-wrap:wrap;gap:.15rem .6rem;align-items:center;font-size:.86rem;
padding:.2rem 0;border-top:1px solid var(--rule);font-variant-numeric:tabular-nums}
.tleg .rowicon{width:16px;height:16px;flex:0 0 auto}
.tleg.back .rowicon{transform:scaleX(-1)}
.tleg .tt1{font-weight:700}
.tleg .tseen{font-size:.75rem;color:var(--gloss);font-style:italic}
.tleg .fare{margin:0 0 0 auto;font-size:.78rem;padding:.12rem .7rem}
.tleg .tthb{font-weight:800}
.tboth{font-size:.85rem;font-weight:800;color:var(--ant-dark)}
.tmore{font:inherit;font-size:.85rem;margin:.5rem 0 0;border:2px solid var(--ink);border-radius:2rem;
background:var(--card);color:var(--ink);padding:.25rem .9rem;cursor:pointer}
.tgap{font-size:.8rem;color:var(--ink-soft);margin:.5rem 0 0}
"""

# ---------------------------------------------------------------------- js

JS = """// flights.js — generated by flights_layer.py
// The page is baked; this keeps it fresh between builds: fare links get a
// bookable date ~3 weeks out, seasonal chips follow the reader's month, and
// the timetable board shows one airport, one direction, one date.
(function(){
var d=new Date();d.setDate(d.getDate()+21);
var mm=String(d.getMonth()+1).padStart(2,'0'),dd=String(d.getDate()).padStart(2,'0');
document.querySelectorAll('a.fare[data-org]').forEach(function(a){
  var u=new URL(a.href);
  u.pathname='/search/'+a.dataset.org+dd+mm+a.dataset.dst+'1';
  a.href=u.toString();});
var month=new Date().getMonth()+1;
document.querySelectorAll('.schip[data-months]').forEach(function(ch){
  if(ch.hasAttribute('data-upcoming'))return;
  var on=ch.dataset.months.split(',').indexOf(String(month))>=0;
  ch.classList.toggle('on',on);
  var card=ch.closest('.route');if(card)card.classList.toggle('off',!on);});

var B=document.querySelector('.fboard');if(!B)return;
var TD=['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'],ED=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var TM=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function bkk(off){var t=new Date(Date.now()+7*3600e3+off*864e5);
  return {iso:t.toISOString().slice(0,10),dow:t.getUTCDay(),day:t.getUTCDate(),mon:t.getUTCMonth()};}
var st={ap:'CNX',dir:'out',day:bkk(0)};
var box=B.querySelector('.seg.dates');
for(var i=0;i<7;i++){(function(i){var x=bkk(i),b=document.createElement('button');
  b.type='button';b.dataset.v=String(i);b.setAttribute('aria-pressed',i===0?'true':'false');
  b.innerHTML='<span class="bi"><span class="th" lang="th">'+(i===0?'วันนี้':TD[x.dow]+' '+x.day+' '+TM[x.mon])+
   '</span><span class="en" lang="en"> · '+(i===0?'Today':ED[x.dow]+' '+x.day)+'</span></span>';
  box.appendChild(b);})(i);}
var pick=document.createElement('input');pick.type='date';pick.className='dpick';
pick.setAttribute('aria-label','วันที่ · Date');pick.min=bkk(0).iso;box.appendChild(pick);
pick.addEventListener('change',function(){if(!pick.value)return;
  var t=new Date(pick.value+'T00:00:00Z');st.day={iso:pick.value,dow:t.getUTCDay(),day:t.getUTCDate(),mon:t.getUTCMonth()};
  box.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed','false');});paint();});
var rows=[].slice.call(B.querySelectorAll('.btab tr[data-ap]'));
var empty=B.querySelector('.bempty');
function paint(){
  var dn=String((st.day.dow+6)%7+1),n=0;
  B.classList.toggle('in',st.dir==='in');
  rows.forEach(function(r){var s=r.dataset,ok=s.ap===st.ap&&s.dir===st.dir&&s.days.indexOf(dn)>=0&&
    (!s.from||s.from<=st.day.iso)&&(!s.to||s.to>=st.day.iso);r.hidden=!ok;if(ok)n++;});
  empty.hidden=n>0;}
B.addEventListener('click',function(ev){var b=ev.target.closest('.seg button');if(!b)return;
  var seg=b.parentNode,k=seg.dataset.k;
  seg.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false');});
  if(k==='day'){st.day=bkk(+b.dataset.v);pick.value='';}else st[k]=b.dataset.v;paint();});
B.classList.add('js');paint();
})();

// today's flights: data/flightboard.json (AirLabs), one airport and direction at a time
(function(){
var S=document.getElementById('today');if(!S)return;
var N=JSON.parse(document.getElementById('tdnames').textContent),key='CNX-dep',B=null;
function bi(th,en){return '<span class="bi"><span class="th" lang="th">'+th+'</span><span class="en" lang="en">'+en+'</span></span>';}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function ts(f,s){return (f[s+'_actual_ts']||f[s+'_estimated_ts']||f[s+'_time_ts']||0)*1000;}
function st(f){var d=f.delayed||f.dep_delayed||f.arr_delayed;
 if(f.status==='cancelled')return['bad','ยกเลิก','cancelled'];
 if(f.status==='landed')return['done','ลงแล้ว '+(f.arr_actual||'').slice(11,16),'landed '+(f.arr_actual||'').slice(11,16)];
 if(f.status==='active')return['ok','บินอยู่ ถึงราว '+(f.arr_estimated||f.arr_time||'').slice(11,16),'in the air, due '+(f.arr_estimated||f.arr_time||'').slice(11,16)];
 if(d>=15)return['late','ช้า '+d+' นาที',d+' min late'];
 return['ok','ตรงเวลา','on time'];}
function paint(){
 if(!B)return;var k=key.split('-'),ap=k[0],side=k[1],now=Date.now();
 var fs=B.flights.filter(function(f){return f[side+'_iata']===ap;}).sort(function(a,b){return ts(a,side)-ts(b,side);});
 var other=side==='dep'?'arr':'dep';
 document.getElementById('tdlist').innerHTML=fs.length?fs.map(function(f){
  var s=st(f),t=f[side+'_actual']||f[side+'_estimated']||f[side+'_time'],sc=f[side+'_time'],o=f[other+'_iata'],pl=N.p[o]||[o,o],al=N.a[f.airline_iata]||[f.airline_iata,f.airline_iata];
  var past=s[0]==='done';
  var ex=[f.aircraft_icao,f.dep_terminal&&side==='dep'?('T'+f.dep_terminal):'',f.dep_gate&&side==='dep'?bi('ประตู '+esc(f.dep_gate),'gate '+esc(f.dep_gate)):'',f.arr_gate&&side==='arr'?bi('ประตู '+esc(f.arr_gate),'gate '+esc(f.arr_gate)):'',f.arr_baggage&&side==='arr'?bi('สายพาน '+esc(f.arr_baggage),'belt '+esc(f.arr_baggage)):'',f.duration?bi(f.duration+' นาที',f.duration+' min'):''].filter(Boolean).join(' · ');
  return '<div class="tdrow '+(past?'done ':'')+s[0]+'"><div class="tm">'+esc((t||'').slice(11,16))+(t&&sc&&t!==sc?'<s>'+esc(sc.slice(11,16))+'</s>':'')+'</div>'+
   '<div class="wh">'+bi((side==='dep'?'ไป ':'จาก ')+esc(pl[0]),(side==='dep'?'to ':'from ')+esc(pl[1]))+' · '+esc(f.flight_iata)+'<small>'+bi(esc(al[0]),esc(al[1]))+(ex?' · '+ex:'')+'</small></div>'+
   '<div class="st">'+bi(s[1],s[2])+'</div></div>';}).join(''):'<p>'+bi('ไม่มีเที่ยวบินในไฟล์ตอนนี้','No flights in the file right now')+'</p>';
}
S.addEventListener('click',function(e){var b=e.target.closest('button[data-tk]');if(!b)return;key=b.dataset.tk;
 S.querySelectorAll('button[data-tk]').forEach(function(x){x.setAttribute('aria-pressed',String(x===b));});paint();});
fetch('data/flightboard.json').then(function(r){return r.json();}).then(function(d){B=d;
 document.getElementById('tdnote').innerHTML=bi('สถานะจาก AirLabs อัปเดต '+d.generated.slice(11,16)+' น. เวลาท้องถิ่นของแต่ละสนามบิน วันละเจ็ดรอบ','Status from AirLabs, updated '+d.generated.slice(11,16)+'. Local time at each airport. Refreshed seven times a day.');
 paint();},function(){S.hidden=true;});
setInterval(paint,60000);
})();
"""


TRIP_CORE = """
// weekend away: pair out and back flights (the pairing in ~/.claude/bin/trip, on timetable rows).
// Times are local at each airport; a window is local at the airport the flight leaves from.
var mdTrip=(function(){
function addDays(iso,n){var t=new Date(iso+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);}
function dow(iso){return (new Date(iso+'T00:00:00Z').getUTCDay()+6)%7+1;}
function ms(iso,hm,tz){return Date.parse(iso+'T'+hm+':00Z')-tz*3600e3;}
function legs(P,dir,lo,hi){
  var tzD=dir==='out'?7:P.tz,tzA=dir==='out'?P.tz:7,got=[],have={};
  for(var day=lo.slice(0,10);day<=hi.slice(0,10);day=addDays(day,1)){
    var dn=String(dow(day));
    P.legs.forEach(function(f){
      if(f.d!==dir)return;
      if(f.on){if(f.on.indexOf(day)<0)return;}
      else{var v=f.valid.split('/');if(f.days.indexOf(dn)<0||(v[0]&&day<v[0])||(v[1]&&day>v[1]))return;}
      var at=day+'T'+f.dep;if(at<lo||at>hi)return;
      var k=f.al+at;if(have[k])return;have[k]=1;
      var ad=addDays(day,f.plus||0);
      got.push({f:f,day:day,aday:ad,dep:ms(day,f.dep,tzD),arr:ms(ad,f.arr,tzA)});});
  }
  // a timetable row wins over the same flight seen on a booking page
  got.sort(function(a,b){return (a.f.seen||0)-(b.f.seen||0);});
  var seen={};got=got.filter(function(x){var k=x.f.al+x.day+x.f.dep;if(seen[k])return false;seen[k]=1;return true;});
  return got.sort(function(a,b){return a.dep-b.dep;});
}
// nights in the city: each 02:00 there that falls between landing and leaving
function nights(arr,dep,tz){
  var n=0,day=new Date(arr+tz*3600e3).toISOString().slice(0,10);
  for(;;day=addDays(day,1)){var two=ms(day,'02:00',tz);if(two>dep)return n;if(two>arr)n++;}
}
function pairs(P,q){
  var outs=legs(P,'out',q.outLo,q.outHi),backs=legs(P,'in',q.backLo,q.backHi),ps=[];
  outs.forEach(function(o){backs.forEach(function(b){
    var ground=(b.dep-o.arr)/36e5,whole=(b.arr-o.dep)/36e5;
    if(ground>0&&ground>=q.min&&whole<=q.max)
      ps.push({out:o,back:b,ground:ground,whole:whole,nights:nights(o.arr,b.dep,P.tz)});});});
  ps.sort(function(a,b){return a.nights-b.nights||b.ground-a.ground||a.out.dep-b.out.dep;});
  return {outs:outs,backs:backs,pairs:ps};
}
// the first n, plus the longest stay at every other count of nights
function pick(ps,n){
  var shown=ps.slice(0,n),best={};
  ps.forEach(function(p){if(!(p.nights in best))best[p.nights]=p;});
  Object.keys(best).forEach(function(k){if(shown.indexOf(best[k])<0)shown.push(best[k]);});
  return shown;
}
// a cached fare for this leg: same airports, airline and departure; F = data.fares
function fresh(F,now){return !!F&&(now-Date.parse(F.asof+'T00:00:00+07:00'))/864e5<F.max+1;}
function price(F,P,x,back){
  var o=back?x.f.ap:P.from,d=back?P.from:x.f.ap;
  return F&&F.thb[o+'>'+d+' '+x.f.al+' '+x.day+'T'+x.f.dep]||0;
}
return {legs:legs,nights:nights,pairs:pairs,pick:pick,addDays:addDays,fresh:fresh,price:price};
})();
"""

TRIP_UI = """
(function(){
var S=document.getElementById('trip');if(!S||!window.mdTrip)return;
var D=JSON.parse(document.getElementById('tripdata').textContent),T=window.mdTrip;
var F=T.fresh(D.fares,Date.now())?D.fares:null;
var TD=['จ.','อ.','พ.','พฤ.','ศ.','ส.','อา.'],ED=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
var TM=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
var EM=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function bi(th,en){return '<span class="bi"><span class="th" lang="th">'+th+'</span><span class="en" lang="en">'+en+'</span></span>';}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function icon(n){return window.mdIcon?window.mdIcon(n,16):'';}
function q(c){return S.querySelector(c);}
var st={from:'CNX',all:false},sel=q('.tto'),out=q('.tout');
// next Saturday (today if it is Saturday), Bangkok time
var now=new Date(Date.now()+7*36e5),today=now.toISOString().slice(0,10);
var sat=T.addDays(today,(6-now.getUTCDay()+7)%7),sun=T.addDays(sat,1),mon=T.addDays(sat,2);
q('.ol').value=sat+'T16:00';q('.oh').value=sun+'T11:00';q('.bl').value=sun+'T18:00';q('.bh').value=mon+'T11:00';
function places(){
  var cur=sel.value;sel.innerHTML='';
  D.places.forEach(function(p){if(p.from!==st.from)return;var o=document.createElement('option');
    o.value=p.k;o.textContent=p.th+' · '+p.en+' ('+p.aps.join(' + ')+')';sel.appendChild(o);});
  if(cur&&[].some.call(sel.options,function(o){return o.value===cur;}))sel.value=cur;
}
function dlabel(iso){var t=new Date(iso+'T00:00:00Z'),w=(t.getUTCDay()+6)%7;
  return [TD[w]+' '+t.getUTCDate()+' '+TM[t.getUTCMonth()],ED[w]+' '+t.getUTCDate()+' '+EM[t.getUTCMonth()]];}
function hrs(h){var m=Math.round(h*60),H=Math.floor(m/60),M=m%60;
  return [(H?H+' ชม. ':'')+(M?M+' นาที':''),H+'h '+(M<10?'0':'')+M+'m'];}
function fare(org,dst,iso){
  return D.aff.host+'/search/'+org+iso.slice(8,10)+iso.slice(5,7)+dst+'1?marker='+encodeURIComponent(D.aff.marker);}
function al(c){return D.al[c]||[c,c];}
function baht(n){return '฿'+n.toLocaleString('en-US');}
function leg(x,P,back){
  var f=x.f,a=al(f.al),d=dlabel(x.day),home=P.from,org=back?f.ap:home,dst=back?home:f.ap;
  var plus=x.aday!==x.day?'<sup>+1</sup>':'',thb=T.price(F,P,x,back);
  return '<div class="tleg'+(back?' back':'')+'">'+icon('i-plane')+
    '<span class="tt1">'+bi(d[0],d[1])+' '+esc(f.dep)+'</span>'+
    '<span>'+esc(org)+' → '+esc(dst)+' '+esc(f.arr)+plus+'</span>'+
    '<span>'+bi(esc(a[0]),esc(a[1]))+(f.no?' '+esc(f.no):'')+'</span>'+
    (f.seen?'<span class="tseen">'+bi('เวลาที่เห็นในหน้าจองตั๋ววันนั้น','time seen on a booking page for that day')+'</span>':'')+
    '<a class="fare" href="'+esc(fare(org,dst,x.day))+'" rel="nofollow sponsored noopener" target="_blank">'+
    (thb?'<b class="tthb">'+baht(thb)+'</b> ':'')+bi('ราคาตั๋ว','Fares')+' →</a></div>';
}
function paint(){
  var P=null;D.places.forEach(function(p){if(p.k===sel.value)P=p;});if(!P){out.innerHTML='';return;}
  var Q={outLo:q('.ol').value,outHi:q('.oh').value,backLo:q('.bl').value,backHi:q('.bh').value,
    min:+q('.tmin').value||0,max:+q('.tmax').value||1e9};
  if(!(Q.outLo&&Q.outHi&&Q.backLo&&Q.backHi)){out.innerHTML='';return;}
  var R=T.pairs(P,Q),shown=st.all?R.pairs:T.pick(R.pairs,9),h='';
  h+='<p class="tsum">'+bi('ขาไป '+R.outs.length+' เที่ยว × ขากลับ '+R.backs.length+' เที่ยว → '+R.pairs.length+' คู่ที่เข้าเงื่อนไข',
    R.outs.length+' out × '+R.backs.length+' back → '+R.pairs.length+' pairs fit')+'</p>';
  if(shown.length){
    h+='<div class="tpairs">'+shown.map(function(p){var g=hrs(p.ground),n=p.nights,
        a=T.price(F,P,p.out,false),b=T.price(F,P,p.back,true);
      return '<div class="tpair"><div class="tph"><b>'+bi(g[0]+' ที่'+esc(P.th),g[1]+' in '+esc(P.en))+'</b>'+
        '<span class="tnights">'+icon('i-bed')+' '+(n?bi('ค้าง '+n+' คืน',n+' hotel night'+(n>1?'s':'')):bi('ไม่ต้องค้างคืน','no hotel night'))+'</span>'+
        (a&&b?'<span class="tboth">'+bi('ไป–กลับ '+baht(a+b),baht(a+b)+' both flights')+'</span>':'')+'</div>'+
        leg(p.out,P,false)+leg(p.back,P,true)+'</div>';}).join('')+'</div>';
    if(!st.all&&shown.length<R.pairs.length)
      h+='<button type="button" class="tmore">'+bi('ดูทั้งหมด '+R.pairs.length+' คู่','Show all '+R.pairs.length+' pairs')+'</button>';
  }else{
    var ol=Q.outLo.slice(0,10),bl=Q.backLo.slice(0,10),a=dlabel(ol),b=dlabel(bl);
    h+='<p>'+bi('ไม่มีคู่เที่ยวบินในตารางที่เรามีที่เข้ากับช่วงเวลานี้ ลองขยายช่วงเวลา หรือค้นราคาตั๋วตามวัน:',
      'No pair in our rows fits these windows. Widen a window, or search fares by day:')+'</p>'+
      '<p class="trow"><a class="fare" href="'+esc(fare(P.from,P.aps[0],ol))+'" rel="nofollow sponsored noopener" target="_blank">'+bi('ขาไป '+a[0],'Out '+a[1])+' →</a>'+
      '<a class="fare" href="'+esc(fare(P.aps[0],P.from,bl))+'" rel="nofollow sponsored noopener" target="_blank">'+bi('ขากลับ '+b[0],'Back '+b[1])+' →</a></p>';
  }
  if(F&&shown.length){var s=dlabel(F.asof);
    h+='<p class="tgap">'+bi('ราคา ฿ จากแคชการค้นหาของ Aviasales เห็นเมื่อ '+s[0]+' ผู้ใหญ่หนึ่งคน มีเฉพาะบางเที่ยว ราคาวันนี้อยู่ในปุ่มราคาตั๋ว',
      '฿ prices are from Aviasales’ search cache, seen '+s[1]+', one adult, for some flights only; the fare link shows today’s price.')+'</p>';}
  if(P.gap.length)
    h+='<p class="tgap">'+bi('บินเส้นนี้ด้วย แต่เวลายังไม่อยู่ในตารางที่เรามีครบ: '+P.gap.map(function(c){return esc(al(c)[0]);}).join(', ')+' ปุ่มราคาตั๋วค้นทุกสายการบิน',
      'Also on this route, times not fully in our rows: '+P.gap.map(function(c){return esc(al(c)[1]);}).join(', ')+'. The fare links search every airline.')+'</p>';
  out.innerHTML=h;
}
S.addEventListener('click',function(e){
  var b=e.target.closest('.seg button');
  if(b){b.parentNode.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false');});
    st.from=b.dataset.v;st.all=false;places();paint();return;}
  if(e.target.closest('.tmore')){st.all=true;paint();}});
S.addEventListener('input',function(){st.all=false;paint();});
S.addEventListener('change',function(){st.all=false;paint();});
places();S.classList.add('js');q('.tform').hidden=false;paint();
})();
"""


# -------------------------------------------------------------------- emit

def emit(g, data=None):
    docs = g["DOCS"]
    (docs / "flights.css").write_text(CSS)
    (docs / "flights.js").write_text(JS + TRIP_CORE + TRIP_UI)
    (docs / "flights.html").write_text(build_board(g))
    (docs / "widgets").mkdir(exist_ok=True)
    (docs / "widgets" / "flights.html").write_text(build_widget(g))
    n = {"CNX": 0, "CEI": 0}
    for r in ROUTES:
        n[r["airport"]] += 1
    n_tt = sum(1 for r in ROUTES if r.get("out") or r.get("in"))
    return (f'{n["CNX"]} CNX + {n["CEI"]} CEI routes, {n_tt} with timetable rows, '
            f'{len(AIRLINES)} airlines, as of {AS_OF}')


def main():
    import build  # importing does not build: build() runs under __main__ only
    if not (build.DOCS / "index.html").exists():
        raise SystemExit("docs/ is not built yet — run python3 build.py first")
    print(emit(vars(build)))


if __name__ == "__main__":
    main()
