# Saving tokens (for agents)

Agents working in this repo should keep tool output small. Context spent on
noise is context not spent on the task, and long sessions get summarized
sooner. This page is the house style; CLAUDE.md links here.

## rtk: compact command output (installed automatically)

[rtk](https://github.com/rtk-ai/rtk) is a CLI proxy that filters and
summarizes command output (git, npm, vitest, tsc, grep, ls, ...) before it
reaches the agent, typically cutting 60-90% of the tokens.

How it is wired up:

- `.claude/hooks/session-start.sh` (SessionStart, cloud sessions only)
  installs a pinned, checksum-verified rtk to `/usr/local/bin`, then the npm
  dependencies for the app and the server (skipped when the lockfiles
  haven't changed). The cloud environment's setup script installs the same
  pinned rtk, so new containers start with it.
- `.claude/hooks/rtk-rewrite.sh` (PreToolUse on Bash) runs `rtk hook claude`,
  which rewrites supported commands, e.g. `git status` → `rtk git status`.
  It does nothing when rtk isn't installed, so local machines without rtk
  are unaffected. To install it locally:
  `cargo install --git https://github.com/rtk-ai/rtk` or a release binary.

How to work with it:

- Run commands normally; the hook rewrites them. Treat condensed output as
  the complete result. Truncated output says how to get the rest.
- If a result is clearly unusable (empty when output was expected, garbled,
  or contradicting its exit code), re-run it as `rtk bypass <cmd>`.
- **Before concluding a check passed, read the exit code / pass line.** rtk
  keeps failures and errors, but when a failure looks odd, re-run that one
  test unfiltered rather than guessing.
- `rtk gain` shows how much has been saved this session.
- To bump rtk: change `RTK_VERSION` and `RTK_SHA256` together in
  `session-start.sh` (sha256 of `rtk-x86_64-unknown-linux-musl.tar.gz`,
  listed in the release's `checksums.txt`), and in the environment setup
  script.

## Reading the big docs

Several docs are long (STATUS.md is over 1,200 lines; BACKLOG.md over 600).
Don't read them top to bottom:

- List headings first: `grep -n '^#' docs/STATUS.md`, then read only the
  section you need with `Read` + `offset`/`limit`.
- Search before reading: `Grep` for the symbol or term, then open the file
  around the hit.
- For broad "where is X handled" sweeps across many files, use the Explore
  agent; it returns conclusions, not file dumps.
- Don't open generated or vendored trees: `node_modules/`, `dist/`,
  `android/`, `ios/` (native projects; the web assets in them are generated),
  `package-lock.json`.

## Running commands

- Tests: `npx vitest run <file>` or `-t '<name>'` for the part you changed;
  the full `npm test` before committing. Add `--reporter=dot` when running
  everything without rtk.
- Builds and long scripts: pipe to `tail -n 30` when only the end matters.
- Git: `git log --oneline -n 20`, `git diff --stat` before a full diff,
  `git diff -- <path>` for one file.
- Batch independent commands into one call instead of one per turn.
- Screenshots (`scripts/shot.mjs`) are images: take one, at the size you
  need, not a series.

## Editing

- Use `Edit` with a small unique `old_string`; don't re-`Read` a file just
  to confirm an edit (the tool errors if it failed).
- Don't paste large file contents back into chat or commit messages.
