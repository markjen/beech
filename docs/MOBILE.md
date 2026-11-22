# Mobile apps (App Store + Google Play)

The phone apps are the same web build wrapped with **Capacitor 8**:

| | |
|---|---|
| Config | `capacitor.config.ts` (appId `app.beech.beach`, webDir `dist`) |
| Android project | `android/` (Gradle, compile/target SDK 36, min SDK 24) |
| iOS project | `ios/App/App.xcodeproj` (Swift Package Manager, no CocoaPods) |
| Native plugin | `@capacitor/haptics` (Taptic Engine / vibrator) |
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
5. Data safety: **no data collected or shared.** The app has no network
   calls, analytics or accounts. Settings stay on the device. "Near me" reads
   the coarse location once, on the device, to pick a beach. It is never
   stored or sent.
6. Target audience: everyone. The app has no ads and no in-app purchases.

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
4. App Privacy: **Data Not Collected**. Location is used on the device
   only, for "near me".
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

## Platform notes

- **Audio** starts on the first touch (the title card), which WebView
  autoplay rules require.
- **Haptics:** native apps use `@capacitor/haptics`. Android web uses
  `navigator.vibrate`. iOS web has no vibration API, so there are no haptics there.
- **Backgrounding** pauses the sim worker and audio (`visibilitychange`).
- **The service worker is not registered** in the native shells, which load
  assets locally anyway.
