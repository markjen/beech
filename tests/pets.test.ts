import { describe, expect, it } from 'vitest';

import { ANIMALS } from '../src/config';
import { AnimalController, type AnimalEnv } from '../src/world/animals';
import { PETS, petKind, pickWildSpecies, type PetSpecies } from '../src/world/pets';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A beach sloping into the sea: the water surface is at y = 0.1, the shoreline near z = 0.8. */
function slopedBeach(brush?: { x: number; z: number; active: boolean }): AnimalEnv {
  const heightAt = (_x: number, z: number) => 0.12 * z;
  return {
    heightAt,
    waterAt: (x, z) => Math.max(0, 0.1 - heightAt(x, z)),
    brush,
  };
}

const surface = (env: AnimalEnv, x: number, z: number) => env.heightAt(x, z) + env.waterAt(x, z);

function run(ctrl: AnimalController, env: AnimalEnv, seconds: number, each?: () => void, step = 0.05): void {
  const n = Math.ceil(seconds / step);
  for (let i = 0; i < n; i++) {
    ctrl.update(step, env);
    each?.();
  }
}

describe('pet catalog (app)', () => {
  it('six pets; feeding to befriend is half the price for each', () => {
    expect(PETS.map((p) => p.species)).toEqual(['crab', 'sandpiper', 'octopus', 'seal', 'turtle', 'dolphin']);
    for (const p of PETS) expect(p.feeds * 2).toBe(p.bucks);
    expect(new Set(PETS.map((p) => p.bucks)).size).toBe(6);
  });

  it('wild picks respect where the snack lands', () => {
    const r = seeded(3);
    for (let i = 0; i < 200; i++) {
      expect(petKind(pickWildSpecies(r, true)).habitat).not.toBe('land');
      expect(petKind(pickWildSpecies(r, false)).habitat).not.toBe('sea');
    }
  });
});

describe('water pets are visible', () => {
  for (const species of ['octopus', 'seal', 'turtle', 'dolphin'] as PetSpecies[]) {
    it(`a pet ${species} swimming keeps the top of its back above the water`, () => {
      const env = slopedBeach();
      const ctrl = new AnimalController(seeded(11));
      ctrl.setPet({ species, name: 'Pip', mood: 'happy', home: { x: 0, z: -4 } }, env);
      const s = ctrl.snapshot();
      expect(s.active).toBe(true);
      let swimmingSteps = 0;
      run(ctrl, env, 90, () => {
        if (!s.inWater || s.phase === 'breaching') return;
        swimmingSteps++;
        const top = s.y + petKind(species).top * s.size;
        expect(top).toBeGreaterThan(surface(env, s.x, s.z));
      });
      expect(swimmingSteps).toBeGreaterThan(100);
      expect(s.active).toBe(true); // a pet never leaves
    });
  }
});

describe('each pet does its own thing', () => {
  it('the sandpiper keeps to the wave edge', () => {
    const env = slopedBeach();
    const ctrl = new AnimalController(seeded(5));
    ctrl.spawnNow(env, { x: 0, z: 6 }, 'sandpiper');
    const s = ctrl.snapshot();
    expect(s.flap).toBe(1); // flies in
    run(ctrl, env, 40);
    expect(s.active).toBe(true);
    expect(s.z).toBeLessThan(3); // came down to the wet edge (shoreline ~0.8)
    expect(s.flap).toBe(0);
  });

  it('the octopus stays in the shallows, blends in when still, and inks at the brush', () => {
    const brush = { x: 0, z: 0, active: false };
    const env = slopedBeach(brush);
    const ctrl = new AnimalController(seeded(9));
    ctrl.setPet({ species: 'octopus', name: 'Inky', mood: 'happy' }, env);
    const s = ctrl.snapshot();
    let maxTint = 0;
    run(ctrl, env, 60, () => {
      expect(env.waterAt(s.x, s.z)).toBeGreaterThan(ANIMALS.octopusMinDepth * 0.5);
      maxTint = Math.max(maxTint, s.tint);
    });
    expect(maxTint).toBeGreaterThan(0.6);
    brush.x = s.x + 1;
    brush.z = s.z;
    brush.active = true;
    ctrl.update(0.05, env);
    expect(s.ink).toBeGreaterThan(0);
    expect(s.phase).toBe('fleeing');
  });

  it('the seal hauls out onto the sand, and goes back to sea', () => {
    const env = slopedBeach();
    const ctrl = new AnimalController(seeded(21));
    ctrl.setPet({ species: 'seal', name: 'Sammy', mood: 'happy' }, env);
    const s = ctrl.snapshot();
    expect(s.inWater).toBe(true);
    let ashore = false;
    let backInSea = false;
    run(ctrl, env, 400, () => {
      if (!s.inWater) ashore = true;
      else if (ashore) backInSea = true;
    });
    expect(ashore).toBe(true);
    expect(backInSea).toBe(true);
  });

  it('the turtle leaves flipper tracks when it crawls up the sand', () => {
    const env = slopedBeach();
    const ctrl = new AnimalController(seeded(4));
    ctrl.setPet({ species: 'turtle', name: 'Shelly', mood: 'happy', home: { x: 0, z: 5 } }, env);
    const s = ctrl.snapshot();
    expect(s.inWater).toBe(false); // its spot is on the sand
    run(ctrl, env, 60);
    expect(s.trackCount).toBeGreaterThan(2);
    for (let i = 0; i < s.trackCount; i++) expect(env.waterAt(s.tracks[i * 2], s.tracks[i * 2 + 1])).toBeLessThan(0.3);
  });

  it('a pet dolphin turns round at the ends of its beach instead of leaving', () => {
    const env = slopedBeach();
    const ctrl = new AnimalController(seeded(8));
    ctrl.setPet({ species: 'dolphin', name: 'Flip', mood: 'happy' }, env);
    run(ctrl, env, 120);
    expect(ctrl.snapshot().active).toBe(true);
  });
});

describe('snacks in the water', () => {
  it('a snack tossed into the sea floats, and a sea animal comes for it and eats it', () => {
    const env = slopedBeach();
    const ctrl = new AnimalController(seeded(12));
    let fed: string | null = null;
    ctrl.onWildFed = (sp) => (fed = sp);
    const pos = { x: 0, z: -5 };
    const sp = ctrl.snackSpecies(env, pos);
    expect(petKind(sp).habitat).not.toBe('land');
    expect(ctrl.dropFood(env, pos)).toBe(true);
    expect(ctrl.snapshot().food.floating).toBe(true);
    expect(ctrl.snapshot().food.y).toBeCloseTo(surface(env, pos.x, pos.z), 3);
    run(ctrl, env, 240);
    expect(fed).toBe(sp);
  });

  it('a snack on dry sand is for land animals', () => {
    const env = slopedBeach();
    const ctrl = new AnimalController(seeded(2));
    for (let i = 0; i < 20; i++) {
      ctrl.takeFood();
      expect(petKind(ctrl.snackSpecies(env, { x: 0, z: 6 })).habitat).not.toBe('sea');
    }
  });
});

describe('pets are things you move', () => {
  it('a carried pet follows the pointer, and is set down where you let go', () => {
    const env = slopedBeach();
    const ctrl = new AnimalController(seeded(1));
    ctrl.setPet({ species: 'crab', name: 'Pinch', mood: 'happy' }, env);
    run(ctrl, env, 2);
    const s = ctrl.snapshot();
    expect(ctrl.animalNear(s.x, s.z, ANIMALS.petReach)).toBe(true);
    ctrl.carry(true);
    expect(s.phase).toBe('carried');
    ctrl.carryTo(env, 5, 8);
    run(ctrl, env, 3);
    expect([s.x, s.z]).toEqual([5, 8]);
    expect(s.y).toBeGreaterThan(env.heightAt(5, 8));
    expect(ctrl.canSetDown(env, 5, 8)).toBe(true);
    ctrl.carry(false, env);
    expect(s.carried).toBe(false);
    run(ctrl, env, 30);
    expect(Math.hypot(s.x - 5, s.z - 8)).toBeLessThan(ANIMALS.homeRadius + 3.5);
  });

  it('a sea pet can only be set down in the water', () => {
    const env = slopedBeach();
    const ctrl = new AnimalController(seeded(1));
    ctrl.setPet({ species: 'dolphin', name: 'Flip', mood: 'happy' }, env);
    expect(ctrl.canSetDown(env, 0, 6)).toBe(false);
    expect(ctrl.canSetDown(env, 0, -8)).toBe(true);
  });

  it('switching to a pet of another species replaces the animal on the beach', () => {
    const env = slopedBeach();
    const ctrl = new AnimalController(seeded(1));
    ctrl.setPet({ species: 'crab', name: 'A', mood: 'happy' }, env);
    ctrl.setPet({ species: 'turtle', name: 'B', mood: 'happy' }, env);
    expect(ctrl.snapshot().species).toBe('turtle');
  });
});
