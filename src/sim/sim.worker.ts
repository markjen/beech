/// <reference lib="webworker" />
import * as CONFIG from '../config';
import { SIM_HZ } from '../config';
import { BeachSim } from './beachSim';
import type { FromWorker, ToWorker } from './protocol';

// The worker owns the simulation. It ticks at a fixed rate and ships packed
// RGBA float frames (sand, water, wet, foam) back to the main thread, which
// returns each buffer after uploading it so nothing is allocated per frame.

declare const self: DedicatedWorkerGlobalScope;

let sim: BeachSim | null = null;
const pool: Float32Array[] = [];
const posPool: Float32Array[] = [];
let paused = false;
let loadId = 0;
let lastTime = 0;
let acc = 0;
let statsEvery = 0;
/** the roster version the main thread has (-1: none yet) */
let rosterSent = -1;
const DT = 1 / SIM_HZ;

function post(msg: FromWorker, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

function loop() {
  const now = performance.now();
  if (!sim || paused) {
    lastTime = now;
    setTimeout(loop, 50);
    return;
  }
  acc += Math.min(0.25, (now - lastTime) / 1000);
  lastTime = now;
  let ticked = false;
  let tickMs = 0;
  let n = 0;
  while (acc >= DT && n < 3) {
    const t0 = performance.now();
    sim.step(DT);
    tickMs = performance.now() - t0;
    acc -= DT;
    n++;
    ticked = true;
  }
  if (n === 3) acc = 0; // fell behind: drop time rather than spiral
  if (ticked) {
    const buf = pool.pop();
    if (buf) {
      sim.pack(buf);
      const withStats = ++statsEvery % 15 === 0;
      const objs = sim.objects;
      const roster = objs.version !== rosterSent ? objs.persisted() : undefined;
      rosterSent = objs.version;
      const objPos = objs.packPositions(posPool.pop());
      const lost = objs.takeLost();
      post(
        {
          type: 'frame',
          buf,
          t: sim.time,
          eta: sim.seaLevel(),
          tide: sim.meanLevel(),
          waveMul: sim.waveMul,
          undoCount: sim.undo.undoCount,
          redoCount: sim.undo.redoCount,
          digIntensity: sim.digIntensity,
          swash: sim.swashVolume,
          objPos,
          rosterVersion: objs.version,
          loadId,
          roster,
          lost: lost.length ? lost : undefined,
          stats: withStats ? sim.stats() : undefined,
          tickMs,
        },
        [buf.buffer, objPos.buffer],
      );
    }
  }
  const wait = Math.max(0, (DT - acc) * 1000 - 1);
  setTimeout(loop, wait);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case 'init': {
      sim = new BeachSim(m.grid, m.seed, m.flags);
      rosterSent = -1;
      pool.length = 0;
      posPool.length = 0;
      for (let i = 0; i < 3; i++) pool.push(new Float32Array(sim.n * 4));
      const rest = sim.rest.slice();
      post({ type: 'ready', grid: m.grid, rest, seed: m.seed }, [rest.buffer]);
      lastTime = performance.now();
      acc = DT; // produce a first frame right away
      break;
    }
    case 'getSand':
      if (sim) {
        const delta = sim.sandDelta();
        const cover = sim.sandCover();
        const xfer: Transferable[] = [delta.buffer];
        if (cover) xfer.push(cover.buffer);
        const history = m.history ? sim.undo.take() : undefined;
        post({ type: 'sand', id: m.id, delta, objects: sim.objects.persisted(), ...(cover ? { cover } : {}), ...(history ? { history } : {}) }, xfer);
      }
      break;
    case 'setSand':
      if (sim && m.delta.length === sim.n) {
        sim.loadDelta(m.delta, m.objects ?? [], m.cover, m.history);
        loadId = m.loadId ?? 0;
      }
      break;
    case 'importBeach':
      if (sim && m.delta.length === sim.n) sim.importBeach(m.delta, m.objects, m.cover);
      break;
    case 'placeObject':
      sim?.placeObject(m.obj, m.group);
      break;
    case 'removeObject':
      sim?.removeObject(m.id);
      break;
    case 'moveObject':
      sim?.moveObject(m.id, m.x, m.y);
      break;
    case 'sea':
      sim?.setSea(m.tide, m.waves);
      break;
    case 'bench': {
      // time a few ticks of the smallest grid to pick a quality tier
      const b = new BeachSim(CONFIG.GRID_TIERS.low, 1);
      for (let i = 0; i < 3; i++) b.step(DT);
      const t0 = performance.now();
      const N = 12;
      for (let i = 0; i < N; i++) b.step(DT);
      post({ type: 'bench', msPerTickLow: (performance.now() - t0) / N });
      break;
    }
    case 'return':
      if (sim && m.buf && m.buf.length === sim.n * 4) pool.push(m.buf);
      if (m.objPos && posPool.length < 3) posPool.push(m.objPos);
      break;
    case 'brush':
      if (!sim) break;
      if (m.phase === 'start') sim.beginStroke(m.x, m.y, m.r, m.mode);
      else if (m.phase === 'move') sim.moveStroke(m.x, m.y, m.r);
      else if (m.phase === 'end') sim.endStroke();
      else sim.cancelStroke();
      break;
    case 'castle':
      sim?.moldCastle(m.x, m.y, m.shape);
      break;
    case 'undo':
      sim?.undoStroke();
      break;
    case 'redo':
      sim?.redoStroke();
      break;
    case 'reset':
      sim?.resetBeach();
      break;
    case 'flags':
      if (sim) sim.flags = { ...sim.flags, ...m.flags };
      break;
    case 'pause':
      paused = m.paused;
      break;
    case 'tune': {
      const section = (CONFIG as unknown as Record<string, Record<string, number>>)[m.section];
      if (section && typeof section[m.key] === 'number') section[m.key] = m.value;
      break;
    }
  }
};

loop();
