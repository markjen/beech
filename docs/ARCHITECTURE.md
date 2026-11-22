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
