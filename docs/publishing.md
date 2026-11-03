# Publishing

English · [中文](publishing.zh-CN.md)

One code base, four channels. `npm run build` writes `dist/chrome`, `dist/firefox`, `dist/safari` and two zips. Listing copy is in [store/listing.md](../store/listing.md), images in `store/`, and the privacy policy is [PRIVACY.md](../PRIVACY.md); host it at a public address (for example, the GitHub repository).

Before the first upload:

1. Check the version in `package.json`. Every upload must be higher than the last.
2. Replace the Firefox add-on ID `inkpage@inkpage.app` in `scripts/build.mjs` with your own (for example `inkpage@your-domain`). **It can't change after the first upload.**

## Chrome Web Store (the same package goes to Edge)

1. Register at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole): one-time US$5 fee and email verification. If you publish to users in the EU, you'll also declare whether you're a trader.
2. **New item** → upload `dist/inkpage-chrome-<version>.zip`.
3. **Store listing**:
   - Description: the English text from `store/listing.md`. Add a Chinese (Simplified) listing with the Chinese text.
   - Category: Accessibility, or Productivity › Tools.
   - Screenshots: `store/en/1-4` for English, `store/zh/1-4` for Chinese.
   - Small promo tile: `promo-440x280.png`. Marquee (optional): `marquee-1400x560.png`.
4. **Privacy practices**:
   - Single purpose and permission justifications: from the table in `store/listing.md`.
   - Remote code: No.
   - Data usage: tick no data types, then tick the three certifications.
   - Privacy policy URL: the public address of PRIVACY.md.
5. **Distribution**: public, all regions → submit. Extensions with access to all sites get a closer review, usually a few days.

**Edge Add-ons**: register free at [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview) and upload the same Chrome zip with the same copy and images.

## Firefox Add-ons (AMO)

1. Sign in to the [AMO Developer Hub](https://addons.mozilla.org/developers/) with a Firefox account (free).
2. **Submit a New Add-on** → On this site (listed) → upload `dist/inkpage-firefox-<version>.zip`. Validation should show 0 errors (`npm run lint:firefox` runs it locally).
3. When asked about minifiers or bundlers, answer **No**. Everything ships as readable source (Readability is the upstream unminified file), so no separate source upload is needed.
4. Details:
   - Summary (≤ 250 characters) and description: from `store/listing.md`.
   - Categories: Appearance, Accessibility.
   - License: your choice, for example MIT. Readability is Apache-2.0 and the three fonts are SIL OFL; their licence files are included in the package.
   - Privacy policy, screenshots and support email.
5. Validation leaves two warnings, "Unsafe assignment to innerHTML" in `vendor/Readability.js`. They come from the unmodified upstream Mozilla Readability 0.6.0 and only touch a detached clone of the document. Put this in the notes to reviewers:
   > vendor/Readability.js is the unmodified upstream Mozilla Readability 0.6.0 (https://github.com/mozilla/readability). Its innerHTML assignments run on a detached clone of the document used for article extraction.
6. Signing is automatic. Human review may follow, usually within hours to days. The manifest already declares that no data is collected; the minimum is Firefox 140 / Firefox for Android 142.

## Safari: direct download for Mac (no Xcode)

Like Tact, this needs only the command line tools and a Developer ID certificate:

```bash
npm run safari:app                                        # builds and signs dist/InkPage.app
INKPAGE_NOTARY_PROFILE=<notarytool profile> npm run safari:app   # also a notarized DMG
```

- It uses the "Developer ID Application" certificate in the keychain; `INKPAGE_SIGN_IDENTITY` picks another. The bundle ID defaults to `io.github.wyh0626.inkpage`; change it with `INKPAGE_BUNDLE_ID`.
- Users open the DMG, drag InkPage to Applications, open it once, then enable InkPage in Safari → Settings → Extensions and allow websites.
- Ship the DMG the way Tact does, for example on GitHub Releases.

## Safari: App Store (iPhone / iPad, optionally Mac)

Safari extensions on iPhone and iPad install only from the App Store, and an iOS build needs **full Xcode** (the command line tools have no iOS SDK). The existing Apple Developer membership (team PFM45ATWW9) covers it.

**Suggested split**: iPhone / iPad through the App Store; the Mac keeps the DMG above. To put the Mac on the App Store too, submit it under the same bundle ID for a universal purchase.

1. **Install Xcode** from the Mac App Store, open it once and accept the licence. For the simulators, also download the iOS platform (Xcode → Settings → Components, or `xcodebuild -downloadPlatform iOS`, about 8 GB).
2. **Generate the project** (iOS / iPadOS and macOS apps together):
   ```bash
   npm run safari:xcode
   ```
   This writes `safari-app/InkPage/` and fills in what the converter's template leaves out:
   - the app's setup screen from `safari/xcode` (Chinese or English, with the extension's on/off state and, on iOS 26.2 and later, a button that opens its settings);
   - icons from `store/icon-1024.png`;
   - the version from `package.json`, team PFM45ATWW9 with automatic signing, and the "no non-exempt encryption" declaration.

   `INKPAGE_BUNDLE_ID`, `INKPAGE_TEAM_ID` and `INKPAGE_BUILD` (the build number, raise it for each upload of the same version) change these. The project is regenerated each run, so make changes in `safari/xcode`, not in `safari-app`.
3. **Signing**: open `InkPage.xcodeproj`. Your Apple ID must be signed in under Xcode → Settings → Accounts; the team is already set, so Signing & Capabilities should show no errors.
4. **Test** on an iPhone or iPad simulator, then open the Settings app:
   - iOS 18 and later: Settings → Apps → Safari → Extensions → InkPage → on, and allow All Websites;
   - iOS 17: Settings → Safari → Extensions → InkPage.

   Back in Safari, InkPage is under the page-menu button (aA) in the address bar. For a real device, connect it with a cable and run on it.
5. **TestFlight (optional)**: Product → Archive, then Distribute App → App Store Connect → Upload, and install it on your own iPhone / iPad through TestFlight.
6. **App Store Connect**: create the iOS app in [App Store Connect](https://appstoreconnect.apple.com/) with that bundle ID.
   - App Privacy: "Data Not Collected"; privacy policy URL: the public PRIVACY.md.
   - Screenshots (required): 6.9" iPhone (1320×2868) and 13" iPad (2064×2752), 1–10 each. Chinese sets are ready in `store/ios/zh` (iPhone 18 Pro Max and iPad Pro 13" simulators, iOS 27.2).
   - Description, keywords and support URL; the description can come from `store/listing.md`.
   - Review notes: explain how to enable the extension (Settings → Apps → Safari → Extensions → InkPage), and that the app exists to carry it.
7. **Submit** the uploaded build for review in App Store Connect, usually 1–3 days.

## Automatic releases from GitHub

`.github/workflows/release.yml` runs whenever you push a tag that starts with `v`:

```bash
git tag v1.2.0
git push origin v1.2.0
```

It sets the version from the tag and builds, then:
1. submits the new version to Firefox, Chrome and Edge (each store still reviews it);
2. builds, signs and notarizes the Mac Safari app as a DMG on a GitHub macOS runner;
3. uploads the iPhone / iPad app to App Store Connect;
4. creates a GitHub Release with every package attached.

A store whose secrets aren't set is skipped, so you can connect stores one at a time. Add secrets under the repository's Settings → Secrets and variables → Actions, or with `gh secret set NAME`.

| Store | Secrets | Where they come from |
|---|---|---|
| Firefox | `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | AMO Developer Hub → Tools → [Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/) |
| Chrome | `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` | Publish once by hand for the extension ID, then follow [chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys) to enable the Chrome Web Store API in Google Cloud and create OAuth credentials |
| Edge | `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY` | Publish once by hand, then Partner Center → Microsoft Edge → Publish API → create API credentials |
| Safari Mac (DMG) | `MACOS_CERT_P12`, `MACOS_CERT_PASSWORD` | Export the "Developer ID Application: Eric Wang" certificate with its private key from Keychain Access as .p12, then `base64 -i cert.p12 \| pbcopy` |
| | `ASC_KEY_P8_BASE64`, `ASC_KEY_ID`, `ASC_ISSUER_ID` | App Store Connect → Users and Access → Integrations → App Store Connect API: a new key with the Admin role (notarization, plus signing for the iPhone / iPad build); base64 the downloaded .p8 |
| iPhone / iPad | the three `ASC_…` secrets above, plus the repository **variable** `IOS_APP_STORE` = `true` | Settings → Secrets and variables → Actions → Variables. Turn it on only after the app exists in App Store Connect |

Notes:
- The tag's version must be higher than what each store already has.
- The iPhone / iPad build uses the workflow's run number as its build number and lands in App Store Connect (and TestFlight). Submitting it for review is still one click there: pick the build on the new version and Submit for Review.

## Release checklist (plus `npm run safari:app` for the Mac Safari build)

```bash
npm run build
npm run check:i18n
npm run lint:firefox
python3 -m http.server 8765 &      # from the project root
node test/e2e.mjs                   # 25 Chrome end-to-end checks
```

Then open `http://localhost:8765/test/fixture.html?ext&selftest` in Safari and check the tab title says PASS.
