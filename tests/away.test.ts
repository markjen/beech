import { describe, expect, it } from 'vitest';
import { awayFor, awayText } from '../src/ui/away';

const H = 3600000;
describe('while you were away (docs/LIVE_SIM.md)', () => {
  it('says how long, roughly', () => {
    expect(awayFor(20 * 60000)).toBe('20 minutes');
    expect(awayFor(5 * H)).toBe('5 hours');
    expect(awayFor(50 * H)).toBe('2 days');
  });
  it('counts what the sea took, and never names it', () => {
    const a = { from: 0, to: 48 * H, highTides: 4, lost: 3, broughtIn: 5, checkpoint: 'x' };
    expect(awayText(a)).toBe('While you were away (2 days) · 4 high tides · the sea took 3 things (back in your bag)');
    expect(awayText({ ...a, lost: 1 })).toContain('the sea took 1 thing (back');
    expect(awayText({ ...a, lost: 0 })).toContain('the sea washed up 5 things');
    expect(awayText({ ...a, lost: 0, broughtIn: 0, highTides: 1, to: 6 * H })).toBe('While you were away (6 hours) · 1 high tide · the sea smoothed your sand');
  });
});
