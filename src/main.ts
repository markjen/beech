import { Engine } from '@babylonjs/core/Engines/engine';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';

import { Ambience } from './audio/ambience';
import { ANIMALS, BEACH_STORE, GRID_TIERS, SIM_HZ, WAVES, WORLD_SIZE_X, type QualityTier } from './config';
import { CameraController } from './input/cameraController';
import { Gestures, HOLD_SLOP_PX, LONG_PRESS_MS } from './input/gestures';
import { SandPicker } from './input/sandPicker';
import { rgbToCss, type Palette } from './palette';
import { Haptics } from './platform/haptics';
import { nearbyCoordinates } from './platform/location';
import { registerServiceWorker } from './platform/pwa';
import { tierFromBench } from './platform/quality';
import { BeachRenderer, ORIGIN_X, ORIGIN_Z } from './render/beachRenderer';
import type { AnimalView } from './render/animals';
import { ObjectView } from './render/objects';
import { Horizon } from './render/horizon';
import { Sky, type SkyDisc } from './render/sky';
import { AnimalController, type AnimalEnv, type AnimalObstacle } from './world/animals';
import { LiveConditions, type LiveState } from './world/live';
import { mixLive, shoreLightMix } from './world/shoreLight';
import { BEACHES, beachById, defaultBeach, nearestBeach, type Beach } from './world/locations';
import type { BrushMode, CastleShape, ClearingMode, SandMode } from './sim/beachSim';
import { isClearingMode, isSandMode } from './sim/beachSim';
import { DIG_FIND_ROLL_COOLDOWN_MS, qualifiesForFind } from './sim/digFinds';
import { POS_STRIDE, type ObjectState, type PlacedObject } from './sim/objects';
import type { FrameInfo, FromWorker, ToWorker } from './sim/protocol';
import { makeSwell } from './sim/waves';
import { MAX_OBJECTS, decodeSand, encodeSand, fitWorld, resampleField } from './sim/sandCodec';
import type { UndoHistory } from './sim/undoStack';
import { restHeight } from './sim/profile';
import { Ambient, toggleFullscreen } from './ui/ambient';
import { Hud, icon, type DirtDef } from './ui/hud';
import { SocialHub, StarredDialog, VisitDialog } from './ui/socialHub';
import { SettingsSheet, StartScreen, showActionToast, showChoiceToast, showPaneToast, showToast } from './ui/overlays';
import { awayText } from './ui/away';
import { CheckpointsSection } from './ui/checkpoints';
import { InventoryTray, PlaceBar } from './ui/inventory';
import { ClawMachine } from './ui/clawMachine';
import { DigFind } from './ui/digFind';
import { Shop } from './ui/shop';
import { ShopApi, webOrderFromUrl, withoutWebOrderParams } from './net/shop';
import { VendingMachine } from './ui/vendingMachine';
import { DEFAULT_SIZE, ITEMS, rollPlacement, type Item } from './world/items';
import { footprintDrag, footprintFarSide, type FootprintStroke } from './world/footprints';
import { ACCOUNTS_ENABLED, Account, AnimalsApi, ApiError, CheckpointApi, DigFindApi, GiftApi, GuideApi, InboxApi, PullApi, ReferralApi, type PetDto, type ShoreBeach } from './net/account';
import type { InboxPanel } from './ui/inbox';
import type { VisitorCard } from './ui/visitorCard';
import type { IconName } from './ui/hud';
import { beachShareText, inviteCodeFromUrl, shoreBeachUrl, SHORE_URL, visitCodeFromUrl, withoutInviteParam, withoutVisitParam } from './net/share';
import { shareLink } from './ui/shareSheet';
import { BeachGuide, type GuideHost } from './ui/guide';
import type { InvitePanel } from './ui/invite';
import { extraById, itemById, prizeName } from './world/items';
import { BeachSync, countItems, type SyncState } from './net/beachSync';
import { BeachStore, LOCAL_BEACH, type BeachRef } from './net/beachStore';
import { beachBackend } from './net/storeBackends';
import { idbSnapshotCache } from './net/snapshotCache';
import { snapshotBeforeBigEdit } from './net/bigEditSnapshot';
import { AccountPanel } from './ui/accountPanel';
import { Leaderboard } from './ui/leaderboard';
import { NeighborView } from './render/neighbors';
import { loadSettings, saveSettings, type Settings, type WaveStrength } from './ui/settingsStore';
import { initTelemetry, reportError, reportEvent } from './net/telemetry';
import { LocalCheckpointsSection } from './ui/localCheckpoints';
import { watchForNewVersion } from './platform/version';
import { isSteam, steamBridge, usesHostedClient } from './platform/runtime';
import { unlockSteamAchievement, updateSteamRichPresence } from './platform/steamFeatures';
import { canSchedulePetReminders, requestPetReminderPermission, setPetHungerReminder } from './platform/petNotify';
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
 * An invite link (?invite=CODE, docs/INVITES_GUIDE.md). Kept on the device
 * until it's claimed: it has to survive the Google / Apple sign-in.
 */
const INVITE_KEY = 'beech-invite';
const readInvite = (): string | null => {
  try {
    return localStorage.getItem(INVITE_KEY);
  } catch {
    return null;
  }
};
const writeInvite = (code: string | null) => {
  try {
    if (code) localStorage.setItem(INVITE_KEY, code);
    else localStorage.removeItem(INVITE_KEY);
  } catch {
    /* private mode: it lasts for this visit */
  }
};
let inviteCode: string | null = null;
/** the invite came in this page load's link (it also lands you on their beach) */
let inviteFromLink: string | null = null;
if (ACCOUNTS_ENABLED) {
  inviteCode = inviteFromLink = inviteCodeFromUrl(location.search);
  if (inviteCode) {
    writeInvite(inviteCode);
    history.replaceState(null, '', location.pathname + withoutInviteParam(location.search) + location.hash);
  } else {
    inviteCode = readInvite();
  }
}
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
  const noRender = params.has('norender');
  const engine = new Engine(canvas, !noRender, {
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
  /**
   * The light you see: the real place of the beach in the middle of the view
   * (blended across the gap while you scroll along the shore). The tide and
   * swell stay the live beach's (`liveState`): that's the sea being simulated.
   */
  let viewState: LiveState = liveState;
  /** the conditions of the place nearest the view (for the status pane) */
  let viewConditions: LiveConditions = live;
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
  let invitePanel: InvitePanel | null = null;
  let inboxUi: InboxPanel | null = null;
  let socialHub: SocialHub | null = null;
  /** neighbor requests waiting: a dot on the Inbox button */
  let neighborAsks = 0;
  const syncAskBadge = () => inboxUi?.button.classList.toggle('badge', neighborAsks > 0);
  let visitorUi: VisitorCard | null = null;
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
      animalView.offsetX = picker.offsetX;
    });
  };
  // the pet of someone else's beach you're looking at (drawn from its snapshot sand)
  const visitAnimals = new AnimalController();
  let visitView: AnimalView | null = null;
  let visitViewLoading = false;
  /** code of the beach whose pet visitAnimals is showing, and where that beach sits */
  let visitPetCode: string | null = null;
  let visitPetX = 0;
  const visitEnv: AnimalEnv = {
    heightAt: (x, z) => neighbors?.heightAtWorld(x + visitPetX, z) ?? NaN,
    waterAt: (x, z) => neighbors?.waterAtWorld(x + visitPetX, z) ?? 0,
  };
  const animalBrush = { x: 0, z: 0, active: false };
  const animalObstacles: AnimalObstacle[] = [];
  // animals live in their beach's own frame (centred on x = 0); the live beach sits at picker.offsetX
  const animalEnv: AnimalEnv = {
    heightAt: (x, z) => picker.heightAt(x + picker.offsetX, z),
    waterAt: (x, z) => picker.waterAt(x + picker.offsetX, z),
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
  // be refused, 426): offer a reload for hosted clients and a store update
  // for clients whose game code ships with the native app.
  let reloadOffered = false;
  const offerReload = () => {
    if (reloadOffered) return;
    reloadOffered = true;
    if (isSteam()) showToast(uiRoot, 'A newer beech is out: update it on Steam to keep saving.');
    else if (!usesHostedClient()) showToast(uiRoot, 'A newer beech is out: update it from the store to keep saving.');
    else showActionToast(uiRoot, 'A new version of beech is ready.', 'Reload', () => location.reload(), 24 * 3600 * 1000);
  };
  if (usesHostedClient()) watchForNewVersion(offerReload);

  // ---------------------------------------------------------------- sim frames
  let info: FrameInfo = {
    t: 0,
    eta: 0,
    tide: 0,
    waveMul: 1,
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
  let loadId = 0;

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
  const sandWaiters = new Map<number, (d: SandReply & { history?: UndoHistory }) => void>();
  let sandReq = 0;
  const getSand = (history = false) =>
    new Promise<SandReply & { history?: UndoHistory }>((resolve) => {
      const id = ++sandReq;
      sandWaiters.set(id, resolve);
      send({ type: 'getSand', id, ...(history ? { history: true } : {}) });
    });

  // ---------------------------------------------------------------- beach state (docs/BEACH_STORE.md)
  // Every beach the app knows is kept in the store by id; there is no
  // "current" beach. The worker simulates whichever beach of yours the view
  // is on (`sync.id`), drawn by the live renderer at that beach's place.
  const account: Account | null = ACCOUNTS_ENABLED ? new Account() : null;
  // other people's beaches are kept on the device between visits (docs/BEACH_STORE.md)
  const snapshots = ACCOUNTS_ENABLED ? idbSnapshotCache() : undefined;
  const store = new BeachStore(grid, ready.rest, beachBackend(account, { saveLocal: !ACCOUNTS_ENABLED, fresh: params.has('fresh'), snapshots }), seed);
  store.canSave = () => !account || !!account.user;
  /** the live renderer is waiting for the worker's first frame of the beach it just got */
  let awaitingLoad = 0;
  const sync = new BeachSync(account, store, {
    read: (history) => getSand(history),
    write: (sand) => {
      // (the undo order across beaches stays: each beach's history travels with it)
      const xfer: Transferable[] = [sand.delta.buffer];
      if (sand.cover) xfer.push(sand.cover.buffer);
      settling = null;
      dragging = null;
      awaitingLoad = ++loadId;
      send({ type: 'setSand', loadId, delta: sand.delta, objects: sand.objects, ...(sand.cover ? { cover: sand.cover } : {}), ...(sand.history ? { history: sand.history } : {}) }, xfer);
    },
  });
  /** is this the beach the worker simulates? */
  const isLive = (id: string) => id === sync.id;
  type DroppedSnack = { x: number; z: number; expiresAt: number };
  const droppedSnacks = new Map<string, DroppedSnack>();
  let shownSnackBeach: string | null = null;

  const hideSnack = () => {
    if (shownSnackBeach) animals.takeFood();
    shownSnackBeach = null;
  };
  const showLiveSnack = () => {
    const id = sync.id;
    if (!id || awaitingLoad || shownSnackBeach === id) return;
    const snack = droppedSnacks.get(id);
    if (!snack) return;
    const secondsLeft = (snack.expiresAt - Date.now()) / 1000;
    if (secondsLeft <= 0) {
      droppedSnacks.delete(id);
      return;
    }
    if (!animals.dropFood(animalEnv, snack)) return;
    animals.setFoodTimeLeft(secondsLeft);
    shownSnackBeach = id;
  };

  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    if (m.type === 'sand') {
      sandWaiters.get(m.id)?.({ delta: m.delta, objects: m.objects, ...(m.cover ? { cover: m.cover } : {}), ...(m.history ? { history: m.history } : {}) });
      sandWaiters.delete(m.id);
      return;
    }
    if (m.type !== 'frame') return;
    if (awaitingLoad && m.loadId !== awaitingLoad) {
      // still the beach the worker had before: don't draw it at the new place
      send({ type: 'return', buf: m.buf, objPos: m.objPos }, [m.buf.buffer, m.objPos.buffer]);
      return;
    }
    if (awaitingLoad) {
      // the worker has the new beach now: move the live renderer there and
      // let the snapshot take the old one, in the same frame
      awaitingLoad = 0;
      liveArrived();
    }
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
    if (m.lost) seaTook(m.lost.length);
    if (m.vacuumed) vacuumedUp(m.vacuumed);
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
  /** visiting: the code of the beach waiting for you to set a snack down for its pet */
  let feedSpot: string | null = null;
  /** a beach snack in hand (from the bag): a tap on your beach tosses it there */
  let snackInHand = false;
  /** set up with the account layer: toss the snack in hand where you tapped, or pick the one that's out back up */
  let tossSnack: (hit: Hit) => void = () => {};
  let pickUpSnack: (how: 'hand' | 'vacuum') => void = () => {};
  /** is the snack that's out under this point of your beach? */
  const snackAt = (hit: Hit | null, reach = ANIMALS.snackReach) =>
    !!hit && hit.target.beachId === shownSnackBeach && isLive(hit.target.beachId) && !awaitingLoad &&
    animals.foodNear(hit.x - picker.offsetX, hit.z, reach);
  let digging = false;
  let strokeOpen = false;
  /** a "before big edit" snapshot has been taken (or tried) since the last save */
  let bigEditSnapshotAttempted = false;
  /** set up once the account layer exists (below): snapshot before a clearing stroke */
  let maybeBigEditSnapshot: () => void = () => {};
  /** a dig stroke's effort, for buried finds: brush travel (m) and when it started */
  let digPathM = 0;
  let digStrokeStart = 0;
  /** last time the app asked the server for a digging roll (the server enforces the same gap) */
  let lastDigFindAttempt = 0;
  /**
   * Every edit names the beach it lands on, by id (docs/BEACH_STORE.md), and
   * where that beach sits along the shore. The one the worker simulates is
   * edited there; any other beach of yours through the store's edit sim.
   */
  type EditTarget = { beachId: string; offsetX: number };
  type Hit = { x: number; y: number; z: number; target: EditTarget };
  type TrailPlacement = ReturnType<typeof rollPlacement>;
  let footprintsStroke: {
    group: string;
    anchorTarget: EditTarget;
    first: TrailPlacement;
    size01: number;
    walk: FootprintStroke;
    undoBeaches: string[];
    liveCount: number;
  } | null = null;
  let footprintStrokeSeq = 0;
  const sameTarget = (a: EditTarget, b: EditTarget) => a.beachId === b.beachId;
  let strokeTarget: EditTarget | null = null;
  /** Each edit can affect one beach or both sides of a seam (beach ids, oldest first). */
  const undoTargets: string[][] = [];
  const redoTargets: string[][] = [];
  const footprintEdits = new WeakSet<string[]>();
  const recordEditTarget = (...targets: EditTarget[]) => {
    const ids = targets.map((t) => t.beachId);
    undoTargets.push(ids);
    if (undoTargets.length > 64) undoTargets.shift();
    redoTargets.length = 0;
    return ids;
  };
  let lastHit: Hit | null = null;
  let hover: Hit | null = null;
  let ringAlpha = 0;
  let lastRing: Hit = { x: 0, y: 0, z: 0, target: { beachId: '', offsetX: 0 } };

  /** the live beach is drawn (on the shore near the view) */
  const liveShown = () => !!sync.id && (neighbors ? neighbors.liveVisible : true);
  const pickAt = (sx: number, sy: number): Hit | null => {
    const ray = cam.ray(sx, sy);
    // (while the worker is still loading a beach, the live renderer shows the last one: no edits through it)
    const liveHit = liveShown() && !awaitingLoad ? picker.pick(ray) : null;
    const ownedHit = neighbors ? neighbors.pickOwned(ray) : null;
    const live = (): Hit | null => (liveHit && sync.id ? { ...liveHit, target: { beachId: sync.id, offsetX: picker.offsetX } } : null);
    const owned = (): Hit | null =>
      ownedHit ? { x: ownedHit.x, y: ownedHit.y, z: ownedHit.z, target: { beachId: ownedHit.beachId, offsetX: ownedHit.offsetX } } : null;
    if (liveHit && ownedHit) {
      const o = ray.origin;
      const dLive = (liveHit.x - o.x) ** 2 + (liveHit.y - o.y) ** 2 + (liveHit.z - o.z) ** 2;
      const dOwned = (ownedHit.x - o.x) ** 2 + (ownedHit.y - o.y) ** 2 + (ownedHit.z - o.z) ** 2;
      return dOwned < dLive ? owned() : live();
    }
    return live() ?? owned();
  };
  const toSim = (p: Hit) => ({
    x: p.x - (p.target.offsetX + ORIGIN_X),
    y: p.z - ORIGIN_Z,
  });

  // ---------------------------------------------------------------- picking things up
  // Long-press on a thing picks it up; drag it, and it goes down where you let
  // go (one undo step). While held, its drawn position follows the finger.
  let press: { sx: number; sy: number; timer: number; mold?: () => void } | null = null;
  let dragging: { id: number; x: number; y: number; source: EditTarget; current: EditTarget; obj: PlacedObject } | null = null;
  /** just let go: keep drawing it there until the worker's next frame has it */
  let settling: { id: number; x: number; y: number; until: number } | null = null;
  /** the thing under the pointer, if any (its footprint, roughly) */
  const thingAt = (sx: number, sy: number): { obj: PlacedObject; target: EditTarget } | null => {
    const hit = pickAt(sx, sy);
    if (!hit) return null;
    const p = toSim(hit);
    if (!isLive(hit.target.beachId)) {
      const obj = neighbors?.ownedObjectAt(hit.target.beachId, p.x, p.y) ?? null;
      return obj ? { obj, target: hit.target } : null;
    }
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
    return best ? { obj: best, target: hit.target } : null;
  };
  /** draw the held thing at the finger (after the worker's positions are applied) */
  const applyDrag = () => {
    if (dragging && isLive(dragging.source.beachId) && isLive(dragging.current.beachId)) {
      const s = objectStates.find((o) => o.id === dragging!.id);
      if (!s) return;
      s.x = dragging.x;
      s.y = dragging.y;
      s.z = picker.heightAt(dragging.x + ORIGIN_X + picker.offsetX, dragging.y + ORIGIN_Z) + 0.12;
      s.floating = false;
      objectView.touch();
      return;
    }
    if (!dragging && settling) {
      const s = objectStates.find((o) => o.id === settling!.id);
      if (!s) return;
      s.x = settling.x;
      s.y = settling.y;
      s.z = picker.heightAt(settling.x + ORIGIN_X + picker.offsetX, settling.y + ORIGIN_Z);
      s.floating = false;
      objectView.touch();
    }
  };

  const finishStrokeTarget = (t: EditTarget) => {
    if (isLive(t.beachId)) {
      send({ type: 'brush', phase: 'end' });
      markDirty();
    } else {
      // a beach next door reports its vacuumed things at the end of the stroke
      const vacuumed = neighbors?.endStroke(t.beachId) ?? [];
      if (vacuumed.length) vacuumedUp(vacuumed);
    }
    recordEditTarget(t);
  };

  const cancelStrokeTarget = (t: EditTarget) => {
    if (isLive(t.beachId)) send({ type: 'brush', phase: 'cancel' });
    else neighbors?.cancelStroke(t.beachId);
  };

  const startDig = (sx: number, sy: number, hit?: Hit) => {
    digging = true;
    strokeOpen = false;
    strokeTarget = null;
    digPathM = 0;
    digStrokeStart = performance.now();
    hover = lastHit = null;
    strokeTo(sx, sy, hit);
  };

  const strokeTo = (sx: number, sy: number, hit = pickAt(sx, sy)) => {
    if (!hit) return;
    // a dig stroke's effort, for buried finds: how far the brush travelled
    if (digging && brushMode === 'dig' && lastHit) {
      digPathM += Math.hypot(hit.x - lastHit.x, hit.z - lastHit.z);
    }
    lastHit = hit;
    const r = cam.brushRadius(hit);
    const s = toSim(hit);
    // Crossing a linked seam between two of your beaches: finish the stroke
    // on the beach you left and begin one seamlessly on the beach you entered.
    if (strokeOpen && strokeTarget && !sameTarget(strokeTarget, hit.target)) {
      finishStrokeTarget(strokeTarget);
      strokeOpen = false;
      strokeTarget = null;
    }
    if (isLive(hit.target.beachId)) {
      // picking up a clearing tool (bulldozer, flatten, vacuum) is the
      // intent to reshape the beach: keep it as it is now first
      // (docs/CHECKPOINTS.md). A clearing stroke on a beach you own next
      // door skips this — the server's save-diff backstop covers it.
      if (!strokeOpen && isClearingMode(brushMode)) maybeBigEditSnapshot();
      send({ type: 'brush', phase: strokeOpen ? 'move' : 'start', x: s.x, y: s.y, r, mode: brushMode });
      // the vacuum takes the beach snack that's out too (back in the bag)
      if (brushMode === 'vacuum' && snackAt(hit, r)) pickUpSnack('vacuum');
    } else if (strokeOpen) {
      neighbors?.moveStroke(hit.target.beachId, s.x, s.y, r);
    } else {
      neighbors?.beginStroke(hit.target.beachId, s.x, s.y, r, brushMode);
    }
    strokeTarget = hit.target;
    strokeOpen = true;
  };

  /** the live beach changed: save it soon (the store saves each beach by id) */
  const markDirty = (delayMs?: number) => sync.markDirty(delayMs);
  /** refresh the bag from the server (set up with the account layer) */
  let refreshOwned: () => void = () => {};

  /**
   * View-only after a takeover (docs/EDIT_SESSIONS.md): another tab or
   * device is editing this beach, so this instance can look, not touch.
   * Set by BeachSync's onFenced handler below; the banner (with its
   * "Take over editing" action) is assigned there too, and digging, picking
   * things up, placing, undo and redo all check this flag first.
   */
  let fenced = false;
  let showFencedBanner: () => void = () => {};

  /**
   * The sea took some of your things (docs/LIVE_SIM.md, section 5): they're
   * already off the roster, so back in the bag. Losses close together share
   * one summary toast, and the beach saves soon so the server agrees.
   */
  let seaTookCount = 0;
  let seaTookTimer = 0;
  const seaTook = (n: number) => {
    seaTookCount += n;
    markDirty(1500);
    window.clearTimeout(seaTookTimer);
    seaTookTimer = window.setTimeout(() => {
      const k = seaTookCount;
      seaTookCount = 0;
      showToast(uiRoot, k === 1 ? 'The sea took 1 thing. It’s back in your bag.' : `The sea took ${k} things. They’re back in your bag.`);
    }, 2500);
  };

  /**
   * The vacuum swept things up — the live beach reports them per frame,
   * a beach next door hands them back when the stroke ends. Sweeps close
   * together share one small toast under the status pane, naming what went.
   */
  let vacuumedNames: string[] = [];
  let vacuumedTimer = 0;
  const vacuumedUp = (items: PlacedObject[]) => noteVacuumed(items.map((o) => prizeName(o.item)));
  const noteVacuumed = (names: string[]) => {
    vacuumedNames.push(...names);
    window.clearTimeout(vacuumedTimer);
    vacuumedTimer = window.setTimeout(() => {
      const names = vacuumedNames;
      vacuumedNames = [];
      if (!names.length) return;
      const text =
        names.length === 1
          ? `Vacuumed up the ${names[0]}`
          : names.length <= 3
            ? `Vacuumed up ${names.join(', ')}`
            : `Vacuumed up ${names.length} things`;
      showPaneToast(placeWrap, text);
    }, 1500);
  };

  /** At the end of a good dig, ask the server whether something was buried there. */
  const tryDigFind = async (pathM: number, durationMs: number) => {
    if (!digFindApi || !digFindApi.signedIn || !digFind) return; // signed out, or the sandbox build
    if (fenced) return; // view-only: digging is off, so there is no roll
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

  const replayEdit = (action: 'undo' | 'redo') => {
    if (fenced) {
      showFencedBanner();
      return;
    }
    footprintsStroke = null;
    const past = action === 'undo' ? undoTargets : redoTargets;
    const future = action === 'undo' ? redoTargets : undoTargets;
    const liveCount = action === 'undo' ? info.undoCount : info.redoCount;
    const targets = past.pop() ?? (sync.id ? [sync.id] : []);
    // Every recorded footprint placement has a worker command ahead of this
    // one. The frame's counts may still precede it when Undo or Redo is quick.
    const grouped = footprintEdits.has(targets);
    if (!targets.length || !targets.every((target) => isLive(target)
      ? grouped || liveCount > 0
      : neighbors?.canReplay(target, action))) return;
    for (const target of targets) {
      if (isLive(target)) {
        markDirty();
        send({ type: action });
      } else {
        neighbors?.[action](target);
      }
    }
    future.push(targets);
    if (action === 'undo') guide.mark('undo');
    audio.whoosh(action === 'undo');
    haptics.impact('medium');
  };
  const undo = () => replayEdit('undo');
  const redo = () => replayEdit('redo');

  // ---------------------------------------------------------------- UI
  const vignette = document.createElement('div');
  vignette.className = 'vignette';
  uiRoot.appendChild(vignette);

  const hud = new Hud(uiRoot, { undo, redo });

  // wave strength (Manage → Settings): calm · gentle · lively · surf
  const waveStrength = (): WaveStrength => settings.waves ?? 'lively';
  const sendWaves = () => send({ type: 'flags', flags: { waveLevel: WAVES.levels[waveStrength()] } });
  sendWaves();

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

  /** The real place whose sky, sun and tide you see: the live beach's (saved with it when you change it). */
  const setBeach = (b: Beach) => {
    if (sync.id) store.setLocation(sync.id, b.id);
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
  // The beach selected *for settings* (set by AccountPanel in production builds).
  let settingsBeachId: () => string | null = () => null;
  let applyPlaceToBeach = (b: Beach) => setBeach(b);
  let petForReminder: Pick<PetDto, 'name' | 'lastFedAt'> | null = null;
  const updatePetReminder = () => {
    const reminder = settings.petReminders && petForReminder ? { ...petForReminder, beachName: beach.name } : null;
    setPetHungerReminder(reminder);
  };
  let smoothSelectedBeach = () => {
    if (!sync.id) return;
    markDirty(1500);
    send({ type: 'reset' });
    recordEditTarget({ beachId: sync.id, offsetX: picker.offsetX });
    audio.whoosh(false);
  };
  const sheet = new SettingsSheet(
    uiRoot,
    settings,
    {
      nearMe: () => {
        void nearbyCoordinates()
          .then(({ latitude, longitude }) => applyPlaceToBeach(nearestBeach(latitude, longitude)))
          .catch(() => { /* denied or unavailable: keep the current beach */ });
      },
      enablePetReminders: account && canSchedulePetReminders() ? requestPetReminderPermission : undefined,
      change: (s, key) => {
        if (key === 'beach') {
          const b = beachById(s.beach);
          if (b) applyPlaceToBeach(b);
          return;
        }
        settings = s;
        saveSettings(settings);
        if (key === 'petReminders') updatePetReminder();
        if (key === 'sound') audio.setSound(s.sound);
        if (key === 'music') audio.setMusic(s.music);
        if (key === 'haptics') haptics.enabled = s.haptics;
        if (key === 'ambient') ambient.setEnabled(s.ambient);
        if (key === 'waves') {
          sendWaves();
          updatePlace(true);
        }
      },
      smooth: () => smoothSelectedBeach(),
      smoothTarget: () => settingsBeachId(),
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
    },
    BEACHES,
    { accounts: ACCOUNTS_ENABLED },
  );
  sheet.setSettings({ ...settings, beach: beach.id });

  // the status pane, top left (shown with the rail): whose beach this is
  // and the weather by default; ⌄ adds the game status and actions while
  // you're away; × tucks it away to an i.
  const placeWrap = document.createElement('div');
  placeWrap.className = 'place-wrap status-pane';
  placeWrap.innerHTML = `
    <div class="sp-card">
      <div class="sp-head">
        <div class="place">
          <a class="sp-shore-link" target="_blank" rel="noopener" hidden></a>
          <button type="button" class="sp-summary" aria-expanded="false" aria-controls="sp-more">
            <b></b><span></span>
          </button>
        </div>
        <button type="button" class="sp-btn sp-toggle" aria-controls="sp-more">${icon('down')}</button>
        <button type="button" class="sp-btn sp-close" aria-label="Close the status pane" title="Close the status pane">${icon('close')}</button>
      </div>
      <div class="sp-more" id="sp-more">
        <p class="sp-detail"></p>
        <div class="sp-chips"></div>
      </div>
    </div>
    <button type="button" class="sp-open" aria-label="Show the status pane" title="Show the status pane"><i>i</i></button>`;
  const place = placeWrap.querySelector<HTMLElement>('.place')!;
  const spSummary = place.querySelector<HTMLButtonElement>('.sp-summary')!;
  const spTitle = spSummary.querySelector('b')!;
  const spWeather = spSummary.querySelector('span')!;
  const spToggle = placeWrap.querySelector<HTMLButtonElement>('.sp-toggle')!;
  const spMore = placeWrap.querySelector<HTMLElement>('.sp-more')!;
  const spDetail = placeWrap.querySelector<HTMLElement>('.sp-detail')!;
  const spChips = placeWrap.querySelector<HTMLElement>('.sp-chips')!;
  const spShoreLink = placeWrap.querySelector<HTMLAnchorElement>('.sp-shore-link')!;
  uiRoot.appendChild(placeWrap);
  type PaneState = 'default' | 'expanded' | 'closed';
  let paneState: PaneState = settings.statusPane ?? 'default';
  const setPane = (state: PaneState) => {
    paneState = state;
    placeWrap.dataset.state = state;
    const expanded = state === 'expanded';
    spSummary.setAttribute('aria-expanded', String(expanded));
    spToggle.setAttribute('aria-expanded', String(expanded));
    spToggle.innerHTML = icon(expanded ? 'up' : 'down');
    const label = expanded ? 'Show less' : 'Show more';
    spToggle.setAttribute('aria-label', label);
    spToggle.title = label;
    spSummary.setAttribute('aria-label', `${label}: beach status`);
    if (settings.statusPane !== state) {
      settings = { ...settings, statusPane: state };
      saveSettings(settings);
    }
    updatePlace(true);
  };
  /** Tried to dig on someone else's beach: expand the pane and pulse the header. */
  const nudgePane = () => {
    setPane('expanded');
    place.classList.remove('nudge');
    void place.offsetWidth;
    place.classList.add('nudge');
  };
  spSummary.addEventListener('click', () => setPane(paneState === 'expanded' ? 'default' : 'expanded'));
  spToggle.addEventListener('click', () => setPane(paneState === 'expanded' ? 'default' : 'expanded'));
  placeWrap.querySelector('.sp-close')!.addEventListener('click', () => setPane('closed'));
  placeWrap.querySelector('.sp-open')!.addEventListener('click', () => setPane('default'));
  /** Whose beach is under the view, with a page link for visiting. */
  let paneOwner: () => { title: string; shoreCode?: string } = () => ({ title: `Your beach · ${beach.name}` });
  /** extra status chips (saved, visiting…): filled in by the account layer */
  let paneChips: () => string[] = () => [];
  const SKY: [number, string][] = [
    [-6, '☾'],
    [6, '◒'],
    [Infinity, '☀'],
  ];
  const swellWord = () => {
    const w = liveState.waves * WAVES.levels[waveStrength()];
    return w < 0.45 ? 'calm sea' : w < 0.85 ? 'gentle swell' : w < 1.15 ? 'lively swell' : 'big surf';
  };
  let placeText = '';
  let placeAt = 0;
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&${({ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' } as Record<string, string>)[c]};`);
  const updatePlace = (force = false) => {
    const t = performance.now();
    if (!force && t - placeAt < 1000) return;
    placeAt = t;
    const owner = paneOwner();
    const sun = viewState.sky.sun.elevation;
    const glyph = SKY.find(([e]) => sun < e)![1];
    const weather = `${glyph} ${viewState.localTime} · ${swellWord()}`;
    const detail = viewConditions.describe(viewState).split(' · ').slice(1).join(' · ');
    const chips = [`wave · ${waveStrength()}`, ...paneChips()];
    const key = JSON.stringify([owner.title, owner.shoreCode, weather, detail, chips]);
    if (key !== placeText) {
      placeText = key;
      spTitle.hidden = !!owner.shoreCode;
      spTitle.textContent = owner.title;
      spShoreLink.hidden = !owner.shoreCode;
      if (owner.shoreCode) {
        spShoreLink.href = shoreBeachUrl(owner.shoreCode);
        spShoreLink.textContent = owner.title;
      } else {
        spShoreLink.removeAttribute('href');
        spShoreLink.textContent = '';
      }
      spWeather.textContent = weather;
      spDetail.textContent = detail;
      spChips.innerHTML = chips.map((c) => `<span>${esc(c)}</span>`).join('');
    }
  };
  updatePlace(true);
  setPane(paneState);
  // the look tool (the hand, the default) only moves the view: pan, zoom,
  // tilt, turn. All dirt work is one rail button (the bulldozer) with a
  // flyout: dig, build up, smooth (the sand modes), flatten, vacuum,
  // bulldozer (the clearing modes), and the two sandcastle molds.
  const DIRT: DirtDef[] = [
    { id: 'dig', icon: 'dig', label: 'Dig' },
    { id: 'pile', icon: 'build', label: 'Build up' },
    { id: 'smooth', icon: 'smooth', label: 'Smooth' },
    { id: 'flatten', icon: 'blade', label: 'Flatten' },
    { id: 'vacuum', icon: 'vacuum', label: 'Vacuum cleaner' },
    { id: 'dozer', icon: 'dozer', label: 'Bulldozer' },
    { id: 'round', icon: 'castleRound', label: 'Round sandcastle', sep: true },
    { id: 'square', icon: 'castleSquare', label: 'Square sandcastle' },
  ];
  /** number keys 1-5: look, dig, build, blend, bulldozer */
  const KEY_TOOLS = ['look', 'dig', 'pile', 'smooth', 'dozer'] as const;
  let tool = 'look';
  let sandMode: SandMode = 'dig';
  let clearingMode: ClearingMode = 'dozer';
  let castleShape: CastleShape = 'round';
  /** the dirt tool the Dirt button picks up again */
  let lastDirt = 'dig';
  /** Minimal: the rail is closed, only the palm shows (and the view only moves) */
  let collapsed = true;
  /** highlight the active tool: the hand, the bag (an item in hand), or a dirt tool */
  const syncToolUI = () =>
    hud.setTool(placing || snackInHand ? 'place' : tool === 'sand' ? sandMode : tool === 'clearing' ? clearingMode : tool === 'castle' ? castleShape : tool);
  const syncLookOnly = () => {
    gestures.tapToPlace = feedSpot !== null;
    gestures.lookOnly = !feedSpot && (collapsed || (!placing && !snackInHand && tool === 'look'));
  };
  const pickTool = (id: string) => {
    if (isSandMode(id)) {
      tool = 'sand';
      sandMode = id;
      brushMode = id;
    } else if (isClearingMode(id)) {
      tool = 'clearing';
      clearingMode = id;
      brushMode = id;
    } else if (id === 'round' || id === 'square') {
      tool = 'castle';
      castleShape = id;
    } else {
      tool = 'look';
    }
    if (tool !== 'look') lastDirt = id;
    placing = null;
    endFeedSpot();
    snackInHand = false;
    footprintsStroke = null;
    inventory.deselect();
    placeBar.show(null, DEFAULT_SIZE);
    syncLookOnly();
    syncToolUI();
    haptics.impact('light');
  };
  hud.setDirt(DIRT, pickTool);
  // the Dirt button picks up the dirt tool you used last; its flyout stays
  // open while a dirt tool is in use (the hand puts them away)
  hud.dirtBtn.addEventListener('click', () => pickTool(lastDirt));
  const moveBtn = hud.button('hand', 'Hand: look around', 'hud-btn hud-tool');
  moveBtn.dataset.tool = 'look';
  moveBtn.addEventListener('click', () => pickTool('look'));

  // the bag: rocks and driftwood (free, unlimited) for now
  const inventory = new InventoryTray((n, l, c) => hud.button(n, l, c), hud.root, ITEMS, (item) => {
    placing = item;
    endFeedSpot();
    snackInHand = false;
    footprintsStroke = null;
    syncLookOnly();
    syncToolUI();
    placeBar.show(item, DEFAULT_SIZE);
    haptics.impact('light');
  });

  // beach files (docs/BEACH_FILE.md): export what's here, import a designed beach
  const myBeachName = () => account?.mine(sync.id)?.name || beach.name;
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
  const moldCastle = (hit: Hit | null) => {
    if (!hit) return;
    const s = toSim(hit);
    if (isLive(hit.target.beachId)) {
      send({ type: 'castle', ...s, shape: castleShape });
      markDirty();
    } else {
      neighbors?.moldCastle(hit.target.beachId, s.x, s.y, castleShape);
    }
    recordEditTarget(hit.target);
    haptics.impact('medium');
  };

  /** Tap with an item in hand: set the item down. Picking things back up is
   * the vacuum's job now — the item tool only places. */
  let fullToastAt = 0;
  const liveOwnedCount = () => info.objects.filter((o) => !o.wild).length;
  const hasRoom = (target: EditTarget, liveCount = 0) => {
    const count = isLive(target.beachId)
      ? Math.max(liveOwnedCount(), liveCount)
      : (neighbors?.ownedCount(target.beachId) ?? MAX_OBJECTS);
    if (count < MAX_OBJECTS) return true;
    haptics.impact('light');
    if (performance.now() - fullToastAt > 4000) {
      fullToastAt = performance.now();
      showToast(uiRoot, `This beach is full: it holds ${MAX_OBJECTS} things. Take some away with the vacuum to put more down.`);
    }
    return false;
  };
  /** Set one item down at a sim point on a beach (live or one of yours
   * beside it). A footprint trail shares one undo step across all its placements. */
  const placeItem = (target: EditTarget, x: number, y: number, r: TrailPlacement, trail?: NonNullable<typeof footprintsStroke>): boolean => {
    if (!placing) return false;
    if (!inventory.canPlace(placing.id)) {
      // all of them are already on the beach
      haptics.impact('light');
      return false;
    }
    if (!hasRoom(target, trail?.liveCount)) return false;
    const { size, variant, angle } = r;
    const obj = { kind: placing.kind, item: placing.id, x, y, size, variant, angle };
    if (isLive(target.beachId)) {
      send({ type: 'placeObject', obj, ...(trail ? { group: trail.group } : {}) });
      if (trail) trail.liveCount = Math.max(liveOwnedCount(), trail.liveCount) + 1;
      markDirty();
    } else {
      if (!neighbors?.placeObject(target.beachId, obj, trail?.group)) return false;
    }
    if (!trail) {
      recordEditTarget(target);
    } else if (!trail.undoBeaches.length) {
      trail.undoBeaches = recordEditTarget(target);
      footprintEdits.add(trail.undoBeaches);
    } else if (!trail.undoBeaches.includes(target.beachId)) {
      trail.undoBeaches.push(target.beachId);
    }
    guide.mark('place');
    if (placing.kind === 'rock' || placing.kind === 'driftwood') audio.thunk(placing.kind === 'rock');
    return true;
  };
  const putDown = (hit: Hit) => {
    if (!placing) return;
    const p = toSim(hit);
    const size01 = sizeOf(placing.id);
    const first = rollPlacement(placing, size01);
    if (placing.id === 'footprints') {
      // Wait for the first stride so the starting trail can face the walk.
      footprintsStroke = {
        group: `footprints-${++footprintStrokeSeq}`,
        anchorTarget: hit.target,
        first,
        size01,
        walk: {
          anchor: { x: hit.x, y: p.y },
          farSide: footprintFarSide(first.variant, false),
          size: first.size,
          count: 1,
        },
        undoBeaches: [],
        liveCount: 0,
      };
    } else if (placeItem(hit.target, p.x, p.y, first)) {
      haptics.impact(placing.kind === 'rock' ? 'medium' : 'light');
    }
  };

  const placeTrail = (trail: NonNullable<typeof footprintsStroke>, target: EditTarget, point: { x: number; y: number }, placement: TrailPlacement) =>
    placeItem(target, point.x - (target.offsetX + ORIGIN_X), point.y, placement, trail);

  /** Keep the path in world X so distances stay continuous at a seam. */
  const dragFootprints = (sx: number, sy: number) => {
    const trail = footprintsStroke;
    const item = placing;
    if (item?.id !== 'footprints' || !trail) return;
    const hit = pickAt(sx, sy);
    if (!hit) return;
    const p = toSim(hit);
    const { anchor } = trail.walk;
    const { placements, stroke } = footprintDrag(trail.walk, { x: hit.x, y: p.y }, trail.size01, (size01) => rollPlacement(item, size01));
    if (!placements.length) return;
    if (!trail.undoBeaches.length) {
      const angle = Math.atan2(p.y - anchor.y, hit.x - anchor.x);
      if (!placeTrail(trail, trail.anchorTarget, anchor, { ...trail.first, angle })) {
        footprintsStroke = null;
        return;
      }
      haptics.impact('light');
    }
    for (const placement of placements) {
      const onTarget = (target: EditTarget) => Math.abs(placement.x - target.offsetX) <= WORLD_SIZE_X / 2;
      const target = onTarget(hit.target) ? hit.target : onTarget(trail.anchorTarget) ? trail.anchorTarget : null;
      if (!target || !placeTrail(trail, target, placement, placement)) {
        footprintsStroke = null;
        return;
      }
      trail.anchorTarget = target;
    }
    trail.walk = stroke;
  };

  const finishFootprints = () => {
    const trail = footprintsStroke;
    footprintsStroke = null;
    if (trail && !trail.undoBeaches.length && placeTrail(trail, trail.anchorTarget, trail.walk.anchor, trail.first)) {
      haptics.impact('light');
    }
  };

  // the rail, top to bottom: inbox (added once signed-in builds load it),
  // hand, dirt · bag, store · view, manage — then undo, then the palm
  hud.group(0).append(moveBtn, hud.dirtBtn);
  hud.group(1).append(inventory.button);
  const storeBtn = hud.button('store', 'Store', 'hud-btn hud-tool');
  storeBtn.dataset.act = 'store';
  if (ACCOUNTS_ENABLED) hud.group(1).append(storeBtn);
  const viewBtn = hud.button('chair', 'View', 'hud-btn hud-tool');
  viewBtn.dataset.act = 'view';
  const viewLabel = document.createElement('span');
  viewLabel.className = 'hud-view-label';
  viewLabel.setAttribute('role', 'status');
  const menuBtn = hud.button('menu', 'Manage', 'hud-btn hud-tool');
  menuBtn.dataset.act = 'manage';
  hud.group(2).append(viewBtn, menuBtn);
  hud.rail.appendChild(viewLabel);
  menuBtn.addEventListener('click', () => sheet.toggleOpen());

  // ambient / TV: controls fade when idle, screen stays awake
  const tv = params.has('tv');
  const ambient = new Ambient();
  ambient.setEnabled(settings.ambient || tv);

  // the view cycles: chair → isometric → reverse isometric (looking back at
  // the beach from the sea) → chair. A label beside the button names it.
  type ViewName = 'chair' | 'iso' | 'reverse';
  const VIEW_NAMES: Record<ViewName, string> = { chair: 'Chair', iso: 'Isometric', reverse: 'Reverse isometric' };
  const VIEW_ICONS: Record<ViewName, IconName> = { chair: 'chair', iso: 'diorama', reverse: 'reverse' };
  const currentView = (): ViewName => (cam.mode === 'chair' ? 'chair' : cam.reversed ? 'reverse' : 'iso');
  let viewLabelTimer = 0;
  const syncViewButton = (announce: boolean) => {
    const v = currentView();
    hud.setIcon(viewBtn, VIEW_ICONS[v]);
    hud.setLabel(viewBtn, `View: ${VIEW_NAMES[v]}`);
    if (!announce) return;
    viewLabel.textContent = VIEW_NAMES[v];
    viewLabel.classList.add('shown');
    window.clearTimeout(viewLabelTimer);
    viewLabelTimer = window.setTimeout(() => viewLabel.classList.remove('shown'), 1800);
  };
  const cycleView = () => {
    const v = currentView();
    if (v === 'chair') {
      cam.setMode('diorama');
      cam.faceShore(false);
    } else if (v === 'iso') {
      cam.faceShore(true);
    } else {
      cam.setMode('chair');
    }
    syncViewButton(true);
    haptics.impact('light');
  };
  viewBtn.addEventListener('click', cycleView);
  syncViewButton(false);

  // Minimal (the default): only the palm. Tapping it opens the rail, with
  // the hand picked every time; the palm turns into a × that closes it all.
  const setCollapsed = (on: boolean) => {
    if (collapsed === on) return;
    collapsed = on;
    uiRoot.classList.toggle('ui-collapsed', on);
    hud.root.classList.toggle('collapsed', on);
    hud.setOpen(!on);
    if (on) {
      inventory.setOpen(false);
      sheet.hide();
    }
    // closing puts the item in hand away; opening always starts on the hand
    pickTool('look');
  };
  hud.palmBtn.addEventListener('click', () => setCollapsed(!collapsed));
  uiRoot.classList.add('ui-collapsed');
  hud.root.classList.add('collapsed');
  hud.setOpen(false);

  // the beach guide (docs/INVITES_GUIDE.md): teaches each mechanic once.
  // Its host is filled in by the account layer below (the sandbox keeps the defaults).
  const guideHost: GuideHost = {
    accounts: ACCOUNTS_ENABLED,
    signedIn: () => false,
    signIn: () => sheet.show('account'),
    load: async () => [],
    complete: async () => {
      throw new Error('sign in first');
    },
    openInvite: () => sheet.show(),
    toast: (t) => showToast(uiRoot, t),
    gifted: () => refreshOwned(),
  };
  // the coach card is onboarding: ?nointro / ?smoke (the test scripts) leave it out, like the start screen
  const guide = new BeachGuide(uiRoot, hud.root, (n, l) => hud.button(n, l), guideHost, !(params.has('smoke') || params.has('nointro')));
  const guideLink = sheet.el.querySelector('[data-act="guide"]')!;
  const helpActions = document.createElement('div');
  helpActions.className = 'row actions';
  guideLink.replaceWith(helpActions);
  helpActions.append(guide.button, guideLink);
  guide.button.addEventListener('click', () => sheet.hide());

  // the shore bar: actions for the beach you're looking at when away from
  // home (leave something, ask to be neighbors, feed pet, star)
  const shoreBar = document.createElement('div');
  shoreBar.className = 'shore-bar';
  shoreBar.innerHTML = `<span class="sb-where"></span><button type="button" class="sb-leave" hidden>leave something</button><button type="button" class="sb-ask" hidden>ask to be neighbors</button><button type="button" class="sb-pet" hidden>Feed pet</button><button type="button" class="sb-fav"></button>`;
  spMore.appendChild(shoreBar);
  const sbWhere = shoreBar.querySelector<HTMLElement>('.sb-where')!;
  const sbLeave = shoreBar.querySelector<HTMLButtonElement>('.sb-leave')!;
  const sbAsk = shoreBar.querySelector<HTMLButtonElement>('.sb-ask')!;
  const sbPet = shoreBar.querySelector<HTMLButtonElement>('.sb-pet')!;
  const sbFav = shoreBar.querySelector<HTMLButtonElement>('.sb-fav')!;
  let shoreKey = '';
  /** opens the visitor card for another beach (filled in once the account layer loads) */
  let leaveBeach: ((b: ShoreBeach) => void) | null = null;
  let askingCode: string | null = null;
  const visitedPetCache = new Map<string, PetDto | null>();
  const visitorFeeds = new Set<string>();
  /** the beach under the view, along the shore (null: one of your own) */
  const beachHere = () => {
    if (!neighbors) return null;
    const b = neighbors.beachAt(neighbors.nearestIndex(cam.focusX));
    return b && !neighbors.isOwned(b) ? b : null;
  };
  const goHome = async () => {
    if (neighbors && neighbors.anchorCode !== null) {
      await neighbors.anchorAt(null);
      cam.goTo(0, true);
    } else {
      cam.goTo(0);
    }
    haptics.impact('light');
  };
  const homeButton = document.createElement('button');
  homeButton.type = 'button';
  homeButton.className = 'shore-home';
  homeButton.dataset.act = 'home';
  homeButton.hidden = true;
  hud.setLabel(homeButton, 'Return to my beach');
  hud.setIcon(homeButton, 'home');
  homeButton.addEventListener('click', () => void goHome());
  uiRoot.appendChild(homeButton);
  sbLeave.addEventListener('click', () => {
    const b = beachHere();
    if (b) leaveBeach?.(b);
  });
  sbAsk.addEventListener('click', () => {
    if (!neighbors) return;
    const idx = neighbors.nearestIndex(cam.focusX);
    const b = neighbors.beachAt(idx);
    if (!b || !neighbors.askSideAt(idx)) return;
    askingCode = b.code;
    sbAsk.disabled = true;
    void neighbors
      .askAt(idx)
      .then((status) => {
        if (status) {
          sbAsk.textContent = status === 'linked' ? 'neighbors now' : 'asked ✓';
          showToast(uiRoot, status === 'linked' ? `You and ${b.name || 'them'} are neighbors now` : `Asked ${b.name || 'them'} to be neighbors`);
        }
      })
      .catch((err: unknown) => {
        sbAsk.disabled = false;
        showToast(uiRoot, err instanceof Error ? err.message : 'Could not ask');
      })
      .finally(() => {
        askingCode = null;
        shoreKey = '';
      });
  });
  sbFav.addEventListener('click', () => {
    if (ACCOUNTS_ENABLED && !account?.user) return sheet.show('account'); // stars need an account
    const b = beachHere();
    if (b && neighbors) void neighbors.toggleFavorite(b).catch(() => {});
  });
  const petLabel = (p: PetDto | null | undefined) => (p?.name ? `Feed ${p.name}` : 'Feed pet');
  const endFeedSpot = () => {
    if (!feedSpot) return;
    feedSpot = null;
    sbPet.classList.remove('on');
    sbPet.textContent = petLabel(visitedPetCache.get(beachHere()?.code ?? ''));
    syncLookOnly();
  };
  // Feed pet: pick the spot, then the snack goes down where you tap their sand
  sbPet.addEventListener('click', () => {
    if (feedSpot) {
      endFeedSpot();
      return;
    }
    const b = beachHere();
    if (!b || !animalsApi || visitorFeeds.has(b.code)) return;
    if (!animalsApi.signedIn) {
      showToast(uiRoot, 'Sign in to feed pets.');
      return;
    }
    feedSpot = b.code;
    placing = null;
    snackInHand = false;
    footprintsStroke = null;
    inventory.deselect();
    placeBar.show(null, DEFAULT_SIZE);
    syncToolUI();
    sbPet.classList.add('on');
    sbPet.textContent = 'cancel';
    syncLookOnly();
    haptics.impact('light');
  });
  /** a tap while setting a snack down: put it on their sand and feed their pet */
  const dropVisitSnack = (sx: number, sy: number) => {
    if (cam.animating) return;
    const b = beachHere();
    if (!b || b.code !== feedSpot || !neighbors || !animalsApi?.signedIn || visitorFeeds.has(b.code)) {
      endFeedSpot();
      return;
    }
    const hit = neighbors.pickBeach(cam.ray(sx, sy), b.id);
    const code = b.code;
    const pet = visitedPetCache.get(code);
    if (!hit || !pet || visitPetCode !== code || visitAnimals.snapshot().food.active ||
        neighbors.waterAtWorld(hit.x, hit.z) > ANIMALS.snackMaxWaterDepth ||
        !visitAnimals.dropFood(visitEnv, { x: hit.x - hit.offsetX, z: hit.z })) return;
    visitorFeeds.add(code);
    endFeedSpot();
    sbPet.disabled = true;
    haptics.impact('light');
    void animalsApi
      .feedVisitorPet(code)
      .then((res) => {
        if (res.usedFood) refreshOwned();
        visitedPetCache.set(code, res.pet);
        if (visitPetCode === code) visitAnimals.setPet(res.pet, visitEnv);
        showToast(uiRoot, res.pet.name ? `Fed ${res.pet.name}!` : 'Fed their sand crab!');
      })
      .catch((err: unknown) => {
        if (visitPetCode === code) {
          visitAnimals.takeFood();
          visitAnimals.setPet(pet, visitEnv);
        }
        showToast(uiRoot, err instanceof Error ? err.message : 'Could not feed pet.');
      })
      .finally(() => {
        visitorFeeds.delete(code);
        shoreKey = '';
      });
  };
  /** per frame: show the pet of the other beach under the view, walking its sand */
  const updateVisitPet = (dt: number) => {
    const here = beachHere();
    const pet = here ? visitedPetCache.get(here.code) : undefined;
    const code = here && pet ? here.code : null;
    if (code !== visitPetCode) {
      visitAnimals.despawnNow();
      visitAnimals.takeFood();
      visitAnimals.setPet(null);
      visitPetCode = code;
      if (code && pet && neighbors) {
        visitPetX = neighbors.xFor(neighbors.nearestIndex(cam.focusX));
        visitAnimals.setPet({ species: pet.species, name: pet.name, mood: pet.mood }, visitEnv);
      }
    }
    if (visitPetCode && neighbors) {
      visitPetX = neighbors.xFor(neighbors.nearestIndex(cam.focusX));
      visitAnimals.update(dt, visitEnv);
      if (!visitView && !visitViewLoading) {
        visitViewLoading = true;
        void import('./render/animals').then(({ AnimalView: View }) => {
          visitView = new View(scene, renderer);
        });
      }
    }
    if (visitView) {
      visitView.offsetX = visitPetX;
      visitView.update(visitAnimals.snapshot(), !!visitPetCode);
    }
  };
  const updateShoreBar = () => {
    const away = !!neighbors && neighbors.away;
    const idx = neighbors ? neighbors.nearestIndex(cam.focusX) : 0;
    const here = beachHere();
    const b = away ? here : null;
    const fav = !!b && !!neighbors?.favorites.has(b.code);
    const signedIn = !!account?.user;
    const isMine = !!b && (!!neighbors?.ownedBeach(b) || b.code === neighbors?.state?.code);
    const canLeave = !!b && !!leaveBeach && !isMine;
    const askSide = b && neighbors ? neighbors.askSideAt(idx) : null;
    if (feedSpot && (!signedIn || b?.code !== feedSpot)) endFeedSpot();
    const key = `${away}|${here?.code}|${here?.name}|${fav}|${!!neighbors?.visiting}|${signedIn}|${canLeave}|${askSide}|${askingCode === b?.code}|${feedSpot}`;
    if (key === shoreKey) return;
    shoreKey = key;
    shoreBar.classList.toggle('shown', away);
    homeButton.hidden = !away;
    if (b) guide.mark('visit');
    guide.render();
    const placeBeach = b?.location ? beachById(b.location) : undefined;
    sbWhere.textContent = b ? `${neighbors?.visiting ? 'Visiting ' : ''}${b.name || 'a beach'}${placeBeach ? ` · ${placeBeach.name}` : ''}` : 'Down the shore';
    updatePlace(true);
    sbLeave.hidden = !canLeave;
    if (b) sbLeave.dataset.act = `leave-${b.code}`;
    else delete sbLeave.dataset.act;
    sbAsk.hidden = !askSide;
    if (askSide && askingCode !== b?.code) {
      sbAsk.textContent = 'ask to be neighbors';
      sbAsk.disabled = false;
      sbAsk.title = `Ask ${b?.name || 'them'} to move in on your ${askSide}`;
    }
    sbFav.hidden = !b || !signedIn || !!neighbors?.ownedBeach(b);
    sbFav.textContent = fav ? '★' : '☆';
    sbFav.classList.toggle('on', fav);
    sbFav.setAttribute('aria-label', fav ? 'Remove from favorites' : 'Add to favorites');
    sbPet.hidden = true;
    sbPet.disabled = !!b && visitorFeeds.has(b.code);
    sbPet.classList.toggle('on', !!feedSpot);
    if (b && animalsApi) {
      const cached = visitedPetCache.get(b.code);
      if (cached !== undefined) {
        if (cached) {
          sbPet.textContent = feedSpot ? 'cancel' : petLabel(cached);
          sbPet.hidden = false;
        }
      } else {
        const code = b.code;
        visitedPetCache.set(code, null); // one look per beach while it's being fetched
        void animalsApi
          .getBeachPet(code)
          .then((r) => {
            visitedPetCache.set(code, r.pet);
            if (beachHere()?.code === code && r.pet) {
              sbPet.textContent = feedSpot ? 'cancel' : petLabel(r.pet);
              sbPet.hidden = false;
            }
          })
          .catch(() => visitedPetCache.delete(code));
      }
    }
  };

  // the status pane's first line: whose beach is under the view
  paneOwner = () => {
    const away = !!neighbors && neighbors.away;
    const here = neighbors?.beachAt(neighbors.nearestIndex(cam.focusX));
    if (away && here) {
      const loc = here.location ? beachById(here.location) : undefined;
      const whose = here.beachName || `${here.name || 'Someone'}’s beach`;
      return { title: `${whose}${loc ? ` · ${loc.name}` : ''}`, shoreCode: here.code };
    }
    if (away) return { title: 'Down the shore' };
    const own = here ? neighbors?.ownedBeach(here) : undefined;
    if (own) {
      const locId = own.location || here?.location;
      const loc = locId ? beachById(locId) : undefined;
      return { title: `${own.name || 'Your beach'}${loc ? ` · ${loc.name}` : ''}` };
    }
    const mine = account?.mine(sync.id)?.name;
    return { title: `${mine || 'Your beach'} · ${beach.name}` };
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
    if (chair) guide.mark('chair');
    renderer.setChairView(chair);
    neighbors?.setChairView(chair);
    horizon.setEnabled(chair);
    walkGroup.classList.toggle('shown', chair);
    hud.root.classList.toggle('chair', chair);
    syncViewButton(false);
    haptics.impact('light');
  });

  const begin = () => {
    audio.start();
  };
  const skipIntro = params.has('smoke') || params.has('nointro');
  const start = skipIntro ? null : new StartScreen(uiRoot, begin, isTouch);

  const gestures = new Gestures(canvas, cam, {
    tap: dropVisitSnack,
    digStart: (sx, sy) => {
      if (cam.animating) return;
      const hit = pickAt(sx, sy);
      if (!hit) {
        if (neighbors && neighbors.viewing) nudgePane();
        return;
      }
      if (fenced) {
        showFencedBanner();
        return;
      }
      inventory.setOpen(false);
      if (snackInHand) {
        tossSnack(hit);
        return;
      }
      if (placing) {
        putDown(hit);
        return;
      }
      // pressing on the snack that's out: hold still to pick it back up
      if (snackAt(hit)) {
        press = {
          sx,
          sy,
          ...(tool === 'castle' ? { mold: () => moldCastle(hit) } : {}),
          timer: window.setTimeout(() => {
            press = null;
            if (snackAt(hit)) pickUpSnack('hand');
          }, LONG_PRESS_MS),
        };
        return;
      }
      if (tool === 'castle') {
        moldCastle(hit);
        return;
      }
      // pressing on a thing: hold still to pick it up (a move or a quick tap digs)
      const found = thingAt(sx, sy);
      if (found) {
        const { obj, target } = found;
        press = {
          sx,
          sy,
          timer: window.setTimeout(() => {
            press = null;
            dragging = { id: obj.id, x: obj.x, y: obj.y, source: target, current: target, obj };
            if (!isLive(target.beachId)) neighbors?.previewDrag(target.beachId, obj.id, obj.x, obj.y);
            haptics.impact('medium');
          }, LONG_PRESS_MS),
        };
        return;
      }
      startDig(sx, sy);
    },
    digMove: (sx, sy) => {
      if (placing?.id === 'footprints' && footprintsStroke) {
        dragFootprints(sx, sy);
        return;
      }
      if (press) {
        // moved before the long-press: it's a dig after all
        if (Math.hypot(sx - press.sx, sy - press.sy) > HOLD_SLOP_PX) {
          const p = press;
          window.clearTimeout(p.timer);
          press = null;
          if (p.mold) p.mold();
          else {
            startDig(p.sx, p.sy);
            strokeTo(sx, sy);
          }
        }
        return;
      }
      if (dragging) {
        const hit = pickAt(sx, sy);
        if (hit) {
          const p = toSim(hit);
          dragging.x = p.x;
          dragging.y = p.y;
          dragging.current = hit.target;
          if (!isLive(dragging.source.beachId) && sameTarget(dragging.source, hit.target)) {
            neighbors?.previewDrag(dragging.source.beachId, dragging.id, p.x, p.y);
          } else {
            applyDrag();
          }
        }
        return;
      }
      if (digging) strokeTo(sx, sy);
    },
    digEnd: () => {
      finishFootprints();
      if (press) {
        // a quick tap on a thing: dig there, as a tap anywhere else does
        const p = press;
        window.clearTimeout(p.timer);
        press = null;
        if (p.mold) p.mold();
        else startDig(p.sx, p.sy);
      }
      if (dragging) {
        const d = dragging;
        dragging = null;
        const srcLive = isLive(d.source.beachId);
        const dstLive = isLive(d.current.beachId);
        if (!srcLive) neighbors?.previewDrag(d.source.beachId, null);
        if (sameTarget(d.source, d.current)) {
          if (srcLive) {
            // (a few frames at most: the worker's own position takes over)
            settling = { id: d.id, x: d.x, y: d.y, until: performance.now() + 400 };
            send({ type: 'moveObject', id: d.id, x: d.x, y: d.y });
            markDirty();
          } else {
            neighbors?.moveObject(d.source.beachId, d.id, d.x, d.y);
          }
          recordEditTarget(d.source);
        } else {
          // across a seam: off one beach, onto the other (each by id)
          const nv = neighbors;
          if (!hasRoom(d.current)) return;
          const placedObj: Omit<PlacedObject, 'id'> = {
            kind: d.obj.kind,
            item: d.obj.item,
            x: d.x,
            y: d.y,
            size: d.obj.size,
            angle: d.obj.angle,
            variant: d.obj.variant,
            ...(d.obj.found || d.obj.wild ? { found: true } : {}),
          };
          if (!srcLive && !nv?.hasOwnedObject(d.source.beachId, d.id)) return;
          if (srcLive && !info.objects.some((obj) => obj.id === d.id)) return;
          if (!dstLive && !nv?.placeObject(d.current.beachId, placedObj)) return;
          if (srcLive) {
            send({ type: 'removeObject', id: d.id });
            markDirty();
          } else {
            nv?.removeObject(d.source.beachId, d.id);
          }
          if (dstLive) {
            send({ type: 'placeObject', obj: placedObj });
            markDirty();
          }
          recordEditTarget(d.source, d.current);
        }
        haptics.impact('light');
        return;
      }
      const wasDig = strokeOpen && brushMode === 'dig';
      if (strokeOpen && brushMode === 'dig') guide.mark('dig');
      if (strokeOpen && brushMode === 'pile') guide.mark('pile');
      const pathM = digPathM;
      const durationMs = performance.now() - digStrokeStart;
      if (strokeOpen && strokeTarget) {
        finishStrokeTarget(strokeTarget);
      }
      digging = false;
      strokeOpen = false;
      strokeTarget = null;
      if (wasDig) {
        unlockSteamAchievement('FIRST_DIG');
        void tryDigFind(pathM, durationMs);
      }
    },
    grabAt: (sx, sy) => {
      // look mode: a long-press on a thing picks it up (on any of your visible beaches)
      if (fenced) return false;
      if (snackAt(pickAt(sx, sy))) {
        pickUpSnack('hand');
        return false;
      }
      const found = thingAt(sx, sy);
      if (!found) return false;
      const { obj, target } = found;
      dragging = { id: obj.id, x: obj.x, y: obj.y, source: target, current: target, obj };
      if (!isLive(target.beachId)) neighbors?.previewDrag(target.beachId, obj.id, obj.x, obj.y);
      haptics.impact('medium');
      return true;
    },
    digCancel: () => {
      footprintsStroke = null;
      if (press) {
        window.clearTimeout(press.timer);
        press = null;
      }
      // a second finger mid-drag: put it back where it was
      if (dragging && !isLive(dragging.source.beachId)) neighbors?.previewDrag(dragging.source.beachId, null);
      dragging = null;
      if (strokeOpen && strokeTarget) cancelStrokeTarget(strokeTarget);
      digging = false;
      strokeOpen = false;
      strokeTarget = null;
    },
    hover: (sx, sy) => {
      hover = pickAt(sx, sy);
    },
    hoverEnd: () => {
      hover = null;
    },
    undo,
    redo,
    tool: (i) => {
      if (!KEY_TOOLS[i]) return;
      if (collapsed) setCollapsed(false);
      pickTool(KEY_TOOLS[i]);
    },
    view: () => cycleView(),
    toggleCollapse: () => setCollapsed(!collapsed),
    exitCollapse: endFeedSpot,
    interacted: () => {
      // any input (including when there is no start screen) unlocks audio
      if (!start?.visible) audio.start();
    },
  });
  gestures.lookOnly = true;

  const gamepad = new GamepadController(canvas, cam, {
    digStart: (sx, sy) => {
      if (cam.animating) return;
      if (feedSpot) {
        dropVisitSnack(sx, sy);
        return;
      }
      if (fenced) return;
      const hit = pickAt(sx, sy);
      if (!hit) return;
      if (snackInHand) {
        tossSnack(hit);
        return;
      }
      if (placing) {
        putDown(hit);
        return;
      }
      if (tool === 'castle') {
        moldCastle(hit);
        return;
      }
      startDig(sx, sy);
    },
    digMove: (sx, sy) => {
      if (footprintsStroke) dragFootprints(sx, sy);
      else if (digging) strokeTo(sx, sy);
    },
    digEnd: () => {
      finishFootprints();
      const wasDig = strokeOpen && brushMode === 'dig';
      const pathM = digPathM;
      const durationMs = performance.now() - digStrokeStart;
      if (strokeOpen && strokeTarget) {
        finishStrokeTarget(strokeTarget);
      }
      digging = false;
      strokeOpen = false;
      strokeTarget = null;
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
      if (collapsed) setCollapsed(false);
      const ids = ['look', ...DIRT.map((d) => d.id)];
      const now = tool === 'sand' ? sandMode : tool === 'clearing' ? clearingMode : tool === 'castle' ? castleShape : 'look';
      const current = Math.max(0, ids.indexOf(now));
      pickTool(ids[(current + delta + ids.length) % ids.length]);
    },
    toggleView: () => cycleView(),
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
    const radius = cam.brushRadius(lastRing);
    if (isLive(lastRing.target.beachId)) {
      renderer.setBrush(lastRing.x, lastRing.z, radius, ringAlpha, palette.foam);
      neighbors?.setBrush(null, 0, 0, 1, 0, palette.foam);
    } else {
      renderer.setBrush(0, 0, 1, 0, palette.foam);
      neighbors?.setBrush(lastRing.target.beachId || null, lastRing.x, lastRing.z, radius, ringAlpha, palette.foam);
    }
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

  // ---------------------------------------------------------------- where the waves run
  // No current beach (docs/BEACH_STORE.md): the worker simulates the beach of
  // yours nearest the centre of the view, and moves when the view settles on
  // another one. Never mid-stroke or mid-drag; one move at a time.
  let binding = false;
  let openingShore = false;
  const bindLive = (ref: BeachRef | null) => {
    if (binding) return;
    binding = true;
    void sync.bind(ref, { adoptLocal: true }).finally(() => (binding = false));
  };
  /** put the live renderer, its picker, things and animals at this place along the shore */
  const placeLive = (x: number) => {
    if (picker.offsetX === x && renderer.offsetX === x) return;
    renderer.setOffsetX(x);
    picker.offsetX = x;
    objectView.setOffsetX(x);
    if (animalView) animalView.offsetX = x;
  };
  const chooseLive = () => {
    const nv = neighbors;
    if (!nv) return;
    if (sync.id) {
      const x = nv.xForBeach(sync.id);
      if (x !== null) placeLive(x);
    }
    if (openingShore || binding || awaitingLoad || digging || dragging || strokeOpen || press || footprintsStroke) return;
    const near = nv.ownedNearest(cam.focusX);
    if (!near || near.beach.id === sync.id || releasing.has(near.beach.id)) return;
    // the live one is off this shore (or out of view): take the one in view at once;
    // else only once the view is well onto the other beach
    const liveOnShore = sync.id !== null && nv.liveVisible;
    if (liveOnShore && near.dist > BEACH_STORE.liveSwitchM) return;
    // (signed in, the device's own beach is the last person's leftovers on a stale shore: not yours to simulate)
    if (near.beach.id === LOCAL_BEACH && (account?.user || (!store.has(LOCAL_BEACH) && sync.id !== null))) return;
    bindLive(nv.refOf(near.beach));
  };
  // this device's own beach goes in first (the sandbox keeps it between visits; signing in moves on from it)
  void sync.bind({ id: LOCAL_BEACH, owned: true });
  /** beaches being removed: the view mustn't put the waves back on them */
  const releasing = new Set<string>();
  /** the worker's first frame of the bound beach arrived: draw it where it belongs */
  const liveArrived = () => {
    const id = sync.id;
    // the waves moved onto a beach drawn as a snapshot: ease from its water, not a one-frame swap
    if (id && neighbors?.showsSnapshot(id)) renderer.easeFromStatic(BEACH_STORE.liveEaseMs);
    neighbors?.setLive(id, renderer);
    const x = id && neighbors ? neighbors.xForBeach(id) : 0;
    placeLive(x ?? 0);
  };
  sync.onBound((id) => {
    hideSnack();
    if (!id) liveArrived();
    // the sky, sun and tide are the live beach's place
    const loc = id ? beachById(store.peek(id)?.location) : undefined;
    if (loc && loc.id !== beach.id && !params.get('beach')) setBeach(loc);
  });

  // ---------------------------------------------------------------- main loop
  let last = performance.now();
  const t0 = last;
  let skip = false;
  const right = new Vector3();
  let liveAt = -Infinity;
  let liveFixed: string | undefined;
  let liveBeachId = '';
  /** each other place's light along the shore, refreshed like the live one */
  const placeLights = new Map<string, { lc: LiveConditions; state: LiveState | null; at: number; fixed?: string }>();
  const conditionsAt = (loc: Beach, now0: Date, nowMs: number, fixed: string | undefined) => {
    if (loc.id === beach.id) return { lc: live, state: liveState };
    let e = placeLights.get(loc.id);
    if (!e) placeLights.set(loc.id, (e = { lc: new LiveConditions(loc), state: null, at: -Infinity }));
    if (!e.state || Math.abs(nowMs - e.at) >= 500 || e.fixed !== fixed) {
      e.state = e.lc.compute(now0, fixed);
      e.at = nowMs;
      e.fixed = fixed;
    }
    return { lc: e.lc, state: e.state };
  };
  /** the real place of a beach on the shore (one not placed yet shares the live beach's) */
  const placeOf = (b: ShoreBeach): Beach => beachById(store.peek(b.id)?.location ?? b.location) ?? beach;
  let lastMix: { a: LiveState; b: LiveState; t: number; out: LiveState } | null = null;
  /** the light under the middle of the view (local weather), else the live beach's */
  const updateViewLight = (now0: Date, nowMs: number, fixed: string | undefined) => {
    const nv = neighbors;
    const mix = nv && !params.get('beach')
      ? shoreLightMix(cam.focusX, nv.drawnBeaches().map((d) => ({ x: d.x, location: placeOf(d.beach).id })))
      : null;
    if (!mix) {
      viewState = liveState;
      viewConditions = live;
      return;
    }
    const a = conditionsAt(beachById(mix.a) ?? beach, now0, nowMs, fixed);
    const b = mix.t > 0 ? conditionsAt(beachById(mix.b) ?? beach, now0, nowMs, fixed) : a;
    viewConditions = mix.t < 0.5 ? a.lc : b.lc;
    if (lastMix && lastMix.a === a.state && lastMix.b === b.state && lastMix.t === mix.t) {
      viewState = lastMix.out;
      return;
    }
    viewState = mixLive(a.state, b.state, mix.t);
    lastMix = { a: a.state, b: b.state, t: mix.t, out: viewState };
  };
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

  const tickFrame = () => {
    const now = performance.now();
    if (settings.batterySaver) {
      skip = !skip;
      if (skip) return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const now0 = clockNow();
    const nowMs = now0.getTime();
    const fixed = fixedPalette ?? (settings.localWeather ? undefined : settings.palette);
    if (Math.abs(nowMs - liveAt) >= 500 || fixed !== liveFixed || beach.id !== liveBeachId) {
      liveState = live.compute(now0, fixed);
      liveAt = nowMs;
      liveFixed = fixed;
      liveBeachId = beach.id;
    }
    updateViewLight(now0, nowMs, fixed);
    if (now - seaSentAt > 2000) {
      seaSentAt = now;
      sendSea();
    }
    updatePlace();
    if (!noRender && !document.hidden && !params.has('fixedres')) adaptResolution(dt);

    const palette = viewState.palette;
    gamepad.poll(dt);
    cam.update(dt, gestures.cameraActive);
    updateRing(dt, palette);
    updateSteamRichPresence(beach.name, cam.mode);
    if (cam.mode === 'chair') unlockSteamAchievement('CHAIR_VIEW');
    if (viewState.sky.night > 0.5) unlockSteamAchievement('NIGHT_BEACH');
    if (neighbors && !neighbors.anyOwnVisible) unlockSteamAchievement('WALK_SHORE');
    chooseLive();
    // every edit, on any beach, is in the undo order (each beach keeps its own history)
    hud.setUndoState(Math.max(undoTargets.length, info.undoCount), Math.max(redoTargets.length, info.redoCount));
    applyUiColors(palette);

    if (pendingBuf) {
      const buf = pendingBuf;
      pendingBuf = null;
      picker.updateFromFrame(buf);
      if (!noRender) renderer.uploadFrame(buf);
      send({ type: 'return', buf }, [buf.buffer]);
    }

    const mix = Math.min(1, (now - frameAt) / (1000 / SIM_HZ));
    renderer.setFrameMix(mix);
    const simTime = prevT + (info.t - prevT) * mix;
    const amp = info.waveMul * liveState.waves;
    const camFwd = cam.forward();
    renderer.update(palette, camFwd, (now - t0) / 1000, simTime, info.tide, amp);
    neighbors?.update(palette, camFwd, (now - t0) / 1000, simTime, info.tide, amp);
    // the live beach is drawn while it's near the view
    const ownShown = liveShown();
    renderer.setVisible(ownShown);
    objectView.setVisible(ownShown);
    updateShoreBar();
    if (cam.mode === 'chair') {
      // the static shore starts where the drawn beaches end
      horizon.setExtent(neighbors?.windowCenters() ?? [0]);
      horizon.update(palette, camFwd, simTime, info.tide, amp);
    }
    const sk = viewState.sky;
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
      animalBrush.x = lastHit.x - picker.offsetX;
      animalBrush.z = lastHit.z;
    }
    showLiveSnack();
    if (animals.snapshot().active) syncAnimalObstacles();
    animals.update(dt, animalEnv);
    const animalSnap = animals.snapshot();
    if (shownSnackBeach && !animalSnap.food.active) {
      droppedSnacks.delete(shownSnackBeach);
      shownSnackBeach = null;
    }
    if (animalSnap.active || animalSnap.food.active) ensureAnimalView();
    animalView?.update(animalSnap, ownShown);
    updateVisitPet(dt);
    if (digging) haptics.dig(info.digIntensity);
    cam.camera.getDirectionToRef(Vector3.Right(), right);
    audio.update(dt, {
      swashRate,
      dig: digging ? info.digIntensity : 0,
      seaPan: -right.z,
      zoomOut: cam.zoomOut01(),
      calm: Math.min(1, Math.max(0, (1 - info.waveMul) / (1 - WAVES.levels.calm))),
      daylight: 1 - viewState.sky.night,
    });

    if (noRender) {
      // Keep camera & scene transform matrices fresh on CPU for ray picking
      // and world-to-screen projection without triggering SwiftShader WebGL draws.
      scene.activeCamera?.getViewMatrix(true);
      scene.activeCamera?.getProjectionMatrix(true);
      scene.updateTransformMatrix();
    } else {
      scene.render();
    }
  };

  if (!noRender) engine.runRenderLoop(tickFrame);

  const onResize = () => {
    engine.resize();
    cam.onResize();
  };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  // ---------------------------------------------------------------- accounts
  let animalsApi: AnimalsApi | null = null;
  if (account) {
    animalsApi = new AnimalsApi(account);
    const applyPet = (pet: { species: 'crab'; name: string; mood: 'happy' | 'peckish' | 'hungry' | 'sleepy'; lastFedAt: number } | null) => {
      syncAnimalObstacles();
      animals.setPet(pet ? { species: pet.species, name: pet.name, mood: pet.mood } : null, animalEnv);
      petForReminder = pet && { name: pet.name, lastFedAt: pet.lastFedAt };
      if (settings.petReminders) updatePetReminder();
    };
    const refreshPet = () => {
      const userId = account.user?.id;
      if (!animalsApi?.signedIn || !userId) {
        applyPet(null);
        return;
      }
      // the pet of the live beach (the beach of yours in front of you)
      const bId = sync.id && sync.id !== LOCAL_BEACH ? sync.id : undefined;
      if (!bId) {
        applyPet(null);
        return;
      }
      void animalsApi
        .getPet(bId)
        .then((r) => {
          if (account.user?.id !== userId || sync.id !== bId) return;
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
      if (!liveShown() || !sync.id || sync.id === LOCAL_BEACH) {
        showToast(uiRoot, 'Head back to your beach first.');
        return;
      }
      const activeBeachId = sync.id;
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
      // a snack in hand: tap your beach to toss it there
      endFeedSpot();
      placing = null;
      footprintsStroke = null;
      inventory.deselect();
      snackInHand = true;
      syncLookOnly();
      syncToolUI();
      placeBar.showSnack('Beach snacks', inventory.ownedCount('crab-treat'));
      haptics.impact('light');
    };
    let snackBusy = false;
    tossSnack = (hit) => {
      if (snackBusy) return;
      if (!animalsApi?.signedIn || !isLive(hit.target.beachId) || awaitingLoad || !sync.id || sync.id === LOCAL_BEACH) {
        showToast(uiRoot, 'Head back to your beach first.');
        return;
      }
      // tapping the snack that's out picks it back up
      if (snackAt(hit)) {
        pickUpSnack('hand');
        return;
      }
      const pos = { x: hit.x - picker.offsetX, z: hit.z };
      if (animalEnv.waterAt(pos.x, pos.z) > ANIMALS.snackMaxWaterDepth) {
        haptics.impact('light');
        showToast(uiRoot, 'Too wet here.');
        return;
      }
      const beachId = sync.id;
      const expiresAt = Date.now() + ANIMALS.foodDuration * 1000;
      snackBusy = true;
      void animalsApi
        .feed(beachId)
        .then((res) => {
          droppedSnacks.set(beachId, { ...pos, expiresAt });
          if (isLive(beachId)) {
            hideSnack();
            showLiveSnack();
          }
          refreshOwned();
          haptics.impact('light');
          if (snackInHand) {
            if (res.remaining > 0) placeBar.showSnack('Beach snacks', res.remaining);
            else pickTool(tool);
          }
          if (res.pet) {
            if (isLive(beachId)) applyPet(res.pet);
            showToast(uiRoot, res.pet.name ? `Fed ${res.pet.name}!` : 'Fed your sand crab!');
          } else if (res.bond?.ready) {
            showActionToast(uiRoot, 'A wild sand crab wants to stay on your beach!', 'Adopt', () => {
              void animalsApi
                ?.adoptPet({ mode: 'befriend', beachId })
                .then((pet) => {
                  droppedSnacks.delete(beachId);
                  if (shownSnackBeach === beachId) hideSnack();
                  if (isLive(beachId)) applyPet(pet);
                  haptics.impact('medium');
                  showToast(uiRoot, 'Your new sand crab moved in!');
                })
                .catch((err: unknown) => showToast(uiRoot, err instanceof Error ? err.message : 'Could not adopt pet.'));
            });
          }
        })
        .catch((err: unknown) => {
          showToast(uiRoot, err instanceof Error ? err.message : 'No beach snacks left.');
        })
        .finally(() => {
          snackBusy = false;
        });
    };
    pickUpSnack = (how) => {
      const beachId = shownSnackBeach;
      if (snackBusy || fenced || awaitingLoad || !animalsApi?.signedIn || !beachId || !isLive(beachId)) return;
      const snack = droppedSnacks.get(beachId);
      if (!snack || !animals.snapshot().food.active) return;
      droppedSnacks.delete(beachId);
      hideSnack();
      snackBusy = true;
      haptics.impact('light');
      void animalsApi
        .returnSnack(beachId)
        .then((res) => {
          refreshOwned();
          if (res.pet && isLive(beachId)) applyPet(res.pet);
          if (snackInHand) placeBar.showSnack('Beach snacks', res.remaining);
          if (how === 'vacuum') noteVacuumed(['beach snack']);
          else showPaneToast(placeWrap, 'Beach snack back in your bag');
        })
        .catch((err: unknown) => {
          // A conflict means the server no longer has a snack to return.
          if ((err as { status?: number } | null)?.status !== 409) droppedSnacks.set(beachId, snack);
          showToast(uiRoot, err instanceof Error ? err.message : 'Couldn’t pick up the snack.');
        })
        .finally(() => {
          snackBusy = false;
        });
    };
    const s = sync;
    sync.onBound(() => refreshPet());
    // an app older than the server's data can't save: say so, once, with a reload
    store.onState((st) => {
      if (st === 'outdated') offerReload();
    });
    // another tab or device took over editing: this one is view-only, with
    // a way back — the banner stays up until editing is taken over here
    let fencedHide: (() => void) | null = null;
    showFencedBanner = () => {
      fencedHide?.();
      fencedHide = showActionToast(
        uiRoot,
        'Another tab or device is editing this beach — you’re viewing it.',
        'Take over editing',
        () => {
          void s
            .takeOver()
            .then(() => {
              fenced = false;
              fencedHide?.();
              fencedHide = null;
              showToast(uiRoot, 'You’re editing this beach here now.');
            })
            .catch(() => showToast(uiRoot, 'Couldn’t take over editing — check you’re online and try again.'));
        },
        24 * 3600 * 1000,
      );
    };
    // say so when a save can't hold everything (an undo can bring a full
    // beach past the limit), and when the server refuses one as too big
    store.onDropped((n) => {
      if (n) showToast(uiRoot, `Only ${MAX_OBJECTS} things are saved on a beach: the ${n} you put down last won't be kept. Take some away with the vacuum.`);
    });
    // a big edit landed, but its safety copy could not be kept: say so,
    // so the player can save a checkpoint by hand if they want one
    store.onLargeEditUnprotected(() => {
      showToast(uiRoot, 'That big edit is saved, but the copy of the beach before it couldn’t be kept — save a checkpoint from Settings if you want one to go back to.');
    });
    const SYNC_CHIP: Partial<Record<SyncState, string>> = { saving: 'saving…', saved: 'saved', offline: 'offline', tooBig: 'too big to save' };
    let syncChip = '';
    s.onState((st) => {
      syncChip = SYNC_CHIP[st] ?? '';
      updatePlace(true);
    });
    paneChips = () => [neighbors?.viewing ? 'look only' : '', acct.user ? syncChip : ''].filter(Boolean);
    let toldTooBig = false;
    store.onState((st) => {
      if (st === 'tooBig' && !toldTooBig) showToast(uiRoot, 'This beach is too big to save. Smooth some of the sand and it will save again.');
      toldTooBig = st === 'tooBig';
    });
    neighbors = new NeighborView(scene, grid, ready.rest, swell, cam, account, store);
    const nv = neighbors;
    nv.setLive(sync.id, renderer);
    // a save of any beach of yours that can't go through: say so once, the same way for all of them
    store.onProblem((_id, kind) => {
      if (kind === 'fenced') {
        fenced = true;
        placing = null;
        snackInHand = false;
        footprintsStroke = null;
        showFencedBanner();
      } else if (kind === 'short') {
        showToast(uiRoot, 'This beach couldn’t save: it held more than your bag. It’s back as it was last saved.');
      } else if (kind === 'restored') {
        showToast(uiRoot, 'This beach was restored from a checkpoint on another device');
        void checkpoints.load();
      }
    });
    const acct = account;
    // a share link (?visit=CODE) waits for sign-in, then lands on that beach
    let pendingVisit: string | null = visitCode ?? inviteFromLink;
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
    // a device remembers which beach of yours was in front of it (a view bookmark, not a "current" beach)
    const VIEW_KEY = 'beech.view.v1';
    const readView = (user: string): string | null => {
      try {
        return (JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as Record<string, string>)[user] ?? null;
      } catch {
        return null;
      }
    };
    const writeView = (user: string, code: string) => {
      try {
        const all = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as Record<string, string>;
        all[user] = code;
        localStorage.setItem(VIEW_KEY, JSON.stringify(all));
      } catch {
        /* storage blocked: this device opens at home next time */
      }
    };
    sync.onBound((id) => {
      const code = acct.mine(id)?.code;
      if (acct.user && code) writeView(acct.user.id, code);
    });
    // whenever someone new signs in (or a saved session comes back), bring
    // back their beach and their neighbors
    let signedInAs: string | null = null;
    account.onChange((u) => {
      if ((u?.id ?? null) !== signedInAs) {
        undoTargets.length = 0;
        redoTargets.length = 0;
        fenced = false;
        fencedHide?.();
        fencedHide = null;
      }
      if (u && u.id !== signedInAs) {
        openingShore = true;
        // the last person's beaches go; your beaches, then the shore around
        // the one this device last looked at (else home) — the view then
        // puts the waves on the beach of yours in front of you
        void (async () => {
          await s.resetToLocal();
          if (acct.user !== u) return;
          await acct.loadBeaches().catch(() => {});
          if (acct.user !== u) return;
          // a new sign-in (or a saved session coming back) takes over
          // editing here, fencing any older tab or device
          await s.claim();
          if (acct.user !== u) return;
          const viewed = readView(u.id);
          const anchor = !pendingVisit && viewed && acct.beaches.some((b) => b.code === viewed && !b.home) ? viewed : null;
          // the beach the shore centres on is the one in front of you: start its waves
          // now, while the rest of the shore loads (the view takes over from here)
          const first = anchor ? acct.beaches.find((b) => b.code === anchor) : acct.home;
          if (first) await s.bind({ id: first.id, code: first.code, owned: true, location: first.location }, { adoptLocal: true });
          if (acct.user !== u) return;
          if (pendingVisit) await applyPendingVisit();
          else await nv.anchorAt(anchor).catch(() => nv.anchorAt(null));
          if (acct.user === u) cam.goTo(0, true);
        })().catch(() => {}).finally(() => {
          if (acct.user === u) openingShore = false;
        });
        void nv.loadFavorites();
      } else if (!u) {
        openingShore = false;
        // signed out: the account's shore goes away, but the public shore
        // still runs past your (local-only) beach — load it
        nv.clear();
        if (signedInAs) {
          // a shared device: the beaches you looked at go with you
          void snapshots?.clear();
          void s.resetToLocal().then(() => nv.refresh());
        }
      }
      signedInAs = u?.id ?? null;
    });
    // your bag counts what's on your other beaches too (as edited here, else as last saved)
    let elsewhereTimer = 0;
    const updateElsewhere = () => {
      elsewhereTimer = 0;
      const other = new Map<string, number>();
      for (const b of acct.beaches) {
        if (isLive(b.id)) continue;
        const objs = store.objectsOf(b.id);
        const items = objs ? countItems(objs) : (b.items ?? {});
        for (const [k, v] of Object.entries(items)) other.set(k, (other.get(k) ?? 0) + v);
      }
      inventory.setElsewhere(other);
    };
    const updateElsewhereSoon = () => {
      if (!elsewhereTimer) elsewhereTimer = window.setTimeout(updateElsewhere, 250);
    };
    store.onChanged(updateElsewhereSoon);
    sync.onBound(updateElsewhereSoon);
    // your beaches changed: forget the sand of ones that are gone
    acct.onBeaches((list) => {
      const ids = new Set(list.map((b) => b.id));
      for (const id of store.ids()) if (id !== LOCAL_BEACH && store.peek(id)?.owned && !ids.has(id) && !isLive(id)) store.forget(id);
      updateElsewhereSoon();
    });
    store.onSaved((id, r) => {
      const b = acct.mine(id);
      if (b) Object.assign(b, { updatedAt: r.updatedAt, items: r.items });
    });
    // a dot on the settings button and Shore tab when someone has asked to move in next to you
    nv.onChange((n) => {
      neighborAsks = n?.requests.length ?? 0;
      syncAskBadge();
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
      // an import lands on the live beach (the beach of yours in front of you)
      const here = sync.id && sync.id !== LOCAL_BEACH ? sync.id : null;
      if (!acct.user || !here) return;
      if (s.fenced) throw new Error('Another tab or device is editing this beach — take over editing there first.');
      await store.flush(here);
      if (!acct.mine(here)?.updatedAt && !store.peek(here)?.updatedAt) return; // nothing saved to keep
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
        // the beach on this device or an edited adjacent one: what's on it right now; others: as last saved
        itemsOn: (id) => {
          if (isLive(id)) return countItems(info.objects);
          const objs = store.objectsOf(id);
          return objs ? countItems(objs) : (acct.mine(id)?.items ?? {});
        },
        here: () => (sync.id && sync.id !== LOCAL_BEACH ? sync.id : null),
        saveBeach: (id) => store.flush(id),
        // save it, swap it on the server, load what's there now (into the worker if it's the live one)
        replaceBeach: async (id, change) => {
          await store.flush(id);
          await change();
          const b = acct.mine(id);
          if (b) await store.reload({ id, code: b.code, owned: true }, true);
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
    // a clearing stroke is about to reshape the beach: keep it as it is now
    // first (docs/CHECKPOINTS.md). Once per save — the next save resets the
    // flag, so a later clearing session snapshots again. The snapshot is
    // best-effort and never blocks the stroke: the server's save-diff
    // backstop still gets its chance at the next save.
    maybeBigEditSnapshot = () => {
      if (bigEditSnapshotAttempted) return;
      bigEditSnapshotAttempted = true;
      void snapshotBeforeBigEdit({
        fenced,
        signedIn: !!acct.user,
        beachId: sync.id && sync.id !== LOCAL_BEACH ? sync.id : null,
        alreadyAttempted: false,
        flush: () => s.flush(),
        saveAutoCheckpoint: (id, name) =>
          cpApi.save(id, name, true).then(() => {
            void checkpoints.load();
          }),
      });
    };
    store.onState((st) => {
      if (st === 'saved') bigEditSnapshotAttempted = false;
    });
    // "while you were away" (docs/LIVE_SIM.md): each time a beach of yours
    // loads here, what the sea did to it since you last looked, once
    s.onLoaded((here) => {
      void (async () => {
        const away = await acct.away(here).catch(() => null);
        if (!away) return;
        void acct.awaySeen(here).catch(() => {});
        const cp = away.checkpoint;
        showChoiceToast(
          uiRoot,
          awayText(away),
          cp && here
            ? [{ label: 'Put it back as it was', onClick: () => void checkpoints.putBack(cp, here) }, { label: 'Keep' }]
            : [{ label: 'OK' }],
        );
        void checkpoints.load();
      })();
    });
    panel = new AccountPanel(
      {
        beach: sheet.beachSlot,
        checkpoints: sheet.checkpointsSlot,
        shore: sheet.shoreSlot!,
        account: sheet.accountSlot,
      },
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
        // go to one of your beaches: glide if it's on this shore, else lay the shore out around it
        // (the waves follow the view there: nothing is switched)
        open: async (id) => {
          const idx = nv.indexOfBeach(id);
          if (idx !== null && !nv.visiting) {
            cam.goTo(nv.xFor(idx));
            sheet.hide();
            return;
          }
          const b = acct.mine(id);
          if (!b) return;
          await nv.anchorAt(b.home ? null : b.code);
          cam.goTo(0, true);
          sheet.hide();
        },
        inView: () => (sync.id && sync.id !== LOCAL_BEACH ? sync.id : null),
        remove: async (id) => {
          releasing.add(id);
          try {
            if (isLive(id)) {
              const home = acct.home;
              await sync.bind(home && home.id !== id ? { id: home.id, code: home.code, owned: true } : null);
            }
            await acct.removeBeach(id);
            store.forget(id);
            if (nv.indexOfBeach(id) !== null) {
              await nv.anchorAt(null);
              cam.goTo(0, true);
            }
          } finally {
            releasing.delete(id);
          }
        },
        // a new beach starts at the real beach you're looking at now
        location: () => beach.id,
        shop: () => {
          sheet.hide();
          void shopDialog?.open();
        },
        changed: () => {
          updateElsewhere();
          void nv.refresh();
        },
        onSelect: (sel) => {
          if (sel?.location) sheet.setBeachLocation(sel.location);
          else sheet.setBeachLocation(beach.id);
        },
        onAuthChange: (signedIn) => {
          sheet.setTab(signedIn ? 'beach' : 'account');
        },
      },
      checkpoints,
    );
    settingsBeachId = () => panel?.selectedBeach?.id ?? sync.id;
    applyPlaceToBeach = (b) => {
      const targetId = settingsBeachId();
      if (acct.user && targetId && !isLive(targetId)) {
        sheet.setBeachLocation(b.id);
        void store
          .flush(targetId)
          .then(() => acct.updateBeach(targetId, { location: b.id }))
          .then(() => {
            const st = store.peek(targetId);
            if (st) st.location = b.id;
          })
          .then(() => nv.refresh())
          .catch((error) => {
            panel?.render();
            showToast(uiRoot, (error as Error).message);
          });
        return;
      }
      setBeach(b);
    };
    smoothSelectedBeach = () => {
      const targetId = settingsBeachId();
      if (acct.user && targetId && !isLive(targetId)) {
        if (!nv.resetOwned(targetId)) {
          showToast(uiRoot, 'Go to this beach to smooth it');
          return;
        }
        recordEditTarget({ beachId: targetId, offsetX: nv.xForBeach(targetId) ?? 0 });
        audio.whoosh(false);
        return;
      }
      if (!sync.id) return;
      markDirty(1500);
      send({ type: 'reset' });
      recordEditTarget({ beachId: sync.id, offsetX: picker.offsetX });
      audio.whoosh(false);
    };

    // the claw and capsule machines are tiles in the bag; the store is its own rail button
    inventory.setMachines([
      { id: 'vending', icon: 'vending', label: 'Item capsule', open: () => (acct.user ? void vendingMachine?.open() : sheet.show('account')) },
      { id: 'claw', icon: 'claw', label: 'Claw machine', open: () => (acct.user ? void clawMachine?.open() : sheet.show('account')) },
    ]);
    storeBtn.addEventListener('click', () => (acct.user ? void shopDialog?.open() : sheet.show('account')));

    const board = new Leaderboard(uiRoot, {
      signedIn: () => !!acct.user,
      signIn: () => sheet.show('account'),
      shoreUrl: SHORE_URL,
      load: (which) => nv.api.leaderboard(which),
      starred: (code) => nv.favorites.has(code),
      star: (e, on) => nv.setFavorite({ id: e.id, code: e.code, name: e.name, beachName: e.beachName, location: e.location, updatedAt: e.updatedAt }, on),
      visit: async (e) => {
        // anyone's beach, yours too: the shore lays out around it, and if it's
        // yours the waves follow the view onto it
        const mineHere = e.yours ? acct.beaches.find((b) => b.code === e.code) : undefined;
        await nv.anchorAt(mineHere?.home ? null : e.code);
        cam.goTo(0, true);
        haptics.impact('light');
      },
    });
    leaderboard = board;

    // share: the beach under the view (yours at home) as a beechshore link,
    // which previews with a picture and opens for anyone, signed in or not
    const shareBeach = () => void (async () => {
      if (!acct.user) {
        sheet.show('account');
        return;
      }
      const other = beachHere();
      const mine = acct.mine(nv.beachAt(nv.nearestIndex(cam.focusX))?.id) ?? acct.mine(sync.id) ?? acct.home ?? undefined;
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
    })();

    // the social hub behind the Inbox button: Inbox · Leaderboard · Starred · Visit by code
    const hub = new SocialHub({ signedIn: () => !!acct.user, signIn: () => sheet.show('account'), needsAccount: ['inbox', 'starred'] });
    socialHub = hub;
    hub.add('leaderboard', board);
    const starred = new StarredDialog(uiRoot, {
      list: () => [...nv.favorites.values()],
      visit: async (code) => {
        await nv.visit(code);
        cam.goTo(0, true);
      },
      unstar: (b) => nv.setFavorite(b, false),
    });
    hub.add('starred', starred);
    hub.add(
      'visit',
      new VisitDialog(uiRoot, {
        visit: async (code) => {
          await nv.visit(code);
          cam.goTo(0, true);
          haptics.impact('light');
        },
        myCode: () => (acct.user ? (acct.mine(sync.id)?.code ?? nv.state?.code ?? null) : null),
        share: shareBeach,
      }),
    );
    nv.onFavorites(() => {
      board.refreshStars();
      starred.refresh();
      if (nv.favorites.size > 0) guide.mark('star');
    });

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
    const claw = new ClawMachine(
      uiRoot,
      new PullApi(acct),
      (item, place) => {
        unlockSteamAchievement('CLAW_WIN');
        void loadOwned().then(() => {
          if (place) inventory.select(item);
        });
      },
      params.has('fast'),
    );
    clawMachine = claw;
    claw.onClosed = () => guide.mark('claw');
    // the shop: paid through Apple / Google in the apps (src/net/shop.ts)
    const shopApi = new ShopApi(acct);
    const shop = new Shop(uiRoot, shopApi, () => {
      void loadOwned();
      void acct.loadBeaches().catch(() => {});
    });
    shopDialog = shop;
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
    const vending = new VendingMachine(uiRoot, new PullApi(acct), (item, place) => {
      unlockSteamAchievement('VENDING_PULL');
      void loadOwned().then(() => {
        if (place) inventory.select(item);
      });
    });
    vendingMachine = vending;
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
    acct.onChange(() => void loadOwned());
    // ---- the beach guide and invites (docs/INVITES_GUIDE.md)
    // The panels only signed-in players use (invites, the inbox, the visitor
    // card) load in their own chunk, off the start-up bundle (perf/budget.json).
    // If that fails (a first visit while offline), the game carries on
    // without them; account features need the network anyway.
    const social = await Promise.all([import('./ui/invite'), import('./ui/inbox'), import('./ui/visitorCard'), import('./ui/inboxText')]).then(
      ([invite, inbox, visitorCard, inboxText]) => ({ ...invite, ...inbox, ...visitorCard, ...inboxText }),
      () => null,
    );
    const guideApi = new GuideApi(acct);
    const referralApi = new ReferralApi(acct);
    const invites = social
      ? new social.InvitePanel(uiRoot, {
          signedIn: () => !!acct.user,
          signIn: () => sheet.show('account'),
          name: () => acct.user?.name ?? '',
          load: () => referralApi.status(),
        })
      : null;
    invitePanel = invites;
    guideHost.signedIn = () => !!acct.user;
    guideHost.load = () => guideApi.done();
    guideHost.complete = (step) => guideApi.complete(step);
    guideHost.openInvite = () => {
      sheet.hide();
      void invites?.open();
    };
    panel.invite = guideHost.openInvite;
    panel.render();
    // signed out with an invite: say who it's from on the start screen and the sign-in
    if (inviteCode && !acct.user) {
      void referralApi
        .lookup(inviteCode)
        .then((who) => {
          if (!who) return writeInvite(null);
          start?.setInvite(who.name, prizeName(who.welcomeGift).toLowerCase());
          panel.signInNote = `${who.name} invited you`;
          panel.render();
        })
        .catch(() => {});
    }
    /** a new player who came through a link: the welcome gift, and an offer to be neighbors */
    const claimInvite = async () => {
      const code = readInvite();
      if (!code || !acct.user) return;
      try {
        const r = await referralApi.claim(code);
        writeInvite(null);
        panel.signInNote = '';
        refreshOwned();
        const gift = prizeName(r.gift).toLowerCase();
        showActionToast(
          uiRoot,
          `A welcome gift from ${r.inviter.name}: a ${gift} is in your bag.`,
          `Be ${r.inviter.name}’s neighbor`,
          () => void askToBeNeighbors(r.inviter.code, r.inviter.name),
          14000,
        );
      } catch (e) {
        // already invited, your own link, or an account that isn't new: nothing to claim
        if (e instanceof ApiError && e.status < 500) writeInvite(null);
      }
    };
    const askToBeNeighbors = async (code: string, name: string) => {
      const st = nv.state ?? (await nv.api.get().catch(() => null));
      const side = !st ? 'right' : !st.right && !st.asked.right ? 'right' : !st.left && !st.asked.left ? 'left' : null;
      if (!side) return showToast(uiRoot, 'Both sides of your beach are taken');
      try {
        const res = await nv.api.set(side, code);
        showToast(uiRoot, res.status === 'linked' ? `You and ${name} are neighbors now` : `Asked ${name} to be your neighbor`);
        void nv.refresh();
      } catch (e) {
        showToast(uiRoot, (e as Error).message);
      }
    };
    /** the inviter: say so when a friend has settled in since we last told you */
    const toldKey = (id: string) => `beech-invite-told-${id}`;
    const checkReferrals = async () => {
      const me = acct.user;
      if (!me) return;
      let r;
      try {
        r = await referralApi.status();
      } catch {
        return;
      }
      let told = 0;
      try {
        told = Number(localStorage.getItem(toldKey(me.id)) ?? 0) || 0;
      } catch {
        /* private mode */
      }
      const fresh = r.friends.filter((f) => f.settled).slice(told);
      try {
        localStorage.setItem(toldKey(me.id), String(r.settled));
      } catch {
        /* private mode */
      }
      const gifts = fresh.filter((f) => f.reward);
      if (!gifts.length) return;
      refreshOwned();
      const f = gifts[gifts.length - 1];
      const reward = f.reward === 'beach' ? 'an extra beach is yours' : `a ${prizeName(f.reward!).toLowerCase()} is in your bag`;
      const more = gifts.length > 1 ? ` (and ${gifts.length - 1} more friend${gifts.length > 2 ? 's' : ''})` : '';
      showActionToast(uiRoot, `${f.name} settled in${more}: ${reward}`, 'Invite more', () => void invites?.open(), 12000);
    };
    acct.onChange((u) => {
      if (!u) return guide.signedOut();
      // the claim first (its gift, and the invite step for the inviter), then the guide
      void claimInvite().then(() => guide.sync());
      void checkReferrals();
    });
    // ---- visitors and the inbox (docs/INBOX_NOTIFICATIONS.md)
    if (social) {
      const { InboxPanel, VisitorCard, ANNOUNCE, announce } = social;
      const inboxApi = new InboxApi(acct);
      const inboxPanel = new InboxPanel(uiRoot, hud.root, (n, l) => hud.button(n, l), inboxApi, {
        signedIn: () => !!acct.user,
        signIn: () => sheet.show('account'),
        visit: (code) =>
          void nv
            .visit(code)
            .then(() => cam.goTo(0, true))
            .catch(() => showToast(uiRoot, 'No beach has that code')),
        neighborsChanged: () => void nv.refresh(),
        toast: (t) => showToast(uiRoot, t),
      });
      inboxUi = inboxPanel;
      // the Inbox heads the rail: signed in it opens the inbox, signed out the leaderboard
      hud.group(0).prepend(inboxPanel.button);
      inboxPanel.button.addEventListener('click', () => socialHub?.show(acct.user ? 'inbox' : 'leaderboard'));
      socialHub?.add('inbox', inboxPanel);
      const shareRow = document.createElement('div');
      shareRow.className = 'inbox-share';
      shareRow.innerHTML = `<button type="button" class="action" data-act="share">share this beach</button>`;
      shareRow.querySelector('button')!.addEventListener('click', shareBeach);
      inboxPanel.el.querySelector('.board-card')!.appendChild(shareRow);
      syncAskBadge();
      const visitor = new VisitorCard(uiRoot, inboxApi, {
        giftable: () => {
          const out: { id: string; name: string; icon: IconName; count: number }[] = [];
          for (const [id, n] of inventory.ownedItems()) {
            const it = itemById(id);
            if (n <= 0 || (it ? it.unlimited : !extraById(id))) continue;
            out.push({ id, name: prizeName(id), icon: (it ? id : 'beach') as IconName, count: n });
          }
          return out;
        },
        gifted: () => refreshOwned(),
        toast: (t) => showToast(uiRoot, t),
      });
      visitorUi = visitor;
      // signed out, "leave something" signs in first, then opens the card
      let cardAfterSignIn: { code: string; owner: string; beachName?: string } | null = null;
      // "leave something" in the status pane's shore bar
      leaveBeach = (b) => {
        if (!acct.user) {
          cardAfterSignIn = { code: b.code, owner: b.name, beachName: b.beachName };
          sheet.show('account');
          return;
        }
        void visitor.open(b.code, b.name, b.beachName);
      };
      shoreKey = '';
      // the poll carries the inbox: the badge, and a note for what matters
      let announced = -1;
      nv.onChange((n) => {
        inboxPanel.setSummary(acct.user ? (n?.inbox ?? { unread: 0, latest: null }) : null);
        const latest = n?.inbox?.latest;
        if (!latest) {
          if (n?.inbox && announced < 0) announced = 0;
          return;
        }
        if (announced >= 0 && latest.id > announced && ANNOUNCE.has(latest.kind) && !inboxPanel.isOpen) {
          showActionToast(uiRoot, announce(latest.kind, latest.name), 'open', () => void inboxPanel.open(), 10000);
          if (latest.kind === 'visit' || latest.kind === 'gift' || latest.kind === 'invite_settled') refreshOwned();
        }
        announced = Math.max(announced, latest.id);
      });
      acct.onChange((u) => {
        if (!u) {
          announced = -1;
          inboxPanel.setSummary(null);
          return;
        }
        inboxPanel.setSummary({ unread: 0, latest: null });
        if (cardAfterSignIn) {
          const c = cardAfterSignIn;
          cardAfterSignIn = null;
          void visitor.open(c.code, c.owner, c.beachName);
        }
      });
    }

    // a link opened signed out: open the beach read-only in 3D if it's
    // public on the shore (and let them walk the public shore); an off-shore
    // beach still waits for sign-in. A sign-up from a plain visit link counts
    // as an invite of that beach's owner (docs/INBOX_NOTIFICATIONS.md).
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
      if (u || acct.user) return;
      // a sign-up from a plain visit link counts as an invite of that beach's owner
      if (visitCode && !readInvite()) writeInvite(visitCode);
      const code = visitCode ?? inviteFromLink;
      if (!code) {
        void nv.refresh();
        return;
      }
      try {
        await nv.visit(code);
        if (acct.user) return;
        history.replaceState(null, '', location.pathname + withoutVisitParam(location.search) + location.hash);
        cam.goTo(0, true);
      } catch {
        showToast(uiRoot, 'Sign in (settings) to visit this beach');
        void nv.refresh();
      }
    });
  }

  document.addEventListener('visibilitychange', () => {
    // going to the back: save every beach with changes now (keepalive: the page may be closing)
    if (document.hidden || document.visibilityState === 'hidden') void store.flushAll(true);
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
    // (the beach itself is the store's `local` beach: kept in IndexedDB by its backend)
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
    /** open (true) or close the rail, as the palm does */
    setRail: (on: boolean) => setCollapsed(!on),
    /** the status pane: 'default' | 'expanded' | 'closed' */
    setPane: (state: PaneState) => setPane(state),
    /** the social hub: show a tab ('inbox' | 'leaderboard' | 'starred' | 'visit') */
    hub: () => socialHub,
    sheet,
    inventory,
    claw: () => clawMachine,
    shop: () => shopDialog,
    leaderboard: () => leaderboard,
    vending: () => vendingMachine,
    guide,
    invites: () => invitePanel,
    inbox: () => inboxUi,
    visitor: () => visitorUi,
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
      /** the pet of the other beach under the view (when away) */
      visit: () => ({ code: visitPetCode, offsetX: visitPetX, ...visitAnimals.snapshot(), food: { ...visitAnimals.snapshot().food } }),
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
    /** the client's beach state, by id (docs/BEACH_STORE.md) */
    store: () => store,
    /** the beach the wave worker simulates now (the one of yours in view) */
    liveBeach: () => sync.id,
    /** the beach of yours in front of you, once your beaches are in (null before, or signed out) */
    beachId: () => (sync.id && sync.id !== LOCAL_BEACH ? sync.id : null),
    live: () => ({ ...liveState, palette: undefined }),
    /** the light you see (local weather: the place of the beach in the middle of the view) */
    light: () => ({ ...viewState, palette: viewState.palette.name, place: viewConditions.beach.id }),
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
  // The test loop reads state initialized by both account and sandbox setup.
  if (noRender) {
    tickFrame();
    window.setInterval(tickFrame, 33);
  }
  document.body.dataset.ready = '1';
}

registerServiceWorker();

boot().catch((err) => {
  console.error(err);
  reportError('boot', err, { source: 'main:boot' });
  document.body.dataset.bootError = '1';
  document.body.innerHTML = `<p style="font-family:sans-serif;padding:2em;color:#6b5a6e">Sorry — this device couldn't start the beach (${String(
    err?.message ?? err,
  )}).</p>`;
});
