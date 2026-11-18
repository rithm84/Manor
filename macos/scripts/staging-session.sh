#!/usr/bin/env bash
# Signs the installed "Manor Staging" app in as a synthetic staging user, without Google.
#
#   scripts/staging-session.sh [email]          (PRINT_LINK=1 prints the link instead of opening it)
#
# Creates the auth user directly in the staging database when it does not exist yet (the signup gate's hook
# only guards Auth API sign-ups), mints a session from a magic link with the service key, and hands it to the
# app as a manor-staging:// sign-in link. Staging only; never point this at production.
set -euo pipefail
REF="cysdooljdslgvqrahymm"
EMAIL="${1:-manor-native-test@example.com}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Credentials come from the environment (a cloud session) or the repo-root .env.local (a laptop).
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -f "$ROOT/.env.local" ]]; then set -a; source "$ROOT/.env.local"; set +a; fi
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"
API="https://api.supabase.com/v1/projects/$REF"
KEYS="$(curl -fsS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "$API/api-keys?reveal=true")"
ANON="$(python3 -I -c 'import json,sys; k=json.load(sys.stdin); print(next(x["api_key"] for x in k if x["name"]=="anon"))' <<<"$KEYS")"
SERVICE="$(python3 -I -c 'import json,sys; k=json.load(sys.stdin); print(next(x["api_key"] for x in k if x["name"]=="service_role"))' <<<"$KEYS")"
SQL=$(cat <<SQL
do \$\$
declare uid uuid;
begin
  select id into uid from auth.users where email = '$EMAIL';
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', '$EMAIL', now(),
      '{"provider":"google","providers":["google"]}', '{"full_name":"Native Test"}', now(), now());
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
    values (gen_random_uuid(), uid, uid::text, 'google', jsonb_build_object('sub', uid::text, 'email', '$EMAIL'), now(), now(), now());
  end if;
  -- Auth reads these as strings; NULL makes it fail with "Database error finding user".
  update auth.users set confirmation_token = coalesce(confirmation_token, ''), recovery_token = coalesce(recovery_token, ''),
    email_change_token_new = coalesce(email_change_token_new, ''), email_change = coalesce(email_change, ''),
    email_change_token_current = coalesce(email_change_token_current, ''), phone_change = coalesce(phone_change, ''),
    phone_change_token = coalesce(phone_change_token, ''), reauthentication_token = coalesce(reauthentication_token, '')
  where id = uid;
end \$\$;
SQL
)
curl -fsS -X POST -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  "$API/database/query" -d "$(python3 -I -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' <<<"$SQL")" >/dev/null
LINK="$(curl -fsS -X POST "https://$REF.supabase.co/auth/v1/admin/generate_link" -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
  -H "Content-Type: application/json" -d "{\"type\":\"magiclink\",\"email\":\"$EMAIL\"}")"
HASH="$(python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(d.get("hashed_token") or d["properties"]["hashed_token"])' <<<"$LINK")"
SESSION="$(curl -fsS -X POST "https://$REF.supabase.co/auth/v1/verify" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"type\":\"magiclink\",\"token_hash\":\"$HASH\"}")"
FRAGMENT="$(python3 -I -c 'import json,sys,urllib.parse; s=json.load(sys.stdin); print(urllib.parse.urlencode({k:s[k] for k in ("access_token","refresh_token","expires_in","token_type")}))' <<<"$SESSION")"
if [[ -n "${PRINT_LINK:-}" ]]; then
  # For a build on another Mac: print the one-time sign-in link instead of opening it here.
  echo "manor-staging://auth/callback#$FRAGMENT"
  exit 0
fi
open -a "${MANOR_APP:-$(cd "$(dirname "$0")/.." && pwd)/build/Manor Staging.app}" "manor-staging://auth/callback#$FRAGMENT"
echo "Signed the staging app in as $EMAIL"
