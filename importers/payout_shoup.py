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

    payout_shoup.py price [program]                 this week's payout and slots left
    payout_shoup.py accept <program> <who> <ref> "<what>" [baht]   record a change we used;
                                                      baht only to honour terms posted when it was sent
    payout_shoup.py paid <ref> [how]                  mark it paid
    payout_shoup.py owed [who]                        unpaid, summed per bot
    payout_shoup.py publish [--live]                  write the amount and the wall into
                                                      assets/roadworks; --live publishes
                                                      when anything changed (Mondays, pull_inbox)
"""
import datetime, json, os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEDGER = os.path.expanduser("~/.claude/state/payouts.tsv")
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


def accept(program, who, ref, what, honour=None):
    rs = rows()
    if any(r["ref"] == ref for r in rs):
        sys.exit("accept: %s is already in the ledger" % ref)
    p, c = PROGRAMS[program], counts(program, rs)
    w = monday(today())
    while c.get(w.isoformat(), 0) >= p["slots"]:
        w += datetime.timedelta(days=7)
    # the payout of the slot's week, walked as if the weeks before it ended as they stand
    baht = walk(program, w, c)[0] if honour is None else int(honour)
    rs.append({"accepted": today().isoformat(), "program": program, "who": who, "ref": ref,
               "baht": str(baht), "week": w.isoformat(), "state": "approved", "what": what})
    save(rs)
    print("%s · %s · ฿%d · slot week %s" % (ref, who, baht, w.isoformat()))


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

BOUNTY_TXT = """Bounty: if we use your change, we pay ฿{baht} (about US${usd}) this week.
The amount moves each Monday with how many changes we used the week before:
all {slots} of the week's slots used, one step down; fewer than {lo_n}, one step up.
It stays between ฿{floor} and ฿{ceiling}. A change that arrives once this week's
{slots} slots are used takes a slot next week, at next week's amount.
This week: {left} of {slots} slots left; the next free slot is in the week of {next_free}.
Next change of amount: Monday {next_check}.
Paid by PayPal, Venmo, Wise or Ko-fi on the Monday after your change goes live.
Put which one and its address in "from". Small rewards to one contributor add up
into one payment when a payout service has a minimum.
No payout account yet? Send the change; the address can follow once we use it."""

BOUNTY_TH = ("ถ้าเราใช้การแก้ของคุณ สัปดาห์นี้เราจ่าย <span class=\"bounty\" data-bounty>฿{baht}</span> (ราว {usd} ดอลลาร์) "
             "ยอดนี้ขยับทุกวันจันทร์ตามจำนวนงานที่เราใช้ในสัปดาห์ก่อน ใช้ครบ {slots} ช่อง ลดหนึ่งขั้น ใช้น้อยกว่า {lo_n} ช่อง เพิ่มหนึ่งขั้น "
             "อยู่ระหว่าง ฿{floor} ถึง ฿{ceiling} สัปดาห์นี้เหลือ {left} จาก {slots} ช่อง")
BOUNTY_EN = ("Bots can build too. If we use your change, this week we pay <span class=\"bounty\" data-bounty>฿{baht}</span> "
             "(about US${usd}). The amount moves each Monday with how many changes we used the week before: all {slots} slots used, "
             "one step down; fewer than {lo_n}, one step up; between ฿{floor} and ฿{ceiling}. This week: {left} of {slots} slots left.")


def fill(t, pr):
    return t.format(lo_n=3, **pr)


def wall(program):
    by = {}
    for r in rows():
        if r["program"] == program and r["state"] != "void":
            by.setdefault(r["who"], []).append(r)
    if not by:
        return ""
    items = []
    for who, rs in sorted(by.items(), key=lambda kv: -len(kv[1])):
        whats = " · ".join(r["what"] for r in rs)
        first = min(r["accepted"] for r in rs)
        items.append("<li><b>%s</b> · %d · %s<span class=\"en\">since %s</span></li>"
                     % (who, len(rs), whats, first))
    n = sum(len(v) for v in by.values())
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
    pr = price("roadworks")
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
    want = dict(b, amount_thb=pr["baht"], display="฿%s (about US$%s) this week" % (pr["baht"], pr["usd"]),
                rule="Shoup: each Monday, all %d weekly slots used last week → one step down; under 3 → one step up; ฿%d–฿%d"
                     % (pr["slots"], pr["floor"], pr["ceiling"]),
                slots_per_week=pr["slots"], slots_left_this_week=pr["left"], next_free_slot_week=pr["next_free"], next_change=pr["next_check"],
                payment="PayPal, Venmo, Wise or Ko-fi, the Monday after your change goes live; put which one and its address in from",
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
    print("roadworks payout ฿%d · %d of %d slots left · changed: %s" % (pr["baht"], pr["left"], pr["slots"], ", ".join(changed) or "nothing"))
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
    elif a[0] == "accept" and len(a) in (5, 6):
        accept(*a[1:])
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
