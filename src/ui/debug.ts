import * as CONFIG from '../config';
import type { FrameInfo, TunableSection, ToWorker } from '../sim/protocol';

export interface DebugAnimalsHandle {
  spawn: () => boolean;
  spawnDolphin: () => boolean;
  despawn: () => void;
  dropFood: () => boolean;
  status: () => string;
}

/**
 * ?debug=1: a live tuning panel (lil-gui, loaded on demand) plus a small stats
 * overlay. Every change is applied to the main thread's config and mirrored
 * into the worker.
 */
export async function setupDebug(
  send: (m: ToWorker) => void,
  getInfo: () => FrameInfo,
  getBrush: () => number,
  animals?: DebugAnimalsHandle,
) {
  const { default: GUI } = await import('lil-gui');
  const gui = new GUI({ title: 'beech tuning' });
  gui.close();
  const sections: Record<TunableSection, [string, number, number, number][]> = {
    WATER: [
      ['friction', 0, 0.1, 0.001],
      ['linearDamping', 0, 2, 0.01],
      ['maxFluxDepth', 0.3, 1.5, 0.05],
    ],
    WAVES: [
      ['calmFactor', 0, 1, 0.05],
      ['tideAmp', 0, 0.5, 0.01],
      ['farSpeed', 1, 8, 0.1],
    ],
    SAND: [
      ['reposeDry', 15, 60, 1],
      ['reposeDamp', 15, 75, 1],
      ['reposeSaturated', 5, 40, 1],
      ['slumpRate', 0, 1, 0.01],
      ['dryingTime', 2, 120, 1],
      ['capillaryHeight', 0, 1, 0.01],
    ],
    EROSION: [
      ['capacity', 0, 0.3, 0.005],
      ['dissolve', 0, 5, 0.05],
      ['deposit', 0, 5, 0.05],
      ['minSlope', 0, 0.2, 0.005],
      ['healingTime', 10, 1200, 10],
    ],
    BRUSH: [
      ['screenRadiusPx', 8, 64, 1],
      ['rateStart', 0, 1, 0.01],
      ['rateHeld', 0, 2, 0.01],
      ['holdRamp', 0.1, 4, 0.05],
      ['rimFraction', 0, 1, 0.01],
      ['rimOuter', 1.1, 3, 0.05],
    ],
  };
  for (const [name, keys] of Object.entries(sections) as [TunableSection, [string, number, number, number][]][]) {
    const folder = gui.addFolder(name);
    folder.close();
    const obj = (CONFIG as unknown as Record<string, Record<string, number>>)[name];
    for (const [key, min, max, step] of keys) {
      folder
        .add(obj, key, min, max, step)
        .onChange((v: number) => send({ type: 'tune', section: name, key, value: v }));
    }
  }

  if (animals) {
    const af = gui.addFolder('ANIMALS');
    af.add({ spawnCrab: () => animals.spawn() }, 'spawnCrab').name('Spawn sand crab');
    af.add({ spawnDolphin: () => animals.spawnDolphin() }, 'spawnDolphin').name('Spawn dolphin');
    af.add({ dropFood: () => animals.dropFood() }, 'dropFood').name('Drop beach snack');
    af.add({ despawn: () => animals.despawn() }, 'despawn').name('Despawn');
  }

  const hud = document.createElement('pre');
  hud.style.cssText =
    'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,monospace;' +
    'background:rgba(255,255,255,.7);color:#334;border-radius:6px;pointer-events:none;z-index:10';
  document.body.appendChild(hud);
  let frames = 0;
  let last = performance.now();
  let fps = 0;
  const tick = () => {
    frames++;
    const now = performance.now();
    if (now - last > 500) {
      fps = (frames * 1000) / (now - last);
      frames = 0;
      last = now;
      const i = getInfo();
      hud.textContent =
        `fps ${fps.toFixed(0)}  sim ${i.tickMs.toFixed(1)} ms\n` +
        `t ${i.t.toFixed(1)}s  sea ${i.eta.toFixed(2)} m  tide ${i.tide.toFixed(2)} m\n` +
        (i.stats ? `sand ${i.stats.totalSand.toFixed(2)} m³  water ${i.stats.totalWater.toFixed(1)} m³\n` : '') +
        `brush r ${getBrush().toFixed(2)} m  undo ${i.undoCount}/${i.redoCount}` +
        (animals ? `\nanimal ${animals.status()}` : '');
    }
    requestAnimationFrame(tick);
  };
  tick();
}
