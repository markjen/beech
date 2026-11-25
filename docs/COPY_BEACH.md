# Copying a beach (design)

Status: **designed, not built** (2026-11-25). State machine:
[`specs/tla/BeachCopy.tla`](../specs/tla/BeachCopy.tla), checked with TLC
(see [State machine](#state-machine)).

See a beach you love on the shore, and make one of your own beaches just
like it: the same sand and the same things. Free things (rocks, driftwood,
shells, flags...) always come along. Bag things (a lighthouse, a palm tree,
a conch from the claw) need to be in your bag. If they aren't, you choose:

1. **Buy what's missing** from the shop, then copy the whole beach, or
2. **Copy what you can**: the sand and everything you have, without the
   missing things.

A third, quieter choice is always there: **keep it as a checkpoint**, which
needs nothing from your bag. You can restore it later, once you have the
things.

Under the hood a copy is a **checkpoint restore whose source is someone
else's saved beach**. The strict and drop-missing modes, the
inventory check (`fitOf`), `dropMissing`, the "Before ..." automatic
checkpoint, the epoch bump and Undo all exist already
([CHECKPOINTS.md](CHECKPOINTS.md)). This feature adds a new source, a new
target (a new beach), a version pin, the shopping basket and the places in
the UI.

## What people get

- On any public beach in the game: **copy** in the shore bar. On
  beechshore.com: **Copy to my beach** next to "Visit in beech".
- A copy sheet: a picture of the beach, where to put it (one of your
  beaches or a new one), the bag things it needs and whether you have them.
- If you have everything: **Copy**. The beach you picked is replaced, you
  land on it, and a toast offers **Undo**.
- If you're short: **Buy what's missing** (the exact items and the total
  price) or **Copy without them**.
- On your own beaches (settings → your beaches): **duplicate**, the same
  sheet with your own beach as the source.

## Where it goes in the UI

You decide to copy a beach while you're looking at it, so the button goes
where you look at other people's beaches. In order of importance:

| Place | What | Why |
|---|---|---|
| **The shore bar** (in the game, on someone else's beach) | `copy` button, between the star and `⌂ my beach` | The bar already holds everything you can do *to a beach you're visiting*: leave something, ask to be neighbors, feed pet, star. Copying is the same kind of action. You see it in 3D, at its real place and light, right before you decide. |
| **beechshore.com beach page** (`/K7F2QX`) | **Copy to my beach →** next to "Visit in beech →", linking to `GAME_URL/?visit=K7F2QX&copy=1` | Most browsing of the best beaches happens on the shore site (`/top`, `/rising`). The link opens the game on that beach with the copy sheet already open, so the person sees the beach in 3D behind the sheet. The site has no accounts, so the game does the sign-in and the copy. |
| **Settings → your beaches** | **duplicate** on each saved beach | "Make another like this one" for your own beaches, including ones off the shore. Same sheet, same route. |

Not on the leaderboard rows, neighbor name tags or the shore site's lists:
one tap takes you to the beach from all of those, and the shore bar is
right there. Fewer buttons, and nobody copies a beach without having seen
it.

**Signed out** (the read-only public visit): `copy` shows, and like `leave
something` it signs in first, then opens the sheet. The **sandbox build**
has no accounts and no bag, so it has no copy button. Its route to a
design is a beach file (BEACH_FILE.md).

**On a phone** the shore bar wraps onto a second row when all the buttons
show. Check at 390×844 when building it. If it crowds, `copy` and `star`
are the two that matter most to a visitor, so `ask to be neighbors` moves
into the beach-name menu first.

**Not shown when:** it's your own beach (use duplicate), the beach isn't
public (see [Privacy](#privacy-and-consent)).

## The copy sheet

`src/ui/copyBeach.ts`, styled like the import preview
(`beachFileDialog.ts`). Labels and status only, no explanations (CLAUDE.md).
How it works goes in the guide.

```
┌────────────────────────────────────────────┐
│ Copy "Sunset moat"                       × │
│ Sam · Bondi                                │
│ ┌────────────────────────────────────────┐ │
│ │      /img/K7F2QX/thumb.png             │ │
│ └────────────────────────────────────────┘ │
│ Onto  [Home ▾]  Brighton  + a new beach    │
│                                            │
│ Lighthouse ×1      ✓                       │
│ Palm tree ×2       1 short · $2.99         │
│ Conch ×1           1 short · not in shop   │
│ Tiki torch ×1      ✓ (on Home)             │
│ + 214 rocks, shells and driftwood          │
│                                            │
│ [ Buy what's missing · $2.99 ]             │
│ [ Copy without them (2 left out) ]         │
│   keep as a checkpoint                     │
└────────────────────────────────────────────┘
```

States of the buttons:

| Situation | Main button | Second | Always |
|---|---|---|---|
| Nothing short | **Copy** (onto an existing beach: "Replace Home" then confirm) | none | keep as a checkpoint |
| Short, all buyable | **Buy what's missing · $X** | **Copy without them (N left out)** | keep as a checkpoint |
| Short, some not in the shop | **Buy the N you can · $X** | **Copy without them (N left out)** | keep as a checkpoint |
| Short, none buyable | **Copy without them (N left out)** | none | keep as a checkpoint |
| "a new beach" and no beach left in your allowance | the extra beach joins the basket (`beach_1`, $2.99) | pick one of your beaches instead | keep as a checkpoint |

- **"on Home"** is status, not advice: it says that thing is in your bag
  but already placed on another of your beaches. That is the same
  "elsewhere" the bag shows. Pick it up there and the sheet turns ✓ when
  you come back.
- Changing the target re-runs the fit, because the target's own things don't
  count against you.
- **Replacing an existing beach** asks once ("Replace Home?"), as
  restoring a checkpoint does. A new beach doesn't ask.
- The copy keeps **the target's place** (Bondi stays Bondi). A new beach
  takes the source's place by default, shown on the sheet as
  "at Bondi", and you can change it.
- A new beach gets the source's name with "(copy)" ("Sunset moat
  (copy)"). You can rename it later.

## Option 1: buy what's missing

The basket is worked out from the shortfall, the same `short` the fit
returns, item by item:

```
product(i)  = the single-item product that grants i (item_<id> in server/src/products.ts)
quantity(i) = ceil(short(i) / grant(i))        e.g. 3 tiki torches short, sold in pairs: 2
```

- **Only single-item products.** The Founder's pack is never suggested:
  the basket is exactly what's missing. (Buying the pack in the shop still
  counts, because the fit is checked again afterwards.)
- **Not in the shop:** claw, vending-machine, dig-find and wash-ashore
  things can't be bought. They are labelled "not in shop" and stay short.
  After buying, the copy can only go ahead with **Copy without them**, which
  then leaves out only those things.
- **A new beach** with no room in your allowance adds `beach_1` to the
  basket.
- The basket is worked out on the **server**
  (`GET /api/beaches/:code/copy-fit` returns it with prices), so the app,
  the store list and the price tiers can't drift. A pure
  `copyBasket(short, products)` lives in `server/src/products.ts`, with the
  app's copy in `src/world/checkpointFit.ts` and one fixture file
  (`tests/fixtures/copy-basket.json`) run in both suites, as with
  `checkpoint-fit.json`.

How the purchase works, by where you are:

| Where | How | Notes |
|---|---|---|
| **Shop credit** (gift cards) | one request, `POST /api/store/credit-purchase { items: [{ product, quantity }] }`, one transaction | The best path: one tap, no store sheet. Promo codes apply as today. |
| **Web** (Xsolla) | one order with several lines: `POST /api/store/web-checkout { items: [...] }`. The token call already takes `purchase.items[]` with quantities. `web_orders` gains lines. | The page leaves for Pay Station. Before it goes, the app saves the pending copy (`{ code, version, target, mode }`) in localStorage. On `?web_order=` return, once the order is paid, it reopens the sheet. |
| **iPhone / Android** | one store sheet per product, in turn ("1 of 2"). StoreKit and Play Billing have no basket. A quantity above 1 is bought as repeat purchases (the products are consumables). | Cancelling part-way keeps what was bought. The sheet re-fits and shows what's still short. |
| **Steam** | `InitTxn` with several line items | Same as the web return. |

**After buying**, the sheet re-fits and the main button becomes **Copy**
once nothing buyable is short. The copy is **never applied
automatically**. Purchases finish asynchronously (webhooks, receipts) and
the source may have changed meanwhile, so the person taps Copy once more
and sees exactly what they get.

## Option 2: copy what you can

This is checkpoints' `drop-missing` mode:

- The **sand is copied whole**, and so are all free things.
- For each short item, `dropMissing` leaves out `short(i)` of them, the
  highest ids (the ones placed last on the source). The source is never
  changed.
- The response says how many were left out, and the toast says "Copied
  onto Home · 2 left out".

## What's copied and what isn't

| Copied | Not copied |
|---|---|
| The sand (the source's BCH2 bytes, byte for byte) | The source's name, owner, stars, favorites, visitor notes and gifts |
| Every placed object: free things always, bag things as your bag allows | Its pet crab and any snacks out (server state, not in the save) |
| The grid as saved: any device fits and resamples it on load, as for a checkpoint | Its neighbors and place on the shore: the target keeps its own |
| | The source's real place for an existing target: the target keeps its own (a new beach starts at the source's place) |

The source is its **last save**. That is what beechshore.com draws and what
visitors load, so the sheet's picture is what you get.

## Credit and attribution

- `beach.copied_from` (source beach id, nullable), `copied_from_code`,
  `copied_version`. It is kept when the source is deleted, as a checkpoint
  keeps `from_name`.
- `beach_copies (source_beach, copier, first_at)`, unique on
  `(source_beach, copier)`, written `ON CONFLICT DO NOTHING` in the copy's
  transaction. It feeds:
  - a **"copied N times"** count on the source's beechshore page, counting
    people, not copies, so one person copying twice counts once;
  - an **inbox message** to the source's owner, "Sam copied your beach",
    the first time each person copies it (INBOX_NOTIFICATIONS.md kinds).
- On the copy's own beechshore page: "copied from K7F2QX ↗", a link back
  to the original while it's public.

None of this needs a model of its own. It is insert-once rows under a
unique key, written in the same transaction as the copy.

## Privacy and consent

- Only **public** beaches can be copied (`isPublic`: on the shore and
  saved; not hidden by an admin). That is the same set anyone can already
  see on beechshore.com.
- **Every public beach can be copied.** There is no per-beach "allow
  copies" setting: a beach on the shore is public, and keeping it off the
  shore is how an owner keeps it to themselves (owner decision,
  2026-11-25).
- **Your own beaches** (duplicate) can be copied whether or not they're
  public.
- The owner taking a beach off the shore takes effect at once, even for a copy sheet someone already has open. The
  model checks this (`NoCopyOffShore`).

## State machine

[`specs/tla/BeachCopy.tla`](../specs/tla/BeachCopy.tla), with
`BeachCopy.cfg` (the three-statement form) and `BeachCopyFixed.cfg` (the
design). `specs/tla/check.sh BeachCopy` passes: 243,648 distinct states,
two concurrent copies, three beach slots, an allowance of 2.

State: the copier's bag (one bag item), their beach rows and what each
holds, the source's version, whether it's public and what it holds, and
each copy request's step, target, mode and pinned version. The edit token
and the epoch work as in a restore (`BeachEditing.tla`), so they aren't
repeated here: a copy runs through the same `asEditor`.

| Action | Route | Code |
| --- | --- | --- |
| `CopyStart` | `GET /beaches/:code/copy-fit`, then tapping Copy | the app pins the `version` it previewed |
| `CopyAtomic` | `POST /beaches/mine/copy` | `oneAtATime(me, asEditor(tx => ...))`: the source row `FOR SHARE` (public, `version = $pin`), `fitOf`, the allowance, `dropMissing`, then the insert or the restore's `WITH snap ... UPDATE beach` |
| `SourceEdit` | the owner's `PUT /beaches/mine/:id/sand` | |
| `SourceShore` | the owner's `PATCH /beaches/mine/:id { onShore }`, an admin hide | |
| `Buy` | a store grant (receipt, webhook, credit) | grants only add |
| `Save` | the copier's other device saving | `BeachEditing`'s `SaveAtomic` |

Invariants, in the game's words:

- `WithinBag`: never more of a thing placed, across all your beaches, than
  you own.
- `WithinAllowance`: never more beaches than your allowance.
- `CopiedWhatSeen`: you get the version you previewed, or nothing (409
  `changed`).
- `NoCopyOffShore`: once a beach leaves the shore, nobody copies it.
- `NothingOffBeach`: things are only ever written onto beaches you have.

**What TLC found** in the three-statement form (read the source, then
check, then write), each with `--bugs`:

1. `WithinBag` (6 states): the copy checks the bag (1 lighthouse, none
   placed), then another device saves a lighthouse onto Home, then the copy
   writes one onto the new beach. Two placed, one owned.
2. `WithinAllowance` (9 states): two copies to "a new beach" both check the
   allowance (1 of 2 used), then both insert. Three beaches.
3. `NoCopyOffShore` (6 states): the copy reads the source, the owner takes
   it off the shore, then the copy writes.

So the design is **one transaction**. It holds the copier's player lock
(`oneAtATime` + `asEditor`, which serialise their saves, restores and
copies, and make the allowance check and insert safe), and reads the source
row `FOR SHARE`, so the owner's save or hide waits for the copy to commit.
**Lock order:** the copier's player lock, then the source row. The owner's
save takes the owner's player lock, then their own beach row. A cycle
would need the copier's own beach row taken under someone else's player
lock, which never happens, so there is no deadlock (a PostgreSQL test
should check two people copying each other's beaches at once). Copying
your own beach takes the same player lock twice, which is fine: it's one
transaction.

## Server

New routes, all behind `requireUser`:

| | |
|---|---|
| `GET /api/beaches/:code/copy-fit?target=<id>\|new` | `{ version, name, owner, location, nx, ny, items, need, owned, elsewhere, short: [{ item, short, buy?: { product, quantity, usd } }], room, basket: { items, usd } }`. 404 if not public (unless it's yours). |
| `POST /api/beaches/mine/copy { from: code, version, target: id \| 'new', mode: 'strict' \| 'drop-missing', name?, location? }` | 200 `{ beach, version, epoch, updatedAt, undo, dropped }`. 409 `{ error: 'short', short }` (strict), 409 `{ error: 'changed', version }` (the source has a newer save: the app re-previews), 409 `{ error: 'room' }`, 404 gone, 429. |
| `POST /api/checkpoints/copy { from: code, version }` | "keep as a checkpoint": a checkpoint with `source = 'copy'`, `from_name` = the source's name. No bag check (a checkpoint holds things, it doesn't place them). Counts toward the checkpoint limits. |
| `POST /api/store/credit-purchase`, `POST /api/store/web-checkout` | accept `items: [{ product, quantity }]` as well as the single product they take today |

Building it:

- Pull the restore route's body (`fitOf`, `dropMissing`, the auto
  checkpoint, the `UPDATE ... epoch + 1`) into `writeOnto(tx, me, target,
  bytes, mode, beforeName)` and call it from both routes, so a copy and a
  restore can't drift. For `target: 'new'`, insert the beach with the
  existing allowance-checked `INSERT ... WHERE (SELECT count(*) ...) < $allowance`
  first, in the same transaction.
- `requireEditToken` first (a copy replaces a beach). Rate limit
  `copyLimiter`: 20 an hour per person.
- Migration (appended): `beach.copied_from UUID`, `copied_from_code TEXT`,
  `copied_version INTEGER`;
  `beach_copies`.

## App

- `src/ui/copyBeach.ts`: the sheet. `net/account.ts`: `copyFit`, `copy`,
  `copyToCheckpoint`.
- `main.ts`: a `copy` button in the shore bar (hidden on your own beach and
  where `copyFit` would 404). `?visit=CODE&copy=1` opens the sheet once the
  beach is in view.
- **After a copy:** `BeachSync.flush` the live beach first (as a restore
  does), then go to the target, load it, and show the toast "Copied onto
  Home" with **Undo** (restores the `undo` checkpoint).
- **Pending copy** across a web checkout: localStorage
  `beech.pendingCopy = { code, version, target, mode, at }`, dropped after
  a day.
- Settings → your beaches: **duplicate** on each saved beach.

## Guide and release notes

- Guide (`server/src/guide.ts`): a "Copying a beach" section covering what
  comes along, what doesn't, the two choices when you're short, "not in the
  shop" things, keeping a copy as a checkpoint, Undo, and that
  any beach on the shore can be copied (keep it off the shore to prevent it).
- Release note when it ships: "Copy any beach on the shore onto one of
  your own, from the shore bar or beechshore.com."

## Tests

- **State machine** (`server/test/stateMachines/copy.test.ts`,
  `copyModel.ts`): each action on its own with its refusals; replays of
  the three counterexamples above, using `s.gate.pauseBefore` between the
  read and the write; a random walk of copies, saves, source edits, hides
  and grants against the model.
- **Unit:** `copyBasket` (pairs, several short items, unbuyable ones, the
  extra beach) from the shared fixture, in both suites.
- **Server:** copy onto an existing beach, onto a new one, at the
  allowance, strict and drop-missing, a changed source, an off-shore
  source, duplicating your own off-shore beach, the
  `beach_copies` row written once, Undo.
- **E2E:** a step in `scripts/` (`e2e:checkpoints` is the closest): visit
  a beach, copy it short, copy without them, Undo; then grant the missing
  item with the test clock and copy strict.
- **Screenshots:** the shore bar and the sheet at 1280×800 and 390×844.

## Phases

Each one leaves the app playable.

| | Phase | Done when |
|---|---|---|
| **K1** | Server copy | `writeOnto` shared with restore; `copy-fit`, `copy`, checkpoint copy; migration; state-machine tests green; TLC in CI. No UI. |
| **K2** | Copy in the game | Shore-bar button, the sheet, Copy / Copy without them / keep as a checkpoint, new beach, Undo toast, guide. |
| **K3** | Buy what's missing | Basket in `copy-fit`; credit and web basket purchases; native one-by-one; pending copy across the web checkout return. |
| **K4** | Shore site and credit | "Copy to my beach" on beechshore.com, `?copy=1`, duplicate in your beaches, "copied N times", inbox message, "copied from". |

## Decisions (owner, 2026-11-25)

- **Allow copies:** no setting. Every beach on the shore is public, so
  every one can be copied. Off the shore is the way to keep a beach to
  yourself.
- **Tell the owner and show "copied N times":** yes, both.
- **Copies on the leaderboard:** no special handling. Copies are not hidden
  from "just built" or any other list.
- **A basket discount:** no. The basket uses the shop's prices.
- **"copied from" on the copy's page:** not asked yet. Built as suggested
  (a link back to the original while it's public) unless the owner says
  otherwise.
