#!/usr/bin/env python3
"""A roadworks change that arrives becomes one line in QUEUE.txt section A.

Nan approves each ฿100 payout herself (her word 2026-10-17: "Want to approve
each request going forward because funds are tight 2nd half of month").
Nothing here pays, publishes or replies. It reads _incoming/suggestions.json
(sync_suggestions.py, run just before in pull_inbox.sh) and, for each
roadworks submission not yet asked about, writes one "say go" line under the
A header. The ids it has asked about live in ~/.claude/state/bounty-asked.tsv.
Every roadworks submission it reads is kept in _incoming/roadworks-suggestions.jsonl,
so a link sent once can still be found after the queue has moved on, and a go
line whose submission repeats a link someone sent earlier says who came first
(Nan 2026-10-19, the Samoeng row: dot sent it on 17 Oct, Briefcraft Lab on 18 Oct).

    python3 importers/bounty_ask.py          # add lines for new submissions
    python3 importers/bounty_ask.py --dry    # print them, write nothing
"""
import json, os, sys, datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUGG = os.path.join(REPO, "_incoming", "suggestions.json")
QUEUE = os.path.expanduser("~/Desktop/1 — NEXT UP/QUEUE.txt")
ASKED = os.path.expanduser("~/.claude/state/bounty-asked.tsv")
A_HEADER = "A — SAY GO."


def is_bounty(s):
    return (s.get("page") or "").startswith("/roadworks")


def first_note(s):
    """ " Repeats a link dot sent first on 2026-10-17 (suggestion 236cf186)." — or ""."""
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import payout_shoup as ps
    except Exception:
        return ""
    mine = ps.urls_in(json.dumps(s, ensure_ascii=False))
    when, sender = s.get("createdAt") or "9999", s.get("from") or ""
    firsts = []
    for x in ps.suggestions():
        if x.get("id") == s.get("id") or not x.get("createdAt") or x["createdAt"] >= when:
            continue
        if ps.same_sender(x.get("from") or "", sender) or (x.get("from") or "") == sender:
            continue
        if mine & ps.urls_in(json.dumps(x, ensure_ascii=False)):
            firsts.append((x["createdAt"], name_of(x.get("from")), "suggestion %s" % x["id"][:8]))
    by_ref = {r["ref"]: r for r in ps.rows()}
    for ref, u in ps.src_rows():
        r = by_ref.get(ref)
        if r and r["state"] != "void" and r["accepted"] < when[:10] and ps.norm_url(u) in mine \
                and not ps.same_sender(r["who"], sender):
            firsts.append((r["accepted"], r["who"], "ledger %s" % ref))
    if not firsts:
        return ""
    w, who, where = min(firsts)
    return " Repeats a link %s sent first on %s (%s)." % (who, w[:10], where)


def name_of(sender):
    """bot:dot 521mojc@… → dot; no address in a QUEUE line."""
    t = (sender or "someone").split(";")[0].split()[0] if sender else "someone"
    return t[4:] if t.startswith("bot:") else t if "@" not in t else "someone"


def line_for(s):
    # the amount is the ฿100 problem and its weekly slots (payout_shoup.py)
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import payout_shoup
        pr = payout_shoup.price("problems")
        amt = "฿%d for a whole district, %d of %d ฿100 problems left this week" % (pr["baht"], pr["left"], pr["slots"])
    except Exception:
        amt = "this week's amount"
    day = (s.get("createdAt") or "")[:10]
    who = (s.get("from") or "no contact given").replace("\n", " ")[:120]
    return ("- ROADWORKS BOUNTY (added %s, %s). A change from %s, %d characters, "
            "suggestion %s. Say go and I check it against the district test in roadworks/bots.txt, put it live "
            "if it holds, record it with payout_shoup.py accept problems, and give you the payout link to tap. "
            "A single row is used unpaid. Say no and nobody is paid.%s\n"
            % (day, amt, who, len(s.get("what") or ""), s["id"][:8], first_note(s)))


SEEN = os.path.join(REPO, "_incoming", "roadworks-suggestions.jsonl")


def keep(subs):
    """Add roadworks submissions not yet in the archive (gitignored, like the queue)."""
    have = set()
    if os.path.exists(SEEN):
        for l in open(SEEN, encoding="utf-8"):
            try:
                have.add(json.loads(l)["id"])
            except (ValueError, KeyError):
                pass
    new = [x for x in subs if is_bounty(x) and x.get("id") and x["id"] not in have]
    if new:
        with open(SEEN, "a", encoding="utf-8") as f:
            f.write("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in new))


def main():
    dry = "--dry" in sys.argv
    try:
        subs = json.load(open(SUGG)).get("suggestions") or []
    except (OSError, ValueError):
        return 0
    if isinstance(subs, dict):
        subs = list(subs.values())
    if not dry:
        keep(subs)
    asked = set()
    if os.path.exists(ASKED):
        asked = {l.split("\t")[0] for l in open(ASKED) if l.strip()}
    new = [s for s in subs if is_bounty(s) and s.get("id") and s["id"] not in asked]
    if not new:
        return 0
    lines = [line_for(s) for s in new]
    if dry:
        sys.stdout.write("".join(lines))
        return 0
    q = open(QUEUE, encoding="utf-8").read().split("\n")
    i = next(n for n, l in enumerate(q) if l.startswith(A_HEADER))
    # under the header and its rule of dashes
    q[i + 2:i + 2] = [l.rstrip("\n") for l in lines]
    open(QUEUE, "w", encoding="utf-8").write("\n".join(q))
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with open(ASKED, "a") as f:
        for s in new:
            f.write("%s\t%s\t%s\n" % (s["id"], now, (s.get("from") or "")[:120]))
    print("bounty: %d line(s) to QUEUE A" % len(new))
    return 0


if __name__ == "__main__":
    sys.exit(main())
