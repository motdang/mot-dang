#!/bin/zsh
# judged_daily.sh — 07:45 daily (launchd com.nanobotco.find-judged). Pulls what
# readers sent from the good / not-it line on /find, replays each bad one against
# live search, and writes _incoming/find-judged/report.txt. One row per run in
# ~/.claude/state/find-judged.tsv. Needs the Mac's wrangler sign-in for D1.
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
cd "${0:A:h}/.." || exit 1
TSV="$HOME/.claude/state/find-judged.tsv"
[[ -f "$TSV" ]] || printf 'date\tresult\n' > "$TSV"
out=$(/opt/homebrew/bin/python3.13 -u fleetsearch/judged.py 2>&1); rc=$?
sum=$(print -r -- "$out" | grep -E '^(pulled|sends|cases)' | tr '\n' ' ' | cut -c1-200)
if (( rc == 0 )); then res="ok: $sum"; else res="failed: $(print -r -- "$out" | tail -1 | cut -c1-160)"; fi
printf '%s\t%s\n' "$(date '+%F %H:%M')" "$res" >> "$TSV"
print -r -- "$out" | tail -8
exit $rc
