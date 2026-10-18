#!/bin/zsh
# ดึงกล่องจดหมาย — the inbox pull.
#
# Nothing on this Mac read the Worker's inbox on its own: owner claims, reader
# suggestions and the search box's misses waited for a session to ask. This
# asks once a day at 08:20, before the listings job at 08:40. It only reads
# the Worker and writes data/claims.json and _incoming/; every step may fail
# alone, and what each said is in the log.
#
#   importers/pull_inbox.sh        by hand, any time
#
# Plist: ~/Library/LaunchAgents/net.motdang.inbox-pull.plist (daily 08:20)
# Log:   ~/Library/Logs/motdang-inbox.log
#
# enrich_daily.sh still carries the miss pull (its step 7) so one run of that
# file is the whole demand loop; this is the copy that runs without a hand.

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
REPO="${0:a:h:h}"   # importers/.. = repo root
LOG="$HOME/Library/Logs/motdang-inbox.log"
exec >>"$LOG" 2>&1
cd "$REPO" || exit 1

say() { print -- "$(date '+%F %T')  $*" }

# wrangler needs the fleet token when nobody is logged in on this Mac — the
# same file and key white-label-ai/deploy.sh reads. The value is never printed.
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  CLOUDFLARE_API_TOKEN=$(python3 -c 'import json,pathlib;print(json.load(open(pathlib.Path.home()/".config/nanobotco/keys.json"))["cloudflare"]["api_token"])' 2>/dev/null || true)
  [[ -n "$CLOUDFLARE_API_TOKEN" ]] && export CLOUDFLARE_API_TOKEN
fi

say "== ดึงกล่องจดหมาย begins"

# step <name> <command…> — run it, keep what it said, remember how it went
WENT=()
step() {
  local name="$1"; shift
  say "-- $name"
  if "$@"; then WENT+=("$name ok"); else WENT+=("$name FAILED"); say "$name failed — see above"; fi
}
step claims      python3 importers/sync_claims.py
step suggestions python3 importers/sync_suggestions.py
step bounty      python3 importers/bounty_ask.py   # a roadworks change → one go line in QUEUE A
step scout       python3 importers/roadworks_scout.py   # Mondays: news leads for /roadworks → one go line in QUEUE A
step payouts     python3 importers/payout_shoup.py publish --live --monday   # Mondays: bounty amount by Shoup, wall of bots
step misses      python3 importers/box_misses.py --days 14

# The Worker's own health line. /health is new and may not be deployed yet:
# anything but a 200 carrying {ok, mailfail:{count, oldest}} reads as unreachable.
HEALTH=$(curl -s -m 10 -w '\n%{http_code}' https://mot-dang-claims.nanobotco.workers.dev/health 2>/dev/null || true)
MAIL=$(print -r -- "$HEALTH" | python3 -c '
import json, sys
raw = sys.stdin.read().rstrip("\n")
try:
    body, code = raw.rsplit("\n", 1)
    if code != "200":
        raise ValueError(code)
    m = json.loads(body)["mailfail"]
    print("mailfail: %s (oldest %s)" % (m.get("count", "?"), m.get("oldest") or "none"))
except Exception:
    print("health: unreachable")
' 2>/dev/null || print -- "health: unreachable")
say "$MAIL"

say "== inbox pull done — ${(j: · :)WENT} · $MAIL"
