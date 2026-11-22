import { Engine } from '@babylonjs/core/Engines/engine';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';

import { Ambience } from './audio/ambience';
import { GRID_TIERS, SIM_HZ, WAVES, type QualityTier } from './config';
import { CameraController } from './input/cameraController';
import { Gestures } from './input/gestures';
import { SandPicker } from './input/sandPicker';
import { rgbToCss, type Palette } from './palette';
import { Haptics } from './platform/haptics';
import { registerServiceWorker } from './platform/pwa';
import { tierFromBench } from './platform/quality';
import { BeachRenderer, ORIGIN_X, ORIGIN_Z } from './render/beachRenderer';
import { ShellField } from './render/shells';
import { Sky, type SkyDisc } from './render/sky';
import { LiveConditions } from './world/live';
import { BEACHES, beachById, defaultBeach, nearestBeach, type Beach } from './world/locations';
import type { BrushMode } from './sim/beachSim';
import type { FrameInfo, FromWorker, ToWorker } from './sim/protocol';
import { makeSwell } from './sim/waves';
import { Hud } from './ui/hud';
import { SettingsSheet, StartScreen, showHint } from './ui/overlays';
import { loadSettings, saveSettings, type Settings } from './ui/settingsStore';

const params = new URLSearchParams(location.search);
/**
 * The clock is the real one. For testing: ?time=2026-11-22T06:30:00Z starts
 * from another moment and ?speed=60 runs it faster (time-lapse).
 */
const clockStart = Date.parse(params.get('time') ?? '') || Date.now();
const clockSpeed = Number(params.get('speed') ?? 1) || 1;
const perfStart = performance.now();
const clockNow = () => new Date(clockStart + (performance.now() - perfStart) * clockSpeed);

function benchmark(worker: Worker): Promise<number> {
  return new Promise((resolve) => {
    const prev = worker.onmessage;
    const timer = window.setTimeout(() => resolve(10), 4000);
    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      if (ev.data.type !== 'bench') return;
      window.clearTimeout(timer);
      worker.onmessage = prev;
      resolve(ev.data.msPerTickLow);
    };
    worker.postMessage({ type: 'bench' } satisfies ToWorker);
  });
}

async function chooseTier(s: Settings, worker: Worker): Promise<{ tier: QualityTier; settings: Settings }> {
  const q = params.get('quality');
  if (q === 'low' || q === 'medium' || q === 'high') return { tier: q, settings: s };
  if (s.quality !== 'auto') return { tier: s.quality, settings: s };
  if (s.benchTier) return { tier: s.benchTier, settings: s };
  const ms = await benchmark(worker);
  const tier = tierFromBench(ms, isTouch);
  const next = { ...s, benchTier: tier };
  saveSettings(next);
  return { tier, settings: next };
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
  // render scale: start at the device's pixel ratio (max 2) and back off if
  // frames get slow (dynamic resolution keeps phones smooth and cool)
  const maxScale = Math.min(window.devicePixelRatio || 1, 2);
  let renderScale = maxScale;
  engine.setHardwareScalingLevel(1 / renderScale);

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.97, 0.92, 0.85, 1);
  scene.skipPointerMovePicking = true;
  scene.skipFrustumClipping = true;

  const worker = new Worker(new URL('./sim/sim.worker.ts', import.meta.url), { type: 'module' });
  const send = (m: ToWorker, transfer: Transferable[] = []) => {
    if (params.has('trace') && m.type !== 'return') console.log('send', JSON.stringify(m));
    worker.postMessage(m, transfer);
  };

  const chosen = await chooseTier(settings, worker);
  settings = chosen.settings;
  const tier = chosen.tier;
  const grid = GRID_TIERS[tier];
  const seed = Number(params.get('seed') ?? 1) || 1;

  const ready = await new Promise<Extract<FromWorker, { type: 'ready' }>>((resolve) => {
    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      if (ev.data.type === 'ready') resolve(ev.data);
    };
    send({ type: 'init', grid, seed, flags: { waves: true, tide: true, erosion: true, healing: true, seep: true } });
  });

  const swell = makeSwell(seed);
  const renderer = new BeachRenderer(scene, grid, ready.rest, swell);

  // ---------------------------------------------------------------- the real beach
  let beach: Beach = beachById(params.get('beach')) ?? beachById(settings.beach) ?? defaultBeach();
  const live = new LiveConditions(beach);
  let liveState = live.compute(clockNow());
  const sendSea = () => send({ type: 'sea', tide: liveState.simTide, waves: beach.waves });
  sendSea();
  const sky = new Sky(scene);
  const picker = new SandPicker(grid, ready.rest);
  const cam = new CameraController(scene, canvas, grid.dx);
  const shells = new ShellField(scene, renderer, picker);
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
  let brushMode: BrushMode = 'dig';
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

  const setBeach = (b: Beach) => {
    beach = b;
    live.setBeach(b);
    liveState = live.compute(clockNow());
    sendSea();
    settings = { ...settings, beach: b.id };
    saveSettings(settings);
    sheet.setSettings(settings);
    updatePlace(true);
  };
  const sheet = new SettingsSheet(uiRoot, settings, {
    nearMe: () => {
      if (!('geolocation' in navigator)) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => setBeach(nearestBeach(pos.coords.latitude, pos.coords.longitude)),
        () => {
          /* denied or unavailable: keep the current beach */
        },
        { maximumAge: 3600000, timeout: 10000 },
      );
    },
    change: (s, key) => {
      if (key === 'beach') {
        const b = beachById(s.beach);
        if (b) setBeach(b);
        return;
      }
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
  }, BEACHES);
  sheet.setSettings({ ...settings, beach: beach.id });

  // place + time + tide, top left; tapping it opens the beach picker
  const place = document.createElement('button');
  place.type = 'button';
  place.className = 'place';
  place.setAttribute('aria-label', 'Choose a beach');
  uiRoot.appendChild(place);
  place.addEventListener('click', () => sheet.show());
  let placeText = '';
  let placeAt = 0;
  const updatePlace = (force = false) => {
    const t = performance.now();
    if (!force && t - placeAt < 1000) return;
    placeAt = t;
    const text = `<b>${beach.name}, ${beach.place}</b><span>${live.describe(liveState)}</span>`;
    if (text !== placeText) {
      placeText = text;
      place.innerHTML = text;
    }
  };
  updatePlace(true);
  const TOOLS: { id: BrushMode; icon: 'dig' | 'build' | 'smooth'; label: string }[] = [
    { id: 'dig', icon: 'dig', label: 'Dig' },
    { id: 'pile', icon: 'build', label: 'Build up sand' },
    { id: 'smooth', icon: 'smooth', label: 'Smooth' },
  ];
  const pickTool = (id: string) => {
    brushMode = id as BrushMode;
    hud.setTool(id);
    haptics.impact('light');
  };
  hud.setTools(TOOLS, brushMode, pickTool);

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
    tool: (i) => TOOLS[i] && pickTool(TOOLS[i].id),
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
  let seaSentAt = 0;
  /** where a sky object sits on the backdrop, seen from the current camera */
  const skyDisc = (dir: [number, number, number], elevation: number): SkyDisc | undefined => {
    if (elevation < -3) return undefined;
    const f = cam.forward();
    const fh = Math.hypot(f.x, f.z) || 1;
    const fx = f.x / fh;
    const fz = f.z / fh;
    const h = Math.hypot(dir[0], dir[2]) || 1;
    const vx = dir[0] / h;
    const vz = dir[2] / h;
    const front = vx * fx + vz * fz;
    // screen right of a camera looking along (fx, fz) is (fz, -fx) in this left-handed scene
    const side = vx * fz - vz * fx;
    const e = Math.max(0, elevation) * (Math.PI / 180);
    const alpha = Math.min(1, Math.max(0, (front + 0.1) / 0.4)) * Math.min(1, Math.max(0, (elevation + 3) / 5));
    if (alpha <= 0) return undefined;
    return { x: 0.5 + side * 0.48, y: 0.24 - Math.sin(e) * 0.2, alpha };
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
  let slowTime = 0;
  let fastTime = 0;
  const adaptResolution = (dt: number) => {
    const budget = settings.batterySaver ? 1 / 24 : 1 / 45;
    if (dt > budget) {
      slowTime += dt;
      fastTime = 0;
    } else if (dt < budget * 0.7) {
      fastTime += dt;
      slowTime = Math.max(0, slowTime - dt * 0.5);
    }
    if (slowTime > 2 && renderScale > 0.75) {
      renderScale = Math.max(0.75, renderScale - 0.25);
      engine.setHardwareScalingLevel(1 / renderScale);
      slowTime = 0;
    } else if (fastTime > 8 && renderScale < maxScale) {
      renderScale = Math.min(maxScale, renderScale + 0.25);
      engine.setHardwareScalingLevel(1 / renderScale);
      fastTime = 0;
    }
  };

  engine.runRenderLoop(() => {
    const now = performance.now();
    if (settings.batterySaver) {
      skip = !skip;
      if (skip) return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const now0 = clockNow();
    const fixed = fixedPalette ?? (settings.palette !== 'live' ? settings.palette : undefined);
    liveState = live.compute(now0, fixed);
    if (now - seaSentAt > 2000) {
      seaSentAt = now;
      sendSea();
    }
    updatePlace();
    if (!document.hidden && !params.has('fixedres')) adaptResolution(dt);

    const palette = liveState.palette;
    cam.update(dt, gestures.cameraActive);
    updateRing(dt, palette);
    hud.setUndoState(info.undoCount, info.redoCount);
    applyUiColors(palette);

    const mix = Math.min(1, (now - frameAt) / (1000 / SIM_HZ));
    renderer.setFrameMix(mix);
    const simTime = prevT + (info.t - prevT) * mix;
    const amp = (1 - (1 - WAVES.calmFactor) * info.calmMix) * beach.waves;
    renderer.update(palette, cam.forward(), (now - t0) / 1000, simTime, info.tide, amp);
    const sk = liveState.sky;
    const moonDisc = skyDisc(sk.moon.dir, sk.moon.elevation);
    sky.update(
      palette,
      {
        sun: fixed ? undefined : skyDisc(sk.sun.dir, sk.sun.elevation),
        moon: fixed || !moonDisc ? undefined : { ...moonDisc, alpha: moonDisc.alpha * (0.35 + 0.65 * sk.night), phase: sk.moon.phase, fraction: sk.moon.fraction },
        stars: fixed ? (fixed === 'night' ? 1 : 0) : sk.night,
      },
      cam.aspect(),
    );
    clear.set(palette.fog[0], palette.fog[1], palette.fog[2], 1);
    scene.clearColor = clear;

    shells.update(dt, swashRate);
    if (digging) haptics.dig(info.digIntensity);
    cam.camera.getDirectionToRef(Vector3.Right(), right);
    const lim = cam.zoomLimits();
    audio.update(dt, {
      swashRate,
      dig: digging ? info.digIntensity : 0,
      seaPan: -right.z,
      zoomOut: (cam.halfH - lim.min) / Math.max(1e-3, lim.max - lim.min),
      calm: info.calmMix,
      daylight: 1 - liveState.sky.night,
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
    renderScale: () => renderScale,
    origin: { x: ORIGIN_X, z: ORIGIN_Z },
    info: () => ({ ...info, buf: undefined, swashRate }),
    frames: () => frames,
    send,
    sheet,
    audio,
    pickTool,
    shells,
    beach: () => beach,
    live: () => ({ ...liveState, palette: undefined }),
    setBeach: (id: string) => {
      const b = beachById(id);
      if (b) setBeach(b);
    },
  };

  if (params.has('debug')) {
    const { setupDebug } = await import('./ui/debug');
    await setupDebug(send, () => info, () => cam.brushRadius());
  }
  document.body.dataset.ready = '1';
}

registerServiceWorker();

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p style="font-family:sans-serif;padding:2em;color:#6b5a6e">Sorry — this device couldn't start the beach (${String(
    err?.message ?? err,
  )}).</p>`;
});
