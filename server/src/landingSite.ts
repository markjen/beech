// The beech.games landing page: https://beech.games/ (and /landing on
// every other host, so it works before the domain does).
//
// Same hand-rolled style as the guide (server/src/guide.ts): server-rendered
// HTML, no JS build, system fonts, light/dark via prefers-color-scheme, the
// same warm palette. Numbers that the server decides are read from the same
// constants the server and the guide use, so the page can't drift from the
// game. Only claim what is true: the game is free in the browser now, the
// phone apps are coming (no store listing is live), and there are no
// screenshots here (the only ones in the repo show a test account).
//
// Starter gifts are a surprise (#9): never mention them here.

import { BEACH_CAP } from './app.js';
import { CHECKPOINTS_PER_BEACH } from './checkpoints.js';
import { DIG_FIND_DAILY_CAP } from './digFinds.js';
import { COOLDOWN_MAX_MS, COOLDOWN_MIN_MS } from './pulls.js';
import { RELEASE_NOTES } from './releaseNotes.js';
import { escapeHtml as esc } from './shareMeta.js';

export const LANDING_GAME_URL = 'https://play.beech.games';

const minutes = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m >= 60 && m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`;
};

/** The landing page. `gameUrl` is where the Play button goes. */
export function landingHtml(gameUrl: string = LANDING_GAME_URL): string {
  const newest = RELEASE_NOTES.slice(0, 2);
  const whatsNew = newest
    .map(
      (r) => `<article class="release">
  <h3>${esc(r.title)}</h3>
  <time datetime="${esc(r.date)}">${esc(new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }))}</time>
  <ul>${r.changes.slice(0, 3).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
</article>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>beech — a quiet place by the sea</title>
<meta name="description" content="beech is a quiet place by the sea: shape the sand, watch the waves, and build a beach of your own. Free to play in your browser.">
<link rel="canonical" href="https://beech.games/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="beech">
<meta property="og:title" content="beech — a quiet place by the sea">
<meta property="og:description" content="Shape the sand, watch the waves, and build a beach of your own. Free to play in your browser.">
<meta property="og:url" content="https://beech.games/">
<meta property="og:image" content="https://beech.games/icons/icon-512.png">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/icons/icon-192.png">
<style>
:root { --bg: #fbf3e6; --fg: #4a3f52; --muted: #7a6584; --line: #e8d8c2; --card: #fffaf2; --accent: #5f7287; --sand: #f2dfba; --sea: #9fc3d4; }
@media (prefers-color-scheme: dark) { :root { --bg: #1f2430; --fg: #efe6f0; --muted: #b8a9c0; --line: #3a4152; --card: #272d3b; --accent: #9fb4cc; --sand: #4a4030; --sea: #33505f; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
header, main, footer { max-width: 760px; margin: 0 auto; padding: 0 16px; }
a { color: var(--accent); }
.hero { text-align: center; padding: 64px 16px 40px; }
.hero img { width: 96px; height: 96px; border-radius: 22px; }
.hero h1 { font-size: 44px; font-weight: 600; letter-spacing: 0.02em; margin: 16px 0 0; }
.hero .tag { font-size: 20px; color: var(--muted); margin: 4px 0 16px; }
.hero p { max-width: 560px; margin: 0 auto 24px; }
.cta { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
.cta a { display: inline-block; padding: 12px 22px; border-radius: 999px; text-decoration: none; font-weight: 600; }
.cta .play { background: var(--accent); color: var(--bg); }
.cta .guide { border: 1px solid var(--line); color: var(--fg); background: var(--card); }
.band { height: 8px; background: linear-gradient(90deg, var(--sea) 0 55%, var(--sand) 55% 100%); border-radius: 4px; max-width: 760px; margin: 8px auto 0; }
h2 { margin: 44px 0 8px; font-weight: 600; font-size: 22px; }
h3 { margin: 0 0 2px; font-size: 16px; }
.sub { color: var(--muted); margin: 0 0 16px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.card p { margin: 0; font-size: 15px; }
.release { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 4px 16px 8px; margin: 16px 0; }
.release h3 { margin-top: 12px; }
.release time { color: var(--muted); font-size: 14px; }
footer { color: var(--muted); font-size: 14px; padding: 40px 16px 32px; text-align: center; }
footer nav { display: flex; flex-wrap: wrap; gap: 6px 18px; justify-content: center; margin-bottom: 12px; }
@media (max-width: 560px) { .grid { grid-template-columns: 1fr; } .hero h1 { font-size: 36px; } }
</style>
</head>
<body>
<header class="hero">
  <img src="/icons/icon-192.png" alt="beech icon" width="96" height="96">
  <h1>beech</h1>
  <p class="tag">a quiet place by the sea.</p>
  <p>Shape the sand, watch the waves rework it, and build a beach of your own — a stretch of sand that follows a real beach, its tide, sun and moon.</p>
  <div class="cta">
    <a class="play" href="${esc(gameUrl)}">Play in your browser →</a>
    <a class="guide" href="/guide">How to play</a>
  </div>
</header>
<div class="band" aria-hidden="true"></div>
<main>
<h2>What you do</h2>
<p class="sub">Dig, build, and set things down. The sea does the rest.</p>
<div class="grid">
  <div class="card"><h3>Shape the sand</h3><p>Dig, build, and smooth. Every stroke can be undone — and the waves wear down what you build, while the sea fills holes near the water.</p></div>
  <div class="card"><h3>Find things</h3><p>The sea washes shells, sea glass and driftwood in. Dig deep enough and you may turn something buried up — up to ${DIG_FIND_DAILY_CAP} finds a day.</p></div>
  <div class="card"><h3>Claw machine</h3><p>Free to play when you’re signed in. After each go the claw rests a random time between ${minutes(COOLDOWN_MIN_MS)} and ${minutes(COOLDOWN_MAX_MS)} — shorter when the ball slips out, longer when you win.</p></div>
  <div class="card"><h3>Vending machine</h3><p>One free ball a day, from a set that changes every week. A vending ball never slips.</p></div>
  <div class="card"><h3>Your bag</h3><p>Rocks, driftwood, shells, sea glass and flags are free and never run out. Things you won or bought can be gifted to the owner of another beach.</p></div>
  <div class="card"><h3>More than one beach</h3><p>Up to ${BEACH_CAP} beaches of your own, each open on a different device at the same time — your phone and your TV can show different ones.</p></div>
  <div class="card"><h3>Neighbors and the shore</h3><p>Link beaches by code, walk the whole shore past your neighbors into everyone else’s beaches, and keep favorites.</p></div>
  <div class="card"><h3>Leaderboard</h3><p>The most-starred beaches of all time, and the ones rising this week.</p></div>
  <div class="card"><h3>Checkpoints</h3><p>Keep up to ${CHECKPOINTS_PER_BEACH} named copies of a beach and put them back — on that beach, or another of yours.</p></div>
  <div class="card"><h3>Beach files</h3><p>Export a beach as a file and import it again, on the web and in the apps.</p></div>
  <div class="card"><h3>Shop</h3><p>A deckchair, parasol, surfboard, tiki torches, sandcastle, beach hut and lighthouse, plus extra beaches. On the web you pay by card; gift cards and promo codes work on the web too.</p></div>
  <div class="card"><h3>Room to build</h3><p>A beach holds up to 2000 things. Sand doesn’t count: dig and build as much as you like.</p></div>
</div>

<h2>What’s new</h2>
${whatsNew}
<p><a href="/guide/releases">All release notes →</a></p>

<h2>Where to play</h2>
<p><b>Free in your browser now</b> — no download, no install: <a href="${esc(gameUrl)}">play.beech.games</a>. Sign in to keep your beach, have neighbors, and play the machines.</p>
<p>iPhone and Android apps are coming.</p>
</main>
<footer>
<nav>
  <a href="/guide">Guide</a>
  <a href="/guide/releases">Release notes</a>
  <a href="/privacy.html">Privacy</a>
  <a href="${esc(gameUrl)}">Play</a>
  <a href="mailto:hello@beech.games">hello@beech.games</a>
</nav>
beech · a quiet place by the sea
</footer>
</body>
</html>`;
}
