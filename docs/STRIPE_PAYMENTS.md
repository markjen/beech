# Web payments: buy store items on the web with Stripe (backup)

Status: **live in test mode.** The server code, the web shop and the
tests are in, and the deploy wires the test secrets (see "Turning it
on"). The web shop offers Stripe only when Xsolla is off — Xsolla
stays the primary whenever it works.

Stripe is the **backup** to Xsolla (docs/WEB_PAYMENTS.md), built while
Xsolla's sandbox token creation was blocked on a generic 422
[0401-2000] "Exception with PayStation service". Xsolla stays the
primary whenever it works: the client uses Xsolla when it is on, and
falls back to Stripe only when Xsolla is off and Stripe is on. The
merch store (docs/MERCH_STORE.md) is a separate Stripe integration
with its own keys and webhook — it does not use this one.

## The tradeoff, stated plainly

Unlike Xsolla, Stripe does **not** act as merchant of record.
Jenerator Labs is the legal seller, so tax/VAT filings, PCI scope and
chargeback liability all land on us — the thing Xsolla was chosen to
offload. Stripe's fee is 2.9% + $0.30 per transaction, which bites hard
on small items:

| Product | Price | Stripe 2.9% + $0.30 | Xsolla at 5% |
|---|---|---|---|
| Parasol / deckchair | $0.99 | $0.33 (keep $0.66) | $0.05 (keep $0.94) |
| Extra beach | $2.99 | $0.39 (keep $2.60) | $0.15 (keep $2.84) |
| Founder's pack | $9.99 | $0.59 (keep $9.40) | $0.50 (keep $9.49) |

Stripe only wins on nothing in this catalog at these prices — it is a
backup for when Xsolla cannot take payment at all, not a cheaper route.
Revisit the primary only if web volume ever justifies running our own
tax operation.

## What it does

- In the browser (never in the apps), the shop's price button opens
  Stripe's hosted Checkout page. The player pays there, comes back to
  the beach, and the item lands in their bag — the same grant an Xsolla,
  App Store or Play purchase gives, through the same `purchases` +
  `inventory` rows.
- A web purchase **grants the item directly**. It does not add account
  credit; credit stays gift-card-only (docs/GIFT_CARDS_PROMOS.md).
- The price comes from `server/src/products.ts`, priced into the
  Checkout Session by the server (`line_items[0].price_data`). There is
  no Stripe dashboard catalog to keep in step — unlike Xsolla, whose
  catalog mirrors `products.ts`. The client never supplies a price, and
  the server checks what Stripe charged against its own list before
  granting.
- **Promo codes never discount** (Mark, 2026-11-27): with a pack, a code
  gives bonus beech bucks on top, at the full price — the same rule as
  Xsolla (docs/WEB_PAYMENTS.md, "Promo codes").
- The native apps are unchanged: StoreKit / Play Billing only, and they
  never link or steer to web checkout.

## How it works (as built)

### Purchase flow

1. **Buy** (`src/ui/shop.ts` → `ShopApi.startStripeCheckout`): in web
   mode, when `GET /api/store/products` says `stripeCheckout: true` and
   `webCheckout` is false, the price button calls
   `POST /api/store/stripe-checkout` with the product ID and an optional
   promo code.
2. **Checkout** (`server/src/app.ts`): the server prices the product,
   writes a `web_orders` row (`created`, `provider: 'stripe'`), and asks
   Stripe for a Checkout Session — `POST
   https://api.stripe.com/v1/checkout/sessions`, Basic auth with the
   secret key, form-encoded (`server/src/stripe.ts`). One line item:
   USD, `unit_amount` = our price in cents, `product_data.name` = the
   product name. Our order id goes in `client_reference_id` and
   `metadata.web_order` (also in `payment_intent_data.metadata`, so a
   refund's charge carries it); the player's id goes in
   `metadata.user_id`. `success_url` is
   `https://play.beech.games/?web_order=<id>&session_id={CHECKOUT_SESSION_ID}`;
   `cancel_url` is the beach itself — canceling charges nothing and the
   created order just expires on read. Stripe answers `{ id, url }`; the
   session id is stored as the order's `provider_order_id` and is the
   `purchases` transaction id, like Xsolla's order id. If the session
   call fails, the row is deleted and the player sees "try again in a
   minute".
3. **Webhook** (`POST /api/store/stripe/webhook`): Stripe calls it when
   the session completes. The server checks the signature, finds the
   order, checks it, and grants in one statement (below).
4. **Return**: Checkout sends the player to
   `https://play.beech.games/?web_order=<id>&session_id=…`; `main.ts`
   strips those, and once signed in polls
   `GET /api/store/web-orders/:id` for up to a minute ("Checking your
   payment…" → "Paid: it's in your bag" and a bag refresh). Order ids
   are also kept in localStorage and re-checked when the shop opens, so
   a lost return link still refreshes the bag.

### Webhooks handled

| Event type | What we do |
|---|---|
| `checkout.session.completed` | Find the order by `metadata.web_order` (or `client_reference_id`). Check: the session id is the order's `provider_order_id`; `payment_status` is `paid`; `metadata.user_id` is the order's player; `amount_total` equals our price in cents and `currency` is USD; and a live event is refused in test mode (a test event is refused in live mode). Then grant, through the same `grantWebOrder` as Xsolla's `order_paid` — one statement, retried webhooks grant nothing twice. Any check failing → 400 and an ERROR log line; nothing granted. |
| `charge.refunded` | Find the order by the charge's `metadata.web_order` (copied from the PaymentIntent metadata we set at session creation). Revoke through the same `cancelWebOrder` as Xsolla's `order_canceled`/`refund`: the purchase is marked and every item it granted expires, including any the player gifted on. The order becomes `refunded` (was paid) or `canceled` (wasn't). An unknown order is acknowledged (200) so Stripe doesn't retry for days. |
| `checkout.session.expired` | Mark a still-created order `canceled`. A payment for it afterwards grants nothing. |
| anything else | 200, logged as ignored. |

A verified, handled webhook always answers 200, including repeats, so
Stripe's retries are harmless.

### Data (migration 46)

```sql
ALTER TABLE purchases DROP CONSTRAINT purchases_store_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_store_check CHECK (store IN ('apple', 'google', 'dev', 'xsolla', 'steam', 'stripe'));
```

Stripe payments reuse `web_orders` with `provider: 'stripe'` and
`provider_order_id` = the Checkout Session id. The grant is the same
one statement as Xsolla's (`grantWebOrder` in `server/src/app.ts`):
insert into `purchases` (`store = 'stripe'`, `transaction_id` = the
session id, `ON CONFLICT DO NOTHING`), mark the order `paid`, insert
the items into `inventory` with `purchase_id`. The
`UNIQUE (store, transaction_id)` key makes a retried or concurrent
webhook grant nothing. An order already canceled isn't revived by a
late payment. An unpaid order older than 24 hours (a Checkout
Session's life) reads as `expired` — computed on read, no sweeper; a
payment that still arrives for it is granted, because the player paid.

### Endpoints

| Endpoint | Auth | |
|---|---|---|
| `POST /api/store/stripe-checkout { productId, promoCode? }` | session; 10/min per player | → `{ order, url }`. 404 unknown product or checkout off; 400 with a code that can't give a bonus with this pack; 502 if Stripe refuses. |
| `GET /api/store/web-orders/:id` | session, owner only | Shared with Xsolla. |
| `POST /api/store/stripe/webhook` | Stripe signature | See "Webhooks handled". 404 while checkout is off. |
| `GET /api/store/products` | none | now also `stripeCheckout: boolean` (and `/store/catalog`). |

### Security

- **Signature first.** `Stripe-Signature: t=<seconds>,v1=<hmac-sha256(secret, "<t>.<raw body>")>`,
  hex; verified over the raw request bytes before any parsing,
  constant-time (`verifyStripeSignature`), timestamps more than 5
  minutes out rejected. Missing or wrong → 400. The webhook secret is
  separate from the secret key, and both are test-mode only until a
  deliberate live launch.
- **Never trust the webhook's amount or player**: both are checked
  against our `web_orders` row, which only our server writes.
- **Test can't grant on live.** Stripe's test mode uses the same
  webhook endpoint shape, so a test-card payment arrives correctly
  signed; a live setup refuses `livemode: false` events, and a test
  setup refuses `livemode: true` ones.
- **Every payment is tied to a signed-in account**: no anonymous
  checkout, and the grant goes to `web_orders.user_id` only.
- **No card data** touches our servers (PCI SAQ A — Stripe's hosted
  page takes the card); logs carry the event type, outcome and session
  id only, never payer details or keys.

## Turning it on (test mode)

1. **Stripe account.** Jenerator Labs' Stripe account is connected to
   Muse (Stripe connector, test mode available). Nothing in this PR
   creates or changes the account.
2. **Secrets** (Secret Manager, never the repo; TEST keys only — keys
   starting `sk_test_` and `whsec_`):
   ```sh
   printf %s "$TEST_KEY" | gcloud secrets create beech-stripe-game-secret-key --data-file=-
   printf %s "$SECRET"    | gcloud secrets create beech-stripe-webhook-secret --data-file=-
   ```
   Grant the runtime service account `secretAccessor` on both.
   `beech-stripe-game-secret-key` is the game's own key — **not**
   `beech-stripe-secret-key`, the merch store's key, which went live
   Nov 27, 2026 while the game checkout is still in test mode. The
   game code reads `STRIPE_GAME_SECRET_KEY` first and only falls back
   to `STRIPE_SECRET_KEY` for local setups, so a shared `:latest`
   can never silently flip the game live. Likewise
   `beech-stripe-webhook-secret` is the game endpoint's signing secret,
   not the merch endpoint's `beech-stripe-merch-webhook-secret`.
3. **Deploy wiring** (in this PR, `.github/workflows/deploy-gcp.yml`):
   the game service mounts
   `STRIPE_GAME_SECRET_KEY=beech-stripe-game-secret-key:latest,STRIPE_WEBHOOK_SECRET=beech-stripe-webhook-secret:latest`
   and sets `STRIPE_SANDBOX=1`. The deploy fails if either secret
   doesn't exist yet, so create them first.
4. **Webhook endpoint.** In the Stripe Dashboard (test mode):
   Developers → Webhooks → Add endpoint, URL
   `https://play.beech.games/api/store/stripe/webhook`, events
   `checkout.session.completed`, `charge.refunded`,
   `checkout.session.expired`. Copy the endpoint's signing secret into
   `beech-stripe-webhook-secret`. (Use the endpoint secret, not the
   account's — each endpoint has its own.) Or create it with the API:
   `POST /v1/webhook_endpoints` with the same URL and events, test key.
5. **Sandbox end to end** with `STRIPE_SANDBOX=1` and Xsolla off (the
   client picks Xsolla first, so turn Xsolla off to exercise Stripe):
   buy with Stripe's test card 4242 4242 4242 4242, cancel at Checkout,
   refund from the Dashboard; check the bag, the `web_orders` row and
   the `stripe_webhook` log lines. Turning Xsolla off is a one-off
   revision change, not a code change: `gcloud run services update
   beech --region us-central1 --remove-env-vars
   XSOLLA_PROJECT_ID,XSOLLA_SANDBOX` (the web shop's checkout is
   already non-functional on Xsolla's broken sandbox, and test-mode
   Stripe can't charge a real card); a later deploy restores Xsolla.
6. **Live** (a separate decision, not this PR): put live keys
   (`sk_live_`, `whsec_` for a live endpoint) in as **new versions of
   the same two secrets** (`beech-stripe-game-secret-key`,
   `beech-stripe-webhook-secret`), drop `STRIPE_SANDBOX` from
   `deploy-gcp.yml`, redeploy, buy the $0.99 parasol with a real card,
   refund it, and check it leaves the bag. Going live also means
   owning tax/VAT, PCI scope and chargebacks — see "The tradeoff"
   above. (Do not point the game at `beech-stripe-secret-key` for the
   live key: the merch store already mounts it, and the two checkouts
   must stay independently flippable.)

The server logs `stripe_config { enabled, sandbox }` at start, and a
warning if only one of the two settings is present. Each checkout logs
`stripe_checkout`; each webhook logs `stripe_webhook { type, outcome }`
(ERROR for refused payments — worth a log-based alert, like Xsolla's).

## Tests

- `server/test/stripeCheckout.test.ts`: signature (good, wrong secret,
  tampered body, missing, stale timestamp); session params; the session
  call (auth header, refusal message); config gating; checkout (auth,
  unknown product, promo refused, session failure leaves no order);
  grant once under retries and concurrent repeats; refused wrong amount
  / unpaid session / wrong player / unknown session / live event on
  test; test event on live; refund and expiry revoke; late payment
  after expiry still grants; promo bonus and its refund; switched-off
  server.
- `tests/webCheckout.test.ts`: the Stripe checkout call and the
  `session_id` return parameter.
- Before going live: the test-mode run in "Turning it on".

## What this deliberately does not do

- No live keys and no live endpoint — test mode only; the live flip is
  a separate decision in "Turning it on".
- No merch store: the same Checkout Sessions could sell merch later,
  but this PR sells only the existing `products.ts` catalog.
- No subscriptions, no paid random draws, no gift-card sales on the
  web, no web checkout inside the native apps, no change to store
  prices or credit.
- No Stripe Dashboard catalog: prices live in `products.ts` and are
  passed per session, so there is nothing to keep in step.

## Sources

- Stripe API docs: Checkout Sessions (`POST /v1/checkout/sessions`,
  form-encoded, `success_url` / `cancel_url` / `client_reference_id` /
  `metadata`), webhooks (signature scheme, `checkout.session.completed`
  / `charge.refunded` / `checkout.session.expired`, retry on non-2xx),
  test cards (4242…), read Nov 2026.
- Stripe pricing: 2.9% + $0.30 per successful card charge (US cards,
  Stripe's published US pricing, Nov 2026).
