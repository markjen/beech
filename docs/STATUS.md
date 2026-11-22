# Status

## Milestones

| # | Milestone | State |
|---|---|---|
| M0 | Scaffold (Vite + TS + Babylon, CI, Pages deploy workflow) | done |
| M1 | Diorama + camera (rest profile, slab strata, sky, far ocean, ortho camera with pan / pinch zoom to fingers / twist with 45° snap, desktop controls) | done |
| M2 | Sand toy (worker grid, screen-constant brush + ring, hold-to-deepen, rim, slump, undo/redo, second-finger cancel) | done |
| M3 | Waves (pipes water sim, swell sets, foam, wetting/drying, calm toggle) | done |
| M4 | Erosion (sediment pick-up/drop/transport, saturated slump, healing, `?debug=1` tuning panel) | done |
| M5 | Ambience (procedural audio, haptics, palettes + day cycle, start screen, hint, settings sheet, vignette) | done |
| M6 | Ship (benchmark quality tiers, dynamic resolution, PWA/offline, icons, Capacitor iOS + Android projects, mobile CI + store release workflow, docs) | done |
| M7 | Stretch (water table seepage, build + smooth tools, shells washing in, save/share a picture) | done |

## Decisions that differ from PLAN.md

- **WebGL2 is the default renderer.** The custom shaders are written in
  GLSL ES and run everywhere WebGL2 does (all current iOS/Android browsers and
  WebViews). WebGPU adds risk for little gain at this scene size.
- **Whole-frame texture uploads.** The worker sends one packed RGBA32F frame
  (sand, water, wet, foam) per tick, about 0.8 MB at the medium tier. The
  renderer keeps the previous and current frames and blends them in the vertex
  shader, so the 30 Hz sim looks smooth at 60 fps. Uploading only the changed
  region wasn't needed.
- **Sediment transport is donor-cell along the water pipe fluxes**, not
  semi-Lagrangian. The semi-Lagrangian scheme leaked sand at wet/dry edges.
  Donor-cell conserves sand exactly.
- **The far ocean is a short apron that fades into the mist.** An infinite
  plane reads as a wall under an orthographic camera.
- **Sand shading uses smooth heightfield normals plus 30% facet normal**, with
  a three-band toon ramp. Pure facets looked speckled at cell scale because of
  the alternating triangle diagonals.
- **Zoom goes in to a 0.45 m half-height** (`CAMERA.minHalfHeight`), close
  enough to look at a shell. Past the point where the 24 px brush would
  cover fewer than 2 cells, the brush stays 2 cells on the sand and grows on
  screen. The chair view zooms to a 0.12 rad field of view.
- **Minimum brush is 2 grid cells** (25 cm at the medium tier). This caps
  zoom-in, so the finest dig still looks clean on a 12.5 cm grid.
- **Dry sand angle of repose is 36°** (not 33°), so held digs in dry sand
  deepen visibly before they widen.
- **Second-finger cancel window: 220 ms.** Within that window the dig is rolled
  back exactly from the stroke snapshot. After it, the stroke is kept.
- **Varied waves** (2026-11-22): each swell component arrives at its own
  angle (up to ±22°, seeded per beach), so crests come in oblique and cross
  along the shore. The whole swell swings in sets: two slow groups (75 s and
  190 s), plus a sharp big set about every 5½ minutes (envelope 0.35–2×,
  `swellEnvelope`). The sim forces each column of its offshore row at that
  column's world x. The ocean and static-shore shaders get the same angles
  (`swellK`) and envelope (`swellEnv`), so they match. Full damping stays in
  the sponge rows at the forced edge.
- **The sea goes 8 m further out** (2026-11-22): the world is 32 × 32 m
  (was 32 × 24), with the extra rows on the offshore side. The shoreline sits
  16.5 m from the edge, and the offshore depth is 2.36 m (the same Dean profile,
  continued). To keep waves from losing height on the longer way in, the
  linear damping drops from 0.5/s in the shallows to 0.12/s in water deeper
  than about 1 m (`WATER.deepDamping`; a test checks the deep water stays free
  of the checkerboard mode). Run-up is back to its old reach. Older saves
  (ny/nx = 3/4) get sea rows added offshore and their objects moved up
  (`fitWorld`). The camera starts framed as before, and zooming out shows the
  whole sea.
- **Water stability:** with 2 substeps per 30 Hz tick, a checkerboard mode
  grew in deep water. The fix is linear flux damping 0.5/s plus capping the
  depth used for wave speed at 0.9 m (wave speed ≤ 3 m/s). A unit test guards
  this (`stability`).
- **Erosion capacity uses the slope of the disturbance** (`sand - rest`), not
  the absolute slope. The natural beach profile is treated as being in
  equilibrium with the waves. Without this, the whole swash zone eroded
  steadily. Player-made features still wear down (a 30 cm mound in the swash
  is gone in about a minute) while the untouched beach drifts by under 5 mm on
  average.
- **Saturated slump also applies next to water**, not only under it, so waves
  undercut walls the way they do in real sand.
- **Foam** only forms on thin, fast water moving landward (the run-up front)
  and on steep incoming bores. The offshore sponge rows never foam. The
  shader draws it as lace from two octaves of drifting noise, with a solid core.
- **The waterline and wet line are softened** in the vertex shaders by
  averaging each cell with its 4 neighbours, so they don't stair-step along
  the grid. Geometry still uses the exact depth.
- **Audio is procedural Web Audio, not Babylon's audio engine.** Pink noise,
  filters, a generated reverb impulse and oscillators make the bed, the wash
  (driven by the rate water runs up the beach face, which the worker measures
  each tick), the backwash fizz, the granular dig scrape, rare gulls and an
  optional pentatonic pad. The app ships no audio files.
- **The day cycle drifts dawn → day → golden → dusk over 20 minutes.** It
  holds each mood for 60% of its segment. A fixed palette can be picked in
  settings.
- **Settings are per-device conveniences in localStorage** (sound, music,
  haptics, battery saver, light, detail). Everything still works if storage is
  unavailable.
- **Battery saver renders every other frame** (about 30 fps). The sim rate is
  unchanged.
- **Quality tier** comes from a benchmark of the low grid in the worker on
  first launch (remembered in settings). `high` is desktop-only. On top of that,
  **dynamic resolution** drops the render scale in 0.25 steps (down to 0.75)
  when frames run long for 2 s, and climbs back after 8 s of headroom. The
  smoke and screenshot scripts pass `?fixedres` to turn this off.
- **PWA:** hand-written `public/sw.js`, network-first for page loads and
  cache-first for hashed assets. Not registered in dev or in the native shells.
- **Capacitor 8 with SPM for iOS** (no CocoaPods), appId `app.beech.beach`
  (a placeholder: choose the final one before the first store upload, see
  docs/MOBILE.md). Android release signing reads `BEECH_KEYSTORE_*` env vars,
  so no key material is ever committed.
- **App icon and splash are generated from code** (`scripts/make-icons.mjs`,
  an isometric beach tile), then turned into native assets by `@capacitor/assets`.
- **The look tool (hand, top of the column) is the default.** One finger or
  the left mouse button pans (in the chair view: looks around). Pinch, twist
  and two-finger tilt work as in every tool. Keys 1–4 pick look / dig /
  build / smooth.
- **Tools are a small column above the undo button** (dig / build / smooth,
  keys 1-3). Build adds sand from a "bucket" (it isn't taken from nearby), so
  the sand total goes up. Undo removes it like any other stroke.
- **Shells** are decorative props on the main thread. One spawns at the top of
  the run-up after a wave recedes (every 14-36 s), follows the sand height,
  drifts with the swash and fades after 2.5-5 minutes. They are drawn
  larger than life (about 15 cm) so they read at diorama scale.
- **Camera looks from the land toward the sea** (alpha = 135°), so the waves
  come toward the viewer.

## Real-world beaches (added after M7)

- `src/world/locations.ts` defines 13 popular beaches: lat/lon, IANA time
  zone, the compass bearing the beach faces, a wave scale, and sand and water
  tints.
- `src/world/astro.ts` holds the SunCalc-style sun and moon positions and moon
  phase. `src/world/live.ts` turns them into scene light (the sea is −Z, and
  facing the sea your right is −X), a sun-elevation palette with the new
  night palette, sky discs, stars and the status line.
- `src/world/tides.ts` is the harmonic prediction engine (28 constituents,
  Schureman phase convention as NOAA uses, nodal corrections). Constants come
  from TICON-3 via `scripts/extract-tides.mjs`. Tested against NOAA official
  predictions: Honolulu RMS 2.3 cm and highs/lows within 20 min (2 min
  observed); Santa Monica RMS 6.4 cm from a gauge 62 km away.
- Real tide → diorama: `0.3 m × sign(h) × (1 − e^(−|h|/1 m))`, sent to the
  worker every 2 s (`sea` message) and eased in over about 20 s.
- The sun and moon are drawn on the backdrop where the camera would see them
  over the sea. The far-ocean apron now fades out by 17 m, so a band of sky
  shows above the sea.
- Gulls only call in daylight, and the ocean bed is a little quieter at night.
- "Near me" uses the browser/OS geolocation once, on the device. The iOS
  `NSLocationWhenInUseUsageDescription` and Android `ACCESS_COARSE_LOCATION`
  are declared. The store privacy answer is still "Data Not Collected"
  (nothing leaves the device).
- Tulum was dropped: its nearest coastal gauge is 94 km away, and its main
  tide constant (7 mm) is implausible.

## Accounts, saved beaches and neighbors (built; production waits on GCP setup)

- **Production target: Google Cloud.** Cloud Run runs one container (the web
  app plus the API), backed by Cloud SQL for PostgreSQL. It deploys from
  `deploy-gcp.yml` with Workload Identity Federation. The setup commands are
  in docs/GCP.md, and the workflow is gated on `vars.GCP_ENABLED`.
  This replaced the earlier Cloudflare Worker + D1 draft, at the owner's
  request.
- **`server/`:** Node 22 + Hono + `pg`, with PGlite for local dev and tests.
  It covers Google/Apple ID-token sign-in, hashed bearer sessions, save/load
  beach, delete account, and neighbors (codes, left/right slots, reading a
  neighbor's beach, rotating a code). Migrations run at startup under an
  advisory lock.
- **Verified here:**
  - 11 server tests, on PGlite and on a real Postgres 16
  - the production Docker image builds; booted against Postgres it serves the
    app with immutable asset caching, rejects forged tokens, keeps dev auth
    off, and refuses to start with `DEV_AUTH=1`
  - browser end-to-end tests for accounts (sign in, dig, save, reload, delete)
    and neighbors (add by code, see their beach and name tag, pan over, move
    away)
- **Bugs found and fixed while building neighbors:**
  - the service worker cached `/api/*` GETs, which served one account's data
    to the next. It now bypasses the API (cache bumped to v2), and every API
    response is `no-store`.
  - a queued save from one account could land in the next account after a
    switch.
- **Not done:**
  - native sign-in in the Capacitor apps (Google blocks WebView OAuth)
  - Sign in with Apple on iOS (required once Google sign-in ships there)
  - mutual neighbor requests
  - live (rather than snapshot) neighbor sand

GitHub Pages: the `github-pages` environment only accepts the repo's default
branch, so the deploy job runs only there. Switch the default branch to
`main` to deploy Pages from `main`.

## Views (added after neighbors)

- **Tilt:** the diorama elevation ranges from 12° to 80° (default 34°).
  Two fingers side by side sliding vertically tilt (`classifyTwoFinger` in
  `src/input/gestures.ts`, unit tested). So do right-drag vertically and the
  R/F keys.
- **Chair view:** a second, perspective camera (`CameraController.mode`),
  at 1.15 m above the sand at the back of your beach, facing the sea. In this
  view the diorama apron and water cut-aways are hidden, and
  `src/render/horizon.ts` adds an open sea (the same swell shader, fading to
  haze over about 900 m) plus static shore either side, built from the same
  rest profile. Sun and moon discs are projected exactly. The brush radius
  depends on distance so it stays the same size on screen.
- **Walking the chair:** hold the ‹ › buttons (chair view only) or Q/E to
  move along the beach at 1.8 m/s (eased), across your neighbors' beaches
  too. The seat height follows your sand, then a neighbor's, then the rest
  profile. The static shore shader (`shoreFragment`) paints the swash: a wet
  band and a foam edge that rises and falls with the swell, phase-shifted
  along the shore.
- **Ambient/TV:** `src/ui/ambient.ts` hides idle controls and holds a screen
  wake lock. There's a full-screen button. Android TV gets the leanback
  launcher, optional touchscreen, and `res/drawable-xhdpi/banner.png`
  (generated by `npm run icons`).

## Inventory (added after views)

- **The bag** (top of the tool column) opens a tray. Rocks and driftwood are
  free and unlimited. With an item in hand a tap sets it down (random size,
  shape and turn) and a tap on something already there picks it back up.
  Both are undoable. Shop, mystery box and claw machine tiles show as
  "coming soon".
- **Rocks** raise the non-erodible `bottom` floor (and the sand) under an
  ellipse slightly inside the drawn rock. Water flows around them, sand scours
  beside them and settles in their lee, and they can't be dug. Removing one
  gives back the sand that was under it, plus anything that settled on top.
  Saves store rocks as objects, not sand (`withoutRocks`).
- **Driftwood** floats once the water is deeper than 1.1× its radius,
  follows the current averaged along its length plus a gentle onshore wave
  drift (so it comes ashore rather than out to sea), turns when its two ends
  feel different flow, and is stranded with sand friction when the water
  drains. It is clamped inside the beach.
- **Item size:** with an item in hand, a bar shows its name and a size
  slider, remembered per item in local settings. The slider maps
  logarithmically across the item's range (rocks 0.12–1.3 m radius,
  driftwood 0.5–3.2 m), with ±8% variation per placement. Flags have one
  size.
- **Shells and sea glass** sit on the sand and are rolled along at about
  half the flow speed when the water is fast (> 0.35 m/s), with a slight
  landward nudge. **Flags** stay put; the pennant flutters and points
  inland on the sea breeze.
- **The sea brings things in** every 70–160 s while the waves run:
  driftwood out at sea (it drifts ashore), or a shell or sea glass at the
  waterline. These are `wild`, are not undoable, and at most 6 stay; the
  oldest is taken back. This replaced the old decorative `ShellField`, so
  washed-up shells are now real objects that save with your beach.
- **Objects live in the worker** (`BeachObjects`). Their states go out with
  every frame, and the renderer eases toward them. Save format **BCH2** adds a
  deflated JSON list of objects. BCH1 saves still load. Loaded objects are
  validated (`sanitizeObjects`, 400 max).
- **Catalog** (`src/world/items.ts`): rarity common/rare/legendary/unique;
  source free/shop/event/pull; `unlimited`, `available {from, until}`,
  `price`. The server has an `inventory` table (migration 2) and
  `GET /api/inventory` for owned, unexpired non-free items. Nothing writes to
  it yet.

## The shore, visiting and favorites (added after item sizes)

- **The shore** is the chain of neighbor links: your left neighbor, their
  left neighbor, and so on, each way (up to 8; `GET /api/shore`). Beach `k`
  sits at x = k × 33.6 m. Only the beaches within 2 of the one under the view
  are drawn (`RENDER`). Beaches within 5 stay decoded in memory, and the rest
  load as you approach. Your own live beach is hidden once it's outside that
  window, and digging is off.
- **Walking:** pan along it in the diorama, or walk in the chair view (hold ‹
  › or Q/E). After a second of holding, walking speeds up to 4×. In the chair
  view the static shore fills the gaps between drawn beaches and runs on past
  both ends.
- **Home:** away from your own beach, a bar (top right; under the place
  label on phones) says whose beach you're on, with ☆ to favorite it and
  "⌂ my beach" to glide home. It pulses if you try to dig someone else's
  beach.
- **Visiting by code** (settings → visit): their beach takes the middle, with
  their shore either side, until you head home. **Favorites** come from ☆ on
  a name tag or on the bar. The list sits in the settings sheet, with visit
  buttons (`favorites` table, migration 4).
- The neighbor tags poll every 30 s across the whole shore.
- `npm run e2e:shore` covers walking, home, visiting by code, and favorites.

## Claw machine (added after chair polish)

- **Free daily claw machine** (production builds, signed in): one go per
  UTC day. The server draws the prize (`server/src/pulls.ts`, crypto
  randomness) with published odds: common 70% (conch, sand dollar), rare 25%
  (starfish), legendary 5% (message in a bottle). The app shows the odds
  before every go. Migration 3 adds `pulls`, keyed on `(user, pool, day)`;
  claiming the day and adding the prize happen in one SQL statement.
- **The game is cosmetic:** the claw wanders, you drop it, and it always
  comes back with a capsule coloured by the server's result. The request
  goes out as the claw drops.
- **Prizes in the bag** show "N of M left". You can have as many of an item
  on the beach as you own, and pulled items count toward that, not wild
  ones. Conch, sand dollar and starfish roll like shells; the bottle floats
  like driftwood.
- **Sandbox build:** the tile says "coming soon". Signed out (production):
  "Sign in to play". `tests/items.test.ts` checks that the server's pool
  items exist in the client catalog with matching rarity.

## Native sign-in (added after inventory)

- `src/net/nativeAuth.ts` wraps `@capgo/capacitor-social-login` 8.7.6. It is
  loaded only inside the apps, so the web bundle doesn't include it. Android
  offers Google (Credential Manager, token for the web client ID). iOS
  offers Sign in with Apple, plus Google when `VITE_GOOGLE_IOS_CLIENT_ID` is
  set. A cancelled sheet shows no error. Signing out also signs out of the
  provider.
- Facebook and Twitter are off in `capacitor.config.ts`. The merged Android
  manifest has no AD_ID permission.
- iOS: `App.entitlements` (Sign in with Apple) is wired via
  `CODE_SIGN_ENTITLEMENTS`. `scripts/native-auth-config.mjs` writes the Google
  URL scheme into Info.plist.
- Not verified on devices yet: that needs the OAuth clients and the Apple
  capability (DevOps; see BACKEND.md, "Phone apps").

## Deploy and build status

- **iOS:** the Xcode project builds for the simulator on GitHub's macOS
  runner (`mobile.yml`, first green run on the dev branch). That build is
  unsigned. A signed archive needs an Apple Developer team (`release-mobile.yml`).
- **Android:** a debug APK, an unsigned release AAB, and a release AAB signed
  from the `BEECH_KEYSTORE_*` env vars (tested with a throwaway key) all built
  locally. CI builds the debug APK and the release AAB too.
- **GitHub Pages:** live (the sandbox build). markjen.github.io/beech
  redirects to markjen.com/beech/, the owner's custom domain. Deploys run
  from the default branch (see "Accounts" above).
- **Web preview meanwhile:** the built game is published as a private
  claude.ai artifact (Beech Seaside Toy), made with
  `node scripts/artifact-page.mjs` after `npm run build`.

## Next steps owned by the repo owner (deferred by choice, 2026-11-22)

- **GitHub Pages:** enabled by the owner. The sandbox is live.
- **Store submission:** later. The owner will create the Apple Developer and
  Google Play accounts, pick the final app ID, and add the secrets listed in
  docs/MOBILE.md. Then run "Release to stores". Agents shouldn't attempt
  uploads before those secrets exist.

## Not verified here (needs real accounts or hardware)

- The store upload workflow (`release-mobile.yml`): needs Play and App Store
  Connect credentials. The first Play upload must be manual.
- Feel on real phones: touch latency, haptics, audio mix, thermal behaviour.
  The tuning panel (`?debug=1`) is the place to adjust these.

## Verification

- `npm test`: unit tests for the sim (water/sand conservation, run-up range,
  hold-to-deepen, rim fraction, undo/redo/cancel/reset, determinism) and the
  brush math.
- `npm run smoke` (or `SMOKE_URL=http://localhost:5173/ npm run smoke` against
  a dev server) drives a headless browser through these checks: the sim is
  running, a touch dig is cancelled by a second finger, a one-finger touch digs,
  a mouse dig changes the sand, undo restores it and redo re-applies it.
