# Performance

The app has to stay smooth on mid-range phones, with a full beach and
neighbors on both sides. `scripts/perf.mjs` profiles it, and CI checks the
results against budgets.

## Run it

```bash
npm run build && npm run perf                    # fixed scenes, checked against perf/budget.json
node scripts/perf.mjs --profile                  # plus the top functions by CPU time per scene
node scripts/perf.mjs --throttle 4               # CPU 4x slower, about a mid-range phone
node scripts/perf.mjs --counts 0,400,2000,4000   # other scene sizes
node scripts/perf.mjs --baseline old.json        # show changes against an earlier run (--out writes one)
node scripts/perf.mjs --url http://localhost:5173/   # against a dev server instead of dist/
```

It serves `dist/` itself, opens it in headless Chromium (software GPU), and
for each scene loads a seeded, realistic mix of things onto the dry sand:
mostly free rocks, pebbles, driftwood, shells and flags, with about 2 %
special things (those glow). It waits until 8 seconds of *simulation* time
have passed (`--settle`), so the sand around new rocks has slumped on any
machine (CI's runs the sim about 4x slower than a laptop), then measures for a
few seconds.

| Metric | Kind | What it is |
|---|---|---|
| `drawCallsPerFrame` | count | every draw call in a frame (sand, water, sky, things, glows) |
| `meshes` | count | meshes in the scene |
| `thingDrawCalls` | count | draw calls the things and their glows take: one per distinct look, one per glow material (`ObjectView.drawCalls`) |
| `touchedPerFrame` | count | things whose matrices were rewritten in the last frame (on a still beach: just the flags) |
| `mainThingsMsPerFrame` | timing | main-thread ms per frame in `ObjectView.set/update/touch` |
| `sim.<tier>.msPerTick` | timing | the simulation's tick per grid tier, measured in Node with the app's settings (`scripts/perf-sim.mjs`, also `npm run perf:sim` for the phase breakdown) |
| `workerTickMs` | info | the tick as the page's worker reports it. Not budgeted: the software GPU keeps every core busy, so it mostly measures waiting for CPU time |
| `fps`, `heapMB` | timing | for information (software GPU: fps is far below a real device) |
| `bundle.*` | count | JavaScript size, raw and gzipped |

Counts are exact (the scene is seeded). Timings vary ±30 % between runs, more
on shared CI machines.

## Budgets

[`perf/budget.json`](../perf/budget.json) has a maximum for each checked
metric. Counts fail CI as soon as they go over; timings have loose limits
that only catch big regressions. When a change needs more (a new effect, a
bigger bundle for a feature), raise the number **in the same commit** and say
why in the commit message. Lowering a number after an improvement locks it
in.

## CI

`.github/workflows/perf.yml` runs on every push to `main`, on pull requests
that touch the app, every Monday, and by hand (Actions → Performance → Run).
Each run:

1. builds the app and installs Playwright's Chromium (pinned),
2. downloads the results of the last successful run on `main`,
3. runs `scripts/perf.mjs`, checks the budgets, and writes a table with the
   change since that run to the job summary,
4. keeps `perf-results.json` as an artifact for 90 days.

To see the trend, open the Performance runs on main; each summary shows the
change against the run before it.

## What's been done (and where the cost was)

2026-11-23, raising the limit on things from 400 to 2000 (STATUS.md, "How
much a beach holds"):

- Things are drawn as **GPU thin instances** through a scene-wide prop bank
  (`src/render/objects.ts`): one source mesh per look, shared by your beach
  and the neighbors'. Draw calls for 2000 things went from about 4,300 to
  about 150.
- The worker sends the roster only when it changes, and a packed
  `Float32Array` of positions every frame (transferred).
- Things at rest aren't touched: matrices are rewritten only for things that
  moved more than a millimetre, float or flutter.
- **Glows instanced too** (`src/render/glow.ts`): halos, sparkles and lamps
  are thin instances of one quad per material, facing the camera and
  twinkling in the vertex shader, so there's no per-glow JavaScript each
  frame. 2000 things: 315 → 163 draw calls a frame.

- **The simulation tick, −40 %** (`src/sim/beachSim.ts`), measured with
  `npm run perf:sim` (by phase) and confirmed in Chromium: the water step
  skips the dry rows above the swash (with flows and velocities zeroed as rows
  drop out, so the result is identical); erosion skips its slope and speed
  maths in water too deep to carry sand; `Math.hypot` (slow in V8) became
  `Math.sqrt` everywhere in the sim. Medium grid: 10.5 → 6.1 ms a tick (in
  Chromium 8.8 → 6.1 ms).

- **2026-11-24 profile & optimization pass**:
  - **Sim tick, another −41 %** (`src/sim/beachSim.ts`, `src/sim/objects.ts`, `src/sim/sim.worker.ts`):
    - `slump()` now evaluates `tanMax` lazily only where `|dh|` exceeds the wet repose floor, and tracks dirty rows across iterations (stopping after 1 scan when nothing slumped, −84 % on medium: 3.42 → 0.54 ms).
    - `flow()` precomputes surface elevation `sand + water`, skips dry/inactive pipes, algebraically eliminates the second division in flux damping, and skips `K` scaling when total outflow doesn't exceed cell depth (−24 %: 8.18 → 6.26 ms).
    - `updateWetFoam()` splits sponge rows out of the main loop, short-circuits `smoothstep`/`Math.sqrt` outside active thresholds, flushes `< 1e-6` to `0` (avoiding subnormal float decay), skips redundant writes, and runs a dry-only pass above `flowTop` (−52 %: 2.22 → 1.07 ms).
    - `erode()` tracks `sedTop` so Pass 2 is skipped when no sediment is suspended and copies only active rows (−38 %: 1.83 → 1.13 ms); `seep()`, `measureSwash()`, and `heal()` bound their row scans.
    - `loadDelta()` / `importBeach()` compute the stripped terrain once instead of once per object (eliminating ~512 MB of temporary copies on 2000-object loads), and `objPos` buffers are pooled back to the worker.
  - **Draw calls −47 % and main-thread work −94 %** (`src/render/objects.ts`, `src/render/shaders.ts`, `src/render/storeMeshes.ts`, `src/render/beachRenderer.ts`, `src/main.ts`):
    - Flag pennants now flutter in the vertex shader (`windTime` uniform), so flags settle and `touchedPerFrame` at 2000 things dropped **95 → 0** (−100 %); `ObjectView` maintains an `active` set for O(active) per-frame updates and snaps reused IDs consistently on bulk beach loads.
    - `PropBank` deduplicates unused variant keys, widens driftwood size buckets, merges same-material lighthouse bands (8 → 4 draws), and shares invariant sub-part sources (flag poles/cloths, deckchair frames, bottle corks): 2000 things dropped **171 → 91 draw calls** (**161 → 81** for things + glows).
    - `BeachRenderer.uploadFrame()` uses `engine.updateTextureData` (`texSubImage2D`) instead of reallocating textures with `texImage2D`, and `src/main.ts` coalesces texture uploads, `SandPicker.updateFromFrame`, and `ObjectView.touch()` to at most once per render frame — eliminating a 4.5–9 s `texImage2D` bottleneck on software GPUs and cutting `mainThingsMsPerFrame` at 2000 things **1.55 → 0.10 ms** (400 things: **1.97 → 0.00 ms**).
    - `BeachRenderer.update()`, `Horizon.update()`, `NeighborView.update()`, `Hud`, `LiveConditions`, and `main.ts` reuse scratch vectors/colours and dirty-check palette/lighting/DOM updates.
  - **Server OG image rendering −66 %** (`server/src/beachImage.ts`): hoisted constant `Math.pow` terms and per-column/per-row bilinear coordinates and removed per-pixel `[r, g, b]` allocations (~460 → ~157 ms for a 1200×630 card).

- **2026-11-26 performance & bundle-size pass**:
  - **Client JS bundle size** (`src/input/cameraController.ts`, `src/render/sky.ts`, `src/sim/modes.ts`, `src/net/beachStore.ts`, `src/net/telemetry.ts`, `src/main.ts`):
    - Replaced `ArcRotateCamera` and `FreeCamera` with `TargetCamera` + a small `OrbitCamera` subclass, dropping Babylon's unused camera inputs, behaviors, collisions, and `Animations` subsystem (−85 KB raw / −18 KB gzip from both main and total).
    - Replaced `Sky`'s Babylon `Layer` + `DynamicTexture` with a fullscreen clip-space triangle `Mesh`, `ShaderMaterial`, and `RawTexture`, dropping `Layer`, `layerSceneComponent`, `DynamicTexture`, and 4 layer shader chunks (−12 KB raw / −4 KB gzip).
    - Extracted `src/sim/modes.ts` and lazy-loaded `BeachSim` in `BeachStore` (loaded in parallel when fetching an editable non-local beach) so `BeachSim` is no longer in the main chunk.
    - Lazy-loaded `beachFileDialog` / `beachFile`, `LocalCheckpointsSection`, and account-only UI panels (`AccountPanel`, `CheckpointsSection`, `Shop`, `ClawMachine`, `VendingMachine`, `CopySheet`, `Leaderboard`, `SocialHub`, `DigFind`, `PierPreview`), and replaced `package.json` imports with `APP_VERSION`.
    - Sandbox main JS: **1323 → 1188 KB raw (350 → 314 KB gzip, −10.3 %)**; total JS: **1571 → 1476 KB raw (434 → 414 KB gzip, −4.6 %)**. Production (`VITE_ACCOUNTS=1`) main JS: **1494 → 1286 KB raw (401 → 344 KB gzip, −14.2 %)**.
  - **Simulation tick, another −6 % to −9 %** (`src/sim/beachSim.ts`):
    - `flow()` skips dead `vx`/`vy` computation on non-final substeps (`computeVel`), threads `wetTop` across substeps, hoists boundary checks in interior Pass 2 loops, and uses a deep-water fast-path (`d + water[kn] >= 2 * maxFluxDepth`) in Pass 1 (`flow` −11 % to −14 %).
    - `erode()` short-circuits `Math.sqrt` and division when `g2 <= minG2`, and `updateWetFoam()` reads only `sand[]` on dry rows above `wetTop`.
    - Sim tick in Node: low **5.85 → 5.37 ms**, medium **9.96 → 9.40 ms**, high **15.47 → 14.06 ms**.
  - **Main-thread allocations** (`src/input/cameraController.ts`): `groundFootprint()`, `forward()`, and `projectDirection()` reuse scratch vectors and matrices instead of allocating every frame.

## Ideas, if a budget gets tight

- Far neighbor beaches could skip their smallest things (shells, sea glass,
  pebbles).
- The tick is now water ~61 %, erosion ~11 %, wet/foam ~11 %, pack ~6 %,
  slump ~5 %. Further water gains would likely mean a WebAssembly/SIMD kernel
  or coarsening the grid tier in `src/config.ts`.

