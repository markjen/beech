# Agent guide for this repo

This repo is set up so that an agent can pick up any task without other context.
Read these first:

1. [PLAN.md](PLAN.md): the design (look, simulation, input, milestones).
2. [docs/STATUS.md](docs/STATUS.md): what is done, what isn't, and decisions
   that differ from the plan. **Update it whenever you finish or change
   something.**
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module map and data flow.
4. [docs/BACKLOG.md](docs/BACKLOG.md): the to-do list (owner tasks,
   engineering queue, ideas). Take work from here, and update it in the same
   commit as the work.
5. Feature designs not built yet, e.g. [docs/MULTI_BEACH.md](docs/MULTI_BEACH.md),
   [docs/INBOX_NOTIFICATIONS.md](docs/INBOX_NOTIFICATIONS.md) (push not built yet),
   [docs/LIVE_SIM.md](docs/LIVE_SIM.md) (the sea works while you're away,
   live viewers), and
   [docs/BEACH_FILE.md](docs/BEACH_FILE.md) (export/import file spec).
   The public shore site (beechshore.com) is in [docs/SHORE_SITE.md](docs/SHORE_SITE.md).
6. [docs/AGENT_TOKENS.md](docs/AGENT_TOKENS.md): how to keep tool output
   small. Cloud sessions install [rtk](https://github.com/rtk-ai/rtk), and a
   Bash hook in `.claude/settings.json` routes commands through it; treat its
   condensed output as complete, and use `rtk bypass <cmd>` only when a
   result is unusable. Read big docs (STATUS.md, BACKLOG.md) by heading, not
   whole.
7. [docs/VERIFICATION.md](docs/VERIFICATION.md): formal verification of
   TypeScript with LemmaScript + Dafny. Skills are in
   `.claude/skills/lemmascript*` (load `lemmascript` first); cloud sessions
   install `lsc` and `dafny`. If `LemmaScript-files.txt` exists,
   `lsc check --backend=dafny` must pass before every commit.

## Ground rules

- **Git & PR workflow:** Always push finished work to GitHub. For bigger or higher-risk changes, push a feature branch and open a pull request. For smaller, high-confidence changes, push directly to `main`.
- `npm test` and `npm run build` must pass before every commit. CI runs both.
- The simulation (`src/sim/`) is plain TypeScript with no DOM or Babylon
  imports, so it runs in a Web Worker and in Vitest. Keep it that way.
- All tuning constants live in `src/config.ts`; all colours live in `src/palette.ts`.
- Physics changes need a test in `tests/sim.test.ts`, covering at least
  conservation and stability.
- Visual changes: check with the screenshot helper before committing:
  `npx vite --port 5173 &` then
  `node scripts/shot.mjs http://localhost:5173/ out.png 1280 800 3000`
  (use 390x844 for a phone).
- The app must stay playable after every commit (a milestone rule).
- Sandbox build changes (no accounts): `npx vite --port 5173 &` then
  `npm run e2e:sandbox` (the beach kept on the device, local checkpoints).
- Performance: changes to rendering, the simulation or the worker messages
  must stay within [perf/budget.json](perf/budget.json): `npm run build &&
  npm run perf`. CI checks it on main and on pull requests; see
  [docs/PERFORMANCE.md](docs/PERFORMANCE.md). Raise a budget only on
  purpose, in the same commit, and say why.
- **No notes in the game UI.** No tips, rules, explanations, odds or small
  print in the game: only labels, status (timers, loading, errors) and
  confirmations. All of that lives in the user guide at
  https://beech.games/guide (`server/src/guide.ts`, linked from settings →
  "guide & help"). When a feature changes how the game works, update the
  guide in the same commit.
- **Release notes:** every change a player can notice adds a plain-words line
  to `server/src/releaseNotes.ts` (newest first; same day, same entry), shown
  at https://beech.games/guide/releases. Never mention the claw's starter
  gifts there or in the guide (they're a surprise, #9).
- Never put secrets in the repo. Store-signing material for the native apps
  stays outside git (see docs/MOBILE.md).
- After web changes that should ship in the apps, run `npx cap sync`. Don't
  hand-edit `android/app/src/main/assets/public` or `ios/App/App/public`; they
  are generated and git-ignored.
- Two builds: the sandbox (default `npm run build`; no accounts — no longer
  published anywhere since GitHub Pages was removed) and production (`VITE_ACCOUNTS=1 …`, served by the Node server in
  `server/`, which runs on Cloud Run, see docs/GCP.md). Keep anything that needs the network behind `ACCOUNTS_ENABLED`.
- Server changes: `cd server && npm run typecheck && npm test` (PGlite; set
  `TEST_DATABASE_URL` to also run against real Postgres), then
  `npm run server:dev` with `npm run e2e` (runs all 9 server E2E scripts in
  parallel; individual scripts are `e2e:accounts`, `e2e:neighbors`, `e2e:shore`,
  `e2e:beaches`, `e2e:leaderboard`, `e2e:checkpoints`, `e2e:invites`,
  `e2e:inbox`, `e2e:live`).
  Schema changes are new entries appended to `server/src/migrations.ts`, never
  edits to applied ones. Never enable `DEV_AUTH` outside local development.
- Android builds here need an SDK: install the command-line tools to a scratch
  dir, set `ANDROID_HOME`, then `cd android && ./gradlew assembleDebug`. iOS
  builds need macOS; rely on the `mobile.yml` CI job.
