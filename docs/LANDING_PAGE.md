# beech.games: the landing page

Status: **built** (2026-11-23; hero redesign + Google Play link 2026-11-24; hero splash graphic 2026-11-24).

The home page for beech: what it is, what you do in it, what's new, and
where to play. It is the place people land from a search or a shared link,
and it sends them on into the game.

## What's on it

| URL | What |
|---|---|
| `/` (on `beech.games`) | The landing page: a full-width hero splash illustration (`public/hero-beach.jpg`, 2048×1152) above the headline ("Shape the sand, stay for the tide."), **Play now on web** → `https://play.beech.games`, **Google Play** → `https://play.google.com/store/apps/details?id=app.beech.beach`, **iOS coming soon** badge, How to play → `/guide`, "What you do", "Where to play", "What's new", "Talk to us" (Discord), footer. |
| `/landing` (every other host) | The same page, for preview before the domain flips — e.g. `https://play.beech.games/landing`, or `http://localhost:8787/landing` in development. |
| `/hero-beach.jpg` | The hero splash (JPEG, quality 83, ~172 KB): a sunny illustrated beach — red-and-white lighthouse, beach hut, striped parasol, sandcastle, shells — drawn as a fancy version of a beach you could actually build in the game. An illustration, not a screenshot or an in-game render. It is also the `og:image` / `twitter:image`. |
| `/landing-assets/*` | Clean UI-free 3D beach diorama renders (`hero-day.webp`, `hero-golden.webp`, `hero-dawn.webp`, `hero-dusk.webp`, `og-card.jpg`) captured directly from the beech engine with no test account or HUD. No longer referenced by the landing page since the hero splash replaced the time-of-day diorama showcase; kept for now, remove in a follow-up if nothing else uses them. |
| `/guide`, `/guide/releases` | The user guide and release notes; they keep working on the landing hosts too, and the landing page links to them. |
| `/privacy.html` (`/privacy` → 301) | The privacy policy (`public/privacy.html`); it answers on the landing hosts too, and on every other host as a static file. The footer links it. |

Numbers on the page (claw rest, digging finds a day, beaches, checkpoints)
come from the same server constants the game and the guide use
(`server/src/landingSite.ts`), so the page can't drift from the game.
"What's new" renders the newest two entries from
`server/src/releaseNotes.ts` — the same data as `/guide/releases`.

Community: the page links the Discord server for feedback, bug reports and
ideas — a "Talk to us" section and a link in the footer nav, plus the same
link in the shore footer and at the bottom of the in-game account panel. The
invite URL lives in one place, `server/src/community.ts`
(`DISCORD_INVITE_URL`); it is the server's permanent invite
(`https://discord.gg/y7EGw2yg2d`).

Store links & claims:

- **Web**: "Play now on web" links to `https://play.beech.games`.
- **Android**: "Get it on Google Play" links to `https://play.google.com/store/apps/details?id=app.beech.beach` (`GOOGLE_PLAY_URL`).
- **iOS**: clearly marked **iOS coming soon** with no App Store link yet.
- **Artwork**: the hero splash is an illustration (`public/hero-beach.jpg`),
  not a screenshot or an in-game render — never call it one. The older
  clean UI-free in-game 3D renders live under `public/landing-assets/` (no
  test account or beach code).
- **Privacy**: linked in the footer → `/privacy.html` (the approved text,
  `public/privacy.html`). Do not duplicate or rewrite the privacy text.

SEO basics are in: `<title>`, meta description, canonical
`https://beech.games/`, Open Graph tags (`og:image` →
`https://beech.games/hero-beach.jpg`, 2048×1152, `summary_large_image`).

## How it's served

The game's own server (`beech` on Cloud Run) serves it; no new service.
`server/src/rootApp.ts` checks the `Host` header:

- `LANDING_HOSTS` (default `beech.games,www.beech.games`): the whole host
  is the landing page. `www` 301s to the apex, keeping the path. The game
  API is not served there — `/api/*` on a landing host gets the landing
  page, not the game. `/healthz` still answers `ok`.
- Four things still answer on a landing host: the guide (`/guide`,
  `/guide/releases`, `/help`, `/releases`), the privacy policy
  (`/privacy.html`; `/privacy` redirects to it), the landing page's own
  artwork (`/landing-assets/*`) and hero splash (`/hero-beach.jpg`), and
  icons (`/icons/*`, `/favicon-32.png`, `/apple-touch-icon.png`).
- Every other host: the page lives under `/landing`.

Environment (server.ts): `LANDING_URL` (default `https://beech.games`),
`LANDING_HOSTS`, `GAME_URL` (default `https://play.beech.games`).

Server tests: `server/test/rootApp.test.ts`, "the landing page and host
routing" — landing host serves the page, www 301s, no game API on a landing
host, `/healthz` and `/guide` still work there, `/hero-beach.jpg` serves on
a landing host (200, image/jpeg) and the landing HTML shows it, `/landing`
previews on the game host, the game host still serves the game at `/`.

## Turning on the domain (owner)

The code is already deployed in the `beech` service; `/landing` works now.
What is left is the DNS cutover in Squarespace (the `beech.games` zone):

1. Read the DNS records from the existing `beech.games` Cloud Run domain
   mapping — it was created manually with
   `gcloud beta run domain-mappings create` and its records are not in the
   repo. Get them with
   `gcloud beta run domain-mappings describe --service beech --domain beech.games --region $REGION`
   (or in the Cloud Console, Cloud Run → beech → Domain mappings).
2. In Squarespace, change the apex and `www` records from Squarespace's
   parking records to the records from step 1. Certificate provisioning
   waits on DNS.
3. Terraform (optional, later): `terraform apply
   -var landing_custom_domain=www.beech.games` creates the `www` mapping
   and an uptime check for the landing page (gated on the same variable;
   it is not yet wired into the uptime alert policy — see the follow-up
   below). Do **not** import the existing manual apex mapping into state
   as part of this step; that is a separate, optional step — if it is
   imported later, `custom_domain` should be set to `beech.games`
   (infra/README.md §6).

Nothing else changes: the server already answers to those hosts.

## Not done yet

- PR #40 (Discord links) is a draft until the invite is confirmed: it now
  carries the server's permanent invite
  (`https://discord.gg/y7EGw2yg2d`) in `server/src/community.ts`, read by
  every surface (landing, shore, in-game) from that one place.
- Wire the landing uptime check into the `beech: site or API down` alert
  policy (`google_monitoring_alert_policy.uptime` in
  `infra/monitoring.tf`). It was left out because the policy's conditions
  reference the checks by index, and a new condition that only exists when
  the landing domain is set needs a `dynamic` block (or a separate policy).
- Import the existing manual `beech.games` apex mapping into Terraform
  state (optional; see above).
- PR #28 ("Docs: beech.games is the main domain") is superseded by this PR:
  it pointed the game at beech.games.
