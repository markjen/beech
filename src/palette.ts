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

/**
 * Palette at a position in the day cycle. phase in [0,1) walks
 * dawn -> day -> golden -> dusk -> (back to dawn), holding on each a while.
 */
export function paletteAtPhase(phase: number): Palette {
  const n = PALETTES.length;
  const p = (((phase % 1) + 1) % 1) * n;
  const i = Math.floor(p);
  const f = p - i;
  // hold for the first 60% of each segment, then ease into the next
  const t = f < 0.6 ? 0 : smooth((f - 0.6) / 0.4);
  return mixPalette(PALETTES[i % n], PALETTES[(i + 1) % n], t);
}

function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}

export function paletteByName(name: string): Palette {
  return PALETTES.find((p) => p.name === name) ?? PALETTES[1];
}

export function rgbToCss(c: RGB, alpha = 1): string {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${alpha})`;
}
