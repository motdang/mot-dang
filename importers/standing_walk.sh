#!/bin/zsh
# เดินเก็บเรื่อย ๆ — the standing walk.
#
# The ants do not wait to be told. This goes round every twenty minutes,
# forever, and publishes whatever the maker bots have finished. Nobody asks
# whether to publish; that question has an answer and this file is it.
#
# HOW IT DIVIDES WITH THE MORNING WALK. morning_walk.sh (07:09) is the GATHER:
# the daily fetchers with a cadence of their own — showtimes, lottery, finance,
# events, festivals — and it writes them to disk whether or not it goes on to
# build. This is the PUBLISH: it picks up whatever is on disk, from that gather
# or from any session's work, and puts it in front of readers. The two compose
# without either knowing about the other, which is why the morning walk needed
# no rewriting when this arrived; they share a lock so they can never be
# halfway through each other.
#
# WHY QUIET AND NOT CLEAN. The morning walk stands down from BUILDING when any
# source file is dirty. That reads as caution and is really a stall: the tree
# is nearly always dirty, because a session is nearly always mid-order, and the
# log shows it published 2 mornings out of 14 while three weeks of finished
# shelves sat unpublished. So this asks a different question — has anyone
# TOUCHED the source in the last QUIET_MINUTES? A tree nobody has written to
# for ten minutes is a tree between edits, not a tree mid-edit. The hard gates
# further down are what actually keep a broken build off the site.
#
# WHY A CHANGE GATE. Rebuilding is not free: build.py rewrites ~36,000 files,
# and the first evening of this walk republished a byte-identical site four
# times in ninety minutes because the weather had been refetched at the top of
# each round. So the weather now comes AFTER the decision to build rather than
# causing it, and the decision belongs to importers/walk_fingerprint.py —
# which knows two things this file should not have to: mtimes are not news
# (the inbox syncs rewrite their files every round), and neither are the
# `generated` stamps the writers put INSIDE their output (data/claims.json
# carries the moment the worker answered, and hashing that raw made round two
# rebuild the whole site to ship a timestamp). Its `diff` names what actually
# changed, so the log reads as a reason and not a verdict.
#
# Resting:  cache/walk-rest — if that file exists the walk stands down. Empty
#           means rest until you remove it; an ISO timestamp inside means rest
#           until then, and the walk clears it itself when the time passes.
#           Every shape isoformat() writes is honored — bare local, ...Z,
#           ±HH:MM — and a date the check cannot read or compare rests like
#           an empty file does: only a proven expiry ever removes the rest,
#           because the file may be another session's and is not ours to lose.
#           NOTHING ELSE STOPS IT. There is no window and no arming step: the
#           default is that finished work reaches readers.
# Gate:     importers/walk_fingerprint.py vs cache/last-published.json —
#           what a build reads, hashed with the volatile stamps dropped.
# Held:     cache/gate-fail.fp — the inputs that last failed the publish gate;
#           while they still match, the round stands down instead of rebuilding.
# Ledger:   cache/standing-walk.jsonl — one line per round, what it did and why.
# Log:      ~/Library/Logs/motdang-standing-walk.log (rotated at 5 MB)
# Plist:    ~/Library/LaunchAgents/net.motdang.standing-walk.plist (every 20 min)
#
# It does NOT commit. The morning walk commits because it owns everything it
# touched; here the source belongs to whichever session is editing it, and a
# commit mixing their half-done work with built output would be a confusing
# thing to find in the history. What shipped is in the ledger.

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
REPO="${0:a:h:h}"   # importers/.. = repo root
LOG="$HOME/Library/Logs/motdang-standing-walk.log"

# A perpetual job needs somewhere for its log to go. Rotate before the first
# line, so a round is never split across two files.
if [[ -f "$LOG" ]] && (( $(stat -f %z "$LOG" 2>/dev/null || echo 0) > 5242880 )); then
  mv -f "$LOG" "$LOG.1" 2>/dev/null
fi
exec >>"$LOG" 2>&1
cd "$REPO" || exit 1

REST="cache/walk-rest"
LEDGER="cache/standing-walk.jsonl"
STAMP="cache/last-published.json"
GATE_FP="cache/gate-fail.fp"   # what last failed the publish gate: hash, when, why
TOWER="/Users/annikapeacock/Developer/claude code projects/bot-tower/tower.py"
QUIET_MINUTES=${MD_QUIET_MINUTES:-10}
MAX_AGE_HOURS=${MD_MAX_AGE_HOURS:-20}

say() { print -- "$(date '+%F %T')  $*" }

note() {   # note <verdict> <detail>   — one line in the ledger, for reading later
  python3 - "$1" "$2" <<'PY' >>"$LEDGER" 2>/dev/null
import json, sys, time
print(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                  "verdict": sys.argv[1], "detail": sys.argv[2]},
                 ensure_ascii=False))
PY
}

stand_down() { say "ยืนดูเฉย ๆ รอบนี้ — $1"; note "stood-down" "$1"; exit 0 }

# gate_fp — one hash of everything the publish gate's verdict depends on: the
# manifest walk_fingerprint.py builds for the change gate below (source, data,
# assets; volatile stamps dropped), then build.py, every *_layer.py,
# and the gate itself once more by name, so what counts is readable here.
# linkhealth.json is NOT named: the manifest already hashes it with
# "generated" dropped, and check_links.py stamps that date every morning —
# named raw, the hash would move daily and the hold would never hold.
# Prints nothing if it cannot hash — an empty fingerprint never matches and
# is never recorded.
gate_fp() {
  python3 - <<'PY' 2>/dev/null
import glob, hashlib, json, sys
sys.path.insert(0, "importers")
import walk_fingerprint
h = hashlib.sha256(json.dumps(walk_fingerprint.manifest(), sort_keys=True).encode("utf-8"))
named = ["build.py", "tests/test_publish_gate.py"] + glob.glob("*_layer.py")
for p in sorted(named):
    h.update(p.encode("utf-8"))
    try:
        h.update(open(p, "rb").read())
    except OSError:
        pass
print(h.hexdigest())
PY
}

# remember_gate_fail <gate output> — write cache/gate-fail.fp: the hash of the
# inputs AS THEY ARE NOW, when, and the line that says why. Now, not at the
# top of the round: weather, air and BUILD_DATE moved after the change gate,
# and the next round hashes before it touches any of them, so only a hash
# taken here sees the bytes it will see.
remember_gate_fail() {
  local why fp
  # "not a site:" is a tree mid-build, not a verdict about the inputs — the
  # gate says so itself ("NOT A BROKEN SITE: pid N is building this repo").
  # Holding on that would suppress a rebuild for a condition that clears on
  # its own, so it is not a reason and, alone, not a hold.
  why=$(print -r -- "$1" | grep -E '^(links to broken URLs|/Users/ path leaks|sites without a card) +[1-9]' \
        | head -3 | sed -E 's/ {2,}/ /g' | tr '\n' ';' | sed 's/;$//')
  [[ -z "$why" ]] && why=$(print -r -- "$1" | grep -E '^front page domain' | head -1 | sed -E 's/ {2,}/ /g')
  if [[ -z "$why" ]]; then
    say "the gate failed on a passing condition — the next round rebuilds"
    return 0
  fi
  fp=$(gate_fp)
  if [[ -z "$fp" ]]; then
    say "could not hash the gate's inputs — the next round rebuilds"
    return 0
  fi
  printf '%s\n%s\n%s\n' "$fp" "$(date '+%F %H:%M')" "$why" > "$GATE_FP" \
    || say "could not write $GATE_FP — the next round rebuilds"
}

source importers/search_reload.sh
source importers/server_link.sh

say "== เดินเก็บเรื่อย ๆ begins"

push_rest   # the server publishes too, so it rests with the laptop
replay_direct_uploads   # direct uploads the server's ledger has not heard of yet

# --- is the walk resting? ------------------------------------------------
# Read first, before anything can cost time or touch the network. An empty
# file rests until somebody removes it; a timestamp rests until that moment
# and then clears itself, so a rest can be set and forgotten.
#
# Sessions write this timestamp in whatever shape isoformat() handed them —
# bare local, ...Z, +00:00, +07:00 — so both sides are normalized to aware
# UTC before comparing (fromisoformat before 3.11 cannot read a trailing Z,
# and an offset date once made the old naive-now() comparison throw; the
# traceback fell through to the rm below and deleted a live rest). The check
# exits 0 ONLY on a proven expiry: parse errors, comparison errors, even a
# missing python3 all land in the else and KEEP the file. Failing toward
# walking destroys other sessions' rests; failing toward resting costs
# twenty minutes.
if [[ -f "$REST" ]]; then
  UNTIL=$(head -1 "$REST" 2>/dev/null | tr -d '[:space:]')
  if [[ -z "$UNTIL" ]]; then
    stand_down "resting — $REST is set (remove it to walk again)"
  fi
  if python3 -c "
import sys, datetime
def expired(raw):
    s = raw.strip()
    if s[-1:] in ('Z', 'z'):
        s = s[:-1] + '+00:00'
    until = datetime.datetime.fromisoformat(s)
    if until.tzinfo is None:
        until = until.astimezone()   # a bare wall time means local time
    return datetime.datetime.now(datetime.timezone.utc) >= until
try:
    sys.exit(0 if expired(sys.argv[1]) else 1)
except Exception:
    sys.exit(1)   # unreadable or uncomparable — an open-ended rest, never an expired one
" "$UNTIL"; then
    rm -f "$REST"
    say "rest ended $UNTIL — walking again"
  else
    stand_down "resting until $UNTIL"
  fi
fi

# --- one walk at a time --------------------------------------------------
# SHARED WITH THE MORNING WALK on purpose. They do different halves of the
# same job and must never be halfway through each other: the gather rewrites
# data/ while a build would be reading it.
LOCK=/tmp/motdang-walk.lock
# A lock records its holder. One whose process is gone (a walk killed
# mid-round cannot run its trap) is announced and taken, as build.py treats
# cache/build.lock; before this, one SIGKILL would have stood both walks down
# for good. A pid-less lock is from before that and counts as stale at 3 h.
walk_lock_stale() {
  local holder
  holder=$(cat "$LOCK/pid" 2>/dev/null)
  if [[ -n "$holder" ]]; then ! kill -0 "$holder" 2>/dev/null; return; fi
  [[ -n $(find "$LOCK" -maxdepth 0 -mmin +180 2>/dev/null) ]]
}
take_walk_lock() {
  mkdir "$LOCK" 2>/dev/null && { print $$ > "$LOCK/pid"; return 0 }
  if walk_lock_stale; then
    say "the walk lock's holder ($(cat "$LOCK/pid" 2>/dev/null || print unknown)) is gone — taking it"
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null && { print $$ > "$LOCK/pid"; return 0 }
  fi
  return 1
}
if ! take_walk_lock; then stand_down "another walk holds the lock (pid $(cat "$LOCK/pid" 2>/dev/null || print unknown))"; fi
trap 'rm -rf "$LOCK" 2>/dev/null' EXIT

# No copy-back of the server's docs/ (her word 2026-10-10: "you should not be
# copying the site to the mac"). The search reload that read the copy moves to
# the server.

# --- one build at a time (CLAUDE.md rule) --------------------------------
# ASK THE LOCK, NOT ps. build.take_build_lock() writes the holder's pid to
# cache/build.lock and is the mechanism the project actually trusts. A lock
# whose process is gone is stale by that function's own rule, so it is ignored
# here exactly as build.py would ignore it.
if [[ -f cache/build.lock ]]; then
  HOLDER=$(head -1 cache/build.lock 2>/dev/null | tr -d '[:space:]')
  if [[ -n "$HOLDER" ]] && kill -0 "$HOLDER" 2>/dev/null; then
    stand_down "cache/build.lock is held by live pid $HOLDER"
  fi
fi
# Anchored at the END, because a shell wrapper whose command line merely
# CONTAINS the words "build.py" is a session that ran a build, not a build.
if ps -eo args | grep -E '[b]uild\.py$' >/dev/null; then
  stand_down "a build.py is already running"
fi

# --- has the source stopped moving? --------------------------------------
# data/, docs/, assets/ and cache/ are what the walks themselves write, so they
# are never evidence of somebody else working. Everything else is source.
BUSY=$(python3 - "$QUIET_MINUTES" <<'PY'
import os, sys, time
cutoff = time.time() - int(sys.argv[1]) * 60
skip = {".git", "docs", "cache", "data", "assets", "_incoming",
        "node_modules", ".venv", "__pycache__"}
newest, name = 0.0, ""
for root, dirs, files in os.walk("."):
    dirs[:] = [d for d in dirs if d not in skip and not d.startswith(".")]
    for f in files:
        if f.startswith("."):
            continue
        p = os.path.join(root, f)
        try:
            m = os.path.getmtime(p)
        except OSError:
            continue
        if m > newest:
            newest, name = m, p
if newest > cutoff:
    print("%s (%.0f min ago)" % (name.lstrip("./"), (time.time() - newest) / 60))
PY
)
[[ -n "$BUSY" ]] && stand_down "source still moving — $BUSY"

# --- what came in while we were away -------------------------------------
# Cheap, keyless, our own worker. These run BEFORE the change gate because a
# claim or a toilet report is exactly the kind of news worth a rebuild.
python3 importers/sync_claims.py      || say "claims sync kept what is on disk"
python3 importers/sync_toilets.py     || say "toilet sync kept what is on disk"
python3 importers/sync_doodle_votes.py || say "doodle votes kept what is on disk"
python3 importers/sync_suggestions.py || say "suggestion queue not read this round"

# Her pictures with no place: tie each to the place it shows, or make the place
# (NaN 2026-10-11). Before the import, so a record it makes is imported now.
python3 importers/place_own_pictures.py --write || say "picture placing kept the last pass"

# People's own pages (sites.motdang.net) matched to the places they describe
# (NaN 2026-10-13). Before the import, so the facts they state land this round.
# A feed that does not answer leaves data/curated/own_pages.json as it was.
python3 importers/own_pages.py --write || say "own pages kept the last pass"

# --- fold in finished crawls ---------------------------------------------
# import_all.py reads cache/overpass/ wholesale and rewrites data/canonical/.
# A crawl still writing into that cache can hand it a half-written file, and a
# truncated group imports as an empty one — the same failure CLAUDE.md warns
# about for Overpass remarks, arriving by a different door. So the import waits
# for the crawler to come home, and the build ships what is already imported
# meanwhile. The next round catches the new shelf.
if ps -eo args | grep -E '[c]rawl_overpass\.py' >/dev/null; then
  say "a crawl is still out — importing nothing this round, building what is already home"
else
  python3 importers/import_all.py       || { say "import FAILED — nothing published"; note "failed" "import_all"; exit 1 }
  python3 importers/build_streets.py    || say "streets kept the last pass"
  # The wat rounds follow the catalogue. data/merit.json was built by hand and
  # then left: the published rounds were grouped from a set of wats the
  # catalogue had since grown past, so /merit.html was showing rounds nobody
  # had checked against the map in weeks.
  python3 importers/build_wats.py       || say "wat rounds kept the last pass"
  python3 importers/build_open_lamps.py || say "lamp schedules kept the last pass"
fi
# Her pictures (pics_layer.py): exact time and heading of each, when the camera
# last saw each place, and card-size copies for the strips. All three rewrite
# only what changed, so a round with no new ride changes nothing.
python3 importers/make_picture_meta.py || say "picture times kept the last pass"
python3 importers/make_field_seen.py   || say "camera sightings kept the last pass"
python3 importers/make_band_pics.py    || say "card pictures kept — the strips fall back to full size"

# --- did these same inputs already fail the gate? ------------------------
# 2026-09-10: six rounds in a row each rebuilt the site (170 min) and each
# failed the publish gate on the same 14 links — nothing the gate reads had
# changed between them. A failed gate leaves cache/gate-fail.fp (see
# remember_gate_fail); while its hash still matches, a build can only fail
# the same way. Any change to those inputs — a source edit, new data, a
# fresh linkhealth.json — changes the hash, and that clears it.
if [[ -f "$GATE_FP" ]]; then
  FP=$(gate_fp)
  if [[ -n "$FP" && "$FP" == "$(sed -n 1p "$GATE_FP")" ]]; then
    stand_down "same inputs failed the gate at $(sed -n 2p "$GATE_FP"): $(sed -n 3p "$GATE_FP") — not rebuilding"
  fi
  rm -f "$GATE_FP"
fi

# --- a stale feed is refetched here, not only reported ---------------------
# BEFORE the change gate, so a healed file counts as news and gets built. It
# acts only on files past their own max age (watch_data.CHECKS), so a healthy
# round fetches nothing and the gate below still decides. The morning walk
# stood down every day from 09-13 to 09-25 and nothing else fetched finance,
# showtimes, lottery or events; ping.json had no caller at all from 09-04.
HEAL_OUT=$(python3 importers/watch_data.py --heal --quiet 2>&1) \
  || { print -r -- "$HEAL_OUT" | tail -20; say "⚠️  a feed is still stale after a refetch — see the list above"; note "stale" "$(print -r -- "$HEAL_OUT" | grep -E '^   - ' | head -3 | tr '\n' ' ')" }

# --- is there anything new to say? ---------------------------------------
# walk_fingerprint.py compares what a build would read (source + data +
# assets, volatile stamps dropped) against what the last publish read, and
# prints one line per real difference. Empty means the town is as it was.
# A missing or unreadable store prints a line saying so, which correctly
# fails toward publishing.
CHANGES=$(python3 importers/walk_fingerprint.py diff "$STAMP")
if [[ -z "$CHANGES" ]]; then
  # Nothing has changed. Publish anyway if the site is about to date itself
  # older than a day — the footer says อัปเดตทุกวัน and that should be true
  # even through a quiet stretch.
  AGE_H=$(python3 -c "
import os, time, sys
print(int((time.time() - os.path.getmtime(sys.argv[1])) / 3600))" "$STAMP")
  if (( AGE_H < MAX_AGE_HOURS )); then
    stand_down "ไม่มีอะไรใหม่ — nothing has changed since the last publish (${AGE_H}h ago)"
  fi
  say "nothing new, but the last publish was ${AGE_H}h ago — walking anyway to keep the date true"
else
  N=$(print -- "$CHANGES" | grep -c .)
  say "what changed ($N):"
  print -- "$CHANGES" | head -10 | while read -r line; do say "    $line"; done
  (( N > 10 )) && say "    … and $((N - 10)) more"
fi

# --- now that we are building, make the numbers current ------------------
# AFTER the gate, never before: these change every single time they run, so
# running them first would make every round look like news and this walk would
# rebuild the whole site every twenty minutes forever.
python3 importers/make_weather.py || say "weather kept the snapshot"
python3 importers/make_air.py     || say "air quality kept the snapshot"
# The river page prints each gauge's hour; watch_data expects it within a day.
# Nothing called make_ping.py from 2026-09-04, and /nam.html went on showing
# that morning's water for three weeks.
python3 importers/make_ping.py    || say "river gauges kept the snapshot"
python3 importers/watch_data.py   || say "⚠️  a source came home empty — see the list above"

# today's date onto every footer
TODAY=$(date +%F)
sed -i '' -E "s/^BUILD_DATE = \"[0-9-]+\"/BUILD_DATE = \"$TODAY\"/" build.py

# Shelf and question cards. Signature-based: it redraws only the ones whose
# picture would differ, so this is seconds on a quiet day. Soft-fails —
# it needs Chrome, and a missing card falls back to the brand card by
# design, which is a worse share but never a broken page.
python3 make_shelf_cards.py || say "shelf cards kept — missing ones fall back to the brand card"
# --- build here, or hand the round to the server ---------------------------
# cache/build-on-server present (2026-10-05, Nan: "move finished builds to the
# server"): the source goes to motdang-build, which builds, gates and publishes
# it (importers/server_walk.sh). The laptop never writes docs.next/ — the
# second 10 GB copy that filled this disk on 2026-10-05.
if [[ -f cache/build-on-server ]]; then
  # Commit builds wait for the code the live site already carries to be
  # committed (Nan, 2026-10-10: "switch it on after they commit"); the noted
  # lines are in cache/build-from-commit.pending.json (importers/build_code.py).
  if [[ -f cache/build-from-commit.pending.json && ! -f cache/build-from-commit ]]; then
    if WAITING=$(python3 importers/build_code.py pending check); then
      touch cache/build-from-commit && rm -f cache/build-from-commit.pending.json
      say "commit builds ON — the code they waited for is committed"
      note "commit-builds-on" "pending code committed"
    else
      say "commit builds wait on: $WAITING"
    fi
  fi
  # A build.py that cannot be imported fails here in seconds, not after hours on
  # the server (2026-10-10). Built from a commit, the folder's build.py is not
  # the one that runs; the server's last good code covers a commit that fails.
  if [[ ! -f cache/build-from-commit ]]; then
    python3 -c "import build" >/dev/null \
      || { say "build.py does not import — nothing sent"; note "failed" "build.py import"; exit 1 }
  fi
  hand_to_server || { say "hand-off to the server FAILED — nothing sent"; note "failed" "hand-off"; exit 1 }
  python3 importers/walk_fingerprint.py write "$STAMP" \
    || say "⚠️  could not record the fingerprint — next round sends again"
  say "== handed to the server $TODAY $(date '+%H:%M') — it builds and publishes"
  note "handed-off" "$(print -- "${CHANGES:-first publish}" | head -1)"
  exit 0
fi
source importers/publish_steps.sh

# --- remember what we just published -------------------------------------
# Recorded here, AFTER weather/air/BUILD_DATE, not before: those changed
# after the diff above was taken, and storing the BEFORE state would make the
# next round see this round's own work as somebody's news and rebuild every
# twenty minutes — the exact loop the gate exists to break.
python3 importers/walk_fingerprint.py write "$STAMP" \
  || say "⚠️  could not record the fingerprint — next round will rebuild once"

say "== published $TODAY $(date '+%H:%M') — $COUNT files, the ants are home"
note "published" "$COUNT files; $(print -- "${CHANGES:-first publish}" | head -1)"

search_reload || true
