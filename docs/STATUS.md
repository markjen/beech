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

Vacuuming shows which items were picked up when a stroke finishes. The claw
and vending prize cards can be closed while keeping the prize in the bag.

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
  enough to look at a shell, and **out to 28 m** (`CAMERA.maxHalfHeight`, or
  1.5× the single-beach fit height on narrow screens via `CAMERA.maxFitScale`)
  so neighbouring beaches along the shore fit in view at once. Past either
  brush bound, `brushRadiusOnSand` clamps the brush on the sand between 2 grid
  cells and `BRUSH.maxRadius` (2.2 m). The chair view zooms to a 0.12 rad field
  of view.
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
- **Stale tabs and the 32 × 32 world** (2026-11-23): a tab left open from
  before the world grew loaded square saves, squeezed the sand into
  32 × 24 and saved it back with the objects unmoved. Today's app then
  padded the sea and moved the objects 8 m up the beach, so flags and rocks
  floated off the land edge (seen on Rose's beach). Now the server refuses
  non-square saves (426, "reload to save"), and `fitWorld` doesn't shift
  objects that are already past the old world's edge, and folds any object
  still off the beach back on in 8 m steps. Sand already squeezed by an old
  tab can't be recovered, but it heals as the waves rework it.
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
- **Bulldozer** (last tool, key 5): drag to push the sand back to the
  untouched beach under a wide blade (1.5× the brush, flat in the middle).
  It never cuts through rocks, since it flattens to `max(rest, bottom)`. One
  stroke is one undo. On short screens (landscape phones) the tools sit in
  a row beside the undo button.
- **The look tool (hand, top of the column) is the default.** One finger or
  the left mouse button pans (in the chair view: looks around). Pinch, twist
  and two-finger tilt work as in every tool. Keys 1–5 pick look / dig /
  build / smooth / bulldozer.
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
- 2026-11-26: 21 more beaches (34 in all), each with a `region` for the
  picker. `scripts/extract-tides.mjs` now reads the ids and coordinates
  straight from `locations.ts`. The 70 km gauge rule (`tests/live.test.ts`)
  dropped 21 candidates, among them Reynisfjara (164 km), Lofoten (107),
  Navagio (314), Bora Bora (78), Tamarindo (116), Grace Bay (270), Durban
  (685) and Tel Aviv (469). Matira/Bora Bora's tiny tide is probably right,
  but its gauge is past the rule. `server/src/beachImage.ts` keeps its copy
  of the list in step (`tests/beachImage.test.ts`).
- **Place picker** (`src/ui/placePicker.ts`), replacing the row of chips:
  one row showing the place, its local time and weather; open, a search box
  (accents and case ignored, every word must match name, town or region),
  near me, a world map with every place as a tappable dot, and the places
  grouped by region, west to east.

## Real weather (2026-11-26)

- `GET /api/weather` (public, `server/src/weather.ts`): one Open-Meteo
  forecast request and one marine request cover every place (they take
  lists of coordinates). The report is cached for an hour and shared by
  all players, with one fetch at a time. When Open-Meteo is down, the last
  report is served for up to 3 hours, then 503. No player data goes
  upstream. Place coordinates come from the catch-up bundle
  (`placeCoords()` in `src/world/catchupBeach.ts`). Failed fetches are
  logged (`weather_fetch_failed`) and retried after a minute.
- Licence: Open-Meteo's free API is non-commercial only. `OPEN_METEO_API_KEY`
  (a paid plan) switches the server to the `customer-*` hosts with the key.
  The deploy passes it once the `OPEN_METEO_ENABLED` variable is set (the
  same optional-secret pattern as push); setting it up is an owner task in
  BACKLOG.md.
- The app (production builds only, `src/net/weather.ts`) fetches it at
  start and every 15 minutes, and keeps the last report in `localStorage`
  so the first frame is already right. The sandbox has no weather unless
  `?wx=<WMO code>` is in the URL (the same made-up weather everywhere, for
  screenshots).
- `src/world/weather.ts` turns a place's weather into a look (overcast,
  fog, rain or snow, storm, wind across the beach, cloud puffs).
  `LiveConditions` eases toward each new report (`WEATHER.easePerSecond`),
  but the first report, or a jump in time, shows at once. The look greys
  the sky, flattens the sunlight and greys the sea; fog closes in the
  horizon. A light picked in settings keeps a clear sky.
- The swell follows the measured offshore wave height:
  `0.35 + 0.45 √Hs`, blended 75 % with the beach's usual swell, plus up to
  0.12 for an onshore wind, clamped to 0.4..1.15 (the sim's tuned range,
  so no physics change). The tide still scales it as before.
- The sky backdrop draws drifting cloud puffs (redrawn when they've moved a
  whole texture pixel) and hides the sun, moon and stars behind cloud.
  Rain and snow are a 2D canvas over the scene (`src/render/precip.ts`),
  up to 260 strokes, off in battery saver. The status pane's first line
  reads e.g. "☂ 8:12 am · rain 14°C · gentle swell" (°F for US locales).
- Data credits (CC-BY 4.0: TICON-3 and Open-Meteo) are in the guide.

## Accounts, saved beaches and neighbors (built; production waits on GCP setup)

- **Production target: Google Cloud.** Cloud Run runs one container (the web
  app plus the API), backed by Cloud SQL for PostgreSQL. It deploys from
  `deploy-gcp.yml` with Workload Identity Federation. The setup commands are
  in docs/GCP.md, and the workflow is gated on `vars.GCP_ENABLED`.
  This replaced the earlier Cloudflare Worker + D1 draft, at the owner's
  request.
- **Sign-in button (2026-11-26):** signed out, a green **Sign in** pill sits in
  the lower-left corner of the title screen and the beach (`hud-sign-in`,
  `src/main.ts`); it opens the account sheet and hides once signed in. The guide
  coach, walk bar and place bar move up by `--sign-in-space` on phones to clear it.
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
  - live (rather than snapshot) neighbor sand: designed in
    [LIVE_SIM.md](LIVE_SIM.md), with server catch-up while the owner is away

GitHub Pages (removed 2026-11-22): the `github-pages` environment only
accepted the repo's default branch, so the deploy job ran only there.

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
  "coming soon". (Later: the claw and the vending machine replaced them;
  the vending machine's paid balls are the mystery box, Mark 2026-11-27.)
- **Signed out** (accounts build), the bag shows "You’re not signed in" with a
  sign-in button at the top (`InventoryTray.setSignIn`); the sandbox build
  doesn't.
- **Rocks** raise the non-erodible `bottom` floor (and the sand) under an
  ellipse slightly inside the drawn rock. Water flows around them, sand scours
  beside them and settles in their lee, and they can't be dug. Removing one
  gives back the sand that was under it, plus anything that settled on top.
  Saves store rocks as objects, not sand (`withoutRocks`), and when sand is
  piled over any rock, a separate `cover` layer (**BCH3**, and optional `cover`
  + rock `base` in `.beach.json`) keeps the cover across reloads, checkpoints,
  exports, neighbor views and beach previews. Overlapping rocks each sit on
  the terrain, never on another rock's dome, so their lifts don't stack;
  loading an old save with stacked rocks re-bases just those and smooths away
  the spire they built (`repairLoaded`).
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
  deflated JSON list of objects, and **BCH3** adds a deflated rock-cover layer
  when any rock is buried. BCH1 and BCH2 saves still load. Loaded objects are
  validated (`sanitizeObjects`, 2000 max; 400 before 2026-11-23).
- **Catalog** (`src/world/items.ts`): rarity common/rare/legendary/unique;
  source free/shop/event/pull; `unlimited`, `available {from, until}`,
  `price`. The server has an `inventory` table (migration 2) and
  `GET /api/inventory` for owned, unexpired non-free items. Nothing writes to
  it yet.

## Smoother scrolling past deep beaches (2026-11-27)

Scrolling past a beach with sand rows, inland sections or a pier hitched.
Measured by panning along the shore: (1) section rows show one beach past
the draw window but slots only exist inside it, and `from` came from the
slot's grid, so a beach's rows were built with `from` 0 and again with its
sand rows each time it crossed the window edge. `syncSections` now falls
back to the depth the beach is loaded at (prefetched 2 out). (2)
`SectionLayer` and `PierLayer` hide rows and piers that leave the view and
reuse them (up to 6 beaches' rows, 3 piers) instead of disposing. (3) The
sand/water grid arrays are cached by grid size (`gridArrays`, 4 sizes), so
a slot no longer rebuilds them; they were most of a slot's CPU cost, and a
deep beach's grid is up to ~1.75x a plain one. Slot creation roughly halved
(e.g. 336 rows: 12-24 ms to 9-14 ms on the dev box).

## Seam streak fixed (2026-11-27)

Where a deeper beach (sand rows or inland sections) met a shallower linked
neighbor, a long striped sliver shot from that corner to the top-right of
the screen. The skirt shader hid a linked side's wall by moving its vertices
outside clip space; the one quad with hidden and shown corners was clipped,
not dropped. It now passes `vHide` and discards in the fragment shader (the
mixed quad is cut at the neighbor's back edge). `tests/skirtShader.test.ts`.

## Inland rows on beechshore.com's pictures (2026-11-27)

Mark: make the pictures taller. Thumbnails and a beach page's flat view
(`/img/CODE/plan.png`) are taller by the rows, drawn from the app's own row
shapes (now in Babylon-free `src/render/sectionShapes.ts`, bundled into
`server/src/generated/sections.ts`). The link-preview card stays 1200×630.
Rows are in the picture version. Not yet in the 3D views. INLAND_SECTIONS.md.

## Admin system messages (2026-11-27)

Admin console → **News**: one message (≤140 characters) to every player's
inbox, announced as "News from beech" and pushed to those with **news** on
(a new notification switch, on by default). At most one a UTC day; a
retried request never sends twice. Modelled first
(`specs/tla/SystemMessages.tla`). Migration 44 (`system_messages`,
`notify_prefs.news`, `inbox_unpushed` gains `system`).

## beechshore.com shows beaches caught up (2026-11-27)

A beach's page and pictures on the shore site run the sea's catch-up first
(the game's `live.ensure`), and picture URLs carry the sand's `version`
too, so a beach nobody opened in the game shows what the tides did, with no
stale cached picture. LIVE_SIM.md.

## Pier deck vs storms (2026-11-27)

Simulated the worst case (the sim's highest tide, surf, the biggest real
swell, a day's worst set): water under the pier's seaward end reaches about
1.33 m, which washed over the first 1.35 m deck. `PIER.deckHeight` is now
1.65 m (underside 1.51 m), `landY` 22 m and `footHeight` 0.43 m (ramp about
17°). A unit test runs that storm (`tests/pier.test.ts`, ~4 s).

## Inland sections: replace a row in place (2026-11-27)

The sections editor's rows have **replace**: the add buttons become **→
type** and swap that row (`replaceRow`), the rest stay put. Client only:
the same `PUT …/sections { rows, rev }` saves it. `e2e:sections` covers it.

## Copy sheet: a place for a new beach (2026-11-27)

"+ a new beach" on the copy sheet shows the place picker (the same one as
Settings), starting at the original's place; `POST /beaches/mine/copy`
already took `location`, now tested.

## Push alerts (2026-11-27)

Two alert policies in `infra/monitoring.tf` (not applied yet: `terraform
apply` from `infra/`): a failing push tick (`push_tick_error`, now also
logged by `POST /api/push/tick`, the route Cloud Scheduler calls) and a
high mean `failed` count per pushing tick. OBSERVABILITY.md.

## Promo codes give bonus beech bucks (2026-11-27)

Promo codes give bonus beech bucks (`bucks` or `percent` of a pack's bb),
never a discount on the charged amount (replaces the account-loaded model
from #148; migration 43, `specs/tla/PromoBucks.tla`, `server/src/giftCards.dfy`).
A `bucks` code redeems on its own (`POST /codes/redeem`, or the gift card
box) or rides on a pack bought on the web; a `percent` code rides on a pack
bought on the web. Refunds claw back the bonus (`promo_bonus_refund`).
GIFT_CARDS_PROMOS.md, WEB_PAYMENTS.md, STATE_MACHINES.md.

## Suspending a sender's notes (2026-11-27)

From a report in the admin console: suspend the sender's notes for 1, 7,
30 or 365 days (optionally hiding every note of theirs still shown), or
lift it. While it lasts a visit carrying a note is refused (403); ratings
and gifts go through. Migration 42 (`users.notes_suspended_until`).
Modelled first (`specs/tla/NoteSuspension.tla`); the check is inside the
visit's transaction under the sender's row lock. INBOX_NOTIFICATIONS.md,
STATE_MACHINES.md.

## Moving things by long-press (2026-11-27)

Long-press a thing you set down, drag, let go: it moves (one undo step),
on the live beach and on your beaches next door, in look mode (palm only)
and with a tool picked. It was already built; the backlog entry was stale.
`npm run e2e:sandbox` now covers both modes, and the guide's Bag section
says how.

## Admin: trade-ins and debts (2026-11-27)

A read-only Beech bucks tab in the admin console (`GET /api/bucks`):
trade-in totals, debts and the latest trade-ins. BEECH_BUCKS.md.

## Pier preview is a ghost (2026-11-27)

The pier preview is drawn see-through and paler until it's placed
(`GHOST` define in the prop shader; `PierLayer` keeps solid and ghost
materials and swaps them in place). `npm run e2e:piers` checks it's a ghost
in preview and solid once placed. Perf within budget.

## Ratings in the shore bar (2026-11-27)

Every beach in the shore walk (`/shore`, `/shore/more`, `/public/shore`,
and anything else built on `NODE`/`beachJson` in `server/src/shore.ts`)
carries `rating: { average, count }` once it has 3 ratings. The expanded
status pane's shore bar shows it with a shell ("4.6 · 12") while you look
at someone else's beach; the floating name tags it was planned for were
replaced by the shore bar on 2026-11-25.

## Admin: referrals view (2026-11-27)

The admin console has a read-only Referrals tab (`GET /api/referrals`):
totals, the top 20 inviters and the latest referrals, searchable by either
side's name, email, player id or the invite code. See INVITES_GUIDE.md.

## More guide steps (2026-11-27)

Four more steps in the beach guide (INVITES_GUIDE.md): `clear` (a stroke
with the bulldozer, flatten or vacuum) and `calm` (waves set to calm) are
app-checked and work in the sandbox; `vending` (a vending pull exists) and
`checkpoint` (a named checkpoint of your own beach or an import) are
server-checked. The bonus needs every step but `invite`, so players who
finished the old nine get it once they do the new four.

## Your account on beechshore, bb, bag trade-ins, invite bonuses (2026-11-26)

Owner request. Details in [BEECH_BUCKS.md](BEECH_BUCKS.md) ("App", "Your
account on beechshore", "Invite bonuses") and
[INVITES_GUIDE.md](INVITES_GUIDE.md).

- **bb:** beech bucks are written bb in the shop, copy sheet, pier button and
  bag; the shop's balance reads "N beech bucks (bb)" (the owner's wording).
  Product names in the stores still say "sand bucks" (update them in App
  Store Connect and the Play Console — owner task).
- **beechshore.com/account:** sign in with Google or Apple right on the
  page (or connect through the game as before), then balance,
  history (every `credit_ledger` row, labelled by `server/src/ledger.ts`),
  card top-ups through Xsolla (returns to the page), gift cards, gifting a
  thing by beach code, and the invite link with who joined. Link more
  sign-ins under "Connected sign-ins" on the page. Forwarded to the
  game API's `/shore-account/*` routes (sign-in to `/shore-auth/*`),
  which take only the shore token.
  Settings → Account links to it too (signed in only; the apps open it with
  `?from=app`, so no top-up or gift card there).
- **Moved out of the game:** gift card redeem (shop), gifting (place bar)
  and the invite panel (`src/ui/invite.ts`, deleted). The web shop links to
  the account page; the apps don't link to it from the shop, and open it
  with `?from=app` (no top-up or gift card there) from the bag's gift button
  and "invite friends".
- **Bag:** "long press item to trade in" under the title (a note in the game
  at the owner's request, an exception to the no-notes rule). Long press or
  right click opens a dialog: how many, "you get bb X", trade in, gift.
  The place bar has no trade/gift buttons any more.
- **Invites:** bb 50 to the friend and to the inviter (first 10 friends) in
  the claim's transaction (`specs/tla/Invites.tla`, migration 37). Legacy
  referrals keep the item ladder. The inviter hears "Fran joined through
  your invite: +bb 50" on their next sign-in.
- **Follow-ups:** watch invite-bonus farming (each throwaway account needs
  its own Google/Apple sign-in; the bonus is now instant, not after three
  guide steps). Apple review: the account page sells packs by card, so the
  apps only open it with `?from=app`; check that's enough for App Review.
  The `invite_settled` push and inbox kinds now only come from legacy
  referrals.

## Shop (added after more than one beach)

- **Items:** parasol, surfboard, tiki torches (rare); sandcastle, beach hut,
  lighthouse (legendary); deckchair. Rare, legendary and shop things glow on
  the sand and sparkle (`src/render/glow.ts`). Lamps and flames glow warm.
- **Products and prices:** `server/src/products.ts`, with the plan in
  docs/PRICING.md. All consumables. The founder's pack is featured.
- **Buying:** the shop (bag → Shop, or "get one in the shop" under your
  beaches). In the apps it uses `@capgo/native-purchases` (StoreKit 2 /
  Play Billing). The proof goes to `POST /api/store/purchase`, the server
  checks it (Apple: certificate chain to the pinned root plus signature,
  offline; Google: the Play Developer API) and grants once. Unconfirmed
  hand-overs are kept and retried (`beech.pendingPurchases.v1`). On the web
  the shop pays through Xsolla Pay Station when the server has it set up
  (docs/WEB_PAYMENTS.md: `POST /api/store/web-checkout`, a signed webhook
  grants once, refunds and cancellations revoke; migration 13), and says to
  buy in the app when it isn't — which is today, until the Xsolla account
  exists. Promo codes apply to credit only, not card payments. When a
  product can be bought with gift-card credit too, its two buttons share a
  row of their own under the text (2026-11-24): on a phone the card is only
  340px wide, and four flex children in one row squeezed the description
  to a word per line.
  Development builds use a pretend store (`platform: dev`, DEV_AUTH only).
  Xsolla checkout uses the player's IPv4 address when available and falls
  back to an explicit country region from their browser locale.
- **Capacitor plugins never travel bare through a promise** (2026-11-26):
  a plugin is a Proxy that answers every property, `then` included, so
  `import(…).then((m) => m.Plugin)` or an async function returning it never
  settles on a device. That kept the app's shop on "Opening the shop…"
  (`native()` in `src/net/shop.ts`) and would hang native sign-in the same
  way (`plugin()` in `src/net/nativeAuth.ts`); both now box the plugin
  (`{ purchases }`, `{ plugin }`). Covered by `tests/shopNative.test.ts`.
- **Refunds:** App Store Server Notifications V2 and Play RTDN expire the
  granted items (migration 8: `purchases`, `inventory.purchase_id`).
- Not tried against the real stores yet: that needs the products set up
  (owner task; MOBILE.md, "In-app purchases").

## More than one beach (added after the claw starter gifts)

- See docs/MULTI_BEACH.md. Settings → "your beaches" lets you open one here,
  rename it, make it home, remove it, or make a new one (allowance = 1 + extra
  beaches owned, cap 8). The player-facing "off the shore" toggle is removed
  for now (admin hide/unhide via `on_shore` remains).
- **No current beach (2026-11-25, docs/BEACH_STORE.md).** The client keeps
  every beach's state in memory by id (`BeachStore`, LRU-capped at
  `BEACH_STORE.capacity`); drawing, editing, saving, checkpoints and pets all
  name an id. The wave worker simulates the beach of yours nearest the
  centre of the view and moves (sand *and* undo history, through the store,
  nothing refetched) when the view settles on another one. Undo is one order
  across beaches. A device remembers the beach it was looking at
  (`beech.view.v1`, a view bookmark) instead of an active beach
  (`beech.activeBeach.v1` is gone), so different devices can still watch
  different beaches. The shore API sends each beach's `id`. Switching accounts
  keeps the device beach separate from sand saved to an account.
  Other people's beaches are kept on the device too (IndexedDB, by id,
  checked against the shore's save time), so a reload or re-anchor draws
  them without refetching; when the waves move onto a beach its snapshot's
  water eases into the simulation's (`BEACH_STORE.liveEaseMs`). The handoff
  starts with the new beach's sand. Clearing the IndexedDB cache on sign-out
  also invalidates writes from requests already in flight.
- Neighbors, requests and codes in settings follow the selected beach
  (`?beach=`); the shore is laid out around an anchor (home, a beach you
  went to, or one you're visiting). Putting one of your own beach codes next to another links them
  at once, with no request.
- The bag counts non-free items across all your beaches. The server counts
  each save's things itself (the app's `X-Beach-Items` is ignored since
  2026-11-25), and "N of M left" includes the other beaches' counts.
- `npm run e2e:beaches`: two devices, two beaches, digging at once, linking
  them, the waves following the view across the seam, and remembering the
  beach in view per device. Needs DEV_AUTH for
  `/api/dev/grant`.

## Inland sections (built 2026-11-26)

[Inland sections](INLAND_SECTIONS.md): up to four 32 × 12 m rows behind
each beach, from eight types, as scenery. Differences from the design are
listed in INLAND_SECTIONS.md (beech bucks, counted rather than per-copy
IDs, no editable sand yet).

- Server: `beach_sections` and `beach.sections_rev` (migration 38),
  `PUT /beaches/mine/:id/sections {rows, rev}`, `sections` and
  `sectionsRev` per beach and `sections {owned, placed}` in
  `/beaches/mine`, `sections` on beaches in shore data (signed in and
  public). Placed rows count as placed for the bag, trade-ins and gifts.
  Catalog in `server/src/sections.ts`, mirrored by `src/world/sections.ts`.
- Client: the editor (`src/ui/sectionsEditor.ts`) from Manage → Beaches;
  `SectionLayer` (`src/render/sections.ts`) drawn by `NeighborView`, with
  joins derived from the shore; the camera pans inland over them.
- Tests: `server/test/stateMachines/sections.test.ts` (transitions,
  replays, random walk), `tests/sections.test.ts`, `npm run e2e:sections`.
- **Playable sand (2026-11-27).** Sand extensions straight behind a beach
  make the beach's own grid deeper (12 m a row), so they dig, sculpt, take
  molds, undo and hold bag items exactly like the beach, and join a linked
  neighbor's at the same row. Differs from the design (own 128 × 48 grid
  per copy): leading sand rows only, sand goes with the row's position, and
  taking a row away drops its sand (things on it back to the bag). Details
  in INLAND_SECTIONS.md, "Playable sand: what was built". Tests: `tests/sim.test.ts`
  ("sand rows inland"), `tests/sections.test.ts`, `npm run e2e:sandrows`.

## Piers (built 2026-11-26)

[Piers](PIERS.md): the middle of three of your own beaches side by side can
hold a timber pier (18 m deck from dry sand out over the water, paired
pilings, rails, a wider end platform). Decorative only.

- **Bought with beech bucks**, not as its own real-money purchase (the design
  said $2.99): `item_pier`, 30 beech bucks, a `pier` in the bag. Differs from
  the design because the shop moved to beech bucks; a pier is counted
  against what's owned rather than tied to one order.
- Manage → Beaches lists each site under your stretches: **buy pier · 30
  beech bucks** (short of bucks: the shop at the packs), **place pier** with
  a spare in the bag, **remove pier**, and **pier paused** when a side link
  is gone. Placing shows the pier on the beach first with **place pier** /
  **cancel**.
- Server: `beach_piers` (migration 34), `PUT`/`DELETE
  /beaches/mine/:id/pier`, `pier` on beaches in shore data (signed in and
  public), `pier`/`pierSite` per beach and `piers {owned, placed}` in
  `/beaches/mine`. Placed piers count as placed for the bag, trade-ins and
  gifts.
- Drawn by `NeighborView` for every beach in view, yours or anyone's, at
  the beach's centre (`src/render/pier.ts`, `PIER` in config).
- beechshore.com draws it too: the card, the thumbnail and both 3D views
  (`server/src/beachImage.ts`), with the pier in each picture URL's `?v=`
  so a placed, removed or paused pier shows at once (SHORE_SITE.md).
- Not yet: tuning the deck height against big real tides (1.35 m above
  still water now).
- Tests: `server/test/stateMachines/piers.test.ts`, `tests/pier.test.ts`,
  `npm run e2e:piers`.

## Mutual neighbors and the global beachfront (added after the bulldozer)

- **Asking and accepting:** in settings, put a code in "left" or "right" and
  press ask. The row says "waiting for … · take back" until they accept.
  The other person gets a dot on the settings button and an "X wants to be
  on your left · accept · no thanks" row. Accept is disabled while that side
  is taken.
- **Global shore:** past the ends of your stretch, the shore carries on into
  everyone else's beaches (see BACKEND.md). The shore view loads 6 each way,
  then pages 6 more whenever the view gets within 3 of the end of what's
  loaded. Beaches loaded by scrolling survive the 30 s refresh unless the
  shore near the middle changed.
- `npm run e2e:neighbors` covers asking, the badge, accepting from the
  sheet, the live update and unlinking both ends. `npm run e2e:shore` covers
  a 3-beach stretch, the shore continuing past it, and infinite scroll.

## The shore, visiting and favorites (added after item sizes)

- **The shore** follows neighbor links: your left neighbor, their left
  neighbor, and so on, each way, then on into everyone else (`GET /api/shore`).
  Linked neighbors sit 32 m apart (zero gap) and unlinked beaches keep the
  1.6 m diorama gap (`src/render/shoreSpacing.ts`). Along a linked boundary,
  the outer mesh columns meet flush at ±16 m, internal skirts and apron side
  fades are suppressed, neighbor beaches animate rolling waves, swash and
  foam on the GPU in sync with the live swell, and sand, normals, wetness,
  water depth and foam blend smoothly across 1.75 m on each side
  (`BeachRenderer.setNeighbors`, `src/render/shaders.ts`). Offshore, the
  simulated water meets the far ocean apron/open sea flush at row `j = 0` with
  matched swell height, lighting, specular, crest fade and deep-water opacity
  so there is no visible boundary line. In the diorama every beach the view
  covers is drawn, worked out from the camera's footprint on the ground
  (sand and open sea), so zooming out draws more (at most 6 either side,
  `RENDER_MAX`); the chair view draws 2 either side (`RENDER`). A drawn beach
  stays drawn until it's a whole beach out of view (`KEEP_MARGIN`), so
  panning to and fro doesn't rebuild it, and 2 more each way are fetched
  ahead without drawing (`PREFETCH`). The store holds up to 20 beaches
  (`BEACH_STORE.capacity`); the rest load as you approach. (Until 2026-11-25
  it was a fixed 2 either side, which left beaches popping in and out at the
  edges when zoomed out.) Your own live
  beach is hidden once it's outside that window, and digging is off.
- **Walking:** pan along it in the diorama, or walk in the chair view (hold ‹
  › or Q/E). After a second of holding, walking speeds up to 4×. In the chair
  view the static shore fills the gaps between drawn beaches and runs on past
  both ends.
- **Home:** just past your own beach, a bar stacked under the beach name
  at the top left says whose beach you're on, with ☆ to favorite it and
  "⌂ my beach" to glide home.
- **Away from home (2026-11-25):** once you're looking at someone else's
  stretch of shore — visiting a beach by code, or scrolled away from your
  own — no name tags float over the sand. The beach names stack under the
  beach name at the top left instead: tap it to open a card with the name
  cards for the beaches in view, nearest first — same names, stars and
  "ask to be neighbors" buttons as the tags had, just behind the tap. The
  bar above it says whose beach you're on, with ☆ and "⌂ my beach". Trying
  to dig someone else's beach nudges the beach name.
  (`src/ui/shoreInfo.ts`, `NeighborView.viewing`.)
- **Visiting by code** (settings → visit): their beach takes the middle, with
  their shore either side, until you head home. **Favorites** come from ☆ on
  a name tag or on the bar. The list sits in the settings sheet, with visit
  buttons (`favorites` table, migration 4).
- The neighbor tags poll every 30 s across the whole shore.
- `npm run e2e:shore` covers walking, home, visiting by code, and favorites.
- **The 3D views (2026-11-24):** every beach page has Flat / 3D / From the
  sea buttons on its picture, and `GET /img/:CODE/iso.png` (from the land)
  and `GET /img/:CODE/iso-ocean.png` (from the sea) serve the 3D isometric
  views (1200×630, same cache behaviour as the card, keyed on the beach's
  and its neighbours' save times). The real heightfield, water with swell
  lines, sand with a slow grain, and billboarded things at the ground
  scale show with one public beach either side — linked flush, unlinked
  with the 1.6 m gap — and the neighbours mirror between the two views,
  because you are looking from opposite directions. The frame fits the
  centre beach plus a 4 m sliver of each neighbour, so the beach being
  shared is the subject (it spans 516 px, 43% of the picture width); a
  side with no public neighbour shows no shore at all, with no faded
  filler. Only public beaches ever appear; a non-public neighbour
  renders as untouched shore.
  `og:image` stays the top-down card. Samples: `docs/shore-iso-sample.png`
  (ocean) and `docs/shore-iso-land-sample.png` (land), re-rendered from a
  constructed player-like beach by `server/scripts/render-iso-samples.ts`.
- **The flat card has no shoulders (2026-11-24):** the top-down card is
  exactly the beach edge to edge — the 32 m beach is stretched alongshore
  to fill the 1200 px width, so the pale bands of empty shore that flanked
  it are gone. Things keep their size and shape; terrain features stretch
  1.22× horizontally (a dug moat reads as an ellipse). Before/after:
  `docs/shore-card-before.png` and `docs/shore-card-after.png`.

## Leaderboard (added after more than one beach)

- **A trophy button** (bottom left, production builds only) opens the
  most-starred beaches, everyone's, in two tabs: **All time** (stars now)
  and **Rising** (star velocity: each star from the past week, halved
  every 2 days of age; see BACKEND.md, "Leaderboard"). Rows show rank
  (gold, silver, bronze for the top three), the beach or owner's name and
  the real beach, stars and "▲ N this week", a ☆/★ toggle and **visit**
  (closes the panel and visits by code; "open" for your own beaches, which
  opens that one on this device). Stars made elsewhere (name tags, the
  shore bar) update the open board.
- Off-shore and never-saved beaches aren't listed. Signed out, the panel
  offers sign-in. The sandbox has no button.
- Migration 10 adds `star_first` (when each person first starred each
  beach), so re-starring can't make a star look new.
- `npm run e2e:leaderboard` covers ordering, rising, starring from the
  board and the shore bar, visiting from the board, and signed out.

## User guide, help and release notes (2026-11-23)

- **No notes in the game.** The owner asked for the game UI to carry no
  explanatory notes. Removed: the controls hint after the start screen, the
  claw's rest note, odds and grab chances, the vending machine's set and odds,
  the leaderboard blurbs and "tap ☆" hints, the multi-device tip and the
  "win one from the claw machine" line in the account panel, the checkpoint
  explanation and its button tooltip, the new-code tooltip, the bag's "tap the
  sand" tip and the extra beach's description, "coming soon" tooltips, the
  beach-file format pointer, the "no bag" and "this replaces the beach"
  lines in the import preview, the shop's payment small print, and "detail
  changes apply on next launch". Kept: labels, status (next go in…, loading,
  errors, "N more buried today"), and confirmations (added to your bag).
- **The guide** is on the website: `/guide` and `/guide/releases`
  (`server/src/guide.ts`, `releaseNotes.ts`; `/help` and `/releases`
  redirect), served by the production server, so at beech.games/guide. The
  numbers come from the server's constants, so odds can't drift. Settings
  has a "guide & help" link, and the claw and vending machines a small
  "odds and how it works" / "this week's set and odds" link to their
  sections (`GUIDE_URL` in `src/config.ts`, absolute, so the apps and the
  sandbox reach it too). The sandbox build (no accounts) has no guide of its own.
- **Release notes** are backfilled from the backlog for 2026-11-22 and
  2026-11-23; CLAUDE.md now asks for a line with every player-visible change.
- **The landing page** is on the website too: `beech.games` serves
  `server/src/landingSite.ts` (Host-header routing in `rootApp.ts`; www
  301s to the apex; the game API is not served there), previewable under
  `/landing` on every other host. Updated (2026-11-24) with an editorial hero,
  an interactive Dawn/Day/Golden/Dusk lighting showcase of UI-free in-game 3D
  renders (`public/landing-assets/`), a **Play now on web** CTA, a **Google
  Play** store link (`app.beech.beach`), and an **iOS coming soon** badge
  (docs/LANDING_PAGE.md).

## Visitors and the inbox (2026-11-24)

Design, as-built notes and decisions in [INBOX_NOTIFICATIONS.md](INBOX_NOTIFICATIONS.md).
Phases V1–V4 are built; push (V5 web, V6 native, and Steam's own
notifications) is built too (2026-11-26) and waits on the owner's keys
(below).

- **Notifications (2026-11-26).** Modelled first (`specs/tla/Push.tla`,
  STATE_MACHINES.md). Web push (VAPID + RFC 8291 in `server/src/push.ts`,
  no new server dependency), APNs straight from the server for the iOS app
  (not through Firebase, unlike the earlier plan), FCM for the Android app,
  and on Steam the running game shows OS notifications from the poll
  (Electron `Notification`; Steam has no push service). Migration 33
  (`push_subscriptions` tied to the session, `push_state` as the push
  lock, `notify_prefs`, `inbox.pushed_at`). The sender commits its claim
  before sending, then rechecks device sessions and preferences under lock.
  Preference edits on different devices preserve each other's changes.
  One push an hour, none from 22:00 to 08:00 on the device clock, never
  stars or ratings, never a note's
  text. The game asks once, after the first pushable thing arrives; the
  switch and three kinds are in Settings. Each platform is on once its
  settings exist (the deploy adds them only when their GitHub variables
  are set); native app builds opt in with `NATIVE_PUSH=1`. Tests:
  `server/test/push.test.ts`, `server/test/stateMachines/push.test.ts`,
  `tests/notify.test.ts`, `npm run e2e:push` (the dev server makes
  throwaway VAPID keys). Not yet tried on a real phone or browser push
  service: headless Chromium refuses push subscriptions.

- **Signed-out visits** use main's read-only 3D visits (the beechshore
  follow-ups: `/api/public/…`, strictly `isPublic`). On top of that, an
  `?invite=` link opens the inviter's beach the same way, and a sign-up
  from a plain `?visit=` link claims that beach's owner as the inviter.
  Signed out, `NeighborApi.get` no longer asks the server every 30 s.
- **The visitor card** ("leave something" on a beach's name tag, which
  main's viewing mode shows in the "i" card while visiting): 1–5 shells, a
  note (280 characters, or quick notes; quick only for an account's first
  day) and a gift from the bag (owned, non-free things only). Signed out,
  the button opens sign-in, then the card. One inbox row per visit; ratings
  alone fold into one row a day. The card shows the beach's average from
  3 ratings. The invite panel, inbox and visitor card load in their own
  chunk after sign-in (bundle budgets raised 340→345 / 440→450, see
  perf/budget.json).
- **The inbox** (envelope, top right, signed in): unread badge from the
  30 s neighbors poll (`inbox` in `GET /api/neighbors`), a note over the
  beach for visits, gifts, neighbor requests and links, and friends settling
  in. Rows for visits, gifts, neighbor requests (accept / decline in place),
  new neighbors, stars and ratings (per day), and invites. Say thanks,
  visit, report a note, block (two taps); unblock from "blocked".
- **Safety:** a server-side note filter (links, handles, phone numbers,
  blocked words with masked vowels), rate limits (10 notes an hour, 3 a day
  to one beach, a rating change a day, gifts 20 an hour), blocks (silent;
  they stop ratings, notes, gifts and neighbor requests, and hide past
  rows), reports, and the admin console's **Reports** tab (hide the note
  or dismiss; audited).
- Gifts from the bag, neighbor requests and links, first stars and invite
  joins / settles now each write their inbox row in the same statement.
- Migration 24: `notes`, `ratings`, `blocks`, `reports`, `inbox`.
- Tests: `server/test/inbox.test.ts` (17), a reports test in
  `server/test/admin.test.ts`, `tests/inboxText.test.ts`,
  `npm run e2e:inbox` (two browsers, the whole loop).
- **No notes in the game:** the guide's coach card, checklist and invite
  panel lost their explanations (they're in the web guide now, Beach guide,
  Invites and Visitors sections), per the CLAUDE.md rule merged from main.

## Invites and the beach guide (2026-11-23)

Design and decisions in [INVITES_GUIDE.md](INVITES_GUIDE.md).

- **The beach guide** (compass button, top of the tool column, with a
  `3/9` badge): nine steps that each teach one mechanic (dig, build, undo,
  put something down, sit on the beach, the claw machine, visit, star,
  invite). A coach card above the bottom-left buttons shows the next step
  and how to do it, cheers when one is done, and says how to get home when
  you're visiting. It can be hidden ("hide the tips"). Each step gives a
  common (conch, sand dollar) once per account; all eight give a starfish.
  Claw, star and invite are checked on the server. The sandbox shows the
  five local steps, without gifts, kept in `localStorage`; signed-out
  progress in production is sent after sign-in and still earns its gifts.
- **Invites**: `?invite=CODE` (your home beach code). The start screen says
  who invited you; the link lands you on their beach; signing in gives the
  welcome parasol and a one-tap "be their neighbor". The inviter gets the
  next rung of a ladder (parasol, surfboard, **extra beach**, tiki torch,
  sandcastle, then starfish; 10 at most) once the friend has done 3 guide
  steps, and is told on their next sign-in. The invite panel (from the guide
  and the account panel's "invite friends") has the link with share and
  copy, the ladder and your friends. Open Graph previews say "Ana invited
  you to beech".
- **Items, not credit**: credit is web-only by store policy, so invite
  rewards are inventory rows (`source = 'reward'`) that work everywhere.
- Migration 23: `guide_steps`, `referrals` (unique rank per inviter), and
  `'reward'` as an inventory source.
- Tests: `server/test/referrals.test.ts`, `server/test/shareMeta.test.ts`,
  `tests/guide.test.ts`, `tests/share.test.ts`; `npm run e2e:invites` drives
  the whole loop in two browsers.
- The action note ("Restored … · Undo", the welcome gift) now sizes to its
  text instead of half the screen, so longer notes don't squeeze on phones.

## Claw machine (added after chair polish)

- **Free claw machine** (production builds, signed in): the rest between
  goes is random, 5 minutes to 3 hours (`cooldownAfter`), skewed short after
  a miss (u², averages ~1 h) and long after a win (1 − (1−u)², ~2 h). The
  range and odds are in the guide (beech.games/guide#claw), not the machine. (Before: 5 min doubling each go up to a
  day; before that, one go per UTC day.) Migration 6 adds
  `pull_state` (goes so far, free again at). One SQL statement claims the
  go, but only if it's free and the count hasn't moved, so two taps at once
  give one go. `pulls` becomes a plain history. Players who had already
  played keep their count. The server draws the prize (`server/src/pulls.ts`, crypto
  randomness) with published odds: common 70% (conch, sand dollar), rare 25%
  (starfish), legendary 5% (message in a bottle). The guide publishes the
  odds (the machine links to them). Migration 3 adds `pulls`, keyed on `(user, pool, day)`;
  claiming the day and adding the prize happen in one SQL statement.
- **Starter gifts** (`STARTER` in `server/src/pulls.ts`): go 1 is a
  Starfish (rare), go 2 is a Deckchair (a shop item, 250, fixed, faces the
  sea), and the first go a day or more after go 1 is an **extra beach**
  (`inventory` item `beach`, once). Every other go is a normal draw. The
  gifts are a surprise: the machine doesn't announce them (#9). The extra beach shows in the bag as
  owned but can't be used yet (`EXTRAS` in `src/world/items.ts`; the plan
  is docs/MULTI_BEACH.md).
- **The game is cosmetic:** the claw wanders, you drop it, and it always
  comes back with a capsule coloured by the server's result. The request
  goes out as the claw drops.
- **Prizes in the bag** show "N of M left". You can have as many of an item
  on the beach as you own, and pulled items count toward that, not wild
  ones. Conch, sand dollar and starfish roll like shells; the bottle floats
  like driftwood. The Week 1 vending Golden sand dollar (`gold-sanddollar`)
  is giant: its size starts at 0.32 m (twice the largest regular sand dollar,
  0.16 m) and scales up to 0.85 m. The claw also gives a branching coral
  fragment (rare, tumbles like a shell) and a coconut (common, rests
  on dry sand and rides high in the water).
- **Prizes look like prizes** (2026-11-23): a prize that shares a kind with
  a free or cheaper item has its own look in `ITEM_LOOKS`
  (`src/palette.ts`) — its own colours and a specular finish (glass and
  polished stone shine, gold shines hardest) — instead of the kind's
  palette. The pink shell is hot pink, blue sea glass deep blue, the pebble
  dark polished slate, the spiral conch coral, the golden sand dollar
  metallic gold with a gold glow and sparkles, the sunset starfish magenta
  and orange, the green bottle deep emerald, the nautilus pearly. Free
  shells are warm cream/tan/peach with no pink anywhere, and free sand
  dollars stay pale cream, never gold. The same colours are drawn on the
  shore pictures (`server/src/beachImage.ts`, kept in step by
  `tests/specialItems.test.ts`, which also checks the rendered pixels), and
  the bag, claw, vending and dig-find icons are tinted per prize
  (`itemIcon` in `src/ui/hud.ts`). The prop bank keys a look by kind +
  item + variant, so a pink shell and a free shell never share a mesh.
  Nothing about ids, rarities, odds, pools, prices or behaviour changed.
- **Sandbox build:** the tile says "coming soon". Signed out (production):
  "Sign in to play". `tests/items.test.ts` checks that the server's pool
  items exist in the client catalog with matching rarity.

## Native sign-in (added after inventory)

- `src/net/nativeAuth.ts` wraps `@capgo/capacitor-social-login` 8.7.6. It is
  loaded only inside the apps, so the web bundle doesn't include it. Android
  offers Google (Credential Manager, token for the web client ID, with
  `skipAuthOnlyAuthorizationAfterSignIn: true` so the plugin skips the unused
  `AuthorizationClient` step on stock `BridgeActivity`). iOS offers Sign in
  with Apple, plus Google when `VITE_GOOGLE_IOS_CLIENT_ID` is set. A cancelled
  sheet shows no error. Signing out also signs out of the provider.
- Facebook and Twitter are off in `capacitor.config.ts`. The merged Android
  manifest has no AD_ID permission.
- iOS: `App.entitlements` (Sign in with Apple) is wired via
  `CODE_SIGN_ENTITLEMENTS`. `scripts/native-auth-config.mjs` writes the Google
  URL scheme into Info.plist.
- **Client error & telemetry reporting (2026-11-24):** `src/net/telemetry.ts`
  now posts to `${VITE_API_URL}/api/client-events` via CORS-safe `fetch` with
  `keepalive: true` (previously a relative URL + `sendBeacon`, which failed in
  native Android/iOS WebViews), tags every payload with `platform`, `version`,
  and `build`, and adds `reportError` / `reportEvent` covering auth, shop/IAP,
  beach sync, sim worker, WebGL context loss, boot failures, `app_boot`, and
  `res_drop`. Server (`server/src/observability.ts`, `server/src/app.ts`)
  validates and logs `client_error`, `client_perf`, and `client_event`;
  `infra/monitoring.tf` adds `beech_client_events_total` and an email alert on
  client error spikes (`beech: client errors`). See [OBSERVABILITY.md](OBSERVABILITY.md).
- **Web Sign in with Apple & token revocation on delete (2026-11-26):**
  `src/net/account.ts` adds Apple JS SDK popup sign-in (`webAppleSignIn`,
  gated on `VITE_APPLE_CLIENT_ID`), wired into the web sign-in screen and
  Settings → connected sign-ins (`src/ui/accountPanel.ts`), plus
  `Dockerfile` and `.github/workflows/deploy-gcp.yml`. Native iOS Apple
  sign-in (`src/net/nativeAuth.ts`) now enables `useProperTokenExchange` and
  forwards `authorizationCode` alongside web Apple sign-in. On the server,
  migration 41 adds `apple_refresh_token` and `apple_client_id` to
  `user_identities` (preserved across account merges), `server/src/auth.ts`
  exchanges authorization codes at `/auth/token` and revokes refresh tokens
  at `/auth/revoke` on `DELETE /api/account` (App Store guideline 5.1.1(v))
  once `APPLE_AUTH_KEY` / `APPLE_AUTH_KEY_ID` / `APPLE_AUTH_TEAM_ID` are set.
- Not verified on devices yet: that needs the OAuth clients and the Apple
  capability (DevOps; see BACKEND.md, "Phone apps").

## Checkpoints (added after beach files, 2026-11-23)

Built as designed in [CHECKPOINTS.md](CHECKPOINTS.md), C1 to C5 (C6,
thumbnails and sandbox checkpoints, is optional and not built).
- **Server:** migration 13 (`checkpoints`, `beach.epoch`); the server reads
  and counts saved beaches itself (`server/src/checkpoints.ts`); list,
  checkpoint a beach, import, rename, delete, fit, and restore (strict, or
  without what's short) one at a time per person. The beach as it was
  becomes its "before restoring" checkpoint. A save from a device that
  loaded the beach before a restore is refused, and that device reloads.
- **App:** settings → checkpoints: save, restore here, restore onto another
  beach, rename, delete (two taps), export as a beach file, import a beach
  file, and an Undo toast after a restore. Chips turn red when your bag
  can't cover a checkpoint here. A **checkpoint** action on each saved beach.
- **Beach files (E5):** the import preview can keep the file as a checkpoint
  instead, and replacing a beach keeps it first as "Before import".
- **Fixed on the way:** the phone apps' cross-origin requests were missing
  the `X-Beach-Items` header (every save) and `PATCH` (beach rename / home /
  shore) in the server's CORS rules.
- **Owner decisions** were taken as the design suggested: 5 named
  checkpoints per beach slot and 16 MB in all; the sandbox uses beach files,
  not checkpoints; a beach keeps its stars when restored.
- **Checked:** 13 server tests (PGlite and Postgres; the server suite now
  runs its files one at a time against Postgres), the shared fit fixture in
  both suites, and `npm run e2e:checkpoints` (save, short then
  drop-missing, full restore, undo, a restore under another device, beach
  removal, export, import, "Before import").

## One active editor, and the daily auto-save (2026-11-24)

Built after Riley's beach was overwritten by an older instance saving over
a restore (last write wins, and a save with no epoch header was let
through). Design in [EDIT_SESSIONS.md](EDIT_SESSIONS.md).

- **Server:** migration 25 (`edit_sessions`: one row per user, the current
  edit token). An instance claims a token when it opens your beach for
  editing (`POST /api/edit-session`); claiming replaces the token, fencing
  every older instance. Fenced: sand saves, checkpoint restores, dig-find
  rolls, and the beach roster (make / rename / remove) — 409 `fenced`,
  426 for an app too old to send a token. Not fenced: pulls, gifts,
  favorites, neighbors, guide, invites, shop, pets, and checkpoint
  create/import/rename/delete (they do not touch beach sand). A save with
  a valid token but no epoch header is accepted — the token, not the
  epoch, is what closes the no-header hole. The heartbeat is
  `GET /api/edit-session` (every 30 s); tokens never expire.
- **App:** `BeachSync` claims on sign-in, sends the token on every save,
  and on `fenced` stops autosaving and turns view-only: digging, placing,
  picking up, dragging, undo and redo are blocked, a banner offers "Take
  over editing" (claims a fresh token and reloads the beach), and settings
  shows "view-only: another tab or device is editing this beach".
- **Daily auto-save:** before a save overwrites a beach, if more than 24 h
  have passed since that beach's last auto checkpoint, the beach as it is
  now is kept in its one auto slot (`Auto-save 2026-11-24`). It shares the
  slot with the "before restoring" and "before import" copies — the newest
  auto event wins — so a restore's undo copy is safe for a day, and only
  then can a daily save replace it. At most one per beach per day; a first
  save keeps nothing; a failed snapshot never blocks the save (logged as
  `auto_checkpoint_failed`). It shows in settings → checkpoints as
  "auto-saved daily" and restores like any checkpoint.
- **Large-edit checkpoint:** before a save that reshapes a tenth of the
  beach's sand cells by ≥ 50 mm, moves ≥ 50 things, or changes the grid
  lands, the beach as it is now is kept in the same one auto slot
  (`Before big edit YYYY-MM-DD`) — even if a daily auto-save fired an hour
  ago, and the copy counts as the day's auto checkpoint, so the daily clock
  restarts from it. The server diffs every save against the beach as saved
  (`sandDiff`, `server/src/checkpoints.ts`: `LARGE_EDIT_FRACTION` 0.1,
  `LARGE_EDIT_MIN_HEIGHT_MM` 50, `LARGE_EDIT_MIN_OBJECTS` 50; unreadable
  bytes count as large); picking up a clearing tool (bulldozer, flatten,
  vacuum) also snapshots first on the client, once per save, so a long
  clearing session is caught at intent, not only at the first chunk over
  the threshold. A failed snapshot never blocks the edit: it is logged
  (`auto_checkpoint_failed`, `reason: 'large-edit'`) and the save answers
  `largeEditCheckpoint: false`, which the app tells the player about.
  Fenced instances cannot trigger it. Design in docs/CHECKPOINTS.md.
- **Sandbox:** unchanged — no accounts, no tokens, production-only.
- **Checked:** 7 new server tests (`server/test/editSessions.test.ts`:
  fencing of saves/restores/dig rolls/roster, takeover both ways, no-token
  426, daily auto-save timing and slot sharing, a full store never blocking
  a save), plus the epoch test updated in `server/test/checkpoints.test.ts`.
  Large-edit: 9 server tests (`server/test/largeEdit.test.ts`: the diff
  thresholds and the save — big-save snapshot, daily interplay, first-save
  and fenced cases, full store never blocking) and 3 client tests
  (`tests/bigEditSnapshot.test.ts`: flush-then-snapshot, skips, never
  throws).
  `npm run e2e:accounts` and `npm run e2e:checkpoints` still pass (the
  scripts drive the real app, so they claim a token the same way a player
  does).

## Performance checks (2026-11-23)

`npm run perf` (`scripts/perf.mjs`) profiles the built app at 0, 400 and
2000 things and checks [perf/budget.json](../perf/budget.json): exact counts
(draw calls, meshes, draw calls for things, things touched per frame, bundle
size) fail when over; timings (main-thread ms on things, the worker's tick)
have loose limits. The Performance workflow runs it on every push to main, on
pull requests that touch the app, and every Monday, keeps the results for 90
days, and shows the change since the last run on main in the job summary.
Details in [PERFORMANCE.md](PERFORMANCE.md).
- Glows are instanced too (2000 things: 315 → 163 draw calls a frame), and
  the simulation's tick is about 40 % faster (medium grid 10.5 → 6.1 ms in
  Node, 8.8 → 6.1 ms in Chromium): the water step skips dry rows, erosion
  skips deep water, and `Math.hypot` is gone from the sim. The sim's tick
  is budgeted from a Node benchmark (`npm run perf:sim`); the in-page number
  isn't, as the software GPU starves the worker of CPU.

## How much a beach holds (2026-11-23)

- A saved beach holds **2000 things** (`MAX_OBJECTS` in `sandCodec.ts`; it
  was 400 until the performance work below). Digging and building sand don't
  count: sand is a height per grid cell, whatever you do to it. Your
  own things are saved first (oldest first), then what the sea brought in.
  Putting down one more than that is refused with a message to use the vacuum. If a save
  still has to leave some out (an undo can go past the limit), a message says
  how many, and the account panel's status line says so too.
- The server refuses a save over **768 KB** (413). The app now says the beach
  is too big to save, rather than retrying quietly. In practice only very
  noisy sand on the finest grid gets near it. 2000 things add roughly 50 KB.
- **Performance work (2026-11-23)**, measured with `scripts/perf.mjs`
  (headless Chromium, a realistic mix, also with the CPU slowed 4x; now run
  in CI against budgets, see [PERFORMANCE.md](PERFORMANCE.md)):
  - Things are drawn as **GPU thin instances** through a scene-wide prop
    bank (`src/render/objects.ts`): one hidden source mesh per look (kind,
    variant, and a size bucket for driftwood; the rest are built at size 1
    and scaled) and a matrix buffer per source. Draw calls for things went
    from one per mesh (about 4,300 at 2000 things) to about one per look
    (about 135 at 2000, 156 at 4000). Neighbor beaches share the same
    sources, so a full shore adds instances, not draw calls. Glows on
    special things are still per thing (few of them).
  - The worker sends the **roster** (what's on the beach) only when
    something is added or removed, and every frame just a packed
    Float32Array of positions (transferred, not copied). The main thread
    updates its object states in place; nothing is allocated per thing per
    frame.
  - Things at rest aren't touched: matrices are only rewritten for things
    that moved more than a millimetre, float, or flutter (a flag).
  - Results: main-thread time for things at 2000 went from 2.5 ms to 1.2 ms
    a frame (1.4 ms with the CPU slowed 4x); the worker's tick didn't change
    with the count (about 5–7 ms with or without 4000 things).
- **Older apps:** an app from before the raise keeps only 400 things when it
  loads a beach, so its save would drop the rest. The app now sends
  `X-Beach-Max` with every save; a save without it onto a beach holding more
  than 400 is refused (426, "out of date: reload") and nothing is lost.

## Beach files (planned 2026-11-23)

Export and import of a documented `.beach.json` file, for designing beaches
offline. The spec and milestones are in [BEACH_FILE.md](BEACH_FILE.md).
- **E1 done:** `src/world/beachFile.ts` reads and writes version 1 (three sand
  encodings, four shapes with add/set/max/min, objects), with errors and
  warnings by JSON path. Also `reconcileItems` for imports and checkpoint
  restores, `docs/beach-file.schema.json`, and examples in `docs/examples/`
  (a test parses each with no warnings).
- **E2 done:** Settings has **export beach** (downloads
  `<beach-name>-<date>.beach.json`) and **import beach**. Import picks a
  file, then shows a preview: a map, the things on it, what was fixed while
  reading, and what your bag can't cover (left out with **Import without
  them**, or the shop). Then it replaces the beach as one undo step that
  restores the old beach exactly. The sandbox build imports free things
  only. Checked in the browser (desktop and phone) and in
  `npm run e2e:accounts` (import with a parasol short, the save survives a
  reload, export).
- **E3 done:** in the phone apps, export goes through the share sheet
  (`@capacitor/filesystem` and `@capacitor/share`), and import uses the
  system file picker. The Android debug build passes here; iOS builds in CI.
  Neither has been tried on a real device yet.
- **E5 done** (with checkpoints, see below).
- **E4 done:** `npm run beach-file -- validate | rows | compact | heightmap`
  (`scripts/beach-file.mjs`, which uses the app's own reader), and a "Design
  a beach offline" guide in BEACH_FILE.md, with a generator script that was
  run and checked. E5 (checkpoints) is left.

## Checkpoints (designed, not built)

- Design in docs/CHECKPOINTS.md: named copies of a beach (the same BCH2
  bytes), restored onto any of your beaches only if your bag still covers
  their non-free things (counted by the server). Strict by default, with
  "restore without them" as the fallback; an automatic checkpoint before
  every restore; a beach epoch so other devices don't save over a restore.
  Milestones C1–C6 are in BACKLOG.md.

## Admin console (2026-11-23)

The admin console is its own app: Cloud Run service `beech-admin`, on the
same database as the game (`server/src/adminServer.ts`; design and setup
in docs/GIFT_CARDS_PROMOS.md#admin-console). The game server no longer
serves `/admin` or `/api/admin/*`. Nothing loads until a Google sign-in by
an `ADMIN_EMAILS` account. It manages gift cards, promo codes, redemptions
and **beaches**: search, details, rename, hide from the shore, new code,
part neighbors, clear the sand (undoable via a checkpoint) and delete a
non-home beach. Every action is audited, and there's an Audit log tab.
`npm run server:dev` also serves it on port 8788.

The Google sign-in round trip on the deployed service is not verified
here: it needs the service's URL on the web OAuth client.

## Live beaches (in progress, docs/LIVE_SIM.md)

- **L1, lost to the sea (2026-11-23):** an owned floater or roller (bottle,
  driftwood, shells and other prizes) that the backwash carries to within
  `LOST_TO_SEA.edge` (0.5 m) of the offshore edge leaves the beach
  (`BeachObjects.takeLost`). The bag counts what's placed, so it's back in
  the bag at once; the frame carries `lost`, the app shows one summary toast
  ("The sea took 2 things…") and saves soon. Wild strays, rocks and fixed
  things are never taken. Stokes drift still brings floaters in, so in normal
  surf this is rare; the catch-up (L2) is where most losses will happen.
  Undo of a lost thing's placement does nothing; redo puts it back from the
  bag.
- **L2, the catch-up model (2026-11-23):** `src/sim/catchup.ts`. Cuts a gap
  into half tide cycles and copies the live sim's healing and wet slumping
  by how long each cell was wet; floaters strand at the high-water line,
  owned things too long in the sea are taken, and fresh strays wash up.
  Constants in `CATCHUP` (`src/config.ts`), including `maxGapDays: 14`.
  14 days costs 30–45 ms (budgeted at 150 ms per tier in `npm run perf`).
  Not used by anything yet; the server runs it in L3.
- **L3, the server catches beaches up (2026-11-23):** every read of a
  beach's sand runs the catch-up first if it's due (10 min since it was last
  simulated, and the owner's app isn't holding it open with its 20 s
  `/here` heartbeat). Compare-and-set on `version`, epoch bump, a
  `beach_events` row, and a "Before the tide" checkpoint before gaps over
  12 h (migration 21). The catch-up is bundled from `src/` into
  `server/src/generated/catchup.ts` (`npm run bundle:server`, checked by
  `tests/bundleServer.test.ts`). Cap: `CATCHUP_MAX_GAP_DAYS` (default 14).
  The app reloads its beach when it comes back after 10 minutes or a
  heartbeat says the epoch moved on. Dev-only `/api/dev/age-beach` lets
  e2e tests skip time.
- **L4, "while you were away" (2026-11-24):** each time one of your beaches
  loads, the app asks `/away` for what the sea did since you last looked
  (unseen `beach_events`, summed) and shows one card: "While you were away
  (2 days) · 4 high tides · the sea took 3 things (back in your bag)", with
  **Put it back as it was** (restores the "Before the tide" checkpoint,
  leaving out anything the bag no longer covers, with Undo) and **Keep**.
  `/away/seen` marks it read, so it shows once. `npm run e2e:live` covers it
  end to end. The public beechshore.com pages still draw the stored sand
  (no catch-up on those reads).
- **L5, live viewers (2026-11-24):** reading someone else's beach (a
  visit, a neighbor, the public shore) marks it watched for 15 s
  (`viewed_until`). The owner's heartbeat reply says so, and while watched
  the owner's app saves every 5 s. The viewer asks `/beaches/:code/live`
  about the beach in front of it: every 5 s while its owner is on it, every
  30 s otherwise, and fetches the sand again when the version moves on (the
  owner's saves and the server's catch-ups). `npm run e2e:live` checks a
  dig reaches a visitor. Since 2026-11-26 the viewer's sand eases to each
  new save over 1 s (`BeachRenderer.easeStatic`: the old snapshot becomes
  the previous frame and `frameMix` runs 0 → 1; `BEACH_STORE.viewerEaseMs`),
  and things on any snapshot beach glide to where a new save or a drag
  preview puts them (`ObjectView.glide`, called per frame from `Neighbors`;
  before, a moved thing on a snapshot only moved when the whole beach was
  rebuilt). Not done: SSE (polling only).
- e2e on 2026-11-24 after rebasing onto main 6f6fa8c: `accounts`,
  `neighbors` and `live` pass. `shore`, `beaches` and `leaderboard` time
  out at the same steps on plain main too (signing a second person in on
  the same page; making a new beach), and `checkpoints` sometimes misses
  its Undo toast on the software-GPU runner: those scripts need a look,
  separately from this work.
- e2e on 2026-11-27 (the look): all 14 scripts pass, run one at a time
  (`E2E_JOBS=1 npm run e2e`, `E2E_RENDER=0` on the software-GPU runner;
  the 3-job default starves a 1.5-CPU VM and the same scripts time out
  there). Fixed on the way: `waitForFunction` defaults to rAF polling,
  which stalls in `?norender` mode, so `scripts/lib/e2e.mjs` now defaults
  it to a 100 ms interval; `thumbnailOf` blocked the main thread ~50 s on
  `canvas.toDataURL`, now async `toBlob` (still ~25 s of readback + encode
  on the main thread, so thumbnails are skipped under `?norender` — the
  e2e path — and covered by `scripts/sandbox-e2e.mjs` on a real device;
  the real fix is to use the canvas itself as the thumbnail and never
  read the pixels back); navigations and boots are slow on the software
  renderer (a goto after an import took 62 s to commit), so the harness
  gives them 120 s / 60 s; `live` restored without an edit token (426 since
  the single-editor fencing of #95); `copy` grabbed the welcome-gift
  toast's button instead of the Copied toast's Undo (both toasts share the
  page — lookups are now scoped to their toast); `invites` went home while
  the invite's pending visit was still applying (the signed-out visit
  already shows Ana, so the waits didn't prove the sign-in visit finished
  — it retries going home until the anchor stays home) and its dig drag
  can land before the home beach is pickable (the wait now also requires
  the shore drawn around home: `liveVisible` and a beach at the centre —
  before that, `pickAt` finds nothing and the stroke never opens; the drag
  itself retries as a safety net); `sections` and `piers` waited a fixed
  1.5 s for the second device instead of waiting for the rows / pier;
  `sand-rows` (new in #168) sent all its brush moves at once, so the
  worker only ever dug at the stroke's final position — the moves are
  now spread over time, like a real drag. Underlying all of it: rAF runs
  at ~1 fps in the headless shell with rendering off, so anything that
  waits on frames (waits, click stability) needs an interval or a retry.
  Still open: two `visit()` calls racing each other are not serialised —
  the last fetch to finish wins, not the last call — so going home in the
  first second after signing in from an invite link can be undone by the
  pending visit landing late (the e2e retry works around it; a fix would
  serialise `anchorAt`). Fixed since: the thumbnail readback — the canvas
  itself is the thumbnail now (`thumbnailCanvas`), so opening the
  checkpoints panel no longer stalls the main thread.
- **Permissions audit (2026-11-25):** every endpoint that changes a beach
  (its sand, name, place, code, neighbors, pet, checkpoints, restores,
  `/here`, `/away/seen`, the dev `age-beach`) resolves the beach through
  `mine()` (owner only, 404 otherwise), and the sand-changing ones also need
  the owner's edit token. Everyone else can only read, and the server's
  catch-up is the only other thing that moves a beach's sand: no app code
  imports the catch-up model (`tests/bundleServer.test.ts` checks), and the
  owner's app reloads after a gap rather than catching up itself. Viewers'
  own water moves the sand they see (it can drift from the owner's), and
  they reload whenever the version moves on. `server/test/permissions.test.ts`
  tries each call as someone else and checks the beach is unchanged. Fixed
  on the way:
  - Saves are read by the server: bytes that aren't a beach, or whose grid
    isn't the one in the headers, are refused (400), and `beach.items` is
    counted from the objects (as catch-up and restore already did). The
    app's `X-Beach-Items` is now ignored, so an under-count can't free an
    item to be placed on two beaches.
  - `GET /beaches/:code/pet` never matched the caller's session (the token
    hash wasn't awaited): owners couldn't see the pet on a beach kept off
    the shore, and visitors never got `canFreeFeed`.
  - Someone the owner has blocked can't feed their pet (403, like visits
    and gifts).
  - Reading your own neighbor beach no longer marks it as watched.
  - **Saves within the bag** (same day, follow-up): a save may raise a
    thing's count on a beach only up to what you own less what's on your
    other beaches (`overBag`, 409 `{ error: 'short', short }`). Only counts
    that go up are checked, so most saves cost no extra query, and what the
    beach already held stays allowed (things gifted away, refunded or
    expired while on the sand). The app (`BeachStore`) saves its other
    beaches and retries once, which settles a move across a seam whose
    two saves arrived out of order; still short, it reloads the saved beach
    with a toast. Apps from before this treat the 409 as "restored" and
    reload.
  - e2e here: `accounts` passes. The others time out signing a second
    device in on this software-GPU runner, and plain main times out the same
    way (`neighbors`, `checkpoints`, `live` checked side by side). The
    server log showed no refused save (no 400) in any run.

## beechshore.com (2026-11-23)

- A public website of every beach on the shore (docs/SHORE_SITE.md):
  `server/src/shoreSite.ts`, served by the game's server on the shore's own
  hosts and under `/shore` everywhere else. Lists, places, a page per beach
  (`beechshore.com/CODE`) with its picture, its stretch of shore and share
  buttons, a sitemap. Only beaches on the shore and saved appear.
- Pictures are drawn on the server (`server/src/beachImage.ts`, PNG with no
  dependencies) and used as `og:image`, also for the game's `?visit=` links.
- The shore walk moved to `server/src/shore.ts`, shared by the API and the
  site; the site skips non-public beaches without changing the order.
- In the game: a share button (bottom left) and "share" in settings send the
  beechshore link; the leaderboard links to the site; a `?visit=` link
  opened signed out opens public beaches directly in read-only 3D (via
  `/api/public/shore`, `/api/public/shore/more` and `/api/public/beaches/:code`,
  strictly `isPublic`), while off-shore beaches still ask for sign-in. Signed out at home, the public shore runs past your (local-only) beach too: public sections appear either side of your empty beach, and scrolling either way walks the whole public world; settings lists the beaches along the shore to visit, and signing in there saves your beach.
- Scale & protection (2026-11-24): migration 17 adds partial indexes
  (`beach_public_updated`, `beach_public_location`) for the lists and counts,
  and uncached PNG draws on `/img/*` are rate-limited (60/min per IP, 429 with
  `Retry-After`; cache hits are free).
- **Decision:** shared links point at beechshore, not the game, because
  they work for anyone, signed in or not, and preview with a picture. The
  game link is still one tap away ("game link" in settings).
- **Decision:** a shore link for a beach that is off the shore redirects to
  the game's visit link rather than 404, so a link the owner sent still works.
- **UI polish & social snapshot studio (2026-11-24):** refreshed coastal visual
  design (`server/src/shoreAssets.ts`), `/find` code/name beach finder, mobile
  navigation strip, and an in-page Social Share & Snapshot Studio (`#share`)
  offering Postcard (1200×630), Square (1080×1080), Story (1080×1920), and Clean
  snapshots with Web Share file attachment, clipboard image copy, PNG download,
  editable caption, and direct social sharing (X, Bluesky, Threads, Reddit,
  WhatsApp, Facebook, Text), plus a "share snapshot ↗" link in the game's
  account settings.
- Needs the domain mapped (owner task in BACKLOG.md).

## Deploy and build status

- **iOS:** the Xcode project builds for the simulator on GitHub's macOS
  runner (`mobile.yml`, first green run on the dev branch). That build is
  unsigned. A signed archive needs an Apple Developer team (`release-mobile.yml`).
- **Android:** a debug APK, an unsigned release AAB, and a release AAB signed
  from the `BEECH_KEYSTORE_*` env vars (tested with a throwaway key) all built
  locally. CI builds the debug APK and the release AAB too.
- **Google Play (2026-11-23):** the app is created (**beech**,
  `app.beech.beach`, Jenerator Labs), identity verification passed, and AAB
  1.0.0 build 1 is uploaded to the internal track as a draft. Privacy
  policy at https://beech.games/privacy.html; listing screenshots and
  feature graphic in `resources/play-store/`. Still manual in Play Console:
  listing text, content rating, data safety, target audience (13+),
  testers, promoting the draft.
- **GitHub Pages:** removed 2026-11-22 (workflow deleted, superseded by
  Cloud Run). The sandbox build (`npm run build`, no accounts) is no
  longer published anywhere.
- **Web preview meanwhile:** the built game is published as a private
  claude.ai artifact (Beech Seaside Toy), made with
  `node scripts/artifact-page.mjs` after `npm run build`.

## Next steps owned by the repo owner (deferred by choice, 2026-11-22)

- **Store submission (Apple):** later. The owner still has to create the
  Apple Developer account and add the secrets listed in docs/MOBILE.md.
  Google Play is underway — see the Google Play bullet above. Agents
  shouldn't attempt uploads before those secrets exist.

## Not verified here (needs real accounts or hardware)

- The store upload workflow (`release-mobile.yml`): the first Play upload
  succeeded via the API (2026-11-23, AAB 1.0.0 build 1 to the internal
  track). The iOS upload still needs App Store Connect credentials.
- Feel on real phones: touch latency, haptics, audio mix, thermal behaviour.
  The tuning panel (`?debug=1`) is the place to adjust these.
- The admin console's real Google sign-in and the `beech-admin` Cloud Run
  deploy. Tests cover sign-in with a stubbed Google verifier, and both
  entry points were run locally. The Docker `admin` target wasn't built
  here, because no Docker daemon was available.

## Item catalog and sample renders (2026-11-24)

- **The catalog is organized** in [ITEMS.md](ITEMS.md): every item by
  how you get it (free, wash-ashore, claw pool, vending sets, shop,
  extras), with kind, rarity, size, variants, behaviour, mesh file and
  price, plus the checklist for adding the next item and the design
  rules (special items look different — and better — than the free
  items sharing their kind; free shells never pink, free sand dollars
  never gold).
- **The guide lists the whole catalog** (2026-11-24): beech.games/guide#catalog groups every item by how you get it — free, washed ashore, claw, vending (this week's set and past sets), shop with prices, extras — with rarity and a line on how each thing behaves. The listing is built at runtime from the claw pool, the vending sets, the shop products and the free items; names, rarities and kinds the server can't derive from those are mirrored in `server/src/prizeNames.ts` and kept in step by `tests/items.test.ts`. A new free item joins its group on its own: footprints (PR #81, still open) will appear in the free list once that PR merges, with no change needed here.
- **Sample renders** (`scripts/render-items.mjs`, committed under
  `docs/items/renders/`): headless Chromium, day light, seed 1. The
  script bundles the app's own catalog, places every item in rows on
  dry sand, pauses the sea, and screenshots the whole beach plus a
  close-up of each item, then composes a labelled contact sheet.
  Regenerate individual shots with `--only <id,...>` and run without
  that option to refresh the full beach and contact sheet.
  Needs playwright (`npm install --no-save playwright@1.63.0`, as in
  CI). The script starts its own dev server unless `--url` is set.
- **Wash-ashore finds** (2026-11-24): the sea now brings in trash (a
  crumpled bright bottle or can), seaweed, and spotted cowries, new
  kinds `trash` and `seaweed` (both tumble in the swash) and a rare
  free `cowrie` on kind `shell` with a spotted brown finish. Wash-in
  weights: driftwood 35%, shell 22%, sea glass 15%, seaweed 12%,
  cowrie 8%, trash 8% — trash stays rarer than shells. All three are
  free and unlimited, and keeping one works through the generic found
  mechanism (pick it up, put it down, it shows in the bag's "Found"
  section). Renders in `docs/items/renders/` (trash, seaweed, cowrie)
  were regenerated with the full harness.
- **Vending Week 2 "Beach day"** (2026-11-24): from Mon 2026-11-30
  the machine gives a beach ball (common, floats), sandals (uncommon,
  tumble in the swash) and a bucket (rare, stands upright) — three new
  kinds (`beachball`, `sandals`, `bucket`), each the only item of its
  kind. Week 2 is a mixed set: three new items can't fill all four
  tiers, so Week 1 items fill the gaps (blue sea glass and pebble,
  spiral conch, green bottle, nautilus) and keep the 3/2/2/1 shape;
  sunset starfish sits the week out. The ball sits on dry sand and
  floats with its bottom submerged. Imported variant 0 uses the first
  colour scheme, and the shore pictures use the same variant colours
  as the game. Renders are in `docs/items/renders/`.
- **Shop centrepieces** (2026-11-24): five new shop items — a palm
  tree (legendary, $2.99, the tallest of the five), a lifeguard tower
  (legendary, $2.99, with a cabin and a ramp), a bonfire (rare,
  $1.49, its flame glows like the tiki torch's), a hammock (rare,
  $1.49) and a beach towel (rare, $0.99) — five new kinds
  (`palmtree`, `lifeguardtower`, `bonfire`, `hammock`, `towel`), each
  the only item of its kind. The render layout keeps the expanded
  catalog on dry sand. The payment-provider setup uses the product
  IDs in `server/src/products.ts` and the Steam IDs in `docs/STEAM.md`.
- **Item catalog on beechshore** (2026-11-24): every item is published
  at `beechshore.com/items`, one page per item (`/items/<id>`) with its
  render, rarity, size, how to get it, price, and creator credit where
  it applies. Signed-in players can vote once per item (toggleable)
  and leave comments (newest first, 1000 characters, author-only
  delete). The guide links to it instead of duplicating it. The
  catalog data is a server-side mirror in
  `server/src/itemCatalog.ts` (the server cannot import
  `src/world/items.ts`); `server/test/itemCatalog.test.ts` keeps the
  mirror field-for-field equal to the catalog, and
  `tests/items.test.ts` checks every item has a render in
  `docs/items/renders/` and a copy in `public/items/`.
  Migration 22 adds `item_votes` and `item_comments`. Admins cannot
  delete other players' comments from the game server — the admin
  email list lives only in the admin service.

- **Signed-out public shore** (2026-11-24): when signed out (and not visiting a
  `?visit=` code), `GET /api/public/shore` without `code` anchors on the top
  public beach and walks both directions (`center: null`, unlinked at the edges
  beside index 0), so `NeighborView` renders public sections of the beechshore
  next to the player's empty beach for inspiration and supports infinite scroll
  and returning home from a visit.

- **Free footprints** (2026-11-24): a trail of prints pressed into
  the sand (`footprints`, common, free and unlimited, 0.5–2.0 m,
  behaviour `fixed`), darker than the dry sand around them so they
  read as dips, with a matching trail in the shore pictures. The
  little figure walking the waterline from the same backlog line did
  not ship with it — there is no character mesh, walk animation, or
  fading-decal system in the app, so it would need a new render
  subsystem rather than an item, and stays a backlog to-do. Renders
  are in `docs/items/renders/` (footprints, full beach, contact
  sheet).
- **Footprints: drag to leave a trail** (2026-11-25): dragging with
  footprints in hand lays one trail per stride along the path, each
  running in the direction of travel with its prints alternating
  left and right across the joins, up to 100 trails per drag; undo
  takes the whole drag back as one step. A render of a dragged trail
  is in `docs/items/renders/footprints-drag.png`.

## Verification

- `npm test`: unit tests for the sim (water/sand conservation, run-up range,
  hold-to-deepen, rim fraction, undo/redo/cancel/reset, determinism) and the
  brush math.
- `npm run smoke` (or `SMOKE_URL=http://localhost:5173/ npm run smoke` against
  a dev server) drives a headless browser through these checks: the sim is
  running, a touch dig is cancelled by a second finger, a one-finger touch digs,
  a mouse dig changes the sand, undo restores it and redo re-applies it.

## Community item submissions

Beechshore has a signed-in [item submission section](ITEM_SUBMISSIONS.md)
with proposed prices and availability, versioned upload consent, and a
creator status and credit view. The admin console queues submissions and
lets reviewers edit a proposal, replace its asset, and link it to a
catalog product. Linked paid items credit the creator 30% of each
completed sale. Assets and availability ship through the existing
catalog release process. The public specification includes an example
prompt, JSON Schema and sample asset.

## Animals — A1 wild sand crab (2026-11-24)

- **Tuning change (2026-11-24, differs from ANIMALS.md):** animals were too
  small and rare to notice, so the crab is now 0.8 m across (was 0.32), the
  dolphin 2.2 m (was 1.55) and swims a lane just past the surf. Crabs spawn in
  the middle 45% of the beach width so narrow phone views show them. Visits now
  come every 1–3 min (85% chance; first one 20–60 s after boot) and last
  1.5–3 min, so an animal is around about half the time (was ~10–15%). The
  crab's leg cycle scales with its size.

- **Rare wild visitor** ([ANIMALS.md](ANIMALS.md)): a single sand crab
  occasionally emerges from the sand (4–12 min quiet wait, 65% roll, 45–120 s
  visit, empty most of the time), scurries sideways in short bursts, pauses to
  wave its claws, flees incoming waves and the player's digging brush, steers
  around placed rocks/large objects, and burrows back into the sand.
- **Implementation:** pure-TS state machine in `src/world/animals.ts` (unit
  tested in `tests/animals.test.ts`), tuning constants in `ANIMALS`
  (`src/config.ts`), colours in `ANIMAL_COLORS` (`src/palette.ts`), and a
  single-draw-call vertex-coloured procedural mesh with GPU leg-scuttle and
  claw-wave animation in `src/render/animals.ts` (`beachAnimal` shader in
  `src/render/shaders.ts`, disabled when absent so idle draw calls stay
  unchanged). `?debug=1` adds **Spawn sand crab** / **Despawn** and a status
  readout.

- **Food & feeding (A2)** (2026-11-24): `crab-treat` ("Beach snacks") added to
  `EXTRAS` and the shop (`food_pack_10` $0.99, `food_pack_35` $2.99) plus a
  25% free bonus treat trickle on digging finds. Tossing a snack from the bag
  calls `POST /api/animals/feed` (atomic server decrement), drops a visible
  treat pile on the sand, speeds up wild spawns 4× while empty, and draws an
  active crab over to eat (extending its visit and calming it around the
  brush).
- **Snack placement and pick-up** (2026-11-25): picking Beach snacks in the
  bag puts a snack in hand (`snackInHand` in `src/main.ts`, the place bar shows
  "N left"); a tap on dry sand of the live beach calls `POST /api/animals/feed`
  and drops the snack there (`dropFood(env, pos)`). Tapping the snack again
  with snacks in hand, long-pressing it (any tool, look included), or a vacuum
  stroke over it calls `POST /api/animals/feed/return` and puts it back in the
  bag (`AnimalController.foodNear` / `takeFood`). Migration 27 adds
  `beach_snacks` (one per beach: the bag row it came from, and whether it
  counted toward befriending or fed the pet). A return refunds that row and
  undoes the toss (wild feed count −1, or the pet's `last_fed_at` and feed log
  restored if nobody fed it since), so tossing and picking up can't farm
  bond progress. Only a snack tossed in the last 15 min can come back; one
  eaten or washed away is gone on the client (the server row just expires),
  and befriending a crab clears it.
- **Resident pets (A3)** (2026-11-24): migration 21 adds `beach_pets`,
  `wild_feed_progress`, and `pet_feed_log`. Players can adopt one pet per beach
  either by feeding wild crabs 10 times (`POST /api/pet/adopt { mode:
  'befriend' }`) or buying `pet_crab` ($1.99) in the shop (`mode: 'shop'`).
  Mood (`happy` / `peckish` / `hungry` / `sleepy`) is computed from
  `last_fed_at`; sleepy pets nap half-burrowed until fed and never leave.
  `src/platform/petNotify.ts` schedules local hunger reminders at +24 h
  respecting 22:00–08:00 quiet hours.
- **Visitor feeding (A4)** (2026-11-24): `GET /api/beaches/:code/pet` and
  `POST /api/beaches/:code/pet/feed` let signed-in visitors feed another
  beach's pet (1 free feed per beach per UTC day, or spend 1 `crab-treat` from
  their own bag anytime). The shore bar shows a **Feed pet** button when
  visiting a beach with a pet, and owners see a quiet toast (`X fed Barnaby!`)
  when visitors feed theirs.
- **Visitors see pets; feeding puts the snack down** (2026-11-25): while away,
  the pet of the other beach under the view is drawn on its snapshot sand by a
  second `AnimalController` + `AnimalView` in `main.ts` (`updateVisitPet`;
  env from `NeighborView.heightAtWorld` / `waterAtWorld`, still water at the
  tide; lazy, 0 draws when no pet in view). **Feed** now arms a placement
  (button reads *cancel*). A completed tap on dry sand
  (`NeighborView.pickBeach`) drops the treat and makes the feed request.
  The pet walks over to eat it. If the request fails, the treat is picked
  back up and the pet's previous mood is restored. Visitor pet animation is
  local to the visitor's browser.
- **Second species — offshore dolphin (A5)** (2026-11-24): added `'dolphin'`
  to `AnimalController` (`src/world/animals.ts`) and `buildDolphinMesh`
  (`src/render/animals.ts`, single draw call, lazy-loaded, 0 idle draws). On
  unbaited wild visit rolls, 35% of visits are an offshore dolphin cruising
  alongshore in deep water (`depth >= 0.6 m`) with periodic parabolic breaching
  arcs and nose pitch; `?debug=1` adds **Spawn dolphin**.

- **Cloud SQL recovery** (2026-11-25): Terraform enables point-in-time recovery with seven days of transaction logs and seven daily backups. Production takes on these settings when the configuration is applied.

- **Direct multi-beach editing, tabbed settings, and 1-click shore connecting** (2026-11-25):
  - Any of your own beaches visible in the 3D shore view can now be edited directly (dig, build, blend, dozer, flatten, vacuum, place/drag items, undo/redo — including seamlessly crossing linked seams between adjacent owned beaches). `NeighborView` lazily spins up a lightweight `BeachSim` (`stepEdit`) per edited owned beach and auto-saves writes to that beach's ID (`PUT /api/beaches/mine/:id/sand`) regardless of which beach is selected in settings.
  - `SettingsSheet` is now organized into sticky tabs (**Beach**, **Shore**, **Display**, **Account**; **Beach** + **Display** in sandbox builds). Selecting a beach in **Beach** only configures its settings (name, place, code, smooth, checkpoints, neighbors) without switching the 3D scene unless you tap **go there** (which glides smoothly if already on the current shore).
  - **Shore** includes a visual **Your beaches on the shore** stretch connector (`src/ui/shoreConnect.ts`) to snap your own beaches side by side or disconnect them in one tap without copying codes or flipping beaches.

## HUD, sandcastle molds and adjacent editing (2026-11-25)

- The right-hand controls group Edit, Shop, Chair, Move and Beach settings. Help
  opens the controls summary and links to the full guide. Account settings
  hold sign-in and device preferences. Beach settings hold location, light,
  saved beaches, checkpoints and neighbors. The bag and paid shop scroll
  within the available viewport.
- Cylinder and square sandcastle molds raise editable terrain. The sand
  tools can add walls and moats, and items from the bag can decorate them.
- Touching a linked beach you own with an edit tool opens it in the same
  view. A brush drag can continue across the seam. Each beach is saved
  separately before handing the live simulation to its neighbor.

## Palm-first UI: one rail, one status pane (2026-11-25)

Built from the "palm first, one rail, one status pane" mockup. Supersedes
the HUD layout in the section above.

- **Minimal is the default.** At rest only a palm button shows, lower
  right (64 px). Tapping it opens the rail and fades in the status pane;
  the palm becomes the × at the bottom of the rail. Closing puts any item
  in hand away. Opening always picks the hand. `H` toggles it, like the
  palm. The eye button is gone. Ambient/TV mode still fades everything
  after idle. Outside it, the lone palm fades after 5 s quiet (Mark,
  2026-11-27; `palm-idle`, `IDLE_FADE.palmMs`) and stays tappable; an open
  rail never fades. The rail's open state isn't saved: every load starts
  minimal.
- **The rail** (`Hud` in `src/ui/hud.ts`) is one frosted pill in three
  groups: Inbox (signed-in builds) · Hand · Dirt | Bag · Store (signed-in
  builds) | View · Manage. Undo (60 px, hold to redo) sits above the ×.
  Under 560 px tall it lies along the bottom and the dirt flyout opens
  above it. The mockup left one question open; we chose: the rail stays
  open while you work with a tool, and modals open over it.
- **Dirt** is one button with a flyout: dig, build up, smooth, flatten,
  vacuum, bulldozer, then the round and square sandcastle molds. The
  mockup has no sandcastle tool, so the molds were put here. The flyout
  stays open while a dirt tool is in use. Tapping Dirt picks up the dirt
  tool used last. Keys 1–5 (and the gamepad's tool cycle) open the rail
  if needed.
- **View** cycles chair → isometric → reverse isometric → chair.
  `CameraController.faceShore()` eases the diorama 180° to look back from
  the sea; `reversed` reports it. A label names the view for 1.8 s.
- **Status pane** (top left, the old place header): whose beach + the
  time and swell by default. While visiting, the beach title opens its
  Beechshore page in a new tab. Expanded adds the tide line, chips (wave
  strength, saving state, "look only" while viewing), and the shore bar
  while away (leave something, ask to be neighbors when a side is free,
  feed pet and star). Closed leaves a lone *i*. The state
  is saved in settings (`statusPane`). There is no weather data, so
  "weather" is the sky (☀ ◒ ☾), the local time and a swell word from the
  live wave scale. The mockup's stars and finds chips came later
  (2026-11-27): ★ n (stars on the beach in view) and "finds n/3" (your
  buried finds today), from `GET /api/pane`, fetched when the beach in
  view changes, after a dig find and every 2 minutes. The credit (beech bucks) chip is
  out on purpose: the balance is only useful in the shop, where it
  already shows (Mark, 2026-11-26). The "also in view" list
  (`ShoreInfo`) and floating neighbor name-tag pills (`tagPlace`) are
  removed — the top-left card already shows whose beach you're looking at.
- **The home icon** appears in the top right while away, including when the
  toolbar and status pane are closed.
- **Inbox hub** (`src/ui/socialHub.ts`): one tab strip on four dialogs,
  swapped in place: Inbox (`InboxPanel`), Leaderboard (`Leaderboard`),
  Starred (`StarredDialog`, from `nv.favorites`) and Visit by code
  (`VisitDialog`, with your code and share). Signed out, the Inbox button
  opens the leaderboard; the Inbox and Starred tabs ask you to sign in.
  Neighbor requests put a dot on the Inbox button (was on the gear and
  the Shore tab). Share lives in the Inbox and Visit tabs. The trophy and
  share buttons are gone.
- **Bag** is a centered modal. The claw and capsule machines are tiles at
  its top. **Store** opens the paid shop directly. The Shop popup is gone.
- **Manage** (the old settings sheet) tabs: Beaches (beach slot, place,
  actions, and the old Shore tab's connect + neighbors), Checkpoints,
  Settings (account + display + wave strength), Help. The old tab names
  `shore`, `display` and `account` still work as aliases in
  `sheet.show()`. Visit by code and favorites left the Shore section for
  the hub.
- **Wave strength**: `SimFlags.calm` (boolean) became `waveLevel` (a
  multiplier the sim eases toward over about 2.5 s): calm 0.25, gentle
  0.6, lively 1 (the beach's own swell, the default), surf 1.3
  (`WAVES.levels`). The setting is per device (`settings.waves`).
  `sim.test.ts` covers conservation and stability at surf.
- e2e scripts use `__beech.setRail(on)`, `__beech.setPane(state)` and
  `__beech.hub().show(tab)`.

### Test & CI speed (2026-11-25)

- **Server tests (`server/test/testDb.ts`):** all 23 DB test files share a
  per-worker DB helper (one PGlite boot + migration per Vitest worker, or one
  isolated Postgres schema `test_w<id>` per worker with `synchronous_commit=off`
  and transactional `DELETE` reset). Previously 10 suites ignored
  `TEST_DATABASE_URL` and ran PGlite sequentially during the Postgres 16 CI
  step; now all DB suites run in parallel on real Postgres 16 too.
- **Web unit tests:** split non-rock swash/surf object checks into
  `tests/objectsSwash.test.ts` (one shared 120 s `BeachSim` pass) and long
  wave checks into `tests/simWaves.test.ts` (shared untouched beach pass);
  combined the two waterline castles in `tests/catchup.test.ts` into one live
  sim pass.
- **CI workflows:** `.github/workflows/ci.yml` runs Postgres 16 DB tests in
  parallel (skipping the 6 non-DB suites already covered in PGlite) and runs
  the Docker production image build/boot check as a parallel job with Buildx
  GHA layer caching; `.github/workflows/perf.yml` caches the Playwright
  Chromium binary.
- **E2E tests (`scripts/lib/e2e.mjs`, `scripts/run-e2e.mjs`, `npm run e2e`):**
  low quality, and since 2026-11-27 no continuous WebGL draws unless the
  script was given a screenshot directory (`e2eRenders`: `E2E_RENDER=1`
  forces drawing, `E2E_RENDER=0` never draws). On a CPU-only machine the
  SwiftShader draws starved the page, and that was the "flaky" timeouts
  (a second device's sign-in took ~27 s, ~0.6 s without draws). The fast frame loop starts after app setup.
  The live-viewer test waits for the scheduled heartbeat. `npm run e2e` runs all 9 server E2E scripts over one shared
  Chromium server, with 3 concurrent scripts by default. Set `E2E_JOBS` or
  pass `--jobs` to choose a positive integer concurrency limit.
- Browser startup failures now include recent page errors, script responses,
  worker starts, and failed requests. Set `E2E_CHROMIUM_PATH` to run against
  a local Chromium executable and `DEBUG_E2E=1` to stream test output.
  Rendered tests pause existing tabs while another WebGL context initializes.
- The shore E2E waits for the destination beach view and its label.
  The multi-beach save race waits for the camera's pending beach transition
  before holding a save response.

## Local weather: the light follows the view along the shore (2026-11-25)

- With **local weather** on (Settings, default on), the sky, sun, moon, stars
  and scene light are those of the real place of the shore beach nearest the
  centre of the view, not only the live (simulated) beach's.
  `shoreLightMix` (`src/world/shoreLight.ts`) picks the two drawn beaches
  either side of `cam.focusX`; each keeps its own light around its centre and
  the light crosses over in the middle `SHORE_LIGHT.blendSpan` (60 %) of the
  gap with a smoothstep. `mixLive` blends palette, sun/moon direction and
  night. main.ts keeps one `LiveConditions` per place (refreshed every
  500 ms) and caches the blend, so the palette object (and the renderers'
  uniform uploads) only changes when the light does.
- A beach's place is its stored location (`store.peek(id).location`, else
  the shore record's); a beach with none shares the live beach's. `?beach=`
  pins everything to that place (screenshots).
- The tide and swell sent to the worker stay the live beach's (that's the sea
  being simulated). The status pane's sky glyph, time and tide line follow the
  viewed place.
- With local weather **off**, every beach uses the light pinned under
  **light** (dawn/day/golden/dusk/night; its chips dim while local weather is
  on). Settings migrate: old `palette: 'live'` → local weather on + day;
  an old pinned mood → local weather off with that mood (`migrateSettings`).
- There is still no forecast data: "weather" is the place's sky and light.
  Clouds/rain stay in the backlog.
- `window.__beech.light()` reports the view's light (`place`, palette name,
  local time); `scripts/shore-e2e.mjs` checks a Waikiki neighbor next to a
  Brighton home and the off switch.

## Agent tooling: token savings (2026-11-25)

Built. `.claude/settings.json` registers a SessionStart hook
(`.claude/hooks/session-start.sh`: pinned, checksum-verified rtk 1.2.1, the
verification tools, then
`npm ci` for the app and server when lockfiles change; cloud sessions only)
and a PreToolUse Bash hook (`.claude/hooks/rtk-rewrite.sh`, a no-op without
rtk). The cloud environment's setup script also installs rtk. Guidance for
agents is in [AGENT_TOKENS.md](AGENT_TOKENS.md). No effect on the game.

## Agent tooling: formal verification (2026-11-25)

LemmaScript skills are vendored in `.claude/skills/lemmascript*` (upstream
commit in `LEMMASCRIPT_UPSTREAM.md`); the session hook installs Dafny 4.11.0
and `lemmascript@0.6.12`, and CI's `verify` job runs
`lsc check --backend=dafny` over `LemmaScript-files.txt`.

Verified (2026-11-25), all server-side, details in
[VERIFICATION.md](VERIFICATION.md):
- the restore check (`shortfall`) and the save check (`saveShort`,
  `nothingGrew`, moved out of `overBag` in app.ts): exactly the real
  shortfalls are refused, with the right counts, and a save never loses
  what a beach already held;
- the promo rules: `discountCents` is between 0 and the price, and
  `promoBlocked` lets a code through exactly when it's active, unexpired,
  not used up and for this product.

No bugs turned up in these: the proofs went through without code changes,
and a 20,000-case random comparison showed the reworked save/restore
checks give the same answers as before. Not verifiable with LemmaScript:
the sim (floating point), the claw and vending draws (randomness), and
anything reading the database. One question came up: an approved
creator item priced 0 cents was "not for sale" in the shop
(`salePriceCents` read 0 as no price) while the submission page called
it "free". Owner's call: 0 is free, and "not for sale" is its own
checkbox (`for_sale`, migration 28); see docs/ITEM_SUBMISSIONS.md.
A claim from the shop's **Free** button requires the current price to be
zero. If the price changes, the claim leaves the player's credit intact.

E2E on this runner: with `E2E_RENDER=0`, all 9 scripts pass (61 s). With
rendering on they still time out here, on main too.

## Game state machines in TLA+ (2026-11-25)

Built. Three TLA+ specs in `specs/tla/` (snacks and pets, editing beaches,
neighbor links), each with the old (`Fixed = FALSE`) and current
(`Fixed = TRUE`) handler steps, checked with TLC (`specs/tla/check.sh`).
Each is mapped to its routes in [STATE_MACHINES.md](STATE_MACHINES.md) and
tested against the real server in-process, with no browser
(`server/test/stateMachines/`, `npm run test:state`, ~9 s): transitions one
at a time, TLC's counterexamples replayed with a gate that pauses a request
between statements, and seeded random walks compared step by step with a
TypeScript port of each spec.

TLC found five races, each reproduced on the server and fixed:
- befriending could finish after the last snack was picked up (a crab for
  one feed less, snack refunded): `adoptPet` is now one transaction with the
  beach lock;
- two visitor feeds at once both got the free daily feed:
  `visitorFeedPet` is one transaction with the beach lock;
- a save could still land after another device took over editing, and
- two saves at once could place more of a thing than owned: saves and
  restores now re-check the edit token and the bag in the same transaction
  as the write, holding the player's row lock (`asEditor`). Taking over
  holds that same lock, which the server test checks on PostgreSQL;
- an accept and a crossing ask could link two beaches on both sides of each
  other: `link()` is one transaction holding both beaches' locks and refuses
  a second link between them.

CI runs the TypeScript tests with the server suite, and TLC on every
spec's fixed form in the `Specs` workflow when `specs/` or `server/src/`
changes. New gameplay and features follow the model-first workflow
(CLAUDE.md ground rule, the `model-first` skill, STATE_MACHINES.md).

## Copying a beach (built 2026-11-26, docs/COPY_BEACH.md)

- Copy a public beach (or duplicate one of your own) onto one of your
  beaches or a new one: `copy` in the shore bar, "Copy to my beach" on
  beechshore.com (`?visit=CODE&copy=1`), "duplicate" in your beaches. When
  the bag is short: buy what's missing (the server works out the basket;
  bought one product at a time through the existing purchase paths), copy
  without them (`drop-missing`), or keep it as a checkpoint. Undo after
  every copy.
- One transaction per copy (player lock, source row `FOR SHARE`), as
  `specs/tla/BeachCopy.tla` requires; the restore route shares its write
  (`writeOnto`). Migration 30. Copies counted once per person
  (`beach_copies`), the owner gets an inbox row the first time, and the
  beach page shows "copied N times" and "Copied from".
- Differs from the design: no multi-product web order yet (one card
  checkout per product); the app shows the server's basket rather than
  computing its own; a new beach takes the original's place.

## Beech bucks and trade-ins (2026-11-26, docs/BEECH_BUCKS.md)

- Everything in the shop is priced in beech bucks (whole numbers, 10¢ a
  buck, same prices as before). Real money only buys beech-buck packs (App
  Store, Play, Steam, Xsolla, gift cards). The balance stays in
  `users.credit_cents`, always a whole number of bucks.
- Trade-ins: anything placeable that isn't on a beach, and unused extra
  beaches, go back for their recorded value (`inventory.unit_cents`: what
  was paid, a bundle or promo shared out; free things at list value; gifts
  keep theirs). Snacks, the pet crab and one-of-a-kind items can't be
  traded. One transaction under the player lock (`specs/tla/SandBucks.tla`).
- Refunds of packs claw back their bucks; what was spent becomes debt,
  paid off by the next bucks in. Creator royalties are in whole bucks and go
  back on a trade-in.
- Old app versions keep `/store/products` and their item receipts; new apps
  use `/store/catalog`. The copy sheet's "Buy what's missing" is now one
  beech-buck purchase (a pack first when the balance is short).
- Differs from the design: none so far. Owner tasks (store products) in
  BACKLOG.md.

### Review of PR #118 (2026-11-26)

Five findings, all fixed with a test each:
- the copy sheet's "Buy what's missing" reused nothing between attempts: a
  lost answer, then a retry, could charge twice. It now keeps the request ID
  until a receipt or a definite no (`tests/shopBasket.test.ts`, and a replay
  in `bucks.test.ts`);
- switching the copy target left the old basket buyable while the new fit
  loaded; the sheet now shows nothing to act on until the right answer is in,
  and drops answers for a target no longer selected;
- Steam (and a stale web page) can still check out the old item products;
- two owners copying each other's beach at once deadlocked on PostgreSQL;
  the copy now locks both beach rows in id order (a PostgreSQL-only test in
  `copy.test.ts` reproduced it first);
- a gifted community item now carries its creator royalty, so trading the
  gift in takes back the right one (migration 32, `inventory.royalty_ref`).

## Pets: six species, movable (2026-11-26, docs/PETS.md)

- Six species, wild first: sand crab, sandpiper, octopus, harbor seal, sea
  turtle, dolphin. One table on each side (`server/src/petCatalog.ts`,
  `src/world/pets.ts`), kept in step by `server/test/stateMachines/pets.test.ts`.
  Befriending takes `feeds` snacks (1 buck each) = a quarter of the shop
  price (20/28/40/48/60/80 bucks: 5/7/10/12/15/20 snacks); tests hold that
  rule. Products `pet_<species>` are built from the table, beech bucks only
  (`Product.bucksOnly`: not in `/store/products`, refused by every
  real-money checkout via `realMoneyProductById`; only `pet_crab` keeps its
  old listing for old apps); none trade in.
- `AnimalController` (`src/world/animals.ts`) moves each its own way: crab as
  before; sandpiper walks forwards and targets the wave edge, flies in and
  flutters from the brush; octopus creeps in 0.15–1.3 m of water, tints to
  the sand when still (`tint` uniform in the animal shader, masked by colour
  alpha), inks at the brush; seal and turtle swim at the surface and haul out
  (turtle lays flipper tracks: one updatable mesh, 1 draw call); a pet dolphin
  turns round at the ends instead of leaving. Sea pets' origins sit so their
  top (`PetKind.top × size`) is above the water: a test checks every frame
  (`tests/pets.test.ts`).
- Snacks can go in water ≥ 0.3 m (and ≤ 1.5 m): they float and bring sea or
  amphibious animals. The species a snack feeds is decided when it's tossed
  (`snackSpecies`) and sent to `POST /animals/feed {species}`; bonds are per
  species.
- Pets are things you own and move: migration 35 (`beach_pets.home_x/z`,
  `pet_bag`), `POST /pet/stow`, `POST /pet/place`, `PATCH /pet {home}`,
  `GET /pet/bag`; shop adopt takes a `home`. Removing a beach puts its pet in
  the bag. Long-press your pet to carry it (`AnimalController.carry`), tap to
  set it down, or "put in bag" in the place bar; bag pets and pet items are
  placed with a tap. `specs/tla/Pets.tla`: place is one transaction under the
  player and beach locks (TLC finds a pet on two beaches, or lost, in three
  steps); replays in `pets.test.ts`.
- `AnimalView` builds a species' mesh on first use; one enabled at a time
  (0 draws when empty, +1 for ink or tracks while shown). `?debug=1` spawns
  every species; `__beech.animals.setPet(species)` shows one on this device.
- Not done: E2E for carrying a pet (no browser E2E run here); pet names for
  new adoptions still come from rename only.
- New offers are beech bucks only (`Product.bucksOnly`): the five new pets and
  the pier (its Steam id 1019 was never set up and is dropped). Real money
  only buys beech-buck packs, plus the old item products for old app versions.

## How beech was built: /story (2026-11-27)

https://beech.games/story (`server/src/story.ts`) tells how beech was built in a few days by Mark and the agents (Claude, Antigravity, Muse, Codex). It is linked from the landing footer as "How it was built" and served on the landing host. The source logs, one per agent, are in `docs/story/`. Codex's log is still to come; add it to `docs/story/` and the page when it exists.
