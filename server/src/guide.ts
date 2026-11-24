// The user guide, help and release notes: https://beech.games/guide and
// /guide/releases.
//
// The game shows no explanatory notes (no tips, rules or small print); they
// all live here. Numbers that the server decides (odds, grab chances, the
// claw's rest, this week's vending set, digging limits) are read from the
// same constants the server uses, so the guide can't drift from the game.
// Prose that describes the app is kept in step by hand: change it in the
// same commit as the feature (CLAUDE.md).
//
// Starter gifts are a surprise (#9): never mention them here.

import { BEACH_CAP } from './app.js';
import { CHECKPOINTS_PER_BEACH } from './checkpoints.js';
import { DIG_FIND_CHANCE, DIG_FIND_DAILY_CAP, DIG_FIND_ROLL_COOLDOWN_MS } from './digFinds.js';
import { COOLDOWN_MAX_MS, COOLDOWN_MIN_MS, GRAB_CHANCE, POOLS, type Rarity } from './pulls.js';
import { RELEASE_NOTES } from './releaseNotes.js';
import { PRIZE_NAMES } from './prizeNames.js';
import { escapeHtml as esc } from './shareMeta.js';
import { currentSet, nextUtcMidnight, type VendingSet } from './vending.js';

const RARITY: Record<Rarity, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary', unique: 'One of a kind' };
const ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'legendary', 'unique'];

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const names = (ids: string[]) => ids.map((id) => esc(PRIZE_NAMES[id] ?? id)).join(', ');
const minutes = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m >= 60 && m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`;
};

function oddsTable(odds: Partial<Record<Rarity, number>>, items: Partial<Record<Rarity, string[]>>, grab?: Partial<Record<Rarity, number>>): string {
  const rows = ORDER.filter((r) => (odds[r] ?? 0) > 0)
    .map(
      (r) =>
        `<tr><td><span class="dot ${r}"></span>${RARITY[r]}</td><td>${pct(odds[r]!)}</td>${grab ? `<td>${grab[r] === undefined ? '' : pct(grab[r]!)}</td>` : ''}<td>${names(items[r] ?? [])}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Rarity</th><th>Chance</th>${grab ? '<th>Claw holds on</th>' : ''}<th>What</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function page(title: string, body: string, nav: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="How to play beech, a quiet place by the sea: controls, tools, machines, odds, and what's new.">
<link rel="icon" href="/icons/icon-192.png">
<style>
:root { --bg: #fbf3e6; --fg: #4a3f52; --muted: #7a6584; --line: #e8d8c2; --card: #fffaf2; --accent: #5f7287; }
@media (prefers-color-scheme: dark) { :root { --bg: #1f2430; --fg: #efe6f0; --muted: #b8a9c0; --line: #3a4152; --card: #272d3b; --accent: #9fb4cc; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
header, main, footer { max-width: 760px; margin: 0 auto; padding: 0 16px; }
header { padding-top: 28px; }
header a.home { color: var(--muted); text-decoration: none; font-size: 14px; }
h1 { font-weight: 600; letter-spacing: 0.02em; margin: 6px 0 4px; }
h2 { margin: 36px 0 8px; font-weight: 600; font-size: 20px; scroll-margin-top: 12px; }
h3 { margin: 20px 0 4px; font-size: 16px; }
p, li { color: var(--fg); }
.sub { color: var(--muted); margin: 0 0 12px; }
nav { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 12px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
a { color: var(--accent); }
table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 14px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 500; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: 0; }
.dot.common { background: #f4c7b8; } .dot.uncommon { background: #a8d8a0; } .dot.rare { background: #8ec5e8; }
.dot.legendary { background: #f2c45a; } .dot.unique { background: #c06fd6; }
kbd { font: 13px ui-monospace, monospace; border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; background: var(--card); }
.release { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 4px 16px 8px; margin: 16px 0; }
.release h2 { margin-top: 12px; }
.release time { color: var(--muted); font-size: 14px; }
footer { color: var(--muted); font-size: 13px; padding: 40px 16px 32px; }
@media (max-width: 480px) { table { font-size: 13px; } th, td { padding: 5px 4px; } }
</style>
</head>
<body>
<header>
  <a class="home" href="/">← back to the beach</a>
  <h1>${esc(title)}</h1>
  ${nav}
</header>
<main>
${body}
</main>
<footer>beech · a quiet place by the sea</footer>
</body>
</html>`;
}

const NAV_SECTIONS: [string, string][] = [
  ['start', 'Getting started'],
  ['controls', 'Controls'],
  ['tools', 'Tools'],
  ['bag', 'Your bag'],
  ['finds', 'Digging finds'],
  ['animals', 'Animals'],
  ['claw', 'Claw machine'],
  ['vending', 'Vending machine'],
  ['beaches', 'Your beaches'],
  ['shore', 'Neighbors and the shore'],
  ['leaderboard', 'Leaderboard'],
  ['checkpoints', 'Checkpoints'],
  ['files', 'Beach files'],
  ['shop', 'Shop'],
  ['catalog', 'Item catalog'],
  ['settings', 'Settings'],
  ['limits', 'Limits'],
];

/** The guide page, with the live numbers as of `now`. */
export function guideHtml(now: number): string {
  const claw = POOLS.daily;
  const set: VendingSet | null = currentSet(now);
  const nav = `<p class="sub">How to play, how everything works, and <a href="/guide/releases">what’s new</a>.</p>
  <nav aria-label="Sections">${NAV_SECTIONS.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('')}<a href="/guide/releases">Release notes</a></nav>`;
  const body = `
<h2 id="start">Getting started</h2>
<p>beech is a stretch of sand by the sea. Dig, build, and set things down, and watch the waves rework it. Tap or click the title screen to begin; sound starts then too.</p>
<p>Sign in (settings, at the top) to keep your beach, have neighbors, and play the machines. Without signing in, your beach isn’t saved — it only lives while you play, and closing the app loses it. Sign in and it’s saved, so you can keep it on any device. You can still pan along the shore beside it to see other people’s public beaches.</p>
<p>The sea follows a real beach: its tide, sun and moon, at that place’s time of day, with waves growing stronger toward high tide and gentler toward low tide. Pick the beach in settings, or “near me” for the closest one.</p>

<h2 id="controls">Controls</h2>
<h3>Touch</h3>
<ul>
  <li>Drag with one finger to look around (with the look tool) or to use the tool you’ve picked.</li>
  <li>Pinch to zoom, twist to turn, and slide two fingers up or down together to tilt.</li>
  <li>A second finger straight after you start digging cancels that dig.</li>
</ul>
<h3>Mouse and keyboard</h3>
<ul>
  <li>Drag to look around or use the tool; the wheel zooms; right-drag turns and tilts.</li>
  <li><kbd>1</kbd>–<kbd>5</kbd> pick a tool; <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or the arrow keys pan; <kbd>Q</kbd>/<kbd>E</kbd> turn 45°; <kbd>R</kbd>/<kbd>F</kbd> tilt; <kbd>+</kbd>/<kbd>-</kbd> zoom.</li>
  <li><kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd> undo, with <kbd>Shift</kbd> (or <kbd>Ctrl</kbd>+<kbd>Y</kbd>) to redo.</li>
  <li><kbd>V</kbd> switches between the diorama and the chair view; <kbd>H</kbd> (or the eye button) collapses the toolbars so you can pan around with minimal overlay.</li>
</ul>
<h3>The chair view</h3>
<p>The chair button sits you on the sand facing the open sea. Hold ‹ › (or <kbd>Q</kbd>/<kbd>E</kbd>) to walk along the beach and on across your neighbors’; after a second of holding you walk faster.</p>

<h2 id="tools">Tools</h2>
<p>The tool column sits above the undo button.</p>
<ul>
  <li><b>Look</b> (the hand): move around without touching the sand.</li>
  <li><b>Sand</b>: three modes — <b>dig</b> (shovel) digs deeper or carves a trench, <b>build</b> (sand dune) adds sand where you drag, and <b>blend</b> (rake) softens edges and bumps.</li>
  <li><b>Clearing</b>: three modes — the <b>bulldozer</b> flattens and scoops up things in its path, <b>flatten</b> pushes the sand back to the untouched beach, and the <b>vacuum</b> picks things up with a tap or along a drag.</li>
</ul>
<p>Every stroke can be undone. Waves wear down what you build, and the sea fills holes near the water.</p>

<h2 id="bag">Your bag</h2>
<p>The bag (top of the tool column) holds things to set on the sand. Rocks, driftwood, shells, sea glass, flags, trash, seaweed and cowries are free and never run out. Pick one, choose its size with the slider, then tap the sand to set it down. Use the vacuum or bulldozer to pick things back up; they go back in your bag.</p>
<p>Rocks shape how water flows and where sand settles. Driftwood floats when the water is deep enough and strands when it drains. Shells, sea glass, trash and seaweed move in fast water. The sea washes things in now and then, including the occasional cowrie, and only a few strays stay at once. Hold one to pick it up, then put it down to keep it. Your bag lists what you've kept under Found.</p>
<p>Things you won or bought show how many you have left to place. You can gift an owned thing to the owner of another beach from the bar that shows while it’s in hand.</p>

<h2 id="finds">Digging finds</h2>
<p>A good dig (dragging at least 2 m, or holding in one place for a second) has a ${pct(DIG_FIND_CHANCE)} chance to turn up something buried, drawn from this week’s <a href="#vending">vending set</a> at the vending odds. At most one try every ${DIG_FIND_ROLL_COOLDOWN_MS / 1000} seconds, and at most ${DIG_FIND_DAILY_CAP} finds a day (the day turns over at midnight UTC). Signed in only.</p>

<h2 id="animals">Animals</h2>
<p>Now and then a wild sand crab pops out of the sand, scurries sideways across the beach, dodges incoming waves and your digging brush, and burrows back down after a couple of minutes — or a dolphin cruises through the deeper water offshore and leaps across the surf. An animal is around roughly half the time, and the first one usually shows up within a minute of opening the game.</p>
<p><b>Beach snacks:</b> toss a snack from your bag onto the sand to draw a visiting crab over and keep it around longer, or leave one out as bait so a crab visits sooner. You can buy snack packs in the shop, and digging up buried finds occasionally turns up a free snack too.</p>
<p><b>Resident pets:</b> feed wild crabs on a beach enough times (10 feeds) and one will offer to move in permanently — or adopt a Pet sand crab straight from the shop. Pets stay on your beach, never leave, and tuck into a cozy sand burrow to nap if unfed for a couple of days until you feed them again.</p>
<p><b>Visitor feeding:</b> when you visit another beach with a pet, you can give it one free snack a day (UTC) from the bar at the top, or feed it again anytime with a beach snack from your own bag.</p>

<h2 id="claw">Claw machine</h2>
<p>Free to play when you’re signed in: open the bag and tap the claw machine. Hold the button to steer, let go to drop.</p>
<p><b>Rest between goes:</b> after each go the claw rests for a random time between ${minutes(COOLDOWN_MIN_MS)} and ${minutes(COOLDOWN_MAX_MS)}. If the ball slipped out, the rest is usually short (about an hour on average); if you won, it’s usually long (about two hours on average). The machine shows when your next go is ready.</p>
<p><b>What’s inside, and the chances.</b> The server draws what the claw grabs, then whether it holds on. A ball that slips out spends the go and wins nothing.</p>
${oddsTable(claw.odds, claw.items, GRAB_CHANCE)}
<p>Prizes go in your bag, ready to place.</p>

<h2 id="vending">Vending machine</h2>
<p>One free ball a day when you’re signed in; the next one is ready at midnight UTC${set ? ` (next: ${esc(new Date(nextUtcMidnight(now)).toISOString().slice(0, 16).replace('T', ' '))} UTC)` : ''}. The set inside changes every week. A vending ball never slips.</p>
${
  set
    ? `<h3>This week: ${esc(set.name)} (week ${set.week})</h3>${oddsTable(set.odds, set.items)}`
    : '<p>No set is live right now.</p>'
}
<p>Past sets’ items stay yours, and stay placeable, after the week ends.</p>

<h2 id="beaches">Your beaches</h2>
<p>You start with one beach. Each extra beach you own (from the shop or the claw machine) lets you make one more, up to ${BEACH_CAP}. Open Settings → <b>Beach</b> to pick which beach you’re configuring (its name, real-world place, code, checkpoints, or to jump to it), or make a new one.</p>
<p>Any of your beaches visible on the shore can be edited directly — dig, build, clear, place, or drag things right across adjacent beaches, and each beach saves on its own automatically regardless of which beach is selected in Settings. Each device still remembers where it opens, so your phone and your TV can watch different beaches at the same time.</p>

<h2 id="shore">Neighbors and the shore</h2>
<p>Open Settings → <b>Shore</b> to arrange your beaches and neighbors. When you own more than one beach, your stretches appear at the top so you can snap your own beaches side by side (or disconnect them) in one tap, with no codes to copy.</p>
<p>Every beach also has a code (under Settings → <b>Beach</b>). To invite someone else as a neighbor, put their code in “left” or “right” under <b>Shore</b> and ask; it links when they accept. A new code stops your old one working; neighbors you already have keep you.</p>
<p>Past your neighbors the shore carries on into everyone else’s beaches: pan along it, or walk it in the chair view. Signed out, the public shore still runs past your beach: the beaches either side show, and you can scroll the whole public shore. You can look at other beaches but only dig your own. Tap ☆ on a name tag or the bar at the top to keep a beach in your favorites; “⌂ my beach” takes you home. Visit any beach by its code from Settings → <b>Shore</b>, or share a link to yours — opening it on beechshore.com lets you grab a Postcard, Square, Story, or Clean preview snapshot to post on social media.</p>

<h2 id="leaderboard">Leaderboard</h2>
<p>The trophy button shows the most-starred beaches. <b>All time</b> counts every star a beach has now. <b>Rising</b> counts stars from the past week, and the newest count most (a star’s weight halves every 2 days). Visit or star a beach from its row. Signed in only.</p>

<h2 id="checkpoints">Checkpoints</h2>
<p>A checkpoint keeps a beach as it is now — its sand and its things — to come back to later or to put on another of your beaches. Up to ${CHECKPOINTS_PER_BEACH} per beach. Restoring needs your bag to cover the things on it; if it can’t, you can restore without them. The beach as it was is kept as a “before restoring” checkpoint, and Undo brings it back. Other devices showing that beach reload.</p>

<h2 id="files">Beach files</h2>
<p>Settings → <b>Beach</b> → “export beach” saves your beach as a <code>.beach.json</code> file; “import beach” opens one. Before importing you see a preview: a map, the things on it, anything that was fixed while reading, and anything your bag can’t cover (import without them, or get them in the shop). Importing replaces the beach you’re on; when signed in the old one is kept as a “Before import” checkpoint, and Undo brings it back. Without an account, only free things come in.</p>
<p>The file format is documented for anyone who wants to design beaches by hand or with a script.</p>

<h2 id="shop">Shop</h2>
<p>Open it from the bag. In the iPhone and Android apps you pay through your App Store or Google Play account. On the web, card payments are handled by Xsolla, our payment partner, on their secure page; prices are in US dollars and converted at checkout. Gift cards and promo codes work on the web only, and promo codes apply to buying with credit. What you buy is yours on every device you sign in on.</p>
<p>Make an item for Beech and <a href="https://beechshore.com/submit">submit it on beechshore</a>. You can propose a price and how often it should appear. If your item is approved and sold, you earn 30% in Beech account credit to spend in the web shop.</p>
<p>Rare and legendary things glow and sparkle on the sand; lamps and flames glow at night.</p>

<h2 id="catalog">Item catalog</h2>
<p>Every item in the game — free things, claw and vending prizes, and shop pieces — is listed on beechshore, with a picture, its size and price, and how to get it: <a href="https://beechshore.com/items">beechshore.com/items</a>. Sign in there to vote for the items you like and leave a comment on any of them.</p>

<h2 id="settings">Settings</h2>
<ul>
  <li><b>Beach</b>: choose which of your beaches to configure, its real-world <b>place</b> (“near me” uses your location once), code and share links, <b>save a picture</b>, <b>smooth the beach</b>, <b>export</b> / <b>import</b>, and <b>checkpoints</b>.</li>
  <li><b>Shore</b>: snap your own beaches side by side in one tap, manage left/right neighbors and requests, visit by code, and open favorite beaches.</li>
  <li><b>Display</b>: <b>sound, music, haptics</b>, <b>battery saver</b> (draws every other frame), <b>ambient (for a TV)</b>, <b>light</b>, <b>detail</b> (takes effect next start), <b>watch on TV</b>, and <b>full screen</b>.</li>
  <li><b>Account</b>: sign in or out, save status, link another device, and delete account.</li>
</ul>

<h2 id="limits">Limits</h2>
<ul>
  <li>A beach holds up to 2000 things. Sand doesn’t count: dig and build as much as you like.</li>
  <li>If a beach can’t be saved (too many things, or too big), the game says so.</li>
</ul>
`;
  return page('beech guide', body, nav);
}

/** The release notes page. */
export function releaseNotesHtml(): string {
  const nav = `<p class="sub">What changed, newest first. <a href="/guide">The guide</a> explains how everything works.</p>`;
  const body = RELEASE_NOTES.map(
    (r) => `<section class="release" id="${esc(r.date)}">
  <h2>${esc(r.title)}</h2>
  <time datetime="${esc(r.date)}">${esc(new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }))}</time>
  <ul>${r.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
</section>`,
  ).join('\n');
  return page('beech release notes', body, nav);
}
