# Architecture

```
 Main thread                                       Sim worker (src/sim/sim.worker.ts)
 ─────────────────────────────────────────         ───────────────────────────────────
 input/gestures.ts ── brush/undo msgs ──────────►  BeachSim (src/sim/beachSim.ts)
 input/cameraController.ts (ortho ArcRotate)         ├ brush stamps + rim
 input/sandPicker.ts (ray vs heightfield)            ├ virtual-pipes shallow water
                                                     ├ erosion / donor-cell transport
 render/beachRenderer.ts ◄── packed RGBA32F ──────    ├ slump (angle of repose by wetness)
   ├ sand grid mesh (vertex texture displacement)     ├ healing, seepage, wet/foam
   ├ water grid mesh (sand + depth, alpha)            └ UndoStack (stroke deltas)
   ├ slab side skirts + water cut-away
   ├ far-ocean apron (swell matches boundary)      fixed 30 Hz, 2 substeps;
   └ stepped rock base                             buffers are transferred, then
 render/sky.ts (gradient layer)                    returned, so nothing is allocated
                                                   per frame
```

## Coordinates

- Grid: `i` runs alongshore (world +X) and `j` runs cross-shore (world +Z).
  `j = 0` is the offshore edge. Cell `k = j*nx + i`.
- Sim units are metres from the grid's corner: `x = (i+0.5)*dx`, `y = (j+0.5)*dx`.
- World: `X = x + ORIGIN_X`, `Z = y + ORIGIN_Z` (the origin is the slab centre),
  and Y is height above mean sea level.

## Frame flow

1. The worker ticks `BeachSim.step(1/30)`, packs the fields into a pooled
   Float32Array and transfers it to the main thread.
2. The main thread uploads it into `texCur` (the old `texCur` becomes `texPrev`),
   copies the sand channel for picking, and transfers the buffer back.
3. Each render frame sets `frameMix` (0 to 1) from the time since the last frame.
   The vertex shaders blend between the previous and current frames.

## The swell is a pure function of time

`src/sim/waves.ts` holds `swellAt(t)` (the sum of three sines, seeded phases).
The sim uses it as the offshore boundary. The far-ocean shader evaluates the
same sines with a travel delay, so the decorative sea flows into the
simulated one.

## Module map

| Path | What |
|---|---|
| `src/main.ts` | Boot: engine, worker, tier choice, UI wiring and the render loop. Exposes `window.__beech` for tests. |
| `src/config.ts` | All tuning constants (grid tiers, waves, water, sand, erosion, brush, camera) |
| `src/palette.ts` | The four moods and the day-cycle blend |
| `src/sim/beachSim.ts` | The simulation, no DOM. Unit tested in `tests/sim.test.ts`. |
| `src/sim/sim.worker.ts`, `protocol.ts` | Worker loop and message types (including live `tune` and `bench`) |
| `src/sim/objects.ts` | Things on the beach: rocks (raise the non-erodible floor), driftwood (floats, drifts, strands), shells and sea glass (rolled by fast water), flags (fixed), and what the sea washes in. Tested in `tests/objects.test.ts`. |
| `src/sim/sandCodec.ts` | Saved-beach format: BCH1 (sand) and BCH2 (sand plus placed objects, validated on load) |
| `src/sim/profile.ts`, `waves.ts`, `undoStack.ts` | Rest beach shape, swell/tide functions, stroke-delta undo |
| `src/render/beachRenderer.ts`, `shaders.ts` | All meshes and GLSL (sand, water, far ocean, skirts, rock, props) |
| `src/render/sky.ts` | Gradient background |
| `src/render/storeMeshes.ts`, `glow.ts`, `meshKit.ts` | The shop's pieces (parasol, surfboard, sandcastle, beach hut, lighthouse, tiki torch); the glow and sparkles on rare, legendary and shop things; shared mesh helpers |
| `src/render/objects.ts` | Faceted rock, driftwood, shell, sea glass and flag meshes (shape from the object's variant), eased to the sim's positions |
| `src/world/items.ts`, `src/ui/inventory.ts` | Item catalog (rarity, source, availability, price) and the bag tray |
| `src/input/*` | Ortho camera, gestures (dig vs camera), heightfield picking, brush math |
| `src/world/*` | Items (`items.ts`, above) and real beaches: `locations.ts` (catalogue), `astro.ts` (sun and moon), `tides.ts` (harmonic tide engine), `tideStations.json` (TICON-3 constants), `live.ts` (turns a beach and the current time into a palette, light, sky and tide) |
| `src/net/*` | Accounts (`account.ts`: session, API, Google button) and `beachSync.ts` (restore and save the player's beach) |
| `server/` | Node + Hono + Postgres (PGlite locally): serves the production web app and `/api` (sign-in, sessions, saved beach, neighbors, delete account). Runs on Cloud Run. See docs/BACKEND.md and docs/GCP.md. |
| `src/render/neighbors.ts` | The shore: beaches down the chain of neighbor links as snapshot dioramas (drawn near the view), visiting by code, favorites, name tags |
| `Dockerfile` | Production image: web app (accounts on) + API server |
| `src/audio/ambience.ts` | Procedural Web Audio soundscape |
| `src/platform/*` | Haptics (Capacitor or vibrate), PWA registration, quality tier from benchmark |
| `src/ui/*` | HUD buttons and tools, start screen, hint, settings sheet, debug panel, settings storage |
| `scripts/` | `shot.mjs` (screenshots), `smoke.mjs` (end-to-end), `make-icons.mjs`, `set-version.mjs`, `extract-tides.mjs` (rebuild tide constants from TICON-3), `artifact-page.mjs` (claude.ai preview), `actions/*` (scripted interactions for screenshots) |
| `android/`, `ios/` | Capacitor native shells (see docs/MOBILE.md) |
