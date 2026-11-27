# Game state machines: TLA+ models and tests

New gameplay and features are designed here first: see the
[model-first workflow](#model-first-workflow) below.

The parts of the game where several requests can change the same state are
modelled in TLA+ (`specs/tla/`), model-checked with TLC, and tested against
the real server without a browser (`server/test/stateMachines/`). The tests
run in under 10 seconds (`cd server && npm run test:state`), and with the
rest of `npm test` in `server/`. No E2E, no rendering.

| Machine | Spec | Tests | What can go wrong |
| --- | --- | --- | --- |
| Beach snacks and pets | `Snacks.tla` | `snacks.test.ts` | snacks lost or duplicated, a crab befriended for less, extra free feeds |
| Moving pets | `Pets.tla` | `pets.test.ts` | a pet on two beaches at once, a pet lost when another lands first, a shop pet item spent twice or not at all |
| Editing beaches | `BeachEditing.tla` | `editing.test.ts` | a fenced device overwriting the editor, more placed than owned, a restore overwritten |
| Neighbor links | `Neighbors.tla` | `neighbors.test.ts` | one-sided links, two neighbors on one side, two beaches linked on both sides |
| Copying a beach | `BeachCopy.tla` | `copy.test.ts` | more placed than owned, more beaches than the allowance, a copy of a beach just taken off the shore, a different version than previewed |
| Beech bucks and trade-ins | `SandBucks.tla` | `bucks.test.ts` | a trade-in of a thing on a beach, the last one traded in twice, bucks lost or minted by spending, trading in or a refund |
| Piers | `Piers.tla` | `piers.test.ts` | a pier landed after an unlink, two on one beach, a placed pier traded in or given away |
| Inland sections | `InlandSections.tla` | `sections.test.ts` | a reorder from one device silently undone by another, one section placed on two beaches, a placed section traded in |
| Push notifications | `Push.tla` | `push.test.ts` | a push sent twice, two in an hour, a push after unsubscribing, signing out, blocking or muting |
| Account promo codes | `PromoCodes.tla` | `accountPromos.test.ts` | a code used twice on one account, global `max_uses` exceeded in a race, a worse code applied instead of the best deal |

## How it fits together

1. **Spec.** Each route handler is an action. A handler that isn't one
   transaction is split into steps (for example `AdoptCheck` and
   `AdoptInsert`), because other requests can land between its statements:
   on Postgres, and on PGlite between `await`s. Each spec has a `Fixed`
   constant: `FALSE` is the code as it was; `TRUE` is the code now. The
   invariants are the game's rules, written down.
2. **TLC.** `specs/tla/check.sh` checks every spec in its fixed form;
   `--bugs` also checks the old forms, invariant by invariant, and each one
   finds its bug. Model sizes are small (2 or 3 players, devices or beaches,
   thresholds of 2), which is enough for these races, and each run takes
   seconds to minutes.
3. **Reference models.** `snacksModel.ts`, `editingModel.ts`,
   `neighborsModel.ts`, `copyModel.ts` and `bucksModel.ts` are the specs in TypeScript, `Fixed = TRUE`, one
   action at a time. Each method is one TLA+ action and returns the HTTP
   answer the server should give.
4. **Tests**, in three layers per machine:
   - *one transition at a time*: each action on its own, against the real
     routes;
   - *TLC counterexamples, replayed*: the exact interleaving TLC found,
     forced on the real server with the harness's gate (below). Each fails
     on the old code and passes on the fixed code;
   - *random walks*: seeded random action sequences (30 to 40 steps, 6 to 8
     seeds each), applied to the server and the model together; after every
     step the database state must equal the model's and the invariants must
     hold. A failure prints the seed and the trace, so it can be replayed.

### The harness (`server/test/stateMachines/harness.ts`)

- `createApp` on PGlite in-process, with a clock the test moves
  (`s.clock.now`), so snacks expire and days end on cue.
- **The gate.** `s.gate.pauseBefore(/sql/, { orTransaction })` stops the
  next request that reaches a matching statement outside a transaction (or,
  with `orTransaction`, a transaction about to start). The test runs other
  requests in the gap, then releases it. Statements inside a transaction
  never pause, because a transaction is atomic, so the same replay tests
  the old code (it pauses) and the fixed code (it runs straight through).
- `beachBytes(items)` builds a real saved beach holding those things.
- `rng(seed)` is a small seeded PRNG for the walks.

## Beach snacks and pets (`Snacks.tla`)

State: the owner's and a visitor's snacks, the shop pet crab, the snack out
on the sand, the befriending count, the pet, and who fed it today.

| Action | Route | Code |
| --- | --- | --- |
| `Toss` | `POST /animals/feed` | `consumeTreat`, `recordWildFeed` or `feedBeachPet`, `recordSnackOut` (one transaction, beach lock) |
| `PickUp` | `POST /animals/feed/return` | `returnSnack` (one transaction, beach lock) |
| `Eaten` | time passes (`SNACK_OUT_MS`) | `returnSnack`'s `tossed_at > now - SNACK_OUT_MS` |
| `AdoptCheck`, `AdoptInsert` | `POST /pet/adopt {mode: befriend}` | `adoptPet` |
| `ShopConsume`, `ShopInsert` | `POST /pet/adopt {mode: shop}` | `adoptPet` (`consumeItem`, insert, refund on a clash) |
| `VisitCheck`, `VisitFeed` | `POST /beaches/:code/pet/feed` | `visitorFeedPet` (`hasVisitorFedToday`, then `feedBeachPet`) |

Invariants: `SnacksConserved` (every snack is in the bag, on the sand or
eaten), `ProgressMatches` (the befriending count is the wild feeds still
counting), `BefriendedFairly` (a befriended crab took the full threshold of
feeds that were never taken back), `OneFreeFeedADay`, `PetItemConserved`.

## Editing beaches (`BeachEditing.tla`)

State: whose edit token is current, each beach's epoch and how many of a
bag item it holds, the epoch each device loaded, and saves and restores in
flight.

| Action | Route | Code |
| --- | --- | --- |
| `Claim` | `POST /edit-session` | replaces the token in a transaction holding the same player row lock as saves and restores |
| `Load` | `GET /beaches/mine/:id/sand` | `X-Beach-Epoch` in the reply |
| `SaveStart` .. `SaveUpd` / `SaveAtomic` | `PUT /beaches/mine/:id/sand` | `saveBeach`: `requireEditToken`, `overBag`, the `UPDATE ... WHERE epoch <= $seen`, now inside `asEditor` |
| `RestoreStart` .. `RestoreFitWrite` / `RestoreAtomic` | `POST /beaches/mine/:id/restore` | `requireEditToken`, `oneAtATime`, `fitOf`, the `UPDATE ... epoch + 1`, now inside `asEditor` |

Invariants: `WithinBag` (never more placed across all beaches than owned),
`OnlyEditorWrites` (only the current token's device changes a beach),
`RestoreKept` (a save from before a restore never overwrites it).

## Neighbor links (`Neighbors.tla`)

State: link rows `<<beach, side, neighbor>>` and requests `<<from, side, to>>`.

| Action | Route | Code |
| --- | --- | --- |
| `Ask` | `PUT /neighbors/:side` | the checks, then `link()` (their request the other way) or a request |
| `AcceptCheck`, `AcceptLink` | `POST /neighbors/requests/:code/accept` | the side check, then `link()` |
| `Decline` | `DELETE /neighbors/requests/:code` | |
| `MoveAway` | `DELETE /neighbors/:side` | both rows of the link, and your own request for that side |

Invariants: `Mutual`, `OnePerSide`, `LinkedOnce` (two beaches are never
neighbors on both sides of each other), `NoSelf`.

## Copying a beach (`BeachCopy.tla`)

[COPY_BEACH.md](COPY_BEACH.md). State: the copier's
bag and beaches, the source's version, whether it's public and what it
holds, and each copy request's step, target, mode and pinned version.

| Action | Route | Code |
| --- | --- | --- |
| `CopyStart` | `GET /beaches/:code/copy-fit`, then Copy | the app pins the previewed `version` |
| `CopyRead` .. `CopyWrite` / `CopyAtomic` | `POST /beaches/mine/copy` | `oneAtATime` + `asEditor`; both beach rows locked in id order (target `FOR NO KEY UPDATE`, source `FOR SHARE`); `fitOf`, the allowance, `dropMissing`, then `writeOnto` (shared with restore) |
| `SourceEdit`, `SourceShore` | the owner's save, `PATCH ... { onShore }`, an admin hide | |
| `Buy` | a store grant | |
| `Save` | the copier's other device saving | `saveBeach` |

Invariants: `WithinBag`, `WithinAllowance`, `CopiedWhatSeen`,
`NoCopyOffShore`, `NothingOffBeach`. The three-statement form breaks the
first, second and fourth; the design (one transaction) passes.

## Beech bucks and trade-ins (`SandBucks.tla`)

[BEECH_BUCKS.md](BEECH_BUCKS.md). State: the balance and debt, the bag's units
by trade-in value, what's on the beaches, packs bought, and each trade-in's
step.

| Action | Route | Code |
| --- | --- | --- |
| `BuyPack` | `POST /store/purchase`, the Xsolla webhook, `POST /store/steam/finalize`, gift card redeem | `grantPurchase` / `creditBalance` (`server/src/bucksDb.ts`) |
| `RefundPack` | store refund notifications, the Steam refund sync | `revokeStorePurchase` → `revokeGrant` / `clawBack` |
| `Spend` | `POST /store/buy`, `POST /store/credit-purchase` | `buyWithBucks`: one `claimCreditPurchase` statement |
| `FreeGrant` | claw, vending, dig finds, rewards, gifts in | the existing grants (`unit_cents` NULL = list value) |
| `GiftOut` | `POST /gifts` | `giveOne` (moves `unit_cents`) |
| `Save` | `PUT /beaches/mine/:id/sand` | `saveBeach` |
| `TradeCheck` .. `TradeWrite` / `TradeAtomic` | `POST /bag/trade-in` | one transaction under `withPlayerWriteLock` |
| `BonusIn` | `POST /referrals/claim` | `creditBalance(..., 'invite_bonus')` in the claim's transaction |

Invariants: `ValueConserved`, `NoPhantomUnits`, `NeverTradePlaced`,
`NoNegative`. The two-statement trade-in breaks `NoPhantomUnits` and
`NeverTradePlaced`; both are replayed in `bucks.test.ts`.

## Invite bonuses (`Invites.tla`)

[INVITES_GUIDE.md](INVITES_GUIDE.md). State: who has claimed, the
inviter's rewarded ranks, each friend's and the inviter's bonus bucks, and
each claim's step (two devices per friend).

| Action | Route | Code |
| --- | --- | --- |
| `ClaimRead` .. `ClaimWrite` / `ClaimAtomic` | `POST /referrals/claim` | one transaction: the referral (unique per invitee), its rank (unique per inviter, MAX + 1 up to the cap, retried on a clash) and both credits |

Invariants: `OneBonusEach`, `CapHolds`, `InviterPaid`. The two-statement
claim breaks `OneBonusEach` and `CapHolds`; `invites.test.ts` replays two
devices at once and random-walks `invitesModel.ts`.

## Piers (`Piers.tla`)

[Piers](PIERS.md). State: the beaches and their direct links, how many
piers the player owns, and how many attachments each beach holds. The pier
is a bag unit bought with beech bucks (`Buy`); attachments are counted
against what's owned.

| Action | Route | Atomic step |
| --- | --- | --- |
| `Buy` | `POST /store/buy`, `POST /store/credit-purchase` (`item_pier`) | `buyWithBucks`, as in `SandBucks` |
| `GiveAway` | `POST /bag/trade-in`, `POST /gifts`, visitor gifts | one transaction under the player's lock; `itemsElsewhere` counts `beach_piers` rows as placed, and `giveOne` refuses a pier unless one is free |
| `Land` | `PUT /beaches/mine/:id/pier` | `asEditor` (the player's lock and the edit token), then the beach row `FOR NO KEY UPDATE` and its links and their beaches `FOR SHARE`, the vacancy and bag checks, and the insert. The primary key on `beach_id` keeps one per beach |
| `Lift` | `DELETE /beaches/mine/:id/pier` | `asEditor`, one `DELETE` |
| `Link`, `Unlink`, `DeleteBeach` | the existing neighbor routes and `DELETE /beaches/mine/:id` | unchanged: an unlink or a deletion of a beach next to the one being placed waits on `Land`'s `FOR SHARE` row locks. Deleting a beach cascades its attachment (the pier is back in the bag). Visibility is derived (`PIER_SHOWN`), never stored |

The design passes with 1,532 distinct states (`PaidAttachment`,
`OnePerBeach`, `NoOrphan`, `PlacementWasEligible`). The other form, which
checks eligibility before the write's transaction and lets a pier leave
the bag without counting placed ones, breaks `PlacementWasEligible` (an
unlink between `LandCheck` and `Land`) and `PaidAttachment` (a trade-in of
the placed pier). Both are replayed in `piers.test.ts` and fail against
that form. Run `specs/tla/check.sh --bugs Piers` to see them.

## Inland sections (`InlandSections.tla`)

[Inland sections](INLAND_SECTIONS.md). State: the player's beaches, each
one's layout (the section types in its rows, front first) and revision, how
many of each type the player owns, and what each of two devices last read.
A section is a bag unit bought with beech bucks (`Buy`); placed rows are
counted against what's owned, per type, across every beach.

| Action | Route | Atomic step |
| --- | --- | --- |
| `Buy` | `POST /store/buy`, `POST /store/credit-purchase` (`item_section_*`) | `buyWithBucks`, as in `SandBucks` |
| `GiveAway` | `POST /bag/trade-in`, `POST /gifts`, visitor gifts | one transaction under the player's lock; `itemsElsewhere` counts `beach_sections` rows as placed, and `giveOne` refuses a section unless one of that type is free |
| `Read` | `GET /beaches/mine` (`sections`, `sectionsRev` per beach) | one read |
| `Write` | `PUT /beaches/mine/:id/sections` `{rows, rev}` | `asEditor` (the player's lock and the edit token), then the beach row `FOR NO KEY UPDATE`; the revision must match, the rows must be at most four and fit in what's owned counting every other beach; then the rows are replaced and `sections_rev` bumps, all in that transaction. Append, replace, reorder and return to the bag are all this one write |
| `DeleteBeach` | `DELETE /beaches/mine/:id` | unchanged: its rows cascade (the sections are back in the bag) |

Joins with neighbors are derived from the shore (same type, same row, a
direct link) and never stored, so they need no state. The design passes
with 60,530 distinct states (`PaidPlacement`, `RowsBound`, `NoOrphan`,
`NoLostUpdate`). The other form, which checks the bag and the rows before
the write's transaction and keeps no revision, breaks `PaidPlacement` (the
last copy placed on two beaches at once, or traded in during a placement)
and `NoLostUpdate` (two devices write from the same layout). All three are
replayed in `sections.test.ts`; the `NoLostUpdate` replay fails with the
revision check taken out. Run `specs/tla/check.sh --bugs InlandSections`
to see them.

## Push notifications (`Push.tla`)

One player, their devices and the push tick
([INBOX_NOTIFICATIONS.md](INBOX_NOTIFICATIONS.md), "Push";
`server/src/push.ts`). State: the inbox rows (pushed or not, read or not),
blocks, muted kinds, sessions and subscriptions, subscriptions the push
service has forgotten, the hour and the hour of the last push, and the
player's push lock. Two senders can run at once (two Cloud Run instances,
or Cloud Scheduler and the server's own timer).

| Action | Route or job | Code |
| --- | --- | --- |
| `Arrive` | every route that writes an inbox row | the row's own statement (unchanged); `pushed_at` starts empty |
| `Read` | `POST /inbox/read` | one `UPDATE` that waits if delivery has locked the inbox row |
| `Block` | `PUT /blocks/:code` | one transaction: `lockPush` (the `push_state` row `FOR UPDATE`), then the insert |
| `Mute`, `Unmute` | `PUT /notify-prefs` | take `lockPush` before reading preferences and applying the requested fields |
| `Subscribe` | `POST /push/subscribe` | one upsert on the endpoint; needs no lock |
| `Unsubscribe` | `DELETE /push/subscribe` | one `DELETE` that waits for the sender's subscription row lock |
| `SignOut` | `POST /auth/logout`, or session expiry | logout cascades to the subscription and waits for its row lock. An elapsed session is ineligible even while its row still exists. |
| `Expire` | the push service | — (the next send answers 404/410) |
| `Claim` | `pushTick` (`POST /push/tick` or the timer) | `pushPlayer` marks due rows and reserves the hour under `lockPush`, then commits before contacting providers |
| `BeginSend`, `Deliver`, `Finish` | the same tick | a second transaction retakes the push lock, locks subscription and inbox rows, and rechecks eligibility before sending. A 404/410 deletes that subscription. |
| `Crash` | worker exit or send transaction rollback | discard the in-memory batch. The committed claim survives and subsequent ticks skip it. |

Invariants: `AtMostOnce` (a row reaches each device at most once),
`OnePerHour`, `NotAfterGone` (nothing after an unsubscribe or sign-out has
returned), `NeverBlocked`, `NeverMuted`, `OnlyPushKinds` (never a star),
`NotInQuietHours`, `SubsHaveSessions`.

The unlocked form (read what's due, send, then write it down; nothing
waits) breaks the first five: two senders push the same rows twice in one
hour, and an unsubscribe, sign-out, block or mute that lands mid-send
returns before a push it should have stopped. The fixed model uses symmetry
reduction for the interchangeable actors, devices, and workers. The tests hold
sends open at a fake provider to replay those races and inject a rollback after provider
acceptance to verify that later ticks skip the committed claim. A crash after
claiming can drop the notification. The inbox entry remains available.

## Suspending a sender's notes (`NoteSuspension.tla`)

One sender, their notes and the admin
([INBOX_NOTIFICATIONS.md](INBOX_NOTIFICATIONS.md), "Reports"). State:
`users.notes_suspended_until`, the sender's notes (hidden or shown) and
visits between their check and their insert.

| Action | Route or job | Code |
| --- | --- | --- |
| `VisitCheck`, `VisitInsert` | `POST /beaches/:code/visit` with a note | one transaction: `SELECT notes_suspended_until … FOR NO KEY UPDATE` on the sender's row, refuse (403) if it's in the future, then the note's insert |
| `Suspend(hide)` | `POST /api/senders/:id/suspend-notes { days, hide }` (admin) | one transaction: `UPDATE users SET notes_suspended_until` (takes the sender's row lock), then with `hide` `UPDATE notes SET hidden_at` for every shown note of theirs, then the audit row |
| `Lift` | `POST /api/senders/:id/lift-notes` (admin), or the time running out | one `UPDATE users` (and its audit row) |
| `HideOne` | `POST /api/reports/:id/resolve { action: hide }` | one `UPDATE notes` (unchanged) |

Invariants: `NoNoteWhileSuspended` (no note is accepted while its sender is
suspended) and `SweptStaysClean` (after "suspend and hide their notes",
none of theirs shows until it's lifted). The other form reads the
suspension before the visit's transaction: a suspension that lands between
the read and the insert lets one more note through, shown, and breaks both.
`server/test/stateMachines/noteSuspension.test.ts` replays that (paused
before the visit's transaction), runs transitions and seeded random walks
against `noteSuspensionModel.ts`.

## Bugs found (2026-11-25), all fixed

Each was found by TLC, then reproduced on the real server by a replay test
that fails before the fix.

1. **A crab befriended for less** (`BefriendedFairly`). `adoptPet` read the
   befriending count, then inserted the pet. A snack picked up in between
   came back to the bag, and the crab moved in anyway with one feed short.
   Fix: the adopt is one transaction holding the beach lock, like a toss
   and a pickup.
2. **Two free visitor feeds** (`OneFreeFeedADay`). Two feed requests at once
   both saw "not fed today". Fix: `visitorFeedPet` is one transaction
   holding the beach lock.
3. **A fenced device's save landing** (`OnlyEditorWrites`). The save checked
   the edit token, then took snapshots, then wrote. A takeover in between
   didn't stop the write. Fix: `asEditor` re-checks the token in the same
   transaction as the write. Taking over, saving, and restoring all hold
   the same player row lock. A PostgreSQL test checks that a takeover waits
   for that lock.
4. **More placed than owned** (`WithinBag`). Two saves at once (the app
   flushes several beaches together) each passed the bag check before
   either wrote. With one lighthouse owned, both beaches got one. Fix: the
   bag is re-checked inside `asEditor`, so one player's saves and restores
   go one at a time.
5. **Neighbors on both sides** (`LinkedOnce`). An accept checked the side,
   and meanwhile a crossing ask linked the same two beaches the other way
   round; then the accept linked them again. Nothing in the table's keys
   stops it. Fix: `link()` is one transaction holding both beaches' locks
   (in id order), refusing a second link between the same two beaches.

## Limits

- The gate can only pause between statements that run outside a
  transaction. A race between two statements *inside* one transaction
  can't happen on PGlite (one connection) and is the database's job on
  Postgres.
- The models count one bag item (the lighthouse) and one snack kind;
  the real checks are per item (proved separately in
  [VERIFICATION.md](VERIFICATION.md)).
- Midnight (UTC) for free feeds, shop purchases and inventory expiry aren't
  modelled.
- CI's `Specs` workflow (`.github/workflows/specs.yml`) runs
  `specs/tla/check.sh` (every spec's fixed form, about 8 minutes) when
  `specs/` or `server/src/` changes; the TypeScript tests run in CI with
  the rest of the server suite. The `--bugs` forms are for local use.

## Model-first workflow

This is how new gameplay and features are built, and how existing ones
change (CLAUDE.md, "Model first"). The model comes before the code: it
decides what the code has to guarantee, which steps must be atomic, and
which tests are worth writing. An agent can also load the `model-first`
skill, which walks through the same steps.

### Does it need a model?

Yes, if the change adds or alters **state the server keeps that more than
one request can touch**: anything a player owns, spends, earns, places,
claims or unlocks; anything with a limit, a cooldown, a daily allowance or
a "first one wins"; anything two devices, two players, a webhook or a
timer can reach at the same time; anything that moves through stages
(requested, accepted, paid, refunded, expired...).

No, for rendering and visuals, sound, UI layout and copy, tuning constants
in `src/config.ts`, the guide and release notes, and pure functions with
no stored state (those get unit tests, or a LemmaScript proof:
[VERIFICATION.md](VERIFICATION.md)). The simulation (`src/sim/`) has its
own conservation and stability tests (CLAUDE.md). When in doubt, write the
model: a small one is an hour, and a race found later costs more. Say in
the change which it was ("no model: rendering only").

### Steps

1. **Find the machine.** Extending an existing one (snacks, editing,
   neighbors)? Change its spec. A new one? Start a new
   `specs/tla/<Name>.tla` from the skeleton below. One spec per machine,
   small enough to read in one sitting.
2. **Write the state.** The variables are what the database holds for it
   (tables and columns), plus what each client believes (a token, an
   epoch). Keep values tiny: 2 or 3 players, devices or beaches, counts up
   to 2, thresholds of 2. TLC finds races with small numbers.
3. **Write the rules as invariants first,** in the game's words: "every
   snack is in the bag, on the sand or eaten", "never more placed than
   owned", "one free feed a day". Ghost variables (not in the database)
   are fine for stating them. These become the tests' assertions.
4. **Write the actions,** one per request or event (route, webhook,
   timer), **split at every separate statement** that another request
   could land between: a read then a write is two steps; one SQL statement
   or one transaction holding a lock is one step. Add a `Fixed` (or
   design-choice) constant when there's more than one way to build it.
5. **Run TLC** (`specs/tla/check.sh <Name>`, or with `--bugs` for the
   alternative forms). Every counterexample is a design bug: change the
   design (make steps atomic, add a lock, add a condition to the write,
   change the rule) and rerun until the version you'll build passes.
   Commit the spec, both configs and the result.
6. **Let the model decide the code.** For each action write down its
   route and function, and how its steps become code: an atomic action is
   one transaction holding a named lock (the beach row, the player row, or
   both in id order), or one SQL statement whose `WHERE` carries the check.
   Put the table in the machine's section of this file before writing the
   code.
7. **Let the model decide the tests,** in `server/test/stateMachines/`:
   - a reference model (`<name>Model.ts`): the spec in TypeScript, the
     version you're building, one method per action returning the HTTP
     answer the server should give;
   - transition tests: each action on its own, including its refusals;
   - replays: every counterexample TLC found against the other forms,
     forced on the server with `s.gate.pauseBefore(...)`. Pause at a
     statement that runs outside a transaction in every form (or use
     `orTransaction`), so the same replay shows the bug and its fix;
   - a random walk: seeded sequences of actions applied to the server and
     the model together, comparing the database with the model after every
     step and checking the invariants.
8. **Build the code** until the tests pass. If a test shows the server
   and the model disagree, decide which is wrong. Fix the code, or change
   the spec and rerun TLC; never loosen an invariant just to get green.
9. **Finish:** STATUS.md and BACKLOG.md as usual, the guide and release
   notes if players notice, and this file's table for the machine.

Changing a modelled route later follows the same order: spec, TLC, model,
tests, code.

### Spec skeleton

```tla
------------------------------ MODULE Name ------------------------------
(* What the machine is, which routes it covers (docs/STATE_MACHINES.md). *)
EXTENDS Integers

CONSTANTS Requests, Max, Fixed     \* concurrent requests; a bound; Fixed: the design choice

VARIABLES
    held,       \* what the database holds (here: how many a player has claimed)
    pc,         \* [Requests -> "idle" | "checked"]: a request between two statements
    granted     \* ghost: how many were handed out (for the invariants)

vars == <<held, pc, granted>>

Init == /\ held = 0 /\ pc = [r \in Requests |-> "idle"] /\ granted = 0

Give == /\ held' = held + 1 /\ granted' = granted + 1

(* POST /claim: check the limit, then write. Two steps unless Fixed. *)
Check(r) ==
    /\ pc[r] = "idle" /\ held < Max
    /\ IF Fixed
         THEN Give /\ UNCHANGED pc                  \* one transaction holding the lock
         ELSE pc' = [pc EXCEPT ![r] = "checked"] /\ UNCHANGED <<held, granted>>
Write(r) ==
    /\ pc[r] = "checked"
    /\ pc' = [pc EXCEPT ![r] = "idle"]
    /\ Give

Next == \E r \in Requests : Check(r) \/ Write(r)
Spec == Init /\ [][Next]_vars

TypeOK == held \in 0..Max + 2
WithinMax == held <= Max            \* the game's rule: never more than Max
=============================================================================
```

With `Name.cfg` (`Requests = {r1, r2}`, `Max = 1`, `Fixed = FALSE`) TLC
breaks `WithinMax` in 5 states: both requests check, then both write. With
`NameFixed.cfg` (`Fixed = TRUE`) it passes. That pair (the race, then the
design without it) is the shape of every spec here. `check.sh` runs
`NameFixed.cfg` always, and each invariant of `Name.cfg` on its own with
`--bugs`. In `Name.cfg`, list only the invariants you expect the other form
to break, or that are quick to exhaust, and add the spec to `check.sh`'s
default list.

### Checklist for a change

- [ ] Model needed? If not, the change says why.
- [ ] Spec written or updated, invariants in the game's words.
- [ ] `specs/tla/check.sh <Name>` passes; counterexamples of the other
      forms are understood and replayed in tests.
- [ ] This file maps every action to its route and function.
- [ ] Reference model, transition tests, replays and a random walk in
      `server/test/stateMachines/`; `npm run test:state` passes.
- [ ] The code makes each atomic action one transaction (or statement),
      with the lock the spec assumes.
