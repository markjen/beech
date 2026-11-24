// All colours in one place. Each palette is a full mood; the day cycle blends
// between them. Colours are linear-ish sRGB triples in 0..1.

export type RGB = [number, number, number];

export interface Palette {
  name: string;
  skyTop: RGB;
  skyBottom: RGB;
  sun: RGB; // directional light colour
  sunDir: [number, number, number]; // direction the light travels (normalised later)
  ambient: RGB;
  shadow: RGB; // tint of the unlit ramp band
  sandDry: RGB;
  sandWet: RGB;
  sandDeep: RGB; // colour of freshly exposed deep sand
  strataA: RGB;
  strataB: RGB;
  rock: RGB;
  waterShallow: RGB;
  waterDeep: RGB;
  foam: RGB;
  farOcean: RGB;
  fog: RGB;
  ui: RGB;
}

const hex = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const PALETTES: Palette[] = [
  {
    name: 'dawn',
    skyTop: hex('#a9b8e0'),
    skyBottom: hex('#f7d2c4'),
    sun: hex('#ffe0cc'),
    sunDir: [0.6, -0.55, 0.45],
    ambient: hex('#b9a9c9'),
    shadow: hex('#9c86a8'),
    sandDry: hex('#f2d9bd'),
    sandWet: hex('#c7a68f'),
    sandDeep: hex('#d9b99a'),
    strataA: hex('#e7c3a4'),
    strataB: hex('#d2a58c'),
    rock: hex('#8c7a95'),
    waterShallow: hex('#9fe3d8'),
    waterDeep: hex('#4f9fb3'),
    foam: hex('#fdf8f4'),
    farOcean: hex('#6fa9c3'),
    fog: hex('#f2d4cb'),
    ui: hex('#7a6584'),
  },
  {
    name: 'day',
    skyTop: hex('#8fd0e6'),
    skyBottom: hex('#fbeedd'),
    sun: hex('#fff5e6'),
    sunDir: [0.35, -0.8, 0.5],
    ambient: hex('#a8c6d6'),
    shadow: hex('#93a9c4'),
    sandDry: hex('#f6e3c3'),
    sandWet: hex('#cdb08e'),
    sandDeep: hex('#e0c49d'),
    strataA: hex('#efd2a8'),
    strataB: hex('#d8b088'),
    rock: hex('#8a97a8'),
    waterShallow: hex('#8ff0de'),
    waterDeep: hex('#2fa4bb'),
    foam: hex('#ffffff'),
    farOcean: hex('#4cb2cc'),
    fog: hex('#f7ead9'),
    ui: hex('#5f7287'),
  },
  {
    name: 'golden',
    skyTop: hex('#f0a98f'),
    skyBottom: hex('#fde3b3'),
    sun: hex('#ffd29a'),
    sunDir: [-0.55, -0.45, 0.55],
    ambient: hex('#c79a9a'),
    shadow: hex('#b07f86'),
    sandDry: hex('#f8d4a2'),
    sandWet: hex('#c99373'),
    sandDeep: hex('#e2b07f'),
    strataA: hex('#eebb8a'),
    strataB: hex('#d49274'),
    rock: hex('#9a7385'),
    waterShallow: hex('#9fdcca'),
    waterDeep: hex('#3d8ea8'),
    foam: hex('#fff3e3'),
    farOcean: hex('#5a99b0'),
    fog: hex('#fbd9b0'),
    ui: hex('#8a5f6b'),
  },
  {
    name: 'dusk',
    skyTop: hex('#4a4f85'),
    skyBottom: hex('#e59a9a'),
    sun: hex('#f3b8b0'),
    sunDir: [-0.7, -0.35, 0.35],
    ambient: hex('#7d77a6'),
    shadow: hex('#5f5a8a'),
    sandDry: hex('#d9b2b0'),
    sandWet: hex('#9c8091'),
    sandDeep: hex('#bb95a0'),
    strataA: hex('#c79ba3'),
    strataB: hex('#a8808f'),
    rock: hex('#5c5880'),
    waterShallow: hex('#88c9cf'),
    waterDeep: hex('#3a6c96'),
    foam: hex('#f6e9f0'),
    farOcean: hex('#46709a'),
    fog: hex('#c98f9f'),
    ui: hex('#e9d6e6'),
  },
  {
    name: 'night',
    skyTop: hex('#141a3a'),
    skyBottom: hex('#3a3f6e'),
    sun: hex('#a9bdf0'), // moonlight
    sunDir: [0.3, -0.85, 0.4],
    ambient: hex('#3c4778'),
    shadow: hex('#363d6a'),
    sandDry: hex('#a39db8'),
    sandWet: hex('#6f6b8e'),
    sandDeep: hex('#8a84a2'),
    strataA: hex('#8f89a8'),
    strataB: hex('#76718f'),
    rock: hex('#363a60'),
    waterShallow: hex('#6fb0d6'),
    waterDeep: hex('#1b3566'),
    foam: hex('#f2f6ff'),
    farOcean: hex('#203c6c'),
    fog: hex('#4a4f80'),
    ui: hex('#dfe4ff'),
  },
];

const lerp3 = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Blend two palettes. */
export function mixPalette(a: Palette, b: Palette, t: number): Palette {
  const out = { ...a, name: t < 0.5 ? a.name : b.name } as Palette;
  for (const key of Object.keys(a) as (keyof Palette)[]) {
    if (key === 'name') continue;
    (out as unknown as Record<string, unknown>)[key] = lerp3(a[key] as RGB, b[key] as RGB, t);
  }
  return out;
}

function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}

/** Piecewise blend between palettes keyed by a value (e.g. sun elevation). */
export function paletteAlong(keys: [number, string][], v: number): Palette {
  if (v <= keys[0][0]) return paletteByName(keys[0][1]);
  for (let i = 1; i < keys.length; i++) {
    if (v <= keys[i][0]) {
      const t = (v - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      return mixPalette(paletteByName(keys[i - 1][1]), paletteByName(keys[i][1]), smooth(t));
    }
  }
  return paletteByName(keys[keys.length - 1][1]);
}

/** Mix a colour tint into a palette entry. */
export function tint(c: RGB, t: RGB, amount: number): RGB {
  return lerp3(c, t, amount);
}

export function paletteByName(name: string): Palette {
  return PALETTES.find((p) => p.name === name) ?? PALETTES[1];
}

export function rgbToCss(c: RGB, alpha = 1): string {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${alpha})`;
}

/** Fixed colours for things placed on the beach (lit by the scene's light). */
export const PROP_COLORS = {
  rock: [hex('#b3aeb4'), hex('#a59cab'), hex('#bfb2a6'), hex('#9ba3a8')] as RGB[],
  driftwood: [hex('#e0d2bd'), hex('#cfbfa8'), hex('#eae0d2')] as RGB[],
  shell: [hex('#fdf2e1'), hex('#f0c09a'), hex('#e6d3ae'), hex('#f5e7c8')] as RGB[],
  seaglass: [hex('#9fd8c0'), hex('#a8d4e6'), hex('#e8c27a'), hex('#e6f0ee')] as RGB[],
  /** bright plastic: a crumpled bottle or can reads as litter, never as a shell or sea glass */
  trash: [hex('#e63329'), hex('#1f8fff'), hex('#22b573'), hex('#ffcf00')] as RGB[],
  /** dark olive and green-brown strands */
  seaweed: [hex('#4a5d23'), hex('#3d4a1f'), hex('#5d6b2a'), hex('#6b5e2f')] as RGB[],
  flag: [hex('#f07f6b'), hex('#f4c95d'), hex('#5fb8b2'), hex('#8f7fd1')] as RGB[],
  conch: [hex('#f6c7b6'), hex('#f2dcc4'), hex('#e9b4a8')] as RGB[],
  sanddollar: [hex('#efe6d4'), hex('#e8dcc6')] as RGB[],
  starfish: [hex('#ef8a5f'), hex('#d9645a'), hex('#f2a65a')] as RGB[],
  bottle: [hex('#8fc9b3'), hex('#9cc3d9')] as RGB[],
  nautilus: [hex('#e8d5c4'), hex('#d9a06b'), hex('#c97e5a')] as RGB[],
  /** a striped beach ball: bright panels alternate with white (variant picks the bright colour) */
  beachball: [hex('#e8443a'), hex('#fbf3e4'), hex('#2f8fd0'), hex('#f5c542')] as RGB[],
  /** sandals: [sole, strap] per variant — teal with an orange strap, coral with a navy strap */
  sandals: [hex('#2f8f7a'), hex('#f08a4b'), hex('#e86a5a'), hex('#2f4a6b')] as RGB[],
  /** a pail: red or blue, by variant */
  bucket: [hex('#d8473b'), hex('#2f8fd0')] as RGB[],
  /** a branching coral fragment: deep brick reds — darker and redder than
      the starfish's orange, and never the sunset starfish's magenta */
  coral: [hex('#c73e2e'), hex('#a82e28'), hex('#d95a3a')] as RGB[],
  /** a coconut: dark browns, a shade darker than driftwood */
  coconut: [hex('#6b4a2f'), hex('#7d5a38')] as RGB[],
  /** deckchair canvas stripes (frame uses `pole`) */
  deckchair: [hex('#4f86c6'), hex('#e46f5a'), hex('#3fa58f')] as RGB[],
  // the shop: [main, accent, trim, lamp]
  parasol: [hex('#f06b5a'), hex('#fbf3e4')] as RGB[],
  surfboard: [hex('#f2efe3'), hex('#2f8fd0')] as RGB[],
  sandcastle: [hex('#e9cf9c'), hex('#e0533f')] as RGB[],
  beachhut: [hex('#6cc3d5'), hex('#f2f0e8'), hex('#e46f5a')] as RGB[],
  lighthouse: [hex('#f4f1ea'), hex('#d8473b'), hex('#3c4652'), hex('#ffe6a8')] as RGB[],
  tikitorch: [hex('#8a5a33'), hex('#ffb347')] as RGB[],
  /** a palm: fronds, then the coconuts at the top (the trunk uses `pole`) */
  palmtree: [hex('#3f8f4f'), hex('#6b4a2f')] as RGB[],
  /** a lifeguard tower: white frame, red cabin, navy roof */
  lifeguardtower: [hex('#f2f0e8'), hex('#d8473b'), hex('#2f4a6b')] as RGB[],
  /** a bonfire: grey stones, then the flame (the logs use `pole`) */
  bonfire: [hex('#9aa0a8'), hex('#ff8c2e')] as RGB[],
  /** a hammock: the slung cloth (the posts use `pole`) */
  hammock: [hex('#e86a5a')] as RGB[],
  /** a striped towel: teal cloth, white stripes */
  towel: [hex('#2f8f7a'), hex('#fbf3e4')] as RGB[],
  /** footprints pressed into the sand: darker than dry sand, so the
      trail reads as a dip rather than something sitting on it */
  footprints: [hex('#b08d68'), hex('#a5825f'), hex('#c09a72')] as RGB[],
  pole: hex('#d8c7ae'),
  /** the rolled-up message inside a bottle */
  paper: hex('#f7efd9'),
};

/** Glow and sparkle colours for special things on the beach (src/render/glow.ts). */
export const RARITY_GLOW: Record<'rare' | 'legendary' | 'unique', RGB> = {
  rare: hex('#7cc4ff'),
  legendary: hex('#ffcf5a'),
  unique: hex('#c06fd6'),
};

/**
 * How a prize item looks on the beach, per catalog item — not per kind.
 * Several prizes share a kind with a free (or cheaper) item — pink-shell is
 * kind shell, the golden sand dollar is kind sanddollar — so the kind
 * palette alone can't tell them apart. These overrides are what make a
 * special item unmistakable at a glance: its own colours, a finish (gloss
 * is a specular glint in the sun: glass and polished stone shine, gold
 * shines hardest), and, for the golden sand dollar, a gold glow. Free
 * shells stay warm cream, tan and peach — pink is reserved for pink-shell —
 * and free sand dollars stay pale cream, never gold.
 */
export interface ItemLook {
  /** colours, one per variant (variant % length, like the kind palettes) */
  colors: RGB[];
  /** specular strength, 0 (matte) to 1 (a hard glint in the sun) */
  gloss: number;
  /** a glow on the beach, if any */
  glow?: 'rare' | 'legendary' | 'unique';
}

export const ITEM_LOOKS: Record<string, ItemLook> = {
  // A spotted cowrie: deep chestnut and caramel browns with a polished
  // sheen — disjoint from the free shell palette (warm cream, tan and
  // peach) and from the pink shell, and never pink.
  cowrie: { colors: [hex('#5d3a1a'), hex('#8a5a2b'), hex('#c98f4e')], gloss: 0.5 },
  // Week 1 vending set ("First light", server/src/vending.ts).
  'pink-shell': { colors: [hex('#f27ba7'), hex('#ef5d8f'), hex('#f8a8c4'), hex('#e8437a')], gloss: 0.45 },
  'blue-seaglass': { colors: [hex('#2f7fc9'), hex('#1f6fb8'), hex('#4aa3e0'), hex('#185a9e')], gloss: 0.8 },
  pebble: { colors: [hex('#5a5f6b'), hex('#6e7683'), hex('#3f4650'), hex('#7d838e')], gloss: 0.6 },
  'spiral-conch': { colors: [hex('#e86a4a'), hex('#f08a4b'), hex('#d94f30'), hex('#f2a65a')], gloss: 0.5 },
  'gold-sanddollar': { colors: [hex('#d4a017'), hex('#e8b923'), hex('#f5c542'), hex('#b8860b')], gloss: 1, glow: 'legendary' },
  'sunset-starfish': { colors: [hex('#ff7e3d'), hex('#e84a7a'), hex('#b84a8f'), hex('#ffb347')], gloss: 0.4 },
  'green-bottle': { colors: [hex('#0f7a4d'), hex('#15965f'), hex('#0a5c38'), hex('#1fae6e')], gloss: 0.9 },
  // the claw's unique prize: same colours as the kind palette, with a pearl sheen
  nautilus: { colors: [hex('#e8d5c4'), hex('#d9a06b'), hex('#c97e5a')], gloss: 0.7 },
};

/** The render look for one catalog item: its own colours and finish, or its kind's. */
export function itemLook(itemId: string, kind: keyof typeof PROP_COLORS): ItemLook {
  const own = ITEM_LOOKS[itemId];
  if (own) return own;
  return { colors: PROP_COLORS[kind] as RGB[], gloss: 0 };
}

/** Fixed colours for beach animals (lit by the scene's light, src/render/animals.ts). */
export const ANIMAL_COLORS = {
  crab: {
    shell: hex('#e05b40'),
    claws: hex('#f26e4a'),
    legs: hex('#d47a54'),
    belly: hex('#f2cbb0'),
    eyes: hex('#231e24'),
  },
  treat: {
    crumb: hex('#e6b96c'),
    shrimp: hex('#f28c6b'),
    kelp: hex('#5b7a3a'),
  },
  dolphin: {
    back: hex('#5d84a6'),
    belly: hex('#d2e2ed'),
    fin: hex('#4a6e8f'),
    eyes: hex('#1e2228'),
  },
};

