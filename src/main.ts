import { Engine } from '@babylonjs/core/Engines/engine';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Scene } from '@babylonjs/core/scene';

import { GRID_TIERS, SIM_HZ, WAVES, type QualityTier } from './config';
import { CameraController } from './input/cameraController';
import { Gestures } from './input/gestures';
import { SandPicker } from './input/sandPicker';
import { paletteByName, type Palette } from './palette';
import { BeachRenderer, ORIGIN_X, ORIGIN_Z } from './render/beachRenderer';
import { Hud } from './ui/hud';
import type { BrushMode } from './sim/beachSim';
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
  const send = (m: ToWorker, transfer: Transferable[] = []) => {
    if (params.has('trace') && m.type !== 'return') console.log('send', JSON.stringify(m));
    worker.postMessage(m, transfer);
  };

  const ready = await new Promise<Extract<FromWorker, { type: 'ready' }>>((resolve) => {
    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      if (ev.data.type === 'ready') resolve(ev.data);
    };
    send({ type: 'init', grid, seed, flags: { waves: true, tide: true, erosion: true, healing: true, seep: true } });
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

  // ---------------------------------------------------------------- digging
  const brushMode: BrushMode = 'dig';
  let digging = false;
  let strokeOpen = false;
  let lastHit: { x: number; z: number } | null = null;
  let hover: { x: number; z: number } | null = null;
  let ringAlpha = 0;

  const pickAt = (sx: number, sy: number) => {
    const hit = picker.pick(cam.ray(sx, sy));
    return hit ? { x: hit.x, z: hit.z } : null;
  };
  const toSim = (p: { x: number; z: number }) => ({ x: p.x - ORIGIN_X, y: p.z - ORIGIN_Z });

  const strokeTo = (sx: number, sy: number) => {
    const hit = pickAt(sx, sy);
    if (!hit) return;
    lastHit = hit;
    const r = cam.brushRadius();
    const s = toSim(hit);
    send({ type: 'brush', phase: strokeOpen ? 'move' : 'start', x: s.x, y: s.y, r, mode: brushMode });
    strokeOpen = true;
  };

  const hud = new Hud(document.getElementById('ui')!, {
    undo: () => send({ type: 'undo' }),
    redo: () => send({ type: 'redo' }),
  });

  // calm waves toggle
  let calm = false;
  const calmBtn = hud.button('wave', 'Calm the waves');
  hud.leftGroup.appendChild(calmBtn);
  calmBtn.addEventListener('click', () => {
    calm = !calm;
    calmBtn.classList.toggle('active', calm);
    hud.setIcon(calmBtn, calm ? 'calm' : 'wave');
    calmBtn.setAttribute('aria-label', calm ? 'Let the waves back in' : 'Calm the waves');
    calmBtn.title = calmBtn.getAttribute('aria-label')!;
    send({ type: 'flags', flags: { calm } });
  });

  const gestures = new Gestures(canvas, cam, {
    digStart: (sx, sy) => {
      digging = true;
      strokeOpen = false;
      hover = null;
      strokeTo(sx, sy);
    },
    digMove: (sx, sy) => {
      if (digging) strokeTo(sx, sy);
    },
    digEnd: () => {
      if (strokeOpen) send({ type: 'brush', phase: 'end' });
      digging = false;
      strokeOpen = false;
    },
    digCancel: () => {
      if (strokeOpen) send({ type: 'brush', phase: 'cancel' });
      digging = false;
      strokeOpen = false;
    },
    hover: (sx, sy) => {
      hover = pickAt(sx, sy);
    },
    hoverEnd: () => {
      hover = null;
    },
    undo: () => send({ type: 'undo' }),
    redo: () => send({ type: 'redo' }),
    interacted: () => {},
  });

  /** Brush ring: under the finger while digging, under the mouse on hover, centre after a zoom. */
  const updateRing = (dt: number) => {
    let target = 0;
    let at: { x: number; z: number } | null = null;
    if (digging && lastHit) {
      target = 0.85;
      at = lastHit;
    } else if (hover) {
      target = 0.6;
      at = hover;
    } else if (cam.zoomHint > 0) {
      at = pickAt(canvas.clientWidth / 2, canvas.clientHeight / 2);
      target = at ? Math.min(1, cam.zoomHint * 1.5) * 0.8 : 0;
    }
    ringAlpha += (target - ringAlpha) * Math.min(1, dt * 14);
    if (at) lastRing = at;
    renderer.setBrush(lastRing.x, lastRing.z, cam.brushRadius(), ringAlpha, palette.foam);
  };
  let lastRing = { x: 0, z: 0 };

  const palette: Palette = paletteByName(params.get('palette') ?? 'day');
  let last = performance.now();
  const start = last;

  engine.runRenderLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    cam.update(dt, gestures.cameraActive);
    updateRing(dt);
    hud.setUndoState(info.undoCount, info.redoCount);
    const mix = Math.min(1, (now - frameAt) / (1000 / SIM_HZ));
    renderer.setFrameMix(mix);
    const simTime = prevT + (info.t - prevT) * mix;
    const amp = 1 - (1 - WAVES.calmFactor) * info.calmMix;
    renderer.update(palette, cam.forward(), (now - start) / 1000, simTime, info.tide, amp);
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
    rest: ready.rest,
    grid,
    tier,
    origin: { x: ORIGIN_X, z: ORIGIN_Z },
    info: () => ({ ...info, buf: undefined }),
    send,
    frames: () => frames,
  };
  if (params.has('debug')) {
    const { setupDebug } = await import('./ui/debug');
    await setupDebug(send, () => info, () => cam.brushRadius());
  }
  document.body.dataset.ready = '1';
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p style="font-family:sans-serif;padding:2em;color:#6b5a6e">Sorry — this device couldn't start the beach (${String(
    err?.message ?? err,
  )}).</p>`;
});
