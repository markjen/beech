# Backlog

The single list of what's left to do, for the owner and for agents.

**How to use it**
- Add new items to the right section, as `- [ ] **Short title**: one or two
  lines of detail`. Add a date when it helps.
- When you start an item, move it to **In progress** and put your name (or
  "agent") on it.
- When it's finished, tick it and move it to **Done** with the date and commit
  or PR. Prune Done now and then; git keeps the history.
- Agents: read this before starting work. Update it in the same commit as the
  work. Never tick an owner task yourself.

## Owner: things only you can do

- [ ] **Store products and payouts**: the Paid Apps agreement and banking on
  Apple, the payments profile on Google, then create the products and
  notification URLs. Step by step in MOBILE.md, "In-app purchases".

- [ ] **Google Cloud project**: run the one-time `gcloud` setup in
  [GCP.md](GCP.md), create the OAuth web client ID, set the GitHub variables,
  then set `GCP_ENABLED=1`.
- [ ] **Production domain**: `beech.games` is the main site (registered
  Nov 23, 2026); map it to Cloud Run (see GCP.md). `beech.markjen.com`
  stays mapped; `beechgame.com`/`beechgames.com` 301 to `beech.games`.
- [ ] **Privacy policy URL**: both stores and Google's OAuth consent screen
  need one.
- [ ] **Final app ID**: replace `app.beech.beach` before the first store
  upload; it can't change after publishing. The list of files is in
  [MOBILE.md](MOBILE.md).
- [ ] **Apple Developer account**: team ID and an App Store Connect API key.
  Add them to the repo secrets listed in MOBILE.md.
- [ ] **Google Play account**: an upload keystore, a service account, and a
  manual first upload. Add them to the repo secrets listed in MOBILE.md.
- [ ] **Default branch to `main`**: Settings → General. Then allow `main`
  under Settings → Environments → github-pages.

## In progress

- [ ] **Beach files: export and import** (agent, 2026-11-23): a documented
  `.beach.json` format, so people can design beaches offline. Plan, spec and
  milestones E1 to E5 in [BEACH_FILE.md](BEACH_FILE.md).
  - [x] E1 format, codec, JSON Schema, examples, tests (2026-11-23)
  - [x] E2 export and import in the app, with preview and inventory check (2026-11-23)
  - [x] E3 phone apps (share sheet, file picker) (2026-11-23; Android built here, iOS through CI, not tried on a device)
  - [x] E4 offline tool (`scripts/beach-file.mjs`) and design guide (2026-11-23)
  - [ ] E5 tie-in with checkpoints

## Up next (engineering)

- [ ] **Reload stale tabs**: send the build id with saves (or poll a
  `/version`), and when the server says the app is out of date (426) show
  "a new version is ready · reload" instead of a silent save failure. A tab
  left open across a world change corrupted Rose's beach (2026-11-23).
- [ ] **More than one beach**: design in [MULTI_BEACH.md](MULTI_BEACH.md),
  four phases (data model and API → beaches list → connected beaches →
  shop). Owner decisions are listed at the end of that doc. People can
  already win an extra beach from the claw machine.

- [ ] **Checkpoints**: save named copies of any of your beaches and restore
  one onto any of them, if your bag still holds its non-free things. Design
  in [CHECKPOINTS.md](CHECKPOINTS.md); owner decisions at its end.
  - [x] **C1** (2026-11-23; migration 13) Server: migration 11 (`checkpoints`, `beach.epoch`),
    `inspectBlob` (counts items from the BCH2 bytes), list / create from a
    beach / import / get / rename / delete with limits; client `countItems`
    counts `wild` non-free items. No visible change.
  - [x] **C2** (2026-11-23) Server: fit check and restore (strict and drop-missing), the
    automatic "before restore" checkpoint, a per-user lock, the epoch on
    beach GET/PUT. Server tests for the race and stale saves.
  - [ ] **C3** App: checkpoints in settings (save, list, rename, delete,
    restore here with confirm, short and undo), `BeachSync` reloads on a
    restore elsewhere. `scripts/checkpoints-e2e.mjs`, `npm run e2e:checkpoints`.
  - [ ] **C4** Restore onto another of your beaches; per-beach "checkpoint"
    action; red item chips when you'd be short.
  - [ ] **C5** Export a checkpoint as a beach file and import one, once
    `docs/BEACH_FILE.md` lands.
  - [ ] **C6** (optional) Client-drawn thumbnails; local checkpoints in the
    sandbox with "keep the sandbox beach on the device".

- [ ] **Release setup for native sign-in** (DevOps): Android and iOS OAuth
  clients, build env vars, the Info.plist URL scheme, the Apple capability,
  and server client IDs. Steps are in BACKEND.md, "Phone apps". Then test on
  real devices.
- [ ] **Revoke Apple tokens on account delete**: App Store guideline
  5.1.1(v). Needs a Sign in with Apple private key in Secret Manager and a
  call to Apple's `/auth/revoke`.
- [ ] **Store privacy forms** (DevOps): the wording is in MOBILE.md.
- [ ] **More free items**: a bucket that stamps sand castles, and a beach
  umbrella that casts a shadow (needs a shadow decal in the sand shader).
- [ ] **A "found" collection**: count what the sea brought in that you kept,
  and show rare finds (it could drop items here later).
- [ ] **Shop (paid items)**: App Store / Play billing (both stores require
  their own in-app purchase for digital goods) and Stripe on the web.
  Purchases are verified on the server, which writes `inventory` rows.
  Limited items use `available.until` and `expires_at`.
- [ ] **Mystery boxes (paid pulls)**: reuse `draw()` and the pulls table
  once billing exists. Before shipping, check the odds-disclosure rules and
  country restrictions for paid random items.
- [ ] **Unique items**: one owner only, enforced with a partial unique index
  on `inventory`, and a "found by …" note.
- [ ] **More prizes**: each pool item needs a catalog entry, a kind, a mesh
  and an icon; `tests/items.test.ts` keeps the pools and catalog in step.
- [ ] **TV**: test on a real Android TV (D-pad focus on the settings sheet,
  leanback banner). Add Chromecast / AirPlay casting for phones → TV
  (an in-app cast button needs a custom Cast receiver app — $5 console
  registration; tab casting from Chrome works today, see
  [CHROME_TV_CAST.md](CHROME_TV_CAST.md)).
- [ ] **API rate limiting**: a per-IP limit in the server, or Cloud Armor in
  front.
- [ ] **Keep my beach off the shore**: a setting to leave the global beachfront
  (and only be visited by code or as someone's neighbor).
- [ ] **Ask from the shore**: when walking past a beach at the end of a
  stretch, offer "ask to be neighbors" right on its name tag.
- [ ] **Push for neighbor requests**: today you see them the next time the
  app polls (30 s) or opens.
- [ ] **Long-press to pick up and drag items**: long-press on an item picks
  it up, then drag it somewhere else and release to put it down.

## Ideas

- [ ] Tide-pool life: tiny crabs that scurry away from your finger.
- [ ] Footprints and a little figure walking the waterline.
- [ ] Sand-castle bucket stamps as a fourth tool.
- [ ] Keep the sandbox beach on the device (IndexedDB) between visits.
- [ ] More real beaches (Reynisfjara, Whitehaven, Navagio…), maybe with
  per-beach slope and sand-grain colour.
- [ ] Weather: overcast, drizzle and wind, from a live forecast for the beach.
- [ ] A WebGPU compute path for the simulation on high-end devices.
- [ ] Seasonal sky (sun height already follows the date), and a meteor
  shower night.

## Done (recent)

- [x] **QA pass of main** (2026-11-23): neighbor name tags kept on screen
  and off the place card and tool column (`src/ui/tagPlace.ts`, tested);
  account panel rows no longer squeeze (visit box cut off, a beach's name
  forced into 3.2em, button labels on two or three lines); the settings
  actions wrap instead of squeezing; one × in the place bar while gifting;
  credit purchases are `shop` items, not `gift`.
- [x] **Gift cards, promos and credit on the web only** (2026-11-23): the
  iOS and Android apps no longer show the redeem box, the promo field, the
  credit line or "Buy with credit" (App Store 3.1.1 / Play payments
  policy); `codesAllowed()` in `src/net/shop.ts`.
- [x] **Bulldozer and vacuum can clear rocks** (2026-11-23): the dozer
  blade and the vacuum used to skip placed rocks (`sweepAt` had an explicit
  `kind === 'rock'` exclusion, "they're terrain") — now a rock in the path
  is swept back into the bag like any other placed item, on tap and on
  drag, and the dozer flattens the sand the rock was sitting on. Undo,
  redo and second-finger cancel put the rock back exactly: the rock's
  placed height is now stored on the object (`base`), the sand a swept
  rock lifts back is kept out of the stroke's undo delta, and cancel
  re-embeds swept objects before restoring the sand. The terrain rock —
  the non-erodible floor you can't dig below — is untouched.
- [x] **Gift cards and promo codes** (2026-11-23): gift cards are prepaid
  credit (16-char bearer codes, HMAC-SHA-256 under a pepper, shown once at
  issue, never stored); promo codes discount a server-side credit purchase
  (percent/fixed, per-product, usage caps, expiry, claimed atomically with
  the purchase). Admin console at `/admin` (Google sign-in + allowlist:
  markjen@gmail.com only) and CLI `scripts/beech-admin.mjs` (admin API
  token from the environment, hashed server-side). Design and setup in
  [GIFT_CARDS_PROMOS.md](GIFT_CARDS_PROMOS.md). **Before merging: create
  Secret Manager secrets `beech-admin-token` and `beech-gift-code-pepper`
  and set the `ADMIN_EMAILS` Actions variable, or the deploy fails.**

- [x] **Digging finds** (2026-11-23, 18ef11a): digging can turn up a buried item from
  this week's vending set at the vending odds (60/25/12/3) — server-side roll
  at the end of a real dig stroke (2 m travelled, or 1 s in place), 1 in 10
  good digs, at most 3 finds a day and one roll every 30 s, granted atomically
  to the bag and shown in a "You dug something up!" dialog (Keep it / Put it
  on the beach). Design in DIGGING_FINDS.md.

- [x] **Bulldozer drag-flattens, dig/build/flatten faster**
  (2026-11-22, 3ad5ed4): one pass of the blade now flattens at any drag speed
  (flattenRate 120 → 300); dig/build rates up (rateStart 0.16 → 0.5,
  rateHeld 0.6 → 1.0, holdRamp 1.2 → 0.6 s) — 0.4 m dug in 0.67 s
  holding still (was 1.40 s), a 1 m/s drag digs 0.085 m (was 0.027 m).
  Returning scooped-up items to the bag is the clearing tool's dozer mode
  (PR #17), which carries the sweep mechanism — this PR keeps only the
  rate tuning. New `tests/bulldozer.test.ts` (5 tests: one-pass flatten,
  faster dig/build timings, tuned-rate assertions).
- [x] **Shop**: store items (glow and sparkle on the beach), more than one
  beach (live on different devices at once), purchases checked with Apple
  and Google, a pricing plan (PRICING.md) (2026-11-23).

- [x] **Settings beach map: your beaches on a world map, west to east**
  (2026-11-23, 6b4f36d): `src/ui/beachMap.ts` plots each beach at its real lon/lat
  on a self-contained stylized SVG world map (no tiles); the settings list
  and favorites are ordered west to east; dots are tappable to open a beach.

- [x] **Clearing tool: dozer, flatten, and vacuum in one top-level tool**
  (2026-11-23, d07a043): the item tool only places now (its tap-to-pick-up is gone);
  a vacuum cleaner tool picks items up on a tap and vacuums the drag path on
  hold-and-drag; dozer, flatten, and vacuum live under one "Clearing" tool
  with a mode strip. Dozer and vacuum sweep through the same worker-side
  mechanism as the bulldozer PR (#16): objects are removed from the beach and
  the bag counts owned minus placed, so the return is automatic; rocks stay,
  wild strays are swept away but never credited; strokes are undoable.
- [x] **Claw machine can miss** (2026-11-22): the server rolls a grab after
  the draw — the claw keeps a common ball 80% of the time, a rare one 65%,
  a legendary one 40% (about 1 go in 4 comes up empty). Starter gifts always
  hold. A miss spends the go, wins nothing, and the claw lifts empty with an
  "It slipped out of the claw!" reveal naming what dropped. Grab chances are
  published (GET /pulls) and shown under the odds.
- [x] **Vending machine: one free ball a day from a weekly set**
  (2026-11-23, a6b20d1): server-side draws, common 60 / uncommon 25 /
  rare 12 / unique 3, one ball a day (UTC midnight). Week 1 "First light":
  Pink shell, Blue sea glass, Pebble / Spiral conch, Golden sand dollar /
  Sunset starfish, Green bottle / Nautilus (new kind). Sets are data in
  `server/src/vending.ts`; design and the weekly process in
  `docs/VENDING_MACHINE.md`.
- [x] **Objects floating off Rose's beach** (2026-11-23): server refuses
  saves from the old 32 × 24 app; `fitWorld` repairs objects it shifted.
- [x] **Leaderboard of the most-starred beaches** (2026-11-23): a trophy
  button opens "All time" (stars now) and "Rising" (star velocity: this
  week's stars, halved every 2 days of age). Visit or star from each row.
  `GET /api/leaderboard`, migration 10 (`star_first`), `npm run e2e:leaderboard`.

- [x] **Chrome fullscreen + TV casting** (2026-11-22): the PWA manifest
  named `.webp` icons that were never shipped, so Chrome never offered to
  install — now the real 192/512/maskable PNGs, with `tests/pwa.test.ts`
  guarding them; one-tap "watch on TV" in settings (ambient + chair view
  + fullscreen). Packaged Chrome Apps are deprecated/removed, so the path
  is install the PWA, fullscreen, cast the tab — see
  [CHROME_TV_CAST.md](CHROME_TV_CAST.md).
- [x] **Observability** (2026-11-22): structured JSON request logs +
  log-based metrics, client error/perf reporting, a Monitoring dashboard,
  uptime checks and 5 alerts to markjen@gmail.com (branch
  `feat/observability`, commit f98ff9d, pushed; Terraform applied,
  all 17 resources live — see docs/OBSERVABILITY.md).
- [x] **Share your beach by link, and gift items** (2026-11-22):
  `?visit=CODE` opens that beach once signed in; copy-link button next
  to your code; Open Graph previews for shared links; `POST /api/gifts`
  moves one owned item to the owner of the beach with that code — instant,
  atomic, 20 an hour. Design and decisions in
  [SHARING_GIFTING.md](SHARING_GIFTING.md). Commit `6d05a46`.
- [x] **Claw starter gifts** (rare, shop item, extra beach after a day),
  the Deckchair, and the multi-beach design (2026-11-23).

- [x] **Phone fixes (#4, #5, #6); claw cooldown 5 min doubling to a day;
  bigger shells** (2026-11-22).

- [x] **Mutual neighbors on one global beachfront, with infinite scroll**
  (2026-11-22).

- [x] **Bulldozer; the sea 8 m further out; varied waves (sets, big
  sets, swell at an angle)** (2026-11-22).

- [x] **Look tool; walk the whole shore; home button; visit by code;
  favorites** (2026-11-22).

- [x] **Zoom in closer; choose item sizes** (2026-11-22).

- [x] **Free daily claw machine** (2026-11-22): server-side draws with
  published odds, one go a day, prizes (conch, sand dollar, starfish,
  message in a bottle) in the bag with counts.

- [x] **Chair view: walk along the beach, surf on the shore either side**
  (2026-11-22). Hold ‹ › (or Q/E) to walk the chair across your beach and
  your neighbors'. The static shore has a wet band and a foam edge driven by
  the same swell.

- [x] **Live neighbor sand** (2026-11-22): every 30 s the app checks
  `/api/neighbors` for newer saves next door and repaints in place. Paused
  in the background. Push (SSE) is possible later if 30 s feels slow.

- [x] **Shells, sea glass and flags; the sea washes things in** (2026-11-22).

- [x] **Native sign-in in the apps** (2026-11-22): Google (Android + iOS) and
  Sign in with Apple (iOS) through `@capgo/capacitor-social-login`. Facebook
  and Twitter SDKs are excluded. The Android debug build passes; device
  testing waits on the release setup above.

- [x] **Inventory: rocks and driftwood** (2026-11-22). Bag tray, place and
  pick up (undoable), rocks shape the flow and erosion, driftwood floats and
  strands, saved with the beach (BCH2), shown on neighbors' beaches. Item
  catalog and server `inventory` table ready for paid, limited and pulled
  items.
- [x] **Animated diorama ↔ chair transition** (2026-11-22).

- [x] **Tilt and chair view, landscape and TV** (2026-11-22). Tilt the
  diorama (two fingers sliding up/down, right-drag, or R/F). The chair view
  (button or V) sits you on the sand facing an open sea to the horizon,
  shore continuing either side, real sun and moon. Ambient/TV mode (`?tv=1`
  or settings) hides idle controls and keeps the screen awake, with a full
  screen button. Android TV launcher support.
- [x] **Neighbors and Google Cloud backend** (2026-11-22): see BACKEND.md and
  GCP.md.
- [x] **Accounts and saved beaches** (2026-11-22).
- [x] **Real beaches, sun, moon and tides** (2026-11-22).
- [x] **Milestones M0-M7** (2026-11-22): see STATUS.md.
