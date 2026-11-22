import { describe, expect, it } from 'vitest';
import { BeachSim } from '../src/sim/beachSim';
import { GRID_TIERS } from '../src/config';

const g = GRID_TIERS.low;
const DT = 1 / 30;
/** Let Vitest's worker breathe during long runs (a busy event loop times out its RPC on slow CI machines). */
const tick = () => new Promise((r) => setTimeout(r, 0));
async function run(sim: BeachSim, steps: number): Promise<void> {
  for (let s = 0; s < steps; s++) {
      if (s % 150 === 0) await tick();
    if (s % 150 === 0) await tick();
    sim.step(DT);
  }
}
const cell = (sim: BeachSim, x: number, y: number) => Math.floor(y / sim.dx) * sim.nx + Math.floor(x / sim.dx);

describe('rocks', () => {
  it('cannot be dug through or washed away, and sand scours around them', async () => {
    const sim = new BeachSim(g, 1);
    const rock = sim.placeObject({ kind: 'rock', item: 'rock', x: 14, y: 18, angle: 0.3, size: 0.45, variant: 2 });
    const k = cell(sim, 14, 18);
    const top = sim.sand[k];
    expect(top).toBeGreaterThan(sim.rest[k] + 0.2);
    // digging on the rock does nothing to it
    sim.stamp('dig', 14, 18, 0.3, 0.5);
    expect(sim.sand[k]).toBeGreaterThanOrEqual(top - 1e-6);
    // a minute of waves: the rock is intact, the sand next to it has changed
    const ringBefore: number[] = [];
    const ring: number[] = [];
    for (let a = 0; a < 16; a++) ring.push(cell(sim, 14 + Math.cos(a) * 0.75, 18 + Math.sin(a) * 0.75));
    for (const r of ring) ringBefore.push(sim.sand[r]);
    await run(sim, 30 * 60);
    expect(sim.sand[k]).toBeGreaterThanOrEqual(top - 1e-6);
    const moved = ring.reduce((m, r, i) => m + Math.abs(sim.sand[r] - ringBefore[i]), 0) / ring.length;
    expect(moved).toBeGreaterThan(0.005);
    // taking it away gives the sand back
    sim.removeObject(rock.id);
    expect(sim.sand[k]).toBeLessThan(top - 0.15);
  });

  it('is saved as an object, not as a lump of sand', async () => {
    const sim = new BeachSim(g, 1, { waves: false, erosion: false, healing: false, seep: false });
    sim.placeObject({ kind: 'rock', item: 'rock', x: 16, y: 28, angle: 0, size: 0.5, variant: 1 });
    const delta = sim.sandDelta();
    expect(Math.abs(delta[cell(sim, 16, 28)])).toBeLessThan(0.01);
    const saved = sim.objects.persisted();
    const other = new BeachSim(g, 1, { waves: false, erosion: false, healing: false, seep: false });
    other.loadDelta(delta, saved);
    expect(other.objects.count).toBe(1);
    expect(other.sand[cell(other, 16, 28)]).toBeCloseTo(sim.sand[cell(sim, 16, 28)], 3);
  });
});

describe('driftwood', () => {
  it('stays put high on the dry beach', async () => {
    const sim = new BeachSim(g, 1);
    const w = sim.placeObject({ kind: 'driftwood', item: 'driftwood', x: 10, y: 28, angle: 0.4, size: 1.8, variant: 1 });
    await run(sim, 30 * 20);
    const now = sim.objects.persisted().find((o) => o.id === w.id)!;
    expect(Math.hypot(now.x - 10, now.y - 28)).toBeLessThan(0.01);
  });

  it('floats and is carried around by the swash', async () => {
    const sim = new BeachSim(g, 1);
    const w = sim.placeObject({ kind: 'driftwood', item: 'driftwood', x: 16, y: 16.5, angle: 0, size: 1.4, variant: 3 });
    let floated = false;
    let maxTravel = 0;
    for (let s = 0; s < 30 * 60; s++) {
      if (s % 150 === 0) await tick();
      sim.step(DT);
      const st = sim.objects.states().find((o) => o.id === w.id)!;
      floated ||= st.floating;
      maxTravel = Math.max(maxTravel, Math.hypot(st.x - 16, st.y - 16.5));
      expect(Number.isFinite(st.x) && Number.isFinite(st.y)).toBe(true);
    }
    expect(floated).toBe(true);
    expect(maxTravel).toBeGreaterThan(0.3);
  });

  it('put out at sea, comes ashore', async () => {
    const sim = new BeachSim(g, 1);
    const w = sim.placeObject({ kind: 'driftwood', item: 'driftwood', x: 16, y: 8, angle: 0.2, size: 1.2, variant: 1 });
    await run(sim, 30 * 120);
    const st = sim.objects.states().find((o) => o.id === w.id)!;
    expect(st.y).toBeGreaterThan(14);
  });
});

describe('placing is undoable', () => {
  it('undo removes a placed item, redo puts it back; undo of a removal restores it', async () => {
    const sim = new BeachSim(g, 1, { waves: false, erosion: false, healing: false, seep: false });
    const r = sim.placeObject({ kind: 'rock', item: 'rock', x: 12, y: 26, angle: 0, size: 0.4, variant: 1 });
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

describe('shells, sea glass and flags', () => {
  it('a shell in the swash is rolled about, then settles; a flag stays put', async () => {
    const sim = new BeachSim(g, 1);
    const sh = sim.placeObject({ kind: 'shell', item: 'shell', x: 16, y: 16.5, angle: 0, size: 0.1, variant: 2 });
    const fl = sim.placeObject({ kind: 'flag', item: 'flag', x: 16, y: 17, angle: 0, size: 0.4, variant: 1 });
    let travel = 0;
    for (let s = 0; s < 30 * 60; s++) {
      if (s % 150 === 0) await tick();
      sim.step(DT);
      const st = sim.objects.states().find((o) => o.id === sh.id)!;
      travel = Math.max(travel, Math.hypot(st.x - 16, st.y - 16.5));
      expect(Number.isFinite(st.x + st.y + st.z)).toBe(true);
    }
    expect(travel).toBeGreaterThan(0.1);
    const f = sim.objects.persisted().find((o) => o.id === fl.id)!;
    expect([f.x, f.y]).toEqual([16, 17]);
  });

  it('the sea brings things in now and then, and keeps only a few', async () => {
    const sim = new BeachSim(g, 3);
    const seen = new Set<number>();
    for (let s = 0; s < 30 * 60; s++) {
      if (s % 150 === 0) await tick();
      if (s % 90 === 0) sim.objects.washSoon(); // speed the sea up: something every 3 s
      sim.step(DT);
      if (s % 30 === 0) for (const o of sim.objects.states()) if (o.wild) seen.add(o.id);
    }
    const wild = sim.objects.states().filter((o) => o.wild);
    expect(seen.size).toBeGreaterThanOrEqual(4);
    expect(wild.length).toBeLessThanOrEqual(6);
    // nothing washed in lands outside the beach
    for (const o of wild) expect(o.x > 0 && o.x < 32 && o.y > 0 && o.y < 32).toBe(true);
    // wild things aren't on the undo stack
    expect(sim.undo.undoCount).toBe(0);
  });

  it('no wash-ins while the waves are off', async () => {
    const sim = new BeachSim(g, 3, { waves: false });
    sim.objects.washSoon();
    await run(sim, 30 * 5);
    expect(sim.objects.count).toBe(0);
  });
});
