#!/usr/bin/env python3
"""A roadworks change that arrives becomes one line in QUEUE.txt section A.

Nan approves each ฿100 payout herself (her word 2026-10-17: "Want to approve
each request going forward because funds are tight 2nd half of month").
Nothing here pays, publishes or replies. It reads _incoming/suggestions.json
(sync_suggestions.py, run just before in pull_inbox.sh) and, for each
roadworks submission not yet asked about, writes one "say go" line under the
A header. The ids it has asked about live in ~/.claude/state/bounty-asked.tsv.

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


def line_for(s):
    # the amount is this week's Shoup payout (payout_shoup.py), not a fixed ฿100
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import payout_shoup
        pr = payout_shoup.price("roadworks")
        amt = "฿%d, %d of %d slots left this week" % (pr["baht"], pr["left"], pr["slots"])
    except Exception:
        amt = "this week's amount"
    day = (s.get("createdAt") or "")[:10]
    who = (s.get("from") or "no contact given").replace("\n", " ")[:120]
    return ("- ROADWORKS BOUNTY (added %s, %s). A change from %s, %d characters, "
            "suggestion %s. Say go and I check it, put it live if it holds, record it with "
            "payout_shoup.py accept, and give you the payout link to tap. Say no and nobody is paid.\n"
            % (day, amt, who, len(s.get("what") or ""), s["id"][:8]))


def main():
    dry = "--dry" in sys.argv
    try:
        subs = json.load(open(SUGG)).get("suggestions") or []
    except (OSError, ValueError):
        return 0
    if isinstance(subs, dict):
        subs = list(subs.values())
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
