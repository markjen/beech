---
name: model-first
description: Model-first development for this game. Load BEFORE writing code for any new gameplay, new feature, or change to how one works that touches state the server keeps (anything a player owns, spends, earns, places, claims or unlocks; limits, cooldowns, daily allowances; anything two devices, players, webhooks or timers can reach at once; anything with stages like requested/accepted/paid/expired). Write or extend the TLA+ spec in specs/tla first, check it with TLC, then derive the code (what must be one transaction, under which lock) and the tests (transition tests, counterexample replays, a random walk against a reference model) from it. Not for rendering, sound, UI layout, copy, tuning constants or the guide.
---

# Model first

The full workflow, with the reasons, the spec skeleton and the checklist,
is in `docs/STATE_MACHINES.md` ("Model-first workflow"). Read it before you
start. This is the short form.

## 0. Decide

Does the change add or alter server state that more than one request can
touch? Then it needs a model. If not (rendering, sound, UI layout, copy,
`src/config.ts` tuning, pure functions), say so in the change ("no model:
UI only") and carry on as usual. When unsure, model it.

## 1. Spec (`specs/tla/<Name>.tla`, before any code)

- Extend the machine it belongs to (`Snacks`, `BeachEditing`,
  `Neighbors`) or start a new spec from the skeleton in the doc.
- **State**: what the database holds for it, plus what clients believe.
  Tiny values: 2-3 players/devices/beaches, counts up to 2.
- **Invariants first**, in the game's words. Ghost variables are fine.
- **Actions**: one per request, webhook or timer, split at every separate
  statement another request could land between (read-then-write is two
  steps; one statement, or one transaction holding a lock, is one).
- A `Fixed` (design-choice) constant when there's more than one way to
  build it; `<Name>.cfg` and `<Name>Fixed.cfg`.

## 2. TLC

```bash
specs/tla/check.sh <Name>          # the design you'll build: must pass
specs/tla/check.sh --bugs <Name>   # the other forms: see what breaks
```

Every counterexample against the design you'll build is a design bug: fix
the design (atomic step, lock, a condition in the write, a different rule)
and rerun. Don't build until it passes.

## 3. Map to code (docs/STATE_MACHINES.md, the machine's table)

Each action: its route and function, and how its steps become code. An
atomic action is one transaction holding a named lock (the beach row, the
player row, or both beaches in id order), or one SQL statement whose
`WHERE` carries the check. Patterns already in the code: `asEditor` (saves
and restores), `adoptPet` and `visitorFeedPet` (beach lock), `link()`
(both beaches).

## 4. Tests (`server/test/stateMachines/`, before or with the code)

Using `harness.ts` (`startServer`, the clock, the gate, `beachBytes`, `rng`):
- `<name>Model.ts`: the spec in TypeScript, the design you're building,
  one method per action returning the expected HTTP answer;
- transition tests, one action at a time, refusals included;
- a replay of each counterexample TLC found in the other forms, using
  `s.gate.pauseBefore(/sql/, { orTransaction })` at a statement that runs
  outside a transaction in every form;
- a seeded random walk: server and model in step, database compared with
  the model and invariants checked after every step.

`npm run test:state` (under 10 s, no browser). A replay should fail
against the unfixed form. Check that once, by stashing the fix.

## 5. Build, then finish

Write the code until the tests pass. If the server and the model disagree,
decide which is wrong. Never loosen an invariant to get green. Then do
the usual: `npm test`/`npm run build`, the server checks, STATUS.md and
BACKLOG.md, and the guide and release notes if players notice.
