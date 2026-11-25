import { describe, expect, it } from 'vitest';

import { ANIMALS, WORLD_SIZE_X, WORLD_SIZE_Z } from '../src/config';
import { AnimalController, type AnimalEnv } from '../src/world/animals';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function flatBeach(opts?: {
  waterAt?: (x: number, z: number) => number;
  heightAt?: (x: number, z: number) => number;
  brush?: { x: number; z: number; active: boolean };
  obstacles?: { x: number; z: number; radius: number }[];
}): AnimalEnv {
  return {
    heightAt: opts?.heightAt ?? ((_x, z) => 0.1 + Math.max(0, z) * 0.05),
    waterAt: opts?.waterAt ?? ((_x, z) => (z < 1 ? 0.25 : 0)),
    brush: opts?.brush,
    obstacles: opts?.obstacles,
  };
}

function advance(ctrl: AnimalController, env: AnimalEnv, seconds: number, step = 0.05): void {
  const n = Math.ceil(seconds / step);
  for (let i = 0; i < n; i++) ctrl.update(step, env);
}

describe('AnimalController (wild sand crab)', () => {
  it('starts absent with a short first wait inside [firstWaitMin, firstWaitMax]', () => {
    const ctrl = new AnimalController(seeded(42));
    const s = ctrl.snapshot();
    expect(s.active).toBe(false);
    expect(s.phase).toBe('absent');
    expect(s.nextSpawnIn).toBeGreaterThanOrEqual(ANIMALS.firstWaitMin);
    expect(s.nextSpawnIn).toBeLessThanOrEqual(ANIMALS.firstWaitMax);
  });

  it('stays absent when the visit chance roll misses, and rolls a fresh wait', () => {
    // Always return 0.99 (> visitChance)
    const ctrl = new AnimalController(() => 0.99);
    const env = flatBeach();
    const initialWait = ctrl.snapshot().nextSpawnIn;
    advance(ctrl, env, initialWait + 1);
    expect(ctrl.snapshot().active).toBe(false);
    expect(ctrl.snapshot().phase).toBe('absent');
    expect(ctrl.snapshot().nextSpawnIn).toBeGreaterThan(ANIMALS.waitMin * 0.5);
  });

  it('completes a full visit lifecycle (emerge -> wander/pause -> burrow -> absent) within slab bounds', () => {
    const ctrl = new AnimalController(seeded(7));
    const env = flatBeach();
    expect(ctrl.spawnNow(env, { x: 0, z: 6 })).toBe(true);
    expect(ctrl.snapshot().phase).toBe('emerging');

    const phases = new Set<string>();
    const halfX = WORLD_SIZE_X / 2 - ANIMALS.edgeMargin + 1e-4;
    const halfZ = WORLD_SIZE_Z / 2 - ANIMALS.edgeMargin + 1e-4;

    // Step through an entire visit (up to visitMax + 10s)
    for (let i = 0; i < Math.ceil((ANIMALS.visitMax + 15) / 0.05); i++) {
      ctrl.update(0.05, env);
      const s = ctrl.snapshot();
      phases.add(s.phase);
      if (s.active) {
        expect(Math.abs(s.x)).toBeLessThanOrEqual(halfX);
        expect(s.z).toBeLessThanOrEqual(halfZ);
        expect(s.y).toBeCloseTo(env.heightAt(s.x, s.z), 4);
      } else if (phases.has('burrowing')) {
        break;
      }
    }

    expect(phases.has('emerging')).toBe(true);
    expect(phases.has('pausing')).toBe(true);
    expect(phases.has('wandering')).toBe(true);
    expect(phases.has('burrowing')).toBe(true);
    expect(ctrl.snapshot().phase).toBe('absent');
    expect(ctrl.snapshot().active).toBe(false);
  });

  it('flees upslope when a wave washes over it', () => {
    const ctrl = new AnimalController(seeded(11));
    let wet = false;
    const env = flatBeach({
      waterAt: (_x, z) => (wet && z < 7 ? 0.08 : 0),
    });

    ctrl.spawnNow(env, { x: 0, z: 5 });
    advance(ctrl, env, 1.2); // finish emerging
    const startZ = ctrl.snapshot().z;

    wet = true;
    advance(ctrl, env, 1.5);
    expect(ctrl.snapshot().z).toBeGreaterThan(startZ + 0.5);
  });

  it('flees from an active digging brush and burrows early after repeated startles', () => {
    const ctrl = new AnimalController(seeded(19));
    const brush = { x: 0, z: 6, active: false };
    const env = flatBeach({ brush });

    ctrl.spawnNow(env, { x: 0.5, z: 6 });
    advance(ctrl, env, 1.2); // finish emerging

    // Repeatedly chase the crab with the brush
    for (let s = 0; s < ANIMALS.crabMaxStartles; s++) {
      brush.x = ctrl.snapshot().x - 0.5;
      brush.z = ctrl.snapshot().z;
      brush.active = true;
      ctrl.update(0.05, env);
      expect(ctrl.snapshot().phase).toBe('fleeing');
      brush.active = false;
      // let startle cooldown elapse
      advance(ctrl, env, 1.8);
    }

    expect(ctrl.snapshot().startles).toBeGreaterThanOrEqual(ANIMALS.crabMaxStartles);
    // Should burrow away shortly after max startles
    advance(ctrl, env, 4);
    expect(ctrl.snapshot().active).toBe(false);
  });

  it('avoids spawning inside placed obstacles', () => {
    const obstacles = [{ x: 0, z: 6, radius: 3 }];
    const ctrl = new AnimalController(seeded(3));
    const env = flatBeach({ obstacles });
    expect(ctrl.spawnNow(env)).toBe(true);
    const s = ctrl.snapshot();
    expect(Math.hypot(s.x - obstacles[0].x, s.z - obstacles[0].z)).toBeGreaterThanOrEqual(obstacles[0].radius);
  });

  it('uses dropped food as bait to bring a wild crab out much sooner', () => {
    const ctrl = new AnimalController(() => 0.2);
    const env = flatBeach();
    expect(ctrl.snapshot().active).toBe(false);
    expect(ctrl.dropFood(env, { x: 0, z: 6 })).toBe(true);
    expect(ctrl.snapshot().food.active).toBe(true);

    // Bait caps wait <= 90 s and speeds it up 4x, so a crab should appear well within 30 s
    advance(ctrl, env, 30);
    expect(ctrl.snapshot().active).toBe(true);
  });

  it('draws an active crab over to eat dropped food, extending its visit and calming it', () => {
    const ctrl = new AnimalController(seeded(21));
    const env = flatBeach();
    let fedCount = 0;
    ctrl.onWildFed = () => fedCount++;

    ctrl.spawnNow(env, { x: 0, z: 6 });
    advance(ctrl, env, 1.2); // finish emerging
    const visitBefore = ctrl.snapshot().visitLeft;

    expect(ctrl.dropFood(env, { x: 2.0, z: 6 })).toBe(true);
    advance(ctrl, env, 8);

    expect(fedCount).toBe(1);
    expect(ctrl.snapshot().food.active).toBe(false);
    expect(ctrl.snapshot().visitLeft).toBeGreaterThan(visitBefore);
    expect(ctrl.snapshot().calmTimer).toBeGreaterThan(0);
  });

  it('washes dropped food away if a big wave covers it', () => {
    const ctrl = new AnimalController(seeded(5));
    const env = flatBeach({ waterAt: () => 0.15 });
    expect(ctrl.dropFood(env, { x: 0, z: 6 })).toBe(true);
    advance(ctrl, env, 2);
    expect(ctrl.snapshot().food.active).toBe(false);
  });

  it('keeps a resident pet permanently on the beach and wakes a sleepy pet when fed', () => {
    const ctrl = new AnimalController(seeded(31));
    const env = flatBeach();
    ctrl.setPet({ species: 'crab', name: 'Barnaby', mood: 'sleepy' }, env);

    expect(ctrl.snapshot().active).toBe(true);
    expect(ctrl.snapshot().isPet).toBe(true);
    expect(ctrl.snapshot().petName).toBe('Barnaby');
    expect(ctrl.snapshot().phase).toBe('sleeping');
    expect(ctrl.snapshot().emerge).toBeCloseTo(0.45, 2);

    // Stays present even after a long idle stretch (never leaves)
    advance(ctrl, env, 200);
    expect(ctrl.snapshot().active).toBe(true);
    expect(ctrl.snapshot().phase).toBe('sleeping');

    // Tossing food immediately wakes the sleepy pet to happy
    ctrl.dropFood(env, { x: ctrl.snapshot().x + 1.5, z: ctrl.snapshot().z });
    expect(ctrl.snapshot().petMood).toBe('happy');
    expect(ctrl.snapshot().phase).toBe('emerging');
    advance(ctrl, env, 8);
    expect(ctrl.snapshot().active).toBe(true);
    expect(ctrl.snapshot().petMood).toBe('happy');
  });

  it('spawns an offshore dolphin that cruises alongshore, breaches above the water, and leaves cleanly', () => {
    const ctrl = new AnimalController(seeded(77));
    const env = flatBeach({
      heightAt: (_x, z) => (z < 0 ? -1.4 : 0.2),
      waterAt: (_x, z) => (z < 0 ? 1.4 : 0),
    });

    expect(ctrl.spawnNow(env, { x: -10, z: -8 }, 'dolphin')).toBe(true);
    expect(ctrl.snapshot().species).toBe('dolphin');
    expect(ctrl.snapshot().phase).toBe('swimming');

    let breached = false;
    let maxY = -Infinity;
    for (let i = 0; i < 400; i++) {
      ctrl.update(0.05, env);
      const s = ctrl.snapshot();
      if (!s.active) break;
      if (s.phase === 'breaching') breached = true;
      if (s.y > maxY) maxY = s.y;
    }

    expect(breached).toBe(true);
    expect(maxY).toBeGreaterThan(0.5); // leapt visibly above water surface (y = 0)
    expect(ctrl.snapshot().active).toBe(false);
  });
});

import { nextPetNotifyTime } from '../src/platform/petNotify';

describe('pet hunger notification timing', () => {
  it('pushes late-night and early-morning reminders out of quiet hours (22:00-08:00) to 08:00', () => {
    const lateNight = new Date(2026, 10, 24, 23, 15, 0, 0).getTime();
    const scheduled = new Date(nextPetNotifyTime(lateNight - 24 * 3600 * 1000, lateNight - 3600 * 1000));
    expect(scheduled.getHours()).toBe(8);
    expect(scheduled.getMinutes()).toBe(0);

    const earlyMorning = new Date(2026, 10, 25, 3, 30, 0, 0).getTime();
    const scheduled2 = new Date(nextPetNotifyTime(earlyMorning - 24 * 3600 * 1000, earlyMorning - 3600 * 1000));
    expect(scheduled2.getHours()).toBe(8);
    expect(scheduled2.getMinutes()).toBe(0);

    const daytime = new Date(2026, 10, 25, 14, 0, 0, 0).getTime();
    const scheduled3 = new Date(nextPetNotifyTime(daytime - 24 * 3600 * 1000, daytime - 3600 * 1000));
    expect(scheduled3.getHours()).toBe(14);
  });
});

describe('AnimalController (visited beach pet)', () => {
  it('walks over to a snack set down at a chosen spot and eats it', () => {
    const ctrl = new AnimalController(seeded(7));
    const env = flatBeach();
    ctrl.setPet({ species: 'crab', name: 'Barnaby', mood: 'peckish' }, env);
    advance(ctrl, env, 1.5);
    const s = ctrl.snapshot();
    expect(s.active).toBe(true);
    const spot = { x: s.x + 2.5, z: s.z };
    expect(ctrl.dropFood(env, spot)).toBe(true);
    expect(s.food.x).toBeCloseTo(spot.x);
    let ate = false;
    for (let i = 0; i < 400 && !ate; i++) {
      ctrl.update(0.05, env);
      if (s.phase === 'eating') ate = true;
    }
    expect(ate).toBe(true);
    expect(Math.hypot(s.x - spot.x, s.z - spot.z)).toBeLessThan(0.6);
    advance(ctrl, env, 4);
    expect(s.food.active).toBe(false);
    expect(s.petMood).toBe('happy');
    expect(s.active).toBe(true); // a pet never leaves
  });

  it('takes a snack back with clearFood', () => {
    const ctrl = new AnimalController(seeded(3));
    const env = flatBeach();
    ctrl.dropFood(env, { x: 0, z: 6 });
    expect(ctrl.snapshot().food.active).toBe(true);
    ctrl.clearFood();
    expect(ctrl.snapshot().food.active).toBe(false);
  });
});
