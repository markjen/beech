# Checkpoints (design)

Status: **built (C1 to C6)**. C6 (2026-11-24): thumbnails on each
checkpoint, and in the sandbox build checkpoints kept on the device
(IndexedDB, up to 20) along with the beach itself between visits.

Built as designed, except: the migration is **13** (11 and 12 were taken by
dig finds and gift cards), and the owner decisions at the end were taken as
suggested (5 per beach slot and 16 MB; beach files only in the sandbox;
stars kept). Also added while building:

- `POST /api/beaches/mine/:id/checkpoints { name, auto: true }` makes the
  beach's one automatic copy instead of a named one (the import preview's
  "Before import"); it replaces the last automatic copy and isn't counted.
- In the app: **settings → checkpoints** (`src/ui/checkpoints.ts`), a
  **checkpoint** action on each saved beach in "your beaches", **restore
  onto…** on each checkpoint, an Undo toast, and **export** / **import a
  beach file** (BEACH_FILE.md). The confirm and short dialogs use the
  browser's own `confirm()`, like removing a beach.
- CORS: the phone apps call the API cross-origin, and the allowed headers
  were missing `X-Beach-Items` (every save) and the `PATCH` method (renaming
  a beach). Both are allowed now, with `X-Beach-Epoch` and
  `X-Checkpoint-Name`.

A checkpoint is a named copy of one of your beaches: its sand and the things
on it. You can save one from any of your beaches and later put it back on
**any** of your beaches, as long as your bag still holds the things it needs.
Before a restore replaces a beach, the server saves that beach as an
automatic checkpoint, so every restore can be undone.

## What people get

- "Save a checkpoint" on any of their beaches, with a name ("Before the
  storm", "Moat v2").
- A list of their checkpoints: name, which beach it came from, when, and the
  non-free things in it.
- "Restore here" (onto the beach this device shows) or "Restore onto…" (any
  of their beaches).
- A clear answer when they can't: "You need 1 more Lighthouse (it's on
  Home)". Then a choice: cancel, or restore without the missing ones.
- "Undo restore" straight after, and the last "before restore" copy of each
  beach kept in the list.
- Later: export a checkpoint as a beach file, and import a beach file as a
  checkpoint (the file format is the export/import feature's,
  `docs/BEACH_FILE.md`).

## Decisions

| Question | Decision | Why |
|---|---|---|
| What is stored | The same BCH2 bytes a beach save holds (`src/sim/sandCodec.ts`), copied as they are | One format: no new codec, the loader (`decodeSand` → `fitWorld` → `resampleField`) already handles every grid size and old world, and a restore is a byte copy |
| Who counts the items | The **server**, from the blob itself | The beach's `items` column comes from the client's `X-Beach-Items` header. For a restore the server must not trust the client's count, so it inflates the objects part and counts |
| Missing items | **Strict by default.** The refusal offers one fallback: "Restore without them" (`mode: drop-missing`) | Strict never silently loses anything; the one-tap fallback covers the common case (an item now placed on another beach) without a menu of half-restores |
| Sand-only restore | Not offered | It would also drop the free rocks and driftwood that shape the sand, which surprises people. "Keep this beach's things, take that sand" is a different feature (Ideas) |
| Location | A restore keeps the **target beach's** place (Bondi stays Bondi) | The place is the beach's, not the design's: it sets the sun and tides. The checkpoint shows where it came from |
| Grid size mismatch | Nothing done on the server; the loading client fits it | The blob keeps its own nx/ny. Any device opening the beach runs `fitWorld` (old 32 × 24 saves) and `resampleField` (another tier's grid), then its next save writes its own grid |
| Safety | An automatic checkpoint of the target, made in the same request, before it's replaced | Undo works even if the app dies mid-restore, and from another device |
| Other devices showing the target | A beach **epoch**: a restore bumps it; saves from before it are refused (409) and that device reloads | Otherwise a phone still showing the old sand saves it back over the restore 6 s later (last write wins) |
| Sandbox build (no accounts) | **No checkpoint list** at first. The beach file (export/import) is the sandbox's save and restore | The sandbox doesn't keep even the beach between visits (Ideas: "keep the sandbox beach on the device"). A file needs no storage and no network. The client code talks to a `CheckpointStore` interface, so an IndexedDB store can be added with that idea |
| Deleting a beach | Its checkpoints stay (`from_beach` becomes null, `from_name` is kept) | "Checkpoint it, then remove it" frees a beach slot without losing the work |

## Data model

Migration **13** (`server/src/migrations.ts`):

```sql
CREATE TABLE checkpoints (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,                                   -- 1..40 chars
  kind TEXT NOT NULL CHECK (kind IN ('named', 'auto')), -- auto: "before restore"
  source TEXT NOT NULL CHECK (source IN ('beach', 'import')),
  from_beach UUID REFERENCES beach (id) ON DELETE SET NULL,
  from_name TEXT NOT NULL DEFAULT '',                   -- that beach's name then
  location TEXT,                                        -- shown, not applied
  nx INTEGER NOT NULL, ny INTEGER NOT NULL,
  sand BYTEA NOT NULL,                                  -- BCH1/BCH2 bytes
  bytes INTEGER NOT NULL,
  items JSONB NOT NULL DEFAULT '{}',                    -- counted by the server
  objects INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX checkpoints_owner ON checkpoints (owner_id, created_at);
CREATE UNIQUE INDEX checkpoints_one_auto ON checkpoints (from_beach) WHERE kind = 'auto';
ALTER TABLE beach ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0;
```

- `items` is `{ lighthouse: 1, starfish: 2 }`: every placed object whose item
  isn't free, **including ones marked `wild`** (the sea only washes in free
  kinds, so a "wild lighthouse" is a crafted file). The client's
  `countItems()` changes to match (it skips `wild` today).
- The server can't import `src/world/items.ts` (separate package), so
  `server/src/checkpoints.ts` keeps `FREE_ITEMS` (rock, driftwood, shell,
  seaglass, flag). Any other id, including unknown ones, needs inventory. A
  client test keeps `FREE_ITEMS` in step with the catalog's `unlimited`
  items, the way `tests/items.test.ts` keeps the pools in step.
- One `auto` row per beach (the unique index): a new one replaces the old.

### Reading a blob on the server

`inspectBlob(bytes) → { nx, ny, items, objects }`, in
`server/src/checkpoints.ts`, with `node:zlib`:

- magic `BCH1` or `BCH2`; `nx === ny`, `8 ≤ nx`, `nx·ny ≤ MAX_CELLS`;
  total ≤ `MAX_BEACH_BYTES` (768 KB);
- the sand part inflates to exactly `nx·ny·2` bytes (`maxOutputLength`
  guards against a zip bomb);
- the objects part inflates to at most 128 KB, is a JSON array of at most
  2000 entries (`MAX_OBJECTS`), each with a string `item` of at most 64 chars. Shape checks
  beyond that are the client's `sanitizeObjects` on load.

Beach rows saved by an old app (32 × 24) may still be non-square. A
snapshot of such a beach copies it as it is; the loader fits it. Only
**imports** must be square.

## Limits

| | Free | Note |
|---|---|---|
| Named checkpoints | **5 per beach of allowance** (5 with one beach, up to 40 with 8) | Buying beaches buys room, so there's no new paid tier to explain (PRICING.md: no subscriptions) |
| Auto checkpoints | 1 per beach, not counted | Replaced by the next restore of that beach |
| Size of one | 768 KB (same as a beach) | Typical beaches are a few KB to ~100 KB |
| Total stored | 16 MB per person (named + auto) | 413 past it |
| Name | 1–40 characters, trimmed | |
| Make / import | 60 an hour | per user, `createRateLimiter` |
| Restore | 30 an hour | per user, `createRateLimiter` |

If the allowance drops (a refunded beach), nothing is deleted: you just can't
make new named checkpoints until you're under the limit again.

## API

All behind `requireUser`. In the app, everything is behind `ACCOUNTS_ENABLED`.

| | |
|---|---|
| `GET /api/checkpoints` | `{ limit, bytesUsed, bytesLimit, checkpoints: [{ id, name, kind, source, fromBeach: { id, name } \| null, location, nx, ny, items, objects, bytes, createdAt }] }`, newest first |
| `POST /api/beaches/mine/:id/checkpoints { name }` | copy that beach's saved sand (server side, no upload). 404 if it has no save; 409 at the limit. The app flushes `BeachSync` first when it's the live beach |
| `POST /api/checkpoints` (body = BCH2 bytes, `X-Checkpoint-Name`, URL-encoded) | import: `inspectBlob`, then store with `source = 'import'`. 400 bad blob, 409 at the limit, 413 too big |
| `GET /api/checkpoints/:id/sand` | the bytes, with `X-Beach-Nx/Ny/Location` (same as `/api/beach`), for export and preview |
| `PATCH /api/checkpoints/:id { name }`, `DELETE /api/checkpoints/:id` | rename, delete (autos too) |
| `GET /api/checkpoints/:id/fit?beach=<id>` | dry run: `{ ok, need, owned, elsewhere, short }` for restoring onto that beach |
| `POST /api/beaches/mine/:id/restore { checkpoint, mode: 'strict' \| 'drop-missing' }` | see below. 200 `{ version, updatedAt, epoch, undo: <auto id>, dropped }`; 409 `{ error: 'short', short }` in strict mode |

A checkpoint id that isn't yours is a 404, the same as `mine()` for beaches.

### The inventory check

For a restore of checkpoint **C** onto your beach **T**, for each non-free
item `i` in `C.items`:

```
need(i)      = C.items[i]
owned(i)     = SUM(quantity) of your unexpired inventory rows for i
elsewhere(i) = SUM(beach.items[i]) over your beaches other than T
short(i)     = max(0, need(i) − (owned(i) − elsewhere(i)))
```

T's own current items don't count against you, because the restore replaces
them. Restore if every `short(i)` is 0. This is the same sum the bag already
shows as "N of M left" (`inventory.setElsewhere` in `src/main.ts`), so the
client can show the answer before asking. A pure `shortfall(need, owned,
elsewhere)` lives in `src/world/checkpointFit.ts`; the server has its own
copy, and one fixture file of cases (`tests/fixtures/checkpoint-fit.json`)
runs in both test suites.

`elsewhere` comes from `beach.items`, which the client reports on each save.
A modified client could under-report and over-place. That gap exists today
for normal placing; checkpoints don't widen it, because what a restore
writes is counted by the server. A follow-up could have `saveBeach` count
with `inspectBlob` too and drop the header.

### The restore, step by step (server)

1. `mine(c, id)` (404 if not yours), load C (404), rate limit (429).
2. Take a per-user advisory lock (`db.withLock(userKey(me), …)`, a key
   hashed from the user id, away from the migration key). Two restores at
   once onto two beaches could otherwise each pass the check.
3. Read owned and elsewhere, compute `short`.
   - `strict` and anything short: 409 `{ short }`, nothing written.
   - `drop-missing`: rewrite the objects JSON without `short(i)` of each
     short item (the highest ids, the ones placed last), deflate it again,
     and keep the sand part's bytes as they are. The checkpoint itself is
     untouched.
4. In **one statement**: upsert T's `auto` checkpoint from T's current
   sand ("Before restoring 'Moat v2'"; skipped if T has no save yet), then
   `UPDATE beach SET sand, nx, ny, items, version = version + 1,
   updated_at = now, epoch = epoch + 1 WHERE id = T`. T's location stays.
5. Return the new version, epoch and the auto checkpoint's id.

## Live devices: the epoch

- `GET` beach sand adds `X-Beach-Epoch`. `BeachSync` keeps it and sends it
  back on every `PUT` as `X-Beach-Epoch`.
- `saveBeach` refuses a save whose epoch is older than the beach's: 409
  `{ error: 'restored' }`. A save without the header (an older app) is still
  accepted, so an old app left open can overwrite a restore. The "reload
  stale tabs" backlog item closes that.
- On `restored`, `BeachSync` drops what it had queued, calls
  `restoreOrCreate()` to load the restored beach, and the app shows "This
  beach was restored from 'Moat v2'" (the name comes from the auto
  checkpoint, via `GET /api/checkpoints`).
- Restoring the beach this device shows: `flush()`, hold saves (the same
  `switching` flag `switchTo` uses), restore, then `restoreOrCreate()`. The
  undo stack is cleared, as for any beach load.
- Restoring one of your other beaches: nothing reloads here; the app
  refreshes `/api/beaches/mine` so the bag's "elsewhere" counts change.

## Neighbors, the shore and the leaderboard

- A restore is a save as far as anyone else can tell: `updated_at` changes,
  so neighbors and the shore repaint within their 30 s poll. A beach that
  had never been saved appears on the shore once restored.
- Stars, links, requests, the code and on/off-shore all belong to the beach,
  not the design, so a restore changes none of them. A beach keeps its stars
  when its sand is swapped, and the rising board doesn't move (it counts
  stars, not saves).
- Checkpoints are private. They have no code and nobody else can list or
  read them. Copying a design between people goes through beach files
  (`docs/BEACH_FILE.md`), and an import brings the sand and free things,
  and only the non-free things the importer owns.

## Abuse and edge cases

| Case | Handling |
|---|---|
| Restore the same lighthouse onto two beaches | The second sees it in `elsewhere`: short. Concurrent restores are serialised by the per-user lock |
| Gift or refund an item, then restore an old checkpoint with it | `owned` is read at restore time: short |
| Crafted blob (zip bomb, 10k objects, "wild" lighthouse, unknown item ids) | `inspectBlob` limits; `wild` is ignored for counting; unknown ids need inventory (owned 0, so short; `drop-missing` drops them) |
| Storage filling | count and byte limits, 768 KB each, rate limits |
| Restore churn to spam neighbors' repaints | 30 restores an hour; repaint cost is the same as a save |
| Restore onto a beach that's over the allowance (read-only after a refund, MULTI_BEACH.md) | 403 once read-only beaches are enforced, like their saves |
| Old app open on the target | its save goes through (no epoch header): documented; fixed by "reload stale tabs" |
| Checkpoint from a deleted beach | still listed ("from Bondi, removed"), still restorable |
| Account deleted | checkpoints go with it (`ON DELETE CASCADE`) |

## App

- **Where:** settings, under "your beaches" (`src/ui/accountPanel.ts`), a
  "checkpoints" section rendered by a new `src/ui/checkpoints.ts`. Not in the
  bag: checkpoints are about beaches, and the bag tray is for placing things.
- **Save:** "save a checkpoint of <this beach>" asks for a name
  (`prompt()`, like naming a beach). Each beach row in "your beaches" also
  gets a small "checkpoint" action for the beaches not shown here.
- **List:** name, "from Home · 2 h ago", and chips for the non-free items
  (a chip turns red when you'd be short restoring here, computed locally from
  the bag's owned and elsewhere maps). A "N of M" count at the top.
- **Actions per checkpoint:** restore here, restore onto… (a picker of your
  beaches), rename, delete (second tap confirms, as delete account), and
  export once the beach file lands.
- **Restore confirm:** "Replace Bondi with 'Moat v2'? Bondi as it is now is
  kept as 'Before restoring', so you can go back." When short: "You need
  1 more Lighthouse (1 is on Home)" with **Restore without them** and
  **Cancel** (and "Get one in the shop" for shop items).
- **After:** a toast "Restored 'Moat v2' · Undo" for 10 s. Undo restores the
  auto checkpoint (strict; it can't be short, because you just swapped those
  things out).
- **Import:** "import a beach file" in the same section, once the beach file
  exists: the export/import module turns the file into `SavedBeach`, the app
  encodes it with `encodeSand` and posts it as a checkpoint. Export goes the
  other way: `GET …/sand`, `decodeSand`, the file writer. Checkpoints only
  ever store BCH2; the file format stays the other module's business.
- **Client code:** `src/net/checkpoints.ts` (`CheckpointStore` interface,
  `ServerCheckpoints` on `Account`), `src/world/checkpointFit.ts`
  (`shortfall()`), the epoch in `src/net/beachSync.ts`.

## Tests

**Server** (`server/test/checkpoints.test.ts`, PGlite and Postgres):

- migration 11 applies on top of 10 with data (`migrations.test.ts` style);
- `inspectBlob`: client-made BCH1/BCH2 fixtures, a wrong magic, a short
  sand part, a zip bomb, 401 objects, `wild` non-free items counted;
- create from a beach, import, list, rename, delete; 404 for someone else's;
  the count limit follows the allowance; the byte limit; rate limits;
- fit: owned minus elsewhere, the target's own items not counted, expired
  inventory not counted, unknown items short; the shared fixture cases;
- restore strict (409 with `short`), drop-missing (the last-placed ones
  dropped, the sand bytes unchanged), the auto checkpoint made and replaced,
  `beach.items` set from the server's count, version and epoch bumped,
  location kept;
- two restores at once onto two beaches with one lighthouse: exactly one
  succeeds;
- saves: a stale epoch is 409 `restored`; no header is accepted; the current
  epoch is accepted;
- deleting a beach keeps its checkpoints; deleting the account removes them.

**Client** (Vitest): `shortfall()` with the shared fixtures; `countItems`
counts `wild` non-free items; `FREE_ITEMS` matches the catalog; `BeachSync`
reloads on `restored`.

**End to end** (`scripts/checkpoints-e2e.mjs`, `npm run e2e:checkpoints`,
against `npm run server:dev` with DEV_AUTH):

1. Sign in, grant a lighthouse and an extra beach (`/api/dev/grant`), place
   the lighthouse and dig on Home, save checkpoint "one".
2. Make a second beach. Restore "one" onto it: refused, short 1 lighthouse.
   Restore without them: the dig is there, no lighthouse.
3. Pick the lighthouse up on Home, restore "one" strictly onto beach 2: the
   lighthouse is there; the bag shows 0 of 1 left.
4. Device B shows beach 2 and keeps digging; device A restores onto it.
   Device B reloads with the restored sand and doesn't save over it.
5. Undo from the toast: beach 2 is back to before.
6. Delete beach 2: its checkpoints are still listed. Delete "one".

Add `npm run e2e:checkpoints` to the server checklist in CLAUDE.md when C3
lands.

## Milestones

Each one leaves the app playable and passes `npm test`, `npm run build` and
the server tests.

| # | What | Visible change |
|---|---|---|
| C1 | Migration 11, `inspectBlob`, `FREE_ITEMS`, list / create from a beach / import / get / rename / delete with limits; client `countItems` counts `wild` non-free items. Server tests | none |
| C2 | Fit check and restore (strict and drop-missing), auto checkpoint, per-user lock, epoch on GET and PUT (`X-Beach-Epoch`). Server tests including the race and stale epoch | none |
| C3 | Client: `CheckpointStore`, epoch in `BeachSync` (reload on `restored`), settings section: save, list, rename, delete, restore here with the confirm and short dialogs, undo toast. `checkpoints-e2e.mjs` steps 1–3 and 5 | checkpoints in settings |
| C4 | Restore onto another beach, the "checkpoint" action on each beach row, red chips from local fit. E2e steps 4 and 6 | restore anywhere |
| C5 | Export and import through the beach file (after `docs/BEACH_FILE.md` lands) | import / export |
| C6 (optional) | A small top-down thumbnail drawn on the client from the decoded sand (nothing stored); a local `CheckpointStore` in IndexedDB for the sandbox, together with "keep the sandbox beach on the device" | thumbnails; sandbox checkpoints |

## Decisions for the owner

- **Limits:** 5 named checkpoints per beach of allowance and 16 MB total.
  More, or a shop product for more?
- **Sandbox:** beach files only (suggested), or local checkpoints too?
- **Stars on restore:** a beach keeps its stars when its sand is swapped
  (suggested), or a restore resets them?
