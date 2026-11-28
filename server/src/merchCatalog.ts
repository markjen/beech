// The merch store's catalog (docs/MERCH_STORE.md): what store.beech.games
// sells, at what price, and which Printful catalog variant each choice is.
//
// Pure data and pure functions: no network, no database. The server prices
// every cart from here; the browser's prices are only for show.
//
// Variant ids, what each costs us, what an extra print placement costs and
// each placement's print-area size come from Printful's catalog, read by
// scripts/merch-catalog.mjs into generated/merchCatalogData.ts.
//
// Pricing (Mark, 2026-11-28): anything that shows off beech (the line mark,
// the wordmark, or the sample beach "Sunny cove") is sold at cost: what
// Printful charges for that colour and size, plus any extra placements,
// plus Stripe's fee, plus about $1, rounded up to the dollar. With the
// buyer's own beach instead, an item keeps a normal margin: its own price
// at the cheapest size, plus what a bigger size costs Printful more.
//
// The designs follow the review's rules: the beach is shown straight from
// above or straight from the side, never slanted; it sits in a square or a
// circle, never across the whole shirt; the bases are soft and neutral;
// line drawings over full pictures.
//
// Not sold yet: the sunglasses (stocked goods, MERCH_SUNGLASSES_VARIANT),
// all-over-print panel items (board shorts, swim trunks, the reversible
// bucket hat, the fanny pack), Tapstitch's heavyweight line (no order API),
// and a buyer's own beach from the side (needs a side-view renderer).

import { PRINTFUL_DATA } from './generated/merchCatalogData.js';

export type ProductId = string;

export interface Color {
  id: string;
  name: string;
  /** swatch on the store page */
  hex: string;
  /** a dark garment: brand art prints in light ink (<art>-light.png) */
  dark?: boolean;
}

/** Where a print sits in its placement's print area. */
export type Spot =
  | 'fill' // the whole area
  | 'contain' // as big as fits, centred
  | 'chest' // small, centred high on the chest
  | 'chest-side' // small, high on the wearer's left
  | 'back-square' // a 10″ square high on the back
  | 'front-square' // an 8″ square high on the front
  | 'back-badge' // an 11″ circle high on the back
  | 'leg-top'; // small, at the top of a sweatpants leg (by the pocket)

/** What a print shows: a brand file (public/merch/<file>), the sample beach, or the buyer's beach. */
export type Art = { file: string; light?: string } | { beach: 'square' | 'flat' };

export interface Print {
  placement: string;
  art: Art;
  spot: Spot;
  /** embroidery: thread colours for the dark and light ink */
  threads?: boolean;
}

export type Section = 'designs' | 'launch' | 'wear' | 'day' | 'home';

export interface Product {
  id: ProductId;
  name: string;
  /** one line under the name on the store page (a label, not a note) */
  blurb: string;
  section: Section;
  /** how the store page draws it */
  kind: string;
  /** generated/merchCatalogData.ts key */
  data: string;
  colors: Color[];
  sizes: string[];
  /** the brand version's prints (sample beach, line art, wordmark) */
  prints: Print[];
  /** with the buyer's own beach: its prints, and its price at the cheapest size */
  own?: { prints: Print[]; cents: number };
  /** the set: one of each of these, chosen separately */
  parts?: ProductId[];
}

// ------------------------------------------------------------------ colours
const C = (id: string, name: string, hex: string, dark = false): Color => ({ id, name, hex, ...(dark ? { dark } : {}) });
const WHITE = C('white', 'White', '#ffffff');
const TEE = [C('heather', 'Light heather gray', '#d6d6d3'), C('ash', 'Ash', '#f0f1ea'), WHITE, C('iceblue', 'Pale blue', '#c9e3e3'), C('natural', 'Natural', '#fef1d1')];
const HOODIE = [C('ash', 'Ash', '#dedede'), WHITE, C('sand', 'Sand', '#e7d3b3'), C('lightblue', 'Light blue', '#a1c5e1')];
const HAT = [C('stone', 'Stone', '#d6bdad'), C('khaki', 'Khaki', '#b49771'), C('lightblue', 'Light blue', '#b5cbda'), C('white', 'White', '#ffffff'), C('navy', 'Navy', '#182031', true)];
const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'];

// ------------------------------------------------------------------ prints
const front = (spot: Spot, art: Art): Print => ({ placement: 'front', art, spot });
const back = (spot: Spot, art: Art): Print => ({ placement: 'back', art, spot });
const MARK: Art = { file: 'mark.png', light: 'mark-light.png' };
const WORD: Art = { file: 'word.png' };
const SAMPLE_SQUARE: Art = { file: 'sample-square.png' };
const SAMPLE_FLAT: Art = { file: 'sample-flat.png' };
const OWN_SQUARE: Art = { beach: 'square' };
const OWN_FLAT: Art = { beach: 'flat' };
const fill = (file: string): Print[] => [{ placement: 'default', art: { file }, spot: 'fill' }];
const contain = (art: Art, placement = 'default'): Print[] => [{ placement, art, spot: 'contain' }];
const embroidered = (placement: string): Print[] => [{ placement, art: { file: 'mark-wide.png', light: 'mark-wide-light.png' }, spot: 'contain', threads: true }];

export const PRODUCTS: Product[] = [
  // the designs
  {
    id: 'top-tee', name: 'Top view tee', blurb: 'A small “beech” on the front, the beach from above on the back', section: 'designs', kind: 'tee-top', data: 'tee',
    colors: [TEE[0], TEE[1], TEE[2], TEE[3]], sizes: SIZES,
    prints: [front('chest-side', WORD), back('back-square', SAMPLE_SQUARE)],
    own: { prints: [front('chest-side', WORD), back('back-square', OWN_SQUARE)], cents: 3800 },
  },
  {
    id: 'side-tee', name: 'Side view tee', blurb: 'The beach from the side on the front, a line badge on the back', section: 'designs', kind: 'tee-side', data: 'tee',
    colors: [WHITE, TEE[1], TEE[3], TEE[0]], sizes: SIZES,
    prints: [front('front-square', { file: 'side-square.png' }), back('back-badge', { file: 'badge.png' })],
  },
  {
    id: 'top-hoodie', name: 'Top view hoodie', blurb: 'A small “beech” on the front, the beach from above on the back', section: 'designs', kind: 'hoodie-top', data: 'hoodie',
    colors: [HOODIE[0], HOODIE[1], HOODIE[3]], sizes: SIZES,
    prints: [front('chest-side', WORD), back('back-square', SAMPLE_SQUARE)],
    own: { prints: [front('chest-side', WORD), back('back-square', OWN_SQUARE)], cents: 6400 },
  },
  {
    id: 'sweatpants', name: 'Beech sweatpants', blurb: 'Heavyweight, “beech” by one pocket and a crab by the other', section: 'designs', kind: 'pants', data: 'sweatpants',
    colors: [C('dust', 'Dust', '#f4e7d6'), C('heather', 'Light heather gray', '#e4e4e1')], sizes: SIZES,
    prints: [{ placement: 'leg_front_left', art: WORD, spot: 'leg-top' }, { placement: 'leg_front_right', art: { file: 'crab.png' }, spot: 'leg-top' }],
  },
  {
    id: 'bottle', name: 'Layers bottle', blurb: 'A line drawing of the beach from the side, all the way round', section: 'designs', kind: 'bottle', data: 'bottle',
    colors: [WHITE], sizes: ['17 oz'], prints: contain({ file: 'wrap.png' }),
  },
  {
    id: 'tumbler', name: 'Layers tumbler', blurb: 'The same line drawing, all the way round a 20 oz tumbler', section: 'designs', kind: 'tumbler', data: 'tumbler',
    colors: [WHITE], sizes: ['20oz'], prints: contain({ file: 'wrap.png' }, 'front'),
  },
  // the launch six, now with the line mark
  { id: 'tee', name: 'Beech tee', blurb: 'Soft cotton, the line mark small on the chest', section: 'launch', kind: 'tee', data: 'tee', colors: TEE, sizes: SIZES, prints: [front('chest', MARK)] },
  { id: 'hoodie', name: 'Beech hoodie', blurb: 'Heavy blend, the line mark small on the chest', section: 'launch', kind: 'hoodie', data: 'hoodie', colors: HOODIE, sizes: SIZES, prints: [front('chest', MARK)] },
  { id: 'hat', name: 'Beech dad hat', blurb: 'The line mark, embroidered', section: 'launch', kind: 'cap', data: 'hat', colors: HAT, sizes: ['One size'], prints: embroidered('embroidery_front') },
  {
    id: 'flipflops', name: 'Beech flip flops', blurb: 'The sea and the sand on the footbeds', section: 'launch', kind: 'flipflops', data: 'flipflops',
    colors: [WHITE], sizes: ['S', 'M', 'L'], prints: fill('flipflops.png'),
  },
  {
    id: 'towel', name: 'Beech beach towel', blurb: '30″ × 60″, the sea and the sand', section: 'launch', kind: 'towel', data: 'towel',
    colors: [WHITE], sizes: ['30″×60″'], prints: fill('towel.png'), own: { prints: contain(OWN_FLAT), cents: 5200 },
  },
  { id: 'set', name: 'The whole beach set', blurb: 'Tee, hoodie, hat, flip flops and towel', section: 'launch', kind: 'set', data: '', colors: [], sizes: [], prints: [], parts: ['tee', 'hoodie', 'hat', 'flipflops', 'towel'] },
  // more to wear
  { id: 'oversized-hoodie', name: 'Oversized heavyweight hoodie', blurb: '10 oz, the line mark small on the chest', section: 'wear', kind: 'hoodie', data: 'oversized-hoodie', colors: [C('dust', 'Dust', '#f4e7d6'), C('grey', 'Vintage heather gray', '#e9e4da'), WHITE], sizes: SIZES, prints: [front('chest', MARK)] },
  { id: 'boxy-tee', name: 'Boxy tee', blurb: 'Oversized, the line mark small on the chest', section: 'wear', kind: 'tee-boxy', data: 'boxy-tee', colors: [C('natural', 'Natural', '#fff8ea'), C('heather', 'Light heather gray', '#d6d6d3'), WHITE], sizes: SIZES, prints: [front('chest', MARK)] },
  { id: 'tank', name: 'Tank top', blurb: 'The line mark small on the chest', section: 'wear', kind: 'tank', data: 'tank', colors: [WHITE, C('heather', 'Light heather gray', '#d6d6d3')], sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL'], prints: [front('chest', MARK)] },
  // beach day
  { id: 'beanie', name: 'Cuffed beanie', blurb: 'The line mark, embroidered', section: 'day', kind: 'beanie', data: 'beanie', colors: [C('grey', 'Heather gray', '#c9c9c6'), WHITE, C('navy', 'Navy', '#1f2a44', true)], sizes: ['One size'], prints: embroidered('embroidery_front') },
  { id: 'bucket-hat', name: 'Bucket hat', blurb: 'Organic cotton, the line mark on the front', section: 'day', kind: 'bucket', data: 'bucket-hat', colors: [C('natural', 'Natural', '#fcf0dc'), C('grey', 'Heather gray', '#c4c4c4')], sizes: ['S/M', 'M/L'], prints: [{ placement: 'front_dtf_hat', art: { file: 'mark-wide.png' }, spot: 'contain' }] },
  { id: 'tote', name: 'Beach tote', blurb: '15″ × 15″, the sea and the sand', section: 'day', kind: 'tote', data: 'tote', colors: [C('black', 'Black handles', '#1d2d38')], sizes: ['15″×15″'], prints: fill('tote.png'), own: { prints: contain(OWN_FLAT), cents: 3600 } },
  {
    id: 'socks', name: 'Socks', blurb: 'The sea at the cuff, the sand below', section: 'day', kind: 'socks', data: 'socks', colors: [C('default', 'White', '#ffffff')], sizes: ['S', 'M', 'L'],
    prints: ['leg_front_right', 'leg_front_left', 'leg_back_right', 'leg_back_left'].map((placement) => ({ placement, art: { file: 'socks.png' }, spot: 'fill' as Spot })),
  },
  { id: 'sticker', name: 'Sticker', blurb: 'The line mark, kiss-cut', section: 'day', kind: 'sticker', data: 'sticker', colors: [WHITE], sizes: ['3″×3″', '4″×4″', '5.5″×5.5″'], prints: contain(MARK), own: { prints: contain(OWN_SQUARE), cents: 700 } },
  // home and wall: the beach from above (Sunny cove, or theirs)
  { id: 'mug', name: 'Layers mug', blurb: 'The line drawing round a white mug', section: 'home', kind: 'mug', data: 'mug', colors: [WHITE], sizes: ['11 oz', '15 oz'], prints: contain({ file: 'wrap.png' }), own: { prints: contain(OWN_FLAT), cents: 2200 } },
  { id: 'poster', name: 'Poster', blurb: 'Matte paper, the beach from above', section: 'home', kind: 'poster', data: 'poster', colors: [C('default', 'Matte', '#ffffff')], sizes: ['12″×16″', '18″×24″', '24″×36″'], prints: contain(SAMPLE_FLAT), own: { prints: contain(OWN_FLAT), cents: 3600 } },
  { id: 'framed-poster', name: 'Framed poster', blurb: 'Luster photo paper, the beach from above', section: 'home', kind: 'frame', data: 'framed-poster', colors: [C('oak', 'Oak frame', '#b07a4c'), C('black', 'Black frame', '#1d2d38'), C('white', 'White frame', '#ffffff')], sizes: ['12″×16″', '18″×24″'], prints: contain(SAMPLE_FLAT), own: { prints: contain(OWN_FLAT), cents: 6900 } },
  { id: 'canvas', name: 'Framed canvas', blurb: 'The beach from above', section: 'home', kind: 'canvas', data: 'canvas', colors: [C('black', 'Black frame', '#1d2d38'), C('brown', 'Brown frame', '#6b4a32')], sizes: ['12″×16″', '16″×20″', '18″×24″'], prints: contain(SAMPLE_FLAT), own: { prints: contain(OWN_FLAT), cents: 12500 } },
  { id: 'puzzle', name: 'Jigsaw puzzle', blurb: 'The beach from above', section: 'home', kind: 'puzzle', data: 'puzzle', colors: [C('default', 'Puzzle', '#ffffff')], sizes: ['252 pieces', '520 pieces'], prints: contain(SAMPLE_FLAT), own: { prints: contain(OWN_FLAT), cents: 4600 } },
  { id: 'blanket', name: 'Sherpa blanket', blurb: 'The beach from above, edge to edge', section: 'home', kind: 'blanket', data: 'blanket', colors: [C('tan', 'Tan sherpa', '#e8d6b8')], sizes: ['50″×60″', '60″×80″'], prints: [{ placement: 'default', art: SAMPLE_FLAT, spot: 'fill' }], own: { prints: [{ placement: 'default', art: OWN_FLAT, spot: 'fill' }], cents: 7900 } },
  { id: 'pillow', name: 'Outdoor pillow', blurb: 'The beach from above on both sides', section: 'home', kind: 'pillow', data: 'pillow', colors: [C('default', 'Pillow', '#ffffff')], sizes: ['18″×18″', '20″×20″'], prints: [{ placement: 'front', art: SAMPLE_SQUARE, spot: 'fill' }, { placement: 'back', art: SAMPLE_SQUARE, spot: 'fill' }], own: { prints: [{ placement: 'front', art: OWN_SQUARE, spot: 'fill' }, { placement: 'back', art: OWN_SQUARE, spot: 'fill' }], cents: 4400 } },
];

export const productById = (id: string): Product | undefined => PRODUCTS.find((p) => p.id === id);

/** What the store sells beyond the products' own prices. */
export const MERCH = {
  /** most of one thing in one order */
  maxQuantity: 10,
  /** most lines in one cart */
  maxLines: 20,
  /** flat shipping per order, in cents, and the subtotal that ships free */
  shippingCents: 800,
  freeShippingFromCents: 10000,
  /** where Printful ships from its US/EU warehouses at the flat rate */
  countries: ['US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'DK', 'SE', 'FI', 'PT', 'PL', 'CH', 'NO', 'JP'],
  /** a buyer's beach, from above: the square (10″ at 150 dpi) and the wide view, before Printful fits it */
  squarePx: 1500,
  flatWidth: 2400,
  flatHeight: 1260,
  /** at cost: Stripe's 2.9% + 30¢, plus about this much, rounded up to the dollar */
  atCostMarginCents: 100,
  /** a "sending" claim older than this goes back to "paid" (specs/tla/MerchOrders.tla, Recover) */
  staleClaimMs: 10 * 60 * 1000,
} as const;

// ------------------------------------------------------------------ prices
const dataOf = (p: Product) => PRINTFUL_DATA[p.data];

/** What one of these costs us at Printful: the variant (its first placement included) plus each extra placement. */
export function costCents(p: Product, color: string, size: string, prints: Print[] = p.prints): number | null {
  const d = dataOf(p);
  const v = d?.variants[`${color}/${size}`];
  if (!v) return null;
  return v[1] + prints.slice(1).reduce((s, x) => s + (d.placementCents[x.placement] ?? 0), 0);
}

/** At cost: our cost plus Stripe's fee plus about $1, rounded up to whole dollars. */
export const atCost = (cost: number): number => Math.ceil((cost + 30 + MERCH.atCostMarginCents) / 0.971 / 100) * 100;

/** The cheapest variant's cost (the own-beach price is set for it; bigger sizes add what they cost more). */
const minCost = (p: Product, prints: Print[]): number =>
  Math.min(...p.colors.flatMap((c) => p.sizes.map((s) => costCents(p, c.id, s, prints) ?? Infinity)));

/** A unit price in cents for one colour and size, as the brand version or with the buyer's beach; null when not sold. */
export function unitCents(p: Product, color: string, size: string, own = false): number | null {
  if (own) {
    if (!p.own) return null;
    const c = costCents(p, color, size, p.own.prints);
    if (c === null) return null;
    return p.own.cents + Math.ceil((c - minCost(p, p.own.prints)) / 100) * 100;
  }
  const c = costCents(p, color, size);
  return c === null ? null : atCost(c);
}

/** The set's price for its chosen parts: at cost, one Stripe fee for the lot. */
export function setCents(p: Product, parts: Record<string, Choice>): number | null {
  let cost = 0;
  for (const id of p.parts ?? []) {
    const part = productById(id)!;
    const c = parts[id];
    const x = c?.color && c.size ? costCents(part, c.color, c.size) : null;
    if (x === null) return null;
    cost += x;
  }
  return atCost(cost);
}

/**
 * Every colour/size's price, for the store page: { 'colour/size': cents }, the
 * same with the buyer's beach, and what each costs us (the page works out the
 * set's at-cost price from these, as setCents does).
 */
export function priceTable(p: Product): { prices: Record<string, number>; ownPrices: Record<string, number> | null; costs: Record<string, number> } {
  const prices: Record<string, number> = {};
  const ownPrices: Record<string, number> = {};
  const costs: Record<string, number> = {};
  for (const c of p.colors)
    for (const s of p.sizes) {
      const k = `${c.id}/${s}`;
      const a = unitCents(p, c.id, s);
      if (a !== null) prices[k] = a;
      const b = unitCents(p, c.id, s, true);
      if (b !== null) ownPrices[k] = b;
      const x = costCents(p, c.id, s);
      if (x !== null) costs[k] = x;
    }
  return { prices, ownPrices: p.own ? ownPrices : null, costs };
}

// ------------------------------------------------------------------ carts

/** One choice of one product (the set names one choice per part). */
export interface Choice {
  color?: string;
  size?: string;
}

/** A cart line as the browser sends it. */
export interface CartLine {
  product: string;
  quantity: number;
  color?: string;
  size?: string;
  /** with the buyer's own beach: which of their beaches */
  beachId?: string;
  /** the set: a choice per part */
  parts?: Record<string, Choice>;
}

/** A line the server has checked and priced. */
export interface PricedLine {
  product: ProductId;
  name: string;
  quantity: number;
  unitCents: number;
  /** what was chosen, shown on the order and the receipt */
  label: string;
  choice: Choice;
  parts?: Record<string, Choice>;
  beachId?: string;
}

export type Availability = { sunglassesVariant: number | null };

/** Sold now: every colour/size it lists has a Printful variant (the set: all its parts). */
export const isAvailable = (p: Product, _a?: Availability): boolean =>
  p.parts ? p.parts.every((id) => isAvailable(productById(id)!)) : p.colors.length > 0 && p.colors.every((c) => p.sizes.every((s) => costCents(p, c.id, s) !== null));

/** Check a color and size against a product; returns the normalized choice or an error. */
function checkChoice(p: Product, c: Choice): Choice | string {
  const color = p.colors.length === 1 ? p.colors[0].id : c.color;
  const size = p.sizes.length === 1 ? p.sizes[0] : c.size;
  if (!color || !p.colors.some((x) => x.id === color)) return `pick a color for the ${p.name.toLowerCase()}`;
  if (!size || !p.sizes.includes(size)) return `pick a size for the ${p.name.toLowerCase()}`;
  return { color, size };
}

const describe = (p: Product, c: Choice): string => {
  const bits: string[] = [];
  if (p.colors.length > 1) bits.push(p.colors.find((x) => x.id === c.color)!.name);
  if (p.sizes.length > 1) bits.push(c.size!);
  return bits.join(', ');
};

/**
 * Price a cart. Returns the priced lines and the totals, or the first
 * problem in words a shopper can act on. Beach ids are only checked for
 * shape here; the caller checks the shopper owns them.
 */
export function priceCart(
  lines: unknown,
  _a?: Availability,
): { ok: true; lines: PricedLine[]; subtotalCents: number; shippingCents: number } | { ok: false; error: string } {
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, error: 'your bag is empty' };
  if (lines.length > MERCH.maxLines) return { ok: false, error: 'that’s too many things for one order' };
  const out: PricedLine[] = [];
  for (const raw of lines as CartLine[]) {
    const p = raw && typeof raw.product === 'string' ? productById(raw.product) : undefined;
    if (!p) return { ok: false, error: 'something in your bag isn’t sold any more' };
    if (!isAvailable(p)) return { ok: false, error: `the ${p.name.toLowerCase()} is sold out` };
    const q = raw.quantity;
    if (!Number.isInteger(q) || q < 1 || q > MERCH.maxQuantity) return { ok: false, error: `up to ${MERCH.maxQuantity} of one thing` };
    if (p.parts) {
      const parts: Record<string, Choice> = {};
      const labels: string[] = [];
      for (const id of p.parts) {
        const part = productById(id)!;
        const c = checkChoice(part, raw.parts?.[id] ?? {});
        if (typeof c === 'string') return { ok: false, error: c };
        parts[id] = c;
        const d = describe(part, c);
        if (d) labels.push(`${part.name.replace(/^Beech /, '')}: ${d}`);
      }
      out.push({ product: p.id, name: p.name, quantity: q, unitCents: setCents(p, parts)!, label: labels.join(' · '), choice: {}, parts });
      continue;
    }
    const c = checkChoice(p, raw);
    if (typeof c === 'string') return { ok: false, error: c };
    const own = raw.beachId !== undefined && raw.beachId !== null && raw.beachId !== '';
    if (own && !p.own) return { ok: false, error: `the ${p.name.toLowerCase()} can’t print your beach` };
    if (own && (typeof raw.beachId !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw.beachId))) return { ok: false, error: `pick a beach for your ${p.name.toLowerCase()}` };
    const unit = unitCents(p, c.color!, c.size!, own);
    if (unit === null) return { ok: false, error: `that ${p.name.toLowerCase()} isn’t available` };
    out.push({ product: p.id, name: p.name, quantity: q, unitCents: unit, label: describe(p, c), choice: c, ...(own ? { beachId: raw.beachId } : {}) });
  }
  const subtotalCents = out.reduce((s, l) => s + l.unitCents * l.quantity, 0);
  const shippingCents = subtotalCents >= MERCH.freeShippingFromCents ? 0 : MERCH.shippingCents;
  return { ok: true, lines: out, subtotalCents, shippingCents };
}

// ------------------------------------------------------------------ Printful items

/** Printful's file position inside a placement's print area (v1 orders). */
export interface FilePosition {
  area_width: number;
  area_height: number;
  width: number;
  height: number;
  top: number;
  left: number;
  limit_to_print_area: boolean;
}

/** One thing for Printful to make: a catalog variant with its files. */
export interface PrintItem {
  variantId?: number;
  warehouseVariantId?: number;
  quantity: number;
  /** cents, for the packing slip and customs */
  retailCents: number;
  name: string;
  files?: { type: string; url: string; position?: FilePosition }[];
  /** Printful order-item options (embroidery thread colours) */
  options?: { id: string; value: string[] }[];
}

/**
 * Embroidery thread colours. Printful's Orders API refuses an embroidered
 * item without them ("thread_colors option is missing or incorrect!"): an
 * item-level `thread_colors` for `embroidery_front`, `thread_colors_<rest>`
 * for other embroidery placements. The line mark is one ink: black thread
 * on light hats, white on dark ones.
 */
export const threadColors = (dark: boolean): string[] => (dark ? ['#FFFFFF'] : ['#000000']);
const threadOptionId = (placement: string): string => (placement === 'embroidery_front' ? 'thread_colors' : `thread_colors_${placement.replace(/^embroidery_/, '')}`);

/** The art's own size in pixels when known (brand files are drawn at these; a beach print at MERCH sizes). */
export const ART_SIZES: Record<string, [number, number]> = {
  'mark.png': [900, 800], 'mark-light.png': [900, 800], 'word.png': [900, 300], 'crab.png': [600, 420],
  'mark-wide.png': [1650, 600], 'mark-wide-light.png': [1650, 600],
  'side-square.png': [1200, 1200], 'badge.png': [1650, 1650], 'wrap.png': [3000, 760],
  'sample-square.png': [MERCH.squarePx, MERCH.squarePx], 'sample-flat.png': [MERCH.flatWidth, MERCH.flatHeight],
};
const artSize = (art: Art): [number, number] =>
  'beach' in art ? (art.beach === 'square' ? [MERCH.squarePx, MERCH.squarePx] : [MERCH.flatWidth, MERCH.flatHeight]) : (ART_SIZES[art.file] ?? [0, 0]);

/** Where the art goes in an area of aw × ah px (Printful's file position). */
export function positionFor(spot: Spot, aw: number, ah: number, art: [number, number]): FilePosition {
  const [iw, ih] = art[0] && art[1] ? art : [aw, ah];
  const box = (w: number, top: number, left?: number) => {
    const h = Math.round((w * ih) / iw);
    return { width: Math.round(w), height: h, top: Math.round(top), left: Math.round(left ?? (aw - w) / 2) };
  };
  const contain = () => {
    const s = Math.min(aw / iw, ah / ih);
    return { width: Math.round(iw * s), height: Math.round(ih * s), top: Math.round((ah - ih * s) / 2), left: Math.round((aw - iw * s) / 2) };
  };
  const pos = (() => {
    switch (spot) {
      case 'fill': return { width: aw, height: ah, top: 0, left: 0 };
      case 'contain': return contain();
      case 'chest': return box(aw * 0.25, ah * 0.07);
      case 'chest-side': return box(aw * 0.22, ah * 0.06, aw * 0.66);
      case 'back-square': return box(aw * (10 / 12), ah * 0.06);
      case 'front-square': return box(aw * (8 / 12), ah * 0.07);
      case 'back-badge': return box(aw * (11 / 12), ah * 0.05);
      case 'leg-top': return box(aw * 0.8, ah * 0.05);
    }
  })();
  return { area_width: aw, area_height: ah, ...pos, limit_to_print_area: true };
}

/**
 * The Printful items for one priced line. `artUrl(file)` is the public URL
 * of a brand print file, `beachUrl` the line's own beach print (lines with
 * the buyer's beach only). The set's price is split over its parts by their
 * at-cost prices, so the slip adds up to what was paid.
 */
export function printItems(
  line: { product: string; quantity: number; unitCents: number; choice: Choice; parts?: Record<string, Choice> | null },
  _a: Availability | undefined,
  artUrl: (file: string) => string,
  beachUrl?: string,
): PrintItem[] {
  const p = productById(line.product);
  if (!p) throw new Error(`unknown product ${line.product}`);
  const one = (part: Product, c: Choice, retailCents: number, own: boolean): PrintItem => {
    const d = dataOf(part);
    const v = d?.variants[`${c.color}/${c.size}`];
    if (!v) throw new Error(`no variant for ${part.id} ${c.color}/${c.size}`);
    const dark = !!part.colors.find((x) => x.id === c.color)?.dark;
    const prints = own ? part.own!.prints : part.prints;
    const options: { id: string; value: string[] }[] = [];
    const files = prints.map((pr) => {
      let url: string;
      if ('beach' in pr.art) {
        if (!beachUrl) throw new Error(`no beach print for ${part.id}`);
        url = beachUrl;
      } else url = artUrl(dark && pr.art.light ? pr.art.light : pr.art.file);
      const area = d.printfiles[pr.placement];
      if (pr.threads) options.push({ id: threadOptionId(pr.placement), value: threadColors(dark) });
      return { type: pr.placement, url, ...(area ? { position: positionFor(pr.spot, area[0], area[1], artSize(pr.art)) } : {}) };
    });
    return { variantId: v[0], quantity: line.quantity, retailCents, name: part.name, files, ...(options.length ? { options } : {}) };
  };
  if (!p.parts) return [one(p, line.choice, line.unitCents, !!beachUrl)];
  const parts = p.parts.map((id) => productById(id)!);
  const each = parts.map((part) => unitCents(part, line.parts?.[part.id]?.color ?? '', line.parts?.[part.id]?.size ?? '') ?? 0);
  const full = each.reduce((s, x) => s + x, 0) || 1;
  let left = line.unitCents;
  return parts.map((part, i) => {
    const share = i === parts.length - 1 ? left : Math.round((line.unitCents * each[i]) / full);
    left -= share;
    return one(part, line.parts?.[part.id] ?? {}, share, false);
  });
}
