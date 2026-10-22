#!/bin/zsh
# server_walk.sh — motdang-build's half of the walk. importers/server_link.sh
# is the laptop's half: it sends the source to /srv/mot-dang.in and writes a
# new id into .handoff. Every five minutes (systemd motdang-walk.timer, user
# nan) this looks for an id it has not tried, copies the staging folder into
# /srv/mot-dang, and runs importers/publish_steps.sh — the same build, gates
# and deploy the laptop ran.
#
#   /srv/state/attempted   last hand-off tried     /srv/state/published  last one live
#   /srv/state/walk-rest   the laptop's cache/walk-rest, sent each round
#   ~/motdang-server-walk.log, /srv/state/walk.jsonl
set -u
export PATH=/usr/local/bin:/usr/bin:/bin
REPO=/srv/mot-dang
STAGE=/srv/mot-dang.in
SSTATE=/srv/state
LOG="$HOME/motdang-server-walk.log"
TOWER=/nonexistent
export MD_JOBS=${MD_JOBS:-1}
# 360 minutes: a full build was 170 minutes of one Mac core on 2026-09-10, and
# this host has two shared cores and 3.8 GB. The limit is there to end a hung
# build; at 180 it also ended slow healthy ones, every round from 2026-10-05.
export MD_BUILD_TIMEOUT=${MD_BUILD_TIMEOUT:-360m}
export MD_PROFILE=${MD_PROFILE:-$SSTATE/build-profile.json}   # build_sampler.py
export MD_LAYER_STATE=${MD_LAYER_STATE:-$SSTATE/layers.json}   # layers.py: each layer's time, outputs, failures
export MD_HOLD_BACK=${MD_HOLD_BACK:-$SSTATE/held-back.txt}     # tools/holdback.py: pages held at their live version
MISSING_CEILING=500   # 2026-10-05: an 11-hour-old source would have deleted 1,977 live files
export MD_DEFERRED=$SSTATE/deferred.txt   # deploy.py: deletions a publish put off
export MD_DIRECT_UPLOADS=$SSTATE/direct-uploads.tsv   # deploy.py --files on the laptop: live files this round keeps
export MD_PLACE_PUBLISHED=$SSTATE/place-published.json   # publish/placeround.py: the weekly place round
export MD_PLACE_FULL_NOW=$SSTATE/place-full-now          # touch it for a full place round next publish
# Announced cuts that landed (publish/safety.py, 2b) stay used up across hand-offs.
export MD_EXPECT_DONE=$SSTATE/expected-done.txt
# Which place pages a round draws (incremental.py) and what the last publish left live
# (publish/incpublish.py): outside the working tree, which each hand-off replaces.
export MD_INCR_STATE=$SSTATE/incremental-state.json
export MD_INCR_LAST=$SSTATE/incremental-last.json
export MD_INCR_STAMPS=$SSTATE/incremental-stamps.json
export MD_INCR_FULL_NOW=$SSTATE/full-now                # touch it for a full draw of every place page next build
export MD_PUBLISHED_MANIFEST=$SSTATE/published-manifest.json
# Pages drawn for a changed record go up before the gates when this file exists (publish/early.py):
#   ssh nan@motdang-server touch /srv/state/early-places         (off unless Nan says)
export MD_EARLY_FLAG=$SSTATE/early-places
# One file turns the incremental draw and the incremental publish off together:
#   ssh nan@motdang-server touch /srv/state/incremental-off      (rm it to turn them on)
[[ -e "$SSTATE/incremental-off" ]] && export MD_INCREMENTAL=0 MD_INCREMENTAL_PUBLISH=0

mkdir -p "$SSTATE"
if [[ -f "$LOG" ]] && (( $(stat -c %s "$LOG") > 5242880 )); then mv -f "$LOG" "$LOG.1"; fi
exec >>"$LOG" 2>&1
exec 9>"$SSTATE/walk.lock"; flock -n 9 || exit 0

say() { print -- "$(date '+%F %T')  $*" }
note() {
  python3 - "$1" "$2" <<'PY' >>"$SSTATE/walk.jsonl" 2>/dev/null
import json, sys, time
print(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "verdict": sys.argv[1],
                  "detail": sys.argv[2]}, ensure_ascii=False))
PY
}
stand_down() { say "standing down — $1"; note "stood-down" "$1"; exit 0 }
# A layer that failed did not stop the build (layers.py); its pages are a round old.
layer_note() {
  local f; f=$(python3 -c 'import json,sys; print(", ".join(json.load(open(sys.argv[1])).get("failed", [])))' "$MD_LAYER_STATE" 2>/dev/null)
  [[ -n "$f" ]] && { say "⚠️  layers that failed, their last good pages kept: $f"; note "layers-failed" "$f" }
  return 0
}
# A page or site a gate failed on was held at its live version (tools/holdback.py).
# Deletions this publish put off (publish/deploy.py --defer-deletions, --no-delete).
deferred_note() {
  local n why
  [[ -s "$MD_DEFERRED" ]] || return 0
  n=$(wc -l < "$MD_DEFERRED")
  why=$(cat "$SSTATE/.deferred-why" 2>/dev/null)
  say "$n deletion(s) deferred${why:+ — $why}; the list is $MD_DEFERRED"
  note "deletions-deferred" "$n live files kept${why:+: $why}"
}
held_note() {
  local h; h=$(python3 tools/holdback.py line 2>/dev/null)
  [[ -n "$h" ]] && { say "⚠️  held back at their live version: $h"; note "held-back" "$h" }
  return 0
}
remember_gate_fail() { say "the gate failed on hand-off $HAND; the next hand-off builds again" }

HAND=$(cat "$STAGE/.handoff" 2>/dev/null)
[[ -z "$HAND" || "$HAND" == "$(cat $SSTATE/attempted 2>/dev/null)" ]] && exit 0

# The laptop's rest holds this side too. A timestamp rests until that moment.
if [[ -f "$SSTATE/walk-rest" ]]; then
  UNTIL=$(head -1 "$SSTATE/walk-rest" | tr -d '[:space:]')
  [[ -z "$UNTIL" ]] && exit 0
  python3 - "$UNTIL" <<'PY' || exit 0
import sys, datetime
s = sys.argv[1]
s = s[:-1] + "+00:00" if s[-1:] in "Zz" else s
try:
    u = datetime.datetime.fromisoformat(s)
    u = u if u.tzinfo else u.astimezone()
    sys.exit(0 if datetime.datetime.now(datetime.timezone.utc) >= u else 1)
except Exception:
    sys.exit(1)
PY
fi

exec 8>"$SSTATE/docs.lock"; flock 8
say "== hand-off $HAND"
# A Mapillary harvest (~/mly_tiles.py), when one is running, waits while the round
# builds: 2026-10-11 the build and the harvest together had 2 GB of the 4 GB box in swap.
pkill -STOP -u "$(id -un)" -f mly_tiles.py 2>/dev/null
trap 'pkill -CONT -u "$(id -un)" -f mly_tiles.py 2>/dev/null' EXIT
# A data file the laptop sent while something was still writing it does not
# parse; the working tree keeps last round's copy of it (tools/datacheck.py).
HELD=()
for f in ${(f)"$(flock "$SSTATE/stage.lock" python3 "$STAGE/tools/datacheck.py" "$STAGE" "$REPO" 2>/dev/null)"}; do
  HELD+=(--exclude "/$f"); say "  held back, does not parse: $f"
done
(( ${#HELD} )) && note "data-held-back" "$(( ${#HELD} / 2 )) file(s) that do not parse"
flock "$SSTATE/stage.lock" rsync -a --delete --exclude /docs/ --exclude /docs.next/ \
  --exclude /docs.prev/ --exclude /cache/build.lock --exclude /.handoff --exclude /.handoff-at \
  --exclude /cache/place-pages-kept.json \
  "${HELD[@]}" "$STAGE/" "$REPO/" \
  || { say "copy from staging FAILED"; note "failed" "staging copy"; exit 1 }
print -- "$HAND" > "$SSTATE/attempted"
# When the laptop began sending this source. deploy.py keeps live files
# uploaded after it: this build cannot know them (publish/safety.py,
# uploaded_since — Lanna Craft, 2026-10-10). A hand-off from before
# .handoff-at existed reads its id's wall clock 14 h early, the earliest that
# clock can mean in any zone.
MD_SOURCE_AT=$(cat "$STAGE/.handoff-at" 2>/dev/null)
if [[ -z "$MD_SOURCE_AT" ]]; then
  MD_SOURCE_AT=$(date -u -d "$(print -- "${HAND%%-*}" | sed -E 's/(....)(..)(..)T(..)(..)(..)/\1-\2-\3 \4:\5:\6/') UTC - 14 hours" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)
fi
export MD_SOURCE_AT
say "source taken ${MD_SOURCE_AT:-at an unknown time}"
cd "$REPO" || exit 1

# The laptop sent HEAD's code beside the folder (importers/build_code.py): it
# replaces the folder's code, so a file a session is still editing is not
# built. build_code.py itself is taken from the tar, not the folder.
if [[ -f cache/build-code.tar ]]; then
  tar -xOf cache/build-code.tar importers/build_code.py > "$SSTATE/build_code.py" \
    && python3 "$SSTATE/build_code.py" overlay cache/build-code.tar "$REPO" \
    || { say "could not put the committed code in place"; note "failed" "code overlay"; exit 1 }
  say "code from commit $(git get-tar-commit-id < cache/build-code.tar | cut -c1-10)"
fi
TODAY=$(date +%F)

# A cut Nan has said yes to can delete more live files than the two ceilings
# allow, once: $SSTATE/prune-once holds "<bound> <last day> <why>". It raises
# MISSING_CEILING and passes --prune-up-to for the next publish of new code,
# and goes when that publish succeeds. First use 2026-10-11, the per-tag GeoJSON.
PRUNE_ARGS=()
if [[ -r "$SSTATE/prune-once" ]]; then
  read -r PRUNE_N PRUNE_UNTIL PRUNE_WHY < "$SSTATE/prune-once" || true
  if [[ "${PRUNE_N:-}" == <-> && -n "${PRUNE_UNTIL:-}" && ! "$TODAY" > "$PRUNE_UNTIL" ]]; then
    MISSING_CEILING=$PRUNE_N
    PRUNE_ARGS=(--prune-up-to "$PRUNE_N")
    say "one-time deletion bound $PRUNE_N until $PRUNE_UNTIL: ${PRUNE_WHY:-}"
  fi
fi

# Live is what the bucket holds, listed at publish time by the same call
# deploy.py's deletion preview makes (publish/safety.py). Until 2026-10-10 the
# list came from the laptop's own docs/, which stops matching the bucket once
# the laptop no longer builds: that day it carried 1,340 place pages the live
# site answers 404 for, enough to refuse any build.
pre_deploy() {
  local rc out why
  # A publish that compares docs/ with the manifest of the last one has nothing to list;
  # deploy.py puts the keys that left docs/ through the same deletion check and the same
  # ceiling (MD_DELETE_CEILING). MD_INCREMENTAL_PUBLISH=0 lists the bucket as before.
  # The ceiling on unannounced deletions below applies to that publish as it did here.
  export MD_DELETE_CEILING=$MISSING_CEILING
  if [[ "${MD_INCREMENTAL_PUBLISH:-1}" != 0 && -s "$MD_PUBLISHED_MANIFEST" ]]; then
    say "bucket not listed: the manifest of the last publish is used"
    rm -f "$SSTATE/.deferred-why"
    return 0
  fi
  # Deletions an announcement covers (publish/expected.json) are held to its
  # number, ±10%; MISSING_CEILING counts the rest (publish/safety.py, 2b).
  out=$(python3 - "$SSTATE/missing.txt" "$MISSING_CEILING" <<'PY'
import sys
from collections import Counter
sys.path.insert(0, "publish")
sys.path.insert(0, "tools")
try:
    import deploy, safety, holdback, placeround
    gone, added = safety.diff_preview("R2:%s" % deploy.BUCKET,
                                      deploy.rclone_env(deploy.creds()), deploy.run)
    gone = [k for k in gone if not holdback.held(k)]   # held: left as it is
    if placeround.plan():                               # place deletions wait for the weekly round
        gone = [k for k in gone if not placeround.covered(k)]
except BaseException as e:
    print("bucket listing failed: %r" % (e,))
    sys.exit(2)
with open(sys.argv[1], "w") as fh:
    fh.write("".join(k + "\n" for k in gone))
ceiling = int(sys.argv[2])
announced, said = safety.load_expected()
rest, groups = safety.expected_split(gone, announced)
for line in said + safety.additions_lines(added, announced):
    print(line.strip())
print("%d live file(s) not in this build, %d of them announced"
      % (len(gone), len(gone) - len(rest)))
for line in safety.expected_lines(groups):
    print(line.strip())
over = [g for g in groups if g["found"] > g["hi"]]
if over:
    print("FAIL more than announced went: %s"
          % ", ".join("%s %d of %d" % (g["pattern"], g["found"], g["expected"]) for g in over))
    sys.exit(3)
if len(rest) > ceiling:
    for d, n in Counter("/".join(k.split("/")[:2]) for k in rest).most_common(8):
        print("  %6d %s" % (n, d))
    print("FAIL %d unannounced live files missing from the build, over %d" % (len(rest), ceiling))
    sys.exit(3)
PY
)
  rc=$?
  print -r -- "$out" | grep -v '^FAIL ' | while IFS= read -r l; do say "$l"; done
  if (( rc == 2 )); then
    say "REFUSING — could not list the live bucket to compare against"
    note "failed" "bucket listing"
    return 1
  elif (( rc != 0 )); then
    # The deletions wait; new and changed files still go up (Nan, 2026-10-11).
    why=$(print -r -- "$out" | sed -n 's/^FAIL //p' | tail -1)
    say "DELETIONS DEFERRED — ${why:-the missing-files check failed}; the list is $SSTATE/missing.txt"
    print -r -- "${why:-missing-files check}" > "$SSTATE/.deferred-why"
    PRUNE_ARGS+=(--no-delete)
  fi
}

# --- one try per hand-off ----------------------------------------------------
# Until 2026-10-11 a failed hand-off was built a second time with the code of
# the last publish and its own data. That second build published 0 times in 14
# (the old code met the new assets and failed its own gates) and held the server
# for another hour each time. A failed hand-off now ends the round, and the
# next hand-off starts sooner.

# The publish runs in a subshell: publish_steps.sh exits on any failure, and
# this side has to see it to write the verdict.
publish_once() {
  rm -f "$SSTATE/.publish-ok" "$SSTATE/.deferred-why"
  ( source importers/publish_steps.sh && print -- "$COUNT" > "$SSTATE/.publish-ok" )
  [[ -s "$SSTATE/.publish-ok" ]]
}

if publish_once; then
  COUNT=$(cat "$SSTATE/.publish-ok")
  print -- "$HAND" > "$SSTATE/published"
  (( ${#PRUNE_ARGS} )) && rm -f "$SSTATE/prune-once"
  say "== published $HAND — $COUNT files"
  note "published" "$HAND $COUNT files"
  deferred_note
  layer_note
  held_note
  exit 0
fi

exit 1
