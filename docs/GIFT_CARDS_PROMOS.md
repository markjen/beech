# Gift cards and promo codes

The shop sells through Apple and Google (docs/PRICING.md): the stores set
the prices, take the payment and handle refunds. The server can't change a
store price, so gift cards and promo codes don't touch the stores at all.
Instead they work on **account credit**, which the server owns end to end.

## How it fits together

- **Gift card** — prepaid credit in USD cents, issued by the admin. A card
  is a bearer code (16 random characters); redeeming it moves its whole
  value into the player's account credit. Cards are single-use and can
  expire or be disabled.
- **Account credit** — a balance on the player, in cents. Every movement is
  a row in `credit_ledger`, so a balance can always be explained.
- **Credit purchase** — `POST /api/store/credit-purchase { productId,
  promoCode? }`. The server prices the product from its own list
  (`server/src/products.ts`), applies a validated promo code, checks the
  credit balance, and — in one SQL statement — deducts the credit, claims
  the promo use, logs the movement and grants the product. A client-supplied
  price is never trusted; there is no price field to supply.
- **Promo code** — a public code (`LAUNCH20`) that a player loads onto
  their account (`POST /promo-codes/load`); it then adds bonus beech bucks
  to bb pack purchases. When a pack is bought (Apple, Google, Steam, Xsolla
  or dev), the loaded code that gives the biggest extra bonus applies
  automatically, at most once per account, claimed atomically with the
  purchase so it can't be spent twice or after expiring. A code is percent
  (1–100, of the pack's bb, rounded up) or a fixed amount of bonus bb,
  optionally for one pack, with an optional usage cap and expiry.
  Fixed `value` means bonus bb on this path. The older credit-purchase
  discount path still exists (`/store/quote` + `/store/credit-purchase`
  with `promoCode?`): there a fixed `value` means cents off the price, and
  that path has no per-account check — so a code scoped to no product
  (`applies_to = NULL`) can be used once as a pack bonus and also as a
  credit-purchase discount. No fixed-cents code exists in production today
  (the only fixture is percent `LAUNCH20`); a fixed code created for packs
  must not be assumed to mean cents anywhere else. Bonus rows also write
  the bonus (in cents) into `promo_uses.discount_cents` alongside
  `bonus_bucks`; nothing sums that column, and the admin redemption display
  keys off `bonus_bucks`.

Gift cards and promos are the only way to get something without the store:
that is the point (a gift from Mark, a launch code, a press copy), and it
is why issuing them is admin-only.

## Gift card codes vs promo codes

They look alike and are treated differently on purpose:

| | Gift card code | Promo code |
|---|---|---|
| Secrecy | Bearer credential — whoever has it can redeem it | Public marketing code, meant to be shared |
| Stored as | HMAC-SHA-256 under `GIFT_CODE_PEPPER`, never plaintext | Plain text, normalized upper case |
| Shown | Once, in the issue response; never again, never in logs | Listed in the console and the CLI, freely |
| Guessing | 16 chars from a 32-letter alphabet (80 bits), plus a per-user rate limit (10/min) on redeem | Rate-limited quote/purchase; a guessed code still needs credit to buy anything |

## Admin console

The admin console is **its own app**, not part of the game: a separate
process (`server/src/adminServer.ts`, `adminApp.ts`, `adminPage.ts`) that
production runs as its own Cloud Run service, **`beech-admin`**, next to
`beech`. It shares the game's database and nothing else: the game server
has no admin routes and no admin secrets.

**Nothing loads without a Google sign-in.** Signed out, `GET /` is a
sign-in page holding only a Google button. No console code, no API paths
and no data are served until the browser holds an admin session; every
`/api` route answers 401.

Exactly one Google account gets in: the allowlist in `ADMIN_EMAILS`
(production: `markjen@gmail.com`).

- **Sign-in.** The sign-in page posts the Google ID token to
  `/auth/google`. The server checks the signature, the issuer, the expiry
  and the audience. The audience must be the web client ID
  (`GOOGLE_CLIENT_ID`); a token minted for another app doesn't count. It
  then checks the **verified** email (`email_verified` must be true)
  against the allowlist. Anyone else gets a flat "isn't an admin". The
  admin gets no game account.
- **Session.** A random token in a `__Host-beech-admin` cookie:
  HttpOnly, Secure, SameSite=Strict, 12 hours. Only its SHA-256 is stored,
  in `admin_sessions`, and the stored email is checked against
  `ADMIN_EMAILS` **on every request**. Taking an email off the list locks
  it out at once.
- **CSRF.** Every cookie-authenticated request must also carry
  `X-Beech-Admin: 1`. A cross-site page can't send that header without a
  CORS preflight, and this app never answers one.
- **Page hardening.** A nonce-based Content-Security-Policy, plus
  `frame-ancestors 'none'`, `Cache-Control: no-store`, `noindex` and
  `Referrer-Policy: no-referrer`.

The **CLI** (`scripts/beech-admin.mjs`) talks to the same service with
`Authorization: Bearer <ADMIN_API_TOKEN>`. The server hashes the
presented token (SHA-256) and compares it in constant time to the hash of
the env value. That value is hashed once at startup, so the raw token is
never kept past boot. The CLI reads the token from the operator's
environment (`BEECH_ADMIN_TOKEN`), never from the repo, and the service
URL from `BEECH_ADMIN_URL`. There is no fallback and no DEV_AUTH.

Every admin action is written to `admin_audit` with the actor: the
admin's email, or `cli-token`. Rows from before the split hold a user id.
Audit rows never hold a gift card code. The console's **Audit log** tab
and `beech-admin.mjs audit` show the latest 100.

### What the console manages

| Tab | What you can do |
|---|---|
| Beaches | Counts (players, beaches, with sand, saved in 24 h, neighbor links, hidden). Search by code, beach name, owner name or email, or id; filter to beaches with sand or hidden ones. Open a beach to see its owner, location, size, version and epoch, the things on it, its neighbors and requests, how many people favorited it, its checkpoints, and the owner's other beaches, with an "Open in the game" link (`BEECH_APP_URL/?visit=CODE`). Actions: **rename** it, **hide it from the shore / put it back**, give it a **new code** (the old one stops working), **part it from a neighbor** (both ends go), **clear the sand** and **delete** it. |
| Gift cards | Issue (the code is shown once), list, disable. |
| Promo codes | Create, list, disable. |
| Redemptions | Gift cards redeemed, promo uses, credit movements. |
| Audit log | The latest admin actions. |

**Clearing the sand** keeps what was there as the beach's "Before it was
cleared" checkpoint (the same slot a restore uses), so the owner can put
it back. The beach's epoch goes up, so a device still showing the old
sand can't save it over the cleared beach. **Deleting** works only on a
beach that isn't someone's home; a home beach goes only with its account.
Links, requests and favorites go with it.

### Running it locally

`npm run server:dev` also serves the console on <http://localhost:8788>
(`ADMIN_DEV_PORT`). It shares the game server's process, because PGlite
can't be opened by two processes. `ADMIN_DEV_PORT` is refused in
production. Signing in there needs a Google client that allows
`http://localhost:8788`. The CLI works with
`ADMIN_API_TOKEN=… npm run server:dev` and `BEECH_ADMIN_TOKEN=…`. To run
the console as its own process locally, point both at one Postgres with
`DATABASE_URL`, then run `node server/build/adminServer.js`.

## Player endpoints

| Endpoint | Auth | What it does |
|---|---|---|
| `POST /api/gift-cards/redeem { code }` | session | Claims the card atomically (active, unexpired, not yet redeemed), credits the player, logs it. Unknown code: 404; used/disabled/expired: 409. Rate-limited per user. |
| `GET /api/credit` | session | Current credit in cents. |
| `POST /api/promo-codes/load { code }` | session | Loads a promo code onto the account (active, unexpired, under its cap); the biggest-bonus loaded code then applies automatically to pack purchases. Unknown code: 404; used/disabled/expired/exhausted: 409. |
| `GET /api/promo-codes/mine` | session | The account's loaded codes with their per-pack bonuses. |
| `POST /api/store/quote { productId, promoCode? }` | session | Price, discount and final price, without spending anything. Legacy credit-purchase discount path (fixed `value` means cents here). |
| `POST /api/store/credit-purchase { productId, promoCode? }` | session | The purchase. 402 when the credit doesn't cover it. Legacy credit-purchase discount path (fixed `value` means cents here). |

The shop dialog shows the credit balance, a gift card redeem box, a promo
code field that loads a code onto the account (its bonus then shows on
packs as "+ N bonus"), and a "Buy with credit" button on products the
credit covers (`src/ui/shop.ts`, `src/net/shop.ts`).

**Web only.** In the iOS and Android apps the shop shows none of these:
digital items there must be bought through the store (App Store
guideline 3.1.1, Google Play's payments policy), and an app that unlocks
them with outside codes or credit risks rejection. `codesAllowed()` in
`src/net/shop.ts` gates them; credit someone has is still theirs, and
they spend it on the web. (The API itself doesn't check the platform:
the rule is about what the apps offer, and a request's platform can't be
trusted anyway.)

## Secrets and setup (nothing secret lives in this repo)

| Secret / setting | Where it lives | Which service | How to set it |
|---|---|---|---|
| `ADMIN_EMAILS` | GitHub Actions variable (public identifier, not a secret) | `beech-admin` | `markjen@gmail.com` |
| `GOOGLE_CLIENT_ID` | GitHub Actions variable (already set for the game) | `beech-admin` | The web OAuth client. **Add the `beech-admin` URL to its Authorized JavaScript origins** (Console → APIs & Services → Credentials), or the sign-in button won't load. The deploy log's smoke test prints the URL. |
| `ADMIN_API_TOKEN` | Secret Manager secret `beech-admin-token` | `beech-admin` only | Generate a random token (`openssl rand -hex 32`) and create the secret. Rotate it by replacing the secret and redeploying. |
| `GIFT_CODE_PEPPER` | Secret Manager secret `beech-gift-code-pepper` | both: `beech-admin` issues, `beech` redeems | Generate it the same way. A missing pepper only logs a warning, because the codes are 80-bit and the hash is still one-way. Set it anyway: then a leaked database alone can't be used to test guesses offline. Rotating it orphans unredeemed cards issued under the old pepper, because their hashes won't match. Issue replacements instead of rotating casually. |
| `BEECH_APP_URL` | set by the deploy workflow (the `beech` service URL) | `beech-admin` | Nothing to do. |

Local development: `ADMIN_EMAILS` unset means nobody is an admin.
`GIFT_CODE_PEPPER` unset is fine outside production; tests pass their own
pepper. `ADMIN_API_TOKEN` unset disables the CLI.

The deploy workflow (`.github/workflows/deploy-gcp.yml`) builds a second
image (`docker build --target admin`) and deploys it as `beech-admin`:
`--max-instances 1`, the same runtime service account and the same Cloud
SQL connection. `beech` no longer gets `ADMIN_EMAILS` or
`ADMIN_API_TOKEN`. **The two Secret Manager secrets must exist, or the
deploy fails.** The running services keep serving their old revisions,
but nothing new deploys.

**Optional hardening:** put Identity-Aware Proxy in front of
`beech-admin` (`gcloud run services update beech-admin --iap`, then grant
`roles/iap.httpsResourceAccessor` to the admin account). Google then
gates the service before a request reaches it, on top of the app's own
sign-in. This isn't on by default. It needs an OAuth consent screen set
up for IAP, and the CLI would need an IAP identity token too.

## What this deliberately does not do

- **No selling gift cards.** There is no web checkout, so a card can only
  be issued by the admin, never bought. Selling them needs a payment flow
  first.
- **No partial redemption.** Redeeming a card moves its whole value into
  account credit at once.
- **No refunds of credit.** A credit purchase grants immediately; there is
  no refund path (unlike store purchases, which the stores refund and the
  server then revokes).
- **No per-beach or per-item promos beyond one product.** `applies_to` is
  one product id or any product.
