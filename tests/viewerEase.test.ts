import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, expect, it, vi } from 'vitest';
import { BeachRenderer } from '../src/render/beachRenderer';
import { ObjectView } from '../src/render/objects';
import { PALETTES } from '../src/palette';
import type { ObjectState } from '../src/sim/objects';
import { makeSwell } from '../src/sim/waves';

// A viewer's copy of someone else's beach eases to each new save (docs/LIVE_SIM.md, section 7).

afterEach(() => vi.restoreAllMocks());

function withScene(fn: (scene: Scene, renderer: BeachRenderer) => void): void {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  // (the null engine can't take texture data; the frames themselves aren't what's tested)
  (engine as unknown as { updateTextureData: () => void }).updateTextureData = () => {};
  try {
    fn(scene, new BeachRenderer(scene, { nx: 4, ny: 4, dx: 8 }, new Float32Array(16), makeSwell(1)));
  } finally {
    scene.dispose();
    engine.dispose();
  }
}

function frameMixAt(renderer: BeachRenderer, ms: number): number {
  vi.spyOn(performance, 'now').mockReturnValue(ms);
  const set = vi.spyOn(renderer.sandMat, 'setFloat');
  renderer.update(PALETTES[0], new Vector3(0, -1, 0), 0, 0, 0, 1);
  const calls = set.mock.calls.filter((c) => c[0] === 'frameMix');
  set.mockRestore();
  return calls[calls.length - 1][1] as number;
}

it('eases a snapshot to its new sand instead of swapping it', () => {
  withScene((_scene, r) => {
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

it('swaps at once when there is no snapshot to ease from', () => {
  withScene((_scene, r) => {
    // no showStatic yet: the renderer isn't drawing a snapshot
    r.easeStatic(new Float32Array(64), 1000);
    expect(frameMixAt(r, 0)).toBe(1);
  });
});

it('glides a thing on a snapshot to where a new save put it', () => {
  withScene((scene, r) => {
    const view = new ObjectView(scene, r);
    const rock: ObjectState = { id: 1, kind: 'rock', item: 'rock', x: 12, y: 20, z: 0.5, size: 0.5, angle: 0, variant: 1, floating: false };
    view.set([rock]);
    view.set([{ ...rock, x: 16 }]);
    expect(view.moving).toBe(1);
    for (let i = 0; i < 120; i++) view.glide(1 / 60);
    expect(view.moving).toBe(0);
  });
});
