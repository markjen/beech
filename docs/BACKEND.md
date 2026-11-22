# Accounts and saved beaches

Two builds come from one codebase:

| | Sandbox | Production |
|---|---|---|
| Where | GitHub Pages (`deploy.yml`) | Cloudflare (`deploy-prod.yml`) |
| Sign-in | none | Google now, Apple next (required for iOS) |
| Saved state | none (only per-device settings) | your beach (sand + which real beach), synced |
| Build flags | none | `VITE_ACCOUNTS=1`, `VITE_GOOGLE_CLIENT_ID=…`, `VITE_API_URL=` (empty = same origin) |

## Recommendation: host production on Cloudflare (Workers + D1)

One Worker (`server/`) serves both the built web app (Workers Static Assets
from `dist/`) and the API under `/api/*`, with a D1 (SQLite) database.

Why this fits beech:

- **Same origin for app and API.** No CORS for the website and no
  third-party cookies, and one deploy ships both. The native apps call the
  same `/api` with a bearer token. Only their origins (`capacitor://localhost`,
  `https://localhost`) are allowed cross-origin.
- **Tiny data.** A beach is stored as millimetre changes from the untouched
  sand, compressed: about 2-20 KB (`src/sim/sandCodec.ts`). That fits in a
  D1 row, so there is no blob store to run. 100,000 players is roughly
  0.2-2 GB.
- **Cheap and global.** At the time of writing, the free plan includes
  100k requests/day plus D1 storage and daily read/write allowances, and the
  paid plan starts at $5/month. Check Cloudflare's pricing page before launch.
  A player makes a handful of requests per session (load once, then a save
  after strokes, every 90 s while things change, and on leaving).
- **No auth vendor.** The Worker verifies Google and Apple ID tokens itself
  (signature against their published keys, issuer, audience, expiry) and
  issues its own opaque session tokens. Switching hosts later means moving
  one SQLite schema and a small router.
- **Testable offline.** `wrangler dev` runs the same Worker with a local D1.
  CI runs the full API test against it.

Alternatives considered:

| Option | Pros | Cons |
|---|---|---|
| **Firebase** (Auth + Firestore + Hosting) | quickest auth, with native Google/Apple sign-in plugins | vendor lock-in, per-document read/write billing, security rules to maintain |
| **Supabase** (Postgres + Auth) | real Postgres, built-in auth providers | the production tier is a fixed monthly cost, more moving parts than this needs |
| **Fly.io / Render + Postgres** | full control | servers, scaling and backups to run yourself |

**Domain.** Use a subdomain such as `beech.markjen.com` for production, and
leave `markjen.com/beech/` on GitHub Pages as the sandbox. A Workers custom
domain needs the zone's DNS on Cloudflare. If `markjen.com` DNS stays
elsewhere, either move it to Cloudflare or start on the free
`beech.<account>.workers.dev` URL.

## API

| | |
|---|---|
| `POST /api/auth/google { credential }` | Google ID token → `{ token, user }` |
| `POST /api/auth/apple { identityToken, name? }` | Sign in with Apple → `{ token, user }` |
| `POST /api/auth/dev { name }` | local dev only (`DEV_AUTH=1`, never in production) |
| `POST /api/auth/logout` | ends this session |
| `GET /api/me` | `{ user }` |
| `GET /api/beach` | the compressed sand, with `X-Beach-Location/Nx/Ny/Version/Updated` headers; 404 if none |
| `PUT /api/beach` | save (body = compressed sand, `X-Beach-Location/Nx/Ny`); last write wins |
| `DELETE /api/account` | deletes the user, sessions and beach (in-app deletion is an App Store requirement) |

Sessions are 60-day random bearer tokens. Only their SHA-256 is stored.
We keep the provider's user id and a first name. No email, no photo.

## Client behaviour

- `src/net/account.ts` handles the session (token in localStorage), API calls,
  and Google Identity Services' button on the web.
- `src/net/beachSync.ts` runs after sign-in. If you already have a saved
  beach, it is restored, including which real beach it was on and resampled
  to this device's grid size. Otherwise the beach you're on is saved. After
  that it saves 6 s after you stop changing things, every 90 s while waves
  reshape it, and when the app goes to the background.
- `src/ui/accountPanel.ts`: the top of the settings sheet. It shows sign in,
  or "signed in as …", the save status, sign out, and delete account (with a
  second tap to confirm).

## Local development

```bash
npm run server:dev          # builds with accounts + dev sign-in, migrates the local D1, runs wrangler on :8787
# then open http://127.0.0.1:8787 and use "dev sign in" in settings
(cd server && npm test)               # token-verification unit tests (no network)
(cd server && npm run test:e2e)       # API end-to-end against the running Worker
npm run e2e:accounts                  # browser: sign in, dig, save, reload, restored, delete
```

## Production setup (one time)

1. **Cloudflare:** create an account. Then
   `cd server && npx wrangler login && npx wrangler d1 create beech`, and
   note the database id.
2. **Google Cloud Console → APIs & Services → Credentials:** create an
   OAuth client ID of type *Web application*. Authorized JavaScript origins:
   your production URL (and `http://localhost:8787` for testing). Then set
   up the OAuth consent screen (app name, support email, privacy policy URL).
3. **GitHub repo settings:**
   - Secrets: `CLOUDFLARE_API_TOKEN` (Workers edit + D1 edit).
   - Variables: `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`,
     `GOOGLE_CLIENT_ID` (web), `GOOGLE_CLIENT_IDS` (web + iOS + Android,
     comma-separated), and `PROD_ENABLED=1`.
4. Push to `main` (or run "Deploy production (Cloudflare)").
5. **Custom domain:** Workers → beech → Settings → Domains & Routes, or the
   `routes` line in `server/wrangler.toml`.
6. **Optional hardening:** a Cloudflare rate-limiting rule on `/api/*`.

## Phone apps (next steps)

Google blocks its sign-in inside embedded WebViews, so the Capacitor apps
need native sign-in:

1. Add a native social-login plugin that returns ID tokens for Google and
   Apple (for example `@capgo/capacitor-social-login`).
2. Create iOS and Android OAuth client IDs in Google Cloud, and add them to
   `GOOGLE_CLIENT_IDS`.
3. **Sign in with Apple is required on iOS** when an app offers Google
   sign-in (App Store Review Guideline 4.8). The server already accepts
   Apple tokens (`/api/auth/apple`). Set `APPLE_CLIENT_IDS` to the bundle id
   and enable the capability in Xcode.
4. Build the apps with `VITE_ACCOUNTS=1 VITE_API_URL=https://<production domain>`.
5. Store privacy answers become: **identifiers (user ID) and the beach,
   linked to the user, used for app functionality only, not for tracking.**
   Update both stores' privacy forms.
