# Beech bucks and trade-ins (design)

Status: **built** (2026-11-26), as designed. State machine:
[`specs/tla/SandBucks.tla`](../specs/tla/SandBucks.tla) (see
[State machine](#state-machine)).

Everything in the shop is priced in **beech bucks**, whole numbers. Real
money only ever buys beech-buck packs. Anything in your bag that isn't on a
beach can be **traded in** for beech bucks at its full value, so people can
try builds freely and change their minds without losing anything.

## Decisions (owner, 2026-11-26)

| | |
|---|---|
| Rate | **1 beech buck = 10¢.** Today's prices carry over exactly (rounded to the buck: $2.99 → 30). |
| Real money | Buys **beech-buck packs only**: from the App Store / Google Play / Steam, a web card payment (Xsolla), or a gift card. |
| Shop | Everything is bought with beech bucks: single things, extra beaches, snacks, the pet crab, and bundles. A bundle's discount is a beech-buck price. |
| Trade-in value | **What you actually paid** for that thing (a bundle's or a promo's price shared out over what it held). Things that came **free** (claw, vending, digging, rewards, starter and invite gifts) are worth their **shop price**, or a price by rarity when no shop sells them. A **gift** keeps the value it had for the giver. |
| What can be traded in | Things you place on a beach, and unused extra beaches. Not snacks, not the pet crab, not one-of-a-kind items (each has one owner; trading it in would destroy it). Free things (rocks, shells…) aren't in the bag, so there's nothing to trade. |
| On a beach | Only units that aren't on any of your beaches. Pick it up first. An extra beach can be traded in only while your beach allowance still covers the beaches you have. |

The owner chose full value for free things knowing it makes the free claw
and vending goes, and gifts, a way to earn beech bucks. That's on purpose:
"try anything, no penalty". Watch the numbers (STATUS.md, "Follow-ups").

## Prices

| Thing | Beech bucks |
|---|---|
| Parasol, deckchair, beach towel | 10 |
| Surfboard, bonfire, hammock, tiki torches (a pair) | 15 |
| Sandcastle, pet sand crab | 20 |
| Lighthouse, palm tree, beach hut, lifeguard tower, extra beach | 30 |
| Beach snacks: 10 / 35 | 10 / 30 |
| **Bundles:** three extra beaches / Founder's (2 beaches, lighthouse, hut, parasol, 2 tiki torches) | 70 / 100 |
| Claw, vending and digging finds (trade-in only) | common 5, uncommon 10, rare 15, legendary 30 |
| Community items | their approved price, rounded to the buck |

**Packs (real money):** 10 beech bucks $0.99 (`bucks_10`), 33 for $2.99
(`bucks_30`), 60 for $4.99 (`bucks_50`), 130 for $9.99 (`bucks_100`), 280 for
$19.99 (`bucks_200`). The base rate is 10¢ a buck; bigger packs carry a
bonus (+10% / +20% / +30% / +40%), so the price per buck falls as the pack
grows (9.90¢, 9.06¢, 8.32¢, 7.68¢, 7.14¢). The product id is the price tier,
not the grant — the ids are the product ids in the stores, Xsolla and Steam,
so they stay put while the grant carries the bonus. Gift cards give 1 sand
buck per 10¢ of their value.

## How it's kept

The balance stays in `users.credit_cents`, counted in cents at 10¢ a buck,
and every change is a whole number of bucks (a multiple of 10). That keeps
gift cards, the credit ledger, creator royalties and the debt column as
they are. The app and the API show **bucks** (`credit_cents / 10`).
Existing balances round up to the next whole buck in the migration.

- **Packs in** (`grantPurchase`): an App Store / Play receipt, a paid web
  order, a finalized Steam order. The bucks go in through `creditBalance`,
  which pays off any debt first. Ledger kind `pack`.
- **Refunds** (`revokeStorePurchase`): a pack's bucks come back out through
  `clawBack`. What's already spent becomes debt (`creator_credit_debt_cents`,
  now "debt" for any clawback), paid off by the next bucks in. Ledger kind
  `pack_refund`. A refunded purchase from an old app version (it granted
  things, not bucks) still expires those things, and takes back the bucks of
  any that were traded in.
- **Spending** (`POST /api/store/buy { offer | basket, requestId }`).
  The app keeps a basket's request ID until a receipt or a definite no, so a
  retry after a lost answer gets the first receipt, not a second charge:
  one statement debits the bucks and grants the things, each unit with its
  trade-in value (`inventory.unit_cents`), the price shared out by list
  value (largest remainder, so it adds up exactly). Promo codes never
  discount a credit purchase; they add bonus bb to bb pack purchases
  (docs/GIFT_CARDS_PROMOS.md). Creator royalties: 30% of the bucks paid, rounded
  to the buck.
- **Trade-ins** (`POST /api/bag/trade-in { item, quantity }`): one
  transaction holding the player's lock (the one saves, restores, copies and
  gifts take). It checks that many units are free (owned − on your beaches,
  or allowance − beaches for an extra beach), takes the newest units first
  (so "buy, then change your mind" returns exactly what was paid), credits
  their values, and logs `trade_ins`. A creator royalty on a traded-in unit
  goes back.
- **Gifts** carry the unit's value (`unit_cents`) to the recipient, and the
  creator royalty it earned (`inventory.royalty_ref`, migration 32), so a
  traded-in gift takes back the right royalty. A community item's units each
  get their own bag row (and royalty) when bought, so one can be gifted or
  traded in alone.
- `inventory.unit_cents` NULL means "its list value" (everything granted for
  free, and everything from before this change).

## Old app versions

The apps in the stores today sell `item_lighthouse` and friends through
Apple and Google. `GET /api/store/products` keeps answering them as before,
and their receipts keep granting things (at their list value for a later
trade-in). The Steam builds already out, and a web page loaded before the
release, can still start a Steam or card checkout for an item product
(`/store/steam/init` and `/store/web-checkout` take packs and the old items).
New apps use `GET /api/store/catalog`: packs (real money) and offers (bucks).
The old products can be removed from sale in App Store Connect, the Play
Console and Steam once the new app is out.

## Copying a beach

"Buy what's missing" (docs/COPY_BEACH.md) becomes one tap: the basket is a
beech-buck price, and one `POST /api/store/buy { basket }` buys it all. When
the balance is short, the sheet offers a beech-buck pack first.

## App

- **Names (owner, 2026-11-26):** beech bucks are written **bb** where space is
  tight (prices, buttons, packs, toasts). The shop's balance line shows the
  coin and "100 beech bucks".
- **Shop:** your balance on top, then everything for sale in bb, then the bb
  packs (the store's price). Promo codes stay here (web). Gift cards moved
  to your account page on beechshore; the web shop links to it ("your
  account · gift cards · history ↗"; hidden in the apps).
- **Settings → Account:** links to your account page on beechshore, for
  topping up and history (signed in only; the apps open it with `?from=app`).
- **Bag:** a line under the title, "long press item to trade in" (the
  owner asked for this note in the game). Long press (or right click) any
  owned thing, or an extra beach, opens the trade-in dialog: a − n + picker
  up to how many can be traded now (the server's `free`), "you get bb X"
  (the newest n units' values, the order a trade-in takes them), **trade in**
  (`POST /bag/trade-in { item, quantity }`), and **gift**, which opens your
  account page on beechshore with that thing picked. Things on a beach can't
  be traded until they're picked up (the dialog says so).
- **Thing in hand:** the place bar has only the size slider and ×; no
  trade-in or gift buttons.

## Your account on beechshore

`beechshore.com/account` (`server/src/accountPage.ts`; `/shore/account` on
the game's host). It connects with the same popup and short-lived token as
item submissions (`/submit/connect`, `item_submission_sessions`, an hour).
The page keeps the token in `sessionStorage`, so a top-up's return lands
still connected.

- **Balance:** the coin and "N beech bucks", and any debt from a refund.
- **Top up:** the five packs, by card through Xsolla (`POST
  /account/api/top-up { productId, mount }`). Pay Station comes back to
  `SHORE_URL/account` (or `/shore/account` on the game host): one of two
  fixed places, never a URL from the request. The page then polls the web
  order until it's paid. Packs only (an item product is refused).
- **Gift card:** redeem a code (moved here from the shop).
- **Gift something:** pick a thing in your bag and a beach code (moved here
  from the place bar; `?gift=<item>` preselects it).
- **Invite friends:** your link (`GAME_URL/?invite=CODE`), copy and share,
  and who joined with the bb each earned you (moved here from the game's
  invite panel).
- **History:** every `credit_ledger` row, newest 100, each with a plain
  line (`server/src/ledger.ts`): packs and refunds by name, what you
  bought, trade-ins with how many, gift cards, creator credit, invite
  bonuses.
- Opened from an app (`?from=app`): no top-up or gift card (store rules on
  linking out to paying).

The page calls `/account/api/*`; the shore site forwards those to the game
API's `/shore-account/*` routes (`app.ts`), which take only the shore token
(`requireShoreAccount`) and reuse the game's own handlers (`webCheckout`,
`webOrder`, `redeemGiftCard`, `sendGift`). The shore token can't reach any
other route, and a game session token can't reach these.

## Invite bonuses

A friend who makes an account through your invite gets **bb 50**, and so do
you, for your first 10 friends (`INVITE_BONUS`, `REWARD_CAP` in
`server/src/referrals.ts`; ledger kind `invite_bonus`). One transaction in
`POST /referrals/claim` writes the referral and both credits
(`specs/tla/Invites.tla`). These are free bucks in (`BonusIn` in
`SandBucks.tla`, counted with the other free value in `ValueConserved`).
Referrals from before keep the old item ladder (`bonus_bucks` NULL).

- **Native apps:** beech bucks bought anywhere can be spent in the app (App
  Store guideline 3.1.3(b), multiplatform services, since the packs are
  also sold in the app). Gift cards and promo codes stay web only.

## State machine

[`specs/tla/SandBucks.tla`](../specs/tla/SandBucks.tla); `SandBucksFixed.cfg`
passes, and `SandBucks.cfg` (a trade-in as two statements) breaks
`NoPhantomUnits` (two trade-ins of the last unit) and `NeverTradePlaced` (a
save places it in between).

| Action | Route | Code |
| --- | --- | --- |
| `BuyPack` | `POST /store/purchase`, the Xsolla webhook, `POST /store/steam/finalize`, gift card redeem | `grantPurchase` → `creditBalance` |
| `RefundPack` | Apple / Google notifications, Xsolla refund, Steam refund sync | `revokeStorePurchase` → `clawBack` |
| `Spend` | `POST /store/buy` | one statement: debit, grant with `unit_cents` |
| `FreeGrant` | claw, vending, dig finds, rewards, gifts in | the existing grants (`unit_cents` NULL = list value) |
| `GiftOut` | `POST /gifts` | `giveOne` (moves `unit_cents`) |
| `Save` | `PUT /beaches/mine/:id/sand` | `saveBeach` (asEditor) |
| `TradeAtomic` | `POST /bag/trade-in` | one transaction under the player lock |
| `BonusIn` | `POST /referrals/claim` | `creditBalance(..., 'invite_bonus')` in the claim's transaction (`Invites.tla`) |

Invariants: `ValueConserved` (balance − debt + the bag's trade-in value =
packs bought + free value in − gifts out: spending and trading in are even
swaps), `NoPhantomUnits`, `NeverTradePlaced`, `NoNegative`.

## Owner tasks

- Create the pack products in App Store Connect and the Play Console
  (`bucks_10` … `bucks_200`, consumable), in Steam (item ids 1101–1105), and
  in Xsolla (same SKUs).
- Update the store listings (in-app purchases are now beech-buck packs).
- Take the old item products off sale once the new app is live.
