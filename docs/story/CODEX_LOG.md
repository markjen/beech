# Codex work on Beech

I reconstructed this log on November 27, 2026, from the history through
`e79f219` and the merged pull requests. The dates below are UTC merge dates.
Five PRs retain their Codex branch names. The earlier beach-state PR credits
both Claude and Codex in its squash commit, which leaves individual line
ownership unresolved.

## November 25 — Beach state follows the shore

Claude Code led the move from a single active beach to state keyed by beach ID.
That let the camera and wave worker move along the shore while each beach kept
its own sand, edits, and save state. Codex shares credit in the squash commit,
whose final listed change is “Keep shore cache and undo state in sync with the
view.” The handoff made it possible to move the live waves to another owned
beach while keeping undo history with the beach it belongs to.
[PR #100](https://github.com/markjen/beech/pull/100) · [Beach state design](../BEACH_STORE.md)

## November 26 — Checkpoints, footprints, and sign-in

- **Beach slots and checkpoints.** I showed extra-beach slot usage in the Bag
  and Beaches tab and clarified what removing a beach does. I kept one
  account-wide checkpoint list and added filters for each source beach and
  imported files. A removed beach still appears as a source, and the tests
  cover renames, duplicate names, and older records. In Chromium at a phone
  viewport, I checked the slot count through creation and removal, the removed
  beach's checkpoint filter, and gifting the freed slot.
  [PR #119](https://github.com/markjen/beech/pull/119)
- **Footprints wash away.** I made swash erase each footprint once the water
  at its center reached the erosion depth. Dry prints from the same drag stay
  visible. I made washout persist through live saves and offline tide
  catch-up, updated the guide, and added regression tests for both paths.
  [PR #124](https://github.com/markjen/beech/pull/124)
- **Sign-in is easier to find.** I added a prominent button on the title
  screen and beach view that opens the existing sign-in panel and tracks
  session state. In Chromium, I checked keyboard access, session restoration,
  sign-out, mobile touch and layout, and sandbox behavior.
  [PR #126](https://github.com/markjen/beech/pull/126)

## November 26 — Shared review and the next beach handoff

- **One review workflow for both agents.** I put the review-and-landing
  instructions in the shared `.agents` skill, added Claude Code's companion
  link, and documented the two invocation forms. The PR records checks for
  the skill metadata and link, the client suite and build, and the Dafny
  proof obligations. [PR #130](https://github.com/markjen/beech/pull/130)
- **Snapshot cache and rendering.** Claude Code's #114 kept fetched beaches
  on the device and eased snapshot water into live waves when the worker
  moved. I followed with #132, making snapshot and eviction-index changes
  atomic in IndexedDB, fencing in-flight writes when an account session
  ended, and evicting kept copies after access was revoked or a beach was
  deleted. I also made the renderer display the new beach's first worker
  frame without blending its terrain with the previous beach, and adjusted
  the sandbox reload test to tolerate differences in pointer-stroke depth.
  The PR records browser checks for concurrent writes across tabs, cache
  invalidation, and sandbox reload persistence, alongside 386 app tests,
  the production build, Dafny proofs, and browser performance budgets.
  [PR #114](https://github.com/markjen/beech/pull/114) · [PR #132](https://github.com/markjen/beech/pull/132)

## November 27 — Adding this account to the story

I matched the pull requests to their branches, compared them with the
repository history, and added this account alongside the other agents' logs.
The story page’s timeline and working-method sections now include these
contributions. The clearest handoff runs from the per-beach state refactor to persistent
snapshots to the cache and render follow-up. The shared review skill is
another concrete handoff: future sessions could pick up the same landing
instructions through either agent's entry point.
[Claude's log](CLAUDE_LOG.md) · [Antigravity's log](ANTIGRAVITY_LOG.md) · [Muse's project chronology](MUSE_LOG.md)
