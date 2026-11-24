// The item catalog as beechshore.com shows it: every item in the game,
// grouped by how you get it, with a detail page, votes and comments per
// item (/items, /items/:id).
//
// The app's catalog (src/world/items.ts) is the source of truth; this
// mirror exists because the server bundle can't import it
// (server/tsconfig rootDir is server/src, and the Docker server stage only
// copies server/src). server/test/itemCatalog.test.ts keeps the two equal,
// field for field — the same arrangement as PRIZE_NAMES and PRODUCTS.
//
// Grouping comes from the same data the game uses: the claw pool
// (server/src/pulls.ts), the vending sets (server/src/vending.ts) and the
// shop products (server/src/products.ts), so a new item, set or product
// shows up here without touching this file — only its row below, which
// the test keeps in step with the catalog.

import { HTTPException } from 'hono/http-exception';

import type { Db } from './db.js';
import { productById, type Product } from './products.js';
import { GRAB_CHANCE, POOLS, type Rarity } from './pulls.js';
import { VENDING_SETS } from './vending.js';

export type CatalogRarity = Rarity;
export type CatalogSource = 'free' | 'shop' | 'pull';
export type CatalogGroupId = 'free' | 'claw' | 'vending' | 'shop';

export interface CatalogItem {
  id: string;
  name: string;
  rarity: Rarity;
  source: CatalogSource;
  /** size range you can pick from (metres) */
  size: [number, number];
  fixedSize?: boolean;
  variants: number;
  /** store product that sells it; unset for free and prize items */
  product?: string;
}

/** Mirror of ITEMS in src/world/items.ts (see header). */
export const CATALOG_ITEMS: CatalogItem[] = [
  { id: 'rock', name: 'Rock', rarity: 'common', source: 'free', size: [0.12, 1.3], variants: 8 },
  { id: 'driftwood', name: 'Driftwood', rarity: 'common', source: 'free', size: [0.5, 3.2], variants: 6 },
  { id: 'shell', name: 'Shell', rarity: 'common', source: 'free', size: [0.05, 0.5], variants: 8 },
  { id: 'seaglass', name: 'Sea glass', rarity: 'common', source: 'free', size: [0.05, 0.16], variants: 4 },
  { id: 'trash', name: 'Trash', rarity: 'common', source: 'free', size: [0.08, 0.25], variants: 3 },
  { id: 'seaweed', name: 'Seaweed', rarity: 'common', source: 'free', size: [0.15, 0.6], variants: 3 },
  { id: 'cowrie', name: 'Cowrie', rarity: 'rare', source: 'free', size: [0.05, 0.2], variants: 3 },
  { id: 'flag', name: 'Flag', rarity: 'common', source: 'free', size: [0.4, 0.4], variants: 4, fixedSize: true },
  { id: 'conch', name: 'Conch', rarity: 'common', source: 'pull', size: [0.1, 0.35], variants: 3 },
  { id: 'sanddollar', name: 'Sand dollar', rarity: 'common', source: 'pull', size: [0.06, 0.16], variants: 2 },
  { id: 'starfish', name: 'Starfish', rarity: 'rare', source: 'pull', size: [0.08, 0.26], variants: 3 },
  { id: 'coral', name: 'Coral', rarity: 'rare', source: 'pull', size: [0.08, 0.3], variants: 3 },
  { id: 'coconut', name: 'Coconut', rarity: 'common', source: 'pull', size: [0.15, 0.35], variants: 2 },
  { id: 'deckchair', name: 'Deckchair', rarity: 'rare', source: 'shop', size: [1, 1], variants: 3, fixedSize: true, product: 'item_deckchair' },
  { id: 'parasol', name: 'Parasol', rarity: 'rare', source: 'shop', size: [1, 1], variants: 1, fixedSize: true, product: 'item_parasol' },
  { id: 'surfboard', name: 'Surfboard', rarity: 'rare', source: 'shop', size: [1, 1], variants: 1, fixedSize: true, product: 'item_surfboard' },
  { id: 'tikitorch', name: 'Tiki torch', rarity: 'rare', source: 'shop', size: [1, 1], variants: 1, fixedSize: true, product: 'item_tikitorch' },
  { id: 'sandcastle', name: 'Sandcastle', rarity: 'legendary', source: 'shop', size: [1, 1], variants: 1, fixedSize: true, product: 'item_sandcastle' },
  { id: 'beachhut', name: 'Beach hut', rarity: 'legendary', source: 'shop', size: [1, 1], variants: 1, fixedSize: true, product: 'item_beachhut' },
  { id: 'lighthouse', name: 'Lighthouse', rarity: 'legendary', source: 'shop', size: [1, 1], variants: 1, fixedSize: true, product: 'item_lighthouse' },
  { id: 'palmtree', name: 'Palm tree', rarity: 'legendary', source: 'shop', size: [1, 1], variants: 1, fixedSize: true, product: 'item_palmtree' },
  { id: 'lifeguardtower', name: 'Lifeguard tower', rarity: 'legendary', source: 'shop', size: [1, 1], variants: 1, fixedSize: true, product: 'item_lifeguardtower' },
  { id: 'bonfire', name: 'Bonfire', rarity: 'rare', source: 'shop', size: [1, 1], variants: 1, fixedSize: true, product: 'item_bonfire' },
  { id: 'hammock', name: 'Hammock', rarity: 'rare', source: 'shop', size: [1, 1], variants: 1, fixedSize: true, product: 'item_hammock' },
  { id: 'towel', name: 'Beach towel', rarity: 'rare', source: 'shop', size: [1, 1], variants: 1, fixedSize: true, product: 'item_towel' },
  { id: 'bottle', name: 'Message in a bottle', rarity: 'legendary', source: 'pull', size: [0.22, 0.45], variants: 2 },
  { id: 'pink-shell', name: 'Pink shell', rarity: 'common', source: 'pull', size: [0.05, 0.5], variants: 8 },
  { id: 'blue-seaglass', name: 'Blue sea glass', rarity: 'common', source: 'pull', size: [0.05, 0.16], variants: 4 },
  { id: 'pebble', name: 'Pebble', rarity: 'common', source: 'pull', size: [0.05, 0.25], variants: 8 },
  { id: 'spiral-conch', name: 'Spiral conch', rarity: 'uncommon', source: 'pull', size: [0.1, 0.35], variants: 3 },
  { id: 'gold-sanddollar', name: 'Golden sand dollar', rarity: 'uncommon', source: 'pull', size: [0.32, 0.85], variants: 2 },
  { id: 'sunset-starfish', name: 'Sunset starfish', rarity: 'rare', source: 'pull', size: [0.08, 0.26], variants: 3 },
  { id: 'green-bottle', name: 'Green bottle', rarity: 'rare', source: 'pull', size: [0.22, 0.45], variants: 2 },
  { id: 'nautilus', name: 'Nautilus', rarity: 'unique', source: 'pull', size: [0.12, 0.3], variants: 3 },
  { id: 'beach-ball', name: 'Beach ball', rarity: 'common', source: 'pull', size: [0.25, 0.6], variants: 3 },
  { id: 'sandals', name: 'Sandals', rarity: 'uncommon', source: 'pull', size: [0.15, 0.35], variants: 2 },
  { id: 'bucket', name: 'Bucket', rarity: 'rare', source: 'pull', size: [0.2, 0.4], variants: 2 },
];

export const catalogItemById = (id: string): CatalogItem | undefined => CATALOG_ITEMS.find((i) => i.id === id);

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  legendary: 'Legendary',
  unique: 'One of a kind',
};

/** Free items the sea washes in on its own (washIn in src/sim/objects.ts). */
export const WASH_IN = new Set(['driftwood', 'shell', 'seaglass', 'trash', 'seaweed', 'cowrie']);

const VENDING_ITEMS = new Map<string, { week: number; name: string }[]>();
for (const set of VENDING_SETS) {
  for (const ids of Object.values(set.items)) {
    for (const id of ids) {
      const weeks = VENDING_ITEMS.get(id) ?? [];
      weeks.push({ week: set.week, name: set.name });
      VENDING_ITEMS.set(id, weeks);
    }
  }
}

export function catalogGroup(item: CatalogItem): CatalogGroupId {
  if (item.source === 'shop') return 'shop';
  if (item.source === 'free') return 'free';
  if (VENDING_ITEMS.has(item.id)) return 'vending';
  return 'claw';
}

export const CATALOG_GROUPS: { id: CatalogGroupId; title: string; blurb: string }[] = [
  { id: 'free', title: 'Free — in your bag', blurb: 'Yours from the start, never used up. Pick one, choose a size, set it down.' },
  { id: 'claw', title: 'Claw machine prizes', blurb: 'Free to play when you’re signed in. The claw doesn’t always hold on.' },
  { id: 'vending', title: 'Vending machine', blurb: 'One free ball a day, from a set that changes every week. A vending ball never slips.' },
  { id: 'shop', title: 'Shop', blurb: 'Bought in the game, yours on every device you sign in on.' },
];

export function catalogItemsByGroup(): { group: (typeof CATALOG_GROUPS)[number]; items: CatalogItem[] }[] {
  return CATALOG_GROUPS.map((group) => ({ group, items: CATALOG_ITEMS.filter((i) => catalogGroup(i) === group.id) }));
}

/** The shop product that sells this item, if any. */
export function catalogProduct(item: CatalogItem): Product | undefined {
  return item.product ? productById(item.product) : undefined;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

/** Plain-words lines saying how you get this item. */
export function howToGet(item: CatalogItem): string[] {
  const group = catalogGroup(item);
  if (group === 'free') {
    const lines = ['Free in your bag — yours from the start, never used up.'];
    if (WASH_IN.has(item.id)) lines.push('The sea washes these in too: pick one up and put it down to keep it.');
    return lines;
  }
  if (group === 'shop') {
    const product = catalogProduct(item);
    const lines = product ? [`Buy in the shop — ${usd(product.usd)}.`] : ['Buy in the shop.'];
    if (product && productById('pack_founder')?.grants.some((g) => g.item === item.id)) {
      lines.push(`Also in the Founder’s pack — ${usd(productById('pack_founder')!.usd)} for two extra beaches and more.`);
    }
    return lines;
  }
  if (group === 'claw') {
    const odds = POOLS.daily.odds[item.rarity] ?? 0;
    // the claw only ever holds common, rare and legendary prizes
    const grab = (GRAB_CHANCE as Partial<Record<Rarity, number>>)[item.rarity];
    return [
      'Won from the free claw machine.',
      `${RARITY_LABEL[item.rarity]} prizes are ${pct(odds)} of grabs${grab === undefined ? '' : `, and the claw holds on ${pct(grab)} of the time`}.`,
    ];
  }
  const weeks = VENDING_ITEMS.get(item.id) ?? [];
  return [
    `From the vending machine — ${weeks.map((w) => `Week ${w.week} “${w.name}”`).join(', ')}.`,
    'One free ball a day when you’re signed in. Past sets’ items stay yours after the week ends.',
  ];
}

export function sizeText(item: CatalogItem): string {
  if (item.fixedSize) return 'Fixed size';
  const m = (n: number) => `${Math.round(n * 100) / 100} m`;
  return `${m(item.size[0])}–${m(item.size[1])}`;
}

// ------------------------------------------------------------ votes & comments

export interface ItemComment {
  id: string;
  userId: string;
  name: string;
  body: string;
  createdAt: number;
}

export const COMMENT_MAX = 1000;

export async function voteCount(db: Db, itemId: string): Promise<number> {
  const rows = await db.query<{ n: string }>('SELECT COUNT(*) AS n FROM item_votes WHERE item_id = $1', [itemId]);
  return Number(rows[0]?.n ?? 0);
}

export async function voteCounts(db: Db): Promise<Record<string, number>> {
  const rows = await db.query<{ item_id: string; n: string }>('SELECT item_id, COUNT(*) AS n FROM item_votes GROUP BY item_id');
  const out: Record<string, number> = {};
  for (const r of rows) out[r.item_id] = Number(r.n);
  return out;
}

export async function myVote(db: Db, itemId: string, userId: string): Promise<boolean> {
  const rows = await db.query('SELECT 1 FROM item_votes WHERE item_id = $1 AND user_id = $2', [itemId, userId]);
  return rows.length > 0;
}

/** Toggle one person's vote for an item. Returns whether they voted after the toggle. */
export async function toggleVote(db: Db, itemId: string, userId: string, now: number): Promise<boolean> {
  return db.withTransaction(async (tx) => {
    const [existing] = await tx.query('SELECT 1 FROM item_votes WHERE item_id = $1 AND user_id = $2', [itemId, userId]);
    if (existing) {
      await tx.query('DELETE FROM item_votes WHERE item_id = $1 AND user_id = $2', [itemId, userId]);
      return false;
    }
    await tx.query('INSERT INTO item_votes (item_id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [itemId, userId, now]);
    return true;
  });
}

export async function listComments(db: Db, itemId: string): Promise<ItemComment[]> {
  const rows = await db.query<{ id: string; user_id: string; name: string; body: string; created_at: string }>(
    `SELECT c.id, c.user_id, u.name, c.body, c.created_at FROM item_comments c
       JOIN users u ON u.id = c.user_id WHERE c.item_id = $1
      ORDER BY c.created_at DESC, c.id DESC LIMIT 100`,
    [itemId],
  );
  return rows.map((r) => ({ id: r.id, userId: r.user_id, name: r.name || 'Someone', body: r.body, createdAt: Number(r.created_at) }));
}

export function commentBody(body: unknown): string {
  if (typeof body !== 'string') throw new HTTPException(400, { message: 'Write a comment.' });
  const text = body.trim();
  if (!text) throw new HTTPException(400, { message: 'Write a comment.' });
  if (text.length > COMMENT_MAX) throw new HTTPException(400, { message: `Keep comments to ${COMMENT_MAX} characters.` });
  return text;
}

export async function addComment(db: Db, itemId: string, userId: string, userName: string, body: string, now: number): Promise<ItemComment> {
  const id = crypto.randomUUID();
  await db.query('INSERT INTO item_comments (id, item_id, user_id, body, created_at) VALUES ($1, $2, $3, $4, $5)', [id, itemId, userId, body, now]);
  return { id, userId, name: userName || 'Someone', body, createdAt: now };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function myCommentIds(db: Db, itemId: string, userId: string): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    'SELECT id FROM item_comments WHERE item_id = $1 AND user_id = $2',
    [itemId, userId],
  );
  return rows.map((r) => r.id);
}

/** Delete a comment. Only its author can (admin delete isn't available from
    the game server — admin identity lives in the separate admin console). */
export async function deleteComment(db: Db, itemId: string, commentId: string, userId: string): Promise<boolean> {
  if (!UUID_RE.test(commentId)) return false;
  const rows = await db.query(
    'DELETE FROM item_comments WHERE id = $1 AND item_id = $2 AND user_id = $3 RETURNING id',
    [commentId, itemId, userId],
  );
  return rows.length > 0;
}

/** The community member whose approved submission became this catalog item,
    if any — the person who earns creator credit when it sells. */
export async function creatorForItem(db: Db, itemId: string): Promise<{ name: string; priceCents: number | null } | null> {
  const rows = await db.query<{ name: string; approved_price_cents: number | null }>(
    `SELECT u.name, s.approved_price_cents FROM item_submissions s
       JOIN users u ON u.id = s.submitter_user_id
      WHERE s.item_id = $1 AND s.status = 'approved'
      ORDER BY s.reviewed_at DESC NULLS LAST, s.created_at DESC LIMIT 1`,
    [itemId],
  );
  if (!rows[0]) return null;
  return { name: rows[0].name || 'Someone', priceCents: rows[0].approved_price_cents };
}

// ------------------------------------------------------------ pages

export const ITEM_CSS = `
.items-head{max-width:780px}
.item-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;list-style:none;margin:0;padding:0}
.item-card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.item-card a{display:block;color:inherit;text-decoration:none}
.item-card img{display:block;width:100%;aspect-ratio:1;object-fit:cover;background:var(--sand2)}
.item-card .info{padding:10px 12px 12px}
.item-card .t{font-weight:700;display:block}
.item-card .s{font-size:13px;color:var(--ink2);display:block}
.item-card .m{font-size:13px;display:flex;gap:8px;align-items:baseline;margin-top:4px}
.item-card .stars{color:var(--ink)}
.item-detail{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:clamp(18px,4vw,36px);align-items:start}
.item-detail .pic{background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden}
.item-detail .pic img{display:block;width:100%;aspect-ratio:1;object-fit:cover}
.item-detail h1{margin-top:0}
.item-detail .facts{list-style:none;margin:14px 0;padding:0;display:grid;gap:6px}
.item-detail .facts li{display:flex;gap:10px}
.item-detail .facts b{min-width:110px;font-weight:700}
.vote-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:16px 0}
.vote-count{font-weight:700}
.comments{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.comments li{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px}
.comments .who{font-size:13px;color:var(--ink2)}
.comments .who b{color:var(--ink)}
.comments p{margin:4px 0 0;overflow-wrap:anywhere;white-space:pre-wrap}
.comment-form{display:grid;gap:10px;margin-top:14px}
.comment-form textarea{width:100%;min-height:74px;padding:9px;border:1px solid var(--line2);border-radius:8px;background:var(--sand2);color:var(--ink);font:inherit}
[hidden]{display:none!important}
@media(max-width:640px){.item-detail{grid-template-columns:minmax(0,1fr)}}
`;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface ItemPageLinks {
  href: (p: string) => string;
  /** URL of an item's render image */
  img: (id: string) => string;
}

export function catalogIndexHtml(items: { group: (typeof CATALOG_GROUPS)[number]; items: CatalogItem[] }[], counts: Record<string, number>, links: ItemPageLinks): string {
  const total = CATALOG_ITEMS.length;
  return `
<section class="head items-head">
  <h1>Every item in beech</h1>
  <p>${total} things to set on the sand, grouped by how you get them. Open one to see its picture, size and price — and vote for the ones you love.</p>
</section>
${items
  .map(
    ({ group, items: rows }) => `
<section>
  <div class="sec-head"><h2>${esc(group.title)}</h2><span class="hint">${rows.length} ${rows.length === 1 ? 'item' : 'items'}</span></div>
  <p class="hint">${esc(group.blurb)}</p>
  <ul class="item-grid">
    ${rows
      .map(
        (it) => `<li class="item-card"><a href="${esc(links.href(`/items/${it.id}`))}">
      <img src="${esc(links.img(it.id))}" width="400" height="400" loading="lazy" decoding="async" alt="${esc(it.name)}">
      <span class="info"><span class="t">${esc(it.name)}</span>
      <span class="s">${esc(RARITY_LABEL[it.rarity])}</span>
      <span class="m">${counts[it.id] ? `<span class="stars">★ ${counts[it.id]}</span>` : ''}<span class="when">${esc(catalogGroup(it) === 'shop' && catalogProduct(it) ? usd(catalogProduct(it)!.usd) : '')}</span></span></span>
    </a></li>`,
      )
      .join('')}
  </ul>
</section>`,
  )
  .join('')}
<style>${ITEM_CSS}</style>`;
}

export interface ItemDetailData {
  item: CatalogItem;
  votes: number;
  creator: { name: string; priceCents: number | null } | null;
  comments: ItemComment[];
}

export function catalogDetailHtml(d: ItemDetailData, links: ItemPageLinks, gameUrl: string): string {
  const { item } = d;
  const product = catalogProduct(item);
  return `
<section class="item-detail">
  <div class="pic"><img src="${esc(links.img(item.id))}" width="400" height="400" alt="${esc(item.name)}"></div>
  <div>
    <p class="hint"><a href="${esc(links.href('/items'))}">← All items</a></p>
    <h1>${esc(item.name)}</h1>
    <p class="m"><span class="stars">${esc(RARITY_LABEL[item.rarity])}</span></p>
    <ul class="facts">
      <li><b>How to get it</b><span>${howToGet(item).map(esc).join('<br>')}</span></li>
      ${product ? `<li><b>Price</b><span>${esc(usd(product.usd))} in the shop</span></li>` : ''}
      <li><b>Size</b><span>${esc(sizeText(item))}</span></li>
      <li><b>Shapes</b><span>${item.variants} ${item.variants === 1 ? 'shape' : 'shapes'}</span></li>
      ${d.creator ? `<li><b>Designed by</b><span>${esc(d.creator.name)} — a community item; they earn 30% in Beech credit when it sells.</span></li>` : ''}
    </ul>
    <div class="vote-row">
      <button type="button" class="btn" id="item-vote" data-item="${esc(item.id)}">★ Vote for this item</button>
      <span class="vote-count" id="item-vote-count">${d.votes === 1 ? '1 vote' : `${d.votes} votes`}</span>
    </div>
    <p class="hint" id="item-vote-status" role="status">Connect your Beech account to vote and comment.</p>
  </div>
</section>
<section>
  <div class="sec-head"><h2>Comments</h2></div>
  <ul class="comments" id="item-comments">
    ${d.comments.length ? d.comments.map((c) => commentHtml(c, false)).join('') : '<li class="empty">No comments yet. Say what you’d build with it.</li>'}
  </ul>
  <form class="comment-form" id="item-comment-form" hidden>
    <label class="field-label" for="item-comment-text">Leave a comment</label>
    <textarea id="item-comment-text" name="text" maxlength="${COMMENT_MAX}" placeholder="What would you build with it?"></textarea>
    <div><button type="submit" class="btn">Post comment</button></div>
  </form>
  <p class="hint">Comments are public, under your Beech name. Keep it kind — Beech can remove anything that isn’t.</p>
</section>
<section class="make">
  <div>
    <h2>Put it on a beach</h2>
    <p>Every item here can be set on the sand in beech — free in your bag, won from a machine, or bought in the shop.</p>
  </div>
  <a class="btn big" href="${esc(gameUrl)}/">Play beech →</a>
</section>
<style>${ITEM_CSS}</style>`;
}

export function commentHtml(c: ItemComment, mine: boolean): string {
  const when = new Date(c.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `<li data-comment="${esc(c.id)}"><span class="who"><b>${esc(c.name)}</b> · ${esc(when)}</span><p>${esc(c.body)}</p>${
    mine ? ` <button type="button" class="linkish" data-delete-comment="${esc(c.id)}">Delete</button>` : ''
  }</li>`;
}

/** Inline script for the detail page: connect, vote toggle, comments.
    Reuses the beechshore account connection from the submission flow
    (submissionPage.ts): the same popup posts the same token back, and the
    same session authorises the vote/comment calls. */
export function catalogDetailScript(config: { connectUrl: string; voteUrl: string; commentsUrl: string }): string {
  const settings = JSON.stringify(config).replace(/</g, '\\u003c');
  return `<script>
(() => {
  const { connectUrl, voteUrl, commentsUrl } = ${settings};
  const voteBtn = document.getElementById('item-vote');
  const count = document.getElementById('item-vote-count');
  const status = document.getElementById('item-vote-status');
  const form = document.getElementById('item-comment-form');
  const list = document.getElementById('item-comments');
  const box = document.getElementById('item-comment-text');
  let token;
  let popup;
  let voted = false;
  let posting = false;
  const setCount = (n) => { count.textContent = n === 1 ? '1 vote' : n + ' votes'; };
  const setVoted = (v) => { voted = v; voteBtn.textContent = v ? '★ You voted for this item' : '★ Vote for this item'; };
  function addDeleteBtn(li, id) {
    if (li.querySelector('[data-delete-comment]')) return;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'linkish';
    del.dataset.deleteComment = id;
    del.textContent = 'Delete';
    li.append(' ', del);
  }
  async function api(url, method, body) {
    const res = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      token = undefined;
      form.hidden = true;
      for (const btn of list.querySelectorAll('[data-delete-comment]')) btn.remove();
      throw new Error('Connect your Beech account again.');
    }
    if (!res.ok) throw new Error(data.error || 'The request did not go through.');
    return data;
  }
  async function refresh() {
    const [vote, comments] = await Promise.all([api(voteUrl, 'GET'), api(commentsUrl, 'GET')]);
    setVoted(vote.voted);
    setCount(vote.votes);
    const mine = new Set(comments.mine || []);
    for (const li of list.children) {
      if (li.dataset.comment && mine.has(li.dataset.comment)) addDeleteBtn(li, li.dataset.comment);
    }
  }
  async function connected(value) {
    token = value;
    try {
      await refresh();
      form.hidden = false;
      status.textContent = 'Connected. Your votes and comments show under your Beech name.';
    } catch (err) { status.textContent = err.message; }
  }
  const connectionOrigin = new URL(connectUrl, location.href).origin;
  window.addEventListener('message', (event) => {
    if (event.origin !== connectionOrigin || event.source !== popup || event.data?.type !== 'beech-item-submission') return;
    if (typeof event.data.token !== 'string') return;
    popup.close();
    popup = null;
    void connected(event.data.token);
  });
  voteBtn.addEventListener('click', async () => {
    if (!token) {
      if (popup && !popup.closed) { popup.focus(); return; }
      popup = window.open(connectUrl, '_blank', 'popup,width=520,height=540');
      status.textContent = popup ? 'Finish connecting in the Beech window.' : 'Allow pop-ups for this page and try connecting again.';
      return;
    }
    try {
      const data = await api(voteUrl, 'POST');
      setVoted(data.voted);
      setCount(data.votes);
    } catch (err) { status.textContent = err.message; }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = box.value.trim();
    if (!text || posting || !token) return;
    posting = true;
    try {
      const data = await api(commentsUrl, 'POST', { text });
      const empty = list.querySelector('.empty');
      if (empty) empty.remove();
      const li = document.createElement('li');
      li.dataset.comment = data.comment.id;
      const who = document.createElement('span');
      who.className = 'who';
      who.innerHTML = '<b></b> · just now';
      who.querySelector('b').textContent = data.comment.name;
      const p = document.createElement('p');
      p.textContent = data.comment.body;
      li.append(who, p);
      addDeleteBtn(li, data.comment.id);
      list.prepend(li);
      box.value = '';
    } catch (err) { status.textContent = err.message; }
    finally { posting = false; }
  });
  list.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-delete-comment]');
    if (!btn || !token) return;
    try {
      await api(commentsUrl + '/' + encodeURIComponent(btn.dataset.deleteComment), 'DELETE');
      btn.closest('li')?.remove();
    } catch (err) { status.textContent = err.message; }
  });
})();
</script>`;
}
