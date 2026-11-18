#!/usr/bin/env bash
# Publishes a production release of Manor and installs it on this Mac in place of the installed Manor.
#
#   macos/scripts/release-and-install.sh <version> [notes.md]
#
# Checks everything the release needs before it starts: the Manor Signing certificate, the update key, a signed-in
# GitHub CLI, and macos/config/production.env (written from the production project's publishable key when missing,
# using SUPABASE_ACCESS_TOKEN from the environment or the repository's .env.local). The previous Manor.app goes to the
# Trash rather than being deleted.
set -euo pipefail
VERSION="${1:?version, for example 0.2.0}"
NOTES="${2:-}"
[[ -n "$NOTES" && "$NOTES" != /* ]] && NOTES="$PWD/$NOTES"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
cd "$ROOT"

fail() { echo "✗ $1" >&2; exit 1; }
security find-identity -p codesigning 2>/dev/null | grep -q '"Manor Signing"' || fail "The Manor Signing certificate isn't in your keychain."
[[ -f ~/.config/manor/update_ed25519.key ]] || fail "Missing the update key at ~/.config/manor/update_ed25519.key."
gh auth status >/dev/null 2>&1 || fail "The GitHub CLI isn't signed in (gh auth login)."
[[ -z "$NOTES" || -f "$NOTES" ]] || fail "No release notes at $NOTES."

if [[ ! -f config/production.env ]]; then
  if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -f "$REPO_ROOT/.env.local" ]]; then set -a; source "$REPO_ROOT/.env.local"; set +a; fi
  [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]] || fail "config/production.env is missing and no SUPABASE_ACCESS_TOKEN is set to write it."
  KEYS="$(curl -fsS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "https://api.supabase.com/v1/projects/pxdxqueevzttpmxjsqes/api-keys?reveal=true")"
  KEY="$(python3 -I -c 'import json,sys; k=json.load(sys.stdin); p=[x for x in k if x.get("type")=="publishable"]; print((p[0] if p else next(x for x in k if x["name"]=="anon"))["api_key"])' <<<"$KEYS")"
  (umask 077; printf 'SUPABASE_URL=https://pxdxqueevzttpmxjsqes.supabase.co\nSUPABASE_KEY=%s\n' "$KEY" > config/production.env)
  echo "✓ Wrote config/production.env"
fi
echo "✓ Release prerequisites are in place"

scripts/release.sh production "$VERSION" ${NOTES:+"$NOTES"}

# Install: quit the running Manor (the old app or this one), keep the old copy in the Trash, copy the new one in.
osascript -e 'quit app id "app.manor.desktop"' >/dev/null 2>&1 || true
osascript -e 'quit app "Manor"' >/dev/null 2>&1 || true
for _ in $(seq 1 20); do pgrep -xq Manor || break; sleep 0.5; done
if [[ -d /Applications/Manor.app ]]; then
  mv /Applications/Manor.app "$HOME/.Trash/Manor $(date '+%Y-%m-%d %H.%M.%S').app"
  echo "✓ Moved the previous Manor to the Trash"
fi
ditto build/Manor.app /Applications/Manor.app
if pgrep -xq Manor; then
  # Alfred's Prep mode keeps Manor running when asked to quit, so the old version is still open.
  echo "✓ Installed Manor $VERSION in Applications"
  echo "! Manor is still running the previous version (Prep mode keeps it open on Quit)."
  echo "  Choose Quit Manor from Manor's menu bar item, then open Manor to start $VERSION."
else
  open /Applications/Manor.app
  echo "✓ Installed and opened Manor $VERSION"
fi
