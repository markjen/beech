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
| `workerTickMs` | timing | the simulation's tick in the worker (median) |
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

## Ideas, if a budget gets tight

- Far neighbor beaches could skip their smallest things (shells, sea glass,
  pebbles).
- The worker's tick is mostly the water: the grid tiers in `src/config.ts`
  set its cost.
