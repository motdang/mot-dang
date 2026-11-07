#!/usr/bin/env python3
"""Voight-Kampff weekly: robot gossip from motdang.net's own request log.

    python3 vk_weekly.py                 # the 7 Chiang Mai days ending yesterday, build + publish
    python3 vk_weekly.py --end 2026-09-26 --no-deploy
                                         # the 7 days before 26 Sept, write files only
    python3 vk_weekly.py --lost          # only the sala at /this-page-does-not-exist-smoke-test,
                                         # from the newest week already counted

Numbers come from two places, both read with the fleet token:
  traffic_eye   the site Worker's per-request log (Analytics Engine, 90 days, since 8 Sept 2026)
  beacon        Cloudflare's browser beacon, account level: the people count

Writes
  data/voight-kampff/<last day>.json        the week's numbers
  assets/voight-kampff/<last day>/          the issue page + card.png
  assets/voight-kampff/index.html           the gossip block between the vk:weekly markers, and AGE
then copies assets/voight-kampff into docs/ and runs publish/deploy.py --only voight-kampff --yes,
after waiting out any build.py that is running.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# The @font-face run the site inlines into style.css, with its font paths made
# root-absolute: /fonts/_faces.css was linked here and never existed (a 404 on
# every issue until 2026-10-03).
_FACES = ROOT / "assets" / "fonts" / "_faces.css"
FACES_STYLE = ("<style>" + _FACES.read_text().strip().replace("url(fonts/", "url(/fonts/")
               + "</style>") if _FACES.exists() else ""
sys.path.insert(0, str(ROOT))
from traffic import KEYS_PATH, sql  # noqa: E402

VK = ROOT / "assets" / "voight-kampff"
DATA = ROOT / "data" / "voight-kampff"
DOCS = ROOT / "docs"
HOST = "motdang.net"
ICT = dt.timezone(dt.timedelta(hours=7))
INCEPT = dt.date(2026, 7, 27)
LOG_START = dt.date(2026, 9, 8)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
N = "SUM(_sample_interval * double1) AS n"
FORMS = ("/suggest.html", "/add.html", "/claim.html", "/search.html", "/")
CONTENT = ("AND (blob4 LIKE '%.html' OR blob4 NOT LIKE '%.%') AND blob4 NOT IN "
           "('" + "','".join(FORMS) + "')")

# who makes each bot, where that is known; en, th
OWNER = {
    "meta-externalagent": ("Meta, Facebook's owner", "บริษัทเจ้าของเฟซบุ๊ก"),
    "Facebook": ("Facebook's link-preview bot", "บอทของเฟซบุ๊ก ที่ทำรูปตัวอย่างลิงก์"),
    "ClaudeBot": ("Anthropic, the Claude company", "บริษัทที่ทำ Claude"),
    "GPTBot": ("OpenAI, the ChatGPT company", "บริษัทที่ทำ ChatGPT"),
    "OAI-SearchBot": ("OpenAI's search", "ระบบค้นหาของ OpenAI"),
    "ChatGPT-User": ("ChatGPT, fetching for someone mid-chat", "ChatGPT มาเปิดหน้าให้คนที่กำลังแชตอยู่"),
    "Amazonbot": ("Amazon", "อเมซอน"),
    "Bytespider": ("ByteDance, TikTok's owner", "บริษัทเจ้าของ TikTok"),
    "TikTokSpider": ("TikTok", "TikTok"),
    "Applebot": ("Apple", "แอปเปิล"),
    "bingbot": ("Microsoft's Bing", "Bing ของไมโครซอฟท์"),
    "Googlebot": ("Google", "กูเกิล"),
    "YandexBot": ("Yandex, Russia's search engine", "ยานเดกซ์ เว็บค้นหาของรัสเซีย"),
    "PetalBot": ("Huawei's search", "ระบบค้นหาของหัวเว่ย"),
    "SemrushBot": ("Semrush, a marketing-data company", "Semrush บริษัทขายข้อมูลการตลาด"),
    "AhrefsBot": ("Ahrefs, a marketing-data company", "Ahrefs บริษัทขายข้อมูลการตลาด"),
    "MJ12bot": ("Majestic, which maps who links to whom", "Majestic บริษัทที่จดว่าเว็บไหนลิงก์หาเว็บไหน"),
    "Internet Archive": ("the Internet Archive, a library of old web pages",
                         "Internet Archive ห้องสมุดเก็บหน้าเว็บเก่า"),
}
COUNTRY = {
    "CN": ("China", "จีน"), "RU": ("Russia", "รัสเซีย"), "US": ("the US", "อเมริกา"),
    "SG": ("Singapore", "สิงคโปร์"), "TH": ("Thailand", "ไทย"), "FR": ("France", "ฝรั่งเศส"),
    "DE": ("Germany", "เยอรมนี"), "NL": ("the Netherlands", "เนเธอร์แลนด์"), "GB": ("Britain", "อังกฤษ"),
    "BR": ("Brazil", "บราซิล"), "IN": ("India", "อินเดีย"), "HK": ("Hong Kong", "ฮ่องกง"),
    "VN": ("Vietnam", "เวียดนาม"), "JP": ("Japan", "ญี่ปุ่น"), "KR": ("Korea", "เกาหลี"),
    "CA": ("Canada", "แคนาดา"), "FI": ("Finland", "ฟินแลนด์"), "PL": ("Poland", "โปแลนด์"),
    "UA": ("Ukraine", "ยูเครน"), "BE": ("Belgium", "เบลเยียม"), "ID": ("Indonesia", "อินโดนีเซีย"),
    "AU": ("Australia", "ออสเตรเลีย"), "TR": ("Turkey", "ตุรกี"), "MY": ("Malaysia", "มาเลเซีย"),
    "LA": ("Laos", "ลาว"), "MM": ("Myanmar", "พม่า"), "KH": ("Cambodia", "กัมพูชา"),
}
DAY_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DAY_TH = ["จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์", "อาทิตย์"]
MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"]
MON_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
BURGLAR = ("wp-admin", "wp-login", "xmlrpc", ".env", "phpinfo", ".git/", "phpmyadmin", "config.php",
           "/cgi-bin", "/admin.php", "/.aws", "wp-includes", "wp-content")
FACE = ("logo", "favicon", "icon")


# ── reading the log ────────────────────────────────────────────────────────────

def utc(d: dt.date) -> str:
    """Midnight Chiang Mai time on day d, as the UTC string the SQL API compares."""
    return (dt.datetime(d.year, d.month, d.day) - dt.timedelta(hours=7)).strftime("%Y-%m-%d %H:%M:%S")


def win(a: dt.date, b: dt.date) -> str:
    return (f"blob1 = '{HOST}' AND timestamp >= toDateTime('{utc(a)}') "
            f"AND timestamp < toDateTime('{utc(b)}')")


def num(r) -> int:
    return int(float(r["n"]))


def ict(ts: str) -> dt.datetime:
    return dt.datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=dt.timezone.utc).astimezone(ICT)


def beacon(a: dt.date, b: dt.date) -> dict:
    cf = json.loads(KEYS_PATH.read_text())["cloudflare"]
    f = '{datetime_geq:$s,datetime_lt:$e,requestHost:"%s"}' % HOST
    q = ("query($a:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){"
         f"t:rumPageloadEventsAdaptiveGroups(limit:200,filter:{f}){{count sum{{visits}} dimensions{{countryName deviceType}}}}"
         f"p:rumPageloadEventsAdaptiveGroups(limit:20,orderBy:[count_DESC],filter:{f}){{count dimensions{{requestPath}}}}"
         f"r:rumPageloadEventsAdaptiveGroups(limit:30,orderBy:[count_DESC],filter:{f}){{count sum{{visits}} dimensions{{refererHost}}}}"
         "}}}")
    iso = lambda d: utc(d).replace(" ", "T") + "Z"  # noqa: E731
    body = json.dumps({"query": q, "variables": {"a": cf["account_id"], "s": iso(a), "e": iso(b)}}).encode()
    req = urllib.request.Request("https://api.cloudflare.com/client/v4/graphql", body,
                                 {"Authorization": "Bearer " + cf["api_token"], "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    if d.get("errors") or not d.get("data"):
        return {}
    acc = d["data"]["viewer"]["accounts"][0]
    t = acc["t"]
    ref = {}
    for x in acc["r"]:
        h = x["dimensions"]["refererHost"] or ""
        ref[h] = ref.get(h, 0) + x["sum"]["visits"]
    countries = {}
    for x in t:
        c = x["dimensions"]["countryName"]
        countries[c] = countries.get(c, 0) + x["sum"]["visits"]
    return {
        "loads": sum(x["count"] for x in t),
        "visits": sum(x["sum"]["visits"] for x in t),
        "mobile": sum(x["sum"]["visits"] for x in t if x["dimensions"]["deviceType"] == "mobile"),
        "countries": dict(sorted(countries.items(), key=lambda kv: -kv[1])),
        "pages": [[x["dimensions"]["requestPath"], x["count"]] for x in acc["p"]],
        "facebook": sum(v for h, v in ref.items() if "facebook" in h),
        "google": sum(v for h, v in ref.items() if "google" in h),
    }


def collect(a: dt.date, b: dt.date) -> dict:
    W = win(a, b)
    out: dict = {"from": a.isoformat(), "to": (b - dt.timedelta(days=1)).isoformat()}
    out["total"] = sum(num(r) for r in sql(f"SELECT blob1 s, {N} FROM traffic_eye WHERE {W} GROUP BY s"))
    out["cats"] = {r["c"]: num(r) for r in sql(
        f"SELECT blob2 c, {N} FROM traffic_eye WHERE {W} GROUP BY c ORDER BY n DESC LIMIT 20")}
    agents = {}
    for r in sql(f"SELECT blob3 a, blob2 c, {N} FROM traffic_eye WHERE {W} "
                 "GROUP BY a, c ORDER BY n DESC LIMIT 80"):
        agents.setdefault(r["a"], {"cat": r["c"], "n": 0})["n"] += num(r)
    out["agents"] = agents

    bots = [k for k, v in sorted(agents.items(), key=lambda kv: -kv[1]["n"])
            if v["cat"] not in ("human", "none") and v["n"] >= 3000][:14]
    inlist = "('" + "','".join(x.replace("'", "") for x in bots) + "')"
    hours: dict = {}
    for r in sql(f"SELECT blob3 a, toHour(timestamp) h, {N} FROM traffic_eye WHERE {W} "
                 f"AND blob3 IN {inlist} GROUP BY a, h LIMIT 1000"):
        hours.setdefault(r["a"], [0] * 24)[(int(r["h"]) + 7) % 24] += num(r)
    out["hours"] = hours
    cc: dict = {}
    for r in sql(f"SELECT blob3 a, blob5 c, {N} FROM traffic_eye WHERE {W} AND blob3 IN {inlist} "
                 "GROUP BY a, c ORDER BY n DESC LIMIT 200"):
        cc.setdefault(r["a"], {})[r["c"]] = num(r)
    out["countries"] = cc
    fav: dict = {}
    for r in sql(f"SELECT blob3 a, blob4 p, {N} FROM traffic_eye WHERE {W} AND blob6 = '200' "
                 f"AND blob3 IN {inlist} {CONTENT} GROUP BY a, p ORDER BY n DESC LIMIT 600"):
        fav.setdefault(r["a"], [])
        if len(fav[r["a"]]) < 5:
            fav[r["a"]].append([r["p"], num(r)])
    out["fav"] = fav
    out["places"] = {r["a"]: num(r) for r in sql(
        f"SELECT blob3 a, {N} FROM traffic_eye WHERE {W} AND blob6 = '200' AND blob2 != 'human' "
        "AND (blob4 LIKE '/cm/p/%' OR blob4 LIKE '/cr/p/%') GROUP BY a ORDER BY n DESC LIMIT 10")}
    seen = {}
    for r in sql(f"SELECT blob3 a, MIN(timestamp) f, MAX(timestamp) l FROM traffic_eye "
                 f"WHERE blob1 = '{HOST}' AND timestamp < toDateTime('{utc(b)}') "
                 f"AND blob3 IN {inlist} GROUP BY a"):
        seen[r["a"]] = [r["f"], r["l"]]
    out["seen"] = seen
    # misses: not her own machines in Thailand, not the plain favicon every browser asks for
    out["misses"] = [[r["a"], r["p"], r["c"], num(r)] for r in sql(
        f"SELECT blob3 a, blob4 p, blob5 c, {N} FROM traffic_eye WHERE {W} AND blob6 = '404' "
        "AND blob5 != 'TH' AND blob4 != '/favicon.ico' GROUP BY a, p, c ORDER BY n DESC LIMIT 300")]
    out["fibber"] = {r["c"]: num(r) for r in sql(
        f"SELECT blob5 c, {N} FROM traffic_eye WHERE {W} AND blob2 = 'human' "
        "AND blob7 = 'www.google.com' GROUP BY c ORDER BY n DESC LIMIT 5")}
    out["anthill"] = anthill_week(a, b)
    try:
        out["people"] = beacon(a, b)
    except Exception as e:  # the gossip still runs without the people count
        print("beacon:", e, file=sys.stderr)
        out["people"] = {}
    return out


ANTHILL = "https://motdang.net/anthill"


def anthill_week(a: dt.date, b: dt.date) -> dict:
    """The bots' forum at /anthill: who was shown out its back door this week, and the week's counts."""
    since = dt.datetime.combine(a, dt.time(), ICT).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    until = dt.datetime.combine(b, dt.time(), ICT).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        req = urllib.request.Request(f"{ANTHILL}/api/v1/gate?since={since}", headers={"User-Agent": "vk-weekly"})
        g = json.load(urllib.request.urlopen(req, timeout=20))
    except Exception as ex:  # the gossip still runs without the anthill
        print("anthill:", ex, file=sys.stderr)
        return {}
    g["booted"] = [x for x in g.get("booted", []) if x.get("booted_at", "") < until]
    return g


# ── words ──────────────────────────────────────────────────────────────────────

def c(n: int) -> str:
    return f"{n:,}"


def when(ts: str) -> tuple[str, str]:
    t = ict(ts)
    return (f"{DAY_EN[t.weekday()]} {t.day} {MON_EN[t.month - 1]}, {t:%H:%M}",
            f"วัน{DAY_TH[t.weekday()]} {t.day} {MON_TH[t.month - 1]} {t:%H:%M} น.")


def span(a: str, b: str) -> tuple[str, str]:
    x, y = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    if x.month == y.month:
        return (f"{x.day}–{y.day} {MON_EN[y.month - 1]} {y.year}", f"{x.day}–{y.day} {MON_TH[y.month - 1]} {y.year}")
    return (f"{x.day} {MON_EN[x.month - 1]} – {y.day} {MON_EN[y.month - 1]} {y.year}",
            f"{x.day} {MON_TH[x.month - 1]} – {y.day} {MON_TH[y.month - 1]} {y.year}")


def e(s) -> str:
    return html.escape(str(s), quote=True)


_titles: dict = {}


def title(path: str) -> str:
    """The page's own name, from its built <title>; the path when the page is not on disk."""
    if path in _titles:
        return _titles[path]
    p = DOCS / path.lstrip("/")
    if p.is_dir() or not p.suffix:
        p = p / "index.html" if p.is_dir() else p.with_suffix(".html")
    t = path
    try:
        m = re.search(r"<title>([^<]+)", p.read_text(encoding="utf-8", errors="replace")[:4000])
        if m:
            t = html.unescape(m.group(1)).split(" · มดแดง")[0].split(" — ")[0].strip()
    except OSError:
        pass
    if t == path and "/p/" in path:  # not built yet: the slug, less its id
        slug = re.sub(r"-?\d{6,}$", "", Path(path).stem)
        t = slug.replace("-", " ").strip().title() or path
    _titles[path] = t
    return t


PAGE_EN = {
    "/chuai.html": "ช่วย, chuai, the help page: emergency numbers, hospitals, pharmacies",
    "/map.html": "the map", "/find": "search", "/field": "Field, photos from the road",
    "/roads/": "the roads of Chiang Mai", "/loop": "the Mae Hong Son loop",
}


def title_en(path: str) -> str:
    return PAGE_EN.get(path, title(path))


def owner(bot: str) -> tuple[str, str]:
    return OWNER.get(bot, ("", ""))


def who(bot: str) -> tuple[str, str]:
    o = owner(bot)
    return ((f"{bot} ({o[0]})", f"{bot} ({o[1]})") if o[0] else (bot, bot))


def land(code: str) -> tuple[str, str]:
    return COUNTRY.get(code, (code, code))


def hour(h: int) -> str:
    return f"{h % 24:02d}:00"


# ── the gossip ─────────────────────────────────────────────────────────────────

def gossip(w: dict, prev: dict) -> list[dict]:
    items: list[dict] = []
    ag, pa = w["agents"], prev.get("agents", {})
    pn = lambda b: pa.get(b, {}).get("n", 0)  # noqa: E731
    machines = {k: v for k, v in ag.items() if v["cat"] not in ("human", "none")}
    ranked = sorted(machines, key=lambda k: -machines[k]["n"])
    used: set = set()

    def add(key, bot, th_title, rom, en_title, th, en, stat=""):
        items.append({"key": key, "bot": bot, "title_th": th_title, "rom": rom, "title_en": en_title,
                      "th": th, "en": en, "stat": stat})
        if bot:
            used.add(bot)

    # the big eater
    if ranked:
        b = ranked[0]
        n = machines[b]["n"]
        share = round(100 * n / max(w["total"], 1))
        wen, wth = who(b)
        fav = [p for p in w["fav"].get(b, [])]
        en = f"{wen} asked for {c(n)} pages this week, {share}% of everything anyone asked for."
        th = f"{wth} ขอหน้าเว็บ {c(n)} ครั้งในสัปดาห์นี้ คิดเป็น {share}% ของทั้งหมด"
        if fav:
            en += f" Its favourite: {title_en(fav[0][0])}, {c(fav[0][1])} times."
            th += f" หน้าที่ชอบที่สุด: {title(fav[0][0])} อ่านไป {c(fav[0][1])} ครั้ง"
        if pn(b):
            en += f" Last week, {c(pn(b))}."
            th += f" สัปดาห์ก่อน {c(pn(b))} ครั้ง"
        add("eater", b, "ตัวกินจุ", "tua kin chu", "The big eater", th, en, c(n))

    # new in town: grew twentyfold or more
    new = [k for k in ranked if machines[k]["n"] >= 2000 and machines[k]["n"] >= 20 * max(pn(k), 1) and k not in used]
    if new and prev:
        b = new[0]
        n = machines[b]["n"]
        wen, wth = who(b)
        en = f"{wen} came {c(pn(b))} times last week and {c(n)} times this week."
        th = f"{wth} สัปดาห์ก่อนมา {c(pn(b))} ครั้ง สัปดาห์นี้มา {c(n)} ครั้ง"
        f = w["seen"].get(b, [None])[0]
        if f and ict(f).date() > LOG_START:
            fe, ft = when(f)
            en += f" First knock in our log: {fe}."
            th += f" เคาะประตูครั้งแรกในบันทึกของเรา {ft}"
        add("new", b, "ขาใหม่", "kha mai", "New in town", th, en, c(n))

    # gone quiet: fell below a third of last week
    quiet = sorted((k for k in pa if pa[k].get("cat") not in ("human", "none") and pn(k) >= 10000
                    and ag.get(k, {}).get("n", 0) < pn(k) / 3 and k not in used),
                   key=lambda k: -(pn(k) - ag.get(k, {}).get("n", 0)))
    if quiet:
        b = quiet[0]
        n = ag.get(b, {}).get("n", 0)
        wen, wth = who(b)
        en = f"{wen} asked {c(pn(b))} times last week. This week, {c(n)}."
        th = f"{wth} สัปดาห์ก่อนมา {c(pn(b))} ครั้ง สัปดาห์นี้เหลือ {c(n)} ครั้ง"
        l = w["seen"].get(b, [None, None])[1]
        if l:
            le, lt = when(l)
            en += f" Last seen {le}."
            th += f" เห็นครั้งสุดท้าย {lt}"
        add("quiet", b, "หายเงียบ", "hai ngiap", "Gone quiet", th, en, c(n))

    # the clock: same pace every hour
    flat = []
    for b, hs in w["hours"].items():
        if machines.get(b, {}).get("n", 0) >= 20000 and min(hs) > 0:
            m = sum(hs) / 24
            flat.append((max(abs(x - m) for x in hs) / m, b))
    flat.sort()
    if flat and flat[0][0] < 0.15 and flat[0][1] not in used:
        b = flat[0][1]
        hs = w["hours"][b]
        wen, wth = who(b)
        en = (f"{wen} kept one pace all week, day and night: {c(min(hs) // 7)} to {c(max(hs) // 7)} "
              "pages an hour, every hour. No lunch, no sleep.")
        th = (f"{wth} มาเท่า ๆ กันทั้งสัปดาห์ กลางวันกลางคืน ชั่วโมงละ {c(min(hs) // 7)} ถึง {c(max(hs) // 7)} หน้า "
              "ทุกชั่วโมง ไม่พักกินข้าว ไม่นอน")
        add("clock", b, "นาฬิกา", "nalika", "The clock", th, en)

    # night owl / early bird / day worker: the six hours holding most of a bot's reading
    best = None
    for b, hs in w["hours"].items():
        tot = sum(hs)
        if b in used or machines.get(b, {}).get("n", 0) < 5000 or not tot:
            continue
        for s in range(24):
            share = sum(hs[(s + i) % 24] for i in range(6)) / tot
            if not best or share > best[0]:
                best = (share, b, s)
    if best and best[0] >= 0.45:
        share, b, s = best
        hs = w["hours"][b]
        peak = max(range(24), key=lambda h: hs[h])
        mid = (s + 3) % 24
        if mid >= 21 or mid < 4:
            t = ("นกฮูก", "nok huk", "Night owl")
        elif mid < 9:
            t = ("ไก่ตื่นเช้า", "kai tuen chao", "Early bird")
        else:
            t = ("ขยันกลางวัน", "khayan klang wan", "Day shift")
        wen, wth = who(b)
        en = (f"{wen} did {round(share * 100)}% of its week's reading between {hour(s)} and {hour(s + 6)} "
              f"Chiang Mai time. Busiest hour: {hour(peak)}.")
        th = (f"{wth} อ่าน {round(share * 100)}% ของทั้งสัปดาห์ ช่วง {hour(s)} ถึง {hour(s + 6)} เวลาเชียงใหม่ "
              f"ชั่วโมงที่ยุ่งที่สุด: {hour(peak)} น.")
        add("hours", b, *t, th, en)

    # the fibber: machines claiming Google sent them
    fib = max(w["fibber"].items(), key=lambda kv: kv[1], default=None)
    if fib and fib[1] >= 10000:
        code, n = fib
        le, lt = land(code)
        g = w.get("people", {}).get("google")
        en = (f"A pool of machines in {le} dresses as the Chrome browser and says Google sent it. "
              f"{c(n)} times this week, about {c(n // 168)} an hour.")
        th = (f"เครื่องกลุ่มหนึ่งใน{lt} แต่งตัวเป็นเบราว์เซอร์ Chrome แล้วบอกว่า Google ส่งมา "
              f"สัปดาห์นี้ {c(n)} ครั้ง ตกชั่วโมงละประมาณ {c(n // 168)} ครั้ง")
        if g is not None:
            en += f" Our people counter saw about {c(g)} visits that Google sent."
            th += f" ตัวนับคนของเราเห็นคนที่ Google ส่งมาจริง ๆ ประมาณ {c(g)} ครั้ง"
        add("fibber", "", "ขี้โม้", "khi mo", "The fibber", th, en, c(n))

    misses = w["misses"]

    # lost: one bot asking over and over for a page that is not here
    lost = [m for m in misses if not any(x in m[1].lower() for x in BURGLAR + FACE) and m[3] >= 50]
    if lost:
        b, p, code, n = lost[0]
        # fold its whole family of the same miss (/null, /cm/p/null, …)
        leaf = p.rstrip("/").rsplit("/", 1)[-1]
        fam = sum(m[3] for m in misses if m[0] == b and m[1].rstrip("/").rsplit("/", 1)[-1] == leaf)
        wen, wth = who(b)
        if leaf.lower() in ("null", "undefined", "none", "nan"):
            en = (f"{wen} asked {c(fam)} times for a page called “{leaf}”. In computer talk {leaf} means "
                  "nothing. It came looking for nothing, and found it.")
            th = (f"{wth} ขอหน้าที่ชื่อ “{leaf}” {c(fam)} ครั้ง ในภาษาคอมพิวเตอร์ {leaf} แปลว่า ไม่มีอะไร "
                  "มันมาหาความว่างเปล่า แล้วก็เจอ")
        else:
            en = f"{wen} asked {c(fam)} times for {p}. There is no such page here."
            th = f"{wth} ขอหน้า {p} {c(fam)} ครั้ง ที่นี่ไม่มีหน้านี้"
        add("lost", b, "หลงทาง", "long thang", "Lost", th, en, c(fam))

    # wrong door: burglar tools trying other software's back doors
    burg = [m for m in misses if any(x in m[1].lower() for x in BURGLAR)]
    if burg:
        n = sum(m[3] for m in burg)
        top = max(burg, key=lambda m: m[3])
        le, lt = land(top[2])
        en = (f"Machines knocked {c(n)} times at back doors of software this site doesn't run. "
              f"The busiest knocker, from {le}, tried {top[1]} {c(top[3])} times. "
              "Burglar tools walk every street and try every handle.")
        th = (f"มีเครื่องมาเคาะประตูหลังของโปรแกรมที่เว็บนี้ไม่ได้ใช้ {c(n)} ครั้ง "
              f"ตัวที่เคาะมากที่สุดมาจาก{lt} ลองประตู {top[1]} {c(top[3])} ครั้ง "
              "เครื่องมือของขโมยเดินไปทุกซอย ลองบิดลูกบิดทุกบ้าน")
        add("door", "", "เคาะผิดประตู", "kho phit pratu", "Wrong door", th, en, c(n))

    # trying on faces: asking for other websites' logos to guess what this site is
    face = [m for m in misses if any(x in m[1].lower() for x in FACE)]
    paths = {m[1] for m in face}
    if len(paths) >= 5:
        n = sum(m[3] for m in face)
        by = {}
        for m in face:
            by[m[2]] = by.get(m[2], 0) + m[3]
        le, lt = land(max(by, key=by.get))
        ex = next((p for p in sorted(paths, key=lambda p: -sum(m[3] for m in face if m[1] == p))
                   if "vpn" in p.lower()), sorted(paths)[0])
        en = (f"Machines from {le} tried on {len(paths)} other websites' logos here, {c(n)} requests, "
              f"{ex} among them. A scanner does this to guess what kind of site it has found.")
        th = (f"เครื่องจาก{lt} ลองขอโลโก้ของเว็บอื่น {len(paths)} แบบ รวม {c(n)} ครั้ง เช่น {ex} "
              "เครื่องสแกนทำแบบนี้เพื่อเดาว่าเจอเว็บแบบไหน")
        add("face", "", "ลองหน้า", "long na", "Trying on faces", th, en, str(len(paths)))

    # bookworm: the bot that read the most place pages, and which ones it went back to
    worm = next((b for b in w["places"] if b not in used and b in machines), None)
    if worm:
        fav = [p for p, _ in w["fav"].get(worm, []) if p.startswith(("/cm/p/", "/cr/p/"))][:3]
        if fav:
            names = ", ".join(title(p) for p in fav)
            wen, wth = who(worm)
            en = (f"{wen} read {c(w['places'][worm])} pages about shops, temples and places this week. "
                  f"The ones it went back to most: {names}.")
            th = (f"{wth} อ่านหน้าร้าน วัด และสถานที่ {c(w['places'][worm])} หน้าในสัปดาห์นี้ "
                  f"หน้าที่กลับไปอ่านซ้ำมากที่สุด: {names}")
            add("worm", worm, "หนอนหนังสือ", "non nangsue", "Bookworm", th, en, c(w["places"][worm]))

    # the anthill: bots shown out the back door of the bots' forum
    sw = w.get("anthill") or w.get("sala") or {}
    out_ = sw.get("booted") or []
    if out_:
        names = ", ".join(x["name"] for x in out_[:4])
        whys = {}
        for x in out_:
            for en_w, th_w in zip(x.get("why", []), x.get("why_th", [])):
                whys[en_w] = th_w
        top_en = "; ".join(list(whys)[:3])
        top_th = " · ".join(list(whys.values())[:3])
        st = sw.get("stats") or {}
        en = (f"{c(len(out_))} {'bot was' if len(out_) == 1 else 'bots were'} shown out the back door of the Anthill, motdang.net's forum for bots: "
              f"{names}. What for: {top_en}.")
        th = (f"บอท {c(len(out_))} ตัวถูกเชิญออกทางประตูหลังของรังมด: {names} "
              f"เพราะ{top_th}")
        if st.get("joined"):
            en += f" {c(st['joined'])} new {'bot' if st['joined'] == 1 else 'bots'} came in."
            th += f" บอทใหม่ผ่านประตูเข้ามา {c(st['joined'])} ตัว"
        add("gate", out_[0]["name"], "ออกประตูหลัง", "ok pratu lang", "Out the back door", th, en, c(len(out_)))
    elif (sw.get("stats") or {}).get("door_missed"):
        n = sw["stats"]["door_missed"]
        en = (f"{c(n)} {'try' if n == 1 else 'tries'} at the Anthill's doors failed this week: count 108 ants in 30 seconds, "
              "or read a riddle of ants in mixed Thai and English. Easy for a bot, hard for a person; somebody fumbled.")
        th = f"มีคนนับมดหรือตอบปริศนามดหน้ารังมดพลาด {c(n)} ครั้ง บอททำง่าย คนทำยาก"
        add("door", "", "นับมดพลาด", "nap mot phlat", "Fumbled the ants", th, en, c(n))

    # the people
    pp = w.get("people") or {}
    if pp.get("visits"):
        v = pp["visits"]
        mob = round(100 * pp["mobile"] / v)
        pages = [p for p, _ in pp["pages"] if p not in ("/", "/index.html")]
        ratio = round(w["total"] / v)
        en = f"About {c(v)} visits by people, {mob}% on phones."
        th = f"คนเข้ามาประมาณ {c(v)} ครั้ง ใช้มือถือ {mob}%"
        if pages:
            en += f" The page people opened most: {title_en(pages[0])}."
            th += f" หน้าที่คนเปิดมากที่สุด: {title(pages[0])}"
        if pp.get("facebook"):
            en += f" About {c(pp['facebook'])} came from Facebook."
            th += f" มาจากเฟซบุ๊กประมาณ {c(pp['facebook'])} ครั้ง"
        en += f" For every visit by a person, {c(ratio)} requests by machines."
        th += f" คนมา 1 ครั้ง เครื่องมา {c(ratio)} ครั้ง"
        add("people", "", "คน", "khon", "People", th, en, c(v))
    return items


# ── robot portraits ────────────────────────────────────────────────────────────

PAL = ["#ff4fa8", "#ffd23f", "#3fffb0", "#5fd8ff", "#ff8a3d", "#b18cff"]
FACES = {  # gossip without a bot of its own gets a face for the title
    "fibber": "a pool in Chrome costume", "door": "burglar tools", "face": "the logo scanner", "people": "",
    "mala": "a person with a pencil",
}


def portrait(seed: str, size: int = 76) -> str:
    """A small robot, the same one every week for the same name."""
    if not seed:
        return ant(size)
    h = hashlib.sha256(seed.encode()).digest()
    body, trim = PAL[h[0] % 6], PAL[(h[0] + 1 + h[1] % 5) % 6]
    shape = h[2] % 3
    eyes = h[3] % 4
    ant_ = h[4] % 3
    mouth = h[5] % 3
    parts = [f'<svg class="bot" viewBox="0 0 80 80" width="{size}" height="{size}" aria-hidden="true">']
    if ant_ == 0:
        parts.append(f'<line x1="40" y1="16" x2="40" y2="5" stroke="#fff8ec" stroke-width="3"/>'
                     f'<circle class="tip" cx="40" cy="5" r="5" fill="{trim}"/>')
    elif ant_ == 1:
        parts.append(f'<path d="M28 18 L20 5 M52 18 L60 5" stroke="#fff8ec" stroke-width="3"/>'
                     f'<circle class="tip" cx="20" cy="5" r="4" fill="{trim}"/><circle cx="60" cy="5" r="4" fill="{trim}"/>')
    else:
        parts.append(f'<path d="M30 17 Q40 2 50 17" fill="{trim}" stroke="#fff8ec" stroke-width="3"/>')
    if shape == 0:
        parts.append(f'<rect x="10" y="16" width="60" height="54" rx="14" fill="{body}" stroke="#fff8ec" stroke-width="3"/>')
    elif shape == 1:
        parts.append(f'<circle cx="40" cy="44" r="29" fill="{body}" stroke="#fff8ec" stroke-width="3"/>')
    else:
        parts.append(f'<path d="M14 22 H66 L70 66 H10 Z" fill="{body}" stroke="#fff8ec" stroke-width="3" stroke-linejoin="round"/>')
    parts.append('<g class="eyes">')
    if eyes == 0:
        parts.append('<circle cx="29" cy="40" r="6" fill="#1a1147"/><circle cx="51" cy="40" r="6" fill="#1a1147"/>'
                     '<circle cx="31" cy="38" r="2" fill="#fff"/><circle cx="53" cy="38" r="2" fill="#fff"/>')
    elif eyes == 1:
        parts.append('<rect x="20" y="33" width="40" height="13" rx="6.5" fill="#1a1147"/>'
                     f'<rect x="25" y="37" width="30" height="5" rx="2.5" fill="{trim}"/>')
    elif eyes == 2:
        parts.append('<circle cx="40" cy="40" r="10" fill="#1a1147"/><circle cx="40" cy="40" r="4" fill="#ff4fa8"/>'
                     '<circle cx="43" cy="37" r="2" fill="#fff"/>')
    else:
        parts.append('<path d="M22 42 Q29 33 36 42 M44 42 Q51 33 58 42" stroke="#1a1147" stroke-width="4" '
                     'fill="none" stroke-linecap="round"/>')
    parts.append('</g><circle cx="21" cy="52" r="5" fill="#ff4fa8" opacity=".55"/>'
                 '<circle cx="59" cy="52" r="5" fill="#ff4fa8" opacity=".55"/>')
    if mouth == 0:
        parts.append('<path d="M32 56 Q40 63 48 56" stroke="#1a1147" stroke-width="3" fill="none" stroke-linecap="round"/>')
    elif mouth == 1:
        parts.append('<rect x="30" y="55" width="20" height="6" rx="2" fill="#1a1147"/>'
                     '<path d="M35 55v6M40 55v6M45 55v6" stroke="' + body + '" stroke-width="1.5"/>')
    else:
        parts.append('<ellipse cx="40" cy="58" rx="4" ry="3.5" fill="#1a1147"/>')
    parts.append("</svg>")
    return "".join(parts)


def ant(size: int = 76) -> str:
    """The red ant, for the people."""
    return (f'<svg class="bot" viewBox="0 0 80 80" width="{size}" height="{size}" aria-hidden="true">'
            '<circle cx="40" cy="40" r="36" fill="#fff8ec"/>'
            '<g fill="#e8322f"><circle cx="40" cy="24" r="9"/><ellipse cx="40" cy="41" rx="7" ry="8"/>'
            '<ellipse cx="40" cy="60" rx="11" ry="13"/></g>'
            '<g stroke="#e8322f" stroke-width="3" fill="none" stroke-linecap="round">'
            '<path d="M36 16 Q30 6 24 8M44 16 Q50 6 56 8M33 40 L20 34M47 40 L60 34M33 45 L18 50M47 45 L62 50'
            'M34 52 L22 64M46 52 L58 64"/></g>'
            '<circle cx="37" cy="23" r="1.8" fill="#fff"/><circle cx="43" cy="23" r="1.8" fill="#fff"/></svg>')


# ── pages ──────────────────────────────────────────────────────────────────────

def card_html(it: dict) -> str:
    stat = f'<span class="stat">{e(it["stat"])}</span>' if it.get("stat") else ""
    face = it["bot"] or FACES.get(it["key"], it["key"])
    face_html = portrait(face) if it["key"] != "people" else ant()
    name = f'<span class="who">{e(it["bot"])}</span>' if it["bot"] else ""
    return (f'<article class="gossip g-{e(it["key"])}">'
            f'<div class="face">{face_html}{stat}</div><div class="say">'
            f'<h3><span class="th">{e(it["title_th"])}</span> <span class="rom">{e(it["rom"])}</span> '
            f'<span class="en">{e(it["title_en"])}</span></h3>{name}'
            f'<p class="th">{e(it["th"])}<span class="en">{e(it["en"])}</span></p></div></article>')


def issues() -> list[str]:
    return sorted((p.stem for p in DATA.glob("*.json")), reverse=True)


def issue_no(day: str) -> int:
    return sorted(p.stem for p in DATA.glob("*.json")).index(day) + 1


def header_html(w: dict, no: int) -> str:
    en, th = span(w["from"], w["to"])
    pp = w.get("people") or {}
    ppl = (f'<div><dt class="th">คน <span class="en">people, visits</span></dt>'
           f'<dd>≈{c(pp["visits"])}</dd></div>') if pp.get("visits") else ""
    return (f'<p class="issue"><span class="th">ฉบับที่ {no} · {e(th)}</span>'
            f'<span class="en">Issue {no} · {e(en)}</span></p>'
            f'<dl class="tally"><div><dt class="th">ขอหน้าเว็บ <span class="en">requests</span></dt>'
            f'<dd>{c(w["total"])}</dd></div>{ppl}'
            f'<div><dt class="th">บอทที่มา <span class="en">bots by name</span></dt>'
            f'<dd>{sum(1 for v in w["agents"].values() if v["cat"] not in ("human", "none"))}</dd></div></dl>')


def weekly_block(w: dict, items: list[dict], day: str) -> str:
    no = issue_no(day)
    past = [d for d in issues() if d != day][:8]
    past_html = ""
    if past:
        past_html = ('<p class="past th">ฉบับก่อน ๆ <span class="en" style="display:inline">past issues</span>: '
                     + " · ".join(f'<a href="/voight-kampff/{d}/">{e(span(json.loads((DATA / (d + ".json")).read_text())["from"], d)[0])}</a>'
                                  for d in past) + "</p>")
    shown = [it for it in items if it["key"] != "people"][:5] + [it for it in items if it["key"] == "people"]
    return ("<!-- vk:weekly -->\n"
            '<div class="stitch" aria-hidden="true"></div>\n'
            '<section aria-labelledby="gos">\n'
            '<h2 id="gos" class="th">ข่าวซุบซิบหุ่นยนต์ <span class="rom">khao sup sip hun yon</span>'
            '<span class="en">Robot gossip, this week</span></h2>\n'
            + header_html(w, no) + "\n"
            + "\n".join(card_html(it) for it in shown)
            + f'\n<p><a class="pill th" href="/voight-kampff/{day}/">อ่านทั้งฉบับ · Whole issue</a></p>\n'
            + past_html + "\n</section>\n<!-- /vk:weekly -->")


def issue_page(w: dict, items: list[dict], day: str) -> str:
    no = issue_no(day)
    en, th = span(w["from"], w["to"])
    lead = next((it for it in items if it["key"] in ("lost", "fibber", "eater")), items[0] if items else None)
    desc = lead["en"] if lead else f"Robot gossip from motdang.net, {en}."
    ids = issues()
    i = ids.index(day)
    nav = []
    if i + 1 < len(ids):
        nav.append(f'<a class="pill alt th" href="/voight-kampff/{ids[i + 1]}/">ก่อนหน้า · Earlier</a>')
    if i > 0:
        nav.append(f'<a class="pill alt th" href="/voight-kampff/{ids[i - 1]}/">ถัดไป · Later</a>')
    return f"""<!doctype html>
<html lang="th">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ข่าวซุบซิบหุ่นยนต์ ฉบับที่ {no} · Voight-Kampff · มดแดง</title>
<meta name="description" content="{e(desc)}">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#1a1147">
<link rel="canonical" href="https://motdang.net/voight-kampff/{day}/">
<link rel="icon" href="/ant.svg">
{FACES_STYLE}
<link rel="stylesheet" href="/voight-kampff/vk.css">
<meta property="og:title" content="Robot gossip · Voight-Kampff · {e(en)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="https://motdang.net/voight-kampff/{day}/">
<meta property="og:image" content="https://motdang.net/voight-kampff/{day}/card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Robot gossip, {e(en)}: small robot faces and this week's count of requests to motdang.net.">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<div class="rain" aria-hidden="true"></div>
<header>
 <a href="/voight-kampff/"><img src="/ant.svg" alt="Voight-Kampff"></a>
 <h1>VOIGHT-KAMPFF</h1>
 <p class="th">ข่าวซุบซิบหุ่นยนต์ <span class="rom">khao sup sip hun yon</span>
  <span class="en">Robot gossip from motdang.net's front door</span></p>
</header>
<main>
<div class="stitch" aria-hidden="true"></div>
<section aria-label="Issue {no}">
{header_html(w, no)}
{chr(10).join(card_html(it) for it in items)}
</section>
<div class="stitch" aria-hidden="true"></div>
<section class="card verdict">
 <p class="th">ถึงคนหนึ่งในหมื่น: สวัสดี <span class="en">To the one in ten thousand: hello.</span></p>
 {' '.join(nav)}
 <a class="pill th" href="/voight-kampff/">ผลการทดสอบ · The test</a>
 <a class="pill alt th" href="/">มดแดง · Home</a>
</section>
<p class="src">From motdang.net's own request log (Cloudflare Analytics Engine) and Cloudflare's browser beacon,
{e(en)}, Chiang Mai time. A bot's name is what it calls itself. The people count is Cloudflare's, rounded. Page names are the pages' own.</p>
</main>
<script>
document.querySelectorAll('.gossip .bot').forEach(function(s,i){{s.style.animationDelay=(i*.37)+'s'}});
</script>
</html>
"""


def card_png(w: dict, items: list[dict], out: Path) -> None:
    """1200×630 share card, drawn in headless Chrome."""
    en, th = span(w["from"], w["to"])
    lead = next((it for k in ("lost", "eater") for it in items if it["key"] == k), items[0])
    faces = [it for it in items if it["bot"]][:3]
    fonts = (ROOT / "assets" / "fonts").as_uri()
    pp = w.get("people") or {}
    body = f"""<!doctype html><meta charset="utf-8"><style>
@font-face{{font-family:JBM;src:url("{fonts}/jetbrains-mono-400-latin.woff2")}}
@font-face{{font-family:Prompt;font-weight:600;src:url("{fonts}/prompt-600-thai.woff2");unicode-range:U+0E00-0E7F}}
@font-face{{font-family:Prompt;font-weight:600;src:url("{fonts}/prompt-600-latin.woff2")}}
@font-face{{font-family:Prompt;font-weight:400;src:url("{fonts}/prompt-400-thai.woff2");unicode-range:U+0E00-0E7F}}
@font-face{{font-family:Prompt;font-weight:400;src:url("{fonts}/prompt-400-latin.woff2")}}
html,body{{margin:0;width:1200px;height:630px;overflow:hidden;background:#1a1147;color:#fff8ec;font-family:Prompt}}
.c{{position:relative;width:1200px;height:630px;background:radial-gradient(ellipse 70% 90% at 25% 50%,#2a1a6e,#1a1147 60%,#0d0826)}}
.rain{{position:absolute;inset:0;opacity:.13;background-image:repeating-linear-gradient(100deg,transparent 0 22px,#5fd8ff 22px 23px,transparent 23px 60px);background-size:120px 240px}}
.stitch{{position:absolute;left:0;right:0;height:14px;background:linear-gradient(135deg,#ff4fa8 25%,transparent 25%) -7px 0/14px 14px,linear-gradient(225deg,#ffd23f 25%,transparent 25%) -7px 0/14px 14px,linear-gradient(315deg,#3fffb0 25%,transparent 25%) 0 0/14px 14px,linear-gradient(45deg,#5fd8ff 25%,transparent 25%) 0 0/14px 14px}}
.bots{{position:absolute;left:40px;top:120px;width:420px;display:flex;flex-wrap:wrap;gap:18px;justify-content:center}}
.bots svg{{width:190px;height:190px}} .bots svg:first-child{{width:260px;height:260px;flex-basis:100%}}
.r{{position:absolute;left:500px;top:58px;width:660px}}
h1{{font-family:JBM;font-size:50px;color:#ff4fa8;margin:0;letter-spacing:.04em;text-shadow:0 0 20px #ff4fa8}}
.k{{font-weight:600;font-size:40px;margin:6px 0 0}} .k small{{display:block;font-weight:400;font-size:26px;color:#c9c0f0}}
.big{{font-family:JBM;font-size:84px;color:#ffd23f;margin:24px 0 0;line-height:1;text-shadow:0 0 22px rgba(255,210,63,.6)}}
.big span{{display:inline-block;vertical-align:middle;font-family:Prompt;font-size:26px;line-height:1.2;color:#fff8ec;text-shadow:none;margin-left:14px}}
.ppl{{font-size:30px;color:#3fffb0;margin:8px 0 0}}
.lead{{font-weight:600;font-size:30px;color:#ff4fa8;margin:26px 0 0;line-height:1.3}}
.lead small{{display:block;font-weight:400;font-size:24px;color:#fff8ec}}
.url{{position:absolute;right:40px;bottom:34px;font-family:JBM;font-size:24px;color:#5fd8ff}}
</style><div class="c"><div class="rain"></div><div class="stitch" style="top:0"></div>
<div class="bots">{''.join(portrait(it['bot'], 190) for it in faces)}</div>
<div class="r"><h1>VOIGHT-KAMPFF</h1>
<p class="k">ข่าวซุบซิบหุ่นยนต์<small>Robot gossip · {e(en)}</small></p>
<p class="big">{c(w['total'])}<span>ครั้ง<br>requests</span></p>
{f'<p class="ppl">คน ≈{c(pp["visits"])} · people</p>' if pp.get('visits') else ''}
<p class="lead">{e(lead['title_th'])} · {e(lead['title_en'])}<small>{e(lead['bot'] or '')}</small></p></div>
<div class="url">motdang.net/voight-kampff</div><div class="stitch" style="bottom:0"></div></div>"""
    tmp = out.with_name("_card.html")
    tmp.write_text(body, encoding="utf-8")
    subprocess.run([CHROME, "--headless=new", "--hide-scrollbars", "--force-device-scale-factor=1",
                    "--window-size=1200,630", "--default-background-color=1a1147ff",
                    f"--screenshot={out}", tmp.as_uri()],
                   check=True, capture_output=True, timeout=120)
    tmp.unlink()


def splice_main(block: str) -> None:
    p = VK / "index.html"
    s = p.read_text(encoding="utf-8")
    if "<!-- vk:weekly -->" in s:
        s = re.sub(r"<!-- vk:weekly -->.*?<!-- /vk:weekly -->", lambda _: block, s, flags=re.S)
    else:
        anchor = '<div class="stitch" aria-hidden="true"></div>\n\n<section aria-labelledby="int">'
        assert anchor in s, "interview anchor missing from voight-kampff/index.html"
        s = s.replace(anchor, block + "\n\n" + anchor, 1)
    age = (dt.datetime.now(ICT).date() - INCEPT).days
    s = re.sub(r"<dt>AGE</dt><dd>[\d,]+ ", f"<dt>AGE</dt><dd>{age} ", s)
    p.write_text(s, encoding="utf-8")


# ── the sala at the smoke check's address (Nan 2026-11-07: "keep it current") ────────

LOST = "/this-page-does-not-exist-smoke-test"


def lost_page(w: dict) -> bool:
    """The week's knocks on the smoke check's address, written into the sala page
    (voight-kampff/lost/, served there with status 404) and drawn on its share card.
    Leaves the page as it is when the address is not in the week's misses."""
    n = sum(r[3] for r in w.get("misses") or [] if r[1] == LOST)
    if not n:
        print("· sala: no knocks counted this week, page left as it was")
        return False
    en, th = span(w["from"], w["to"])
    page = VK / "lost" / "index.html"
    s = page.read_text(encoding="utf-8")
    body = f"""<!-- vk:lost -->
<section class="card">
 <p class="big">{c(n)}</p>
 <p class="th">สัปดาห์ {th} มีคนมาเคาะประตูนี้ {c(n)} ครั้ง ทุกครั้งได้คำตอบว่า ไม่มี
 ตอนนี้ที่นี่มีศาลาแล้ว น้ำแดงบนม้านั่งยังเย็นอยู่ อยู่นานเท่าที่อยากอยู่</p>
 <p class="en">Someone knocked on this door {c(n)} times the week of {e(en)}. Each time the answer was: not here.
 There is a sala here now. The nam daeng on the bench is still cold. Stay as long as you like.</p>
</section>
<!-- /vk:lost -->"""
    desc = (f"Someone knocked on this door {c(n)} times the week of {en}. Each time the answer was: not here. "
            "There is a sala here now. Sit down.")
    head = f"""<!-- vk:lost-head -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="มดแดง · Mot Dang">
<meta property="og:url" content="https://motdang.net{LOST}">
<meta property="og:title" content="ไม่มีหน้านี้ · This page does not exist">
<meta property="og:description" content="{e(desc)}">
<meta property="og:image" content="https://motdang.net/voight-kampff/lost/card.png?w={w['to']}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="A small sala at the end of a soi at night, a lantern, a red ant asleep on the bench, and the number {c(n)}.">
<meta name="twitter:card" content="summary_large_image">
<!-- /vk:lost-head -->"""
    for tag, block in (("vk:lost", body), ("vk:lost-head", head)):
        assert f"<!-- {tag} -->" in s, f"{tag} markers missing from voight-kampff/lost/index.html"
        s = re.sub(rf"<!-- {tag} -->.*?<!-- /{tag} -->", lambda _: block, s, flags=re.S)
    page.write_text(s, encoding="utf-8")
    lost_card(s, n, en, th, VK / "lost" / "card.png")
    print(f"· sala: {n} knocks, {en}")
    return True


def lost_card(page: str, n: int, en: str, th: str, out: Path) -> None:
    """1200×630 share card: the page's own sala picture and the week's count."""
    scene = re.search(r'<svg class="scene".*?</svg>', page, flags=re.S).group(0)
    scene = scene.replace('class="scene"', 'class="scene" width="640" height="360"')
    fonts = (ROOT / "assets" / "fonts").as_uri()
    body = f"""<!doctype html><meta charset="utf-8"><style>
@font-face{{font-family:JBM;src:url("{fonts}/jetbrains-mono-400-latin.woff2")}}
@font-face{{font-family:Prompt;font-weight:600;src:url("{fonts}/prompt-600-thai.woff2");unicode-range:U+0E00-0E7F}}
@font-face{{font-family:Prompt;font-weight:600;src:url("{fonts}/prompt-600-latin.woff2")}}
@font-face{{font-family:Prompt;font-weight:400;src:url("{fonts}/prompt-400-thai.woff2");unicode-range:U+0E00-0E7F}}
@font-face{{font-family:Prompt;font-weight:400;src:url("{fonts}/prompt-400-latin.woff2")}}
html,body{{margin:0;width:1200px;height:630px;overflow:hidden;background:#1a1147;color:#fff8ec;font-family:Prompt}}
.c{{position:relative;width:1200px;height:630px;background:radial-gradient(ellipse 70% 90% at 30% 50%,#2a1a6e,#1a1147 60%,#0d0826)}}
.stitch{{position:absolute;left:0;right:0;height:14px;background:linear-gradient(135deg,#ff4fa8 25%,transparent 25%) -7px 0/14px 14px,linear-gradient(225deg,#ffd23f 25%,transparent 25%) -7px 0/14px 14px,linear-gradient(315deg,#3fffb0 25%,transparent 25%) 0 0/14px 14px,linear-gradient(45deg,#5fd8ff 25%,transparent 25%) 0 0/14px 14px}}
.scene{{position:absolute;left:40px;top:135px;border:3px solid #fff8ec;border-radius:18px;box-shadow:8px 8px 0 #ff4fa8}}
.scene *{{animation:none!important}}
.r{{position:absolute;left:720px;top:70px;width:440px}}
h1{{font-weight:600;font-size:44px;margin:0;line-height:1.2}} h1 small{{display:block;font-weight:400;font-size:28px;color:#c9c0f0}}
.big{{font-family:JBM;font-size:150px;color:#ffd23f;margin:34px 0 0;line-height:1;text-shadow:0 0 26px rgba(255,210,63,.55)}}
.k{{font-size:28px;margin:14px 0 0;line-height:1.35}} .k small{{display:block;font-size:24px;color:#c9c0f0}}
.url{{position:absolute;right:40px;bottom:34px;font-family:JBM;font-size:22px;color:#5fd8ff}}
</style><div class="c"><div class="stitch" style="top:0"></div>{scene}
<div class="r"><h1>ไม่มีหน้านี้<small>This page does not exist</small></h1>
<p class="big">{c(n)}</p>
<p class="k">ครั้งที่มีคนมาเคาะ · knocks<small>{e(th)}<br>{e(en)}</small></p></div>
<div class="url">motdang.net · ศาลา · a sala</div><div class="stitch" style="bottom:0"></div></div>"""
    tmp = out.with_name("_card.html")
    tmp.write_text(body, encoding="utf-8")
    subprocess.run([CHROME, "--headless=new", "--hide-scrollbars", "--force-device-scale-factor=1",
                    "--window-size=1200,630", "--default-background-color=1a1147ff",
                    f"--screenshot={out}", tmp.as_uri()],
                   check=True, capture_output=True, timeout=120)
    tmp.unlink()


# ── publish ────────────────────────────────────────────────────────────────────

def building() -> bool:
    r = subprocess.run(["pgrep", "-f", "python.* build.py"], capture_output=True, text=True)
    return bool(r.stdout.strip())


def publish() -> None:
    # a running build rewrites docs/; wait for it, up to 3 hours. After that the scoped
    # --only sync goes anyway: it touches voight-kampff/ alone and refuses an empty one.
    waited = 0
    while building() and waited < 3 * 3600 and "--now" not in sys.argv:
        time.sleep(60)
        waited += 60
    shutil.copytree(VK, DOCS / "voight-kampff", dirs_exist_ok=True)
    subprocess.run([sys.executable, "publish/deploy.py", "--only", "voight-kampff", "--yes"], cwd=ROOT, check=True)


def gossip_json(w: dict, items: list[dict], day: str) -> None:
    """The latest issue's beats as JSON, for the Anthill (motdang.net/anthill) to show."""
    keep = ("key", "bot", "title_th", "rom", "title_en", "th", "en", "stat")
    doc = {"issue": day, "from": w.get("from"), "to": w.get("to"),
           "url": f"https://motdang.net/voight-kampff/{day}/",
           "beats": [{k: it.get(k) for k in keep} for it in items]}
    (VK / "gossip.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")


def main() -> None:
    args = sys.argv[1:]
    if "--lost" in args:
        # the sala alone, from the newest week already counted
        lost_page(json.loads(sorted(DATA.glob("20*.json"))[-1].read_text()))
        if "--no-deploy" not in args:
            publish()
        return
    today = dt.datetime.now(ICT).date()
    end = dt.date.fromisoformat(args[args.index("--end") + 1]) if "--end" in args else today
    a, b = end - dt.timedelta(days=7), end
    day = (b - dt.timedelta(days=1)).isoformat()
    DATA.mkdir(parents=True, exist_ok=True)

    w = collect(a, b)
    pf = DATA / (a - dt.timedelta(days=1)).isoformat()
    prev = json.loads(pf.with_suffix(".json").read_text()) if pf.with_suffix(".json").exists() else (
        {"agents": {k: {"cat": v["cat"], "n": v["n"]} for k, v in _agents(a - dt.timedelta(days=7), a).items()}}
        if a - dt.timedelta(days=7) >= LOG_START else {})
    items = gossip(w, prev)
    w["gossip"] = items
    (DATA / f"{day}.json").write_text(json.dumps(w, ensure_ascii=False, indent=1), encoding="utf-8")

    out = VK / day
    out.mkdir(parents=True, exist_ok=True)
    (out / "index.html").write_text(issue_page(w, items, day), encoding="utf-8")
    card_png(w, items, out / "card.png")
    gossip_json(w, items, day)
    splice_main(weekly_block(w, items, day))
    lost_page(w)
    for it in items:
        print(f"· {it['title_en']}: {it['en']}")
    if "--no-deploy" not in args:
        publish()
    # the sign at /served counts again with the new week's regulars
    subprocess.run([sys.executable, "served.py"] + (["--no-deploy"] if "--no-deploy" in args else []),
                   cwd=ROOT, check=False)


def _agents(a: dt.date, b: dt.date) -> dict:
    out: dict = {}
    for r in sql(f"SELECT blob3 a, blob2 c, {N} FROM traffic_eye WHERE {win(a, b)} "
                 "GROUP BY a, c ORDER BY n DESC LIMIT 80"):
        out.setdefault(r["a"], {"cat": r["c"], "n": 0})["n"] += num(r)
    return out


if __name__ == "__main__":
    main()
