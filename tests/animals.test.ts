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
  it('starts absent with a quiet wait inside [waitMin, waitMax]', () => {
    const ctrl = new AnimalController(seeded(42));
    const s = ctrl.snapshot();
    expect(s.active).toBe(false);
    expect(s.phase).toBe('absent');
    expect(s.nextSpawnIn).toBeGreaterThanOrEqual(ANIMALS.waitMin);
    expect(s.nextSpawnIn).toBeLessThanOrEqual(ANIMALS.waitMax);
  });

  it('stays absent when the visit chance roll misses, and rolls a fresh wait', () => {
    // Always return 0.99 (> visitChance 0.65)
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
});
