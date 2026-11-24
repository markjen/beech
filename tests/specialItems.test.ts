// Prize items must look different — and better — than the free items they
// share a kind with (src/palette.ts ITEM_LOOKS, server/src/beachImage.ts).
// Free shells are never pink, free sand dollars are never gold, and the
// golden sand dollar is shiny gold.
import { describe, expect, it } from 'vitest';

import { ITEM_COLORS, SHELLS, WORLD, renderBeach, type SavedSand } from '../server/src/beachImage';
import { ITEM_LOOKS, PROP_COLORS, itemLook, type RGB } from '../src/palette';
import { ITEM_ICON_TINT, icon, itemIcon, type IconName } from '../src/ui/hud';
import { ITEMS, itemById } from '../src/world/items';

const hexToRgb = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const rgbToHex = (c: RGB): string =>
  '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

/** [hue 0..360, saturation 0..1, lightness 0..1] */
function hsl(c: RGB): [number, number, number] {
  const [r, g, b] = c;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/**
 * Pink: a light, saturated red with the blue up near the green (that's what
 * makes it pink rather than peach or coral — coral has the blue far below
 * the green). Hue under 20 or over 300.
 */
const isPink = (c: RGB): boolean => {
  const [h, s, l] = hsl(c);
  return (h < 20 || h >= 300) && s > 0.25 && l > 0.55 && c[2] >= c[1] - 0.1;
};

/** Gold: a saturated yellow in the mid-tones (pale cream is lighter than this). */
const isGold = (c: RGB): boolean => {
  const [h, s, l] = hsl(c);
  return h >= 35 && h <= 55 && s > 0.5 && l >= 0.3 && l <= 0.75;
};

describe('free shells are never pink', () => {
  it('the 3D free shell palette has no pink', () => {
    expect(PROP_COLORS.shell.length).toBeGreaterThan(0);
    for (const c of PROP_COLORS.shell) expect(isPink(c), rgbToHex(c)).toBe(false);
  });

  it('the shore picture free shells have no pink', () => {
    expect(SHELLS.length).toBeGreaterThan(0);
    for (const c of SHELLS) expect(isPink(c), rgbToHex(c)).toBe(false);
  });

  it('pink is reserved for the pink shell, which is unmistakably pink', () => {
    const pink = ITEM_LOOKS['pink-shell'];
    expect(pink).toBeTruthy();
    for (const c of pink.colors) expect(isPink(c), rgbToHex(c)).toBe(true);
    // and the free shell palette shares no colour with it
    const free = new Set(PROP_COLORS.shell.map(rgbToHex));
    for (const c of pink.colors) expect(free.has(rgbToHex(c))).toBe(false);
  });
});

describe('free sand dollars are never gold', () => {
  it('the 3D free sand dollar palette has no gold', () => {
    for (const c of PROP_COLORS.sanddollar) expect(isGold(c), rgbToHex(c)).toBe(false);
  });

  it('the golden sand dollar is shiny gold', () => {
    const gold = ITEM_LOOKS['gold-sanddollar'];
    expect(gold).toBeTruthy();
    for (const c of gold.colors) expect(isGold(c), rgbToHex(c)).toBe(true);
    expect(gold.gloss).toBeGreaterThanOrEqual(0.9); // a hard glint in the sun
    expect(gold.glow).toBe('legendary'); // a gold halo and sparkles on the beach
    const free = new Set(PROP_COLORS.sanddollar.map(rgbToHex));
    for (const c of gold.colors) expect(free.has(rgbToHex(c))).toBe(false);
  });

  it('the shore picture draws the golden sand dollar gold, the plain one cream', () => {
    for (const h of ITEM_COLORS['gold-sanddollar']) expect(isGold(hexToRgb(h)), h).toBe(true);
  });
});

describe('every special item looks different from its same-kind counterpart', () => {
  it('items sharing a kind resolve to disjoint colours', () => {
    const byKind = new Map<string, typeof ITEMS>();
    for (const it of ITEMS) {
      const list = byKind.get(it.kind) ?? [];
      list.push(it);
      byKind.set(it.kind, list);
    }
    for (const [kind, group] of byKind) {
      if (group.length < 2) continue;
      const looks = group.map((it) => ({ id: it.id, look: itemLook(it.id, kind as keyof typeof PROP_COLORS) }));
      for (let i = 0; i < looks.length; i++) {
        for (let j = i + 1; j < looks.length; j++) {
          const a = new Set(looks[i].look.colors.map(rgbToHex));
          for (const c of looks[j].look.colors) {
            expect(a.has(rgbToHex(c)), `${looks[i].id} vs ${looks[j].id}: ${rgbToHex(c)}`).toBe(false);
          }
        }
      }
      // all but one of the kind's items carry their own look (the odd one out
      // is the plain kind: the free shell, the claw conch, and so on)
      const plain = looks.filter((l) => !ITEM_LOOKS[l.id]);
      expect(plain.length, kind).toBeLessThanOrEqual(1);
    }
  });

  it('each prize item has a finish, not just a colour', () => {
    for (const [id, look] of Object.entries(ITEM_LOOKS)) {
      expect(look.gloss, id).toBeGreaterThan(0);
      expect(look.colors.length, id).toBeGreaterThanOrEqual(2);
      expect(itemById(id), id).toBeTruthy();
    }
  });

  it('the shore picture mirrors the app’s prize colours', () => {
    for (const [id, look] of Object.entries(ITEM_LOOKS)) {
      const pictured = ITEM_COLORS[id];
      expect(pictured, id).toBeTruthy();
      expect(pictured.map((h) => h.toLowerCase())).toEqual(look.colors.map(rgbToHex));
    }
  });

  it('prize icons are tinted, free icons are not', () => {
    for (const [id, tint] of Object.entries(ITEM_ICON_TINT)) {
      expect(itemIcon(id)).toContain(`color:${tint}`);
      expect(itemIcon(id)).not.toBe(icon(id as IconName));
    }
    for (const it of ITEMS.filter((i) => i.source === 'free')) {
      expect(itemIcon(it.id)).toBe(icon(it.id as IconName));
    }
  });
});

describe('shore pictures draw prizes in their own colours', () => {
  it('a pink shell, a golden sand dollar and the rest read as prizes, not free kinds', () => {
    const W = 1200;
    const H = 630;
    const scale = H / (WORLD - 11.5); // px per metre, as in renderBeach
    const at = (x: number, y: number): [number, number] => [W / 2 - (x - WORLD / 2) * scale, (y - 11.5) * scale];
    const sand: SavedSand = {
      nx: 256,
      ny: 256,
      delta: new Float32Array(256 * 256),
      things: [
        { kind: 'shell', item: 'shell', x: 6, y: 24, angle: 0, size: 0.3, variant: 1 },
        { kind: 'shell', item: 'pink-shell', x: 11, y: 24, angle: 0, size: 0.3, variant: 1 },
        { kind: 'sanddollar', item: 'sanddollar', x: 16, y: 24, angle: 0, size: 0.16, variant: 1 },
        { kind: 'sanddollar', item: 'gold-sanddollar', x: 21, y: 24, angle: 0, size: 0.16, variant: 1 },
        { kind: 'seaglass', item: 'blue-seaglass', x: 26, y: 24, angle: 0, size: 0.1, variant: 0 },
        { kind: 'rock', item: 'pebble', x: 6, y: 28, angle: 0, size: 0.25, variant: 0 },
        { kind: 'conch', item: 'spiral-conch', x: 11, y: 28, angle: 0, size: 0.3, variant: 0 },
        { kind: 'starfish', item: 'sunset-starfish', x: 16, y: 28, angle: 0, size: 0.2, variant: 1 },
        { kind: 'bottle', item: 'green-bottle', x: 21, y: 28, angle: 0, size: 0.3, variant: 0 },
      ],
    };
    const img = renderBeach(sand, { width: W, height: H, location: 'bondi' });
    const pixel = (x: number, y: number, dx = 0, dy = 0): RGB => {
      const [px, py] = at(x, y);
      const k = ((Math.floor(py) + dy) * W + (Math.floor(px) + dx)) * 3;
      return [img[k] / 255, img[k + 1] / 255, img[k + 2] / 255];
    };
    const expectPixel = (x: number, y: number, hex: string, dx = 0, dy = 0) => {
      const got = pixel(x, y, dx, dy);
      const want = hexToRgb(hex);
      for (let i = 0; i < 3; i++) expect(got[i], `at (${x},${y}): ${rgbToHex(got)} vs ${hex}`).toBeCloseTo(want[i], 2);
    };
    // free kinds: warm cream shell, pale cream sand dollar
    expectPixel(6, 24, '#efe4d2');
    expectPixel(16, 24, '#eee6d4');
    // prizes: hot pink shell, shiny gold sand dollar, deep blue glass,
    // dark polished pebble, coral conch, magenta sunset starfish, emerald bottle
    expectPixel(11, 24, '#ef5d8f');
    expectPixel(21, 24, '#e8b923');
    expectPixel(26, 24, '#2f7fc9');
    // the pebble's highlight sits up-left of centre: sample down-right of it
    expectPixel(6, 28, '#5a5f6b', 3, 3);
    expectPixel(11, 28, '#e86a4a');
    expectPixel(16, 28, '#e84a7a');
    expectPixel(21, 28, '#0f7a4d');
  });
});
