# Agent guide for this repo

This repo is set up so that an agent can pick up any task without other context.
Read these first:

1. [PLAN.md](PLAN.md): the design (look, simulation, input, milestones).
2. [docs/STATUS.md](docs/STATUS.md): what is done, what isn't, and decisions
   that differ from the plan. **Update it whenever you finish or change
   something.**
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module map and data flow.

## Ground rules

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
- Never put secrets in the repo. Store-signing material for the native apps
  stays outside git (see docs/MOBILE.md).
- After web changes that should ship in the apps, run `npx cap sync`. Don't
  hand-edit `android/app/src/main/assets/public` or `ios/App/App/public`; they
  are generated and git-ignored.
- Android builds here need an SDK: install the command-line tools to a scratch
  dir, set `ANDROID_HOME`, then `cd android && ./gradlew assembleDebug`. iOS
  builds need macOS; rely on the `mobile.yml` CI job.
