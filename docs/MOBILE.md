# Mobile apps (App Store + Google Play)

Both apps use **Capacitor 8**. Android loads the production game at
`https://play.beech.games` in its WebView. iOS bundles the game from `dist/`.

| | |
|---|---|
| Config | `capacitor.config.ts` (appId `app.beech.beach`) |
| Android project | `android/` (Gradle, compile/target SDK 36, min SDK 24) |
| iOS project | `ios/App/App.xcodeproj` (Swift Package Manager, no CocoaPods) |
| Native plugins | Native sign-in, store billing, haptics, filesystem and sharing on both platforms. Android also uses native approximate location and local pet reminders. |
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
npm run cap:android                  # sync the hosted shell and open Android Studio
npm run cap:ios                      # build, sync and open in Xcode (macOS only)
npm run cap:sync                     # sync both native projects
```

Once the hosted shell is installed, production deployments from `main` update
the Android game. Players who leave it open get a reload prompt. A new Android
release is needed for changes to the native shell or its plugins. The shell
requires a current Android System WebView and displays a retry screen when it
can't reach the game. Local pet reminders are opt-in under Manage → Settings.

Moving from the bundled Android client to the hosted origin requires signing
in again. Account beaches and delivered purchases are server-side. Export
device-only beaches and let any pending purchases finish syncing before
upgrading. WebView data stored at the old `https://localhost` origin stays
there, including settings and local checkpoints.

## Versioning

```bash
node scripts/set-version.mjs 1.0.0 1     # version name + build number, everywhere
```

Both stores reject an upload whose build number isn't higher than the last one.

### iOS auto-build

iOS bundles the web build, so a web feature only reaches the iPhone app
with a new TestFlight build. `release-mobile.yml` therefore builds iOS
automatically after every successful production deploy
(`workflow_run` on "Deploy production (Google Cloud Run)", main only):
the build ships exactly the commit that deployed, and only that commit —
a failed deploy builds nothing, and a later, undeployed commit waits for
its own deploy. Android stays manual: it is a hosted shell, so web
deploys reach it without a rebuild.

**Build number.** The auto-build uses this workflow's run number
(`github.run_number`) as the iOS build number, set in the runner by
`scripts/set-version.mjs` and never committed back to main, so there is
no push loop. Run numbers are monotonic across manual and auto runs, so
Apple never sees a duplicate. The trade-off: the checked-in
`CURRENT_PROJECT_VERSION` (7 at the time of writing) lags what is in
TestFlight, and the version in the repo no longer says which build is
live — the Actions tab does.

**Manual releases after auto-build exists.** A manual dispatch runs a
guard first: the checked-in build number must be ahead of the run
number, or the job fails fast with the bump command instead of failing
five minutes into the archive with an Apple duplicate error. Prefer
bumping the **marketing version** (e.g. 1.0.0 → 1.0.1) for a manual
release: build numbers restart per version, while a build-number-only
bump collides with a future auto-build once the run counter reaches it.

**What "auto" does and does not mean.** A new build lands in TestFlight
for internal testers right away, but it does **not** reach external
testers (the Family group) instantly — each build still needs Beta App
Review approval for the external group, and the new build has to be
added to the group. And the trigger itself is only proven after merge:
`workflow_run` does not fire from a PR branch, so the first auto-build
run after landing needs watching.

**Cost.** Every deploy now also spends macOS runner time: the build-7
run's iOS job took ~5 minutes, and GitHub bills macOS at ~$0.08/min
(10× Linux), so roughly $0.40 per build — at ~5 deploys a day, on the
order of $2/day. If deploys get much more frequent, or a deploy lands
while a build is still running (each run builds its own commit), revisit
whether every deploy needs its own build.

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
npm run cap:sync:android
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

Status (2026-11-23): the app is created in Play Console (**beech**, free,
package `app.beech.beach`, developer account Jenerator Labs), identity
verification passed, and AAB **1.0.0 build 1** is uploaded to the *Internal
testing* track as a draft (release workflow run 45192537104). What is still
manual, in the console: the listing text, content rating, data safety,
target audience, the internal-testers list, and promoting the draft. The
screenshots and feature graphic below are committed in
`resources/play-store/` (they show a test account and a test beach code;
the feature graphic has a faint brush-cursor ring — retake before the
production listing if it shows).

1. Create the app in Play Console (free/paid, category **Games →
   Simulation**).
2. Turn on **Play App Signing** (default) and upload `app-release.aab` to the
   *Internal testing* track first.
3. Store listing: short and full description, a 512×512 icon
   (`public/icons/icon-512.png`), a 1024×500 feature graphic, at least 2
   phone screenshots, and the privacy policy URL
   `https://beech.games/privacy.html`. Capture screenshots with
   `node scripts/shot.mjs` at 1080×1920, or straight from a device.
4. Content rating questionnaire: no violence, no ads. The app **does** have user-generated content — saved beaches, first names, and user-chosen beach names are visible to all signed-in users on the global shore, leaderboard, neighbour tags, and share-link previews — and users **can** interact and share (visits by code or link, neighbour links, starring, item gifting). There is no chat, messaging, or DM anywhere in the app.
5. Data safety: with accounts on (production builds), declare **User IDs**
   and **app activity/content** (the saved beach), plus the **name** shown to
   neighbors you choose. All of it is collected, linked to the user, used for
   app functionality only, and never shared or used for tracking. Users can
   delete their account in the app. With no accounts (sandbox builds),
   nothing is collected. "Near me" reads the coarse location once, on the
   device, to pick a beach. It is never stored or sent.
6. Target audience: 13+. The app has no ads. It has in-app purchases
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
3. Listing: subtitle, description, keywords, support URL
   (`https://beech.games`), a privacy policy URL
   (`https://beech.games/privacy.html`), and screenshots for 6.9" and 6.5"
   iPhones (and 13" iPad, since the app supports iPad).
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
| `release-mobile.yml` | manual, plus an automatic iOS build after each successful production deploy (see "iOS auto-build" above) | Signed AAB to the Play **internal** track (draft), and an iOS archive uploaded to App Store Connect / TestFlight. |

Repository secrets used (Settings → Secrets and variables → Actions):

| Secret | For |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 beech-upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | the upload key |
| `PLAY_SERVICE_ACCOUNT_JSON` | Play Console → Setup → API access → service account with release permissions |
| `APPSTORE_API_KEY_ID`, `APPSTORE_API_ISSUER_ID` | App Store Connect → Users and Access → Integrations → App Store Connect API (role: App Manager) |
| `APPSTORE_API_KEY_P8_BASE64` | `base64 -i AuthKey_XXXX.p8` |
| `APPLE_TEAM_ID` | the 10-character team ID |

The release workflow's first run against the real Play account succeeded
(2026-11-23, run 45192537104): the signed AAB uploaded to the internal
track as a draft through the Play API, so no manual first upload was
needed. The draft still has to be reviewed and rolled out in Play
Console, and testers added to the internal track.

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
what it buys, once. The purchase is finished with the store (consumed on
Android, finished on iOS) only after the server confirms it
(`autoFinishTransactions: false`, `src/net/shop.ts`): finishing earlier would
leave a paid purchase with no grant and nothing to recover. If the hand-over
fails (offline), the app keeps it and retries on the next sign-in or shop
visit, and unfinished store purchases are recovered the same way
(`getUnfinishedTransactions`). A payment the store hasn't completed yet
(for example a cash payment) comes back as pending, not an error, and the
recovery hands it over once the store marks it bought. Refunds come back as
store notifications and take the items away.

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
