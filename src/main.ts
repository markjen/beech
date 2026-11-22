import { Engine } from '@babylonjs/core/Engines/engine';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Scene } from '@babylonjs/core/scene';

import { GRID_TIERS, SIM_HZ, WAVES, type QualityTier } from './config';
import { CameraController } from './input/cameraController';
import { Gestures } from './input/gestures';
import { SandPicker } from './input/sandPicker';
import { paletteByName, type Palette } from './palette';
import { BeachRenderer, ORIGIN_X, ORIGIN_Z } from './render/beachRenderer';
import { Sky } from './render/sky';
import type { FrameInfo, FromWorker, ToWorker } from './sim/protocol';
import { makeSwell } from './sim/waves';

const params = new URLSearchParams(location.search);

function chooseTier(): QualityTier {
  const q = params.get('quality');
  if (q === 'low' || q === 'medium' || q === 'high') return q;
  const cores = navigator.hardwareConcurrency || 4;
  if (cores <= 4) return 'low';
  return 'medium';
}

async function boot() {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const engine = new Engine(canvas, true, {
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.97, 0.92, 0.85, 1);
  scene.skipPointerMovePicking = true;
  scene.skipFrustumClipping = true;

  const tier = chooseTier();
  const grid = GRID_TIERS[tier];
  const seed = Number(params.get('seed') ?? 1) || 1;

  const worker = new Worker(new URL('./sim/sim.worker.ts', import.meta.url), { type: 'module' });
  const send = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);

  const ready = await new Promise<Extract<FromWorker, { type: 'ready' }>>((resolve) => {
    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      if (ev.data.type === 'ready') resolve(ev.data);
    };
    send({ type: 'init', grid, seed, flags: { waves: false, erosion: false, healing: false, seep: false } });
  });

  const swell = makeSwell(seed);
  const renderer = new BeachRenderer(scene, grid, ready.rest, swell);
  const sky = new Sky(scene);
  const picker = new SandPicker(grid, ready.rest);
  const cam = new CameraController(scene, canvas, grid.dx);

  let info: FrameInfo = {
    t: 0,
    eta: 0,
    tide: 0,
    calmMix: 0,
    undoCount: 0,
    redoCount: 0,
    digIntensity: 0,
    tickMs: 0,
  };
  let prevT = 0;
  let frameAt = performance.now();
  let frames = 0;

  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    if (m.type !== 'frame') return;
    renderer.uploadFrame(m.buf);
    picker.updateFromFrame(m.buf);
    send({ type: 'return', buf: m.buf }, [m.buf.buffer]);
    prevT = frames === 0 ? m.t : info.t;
    info = m;
    frameAt = performance.now();
    frames++;
  };

  new Gestures(canvas, cam, {
    digStart: () => {},
    digMove: () => {},
    digEnd: () => {},
    digCancel: () => {},
    hover: () => {},
    hoverEnd: () => {},
    undo: () => {},
    redo: () => {},
    interacted: () => {},
  });

  const palette: Palette = paletteByName(params.get('palette') ?? 'day');
  let last = performance.now();
  const start = last;

  engine.runRenderLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    cam.update(dt, false);
    const mix = Math.min(1, (now - frameAt) / (1000 / SIM_HZ));
    renderer.setFrameMix(mix);
    const simTime = prevT + (info.t - prevT) * mix;
    const amp = 1 - (1 - WAVES.calmFactor) * info.calmMix;
    renderer.update(palette, cam.forward(), (now - start) / 1000, simTime, info.tide, 0 * amp);
    sky.update(palette);
    scene.render();
  });

  const onResize = () => {
    engine.resize();
    cam.onResize();
  };
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => {
    send({ type: 'pause', paused: document.hidden });
  });

  // handle for automated tests and debugging
  (window as unknown as Record<string, unknown>).__beech = {
    engine,
    scene,
    cam,
    picker,
    grid,
    tier,
    origin: { x: ORIGIN_X, z: ORIGIN_Z },
    info: () => info,
    frames: () => frames,
  };
  document.body.dataset.ready = '1';
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p style="font-family:sans-serif;padding:2em;color:#6b5a6e">Sorry — this device couldn't start the beach (${String(
    err?.message ?? err,
  )}).</p>`;
});
