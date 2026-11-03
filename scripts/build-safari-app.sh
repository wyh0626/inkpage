#!/bin/sh
# Builds dist/InkPage.app for Safari on macOS without Xcode: a small native app with the
# Safari Web Extension (dist/safari) embedded as an app extension, signed with a
# Developer ID when one is in the keychain (ad hoc otherwise).
#
#   sh scripts/build-safari-app.sh
#   INKPAGE_SIGN_IDENTITY="Developer ID Application: …"   pick a certificate
#   INKPAGE_BUNDLE_ID=io.github.you.inkpage               app bundle ID
#   INKPAGE_NOTARY_PROFILE=<notarytool profile>           also make a notarized DMG
#
# iPhone / iPad need the iOS SDK, which only full Xcode has: see scripts/safari-xcode.mjs.
set -eu
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
VERSION="$(node -p "require('./package.json').version")"
BUILD="$(date +%Y%m%d%H%M)"
BUNDLE_ID="${INKPAGE_BUNDLE_ID:-io.github.wyh0626.inkpage}"
EXT_ID="$BUNDLE_ID.extension"
MIN_MACOS=12.0
SDK="$(xcrun --show-sdk-path)"

step() { printf '\n→ %s\n' "$1"; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
APP="$WORK/InkPage.app"
APPEX="$APP/Contents/PlugIns/InkPage Extension.appex"

step "Extension files"
node scripts/build.mjs >/dev/null
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APPEX/Contents/MacOS" "$APPEX/Contents/Resources"
cp -R dist/safari/. "$APPEX/Contents/Resources/"

step "Compile (arm64 + x86_64)"
printf 'let extensionBundleID = "%s"\n' "$EXT_ID" > "$WORK/Generated.swift"
for ARCH in arm64 x86_64; do
  xcrun swiftc -O -sdk "$SDK" -target "$ARCH-apple-macos$MIN_MACOS" -module-name InkPage \
    safari/App/main.swift "$WORK/Generated.swift" -o "$WORK/app-$ARCH"
  # An app extension has no main(): Foundation's NSExtensionMain runs it.
  xcrun swiftc -O -sdk "$SDK" -target "$ARCH-apple-macos$MIN_MACOS" -module-name InkPageExtension \
    -application-extension -parse-as-library -Xlinker -e -Xlinker _NSExtensionMain \
    safari/Extension/SafariWebExtensionHandler.swift -o "$WORK/ext-$ARCH"
done
lipo -create "$WORK/app-arm64" "$WORK/app-x86_64" -output "$APP/Contents/MacOS/InkPage"
lipo -create "$WORK/ext-arm64" "$WORK/ext-x86_64" -output "$APPEX/Contents/MacOS/InkPage Extension"

step "Icon"
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
[ -f store/icon-1024.png ] || python3 scripts/icons.py src/icons store/icon-1024.png
for SIZE in 16 32 128 256 512; do
  sips -z "$SIZE" "$SIZE" store/icon-1024.png --out "$ICONSET/icon_${SIZE}x${SIZE}.png" >/dev/null
  sips -z $((SIZE * 2)) $((SIZE * 2)) store/icon-1024.png --out "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

step "Info.plist"
plist() { # file, then key/value XML
  F="$1"; shift
  printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' \
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
    '<plist version="1.0"><dict>' "$@" '</dict></plist>' > "$F"
}
COMMON="<key>CFBundleShortVersionString</key><string>$VERSION</string><key>CFBundleVersion</key><string>$BUILD</string><key>LSMinimumSystemVersion</key><string>$MIN_MACOS</string><key>CFBundleDevelopmentRegion</key><string>en</string><key>CFBundleLocalizations</key><array><string>en</string><string>zh-Hans</string></array>"
plist "$APP/Contents/Info.plist" \
  "<key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>" \
  "<key>CFBundleName</key><string>InkPage</string><key>CFBundleDisplayName</key><string>InkPage</string>" \
  "<key>CFBundleExecutable</key><string>InkPage</string><key>CFBundlePackageType</key><string>APPL</string>" \
  "<key>CFBundleIconFile</key><string>AppIcon</string><key>NSHighResolutionCapable</key><true/>" \
  "<key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>" \
  "$COMMON"
plist "$APPEX/Contents/Info.plist" \
  "<key>CFBundleIdentifier</key><string>$EXT_ID</string>" \
  "<key>CFBundleName</key><string>InkPage Extension</string><key>CFBundleDisplayName</key><string>InkPage</string>" \
  "<key>CFBundleExecutable</key><string>InkPage Extension</string><key>CFBundlePackageType</key><string>XPC!</string>" \
  "<key>NSExtension</key><dict><key>NSExtensionPointIdentifier</key><string>com.apple.Safari.web-extension</string><key>NSExtensionPrincipalClass</key><string>SafariWebExtensionHandler</string></dict>" \
  "$COMMON"

step "Sign"
IDENTITY="${INKPAGE_SIGN_IDENTITY:-$(security find-identity -p codesigning -v | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)}"
if [ -n "$IDENTITY" ]; then
  echo "  $IDENTITY"
  set -- --force --sign "$IDENTITY" --options runtime --timestamp
else
  echo "  no Developer ID certificate: ad hoc signature (runs only on this Mac)"
  set -- --force --sign -
fi
# Inside out: the extension first, then the app around it.
codesign "$@" --entitlements safari/Extension.entitlements "$APPEX"
codesign "$@" --entitlements safari/App.entitlements "$APP"
codesign --verify --strict --deep "$APP"

rm -rf dist/InkPage.app
mv "$APP" dist/InkPage.app
printf "\n✓ dist/InkPage.app  (%s, %s)\n" "$VERSION" "$BUNDLE_ID"

if [ -n "${INKPAGE_NOTARY_PROFILE:-}" ]; then
  step "Notarize (uploads to Apple)"
  DMG="dist/InkPage-$VERSION.dmg"
  rm -f "$DMG"
  hdiutil create -volname InkPage -srcfolder dist/InkPage.app -ov -format UDZO "$DMG" >/dev/null
  codesign --force --sign "$IDENTITY" --timestamp "$DMG"
  xcrun notarytool submit "$DMG" --keychain-profile "$INKPAGE_NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
  echo "✓ $DMG (notarized)"
fi
