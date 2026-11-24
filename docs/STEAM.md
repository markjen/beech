# Steam desktop release (Windows + Linux / Steam Deck)

Status: **S1 (runtime abstraction, `desktop/` shell, SteamPipe CI), S2 (Steam Auth + cross-platform linking), and S3 (`ISteamMicroTxn` + refund sync) built; S4 & S6 queued.**

The Steam release wraps the same Vite web build (`dist/`) in an **Electron + `steamworks.js`** shell under `desktop/`, mirroring how `android/` and `ios/` wrap `dist/` with Capacitor. It connects to the same Cloud Run backend (`https://play.beech.games`), adds zero-friction Steam sign-in with cross-platform account linking, and routes in-game shop purchases through Steam Wallet (`ISteamMicroTxn`).

## Why Electron (over Tauri)

- **Identical WebGL2 + `RGBA32F` rendering across OSes:** Electron ships a pinned Chromium/ANGLE stack matching the browser where `beech` is developed and profiled (`scripts/perf.mjs`). Tauri relies on OS WebViews (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux/SteamOS), where WebKitGTK has WebGL2 float-texture and Web Audio quirks and WebView2 + Steam Overlay / Proton is fragile.
- **Steam Overlay compatibility:** `steamworks.js` (`electronEnableSteamOverlay()`) hooks into Electron's continuous 60 fps Babylon.js render loop. A working Steam Overlay is mandatory for Steam Wallet microtransaction authorization.
- **Native SteamOS / Steam Deck support:** A native Linux x64 Electron depot runs directly on SteamOS without Proton overhead.
- **Toolchain:** Pure TypeScript/Node, matching the root app and `server/`.

## Architecture

### Desktop shell (`desktop/`)

- **`app://beech/` custom protocol:** Registers `app` as a privileged standard/secure scheme serving `dist/` instead of `file://`, so ES module Web Workers (`src/sim/sim.worker.ts`), relative `./` assets, `localStorage`, and `IndexedDB` behave identically to HTTPS. `app://beech` is included in `ALLOWED_ORIGINS` on the server (`server/src/server.ts`).
- **Steam initialization order:** `steamworks.init(APP_ID)` and `steamworks.electronEnableSteamOverlay()` run **before** `app.whenReady()` and before creating `BrowserWindow` (required on Windows 11 and Linux for overlay injection). Production builds call `steamworks.restartAppIfNecessary(APP_ID)` when `STEAM_APP_ID` is set.
- **Preload bridge (`window.beechSteam`):** Renderer runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. `desktop/src/preload.ts` exposes a narrow typed bridge (`BeechSteamBridge` in `src/platform/runtime.ts`):
  - `platform` (`win32` | `linux` | `darwin`) and `steamDeck` flag
  - `getAuthTicket()` → `steamworks.auth.getAuthTicketForWebApi('beech')`
  - `onMicroTxnResponse(cb)` → `MicroTxnAuthorizationResponse_t` callback
  - `unlockAchievement(id)` and `setRichPresence(key, value)`
  - `openExternal(url)` → opens `beech.games/guide`, Discord, and `beechshore.com` in the Steam Overlay browser (or OS browser) without navigating the game window away
  - `toggleFullscreen()`, `isFullscreen()`, `quit()`
  - `saveBeachFile(suggestedName, text)` → native OS Save dialog
- **Windowing:** Launches borderless fullscreen on Steam Deck (`SteamDeck=1` or `isSteamRunningOnSteamDeck()`). `F11` / `Alt+Enter` toggles fullscreen; Settings gains a **Quit** button on Steam. (Window size/position is not persisted yet.)

### Client runtime abstraction (`src/platform/runtime.ts`)

Replaces direct `Capacitor.isNativePlatform()` checks with `getRuntime()` (`'web' | 'ios' | 'android' | 'steam'`), `isSteam()`, `isMobileApp()`, and `isPackagedApp()`:

- **Service worker & update banner:** Disabled on Steam (SteamPipe delivers updates). A 426 stale-save response tells the player to update on Steam.
- **Shop (`src/net/shop.ts`, `src/ui/shop.ts`):** Adds `'steam'` mode. `codesAllowed()` is `false` on Steam (no gift card, promo code, or credit UI; no App Store / Play Store / Xsolla links).
- **Files & sharing:** Export uses `window.beechSteam.saveBeachFile()`; share copies the link to clipboard (with optional external open on `beechshore.com`).
- **Quality tier (`src/platform/quality.ts`):** Steam Deck exposes a touchscreen (`touch = true`); on Steam, quality tier follows the worker benchmark rather than locking out `high` for touchscreens.

## Authentication & cross-platform linking (S2)

- **Zero-friction Steam sign-in:** On boot, the Steam client requests a Web API auth ticket (`getAuthTicketForWebApi('beech')`) and sends `POST /api/auth/steam { ticket, name }` to Cloud Run. The server verifies it via `GET https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/` (checking `result === 'OK'`, `!vacbanned`, `!publisherbanned`), upserts the user, and returns a standard 60-day hashed bearer session. Because sign-in is automatic, the Steam store page does **not** need a "Requires 3rd-Party Account" warning.
- **Offline startup:** If Steam is offline or `play.beech.games` is unreachable, the client falls back cleanly to local IndexedDB storage (`src/net/localStore.ts`) instead of blocking launch.
- **Cross-platform account linking (`user_identities`, migration 18):** Moves `(provider, provider_sub)` lookup into a `user_identities` table so one `users.id` can hold Google, Apple, and Steam identities. Players who already play on web/iOS/Android generate a 10-minute 8-character link code in Settings (`POST /api/account/link-code`) and enter it on Steam (`POST /api/account/link { code }`) to share their beaches, inventory, purchases, neighbors, and checkpoints.

## Monetization: Steam Microtransactions (S3)

- **Model:** Free-to-Play on Steam with all 10 consumable products (`$0.99`–`$9.99`) from `server/src/products.ts` sold via Steam Wallet (`ISteamMicroTxn`). All prices clear Valve's ~$0.49 minimum transaction threshold. Valve takes 30%.
- **Optional DLC:** `pack_founder` (`$9.99`) can also be listed as a one-time Steam DLC for store-page visibility once the store page is live.
- **Claw & vending machines:** Remain 100% free (no paid random draws).
- **Flow:**
  1. `POST /api/store/steam/init { productId }` creates a `steam_orders` row (`BIGSERIAL` numeric `order_id`, migration 19) and calls `ISteamMicroTxn/InitTxn/v3` (or `ISteamMicroTxnSandbox/InitTxn/v3` when `STEAM_SANDBOX=1`).
  2. Steam opens the Overlay for Wallet authorization and fires `MicroTxnAuthorizationResponse_t`.
  3. On approval, the client calls `POST /api/store/steam/finalize { orderId }`; the server calls `ISteamMicroTxn/FinalizeTxn/v2` and atomically writes `purchases` (`store = 'steam'`, `transaction_id = transid`) + `inventory`. On cancel, `POST /api/store/steam/cancel` marks the order canceled.
  4. Pending order IDs are stored in `localStorage` (`beech.pendingSteamOrders.v1`) and retried on next boot or shop open via `QueryTxn/v3` / `FinalizeTxn/v2`.
- **Refunds & chargebacks:** Steam does not push refund webhooks. A scheduled hourly job calls `ISteamMicroTxn/GetReport/v5` (`type=CHARGEBACK` / `GAMESALES`) and calls the existing `refund('steam', transid)` revocation helper for any refunded or charged-back transaction.

## Steamworks features & Steam Deck (S4)

- **Achievements:** Lightweight milestones (`FIRST_DIG`, `FIRST_NEIGHBOR`, `WALK_SHORE`, `CHAIR_VIEW`, `NIGHT_BEACH`, `CLAW_WIN`, `VENDING_PULL`, `BURIED_FIND`, `FIVE_BEACHES`, `CHECKPOINT_SAVED`).
- **Rich Presence:** Shows current beach ("Digging at Bondi", "Watching the waves at Waikīkī").
- **Steam Deck Verified target:** Add a lightweight Gamepad API adapter (`src/input/gamepad.ts`) + official Steam Input controller profile, verify UI legibility at `1280×800`, and ship a native Linux x64 depot.

## Packaging & SteamPipe CI (S5)

- `electron-builder` builds **unpacked directories** (`target: "dir"`) for **Windows x64** and **Linux x64 (SteamOS)** (macOS Universal deferred until Apple Developer ID notarization is set up). SteamPipe handles compression and delta patching.
- `scripts/set-version.mjs` also updates `desktop/package.json`.
- `.github/workflows/release-steam.yml` (manual `workflow_dispatch`) builds both platforms and uploads depots to the `staging` Steam branch using a restricted Steam Build Account (`STEAM_BUILD_USERNAME`, `STEAM_BUILD_PASSWORD`, `STEAM_CONFIG_VDF`). Never auto-promotes to `default`.
- Cloud Run secrets (Secret Manager, never in git): `beech-steam-web-api-key` (`STEAM_WEB_API_KEY`) plus env vars `STEAM_APP_ID` and (while testing) `STEAM_SANDBOX=1`.

## Store assets & release timeline (S6)

Required 2024+ Steam graphical asset sizes (older dimensions are rejected):

| Asset | Dimensions (px) |
|---|---|
| Header Capsule | `920 × 430` |
| Small Capsule | `462 × 174` |
| Main Capsule | `1232 × 706` |
| Vertical Capsule | `748 × 896` |
| Library Capsule | `600 × 900` |
| Library Header | `920 × 430` |
| Library Hero (no text) | `3840 × 1240` |
| Library Logo (transparent PNG) | `1280 × 720` |
| Screenshots | ≥ 5 at `1920 × 1080` |
| App Icon | `184 × 184` JPG + `.ico` / `.png` |

**Compliance & lead times:**
- Pay `$100` Steam Direct fee + tax/banking verification (Day 0; 30-day minimum wait before release).
- Publish "Coming Soon" store page (3–5 day Valve review; must stay up ≥ 14 days before launch).
- Update `public/privacy.html` to mention SteamID and Steam persona name.
- Disclose UGC (beaches, first names, and beach names on the global shore and leaderboard; no chat; moderated via `beech-admin`) and in-app purchases. Keep Apple/Google/Xsolla links out of the Steam listing and client.
- Submit final build for Valve Build Review (3–5 days), disable `STEAM_SANDBOX`, promote `staging` → `default`, and launch.

**Steamworks Partner portal — owner steps (Mark; cannot be done from the repo):**
- Create the `ISteamMicroTxn` item definitions for the `steamItemId`s in `server/src/products.ts`, with prices matching the `usd` column exactly (Steam rejects a purchase whose price doesn't match the definition):

  | `steamItemId` | Product | Price (USD) |
  |---:|---|---:|
  | 1001 | Founder's pack | 9.99 |
  | 1002 | Extra beach | 2.99 |
  | 1003 | Three extra beaches | 6.99 |
  | 1004 | Lighthouse | 2.99 |
  | 1005 | Beach hut | 2.99 |
  | 1006 | Sandcastle | 1.99 |
  | 1007 | Surfboard | 1.49 |
  | 1008 | Tiki torches | 1.49 |
  | 1009 | Parasol | 0.99 |
  | 1010 | Deckchair | 0.99 |

- Create the 10 achievement definitions (IDs in `src/platform/steamFeatures.ts`, S4): `FIRST_DIG`, `BURIED_FIND`, `CHAIR_VIEW`, `NIGHT_BEACH`, `WALK_SHORE`, `FIRST_NEIGHBOR`, `CLAW_WIN`, `VENDING_PULL`, `CHECKPOINT_SAVED`, `FIVE_BEACHES`.
- Create the Rich Presence `#Status_*` display tokens matching the presence strings in S4.

## Milestones

- **S1:** Runtime abstraction (`src/platform/runtime.ts`), Electron + `steamworks.js` shell (`desktop/`), `app://beech` CORS origin, version script update.
- **S2:** `POST /api/auth/steam`, offline fallback, `user_identities` (migration 18) + 8-char cross-platform account linking.
- **S3:** `ISteamMicroTxn` server + client shop `'steam'` mode (migration 19) + `GetReport/v5` refund sync job.
- **S4:** Steam Achievements, Rich Presence, Gamepad API + Steam Deck `1280×800` verification.
- **S5:** Clean-machine Windows & Steam Deck beta testing. (The `.github/workflows/release-steam.yml` SteamPipe workflow itself was built in S1.)
- **S6:** Storefront capsules/screenshots/trailer, Coming Soon page, Valve review, and launch.
