#!/bin/sh
# Archives the iPhone / iPad app and uploads it to App Store Connect, where it also shows in TestFlight.
# Needs full Xcode signed in to the team (Xcode → Settings → Accounts), or an App Store Connect API key
# passed through as extra xcodebuild arguments (see .github/workflows/release.yml).
# The archive is unsigned and the export signs it for the App Store, so the team needs no registered devices.
# Usage: INKPAGE_BUILD=2 sh scripts/ios-upload.sh   (raise the build number for each upload of the same version)
set -e
cd "$(dirname "$0")/.."
node scripts/safari-xcode.mjs
ARCHIVE=safari-app/InkPage.xcarchive
rm -rf "$ARCHIVE" safari-app/export
xcodebuild archive -project safari-app/InkPage/InkPage.xcodeproj -scheme "InkPage (iOS)" -configuration Release \
  -destination generic/platform=iOS -archivePath "$ARCHIVE" CODE_SIGNING_ALLOWED=NO -quiet
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist safari/xcode/ExportOptions.plist \
  -exportPath safari-app/export -allowProvisioningUpdates "$@"
