#!/bin/zsh
# Switch on Sign in with LINE (publish/accounts.js, C230 c, Nan 2026-10-20).
# Reads the LINE Login channel's ID and secret from the token store
# (~/.claude/bin/token: LINE_LOGIN_ID, LINE_LOGIN_SECRET) and sets them as the
# Worker's secrets; /api/me then says line: true and My page shows the button.
#   zsh tools/line_login_on.sh
set -e
cd "${0:A:h}/../publish"
ID=$(~/.claude/bin/token get LINE_LOGIN_ID) || { echo "no LINE_LOGIN_ID in the token store"; exit 1; }
SECRET=$(~/.claude/bin/token get LINE_LOGIN_SECRET) || { echo "no LINE_LOGIN_SECRET in the token store"; exit 1; }
[[ "$ID" == <-> ]] || { echo "LINE_LOGIN_ID should be the channel's number"; exit 1; }
eval "$(~/.claude/bin/cfenv --oauth)"
print -rn -- "$ID" | npx wrangler secret put LINE_LOGIN_ID >/dev/null
print -rn -- "$SECRET" | npx wrangler secret put LINE_LOGIN_SECRET >/dev/null
sleep 5
curl -s https://motdang.net/api/me; echo
