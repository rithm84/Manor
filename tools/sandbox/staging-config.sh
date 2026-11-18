#!/usr/bin/env bash
# Writes macos/config/staging.env (ignored by git) from the staging project's publishable key, using the
# Supabase Management API token in the environment or .env.local. Leaves an existing file alone.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/macos/config/staging.env"
REF="cysdooljdslgvqrahymm"
if [[ -f "$OUT" && "${FORCE:-0}" != 1 ]]; then echo "$OUT exists"; exit 0; fi
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -f "$ROOT/.env.local" ]]; then set -a; source "$ROOT/.env.local"; set +a; fi
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"
KEYS="$(curl -fsS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "https://api.supabase.com/v1/projects/$REF/api-keys?reveal=true")"
KEY="$(python3 -I -c 'import json,sys; k=json.load(sys.stdin); p=[x for x in k if x.get("type")=="publishable"]; print((p[0] if p else next(x for x in k if x["name"]=="anon"))["api_key"])' <<<"$KEYS")"
umask 077
printf 'SUPABASE_URL=https://%s.supabase.co\nSUPABASE_KEY=%s\n' "$REF" "$KEY" > "$OUT"
echo "wrote $OUT"
