#!/usr/bin/env bash
# Attaches an Apple ID to an existing Manor account, whatever email either one uses, and optionally removes the
# account's Google sign-in afterwards.
#
#   scripts/link-apple.sh staging|production <account-id>              link an Apple ID (opens Apple's page)
#   scripts/link-apple.sh staging|production <account-id> --drop-google  remove Google once Apple is linked
#
# Linking needs a session for the account, so this mints one with the service key, turns on Supabase's manual
# identity linking for the length of the run, and opens Apple's sign-in page in the browser. The account owner signs
# in with Apple there; Supabase attaches that Apple ID to the account. Keys and tokens never reach the screen.
set -euo pipefail
case "${1:-}" in
  staging) REF="cysdooljdslgvqrahymm"; CALLBACK="manor-staging://auth/callback" ;;
  production) REF="pxdxqueevzttpmxjsqes"; CALLBACK="manor://auth/callback" ;;
  *) echo "usage: $0 staging|production <account-id> [--drop-google]" >&2; exit 2 ;;
esac
ACCOUNT="${2:?usage: $0 staging|production <account-id> [--drop-google]}"
[[ "$ACCOUNT" =~ ^[0-9a-f-]{36}$ ]] || { echo "The account id must be a UUID" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -f "$ROOT/.env.local" ]]; then set -a; source "$ROOT/.env.local"; set +a; fi
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"
API="https://api.supabase.com/v1/projects/$REF"
AUTH="https://$REF.supabase.co/auth/v1"
SERVICE="$(curl -fsS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "$API/api-keys?reveal=true" \
  | python3 -I -c 'import json,sys; print(next(k["api_key"] for k in json.load(sys.stdin) if k["name"]=="service_role"))')"
admin() { curl -fsS -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H 'Content-Type: application/json' "$@"; }
providers() { admin "$AUTH/admin/users/$ACCOUNT" | python3 -I -c 'import json,sys; print(" ".join(sorted(i["provider"] for i in json.load(sys.stdin).get("identities") or [])))'; }
sql() { python3 -I -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' \
  | curl -fsS -X POST "$API/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' --data-binary @-; }

echo "Sign-in methods now: $(providers)"

if [[ "${3:-}" == "--drop-google" ]]; then
  [[ " $(providers) " == *" apple "* ]] || { echo "Link an Apple ID first; the account would have no way to sign in." >&2; exit 1; }
  sql <<<"delete from auth.identities where user_id = '$ACCOUNT' and provider = 'google'" >/dev/null
  echo "Removed Google. Sign-in methods now: $(providers)"
  exit 0
fi

[[ " $(providers) " == *" apple "* ]] && { echo "An Apple ID is already linked."; exit 0; }

linking() { curl -fsS -o /dev/null -X PATCH "$API/config/auth" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' -d "{\"security_manual_linking_enabled\": $1}"; }
ACCESS=""
finish() {
  linking false || echo "Turn manual linking off in Supabase's Auth settings." >&2
  [[ -n "$ACCESS" ]] && curl -fsS -o /dev/null -X POST "$AUTH/logout?scope=local" -H "apikey: $SERVICE" -H "Authorization: Bearer $ACCESS" || true
}
trap finish EXIT
linking true

# A one-time session for the account, from a magic link verified on the spot.
EMAIL="$(admin "$AUTH/admin/users/$ACCOUNT" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["email"])')"
HASH="$(EMAIL="$EMAIL" python3 -I -c 'import json,os; print(json.dumps({"type":"magiclink","email":os.environ["EMAIL"]}))' \
  | admin -X POST "$AUTH/admin/generate_link" --data-binary @- | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["hashed_token"])')"
ACCESS="$(curl -fsS -X POST "$AUTH/verify" -H "apikey: $SERVICE" -H 'Content-Type: application/json' \
  -d "{\"type\":\"magiclink\",\"token_hash\":\"$HASH\"}" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"

# Auth restarts after a settings change, so linking can take a minute to switch on.
URL=""
for _ in $(seq 1 24); do
  URL="$(curl -fsS -G "$AUTH/user/identities/authorize" -H "apikey: $SERVICE" -H "Authorization: Bearer $ACCESS" \
    --data-urlencode provider=apple --data-urlencode scopes="name email" --data-urlencode redirect_to="$CALLBACK" \
    --data-urlencode skip_http_redirect=true 2>/dev/null | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["url"])' 2>/dev/null || true)"
  [[ -n "$URL" ]] && break
  sleep 5
done
[[ -n "$URL" ]] || { echo "Supabase didn't start the Apple link." >&2; exit 1; }
open "$URL"
echo "Apple's sign-in page is open in your browser. Sign in with the Apple ID to link (either email choice works)."
for _ in $(seq 1 120); do
  sleep 5
  if [[ " $(providers) " == *" apple "* ]]; then echo "Linked. Sign-in methods now: $(providers)"; exit 0; fi
done
echo "No Apple ID was linked within 10 minutes." >&2
exit 1
