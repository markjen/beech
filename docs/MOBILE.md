# Mobile apps (App Store + Google Play)

The phone apps are the same web build wrapped with **Capacitor 8**:

| | |
|---|---|
| Config | `capacitor.config.ts` (appId `app.beech.beach`, webDir `dist`) |
| Android project | `android/` (Gradle, compile/target SDK 36, min SDK 24) |
| iOS project | `ios/App/App.xcodeproj` (Swift Package Manager, no CocoaPods) |
| Native plugins | `@capacitor/haptics` (Taptic Engine / vibrator); `@capacitor/filesystem` and `@capacitor/share` (exporting a beach file through the share sheet) |
| Icons & splash sources | `resources/` (regenerate with `npm run icons`, then `npx @capacitor/assets generate`, see below) |

> **Before the first store upload, decide the final `appId`.** It is the
> bundle ID / package name and can never change once published. To change it,
> edit `capacitor.config.ts`, the `namespace`/`applicationId` in
> `android/app/build.gradle`, the Java package folder under
> `android/app/src/main/java/`, `PRODUCT_BUNDLE_IDENTIFIER` in
> `ios/App/App.xcodeproj/project.pbxproj`, and `packageName` in
> `.github/workflows/release-mobile.yml`.

## Everyday loop

```bash
npm run build && npx cap sync        # copy dist/ + plugins into both native projects
npx cap open android                 # Android Studio
npx cap open ios                     # Xcode (macOS only)
```

`npm run cap:android` / `npm run cap:ios` do build + sync + open in one go.
Run `npx cap sync` after every web change you want in the native apps.

## Versioning

```bash
node scripts/set-version.mjs 1.0.0 1     # version name + build number, everywhere
```

Both stores reject an upload whose build number isn't higher than the last one.

## Icons and splash screens

The artwork is generated from code (`scripts/make-icons.mjs`: an isometric
beach tile on the sky gradient):

```bash
npm run icons                                   # public/icons/* (PWA) + resources/* (store sources)
npx @capacitor/assets generate \
  --iconBackgroundColor '#cfe9ee' --iconBackgroundColorDark '#4a4f85' \
  --splashBackgroundColor '#fbeedd' --splashBackgroundColorDark '#4a4f85'
rm -rf icons                                    # the tool also writes PWA webps to ./icons; we don't use them
```

## Android → Google Play

### Local build

Needs JDK 21 and the Android SDK (Android Studio installs both).

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug           # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Signing

Create an upload key once and keep it **outside git** (back it up: losing it
means using Play's key-reset process):

```bash
keytool -genkeypair -v -keystore beech-upload.jks -alias beech -keyalg RSA -keysize 2048 -validity 10000
```

`android/app/build.gradle` signs release builds only when these environment
variables are set:

```bash
export BEECH_KEYSTORE_PATH=/path/to/beech-upload.jks
export BEECH_KEYSTORE_PASSWORD=...
export BEECH_KEY_ALIAS=beech
export BEECH_KEY_PASSWORD=...
cd android && ./gradlew bundleRelease          # app/build/outputs/bundle/release/app-release.aab
```

### Play Console checklist

1. Create the app in Play Console (free/paid, category **Casual** or **Simulation**).
2. Turn on **Play App Signing** (default) and upload `app-release.aab` to the
   *Internal testing* track first.
3. Store listing: short and full description, a 512×512 icon
   (`public/icons/icon-512.png`), a 1024×500 feature graphic, and at least 2
   phone screenshots. Capture them with `node scripts/shot.mjs` at
   1080×1920, or straight from a device.
4. Content rating questionnaire: no violence, no user content, no ads.
5. Data safety: with accounts on (production builds), declare **User IDs**
   and **app activity/content** (the saved beach), plus the **name** shown to
   neighbors you choose. All of it is collected, linked to the user, used for
   app functionality only, and never shared or used for tracking. Users can
   delete their account in the app. With no accounts (sandbox builds),
   nothing is collected. "Near me" reads the coarse location once, on the
   device, to pick a beach. It is never stored or sent.
6. Target audience: everyone. The app has no ads. It has in-app purchases
   (consumables only; see "In-app purchases" below).

## iOS → App Store

Needs a Mac with Xcode 16+ and an Apple Developer Program membership.

### Local build

```bash
npm run build && npx cap sync ios
npx cap open ios
```

In Xcode, select the **App** target, then **Signing & Capabilities**. Choose
your Team and leave "Automatically manage signing" on. Run it on a device or
simulator. To ship: **Product → Archive → Distribute App → App Store Connect**.

Already set in `Info.plist`:
- status bar hidden, full screen, all orientations
- `ITSAppUsesNonExemptEncryption = NO` (so no export-compliance question on each upload)
- arm64 required

### App Store Connect checklist

1. Create the app record with the same bundle ID as `appId`.
2. Upload a build (Xcode Organizer or the CI workflow below), then add it to
   TestFlight.
3. Listing: subtitle, description, keywords, support URL (the GitHub Pages URL
   works), a privacy policy URL, and screenshots for 6.9" and 6.5" iPhones
   (and 13" iPad, since the app supports iPad).
4. App Privacy (production builds with accounts): **User ID**, **Other
   User Content** (the beach) and **Name** (first name, shown to chosen
   neighbors). All are linked to the user, for App Functionality, and not
   used for tracking. Location is used on the device only, for "near me".
   Sign in with Apple must be enabled on the App ID; see BACKEND.md, "Phone
   apps".
5. Age rating: 4+.

## CI

| Workflow | When | What |
|---|---|---|
| `mobile.yml` | push to `main` touching app code, or manual | Android debug APK plus release AAB (signed if secrets exist), and an iOS simulator build with no signing. Artifacts are uploaded. |
| `release-mobile.yml` | manual only | Signed AAB to the Play **internal** track (draft), and an iOS archive uploaded to App Store Connect / TestFlight. |

Repository secrets used (Settings → Secrets and variables → Actions):

| Secret | For |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 beech-upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | the upload key |
| `PLAY_SERVICE_ACCOUNT_JSON` | Play Console → Setup → API access → service account with release permissions |
| `APPSTORE_API_KEY_ID`, `APPSTORE_API_ISSUER_ID` | App Store Connect → Users and Access → Integrations → App Store Connect API (role: App Manager) |
| `APPSTORE_API_KEY_P8_BASE64` | `base64 -i AuthKey_XXXX.p8` |
| `APPLE_TEAM_ID` | the 10-character team ID |

The release workflow hasn't been run against real store accounts yet. Expect
to adjust it on the first run. The first upload of a new app to Google Play
must also be done by hand in the Play Console before the API will accept
uploads.

## Android TV

The Android app also declares the leanback launcher, an optional
touchscreen, and a 320×180 TV banner, so the same APK/AAB installs on
Android TV. To list it for TV in Play Console, add the TV form factor and TV
screenshots (1920×1080). Capture them with
`node scripts/shot.mjs "http://localhost:5173/?tv=1&nointro" tv.png 1920 1080 8000`.
On TV, the arrow keys look around and V switches between views.

## Sign-in

Google and Apple sign-in use the native sheets (`src/net/nativeAuth.ts`). The
setup steps (OAuth clients, Info.plist URL scheme, Apple capability, server
client IDs) are in [BACKEND.md](BACKEND.md), "Phone apps".

## In-app purchases (the shop)

The shop sells through Apple and Google only (`@capgo/native-purchases`:
StoreKit 2 and Google Play Billing). We never handle payment details. The
products, prices and reasoning are in [PRICING.md](PRICING.md), and the list
lives in `server/src/products.ts`. Every product is a **consumable** with the
**same product id in both stores**.

**How a purchase flows:** the app buys, then hands the store's proof to
`POST /api/store/purchase` (iOS: the signed transaction, `jwsRepresentation`;
Android: the purchase token). The server checks it with the store and grants
what it buys, once. If the hand-over fails (offline), the app keeps it and
retries on the next sign-in or shop visit. Refunds come back as store
notifications and take the items away.

### App Store Connect

1. Agreements, Tax and Banking: accept the Paid Apps agreement and add bank
   and tax details. Without it, no products load.
2. App → Monetization → In-App Purchases: create one **Consumable** per
   product in `server/src/products.ts`. Use the same Product ID (e.g.
   `beach_1`), the price tier from PRICING.md, a display name and
   description, and a review screenshot of the shop.
3. App → Capabilities: In-App Purchase is on by default for the App ID.
4. App Information → **App Store Server Notifications**: Version 2, Production
   and Sandbox URLs both `https://<production domain>/api/store/apple/notifications`.
5. Server env: `APPLE_BUNDLE_ID` if the bundle id isn't `app.beech.beach`.
   Signed transactions are checked offline against the pinned Apple Root CA
   (`server/src/appleRoot.ts`), so no API key is needed.
6. Test with a Sandbox account (Users and Access → Sandbox). Sandbox purchases
   are accepted and recorded with `environment = 'Sandbox'` (App Review buys
   in sandbox against production).

### Google Play Console

1. Set up a payments profile (Play Console → Setup → Payments profile).
2. Monetize → Products → **In-app products**: create one per product, same
   Product ID and the price from PRICING.md, then activate. (Play needs an
   uploaded build that includes the billing library before products can be
   created. Any build after this one includes it.)
3. **Let the server read purchases:** Users and permissions → invite the
   Cloud Run service account (from GCP.md) with "View financial data" and
   "Manage orders and subscriptions". On Cloud Run the server uses that
   account automatically. Elsewhere, set `GOOGLE_PLAY_SERVICE_ACCOUNT` to a
   service-account JSON key, kept in Secret Manager and never in git.
4. **Refunds (real-time developer notifications):** in GCP, create a Pub/Sub
   topic, grant `google-play-developer-notifications@system.gserviceaccount.com`
   the Publisher role on it, and set it under Monetization setup → Real-time
   developer notifications. Add a **push** subscription to
   `https://<production domain>/api/store/google/rtdn` with authentication
   enabled (a service account of your choice). Set the server env
   `GOOGLE_RTDN_AUDIENCE` (the push audience, by default that URL) and
   `GOOGLE_RTDN_SERVICE_ACCOUNT` (that service account's email).
5. Server env: `ANDROID_PACKAGE` if the package isn't `app.beech.beach`.
6. Test with license testers (Setup → License testing). Their purchases are
   free and recorded as `environment = 'Test'`.

### The web build

`VITE_APP_STORE_URL` and `VITE_PLAY_STORE_URL` (at build time) are where the
web shop's buttons send people once the apps are listed. Until then the shop
says the apps are coming.

### Store forms

The apps now have in-app purchases. Declare them in the listings, and add
"Purchase history" (App Privacy: linked to the user, for app functionality)
and "Purchase history" (Play Data safety: collected, not shared) to the
privacy forms.

## Platform notes

- **Audio** starts on the first touch (the title card), which WebView
  autoplay rules require.
- **Beach files:** export writes the file to the app's cache folder and
  opens the share sheet (save to Files, AirDrop, email…). Import uses the
  system file picker, which the WebView opens for `<input type=file>`. In
  the apps the picker accepts any file, since the phones don't know the
  `.beach.json` type; the reader rejects anything that isn't a beach file.
- **Haptics:** native apps use `@capacitor/haptics`. Android web uses
  `navigator.vibrate`. iOS web has no vibration API, so there are no haptics there.
- **Backgrounding** pauses the sim worker and audio (`visibilitychange`).
- **The service worker is not registered** in the native shells, which load
  assets locally anyway.
