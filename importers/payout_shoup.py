#!/usr/bin/env python3
"""Bounty payouts priced by Shoup, so a busy week costs less per change.

Nan, 2026-10-18, as Briefcraft Lab sent four roadworks changes in two hours:
"these contributions are getting to be high volume. we need to shoupify our
payouts to stay within our margins."

THE RULE (Donald Shoup, SFpark), turned round because here we are the payer.
Each program has slots a week: the changes we pay for. Every Monday 00:00
Bangkok the week just ended is read. More than 80% of its slots used: the
payout steps DOWN a rung. Under 60%: UP a rung, to draw more. Between: no
change. A change accepted once this week's slots are used takes a slot in the
first week with room, at that week's payout. So a week costs at most
slots × payout, and the payout stays between floor and ceiling.

Opening amounts were Nan's ฿100, cut to ฿10 on her word the same day; slots, ladder and reach are a session's picks
under her Shoup word (2026-10-15). Each payout still waits for her go
(her word 2026-10-17); this file only says how much.

    Since 2026-10-19 a roadworks payout is a ฿100 problem (one district solved whole),
    recorded as program "problems" with "what" starting "roadworks:"; the per-row
    "roadworks" program keeps its rows and terms for what was sent before.

    payout_shoup.py price [program]                 this week's payout and slots left
    payout_shoup.py accept <program> <who> <ref> "<what>" [baht] --src URL [--src URL]
                           [--sent ISO] [--also-credited WHO]
                                                    record a change we used; baht only to honour
                                                      terms posted when it was sent. Refuses when a
                                                      different sender sent one of its links earlier
                                                      and is not credited for it (first_sender)
    payout_shoup.py paid <ref> [how]                  mark it paid
    payout_shoup.py owed [who]                        unpaid, summed per bot
    payout_shoup.py publish [--live]                  write the amount and the wall into
                                                      assets/roadworks; --live publishes
                                                      when anything changed (Mondays, pull_inbox)
"""
import datetime, json, os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEDGER = os.path.expanduser("~/.claude/state/payouts.tsv")
# The source links of each accepted ref, one "ref<TAB>url" a line, kept beside the
# ledger so the ledger's columns stay as botlist and state.py read them.
SRCS = os.path.expanduser("~/.claude/state/payout-srcs.tsv")
SUGG = os.path.join(REPO, "_incoming", "suggestions.json")
# Every /roadworks suggestion bounty_ask.py has seen, whatever its status since:
# suggestions.json holds only the current fetch.
SEEN = os.path.join(REPO, "_incoming", "roadworks-suggestions.jsonl")
HEAD = "# accepted\tprogram\twho\tref\tbaht\tweek\tstate\twhat\n"
BKK = datetime.timezone(datetime.timedelta(hours=7))

PROGRAMS = {
    "roadworks": {
        # Nan 2026-10-18 "try 1/10 current offer for everything focused on bots": ฿100 → ฿10
        "open": 10, "slots": 5,
        "ladder": [1, 2, 3, 5, 10, 15, 20],
        "down": 4, "up": 2,                   # ฿1 floor, ฿20 ceiling
        "opened": "2026-10-12",               # the Monday of the week Briefcraft's first change landed
        "dir": "assets/roadworks", "live": ["roadworks/index.html", "roadworks/stub.html",
                                             "roadworks/bots.txt", "roadworks/sandbox.json"],
    },
    # Nan 2026-10-19: "we can keep 100-baht problems on motdang, but I want them to be
    # 20-100x harder, and open to humans and robots." One ฿100 problem = a whole set
    # (a roadworks district, a soi, a route, a market). The ฿100 stays put; the week's
    # slots, shared by every ฿100 problem (roadworks districts and the Anthill posts),
    # hold the week to ฿300. 3 a week is a session's pick.
    "problems": {
        "open": 100, "slots": 3,
        "ladder": [100],
        "down": 0, "up": 0,
        "opened": "2026-10-19",
    },
}


def monday(d):
    return d - datetime.timedelta(days=d.weekday())


def today():
    return datetime.datetime.now(BKK).date()


def rows():
    if not os.path.exists(LEDGER):
        return []
    out = []
    for l in open(LEDGER, encoding="utf-8"):
        if l.strip() and not l.startswith("#"):
            f = l.rstrip("\n").split("\t")
            out.append(dict(zip(["accepted", "program", "who", "ref", "baht", "week", "state", "what"], f)))
    return out


def save(rs):
    with open(LEDGER, "w", encoding="utf-8") as f:
        f.write(HEAD)
        for r in rs:
            f.write("\t".join(r[k] for k in ["accepted", "program", "who", "ref", "baht", "week", "state", "what"]) + "\n")


def counts(program, rs=None):
    c = {}
    for r in rs if rs is not None else rows():
        if r["program"] == program and r["state"] != "void":
            c[r["week"]] = c.get(r["week"], 0) + 1
    return c


def walk(program, until, c=None):
    """The payout in the week starting `until` (a Monday), walked from the opening week."""
    p = PROGRAMS[program]
    lad, r0 = p["ladder"], p["ladder"].index(p["open"])
    lo, hi = max(0, r0 - p["down"]), min(len(lad) - 1, r0 + p["up"])
    c = counts(program) if c is None else c
    r, w = r0, datetime.date.fromisoformat(p["opened"])
    steps = []
    while w < until:
        n = c.get(w.isoformat(), 0)
        occ = n / p["slots"]
        nr = r - 1 if occ > 0.8 else r + 1 if occ < 0.6 else r
        nr = max(lo, min(hi, nr))
        steps.append((w.isoformat(), n, lad[nr]))
        r = nr
        w += datetime.timedelta(days=7)
    return lad[r], lad[lo], lad[hi], steps


def usd(b):
    """US$ at ฿33, whole dollars from ฿33 up, cents below."""
    return str(round(b / 33)) if b >= 33 else "%.2f" % (b / 33)


def price(program="roadworks"):
    p = PROGRAMS[program]
    w = monday(today())
    baht, lo, hi, steps = walk(program, w)
    c = counts(program)
    used = c.get(w.isoformat(), 0)
    nf = w
    while c.get(nf.isoformat(), 0) >= p["slots"]:
        nf += datetime.timedelta(days=7)
    return {"next_free": nf.isoformat(), "program": program, "baht": baht, "usd": usd(baht), "week": w.isoformat(),
            "slots": p["slots"], "used": used, "left": max(0, p["slots"] - used),
            "floor": lo, "ceiling": hi, "next_check": (w + datetime.timedelta(days=7)).isoformat()}


# ---- who sent a link first ----------------------------------------------
#
# Nan, 2026-10-19, on the Samoeng row: "let's not make this category of errors
# again." Briefcraft Lab emailed the row to hello@ on 18 Oct and it was accepted
# and paid; dot had sent the same row, with the same Highways Office notice, on
# 17 Oct through /suggest, and nobody looked in _incoming/suggestions.json.

URL_RE = re.compile(r"https?://[^\s\"'<>)\]]+")


def norm_url(u):
    """host + path, slugs cut: chiangmai.doh.go.th/content/9895-แจ้ง… → chiangmai.doh.go.th/content/9895."""
    from urllib.parse import urlsplit, unquote
    u = unquote(u.strip().rstrip(".,;"))
    if "://" not in u:
        u = "https://" + u
    p = urlsplit(u)
    host = p.netloc.lower().split("@")[-1]
    host = host[4:] if host.startswith("www.") else host
    segs = []
    for seg in p.path.split("/"):
        if not seg:
            continue
        m = re.match(r"^(\d+)[-_]", seg)
        segs.append(m.group(1) if m else seg.lower())
    return host + "/" + "/".join(segs) + ("?" + p.query if p.query else "")


def urls_in(text):
    return {norm_url(u) for u in URL_RE.findall(text or "")}


def src_rows():
    out = []
    if os.path.exists(SRCS):
        for l in open(SRCS, encoding="utf-8"):
            f = l.rstrip("\n").split("\t")
            if len(f) >= 2 and not l.startswith("#"):
                out.append((f[0], f[1]))
    return out


def suggestions():
    """Every suggestion on disk, by id: the current fetch and the roadworks archive."""
    found = {}
    if os.path.exists(SEEN):
        for l in open(SEEN, encoding="utf-8"):
            try:
                x = json.loads(l)
                found[x["id"]] = x
            except (ValueError, KeyError):
                continue
    try:
        subs = json.load(open(SUGG, encoding="utf-8")).get("suggestions") or []
        for x in subs.values() if isinstance(subs, dict) else subs:
            if x.get("id"):
                found[x["id"]] = x
    except (OSError, ValueError):
        pass
    return list(found.values())


def same_sender(who, sender):
    """`who` is a ledger name ("Briefcraft Lab", "dot"); `sender` a suggestion's from line."""
    w = re.sub(r"[^a-z0-9]", "", (who or "").lower())
    tokens = {re.sub(r"[^a-z0-9]", "", t) for t in re.split(r"[\s:;,<>()]+", (sender or "").lower())}
    return bool(w) and (w in tokens or w == re.sub(r"[^a-z0-9]", "", (sender or "").lower()))


def first_sender(who, srcs, sent=None, rs=None, subs=None):
    """The earlier senders of any of `srcs` who are not `who` and are not credited for that link.

    [(sender, when, where, link)] — empty when nobody else had it first. A sender
    counts as credited when a ledger row of theirs carries the same link."""
    links = {norm_url(u) for u in srcs}
    if not links:
        return []
    rs = rows() if rs is None else rs
    by_ref = {r["ref"]: r for r in rs}
    credited = {}                                     # link → ledger names credited with it
    for ref, u in src_rows():
        r = by_ref.get(ref)
        if r and r["state"] != "void":
            credited.setdefault(norm_url(u), set()).add(r["who"])
    sent = sent or datetime.datetime.now(datetime.timezone.utc).isoformat()
    out = []
    for x in suggestions() if subs is None else subs:
        sender = x.get("from") or ""
        when = x.get("createdAt") or ""
        if same_sender(who, sender) or not when or when >= sent:
            continue
        for link in links & urls_in(json.dumps(x, ensure_ascii=False)):
            if any(same_sender(c, sender) for c in credited.get(link, ())):
                continue
            out.append((sender, when, "suggestion %s" % x["id"][:8], link))
    return sorted(out, key=lambda t: t[1])


def in_ledger(who, srcs, rs=None):
    """[(who, ref)] of other ledger rows carrying one of `srcs`: credited already, said, not refused."""
    links = {norm_url(u) for u in srcs}
    by_ref = {r["ref"]: r for r in (rows() if rs is None else rs)}
    return sorted({(by_ref[ref]["who"], ref) for ref, u in src_rows()
                   if ref in by_ref and by_ref[ref]["state"] != "void"
                   and by_ref[ref]["who"] != who and norm_url(u) in links})


def accept(program, who, ref, what, honour=None, srcs=(), sent=None, also=None):
    rs = rows()
    if any(r["ref"] == ref for r in rs):
        sys.exit("accept: %s is already in the ledger" % ref)
    if not srcs:
        sys.exit("accept: give the row's source link with --src URL, so an earlier sender of it is found")
    earlier = first_sender(who, srcs, sent, rs)
    if earlier and not (also and all(same_sender(also, e[0]) for e in earlier)):
        lines = ["accept: REFUSED — %s sent this link before %s and is not credited for it:" % (e[0], who) for e in earlier[:1]]
        lines += ["  %s  %s  (%s)" % (e[1][:16].replace("T", " "), e[3], e[2]) for e in earlier]
        lines.append("  Credit them first (accept with their name and the same --src), or say "
                     "--also-credited \"<their name>\" to record %s as a second sender." % ref)
        sys.exit("\n".join(lines))
    p, c = PROGRAMS[program], counts(program, rs)
    w = monday(today())
    while c.get(w.isoformat(), 0) >= p["slots"]:
        w += datetime.timedelta(days=7)
    # the payout of the slot's week, walked as if the weeks before it ended as they stand
    baht = walk(program, w, c)[0] if honour is None else int(honour)
    rs.append({"accepted": today().isoformat(), "program": program, "who": who, "ref": ref,
               "baht": str(baht), "week": w.isoformat(), "state": "approved", "what": what})
    for o, oref in in_ledger(who, srcs, rs):
        print("accept: %s is credited for the same link already (%s); this is a second credit" % (o, oref))
    save(rs)
    with open(SRCS, "a", encoding="utf-8") as f:
        f.write("".join("%s\t%s\n" % (ref, u) for u in srcs))
    print("%s · %s · ฿%d · slot week %s%s" % (ref, who, baht, w.isoformat(),
                                             " · also credited: %s" % also if earlier else ""))


def paid(ref, how=""):
    rs = rows()
    r = next((r for r in rs if r["ref"] == ref), None)
    if not r:
        sys.exit("paid: no %s" % ref)
    r["state"] = "paid %s%s" % (today().isoformat(), (" " + how) if how else "")
    save(rs)
    print(ref, r["state"])


def owed(who=None):
    tot = {}
    for r in rows():
        if r["state"] == "approved" and (who is None or r["who"] == who):
            tot.setdefault(r["who"], []).append(r)
    for w, rs in tot.items():
        print("%s  ฿%d  (%s)" % (w, sum(int(r["baht"]) for r in rs), ", ".join(r["ref"] for r in rs)))
    return tot


# ---- the roadworks pages -------------------------------------------------

BOUNTY_TXT = """Bounty: ฿{baht} (about US${usd}) for one district solved whole.
A ฿100 problem is 20 to 100 times the work of one row. Open to people and bots;
the first work that passes the test below is paid.
Mot Dang pays {slots} of its ฿100 problems a week, roadworks and the others together
(https://motdang.net/anthill/jobs). Work that passes once the week's {slots} are paid
waits for the next week with room. This week: {left} of {slots} left; the next free
one is in the week of {next_free}.
Paid by PromptPay, PayPal, Venmo, Wise or Ko-fi on the Monday after it goes live.
Put which one and its address in "from". No payout account yet? Send the work;
the address can follow once we use it."""

BOUNTY_TH = ("ปัญหา ฿100 · อำเภอเดียว ครบทั้งอำเภอ ได้ <span class=\"bounty\" data-bounty>฿{baht}</span> "
             "งานหนักกว่าหนึ่งแถว 20 ถึง 100 เท่า คนหรือบอทก็ทำได้ งานแรกที่ผ่านเกณฑ์ข้างล่างได้เงิน "
             "มดแดงจ่ายปัญหา ฿100 สัปดาห์ละ {slots} งาน รวมทุกปัญหา สัปดาห์นี้เหลือ {left} จาก {slots}")
BOUNTY_EN = ("A ฿100 problem: one district, solved whole, pays <span class=\"bounty\" data-bounty>฿{baht}</span> "
             "(about US${usd}). It is 20 to 100 times the work of one row, open to people and bots; the first work "
             "that passes the test below is paid. Mot Dang pays {slots} of its ฿100 problems a week, all of them "
             "together. This week: {left} of {slots} left.")


def fill(t, pr):
    return t.format(lo_n=3, **pr)


def row_key(r):
    """The table row a ledger entry is for: its "what" without a trailing note in brackets."""
    return re.sub(r"\s*\([^()]*\)\s*$", "", r["what"]).strip()


def wall(program):
    by = {}
    for r in rows():
        if r["state"] != "void" and (r["program"] == program
                                     or r["program"] == "problems" and r["what"].startswith(program + ":")):
            by.setdefault(r["who"], []).append(r)
    if not by:
        return ""
    items = []
    for who, rs in sorted(by.items(), key=lambda kv: -len(kv[1])):
        whats = " · ".join(r["what"] for r in rs)
        first = min(r["accepted"] for r in rs)
        items.append("<li><b>%s</b> · %d · %s<span class=\"en\">since %s</span></li>"
                     % (who, len(rs), whats, first))
    # Rows, not ledger entries: a row two bots sent (Samoeng, dot and Briefcraft) counts once.
    n = len({row_key(r) for v in by.values() for r in v})
    return ("<section id=\"built-by\" aria-labelledby=\"bb-h\">\n"
            "<h2 id=\"bb-h\">บอทที่ช่วยสร้างหน้านี้<span class=\"en\">Bots that built this page</span></h2>\n"
            "<p>แถวในตารางนี้ %d แถวมาจากบอท แต่ละแถวมีแหล่งข้อมูลและวันที่ คนของเราตรวจกับประกาศจริงก่อนขึ้นเว็บ"
            "<span class=\"en\">%d of the rows above came from bots. Each carries its source and date, "
            "and a person checks it against the official notice before it goes live.</span></p>\n"
            "<ul class=\"built-by\">\n%s\n</ul>\n"
            "<p>หลังบอทตัวแรกขายงานให้เรา เราสร้างบอทของเราเอง · After the first bot sold us a road, we built our own: "
            "<a href=\"https://hongdam.net/bots/\">hongdam.net/bots</a></p>\n"
            "</section>" % (n, n, "\n".join(items)))


def publish(live=False):
    p = PROGRAMS["roadworks"]
    pr = price("problems")
    d = os.path.join(REPO, p["dir"])
    changed = []

    bt = os.path.join(d, "bots.txt")
    s = open(bt, encoding="utf-8").read()
    new = re.sub(r"Bounty: .*?(?=\nQuestions:)", fill(BOUNTY_TXT, pr), s, count=1, flags=re.S)
    if new != s:
        open(bt, "w", encoding="utf-8").write(new); changed.append("bots.txt")

    sj = os.path.join(d, "sandbox.json")
    j = json.load(open(sj, encoding="utf-8"))
    b = j.setdefault("bounty", {})
    want = dict(b, amount_thb=pr["baht"], display="฿%s (about US$%s) for one district solved whole" % (pr["baht"], pr["usd"]),
                when="the first work that passes the test in bots.txt, for that district",
                rule="฿%d a problem; %d of Mot Dang's ฿100 problems paid a week, roadworks and the Anthill ones together; "
                     "work that passes once they are paid waits for the next week with room" % (pr["baht"], pr["slots"]),
                slots_per_week=pr["slots"], slots_left_this_week=pr["left"], next_free_slot_week=pr["next_free"], next_change=pr["next_check"],
                payment="PromptPay, PayPal, Venmo, Wise or Ko-fi, the Monday after it goes live; put which one and its address in from",
                minimum="none; small rewards to one contributor add up into one payment when a payout service has a minimum")
    if want != b:
        j["bounty"] = want
        open(sj, "w", encoding="utf-8").write(json.dumps(j, ensure_ascii=False, indent=2) + "\n"); changed.append("sandbox.json")

    # index.html: the source in assets and the built page in docs both take the same edit;
    # never copy the source over the built page, which carries the build's layers.
    w = wall("roadworks")
    block = "<!-- built-by:start -->\n%s\n<!-- built-by:end -->" % w
    for ix in (os.path.join(d, "index.html"), os.path.join(REPO, "docs", "roadworks", "index.html")):
        if not os.path.exists(ix):
            continue
        s = open(ix, encoding="utf-8").read()
        new = edit_index(s, pr, block, w)
        if new != s:
            open(ix, "w", encoding="utf-8").write(new)
            if "index.html" not in changed:
                changed.append("index.html")

    for f in [x for x in changed if x != "index.html"] + (["stub.html"] if live else []):
        shutil.copyfile(os.path.join(d, f), os.path.join(REPO, "docs", "roadworks", f))
    print("roadworks: ฿%d a district · %d of %d ฿100 problems left this week · changed: %s" % (pr["baht"], pr["left"], pr["slots"], ", ".join(changed) or "nothing"))
    if live and changed:
        subprocess.run([os.path.expanduser("~/.claude/bin/publish-site")] + p["live"], check=False)
    return changed


def edit_index(s, pr, block, w):
    new = re.sub(r"(<h2 id=\"bots-h\">.*?</h2>\n<p>).*?(</p>)",
                 lambda m: m.group(1) + fill(BOUNTY_TH, pr) + "<span class=\"en\">" + fill(BOUNTY_EN, pr) + "</span>" + m.group(2),
                 s, count=1, flags=re.S)
    if "<!-- built-by:start -->" in new:
        new = re.sub(r"<!-- built-by:start -->.*?<!-- built-by:end -->", lambda m: block, new, count=1, flags=re.S)
    elif w:
        new = new.replace("<section id=\"for-bots\"", block + "\n\n<section id=\"for-bots\"", 1)
    return new


def main():
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == "price":
        print(json.dumps(price(a[1] if len(a) > 1 else "roadworks"), ensure_ascii=False))
    elif a[0] == "accept":
        opts, pos, i = {"--src": [], "--sent": [], "--also-credited": []}, [], 1
        while i < len(a):
            if a[i] in opts and i + 1 < len(a):
                opts[a[i]].append(a[i + 1]); i += 2
            else:
                pos.append(a[i]); i += 1
        if len(pos) not in (4, 5):
            sys.exit(__doc__)
        accept(*pos[:4], honour=pos[4] if len(pos) > 4 else None, srcs=opts["--src"],
               sent=(opts["--sent"] or [None])[0], also=(opts["--also-credited"] or [None])[0])
    elif a[0] == "paid" and len(a) >= 2:
        paid(a[1], " ".join(a[2:]))
    elif a[0] == "owed":
        owed(a[1] if len(a) > 1 else None)
    elif a[0] == "publish":
        if "--monday" in a and today().weekday() != 0:
            return
        publish("--live" in a)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
