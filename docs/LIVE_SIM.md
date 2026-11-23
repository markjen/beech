# Live beaches: the sea keeps working while you're away (design)

Status: being built (L1 and L2 done 2026-11-23, see STATUS.md). The owner's decisions are settled (end of this
page). Milestones L1–L5 are at the end and in [BACKLOG.md](BACKLOG.md).

## Today

- The simulation runs only in the owner's app (`sim.worker.ts` ticks
  `BeachSim.step(1/30)`), and only while that beach is open.
- `BeachSync` saves it after strokes, every 90 s while waves change it, and
  when the app goes to the background. Last write wins, guarded by the
  beach's `epoch` (a restore bumps it).
- Everyone else (neighbors, shore walkers, visitors, the leaderboard) sees
  the last save. Their own app draws water over it, but that water doesn't
  move the sand.
- While nobody has it open, nothing happens to a beach. When the owner comes
  back the real tide snaps to now (`setSea` snaps on its first call), but the
  sand is exactly as it was left.
- Owned items never leave a beach: `BeachObjects` clamps every object inside
  the grid. Only `wild` strays are taken back by the sea.

## What we want

1. **The sea works while you're away.** Tides rise and fall at the beach's
   real place, and the castle you left at the waterline is slumped, breached
   or gone when you come back. Realistic destruction is fine, and wanted: it
   gives a reason to come back and look.
2. **Nothing you own is lost.** An item the sea takes goes back into your
   bag. People who want to keep a build use checkpoints
   ([CHECKPOINTS.md](CHECKPOINTS.md)) and restore it later.
3. **Everyone sees the same beach.** A visitor and the owner looking at the
   same beach at the same time see the same sand and the same things on it,
   give or take a few seconds.
4. **It stays cheap.** No server process per beach, and no cost for beaches
   nobody looks at.

## The model in one picture

```
            owner online                          owner offline
   ┌──────────────────────────────┐     ┌───────────────────────────────┐
   │ owner's app: full sim, 30 Hz │     │ nothing runs                  │
   │  holds the lease             │     │                               │
   │  saves sand + objects ~5 s   │     │ first read after a gap:       │
   └──────────────┬───────────────┘     │  server catch-up (coarse,     │
                  │ PUT /api/beach      │  bounded), store, bump epoch  │
                  ▼                     └───────────────┬───────────────┘
            ┌──────────┐                                │
            │ beach row│◀───────────────────────────────┘
            └────┬─────┘
                 │ GET / SSE
                 ▼
   viewers: local water for looks only; sand and objects follow the row
```

### 1. Slow state is shared, fast state is local

- **Slow, shared:** sand heights and objects (position, buried depth, gone).
  One place decides them, the **authority**, and everyone else copies them.
- **Fast, local:** water depth, waves, swash, foam. Every app runs its own
  for the look, as viewers already do. Nobody's water needs to match anyone
  else's.

This keeps sync small: a few-second stream of sand and objects (a few KB to
~100 KB a save, much less as a diff), never 30 Hz water fields.

We do **not** run the same simulation in lockstep on every device. The sim is
seeded, but `Math.sin`/`Math.exp` are not guaranteed bit-identical across
JavaScript engines, so two devices would drift apart. One authority sending
snapshots avoids the whole problem.

### 2. Owner online: the owner's app is the authority

- **One authority per beach: a lease.** A beach can be open on several of
  the owner's devices at once (MULTI_BEACH.md), so the server hands out a
  lease: `sim_lease(beach_id, holder, expires_at)`, 30 s, renewed by a
  heartbeat every 10 s. Only the holder saves sand. Another device of the
  owner's is a viewer until the lease lapses, then takes it.
  - The device you're **touching** should win: a stroke on a device that
    isn't the holder asks for the lease (`force`), and the old holder drops to
    viewer on its next heartbeat. Its unsaved strokes are lost; that's why the
    holder saves soon after each stroke already.
- **Saves get more frequent** while anyone else is watching: every 5 s
  (instead of 90 s) when the server says the beach has viewers (the heartbeat
  reply carries a viewer count). Alone, keep today's rhythm.
- **Every save records `simulated_until = now`**: the authority has
  simulated the beach up to the moment of the save.
- Viewers never write sand. That rule doesn't change: only the owner can
  write their beach.

### 3. Owner offline: catch up on read, on the server

When anyone reads a beach (the owner, a neighbor, a visitor, the shore;
owner's decision 3) and
`now − simulated_until > CATCHUP_MIN_GAP` (10 min), and no lease is live,
the server catches it up before or while serving it:

1. Take a per-beach lock (`pg_try_advisory_xact_lock(beach_id)`). If another
   request holds it, serve the stored beach now; the caught-up one follows
   (see "Serving" below).
2. If the gap is over `CATCHUP.tideCheckpointGapH` (12 h), keep the beach as
   it is now as its **"Before the tide"** checkpoint (section 6), in the
   same transaction.
3. Run `catchUp(beach, from = simulated_until, to = now)` (section 4).
4. Write sand, objects, `items` (recounted), `simulated_until = to`,
   `version + 1`, `epoch + 1`, **only if** `version` is still the one read
   (compare-and-set). A lost race just means someone else already caught it
   up; use theirs.
5. Record what happened in `beach_events` (section 6) and return the lost
   items to the bag (section 5).

**Serving.** The first viewer shouldn't wait for the catch-up:

- If the catch-up is small (gap under ~6 h), run it in the request. The
  budget is ~150 ms of CPU (section 4).
- Otherwise, serve the stored beach with `X-Beach-Catching-Up: 1`, run it
  right after, and let the app fetch again (or get it on the SSE stream). The
  app eases the sand to the new heights over a couple of seconds, so the
  change reads as "the tide did this" rather than a pop.

The `epoch` bump does what it does for a restore today: an owner device that
still holds older sand gets 409 `restored` on its next save and reloads. So
an owner who comes back always sees the caught-up beach and can't overwrite it
with what was cached on the device.

**Why not let a viewer's app run it?** Anyone could then write any sand into
anyone's beach. The server does it, using the same sim code: `src/sim/` has no
DOM or Babylon imports (a repo rule), and `scripts/perf-sim.mjs` already runs
it in Node. The server is a separate package and doesn't import `src/`
today, so it gets the catch-up code as an esbuild bundle at build time, the
way `scripts/beach-file.mjs` bundles `beachFile.ts`. One source, no copy.

**Beaches nobody looks at cost nothing.** A beach unvisited for a month is
caught up once, on the next read, with the gap capped (section 4).

**Snapshots on the shore.** The shore and neighbor endpoints serve many
beaches at once. They don't trigger catch-ups inline; they return what's
stored, and queue a catch-up for any beach in view that's past the gap. The
queue is a small in-process worker pool per instance, with at most 2 at a
time. That's enough because only the beaches someone walks past need it. The
next poll (every 30 s) shows them caught up.

### 4. The catch-up model: coarse and bounded

Replaying the real sim is out: a day is ~2.6 million ticks at 30 Hz. The
catch-up is a separate, cheap model of what hours of tides do to sand,
`src/sim/catchup.ts`, plain TypeScript next to the sim and tested the same
way.

**Inputs:** the sand (delta from rest, as saved), the objects, the beach's
place (tide constituents from `tideStations.json`, wave scale from
`locations.ts`), `from`, `to`.

**Tide history.** Tides are predictable offline (`src/world/tides.ts`,
harmonic, a few cm accurate). The model splits the gap into **half tide
cycles** (low to high, high to low, from `nextExtremes`), about 4 a day, and
maps each one's levels to the diorama with `diorama()`, exactly as the live
app does. Work is scaled by each step's length and the water's reach, not by
wall-clock time.

**What each step does** (per half cycle, as built). It copies the two
things the live sim does to sand over minutes to hours:

- **Wet time per cell:** the time the level (a sine from that half cycle's
  low to its high) plus the swash run-up (`CATCHUP.runup × waves`) is above
  the cell, sampled at three points of the run-up so the swash band counts
  part-time. Waves climb what's built in the swash, so a mound is wetted as
  if it were `CATCHUP.overtop` (0.4) of its height.
- **Healing and wet slumping, taking turns** (`rounds` × `slumpPasses`): wet
  cells heal toward the rest profile with the live sim's own time constant
  (`EROSION.healingTime`, 150 s), and sand slumps at the saturated angle of
  repose where wet, dry angle elsewhere (the live sim's `slump`). Healing
  isn't mass-conserving in the live sim either: the sea smooths things away.
- **Only rows that differ from the rest beach** (plus a margin) are worked
  on: sand at rest stays at rest, so the sea floor costs nothing.
- **Dry sand** above the highest water of the gap is untouched, as in the
  live sim. A castle built high up the beach survives a week; one at the
  waterline doesn't.
- Checked against the live sim (`tests/catchup.test.ts`): two minutes at a
  still tide on a castle at the waterline and one a metre below, the live
  sim and the catch-up both knock the top off, the catch-up a little more
  gently (peak within 0.15 m); a castle 3 m up the beach is untouched by
  both.

**Objects** follow simple rules per step:

- **Rocks, flags, deckchairs, lighthouses** (fixed): stay. If the sand under
  them is gone they sit on the floor; if sand piled over them past their
  height, they're **buried** (see below).
- **Light things** (driftwood, bottles) in water deeper than their draft at
  that step: moved along the shore by the step's mean drift (a seeded random
  walk scaled by waves), then stranded at the step's waterline when the tide
  falls.
- **Shells and other rollers:** rolled downslope a little in swash cells.
- **Lost to the sea** (section 5): an owned floater that spent more than
  `CATCHUP.lostFloatH` (2 h) in the sea in all, or a roller more than
  `lostRollH` (6 h).
- **The sea brings things in:** after a gap with at least one high tide,
  the old strays are gone and up to `MAX_WILD` fresh ones (driftwood,
  shells, sea glass) lie along the last high-water line.
  (Burial isn't modelled: objects ride on the sand surface, live and in the
  catch-up.)

**Bounds.**

- Gap capped at **14 days** by default, configurable (owner's decision 1):
  `CATCHUP.maxGapDays` in `src/config.ts`, overridable on the server with the
  `CATCHUP_MAX_GAP_DAYS` env var (Cloud Run) so it can change without a
  release. Past the cap the beach is already "flattened by the sea" for
  anything the water reaches; more time changes little. The gap's start is
  moved up to `to − cap`, so the tides used are still the most recent ones.
  The perf budget is set at the default; raising the cap a lot means raising
  `catchup14d` too.
- Measured (`npm run perf`, budget `sim.<tier>.catchup14dMs` = 150): 14
  days of Brighton's tides with four castles takes 30–45 ms on every grid;
  a whole beach dug up everywhere is about 200 ms on the largest. Long gaps
  run after the response anyway (section 3).
- Deterministic for a given input (seeded from beach id and `from`), so a
  retry gives the same answer.

**Live sim on return.** When the owner opens the beach, the live sim starts
from the caught-up sand at the real tide, as today. No catch-up runs on the
device.

### 5. What the sea takes goes back in your bag

Today nothing you own can leave a beach. This adds one rule, used by the live
sim and the catch-up alike:

- An **owned** (not `wild`) item is **lost to the sea** when:
  - it's carried (afloat or rolled) to within `LOST_TO_SEA.edge` of the
    offshore edge while moving offshore (along the shore and landward
    everything stays clamped, and wild strays stay clamped everywhere), or
  - it's a floater that's been afloat for `LOST_FLOAT` (catch-up only; the
    live sim lets it drift out instead).
- Rocks, flags and other fixed things are never lost: they don't move.
- A lost item **leaves the beach and is back in the bag**. That needs no
  inventory write: the bag already shows "owned − placed across your
  beaches", and the server recounts `beach.items` from the objects on every
  save and catch-up. A free item (rock, driftwood, shell) just goes; it's
  free anyway.
- The live app shows a summary toast, counting rather than naming (owner's
  decision 4): "The sea took 2 things. They're back in your bag." Losses
  within a few seconds share one toast.
- Catch-up losses go into `beach_events` and show in "while you were away".
- Undo doesn't bring a lost item back (it isn't a stroke); the bag does.

`wild` strays keep their own rule (the oldest goes when there are more than
6) and are never credited.

### 6. "While you were away"

The catch-up records a short summary per run:

```sql
CREATE TABLE beach_events (
  id BIGSERIAL PRIMARY KEY,
  beach_id BIGINT NOT NULL REFERENCES beach(id) ON DELETE CASCADE,
  from_at BIGINT NOT NULL,         -- ms, the gap it covered
  to_at BIGINT NOT NULL,
  tides INT NOT NULL,              -- high tides in the gap
  sand_moved REAL NOT NULL,        -- m³
  lost INT NOT NULL DEFAULT 0,      -- owned things back in the bag
  checkpoint UUID REFERENCES checkpoints(id) ON DELETE SET NULL, -- "Before the tide"
  created_at BIGINT NOT NULL
);
CREATE INDEX beach_events_beach ON beach_events (beach_id, created_at);
```

Kept for 30 days (pruned on write). When the owner opens a beach whose
events they haven't seen, the app shows a small card:

> **While you were away** (2 days)
> 8 high tides · the sea took 3 things (back in your bag)
> [Put it back as it was]  [Keep]

A summary, not a list of items (owner's decision 4). Unseen events of the
same beach are merged into one card. "Last seen" is a per-beach
`owner_seen_at` column, set when the owner opens it.

**"Before the tide" checkpoint** (owner's decision 2). Before a catch-up of a
gap over `CATCHUP.tideCheckpointGapH` (12 h, configurable like the cap), the
server keeps the beach as it was as a checkpoint, in the same transaction:

- A new checkpoint kind, `tide`, named "Before the tide", one per beach
  (a new one replaces the old), with its own unique index like `auto`'s.
  "Before restoring" and "Before import" keep the `auto` slot; the two don't
  replace each other.
- It doesn't count toward the named-checkpoint limit, and, like `auto`, it
  is left out of the byte allowance, so it can never block a catch-up or
  make someone delete a checkpoint.
- **[Put it back as it was]** restores it (the usual restore, `drop-missing`
  mode). Things the sea took are back in the bag, so the restore puts them
  back on the beach if they're still free, and drops any that have since been
  placed elsewhere, saying so (the restore's existing fit rule). The restore
  makes its own "before restoring" copy, so even that can be undone.
- It also shows in settings → checkpoints like any other, and can be
  exported.
- Only gaps over 12 h make one: shorter ones change little, and a beach
  visited all day would otherwise churn it.

Schema (appended migration):

```sql
ALTER TABLE checkpoints DROP CONSTRAINT checkpoints_kind_check;
ALTER TABLE checkpoints ADD CONSTRAINT checkpoints_kind_check
  CHECK (kind IN ('named', 'auto', 'tide'));
CREATE UNIQUE INDEX checkpoints_one_tide ON checkpoints (from_beach) WHERE kind = 'tide';
```

(Check the actual constraint name in the migration before writing this.)

### 7. Viewers see it live

- **Transport:** start with polling, then SSE.
  - **First:** viewers of a beach whose lease is live poll
    `GET /api/beach/:code/sand?since=<version>` every 5 s (304 when
    unchanged). Cheap, works on Cloud Run as is.
  - **Then:** `GET /api/beach/:code/live` (SSE). Cloud Run allows long
    requests (up to 60 min; the client reconnects). Because instances don't
    share memory, a save notifies other instances with Postgres
    `LISTEN/NOTIFY` on `beach_saved`, and each instance fans out to its own
    SSE clients.
- **Applying it:** the viewer's worker gets the new sand and objects with
  `setSand`, eased over ~1 s (a `blend` flag on the message) so waves don't
  jump. Objects tween to their new places. Its own water keeps running.
- **Neighbors' beaches** on the shore use the same rule: the drawn ones
  (within 2) follow live, the rest stay snapshots.
- **Viewer count:** each viewer poll or stream counts as a viewer for 15 s;
  the lease heartbeat reply carries the count so the owner's app knows to
  save every 5 s.

### 8. Edge cases

| Case | What happens |
| --- | --- |
| Owner's app crashes mid-session | The lease lapses after 30 s; the next read catches up from the last save's `simulated_until` |
| Owner offline on one device, opens another | The new device reads (catch-up runs if needed), takes the lease |
| Old app (no lease, no `simulated_until`) | Its saves set `simulated_until = now` on the server side anyway; it never holds a lease, so a catch-up can run under it. The epoch bump makes it reload. Acceptable: old apps are already told to reload (backlog "Reload stale tabs") |
| Restore from a checkpoint | Sets `simulated_until = now`: a restored beach starts fresh, it isn't eroded for the time the checkpoint sat |
| Beach moved to another place | The catch-up uses the place at read time; good enough |
| Sandbox build (no accounts) | Unchanged: no server, no catch-up. The idea "keep the sandbox beach on the device" could run the same `catchUp` on load later, with no network |
| Off-shore beaches (`on_shore = false`) | Same rules; they're just read less |

## API and schema changes

Schema (appended migrations, never edits):

- `beach.simulated_until BIGINT` (ms; null = never, treated as `updated_at`),
  `beach.owner_seen_at BIGINT`.
- `sim_lease (beach_id BIGINT PRIMARY KEY REFERENCES beach(id) ON DELETE
  CASCADE, holder TEXT NOT NULL, expires_at BIGINT NOT NULL)`. `holder` is a
  random per-tab id the app makes at start.
- `beach_events` and the `tide` checkpoint kind (section 6).

Endpoints:

| Endpoint | Change |
| --- | --- |
| `GET /api/beach`, `/api/neighbors/:side/beach`, visits | May run a catch-up first; new headers `X-Beach-Simulated-Until`, `X-Beach-Catching-Up` |
| `PUT /api/beach` | Requires the lease when one is live and held by someone else (409 `lease`); sets `simulated_until`; recounts items (as now) |
| `POST /api/beaches/mine/:id/lease { holder, force? }` | Take or renew; `{ ok, expiresAt, viewers }`, or 409 with who holds it |
| `DELETE /api/beaches/mine/:id/lease` | Give it up (app to background) |
| `GET /api/beach/:code/sand?since=` | Viewers' poll; 304 when unchanged |
| `GET /api/beach/:code/live` | SSE stream of saves (L5) |
| `GET /api/beaches/mine/:id/away` | Unseen `beach_events`; `POST …/away/seen` sets `owner_seen_at` |

## Performance and cost

- Catch-up: bounded at ~150 ms CPU per beach, and at most once per 10 min per
  beach. A beach read all day costs at most 144 catch-ups, each of a short gap
  (part of one half cycle): negligible.
- Shore walking queues catch-ups only for beaches in view, two at a time.
- Saves at 5 s only while someone watches. A 100 KB beach at 5 s is 20 KB/s
  up for the owner during a visit; a diff encoding (only changed rows) is a
  follow-up if that shows up in `npm run perf` or Cloud Run egress.
- New perf budget lines: `catchup14d` (ms), and the viewer's `setSand` blend
  (frame time, as other worker messages).

## Testing

- `tests/catchup.test.ts`: sand never rises above what was there; stability (no
  NaN, no growth) over 14 days; dry sand above the gap's high water
  untouched; same input → same output; two halves ≈ one whole (catch up a→b
  then b→c, compare with a→c, within tolerance); close to the live sim on
  the castle fixture (section 4); items: floaters lost after `LOST_FLOAT`,
  fixed items kept.
- `tests/sim.test.ts`: the live "lost to the sea" rule (an owned bottle
  pushed offshore leaves and reports `lost`), and that clamping still holds
  for `wild` and along-shore.
- Server: lease take/renew/force/expiry; catch-up CAS race (two reads at
  once, one write); epoch bump makes a stale save 409; `items` recount after
  a loss; `simulated_until` reset on restore; a "Before the tide"
  checkpoint only for gaps over the threshold, one per beach, not counted;
  the cap read from `CATCHUP_MAX_GAP_DAYS`.
- E2e `npm run e2e:live`: Ana builds a castle at the waterline and leaves;
  the test clock moves 2 days; Ben visits and sees it eroded; Ana opens her
  beach, sees "while you were away", and her nautilus is back in her bag.
  She taps "Put it back as it was" and the castle (and nautilus) return.
  A second part: Ana online, Ben watching, Ana digs, Ben sees it within 6 s.

## Milestones

| | What | Done when |
| --- | --- | --- |
| **L1** ✅ | **Lost to the sea, live.** Owned floaters and rollers can leave by the offshore edge; the worker reports `lost`; toast; the save drops them so they're back in the bag | sim tests; a bottle pushed out to sea ends up back in the bag after a save |
| **L2** ✅ | **The catch-up model.** `src/sim/catchup.ts`, `CATCHUP` constants, fitted against the live sim; perf line | `tests/catchup.test.ts` passes; `catchup14d` within budget |
| **L3** | **Server catch-up on read.** Bundle into the server, migrations (`simulated_until`, `beach_events`, `owner_seen_at`, `tide` checkpoints), configurable cap, lock + CAS + epoch, "Before the tide" checkpoint, background queue for the shore, items recount | server tests; e2e: 2 days on the test clock erodes a waterline castle and leaves a "Before the tide" checkpoint |
| **L4** | **While you were away.** The summary card, `/away` endpoints, "Put it back as it was" | e2e sees the card once, then not again; putting it back restores the castle |
| **L5** | **Live viewers.** Lease, faster saves while watched, viewer polling with blend, then SSE with `LISTEN/NOTIFY` | e2e: a viewer sees the owner's dig within 6 s; two owner tabs never both save |

L1–L4 are useful on their own (the sea works while you're away) and don't
need L5. L5 is what makes visits live.

## Owner decisions (settled 2026-11-23)

1. **Gap cap:** 14 days, configurable (`CATCHUP.maxGapDays`, server env
   `CATCHUP_MAX_GAP_DAYS`).
2. **"Before the tide" checkpoint:** yes, before catch-ups of gaps over
   12 h, as its own kind, not counted toward the limits.
3. **Visitors trigger the catch-up:** yes. Everyone sees the same beach the
   owner will.
4. **Wording:** a summary that counts what the sea took; no per-item list.
