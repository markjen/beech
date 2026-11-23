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
- [ ] **Create the Discord server**: the feedback channel for players.
  Server created 2026-11-23; its permanent invite
  (`https://discord.gg/y7EGw2yg2d`) is in PR #40 (draft) — tick this once
  that merges.

## In progress

_(nothing right now)_

## Up next (engineering)

- [ ] **Reload stale tabs**: send the build id with saves (or poll a
  `/version`), and when the server says the app is out of date (426) show
  "a new version is ready · reload" instead of a silent save failure. A tab
  left open across a world change corrupted Rose's beach (2026-11-23).
- [ ] **More than one beach**: design in [MULTI_BEACH.md](MULTI_BEACH.md),
  four phases (data model and API → beaches list → connected beaches →
  shop). Owner decisions are listed at the end of that doc. People can
  already win an extra beach from the claw machine.

- [ ] **Checkpoints C6** (optional): a small top-down thumbnail on each
  checkpoint, drawn on the client from its sand; local checkpoints in the
  sandbox, together with "keep the sandbox beach on the device". See
  [CHECKPOINTS.md](CHECKPOINTS.md).

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
  their own in-app purchase for digital goods); on the web, Xsolla
  ([WEB_PAYMENTS.md](WEB_PAYMENTS.md), built). Purchases are verified on
  the server, which writes `inventory` rows. Limited items use
  `available.until` and `expires_at`.
- [ ] **Promo codes on web card payments**: mirror codes into Xsolla and
  accept `order.promocodes` on `order_paid` (WEB_PAYMENTS.md, "Promo
  codes"). Only if Mark wants it (open question 2).
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
- [ ] **beechshore follow-ups**: a read-only 3D visit for signed-out
  people, an index for the lists at scale, rate limits on image drawing
  (SHORE_SITE.md, "Not done yet").
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
