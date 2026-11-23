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
- **Promo code** — a public code (`LAUNCH20`) that discounts a credit
  purchase: percent (1–100) or a fixed amount in cents, optionally for one
  product, with an optional usage cap and expiry. Validated server-side at
  quote and at purchase time, and claimed atomically with the purchase, so
  it can't be spent twice or after expiring.

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

## Admin access

Exactly one Google account: the allowlist in `ADMIN_EMAILS`
(production: `markjen@gmail.com`). The check is server-side on every
admin request, against the **verified** email on the Google ID token
(`email_verified` must be true; Apple sign-in and DEV_AUTH have no email
and never pass).

Two ways in:

1. **Web console** at `/admin`: sign in with Google (same sign-in as the
   app), the server swaps the credential for a session and checks the
   email. Anyone else gets a flat "isn't an admin" with no details.
2. **CLI** (`scripts/beech-admin.mjs`): `Authorization: Bearer
   <ADMIN_API_TOKEN>`. The server hashes the presented token (SHA-256)
   and compares it in constant time to the hash of the env value, which
   is hashed once at startup — the raw token is never kept past boot.
   The token comes from the operator's environment (`BEECH_ADMIN_TOKEN`),
   never from the repo. No token, no fallback, no DEV_AUTH.

Admin actions (issue/disable gift card, create/disable promo) are written
to `admin_audit` with the actor (`user id` or `cli-token`). Audit rows
never hold a code value.

## Player endpoints

| Endpoint | Auth | What it does |
|---|---|---|
| `POST /api/gift-cards/redeem { code }` | session | Claims the card atomically (active, unexpired, not yet redeemed), credits the player, logs it. Unknown code: 404; used/disabled/expired: 409. Rate-limited per user. |
| `GET /api/credit` | session | Current credit in cents. |
| `POST /api/store/quote { productId, promoCode? }` | session | Price, discount and final price, without spending anything. |
| `POST /api/store/credit-purchase { productId, promoCode? }` | session | The purchase. 402 when the credit doesn't cover it. |

The shop dialog shows the credit balance, a gift card redeem box, a promo
code field, and a "Buy with credit" button on products the credit covers
(`src/ui/shop.ts`, `src/net/shop.ts`).

**Web only.** In the iOS and Android apps the shop shows none of these:
digital items there must be bought through the store (App Store
guideline 3.1.1, Google Play's payments policy), and an app that unlocks
them with outside codes or credit risks rejection. `codesAllowed()` in
`src/net/shop.ts` gates them; credit someone has is still theirs, and
they spend it on the web. (The API itself doesn't check the platform:
the rule is about what the apps offer, and a request's platform can't be
trusted anyway.)

## Secrets and setup (nothing secret lives in this repo)

| Secret / setting | Where it lives | How to set it |
|---|---|---|
| `ADMIN_EMAILS` | GitHub Actions variable (public identifier, not a secret) | `markjen@gmail.com` |
| `ADMIN_API_TOKEN` | Secret Manager secret `beech-admin-token` | Generate a random token (`openssl rand -hex 32`), create the secret, add it to the deploy workflow's `--set-secrets` next to `DB_PASSWORD`. Rotate by replacing the secret and redeploying. |
| `GIFT_CODE_PEPPER` | Secret Manager secret `beech-gift-code-pepper` | Generate the same way, add to `--set-secrets`. A missing pepper only logs a warning (the codes are 80-bit, so the hash is still one-way), but set it: it means a leaked database alone can't be used to test guesses offline. Rotating it orphans unredeemed cards issued under the old pepper (their hashes won't match) — issue replacements instead of rotating casually. |

Local development: `ADMIN_EMAILS` unset means nobody is an admin;
`GIFT_CODE_PEPPER` unset is fine outside production (tests pass their own
pepper). `ADMIN_API_TOKEN` unset disables the CLI.

The deploy workflow already passes these two secrets (`--set-secrets`
next to `DB_PASSWORD`, in this PR) and `ADMIN_EMAILS` (from the
`ADMIN_EMAILS` Actions variable). **The two Secret Manager secrets must
exist before this merges, or the deploy will fail** (the running service
keeps serving the old revision, but nothing new deploys). Until they
exist the admin console returns 403 and the CLI 401 in production; the
shop, gift card redeem and credit purchase still work (cards are only
issuable once the secrets are set).

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
