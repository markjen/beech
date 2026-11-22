# beech

A calm little beach for phone and web. Draw in the sand with your finger and
watch the waves roll in and wash it away. Built with Babylon.js, using a soft,
flat-shaded diorama style.

- **Play:** `npm install && npm run dev`, then open the printed URL (it also
  works on a phone on the same Wi-Fi).
- **Design plan:** [PLAN.md](PLAN.md)
- **How the code fits together:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Milestone status and decisions:** [docs/STATUS.md](docs/STATUS.md)
- **Web deploy:** [docs/DEPLOY.md](docs/DEPLOY.md). Sandbox at https://markjen.com/beech/ (GitHub Pages)
- **Accounts, saved beaches and neighbors:** [docs/BACKEND.md](docs/BACKEND.md)
- **Production on Google Cloud (Cloud Run + Cloud SQL):** [docs/GCP.md](docs/GCP.md)
- **App Store / Google Play:** [docs/MOBILE.md](docs/MOBILE.md)
- **Working on this repo as an agent:** [CLAUDE.md](CLAUDE.md)

## Controls

| | Touch | Mouse / keyboard |
|---|---|---|
| Dig | one finger (hold to dig deeper) | left button |
| Pan | two-finger drag | middle-drag, Space+drag, WASD / arrows |
| Zoom | pinch | wheel, + / - |
| Rotate | two-finger twist (snaps to 45°) | right-drag, Q / E |
| Undo / redo | ↶ button (long-press = redo) | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z |
| Tool | dig / build / smooth buttons above undo | 1 / 2 / 3 |
| Calm waves | ≈ button | |
| Settings | ☼ button (sound, music, haptics, light, detail, save a picture, smooth the beach) | Esc closes |

The brush is always the same size on screen. Zoom in for fine detail, zoom out
for broad digs.

## Real beaches, real time

You're on a real beach: Bondi, Waikīkī, Santa Monica, South Beach, Copacabana,
Brighton, Biarritz, Camps Bay, Patong, Kuta, Nice, Kamakura or Piha. It
starts on the one in your time zone (or the nearest UTC offset). Tap the label
in the top-left to pick another, or "near me". At that beach, right now:

- **The sun and moon** are where they really are, computed from the beach's
  latitude, longitude and the current time. They light the sand from that
  direction, and the moon is drawn at its real phase.
- **Time of day** comes from the sun's height. Dawn colours come in the
  morning, golden and dusk in the evening, and stars at night.
- **The tide** comes from the harmonic constants of the nearest real tide
  gauge. Highs and lows land within minutes of official predictions. Big tide
  ranges are squashed to fit the diorama, but the timing and rise/fall are real.
- **The waves and colours** suit the place: calm and blue in Nice, big surf at
  Biarritz and Piha, black sand at Piha.

Tide data: TICON-3 (Hart-Davis, Dettmering & Seitz), PANGAEA,
https://doi.org/10.1594/PANGAEA.951610, CC-BY 4.0.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run preview` | Serve the built `dist/` on :4173 |
| `npm test` | Vitest unit tests (simulation, brush math, tides, sun and moon, sand codec) |
| `npm run server:dev` | Build with accounts + dev sign-in and run the server locally on :8787 (embedded Postgres) |
| `npm run e2e:neighbors` | Browser test: add a neighbor by code and see their beach |
| `npm run e2e:accounts` | Browser test of sign-in → dig → save → reload → restored → delete |
| `npm run smoke` | Headless browser smoke test of the built app, including offline start (needs Playwright + Chromium) |
| `npm run icons` | Regenerate PWA icons and native icon/splash sources from code |
| `npm run cap:android` / `npm run cap:ios` | Build, sync and open the native project |
| `node scripts/set-version.mjs 1.2.0 7` | Set the version name and build number everywhere |

URL parameters for development: `?quality=low|medium|high`, `?seed=N`,
`?palette=dawn|day|golden|dusk|night`, `?beach=bondi|waikiki|…`,
`?time=2026-11-22T06:30:00Z` (start the clock elsewhere), `?speed=60`
(time-lapse), `?debug=1`.
