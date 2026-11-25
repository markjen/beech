# Game state machines: TLA+ models and tests

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
| `Claim` | `POST /edit-session` | a new token replaces the old one |
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
   transaction as the write, holding the player's row lock.
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
- TLC isn't in CI (it needs Java and minutes per spec). Run
  `specs/tla/check.sh` after changing a modelled route; the TypeScript
  tests run in CI with the rest of the server suite.

## Adding to it

Changing a modelled route: update its spec and model first, rerun
`specs/tla/check.sh`, then make the tests agree. Modelling a new machine:
write the spec with the handler's real steps (separate statements are
separate steps), find the invariants the game promises, run TLC on the
current code, then add a reference model, transition tests, replays of
whatever TLC finds, and a random walk.
