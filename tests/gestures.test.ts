import { describe, expect, it } from 'vitest';
import { classifyTwoFinger, isEditableTarget, type TwoFingers } from '../src/input/gestures';

const at = (mx: number, my: number, dist = 200, angle = 0): TwoFingers => ({ mx, my, dist, angle });

// Stand-in for an EventTarget: the guard only reads tagName/isContentEditable.
const el = (tagName: string, isContentEditable = false) =>
  ({ tagName, isContentEditable }) as unknown as EventTarget;

describe('editable targets are left alone by the game key handler', () => {
  it('treats inputs, textareas and selects as editable', () => {
    expect(isEditableTarget(el('INPUT'))).toBe(true);
    expect(isEditableTarget(el('TEXTAREA'))).toBe(true);
    expect(isEditableTarget(el('SELECT'))).toBe(true);
  });
  it('treats contenteditable elements as editable', () => {
    expect(isEditableTarget(el('DIV', true))).toBe(true);
  });
  it('treats the canvas and other plain elements as game input', () => {
    expect(isEditableTarget(el('CANVAS'))).toBe(false);
    expect(isEditableTarget(el('DIV'))).toBe(false);
    expect(isEditableTarget(el('BUTTON'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as unknown as EventTarget)).toBe(false);
  });
});

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
