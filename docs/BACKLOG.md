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

- [ ] **Xsolla account for web checkout**: Publisher Account, agreement,
  tax and payout; catalog SKUs = product ids; webhook URL; two secrets and
  the deploy-workflow lines. Step by step in
  [WEB_PAYMENTS.md](WEB_PAYMENTS.md), "Turning it on". Get the all-in fee
  in writing first. Then answer that doc's open questions.

- [ ] **Google Cloud project**: run the one-time `gcloud` setup in
  [GCP.md](GCP.md), create the OAuth web client ID, set the GitHub variables,
  then set `GCP_ENABLED=1`.
- [ ] **beechshore.com domain**: map it (and www) to the `beech` Cloud Run
  service and add the DNS records; the site already answers to it. Steps in
  [SHORE_SITE.md](SHORE_SITE.md), "Turning on the domain". Until then it is
  at `/shore` on https://play.beech.games, but shared links say
  beechshore.com. Store forms still need the shore-visibility wording; the
  privacy policy (https://beech.games/privacy.html) already covers it.
- [ ] **Apple Developer account**: team ID and an App Store Connect API key.
  Add them to the repo secrets listed in MOBILE.md.
- [ ] **Google Play listing**: the account, upload keystore, service account
  and first upload are done (AAB 1.0.0 build 1 on the internal track as a
  draft, via the release workflow — no manual upload was needed). Still
  manual in Play Console: listing text, content rating, data safety,
  target audience (13+), testers, promoting the draft. See MOBILE.md.
- [ ] **Steamworks Partner account & AppID**: register Jenerator Labs on
  Steamworks, complete tax/banking, pay the $100 Steam Direct fee for
  `STEAM_APP_ID` and Depot IDs, create a Publisher Web API Key (User Auth +
  Microtransaction permissions) in Secret Manager (`beech-steam-web-api-key`),
  and create a restricted Steam Build Account (`STEAM_BUILD_USERNAME`,
  `STEAM_BUILD_PASSWORD`, `STEAM_CONFIG_VDF`). See [STEAM.md](STEAM.md).
- [ ] **Create the Discord server**: the feedback channel for players.
  Server created 2026-11-23; its permanent invite
  (`https://discord.gg/y7EGw2yg2d`) is in PR #40 (draft) — tick this once
  that merges.

## Owner decisions

- [ ] **Invite rewards** (2026-11-23): check the ladder (parasol,
  surfboard, extra beach at 3 friends, tiki torch, sandcastle, then
  starfish; 10 at most), "settled in = 3 guide steps", and the welcome
  parasol. All in `server/src/referrals.ts`. [INVITES_GUIDE.md](INVITES_GUIDE.md),
  "Decisions for the owner".

- [ ] **Inbox defaults** (2026-11-24): notes private, ratings off the
  leaderboard, gifts instant, push limits. Built with the defaults in
  [INBOX_NOTIFICATIONS.md](INBOX_NOTIFICATIONS.md), "Decisions for the
  owner"; also keep or drop the beach guide's coach card under the
  no-notes rule (it shows only the next step's name now).

- [ ] **Push notifications: keys and consoles** (2026-11-24): VAPID keys
  in Secret Manager and two Actions variables (web), Firebase on
  `beech-prod`, the APNs key uploaded to Firebase, the iOS capability and
  the FCM role (apps). Step by step in
  [INBOX_NOTIFICATIONS.md](INBOX_NOTIFICATIONS.md), "Turning on push:
  owner steps". Then an agent builds V5 / V6.

## In progress

_(nothing right now)_

## Up next (engineering)

Items marked **(model first)** change state the server keeps: they start
with their TLA+ spec ([STATE_MACHINES.md](STATE_MACHINES.md#model-first-workflow),
CLAUDE.md "Model first"). Gameplay ideas below get the same once they're
picked up.

- [ ] **Palm-first UI, follow-ups**: real weather (temperature, sky) for
  the status pane's first line; credit, stars and finds-today chips in
  the expanded pane (they need their own requests); decide whether the
  palm should also fade after idle outside ambient mode (the mockup's open
  question; for now it never does). Tap-the-sand-to-close was left out:
  a tap is also how you stop a glide.
- [ ] **Live beaches, next**: SSE instead of polling if the 5 s polls show up in
  Cloud Run costs; catch up the beechshore.com page pictures too; one
  saving device per owner (a lease) if two devices fighting shows up
  **(model first: extend `specs/tla/BeachEditing.tla`)**. See
  [LIVE_SIM.md](LIVE_SIM.md).
- [ ] **Sandcastle mini-game: customize detailed sandcastles**
  **(model first, if castles are saved, unlocked or spent)**: Rose
  asked for more sandcastle shapes (Discord #feedback, 2026-11-23);
  Mark (2026-11-24) chose a mini-game instead — let users build and
  customize a detailed sandcastle (towers, walls, moat, decorations)
  rather than adding more preset shapes. The shop sandcastle ($1.99,
  legendary) stays as is.
- [ ] **Little figure walking the waterline**: from the footprints
  line (Rose, Discord #feedback 2026-11-23). A small ambient figure
  strolling the waterline in chair view, leaving fading footprints
  behind it. Did not ship with the free footprints item: there is no
  character mesh, walk animation, or fading-decal system in the app,
  so it needs a new render subsystem rather than an item.
- [ ] **Steam S6 (Storefront & launch)**: 2024+ Steam capsule & library
  assets, 1080p screenshots/trailer, Coming Soon page (≥14 days), and Valve
  Build Review (`public/privacy.html` already updated). See
  [STEAM.md](STEAM.md).
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
- [ ] **Promo codes on web card payments**: mirror codes into Xsolla and
  accept `order.promocodes` on `order_paid` (WEB_PAYMENTS.md, "Promo
  codes"). Only if Mark wants it (open question 2).
- [ ] **Mystery boxes (paid pulls)**: reuse `draw()` and the pulls table
  once billing exists. Before shipping, check the odds-disclosure rules and
  country restrictions for paid random items.
- [ ] **More prizes**: each pool item needs a catalog entry, a kind, a mesh
  and an icon; `tests/items.test.ts` keeps the pools and catalog in step.
- [ ] **TV**: test on a real Android TV (D-pad focus on the settings sheet,
  leanback banner). Add Chromecast / AirPlay casting for phones → TV
  (an in-app cast button needs a custom Cast receiver app — $5 console
  registration; tab casting from Chrome works today, see
  [CHROME_TV_CAST.md](CHROME_TV_CAST.md)).
- [ ] **Push for neighbor requests**: today you see them the next time the
  app polls (30 s) or opens.
- [ ] **Push notifications (inbox V5, V6)**: web push (VAPID keys in
  Secret Manager, `push_subscriptions`, a send job with the hourly limit
  and quiet hours), then native push (APNs key, Firebase project,
  `@capacitor/push-notifications`). [INBOX_NOTIFICATIONS.md](INBOX_NOTIFICATIONS.md),
  section 3. Owner setup first.
- [ ] **Ratings on name tags**: the shore walk's JSON carries each beach's
  average, shown on the name tags along the shore (today: in the visitor card).
- [ ] **Admin: suspend a sender's notes** after repeated reports (today
  the admin can hide a note or dismiss the report).
- [ ] **Flaky tests**: `npm run e2e:checkpoints` times out at varying
  steps in the cloud container, also on main (so do `neighbors`, `live`,
  `shore`, `beaches` and `leaderboard`: signing a second device in).
  `shore` also times out at its first sign-in: the first save lands ~10 s
  after `signInDev` in the container, against a 15 s wait that includes
  the shore loading.
- [ ] **Invites: open in the apps**: Universal Links / App Links so
  `?invite=` and `?visit=` links open the phone apps (the invite code is
  kept in `localStorage`, so the claim works the same once it lands).
- [ ] **Admin: referrals view**: who invited whom, for disputes and to
  spot farming (`referrals` table).
- [ ] **More guide steps**: the clearing tool, calming the waves, the
  vending machine, a checkpoint. Add to both `src/world/guide.ts` and
  `server/src/referrals.ts` (`tests/guide.test.ts` keeps them in step).
- [ ] **Long-press to pick up and drag items**: long-press on an item picks
  it up, then drag it somewhere else and release to put it down.

## Ideas

- Model more state machines the same way: the claw machine (goes,
  cooldowns, starter gifts), dig finds (daily cap), shop orders and refunds
  (Xsolla, Steam, Apple and Google), checkpoints (limits, the auto slot),
  and the app's BeachStore save pipeline (see STATE_MACHINES.md).

- Verify more with LemmaScript: the app's copy of the restore check
  (`src/world/checkpointFit.ts`), item-size and beach-capacity limits,
  referral ladder rewards. See [VERIFICATION.md](VERIFICATION.md).
- [ ] Sand-castle bucket stamps as a fourth tool.
- [ ] More real beaches (Reynisfjara, Whitehaven, Navagio…), maybe with
  per-beach slope and sand-grain colour.
- [ ] Weather: overcast, drizzle and wind, from a live forecast for the beach.
- [ ] A WebGPU compute path for the simulation on high-end devices.
- [ ] Seasonal sky (sun height already follows the date), and a meteor
  shower night.

## Done (recent)

- [x] **Viewers' sand eases to each new save** (2026-11-26): someone
  else's beach in front of you blends from the drawn snapshot to the new
  save over 1 s instead of swapping, and things moved on a snapshot beach
  glide there (they used to stay put until the beach was rebuilt).

- [x] **Beach store, next** (2026-11-25): other people's beaches kept on
  the device (IndexedDB, by id, checked against the shore's save time) so
  reloads and re-anchors don't refetch them; the waves ease onto a beach
  from its snapshot's water instead of a one-frame swap
  ([BEACH_STORE.md](BEACH_STORE.md)). Also fixed `e2e:sandbox`, which read
  the sand before the hide-save and the first worker frame had landed.

- [x] **Game state machines in TLA+** (2026-11-25): snacks and pets,
  editing beaches and neighbor links modelled and checked with TLC, mapped
  to the routes, and tested without a browser (transition tests, replayed
  counterexamples, random walks against a model). Five races found and
  fixed ([STATE_MACHINES.md](STATE_MACHINES.md)).

- [x] **Free shop items** (2026-11-25): an approved creator item priced
  $0 is free (a Free button on every platform, granted by the server);
  "not for sale" is a separate admin checkbox (migration 28).

- [x] **Formal verification** (2026-11-25): LemmaScript skills vendored
  into `.claude/skills/`, Dafny + `lsc` installed at session start and in
  CI. Proved: the server's save and restore "within the bag" checks and
  the promo discount rules ([VERIFICATION.md](VERIFICATION.md)).

- [x] **Agent token savings** (2026-11-25): cloud sessions install a
  pinned rtk and the npm dependencies at start (`.claude/hooks/`), a Bash
  hook routes commands through rtk, and
  [AGENT_TOKENS.md](AGENT_TOKENS.md) sets the house style for small output.

- [x] **Saves within the bag** (2026-11-25): a save can't raise a thing's
  count on a beach past what you own less your other beaches (409
  `short`); what a beach already holds stays (given away, refunded,
  expired). The app saves its other beaches and retries once (a move
  across a seam), then reloads the saved beach.
- [x] **Flaky digFinds test** (2026-11-25): "three finds a day" starts at
  noon UTC, so it no longer crosses midnight.

- [x] **Server permissions audit** (2026-11-25): only a beach's owner can
  change it (`server/test/permissions.test.ts` tries every such call as
  someone else); catch-up is server-only (no app code imports it). Saves
  are now read by the server: non-beach bytes are refused, items are
  counted from the objects (not `X-Beach-Items`). Fixed the off-shore pet
  read and blocked people feeding a pet. Details in STATUS.md.

- [x] **Client beach state by id** (2026-11-25): no more active beach. A
  `BeachStore` keeps every beach's state in memory by id with LRU
  eviction; the waves follow the view onto whichever beach of yours is in
  front of you, handing sand and undo history over through the store; one
  save pipeline for all beaches. [BEACH_STORE.md](BEACH_STORE.md).

- [x] **Palm-first UI** (2026-11-25): only a palm at rest; one rail
  (Inbox, Hand, Dirt flyout, Bag, Store, View, Manage, Undo, ×); a
  top-left status pane (default / expanded with beaches in view / closed
  to an *i*); the Inbox hub (Inbox, Leaderboard, Starred, Visit by
  code); the Bag as a modal; Manage tabs Beaches, Checkpoints, Settings,
  Help; four-step wave strength; reverse isometric view. See STATUS.md.
- [x] **Live beaches L1–L5** (2026-11-24): the sea keeps working while
  you're away. Owned things the sea carries out go back in the bag; the
  server catches a beach up on read (half tide cycles at its real place,
  14-day cap via `CATCHUP_MAX_GAP_DAYS`), keeps "Before the tide" first,
  and the owner sees "while you were away" with "Put it back as it was".
  Visitors see the owner's beach live (polling). [LIVE_SIM.md](LIVE_SIM.md).
- [x] **HUD and mobile menus** (#48, #49): grouped right-side controls,
  a help panel, separate beach settings, and scrollable bag and shop.
- [x] **Sandcastle molds** (#50): round and square towers shaped from the
  beach terrain, with existing sand and placement tools for customization.
- [x] **Adjacent beach editing** (#68): edit across linked beaches you own
  from one view.

- [x] **Free item: footprints** (2026-11-24, PR #81): a trail of
  footprints pressed into the sand — free and unlimited, kind
  `footprints`, behaviour `fixed`, 0.5–2.0 m, 3 variants, darker
  than dry sand so the trail reads as dips, with a matching trail
  in the shore pictures. The little figure walking the waterline
  from the same line did not ship with it (needs a character mesh,
  walk animation and fading footprints — a new render subsystem,
  not an item) and stays a to-do above.
- [x] **Footprints: drag to leave a trail** (2026-11-25): Kt22chute75
  asked on Discord #feedback to place footprints along a drag path
  instead of one tap at a time. Dragging with footprints in hand now
  lays one trail per stride along the path, each running in the
  direction of travel with its prints alternating across the joins
  (up to 100 trails per drag), and undo takes the whole drag back
  as one step (`src/world/footprints.ts`, grouped `placeObject`).
  A render of a dragged trail is in `docs/items/renders/footprints-drag.png`.
- [x] **Guide: full item catalog** (2026-11-24, PR #86): the user guide
  (beech.games/guide#catalog) lists everything you can place, grouped
  by how you get it — free, washed ashore, claw, vending (this week's
  set and past sets), shop with prices, extras — with rarity and a line
  on how each thing behaves. Groups are built at runtime from the claw
  pool, vending sets, shop products and free items; names, rarities and
  kinds the server can't derive live mirrored in
  `server/src/prizeNames.ts`, kept in step by `tests/items.test.ts`.
  Footprints (PR #81) is in the free list.
- [x] **Beechshore item submissions** (2026-11-24): signed-in uploads with
  versioned terms, an admin review queue, and 30% non-cashable credit on
  linked item sales. [Asset spec and publishing workflow](ITEM_SUBMISSIONS.md).
- [x] **Shop centrepieces: palm tree, lifeguard tower, bonfire,
  hammock, towel** (2026-11-24, PR #66): five new shop items — a palm
  tree (legendary, $2.99, the tallest of the five), a lifeguard tower
  (legendary, $2.99, with a cabin and a ramp), a bonfire (rare, $1.49,
  its flame glows like the tiki torch's), a hammock (rare, $1.49) and
  a beach towel (rare, $0.99) — five new kinds (`palmtree`,
  `lifeguardtower`, `bonfire`, `hammock`, `towel`), each the only item
  of its kind.
- [x] **Claw prizes: coral and coconut** (2026-11-24, PR #65): two new
  claw-machine prizes — a branching coral fragment (rare, tumbles like
  a shell) and a coconut (common, floats like a bottle, riding high).
  Each is the only item of its kind, so the kind palette is its look.
  Daily pool: common [conch, sanddollar, coconut], rare [starfish,
  coral]; odds and grab chances unchanged.
- [x] **Vending Week 2 "Beach day": beach ball, sandals, bucket**
  (2026-11-24, PR #62): Week 2 of the vending machine, from Mon
  2026-11-30 — a beach ball (common, floats), sandals (uncommon,
  tumble) and a bucket (rare, stands upright), three new kinds
  (`beachball`, `sandals`, `bucket`). A mixed set: three new items
  can't fill all four tiers, so Week 1 items fill the gaps (blue sea
  glass, pebble, spiral conch, green bottle, nautilus) and keep the
  3/2/2/1 shape; sunset starfish sits the week out.
- [x] **Wash-ashore finds: trash, seaweed, cowrie** (2026-11-24, PR #60):
  the sea now brings in a crumpled bright bottle or can (`trash`), a
  strand of seaweed (`seaweed`), and a spotted cowrie (`cowrie`, kind
  `shell`, rare) alongside shells, sea glass and driftwood — new kinds
  `trash` and `seaweed`, both tumble in the swash; trash is rarer than
  shells (8% of wash-ins) so the beach doesn't fill with it; at most 6
  wild things at a time, as before. All three are free and unlimited;
  pick one up and put it down and it's yours, listed in the bag's
  "Found" section through the generic found mechanism.
- [x] **beechshore follow-ups** (2026-11-24): read-only 3D visits for
  signed-out visitors (opening `?visit=CODE` for any public beach loads it and
  the public shore in 3D via `/api/public/shore`, `/api/public/shore/more` and
  `/api/public/beaches/:code`, strictly `isPublic`; off-shore beaches still
  require sign-in), migration 17 partial indexes (`beach_public_updated`,
  `beach_public_location`) for the lists and counts at scale, and per-IP rate
  limiting on uncached image draws (`60/min`, 429 with `Retry-After`, cache
  hits free). [SHORE_SITE.md](SHORE_SITE.md).
- [x] **Buried rocks keep their cover on reload** (2026-11-24): sand piled
  over rocks is now saved as a separate `cover` layer (`BeachObjects.rockCover`,
  `BeachSim.sandCover`, binary save format **BCH3** when any rock is buried —
  unburied beaches still write BCH1/BCH2 — and optional `cover` + rock `base`
  in `.beach.json`, docs/BEACH_FILE.md). `sanitizeObjects` also now preserves
  rock `base`. On load (`loadDelta`, `importBeach` + undo/redo), `cover` is
  subtracted to recover `under` before embedding rocks and added back on top,
  so buried rocks stay buried (and removing them afterward restores `under +
  deposit` cleanly), across grid tiers, checkpoints (`server/src/checkpoints.ts`),
  neighbor views (`applyRockCover`), and server thumbnails (`server/src/beachImage.ts`).
- [x] **Checkpoints C6, and the sandbox keeps its beach** (2026-11-24):
  each checkpoint has a small top-down thumbnail drawn on the device from
  its sand. The sandbox build (no accounts) now keeps the beach between
  visits (IndexedDB: saved a few seconds after a change and when the tab
  goes to the back) and has checkpoints on the device: save, restore (one
  undo step), rename, delete, export and import beach files
  (`src/net/localStore.ts`, `src/ui/localCheckpoints.ts`,
  `npm run e2e:sandbox`).
- [x] **A "found" collection** (2026-11-24): pick up something the sea
  brought in (hold on it) and put it down, and it's yours: no longer wild,
  marked `found`, saved, never taken back. The bag's "Found" section lists
  what you've kept from the sea and what you've dug up (`GET
  /api/dig-finds`), with how many were rare or better.
- [x] **Ask from the shore** (2026-11-24): a beach at the end of a stretch
  (the walk shows a free side) whose matching side of yours is free has
  "ask to be neighbors" on its name tag; it sends the usual request
  (`NeighborView.askSide`, checked in `npm run e2e:shore`).
- [x] **Long-press to pick up and drag** (2026-11-24): hold still on a thing
  for 0.42 s (any tool, the look tool included) to pick it up, drag it, let
  go to put it down: one undo step (`BeachSim.moveObject`; rocks lift out
  of the floor and settle where they land). Moving first, or a quick tap,
  digs as before.
- [x] **Reload stale tabs** (2026-11-24): the build writes `version.json`
  and the app knows its own build; a web tab checks every 10 minutes and
  when it comes back to the front, and offers "a new version is ready ·
  Reload". A save refused as out of date (426) offers the same (in the
  phone apps: "update from the store"). Saves send `X-App-Build`, and the
  server logs which build was refused (`stale_app_save`).
- [x] **One active editor** (2026-11-24): after an older instance overwrote
  Riley's beach over a restore, only one tab/device/app edits at a time.
  A per-user edit token (`edit_sessions`, migration 25), claimed when a
  beach is opened for editing; a new claim fences the older instances
  (their saves, restores, dig rolls and beach-roster edits are 409
  `fenced`; no token at all is 426). The fenced instance stops autosaving,
  turns view-only with a "Take over editing" banner, and learns it is
  fenced from a 30 s heartbeat or its next save. Design in
  docs/EDIT_SESSIONS.md; the no-epoch-header hole is closed by the token.
- [x] **Daily auto-save checkpoint** (2026-11-24): before a save overwrites
  a beach, if more than 24 h have passed since that beach's last auto
  checkpoint, the beach as it is now is kept — reusing the one auto slot
  (never a named slot, never a second auto slot), named `Auto-save
  YYYY-MM-DD`. A restore's "before restoring" copy is safe for a day after
  the restore, then the daily save may take the slot. A failed snapshot
  never blocks the save. Shown in settings → checkpoints as "auto-saved
  daily".
- [x] **Large-edit checkpoint** (2026-11-24): before a big edit lands for a
  beach, the beach as it is now is kept in the same one auto slot, named
  `Before big edit YYYY-MM-DD`. Large is a save reshaping ≥ 10% of the
  sand cells by ≥ 50 mm, moving ≥ 50 things, or changing the grid
  (thresholds in `server/src/checkpoints.ts`); the server diffs every save,
  and picking up a clearing tool (bulldozer, flatten, vacuum) snapshots
  first on the client, once per save. It fires even within a day of a daily
  auto-save and counts as the day's auto checkpoint. A failed snapshot
  never blocks the edit — it is logged and the app tells the player.
- [x] **API rate limiting** (2026-11-24): per client IP, 300 requests a
  minute on the API and 20 sign-ins; the stores' webhooks are exempt. 429
  with `Retry-After`.
- [x] **Unique items** (2026-11-24): one owner in the whole game
  (`unique_items`, migration 16). A draw of one that's taken gives a rare
  instead; a gift moves the owner; an owner who deletes their account frees
  it. The bag shows "one of a kind · found by …".
- [x] **Already built, tidied from the queue** (2026-11-24): more than one
  beach (MULTI_BEACH.md), the shop with App Store / Play billing and web
  checkout (PRICING.md, WEB_PAYMENTS.md), and keeping a beach off the shore
  (the on/off-shore switch on each beach).
- [x] **Spire spike on Riley's beach** (2026-11-23): a wall of overlapping
  rocks stacked its sand lifts without bound (each new rock's base was
  sampled from sand already lifted by earlier rocks) and taking the rocks
  off left the floor raised, so the leftover column — about 3.6 m on
  Riley's beach (GJPUDD) — was permanent and survived save/load. Fixed in
  `src/sim/objects.ts` (rock bases and `under` now come from the terrain
  with lifts stripped; removal rebuilds the floor from the untouched floor
  plus the rocks still there; `withoutRocks` peels exactly) and
  `src/sim/beachSim.ts` (loading an old save that holds stacked rocks — a
  rock whose centre sits at the height of another rock's dome — re-bases
  just those rocks and replaces the stacked lift in that cluster with the
  terrain estimate, so Riley's spire heals the next time her beach is
  opened; beaches without stacking, including rocks on piles and buried
  rocks, load exactly as saved). Regression tests in `tests/spike.test.ts`.

- [x] **Visitors and the inbox, V1–V4** (2026-11-24): signed-out visits
  to public beaches; the visitor card (shells, notes, gifts); the inbox
  with thanks, report and block; the note filter and limits; the admin
  Reports tab; visit-link sign-ups count as invites. Migration 24,
  `npm run e2e:inbox`. [INBOX_NOTIFICATIONS.md](INBOX_NOTIFICATIONS.md).

- [x] **Discord links** (2026-11-23, PR #40 draft): the Discord server is
  the feedback channel — "Talk to us" section + footer link on the
  landing page, footer link on the shore site, "Join our Discord" at the
  bottom of the in-game account panel. All three read the invite from one
  constant, `DISCORD_INVITE_URL` in `server/src/community.ts`. The URL
  there is now the server's permanent invite
  (`https://discord.gg/y7EGw2yg2d`); the PR stays a draft until the invite
  is confirmed.
- [x] **Production domains** (2026-11-23): game at https://play.beech.games,
  home page + guide + privacy at https://beech.games (landing), shore at
  https://beechshore.com (mapping + DNS still to do), admin at
  https://admin.beech.games. `beech.markjen.com` keeps working as a legacy
  host; `beechgame.com`/`beechgames.com` redirect to https://beech.games.
  See GCP.md.
- [x] **Privacy policy URL** (2026-11-23): https://beech.games/privacy.html
  (`public/privacy.html`, linked from the landing footer). Still to enter
  by hand: the Play store listing and Google's OAuth consent screen.
- [x] **Final app ID** (2026-11-23): `app.beech.beach` — the app is created
  in Play Console with it and AAB 1.0.0 build 1 is uploaded to the
  internal track as a draft; it can't change now.
- [x] **Default branch to `main`** (2026-11-23): already the default; the
  `github-pages` environment step is moot — Pages publishing was removed.
- [x] **beechshore.com, the public shore** (2026-11-23): server-rendered
  pages for every beach on the shore, drawn pictures for link previews,
  share buttons, cross links with the game. [SHORE_SITE.md](SHORE_SITE.md).

- [x] **Invites and the beach guide** (2026-11-23): a nine-step guide that
  teaches each mechanic (coach card, checklist, a common for each step, a
  starfish for all eight); invite links (`?invite=CODE`) with a welcome
  parasol for the friend, a one-tap neighbor ask, and a reward ladder for
  the inviter once the friend has done 3 guide steps (an extra beach at
  three friends). Items, not credit, so it works in the apps. Migration 23,
  `npm run e2e:invites`. [INVITES_GUIDE.md](INVITES_GUIDE.md).

- [x] **Performance checks in CI** (2026-11-23): `npm run perf` and the
  Performance workflow (main, pull requests, weekly) with budgets in
  `perf/budget.json`. [PERFORMANCE.md](PERFORMANCE.md).
- [x] **Checkpoints C1–C5 and beach files E1–E5** (2026-11-23): save named
  copies of any of your beaches and restore them onto any of them (strict, or
  without what the bag can't cover; undo; a restore elsewhere reloads other
  devices). Export and import of `.beach.json` files on the web and in the
  apps, the offline tool, and the two joined: export a checkpoint, import a
  file as a checkpoint, "Before import" kept automatically.
  [CHECKPOINTS.md](CHECKPOINTS.md), [BEACH_FILE.md](BEACH_FILE.md).
- [x] **2000 things a beach** (2026-11-23): profiled
  (`scripts/perf.mjs`), things drawn as GPU thin instances, the
  worker sends positions as a packed buffer and the roster only on change,
  resting things skipped; then the limit went from 400 to 2000, with old
  apps refused (426) rather than allowed to drop things. STATUS.md, "How much
  a beach holds".
- [x] **Say so when a beach is full** (2026-11-23): 400 things at most;
  placing a 401st is refused with a message, and a save that can't hold
  everything (or is too big for the server) says so.
- [x] **Web checkout through Xsolla** (2026-11-23): reviewed the PR 21 plan
  and built it — `POST /api/store/web-checkout`, the signed webhook
  (`order_paid` grants once, `order_canceled`/`refund` revoke, sandbox
  refused on live), `GET /api/store/web-orders/:id`, migration 15
  (`web_orders`, `purchases.store` allows `xsolla`), the web shop's card
  button and the return-from-checkout toast. Off until the Xsolla settings
  exist. `server/test/webCheckout.test.ts`.

- [x] **Admin console is its own app, and manages beaches** (2026-11-23):
  `/admin` and `/api/admin/*` are gone from the game server. The console
  is a separate Cloud Run service, `beech-admin` (`server/src/adminServer.ts`,
  `adminApp.ts`, `adminPage.ts`; Dockerfile target `admin`), on the same
  database. Nothing loads until a Google sign-in by an `ADMIN_EMAILS`
  account: an HttpOnly session cookie (`admin_sessions`, migration 14), the
  allowlist re-checked on every request, a CSRF header, and a nonce CSP.
  New Beaches tab: counts, search, a beach's details, and rename, hide from
  the shore, new code, part neighbors, clear the sand (undoable via a
  checkpoint) and delete a non-home beach. All actions are audited, and
  there's a new Audit log tab. The CLI gained `beach …` and `audit` and now
  takes `BEECH_ADMIN_URL`. Design in
  [GIFT_CARDS_PROMOS.md](GIFT_CARDS_PROMOS.md#admin-console). **Owner:**
  add the `beech-admin` URL (printed by the deploy's smoke test) to the web
  OAuth client's Authorized JavaScript origins.

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
  the purchase). Admin console (then at `/admin`; now its own service) (Google sign-in + allowlist:
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
- [x] **Special items look different from free ones** (2026-11-23): prizes
  sharing a kind with a free item used to render identically — only the
  name and rarity ring set them apart. Now each has its own colours and
  finish in `ITEM_LOOKS` (`src/palette.ts`): pink shell hot pink (pink is
  reserved for it — free shells are warm cream/tan/peach with no pink),
  golden sand dollar metallic gold with a gold glow and sparkles (free sand
  dollars stay pale cream), plus blue sea glass, polished pebble, spiral
  conch, sunset starfish, green bottle and a pearly nautilus. Same colours
  on the shore pictures and tinted icons in the bag; `tests/specialItems.test.ts`
  guards the palettes and the rendered pixels. No ids, rarities, odds,
  pools, prices or behaviour changed.
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
- [x] **No notes in the game; a user guide, help and release notes on the
  website** (2026-11-23): `/guide` and `/guide/releases` on the production
  server (beech.games), with live odds; settings → "guide & help".
- [x] **beech.games landing page** (2026-11-23): the full home page at
  `beech.games` (server-rendered, `server/src/landingSite.ts`, Host-header
  routing in `rootApp.ts`; www 301s to the apex; no game API on the landing
  hosts; `/guide` still works there), previewable under `/landing` on every
  other host. Hero, what you do (numbers from the server constants), what's
  new (from the release notes), free in the browser now, phone apps coming —
  no store claims, no screenshots. Design and the DNS cutover in
  [LANDING_PAGE.md](LANDING_PAGE.md). The apex mapping exists manually; the
  DNS cutover in Squarespace is still to do.
- [x] **Claw rest is random, 5 min to 3 h** (shorter after a miss, longer
  after a win), replacing the doubling-to-a-day wait (2026-11-23).
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
- [x] **Local weather along the shore** (2026-11-25): the sky and light
  follow the place of the beach in the middle of the view, blending between
  beaches; a settings switch pins one light instead. See STATUS.md.
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
