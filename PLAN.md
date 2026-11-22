# Beech: plan

A calm beach toy for phone and web. You get a small, floating stretch of sand by the ocean. You draw in the sand with your finger and watch the waves wash in and smooth it away. The look takes after the quiet diorama style of games like Monument Valley: flat pastel colors, soft gradients, an isometric camera and few details. The game itself is original.

---

## 1. Goals and non-goals

**Goals**
- One beach and an ocean whose waves run up the sand and pull back.
- Dig in the sand with a finger or mouse. Holding still digs deeper.
- Waves fill, soften and wear away anything you dig or pile up.
- Pan, zoom and rotate the camera.
- The brush is always the **same size on screen**. Zooming changes how much **sand** it covers: zoom in for fine detail, zoom out for broad digging.
- An undo button that works with one tap.
- Calm by default: no score, no timer, no fail state.
- Runs at 60 fps on mid-range phones (around iPhone 12 or Pixel 6) and in desktop browsers.

**Non-goals for v1**
- Other places, characters, story or progression.
- Realistic water (refraction, spray particles). The water is stylized on purpose.
- Multiplayer and cloud saves.

---

## 2. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Engine | **Babylon.js 8.x** (`@babylonjs/core`, tree-shaken ES modules) | The engine you asked for. Supports WebGPU with WebGL2 as a fallback. |
| Language and build | TypeScript + **Vite** | Fast development loop. Workers and shader imports work out of the box. |
| Simulation | Plain TypeScript on typed arrays in a **Web Worker** | Keeps the main thread free for drawing and touch input. Works the same on every browser. |
| Shaders | Babylon `ShaderMaterial` (GLSL, converted automatically for WebGPU) or Node Material | Needed for the height displacement, faceted look, foam and wet sand. |
| Audio | Babylon Audio Engine v2 (Web Audio) | Layered loops, plus volume and pan that follow the simulation. |
| Web distribution | **PWA** (manifest + service worker), static hosting (GitHub Pages, Netlify, etc.) | Installable, works offline, no app store needed to try it. |
| App stores | **Capacitor** wrapper for iOS and Android | The same build, plus native haptics and the store listings. |
| Tests | Vitest for simulation code, Playwright for smoke tests and screenshots | |

---

## 3. Look and feel

**Camera:** An **orthographic** camera looks down at about 30–35° (an isometric feel). Orthographic is the classic diorama look, and it also makes the screen-constant brush math simple (section 6).

**The diorama:** The beach is a floating rectangle of land, about 32 m along the shore and 24 m from the water up the beach. Its cut edges show stepped bands of color (dark wet sand, lighter sand, a rock band at the bottom). Below it, the scene fades into the sky gradient. The ocean runs past the edges of the slab and fades to the horizon in fog.

**Shading**
- Facets: compute the sand normals from screen-space derivatives (`dFdx`/`dFdy`). Every dig then shows up as crisp low-poly facets instead of a smooth blob.
- Lighting: one warm directional light plus a hemisphere light, run through a soft **3-step color ramp**. Little to no specular.
- Fake ambient occlusion: darken the bottoms of holes based on the height of neighboring cells, so digs read clearly without real shadows.
- **Wet sand:** a per-cell wetness value moves the sand color toward a deeper tone with a slight sheen. It dries slowly after the water pulls back. This is the main calm visual payoff.
- **Water:** flat-shaded and translucent. Color goes from turquoise in shallow water to teal in deep water, depending on water depth. Foam is a white band where the water is thin and fast-moving, and at the leading edge of each wave. The thin film of a receding wave fades out gently instead of cutting off hard.
- **Sky:** a full-screen gradient behind everything. Colors come from a palette file (dawn, day, golden hour, dusk). An optional slow day cycle blends between them over about 20 minutes.
- **Post-processing:** FXAA, a light vignette and very faint grain. No bloom.

**Palette:** all colors live in one `palette.ts` file, so the art direction can be tuned in a single place.

---

## 4. Architecture

```
 Main thread                                      Sim worker (owns all fields)
 ───────────────────────────────────────────      ───────────────────────────────────
 Input / gestures ──► BrushCommand ────────────►  sandBrush   (dig + rim)
   │                  UndoCommand  ────────────►  undoStack   (stroke deltas)
   ▼                                              slump       (angle of repose)
 CameraController (orthographic ArcRotate)        water       (shallow water, pipes)
                                                  erosion     (sediment move/deposit)
                                                  forcing     (swell + tide boundary)
 Renderer  ◄── height, water, wetness, foam ◄───  fixed 30 Hz step, 2 substeps
   ├ sandMesh  (vertex texture displacement)      (two buffer sets, passed back and
   ├ waterMesh (sand height + water depth)         forth with no copying)
   ├ oceanFar  (decorative, animated)
   └ sky / post
 Audio  ◄── wave events, dig intensity ◄────────
```

**Project layout**
```
src/
  main.ts                 startup, engine (WebGPU → WebGL2 fallback), main loop
  config.ts               grid size, physics constants, quality tiers
  palette.ts
  render/
    sandMaterial.ts       displacement, facets, wetness, cavity, brush ring
    waterMaterial.ts      depth color, foam, edge fade
    diorama.ts            slab sides with strata, far ocean, sky
    fieldTextures.ts      RawTexture uploads of only the changed region
  input/
    gestures.ts           pointer tracking, deciding dig vs. camera
    cameraController.ts   pan / pinch zoom / twist, clamping, inertia
    brushProjection.ts    screen px → world radius, picking the point on the sand
  sim/
    sim.worker.ts         message loop and fixed-timestep driver
    grid.ts               field storage, indexing, edge rules
    sandBrush.ts
    slump.ts
    water.ts
    erosion.ts
    forcing.ts
    undoStack.ts
    profile.ts            starting beach profile + slow "healing" target
  audio/ambience.ts
  ui/                     undo button, pause-waves, settings sheet (plain DOM over the canvas)
```

**The grid:** 256 cells along the shore × 192 cells up the beach, 12.5 cm per cell (32 m × 24 m). Each field is a `Float32Array`:
- `sand` – height of the sand surface (m)
- `water` – depth of the water above the sand (m)
- `flux` – outflow to the left, right, up and down neighbors (needed by the pipes model)
- `vel` – water velocity (x, y)
- `sediment` – sand carried in the water
- `wet` – wetness from 0 to 1
- `rest` – the beach's resting shape, used for slow healing

Low-end devices use a smaller tier: 192×144 cells at about 17 cm each.

**Drawing the fields:** after each step, the worker sends `sand`, `water` and `wet` (plus foam, computed from water speed and depth) back to the main thread with no copying. The main thread uploads only the changed region into R32F textures (a fallback format covers devices without float-texture filtering). The sand and water meshes are flat grids with one vertex per cell. The vertex shader reads the heights from the textures, so the CPU never rebuilds a mesh.

---

## 5. Camera and gestures

**Camera:** Babylon `ArcRotateCamera` in orthographic mode.
- **Zoom:** changes the orthographic half-height, from about 2.5 m (close up) to about 16 m (whole diorama). Pinch zooms **toward the point between your fingers**: the world point under that spot stays fixed by shifting the camera target.
- **Pan:** moves the camera target across the ground. The target is clamped so the beach always stays on screen.
- **Rotate:** a two-finger twist (or right-drag on desktop) turns the view around the vertical axis. When you let go it eases to the nearest 45° step, which keeps the clean isometric angles. The tilt stays fixed.
- Everything has short, soft inertia.

**Input mapping**

| Action | Touch | Mouse / keyboard |
|---|---|---|
| Dig | one finger | left button |
| Pan | two-finger drag | middle-drag, or Space + drag, or WASD |
| Zoom | pinch | scroll wheel, +/- |
| Rotate | two-finger twist | right-drag, Q/E |
| Undo | undo button | button, Ctrl/Cmd+Z |

**Telling digging from camera gestures:** a one-finger touch starts a dig right away, so it feels instant. If a second finger lands within about 150 ms, the stroke is **cancelled and rolled back** without a trace (using the same delta the undo uses) and the gesture becomes a camera move. While a camera gesture is active, digging is blocked until all fingers lift.

---

## 6. Sand: digging

**Brush that is the same size on screen**
```
brushPx        = 24 CSS px          (about a fingertip; tunable)
worldPerPx     = (ortho.right - ortho.left) / canvas.clientWidth
brushRadius_m  = brushPx * worldPerPx
```
With the orthographic camera, this is exact and depends only on zoom. Rough range: about **0.15 m** when fully zoomed in and about **1.2 m** when fully zoomed out. (If we ever switch to perspective, use the distance from the camera to the touched point to get `worldPerPx` instead.) A soft ring drawn in the sand shader, centered under the finger, shows the brush size as you zoom, even before you touch.

**Finding the touched point:** cast a ray against the sand heightfield (step along the ray across the grid, then refine), not against the flat base mesh. That way the finger lands correctly on dug ground.

**Digging, applied each frame the finger is down**
- Falloff: `k(r) = (1 - (r/R)²)²` for r < R.
- Depth per frame: `rate(t) * dt * k(r)`. Here `rate` starts at about 0.15 m/s and **rises to about 0.6 m/s after holding about 1.2 s**. A quick swipe leaves a shallow groove, and holding in one place digs a deep hole. Moving spreads the same rate over more cells, so slow drags dig deeper than fast ones without any special case.
- **Rim:** the dug volume is placed on a ring from R to 1.6R around the finger. When dragging, more of it goes to the sides of the stroke, so trenches get walls. Total sand stays the same, and the slump pass then softens the rims naturally.
- **Depth limits:** you cannot dig below a hard bottom about 1.2 m under the starting surface (the rock band seen on the slab sides).
- **Water table** (phase 2): holes dug below the local groundwater level slowly fill with water seeping up, like a real hole near the shore.

**Slump (sand sliding down slopes):** an iterative pass over the changed region moves sand downhill wherever a slope is steeper than the angle of repose. The angle depends on wetness:
- dry sand: about 33° (crumbles)
- damp sand: about 50° (holds shape, so walls and castles survive)
- saturated sand, under water: about 18° (gives way, which is why waves knock structures down)

This one rule produces most of what makes the sand look believable.

---

## 7. Water and waves

**Model:** a 2D shallow-water simulation using the "virtual pipes" method (Mei et al. 2007, *Fast Hydraulic Erosion Simulation and Visualization on GPU*, run here on the CPU). Each cell sends water to its four neighbors through flux "pipes" based on the difference in total height. The model is stable, cheap, keeps the total amount of water constant, and handles water rushing up the beach and draining back.

- **Time step:** dx = 0.125 m and the deepest simulated water is about 1.5 m, so the wave speed is about 3.8 m/s. To stay stable, dt must be at most about 0.016 s. That means **2 substeps per 30 Hz tick**.
- **Offshore edge (the wave source):** the water surface on the ocean edge is set to `tide(t) + swell(t)`:
  - swell: a sum of 2–3 sine waves with periods of 8–12 s and slowly drifting phases, giving natural **sets** (a few larger waves, then a lull)
  - amplitude: 0.25–0.5 m, with seeded randomness so the rhythm never sounds mechanical
  - tide (optional): ±0.4 m over about 10 minutes, so the wet line creeps slowly
- **Side edges:** wrap around or reflect (whichever looks better along the shore), with a damping strip so reflections don't build up.
- **Friction:** a Manning-style drag on shallow water, so receding waves leave a thin film that drains away calmly.
- **Wetness:** sand under water becomes fully wet (1). Once uncovered it dries with a time constant of about 25 s.
- **Foam:** `clamp(speed * a - depth * b)`, plus a value that lasts a moment and decays, so foam lines trail behind breaking edges.
- **Far ocean:** beyond the simulated area, a large decorative plane with gentle Gerstner-style ripples. It uses the same `swell(t)` phase so the horizon moves in time with the waves on the beach. Its color blends into the water mesh at the edge.

---

## 8. Erosion and deposition

This follows the same pipes paper:
- How much sand the water can carry: `C = Kc * |v| * max(sinα, ε) * depthFactor`
- If the water carries less than C, it picks up sand (`Ks`). If it carries more, it drops some (`Kd`).
- The carried sand moves with the water velocity (semi-Lagrangian advection).
- Saturated slump (section 6) runs right after, so a wall hit by a wave sags and collapses instead of being only scraped.

**Results we expect:** dug holes fill in from the wave side first. Rims and walls round off and then fall. Channels you dig toward the sea pull the backwash into them and get carved deeper. The beach slowly returns to smooth.

**Beach healing:** a very slow pull (time constant of several minutes) toward the `rest` profile, applied only where water reaches. This stops the beach from slowly drifting into something odd over a long session, and it keeps any mark you make temporary, which suits the calm, sand-mandala mood. The pull is gentle enough that it never cancels the visible effect of a wave.

**Starting beach shape:** a Dean equilibrium profile (`depth = A·x^(2/3)` offshore), a smooth swash slope of about 1:12, a gentle berm and a flat dry backshore. Add faint low-frequency noise along the shore (a little cuspate shoreline) so it does not look ruled.

**Parameters to tune:** Kc, Ks, Kd, the repose angles, the drying rate and the healing time constant all go in `config.ts`, with a debug panel (lil-gui, only in development builds).

---

## 9. Undo

- **One tap**: a large round button with a curved-arrow icon in the bottom right corner, where your thumb rests. Ctrl/Cmd+Z on desktop.
- **Each stroke is one undo step.** At the start of a stroke the worker saves the sand heights. At the end it stores only the **change** within the stroke's bounding box (sizes are in the notes on the design choices below).
- **Undo subtracts that stroke's change** instead of restoring the old heights. Any wave erosion since then is kept, so undoing an old stroke never brings back a broken wall or skips back in time. The result is clamped to the hard bottom, then slumped so everything settles.
- The stack keeps 32 entries. Redo: long-press the undo button (or Ctrl+Shift+Z).
- Feedback: a short soft "whoosh" sound and the restored sand eases in over about 150 ms instead of popping.
- A **"smooth the beach"** reset sits behind the settings sheet (not one tap away, since it wipes everything).

---

## 10. Ambience

**Audio layers**
- Base: a constant soft ocean bed.
- Per wave: a breaking and wash-up sample, triggered when `swell(t)` peaks, with volume set by its amplitude. A gentle backwash hiss follows.
- Digging: a granular sand-scrape sound whose volume and pitch follow dig speed. Damp sand sounds duller.
- Rare far-off gulls and wind gusts.
- Optional soft ambient music (a sparse pad), off by default.
- Sounds pan by the camera's rotation and quiet a little when zoomed far out.
- Audio starts after the first touch, as browsers require for autoplay.

**Haptics**
- Very light ticks while digging, rate following dig intensity. Uses Capacitor Haptics on iOS and `navigator.vibrate` on Android web.
- A soft bump on undo.

**Interface:** three small round geometric buttons (undo, pause or calm the waves, settings) in muted colors that match the palette. There is no other on-screen interface. A short start screen with the title and "touch to begin" (which unlocks audio) fades into the scene.

---

## 11. Performance budget (mid-range phone)

| Item | Budget |
|---|---|
| One simulation tick (2 substeps, 49k cells), in the worker | under 8 ms |
| Texture uploads per frame | under 1 ms (only the changed region) |
| Drawing (sand + water about 98k triangles each, sky, far ocean) | under 8 ms GPU |
| Draw calls | under 15 |
| JS heap | under 60 MB |

**Ways to stay in budget:**
- Quality tiers chosen automatically from a first-second benchmark: grid size, render scale (devicePixelRatio capped at 2), post-processing on or off.
- Skip settled water: rows with no water and no recent changes are not simulated.
- Pause the simulation and audio when the tab is hidden or the app is in the background.
- An optional battery-saver mode drops drawing to 30 fps.
- If the CPU worker is not fast enough at the high tier, move `water` and `erosion` into WebGPU compute shaders behind the same interface. This is not planned for v1.

---

## 12. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold | Vite + TS + Babylon, WebGPU/WebGL2 startup, CI deploys to GitHub Pages |
| M1 | Diorama and camera | Static beach (rest profile), slab strata, sky, far ocean. Orthographic camera with pan, pinch zoom toward the fingers, twist that snaps to 45° steps, and the matching desktop controls. |
| M2 | Sand toy | Worker grid, screen-constant brush with ring, dig that deepens when held, rim, wetness-aware slump, faceted sand shader, undo/redo, cancelling a dig when a second finger lands |
| M3 | Waves | Pipes water simulation, swell and sets at the offshore edge, water material with foam and edge fade, wetting and drying |
| M4 | Erosion | Sediment pickup and drop, carried sand, saturated slump, healing, tuning panel |
| M5 | Ambience | Audio layers linked to the simulation, haptics, palettes and day cycle, interface polish, start screen |
| M6 | Ship | Quality tiers, PWA (offline), Capacitor builds for iOS and Android, device testing pass |
| M7 (stretch) | Extras | Water table seepage, a pile/build tool, a smoothing tool, shells and small props that wash in, screenshot sharing |

M2 is the first point where it is fun to play. M3 and M4 are where it becomes the actual idea. Every milestone is playable on its own.

---

## 13. Testing

- **Unit tests (Vitest):** total water stays constant within 1e-4 when the edges are closed. Total sand stays constant through brush, slump and erosion (when healing is off). Undo after redo leaves things as they were. Brush radius math is correct at the zoom extremes.
- **Determinism:** a seeded simulation and a recorded input sequence must give the same field hashes. This makes physics regressions easy to catch.
- **Playwright:** the app boots on WebGL2 and WebGPU, a scripted dig + undo works, and visual snapshots of the starting scene.
- **Developer overlay:** frame time, simulation time, total sand and water, current brush radius in meters.

---

## 14. Notes on the design choices

- **Single-finger dig, two-finger camera.** This is the most natural split on touch, at the cost of no one-finger panning. If playtesting shows people expect one-finger pan, add an optional "hand / camera" toggle button rather than changing the default.
- **Same grid for sand and water.** One resolution keeps erosion simple and lines the fields up exactly. 12.5 cm cells are fine enough for the close-up brush (about 0.15 m radius, roughly 2.5 cells). If close-up digs look blocky, raise the grid to 384×288 at the high tier before trying anything more complex.
- **Undo subtracts the change instead of restoring a snapshot.** Waves and undo can then coexist without the scene jumping back in time.
- **Healing back toward the rest shape.** A long session never degrades the beach, and the "everything washes away" mood is a feature.
- **Memory for undo.** Changes are stored as Int16 values in millimetres. A typical stroke covering about 3,000 cells takes about 6 KB, so 32 undo steps fit easily.
