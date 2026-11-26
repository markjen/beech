import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, expect, it, vi } from 'vitest';
import { GRID_TIERS } from '../src/config';
import type { CameraController } from '../src/input/cameraController';
import type { Account, ShoreBeach } from '../src/net/account';
import { BeachStore, type Saved } from '../src/net/beachStore';
import { BeachRenderer } from '../src/render/beachRenderer';
import { NeighborView } from '../src/render/neighbors';
import { ObjectView } from '../src/render/objects';
import { PALETTES } from '../src/palette';
import type { ObjectState } from '../src/sim/objects';
import { encodeSand } from '../src/sim/sandCodec';
import { makeSwell } from '../src/sim/waves';

// A viewer's copy of someone else's beach eases to each new save (docs/LIVE_SIM.md, section 7).

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function withScene(fn: (scene: Scene) => void | Promise<void>): Promise<void> {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  // (the null engine can't take texture data; the frames themselves aren't what's tested)
  (engine as unknown as { updateTextureData: () => void }).updateTextureData = () => {};
  try {
    await fn(scene);
  } finally {
    scene.dispose();
    engine.dispose();
  }
}

function makeRenderer(scene: Scene, offsetX = 0): BeachRenderer {
  return new BeachRenderer(scene, { nx: 4, ny: 4, dx: 8 }, new Float32Array(16), makeSwell(1), offsetX);
}

function frameMixAt(renderer: BeachRenderer, ms: number): number {
  vi.spyOn(performance, 'now').mockReturnValue(ms);
  const set = vi.spyOn(renderer.sandMat, 'setFloat');
  renderer.update(PALETTES[0], new Vector3(0, -1, 0), 0, 0, 0, 1);
  const calls = set.mock.calls.filter((c) => c[0] === 'frameMix');
  set.mockRestore();
  return calls[calls.length - 1][1] as number;
}

it('eases a snapshot to its new sand instead of swapping it', async () => {
  await withScene((scene) => {
    const r = makeRenderer(scene);
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    r.showStatic(new Float32Array(64));
    expect(frameMixAt(r, 1000)).toBe(1);
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    r.easeStatic(new Float32Array(64).fill(1), 1000);
    expect(frameMixAt(r, 1000)).toBe(0);
    const mid = frameMixAt(r, 1500);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(frameMixAt(r, 2100)).toBe(1);
    // and it stays there
    expect(frameMixAt(r, 5000)).toBe(1);
  });
});

it('swaps at once when there is no snapshot to ease from', async () => {
  await withScene((scene) => {
    const r = makeRenderer(scene);
    // no showStatic yet: the renderer isn't drawing a snapshot
    r.easeStatic(new Float32Array(64), 1000);
    expect(frameMixAt(r, 0)).toBe(1);
  });
});

it('uses only the new beach on the first frame after a handoff', async () => {
  await withScene((scene) => {
    const r = makeRenderer(scene);
    r.uploadFrame(new Float32Array(64));
    r.uploadFrame(new Float32Array(64).fill(1), true);
    r.setFrameMix(0.25);
    expect(frameMixAt(r, 1000)).toBe(1);
    r.uploadFrame(new Float32Array(64).fill(2));
    r.setFrameMix(0.25);
    expect(frameMixAt(r, 1016)).toBe(0.25);
  });
});

it('glides a thing on a snapshot to where a new save put it', async () => {
  await withScene((scene) => {
    const view = new ObjectView(scene, makeRenderer(scene));
    const rock: ObjectState = { id: 1, kind: 'rock', item: 'rock', x: 12, y: 20, z: 0.5, size: 0.5, angle: 0, variant: 1, floating: false };
    view.set([rock]);
    view.set([{ ...rock, x: 16 }]);
    expect(view.moving).toBe(1);
    for (let i = 0; i < 120; i++) view.glide(1 / 60);
    expect(view.moving).toBe(0);
  });
});

it('eases a new save found by the regular shore poll', async () => {
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  await withScene(async (scene) => {
    const grid = GRID_TIERS.low;
    const rest = new Float32Array(grid.nx * grid.ny);
    async function saveAt(version: number, height: number): Promise<Saved> {
      const bytes = await encodeSand(new Float32Array(rest.length).fill(height), grid.nx, grid.ny, []);
      return { bytes, nx: grid.nx, ny: grid.ny, location: 'bondi', updatedAt: version, version };
    }
    let save = await saveAt(1, 0);
    const store = new BeachStore(grid, rest, { load: async () => save, save: async () => ({ updatedAt: 0 }) });
    const cam = { focusX: 0, groundFootprint: () => null } as unknown as CameraController;
    const account = { user: null, beaches: [] } as unknown as Account;
    const view = new NeighborView(scene, grid, rest, makeSwell(1), cam, account, store);
    const beach: ShoreBeach = { id: 'other', name: 'Other', code: 'OTHER', location: 'bondi', updatedAt: 1 };
    vi.spyOn(view.api, 'shore').mockImplementation(async () => ({
      center: { ...beach, you: false, updatedAt: save.updatedAt }, left: [], right: [],
    }));
    const show = vi.spyOn(BeachRenderer.prototype, 'showStatic');
    const ease = vi.spyOn(BeachRenderer.prototype, 'easeStatic');
    try {
      await view.visit(beach.code);
      expect(show).toHaveBeenCalledTimes(1);
      expect(ease).not.toHaveBeenCalled();

      save = await saveAt(2, 0.3);
      await view.poll();
      await view.poll();
      expect(view.snapshot(0)?.updatedAt).toBe(2);
      expect(show).toHaveBeenCalledTimes(1);
      expect(ease).toHaveBeenCalledTimes(1);
    } finally {
      view.clear();
    }
  });
});

it('uses the same blend on both sides of a linked edge in the same frame', async () => {
  await withScene((scene) => {
    const left = makeRenderer(scene);
    const right = makeRenderer(scene, 32);
    left.showStatic(new Float32Array(64));
    right.showStatic(new Float32Array(64));
    left.setNeighbors(null, right);
    right.setNeighbors(left, null);
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    right.easeStatic(new Float32Array(64).fill(1), 1000);
    clock.mockReturnValue(1500);

    const leftSet = vi.spyOn(left.sandMat, 'setFloat');
    const rightSet = vi.spyOn(right.sandMat, 'setFloat');
    const forward = new Vector3(0, -1, 0);
    left.update(PALETTES[0], forward, 0, 0, 0, 1, 1500);
    right.update(PALETTES[0], forward, 0, 0, 0, 1, 1500);
    expect(leftSet).toHaveBeenCalledWith('posMix', 0.5);
    expect(rightSet).toHaveBeenCalledWith('frameMix', 0.5);
  });
});
