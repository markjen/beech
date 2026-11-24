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

  it('the sea brings trash, seaweed and cowries in too, and still keeps only a few', async () => {
    const sim = new BeachSim(g, 3);
    const kinds = new Set<string>();
    const items = new Set<string>();
    for (let s = 0; s < 150; s++) {
      if (s % 150 === 0) await tick();
      sim.objects.washSoon(); // one wash-in per step
      sim.step(DT);
      for (const o of sim.objects.states()) {
        if (o.wild) {
          kinds.add(o.kind);
          items.add(o.item);
        }
      }
    }
    expect(kinds.has('trash')).toBe(true);
    expect(kinds.has('seaweed')).toBe(true);
    expect(items.has('cowrie')).toBe(true);
    expect(sim.objects.states().filter((o) => o.wild).length).toBeLessThanOrEqual(6);
  });

  it('trash and seaweed tumble in the swash like shells', async () => {
    const sim = new BeachSim(g, 1);
    const tr = sim.placeObject({ kind: 'trash', item: 'trash', x: 16, y: 16.5, angle: 0, size: 0.15, variant: 1 });
    const sw = sim.placeObject({ kind: 'seaweed', item: 'seaweed', x: 18, y: 16.5, angle: 0, size: 0.3, variant: 2 });
    let trTravel = 0;
    let swTravel = 0;
    for (let s = 0; s < 30 * 60; s++) {
      if (s % 150 === 0) await tick();
      sim.step(DT);
      const t = sim.objects.states().find((o) => o.id === tr.id)!;
      const w = sim.objects.states().find((o) => o.id === sw.id)!;
      trTravel = Math.max(trTravel, Math.hypot(t.x - 16, t.y - 16.5));
      swTravel = Math.max(swTravel, Math.hypot(w.x - 18, w.y - 16.5));
      expect(Number.isFinite(t.x + t.y + t.z)).toBe(true);
      expect(Number.isFinite(w.x + w.y + w.z)).toBe(true);
    }
    expect(trTravel).toBeGreaterThan(0.1);
    expect(swTravel).toBeGreaterThan(0.1);
  });

  it('no wash-ins while the waves are off', async () => {
    const sim = new BeachSim(g, 3, { waves: false });
    sim.objects.washSoon();
    await run(sim, 30 * 5);
    expect(sim.objects.count).toBe(0);
  });
});

describe('the roster and packed positions (what the worker sends each frame)', () => {
  it('bumps the version only on add/remove, and packs positions in roster order', async () => {
    const { POS_STRIDE } = await import('../src/sim/objects');
    const sim = new BeachSim(GRID_TIERS.low, 1);
    const objs = sim.objects;
    const v0 = objs.version;
    const a = sim.placeObject({ kind: 'rock', item: 'rock', x: 10, y: 24, angle: 0.5, size: 0.4, variant: 1 });
    const b = sim.placeObject({ kind: 'flag', item: 'flag', x: 12, y: 25, angle: 0, size: 0.4, variant: 2 });
    expect(objs.version).toBe(v0 + 2);
    for (let i = 0; i < 10; i++) sim.step(1 / 30);
    expect(objs.version).toBe(v0 + 2); // moving things doesn't change the roster
    const roster = objs.persisted();
    const pos = objs.packPositions();
    expect(pos.length).toBe(roster.length * POS_STRIDE);
    expect(roster.map((o) => o.id)).toEqual([a.id, b.id]);
    expect(pos[0]).toBeCloseTo(10, 5);
    expect(pos[1]).toBeCloseTo(24, 5);
    expect(pos[3]).toBeCloseTo(0.5, 5);
    expect(pos[POS_STRIDE]).toBeCloseTo(12, 5);
    sim.removeObject(a.id);
    expect(objs.version).toBe(v0 + 3);
    expect(objs.packPositions().length).toBe(POS_STRIDE);
  });
});

describe('moving a thing (long-press and drag)', () => {
  it('lifts a rock out where it was, settles it where it lands, and undoes and redoes as one step', () => {
    const sim = new BeachSim(GRID_TIERS.low, 1, { waves: false, erosion: false, healing: false, seep: false });
    const y = 26;
    const cell = (x: number) => Math.floor(y / sim.dx) * sim.nx + Math.floor(x / sim.dx);
    const sandBefore = sim.sand.slice();
    const floorBefore = sim.bottom.slice();
    const rock = sim.placeObject({ kind: 'rock', item: 'rock', x: 10, y, angle: 0, size: 0.5, variant: 1 });
    expect(sim.bottom[cell(10)]).toBeGreaterThan(floorBefore[cell(10)]);
    const undos = sim.undo.undoCount;
    const moved = sim.moveObject(rock.id, 20, y)!;
    expect(sim.undo.undoCount).toBe(undos + 1);
    expect(moved.id).toBe(rock.id);
    // the old spot is sand again, exactly as before; the new spot has the rock
    expect(sim.bottom[cell(10)]).toBeCloseTo(floorBefore[cell(10)], 6);
    expect(sim.sand[cell(10)]).toBeCloseTo(sandBefore[cell(10)], 6);
    expect(sim.bottom[cell(20)]).toBeGreaterThan(floorBefore[cell(20)]);
    expect(sim.objects.persisted().map((o) => [o.id, Math.round(o.x)])).toEqual([[rock.id, 20]]);
    sim.undoStroke(false);
    expect(sim.objects.persisted().map((o) => Math.round(o.x))).toEqual([10]);
    expect(sim.bottom[cell(20)]).toBeCloseTo(floorBefore[cell(20)], 6);
    sim.redoStroke(false);
    expect(sim.objects.persisted().map((o) => Math.round(o.x))).toEqual([20]);
    // kept on the beach
    expect(sim.moveObject(rock.id, 99, -5)!.x).toBeLessThan(32);
    expect(sim.moveObject(12345, 1, 1)).toBe(null);
  });
});

describe('keeping what the sea brings', () => {
  it('a stray picked up and put down is yours: no longer wild, marked found, and saved', async () => {
    const { encodeSand, decodeSand } = await import('../src/sim/sandCodec');
    const sim = new BeachSim(GRID_TIERS.low, 1, { waves: false, erosion: false, healing: false, seep: false });
    const shell = sim.objects.add({ kind: 'shell', item: 'shell', x: 12, y: 20, angle: 0, size: 0.1, variant: 2, wild: true });
    const kept = sim.moveObject(shell.id, 14, 24)!;
    expect(kept.wild).toBeUndefined();
    expect(kept.found).toBe(true);
    const back = await decodeSand(await encodeSand(new Float32Array(sim.n), sim.nx, sim.ny, sim.objects.persisted()));
    expect(back.objects[0]).toMatchObject({ item: 'shell', found: true });
    expect(back.objects[0].wild).toBeUndefined();
    // undo: a stray again
    sim.undoStroke(false);
    expect(sim.objects.persisted()[0]).toMatchObject({ wild: true });
  });
});
