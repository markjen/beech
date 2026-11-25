import { beforeAll, describe, expect, it } from 'vitest';
import { BeachSim } from '../src/sim/beachSim';
import { GRID_TIERS } from '../src/config';
import type { ObjectState, PlacedObject } from '../src/sim/objects';

const g = GRID_TIERS.low;
const DT = 1 / 30;
/** Let Vitest's worker breathe during long runs (a busy event loop times out its RPC on slow CI machines). */
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Non-rock objects (driftwood, shells, flags, trash, seaweed, bottles) do not
 * modify the sand or collide with each other, so we simulate them together on
 * one BeachSim(low, 1) pass instead of running six separate 1-to-2-minute sims.
 */
describe('objects in the waves and swash', () => {
  let dryWoodAt20s!: PlacedObject;
  let swashFloated = false;
  let swashMaxTravel = 0;
  let swashAllFinite = true;
  let seaWoodAt120s!: ObjectState;
  let shellTravel = 0;
  let shellAllFinite = true;
  let flagAt60s!: PlacedObject;
  let trashTravel = 0;
  let seaweedTravel = 0;
  let trashAllFinite = true;
  let seaweedAllFinite = true;
  let lostAt60s: PlacedObject[] = [];
  let bottleCountAt60s = 0;
  let persistedFiniteAt60s = true;

  beforeAll(async () => {
    const sim = new BeachSim(g, 1);
    const dryWood = sim.placeObject({ kind: 'driftwood', item: 'driftwood', x: 10, y: 28, angle: 0.4, size: 1.8, variant: 1 });
    const swashWood = sim.placeObject({ kind: 'driftwood', item: 'driftwood', x: 16, y: 16.5, angle: 0, size: 1.4, variant: 3 });
    const seaWood = sim.placeObject({ kind: 'driftwood', item: 'driftwood', x: 16, y: 8, angle: 0.2, size: 1.2, variant: 1 });
    const shell = sim.placeObject({ kind: 'shell', item: 'shell', x: 16, y: 16.5, angle: 0, size: 0.1, variant: 2 });
    const flag = sim.placeObject({ kind: 'flag', item: 'flag', x: 16, y: 17, angle: 0, size: 0.4, variant: 1 });
    const trash = sim.placeObject({ kind: 'trash', item: 'trash', x: 16, y: 16.5, angle: 0, size: 0.15, variant: 1 });
    const seaweed = sim.placeObject({ kind: 'seaweed', item: 'seaweed', x: 18, y: 16.5, angle: 0, size: 0.3, variant: 2 });
    const bottle = sim.placeObject({ kind: 'bottle', item: 'bottle', x: 16, y: 12, angle: 0, size: 0.3, variant: 1 });

    for (let s = 0; s < 30 * 120; s++) {
      if (s % 150 === 0) await tick();
      sim.step(DT);
      if (s < 30 * 60) {
        const byId = new Map<number, ObjectState>();
        for (const st of sim.objects.states()) byId.set(st.id, st);

        const sw = byId.get(swashWood.id)!;
        swashFloated ||= sw.floating;
        swashMaxTravel = Math.max(swashMaxTravel, Math.hypot(sw.x - 16, sw.y - 16.5));
        if (!Number.isFinite(sw.x) || !Number.isFinite(sw.y)) swashAllFinite = false;

        const sh = byId.get(shell.id)!;
        shellTravel = Math.max(shellTravel, Math.hypot(sh.x - 16, sh.y - 16.5));
        if (!Number.isFinite(sh.x + sh.y + sh.z)) shellAllFinite = false;

        const tr = byId.get(trash.id)!;
        const wed = byId.get(seaweed.id)!;
        trashTravel = Math.max(trashTravel, Math.hypot(tr.x - 16, tr.y - 16.5));
        seaweedTravel = Math.max(seaweedTravel, Math.hypot(wed.x - 18, wed.y - 16.5));
        if (!Number.isFinite(tr.x + tr.y + tr.z)) trashAllFinite = false;
        if (!Number.isFinite(wed.x + wed.y + wed.z)) seaweedAllFinite = false;
      }
      if (s === 30 * 20 - 1) {
        dryWoodAt20s = { ...sim.objects.persisted().find((o) => o.id === dryWood.id)! };
      }
      if (s === 30 * 60 - 1) {
        flagAt60s = { ...sim.objects.persisted().find((o) => o.id === flag.id)! };
        lostAt60s = sim.objects.takeLost();
        const persisted = sim.objects.persisted();
        bottleCountAt60s = persisted.filter((o) => o.id === bottle.id).length;
        persistedFiniteAt60s = persisted.every((o) => Number.isFinite(o.x) && Number.isFinite(o.y));
      }
    }
    seaWoodAt120s = sim.objects.states().find((o) => o.id === seaWood.id)!;
  });

  it('driftwood stays put high on the dry beach', () => {
    expect(Math.hypot(dryWoodAt20s.x - 10, dryWoodAt20s.y - 28)).toBeLessThan(0.01);
  });

  it('driftwood floats and is carried around by the swash', () => {
    expect(swashAllFinite).toBe(true);
    expect(swashFloated).toBe(true);
    expect(swashMaxTravel).toBeGreaterThan(0.3);
  });

  it('driftwood put out at sea comes ashore', () => {
    expect(seaWoodAt120s.y).toBeGreaterThan(14);
  });

  it('a shell in the swash is rolled about, then settles; a flag stays put', () => {
    expect(shellAllFinite).toBe(true);
    expect(shellTravel).toBeGreaterThan(0.1);
    expect([flagAt60s.x, flagAt60s.y]).toEqual([16, 17]);
  });

  it('trash and seaweed tumble in the swash like shells', () => {
    expect(trashAllFinite).toBe(true);
    expect(seaweedAllFinite).toBe(true);
    expect(trashTravel).toBeGreaterThan(0.1);
    expect(seaweedTravel).toBeGreaterThan(0.1);
  });

  it('a beach with waves keeps things in the surf (Stokes drift brings them in)', () => {
    expect(lostAt60s).toEqual([]);
    expect(bottleCountAt60s).toBe(1);
    expect(persistedFiniteAt60s).toBe(true);
  });
});
