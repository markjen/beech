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
| `src/sim/sim.worker.ts`, `protocol.ts` | Worker loop and message types (including live `tune` and `bench`). Each frame carries the packed sand buffer and a packed positions buffer for the things on the beach; the roster of things only when it changes |
| `scripts/perf-sim.mjs` | The simulation's tick by phase and grid tier, in Node with the app's settings, and the 14-day catch-up (`npm run perf:sim`; `perf.mjs` budgets its totals) |
| `src/sim/catchup.ts` | The catch-up: what the sea did to a beach while nobody had it open, by half tide cycles (docs/LIVE_SIM.md). Tested in `tests/catchup.test.ts`. |
| `scripts/perf.mjs`, `perf/budget.json` | Performance profile (draw calls, meshes, main-thread and worker ms, bundle size) checked against budgets; `npm run perf`, CI's Performance workflow. See PERFORMANCE.md |
| `src/sim/objects.ts` | Things on the beach: rocks (raise the non-erodible floor), driftwood (floats, drifts, strands), shells and sea glass (rolled by fast water), flags (fixed), what the sea washes in, and owned things the sea takes out (`takeLost`). Tested in `tests/objects.test.ts`. |
| `src/sim/sandCodec.ts` | Saved-beach format: BCH1 (sand), BCH2 (sand plus placed objects, validated on load), and BCH3 (adds rock cover when any rock is buried) |
| `src/world/beachFile.ts` | Beach files (`.beach.json`, spec in BEACH_FILE.md): read and write, shapes, `reconcileItems` (what of a beach your bag can build) |
| `scripts/beach-file.mjs` | Offline beach-file tool: validate, rows/compact, heightmap PNG (`scripts/lib/png.mjs`) |
| `src/net/localStore.ts`, `src/ui/localCheckpoints.ts` | The sandbox build's device storage (IndexedDB): the beach between visits, and checkpoints on the device |
| `src/ui/checkpoints.ts` | Settings → checkpoints: save, list, restore here / onto another beach, undo, export, import (`CheckpointApi` in `src/net/account.ts`, the fit check in `src/world/checkpointFit.ts`) |
| `src/ui/shop.ts`, `server/src/bucks.ts`, `server/src/bucksDb.ts` | Sand bucks: the shop (balance, packs for real money, everything for sand bucks), trade-ins from the place bar and the bag (`src/ui/inventory.ts`); on the server the value rules (list values, sharing a price out) and the balance (credit with debt first, clawbacks, purchase grants and refunds). SAND_BUCKS.md |
| `src/ui/copyBeach.ts` | Copying a beach: the copy sheet (where it goes, what the bag lacks, buy what's missing, copy without them, keep as a checkpoint) and the copy waiting on a web checkout (`CopyApi` in `src/net/account.ts`; server: "copying a beach" in `server/src/app.ts`, `copyBasket` in `server/src/products.ts`). COPY_BEACH.md |
| `src/ui/pierPreview.ts` | The pier preview's "place pier" / "cancel" bar (the buy/place/remove rows are in `accountPanel.ts`; server: "piers" in `server/src/app.ts`, `PIER_SHOWN` in `server/src/shore.ts`). PIERS.md |
| `server/src/guide.ts`, `releaseNotes.ts` | The user guide, help and release notes at `/guide` and `/guide/releases` (`/help`, `/releases` redirect), rendered per request from the server's own constants (odds, grab chances, the claw's rest, this week's vending set). The game shows no explanatory notes; it links here (`GUIDE_URL` in `src/config.ts`) |
| `server/src/landingSite.ts`, `rootApp.ts` | The beech.games landing page: Host-header routing in `rootApp.ts` (`beech.games` + `www`, which 301s to the apex; no game API on those hosts), previewable under `/landing` on every other host. Numbers from the server's constants; "What's new" from `releaseNotes.ts`. See docs/LANDING_PAGE.md |
| `src/world/catchupBeach.ts` | A saved beach caught up at its place (decode, `catchUp` at the real tide, encode). Bundled for the server by `scripts/bundle-server.mjs` into `server/src/generated/catchup.ts` |
| `server/src/liveBeach.ts` | The server's catch-up on read: due or not, the owner's heartbeat, compare-and-set write with the "Before the tide" checkpoint and the event (docs/LIVE_SIM.md). Tested in `server/test/liveBeach.test.ts` |
| `server/src/checkpoints.ts` | Reads a saved beach on the server (`inspectBlob`), the restore fit check, dropping what's short |
| `src/ui/beachFileDialog.ts` | The import preview (map, items, warnings, shortfalls) and the file pick / download helpers |
| `src/sim/profile.ts`, `waves.ts`, `undoStack.ts` | Rest beach shape, swell/tide functions, stroke-delta undo |
| `src/render/beachRenderer.ts`, `shaders.ts` | All meshes and GLSL (sand, water, far ocean, skirts, rock, props) |
| `src/render/sky.ts` | Gradient background, sun, moon, stars and real-weather cloud puffs |
| `src/render/precip.ts` | Rain and snow: a 2D canvas over the scene, drawn only while something falls |
| `src/render/storeMeshes.ts`, `glow.ts`, `meshKit.ts` | The shop's pieces (parasol, surfboard, sandcastle, beach hut, lighthouse, tiki torch); the glow and sparkles on rare, legendary and shop things; shared mesh helpers |
| `src/render/objects.ts` | The props (rocks, driftwood, shells, flags, shop items…): shapes from each thing's variant, drawn as GPU thin instances through a scene-wide prop bank (one source mesh per look, shared by your beach and the neighbors'), eased to the sim's positions; things at rest aren't touched |
| `src/world/items.ts`, `src/ui/inventory.ts` | Item catalog (rarity, source, availability, price) and the bag tray |
| `src/input/*` | Ortho camera, gestures (dig vs camera), heightfield picking, brush math |
| `src/world/*` | Items (`items.ts`, above) and real beaches: `locations.ts` (catalogue), `astro.ts` (sun and moon), `tides.ts` (harmonic tide engine), `tideStations.json` (TICON-3 constants), `live.ts` (turns a beach and the current time into a palette, light, sky and tide), `weather.ts` (the real-weather report: WMO codes to a look, the grey/fog palette shift, measured wave height to swell scale) |
| `src/net/weather.ts` | Fetches `GET /api/weather` (every place at once) every 15 min in production builds, cached on the device |
| `src/ui/placePicker.ts` | The place picker on the Beaches tab: search, world map, places by region with local time and weather |
| `src/net/*` | Accounts (`account.ts`: session, API, Google button), `beachStore.ts` (every beach's state in memory by id, LRU, one save pipeline; docs/BEACH_STORE.md), `storeBackends.ts` (where beaches load from and save to), `snapshotCache.ts` (other people's beaches kept on the device), and `beachSync.ts` (which beach the wave worker simulates: the one of yours in view) |
| `server/` | Node + Hono + Postgres (PGlite locally): serves the production web app and `/api` (sign-in, sessions, saved beach, neighbors, delete account). Runs on Cloud Run. See docs/BACKEND.md and docs/GCP.md. The admin console is a second entry point in the same package (`adminServer.ts` → `adminApp.ts`), deployed as its own Cloud Run service `beech-admin` on the same database (docs/GIFT_CARDS_PROMOS.md). Payments: `store.ts` (App Store / Play verification), `xsolla.ts` (web checkout token and webhook signature, docs/WEB_PAYMENTS.md), `giftCards.ts` (credit and promos). |
| `server/src/shoreSite.ts`, `shore.ts`, `beachImage.ts` | beechshore.com, the public shore site (docs/SHORE_SITE.md): server-rendered pages, the shared shore walk, beach pictures as PNG |
| `src/net/share.ts`, `src/ui/shareSheet.ts` | Share links (game `?visit=` and beechshore) and sending them (share sheet or copy) |
| `src/world/guide.ts`, `src/ui/guide.ts`, `src/ui/invite.ts`, `server/src/referrals.ts` | The beach guide (steps, coach card, checklist) and invites (the panel, the ladder); the server's step gifts, ladder and rules. INVITES_GUIDE.md |
| `src/ui/inbox.ts`, `src/ui/visitorCard.ts`, `src/ui/inboxText.ts`, `server/src/inbox.ts` | Visitors and the inbox: the mailbox and its list, the "leave something" card, the rows' wording; the server's limits, quick notes and note filter. INBOX_NOTIFICATIONS.md |
| `src/ui/socialHub.ts` | The Inbox hub: one tab strip over the inbox, leaderboard, starred and visit-by-code dialogs |
| `src/ui/leaderboard.ts` | The leaderboard panel (most-starred beaches: all time and rising), with visit and star on each row |
| `src/render/neighbors.ts` | The shore: beaches down the chain of neighbor links as snapshot dioramas (drawn near the view), visiting by code, favorites |
| `src/render/pier.ts` | The pier on the middle of three of a player's beaches (docs/PIERS.md): its geometry and the layer `NeighborView` keeps in step with the shore |
| `Dockerfile` | Production image: web app (accounts on) + API server |
| `src/audio/ambience.ts` | Procedural Web Audio soundscape |
| `src/platform/*` | Runtime detection (`runtime.ts` for web/iOS/Android/Steam), haptics (Capacitor or vibrate), PWA registration, quality tier from benchmark, inbox notifications (`notify.ts`: web push, native push, Steam OS notifications) |
| `src/ui/*` | The HUD (`hud.ts`: palm, rail, dirt flyout, undo), the status pane (built in `main.ts`), start screen, hint, Manage sheet (`overlays.ts`), debug panel, settings storage |
| `scripts/` | `shot.mjs` (screenshots), `smoke.mjs` (end-to-end), `make-icons.mjs`, `set-version.mjs`, `extract-tides.mjs` (rebuild tide constants from TICON-3), `artifact-page.mjs` (claude.ai preview), `actions/*` (scripted interactions for screenshots) |
| `android/`, `ios/` | Capacitor native shells (see docs/MOBILE.md) |
| `desktop/` | Electron + `steamworks.js` Steam desktop shell (`app://beech/` protocol, SteamPipe VDFs; see docs/STEAM.md) |
