// How beech was built: https://beech.games/story
//
// A public page telling how the whole of beech (the game, the server, the
// apps, beechshore.com) was built in a few days by one person steering
// several AI agents. The source logs, one per agent, live in docs/story/
// (CLAUDE_LOG.md, ANTIGRAVITY_LOG.md, MUSE_LOG.md); keep this page in step
// with them. Codex has no log yet.
//
// Never mention the claw's starter gifts here (#9).

import { escapeHtml as esc } from './shareMeta.js';

interface Agent {
  name: string;
  role: string;
  /** what this agent turned out to be best at, in a line */
  bestAt: string;
  /** the areas it did most of */
  mostly: string[];
  did: string[];
}

const AGENTS: Agent[] = [
  {
    name: 'Mark',
    role: 'The one human. Owner, product lead, reviewer.',
    bestAt: 'Deciding. Short calls that every agent applied across the whole task.',
    mostly: ['Product calls', 'Merging', 'Accounts and consoles'],
    did: [
      'Wrote the direction, usually as one line: “Lets do it”, “Change promo codes to always be for bonus bb”, “Keep the free API as-is”.',
      'Did every step that needs a person: domains, the Apple and Google consoles, store listings, signing keys, secrets.',
      'Merged the pull requests once review passed and CI was green.',
    ],
  },
  {
    name: 'Claude',
    role: 'Claude Code in cloud sessions. Most of the code.',
    bestAt: 'Building whole features end to end: the model, server, client, tests, guide and release note, all in one change.',
    mostly: ['Simulation and rendering', 'Game features', 'Game server', 'Formal verification', 'Docs and process'],
    did: [
      'Worked in at least 33 separate cloud sessions, many at once, each on its own branch. Around 190 commits carry its name.',
      'Built the simulation and renderer on day one (milestones M0 to M7), then most features after: multi-beach, checkpoints, beach files, live beaches, animals, piers, inland rows, push notifications, beech bucks.',
      'Brought in the rules that kept everyone safe: performance budgets, formal verification with Dafny, and TLA+ models written before the code.',
      'Reviewed and finished other agents’ pull requests: rebasing them, fixing focus bugs, adding missing tests.',
    ],
  },
  {
    name: 'Antigravity',
    role: 'A second coding agent. Desktop, UI, performance, economy.',
    bestAt: 'Platform and performance: native shells, bundle size, hot loops, and tidying how the interface is laid out.',
    mostly: ['Steam and desktop', 'Performance', 'Navigation and UI', 'Admin tooling'],
    did: [
      'Steam S1: one runtime layer shared by web, phone and Steam builds, plus the Electron and Steamworks shell (#52).',
      'Grouped the sand tools and added a hide-everything pan mode (#73). Reworked navigation on beechshore.com (#145) and in the shop (#146).',
      'A performance pass that cut the main bundle by 10 to 14% and the simulation tick by 6 to 9% (#153).',
      'Promo codes loaded onto an account, plus admin corrections and refunds, starting from a TLA+ model that caught a race (#148).',
    ],
  },
  {
    name: 'Muse',
    role: 'The coordinating session. Review, release, players.',
    bestAt: 'Production. Getting beech live and keeping it running: domains, deploys, secrets, app stores, and the players.',
    mostly: ['Production setup', 'Releases and stores', 'Review and merge', 'Player feedback', 'Bug fixes'],
    did: [
      'Set up production: the domains (beech.games, play.beech.games, beechshore.com), Cloud Run deploys, secrets and their access grants, and the steps in the Apple, Google and Play consoles that ran alongside them.',
      'Shipped the apps: Play internal and closed testing tracks, the merchant account and beech bucks products, Apple Developer enrollment, and the first TestFlight build. It traced the Android sign-in error to an unregistered signing key.',
      'Ran operations: chasing alerts (the “slow database” turned out to be push ticks on throttled instances, so they moved to Cloud Scheduler) and getting a deploy that had failed five times to land.',
      'Ran the review loop. A review agent gives each PR a verdict of READY or NEEDS WORK, a fix-up agent clears the blockers, then the PR is reviewed again.',
      'Watched the Beech Discord every five minutes. Bugs players reported became fixes, such as #96, #138 and #140, and the reporter got a reply when each shipped.',
    ],
  },
  {
    name: 'Codex',
    role: 'OpenAI’s coding agent. Notes still to come.',
    bestAt: 'Untangling client state: making the game keep each beach by id, with no single “active” beach.',
    mostly: ['Client architecture', 'Rendering'],
    did: [
      'Uses the same review-pr skill as the Claude sessions (#130), so every PR got the same review.',
      'Co-wrote the switch to keeping beach state by id, so waves follow the view (#100).',
      'Its own log hasn’t been written yet. This section will grow when it is.',
    ],
  },
];

interface Day {
  date: string;
  title: string;
  points: string[];
}

const DAYS: Day[] = [
  {
    date: '22 Nov',
    title: 'The game in a day',
    points: [
      'It began with one file, PLAN.md: the look, the simulation, the input and the milestones.',
      'By evening it had: sand you can dig, waves with foam and erosion, procedural sound and haptics, day-cycle colours, a PWA, and iOS and Android shells.',
      'Then live tides at 13 real beaches, Google Cloud hosting written in Terraform, Google and Apple sign-in, neighbours, the claw machine and the vending machine.',
    ],
  },
  {
    date: '23 Nov',
    title: 'Going live',
    points: [
      'New domains: beech.games, play.beech.games and beechshore.com. The guide moved off the game screen and onto the website.',
      'The shop opened, with purchases checked with Apple and Google. More than one beach per player, checkpoints, and beach files you can export and import.',
      'Version 1.0.0 went up as the first Play Store build. Things on a beach became GPU instances, so a beach now holds 2,000 of them instead of 400.',
    ],
  },
  {
    date: '24 Nov',
    title: 'Animals, Steam, live beaches',
    points: [
      'The busiest day by commits. Animals landed in five steps: sand crab, snacks, resident pets, visitor feeding, dolphin.',
      'Steam S1 to S4: desktop shell, sign-in, wallet checkout, achievements and controller.',
      'Live beaches: the sea keeps working while you’re away, and visitors watch your changes as you make them. Linked neighbours blend into one continuous beach.',
    ],
  },
  {
    date: '25 Nov',
    title: 'Getting it right',
    points: [
      'The palm-first interface: at rest the screen is just the beach and a palm. Local weather follows the beach you’re looking at.',
      'A permissions audit, then formal verification: the game’s state machines were modelled in TLA+, which found five races, and from then on every new feature started with a model.',
      'The Android app became a hosted shell, so web changes reach phones without a new build. Copying beaches, and the first version of the currency.',
    ],
  },
  {
    date: '26 Nov',
    title: 'Breadth',
    points: [
      'About 40 pull requests in one day: piers, inland rows, six pet species, real weather at 34 beaches, push notifications on web, phone and Steam.',
      'Sand bucks were renamed beech bucks, because a player asked on Discord. Sign-ins can now be linked, and two accounts merged.',
      'Build 7, the first that could send push notifications, reached closed testing on Play. The iOS build went to TestFlight review.',
    ],
  },
  {
    date: '27 Nov',
    title: 'Polish',
    points: [
      'Sign-in on beechshore.com. Promo codes changed to give bonus beech bucks only, built model first, as were multi-item trade-ins and admin system messages.',
      'Paid items got bigger and piers stand clear of storm waves. Flaky end-to-end tests were fixed.',
    ],
  },
];

const PRACTICES: [string, string][] = [
  ['Docs are the shared memory', 'No agent remembers the last session. CLAUDE.md, PLAN.md, STATUS.md and BACKLOG.md hold the state, and every change updates them in the same commit. Any agent can pick up any task cold.'],
  ['One branch per agent, one gate for all', 'Agents work in parallel on their own branches or worktrees and never share a checkout. Nothing reaches main unless tests, the build and the performance budget pass, and the game has to stay playable after every commit.'],
  ['Review, then fix-up', 'A review agent gives every pull request READY or NEEDS WORK with specific blockers. A fix-up agent clears them, then the PR is reviewed again. That loop caught migration-number collisions, a verified datatype left stale, and a migration that would have dropped a ledger kind.'],
  ['Model first', 'Anything that changes state the server keeps (money, items, pets, limits) starts as a TLA+ spec that the TLC model checker must pass. The model decides what has to be one transaction and under which lock, and the tests replay what TLC found.'],
  ['Agents finish each other’s work', 'A content PR from one agent was often finished by another, which fixed its renders, rebased it over a parallel rename, or extended its formal model (PromoCodes.tla became PromoBucks.tla).'],
  ['Players in the loop', 'Discord bug reports became pull requests the same day, and the person who reported each bug got a reply when the fix shipped. Requests that clash with a shipped design go to Mark as a decision; they aren’t built quietly.'],
  ['People do the human parts', 'Agents write the code, review and deploy. Domains, store consoles, keys and money stay with a person, and the agents write the checklists for those steps.'],
];

/** Who led (2) or helped with (1) each area, in AGENTS order. */
const WHO: [string, number[]][] = [
  ['The sand, waves and 3D look', [1, 2, 1, 0, 1]],
  ['Gameplay features', [1, 2, 1, 1, 0]],
  ['Game server and database', [0, 2, 1, 1, 0]],
  ['Formal models (TLA+, Dafny)', [0, 2, 1, 0, 0]],
  ['Performance', [0, 2, 2, 0, 0]],
  ['Steam and desktop', [0, 1, 2, 0, 0]],
  ['Menus and navigation', [0, 1, 2, 1, 0]],
  ['Client state and structure', [0, 1, 0, 0, 2]],
  ['Production: domains, deploys, secrets', [1, 1, 0, 2, 0]],
  ['App store releases', [1, 1, 0, 2, 0]],
  ['Review and merging', [2, 1, 0, 2, 1]],
  ['Player feedback (Discord)', [1, 0, 0, 2, 0]],
];

interface Shot {
  file: string;
  when: string;
  title: string;
  caption: string;
}

/** The game as it was, built from the commit named and screenshotted at midday. */
const SHOTS: Shot[] = [
  { file: 'state-1-waves.webp', when: '22 Nov, early', title: 'Waves on a slab of sand', caption: 'Milestones M3 and M4: the beach simulation, foam, wet sand and erosion. No interface yet beyond undo.' },
  { file: 'state-2-toy.webp', when: '22 Nov, a few hours later', title: 'A sand toy', caption: 'M7: dig, build and smooth tools, shells washing in, a start screen and a settings sheet.' },
  { file: 'state-3-claw.webp', when: '22 Nov, night', title: 'A real beach with things to do', caption: 'A live sun, moon and tide at a real place (Brighton here), a tool rail, the bag, and the claw machine.' },
  { file: 'state-4-live.webp', when: '23 Nov', title: 'Going live', caption: 'A shop, more than one beach, checkpoints, beach files. The game moved to play.beech.games.' },
  { file: 'state-5-palm.webp', when: '24 Nov', title: 'Palm first', caption: 'After animals, Steam and live beaches came a quieter screen: just the beach and a palm that opens every tool.' },
  { file: 'state-6-today.webp', when: '27 Nov', title: 'Today', caption: 'Weather, piers, inland rows, pets, beech bucks. The picture is still the beach.' },
];

const STATS: [string, string][] = [
  ['5', 'days, plan to TestFlight'],
  ['~170', 'pull requests merged'],
  ['320+', 'commits'],
  ['4', 'AI agents, 1 person'],
];

export function storyHtml(): string {
  const stats = STATS.map(([n, l]) => `<div class="stat"><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('');
  const agents = AGENTS.map((a) => `<article class="agent">
  <h3>${esc(a.name)}</h3>
  <p class="role">${esc(a.role)}</p>
  <p class="best"><b>Best at:</b> ${esc(a.bestAt)}</p>
  <p class="tags">${a.mostly.map((m) => `<span>${esc(m)}</span>`).join('')}</p>
  <ul>${a.did.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
</article>`).join('\n');
  const days = DAYS.map((d) => `<li class="day">
  <time>${esc(d.date)}</time>
  <div><h3>${esc(d.title)}</h3><ul>${d.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>
</li>`).join('\n');
  const who = `<div class="tablewrap"><table class="who">
<thead><tr><th></th>${AGENTS.map((a) => `<th>${esc(a.name)}</th>`).join('')}</tr></thead>
<tbody>${WHO.map(([area, row]) => `<tr><th>${esc(area)}</th>${row.map((v) => `<td>${v === 2 ? '<span class="lead" title="led">●</span>' : v === 1 ? '<span class="help" title="helped">○</span>' : ''}</td>`).join('')}</tr>`).join('')}</tbody>
</table></div>
<p class="note">● led · ○ helped. Drawn from each agent’s log and the commit trailers.</p>`;
  const shots = SHOTS.map((x) => `<figure>
  <img src="/landing-assets/story/${esc(x.file)}" alt="${esc(x.title)}: beech on ${esc(x.when)}" width="1280" height="800" loading="lazy">
  <figcaption><time>${esc(x.when)}</time><b>${esc(x.title)}</b>${esc(x.caption)}</figcaption>
</figure>`).join('\n');
  const practices = PRACTICES.map(([h, p]) => `<div class="practice"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How beech was built</title>
<meta name="description" content="How one person and several AI agents built beech (game, server, apps and beechshore.com) in five days.">
<meta property="og:title" content="How beech was built">
<meta property="og:description" content="One person, four AI agents, five days: the story of building beech.">
<link rel="icon" href="/icons/icon-192.png">
<style>
:root { --bg: #fbf3e6; --fg: #4a3f52; --muted: #7a6584; --line: #e8d8c2; --card: #fffaf2; --accent: #5f7287; --sand: #f1dcb8; }
@media (prefers-color-scheme: dark) { :root { --bg: #1f2430; --fg: #efe6f0; --muted: #b8a9c0; --line: #3a4152; --card: #272d3b; --accent: #9fb4cc; --sand: #3a3a44; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
header, main, footer { max-width: 880px; margin: 0 auto; padding: 0 16px; }
header { padding-top: 28px; }
header a.home { color: var(--muted); text-decoration: none; font-size: 14px; }
h1 { font-weight: 600; font-size: clamp(28px, 5vw, 40px); line-height: 1.2; margin: 10px 0 8px; }
.lede { font-size: 18px; color: var(--muted); max-width: 640px; margin: 0; }
h2 { margin: 48px 0 12px; font-weight: 600; font-size: 22px; }
h3 { margin: 0 0 4px; font-size: 16px; }
a { color: var(--accent); }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 28px 0 0; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
.stat b { display: block; font-size: 28px; font-weight: 600; }
.stat span { color: var(--muted); font-size: 14px; }
.agents { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.agent, .practice { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
.agent .role { color: var(--muted); font-size: 14px; margin: 0 0 8px; }
.agent ul { margin: 0; padding-left: 18px; font-size: 15px; }
.timeline { list-style: none; padding: 0; margin: 0; border-left: 2px solid var(--sand); }
.day { display: grid; grid-template-columns: 76px 1fr; gap: 12px; padding: 0 0 20px 16px; position: relative; }
.day::before { content: ""; position: absolute; left: -7px; top: 6px; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); }
.day time { color: var(--muted); font-size: 14px; padding-top: 1px; }
.day ul { margin: 4px 0 0; padding-left: 18px; }
.best { margin: 0 0 8px; font-size: 15px; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
.tags span { background: var(--sand); border-radius: 999px; padding: 1px 10px; font-size: 13px; }
.tablewrap { overflow-x: auto; }
.who { border-collapse: collapse; width: 100%; font-size: 14px; }
.who th, .who td { padding: 7px 8px; border-bottom: 1px solid var(--line); text-align: center; }
.who tbody th { text-align: left; font-weight: 400; }
.who thead th { color: var(--muted); font-weight: 500; }
.lead { color: var(--accent); font-size: 16px; } .help { color: var(--muted); }
.shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 16px; }
figure { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
figure img { display: block; width: 100%; height: auto; aspect-ratio: 16 / 10; object-fit: cover; }
figcaption { padding: 10px 14px 14px; font-size: 15px; }
figcaption time { display: block; color: var(--muted); font-size: 13px; }
figcaption b { display: block; }
.practices { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.practice p { margin: 0; font-size: 15px; }
.note { color: var(--muted); font-size: 14px; }
footer { color: var(--muted); font-size: 13px; padding: 48px 16px 32px; }
@media (max-width: 560px) { .shots { grid-template-columns: 1fr; } .who { font-size: 13px; } .who th, .who td { padding: 6px 4px; } .stats { grid-template-columns: repeat(2, 1fr); } .day { grid-template-columns: 1fr; gap: 0; } }
</style>
</head>
<body>
<header>
  <a class="home" href="/">← beech.games</a>
  <h1>How beech was built</h1>
  <p class="lede">Beech is a quiet beach you shape with your fingers. It runs in the browser, on phones and on Steam, and it has accounts, a shop, live neighbours and a public shore. One person and a handful of AI agents built all of it in five days, from a plan file to TestFlight. This is how.</p>
  <div class="stats">${stats}</div>
</header>
<main>
<h2>Who built it</h2>
<div class="agents">
${agents}
</div>

<h2>Who did what</h2>
${who}

<h2>Beech as it grew</h2>
<p class="note">Each picture is the game built from that day’s commit, at midday on the same beach.</p>
<div class="shots">
${shots}
</div>

<h2>Day by day</h2>
<ol class="timeline">
${days}
</ol>

<h2>How the agents worked together</h2>
<div class="practices">${practices}</div>

<h2>Where this comes from</h2>
<p>Each agent wrote its own log from the repository’s history: commits, pull requests, release notes and status docs. This page puts them together. The git record shows what was built, but not always who wrote which line, because every pull request is opened under one account. So credit here follows the agents’ own logs and commit trailers. Codex’s log is still to come.</p>
<p class="note">Want to see the result? <a href="/">Play beech</a> or read <a href="/guide/releases">what’s changed</a>.</p>
</main>
<footer>beech · a quiet place by the sea</footer>
</body>
</html>`;
}
