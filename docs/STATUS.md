# Status

## Milestones

| # | Milestone | State |
|---|---|---|
| M0 | Scaffold (Vite + TS + Babylon, CI, Pages deploy workflow) | done |
| M1 | Diorama + camera (rest profile, slab strata, sky, far ocean, ortho camera with pan / pinch zoom to fingers / twist with 45° snap, desktop controls) | done |
| M2 | Sand toy (worker grid, screen-constant brush + ring, hold-to-deepen, rim, slump, undo/redo, second-finger cancel) | done |
| M3 | Waves (pipes water sim, swell sets, foam, wetting/drying) | todo |
| M4 | Erosion (sediment pick-up/drop/transport, saturated slump, healing, tuning panel) | todo |
| M5 | Ambience (audio, haptics, palettes + day cycle, UI polish, start screen) | todo |
| M6 | Ship (quality tiers, PWA/offline, Capacitor iOS + Android) | todo |
| M7 | Stretch (water table seepage, pile + smooth tools, shells, screenshot share) | todo |

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
- **Camera looks from the land toward the sea** (alpha = 135°), so the waves
  come toward the viewer.

## Verification

- `npm test`: unit tests for the sim (water/sand conservation, run-up range,
  hold-to-deepen, rim fraction, undo/redo/cancel/reset, determinism) and the
  brush math.
- `npm run smoke` (or `SMOKE_URL=http://localhost:5173/ npm run smoke` against
  a dev server) drives a headless browser through these checks: the sim is
  running, a touch dig is cancelled by a second finger, a one-finger touch digs,
  a mouse dig changes the sand, undo restores it and redo re-applies it.
