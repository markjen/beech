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
| Editing beaches | `BeachEditing.tla` | `editing.test.ts` | a fenced device overwriting the editor, more placed than owned, a restore overwritten |
| Neighbor links | `Neighbors.tla` | `neighbors.test.ts` | one-sided links, two neighbors on one side, two beaches linked on both sides |
| Piers (designed) | `Piers.tla` | Planned | a pier landed after an unlink, duplicate attachments, an attachment surviving a refund |

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
3. **Reference models.** `snacksModel.ts`, `editingModel.ts` and
   `neighborsModel.ts` are the specs in TypeScript, `Fixed = TRUE`, one
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

## Piers (`Piers.tla`)

Proposed routes for [Piers](PIERS.md). State includes direct links, the
phase of each purchase and the beach each purchase is attached to.

| Action | Route | Proposed atomic step |
| --- | --- | --- |
| `Begin` | `POST /beaches/mine/:id/pier/checkout` | Under the beach owner's account lock, check that the site qualifies and is vacant, then issue an account-bound checkout authorization. Start the provider flow after the transaction. |
| `Settle`, `Close` | Existing store confirmation, cancellation and refund routes | Deduplicate by provider order or receipt. Under the buyer's account lock, grant the entitlement once or close it and clear its attachment. An authoritative refund or cancellation is terminal even if a confirmation arrives later. |
| `Land` | `PUT /beaches/mine/:id/pier` | Use `asEditor` to hold the owner's account lock while checking links, site vacancy and entitlement, then insert the attachment. Unique keys on beach and entitlement prevent double placement. |
| `Lift` | `DELETE /beaches/mine/:id/pier` | Use `asEditor` to remove the specified attachment and free the entitlement. |
| `Link`, `Unlink`, `DeleteBeach` | Existing neighbor link, unlink and beach deletion routes, including admin writes | Hold the affected owner account locks before changing the graph, taking multiple account locks in ID order and before beach row locks. Derive pier visibility from the new graph. Beach deletion removes the attachment and leaves the entitlement in the bag. |

The selected model explores 6,012 distinct states. The alternate model
finds a stale placement after a supporting link is removed between
`LandCheck` and `Land`. Check and write under the same lock to enforce
`PlacementWasEligible`. The model also checks `PaidAttachment` and
`OnePerBeach`. Run `specs/tla/check.sh --bugs Piers` to reproduce both runs.

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
