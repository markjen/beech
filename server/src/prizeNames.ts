/**
 * Display names of everything the machines can give (the app's catalog,
 * src/world/items.ts, is the source; tests/items.test.ts keeps these equal).
 *
 * Kept in its own dependency-free module so the root test suite can import
 * it without dragging in the whole server (guide.ts pulls in hono, pg, jose
 * and friends, which only exist in server/node_modules).
 */
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
};
