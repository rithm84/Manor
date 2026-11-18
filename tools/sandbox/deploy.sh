#!/usr/bin/env bash
# Uploads macos/ (no build products, no production config) to the Daytona sandbox, builds Manor Staging
# there, relaunches it, and signs it in as the showroom account with a link minted from this machine.
#
#   tools/sandbox/deploy.sh [--no-launch]       SIGN_IN=0 skips the sign-in, EMAIL picks the account
#   ALFRED_NOTES_DEMO=1 launches with Alfred's scripted demo writer (debug builds), for review without provider keys.
#
# Needs: python with `daytona==2.0.0a13` (PYTHON overrides the interpreter), DAYTONA_API_KEY, and for
# sign-in SUPABASE_ACCESS_TOKEN (environment or .env.local). Staging only.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PY="${PYTHON:-python3}"
DT=("$PY" "$HERE/dt.py")
EMAIL="${EMAIL:-showroom@example.invalid}"
"$ROOT/tools/sandbox/staging-config.sh" >/dev/null
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cd "$ROOT/macos"
COPYFILE_DISABLE=1 tar -czf "$TMP/manor-src.tgz" --exclude='.build*' --exclude='build' --exclude='config/production.env' \
  Package.swift Package.resolved VERSION Sources Tests Vendor Resources scripts config
"${DT[@]}" put "$TMP/manor-src.tgz" /Users/lume/manor-src.tgz >/dev/null
# Alfred's Prep mode keeps Manor running when asked to quit, so a sandbox app that stays up is force-quit:
# otherwise the old build would keep running and the test would exercise stale code.
"${DT[@]}" exec "osascript -e 'quit app \"Manor Staging\"' 2>/dev/null; sleep 2; pkill -9 -f 'Manor Staging.app/Contents/MacOS' 2>/dev/null; rm -rf ~/manor/Sources ~/manor/Tests; mkdir -p ~/manor && cd ~/manor && tar -xzf ~/manor-src.tgz && scripts/build-app.sh staging --debug > build.log 2>&1; echo build-exit \$?; grep -E 'error:' build.log | sort -u | head -15" 1800
if [[ "${1:-}" != "--no-launch" ]]; then
  OPEN_ENV=""; [[ -n "${ALFRED_NOTES_DEMO:-}" ]] && OPEN_ENV="--env ALFRED_NOTES_DEMO=1"
  "${DT[@]}" exec "open $OPEN_ENV ~/manor/build/'Manor Staging.app'; sleep 4" 60 >/dev/null
  if [[ "${SIGN_IN:-1}" == 1 ]]; then
    LINK=$(PRINT_LINK=1 "$ROOT/macos/scripts/staging-session.sh" "$EMAIL" | tail -1)
    "${DT[@]}" exec "open -a ~/manor/build/'Manor Staging.app' '$LINK'; sleep 8" 60 >/dev/null
  fi
  echo launched
fi
