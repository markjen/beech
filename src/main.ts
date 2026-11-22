import { Engine } from '@babylonjs/core/Engines/engine';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';

import { Ambience } from './audio/ambience';
import { GRID_TIERS, SIM_HZ, WAVES, type QualityTier } from './config';
import { CameraController } from './input/cameraController';
import { Gestures } from './input/gestures';
import { SandPicker } from './input/sandPicker';
import { paletteAtPhase, paletteByName, rgbToCss, type Palette } from './palette';
import { Haptics } from './platform/haptics';
import { BeachRenderer, ORIGIN_X, ORIGIN_Z } from './render/beachRenderer';
import { Sky } from './render/sky';
import type { BrushMode } from './sim/beachSim';
import type { FrameInfo, FromWorker, ToWorker } from './sim/protocol';
import { makeSwell } from './sim/waves';
import { Hud } from './ui/hud';
import { SettingsSheet, StartScreen, showHint } from './ui/overlays';
import { loadSettings, saveSettings, type Settings } from './ui/settingsStore';

const params = new URLSearchParams(location.search);
/** One full dawn -> day -> golden -> dusk drift, in seconds. */
const DAY_CYCLE_SECONDS = 20 * 60;

function autoTier(): QualityTier {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  if (cores <= 4 || mem <= 2) return 'low';
  return 'medium';
}

function chooseTier(s: Settings): QualityTier {
  const q = params.get('quality');
  if (q === 'low' || q === 'medium' || q === 'high') return q;
  if (s.quality !== 'auto') return s.quality;
  return autoTier();
}

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

async function boot() {
  let settings = loadSettings();
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui')!;
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

  const tier = chooseTier(settings);
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
  const audio = new Ambience();
  const haptics = new Haptics();
  haptics.enabled = settings.haptics;
  audio.setSound(settings.sound);
  audio.setMusic(settings.music);

  // ---------------------------------------------------------------- sim frames
  let info: FrameInfo = {
    t: 0,
    eta: 0,
    tide: 0,
    calmMix: 0,
    undoCount: 0,
    redoCount: 0,
    digIntensity: 0,
    swash: 0,
    tickMs: 0,
  };
  let prevT = 0;
  let frameAt = performance.now();
  let frames = 0;
  let swashRate = 0;

  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    if (m.type !== 'frame') return;
    renderer.uploadFrame(m.buf);
    picker.updateFromFrame(m.buf);
    send({ type: 'return', buf: m.buf }, [m.buf.buffer]);
    const dtSim = m.t - info.t;
    if (frames > 0 && dtSim > 0) swashRate += ((m.swash - info.swash) / dtSim - swashRate) * 0.3;
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
  let lastRing = { x: 0, z: 0 };

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

  const undo = () => {
    send({ type: 'undo' });
    audio.whoosh(true);
    haptics.impact('medium');
  };
  const redo = () => {
    send({ type: 'redo' });
    audio.whoosh(false);
    haptics.impact('medium');
  };

  // ---------------------------------------------------------------- UI
  const vignette = document.createElement('div');
  vignette.className = 'vignette';
  uiRoot.appendChild(vignette);

  const hud = new Hud(uiRoot, { undo, redo });

  let calm = false;
  const calmBtn = hud.button('wave', 'Calm the waves');
  calmBtn.addEventListener('click', () => {
    calm = !calm;
    calmBtn.classList.toggle('active', calm);
    hud.setIcon(calmBtn, calm ? 'calm' : 'wave');
    calmBtn.setAttribute('aria-label', calm ? 'Let the waves back in' : 'Calm the waves');
    calmBtn.title = calmBtn.getAttribute('aria-label')!;
    send({ type: 'flags', flags: { calm } });
    haptics.impact('light');
  });

  const share = async () => {
    scene.render();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return;
    const file = new File([blob], 'beech.png', { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: 'beech' });
        return;
      } catch {
        /* cancelled: fall through to download */
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'beech.png';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const sheet = new SettingsSheet(uiRoot, settings, {
    change: (s, key) => {
      settings = s;
      saveSettings(settings);
      if (key === 'sound') audio.setSound(s.sound);
      if (key === 'music') audio.setMusic(s.music);
      if (key === 'haptics') haptics.enabled = s.haptics;
    },
    smooth: () => {
      send({ type: 'reset' });
      audio.whoosh(false);
    },
    share: () => void share(),
  });
  const menuBtn = hud.button('menu', 'Settings');
  menuBtn.addEventListener('click', () => sheet.toggleOpen());
  hud.leftGroup.appendChild(menuBtn);
  hud.leftGroup.appendChild(calmBtn);

  let hideHint: (() => void) | null = null;
  const begin = () => {
    audio.start();
    if (!settings.seenIntro || params.has('hint')) {
      hideHint = showHint(uiRoot, isTouch);
      settings = { ...settings, seenIntro: true };
      saveSettings(settings);
    }
  };
  const skipIntro = params.has('smoke') || params.has('nointro');
  const start = skipIntro ? null : new StartScreen(uiRoot, begin, isTouch);

  const gestures = new Gestures(canvas, cam, {
    digStart: (sx, sy) => {
      digging = true;
      strokeOpen = false;
      hover = null;
      hideHint?.();
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
    undo,
    redo,
    interacted: () => {
      // any input (including when there is no start screen) unlocks audio
      if (!start?.visible) audio.start();
    },
  });

  /** Brush ring: under the finger while digging, under the mouse on hover, centre after a zoom. */
  const updateRing = (dt: number, palette: Palette) => {
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

  // ---------------------------------------------------------------- palette / day cycle
  const fixedPalette = params.get('palette');
  let dayPhase = 0.27; // start in full daylight
  const currentPalette = (): Palette => {
    if (fixedPalette) return paletteByName(fixedPalette);
    if (settings.palette !== 'cycle') return paletteByName(settings.palette);
    return paletteAtPhase(dayPhase);
  };
  const clear = new Color4(0, 0, 0, 1);
  const applyUiColors = (p: Palette) => {
    const lum = 0.3 * p.ui[0] + 0.59 * p.ui[1] + 0.11 * p.ui[2];
    const bg = lum > 0.6 ? 'rgba(46, 40, 78, 0.55)' : 'rgba(255, 250, 244, 0.72)';
    hud.setColors(rgbToCss(p.ui), bg);
  };

  // ---------------------------------------------------------------- main loop
  let last = performance.now();
  const t0 = last;
  let skip = false;
  const right = new Vector3();

  engine.runRenderLoop(() => {
    const now = performance.now();
    if (settings.batterySaver) {
      skip = !skip;
      if (skip) return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    dayPhase += dt / DAY_CYCLE_SECONDS;

    const palette = currentPalette();
    cam.update(dt, gestures.cameraActive);
    updateRing(dt, palette);
    hud.setUndoState(info.undoCount, info.redoCount);
    applyUiColors(palette);

    const mix = Math.min(1, (now - frameAt) / (1000 / SIM_HZ));
    renderer.setFrameMix(mix);
    const simTime = prevT + (info.t - prevT) * mix;
    const amp = 1 - (1 - WAVES.calmFactor) * info.calmMix;
    renderer.update(palette, cam.forward(), (now - t0) / 1000, simTime, info.tide, amp);
    sky.update(palette);
    clear.set(palette.fog[0], palette.fog[1], palette.fog[2], 1);
    scene.clearColor = clear;

    if (digging) haptics.dig(info.digIntensity);
    cam.camera.getDirectionToRef(Vector3.Right(), right);
    const lim = cam.zoomLimits();
    audio.update(dt, {
      swashRate,
      dig: digging ? info.digIntensity : 0,
      seaPan: -right.z,
      zoomOut: (cam.halfH - lim.min) / Math.max(1e-3, lim.max - lim.min),
      calm: info.calmMix,
    });

    scene.render();
  });

  const onResize = () => {
    engine.resize();
    cam.onResize();
  };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => {
    send({ type: 'pause', paused: document.hidden });
    audio.suspend(document.hidden);
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
    frames: () => frames,
    send,
    sheet,
    audio,
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
