# server_link.sh — the laptop's half of building on motdang-build.
# Sourced by standing_walk.sh; acts only while cache/build-on-server exists.
#
#   hand_to_server       source → /srv/mot-dang.in, then a new id in .handoff and,
#                        in .handoff-at, when the copy began (UTC): the publish
#                        leaves alone live files uploaded after it
#   push_rest            cache/walk-rest mirrored to /srv/state/walk-rest
#   replay_direct_uploads  ledger lines a direct upload could not send, sent now
#   (no copy-back: the server's docs/ stays on the server, her word 2026-10-10)
#
# The server copies the staging folder into its working tree only between
# builds, under the same flock as the hand-off, so a build never reads a
# half-sent tree. Its side is importers/server_walk.sh.

SERVER="nan@motdang-server"
SRV=/srv/mot-dang
STAGE=/srv/mot-dang.in
SSTATE=/srv/state
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=20)
# An idle limit on every transfer. On 2026-10-10 the copy-back stalled on one
# file with nothing arriving for minutes; macOS's rsync (openrsync) does not give
# up on its own, so the walk round never reached its import or hand-off, and the
# shared docs.lock it held on the server would have kept the next build waiting.
RSYNC_IDLE=--timeout=300

# _incoming/enrich/ and the path enrich.py reads (cache/enrich_archive.txt) stay on this Mac.
HANDOFF_EXCLUDES=(--exclude /docs/ --exclude /docs.next/ --exclude /docs.prev/
  --exclude __pycache__/ --exclude '*.pyc' --exclude /cache/build.lock
  --exclude /cache/walk-rest --exclude /cache/place-inputs.json --exclude /_incoming/enrich/ --exclude /cache/enrich_archive.txt --exclude /.claude/
  --exclude .DS_Store
  # Mapillary street photos are harvested on the server, into the staging
  # folder, and held there only (her word 2026-10-11: rented storage, not the
  # Mac). Excluded, so this mirror neither sends nor deletes them; her own
  # photos in assets/streetphotos/own/ still travel.
  --exclude '/assets/streetphotos/*.jpg' --exclude /data/street_photos.json
  # Street view (harvest_streetview.py, her pick (a) 2026-10-13): same place, same reason.
  --exclude /assets/streetphotos/sv/ --exclude /data/streetview/ --exclude /cache/streetview-harvest.json
  # Importer caches and old logs that no server build read from 2026-10-05 to
  # 10-11 (atime on /srv): 3.6 GB in 19k files a round. The Mac keeps them;
  # the server keeps its last copy. Nan, 2026-10-11: cut what weighs and adds little.
  --exclude /cache/cmhy/ --exclude /cache/roads-prov/ --exclude /cache/satellite/
  --exclude /cache/weedth/ --exclude /cache/overture/ --exclude /cache/terrain/
  --exclude /cache/swag/ --exclude /cache/naturalearth/ --exclude /cache/bigsize/
  --exclude /cache/paper/ --exclude /cache/flights-research/ --exclude /cache/admin/
  --exclude /cache/hotel_amenities/ --exclude /cache/scripture/ --exclude /cache/obec/
  --exclude /cache/datagoth/ --exclude /cache/rollback/ --exclude /cache/commons_area/
  --exclude /cache/lens/ --exclude /cache/foursquare/ --exclude /cache/thdata/
  --exclude /cache/care/ --exclude /cache/traffic/ --exclude /cache/ot/
  --exclude /cache/buildings/ --exclude /cache/buildings-cr/
  --exclude /cache/fda_register/ --exclude /cache/hotel_monthly/ --exclude /cache/nhso/
  --exclude /cache/inat/ --exclude /cache/citizeninfo/
  --exclude /_incoming/vivo-2026-10-02 --exclude /_incoming/pano
  --exclude /_incoming/passed --exclude /_incoming/canonical-backup-2026-09-05
  --exclude /_incoming/nano-banana-2026-10-05
  --exclude /_incoming/provenance-backfill-2026-09-05.json
  --exclude /_incoming/osm-giveback-2026-09-05.json
  --exclude '/cache/*.log' --exclude '/cache/*.bak*' --exclude '/cache/*.before*')

hand_to_server() {
  local id at; id="$(date +%Y%m%dT%H%M%S)-$$"; at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  "${SSH[@]}" "$SERVER" "mkdir -p $STAGE $SSTATE" || return 1
  # The roster the sites page reads (sites_layer.py: ../index/data/fleet.json); /srv/index had stopped at 74 of 80 sites.
  [[ -f ../index/data/fleet.json ]] && rsync -a -e "${SSH[*]}" ../index/data/fleet.json "$SERVER:/srv/index/data/fleet.json" 2>/dev/null
  # What is live, as far as this Mac knows: the server checks its build against it.
  (cd docs && find . -type f ! -path './tiles/*' | sed 's#^\./##' | sort) | gzip > cache/docs-list.txt.gz
  # The code of HEAD rides beside the folder; the server puts it over the
  # folder's code (importers/build_code.py). Without the flag the folder's own
  # code is built, as before.
  if [[ -f cache/build-from-commit ]]; then
    local commit left
    commit=$(python3 importers/build_code.py pack cache/build-code.tar) \
      || { say "could not pack the committed code"; return 1 }
    left=$(python3 importers/build_code.py left-out 2>/dev/null)
    say "code from commit ${commit:0:10}"
    [[ "$commit" == "$(git rev-parse HEAD)" ]] \
      || { say "  ⚠️  HEAD $(git rev-parse --short=10 HEAD) does not compile (tools/codecheck.py HEAD); sent the newest commit that does"
           note "code-held-back" "HEAD $(git rev-parse --short=10 HEAD) does not compile" }
    if [[ -n "$left" ]]; then
      say "  not committed, so not built ($(print -- "$left" | grep -c .)):"
      print -- "$left" | head -12 | while read -r l; do say "    $l"; done
    fi
  else
    rm -f cache/build-code.tar
  fi
  rsync -a --delete --partial $RSYNC_IDLE "${HANDOFF_EXCLUDES[@]}" -e "${SSH[*]}" \
    --rsync-path="flock $SSTATE/stage.lock rsync" ./ "$SERVER:$STAGE/" || return 1
  "${SSH[@]}" "$SERVER" "flock $SSTATE/stage.lock sh -c 'echo $at > $STAGE/.handoff-at && echo $id > $STAGE/.handoff'" || return 1
  say "sent to the server as $id"
}

# Ledger lines deploy.py could not send over ssh when it uploaded (publish/deploy.py
# record_direct_uploads keeps them in cache/direct-uploads.pending.tsv). The server
# reads its ledger when a round publishes, so a line sent within one walk reaches
# the round that is building now.
replay_direct_uploads() {
  [[ -f cache/build-on-server && -s cache/direct-uploads.pending.tsv ]] || return 0
  local f=cache/direct-uploads.pending.tsv
  mv -f "$f" "$f.sending" || return 0
  if "${SSH[@]}" "$SERVER" "mkdir -p $SSTATE && cat >> $SSTATE/direct-uploads.tsv" < "$f.sending" 2>/dev/null; then
    say "sent $(wc -l < "$f.sending" | tr -d ' ') direct-upload line(s) to the server's ledger"
    rm -f "$f.sending"
  else
    cat "$f.sending" >> "$f" && rm -f "$f.sending"
    say "⚠️  the server's ledger of direct uploads did not answer; the lines wait for the next walk"
  fi
}

push_rest() {
  [[ -f cache/build-on-server ]] || return 0
  if [[ -f "$REST" ]]; then
    rsync -a $RSYNC_IDLE -e "${SSH[*]}" "$REST" "$SERVER:$SSTATE/walk-rest" 2>/dev/null \
      || say "⚠️  could not tell the server the walk is resting"
  else
    "${SSH[@]}" "$SERVER" "rm -f $SSTATE/walk-rest" 2>/dev/null || true
  fi
}

