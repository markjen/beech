import { describe, expect, it } from 'vitest';
import { classifyTwoFinger, type TwoFingers } from '../src/input/gestures';

const at = (mx: number, my: number, dist = 200, angle = 0): TwoFingers => ({ mx, my, dist, angle });

describe('two-finger gestures', () => {
  it('waits until the gesture is clear', () => {
    expect(classifyTwoFinger(at(500, 500), at(503, 504))).toBeNull();
  });
  it('side-by-side fingers sliding up or down tilt', () => {
    expect(classifyTwoFinger(at(500, 500), at(502, 460))).toBe('tilt');
    expect(classifyTwoFinger(at(500, 500), at(498, 540))).toBe('tilt');
  });
  it('sideways drags, pinches and twists move the camera', () => {
    expect(classifyTwoFinger(at(500, 500), at(560, 505))).toBe('move');
    expect(classifyTwoFinger(at(500, 500), at(500, 500, 260))).toBe('move');
    expect(classifyTwoFinger(at(500, 500), at(500, 500, 200, 0.4))).toBe('move');
  });
  it('fingers one above the other dragging vertically is a pan, not a tilt', () => {
    expect(classifyTwoFinger(at(500, 500, 200, Math.PI / 2), at(500, 450, 200, Math.PI / 2))).toBe('move');
  });
});
