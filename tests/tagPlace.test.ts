import { describe, expect, it } from 'vitest';
import { placeTag } from '../src/ui/tagPlace';

// a 1280 x 800 screen with the place card top left and the tool column right
const card = { left: 16, top: 14, right: 258, bottom: 65 };
const tools = { left: 1202, top: 410, right: 1254, bottom: 782 };
const W = 1280;
const H = 800;

describe('neighbor name tags', () => {
  it('sit centred above their beach when nothing is in the way', () => {
    expect(placeTag(640, 300, 200, 26, W, H, [card, tools])).toEqual({ left: 540, top: 274 });
  });

  it('stay on screen at the edges', () => {
    expect(placeTag(1300, 300, 200, 26, W, H, []).left).toBe(W - 8 - 200);
    expect(placeTag(-50, 300, 200, 26, W, H, []).left).toBe(8);
    expect(placeTag(640, 5, 200, 26, W, H, []).top).toBe(8);
  });

  it('never cover the place card or the tool column', () => {
    const overlaps = (t: { left: number; top: number }, w: number, h: number, r: typeof card) =>
      t.left < r.right && t.left + w > r.left && t.top < r.bottom && t.top + h > r.top;
    for (const [x, y] of [[100, 40], [130, 60], [10, 30], [1230, 600], [1250, 500], [1200, 790]]) {
      const t = placeTag(x, y, 220, 26, W, H, [card, tools]);
      expect(overlaps(t, 220, 26, card), `card at ${x},${y}`).toBe(false);
      expect(overlaps(t, 220, 26, tools), `tools at ${x},${y}`).toBe(false);
      expect(t.left).toBeGreaterThanOrEqual(8);
      expect(t.left + 220).toBeLessThanOrEqual(W - 8);
    }
  });
});
