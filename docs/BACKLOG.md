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
- [ ] **Production domain**: pick one (for example `beech.markjen.com`), then
  map it to Cloud Run (see GCP.md).
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

_(nothing right now)_

## Up next (engineering)

- [ ] **More than one beach**: design in [MULTI_BEACH.md](MULTI_BEACH.md),
  four phases (data model and API → beaches list → connected beaches →
  shop). Owner decisions are listed at the end of that doc. People can
  already win an extra beach from the claw machine.

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
  leanback banner). Add Chromecast / AirPlay casting for phones → TV.
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

- [x] **Shop**: store items (glow and sparkle on the beach), more than one
  beach (live on different devices at once), purchases checked with Apple
  and Google, a pricing plan (PRICING.md) (2026-11-23).

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
