# beech

A calm little beach for phone and web. Draw in the sand with your finger and
watch the waves roll in and wash it away. Built with Babylon.js, using a soft,
flat-shaded diorama style.

- **Play:** `npm install && npm run dev`, then open the printed URL (it also
  works on a phone on the same Wi-Fi).
- **Design plan:** [PLAN.md](PLAN.md)
- **How the code fits together:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Milestone status and decisions:** [docs/STATUS.md](docs/STATUS.md)
- **Working on this repo as an agent:** [CLAUDE.md](CLAUDE.md)

## Controls

| | Touch | Mouse / keyboard |
|---|---|---|
| Dig | one finger (hold to dig deeper) | left button |
| Pan | two-finger drag | middle-drag, Space+drag, WASD / arrows |
| Zoom | pinch | wheel, + / - |
| Rotate | two-finger twist (snaps to 45°) | right-drag, Q / E |
| Undo / redo | ↶ button (long-press = redo) | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z |

The brush is always the same size on screen. Zoom in for fine detail, zoom out
for broad digs.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run preview` | Serve the built `dist/` on :4173 |
| `npm test` | Vitest unit tests (simulation, brush math) |
| `npm run smoke` | Headless browser smoke test of the built app (needs Playwright + Chromium) |

URL parameters for development: `?quality=low|medium|high`, `?seed=N`,
`?palette=dawn|day|golden|dusk`, `?debug=1`.
