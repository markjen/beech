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
| `GET /api/neighbors` | `{ code, left, right, pickedBy }` |
| `PUT /api/neighbors/:side { code }` | put the beach with that code on your `left` or `right` |
| `DELETE /api/neighbors/:side` | move them away |
| `GET /api/neighbors/:side/beach` | that neighbor's sand (only your own neighbors' beaches are readable) |
| `POST /api/neighbors/code` | new code; the old one stops working, and current neighbors keep you |

Sessions are 60-day random bearer tokens, and only their SHA-256 is stored.
We keep the provider's user id, a first name (neighbors see it), your neighbor
code, and your beach. No email or photo. Every API response is
`Cache-Control: no-store`, and the service worker never caches `/api/*`. An
earlier build cached it, which served one person's data to the next account
on the same device.

### Neighbors

Every player has a 6-character neighbor code (no 0/O or 1/I). Sharing it is
the consent: nobody can find or see your beach without it. You choose who
sits on your left and right. The client draws their beaches as still
snapshots of their last save, as dioramas either side of yours (facing the
sea, left is world +X), with your sky, sea and tide, and a name tag. The
camera can pan over to them. A future step could make neighbors mutual
(requests and accepts) or show live sand. The schema already has the
`neighbor_id` index for "who has me next door".

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
```

CI runs the server tests on PGlite and on a Postgres 16 service, builds the
production image, boots it and probes it.

## Phone apps (next steps)

1. Google blocks its sign-in inside app WebViews, so add a native
   social-login plugin that returns Google and Apple ID tokens (for example
   `@capgo/capacitor-social-login`). Add the iOS and Android OAuth client IDs
   to `GOOGLE_CLIENT_IDS`.
2. **Sign in with Apple is required on iOS** once Google sign-in ships there
   (App Store guideline 4.8). The server already accepts Apple tokens.
3. Build the apps with `VITE_ACCOUNTS=1 VITE_API_URL=https://<production domain>`.
4. Update both stores' privacy forms: user ID, the beach, and a first name
   shown to neighbors you choose; linked to the user, for app functionality,
   not used for tracking.
