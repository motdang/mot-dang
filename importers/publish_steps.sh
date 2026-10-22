# publish_steps.sh — build, the pre-publish gates, deploy, IndexNow.
# Sourced, not run: by importers/standing_walk.sh on the laptop, and by
# importers/server_walk.sh on motdang-build, so both hosts pass the same gates.
# Needs say, note, remember_gate_fail and TOWER from the caller; sets COUNT.

BUILD_TIMEOUT="${MD_BUILD_TIMEOUT:-180m}"
# Unbuffered, so build.py's own lines reach the walk log as they happen. Buffered,
# a build killed at its time limit left no line saying how far it got (2026-10-10).
export PYTHONUNBUFFERED=1
# The same bytes from the same inputs: str hash() is salted per process unless
# this is pinned, and an event without a uid takes its .ics UID from it (build.py).
export PYTHONHASHSEED=0
# Pictures (streetphotos/, photos/, inat/, og/) go to the bucket mot-dang-media instead of
# docs/ when this host can write it (media_layer.py, publish/media_sync.py, worker-media/).
# A host whose key does not cover that bucket publishes them with the site as before.
export MD_MEDIA_BUCKET=0
if python3 publish/media_sync.py probe; then
  export MD_MEDIA_BUCKET=1
else
  say "⚠️  pictures ride the site build: mot-dang-media is not writable from this host"
fi
if command -v timeout >/dev/null 2>&1; then
  timeout "$BUILD_TIMEOUT" python3 build.py || { say "BUILD FAILED (or timed out after $BUILD_TIMEOUT) — nothing published"; note "failed" "build.py"; exit 1 }
else
  python3 build.py || { say "BUILD FAILED — nothing published"; note "failed" "build.py"; exit 1 }
fi

# --- the pre-publish sequence, same as by hand ---------------------------
# HOLD BACK THE FAILING PART (Nan, 2026-10-11, "A"). The publish gate and map
# sanity name the page or site they fail on; tools/holdback.py holds it, the
# gate runs again without it, and deploy.py leaves it in the bucket as it is.
# Anything else they fail on, or more than 20 units, fails as before.
python3 tools/holdback.py reset
hold_gate() {   # hold_gate <label> <cmd…>: 0 when it passes, alone or after a hold
  local label=$1 prop out rc; shift
  prop=$(mktemp)
  out=$(MD_HOLD_PROPOSE=$prop "$@" 2>&1); rc=$?
  HOLD_OUT=$out
  if (( rc != 0 )) && python3 tools/holdback.py accept "$prop"; then
    out=$("$@" 2>&1); rc=$?
    HOLD_OUT=$out
    (( rc == 0 )) && say "$label passed with the failing part held back"
  fi
  rm -f "$prop"
  return $rc
}
hold_gate "publish gate" python3 tests/test_publish_gate.py; GATE_RC=$?
GATE=$HOLD_OUT
print -r -- "$GATE"
if (( GATE_RC != 0 )); then
  say "publish gate FAILED — nothing published"; note "failed" "publish gate"
  remember_gate_fail "$GATE"
  exit 1
fi
# A published reader question must have its records, its page, its card and
# a reply that fills. Hard, because a broken one is a wrong answer with the
# site's name on it — a half-answered question carries draft:true in
# data/asked.json and is skipped, which is the valve.
python3 tests/test_asked.py || { say "asked gate FAILED — nothing published"; note "failed" "asked gate"; exit 1 }
python3 tests/test_sites.py || { say "register gate FAILED — nothing published"; note "failed" "register gate"; exit 1 }
# Every pin where it says it is (tests/test_map_sanity.py): swapped or
# out-of-country pins, pins off their frame or their province, GeoJSON in the
# wrong order. Hard, and a ratchet: rows standing when it went in are listed
# in tests/map_sanity_known.json and printed; a NEW one fails (Nan, 2026-09-25:
# "do sanity checks everywhere").
hold_gate "map sanity" python3 tests/test_map_sanity.py || { print -r -- "$HOLD_OUT" | tail -25; say "map sanity FAILED — nothing published"; note "failed" "map sanity"; exit 1 }
# Advisory: its NO CARD mode fires legitimately when Chrome was away.
python3 tests/test_shelf_cards.py || say "⚠️  shelf cards advisory — some list pages share as the brand card"
# Advisory: the 🏷 tag layer's counts, thresholds and pills (tests/test_tags.py).
# A drift here is a wrong count on a tag page, not a broken site — say so, ship.
# Its last 20 lines land here when it fails, so the advisory says why.
TAGS_OUT=$(python3 tests/test_tags.py 2>&1) || { print -r -- "$TAGS_OUT" | tail -20; say "⚠️  tags advisory — tests/test_tags.py failed; tag pages may disagree with places.json" }
# Advisory: a borrowed pin must never claim to be surer than the record it
# was copied from (tests/test_pins.py). A wrong error bar is a quiet wrong
# answer, not a broken page — say it, ship it. Last 20 lines here on a fail.
PINS_OUT=$(python3 tests/test_pins.py 2>&1) || { print -r -- "$PINS_OUT" | tail -20; say "⚠️  pins advisory — a borrowed pin claims more precision than its source" }
# A perishable figure past its age is not shown (tests/test_shelflife.py; Nan,
# 2026-09-25, "b": hide it rather than print it with its date). Hard: the page
# that breaks this is the river page on the day the river rises.
python3 tests/test_shelflife.py >/dev/null || { say "shelflife FAILED — nothing published"; note "failed" "shelflife"; exit 1 }
# Advisory: reader-visible text through stylecheck's assurance forms
# (tests/test_no_assurances.py; 2026-09-25 six pages promised a position was
# "not sent anywhere, not stored" and nothing flagged it).  # stylecheck: allow
PROMISE_OUT=$(python3 tests/test_no_assurances.py 2>&1) || { print -r -- "$PROMISE_OUT" | tail -12; say "⚠️  copy advisory — a page makes a promise ~/.claude/STYLE.md §1 bans" }
# Advisory: a count llms.txt prints must match the file it describes
# (tests/test_llms_counts.py; 2026-09-25 it said 431 toilets over a file of 537).
LLMS_OUT=$(python3 tests/test_llms_counts.py 2>&1) || { print -r -- "$LLMS_OUT" | tail -10; say "⚠️  llms.txt advisory — a count there disagrees with its data file" }
node tests/test_plan_routes.js     || { say "route tests FAILED — nothing published"; note "failed" "route tests"; exit 1 }
# The front page's calendar reads every event with its own date code (tests/test_front_calendar.js;
# 2026-10-10 an end given as a bare date threw there and the calendar went out without its days drawn).
node tests/test_front_calendar.js  || { say "front calendar FAILED — nothing published"; note "failed" "front calendar"; exit 1 }
# Advisory: the doodle clock's hour hand reads like a wall clock (tests/test_front_clock.js;
# until 2026-10-11 a 24-hour dial put 09:38 where a wall clock says 11).
CLOCK_OUT=$(node tests/test_front_clock.js 2>&1) || { print -r -- "$CLOCK_OUT" | tail -6; say "⚠️  clock advisory — the doodle clock reads the wrong time" }
# Advisory: every dated thing in docs/front/when.json lands in one band of the calendar, by when.js
# (tests/test_when.js; the 03:00 day, all-day events on their own date, the same in any time zone).
WHEN_OUT=$(node tests/test_when.js 2>&1) || { print -r -- "$WHEN_OUT" | tail -6; say "⚠️  when advisory — a dated thing falls outside the calendar's bands" }
# The 404 page's side-scroller. Hard, for one of its checks only: the game
# must not take a keystroke from the search box, which is the whole job of
# the page it sits on. Needs no build — it reads assets/soi_run.js.
node tests/test_soi_run.js         || { say "soi_run FAILED — nothing published"; note "failed" "soi_run"; exit 1 }
# A leak inside a page or site is held back with it; one anywhere else stops the round.
LEAKS=$(grep -rlE "/Users/|/srv/mot-dang|/home/nan/" docs/ | python3 -c '
import sys; sys.path.insert(0, "tools"); import holdback
print("\n".join(l.strip() for l in sys.stdin if l.strip() and not holdback.held(l.strip())))')
if [[ -n "$LEAKS" ]] && ! print -r -- "$LEAKS" | python3 tools/holdback.py take "path leak"; then
  say "path leak in docs/ — nothing published"; note "failed" "path leak in docs/"; exit 1
fi
# deploy.py has its own floor, but failing here costs a second instead of a
# full bucket listing, and says the number out loud in the log.
COUNT=$(python3 -c "
import pathlib
print(sum(1 for p in pathlib.Path('docs').rglob('*') if p.is_file()))")
say "docs/ holds $COUNT files"
if (( COUNT < 20000 )); then
  say "REFUSING — $COUNT files is a broken build, not a small site"
  note "failed" "docs floor: $COUNT files"; exit 1
fi

# The pictures the build listed go up before the pages that name them.
if [[ "$MD_MEDIA_BUCKET" == 1 ]]; then
  python3 publish/media_sync.py sync || { say "media sync FAILED — nothing published"; note "failed" "media sync"; exit 1 }
fi

# The server defines pre_deploy (importers/server_walk.sh); the laptop does not.
if typeset -f pre_deploy >/dev/null; then pre_deploy || exit 1; fi

# --- publish -------------------------------------------------------------
# Through the tower, on the cloudflare-deploy lane, so this can never land on
# top of the wichaa nightly or the crawler's own publish step.
#
# WAIT FOR THE LANE, DO NOT STEP BACK (2026-09-10). This used to be --no-wait,
# on the reasoning that another tick comes in twenty minutes. But by this line
# a whole build has just finished — 2 h 50 on 9/10 — and stepping back threw
# it away: the fingerprint below is never written, so the next round saw the
# same changes and rebuilt the entire site. The lane's usual holder is the
# manuscript-wiki publish, 10-15 minutes every hour plus a 5-minute courtesy
# gap, so a finished build landed in a busy lane about a quarter of the time.
# Two walks cannot pile up behind each other while this waits: the walk lock
# at the top of this file stands the next tick down. If the lane is still
# busy after 45 minutes the tower returns 75 and this stands down as before.
(( ${+PRUNE_ARGS} )) || PRUNE_ARGS=()   # server_walk.sh sets it (a one-time deletion bound)
# --defer-deletions: a refused deletion check puts the deletions off and the
# new and changed files still go up (publish/deploy.py; Nan, 2026-10-11).
# --incremental: compare docs/ with the manifest of the last publish and send what moved
# (publish/incpublish.py). With no manifest yet it publishes in full and writes one.
# MD_INCREMENTAL_PUBLISH=0 publishes in full as before.
INCR_ARGS=(--incremental)
[[ "${MD_INCREMENTAL_PUBLISH:-1}" == 0 ]] && INCR_ARGS=()
if [[ -f "$TOWER" ]]; then
  python3 "$TOWER" wrap cloudflare-deploy --patience 45 -- python3 publish/deploy.py --yes --defer-deletions "${INCR_ARGS[@]}" "${PRUNE_ARGS[@]}"
else
  python3 publish/deploy.py --yes --defer-deletions "${INCR_ARGS[@]}" "${PRUNE_ARGS[@]}"     # the server has no tower; nothing else there publishes
fi
RC=$?
if (( RC == 75 )); then
  stand_down "the cloudflare-deploy lane was busy; the next round will take it"
elif (( RC != 0 )); then
  say "R2 site sync FAILED ($RC) — readers still see the last good build"
  note "failed" "deploy.py exit $RC"; exit 1
fi

python3 importers/ping_indexnow.py || say "IndexNow ping skipped"
