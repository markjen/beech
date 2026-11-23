# beech.games: the landing page

Status: **built** (2026-11-23).

The home page for beech: what it is, what you do in it, what's new, and
where to play. It is the place people land from a search or a shared link,
and it sends them on into the game.

## What's on it

| URL | What |
|---|---|
| `/` (on `beech.games`) | The landing page: hero ("beech — a quiet place by the sea"), Play in your browser → `https://play.beech.games`, How to play → `/guide`, "What you do", "What's new", where to play, footer. |
| `/landing` (every other host) | The same page, for preview before the domain flips — e.g. `https://play.beech.games/landing`, or `http://localhost:8787/landing` in development. |
| `/guide`, `/guide/releases` | The user guide and release notes; they keep working on the landing hosts too, and the landing page links to them. |

Numbers on the page (claw rest, digging finds a day, beaches, checkpoints)
come from the same server constants the game and the guide use
(`server/src/landingSite.ts`), so the page can't drift from the game.
"What's new" renders the newest two entries from
`server/src/releaseNotes.ts` — the same data as `/guide/releases`.

What the page does **not** claim:

- No store listing is live: iPhone and Android apps are "coming". No store
  badges, no download links. (Play internal-track upload status is
  unverified; Apple enrollment is unconfirmed.)
- No screenshots: the only ones in the repo (PR #27) show a test account
  and a test beach code. The page uses the existing icon
  (`public/icons/icon-192.png`) and CSS only.
- No privacy link yet: `public/privacy.html` lives in unmerged PR #27
  (`feat/play-store-assets`). Do not duplicate or rewrite the privacy text;
  link it from the footer once that PR merges.

SEO basics are in: `<title>`, meta description, canonical
`https://beech.games/`, Open Graph tags (`og:image` →
`https://beech.games/icons/icon-512.png`).

## How it's served

The game's own server (`beech` on Cloud Run) serves it; no new service.
`server/src/rootApp.ts` checks the `Host` header:

- `LANDING_HOSTS` (default `beech.games,www.beech.games`): the whole host
  is the landing page. `www` 301s to the apex, keeping the path. The game
  API is not served there — `/api/*` on a landing host gets the landing
  page, not the game. `/healthz` still answers `ok`.
- Two things still answer on a landing host: the guide (`/guide`,
  `/guide/releases`, `/help`, `/releases`) and the landing page's own icon
  (`/icons/*`, `/favicon-32.png`, `/apple-touch-icon.png` — the page and
  its `og:image` need them).
- Every other host: the page lives under `/landing`.

Environment (server.ts): `LANDING_URL` (default `https://beech.games`),
`LANDING_HOSTS`, `GAME_URL` (default `https://play.beech.games`).

Server tests: `server/test/rootApp.test.ts`, "the landing page and host
routing" — landing host serves the page, www 301s, no game API on a landing
host, `/healthz` and `/guide` still work there, `/landing` previews on the
game host, the game host still serves the game at `/`.

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

- Privacy link in the footer, once PR #27 merges `public/privacy.html`.
- Wire the landing uptime check into the `beech: site or API down` alert
  policy (`google_monitoring_alert_policy.uptime` in
  `infra/monitoring.tf`). It was left out because the policy's conditions
  reference the checks by index, and a new condition that only exists when
  the landing domain is set needs a `dynamic` block (or a separate policy).
- Import the existing manual `beech.games` apex mapping into Terraform
  state (optional; see above).
- PR #28 ("Docs: beech.games is the main domain") is still open; this
  page and its docs supersede the `beech.games` parts of it.
