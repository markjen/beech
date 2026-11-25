import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { expect, it, vi } from 'vitest';
import { BeachRenderer } from '../src/render/beachRenderer';
import { ObjectView } from '../src/render/objects';
import type { ObjectState } from '../src/sim/objects';
import { makeSwell } from '../src/sim/waves';

it('uploads the transform of a newly placed rock that shares an existing mesh', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const renderer = new BeachRenderer(scene, { nx: 4, ny: 4, dx: 8 }, new Float32Array(16), makeSwell(1));
    const view = new ObjectView(scene, renderer);
    const rock: ObjectState = { id: 1, kind: 'rock', item: 'rock', x: 12, y: 20, z: 0.5, size: 0.5, angle: 0, variant: 1, floating: false };
    view.set([rock]);
    scene.onBeforeRenderObservable.notifyObservers(scene);

    const upload = vi.spyOn(engine, 'updateDynamicVertexBuffer');
    view.set([rock, { ...rock, id: 2, x: 14 }]);
    scene.onBeforeRenderObservable.notifyObservers(scene);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][3]).toBe(2 * 16 * Float32Array.BYTES_PER_ELEMENT);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
