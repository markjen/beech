import { describe, expect, it } from 'vitest';
import { BeachSim } from '../src/sim/beachSim';
import { GRID_TIERS } from '../src/config';

const g = GRID_TIERS.low;
const DT = 1 / 30;
const cell = (sim: BeachSim, x: number, y: number) => Math.floor(y / sim.dx) * sim.nx + Math.floor(x / sim.dx);

describe('rocks', () => {
  it('cannot be dug through or washed away, and sand scours around them', () => {
    const sim = new BeachSim(g, 1);
    const rock = sim.placeObject({ kind: 'rock', item: 'rock', x: 14, y: 10, angle: 0.3, size: 0.45, variant: 2 });
    const k = cell(sim, 14, 10);
    const top = sim.sand[k];
    expect(top).toBeGreaterThan(sim.rest[k] + 0.2);
    // digging on the rock does nothing to it
    sim.stamp('dig', 14, 10, 0.3, 0.5);
    expect(sim.sand[k]).toBeGreaterThanOrEqual(top - 1e-6);
    // a minute of waves: the rock is intact, the sand next to it has changed
    const ringBefore: number[] = [];
    const ring: number[] = [];
    for (let a = 0; a < 16; a++) ring.push(cell(sim, 14 + Math.cos(a) * 0.75, 10 + Math.sin(a) * 0.75));
    for (const r of ring) ringBefore.push(sim.sand[r]);
    for (let s = 0; s < 30 * 60; s++) sim.step(DT);
    expect(sim.sand[k]).toBeGreaterThanOrEqual(top - 1e-6);
    const moved = ring.reduce((m, r, i) => m + Math.abs(sim.sand[r] - ringBefore[i]), 0) / ring.length;
    expect(moved).toBeGreaterThan(0.005);
    // taking it away gives the sand back
    sim.removeObject(rock.id);
    expect(sim.sand[k]).toBeLessThan(top - 0.15);
  });

  it('is saved as an object, not as a lump of sand', () => {
    const sim = new BeachSim(g, 1, { waves: false, erosion: false, healing: false, seep: false });
    sim.placeObject({ kind: 'rock', item: 'rock', x: 16, y: 20, angle: 0, size: 0.5, variant: 1 });
    const delta = sim.sandDelta();
    expect(Math.abs(delta[cell(sim, 16, 20)])).toBeLessThan(0.01);
    const saved = sim.objects.persisted();
    const other = new BeachSim(g, 1, { waves: false, erosion: false, healing: false, seep: false });
    other.loadDelta(delta, saved);
    expect(other.objects.count).toBe(1);
    expect(other.sand[cell(other, 16, 20)]).toBeCloseTo(sim.sand[cell(sim, 16, 20)], 3);
  });
});

describe('driftwood', () => {
  it('stays put high on the dry beach', () => {
    const sim = new BeachSim(g, 1);
    const w = sim.placeObject({ kind: 'driftwood', item: 'driftwood', x: 10, y: 20, angle: 0.4, size: 1.8, variant: 1 });
    for (let s = 0; s < 30 * 20; s++) sim.step(DT);
    const now = sim.objects.persisted().find((o) => o.id === w.id)!;
    expect(Math.hypot(now.x - 10, now.y - 20)).toBeLessThan(0.01);
  });

  it('floats and is carried around by the swash', () => {
    const sim = new BeachSim(g, 1);
    const w = sim.placeObject({ kind: 'driftwood', item: 'driftwood', x: 16, y: 8.5, angle: 0, size: 1.4, variant: 3 });
    let floated = false;
    let maxTravel = 0;
    for (let s = 0; s < 30 * 60; s++) {
      sim.step(DT);
      const st = sim.objects.states().find((o) => o.id === w.id)!;
      floated ||= st.floating;
      maxTravel = Math.max(maxTravel, Math.hypot(st.x - 16, st.y - 8.5));
      expect(Number.isFinite(st.x) && Number.isFinite(st.y)).toBe(true);
    }
    expect(floated).toBe(true);
    expect(maxTravel).toBeGreaterThan(0.3);
  });
});

describe('placing is undoable', () => {
  it('undo removes a placed item, redo puts it back; undo of a removal restores it', () => {
    const sim = new BeachSim(g, 1, { waves: false, erosion: false, healing: false, seep: false });
    const r = sim.placeObject({ kind: 'rock', item: 'rock', x: 12, y: 18, angle: 0, size: 0.4, variant: 1 });
    expect(sim.objects.count).toBe(1);
    sim.undoStroke(false);
    expect(sim.objects.count).toBe(0);
    sim.redoStroke(false);
    expect(sim.objects.count).toBe(1);
    sim.removeObject(r.id);
    expect(sim.objects.count).toBe(0);
    sim.undoStroke(false);
    expect(sim.objects.count).toBe(1);
  });
});
