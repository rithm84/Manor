#!/usr/bin/env bash
# Turns on Sign in with Apple for a Supabase project, or renews its client secret.
#
#   scripts/apple-sign-in.sh staging|production
#
# Apple's client secret is a JWT signed with the Sign in with Apple key and expires after 180 days, so run this again
# before the date it prints (also kept in ~/.config/manor/apple-secret-<project>.expires). The secret goes straight to
# Supabase's Auth settings and never reaches the screen.
set -euo pipefail
TEAM_ID="2588U5J9Z7"
SERVICES_ID="app.manor.signin"
KEY_FILE="$(ls "$HOME"/.config/manor/AuthKey_*.p8 2>/dev/null | head -1 || true)"
case "${1:-}" in
  staging) REF="cysdooljdslgvqrahymm" ;;
  production) REF="pxdxqueevzttpmxjsqes" ;;
  *) echo "usage: $0 staging|production" >&2; exit 2 ;;
esac
[[ -n "$KEY_FILE" ]] || { echo "No Sign in with Apple key in ~/.config/manor (AuthKey_<id>.p8)" >&2; exit 1; }
KEY_ID="$(basename "$KEY_FILE" .p8)"; KEY_ID="${KEY_ID#AuthKey_}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -f "$ROOT/.env.local" ]]; then set -a; source "$ROOT/.env.local"; set +a; fi
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"

SECRET="$(swift "$ROOT/macos/scripts/apple-client-secret.swift" "$KEY_FILE" "$KEY_ID" "$TEAM_ID" "$SERVICES_ID")"
BODY="$(SECRET="$SECRET" SERVICES_ID="$SERVICES_ID" python3 -I -c '
import json, os
print(json.dumps({"external_apple_enabled": True, "external_apple_client_id": os.environ["SERVICES_ID"],
                  "external_apple_secret": os.environ["SECRET"]}))')"
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' --data-binary @- <<<"$BODY")"
[[ "$STATUS" == 200 ]] || { echo "Supabase refused the Apple settings (HTTP $STATUS)" >&2; exit 1; }
EXPIRES="$(date -v+180d +%Y-%m-%d)"
echo "$EXPIRES" > "$HOME/.config/manor/apple-secret-$1.expires"
echo "Sign in with Apple is on for $1. Renew the client secret before $EXPIRES."
