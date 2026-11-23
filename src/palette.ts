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
  shell: [hex('#fad6cc'), hex('#fdf2e1'), hex('#f0c09a'), hex('#f3e6ef')] as RGB[],
  seaglass: [hex('#9fd8c0'), hex('#a8d4e6'), hex('#e8c27a'), hex('#e6f0ee')] as RGB[],
  flag: [hex('#f07f6b'), hex('#f4c95d'), hex('#5fb8b2'), hex('#8f7fd1')] as RGB[],
  conch: [hex('#f6c7b6'), hex('#f2dcc4'), hex('#e9b4a8')] as RGB[],
  sanddollar: [hex('#efe6d4'), hex('#e8dcc6')] as RGB[],
  starfish: [hex('#ef8a5f'), hex('#d9645a'), hex('#f2a65a')] as RGB[],
  bottle: [hex('#8fc9b3'), hex('#9cc3d9')] as RGB[],
  /** deckchair canvas stripes (frame uses `pole`) */
  deckchair: [hex('#4f86c6'), hex('#e46f5a'), hex('#3fa58f')] as RGB[],
  // the shop: [main, accent, trim, lamp]
  parasol: [hex('#f06b5a'), hex('#fbf3e4')] as RGB[],
  surfboard: [hex('#f2efe3'), hex('#2f8fd0')] as RGB[],
  sandcastle: [hex('#e9cf9c'), hex('#e0533f')] as RGB[],
  beachhut: [hex('#6cc3d5'), hex('#f2f0e8'), hex('#e46f5a')] as RGB[],
  lighthouse: [hex('#f4f1ea'), hex('#d8473b'), hex('#3c4652'), hex('#ffe6a8')] as RGB[],
  tikitorch: [hex('#8a5a33'), hex('#ffb347')] as RGB[],
  pole: hex('#d8c7ae'),
  /** the rolled-up message inside a bottle */
  paper: hex('#f7efd9'),
};

/** Glow and sparkle colours for special things on the beach (src/render/glow.ts). */
export const RARITY_GLOW: Record<'rare' | 'legendary', RGB> = {
  rare: hex('#7cc4ff'),
  legendary: hex('#ffcf5a'),
};
