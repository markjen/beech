import { describe, expect, it } from 'vitest';
import { placeTag } from '../src/ui/tagPlace';

// a 1280 x 800 screen with the place card top left and the tool column right
const card = { left: 16, top: 14, right: 258, bottom: 65 };
const tools = { left: 1202, top: 410, right: 1254, bottom: 782 };
const W = 1280;
const H = 800;

describe('neighbor name tags', () => {
  it('float on the left edge for left or centred beaches, never over the middle of the beach', () => {
    expect(placeTag(640, 300, 200, 26, W, H, [card, tools])).toEqual({ left: 14, top: 287 });
    expect(placeTag(200, 300, 200, 26, W, H, [card, tools])).toEqual({ left: 14, top: 287 });
  });

  it('float on the right edge for beaches on the right half of the screen', () => {
    expect(placeTag(980, 300, 200, 26, W, H, [card, tools])).toEqual({ left: W - 14 - 200, top: 287 });
  });

  it('stay on screen at the edges', () => {
    expect(placeTag(1300, 300, 200, 26, W, H, []).left).toBe(W - 14 - 200);
    expect(placeTag(-50, 300, 200, 26, W, H, []).left).toBe(14);
    expect(placeTag(640, 5, 200, 26, W, H, []).top).toBe(14);
  });

  it('never cover the place card or the tool column, and stay on the side', () => {
    const overlaps = (t: { left: number; top: number }, w: number, h: number, r: typeof card) =>
      t.left < r.right && t.left + w > r.left && t.top < r.bottom && t.top + h > r.top;
    for (const [x, y] of [[100, 40], [130, 60], [10, 30], [1230, 600], [1250, 500], [1200, 790]]) {
      const t = placeTag(x, y, 220, 26, W, H, [card, tools]);
      expect(overlaps(t, 220, 26, card), `card at ${x},${y}`).toBe(false);
      expect(overlaps(t, 220, 26, tools), `tools at ${x},${y}`).toBe(false);
      expect(t.left === 14 || t.left === W - 14 - 220, `stays on a side edge at ${x},${y}`).toBe(true);
    }
  });

  it('stack cleanly along the side without overlapping already-placed tags', () => {
    const first = placeTag(200, 300, 200, 26, W, H, [card, tools]);
    const firstRect = { left: first.left, top: first.top, right: first.left + 200, bottom: first.top + 26 };
    const second = placeTag(250, 300, 200, 26, W, H, [card, tools, firstRect]);
    expect(second.left).toBe(14);
    expect(second.top >= firstRect.bottom + 8 || second.top + 26 <= firstRect.top - 8).toBe(true);
  });
});
