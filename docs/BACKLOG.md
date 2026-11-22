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

- [ ] **Release setup for native sign-in** (DevOps): Android and iOS OAuth
  clients, build env vars, the Info.plist URL scheme, the Apple capability,
  and server client IDs. Steps are in BACKEND.md, "Phone apps". Then test on
  real devices.
- [ ] **Revoke Apple tokens on account delete**: App Store guideline
  5.1.1(v). Needs a Sign in with Apple private key in Secret Manager and a
  call to Apple's `/auth/revoke`.
- [ ] **Store privacy forms** (DevOps): the wording is in MOBILE.md.
- [ ] **Chair view polish**: let the chair move along the beach (and over to
  neighbors). Add surf foam lines on the static shore either side.
- [ ] **More free items**: a bucket that stamps sand castles, and a beach
  umbrella that casts a shadow (needs a shadow decal in the sand shader).
- [ ] **A "found" collection**: count what the sea brought in that you kept,
  and show rare finds (it could drop items here later).
- [ ] **Shop (paid items)**: App Store / Play billing (both stores require
  their own in-app purchase for digital goods) and Stripe on the web.
  Purchases are verified on the server, which writes `inventory` rows.
  Limited items use `available.until` and `expires_at`.
- [ ] **Mystery boxes and the claw machine**: server-side draws with
  published odds (Apple and Google require shown odds for paid random
  items, and some countries restrict them; check before shipping), rarity
  tiers, and a little claw-machine mini-game in front of the draw. Unique
  items: one owner only, enforced in the database.
- [ ] **TV**: test on a real Android TV (D-pad focus on the settings sheet,
  leanback banner). Add Chromecast / AirPlay casting for phones → TV.
- [ ] **API rate limiting**: a per-IP limit in the server, or Cloud Armor in
  front.
- [ ] **Mutual neighbors**: requests and accepts on top of codes.

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
