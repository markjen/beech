# Accounts, saved beaches and neighbors

Two builds come from one codebase:

| | Sandbox | Production |
|---|---|---|
| Where | Local / any static host (`npm run build`; no longer published — see [DEPLOY.md](DEPLOY.md)) | Google Cloud Run (`deploy-gcp.yml`), https://play.beech.games, see [GCP.md](GCP.md) |
| Sign-in | none | Google now; Apple next (required for iOS) |
| Saved state | none (only per-device settings) | your beach, synced, plus neighbors |
| Build flags | none | `VITE_ACCOUNTS=1`, `VITE_GOOGLE_CLIENT_ID=…`, `VITE_API_URL=` (empty means same origin) |

## Server (`server/`)

Node 22 + [Hono](https://hono.dev) + Postgres. `src/server.ts` serves the
built web app and mounts `src/app.ts` at `/api`. The database layer
(`src/db.ts`) uses `pg` in production (Cloud SQL socket or `DATABASE_URL`)
and PGlite (Postgres in WebAssembly) for local development and tests.
Migrations live in `src/migrations.ts` and are applied at startup.

| | |
|---|---|
| `POST /api/auth/google { credential }` | Google ID token → `{ token, user }` |
| `POST /api/auth/apple { identityToken, name? }` | Sign in with Apple → `{ token, user }` |
| `POST /api/auth/dev { name }` | local development only (`DEV_AUTH=1`; refused when `NODE_ENV=production`) |
| `POST /api/auth/logout` | ends this session |
| `GET /api/me` | `{ user }` |
| `POST /api/edit-session` | claim this instance as the one editor: `{ token }` (fences older instances; docs/EDIT_SESSIONS.md) |
| `GET /api/edit-session` (`X-Edit-Token`) | heartbeat: `{ active }` — whether this instance is still the editor |
| `GET /api/beach` | your compressed sand, with `X-Beach-Location/Nx/Ny/Version/Updated/Epoch` headers; 404 if none |
| `PUT /api/beach` | save it (body = sand bytes, plus `X-Beach-Location/Nx/Ny`); only the current editor's token saves (409 `fenced`, 426 with no token at all). Before it overwrites: the daily auto-save (once a day) and the large-edit checkpoint (a tenth of the sand, fifty things, a new grid — even within the day), both into the beach's one auto slot; a large save answers `largeEdit` / `largeEditCheckpoint` |
| `DELETE /api/account` | deletes you, your sessions and beach, and you from other people's neighbor slots |
| `GET /api/neighbors` | `{ code, left, right, asked: { left, right }, requests: [{ code, name, location, side }] }` |
| `PUT /api/neighbors/:side { code }` | ask them to be on your `side` (`status: asked`); if they'd already asked for the matching sides, `linked` at once. 409 if either side is taken |
| `POST /api/neighbors/requests/:code/accept`, `DELETE /api/neighbors/requests/:code` | accept or decline someone's request |
| `DELETE /api/neighbors/:side` | move away (both ends of the link go), or take back your request for that side |
| `GET /api/shore?code=&depth=` | a beach (yours, or anyone's by code) and the global shore each way, nearest first (alternating sides), up to 12; each beach says if it's `linked` to the one before |
| `GET /api/shore/more?from=&dir=&count=` | keep walking from a beach (infinite scroll) |
| `GET /api/neighbors/:side/beach` | that neighbor's sand (only your own neighbors' beaches are readable) |
| `POST /api/neighbors/code` | new code; the old one stops working, and current neighbors keep you |
| `GET /api/pulls` | `{ pools: [{ id, name, odds, items, free, nextCooldown, nextFree, set? }], nextFree }`: the machines, their published odds, and whether a free go is ready. The claw machine (`daily`) and the vending machine (`vending`, this week's set — see [VENDING_MACHINE.md](VENDING_MACHINE.md)) |
| `POST /api/pulls/:pool` | a free go (`daily` or `vending`): the server draws, logs it and adds the prize to `inventory`. The claw's rest before the next go starts at 5 min and doubles each go, up to a day; a vending ball is one a day, next UTC midnight (`pull_state`). 409 while it's resting |
| `GET /api/beaches/:code` | anyone's saved beach, by code |
| `GET /api/favorites`, `PUT`/`DELETE /api/favorites/:code` | your starred beaches |
| `GET /api/store/products` | the shop's products: `{ id, name, grants, usd, blurb, featured }` |
| `POST /api/store/purchase { platform: ios, jws }` / `{ platform: android, token }` | check the purchase with Apple or Google (`server/src/store.ts`), record it once (`purchases`, unique per store transaction), grant its items. 402 if the store didn't confirm it, 403 if it's tied to another account, 409 if another account already used it; sending it again returns `already: true` |
| `POST /api/store/apple/notifications` | App Store Server Notifications V2 (signed): REFUND / REVOKE expire what the purchase granted |
| `POST /api/store/google/rtdn` | Google Play real-time developer notifications (Pub/Sub push, OIDC-checked): voided purchases expire what they granted |
| `GET /api/leaderboard?board=all\|rising&limit=50` | the most-starred beaches (see "Leaderboard" below): `{ board, window, halfLife, entries: [{ rank, code, name, beachName?, location, updatedAt, stars, recent, velocity, starred, yours }] }`; limit 1–100 |
| `GET /api/inventory` | `{ items: [{ item, quantity, source, acquiredAt, expiresAt }] }`: what you own beyond the free items, unexpired. Empty until the shop and pulls exist; rows are only written by the server. |
| `GET /api/checkpoints` | your checkpoints (docs/CHECKPOINTS.md): `{ limit, named, bytesUsed, bytesLimit, checkpoints: [{ id, name, kind, source, fromBeach, fromName, location, nx, ny, items, objects, bytes, createdAt }] }`, newest first. 5 named per beach of your allowance, 16 MB in all |
| `POST /api/beaches/mine/:id/checkpoints { name, auto? }` | a checkpoint of that beach as last saved (`auto`: its one automatic copy, e.g. "Before import"). 404 if it has no save, 409 at the limit |
| `POST /api/checkpoints` | import a beach as a checkpoint: body = saved-beach bytes, `X-Checkpoint-Name` (URL-encoded), optional `X-Beach-Location`. The server reads and counts it itself |
| `GET /api/checkpoints/:id/sand`, `PATCH /api/checkpoints/:id { name }`, `DELETE /api/checkpoints/:id` | its bytes; rename; delete |
| `GET /api/checkpoints/:id/fit?beach=` | would it fit there: `{ ok, need, owned, elsewhere, short }` |
| `POST /api/beach/here`, `POST /api/beaches/mine/:id/here` | the owner's app has that beach open (every 20 s while showing): no catch-up for 45 s. `{ epoch }`: if it moved on, the app reloads (docs/LIVE_SIM.md) |
| `GET /api/beach/away`, `GET /api/beaches/mine/:id/away`; `POST …/away/seen` | what the sea did since you last looked: `{ away: { from, to, highTides, lost, broughtIn, checkpoint } \| null }` (unseen catch-ups, summed; `checkpoint` is the "Before the tide" one). `seen` marks them read |
| `GET /api/beaches/:code/live`, `GET /api/public/beaches/:code/live` | a viewer's poll: `{ version, updatedAt, live }` (`live`: its owner's app is on it now); catches it up if due, and marks it watched for 15 s |
| `POST /api/dev/age-beach { hours, beach? }` | `DEV_AUTH` only: as if nobody had opened that beach for `hours` (e2e tests) |
| `POST /api/beaches/mine/:id/restore { checkpoint, mode: strict \| drop-missing }` | put it on that beach (one at a time per person). The beach as it was becomes its "before restoring" checkpoint (`undo`). Strict and short: 409 `{ error: 'short', short }`. Bumps the beach's epoch: a save sending an older `X-Beach-Epoch` gets 409 `restored`. Only the current editor's token restores (409 `fenced`) |
| `POST /api/gifts { code, item }` | give one of your items to someone else, by their neighbor code — instant, one atomic statement, 20 an hour (see [SHARING_GIFTING.md](SHARING_GIFTING.md)). |
| `GET /api/guide`, `POST /api/guide/:step` | the beach guide: steps done; mark one done (once, with its gift; claw, star and invite are checked on the server, 409 until true). See [INVITES_GUIDE.md](INVITES_GUIDE.md) |
| `GET /api/invites/:code` | who an invite link is from (no session, 30/min per IP): `{ name, welcomeGift }` |
| `POST /api/referrals/claim { code }` | a new player (account under 7 days old) claims the invite they came through, once: the welcome gift. 400 own code, 404 unknown, 409 already invited or too old |
| `GET /api/beaches/:code/rating` | the visitor card: `{ count, average (from 3), mine, yours, quickNotes, freeText }` |
| `POST /api/beaches/:code/visit { shells?, note?, quick?, item? }` | leave a rating, a note and/or a gift (one inbox row). 400 bad or filtered note, 403 blocked or a new account's typed note, 409 no such item, 429 limits. See [INBOX_NOTIFICATIONS.md](INBOX_NOTIFICATIONS.md) |
| `GET /api/inbox?before=`, `POST /api/inbox/read { upTo }` | your inbox, newest first (30 a page), and marking it seen; `GET /api/neighbors` also carries `inbox: { unread, latest }` |
| `POST /api/notes/:id/report`, `GET /api/blocks`, `PUT`/`DELETE /api/blocks/:code` | report a note you got; block / unblock someone by any beach code of theirs |
| `GET /api/referrals` | your invites: `{ code, joined, settled, friends, ladder, cap, settleSteps, welcomeGift }`. A friend settles in after 3 guide steps; the inviter then gets the next rung (parasol, surfboard, extra beach, …, 10 at most) |

Every request from a client IP (Cloud Run's `x-forwarded-for`) is rate
limited: 300 a minute on the API, 20 sign-ins a minute; the stores'
webhooks are exempt (429 with `Retry-After: 60`, logged as `rate_limited`).
Saves from an app too old for the data (426) are logged as `stale_app_save`
with the app's `X-App-Build`.

Sessions are 60-day random bearer tokens, and only their SHA-256 is stored.
We keep the provider's user id, a first name (neighbors see it), your neighbor
code, and your beach. No email or photo. Every API response is
`Cache-Control: no-store`, and the service worker never caches `/api/*`. An
earlier build cached it, which served one person's data to the next account
on the same device.

### Neighbors: one global beachfront

Neighbors are **mutual**. You ask someone (by their code) to be on your left.
When they accept, they're on your left and you're on their right. Each side
holds one person. A link is two rows in `neighbors`, written in one SQL
statement. A unique index on `(neighbor_id, side)` means nobody is on two
people's same side. Pending asks live in `neighbor_requests`, one per side
per person. If both people ask for matching sides, they're linked at once.
Accepting clears requests that can no longer happen. Moving away removes
both rows. Migration 5 kept the old one-way picks that were already mutual
as links, and turned the rest into requests.

**The beachfront.** Links make stretches of shore. Past the end of a stretch
the shore carries on into the next stretch. Stretches are ordered by when
their right-hand end joined (`users.created_at, id`), round and round, so
walking either way eventually meets every beach (anyone with a saved beach or
a link). `GET /api/shore` walks one step each way at a time, so the nearest
beaches come first, and never shows anyone twice. The app pages more with
`/api/shore/more` as you near the end of what's loaded, and stops a
direction once it comes round to a beach it already has.

**Privacy.** On the global shore, **every saved beach is visible to every
signed-in person**, and beaches on the shore are also public on the web at
beechshore.com ([SHORE_SITE.md](SHORE_SITE.md)): first name, real beach location, sand and things. Codes
are still how you ask someone to be a neighbor or jump straight to a beach.
The store privacy forms must say that the first name and the beach are
public to other users. A "keep my beach off the shore" setting is on the
backlog.

### Leaderboard

A star is a row in `favorites` (one per person per beach; you can't star
your own). The leaderboard counts only stars that still stand, and lists
only beaches that are on the shore (`on_shore`) and have been saved
(`sand IS NOT NULL`). Beaches kept off the shore stay off the board too.

- **All time:** stars now. Ties go to the one rising faster, then the older
  beach.
- **Rising (star velocity):** every star made in the last 7 days counts
  `0.5 ^ (age / 2 days)`: a star today is worth 1, two days ago 0.5, six
  days ago 0.125, and none after a week. The board is ordered by that sum
  (`velocity`); `recent` is the plain count for the week, which is what the
  app shows ("▲ 3"). Why this metric: a sliding 7-day count jumps when a
  star falls off the end, and a Hacker-News score (`stars / age^1.8`)
  divides by the beach's age, so old beaches that are suddenly loved never
  rise. Exponential decay over the stars themselves is smooth, needs no
  per-beach age, ranks "5 stars today" above "5 stars last week", and is
  one `SUM` in SQL.
- **Hard to game:** a star's age comes from `star_first` (migration 10), the
  first time that person starred that beach, which survives un-starring. So
  un-starring and starring again doesn't make a star look new. One person
  adds at most 1 to any beach, and the owner's own stars are blocked (and
  also filtered in the query). Many fake accounts could still push a beach
  up; signing in needs a Google or Apple account, and API rate limiting
  (backlog) would help further.
- **Cost:** one grouped query over `favorites` per request (index
  `favorites_beach`). Fine for now; if stars grow to millions, cache the
  board for a minute and look up the caller's `starred` flags separately.
**Live beaches** ([LIVE_SIM.md](LIVE_SIM.md)). Every read of a beach's
sand (yours, a neighbor's, a visit) first catches it up if nobody has
simulated it for 10 minutes and its owner's app isn't holding it open: the
catch-up model from `src/sim/catchup.ts`, bundled into
`server/src/generated/catchup.ts` (`npm run bundle:server`; a test fails if
it's stale), at the beach's real tide. It writes with a compare-and-set on
`version`, bumps the epoch, records a `beach_events` row, and before a gap
over 12 h keeps the beach as its "Before the tide" checkpoint (kind `tide`,
one per beach, not counted). Reads carry `X-Beach-Simulated-Until`.

**Sharing and gifting.** A share link is `?visit=<code>` on the site's own
URL (`src/net/share.ts`); opening it visits that beach once you're signed
in. The Cloud Run server injects Open Graph tags for the beach into
`index.html` for such requests (`server/src/shareMeta.ts`), so the link
shows a preview where it's pasted, with a picture of the beach when it's on
the shore. The app's share buttons send the beechshore link instead
([SHORE_SITE.md](SHORE_SITE.md)). Gifting (`POST /api/gifts`) moves one
inventory row to someone else by code, instantly and atomically; see
[SHARING_GIFTING.md](SHARING_GIFTING.md) for the design and the decisions
that are still the owner's to make.

While the shore is shown, the app polls `GET /api/neighbors` and the shore
every 30 s, and refetches a beach only when its `updatedAt` changed.

## Client

- `src/net/account.ts`: the session (token in localStorage), API calls,
  `NeighborApi`, and the Google Identity Services button.
- `src/net/beachSync.ts`: restores your beach when someone signs in, then
  saves 6 s after changes, every 90 s while changing, and when the app goes to
  the background. Switching accounts drops anything queued for the previous
  person. Only one instance edits at a time (docs/EDIT_SESSIONS.md): it
  claims an edit token when it opens the beach, sends it on every save, asks
  every 30 s whether it is still the editor, and turns view-only — banner
  plus "Take over editing" — when another instance takes over.
- `src/render/neighbors.ts`: the neighbor slabs and tags. A refresh
  "generation" makes sure a slow older load can't overwrite a newer one.
- `src/ui/leaderboard.ts`: the leaderboard panel (trophy button, bottom
  left; production builds only).
- `src/ui/accountPanel.ts`: the top of the settings sheet. It has sign in or
  out, save status, delete account (second tap to confirm), your code
  (copy / new code), and left/right slots ("move in" / "move away").

## Tests

```bash
(cd server && npm test)                                                     # API + auth on PGlite
(cd server && TEST_DATABASE_URL=postgres://beech:beech@localhost/beech_test npm test)  # same, real Postgres
npm run server:dev                      # then, in another terminal:
npm run e2e:accounts                    # sign in, dig, save, reload, restored, delete
npm run e2e:neighbors                   # Ana saves; Ben adds her code on his left and sees her beach
npm run e2e:shore                       # walk down a 3-beach shore, head home, visit by code, favorites
npm run e2e:leaderboard                 # fans star beaches; the board orders them; star and visit from it
npm run e2e:invites                     # Fran joins through Ana's link, settles in; Ana is rewarded
npm run e2e:inbox                       # Ben visits signed out, signs in, leaves a note and a gift; Ana's inbox
npm run e2e:live                        # two days pass: the sea wears a castle down; "while you were away"; put it back
```

CI runs the server tests on PGlite and on a Postgres 16 service, builds the
production image, boots it and probes it.

## Phone apps

Google blocks its web sign-in inside app WebViews, so the apps use the
system sign-in sheets through `@capgo/capacitor-social-login`
(`src/net/nativeAuth.ts`). Each returns an ID token that goes to the same
`/api/auth/google` or `/api/auth/apple` endpoint as the web.

| | Android | iOS |
|---|---|---|
| Google | Credential Manager; token audience = the **web** client ID | GoogleSignIn; token audience = the **iOS** client ID |
| Apple | not offered (needs a web redirect flow; Play doesn't require it) | AuthenticationServices; audience = the bundle ID. Required by App Store guideline 4.8 because Google is offered. |

Facebook and Twitter are switched off in `capacitor.config.ts`, so their SDKs
(and Facebook's advertising-ID permission) don't ship.

**Release setup** (DevOps):
1. Google Cloud → Credentials (same project as the web client):
   - an **Android** OAuth client for package `app.beech.beach` with the
     SHA-1 of the Play **app signing** key (Play Console → App integrity) and
     of the upload/debug keys used for testing;
   - an **iOS** OAuth client for bundle ID `app.beech.beach`.
2. Android takes `VITE_GOOGLE_CLIENT_ID` from the production web build.
   For iOS, build with `VITE_ACCOUNTS=1`,
   `VITE_API_URL=https://<production domain>`, `VITE_GOOGLE_CLIENT_ID=<web
   client>` and `VITE_GOOGLE_IOS_CLIENT_ID=<iOS client>`, then run `npx cap sync ios`.
3. Run `VITE_GOOGLE_IOS_CLIENT_ID=… node scripts/native-auth-config.mjs` once,
   and commit the result. It adds the reversed client ID URL scheme to
   `ios/App/App/Info.plist`. Client IDs are public, not secrets.
4. Apple Developer → Identifiers → `app.beech.beach`: enable **Sign in with
   Apple**. The entitlement is already in `ios/App/App/App.entitlements`.
5. Server: `GOOGLE_CLIENT_IDS=<web>,<iOS>` (Android tokens carry the web ID)
   and `APPLE_CLIENT_IDS=app.beech.beach`.
6. Store privacy forms: user ID, the beach, and a first name shown to
   neighbors you choose. These are linked to the user, used for app
   functionality, and not used for tracking.

Still to do: when someone who signed in with Apple deletes their account, the
server should also revoke their Apple token (App Store guideline 5.1.1(v)).
That needs a Sign in with Apple key on the server; see BACKLOG.md.
