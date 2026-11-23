# Accounts, saved beaches and neighbors

Two builds come from one codebase:

| | Sandbox | Production |
|---|---|---|
| Where | GitHub Pages (`deploy.yml`), https://markjen.com/beech/ | Google Cloud Run (`deploy-gcp.yml`), see [GCP.md](GCP.md) |
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
| `GET /api/beach` | your compressed sand, with `X-Beach-Location/Nx/Ny/Version/Updated` headers; 404 if none |
| `PUT /api/beach` | save it (body = sand bytes, plus `X-Beach-Location/Nx/Ny`); last write wins |
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
| `GET /api/inventory` | `{ items: [{ item, quantity, source, acquiredAt, expiresAt }] }`: what you own beyond the free items, unexpired. Empty until the shop and pulls exist; rows are only written by the server. |
| `POST /api/gifts { code, item }` | give one of your items to someone else, by their neighbor code — instant, one atomic statement, 20 an hour (see [SHARING_GIFTING.md](SHARING_GIFTING.md)). |

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
signed-in person**: first name, real beach location, sand and things. Codes
are still how you ask someone to be a neighbor or jump straight to a beach.
The store privacy forms must say that the first name and the beach are
public to other users. A "keep my beach off the shore" setting is on the
backlog.

**Sharing and gifting.** A share link is `?visit=<code>` on the site's own
URL (`src/net/share.ts`); opening it visits that beach once you're signed
in. The Cloud Run server injects Open Graph tags for the beach into
`index.html` for such requests (`server/src/shareMeta.ts`), so the link
shows a preview where it's pasted. Gifting (`POST /api/gifts`) moves one
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
  person.
- `src/render/neighbors.ts`: the neighbor slabs and tags. A refresh
  "generation" makes sure a slow older load can't overwrite a newer one.
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
2. Build the apps with `VITE_ACCOUNTS=1`,
   `VITE_API_URL=https://<production domain>`, `VITE_GOOGLE_CLIENT_ID=<web
   client>` and `VITE_GOOGLE_IOS_CLIENT_ID=<iOS client>`, then `npx cap sync`.
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
