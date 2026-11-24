import { describe, expect, it } from 'vitest';
import { GUIDE_BONUS as SERVER_BONUS, GUIDE_STEPS, WELCOME_GIFT, ladder, ladderReward, REWARD_CAP } from '../server/src/referrals';
import { GUIDE, GUIDE_BONUS, guideSteps, nextStep, progress } from '../src/world/guide';
import { extraById, itemById } from '../src/world/items';
import { ladderLines } from '../src/ui/invite';

const known = (id: string) => !!itemById(id) || !!extraById(id);

describe('the beach guide', () => {
  it('has the same steps, in the same order, with the same gifts as the server', () => {
    expect(GUIDE.map((s) => s.id)).toEqual(GUIDE_STEPS.map((s) => s.id));
    for (const s of GUIDE) {
      const g = GUIDE_STEPS.find((x) => x.id === s.id)!;
      expect(s.gift, s.id).toBe(g.gift);
      // the web guide explains each step under the name the game shows
      expect(s.title, s.id).toBe(g.title);
      expect(g.how.length, s.id).toBeGreaterThan(10);
    }
    expect(GUIDE_BONUS).toBe(SERVER_BONUS);
  });

  it('only gives catalog items that are owned, not free', () => {
    for (const s of GUIDE_STEPS) if (s.gift) expect(itemById(s.gift)?.unlimited, s.id).toBe(false);
    expect(itemById(GUIDE_BONUS)?.unlimited).toBe(false);
    expect(itemById(WELCOME_GIFT)?.unlimited).toBe(false);
    for (const r of ladder()) expect(known(r.item), `rung ${r.rank}: ${r.item}`).toBe(true);
  });

  it('needs an account exactly for the steps the server checks, plus visiting', () => {
    for (const s of GUIDE_STEPS) if (s.serverChecked) expect(GUIDE.find((g) => g.id === s.id)!.needsAccount).toBe(true);
    expect(guideSteps(false).map((s) => s.id)).toEqual(['dig', 'pile', 'undo', 'place', 'chair']);
    expect(guideSteps(true)).toHaveLength(9);
  });

  it('points at the first step not done, and counts progress', () => {
    expect(nextStep(new Set(), true)?.id).toBe('dig');
    expect(nextStep(new Set(['dig', 'undo']), true)?.id).toBe('pile');
    const local = new Set(['dig', 'pile', 'undo', 'place', 'chair']);
    expect(nextStep(local, false)).toBeNull();
    expect(nextStep(local, true)?.id).toBe('claw');
    expect(progress(local, true)).toEqual({ done: 5, total: 9 });
    expect(progress(new Set(['claw', 'nonsense']), false)).toEqual({ done: 0, total: 5 });
  });
});

describe('the invite ladder', () => {
  it('climbs to an extra beach at three and stops at the cap', () => {
    expect(ladderReward(1)).toBe('parasol');
    expect(ladderReward(3)).toBe('beach');
    expect(ladderReward(REWARD_CAP)).toBe('starfish');
    expect(ladderReward(REWARD_CAP + 1)).toBeNull();
    expect(ladderReward(0)).toBeNull();
    expect(ladder()).toHaveLength(REWARD_CAP);
  });

  it('folds runs of the same gift into one line', () => {
    const lines = ladderLines(ladder());
    expect(lines.slice(0, 5).map((l) => [l.from, l.to])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
    expect(lines[5]).toEqual({ from: 6, to: REWARD_CAP, item: 'starfish' });
    expect(lines).toHaveLength(6);
  });
});
