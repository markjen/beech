# Live beaches: the sea keeps working while you're away (design)

Status: design, not built. Milestones L1–L5 are at the end and in
[BACKLOG.md](BACKLOG.md).

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

When anyone (owner included) reads a beach and
`now − simulated_until > CATCHUP_MIN_GAP` (10 min), and no lease is live,
the server catches it up before or while serving it:

1. Take a per-beach lock (`pg_try_advisory_xact_lock(beach_id)`). If another
   request holds it, serve the stored beach now; the caught-up one follows
   (see "Serving" below).
2. Run `catchUp(beach, from = simulated_until, to = now)` (section 4).
3. Write sand, objects, `items` (recounted), `simulated_until = to`,
   `version + 1`, `epoch + 1`, **only if** `version` is still the one read
   (compare-and-set). A lost race just means someone else already caught it
   up; use theirs.
4. Record what happened in `beach_events` (section 6) and return the lost
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

**What each step does** (per half cycle, only on the **active band**: the
rows between that step's lowest water and its highest water plus a swash
band above it, usually a third of the grid or less):

- **Slope relaxation:** wet sand relaxes toward its wet angle of repose,
  moving sand downhill (mass-conserving), several Jacobi passes per step.
  This is what slumps walls and fills moats.
- **Toward the equilibrium profile:** submerged and swash cells move a
  fraction toward the rest profile, `k · waves · Δt`, with the sand moved
  offshore-ward and deposited in the surf zone, not deleted (mass is
  conserved inside the grid; only the offshore edge may lose, as in the live
  sim).
- **Dry sand** above the highest water of the gap is untouched, as in the
  live sim. A castle built high up the beach survives a week; one at the
  waterline doesn't.
- The constants (`CATCHUP` in `src/config.ts`) are fitted to the live sim:
  a test runs both on the same castle for one simulated hour at a fixed tide
  and checks the catch-up lands near the full sim (height loss within ~25 %,
  same cells changed). It doesn't need to match closely, only to look like
  the same sea.

**Objects** follow simple rules per step:

- **Rocks, flags, deckchairs, lighthouses** (fixed): stay. If the sand under
  them is gone they sit on the floor; if sand piled over them past their
  height, they're **buried** (see below).
- **Light things** (driftwood, bottles) in water deeper than their draft at
  that step: moved along the shore by the step's mean drift (a seeded random
  walk scaled by waves), then stranded at the step's waterline when the tide
  falls.
- **Shells and other rollers:** rolled downslope a little in swash cells.
- **Lost to the sea** (section 5): a floater that spent more than
  `LOST_FLOAT` (2 h) in water, or any item under more than `LOST_BURY`
  (0.3 m) of sand at the end of the gap.

**Bounds.**

- Gap capped at **14 days**. Past that, the beach is already "flattened by
  the sea" for anything the water reaches; more time changes nothing visible.
- The grid is the saved one (192² to 320² cells). A 14-day gap is ~56 half
  cycles; at ~10 relaxation passes each over a band of ~256 × 90 cells,
  that's ~13 M cell updates, roughly 50–100 ms in JS. Target: a 14-day
  catch-up under 150 ms on a Cloud Run CPU, checked by `npm run perf` (a new
  `catchup14d` line in `perf/budget.json`). If it misses, run the band at
  half resolution and add the upsampled change back.
- Deterministic for a given input (seeded from beach id and `from`), so a
  retry gives the same answer.

**Live sim on return.** When the owner opens the beach, the live sim starts
from the caught-up sand at the real tide, as today. No catch-up runs on the
device.

### 5. What the sea takes goes back in your bag

Today nothing you own can leave a beach. This adds one rule, used by the live
sim and the catch-up alike:

- An **owned** (not `wild`) item is **lost to the sea** when:
  - it floats past the offshore edge (the live sim stops clamping owned
    floaters at the offshore side; along the shore and landward they stay
    clamped), or
  - it ends up buried deeper than `LOST_BURY` (the live sim checks this when
    the water leaves it), or
  - it's a floater that's been afloat for `LOST_FLOAT` (catch-up only; the
    live sim lets it drift out instead).
- Rocks, flags and other fixed things are never lost: they don't move.
- A lost item **leaves the beach and is back in the bag**. That needs no
  inventory write: the bag already shows "owned − placed across your
  beaches", and the server recounts `beach.items` from the objects on every
  save and catch-up. A free item (rock, driftwood, shell) just goes; it's
  free anyway.
- The live app shows a toast: "The sea took your nautilus. It's back in your
  bag."
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
  lost JSONB NOT NULL DEFAULT '[]',-- [{ item, kind }] back in the bag
  created_at BIGINT NOT NULL
);
CREATE INDEX beach_events_beach ON beach_events (beach_id, created_at);
```

Kept for 30 days (pruned on write). When the owner opens a beach whose
events they haven't seen, the app shows a small card:

> **While you were away** (2 days)
> 4 high tides · your castle took the worst of it ·
> the sea took your nautilus and 2 shells (back in your bag)
> [Restore a checkpoint]

"Restore a checkpoint" opens settings → checkpoints. "Last seen" is a
per-beach `owner_seen_at` column, set when the owner opens it.

A later idea: before the catch-up, keep the old sand as the beach's automatic
checkpoint ("Before the tide"), so one tap undoes a week of sea. It's the
same mechanism as "before restoring" and costs nothing new, but it would
replace the existing auto slot, so it's left as an owner decision below.

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
- `beach_events` (section 6).

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

- `tests/catchup.test.ts`: mass conservation inside the grid; stability (no
  NaN, no growth) over 14 days; dry sand above the gap's high water
  untouched; same input → same output; two halves ≈ one whole (catch up a→b
  then b→c, compare with a→c, within tolerance); close to the live sim on
  the castle fixture (section 4); items: floaters lost after `LOST_FLOAT`,
  fixed items kept, deep-buried items lost.
- `tests/sim.test.ts`: the live "lost to the sea" rule (an owned bottle
  pushed offshore leaves and reports `lost`), and that clamping still holds
  for `wild` and along-shore.
- Server: lease take/renew/force/expiry; catch-up CAS race (two reads at
  once, one write); epoch bump makes a stale save 409; `items` recount after
  a loss; `simulated_until` reset on restore.
- E2e `npm run e2e:live`: Ana builds a castle at the waterline and leaves;
  the test clock moves 2 days; Ben visits and sees it eroded; Ana opens her
  beach, sees "while you were away", and her nautilus is back in her bag.
  A second part: Ana online, Ben watching, Ana digs, Ben sees it within 6 s.

## Milestones

| | What | Done when |
| --- | --- | --- |
| **L1** | **Lost to the sea, live.** Owned floaters can leave by the offshore edge; deep-buried items are lost; the worker reports `lost`; toast; the save drops them so they're back in the bag | sim tests; a bottle pushed out to sea ends up back in the bag after a save |
| **L2** | **The catch-up model.** `src/sim/catchup.ts`, `CATCHUP` constants, fitted against the live sim; perf line | `tests/catchup.test.ts` passes; `catchup14d` within budget |
| **L3** | **Server catch-up on read.** Bundle into the server, migrations (`simulated_until`, `beach_events`, `owner_seen_at`), lock + CAS + epoch, background queue for the shore, items recount | server tests; e2e: 2 days on the test clock erodes a waterline castle |
| **L4** | **While you were away.** The card, `/away` endpoints, "Restore a checkpoint" link | e2e sees the card once, then not again |
| **L5** | **Live viewers.** Lease, faster saves while watched, viewer polling with blend, then SSE with `LISTEN/NOTIFY` | e2e: a viewer sees the owner's dig within 6 s; two owner tabs never both save |

L1–L4 are useful on their own (the sea works while you're away) and don't
need L5. L5 is what makes visits live.

## Owner decisions

1. **Gap cap:** 14 days suggested. Longer changes nothing visible, but a
   shorter one (e.g. 3 days) would be gentler for people who come back after
   a holiday.
2. **"Before the tide" auto checkpoint** before each big catch-up (say, gaps
   over 12 h): one-tap undo of the sea, but it takes the beach's one auto
   slot (today used by "before restoring" and "before import"). Suggested:
   yes, as a second auto kind, not counted toward the limit.
3. **Do neighbors' visits catch up your beach?** Suggested yes (that's the
   point: they see the same beach you will). The alternative is to catch up
   only when you open it, and show visitors the beach as you left it.
4. **Lost item toast wording and whether the card names each item** or just
   counts them.
