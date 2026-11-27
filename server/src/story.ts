// How beech was built: https://beech.games/story
//
// A public page telling how the whole of beech (the game, the server, the
// apps, beechshore.com) was built in a few days by one person steering
// several AI agents. The source logs, one per agent, live in docs/story/
// (CLAUDE_LOG.md, ANTIGRAVITY_LOG.md, MUSE_LOG.md, CODEX_LOG.md). Keep this
// page in step with them.
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
  /** accent colour for this agent, light then dark */
  hue: [string, string];
}

const AGENTS: Agent[] = [
  {
    name: 'Mark',
    hue: ['#d9624c', '#ee826c'],
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
    hue: ['#b8663e', '#e09468'],
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
    hue: ['#6b5bb5', '#a99ae6'],
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
    hue: ['#1a6f85', '#66c8d4'],
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
    hue: ['#4e606e', '#a7b6c3'],
    role: 'OpenAI’s coding agent. Worked on the shore, player controls, and the shared review workflow.',
    bestAt: 'Keeping state, saves, and rendering attached to the right beach as players move along the shore.',
    mostly: ['Client architecture', 'Rendering', 'Player controls'],
    did: [
      'Helped keep the shore cache and undo history in sync with the view during the move to beach IDs (#100).',
      'Followed Claude’s device-cache work with fixes for concurrent tabs, account transitions, and the first live frame on a new beach (#114, #132).',
      'Made beach slots and checkpoint sources easier to see, let waves wash away footprints, and made sign-in easier to find (#119, #124, #126).',
      'Gave Codex and Claude sessions the same pull request review and landing instructions (#130).',
    ],
  },
];

interface Shot {
  file: string;
  label: string;
  caption: string;
}

interface Day {
  date: string;
  title: string;
  points: string[];
  /** screenshots of the game that day, in public/landing-assets/story/ */
  shots: Shot[];
}

const DAYS: Day[] = [
  {
    date: '22 Nov',
    title: 'The game in a day',
    shots: [
      { file: 'state-1-waves.webp', label: 'Morning', caption: 'The simulation alone: waves, foam, wet sand and a few holes dug by hand. No sky yet, and no time of day.' },
      { file: 'state-2-toy.webp', label: 'Midday', caption: 'A sand toy: a mound with a moat, a channel to the sea and a dune.' },
      { file: 'state-3-claw.webp', label: 'Night', caption: 'Brighton at sunset, with a live sun and tide. Things from the bag: rocks, driftwood, shells, starfish and flags.' },
    ],
    points: [
      'It began with one file, PLAN.md: the look, the simulation, the input and the milestones.',
      'By evening it had: sand you can dig, waves with foam and erosion, procedural sound and haptics, day-cycle colours, a PWA, and iOS and Android shells.',
      'Then live tides at 13 real beaches, Google Cloud hosting written in Terraform, Google and Apple sign-in, neighbours, the claw machine and the vending machine.',
    ],
  },
  {
    date: '23 Nov',
    title: 'Going live',
    shots: [{ file: 'state-4-live.webp', label: 'Evening', caption: 'Neighbours at dusk: your beach between Ana’s and Cara’s, each with its own name tag. The shop is open too: a lighthouse, a hut, a deckchair and a parasol.' }],
    points: [
      'New domains: beech.games, play.beech.games and beechshore.com. The guide moved off the game screen and onto the website.',
      'The shop opened, with purchases checked with Apple and Google. More than one beach per player, checkpoints, and beach files you can export and import.',
      'Version 1.0.0 went up as the first Play Store build. Things on a beach became GPU instances, so a beach now holds 2,000 of them instead of 400.',
    ],
  },
  {
    date: '24 Nov',
    title: 'Animals, Steam, live beaches',
    shots: [{ file: 'state-5-palm.webp', label: 'Night', caption: 'Linked beaches on a bright morning: neighbours join into one shore, with sand, water and waves running straight across. Palm trees and lifeguard towers arrive.' }],
    points: [
      'The busiest day by commits. Animals landed in five steps: sand crab, snacks, resident pets, visitor feeding, dolphin.',
      'Steam S1 to S4: desktop shell, sign-in, wallet checkout, achievements and controller.',
      'Live beaches: the sea keeps working while you’re away, and visitors watch your changes as you make them. Linked neighbours blend into one continuous beach.',
    ],
  },
  {
    date: '25 Nov',
    title: 'Getting it right',
    shots: [],
    points: [
      'The palm-first interface: at rest the screen is just the beach and a palm. Local weather follows the beach you’re looking at.',
      'A permissions audit, then formal verification: the game’s state machines were modelled in TLA+, which found five races, and from then on every new feature started with a model.',
      'Claude, with help from Codex, moved the game to keeping each beach’s state by its ID, so the live waves could follow the camera while each beach kept its own edits (#100).',
      'The Android app became a hosted shell, so web changes reach phones without a new build. Copying beaches, and the first version of the currency.',
    ],
  },
  {
    date: '26 Nov',
    title: 'Breadth',
    shots: [],
    points: [
      'About 40 pull requests in one day: piers, inland rows, six pet species, real weather at 34 beaches, push notifications on web, phone and Steam.',
      'Sand bucks were renamed beech bucks, because a player asked on Discord. Sign-ins can now be linked, and two accounts merged.',
      'Codex made it easier to see how many beach slots were in use, filter checkpoints by where they came from, and find sign-in. Footprints started washing away when waves reached them (#119, #124, #126).',
      'Build 7, the first that could send push notifications, reached closed testing on Play. The iOS build went to TestFlight review.',
    ],
  },
  {
    date: '27 Nov',
    title: 'Polish',
    shots: [
      { file: 'state-8-pier.webp', label: 'Today', caption: 'Three of one player’s beaches linked side by side at golden hour, every one furnished, with a timber pier off the middle one.' },
      { file: 'state-7-today.webp', label: 'Tonight', caption: 'The same beach after dark: torches lit, a bonfire, deckchairs, a hammock, a sandcastle in its moat.' },
    ],
    points: [
      'Sign-in on beechshore.com. Promo codes changed to give bonus beech bucks only, built model first, as were multi-item trade-ins and admin system messages.',
      'Paid items got bigger and piers stand clear of storm waves. Flaky end-to-end tests were fixed.',
    ],
  },
];

const PRACTICES: [string, string][] = [
  ['Docs are the shared memory', 'No agent remembers the last session. CLAUDE.md, PLAN.md, STATUS.md and BACKLOG.md hold the state, and every change updates them in the same commit. Any agent can pick up any task cold.'],
  ['One branch per agent, one gate for all', 'Agents work in parallel on their own branches or worktrees and never share a checkout. Nothing reaches main unless tests, the build and the performance budget pass, and the game has to stay playable after every commit.'],
  ['Review, then fix-up', 'A review agent gives every pull request READY or NEEDS WORK with specific blockers. A fix-up agent clears them, then the PR is reviewed again. That loop caught migration-number collisions, a verified datatype left stale, and a migration that would have dropped a ledger kind. Codex put the review and landing instructions in a shared skill both Codex and Claude could use (#130).'],
  ['Model first', 'Anything that changes state the server keeps (money, items, pets, limits) starts as a TLA+ spec that the TLC model checker must pass. The model decides what has to be one transaction and under which lock, and the tests replay what TLC found.'],
  ['Agents finish each other’s work', 'A content PR from one agent was often finished by another, which fixed its renders, rebased it over a parallel rename, or extended its formal model (PromoCodes.tla became PromoBucks.tla). Claude made visited beaches load from a device cache and eased their snapshot water into live waves (#114). Codex followed up so tabs could update the cache together, a late fetch could not refill it after sign-out, and the first live frame came from the beach you had just reached (#132).'],
  ['Players in the loop', 'Discord bug reports became pull requests the same day, and the person who reported each bug got a reply when the fix shipped. Requests that clash with a shipped design go to Mark as a decision; they aren’t built quietly.'],
  ['People do the human parts', 'Agents write the code, review and deploy. Domains, store consoles, keys and money stay with a person, and the agents write the checklists for those steps.'],
];

/** Who led (2) or helped with (1) each area, in AGENTS order. */
const WHO: [string, number[]][] = [
  ['The sand, waves and 3D look', [1, 2, 1, 0, 1]],
  ['Gameplay features', [1, 2, 1, 1, 1]],
  ['Game server and database', [0, 2, 1, 1, 0]],
  ['Formal models (TLA+, Dafny)', [0, 2, 1, 0, 0]],
  ['Performance', [0, 2, 2, 0, 0]],
  ['Steam and desktop', [0, 1, 2, 0, 0]],
  ['Menus and navigation', [0, 1, 2, 1, 1]],
  ['Client state and structure', [0, 2, 0, 0, 1]],
  ['Production: domains, deploys, secrets', [1, 1, 0, 2, 0]],
  ['App store releases', [1, 1, 0, 2, 0]],
  ['Review and merging', [2, 1, 0, 2, 1]],
  ['Player feedback (Discord)', [1, 0, 0, 2, 0]],
];


const STATS: [string, string][] = [
  ['5', 'days from a plan file to TestFlight'],
  ['~170', 'pull requests merged'],
  ['320+', 'commits on main'],
  ['4 + 1', 'AI agents and one person'],
];

const FINISHED: string[] = [
  'A beach simulation in a Web Worker',
  'Web, Android, iOS and Steam builds',
  'Accounts with Google, Apple and Steam',
  'A shop on four payment systems',
  'Live beaches and neighbours',
  'beechshore.com, the public shore',
  'Push notifications',
  'TLA+ models and Dafny proofs',
  'An admin console',
  'Terraform for all of production',
];

const agentStyle = (a: Agent) => `--hue:${a.hue[0]};--hue-dark:${a.hue[1]}`;

function shotFigure(x: Shot, size: 'big' | 'small'): string {
  return `<figure class="shot ${size}">
  <div class="frame"><img src="/landing-assets/story/${esc(x.file)}" alt="${esc(x.caption)}" width="1280" height="800" loading="lazy" decoding="async"></div>
  <figcaption><span class="chip">${esc(x.label)}</span>${esc(x.caption)}</figcaption>
</figure>`;
}

export function storyHtml(): string {
  const stats = STATS.map(([n, l]) => `<div class="stat"><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('');
  const finished = FINISHED.map((f) => `<li>${esc(f)}</li>`).join('');
  const cast = AGENTS.map((a) => `<article class="agent" style="${agentStyle(a)}">
  <div class="agent-head"><span class="avatar" aria-hidden="true">${esc(a.name[0])}</span><div><h3>${esc(a.name)}</h3><p class="role">${esc(a.role)}</p></div></div>
  <p class="best">${esc(a.bestAt)}</p>
  <p class="tags">${a.mostly.map((m) => `<span>${esc(m)}</span>`).join('')}</p>
  <details><summary>What ${esc(a.name)} did</summary><ul>${a.did.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></details>
</article>`).join('\n');
  const who = `<div class="tablewrap"><table class="who">
<thead><tr><th scope="col"><span class="sr">Area</span></th>${AGENTS.map((a) => `<th scope="col" style="${agentStyle(a)}"><span class="avatar sm" aria-hidden="true">${esc(a.name[0])}</span><span class="who-name">${esc(a.name)}</span></th>`).join('')}</tr></thead>
<tbody>${WHO.map(([area, row]) => `<tr><th scope="row">${esc(area)}</th>${row.map((v, i) => `<td style="${agentStyle(AGENTS[i])}">${v === 2 ? '<span class="dot lead" title="led"></span><span class="sr">led</span>' : v === 1 ? '<span class="dot help" title="helped"></span><span class="sr">helped</span>' : ''}</td>`).join('')}</tr>`).join('')}</tbody>
</table></div>
<p class="legend"><span class="dot lead"></span> led <span class="dot help"></span> helped</p>`;
  const days = DAYS.map((d, i) => `<section class="day${d.shots.length > 1 ? ' wide' : ''}${d.shots.length === 0 ? ' noshot' : ''}">
  <div class="day-text">
    <p class="kicker">Day ${i + 1} · ${esc(d.date)}</p>
    <h3>${esc(d.title)}</h3>
    <ul>${d.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
  </div>
  ${d.shots.length ? `<div class="day-shots" style="--cols:${d.shots.length}">${d.shots.map((x) => shotFigure(x, d.shots.length > 1 ? 'small' : 'big')).join('')}</div>` : ''}
</section>`).join('\n');
  const practices = PRACTICES.map(([h, p], i) => `<div class="practice"><span class="num">${String(i + 1).padStart(2, '0')}</span><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How beech was built</title>
<meta name="description" content="How one person and four AI agents built beech (the game, server, apps and beechshore.com) in five days.">
<meta property="og:title" content="How beech was built">
<meta property="og:description" content="One person, four AI agents, five days: the story of building beech.">
<meta property="og:image" content="/landing-assets/story/state-8-pier.webp">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400..500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap">
<style>
:root {
  --bg: #fbf4e7; --bg-deep: #f2e5ce; --surface: #fffcf6; --surface-tint: #f6ecda;
  --ink: #1d2d38; --ink-soft: #4e606e; --ink-faint: #758490;
  --line: rgba(98, 82, 62, 0.14); --line-strong: rgba(98, 82, 62, 0.24);
  --sea: #1a6f85; --sea-soft: rgba(26, 111, 133, 0.11); --sea-ink: #fffdf8;
  --shadow-md: 0 14px 36px rgba(32, 48, 60, 0.10), 0 2px 8px rgba(32, 48, 60, 0.05);
  --shadow-lg: 0 28px 68px rgba(24, 42, 54, 0.18), 0 6px 18px rgba(24, 42, 54, 0.08);
  --font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
  --font-sans: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #131b26; --bg-deep: #0e151f; --surface: #1b2534; --surface-tint: #212e40;
    --ink: #f3ede3; --ink-soft: #b2c0cc; --ink-faint: #7e90a1;
    --line: rgba(226, 214, 196, 0.12); --line-strong: rgba(226, 214, 196, 0.22);
    --sea: #66c8d4; --sea-soft: rgba(102, 200, 212, 0.14); --sea-ink: #0c1b23;
    --shadow-md: 0 16px 40px rgba(0, 0, 0, 0.34); --shadow-lg: 0 30px 72px rgba(0, 0, 0, 0.5);
  }
  [style*="--hue"] { --hue: var(--hue-dark) !important; }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.65 var(--font-sans); -webkit-font-smoothing: antialiased; }
a { color: var(--sea); }
img { max-width: 100%; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px; }
h1, h2 { font-family: var(--font-display); font-weight: 500; letter-spacing: -0.01em; }

/* top bar */
.bar { position: absolute; inset: 0 0 auto; z-index: 2; }
.bar .wrap { display: flex; justify-content: space-between; align-items: center; padding-top: 18px; }
.bar a { color: #fffdf8; text-decoration: none; font-weight: 600; font-size: 15px; text-shadow: 0 1px 8px rgba(0,0,0,.25); }
.bar .brand { display: flex; gap: 8px; align-items: center; font-family: var(--font-display); font-size: 20px; font-weight: 500; }
.bar .brand img { width: 26px; height: 26px; border-radius: 7px; }
.bar .play { background: rgba(255,253,248,.18); border: 1px solid rgba(255,253,248,.4); padding: 7px 16px; border-radius: 999px; backdrop-filter: blur(8px); }

/* hero */
.hero { position: relative; min-height: min(92vh, 860px); display: flex; align-items: flex-end; color: #fffdf8; overflow: hidden; }
.hero > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 60% 50%; }
.hero::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(14,24,32,.45) 0%, rgba(14,24,32,.25) 35%, rgba(14,24,32,.55) 65%, rgba(14,24,32,.86) 100%), linear-gradient(90deg, rgba(14,24,32,.45), rgba(14,24,32,0) 70%); }
.hero .wrap { position: relative; z-index: 1; padding-bottom: 56px; width: 100%; }
.eyebrow { text-transform: uppercase; letter-spacing: .14em; font-size: 13px; font-weight: 600; opacity: .9; margin: 0 0 12px; }
.hero h1 { font-size: clamp(40px, 7.4vw, 88px); line-height: 1.02; margin: 0 0 18px; max-width: 900px; text-shadow: 0 2px 24px rgba(0,0,0,.25); }
.hero h1 em { font-style: italic; font-weight: 400; }
.hero .lede { font-size: clamp(17px, 2vw, 20px); max-width: 640px; margin: 0 0 32px; opacity: .95; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.stat { background: rgba(255,253,248,.14); border: 1px solid rgba(255,253,248,.28); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-radius: 16px; padding: 14px 16px; }
.stat b { display: block; font-family: var(--font-display); font-size: clamp(28px, 4vw, 40px); font-weight: 500; line-height: 1.1; }
.stat span { font-size: 14px; opacity: .9; }

/* sections */
section.block { padding: 88px 0 0; }
.section-head { max-width: 680px; margin-bottom: 32px; }
.section-head h2 { font-size: clamp(30px, 4.4vw, 48px); line-height: 1.1; margin: 0 0 10px; }
.section-head p { color: var(--ink-soft); font-size: 18px; margin: 0; }
.kicker { color: var(--sea); text-transform: uppercase; letter-spacing: .12em; font-size: 12px; font-weight: 700; margin: 0 0 8px; }

/* what got built */
.built { display: flex; flex-wrap: wrap; gap: 10px; list-style: none; padding: 0; margin: 0; }
.built li { background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 8px 16px; font-size: 15px; font-weight: 500; box-shadow: 0 1px 0 var(--line); }

/* days */
.days { display: flex; flex-direction: column; gap: 72px; }
.day { display: grid; grid-template-columns: 5fr 7fr; gap: 40px; align-items: center; }
.day:nth-child(even) .day-text { order: 2; }
.day.wide, .day.noshot { grid-template-columns: 1fr; }
.day.wide .day-text, .day.noshot .day-text { max-width: 760px; order: 0; }
.day.noshot { background: var(--surface-tint); border-radius: 22px; padding: 32px; }
.day h3 { font-family: var(--font-display); font-weight: 500; font-size: clamp(26px, 3.2vw, 36px); line-height: 1.15; margin: 0 0 12px; }
.day ul { margin: 0; padding: 0; list-style: none; color: var(--ink-soft); }
.day li { position: relative; padding-left: 20px; margin: 0 0 10px; }
.day li::before { content: ""; position: absolute; left: 0; top: .7em; width: 8px; height: 8px; border-radius: 50%; background: var(--sea); opacity: .6; }
.day-shots { display: grid; gap: 16px; }
.day.wide .day-shots { grid-template-columns: repeat(var(--cols), 1fr); }
.shot { margin: 0; }
.frame { border-radius: 18px; overflow: hidden; box-shadow: var(--shadow-lg); border: 1px solid var(--line); background: var(--bg-deep); aspect-ratio: 16 / 10; }
.shot.small .frame { border-radius: 14px; box-shadow: var(--shadow-md); }
.frame img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .6s ease; }
.shot:hover .frame img { transform: scale(1.03); }
figcaption { color: var(--ink-soft); font-size: 14px; margin-top: 12px; display: flex; gap: 10px; align-items: baseline; }
.chip { flex: none; background: var(--sea-soft); color: var(--sea); border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 700; }

/* cast */
.cast { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px; }
.agent { background: var(--surface); border: 1px solid var(--line); border-top: 4px solid var(--hue); border-radius: 20px; padding: 22px; box-shadow: var(--shadow-md); }
.agent-head { display: flex; gap: 14px; align-items: center; margin-bottom: 14px; }
.avatar { flex: none; display: inline-grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; background: var(--hue); color: #fffdf8; font-family: var(--font-display); font-size: 22px; }
.avatar.sm { width: 28px; height: 28px; border-radius: 9px; font-size: 15px; }
.agent h3 { margin: 0; font-size: 20px; }
.role { margin: 0; color: var(--ink-faint); font-size: 14px; }
.best { font-family: var(--font-display); font-size: 19px; line-height: 1.4; margin: 0 0 14px; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 14px; }
.tags span { border: 1px solid var(--hue); color: var(--hue); border-radius: 999px; padding: 1px 10px; font-size: 13px; font-weight: 600; }
details summary { cursor: pointer; color: var(--ink-soft); font-size: 14px; font-weight: 600; }
details ul { margin: 10px 0 0; padding-left: 18px; color: var(--ink-soft); font-size: 15px; }
details li { margin-bottom: 6px; }

/* who did what */
.tablewrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 20px; box-shadow: var(--shadow-md); }
.who { border-collapse: collapse; width: 100%; font-size: 15px; }
.who th, .who td { padding: 12px 10px; border-bottom: 1px solid var(--line); text-align: center; }
.who tbody tr:last-child th, .who tbody tr:last-child td { border-bottom: 0; }
.who tbody th { text-align: left; font-weight: 500; padding-left: 22px; }
.who thead th { font-size: 13px; font-weight: 600; color: var(--ink-soft); vertical-align: bottom; }
.who thead th .avatar { display: grid; margin: 0 auto 4px; }
.dot { display: inline-block; width: 14px; height: 14px; border-radius: 50%; vertical-align: middle; }
.dot.lead { background: var(--hue, var(--ink-soft)); }
.dot.help { border: 2px solid var(--hue, var(--ink-soft)); width: 12px; height: 12px; opacity: .7; }
.legend { color: var(--ink-faint); font-size: 14px; display: flex; gap: 8px; align-items: center; margin: 12px 4px 0; }
.legend .dot { width: 11px; height: 11px; } .legend .dot.help { width: 9px; height: 9px; } .legend .dot.help { margin-left: 10px; }

/* practices */
.practices { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 18px; }
.practice { position: relative; background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 24px; }
.practice .num { font-family: var(--font-display); font-size: 34px; color: var(--sea); opacity: .5; line-height: 1; }
.practice h3 { margin: 10px 0 6px; font-size: 18px; }
.practice p { margin: 0; color: var(--ink-soft); font-size: 15px; }

/* sources + cta */
.sources { max-width: 760px; color: var(--ink-soft); }
.cta { margin: 96px 0 0; background: linear-gradient(135deg, #1a6f85, #12485a); color: #fffdf8; border-radius: 28px; padding: 48px 32px; text-align: center; }
.cta h2 { font-size: clamp(28px, 4vw, 44px); margin: 0 0 8px; }
.cta p { margin: 0 0 24px; opacity: .9; }
.cta a { display: inline-block; background: #fffdf8; color: #12485a; text-decoration: none; font-weight: 700; padding: 12px 26px; border-radius: 999px; margin: 4px; }
.cta a.ghost { background: transparent; color: #fffdf8; border: 1px solid rgba(255,253,248,.5); }
footer { color: var(--ink-faint); font-size: 13px; padding: 40px 20px 36px; text-align: center; }

@media (max-width: 860px) {
  .day { grid-template-columns: 1fr; gap: 20px; }
  .day:nth-child(even) .day-text { order: 0; }
  .day.wide .day-shots { grid-template-columns: repeat(min(var(--cols), 2), 1fr); }
  .stats { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 560px) {
  .wrap { padding: 0 16px; }
  .hero { min-height: 88vh; }
  .hero .wrap { padding-bottom: 32px; }
  .day.wide .day-shots { grid-template-columns: 1fr; }
  .day.noshot { padding: 24px 20px; }
  .cast, .practices { grid-template-columns: 1fr; }
  section.block { padding-top: 64px; }
  .who { font-size: 13px; } .who th, .who td { padding: 9px 4px; } .who tbody th { padding-left: 12px; }
  .who-name { display: none; }
  .cta { padding: 36px 20px; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } .frame img { transition: none; } }
</style>
</head>
<body>
<div class="bar"><div class="wrap">
  <a class="brand" href="/"><img src="/icons/icon-192.png" alt="">beech</a>
  <a class="play" href="/">Play beech</a>
</div></div>

<header class="hero">
  <img src="/landing-assets/story/state-8-pier.webp" alt="Three linked beech beaches at golden hour with a pier" fetchpriority="high">
  <div class="wrap">
    <p class="eyebrow">The making of beech</p>
    <h1>One beach, <em>five days</em>, four AI agents and one person.</h1>
    <p class="lede">Beech is a quiet beach you shape with your fingers. It runs in the browser, on phones and on Steam, and it has accounts, a shop, live neighbours and a public shore. All of it went from a single plan file to TestFlight in five days. This is how.</p>
    <div class="stats">${stats}</div>
  </div>
</header>

<main class="wrap">
<section class="block">
  <div class="section-head"><p class="kicker">What got built</p><h2>Not a prototype. A whole product.</h2><p>By the end of the week beech had all of this, and it all shipped:</p></div>
  <ul class="built">${finished}</ul>
</section>

<section class="block">
  <div class="section-head"><p class="kicker">Beech as it grew</p><h2>Day by day</h2><p>Each picture is the game built from that day’s commit, with the same beach built up using what that version could do: sculpted sand first, then things from the bag, then the shop, then neighbours, linked beaches and a pier. The clock is set to a different time of day for each one.</p></div>
  <div class="days">
${days}
  </div>
</section>

<section class="block">
  <div class="section-head"><p class="kicker">The cast</p><h2>Who built it, and what each was best at</h2><p>The agents found their own specialities. Claude built most of the game, Antigravity took the platform and performance work, and Muse ran production.</p></div>
  <div class="cast">
${cast}
  </div>
</section>

<section class="block">
  <div class="section-head"><p class="kicker">Division of labour</p><h2>Who did what</h2></div>
  ${who}
</section>

<section class="block">
  <div class="section-head"><p class="kicker">The method</p><h2>How the agents worked together</h2><p>No agent remembers yesterday. What kept many parallel sessions coherent were the habits below.</p></div>
  <div class="practices">${practices}</div>
</section>

<section class="block">
  <div class="section-head"><p class="kicker">Sources</p><h2>Where this comes from</h2></div>
  <div class="sources">
    <p>Each agent wrote its own log from the repository’s history: commits, pull requests, release notes and status docs. This page puts them together. Every pull request was opened under one account, so the git record shows what was built but not always who wrote which line. Credit here follows the agents’ own logs and commit trailers.</p>
  </div>
</section>

<section class="cta">
  <h2>See the result</h2>
  <p>The beach is open. Dig something.</p>
  <a href="/">Play beech</a><a class="ghost" href="/guide/releases">What’s changed</a>
</section>
</main>
<footer>beech · a quiet place by the sea</footer>
</body>
</html>`;
}
