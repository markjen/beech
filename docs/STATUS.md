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
- **Minimum brush is 2 grid cells** (25 cm at the medium tier). This caps
  zoom-in, so the finest dig still looks clean on a 12.5 cm grid.
- **Dry sand angle of repose is 36°** (not 33°), so held digs in dry sand
  deepen visibly before they widen.
- **Second-finger cancel window: 220 ms.** Within that window the dig is rolled
  back exactly from the stroke snapshot. After it, the stroke is kept.
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
- **Tools are a small column above the undo button** (dig / build / smooth,
  keys 1-3). Build adds sand from a "bucket" (it isn't taken from nearby), so
  the sand total goes up. Undo removes it like any other stroke.
- **Shells** are decorative props on the main thread. One spawns at the top of
  the run-up after a wave recedes (every 14-36 s), follows the sand height,
  drifts with the swash and fades after 2.5-5 minutes. They are drawn
  larger than life (about 15 cm) so they read at diorama scale.
- **Camera looks from the land toward the sea** (alpha = 135°), so the waves
  come toward the viewer.

## Ideas beyond the plan (not started)

- Tide-pool life (tiny crabs that scurry from the finger), footprints.
- Sand-castle stamps (bucket shapes) as a fourth tool.
- Persisting the beach between sessions (save the sand field to IndexedDB).
- WebGPU compute path for the sim at the `high` tier.

## Deploy and build status

- **iOS:** the Xcode project builds for the simulator on GitHub's macOS
  runner (`mobile.yml`, first green run on the dev branch). That build is
  unsigned. A signed archive needs an Apple Developer team (`release-mobile.yml`).
- **Android:** a debug APK, an unsigned release AAB, and a release AAB signed
  from the `BEECH_KEYSTORE_*` env vars (tested with a throwaway key) all built
  locally. CI builds the debug APK and the release AAB too.
- **GitHub Pages:** the deploy workflow runs on `main` and on the dev branch,
  but it fails at `configure-pages` ("Create Pages site failed: Resource not
  accessible by integration"). The workflow token isn't allowed to switch
  Pages on. A repo admin must set **Settings → Pages → Source: GitHub
  Actions** once and then re-run "Deploy web build to GitHub Pages".
  If the `github-pages` environment only allows `main`, either merge first or
  add the dev branch under Settings → Environments → github-pages.
- **Web preview meanwhile:** the built game is published as a private
  claude.ai artifact (Beech Seaside Toy), made with
  `node scripts/artifact-page.mjs` after `npm run build`.

## Next steps owned by the repo owner (deferred by choice, 2026-11-22)

- **GitHub Pages:** skipped for now. The private claude.ai artifact is the
  web build. To go live: enable Pages (see above) and re-run the deploy.
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
