import { Engine } from '@babylonjs/core/Engines/engine';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';

import { Ambience } from './audio/ambience';
import { GRID_TIERS, SIM_HZ, WAVES, WORLD_SIZE_X, type QualityTier } from './config';
import { CameraController } from './input/cameraController';
import { Gestures, HOLD_SLOP_PX, LONG_PRESS_MS } from './input/gestures';
import { SandPicker } from './input/sandPicker';
import { rgbToCss, type Palette } from './palette';
import { Haptics } from './platform/haptics';
import { registerServiceWorker } from './platform/pwa';
import { tierFromBench } from './platform/quality';
import { BeachRenderer, ORIGIN_X, ORIGIN_Z } from './render/beachRenderer';
import type { AnimalView } from './render/animals';
import { ObjectView } from './render/objects';
import { Horizon } from './render/horizon';
import { Sky, type SkyDisc } from './render/sky';
import { AnimalController, type AnimalEnv, type AnimalObstacle } from './world/animals';
import { LiveConditions } from './world/live';
import { BEACHES, beachById, defaultBeach, nearestBeach, type Beach } from './world/locations';
import type { BrushMode, ClearingMode, SandMode } from './sim/beachSim';
import { isClearingMode, isSandMode } from './sim/beachSim';
import { DIG_FIND_ROLL_COOLDOWN_MS, qualifiesForFind } from './sim/digFinds';
import { POS_STRIDE, type ObjectState, type PlacedObject } from './sim/objects';
import type { FrameInfo, FromWorker, ToWorker } from './sim/protocol';
import { makeSwell } from './sim/waves';
import { MAX_OBJECTS, decodeSand, encodeSand, fitWorld, resampleField } from './sim/sandCodec';
import { restHeight } from './sim/profile';
import { Ambient, toggleFullscreen } from './ui/ambient';
import { Hud, type ToolDef } from './ui/hud';
import { SettingsSheet, StartScreen, showActionToast, showToast } from './ui/overlays';
import { CheckpointsSection } from './ui/checkpoints';
import { InventoryTray, PlaceBar } from './ui/inventory';
import { ClawMachine } from './ui/clawMachine';
import { DigFind } from './ui/digFind';
import { Shop } from './ui/shop';
import { ShopApi, webOrderFromUrl, withoutWebOrderParams } from './net/shop';
import { VendingMachine } from './ui/vendingMachine';
import { DEFAULT_SIZE, ITEMS, rollPlacement, type Item } from './world/items';
import { ACCOUNTS_ENABLED, Account, AnimalsApi, CheckpointApi, DigFindApi, GiftApi, PullApi } from './net/account';
import { beachShareText, shoreBeachUrl, SHORE_URL, visitCodeFromUrl, withoutVisitParam } from './net/share';
import { shareLink } from './ui/shareSheet';
import { BeachSync, countItems } from './net/beachSync';
import { AccountPanel } from './ui/accountPanel';
import { Leaderboard } from './ui/leaderboard';
import { NeighborView } from './render/neighbors';
import { loadSettings, saveSettings, type Settings } from './ui/settingsStore';
import { initTelemetry, reportError, reportEvent } from './net/telemetry';
import { loadLocalBeach, saveLocalBeach } from './net/localStore';
import { LocalCheckpointsSection } from './ui/localCheckpoints';
import { watchForNewVersion } from './platform/version';
import { isPackagedApp, isSteam, steamBridge } from './platform/runtime';
import { unlockSteamAchievement, updateSteamRichPresence } from './platform/steamFeatures';
import { schedulePetHungerReminder } from './platform/petNotify';
import { GamepadController } from './input/gamepad';
import { BeachFileDialog, beachFileName, pickFile, saveText, type BeachFileHost } from './ui/beachFileDialog';
import { parseBeachFile, writeBeachFile } from './world/beachFile';
import { version as APP_VERSION } from '../package.json';

// Unhandled errors + one page-load timing sample go to /api/client-events,
// so phones are visible in Cloud Logging too. First, so early errors count.
// Production only: the sandbox build has no server to send to.
if (ACCOUNTS_ENABLED) initTelemetry();

const params = new URLSearchParams(location.search);
/** a share link (?visit=CODE) opens that person's beach once signed in */
const visitCode = visitCodeFromUrl(location.search);
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
  const tier = tierFromBench(ms, isTouch, isSteam());
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
  canvas.addEventListener('webglcontextlost', () => reportError('webgl', 'WebGL context lost', { source: 'canvas' }));
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
  worker.addEventListener('error', (e) =>
    reportError('worker', e.message || 'sim worker error', {
      source: e.filename ? `${e.filename.split('?')[0]}:${e.lineno ?? 0}` : 'sim.worker',
    }),
  );
  worker.addEventListener('messageerror', () => reportError('worker', 'sim worker messageerror', { source: 'sim.worker' }));
  const send = (m: ToWorker, transfer: Transferable[] = []) => {
    if (params.has('trace') && m.type !== 'return') console.log('send', JSON.stringify(m));
    worker.postMessage(m, transfer);
  };

  const chosen = await chooseTier(settings, worker);
  settings = chosen.settings;
  const tier = chosen.tier;
  reportEvent('app_boot', {
    tier,
    dpr: Math.round((window.devicePixelRatio || 1) * 10) / 10,
    touch: isTouch,
  });
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
  const sendSea = () => send({ type: 'sea', tide: liveState.simTide, waves: liveState.waves });
  sendSea();
  const sky = new Sky(scene);
  const picker = new SandPicker(grid, ready.rest);
  const cam = new CameraController(scene, canvas, grid.dx);
  // set up with the account layer (production builds)
  let neighbors: NeighborView | null = null;
  let clawMachine: ClawMachine | null = null;
  let digFind: DigFind | null = null;
  let digFindApi: DigFindApi | null = null;
  let shopDialog: Shop | null = null;
  let leaderboard: Leaderboard | null = null;
  let vendingMachine: VendingMachine | null = null;
  // your sand, else a neighbor's, else the untouched shore (the chair can walk along all of it)
  cam.groundHeight = (x, z) => {
    const h = picker.heightAt(x, z);
    if (Number.isFinite(h)) return h;
    const n = neighbors?.heightAtWorld(x, z) ?? NaN;
    return Number.isFinite(n) ? n : restHeight(x + WORLD_SIZE_X / 2, z - ORIGIN_Z, seed);
  };
  const horizon = new Horizon(scene, swell, seed, grid.dx);
  const objectView = new ObjectView(scene, renderer);
  const animals = new AnimalController();
  let animalView: AnimalView | null = null;
  let animalViewLoading = false;
  const ensureAnimalView = () => {
    if (animalView || animalViewLoading) return;
    animalViewLoading = true;
    void import('./render/animals').then(({ AnimalView: View }) => {
      animalView = new View(scene, renderer);
    });
  };
  const animalBrush = { x: 0, z: 0, active: false };
  const animalObstacles: AnimalObstacle[] = [];
  const animalEnv: AnimalEnv = {
    heightAt: (x, z) => picker.heightAt(x, z),
    waterAt: (x, z) => picker.waterAt(x, z),
    brush: animalBrush,
    obstacles: animalObstacles,
  };
  const syncAnimalObstacles = () => {
    let n = 0;
    for (let i = 0; i < objectStates.length; i++) {
      const o = objectStates[i];
      if (o.kind !== 'rock' && o.size < 0.7) continue;
      const wx = o.x + ORIGIN_X;
      const wz = o.y + ORIGIN_Z;
      const r = o.kind === 'rock' ? o.size : 0.7;
      if (n < animalObstacles.length) {
        animalObstacles[n].x = wx;
        animalObstacles[n].z = wz;
        animalObstacles[n].radius = r;
      } else {
        animalObstacles.push({ x: wx, z: wz, radius: r });
      }
      n++;
    }
    animalObstacles.length = n;
  };
  const audio = new Ambience();
  const haptics = new Haptics();
  haptics.enabled = settings.haptics;
  audio.setSound(settings.sound);
  audio.setMusic(settings.music);

  // ---------------------------------------------------------------- new versions
  // A tab left open across a deploy runs old code (and an old app's saves can
  // be refused, 426): offer a reload, once. The phone apps update through the
  // stores, so there it says to update instead.
  let reloadOffered = false;
  const offerReload = () => {
    if (reloadOffered) return;
    reloadOffered = true;
    if (isSteam()) showToast(uiRoot, 'A newer beech is out: update it on Steam to keep saving.');
    else if (isPackagedApp()) showToast(uiRoot, 'A newer beech is out: update it from the store to keep saving.');
    else showActionToast(uiRoot, 'A new version of beech is ready.', 'Reload', () => location.reload(), 24 * 3600 * 1000);
  };
  if (!isPackagedApp()) watchForNewVersion(offerReload);

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

  let pendingBuf: Float32Array | null = null;
  let pendingTouch = false;
  type SandReply = { delta: Float32Array; objects: PlacedObject[]; cover?: Float32Array };
  /** what's on the beach now (the worker sends the roster when it changes, positions every frame) */
  let objectStates: ObjectState[] = [];
  /** the strays from the sea you've kept, by item (the bag's "found" list) */
  const countFound = () => {
    const kept = new Map<string, number>();
    for (const o of objectStates) if (o.found) kept.set(o.item, (kept.get(o.item) ?? 0) + 1);
    return kept;
  };
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
      sandWaiters.get(m.id)?.({ delta: m.delta, objects: m.objects, ...(m.cover ? { cover: m.cover } : {}) });
      sandWaiters.delete(m.id);
      return;
    }
    if (m.type !== 'frame') return;
    // everything's position this frame, in roster order (no objects made per frame)
    const pos = m.objPos;
    if (m.roster) {
      // something was added or removed: apply positions right away so newly
      // added objects spawn at their true z and settle immediately
      objectStates = m.roster.map((o, i) => {
        const off = i * POS_STRIDE;
        return off + 4 < pos.length
          ? { ...o, x: pos[off], y: pos[off + 1], z: pos[off + 2], angle: pos[off + 3], floating: pos[off + 4] > 0 }
          : { ...o, z: 0, floating: false };
      });
      objectView.set(objectStates);
      pendingTouch = false;
      // how many of each item you've put down (prizes can only go down as often as you own them)
      const placed = new Map<string, number>();
      for (const o of objectStates) if (!o.wild) placed.set(o.item, (placed.get(o.item) ?? 0) + 1);
      inventory.setPlaced(placed);
      // kept from the sea: strays you picked up and put down
      inventory.setFound(countFound());
    } else {
      for (let i = 0, o = 0; i < objectStates.length && o < pos.length; i++, o += POS_STRIDE) {
        const s = objectStates[i];
        s.x = pos[o];
        s.y = pos[o + 1];
        s.z = pos[o + 2];
        s.angle = pos[o + 3];
        s.floating = pos[o + 4] > 0;
      }
      pendingTouch = true;
    }
    // a held thing follows the finger; one just put down waits for the worker
    if (settling) {
      const s = objectStates.find((o) => o.id === settling!.id);
      if (!s || performance.now() > settling.until || (Math.abs(s.x - settling.x) < 0.05 && Math.abs(s.y - settling.y) < 0.05)) settling = null;
    }
    applyDrag();
    // Defer the GPU texture upload and picker sync to the render loop so slow
    // frames don't pile up wasted work; return any superseded buffer right away.
    if (pendingBuf) {
      send({ type: 'return', buf: pendingBuf, objPos: pos }, [pendingBuf.buffer, pos.buffer]);
    } else {
      send({ type: 'return', objPos: pos }, [pos.buffer]);
    }
    pendingBuf = m.buf;
    const dtSim = m.t - info.t;
    if (frames > 0 && dtSim > 0) swashRate += ((m.swash - info.swash) / dtSim - swashRate) * 0.3;
    prevT = frames === 0 ? m.t : info.t;
    info = { ...m, objects: objectStates };
    frameAt = performance.now();
    frames++;
  };

  // ---------------------------------------------------------------- digging
  let brushMode: BrushMode = 'dig';
  /** an inventory item in hand: taps set it down instead of digging */
  let placing: Item | null = null;
  let digging = false;
  let strokeOpen = false;
  /** a dig stroke's effort, for buried finds: brush travel (m) and when it started */
  let digPathM = 0;
  let digStrokeStart = 0;
  /** last time the app asked the server for a digging roll (the server enforces the same gap) */
  let lastDigFindAttempt = 0;
  type Hit = { x: number; y: number; z: number };
  let lastHit: Hit | null = null;
  let hover: Hit | null = null;
  let ringAlpha = 0;
  let lastRing: Hit = { x: 0, y: 0, z: 0 };

  const pickAt = (sx: number, sy: number): Hit | null => picker.pick(cam.ray(sx, sy));
  const toSim = (p: { x: number; z: number }) => ({ x: p.x - ORIGIN_X, y: p.z - ORIGIN_Z });

  // ---------------------------------------------------------------- picking things up
  // Long-press on a thing picks it up; drag it, and it goes down where you let
  // go (one undo step). While held, its drawn position follows the finger.
  let press: { sx: number; sy: number; timer: number } | null = null;
  let dragging: { id: number; x: number; y: number } | null = null;
  /** just let go: keep drawing it there until the worker's next frame has it */
  let settling: { id: number; x: number; y: number; until: number } | null = null;
  /** the thing under the pointer, if any (its footprint, roughly) */
  const thingAt = (sx: number, sy: number): ObjectState | null => {
    const hit = pickAt(sx, sy);
    if (!hit) return null;
    const p = toSim(hit);
    let best: ObjectState | null = null;
    let bestD = Infinity;
    for (const o of objectStates) {
      const reach = o.kind === 'driftwood' ? o.size * 0.5 : Math.max(0.22, Math.min(1, o.size) * 0.9);
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < reach && d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  };
  /** draw the held thing at the finger (after the worker's positions are applied) */
  const applyDrag = () => {
    const d = dragging ?? settling;
    if (!d) return;
    const s = objectStates.find((o) => o.id === d.id);
    if (!s) return;
    s.x = d.x;
    s.y = d.y;
    s.z = picker.heightAt(d.x + ORIGIN_X, d.y + ORIGIN_Z) + (dragging ? 0.12 : 0);
    s.floating = false;
    objectView.touch();
  };

  const startDig = (sx: number, sy: number) => {
    digging = true;
    strokeOpen = false;
    digPathM = 0;
    digStrokeStart = performance.now();
    hover = null;
    strokeTo(sx, sy);
  };

  const strokeTo = (sx: number, sy: number) => {
    const hit = pickAt(sx, sy);
    if (!hit) return;
    // a dig stroke's effort, for buried finds: how far the brush travelled
    if (digging && brushMode === 'dig' && lastHit) {
      digPathM += Math.hypot(hit.x - lastHit.x, hit.z - lastHit.z);
    }
    lastHit = hit;
    const r = cam.brushRadius(hit);
    const s = toSim(hit);
    send({ type: 'brush', phase: strokeOpen ? 'move' : 'start', x: s.x, y: s.y, r, mode: brushMode });
    strokeOpen = true;
  };

  // set up below once the account layer exists (sandbox builds never save)
  let markDirty: (delayMs?: number) => void = () => {};
  /** refresh the bag from the server (set up with the account layer) */
  let refreshOwned: () => void = () => {};

  /** At the end of a good dig, ask the server whether something was buried there. */
  const tryDigFind = async (pathM: number, durationMs: number) => {
    if (!digFindApi || !digFindApi.signedIn || !digFind) return; // signed out, or the sandbox build
    // for tests (the e2e scripts): ?nofinds never rolls, so a 1-in-10 find
    // can't pop up over whatever the test does next
    if (params.has('nofinds')) return;
    if (!qualifiesForFind(pathM, durationMs)) return;
    const now = performance.now();
    if (now - lastDigFindAttempt < DIG_FIND_ROLL_COOLDOWN_MS) return;
    lastDigFindAttempt = now;
    let res;
    try {
      res = await digFindApi.find(pathM, durationMs);
    } catch {
      return; // offline, or the server said not yet: nothing is lost, the roll is server-side
    }
    if (!res.found || !res.item || !res.rarity) return;
    refreshOwned();
    digFind.show({ item: res.item, rarity: res.rarity }, res.findsLeft ?? 0);
    unlockSteamAchievement('BURIED_FIND');
    audio.whoosh(true);
    haptics.impact('medium');
  };

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
    updateSteamRichPresence(b.name, cam.mode);
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
    exportBeach: () => void exportBeach(),
    importBeach: () => void beachFiles.pick(),
    fullscreen: () => void toggleFullscreen(),
    tv: () => {
      // one tap for the TV: idle controls + wake lock, seated on the sand,
      // fullscreen. (Fullscreen needs the tap; that is why it is a button.)
      settings = { ...settings, ambient: true };
      saveSettings(settings);
      ambient.setEnabled(true);
      sheet.setSettings(settings);
      cam.setMode('chair', false);
      void toggleFullscreen();
    },
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
  // the look tool (the default) only moves the view: pan, zoom, tilt, turn.
  // sand is one top-level tool with three modes: dig (shovel), build up (dune),
  // or blend (rake). clearing is one top-level tool with three modes: bulldozer
  // (flatten + scoop up items), flatten the sand, or vacuum items up.
  const SAND_MODE_DEFS: { id: SandMode; icon: 'dig' | 'build' | 'smooth'; label: string }[] = [
    { id: 'dig', icon: 'dig', label: 'Dig' },
    { id: 'pile', icon: 'build', label: 'Build up sand' },
    { id: 'smooth', icon: 'smooth', label: 'Blend sand' },
  ];
  const CLEARING_MODE_DEFS: { id: ClearingMode; icon: 'dozer' | 'blade' | 'vacuum'; label: string }[] = [
    { id: 'dozer', icon: 'dozer', label: 'Bulldozer: flatten and scoop up items' },
    { id: 'flatten', icon: 'blade', label: 'Flatten the sand back to the beach' },
    { id: 'vacuum', icon: 'vacuum', label: 'Vacuum: pick items up' },
  ];
  const TOOLS: ToolDef[] = [
    { id: 'look', icon: 'hand', label: 'Look around' },
    { id: 'sand', icon: 'dig', label: 'Sand', modes: SAND_MODE_DEFS },
    { id: 'clearing', icon: 'dozer', label: 'Clearing', modes: CLEARING_MODE_DEFS },
  ];
  /** number keys 1-5: look, dig, build, blend, bulldozer */
  const KEY_TOOLS = ['look', 'dig', 'pile', 'smooth', 'clearing'] as const;
  let tool = 'look';
  let sandMode: SandMode = 'dig';
  let clearingMode: ClearingMode = 'dozer';
  let collapsed = false;
  /** highlight the active tool (and, for grouped tools, the active sub-mode) */
  const syncToolUI = () =>
    hud.setTool(placing ? 'place' : tool, tool === 'sand' ? sandMode : tool === 'clearing' ? clearingMode : undefined);
  const syncLookOnly = () => {
    gestures.lookOnly = collapsed || (!placing && tool === 'look');
  };
  const setSandMode = (mode: SandMode) => {
    tool = 'sand';
    sandMode = mode;
    brushMode = mode;
    placing = null;
    inventory.deselect();
    placeBar.show(null, DEFAULT_SIZE);
    syncLookOnly();
    syncToolUI();
    haptics.impact('light');
  };
  const setClearingMode = (mode: ClearingMode) => {
    tool = 'clearing';
    clearingMode = mode;
    brushMode = mode;
    placing = null;
    inventory.deselect();
    placeBar.show(null, DEFAULT_SIZE);
    syncLookOnly();
    syncToolUI();
    haptics.impact('light');
  };
  const pickTool = (id: string) => {
    if (isSandMode(id)) {
      setSandMode(id);
      return;
    }
    if (isClearingMode(id)) {
      setClearingMode(id);
      return;
    }
    tool = id;
    if (id === 'sand') brushMode = sandMode;
    else if (id === 'clearing') brushMode = clearingMode;
    placing = null;
    inventory.deselect();
    placeBar.show(null, DEFAULT_SIZE);
    syncLookOnly();
    syncToolUI();
    haptics.impact('light');
  };
  /** one callback for tool buttons and sub-mode buttons */
  const pick = (id: string) => pickTool(id);
  hud.setTools(TOOLS, tool, pick);
  syncToolUI();

  // the bag: rocks and driftwood (free, unlimited) for now
  const inventory = new InventoryTray((n, l, c) => hud.button(n, l, c), hud.root, ITEMS, (item) => {
    placing = item;
    syncLookOnly();
    syncToolUI();
    placeBar.show(item, DEFAULT_SIZE);
    haptics.impact('light');
  });

  // beach files (docs/BEACH_FILE.md): export what's here, import a designed beach
  const myBeachName = () => account?.beaches.find((b) => b.id === account?.beachId)?.name || beach.name;
  const exportBeach = async () => {
    const { delta, objects, cover } = await getSand();
    const name = myBeachName();
    const text = await writeBeachFile(
      { nx: grid.nx, ny: grid.ny, delta, objects, ...(cover ? { cover } : {}) },
      { name, location: beach.id, createdWith: `beech ${APP_VERSION}` },
    );
    await saveText(beachFileName(name), text);
  };
  const beachFileHost: BeachFileHost = {
    grid: () => grid,
    owned: () => inventory.ownedItems(),
    placedElsewhere: () => inventory.elsewhereItems(),
    hasBag: ACCOUNTS_ENABLED,
    shop: ACCOUNTS_ENABLED ? () => void shopDialog?.open() : undefined,
    apply: (b) => {
      const xfer: Transferable[] = [b.delta.buffer];
      if (b.cover) xfer.push(b.cover.buffer);
      send({ type: 'importBeach', delta: b.delta, objects: b.objects, ...(b.cover ? { cover: b.cover } : {}) }, xfer);
      const loc = beachById(b.location);
      if (loc && loc.id !== beach.id) setBeach(loc);
      markDirty(1500);
      haptics.impact('medium');
      audio.whoosh(false);
      showToast(uiRoot, b.name ? `${b.name} is here. Undo brings your beach back.` : 'Imported. Undo brings your beach back.');
    },
  };
  const beachFiles = new BeachFileDialog(uiRoot, beachFileHost);
  const sizeOf = (id: string) => settings.itemSizes?.[id] ?? DEFAULT_SIZE;
  const placeBar = new PlaceBar(
    hud.root,
    () => settings.itemSizes ?? {},
    (id, v) => {
      settings = { ...settings, itemSizes: { ...settings.itemSizes, [id]: v } };
      saveSettings(settings);
    },
    () => pickTool(tool),
  );
  hud.toolGroup.prepend(inventory.button);
  // the look tool sits at the very top, above the bag
  hud.toolGroup.prepend(hud.toolGroup.querySelector('button[data-tool="look"]')!);

  /** Tap with an item in hand: set the item down. Picking things back up is
   * the vacuum's job now — the item tool only places. */
  let fullToastAt = 0;
  const putDown = (sx: number, sy: number) => {
    if (!placing) return;
    const hit = pickAt(sx, sy);
    if (!hit) return;
    const p = toSim(hit);
    if (!inventory.canPlace(placing.id)) {
      // all of them are already on the beach
      haptics.impact('light');
      return;
    }
    if (info.objects.filter((o) => !o.wild).length >= MAX_OBJECTS) {
      // a beach saves this many things at most: more would be lost on the next save
      haptics.impact('light');
      if (performance.now() - fullToastAt > 4000) {
        fullToastAt = performance.now();
        showToast(uiRoot, `This beach is full: it holds ${MAX_OBJECTS} things. Take some away with the vacuum to put more down.`);
      }
      return;
    }
    const r = rollPlacement(placing, sizeOf(placing.id));
    send({ type: 'placeObject', obj: { kind: placing.kind, item: placing.id, x: p.x, y: p.y, ...r } });
    if (placing.kind === 'rock' || placing.kind === 'driftwood') audio.thunk(placing.kind === 'rock');
    haptics.impact(placing.kind === 'rock' ? 'medium' : 'light');
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

  // collapse all toolbars for distraction-free panning around the beach
  const collapseBtn = hud.button('eye', 'Hide toolbars', 'hud-btn hud-collapse');
  collapseBtn.setAttribute('aria-pressed', 'false');
  hud.leftGroup.appendChild(collapseBtn);
  const setCollapsed = (on: boolean) => {
    if (collapsed === on) return;
    collapsed = on;
    uiRoot.classList.toggle('ui-collapsed', on);
    hud.root.classList.toggle('collapsed', on);
    hud.setIcon(collapseBtn, on ? 'eyeOff' : 'eye');
    const label = on ? 'Show toolbars' : 'Hide toolbars';
    collapseBtn.setAttribute('aria-label', label);
    collapseBtn.title = label;
    collapseBtn.setAttribute('aria-pressed', String(on));
    if (on) {
      inventory.setOpen(false);
      sheet.hide();
      if (placing) {
        placing = null;
        inventory.deselect();
        placeBar.show(null, DEFAULT_SIZE);
        syncToolUI();
      }
    }
    syncLookOnly();
    haptics.impact('light');
  };
  collapseBtn.addEventListener('click', () => setCollapsed(!collapsed));
  // the shore bar (top right): who you're visiting, and the way home
  const shoreBar = document.createElement('div');
  shoreBar.className = 'shore-bar';
  shoreBar.innerHTML = `<span class="sb-where"></span><button type="button" class="sb-pet" hidden>Feed pet</button><button type="button" class="sb-fav"></button><button type="button" class="sb-home" data-act="home">⌂ <span>my beach</span></button>`;
  hud.root.appendChild(shoreBar);
  const sbWhere = shoreBar.querySelector<HTMLElement>('.sb-where')!;
  const sbPet = shoreBar.querySelector<HTMLButtonElement>('.sb-pet')!;
  const sbFav = shoreBar.querySelector<HTMLButtonElement>('.sb-fav')!;
  let shoreKey = '';
  const visitedPetCache = new Map<string, { name: string } | null>();
  /** the beach under the view, along the shore (null: your own) */
  const beachHere = () => {
    if (!neighbors) return null;
    const i = neighbors.nearestIndex(cam.focusX);
    return i === 0 && !neighbors.visiting ? null : neighbors.beachAt(i);
  };
  const goHome = async () => {
    if (neighbors?.visiting) {
      await neighbors.visit(null);
      cam.goTo(0, true);
    } else {
      cam.goTo(0);
    }
    haptics.impact('light');
  };
  shoreBar.querySelector('.sb-home')!.addEventListener('click', () => void goHome());
  sbFav.addEventListener('click', () => {
    const b = beachHere();
    if (b && neighbors) void neighbors.toggleFavorite(b).catch(() => {});
  });
  sbPet.addEventListener('click', () => {
    const b = beachHere();
    if (!b || !animalsApi) return;
    if (!animalsApi.signedIn) {
      showToast(uiRoot, 'Sign in to feed pets.');
      return;
    }
    void animalsApi
      .feedVisitorPet(b.code)
      .then((res) => {
        if (res.usedFood) refreshOwned();
        haptics.impact('light');
        showToast(uiRoot, res.pet.name ? `Fed ${res.pet.name}!` : 'Fed their sand crab!');
      })
      .catch((err: unknown) => {
        showToast(uiRoot, err instanceof Error ? err.message : 'Could not feed pet.');
      });
  });
  const updateShoreBar = () => {
    const away = !!neighbors && (!!neighbors.visiting || Math.abs(cam.focusX) > WORLD_SIZE_X / 2 + 2);
    const b = away ? beachHere() : null;
    const fav = !!b && !!neighbors?.favorites.has(b.code);
    const signedIn = !!account?.user;
    // in viewing mode the shore bar's pill is gone too: the beach info
    // lives behind the "i" button at the bottom instead
    const viewing = !!neighbors && neighbors.viewing;
    const key = `${away}|${b?.code}|${b?.name}|${fav}|${!!neighbors?.visiting}|${signedIn}|${viewing}`;
    if (key === shoreKey) return;
    shoreKey = key;
    shoreBar.classList.toggle('shown', away && !viewing);
    const place = b?.location ? beachById(b.location) : undefined;
    sbWhere.textContent = b ? `${neighbors?.visiting ? 'Visiting ' : ''}${b.name || 'a beach'}${place ? ` · ${place.name}` : ''}` : 'Down the shore';
    sbFav.hidden = !b || !signedIn;
    sbFav.textContent = fav ? '★' : '☆';
    sbFav.classList.toggle('on', fav);
    sbFav.setAttribute('aria-label', fav ? 'Remove from favorites' : 'Add to favorites');
    sbPet.hidden = true;
    if (b && animalsApi) {
      const cached = visitedPetCache.get(b.code);
      if (cached !== undefined) {
        if (cached) {
          sbPet.textContent = cached.name ? `Feed ${cached.name}` : 'Feed pet';
          sbPet.hidden = false;
        }
      } else {
        const code = b.code;
        void animalsApi
          .getBeachPet(code)
          .then((r) => {
            visitedPetCache.set(code, r.pet ? { name: r.pet.name } : null);
            if (beachHere()?.code === code && r.pet) {
              sbPet.textContent = r.pet.name ? `Feed ${r.pet.name}` : 'Feed pet';
              sbPet.hidden = false;
            }
          })
          .catch(() => {});
      }
    }
  };

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

  const begin = () => {
    audio.start();
  };
  const skipIntro = params.has('smoke') || params.has('nointro');
  const start = skipIntro ? null : new StartScreen(uiRoot, begin, isTouch);

  const gestures = new Gestures(canvas, cam, {
    digStart: (sx, sy) => {
      if (cam.animating) return;
      if (neighbors && neighbors.viewing) {
        // someone else's beach: look, don't touch
        neighbors.nudgeInfo();
        return;
      }
      inventory.setOpen(false);
      if (placing) {
        putDown(sx, sy);
        return;
      }
      // pressing on a thing: hold still to pick it up (a move or a quick tap digs)
      const thing = thingAt(sx, sy);
      if (thing) {
        const id = thing.id;
        press = {
          sx,
          sy,
          timer: window.setTimeout(() => {
            press = null;
            const t = objectStates.find((o) => o.id === id);
            if (!t) return;
            dragging = { id, x: t.x, y: t.y };
            haptics.impact('medium');
          }, LONG_PRESS_MS),
        };
        return;
      }
      startDig(sx, sy);
    },
    digMove: (sx, sy) => {
      if (press) {
        // moved before the long-press: it's a dig after all
        if (Math.hypot(sx - press.sx, sy - press.sy) > HOLD_SLOP_PX) {
          const p = press;
          window.clearTimeout(p.timer);
          press = null;
          startDig(p.sx, p.sy);
          strokeTo(sx, sy);
        }
        return;
      }
      if (dragging) {
        const hit = pickAt(sx, sy);
        if (hit) {
          const p = toSim(hit);
          dragging.x = p.x;
          dragging.y = p.y;
          applyDrag();
        }
        return;
      }
      if (digging) strokeTo(sx, sy);
    },
    digEnd: () => {
      if (press) {
        // a quick tap on a thing: dig there, as a tap anywhere else does
        const p = press;
        window.clearTimeout(p.timer);
        press = null;
        startDig(p.sx, p.sy);
      }
      if (dragging) {
        const d = dragging;
        dragging = null;
        // (a few frames at most: the worker's own position takes over)
        settling = { ...d, until: performance.now() + 400 };
        send({ type: 'moveObject', id: d.id, x: d.x, y: d.y });
        haptics.impact('light');
        markDirty();
        return;
      }
      const wasDig = strokeOpen && brushMode === 'dig';
      const pathM = digPathM;
      const durationMs = performance.now() - digStrokeStart;
      if (strokeOpen) {
        send({ type: 'brush', phase: 'end' });
        markDirty();
      }
      digging = false;
      strokeOpen = false;
      if (wasDig) {
        unlockSteamAchievement('FIRST_DIG');
        void tryDigFind(pathM, durationMs);
      }
    },
    grabAt: (sx, sy) => {
      // look mode: a long-press on a thing picks it up
      if (neighbors && (neighbors.visiting || !neighbors.ownVisible)) return false;
      const t = thingAt(sx, sy);
      if (!t) return false;
      dragging = { id: t.id, x: t.x, y: t.y };
      haptics.impact('medium');
      return true;
    },
    digCancel: () => {
      if (press) {
        window.clearTimeout(press.timer);
        press = null;
      }
      // a second finger mid-drag: put it back where it was
      dragging = null;
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
    tool: (i) => KEY_TOOLS[i] && pickTool(KEY_TOOLS[i]),
    view: () => cam.toggleMode(),
    toggleCollapse: () => setCollapsed(!collapsed),
    exitCollapse: () => {
      if (collapsed) setCollapsed(false);
    },
    interacted: () => {
      // any input (including when there is no start screen) unlocks audio
      if (!start?.visible) audio.start();
    },
  });
  gestures.lookOnly = true;

  const gamepad = new GamepadController(canvas, cam, {
    digStart: (sx, sy) => {
      if (cam.animating) return;
      if (neighbors && (neighbors.visiting || !neighbors.ownVisible)) return;
      if (placing) {
        putDown(sx, sy);
        return;
      }
      startDig(sx, sy);
    },
    digMove: (sx, sy) => {
      if (digging) strokeTo(sx, sy);
    },
    digEnd: () => {
      const wasDig = strokeOpen && brushMode === 'dig';
      const pathM = digPathM;
      const durationMs = performance.now() - digStrokeStart;
      if (strokeOpen) {
        send({ type: 'brush', phase: 'end' });
        markDirty();
      }
      digging = false;
      strokeOpen = false;
      if (wasDig) {
        unlockSteamAchievement('FIRST_DIG');
        void tryDigFind(pathM, durationMs);
      }
    },
    hover: (sx, sy) => {
      hover = pickAt(sx, sy);
    },
    undo,
    cycleTool: (delta) => {
      // Derive the index from the current tool on each press: the mouse /
      // touch UI can change it, so a stored index would drift and LB/RB
      // would jump to the wrong tool.
      const current = Math.max(0, TOOLS.findIndex((t) => t.id === tool));
      const next = (current + delta + TOOLS.length) % TOOLS.length;
      if (TOOLS[next]) pickTool(TOOLS[next].id);
    },
    toggleView: () => cam.toggleMode(),
    toggleSettings: () => sheet.toggleOpen(),
    interacted: () => {
      if (start?.visible) begin();
      else audio.start();
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
  let lastUiPalette: Palette | null = null;
  const applyUiColors = (p: Palette) => {
    if (p === lastUiPalette) return;
    lastUiPalette = p;
    const lum = 0.3 * p.ui[0] + 0.59 * p.ui[1] + 0.11 * p.ui[2];
    const bg = lum > 0.6 ? 'rgba(46, 40, 78, 0.55)' : 'rgba(255, 250, 244, 0.72)';
    hud.setColors(rgbToCss(p.ui), bg);
  };

  // ---------------------------------------------------------------- main loop
  let last = performance.now();
  const t0 = last;
  let skip = false;
  const right = new Vector3();
  let liveAt = -Infinity;
  let liveFixed: string | undefined;
  let liveBeachId = '';
  let slowTime = 0;
  let fastTime = 0;
  let reportedResDrop = false;
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
      if (!reportedResDrop) {
        reportedResDrop = true;
        reportEvent('res_drop', { scale: renderScale, tier });
      }
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
    const nowMs = now0.getTime();
    const fixed = fixedPalette ?? (settings.palette !== 'live' ? settings.palette : undefined);
    if (Math.abs(nowMs - liveAt) >= 500 || fixed !== liveFixed || beach.id !== liveBeachId) {
      liveState = live.compute(now0, fixed);
      liveAt = nowMs;
      liveFixed = fixed;
      liveBeachId = beach.id;
    }
    if (now - seaSentAt > 2000) {
      seaSentAt = now;
      sendSea();
    }
    updatePlace();
    if (!document.hidden && !params.has('fixedres')) adaptResolution(dt);

    const palette = liveState.palette;
    gamepad.poll(dt);
    cam.update(dt, gestures.cameraActive);
    updateRing(dt, palette);
    updateSteamRichPresence(beach.name, cam.mode);
    if (cam.mode === 'chair') unlockSteamAchievement('CHAIR_VIEW');
    if (liveState.sky.night > 0.5) unlockSteamAchievement('NIGHT_BEACH');
    if (neighbors && !neighbors.ownVisible) unlockSteamAchievement('WALK_SHORE');
    hud.setUndoState(info.undoCount, info.redoCount);
    applyUiColors(palette);

    if (pendingBuf) {
      const buf = pendingBuf;
      pendingBuf = null;
      picker.updateFromFrame(buf);
      renderer.uploadFrame(buf);
      send({ type: 'return', buf }, [buf.buffer]);
    }

    const mix = Math.min(1, (now - frameAt) / (1000 / SIM_HZ));
    renderer.setFrameMix(mix);
    const simTime = prevT + (info.t - prevT) * mix;
    const amp = (1 - (1 - WAVES.calmFactor) * info.calmMix) * liveState.waves;
    const camFwd = cam.forward();
    renderer.update(palette, camFwd, (now - t0) / 1000, simTime, info.tide, amp);
    neighbors?.update(palette, camFwd, (now - t0) / 1000, simTime, info.tide, amp);
    // your beach is drawn while it's near the view (not while visiting someone)
    const ownShown = neighbors ? neighbors.ownVisible : true;
    renderer.setVisible(ownShown);
    objectView.setVisible(ownShown);
    updateShoreBar();
    if (cam.mode === 'chair') {
      // the static shore starts where the drawn beaches end
      horizon.setExtent(neighbors?.windowCenters() ?? [0]);
      horizon.update(palette, camFwd, simTime, info.tide, amp);
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

    if (pendingTouch) {
      pendingTouch = false;
      objectView.touch();
    }
    objectView.update(dt);
    animalBrush.active = digging && lastHit !== null;
    if (lastHit) {
      animalBrush.x = lastHit.x;
      animalBrush.z = lastHit.z;
    }
    if (animals.snapshot().active) syncAnimalObstacles();
    animals.update(dt, animalEnv);
    const animalSnap = animals.snapshot();
    if (animalSnap.active || animalSnap.food.active) ensureAnimalView();
    animalView?.update(animalSnap, ownShown);
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
  let animalsApi: AnimalsApi | null = null;
  if (ACCOUNTS_ENABLED) {
    account = new Account();
    animalsApi = new AnimalsApi(account);
    const applyPet = (pet: { species: 'crab'; name: string; mood: 'happy' | 'peckish' | 'hungry' | 'sleepy'; lastFedAt: number } | null) => {
      syncAnimalObstacles();
      animals.setPet(pet ? { species: pet.species, name: pet.name, mood: pet.mood } : null, animalEnv);
      if (pet) void schedulePetHungerReminder(pet.name, beach.name, pet.lastFedAt);
    };
    const refreshPet = () => {
      if (!animalsApi?.signedIn) {
        animals.setPet(null);
        return;
      }
      const bId = account?.beachId ?? undefined;
      void animalsApi
        .getPet(bId)
        .then((r) => {
          applyPet(r.pet);
          const latest = r.recentFeeders?.[0];
          if (r.pet && latest) {
            const key = `beech.petFeedSeen.${r.pet.beachId}`;
            const prev = Number(localStorage.getItem(key) ?? 0);
            if (latest.at > prev) {
              try {
                localStorage.setItem(key, String(latest.at));
              } catch {
                /* storage unavailable */
              }
              showToast(uiRoot, `${latest.name} fed ${r.pet.name || 'your sand crab'}!`);
            }
          }
        })
        .catch(() => {});
    };
    account.onChange(() => refreshPet());
    inventory.onUseExtra = (id) => {
      if (!animalsApi?.signedIn) {
        showToast(uiRoot, 'Sign in first.');
        return;
      }
      if (neighbors && !neighbors.ownVisible) {
        showToast(uiRoot, 'Head back to your beach first.');
        return;
      }
      const activeBeachId = account?.beachId ?? undefined;
      if (id === 'pet-crab') {
        void animalsApi
          .adoptPet({ mode: 'shop', beachId: activeBeachId })
          .then((pet) => {
            applyPet(pet);
            refreshOwned();
            haptics.impact('medium');
            showToast(uiRoot, 'A sand crab moved onto your beach!');
          })
          .catch((err: unknown) => {
            showToast(uiRoot, err instanceof Error ? err.message : 'Could not adopt pet.');
          });
        return;
      }
      if (id !== 'crab-treat') return;
      void animalsApi
        .feed(activeBeachId)
        .then((res) => {
          syncAnimalObstacles();
          animals.dropFood(animalEnv);
          refreshOwned();
          haptics.impact('light');
          if (res.pet) {
            applyPet(res.pet);
            showToast(uiRoot, res.pet.name ? `Fed ${res.pet.name}!` : 'Fed your sand crab!');
          } else if (res.bond?.ready) {
            showActionToast(uiRoot, 'A wild sand crab wants to stay on your beach!', 'Adopt', () => {
              void animalsApi
                ?.adoptPet({ mode: 'befriend', beachId: activeBeachId })
                .then((pet) => {
                  applyPet(pet);
                  haptics.impact('medium');
                  showToast(uiRoot, 'Your new sand crab moved in!');
                })
                .catch((err: unknown) => showToast(uiRoot, err instanceof Error ? err.message : 'Could not adopt pet.'));
            });
          } else {
            showToast(uiRoot, 'Beach snack tossed on the sand.');
          }
        })
        .catch((err: unknown) => {
          showToast(uiRoot, err instanceof Error ? err.message : 'No beach snacks left.');
        });
    };
    sync = new BeachSync(account, {
      getSand,
      setSand: (delta, objects, cover) => {
        const xfer: Transferable[] = [delta.buffer];
        if (cover) xfer.push(cover.buffer);
        send({ type: 'setSand', delta, objects, ...(cover ? { cover } : {}) }, xfer);
      },
      grid: { nx: grid.nx, ny: grid.ny },
      location: () => beach.id,
      setLocation: (id) => {
        const b = beachById(id);
        if (b && b.id !== beach.id) setBeach(b);
      },
    });
    const s = sync;
    markDirty = (delayMs?: number) => s.markDirty(delayMs);
    // an app older than the server's data can't save: say so, once, with a reload
    s.onState((st) => {
      if (st === 'outdated') offerReload();
    });
    // say so when a save can't hold everything (an undo can bring a full
    // beach past the limit), and when the server refuses one as too big
    s.onDropped((n) => {
      if (n) showToast(uiRoot, `Only ${MAX_OBJECTS} things are saved on a beach: the ${n} you put down last won't be kept. Take some away with the vacuum.`);
    });
    let toldTooBig = false;
    s.onState((st) => {
      if (st === 'tooBig' && !toldTooBig) showToast(uiRoot, 'This beach is too big to save. Smooth some of the sand and it will save again.');
      toldTooBig = st === 'tooBig';
    });
    neighbors = new NeighborView(scene, grid, ready.rest, swell, cam, uiRoot, account, renderer);
    const nv = neighbors;
    nv.onHome = () => void goHome();
    const acct = account;
    // a share link (?visit=CODE) waits for sign-in, then lands on that beach
    let pendingVisit: string | null = visitCode;
    const applyPendingVisit = async () => {
      const me = account;
      if (!pendingVisit || !me?.user) return;
      const code = pendingVisit;
      pendingVisit = null;
      history.replaceState(null, '', location.pathname + withoutVisitParam(location.search) + location.hash);
      try {
        await nv.visit(code);
        cam.goTo(0, true);
      } catch {
        showToast(uiRoot, 'No beach has that code');
      }
    };
    // whenever someone new signs in (or a saved session comes back), bring
    // back their beach and their neighbors
    let signedInAs: string | null = null;
    account.onChange((u) => {
      if (u && u.id !== signedInAs) {
        // your beaches first (this device opens the one it had, else home),
        // then its sand and its stretch of shore
        void (async () => {
          await acct.loadBeaches().catch(() => {});
          await s.restoreOrCreate().catch(() => {});
          await nv.refresh();
        })();
        void nv.loadFavorites();
        void applyPendingVisit();
      } else if (!u) {
        nv.clear();
        if (signedInAs) void nv.refresh();
      }
      signedInAs = u?.id ?? null;
    });
    // another of your beaches opened on this device: the shore moves to it
    let shownBeach: string | null = null;
    acct.onBeach((id) => {
      if (shownBeach && id && id !== shownBeach) void nv.recentre();
      shownBeach = id;
      updateElsewhere();
    });
    // your bag counts what's on your other beaches too
    const updateElsewhere = () => {
      const other = new Map<string, number>();
      for (const b of acct.beaches)
        if (b.id !== acct.beachId) for (const [k, v] of Object.entries(b.items ?? {})) other.set(k, (other.get(k) ?? 0) + v);
      inventory.setElsewhere(other);
    };
    // a dot on the settings button when someone has asked to move in next to you
    nv.onChange((n) => {
      const asking = n?.requests.length ?? 0;
      menuBtn.classList.toggle('badge', asking > 0);
      menuBtn.setAttribute('aria-label', asking ? `Settings (${asking} neighbor request${asking > 1 ? 's' : ''})` : 'Settings');
    });
    // checkpoints (docs/CHECKPOINTS.md): saved copies of your beaches
    let panel: AccountPanel | null = null;
    const cpApi = new CheckpointApi(acct);
    const keepAsCheckpoint = async (
      b: { nx: number; ny: number; delta: Float32Array; objects: PlacedObject[]; cover?: Float32Array; name?: string; location?: string },
      fallback: string,
    ) => {
      const bytes = await encodeSand(b.delta, b.nx, b.ny, b.objects, b.cover);
      const cp = await cpApi.import(bytes, (b.name || fallback || 'Imported beach').slice(0, 40), b.location);
      showToast(uiRoot, `Kept “${cp.name}” as a checkpoint`);
      unlockSteamAchievement('CHECKPOINT_SAVED');
      await checkpoints.load();
    };
    // beach files and checkpoints (BEACH_FILE.md, E5)
    beachFileHost.saveAsCheckpoint = (b, fallback) => {
      if (!acct.user) throw new Error('sign in to keep checkpoints');
      return keepAsCheckpoint(b, fallback);
    };
    beachFileHost.beforeApply = async () => {
      const here = acct.beachId;
      if (!acct.user || !here) return;
      await s.flush();
      if (!acct.beaches.find((b) => b.id === here)?.updatedAt && !s.savedAt) return; // nothing saved to keep
      await cpApi.save(here, 'Before import', true);
      void checkpoints.load();
    };
    const checkpoints = new CheckpointsSection(
      cpApi,
      acct,
      {
        exportCheckpoint: async (cp) => {
          const { bytes, location } = await cpApi.sand(cp.id);
          const b = fitWorld(await decodeSand(bytes));
          const text = await writeBeachFile(b, { name: cp.name, location: location || undefined, createdWith: `beech ${APP_VERSION}` });
          await saveText(beachFileName(cp.name), text);
        },
        importAsCheckpoint: async () => {
          const f = await pickFile();
          if (!f) return;
          const r = await parseBeachFile(await f.text(), { nx: grid.nx, ny: grid.ny });
          if (!r.ok) throw new Error(`${f.name} isn't a beach file (${r.errors[0].path || 'file'}: ${r.errors[0].message})`);
          await keepAsCheckpoint(r.beach, f.name.replace(/(\.beach)?\.json$/i, ''));
        },
        owned: () => inventory.ownedItems(),
        // the beach on this device: what's on it this moment; the others: as last saved
        itemsOn: (id) => (id === acct.beachId ? countItems(info.objects) : (acct.beaches.find((b) => b.id === id)?.items ?? {})),
        saveNow: () => s.flush(),
        replaceHere: async (change) => {
          await s.replaceHere(change);
          cam.goTo(0, true);
        },
        changed: async () => {
          await acct.loadBeaches().catch(() => {});
          await loadOwned();
          updateElsewhere();
        },
        toast: (text, undo) => (undo ? showActionToast(uiRoot, text, 'Undo', undo) : showToast(uiRoot, text)),
        shop: () => {
          sheet.hide();
          void shopDialog?.open();
        },
      },
      () => panel?.render(),
    );
    acct.onChange(() => void checkpoints.load());
    s.onRestoredElsewhere(() => {
      showToast(uiRoot, 'This beach was restored from a checkpoint on another device');
      void checkpoints.load();
    });
    panel = new AccountPanel(
      sheet.accountSlot,
      account,
      s,
      () => {},
      nv,
      async (code) => {
        await nv.visit(code);
        cam.goTo(0, true);
        sheet.hide();
      },
      {
        // open one of your beaches on this device
        open: async (id) => {
          await s.switchTo(id);
          if (nv.visiting) await nv.visit(null);
          cam.goTo(0, true);
          updateElsewhere();
          sheet.hide();
        },
        // a new beach starts at the real beach you're looking at now
        location: () => beach.id,
        shop: () => {
          sheet.hide();
          void shopDialog?.open();
        },
        changed: () => updateElsewhere(),
      },
      checkpoints,
    );

    // the leaderboard: the most-starred beaches, to visit and star
    const boardBtn = hud.button('trophy', 'Most-starred beaches');
    boardBtn.dataset.act = 'leaderboard';
    hud.leftGroup.appendChild(boardBtn);
    const board = new Leaderboard(uiRoot, {
      signedIn: () => !!acct.user,
      signIn: () => sheet.show(),
      shoreUrl: SHORE_URL,
      load: (which) => nv.api.leaderboard(which),
      starred: (code) => nv.favorites.has(code),
      star: (e, on) => nv.setFavorite({ code: e.code, name: e.name, beachName: e.beachName, location: e.location, updatedAt: e.updatedAt }, on),
      visit: async (e) => {
        const mineHere = e.yours ? acct.beaches.find((b) => b.code === e.code) : undefined;
        if (mineHere && mineHere.id !== acct.beachId) {
          // one of your other beaches: open it on this device
          await s.switchTo(mineHere.id);
          updateElsewhere();
        }
        await nv.visit(e.yours ? null : e.code);
        cam.goTo(0, true);
        haptics.impact('light');
      },
    });
    leaderboard = board;
    boardBtn.addEventListener('click', () => board.open());

    // share: the beach under the view (yours at home) as a beechshore link,
    // which previews with a picture and opens for anyone, signed in or not
    const shareBtn = hud.button('share', 'Share this beach');
    shareBtn.dataset.act = 'share';
    hud.leftGroup.appendChild(shareBtn);
    shareBtn.addEventListener('click', () => void (async () => {
      if (!acct.user) {
        sheet.show();
        return;
      }
      const other = beachHere();
      const mine = acct.beach;
      const code = other?.code ?? mine?.code ?? nv.state?.code;
      if (!code) return;
      haptics.impact('light');
      const r = await shareLink({
        url: shoreBeachUrl(code),
        title: other ? other.beachName || `${other.name || 'Someone'}’s beach` : mine?.name || 'My beach',
        text: other ? beachShareText(other.name, other.beachName) : beachShareText(acct.user.name, mine?.name, true),
      });
      if (r === 'copied') showToast(uiRoot, 'Link copied: paste it anywhere');
      else if (r === 'failed') showToast(uiRoot, `Couldn’t share. The link is ${shoreBeachUrl(code)}`);
    })());
    nv.onFavorites(() => board.refreshStars());

    // what you've won (and later bought), and the claw machine
    const loadOwned = async () => {
      if (!acct.user) return inventory.setOwned(new Map());
      try {
        const owned = new Map<string, number>();
        const foundBy = new Map<string, string>();
        for (const it of await acct.inventory()) {
          owned.set(it.item, (owned.get(it.item) ?? 0) + it.quantity);
          if (it.foundBy !== undefined) foundBy.set(it.item, it.foundBy);
        }
        inventory.setOwned(owned, foundBy);
        // what you've dug up, for the bag's "found" list
        const dug = await new DigFindApi(acct).list().catch(() => null);
        if (dug) inventory.setFound(countFound(), dug);
      } catch {
        /* offline: keep what we had */
      }
    };
    // gifting: an item in hand can go to someone else, by their code
    const giftApi = new GiftApi(acct);
    placeBar.setGift({
      giftable: (item) => !item.unlimited && inventory.ownedCount(item.id) > 0,
      sendGift: async (item, code) => {
        const res = await giftApi.gift(code, item.id);
        void loadOwned();
        return { name: res.to.name };
      },
    });
    const claw = new ClawMachine(uiRoot, new PullApi(acct), (item, place) => {
      unlockSteamAchievement('CLAW_WIN');
      void loadOwned().then(() => {
        if (place) inventory.select(item);
      });
    });
    clawMachine = claw;
    inventory.onClaw = () => (acct.user ? void claw.open() : sheet.show());
    // the shop: paid through Apple / Google in the apps (src/net/shop.ts)
    const shopApi = new ShopApi(acct);
    const shop = new Shop(uiRoot, shopApi, () => {
      void loadOwned();
      void acct.loadBeaches().catch(() => {});
    });
    shopDialog = shop;
    inventory.onShop = () => (acct.user ? void shop.open() : sheet.show());
    // back from web checkout (Pay Station adds ?web_order=…): once signed
    // in, wait for Xsolla's webhook to land, then say so and refresh the bag
    let returnedOrder = webOrderFromUrl(location.search);
    if (returnedOrder) history.replaceState(null, '', location.pathname + withoutWebOrderParams(location.search) + location.hash);
    const settleReturnedOrder = async () => {
      if (!returnedOrder || !acct.user) return;
      const id = returnedOrder;
      returnedOrder = null;
      showToast(uiRoot, 'Checking your payment…');
      const o = await shopApi.waitForWebOrder(id);
      if (o?.status === 'paid') {
        showToast(uiRoot, 'Paid: it\'s in your bag. Thank you!');
        void loadOwned();
        void acct.loadBeaches().catch(() => {});
      } else if (o?.status === 'created') {
        showToast(uiRoot, 'Your payment is still being confirmed. It will be in your bag as soon as it is.');
      } else if (o) {
        showToast(uiRoot, 'That payment didn\'t go through: you weren\'t charged for it.');
      }
    };
    void settleReturnedOrder();
    acct.onChange((u) => {
      // anything paid for but not yet confirmed by the server: hand it over again
      if (u)
        void shopApi.retryPending().then((n) => {
          if (n) void loadOwned();
        });
      if (u) void settleReturnedOrder();
    });
    inventory.setClaw(acct.user ? 'play' : 'signin');
    const vending = new VendingMachine(uiRoot, new PullApi(acct), (item, place) => {
      unlockSteamAchievement('VENDING_PULL');
      void loadOwned().then(() => {
        if (place) inventory.select(item);
      });
    });
    vendingMachine = vending;
    inventory.onVending = () => (acct.user ? void vending.open() : sheet.show());
    // digging finds: a good dig can turn up something buried (the server
    // rolls); the dialog offers to put it on the beach or keep it in the bag
    digFindApi = new DigFindApi(acct);
    digFind = new DigFind(uiRoot, (item, place) => {
      void loadOwned().then(() => {
        if (place) inventory.select(item);
      });
    });
    refreshOwned = () => {
      void loadOwned();
    };
    inventory.setVending(acct.user ? 'play' : 'signin');
    acct.onChange((u) => {
      inventory.setClaw(u ? 'play' : 'signin');
      inventory.setVending(u ? 'play' : 'signin');
      void loadOwned();
    });
    // a share link opened signed out: open the beach read-only in 3D if it's
    // public on the shore (and let them walk the public shore); an off-shore
    // beach still waits for sign-in
    void account.restore().then(async (u) => {
      if (!u && isSteam()) {
        const steam = steamBridge();
        if (steam) {
          try {
            const t = await steam.getAuthTicket();
            // acct, not account: the await above resets narrowing of the
            // mutable `account` binding, and acct is the const alias.
            u = await acct.signInWithSteam(t.ticketHex, t.personaName);
          } catch {
            /* offline or Steam unavailable: stay playable locally */
          }
        }
      }
      if (u) return;
      if (!visitCode) {
        void nv.refresh();
        return;
      }
      const code = visitCode;
      try {
        await nv.visit(code);
        pendingVisit = null;
        history.replaceState(null, '', location.pathname + withoutVisitParam(location.search) + location.hash);
        cam.goTo(0, true);
      } catch {
        showToast(uiRoot, 'Sign in (settings) to visit this beach');
        void nv.refresh();
      }
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void sync?.flush(true);
    send({ type: 'pause', paused: document.hidden });
    audio.suspend(document.hidden);
  });

  // handle for automated tests and debugging
  // ---------------------------------------------------------------- the sandbox keeps its beach
  // No accounts here: the beach stays on this device between visits, and
  // checkpoints are kept on the device too (IndexedDB; docs/CHECKPOINTS.md C6).
  if (!ACCOUNTS_ENABLED) {
    const restoreBytes = async (bytes: Uint8Array) => {
      const b = fitWorld(await decodeSand(bytes));
      return {
        delta: resampleField(b.delta, b.nx, b.ny, grid.nx, grid.ny),
        objects: b.objects,
        ...(b.cover ? { cover: resampleField(b.cover, b.nx, b.ny, grid.nx, grid.ny) } : {}),
      };
    };
    const kept = await loadLocalBeach();
    if (kept && !params.has('fresh')) {
      try {
        const b = await restoreBytes(kept.bytes);
        const xfer: Transferable[] = [b.delta.buffer];
        if (b.cover) xfer.push(b.cover.buffer);
        send({ type: 'setSand', delta: b.delta, objects: b.objects, ...(b.cover ? { cover: b.cover } : {}) }, xfer);
        const loc = beachById(kept.location);
        if (loc && loc.id !== beach.id && !params.get('beach')) setBeach(loc);
      } catch {
        /* unreadable: start fresh */
      }
    }
    let saveTimer = 0;
    const saveHere = async () => {
      window.clearTimeout(saveTimer);
      const { delta, objects, cover } = await getSand();
      await saveLocalBeach({ bytes: await encodeSand(delta, grid.nx, grid.ny, objects, cover), location: beach.id, savedAt: Date.now() });
    };
    markDirty = (delayMs = 4000) => {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => void saveHere(), delayMs);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void saveHere();
    });
    new LocalCheckpointsSection(sheet.accountSlot, {
      snapshot: async () => {
        const { delta, objects, cover } = await getSand();
        return { bytes: await encodeSand(delta, grid.nx, grid.ny, objects, cover), objects: objects.filter((o) => !o.wild).length, location: beach.id };
      },
      restore: async (bytes) => {
        const b = await restoreBytes(bytes);
        const xfer: Transferable[] = [b.delta.buffer];
        if (b.cover) xfer.push(b.cover.buffer);
        send({ type: 'importBeach', delta: b.delta, objects: b.objects, ...(b.cover ? { cover: b.cover } : {}) }, xfer);
        markDirty(1500);
      },
      exportFile: async (name, bytes) => {
        const b = fitWorld(await decodeSand(bytes));
        await saveText(beachFileName(name), await writeBeachFile(b, { name, createdWith: `beech ${APP_VERSION}` }));
      },
      importFile: async () => {
        const f = await pickFile();
        if (!f) return null;
        const r = await parseBeachFile(await f.text(), { nx: grid.nx, ny: grid.ny });
        if (!r.ok) throw new Error(`${f.name} isn't a beach file (${r.errors[0].path || 'file'}: ${r.errors[0].message})`);
        return {
          name: r.beach.name || f.name.replace(/(\.beach)?\.json$/i, ''),
          bytes: await encodeSand(r.beach.delta, grid.nx, grid.ny, r.beach.objects, r.beach.cover),
          objects: r.beach.objects.length,
          location: r.beach.location ?? beach.id,
        };
      },
      toast: (text) => showToast(uiRoot, text),
    });
  }

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
    shop: () => shopDialog,
    leaderboard: () => leaderboard,
    vending: () => vendingMachine,
    objectView,
    animals: {
      snapshot: () => ({ ...animals.snapshot(), food: { ...animals.snapshot().food } }),
      spawn: (pos?: { x: number; z: number }, species: 'crab' | 'dolphin' = 'crab') => {
        syncAnimalObstacles();
        return animals.spawnNow(animalEnv, pos, species);
      },
      dropFood: (pos?: { x: number; z: number }) => {
        syncAnimalObstacles();
        return animals.dropFood(animalEnv, pos);
      },
      despawn: () => animals.despawnNow(),
    },
    audio,
    pickTool,
    setCollapsed,
    collapsed: () => collapsed,
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
    await setupDebug(send, () => info, () => cam.brushRadius(), {
      spawn: () => {
        syncAnimalObstacles();
        return animals.spawnNow(animalEnv, undefined, 'crab');
      },
      spawnDolphin: () => {
        syncAnimalObstacles();
        return animals.spawnNow(animalEnv, undefined, 'dolphin');
      },
      dropFood: () => {
        syncAnimalObstacles();
        return animals.dropFood(animalEnv);
      },
      despawn: () => animals.despawnNow(),
      status: () => {
        const s = animals.snapshot();
        const foodTag = s.food.active ? ` · food ${s.food.timeLeft.toFixed(0)}s` : '';
        return (
          (s.active
            ? `${s.species} ${s.phase} (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) left ${s.visitLeft.toFixed(0)}s`
            : `absent (next roll ${s.nextSpawnIn.toFixed(0)}s)`) + foodTag
        );
      },
    });
  }
  // start seated (TV / ?view=chair) once everything the view switch touches exists
  if (tv || params.get('view') === 'chair') cam.setMode('chair', false);
  document.body.dataset.ready = '1';
}

registerServiceWorker();

boot().catch((err) => {
  console.error(err);
  reportError('boot', err, { source: 'main:boot' });
  document.body.innerHTML = `<p style="font-family:sans-serif;padding:2em;color:#6b5a6e">Sorry — this device couldn't start the beach (${String(
    err?.message ?? err,
  )}).</p>`;
});
