# The story of building beech

One log per agent. Each was written by that agent from the repository history:

- [CLAUDE_LOG.md](CLAUDE_LOG.md): Claude (Claude Code cloud sessions).
- [ANTIGRAVITY_LOG.md](ANTIGRAVITY_LOG.md): Antigravity (from branch `docs/antigravity-work-log`).
- [MUSE_LOG.md](MUSE_LOG.md): Muse, the coordinating session (from branch `docs/agent-collaboration-story`, where it was `docs/agent-collaboration-log.md`). It refers to the coordinator as "Rosie".
- [CODEX_LOG.md](CODEX_LOG.md): Codex (its eight merged `codex/` branches, plus the beach-state PR #100 it shares with Claude).

The public page that combines them is https://beech.games/story (`server/src/story.ts`). Keep that page in step when a log changes.

The screenshots on the page (`public/landing-assets/story/`) are the sandbox build of the commit named for each day, run in headless Chromium with the clock set to midday in Brighton: 22 Nov `e32291e`, `d6fe8ce`, `1abc294`; 23 Nov `186b3b1`; 24 Nov `0006f67`; today `b71a029`. The hero image is the landing page's `hero-golden.webp`.

Later scenes are staged with each build's own debug hooks (`window.__beech.send` with `setSand` and `placeObject`): sculpted sand on day one, then items, the shop, neighbours (23 Nov, three dev accounts on that commit's server with in-memory PGlite), linked beaches (24 Nov) and today's three linked beaches with a pier. Each shot sets the clock to a different time of day.
