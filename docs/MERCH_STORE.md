# The merch store (store.beech.games)

Status: **built, switched off until the secrets and Printful are set up**
(2026-11-27). The Stripe account and test-mode catalog are done (see
"Turning it on"); the Printful token and the four secrets are still open.
The store page is live at `/merch-store` on any host (and at
store.beech.games once the domain is mapped): it shows the catalog and says
it opens soon. Orders turn on by themselves when the four secrets are set
(see "Turning it on").

## What it sells

| Product | Price | Made by | Printful product / variants |
| --- | --- | --- | --- |
| Beech tee | $30 | printed on demand (DTG front) | 71 Bella + Canvas 3001; white, soft cream, ocean blue, aqua, black; S–3XL |
| Beech hoodie | $55 | printed on demand (DTG front) | 146 Gildan 18500; sand, white, light blue, navy, black; S–3XL |
| Beech dad hat | $28 | embroidered on demand | 206 Yupoong 6245CM; khaki, stone, light blue, navy, white |
| Beech flip flops | $30 | sublimated on demand | 359 Sublimation flip flops; S, M, L |
| Beech beach towel | $45 | sublimated on demand | 259 Beach towel 30″ × 60″ |
| The whole beach set | $160 (vs $188) | one of each of the five, colours and sizes chosen per piece | — |
| Your beach tee | $36 | your own beach printed on the front | 71, same colours and sizes |
| Your beach hoodie | $62 | your own beach printed on the front | 146, same colours and sizes |

Shipping is a flat $8, free from $100, to the countries in
`MERCH.countries` (`server/src/merchCatalog.ts`). Every price, variant id
and the shipping rule live in `merchCatalog.ts`; the server prices every
cart from there and never trusts the browser's numbers. Variant ids were
read from Printful's public catalog API on 2026-11-27.

**Sunglasses, for later.** The sunglasses were in the first catalog and
are out for now (2026-11-27): Printful (and Printify, Gooten) don't print
sunglasses on demand. The few who do (Contrado, Bags of Love) have no
order API that fits. So the sunglasses are ordered once in bulk with the
beech logo on the arm (any promo supplier; 50–100 units, a few dollars
each), sent to Printful's warehouse (Printful Warehousing), and picked into
the same box as the printed things. When that is done and the Actions
variable `MERCH_SUNGLASSES_VARIANT` is set to their warehouse variant id,
the sunglasses come back as their own product in the store. The set does
not wait on that: it stays the five printed things.

## One-off prints of your beach

Yes, it's possible, and it's built for the tee and the hoodie. Printful's
order API takes a print file URL per order item, so every order can carry
its own picture: there's no product to set up per beach.

- The shopper signs in on the store with Google or Apple (the same shore
  token as beechshore.com's account page, docs/SHORE_SITE.md), sees their
  saved beaches with a preview of each, and picks one.
- At checkout the server copies that beach (its saved sand, its place, its
  pier and its inland rows) onto the order line, in the same transaction
  that checks the shopper still owns it. Building on afterwards doesn't
  change the print.
- The print file is the shore's top-down picture of that copy
  (`beachPng`, the same drawing as beechshore.com's cards), 1800 × 945
  pixels: 12″ wide at 150 dpi, which fills the width of Printful's 12″ × 16″
  DTG front area. It is served at `store.beech.games/api/print/<key>.png`;
  the key is random per line, so only Printful (and the order) know it.
- Only your own beaches: printing someone else's beach is refused (403).

## How an order goes

```
store page ── POST /api/checkout ──► server prices the cart, makes a Stripe Checkout
                                     session (idempotency key = order id), then saves
                                     the order (status open) + lines + beach copies
shopper pays on Stripe's page ─────► webhook checkout.session.completed ─┐
shopper comes back to /order/<id> ─► GET /api/orders/<id> asks Stripe ───┴► paid (once)
                                     │ send: claim → Printful draft (external_id = order id)
                                     │       → mark sent → Printful confirm
Printful makes it, webhook ────────► package_shipped → shipped (+ tracking on the order page)
```

- The **store page** (`server/src/merchSite.ts`) is one page that draws
  itself from `GET /api/catalog`: the set, the collection, and "your beach,
  printed". The bag is kept in the browser (localStorage). Each product is
  drawn as an SVG in the chosen colour with its real print file on it.
- **Payments: Stripe Checkout** (hosted by Stripe: card, Apple Pay, Google
  Pay; no card data reaches us). It collects the shipping address and
  phone, adds the flat shipping, and adds Stripe Tax
  (`MERCH_STRIPE_TAX=1`; Tax is active for CA). Stripe sends its own
  receipt email. Sessions are made with inline `price_data` from
  `merchCatalog.ts`, not by referencing Stripe Price IDs — the Stripe
  catalog (see "Turning it on") is the record/receipt side and must be
  kept in sync with the catalog's prices by hand.
- **Fulfilment: Printful's API** (`server/src/merchProviders.ts`, plain
  fetch). Orders are made as drafts, then confirmed. The brand art is in
  `public/merch/` (drawn by `scripts/merch-art.mjs` from the app icon; dark
  garments get the light-ink version) and Printful fetches it from
  `store.beech.games/merch-art/<file>`. The hat is embroidered, not printed:
  Printful's Orders API refuses an embroidered item without an item-level
  `thread_colors` option, so the hat's order item carries one
  (`HAT_THREAD_COLORS` in `merchCatalog.ts`: white, sky blue, black, old
  gold — the logo-hat art's palette matched to Printful's allowed threads).
- A **sweep** runs once a minute (`server.ts`): stale claims go back,
  orders left unconfirmed are confirmed, paid orders that couldn't reach
  Printful are retried.

## State machine

`specs/tla/MerchOrders.tla`; the action-to-route table is in
[STATE_MACHINES.md](STATE_MACHINES.md), "Merch store orders". The rules:
one receipt per order however many times Stripe tells us; nothing printed
unpaid; a refund before the order was sent stops the print; the print is
the beach as it was at checkout; a paid, unrefunded order never ends up
expired; a refunded order never looks live. What the model decided:

- marking paid is one `UPDATE … WHERE status IN ('open','expired')`, and
  only the request that gets the row sends the order on (the webhook and
  the return page race);
- we never expire an order ourselves: Stripe does, and a late "completed"
  still wins over "expired";
- the worker marks the order sent *before* confirming at Printful, under its
  claim, so a refund that lands first stops it;
- a refund cancels an order in every state before sent, including open
  (its "completed" may come after the refund).

## When something goes wrong

- **Refunds** are made in the Stripe dashboard. A full refund before the
  order went to Printful cancels it there and then; after, the order is
  marked refunded and it's already being made (cancel it in Printful's
  dashboard if it's still in its first hour). Partial refunds leave the
  order alone.
- **Printful problems** (`order_failed`, `order_canceled`,
  `order_put_hold`) are logged as `merch_printful_problem` (ERROR): sort
  them out in Printful's dashboard.
- **Logs**: `merch_checkout`, `merch_paid`, `merch_send`, `merch_refunded`,
  `merch_send_error`, `merch_tick`, `merch_stripe_webhook`,
  `merch_printful_webhook`.
- **Returns policy** (the guide, `server/src/guide.ts` "Merch store"):
  misprinted, damaged or wrong things are replaced or refunded within 30
  days; things made to order can't be returned for a change of mind.

## Turning it on (owner)

1. **Printful**: make an account, a "Manual order platform / API" store,
   and a private token with orders + webhooks scopes. Add billing (Printful
   charges you per order). Put the token in Secret Manager as
   `beech-printful-token`. (An account-level token also needs the Actions
   variable `PRINTFUL_STORE_ID`.)
2. **Stripe**: ✅ the account is set up — Jenerator Labs
   (`acct_14FIlH4IbcjUfc8t`), charges and payouts on, daily payouts to Bank
   of America ending 8659. Stripe Tax is active with a US–CA registration,
   so set the Actions variable `MERCH_STRIPE_TAX=1` (prices below are
   tax-exclusive; Stripe adds tax on top at checkout). The secret key goes
   in Secret Manager as `beech-stripe-secret-key` — the same key the game's
   web checkout uses (PR #191), so one secret serves both. Add a webhook
   endpoint `https://store.beech.games/api/stripe-webhook` with events
   `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.expired`
   and `charge.refunded`; its signing secret → **`beech-stripe-merch-webhook-secret`**
   (its own secret — the game's endpoint
   `/api/store/stripe/webhook` has a different signing secret in
   `beech-stripe-webhook-secret`, and one Stripe signing secret verifies
   only its own endpoint). Turn on "Successful payments" customer emails
   for receipts.
   - **Catalog (test mode, done 2026-11-27)** — every product exists with a
     default price matching `merchCatalog.ts` exactly. The checkout code
     sends inline `price_data`, not these Price IDs, so this catalog is the
     record/receipt side: if a price changes in `merchCatalog.ts`, change
     the matching Price here too, by hand.

     | Product | Price | Test-mode price id |
     | --- | --- | --- |
     | Beech T-Shirt (`prod_Vhp2DyHw5C6IG7`) | $30.00 | `price_1UgQGK4IbcjUfc8tSBqA6gYk` |
     | Beech Hoodie (`prod_Vhp2OiUR1wLtsv`) | $55.00 | `price_1UgQGM4IbcjUfc8tdEcxp6BI` |
     | Beech Hat (`prod_Vhp2JZnhpjs0Rx`) | $28.00 | `price_1UgQGN4IbcjUfc8tKWNztsXL` |
     | Beech Flip Flops (`prod_Vhp2mhGLOqLJh1`) | $30.00 | `price_1UgQGP4IbcjUfc8tB47117yz` |
     | Beech Beach Towel (`prod_Vhp2nbZ5Ky0sGs`) | $45.00 | `price_1UgQGR4IbcjUfc8tzLnosN8E` |
     | Beech Sunglasses (`prod_Vhp2nKNk8Ha8za`) | $22.00 | `price_1UgQGU4IbcjUfc8tSHsBsldI` — dormant: out of the store for now (see "Sunglasses, for later"), not deleted |
     | Beech Merch Set (`prod_Vhp2rlrkX6n0p2`) | $160.00 | `price_1UgRKK4IbcjUfc8tAzGYhxrx` (default since 2026-11-27; the old $179 price `price_1UgQGW4IbcjUfc8t1RRXfCxQ` still exists on the product but is no longer the default) |
     | Your Beach Tee (`prod_VhpwfdcKos7z6l`) | $36.00 | `price_1UgQGX4IbcjUfc8tvcXlVpiu` |
     | Your Beach Hoodie (`prod_Vhpw6RneSazepM`) | $62.00 | `price_1UgQGZ4IbcjUfc8t7B6QQ11B` |

     All shippable, tax code `txcd_10000000`. **Still open:** create the
     two secrets (`beech-stripe-secret-key`, `beech-stripe-merch-webhook-secret`,
     TEST keys) and grant the game service's account access; register the
     webhook endpoint above in the Stripe dashboard (test mode); at launch,
     create the same eight store products + prices in **live** mode (not the
     dormant sunglasses) and swap the secrets for live keys.
3. **Printful webhook**: make up a long random secret →
   `beech-printful-webhook-secret`, then register
   `https://store.beech.games/api/printful-webhook?s=<that secret>` for
   `package_shipped`, `order_failed`, `order_canceled`, `order_put_hold`
   (`POST https://api.printful.com/webhooks`, or the dashboard).
4. Give the game service's account access to the four secrets, set the
   Actions variable `MERCH_ENABLED=1`, and deploy.
5. **Domain**: `terraform apply -var store_custom_domain=store.beech.games`,
   then add the CNAME it prints in Squarespace (`beech.games` zone).
6. **Sign-in**: add `https://store.beech.games` to the web OAuth client's
   Authorized JavaScript origins, and the domain + return URL
   `https://store.beech.games/` to the Sign in with Apple Services ID.
7. **Test first**: set `PRINTFUL_DRAFTS_ONLY=1` and use Stripe test keys:
   orders reach Printful as drafts you can inspect (check each placement
   and the hat's embroidery in Printful's preview) and are never made.
   Order one of each for real before telling anyone.
8. Then a line in the release notes (`server/src/releaseNotes.ts`).

**Later: sunglasses.** Not a launch step. Order logo sunglasses in bulk,
send them to Printful Warehousing, and set the Actions variable
`MERCH_SUNGLASSES_VARIANT` to their warehouse variant id — the sunglasses
then come back as their own product in the store. The set stays five.

## Not built (ideas)

- Mockups from Printful's mockup generator instead of the drawn pictures.
- Your beach on the towel (sublimation, a tall crop of the beach) and the
  isometric view as a print choice.
- A "store" link in the game's settings and on beechshore.com.
