#!/usr/bin/env bash
# Builds Manor.app (production) or "Manor Staging.app" and signs it with the Developer ID Application certificate
# for team 2588U5J9Z7 (release builds get a secure timestamp, which notarization requires).
#
#   scripts/build-app.sh [production|staging] [--debug] [--open]
#
# Configuration comes from config/<mode>.env (SUPABASE_URL and SUPABASE_KEY, the publishable key), which is
# ignored by git. Signing with the team's Developer ID keeps Keychain access, privacy permissions, and update checks
# working across builds and certificate renewals; MANOR_SIGN_IDENTITY overrides it, and a Mac without it signs ad hoc.
set -euo pipefail

MODE="${1:-staging}"
CONFIG="release"
OPEN=0
for arg in "${@:2}"; do
  case "$arg" in
    --debug) CONFIG="debug" ;;
    --open) OPEN=1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE="config/$MODE.env"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE (SUPABASE_URL and SUPABASE_KEY)" >&2; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"

case "$MODE" in
  production) NAME="Manor"; IDENTIFIER="app.manor.desktop"; SCHEME="manor"; FEED="https://github.com/rithm84/Manor/releases/latest/download/manor-update.json" ;;
  staging) NAME="Manor Staging"; IDENTIFIER="app.manor.desktop.staging"; SCHEME="manor-staging"; FEED="https://github.com/rithm84/Manor/releases/download/staging/manor-update.json" ;;
  *) echo "Mode must be production or staging" >&2; exit 1 ;;
esac
VERSION="$(cat VERSION 2>/dev/null || echo 0.2.0)"
BUILD_NUMBER="${MANOR_BUILD_NUMBER:-$(git rev-list --count HEAD 2>/dev/null || echo 1)}"
UPDATE_KEY="$(cat config/update-public-key.txt 2>/dev/null || true)"

swift build -c "$CONFIG" --product Manor
BIN="$(swift build -c "$CONFIG" --show-bin-path)/Manor"

APP="$ROOT/build/$NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/Fonts"
cp "$BIN" "$APP/Contents/MacOS/Manor"
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cp Resources/Fonts/* "$APP/Contents/Resources/Fonts/"
# The asset catalog carries the plum accent color, so native controls (pop-up menus, checkboxes, pickers,
# switches) match Manor instead of the system blue.
xcrun actool Resources/Assets.xcassets --compile "$APP/Contents/Resources" --platform macosx \
  --minimum-deployment-target 15.0 --output-partial-info-plist "$ROOT/build/assets-info.plist" >/dev/null
for folder in Sounds MathFonts; do
  if [[ -d "Resources/$folder" ]]; then cp -R "Resources/$folder" "$APP/Contents/Resources/$folder"; fi
done

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
  <key>CFBundleIdentifier</key><string>$IDENTIFIER</string>
  <key>CFBundleExecutable</key><string>Manor</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$BUILD_NUMBER</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>ATSApplicationFontsPath</key><string>Fonts</string>
  <key>NSAccentColorName</key><string>AccentColor</string>
  <key>NSMicrophoneUsageDescription</key><string>Alfred listens to what you say during practice conversations to help you prepare.</string>
  <key>NSScreenCaptureUsageDescription</key><string>Alfred looks at your screen when you ask about it, and hears your call's audio in Prep mode.</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>$IDENTIFIER</string>
      <key>CFBundleURLSchemes</key><array><string>$SCHEME</string></array>
    </dict>
  </array>
  <key>ManorSupabaseURL</key><string>$SUPABASE_URL</string>
  <key>ManorSupabaseKey</key><string>$SUPABASE_KEY</string>
  <key>ManorURLScheme</key><string>$SCHEME</string>
  <key>ManorEnvironment</key><string>$MODE</string>
  <key>ManorUpdateFeed</key><string>$FEED</string>
  <key>ManorUpdatePublicKey</key><string>$UPDATE_KEY</string>
</dict>
</plist>
PLIST

TEAM_ID="2588U5J9Z7"
IDENTITY="${MANOR_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | grep -o "\"Developer ID Application: [^\"]*($TEAM_ID)\"" | head -1 | tr -d '"')}"
# Notarization needs a secure timestamp from Apple; debug builds skip the network round trip.
TIMESTAMP="--timestamp"
[[ "$CONFIG" == debug ]] && TIMESTAMP="--timestamp=none"
if [[ -n "$IDENTITY" ]] && grep -q "\"$IDENTITY\"" <<<"$(security find-identity -p codesigning 2>/dev/null)"; then
  codesign --force --sign "$IDENTITY" "$TIMESTAMP" --options runtime --entitlements Resources/Manor.entitlements "$APP"
else
  echo "warning: signing identity \"$IDENTITY\" not found; signing ad hoc" >&2
  codesign --force --sign - "$APP"
fi
codesign --verify --strict "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
echo "Built $APP ($CONFIG, $MODE)"
[[ "$OPEN" == 1 ]] && open "$APP"
exit 0
