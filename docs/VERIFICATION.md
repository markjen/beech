# Formal verification (LemmaScript + Dafny)

Agents in this repo can formally verify TypeScript with
[LemmaScript](https://github.com/midspiral/LemmaScript): `//@` annotations
(`requires`, `ensures`, invariants) on ordinary TypeScript, compiled to
[Dafny](https://dafny.org) and proved with Z3. The TypeScript ships
unchanged; the proof lives next to it.

This page says how the tooling is set up, what is verified, and where it
fits.

## What is verified (`LemmaScript-files.txt`)

On the server, which has the final say, and in the app where it shows an answer early or decides what a save keeps:

| Function | File | Proved |
| --- | --- | --- |
| `shortfallUnsorted` (behind `shortfall`) | `server/src/checkpoints.ts` | The restore check: an item is listed exactly when it isn't free and the checkpoint needs more than owned minus what's on your other beaches (never below 0), with the right `need`/`have`, and each item at most once. |
| `saveShortUnsorted` (behind `saveShort`) | `server/src/checkpoints.ts` | The save check ("within the bag"): an item is refused exactly when the save puts more on the beach than both what it already held and owned minus elsewhere, with the right counts, at most once each. Nothing kept at or below what was stored is ever refused. |
| `nothingGrew` | `server/src/checkpoints.ts` | True exactly when no item went up. Together with the line above, that's why the save route may skip the bag lookup when it's true: such a save can't be short. |
| `countIn`, `bagLeft` | `server/src/checkpoints.ts` | Helpers used in the specs; `bagLeft` is never negative. |
| `promoBonusCents` | `server/src/giftCards.ts` | A promo's bonus is never negative; a bucks code gives exactly its value; a percent code gives nothing without a pack and never more than the pack's own bucks. |
| `salePriceCents` | `server/src/creatorCredit.ts` | Given a creator offer, a returned shop price implies that the offer is approved and for sale, and that the price equals its approved price. |
| `promoBlocked` | `server/src/giftCards.ts` | Returns nothing exactly when the code is active, not expired, not used up and meant for this product. |
| `ladderAt` (behind `ladderReward`) | `server/src/referrals.ts` | The invite ladder: a reward exactly for ranks 1 to `REWARD_CAP`; the first rungs in order, then `LADDER_REST`; the extra beach at `LADDER_BEACH_RANK` and no other rank, so the ladder gives one extra beach at most. |
| `beachAllowance` | `server/src/limits.ts` | How many beaches you may have: never more than `BEACH_CAP`, never fewer than one, one more for each extra beach until the cap. |
| `checkpointLimit` | `server/src/limits.ts` | Named checkpoints: 5 per allowed beach, so never more than 40. |
| `checkpointRoom` | `server/src/limits.ts` | Room for a named checkpoint exactly when one more stays within the limit and the 16 MB store (`specs/tla/Checkpoints.tla` makes the check and the write one transaction). |
| `autoSlotFits` | `server/src/limits.ts` | An automatic copy fits exactly when the store after replacing the beach's slot stays within 16 MB; never stricter than the named check. |
| `objectsToSave` (and `yoursOf`, `wildOf`) | `src/sim/sandCodec.ts` | What a save keeps: never more than `MAX_OBJECTS`, as many as fit, your own things first and in order (so none of yours is dropped while a wild one is kept), nothing that wasn't on the beach, and `dropped` exactly how many of yours didn't fit. |
| `shortfallUnsorted` (behind `shortfall`) | `src/world/checkpointFit.ts` | The app's restore check: the same statement as the server's, with the free items passed in (from the catalog's `unlimited`). |

What this rests on (trusted, not proved):
- Counts and prices are whole numbers. LemmaScript models `number` as an
  integer; the server makes them so (beach bytes are counted per thing,
  prices are validated whole cents, promo values are validated integers).
- `Object.entries` visits every key once (true in JS).
- A placed thing's coordinates and size are floats that the model sees as
  whole numbers; `objectsToSave` only copies things, never computes with
  them, so that changes nothing it proves.
- `Array.prototype.filter` and `slice` behave as JS defines them (the model
  uses Dafny's `Seq.Filter` and a clamped slice).
- The `.sort` in `shortfall`/`saveShort` only reorders the list.
- The database rows that feed these functions (`owned`, `elsewhere`,
  `stored`) are what they claim to be. The SQL isn't verified.
- Approved prices are 0 or more: the database's `CHECK` and the review
  form enforce it; the model can't see either. (`salePriceCents` models
  the shop's own `usd` prices loosely, as whole numbers; the proof is about
  creator items only.)
- The item-submission integration tests cover admin-only catalog linking
  and removal from the shop after rejection.

The app's own copy of the restore check (`src/world/checkpointFit.ts`) only
shows an answer early; the server's verified check decides. Both cores are
proved to the same statement, and the shared fixture
`tests/fixtures/checkpoint-fit.json` keeps the wrappers (sorting, the free
items) in step.

Not proved: item sizes. `rollPlacement` (`src/world/items.ts`) and the
server's size check on saved things are floating point (`Math.pow`, a
0.05 to 4 m range), outside what LemmaScript models.

## Setup (automatic in cloud sessions)

- **Skills:** `.claude/skills/lemmascript*`, vendored unchanged from
  [midspiral/lemmascript-skills](https://github.com/midspiral/lemmascript-skills)
  (pinned commit in `.claude/skills/LEMMASCRIPT_UPSTREAM.md`). Start with the
  `lemmascript` skill; it routes to the others (design doc, claimcheck,
  counterexamples, proof review, rules for a verified codebase).
- **Tools:** `.claude/hooks/session-start.sh` installs Dafny 4.11.0
  (checksum-verified, self-contained, includes Z3) to `/opt/dafny` and
  `lemmascript@0.6.12` globally (`lsc`). Keep `LSC_VERSION` in step with the
  vendored skills.
- **Locally:** `npm i -g lemmascript@0.6.12` and a Dafny 4.11 release from
  https://github.com/dafny-lang/dafny/releases.

Smoke test:

```ts
//@ backend dafny
//@ verify
//@ requires lo <= hi
//@ ensures \result >= lo && \result <= hi
export function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}
```

`lsc check --backend=dafny clamp.verify.ts` → "2 verified, 0 errors".

## What fits here, and what doesn't

LemmaScript covers pure, deterministic logic over integers, collections
and state machines. **Floating point, randomness, I/O and the DOM are out
of its model.**

- Not a fit: the sand/water simulation (`src/sim/`, float heightfields),
  rendering, anything Babylon.
- Good candidates: integer bookkeeping and rules where a wrong answer costs
  the player something: inventory counts and item sizes, shop purchases,
  claw machine prize logic, "how much a beach holds" limits, checkpoint and
  one-active-editor rules, invite and neighbor state on the server.

## Rules once something is verified

- Verified files use the `foo.verify.ts` / `.dfy.gen` / `.dfy` layout from
  the `lemmascript` skill and are listed in `LemmaScript-files.txt` at the
  repo root. That file's existence turns on the
  `lemmascript-verified-codebase-rules` skill for every change.
- `lsc check --backend=dafny` (no file argument) must pass before commit,
  the same as `npm test`. CI runs it (`.github/workflows/`).
- Change a verified function's `.ts`, then `lsc regen --backend=dafny <file>`
  (not `check`): it keeps the hand-written proof in the `.dfy`. Commit the
  `.ts`, `.dfy` and `.dfy.gen` together.
- `*.dfy.base` is git-ignored (merge scratch from `lsc regen`).
- Never weaken a spec or drop a file from the list to get a build green;
  ask the owner.
