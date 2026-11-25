# Beach state on the client (design)

Status: **built** (2026-11-25). Replaces the per-device "active beach".

## The problem it fixes

Before this, the client had one *active beach* (`account.beachId`, remembered
per device in localStorage). That beach lived in the wave worker at the world
origin; every other beach, including your own other beaches next door, was a
snapshot owned by a shore slot in `NeighborView`, with its own fetch, its own
edit simulation and its own saver. Two copies of the "which beach is this
sand" question (`account.beachId` and the slot index) had to agree, and the
switch, restore and save paths spent most of their code keeping them in step
(`switching`, `simBeach`, the switch queue, the seam-crossing stroke dance).

## The model

1. **The store holds beach state by id.** `BeachStore`
   (`src/net/beachStore.ts`) is a map from beach id to `BeachState`: the sand
   (minus the rest beach, at this device's grid), rock cover, the things on it,
   a display copy with the cover baked in, the server's `epoch`, `updatedAt`
   and `version`, the undo history while no simulation holds it, and the edit
   simulation once it has been edited here. Every beach the client knows about
   is in it, yours and anyone else's: the shore API now sends each beach's
   `id`. The signed-out / sandbox beach is the id `local`.
2. **Everything addresses beaches by id.** Drawing reads `store.peek(id)`;
   digging, placing, moving, undo and redo name a beach id; saves are
   `store.markDirty(id)` / `store.flush(id)`; checkpoints, pets, the away
   summary and the settings panel take an explicit id. `Account` no longer has
   `beachId`, `setBeach`, `onBeach` or a remembered active beach, and its sand
   endpoints all take an id.
3. **No current beach: only the beaches in view.** `NeighborView` lays the
   shore out around an anchor (your home, a beach you chose in settings, or a
   beach you're visiting by code). Index 0 is an ordinary entry. Which
   beaches are drawn is the view's window; which are kept in memory is the
   store's business.
4. **The waves run where you're looking.** The worker is a compute engine,
   not a beach. It simulates the beach of yours nearest the centre of the
   view (`liveId`, picked each frame with hysteresis, never mid-stroke). When
   the view settles on another of your beaches, the binding (`BeachSync`)
   reads the worker's sand *and undo history* back into the store under the
   old id, then loads the new id's state (including its history, or its edit
   simulation's) into the worker, and the live renderer, picker, things and
   animals move to that beach's place on the shore. Nothing is refetched: the
   store already has it. Other beaches of yours in view are edited on the
   main thread through the store's edit simulation, as before.
5. **Saving is one pipeline.** The store saves each id on its own timer, one
   save in flight per id, with a revision counter so a save that started
   before the latest edit leaves the beach dirty. If the id is bound to the
   worker, the save reads the worker first. Fenced, restored (409), outdated
   (426), too big (413) and offline are handled once, for every beach.
6. **Memory: LRU.** The store keeps at most `BEACH_STORE.capacity` beaches
   (`src/config.ts`). After each window change the view tells the store which
   ids are in view (`retain`), and `gc()` drops the least recently used of the
   rest, never one that is in view, bound to the worker, dirty, saving or
   loading. A dropped beach is fetched again when it comes back into view.

## Per-device view memory

Instead of an active beach, a device remembers which beach was in front of
it (`beech.view.v1`, per user, by code) and anchors the shore there on the
next start. It's a camera bookmark: if that beach is gone or isn't yours any
more, the shore anchors at home.

## Live-sim duties that follow the binding

- `here` heartbeat and `watched` saves (docs/LIVE_SIM.md) go to `liveId`.
- The "while you were away" summary shows when a beach is bound and its
  sand came from the server, once per beach per load.
- A reload because the epoch moved on (a catch-up or restore elsewhere)
  reloads that id in the store; if it's bound, the worker gets the new sand.

## Tests

- `tests/beachStore.test.ts`: load de-duplication, unsaved edits survive a
  reload, revisions across an in-flight save, LRU eviction skips retained /
  dirty / bound beaches, error handling per id, history parking.
- `tests/beachSync.test.ts`: fencing, and that rebinding hands sand and undo
  history over through the store without a refetch.
- The e2e scripts use `__beech.store()`, `__beech.liveBeach()` and
  `__beech.sync()`.
