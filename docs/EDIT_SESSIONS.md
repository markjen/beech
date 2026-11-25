# One active editor (single edit instance)

Status: **built (2026-11-24)**. Migration 25 (`edit_sessions`), server
tests in `server/test/editSessions.test.ts`, client in
`src/net/account.ts` (`claimEditSession`, `editSessionActive`),
`src/net/beachSync.ts` (`fenced` state, heartbeat, takeover) and
`src/main.ts` (view-only banner and input gates).

## The problem it fixes

Saves were last-write-wins, and the checkpoint epoch only refused saves
that carried a stale `X-Beach-Epoch`. A client sending no epoch header at
all — any app from before epochs, or a tab left open — was let through and
could silently overwrite a restore (or another device's work) minutes or
hours later. That is what happened to Riley's beach (code GJPUDD) on
Nov 24, 2026: an older instance overwrote a flat empty beach over the
restored one. This does not recover that beach; it stops the next one.

## What a session is

A session is one running instance of the app for one person: one web tab,
one phone app, one Steam client. It is **not** the sign-in: two tabs share
one bearer token (localStorage) and one sign-in, but they are two
sessions, and signing in again on the same device does not by itself
fence anything — opening the beach for editing does.

## The mechanism: a per-user edit token

- `edit_sessions` holds one row per user: the current token, when it was
  claimed, and when its holder last proved it is still there.
- When an instance opens your beach for editing — signing in (or a saved
  session coming back), on `BeachSync.restoreOrCreate(claim: true)` — it
  claims a token: `POST /api/edit-session` → `{ token }`. Claiming
  replaces the stored token, so every older instance is fenced at once.
  A claim that replaces a token logs `edit_takeover`.
- The token lives only in that instance's memory (`Account.editToken`).
  It is deliberately **not** in localStorage: two tabs share localStorage,
  so a stored token could not tell them apart. A reloaded tab claims
  again on load, and fences the tab it replaces.
- Every beach edit carries the token as `X-Edit-Token`. The server checks
  it before the edit lands; a missing or stale token never writes.
- The holder also asks every 30 s whether its token is still current
  (`GET /api/edit-session`, the heartbeat), so an older instance learns
  promptly it is view-only even while idle — it does not have to try a
  save first. The heartbeat updates `last_seen_at`; a failed heartbeat
  (offline) changes nothing, and the next save decides.
- There is no expiry: a token never times out on its own. An instance
  that goes offline and comes back hours later can still save, as long as
  nobody else claimed in between — the token, not a clock, decides. A
  stale tab reopened after hours is therefore either still the editor
  (nobody else claimed: it just works) or fenced (someone did: it is
  view-only from the moment it loads, and its first save is refused).

## What is fenced, and what is not

Fenced (409 `{ error: 'fenced' }` without the current token, 426 for an
app too old to send one — see below):

| Endpoint | Why |
|---|---|
| `PUT /api/beach`, `PUT /api/beaches/mine/:id/sand` | the save itself |
| `POST /api/beaches/mine/:id/restore` | a restore replaces the beach |
| `POST /api/dig-finds` | digging changes the beach (and the roll grants a find) |
| `POST /api/beaches/mine`, `PATCH /api/beaches/mine/:id`, `DELETE /api/beaches/mine/:id` | the beach roster: a view-only tab must not delete the beach being edited elsewhere |

Not fenced — they do not touch beach sand, and blocking them in a second
tab would surprise people:

- Pulls, gifts, favorites, neighbors, the guide, invites, the shop,
  gift cards and credit: account-level, safe from any tab.
- Pets (`/api/pet*`, `/api/animals/feed`): a pet lives on a beach but not
  in its sand, and visitors feed other people's pets on purpose.
- Checkpoints: creating one from a beach copies the server's saved sand
  (it cannot overwrite anything), importing one creates a checkpoint, and
  renaming or deleting one touches no beach. Only restoring one is fenced.
- Reading anything: loading a beach, the shore, neighbors, a checkpoint's
  sand. Viewing a neighbor's beach was already read-only and is unchanged.

## What an old instance sees

- It stops autosaving at once (`BeachSync` drops anything queued and
  `markDirty`/`flush` become no-ops), so it can never save over the
  editor — not on the next stroke, not on the 90 s timer, not on
  backgrounding.
- It can still look, visit, pan down the shore, star, pull, gift and
  feed pets: everything that is not a beach edit.
- It cannot dig, place, pick things up, drag them, undo or redo: the
  input gates in `src/main.ts` check the fenced flag first, the same way
  visiting someone else's beach already blocked digging.
- It shows a banner — "Another tab or device is editing this beach —
  you're viewing it." — with a **Take over editing** action, and the
  settings panel's save status reads "view-only: another tab or device
  is editing this beach". Trying to dig or undo while fenced shows the
  banner again, so it is reachable even after being dismissed.
- **Take over editing** claims a fresh token (fencing the other
  instances in turn) and reloads the beach, because what is on screen is
  not necessarily what is saved any more. The other instances then learn
  they are fenced from their heartbeat (within 30 s) or their next save.
- Editing an adjacent beach you own goes through the same token: the
  fence is per person, not per beach, so a fenced instance cannot edit
  any of its beaches. Its neighbor saves are refused the same way (409
  `fenced`); the neighbor view drops the unsaved edit, refetches, and
  reports `fenced`, which turns the whole instance view-only with the
  same banner — it does not tell the player the beach was restored.

## The no-epoch-header hole, closed

A save now requires the edit token. No token → 426 ("this app is out of
date: reload to save"), the same refusal other out-of-date apps get, so an
old app left open can no longer silently overwrite anything. A stale
token → 409 `fenced`. The epoch check stays as a second guard for saves
that carry it (every current app does): a save whose epoch is older than
the beach's is still 409 `restored`, and that device reloads the restored
beach. A save with a valid token but no epoch header is accepted — the
token already proves this instance is the editor, and a restore elsewhere
fences its token first, so there is nothing left for the missing epoch to
protect. `server/test/checkpoints.test.ts` covers the three cases.

## The daily auto-save and the restore-undo copy

The daily auto-save (`maybeAutoSave` in `server/src/app.ts`,
docs/CHECKPOINTS.md) shares the beach's one auto checkpoint slot with
the restore-undo copy. That is one slot on purpose, so the semantics are:
the newest auto event wins. A restore's undo copy is safe for a day after
the restore, because the restore's own auto write counts as the last auto
checkpoint and the daily save only fires after 24 h without one. After
that a daily save may replace it with a newer snapshot of the (restored)
beach. A large edit's "Before big edit" copy shares the slot the same way
and also resets the 24 h clock — it fires regardless of the clock, and a
daily save will not replace it for a day. The names tell them apart in settings → checkpoints: `Auto-save
2026-11-24`, `Before restoring “Moat v2”`, `Before import`, `Before big edit 2026-11-24`.

## Sandbox build

Fencing is production-only. The sandbox build has no accounts, no server
and no edit tokens, and is unchanged: everything there is local and
single-instance by construction.

## Edge cases

| Case | Handling |
|---|---|
| Same user, two tabs | The second tab claims on load and fences the first; the first's banner offers to take it back. |
| Phone + web | Same: whichever claimed last edits; the other is view-only. |
| Stale tab reopened after hours | Still the editor if nobody claimed since (it just works); fenced if someone did (view-only from load). |
| Offline, then reconnect | No expiry: the token is still current if nobody claimed meanwhile, so the queued save lands. If someone did claim, the save is 409 `fenced`. |
| Offline heartbeat | A failed heartbeat never fences: only a successful "not active" answer, or a refused save, does. |
| Two instances saving at once | Both need the current token; only one holds it, so only one save lands. |
| Sign-out / account delete | The bearer session ends; the edit row stays (harmless — the token is useless without a live session), and the next sign-in claims a new one. |
| Old app (no token, no epoch) | 426 on any beach edit: it must reload/update to save again. |

## API

All behind `requireUser`.

| | |
|---|---|
| `POST /api/edit-session` | claim (or take over) editing: `{ token }`. Replaces the stored token. |
| `GET /api/edit-session` (`X-Edit-Token`) | heartbeat: `{ active: boolean }`. No token → `{ active: false }`. |

`X-Edit-Token` is in the CORS allow-list (the phone apps send it
cross-origin).

## Observability

- `edit_takeover` (INFO): a claim replaced a token — one instance took
  over from another. Normal when someone opens a second tab; worth a
  look if a player reports losing edits.
- `auto_checkpoint_failed` (WARNING): the daily auto-save could not
  write; the beach save it was guarding went ahead anyway. Carries
  `reason: 'daily'` or `'large-edit'` for a big edit's safety copy — the
  save's response tells the app in that case too
  (`largeEditCheckpoint: false`), so the player is told.
- `stale_app_save` (WARNING, `why: 'no X-Edit-Token'`): an app too old
  to send a token tried to save.

## Tests

`server/test/editSessions.test.ts` (PGlite and Postgres):

- a new claim fences the old instance: its saves, restores and dig
  rolls are 409 `fenced` and write nothing; taking over again fences
  the second instance in turn;
- no token at all: 426; someone else's token: 409;
- the beach roster (make / rename / remove) is fenced;
- the daily auto-save: first save keeps nothing, second save keeps the
  beach as it was, a third save the same day leaves it alone, a day
  later the same slot is replaced; a restore's undo copy survives a
  day, then the daily save takes the slot; a full checkpoint store never
  blocks the save.
