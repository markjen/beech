// The merch store's catalog (docs/MERCH_STORE.md): what store.beech.games
// sells, at what price, and which Printful catalog variant each choice is.
//
// Pure data and pure functions: no network, no database. The server prices
// every cart from here; the browser's prices are only for show.
//
// Printful variant ids come from Printful's public catalog API
// (GET https://api.printful.com/products/<id>), checked 2026-11-27. The
// sunglasses aren't in Printful's print-on-demand catalog: they are stocked
// goods kept in Printful's warehouse (Printful Warehousing), so they ship in
// the same box. Their warehouse variant id is a setting
// (MERCH_SUNGLASSES_VARIANT); until it is set, the sunglasses and the set
// show as sold out.

export type ProductId = 'tee' | 'hoodie' | 'hat' | 'flipflops' | 'towel' | 'sunglasses' | 'beach-tee' | 'beach-hoodie' | 'set';

export interface Color {
  id: string;
  name: string;
  /** swatch on the store page */
  hex: string;
  /** a dark garment: brand art prints in light ink (<art>-light.png) */
  dark?: boolean;
}

export interface Product {
  id: ProductId;
  name: string;
  /** one line under the name on the store page (a label, not a note) */
  blurb: string;
  cents: number;
  colors: Color[];
  sizes: string[];
  /** Printful catalog product (for the record; orders name variants) */
  printfulProduct?: number;
  /** Printful variant id for a color+size: `${color}/${size}` */
  variants: Record<string, number>;
  /** Printful placement the print file goes on */
  placement: string;
  /** the brand artwork this product prints (public/merch/<file>); beach prints draw the shopper's beach instead */
  art?: string;
  /** prints the shopper's own beach (needs a signed-in shopper and one of their beaches) */
  beachPrint?: boolean;
  /** stocked in Printful's warehouse, not printed on demand */
  warehouse?: boolean;
  /** the set: one of each of these, chosen separately */
  parts?: ProductId[];
}

const TEE_COLORS: Color[] = [
  { id: 'white', name: 'White', hex: '#ffffff' },
  { id: 'cream', name: 'Soft cream', hex: '#e7d4c0' },
  { id: 'ocean', name: 'Ocean blue', hex: '#a9dff6' },
  { id: 'aqua', name: 'Aqua', hex: '#008db5', dark: true },
  { id: 'black', name: 'Black', hex: '#0c0c0c', dark: true },
];
const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
// Bella + Canvas 3001 (Printful product 71)
const TEE_VARIANTS = grid(TEE_COLORS, SIZES, {
  white: [4011, 4012, 4013, 4014, 4015, 5294],
  cream: [4151, 4152, 4153, 4154, 4155, 5305],
  ocean: [4116, 4117, 4118, 4119, 4120, 5302],
  aqua: [4021, 4022, 4023, 4024, 4025, 5296],
  black: [4016, 4017, 4018, 4019, 4020, 5295],
});

const HOODIE_COLORS: Color[] = [
  { id: 'sand', name: 'Sand', hex: '#e7d3b3' },
  { id: 'white', name: 'White', hex: '#ffffff' },
  { id: 'lightblue', name: 'Light blue', hex: '#a1c5e1' },
  { id: 'navy', name: 'Navy', hex: '#131928', dark: true },
  { id: 'black', name: 'Black', hex: '#0b0b0b', dark: true },
];
// Gildan 18500 (Printful product 146)
const HOODIE_VARIANTS = grid(HOODIE_COLORS, SIZES, {
  sand: [12997, 12998, 12999, 13000, 13001, 13002],
  white: [5522, 5523, 5524, 5525, 5526, 5527],
  lightblue: [10841, 10842, 10843, 10844, 10845, 10846],
  navy: [5594, 5595, 5596, 5597, 5598, 5599],
  black: [5530, 5531, 5532, 5533, 5534, 5535],
});

const HAT_COLORS: Color[] = [
  { id: 'khaki', name: 'Khaki', hex: '#b49771' },
  { id: 'stone', name: 'Stone', hex: '#d6bdad' },
  { id: 'lightblue', name: 'Light blue', hex: '#b5cbda' },
  { id: 'navy', name: 'Navy', hex: '#182031', dark: true },
  { id: 'white', name: 'White', hex: '#ffffff' },
];
// Yupoong 6245CM classic dad hat (Printful product 206), embroidered
const HAT_VARIANTS: Record<string, number> = { 'khaki/One size': 7855, 'stone/One size': 7859, 'lightblue/One size': 7856, 'navy/One size': 7857, 'white/One size': 7853 };

const WHITE: Color[] = [{ id: 'white', name: 'White', hex: '#ffffff' }];
const ONE = ['One size'];

function grid(colors: Color[], sizes: string[], ids: Record<string, number[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of colors) sizes.forEach((s, i) => (out[`${c.id}/${s}`] = ids[c.id][i]));
  return out;
}

export const PRODUCTS: Product[] = [
  { id: 'tee', name: 'Beech tee', blurb: 'Soft cotton, the beech logo on the front', cents: 3000, colors: TEE_COLORS, sizes: SIZES, printfulProduct: 71, variants: TEE_VARIANTS, placement: 'front', art: 'logo-front.png' },
  { id: 'hoodie', name: 'Beech hoodie', blurb: 'Heavy blend hoodie, the beech logo on the front', cents: 5500, colors: HOODIE_COLORS, sizes: SIZES, printfulProduct: 146, variants: HOODIE_VARIANTS, placement: 'front', art: 'logo-front.png' },
  { id: 'hat', name: 'Beech dad hat', blurb: 'Embroidered, adjustable', cents: 2800, colors: HAT_COLORS, sizes: ONE, printfulProduct: 206, variants: HAT_VARIANTS, placement: 'embroidery_front', art: 'logo-hat.png' },
  {
    id: 'flipflops', name: 'Beech flip flops', blurb: 'Printed footbeds', cents: 3000, colors: WHITE,
    sizes: ['S', 'M', 'L'], printfulProduct: 359, variants: { 'white/S': 10170, 'white/M': 10171, 'white/L': 10172 }, placement: 'default', art: 'flipflops.png',
  },
  { id: 'towel', name: 'Beech beach towel', blurb: '30″ × 60″, printed edge to edge', cents: 4500, colors: WHITE, sizes: ['30″ × 60″'], printfulProduct: 259, variants: { 'white/30″ × 60″': 8874 }, placement: 'default', art: 'towel.png' },
  { id: 'sunglasses', name: 'Beech sunglasses', blurb: 'UV400, beech on the arm', cents: 2200, colors: [{ id: 'white', name: 'White', hex: '#ffffff' }], sizes: ONE, variants: {}, placement: '', warehouse: true },
  { id: 'beach-tee', name: 'Your beach tee', blurb: 'Your own beach, printed big on the front', cents: 3600, colors: TEE_COLORS, sizes: SIZES, printfulProduct: 71, variants: TEE_VARIANTS, placement: 'front', beachPrint: true },
  { id: 'beach-hoodie', name: 'Your beach hoodie', blurb: 'Your own beach, printed big on the front', cents: 6200, colors: HOODIE_COLORS, sizes: SIZES, printfulProduct: 146, variants: HOODIE_VARIANTS, placement: 'front', beachPrint: true },
  { id: 'set', name: 'The whole beach set', blurb: 'Tee, hoodie, hat, flip flops, sunglasses and towel', cents: 17900, colors: [], sizes: [], variants: {}, placement: '', parts: ['tee', 'hoodie', 'hat', 'flipflops', 'sunglasses', 'towel'] },
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
  /** a beach print's file: Printful's 3001 front area is 12″ × 16″ at 150 dpi; the beach is drawn 12″ wide */
  printWidth: 1800,
  printHeight: 945,
  /** a "sending" claim older than this goes back to "paid" (specs/tla/MerchOrders.tla, Recover) */
  staleClaimMs: 10 * 60 * 1000,
} as const;

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
  /** beach prints: which of the shopper's beaches */
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

export const isAvailable = (p: Product, a: Availability): boolean =>
  p.warehouse ? a.sunglassesVariant !== null : !p.parts || p.parts.every((id) => isAvailable(productById(id)!, a));

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
  a: Availability,
): { ok: true; lines: PricedLine[]; subtotalCents: number; shippingCents: number } | { ok: false; error: string } {
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, error: 'your bag is empty' };
  if (lines.length > MERCH.maxLines) return { ok: false, error: 'that’s too many things for one order' };
  const out: PricedLine[] = [];
  for (const raw of lines as CartLine[]) {
    const p = raw && typeof raw.product === 'string' ? productById(raw.product) : undefined;
    if (!p) return { ok: false, error: 'something in your bag isn’t sold any more' };
    if (!isAvailable(p, a)) return { ok: false, error: `the ${p.name.toLowerCase()} is sold out` };
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
      out.push({ product: p.id, name: p.name, quantity: q, unitCents: p.cents, label: labels.join(' · '), choice: {}, parts });
      continue;
    }
    const c = checkChoice(p, raw);
    if (typeof c === 'string') return { ok: false, error: c };
    if (p.beachPrint && (typeof raw.beachId !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw.beachId)))
      return { ok: false, error: `pick a beach for your ${p.name.replace(/^Your beach /, '')}` };
    out.push({ product: p.id, name: p.name, quantity: q, unitCents: p.cents, label: describe(p, c), choice: c, ...(p.beachPrint ? { beachId: raw.beachId } : {}) });
  }
  const subtotalCents = out.reduce((s, l) => s + l.unitCents * l.quantity, 0);
  const shippingCents = subtotalCents >= MERCH.freeShippingFromCents ? 0 : MERCH.shippingCents;
  return { ok: true, lines: out, subtotalCents, shippingCents };
}

/** One thing for Printful to make or pick: a catalog variant with its file, or a warehouse variant. */
export interface PrintItem {
  variantId?: number;
  warehouseVariantId?: number;
  quantity: number;
  /** cents, for the packing slip and customs */
  retailCents: number;
  name: string;
  /** placement → file URL */
  files?: { type: string; url: string }[];
}

/**
 * The Printful items for one priced line. `artUrl(file)` is the public URL
 * of a brand print file, `beachUrl` the line's own beach print (beach
 * prints only). The set's price is split over its parts by their own
 * prices, so the slip adds up to what was paid.
 */
export function printItems(
  line: { product: string; quantity: number; unitCents: number; choice: Choice; parts?: Record<string, Choice> | null },
  a: Availability,
  artUrl: (file: string) => string,
  beachUrl?: string,
): PrintItem[] {
  const p = productById(line.product);
  if (!p) throw new Error(`unknown product ${line.product}`);
  const one = (part: Product, c: Choice, retailCents: number): PrintItem => {
    if (part.warehouse) {
      if (a.sunglassesVariant === null) throw new Error(`${part.id} has no warehouse variant`);
      return { warehouseVariantId: a.sunglassesVariant, quantity: line.quantity, retailCents, name: part.name };
    }
    const variantId = part.variants[`${c.color}/${c.size}`];
    if (!variantId) throw new Error(`no variant for ${part.id} ${c.color}/${c.size}`);
    const dark = part.colors.find((x) => x.id === c.color)?.dark;
    const url = part.beachPrint ? beachUrl : artUrl(dark ? part.art!.replace(/\.png$/, '-light.png') : part.art!);
    if (!url) throw new Error(`no print file for ${part.id}`);
    return { variantId, quantity: line.quantity, retailCents, name: part.name, files: [{ type: part.placement, url }] };
  };
  if (!p.parts) return [one(p, line.choice, line.unitCents)];
  const parts = p.parts.map((id) => productById(id)!);
  const full = parts.reduce((s, x) => s + x.cents, 0);
  let left = line.unitCents;
  return parts.map((part, i) => {
    const share = i === parts.length - 1 ? left : Math.round((line.unitCents * part.cents) / full);
    left -= share;
    return one(part, line.parts?.[part.id] ?? {}, share);
  });
}
