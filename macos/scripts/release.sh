#!/usr/bin/env bash
# Builds, signs, and publishes a Manor update to GitHub Releases.
#
#   scripts/release.sh production <version> [notes.md]   # tag v<version>, marked latest
#   scripts/release.sh staging [notes.md]                 # replaces the rolling "staging" prerelease
#
# A release is the app archive plus manor-update.json (version, build, archive name, Ed25519 signature).
# Installed apps read that manifest, verify the signature with the public key in their Info.plist, and check
# that the new app is signed with the same certificate before swapping it in.
set -euo pipefail

MODE="${1:?production or staging}"
CALLER="$PWD"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REPO="rithm84/Manor"

if [[ "$MODE" == production ]]; then
  VERSION="${2:?version, for example 0.2.1}"
  NOTES="${3:-}"
  TAG="v$VERSION"
else
  VERSION="$(cat VERSION)"
  NOTES="${2:-}"
  TAG="staging"
fi

# A relative notes path names a file from where the script was run, not from macos/.
[[ -n "$NOTES" && "$NOTES" != /* ]] && NOTES="$CALLER/$NOTES"
[[ -z "$NOTES" || -f "$NOTES" ]] || { echo "No release notes at $NOTES" >&2; exit 1; }

if [[ -n "$(git status --porcelain)" ]]; then
  echo "The working tree has uncommitted changes; a published build must match a commit." >&2
  exit 1
fi
if [[ "$MODE" == production ]] && gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "$TAG is already published; a published version is never replaced." >&2
  exit 1
fi
[[ -f ~/.config/manor/update_ed25519.key ]] || { echo "Missing ~/.config/manor/update_ed25519.key" >&2; exit 1; }

if [[ "$MODE" == production ]]; then
  echo "$VERSION" > VERSION
  git add VERSION
  # VERSION may already name this release; then there is nothing to commit and the tag goes on HEAD.
  git diff --cached --quiet || git commit -m "Release Manor $VERSION" >/dev/null
fi

scripts/build-app.sh "$MODE"
NAME="$([[ "$MODE" == production ]] && echo "Manor" || echo "Manor Staging")"
APP="build/$NAME.app"
BUILD="$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$APP/Contents/Info.plist")"
ARCHIVE="${NAME// /-}-$VERSION-$BUILD.zip"
OUT="build/release"
rm -rf "$OUT" && mkdir -p "$OUT"
ditto -c -k --keepParent "$APP" "$OUT/$ARCHIVE"
SIGNATURE="$(swift scripts/sign-update.swift "$OUT/$ARCHIVE")"
cat > "$OUT/manor-update.json" <<JSON
{"version":"$VERSION","build":$BUILD,"archive":"$ARCHIVE","signature":"$SIGNATURE"}
JSON

NOTES_ARGS=(--notes "Manor $VERSION")
[[ -n "$NOTES" ]] && NOTES_ARGS=(--notes-file "$NOTES")
if [[ "$MODE" == production ]]; then
  git tag "$TAG"
  git push origin HEAD "$TAG"
  gh release create "$TAG" --repo "$REPO" --title "Manor $VERSION" --latest "${NOTES_ARGS[@]}" "$OUT/$ARCHIVE" "$OUT/manor-update.json"
else
  gh release view staging --repo "$REPO" >/dev/null 2>&1 || gh release create staging --repo "$REPO" --title "Manor Staging" --prerelease --notes "Rolling staging build"
  for old in $(gh release view staging --repo "$REPO" --json assets -q '.assets[].name' | grep -E '^Manor-Staging-.*\.zip$' || true); do
    gh release delete-asset staging "$old" --repo "$REPO" --yes
  done
  gh release upload staging --repo "$REPO" --clobber "$OUT/$ARCHIVE" "$OUT/manor-update.json"
fi
echo "Published $NAME $VERSION ($BUILD)"
