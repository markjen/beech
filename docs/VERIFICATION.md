# Formal verification (LemmaScript + Dafny)

Agents in this repo can formally verify TypeScript with
[LemmaScript](https://github.com/midspiral/LemmaScript): `//@` annotations
(`requires`, `ensures`, invariants) on ordinary TypeScript, compiled to
[Dafny](https://dafny.org) and proved with Z3. The TypeScript ships
unchanged; the proof lives next to it.

Nothing in the game is verified yet. This page says how the tooling is set
up and where it fits.

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
  the same as `npm test`. Add it to CI when the first file lands.
- `*.dfy.base` is git-ignored (merge scratch from `lsc regen`).
- Never weaken a spec or drop a file from the list to get a build green;
  ask the owner.
