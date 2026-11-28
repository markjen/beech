// Reads the merch store's Printful catalog data (docs/MERCH_STORE.md) and
// writes server/src/generated/merchCatalogData.ts: for every product the
// store sells, each colour/size's Printful variant id and its cost to us,
// what each extra print placement costs, and each placement's print-file
// size. The server prices "at cost" items from these numbers, so rerun this
// when Printful's prices change, and commit the result.
//
//   PRINTFUL_TOKEN=... PRINTFUL_STORE_ID=19138894 node scripts/merch-catalog.mjs
//
// Uses Printful's v2 catalog (variants, prices with this store's pricing)
// and the v1 print-file sizes. Read-only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.PRINTFUL_TOKEN;
const STORE = process.env.PRINTFUL_STORE_ID;
if (!TOKEN || !STORE) throw new Error('set PRINTFUL_TOKEN and PRINTFUL_STORE_ID');
const headers = { Authorization: `Bearer ${TOKEN}`, 'X-PF-Store-Id': STORE };
const get = async (url) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 5000)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  }
  throw new Error(`rate limited: ${url}`);
};
const all = async (url) => {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const r = await get(`${url}${url.includes('?') ? '&' : '?'}limit=100&offset=${offset}`);
    out.push(...r.data);
    if (out.length >= (r.paging?.total ?? 0) || !r.data.length) return out;
  }
};

// key: [Printful product, technique priced, { Printful colour: our colour id } | null (any), sizes | null (all)]
const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const PRODUCTS = {
  tee: [71, 'dtg', { White: 'white', Ash: 'ash', 'Athletic Heather': 'heather', 'Heather Prism Ice Blue': 'iceblue', Natural: 'natural' }, SIZES],
  hoodie: [146, 'dtg', { White: 'white', Ash: 'ash', Sand: 'sand', 'Light Blue': 'lightblue' }, SIZES],
  hat: [206, 'embroidery', { Khaki: 'khaki', Stone: 'stone', 'Light Blue': 'lightblue', Navy: 'navy', White: 'white' }, null],
  flipflops: [359, null, null, null],
  towel: [259, null, null, ['30″×60″']],
  'oversized-hoodie': [892, 'dtg', { Dust: 'dust', 'Vintage Heather Grey': 'grey', White: 'white' }, SIZES],
  'boxy-tee': [1592, 'dtg', { Natural: 'natural', 'Athletic Heather': 'heather', White: 'white' }, SIZES],
  tank: [248, 'dtg', { White: 'white', 'Athletic Heather': 'heather' }, ['XS', 'S', 'M', 'L', 'XL', '2XL']],
  beanie: [266, 'embroidery', { 'Heather Grey': 'grey', White: 'white', Navy: 'navy' }, null],
  'bucket-hat': [1688, 'dtfilm', { Natural: 'natural', 'Heather Grey': 'grey' }, null],
  tote: [84, null, { Black: 'black' }, null],
  socks: [882, null, null, null],
  mug: [19, null, null, ['11 oz', '15 oz']],
  poster: [1, null, null, ['12″×16″', '18″×24″', '24″×36″']],
  'framed-poster': [172, null, { Black: 'black', 'Red Oak': 'oak', White: 'white' }, ['12″×16″', '18″×24″']],
  canvas: [614, null, { Black: 'black', Brown: 'brown' }, ['12″×16″', '16″×20″', '18″×24″']],
  puzzle: [534, null, null, null],
  sticker: [358, null, null, ['3″×3″', '4″×4″', '5.5″×5.5″']],
  blanket: [711, null, null, ['50″×60″', '60″×80″']],
  pillow: [1742, null, null, ['18″×18″', '20″×20″']],
  bottle: [382, null, { White: 'white' }, null],
  tumbler: [909, null, null, null],
  sweatpants: [895, 'dtg', { Dust: 'dust', 'Athletic Heather': 'heather' }, SIZES],
};

const cents = (s) => Math.round(Number(s) * 100);
const out = {};
for (const [key, [id, technique, colors, sizes]] of Object.entries(PRODUCTS)) {
  const variants = await all(`https://api.printful.com/v2/catalog-products/${id}/catalog-variants`);
  const prices = await get(`https://api.printful.com/v2/catalog-products/${id}/prices?currency=USD`);
  // the prices endpoint pages its variants under data.variants
  const priced = new Map();
  for (let offset = 0; ; offset += 100) {
    const r = await get(`https://api.printful.com/v2/catalog-products/${id}/prices?currency=USD&limit=100&offset=${offset}`);
    for (const v of r.data.variants) {
      const t = v.techniques.find((x) => !technique || x.technique_key === technique) ?? v.techniques[0];
      if (t) priced.set(v.id, cents(t.discounted_price ?? t.price));
    }
    if (r.data.variants.length < 100) break;
  }
  const placements = Object.fromEntries(prices.data.product.placements.map((p) => [p.id, cents(p.discounted_price ?? p.price)]));
  const pf = (await get(`https://api.printful.com/mockup-generator/printfiles/${id}`)).result;
  const files = Object.fromEntries(pf.printfiles.map((f) => [f.printfile_id, [f.width, f.height]]));
  const sizesOf = {};
  const v = {};
  for (const x of variants) {
    const color = colors ? colors[x.color] : (x.color ? x.color.toLowerCase().replace(/[^a-z0-9]+/g, '') : 'default') || 'default';
    if (!color || (sizes && !sizes.includes(x.size))) continue;
    const cost = priced.get(x.id);
    if (!cost) continue;
    v[`${color}/${x.size}`] = [x.id, cost];
    const vp = pf.variant_printfiles.find((p) => p.variant_id === x.id);
    if (vp) sizesOf[x.id] = Object.fromEntries(Object.entries(vp.placements).map(([pl, f]) => [pl, files[f]]));
  }
  // print-file sizes per placement (the largest variant's, which the art is drawn for)
  const printfiles = {};
  for (const s of Object.values(sizesOf)) for (const [pl, wh] of Object.entries(s)) if (!printfiles[pl] || wh[0] * wh[1] > printfiles[pl][0] * printfiles[pl][1]) printfiles[pl] = wh;
  out[key] = { printful: id, variants: v, placementCents: placements, printfiles };
  console.log(key, Object.keys(v).length, 'variants');
}

const file = path.join(root, 'server', 'src', 'generated', 'merchCatalogData.ts');
fs.writeFileSync(
  file,
  `// Generated by scripts/merch-catalog.mjs from Printful's catalog (${new Date().toISOString().slice(0, 10)}): do not edit.\n` +
    `// variants: 'colour/size' -> [Printful variant id, cost to us in cents, first placement included]\n` +
    `// placementCents: what each placement costs when it isn't the first; printfiles: [width, height] px\n` +
    `export const PRINTFUL_DATA: Record<string, { printful: number; variants: Record<string, [number, number]>; placementCents: Record<string, number>; printfiles: Record<string, [number, number]> }> = ${JSON.stringify(out, null, 1)};\n`,
);
console.log('wrote', path.relative(root, file));
