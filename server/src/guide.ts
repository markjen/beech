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
//
// The catalog section (#catalog) lists every item by how you get it,
// built at runtime from the claw pool, the vending sets, the shop
// products and the free items — never a hand-kept copy. Names, rarities
// and kinds the server can't derive from those live mirrored in
// prizeNames.ts, kept in step by tests/items.test.ts.

import { BEACH_CAP } from './app.js';
import { CHECKPOINTS_PER_BEACH, FREE_ITEMS } from './checkpoints.js';
import { DIG_FIND_CHANCE, DIG_FIND_DAILY_CAP, DIG_FIND_ROLL_COOLDOWN_MS } from './digFinds.js';
import { COOLDOWN_MAX_MS, COOLDOWN_MIN_MS, GRAB_CHANCE, POOLS, type Rarity } from './pulls.js';
import { NOTE_MAX, NOTES_PER_BEACH_DAY, NOTES_PER_HOUR, QUICK_NOTES, RATING_SHOWN_AT } from './inbox.js';
import { CLAIM_WINDOW_MS, GUIDE_BONUS, GUIDE_STEPS, REWARD_CAP, SETTLE_STEPS, WELCOME_GIFT, ladder } from './referrals.js';
import { RELEASE_NOTES } from './releaseNotes.js';
import { behaviourOfKind, displayName, itemGlows, itemKind, itemRarity, type ItemBehaviour } from './prizeNames.js';
import { PRODUCTS } from './products.js';
import { escapeHtml as esc } from './shareMeta.js';
import { VENDING_SETS, currentSet, nextUtcMidnight, type VendingSet } from './vending.js';

const RARITY: Record<Rarity, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary', unique: 'One of a kind' };
const ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'legendary', 'unique'];

/** "a parasol", "an extra beach" */
const aName = (id: string) => {
  if (id === 'beach') return 'an extra beach';
  const name = displayName(id).toLowerCase();
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${esc(name)}`;
};
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** the invite ladder as list items, folding runs of the same reward */
function ladderItems(): string {
  const lines: { from: number; to: number; item: string }[] = [];
  for (const r of ladder()) {
    const last = lines[lines.length - 1];
    if (last && last.item === r.item) last.to = r.rank;
    else lines.push({ from: r.rank, to: r.rank, item: r.item });
  }
  return lines
    .map((l) => `<li>${l.from === l.to ? `Your ${ordinal(l.from)} friend` : `Your ${ordinal(l.from)} to ${ordinal(l.to)} friends`}: ${aName(l.item)}${l.from === l.to ? '' : ' each'}</li>`)
    .join('');
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const names = (ids: string[]) => ids.map((id) => esc(displayName(id))).join(', ');
const usd = (n: number) => `$${n.toFixed(2)}`;
const sentence = (s: string) => (s.endsWith('.') ? s : `${s}.`);
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

/** The free things the sea brings in on its own (washIn in src/sim/objects.ts): the loose light things, a few at a time. Rocks and flags never wash in, and neither do things you win or buy. Kept in step by tests/items.test.ts. */
export const WASH_ASHORE_ITEMS: ReadonlySet<string> = new Set(['driftwood', 'shell', 'seaglass', 'trash', 'seaweed', 'cowrie']);

const BEHAVIOUR_WORDS: Record<ItemBehaviour, string> = {
  rock: 'Shapes how water flows and where sand settles.',
  float: 'Floats on the water, and strands when it drains.',
  tumble: 'Moves in fast water, then settles on the sand.',
  fixed: 'Stays where you put it.',
};

const byName = (a: string, b: string) => displayName(a).localeCompare(displayName(b));
const byTierThenName = (a: string, b: string) => ORDER.indexOf(itemRarity(a)) - ORDER.indexOf(itemRarity(b)) || byName(a, b);

/** One catalog row: name, rarity, and a line on how it behaves — plus the shop price and the shop's own line where there is one. */
function catalogRow(id: string): string {
  const behaviour = behaviourOfKind(itemKind(id));
  const single = PRODUCTS.find((p) => p.grants.length === 1 && p.grants[0].item === id);
  const price = single ? ` · ${usd(single.usd)}` : '';
  // The glow line is for placed things: extras with no behaviour (beach
  // snacks, the pet crab) aren't placed on the sand, and pets don't glow.
  const words = [single?.blurb ?? '', behaviour ? BEHAVIOUR_WORDS[behaviour] : '', behaviour && itemGlows(id) ? 'Glows and sparkles on the sand.' : '']
    .filter(Boolean)
    .map(sentence)
    .join(' ');
  return `<li><b>${esc(displayName(id))}</b> — ${RARITY[itemRarity(id)]}${price}${words ? `. ${words}` : ''}</li>`;
}

/** The full catalog, grouped by how you get each thing. Every group is built at runtime from the pools, sets, products and free items, so a new item joins its group on its own. */
function catalogSection(now: number): string {
  const free = [...FREE_ITEMS].sort(byName);
  const wash = [...WASH_ASHORE_ITEMS].sort(byName);
  const clawIds = [...new Set(Object.values(POOLS).flatMap((p) => Object.values(p.items).flat()))].sort(byTierThenName);
  const sets = [...VENDING_SETS].sort((a, b) => b.week - a.week);
  const current = currentSet(now);
  const shopIds = [...new Set(PRODUCTS.flatMap((p) => p.grants.map((g) => g.item)))].filter((id) => id !== 'beach').sort(byName);
  const founder = PRODUCTS.find((p) => p.featured);
  const beachProducts = PRODUCTS.filter((p) => p.grants.length > 0 && p.grants.every((g) => g.item === 'beach')).sort(
    (a, b) => a.grants[0].quantity - b.grants[0].quantity,
  );
  const beachPrices = beachProducts
    .map((p) => (p.grants[0].quantity === 1 ? usd(p.usd) : `${p.grants[0].quantity} for ${usd(p.usd)}`))
    .join(', or ');
  const beachBlurb = beachProducts[0]?.blurb ?? '';
  return `
<h2 id="catalog">Everything you can place</h2>
<p>Everything you can put on your beach, by how you get it. Free things never run out; things you win or buy show how many you have left to place.</p>

<h3>Free, from your bag</h3>
<p>Yours from the start. Pick one, choose its size, and set it down.</p>
<ul>${free.map(catalogRow).join('')}</ul>

<h3>Washed ashore</h3>
<p>The sea brings these in on its own, a few at a time. Pick one up and put it down and it's yours; your bag lists what you've kept under Found.</p>
<ul>${wash.map(catalogRow).join('')}</ul>

<h3>From the vending machine</h3>
<p>One free ball a day, from the week's set — the odds are in the vending machine section above. Past sets' items stay yours, and stay placeable, after the week ends.</p>
${sets
  .map(
    (set) =>
      `<h3>Week ${set.week}: ${esc(set.name)}${set === current ? ' (this week)' : ''}</h3><ul>${[...new Set(Object.values(set.items).flat())].sort(byTierThenName).map(catalogRow).join('')}</ul>`,
  )
  .join('')}

<h3>From the claw machine</h3>
<p>Won from the free claw machine — the odds are in the claw machine section above.</p>
<ul>${clawIds.map(catalogRow).join('')}</ul>

<h3>From the shop</h3>
<p>Bought in the paid shop, under Shop. Prices in US dollars; what you buy is yours on every device you sign in on.</p>
<ul>${shopIds.map(catalogRow).join('')}</ul>
${founder ? `<p>The <b>${esc(founder.name)}</b> (${usd(founder.usd)}) — ${esc(sentence(founder.blurb))}</p>` : ''}

<h3>Extras</h3>
<p>Things you own that aren't placed on the sand.</p>
<ul><li><b>${esc(displayName('beach'))}</b> — ${RARITY[itemRarity('beach')]}${beachPrices ? ` · ${beachPrices}` : ''}${beachBlurb ? `. ${esc(sentence(beachBlurb))}` : ''}</li></ul>
`;
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
  ['catalog', 'Everything'],
  ['beaches', 'Your beaches'],
  ['shore', 'Neighbors and the shore'],
  ['leaderboard', 'Leaderboard'],
  ['visitors', 'Visitors and your inbox'],
  ['beach-guide', 'Beach guide'],
  ['invites', 'Invites'],
  ['checkpoints', 'Checkpoints'],
  ['files', 'Beach files'],
  ['shop', 'Shop'],
  ['item-catalog', 'Item catalog'],
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
<p>At rest the screen is just the beach and a palm button in the lower right. Tap the palm to open the toolbar (and the status pane, top left); the palm turns into a × that closes it all again.</p>
<p>Sign in (Manage → <b>Settings</b>) to keep your beach, have neighbors, and play the machines. Without signing in, your beach isn’t saved — it only lives while you play, and closing the app loses it. Sign in and it’s saved, so you can keep it on any device. You can still pan along the shore beside it to see other people’s public beaches.</p>
<p>The sea follows a real beach: its tide, sun and moon, at that place’s time of day, with waves growing stronger toward high tide and gentler toward low tide. Pick the beach in Manage → <b>Beaches</b>, or “near me” for the closest one.</p>

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
  <li><kbd>V</kbd> cycles the view; <kbd>H</kbd> opens or closes the toolbar, like the palm.</li>
</ul>
<h3>The toolbar</h3>
<p>Top to bottom: <b>Inbox</b> (signed-in builds), <b>Hand</b>, <b>Dirt</b> · <b>Bag</b>, <b>Store</b> · <b>View</b>, <b>Manage</b>, then <b>Undo</b> (hold it to redo) and the × that closes the toolbar. Every time the toolbar opens, the hand is picked, so you start out just looking around. On short screens (a phone on its side) the toolbar lies along the bottom instead.</p>
<h3>The status pane</h3>
<p>Top left, with the toolbar: whose beach you’re looking at, the local time and the swell. ⌄ shows more: the tide, the wave strength, whether your beach is saved, and while you’re on someone else’s beach, actions to leave something, ask to be neighbors, feed their pet, star the beach, or head home. × tucks the pane away to a small <i>i</i>; tap it to bring the pane back.</p>
<h3>Views</h3>
<p>The View button cycles: <b>chair</b> → <b>isometric</b> → <b>reverse isometric</b> (looking back at the beach from the sea) → chair. A label beside it names the view for a moment.</p>
<h3>The chair view</h3>
<p>The chair view sits you on the sand facing the open sea. Hold ‹ › (or <kbd>Q</kbd>/<kbd>E</kbd>) to walk along the beach and on across your neighbors’; after a second of holding you walk faster.</p>

<h2 id="tools">Tools</h2>
<p>The <b>Hand</b> moves the view without touching the sand. All the dirt work is behind one button, <b>Dirt</b> (the bulldozer): it opens a column of tools beside the toolbar, and picks up the tool you used last.</p>
<ul>
  <li><b>Dig</b> (shovel) digs deeper or carves a trench.</li>
  <li><b>Build up</b> (sand dune) adds sand where you drag.</li>
  <li><b>Smooth</b> (rake) softens edges and bumps.</li>
  <li><b>Flatten</b> pushes the sand back to the untouched beach.</li>
  <li><b>Vacuum cleaner</b> picks things up with a tap or along a drag.</li>
  <li><b>Bulldozer</b> flattens and scoops up things in its path.</li>
  <li>The two <b>sandcastle molds</b>, round and square (below).</li>
</ul>
<p>Every stroke can be undone. Waves wear down what you build, and the sea fills holes near the water.</p>

<p>Pick the round or square sandcastle mold under Dirt, and tap the sand to make a tower. Put towers together, shape connecting walls with Build, dig a moat, and decorate from the bag. Sandcastles erode with the beach and can be undone.</p>

<h2 id="bag">Your bag</h2>
<p>The <b>Bag</b> (in the toolbar) opens in the middle of the screen and holds things to set on the sand. Signed in, the claw machine and the item capsule machine are tiles at the top of it. Rocks, driftwood, shells, sea glass, flags, trash, seaweed, cowries and footprints are free and never run out. Pick one, choose its size with the slider, then tap the sand to set it down. Use the vacuum or bulldozer to pick things back up; they go back in your bag.</p>
<p>Rocks shape how water flows and where sand settles. Driftwood floats when the water is deep enough and strands when it drains. Shells, sea glass, trash and seaweed move in fast water. Footprints stay where you put them. The sea washes things in now and then, including the occasional cowrie, and only a few strays stay at once. Hold one to pick it up, then put it down to keep it. Your bag lists what you've kept under Found.</p>
<p>Things you won or bought show how many you have left to place. You can gift an owned thing to the owner of another beach from the bar that shows while it’s in hand.</p>

<h2 id="finds">Digging finds</h2>
<p>A good dig (dragging at least 2 m, or holding in one place for a second) has a ${pct(DIG_FIND_CHANCE)} chance to turn up something buried, drawn from this week’s <a href="#vending">vending set</a> at the vending odds. At most one try every ${DIG_FIND_ROLL_COOLDOWN_MS / 1000} seconds, and at most ${DIG_FIND_DAILY_CAP} finds a day (the day turns over at midnight UTC). Signed in only.</p>

<h2 id="animals">Animals</h2>
<p>Now and then a wild sand crab pops out of the sand, scurries sideways across the beach, dodges incoming waves and your digging brush, and burrows back down after a couple of minutes — or a dolphin cruises through the deeper water offshore and leaps across the surf. An animal is around roughly half the time, and the first one usually shows up within a minute of opening the game.</p>
<p><b>Beach snacks:</b> toss a snack from your bag onto the sand to draw a visiting crab over and keep it around longer, or leave one out as bait so a crab visits sooner. You can buy snack packs in the shop, and digging up buried finds occasionally turns up a free snack too.</p>
<p><b>Resident pets:</b> feed wild crabs on a beach enough times (10 feeds) and one will offer to move in permanently — or adopt a Pet sand crab straight from the shop. Pets stay on your beach, never leave, and tuck into a cozy sand burrow to nap if unfed for a couple of days until you feed them again.</p>
<p><b>Visitor feeding:</b> when you visit another beach with a pet, you can give it one free snack a day (UTC) from the bar at the top, or feed it again anytime with a beach snack from your own bag.</p>

<h2 id="claw">Claw machine</h2>
<p>Free to play when you’re signed in: open Shop and tap Claw machine. Hold the button to steer, let go to drop.</p>
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
${catalogSection(now)}

<h2 id="beaches">Your beaches</h2>
<p>You start with one beach. Each extra beach you own (from the shop or the claw machine) lets you make one more, up to ${BEACH_CAP}. Open Manage → <b>Beaches</b> to pick which beach you’re configuring (its name, real-world place, code, checkpoints, or to jump to it), or make a new one.</p>
<p>Any of your beaches visible on the shore can be edited directly — dig, build, clear, place, or drag things right across adjacent beaches, and each beach saves on its own automatically regardless of which beach is selected in Manage. The waves run on whichever of your beaches you're looking at and move with you as you pan from one to the next, and Undo steps back through your edits on all of them. Each device remembers which beach it was looking at, so your phone and your TV can watch different beaches at the same time. Only one tab or device edits at a time, though: the one you opened most recently takes over, and the others turn view-only until you take editing back there. Put one of your own beach codes next to another of yours and they link straight away, without asking.</p>
<p>The sea keeps working while you’re away: tides rise and fall for your beach’s real-world place, wearing down sand near the waterline and washing up fresh shells and driftwood. Anything you own that the sea carries out goes straight back into your bag — nothing you own is lost. When you come back after a while, a “While you were away” card sums up what happened, and after a gap of more than 12 hours your beach as you left it is kept as a “Before the tide” checkpoint so you can put it back in one tap.</p>

<h2 id="shore">Neighbors and the shore</h2>
<p>Open Manage → <b>Beaches</b> to arrange your beaches and neighbors. When you own more than one beach, your stretches appear at the top so you can snap your own beaches side by side (or disconnect them) in one tap, with no codes to copy.</p>
<p>Every beach also has a code (under Manage → <b>Beaches</b>). To invite someone else as a neighbor, put their code in “left” or “right” there and ask; it links when they accept. Requests to be your neighbor arrive in your Inbox, with a dot on the Inbox button. A new code stops your old one working; neighbors you already have keep you.</p>
<p>Past your neighbors the shore carries on into everyone else’s beaches: pan along it, or walk it in the chair view. Signed out, the public shore still runs past your beach: the beaches either side show, and you can scroll the whole public shore. You can look at other beaches but only dig your own; when a beach’s owner is on it at the same time, you’ll see their changes appear every few seconds. Expand the status pane (⌄, top left) to star a beach (☆), ask to be neighbors when a side is free, or tap “⌂ my beach” to head home; the Inbox’s <b>Starred</b> tab lists your starred beaches, each with a visit button. Visit any beach by its code from the Inbox’s <b>Visit by code</b> tab (your own code is there too, to share), or share a link to yours — opening it on beechshore.com lets you grab a Postcard, Square, Story, or Clean preview snapshot to post on social media.</p>

<h2 id="leaderboard">Leaderboard</h2>
<p>The Inbox’s <b>Leaderboard</b> tab shows the most-starred beaches. <b>All time</b> counts every star a beach has now. <b>Rising</b> counts stars from the past week, and the newest count most (a star’s weight halves every 2 days). Visit or star a beach from its row. Signed in only.</p>

<h2 id="visitors">Visitors and your inbox</h2>
<p>A link to a beach opens it straight away, even before you sign in, as long as the beach is on the shore. To leave anything, sign in.</p>
<h3>Leaving something</h3>
<p>On someone else’s beach, open the toolbar, expand the status pane (⌄, top left), then tap <b>leave something</b>. A card opens where you can leave any of these, all at once:</p>
<ul>
  <li><b>A rating</b>, one to five shells. One rating per beach; you can change it once a day. The card shows a beach’s average once it has ${RATING_SHOWN_AT} ratings. Ratings are separate from stars: a star keeps a beach in your favorites and counts on the leaderboard.</li>
  <li><b>A note</b> of up to ${NOTE_MAX} characters, or one of the quick notes (${QUICK_NOTES.map((q) => `“${esc(q)}”`).join(', ')}). Only the beach’s owner can read it. Notes can’t contain links, usernames, phone numbers or rude words. For your first day only quick notes can be sent. At most ${NOTES_PER_HOUR} notes an hour, and ${NOTES_PER_BEACH_DAY} a day to the same beach.</li>
  <li><b>A gift</b> from your bag: anything you won or bought that you still have. Free things (rocks, driftwood, shells, sea glass, flags) aren’t listed, because everyone has as many as they like. It arrives at once.</li>
</ul>
<h3>Your inbox</h3>
<p>The Inbox is the top button of the toolbar; it opens on the <b>Inbox</b> tab, beside <b>Leaderboard</b>, <b>Starred</b> and <b>Visit by code</b> (signed out, it opens on the leaderboard). A red number says how many things are new. In it: visitors and what they left, gifts, neighbor requests (accept or decline right there), new neighbors, stars and ratings (gathered into one line a day), and friends who joined through your invite. When something arrives while you’re playing, a short line says so. Opening the inbox marks everything in it as seen. It keeps your newest 500 things; things you’ve seen go after 180 days.</p>
<p>On each line you can <b>say thanks</b> (sends a quick “thank you” note back), <b>visit</b> the sender’s beach, <b>report</b> a note, or <b>block</b> the sender. Someone you block can no longer rate, write to, give to or ask to be next to you, and what they sent disappears from your inbox; they aren’t told. Unblock them from “blocked” at the bottom of the inbox. Reported notes are looked at by the beech team and removed if they break the rules.</p>

<h2 id="beach-guide">Beach guide</h2>
<p>The compass at the top of the tool column is the beach guide: a list of things to try, one at a time, with how many you’ve done. The card above the round buttons shows the next one; tap it to open the list, or × to hide it (the list stays under the compass). Signed in, each step leaves a small gift in your bag the first time.</p>
<table><thead><tr><th>Step</th><th>How</th><th>Gift</th></tr></thead><tbody>
${GUIDE_STEPS.map((st) => `<tr><td>${esc(st.title)}</td><td>${esc(st.how)}</td><td>${st.gift ? esc(displayName(st.gift)) : st.id === 'claw' ? 'the claw’s own prize' : st.id === 'invite' ? 'see <a href="#invites">invites</a>' : ''}</td></tr>`).join('')}
</tbody></table>
<p>Do the first ${GUIDE_STEPS.length - 1} and you also get ${aName(GUIDE_BONUS)}. Without signing in, the steps that need an account (the machines, visiting, stars and invites) wait, and steps you do before signing in still count, with their gifts, once you sign in.</p>

<h2 id="invites">Invites</h2>
<p>Manage → <b>Beaches</b> → “invite friends” (or the last step of the beach guide) gives you your invite link, to share or copy. A link to your beach (from “share”) works as an invite too.</p>
<p><b>Your friend</b> sees who invited them, lands on your beach, and gets ${aName(WELCOME_GIFT)} as soon as they sign in for the first time, with a button to ask to be your neighbor. Invites are for new players: an account more than ${Math.round(CLAIM_WINDOW_MS / 86400000)} days old can’t use one, and each player can join through one invite only.</p>
<p><b>You</b> get a gift once your friend has settled in: when they’ve done ${SETTLE_STEPS} steps of the beach guide. The gifts climb:</p>
<ul>${ladderItems()}</ul>
<p>After ${REWARD_CAP} friends the gifts stop, but friends still join and still get their welcome gift. The next time you open the game after a friend settles in, it tells you what you got. The invite panel lists who joined and who has settled in.</p>

<h2 id="checkpoints">Checkpoints</h2>
<p>A checkpoint keeps a beach as it is now — its sand and its things — to come back to later or to put on another of your beaches. Up to ${CHECKPOINTS_PER_BEACH} per beach. Restoring needs your bag to cover the things on it; if it can’t, you can restore without them. The beach as it was is kept as a “before restoring” checkpoint, and Undo brings it back. Other devices showing that beach reload. Once a day, your beach is auto-saved as a checkpoint too, so you can always go back to yesterday’s beach — it sits in the same list, marked “auto-saved daily”. Starting a big clear-out with the bulldozer, flatten or vacuum — or any save that reshapes a tenth of the beach — keeps the beach as it was first, in the same auto slot, so you can always go back to before the big edit.</p>

<h2 id="files">Beach files</h2>
<p>Manage → <b>Beaches</b> → “export beach” saves your beach as a <code>.beach.json</code> file; “import beach” opens one. Before importing you see a preview: a map, the things on it, anything that was fixed while reading, and anything your bag can’t cover (import without them, or get them in the shop). Importing replaces the beach you’re on; when signed in the old one is kept as a “Before import” checkpoint, and Undo brings it back. Without an account, only free things come in.</p>
<p>The file format is documented for anyone who wants to design beaches by hand or with a script.</p>

<h2 id="shop">Shop</h2>
<p>Choose Paid shop from Shop. In the iPhone and Android apps you pay through your App Store or Google Play account. On the web, card payments are handled by Xsolla, our payment partner, on their secure page; prices are in US dollars and converted at checkout. Gift cards and promo codes work on the web only, and promo codes apply to buying with credit. What you buy is yours on every device you sign in on.</p>
<p>Make an item for Beech and <a href="https://beechshore.com/submit">submit it on beechshore</a>. You can propose a price and how often it should appear. If your item is approved and sold, you earn 30% in Beech account credit to spend in the web shop.</p>
<p>Rare and legendary things glow and sparkle on the sand; lamps and flames glow at night.</p>

<h2 id="item-catalog">Item catalog</h2>
<p>Every item in the game — free things, claw and vending prizes, and shop pieces — is listed on beechshore, with a picture, its size and price, and how to get it: <a href="https://beechshore.com/items">beechshore.com/items</a>. Sign in there to vote for the items you like and leave a comment on any of them.</p>

<h2 id="settings">Settings</h2>
<p><b>Manage</b> (the gear in the toolbar) has four tabs.</p>
<ul>
  <li><b>Beaches</b>: choose which of your beaches to configure, its real-world <b>place</b> (“near me” uses your location once), code and share links, <b>save a picture</b>, <b>smooth the beach</b> when it’s in view, <b>export</b> / <b>import</b>, snapping your own beaches side by side, and your left/right neighbors.</li>
  <li><b>Checkpoints</b>: save, restore, export and import checkpoints.</li>
  <li><b>Settings</b>: your account (sign in or out, save status, link another device, delete account), <b>waves</b> (calm, gentle, lively — the beach’s own swell — or surf), <b>sound, music, haptics</b>, <b>battery saver</b> (draws every other frame), <b>ambient (for a TV)</b>, <b>light</b>, <b>detail</b> (takes effect next start), <b>watch on TV</b>, and <b>full screen</b>.</li>
  <li><b>Help</b>: what each toolbar button does, and a link to this guide.</li>
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
