/**
 * Display names of everything the machines can give (the app's catalog,
 * src/world/items.ts, is the source; tests/items.test.ts keeps these equal).
 *
 * Kept in its own dependency-free module so the root test suite can import
 * it without dragging in the whole server (guide.ts pulls in hono, pg, jose
 * and friends, which only exist in server/node_modules).
 *
 * The guide (server/src/guide.ts) lists the whole catalog, but the server
 * can't import the catalog itself: the production image only copies
 * server/src (see the Dockerfile), so src/world/items.ts isn't there.
 * What the guide needs per item lives here instead, as mirrors of the
 * catalog, and tests/items.test.ts keeps every mirror in step with the
 * catalog — a catalog change that isn't mirrored here fails the tests:
 *
 * - PRIZE_NAMES: every catalog item's name, plus the extra beach.
 * - displayName: the name, or the id made readable (single-word ids like
 *   `footprints` read as their name, so a new free item joins the guide
 *   on its own).
 * - ITEM_RARITY: only the rarities the guide can't derive — shop items,
 *   the rare free cowrie, and the extra beach. Pull rarities come from
 *   the pool or set tier an item is drawn at; other free items are
 *   common.
 * - KIND_OVERRIDES: only the items whose kind isn't their id (a prize
 *   sharing a kind with a free item, like the pink shell). Most items
 *   are their own kind.
 * - GLOW_ITEMS: the items with a glow in their own finish
 *   (src/palette.ts ITEM_LOOKS), beyond the rare/legendary/unique
 *   things, which all glow.
 */

import type { Rarity } from './pulls.js';

export const PRIZE_NAMES: Record<string, string> = {
  conch: 'Conch',
  sanddollar: 'Sand dollar',
  starfish: 'Starfish',
  coral: 'Coral',
  coconut: 'Coconut',
  bottle: 'Message in a bottle',
  'pink-shell': 'Pink shell',
  'blue-seaglass': 'Blue sea glass',
  pebble: 'Pebble',
  'spiral-conch': 'Spiral conch',
  'gold-sanddollar': 'Golden sand dollar',
  'sunset-starfish': 'Sunset starfish',
  'green-bottle': 'Green bottle',
  nautilus: 'Nautilus',
  'beach-ball': 'Beach ball',
  sandals: 'Sandals',
  bucket: 'Bucket',
  rock: 'Rock',
  driftwood: 'Driftwood',
  shell: 'Shell',
  seaglass: 'Sea glass',
  trash: 'Trash',
  seaweed: 'Seaweed',
  cowrie: 'Cowrie',
  flag: 'Flag',
  deckchair: 'Deckchair',
  parasol: 'Parasol',
  surfboard: 'Surfboard',
  tikitorch: 'Tiki torch',
  sandcastle: 'Sandcastle',
  beachhut: 'Beach hut',
  lighthouse: 'Lighthouse',
  palmtree: 'Palm tree',
  lifeguardtower: 'Lifeguard tower',
  bonfire: 'Bonfire',
  hammock: 'Hammock',
  towel: 'Beach towel',
  beach: 'Extra beach',
};

/** The name as the guide shows it: the table, or the id made readable. */
export function displayName(id: string): string {
  return PRIZE_NAMES[id] ?? id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Rarities the guide can't derive: shop items, the rare free cowrie, and
 * the extra beach. Every other item's rarity comes from the pool or set
 * tier it is drawn at, or from being a free item (common).
 */
export const ITEM_RARITY: Record<string, Rarity> = {
  cowrie: 'rare',
  deckchair: 'rare',
  parasol: 'rare',
  surfboard: 'rare',
  tikitorch: 'rare',
  bonfire: 'rare',
  hammock: 'rare',
  towel: 'rare',
  sandcastle: 'legendary',
  beachhut: 'legendary',
  lighthouse: 'legendary',
  palmtree: 'legendary',
  lifeguardtower: 'legendary',
  beach: 'legendary',
};

/**
 * Items whose kind isn't their id. Everything else is its own kind, so a
 * new item on a new kind needs no entry here.
 */
export const KIND_OVERRIDES: Record<string, string> = {
  cowrie: 'shell',
  'pink-shell': 'shell',
  'blue-seaglass': 'seaglass',
  pebble: 'rock',
  'spiral-conch': 'conch',
  'gold-sanddollar': 'sanddollar',
  'sunset-starfish': 'starfish',
  'green-bottle': 'bottle',
  'beach-ball': 'beachball',
};

/** Items with a glow in their own finish (ITEM_LOOKS), beyond the rare and better things, which all glow. */
export const GLOW_ITEMS: ReadonlySet<string> = new Set(['gold-sanddollar']);
