import { Engine } from '@babylonjs/core/Engines/engine';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';

import { Ambience } from './audio/ambience';
import { GRID_TIERS, SIM_HZ, WAVES, WORLD_SIZE_X, type QualityTier } from './config';
import { CameraController } from './input/cameraController';
import { Gestures } from './input/gestures';
import { SandPicker } from './input/sandPicker';
import { rgbToCss, type Palette } from './palette';
import { Haptics } from './platform/haptics';
import { registerServiceWorker } from './platform/pwa';
import { tierFromBench } from './platform/quality';
import { BeachRenderer, ORIGIN_X, ORIGIN_Z } from './render/beachRenderer';
import { ObjectView } from './render/objects';
import { Horizon } from './render/horizon';
import { Sky, type SkyDisc } from './render/sky';
import { LiveConditions } from './world/live';
import { BEACHES, beachById, defaultBeach, nearestBeach, type Beach } from './world/locations';
import type { BrushMode } from './sim/beachSim';
import type { PlacedObject } from './sim/objects';
import type { FrameInfo, FromWorker, ToWorker } from './sim/protocol';
import { makeSwell } from './sim/waves';
import { restHeight } from './sim/profile';
import { Ambient, toggleFullscreen } from './ui/ambient';
import { Hud } from './ui/hud';
import { SettingsSheet, StartScreen, showHint } from './ui/overlays';
import { InventoryTray, PlaceBar } from './ui/inventory';
import { ClawMachine } from './ui/clawMachine';
import { DEFAULT_SIZE, ITEMS, rollPlacement, type Item } from './world/items';
import { WOOD_RADIUS } from './sim/objects';
import { ACCOUNTS_ENABLED, Account, PullApi } from './net/account';
import { BeachSync } from './net/beachSync';
import { AccountPanel } from './ui/accountPanel';
import { NEIGHBOR_OFFSET, NeighborView } from './render/neighbors';
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
  // set up with the account layer (production builds)
  let neighbors: NeighborView | null = null;
  let clawMachine: ClawMachine | null = null;
  // your sand, else a neighbor's, else the untouched shore (the chair can walk along all of it)
  cam.groundHeight = (x, z) => {
    const h = picker.heightAt(x, z);
    if (Number.isFinite(h)) return h;
    const n = neighbors?.heightAtWorld(x, z) ?? NaN;
    return Number.isFinite(n) ? n : restHeight(x + WORLD_SIZE_X / 2, z - ORIGIN_Z, seed);
  };
  const horizon = new Horizon(scene, swell, seed, grid.dx);
  const objectView = new ObjectView(scene, renderer);
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
    objects: [],
    tickMs: 0,
  };
  let prevT = 0;
  let frameAt = performance.now();
  let frames = 0;
  let swashRate = 0;

  type SandReply = { delta: Float32Array; objects: PlacedObject[] };
  const sandWaiters = new Map<number, (d: SandReply) => void>();
  let sandReq = 0;
  const getSand = () =>
    new Promise<SandReply>((resolve) => {
      const id = ++sandReq;
      sandWaiters.set(id, resolve);
      send({ type: 'getSand', id });
    });

  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    if (m.type === 'sand') {
      sandWaiters.get(m.id)?.({ delta: m.delta, objects: m.objects });
      sandWaiters.delete(m.id);
      return;
    }
    if (m.type !== 'frame') return;
    renderer.uploadFrame(m.buf);
    objectView.set(m.objects);
    // how many of each item you've put down (prizes can only go down as often as you own them)
    const placed = new Map<string, number>();
    for (const o of m.objects) if (!o.wild) placed.set(o.item, (placed.get(o.item) ?? 0) + 1);
    inventory.setPlaced(placed);
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
  /** an inventory item in hand: taps set it down instead of digging */
  let placing: Item | null = null;
  let digging = false;
  let strokeOpen = false;
  type Hit = { x: number; y: number; z: number };
  let lastHit: Hit | null = null;
  let hover: Hit | null = null;
  let ringAlpha = 0;
  let lastRing: Hit = { x: 0, y: 0, z: 0 };

  const pickAt = (sx: number, sy: number): Hit | null => picker.pick(cam.ray(sx, sy));
  const toSim = (p: { x: number; z: number }) => ({ x: p.x - ORIGIN_X, y: p.z - ORIGIN_Z });

  const strokeTo = (sx: number, sy: number) => {
    const hit = pickAt(sx, sy);
    if (!hit) return;
    lastHit = hit;
    const r = cam.brushRadius(hit);
    const s = toSim(hit);
    send({ type: 'brush', phase: strokeOpen ? 'move' : 'start', x: s.x, y: s.y, r, mode: brushMode });
    strokeOpen = true;
  };

  // set up below once the account layer exists (sandbox builds never save)
  let markDirty: (delayMs?: number) => void = () => {};

  const undo = () => {
    markDirty();
    send({ type: 'undo' });
    audio.whoosh(true);
    haptics.impact('medium');
  };
  const redo = () => {
    markDirty();
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
    if (b.id !== beach.id) markDirty(1500);
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
      if (key === 'ambient') ambient.setEnabled(s.ambient);
    },
    smooth: () => {
      markDirty(1500);
      send({ type: 'reset' });
      audio.whoosh(false);
    },
    share: () => void share(),
    fullscreen: () => void toggleFullscreen(),
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
    placing = null;
    inventory.deselect();
    placeBar.show(null, DEFAULT_SIZE);
    hud.setTool(id);
    haptics.impact('light');
  };
  hud.setTools(TOOLS, brushMode, pickTool);

  // the bag: rocks and driftwood (free, unlimited) for now
  const inventory = new InventoryTray((n, l, c) => hud.button(n, l, c), hud.root, ITEMS, (item) => {
    placing = item;
    hud.setTool(item ? 'place' : brushMode);
    placeBar.show(item, DEFAULT_SIZE);
    haptics.impact('light');
  });
  const sizeOf = (id: string) => settings.itemSizes?.[id] ?? DEFAULT_SIZE;
  const placeBar = new PlaceBar(
    hud.root,
    () => settings.itemSizes ?? {},
    (id, v) => {
      settings = { ...settings, itemSizes: { ...settings.itemSizes, [id]: v } };
      saveSettings(settings);
    },
    () => pickTool(brushMode),
  );
  hud.toolGroup.prepend(inventory.button);

  /** Tap with an item in hand: pick up what's there, or set the item down. */
  const putDown = (sx: number, sy: number) => {
    if (!placing) return;
    const hit = pickAt(sx, sy);
    if (!hit) return;
    const p = toSim(hit);
    // something already there? pick it back up
    let near: { id: number; d: number } | null = null;
    for (const o of info.objects) {
      const reach = o.kind === 'driftwood' ? Math.max(WOOD_RADIUS(o.size) * 3, 0.25) : Math.max(o.size * 1.5, 0.25);
      // driftwood: distance to the log's centre line
      let d: number;
      if (o.kind === 'driftwood') {
        const ca = Math.cos(o.angle);
        const sa = Math.sin(o.angle);
        const along = Math.max(-o.size / 2, Math.min(o.size / 2, (p.x - o.x) * ca + (p.y - o.y) * sa));
        d = Math.hypot(p.x - (o.x + ca * along), p.y - (o.y + sa * along));
      } else {
        d = Math.hypot(p.x - o.x, p.y - o.y);
      }
      if (d < reach && (!near || d < near.d)) near = { id: o.id, d };
    }
    if (near) {
      send({ type: 'removeObject', id: near.id });
      audio.whoosh(true);
      haptics.impact('light');
    } else if (!inventory.canPlace(placing.id)) {
      // all of them are already on the beach
      haptics.impact('light');
      return;
    } else {
      const r = rollPlacement(placing, sizeOf(placing.id));
      send({ type: 'placeObject', obj: { kind: placing.kind, item: placing.id, x: p.x, y: p.y, ...r } });
      if (placing.kind === 'rock' || placing.kind === 'driftwood') audio.thunk(placing.kind === 'rock');
      haptics.impact(placing.kind === 'rock' ? 'medium' : 'light');
    }
    markDirty();
  };

  const menuBtn = hud.button('menu', 'Settings');
  menuBtn.addEventListener('click', () => sheet.toggleOpen());
  hud.leftGroup.appendChild(menuBtn);
  hud.leftGroup.appendChild(calmBtn);

  // ambient / TV: controls fade when idle, screen stays awake.
  // ?tv=1 starts there, sitting on the beach.
  const tv = params.has('tv');
  const ambient = new Ambient();
  ambient.setEnabled(settings.ambient || tv);

  // diorama <-> chair (sitting on the sand, looking out to sea)
  const viewBtn = hud.button('chair', 'Sit on the beach');
  hud.leftGroup.appendChild(viewBtn);
  viewBtn.addEventListener('click', () => cam.toggleMode());
  // chair: hold ‹ or › to walk the chair along the beach (and over to the neighbors)
  const walkGroup = document.createElement('div');
  walkGroup.className = 'hud-walk';
  for (const [dir, icon, label] of [[-1, 'left', 'Walk left'], [1, 'right', 'Walk right']] as const) {
    const b = hud.button(icon, label);
    b.dataset.walk = String(dir);
    const stop = () => {
      if (cam.walk === dir) cam.walk = 0;
      b.classList.remove('pressed');
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cam.walk = dir;
      b.classList.add('pressed');
    });
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointerleave', stop);
    b.addEventListener('pointercancel', stop);
    walkGroup.appendChild(b);
  }
  hud.root.appendChild(walkGroup);
  cam.onModeChange((m) => {
    const chair = m === 'chair';
    renderer.setChairView(chair);
    neighbors?.setChairView(chair);
    horizon.setEnabled(chair);
    walkGroup.classList.toggle('shown', chair);
    hud.root.classList.toggle('chair', chair);
    hud.setIcon(viewBtn, chair ? 'diorama' : 'chair');
    viewBtn.setAttribute('aria-label', chair ? 'Back to the diorama' : 'Sit on the beach');
    viewBtn.title = viewBtn.getAttribute('aria-label')!;
    haptics.impact('light');
  });

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
      if (cam.animating) return;
      inventory.setOpen(false);
      if (placing) {
        hideHint?.();
        putDown(sx, sy);
        return;
      }
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
      if (strokeOpen) {
        send({ type: 'brush', phase: 'end' });
        markDirty();
      }
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
    view: () => cam.toggleMode(),
    interacted: () => {
      // any input (including when there is no start screen) unlocks audio
      if (!start?.visible) audio.start();
    },
  });

  /** Brush ring: under the finger while digging, under the mouse on hover, centre after a zoom. */
  const updateRing = (dt: number, palette: Palette) => {
    let target = 0;
    let at: Hit | null = null;
    if (placing) {
      target = 0;
    } else if (digging && lastHit) {
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
    renderer.setBrush(lastRing.x, lastRing.z, cam.brushRadius(lastRing), ringAlpha, palette.foam);
  };

  // ---------------------------------------------------------------- palette / day cycle
  const fixedPalette = params.get('palette');
  let seaSentAt = 0;
  /** where a sky object sits on the backdrop, seen from the current camera */
  const skyDisc = (dir: [number, number, number], elevation: number): SkyDisc | undefined => {
    if (elevation < -3) return undefined;
    if (cam.mode === 'chair') {
      // perspective: put it exactly where it is in the sky
      const p = cam.projectDirection(dir);
      if (!p.front) return undefined;
      return { x: p.x, y: p.y, alpha: Math.min(1, Math.max(0, (elevation + 3) / 5)) };
    }
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
    neighbors?.update(palette, cam.forward(), (now - t0) / 1000, simTime, info.tide, amp);
    if (cam.mode === 'chair') {
      // the static shore starts where the simulated beaches end
      const centres = [0];
      if (cam.maxX > WORLD_SIZE_X) centres.push(NEIGHBOR_OFFSET);
      if (cam.minX < -WORLD_SIZE_X) centres.push(-NEIGHBOR_OFFSET);
      horizon.setExtent(cam.minX + grid.dx * 0.5, cam.maxX - grid.dx * 0.5, centres);
      horizon.update(palette, cam.forward(), simTime, info.tide, amp);
    }
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

    objectView.update(dt);
    if (digging) haptics.dig(info.digIntensity);
    cam.camera.getDirectionToRef(Vector3.Right(), right);
    audio.update(dt, {
      swashRate,
      dig: digging ? info.digIntensity : 0,
      seaPan: -right.z,
      zoomOut: cam.zoomOut01(),
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
  // ---------------------------------------------------------------- accounts
  let account: Account | null = null;
  let sync: BeachSync | null = null;
  if (ACCOUNTS_ENABLED) {
    account = new Account();
    sync = new BeachSync(account, {
      getSand,
      setSand: (delta, objects) => send({ type: 'setSand', delta, objects }, [delta.buffer]),
      grid: { nx: grid.nx, ny: grid.ny },
      location: () => beach.id,
      setLocation: (id) => {
        const b = beachById(id);
        if (b && b.id !== beach.id) setBeach(b);
      },
    });
    const s = sync;
    markDirty = (delayMs?: number) => s.markDirty(delayMs);
    neighbors = new NeighborView(scene, grid, ready.rest, swell, cam, uiRoot, account);
    const nv = neighbors;
    // whenever someone new signs in (or a saved session comes back), bring
    // back their beach and their neighbors
    let signedInAs: string | null = null;
    account.onChange((u) => {
      if (u && u.id !== signedInAs) {
        void s.restoreOrCreate().catch(() => {});
        void nv.refresh();
      } else if (!u) {
        nv.clear();
      }
      signedInAs = u?.id ?? null;
    });
    new AccountPanel(sheet.accountSlot, account, s, () => {}, nv);

    // what you've won (and later bought), and the claw machine
    const acct = account;
    const loadOwned = async () => {
      if (!acct.user) return inventory.setOwned(new Map());
      try {
        const owned = new Map<string, number>();
        for (const it of await acct.inventory()) owned.set(it.item, (owned.get(it.item) ?? 0) + it.quantity);
        inventory.setOwned(owned);
      } catch {
        /* offline: keep what we had */
      }
    };
    const claw = new ClawMachine(uiRoot, new PullApi(acct), (item, place) => {
      void loadOwned().then(() => {
        if (place) inventory.select(item);
      });
    });
    clawMachine = claw;
    inventory.onClaw = () => (acct.user ? void claw.open() : sheet.show());
    inventory.setClaw(acct.user ? 'play' : 'signin');
    acct.onChange((u) => {
      inventory.setClaw(u ? 'play' : 'signin');
      void loadOwned();
    });
    void account.restore();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void sync?.flush(true);
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
    inventory,
    claw: () => clawMachine,
    objectView,
    audio,
    pickTool,
    view: (m?: 'diorama' | 'chair') => (m ? cam.setMode(m) : cam.toggleMode()),
    beach: () => beach,
    account: () => account,
    neighbors: () => neighbors,
    sync: () => sync,
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
  // start seated (TV / ?view=chair) once everything the view switch touches exists
  if (tv || params.get('view') === 'chair') cam.setMode('chair', false);
  document.body.dataset.ready = '1';
}

registerServiceWorker();

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p style="font-family:sans-serif;padding:2em;color:#6b5a6e">Sorry — this device couldn't start the beach (${String(
    err?.message ?? err,
  )}).</p>`;
});
