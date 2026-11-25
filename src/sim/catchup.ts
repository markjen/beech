// The catch-up: what the sea did to a beach while nobody had it open
// (docs/LIVE_SIM.md, section 4).
//
// Replaying the live simulation is out (a day is 2.6 million ticks), so this
// is a coarse model of the two things the live sim does to sand over hours:
//
//  - wet sand slumps at its saturated angle of repose (waves undercut walls
//    and castles: `BeachSim.slump`), and
//  - wherever the water reaches, sand heals back toward the rest profile with
//    time constant EROSION.healingTime (`BeachSim.heal`).
//
// Both only happen where the water gets to, so the gap is cut into half tide
// cycles (from the real tide at the beach's place, passed in as a function)
// and each cell gets the time it spent wet in each: under the still water
// always, in the swash band above it part of the time. Dry sand above the
// highest water is left alone, as in the live sim.
//
// Things on the beach follow simple rules: floaters drift along the shore and
// strand at the high-water line, rollers creep seaward, and owned things that
// spend too long in the sea are taken (they go back in the bag). The sea
// brings in fresh strays along the last high-water line.
//
// Plain TypeScript with no DOM: it runs in Vitest and, bundled, on the server.

import { CATCHUP, EROSION, PROFILE, SAND, WORLD_SIZE_X } from '../config';
import { BEHAVIOUR, MAX_WILD, type PlacedObject } from './objects';
import { buildRestProfile } from './profile';

export interface CatchUpInput {
  nx: number;
  ny: number;
  /** sand minus the rest beach, as saved */
  delta: Float32Array;
  objects: PlacedObject[];
  /** the diorama tide (m) at a time (ms since the epoch): `diorama(tideHeight(...))` */
  tide: (ms: number) => number;
  /** the place's swell multiplier (`Beach.waves`) */
  waves: number;
  /** ms since the epoch */
  from: number;
  to: number;
  /** rest-profile seed (the app uses 1) */
  seed?: number;
  /** cap on the gap (days); default CATCHUP.maxGapDays */
  maxGapDays?: number;
}

export interface CatchUpResult {
  delta: Float32Array;
  objects: PlacedObject[];
  /** owned things the sea took (no longer in `objects`: back in the bag) */
  lost: PlacedObject[];
  /** strays the sea brought in */
  broughtIn: number;
  /** high tides in the gap */
  highTides: number;
  /** sand that changed (m³) */
  sandMoved: number;
  /** the part of the gap that was simulated (`from` moves up past the cap) */
  from: number;
  to: number;
}

const DEG = Math.PI / 180;

/** Half tide cycles: [start ms, end ms, low level, high level], plus how many high tides. */
export function halfCycles(tide: (ms: number) => number, from: number, to: number): { segs: [number, number, number, number][]; highTides: number } {
  const step = CATCHUP.sampleMin * 60000;
  const n = Math.max(1, Math.ceil((to - from) / step));
  const ts: number[] = [];
  const ls: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i === n ? to : from + i * step;
    ts.push(t);
    ls.push(tide(t));
  }
  const segs: [number, number, number, number][] = [];
  let highTides = 0;
  let start = 0;
  let dir = 0;
  for (let i = 1; i <= n; i++) {
    const dPrev = Math.sign(ls[i] - ls[i - 1]);
    if (dPrev !== 0) dir = dPrev;
    const dNext = i < n ? Math.sign(ls[i + 1] - ls[i]) : 0;
    const turning = i < n && dir !== 0 && dNext !== 0 && dir !== dNext;
    if (turning && dir > 0) highTides++;
    if (turning || i === n) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = start; k <= i; k++) {
        lo = Math.min(lo, ls[k]);
        hi = Math.max(hi, ls[k]);
      }
      if (ts[i] > ts[start]) segs.push([ts[start], ts[i], lo, hi]);
      start = i;
    }
  }
  return { segs, highTides };
}

/** Fraction of a half cycle (level swinging like a sine from lo to hi) that the level is at or above z. */
function above(z: number, lo: number, hi: number): number {
  if (z <= lo) return 1;
  if (z >= hi) return 0;
  return Math.acos((2 * z - hi - lo) / (hi - lo)) / Math.PI;
}

/** Swash band: fractions of the run-up where the wetting is sampled (weights the band linearly). */
const BAND = [1 / 6, 1 / 2, 5 / 6];

export function catchUp(input: CatchUpInput): CatchUpResult {
  const { nx, ny, waves } = input;
  const n = nx * ny;
  if (input.delta.length !== n) throw new Error('grid size mismatch');
  const dx = WORLD_SIZE_X / nx;
  const cap = (input.maxGapDays ?? CATCHUP.maxGapDays) * 86400000;
  const to = input.to;
  const from = Math.max(input.from, to - cap);
  const objects = input.objects.map((o) => ({ ...o }));
  const empty: CatchUpResult = { delta: input.delta.slice(), objects, lost: [], broughtIn: 0, highTides: 0, sandMoved: 0, from, to };
  if (!(to > from)) return empty;

  const rest = buildRestProfile({ nx, ny, dx }, input.seed ?? 1);
  const sand = new Float32Array(n);
  const bottom = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    sand[k] = rest[k] + input.delta[k];
    bottom[k] = rest[k] - PROFILE.digDepthLimit;
  }
  const start = sand.slice();
  const wetTime = new Float32Array(n);
  const tanMax = new Float32Array(n);
  const tmp = new Float32Array(n);
  const R = CATCHUP.runup * waves;
  const tDry = Math.tan(SAND.reposeDry * DEG) * dx;
  const tSat = Math.tan(SAND.reposeSaturated * DEG) * dx;

  let st = (Math.imul((input.seed ?? 1) | 0, 2654435761) ^ (Math.floor(from / 60000) | 0) ^ 0x5bd1e995) >>> 0 || 1;
  const rand = () => {
    st ^= st << 13;
    st ^= st >>> 17;
    st ^= st << 5;
    return (st >>> 0) / 4294967296;
  };
  const cellOf = (x: number, y: number) =>
    Math.min(ny - 1, Math.max(0, Math.floor(y / dx))) * nx + Math.min(nx - 1, Math.max(0, Math.floor(x / dx)));
  /** the highest-water line in column i: the first cell from the sea at or above level z (m from the offshore edge) */
  const lineAt = (x: number, z: number): number | null => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor(x / dx)));
    for (let j = 0; j < ny; j++) if (sand[j * nx + i] >= z) return (j + 0.5) * dx;
    return null;
  };

  const rate = SAND.slumpRate * 0.5;
  const slump = (j0: number, j1: number) => {
    for (let it = 0; it < CATCHUP.slumpPasses; it++) {
      for (let j = j0; j <= j1; j++) tmp.fill(0, j * nx, (j + 1) * nx);
      for (let j = j0; j <= j1; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          const hk = sand[k];
          if (i < nx - 1) {
            const kn = k + 1;
            const dh = hk - sand[kn];
            const t = Math.min(tanMax[k], tanMax[kn]);
            if (dh > t) {
              const m = Math.min((dh - t) * rate, Math.max(0, hk - bottom[k]) * 0.25);
              tmp[k] -= m;
              tmp[kn] += m;
            } else if (-dh > t) {
              const m = Math.min((-dh - t) * rate, Math.max(0, sand[kn] - bottom[kn]) * 0.25);
              tmp[k] += m;
              tmp[kn] -= m;
            }
          }
          if (j < j1) {
            const kn = k + nx;
            const dh = hk - sand[kn];
            const t = Math.min(tanMax[k], tanMax[kn]);
            if (dh > t) {
              const m = Math.min((dh - t) * rate, Math.max(0, hk - bottom[k]) * 0.25);
              tmp[k] -= m;
              tmp[kn] += m;
            } else if (-dh > t) {
              const m = Math.min((-dh - t) * rate, Math.max(0, sand[kn] - bottom[kn]) * 0.25);
              tmp[k] += m;
              tmp[kn] -= m;
            }
          }
        }
      }
      for (let k = j0 * nx; k < (j1 + 1) * nx; k++) sand[k] += tmp[k];
    }
  };

  const { segs, highTides } = halfCycles(input.tide, from, to);
  /** seconds each object has spent in the sea */
  const soaked = new Map<number, number>();
  const lost: PlacedObject[] = [];
  let lastHigh = -Infinity;

  for (const [t0, t1, lo, hi] of segs) {
    const D = (t1 - t0) / 1000;
    const reach = hi + R;
    lastHigh = Math.max(lastHigh, hi);
    // Sand at rest stays at rest (the rest beach is gentler than any angle
    // of repose, and healing pulls toward it), so only rows that differ from
    // it, and a margin, need work. That skips the whole sea floor.
    let dlo = ny;
    let dhi = -1;
    for (let j = 0; j < ny; j++) {
      for (let k = j * nx, e = k + nx; k < e; k++) {
        if (sand[k] !== rest[k]) {
          if (j < dlo) dlo = j;
          dhi = j;
          break;
        }
      }
    }
    // how long each cell was wet in this half cycle, and the rows that were
    let jlo = ny;
    let jhi = -1;
    const b0 = Math.max(0, dlo - 3);
    const b1 = Math.min(ny - 1, dhi + 3);
    for (let j = b0; j <= b1 && dhi >= 0; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        // waves run up and over things built in the swash: a mound is
        // wetted as if it were only `overtop` of its height
        const r0 = rest[k];
        const h = sand[k] > r0 ? r0 + (sand[k] - r0) * CATCHUP.overtop : sand[k];
        if (h >= reach) {
          wetTime[k] = 0;
          continue;
        }
        let f = 0;
        for (const q of BAND) f += above(h - q * R, lo, hi);
        wetTime[k] = (D * f) / BAND.length;
        if (wetTime[k] > 0) {
          if (j < jlo) jlo = j;
          if (j > jhi) jhi = j;
        }
      }
    }
    const j0 = Math.max(b0, jlo - 2);
    const j1 = Math.min(b1, jhi + 2);

    // waves undercut: wet sand gives way at the saturated angle, and wherever
    // the water reached the sea smooths it back toward the rest beach. The
    // live sim does both every tick, so they take turns here.
    for (let j = j0; j <= j1; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        tanMax[k] = wetTime[k] > 0 ? tSat : tDry;
      }
    }
    for (let round = 0; round < CATCHUP.rounds && jhi >= 0; round++) {
      for (let k = j0 * nx; k < (j1 + 1) * nx; k++) {
        const w = wetTime[k];
        if (w <= 0) continue;
        const a = 1 - Math.exp(-w / CATCHUP.rounds / EROSION.healingTime);
        const v = sand[k] + (rest[k] - sand[k]) * a;
        sand[k] = v < bottom[k] ? bottom[k] : v;
      }
      slump(j0, j1);
    }

    // things on the beach
    for (const o of objects) {
      const b = BEHAVIOUR[o.kind];
      if (b !== 'float' && b !== 'tumble') continue;
      const h = sand[cellOf(o.x, o.y)];
      const inSea = D * above(h + 0.03, lo, hi);
      if (inSea <= 0) continue;
      soaked.set(o.id, (soaked.get(o.id) ?? 0) + inSea);
      const share = inSea / D;
      if (b === 'float') {
        // drifts along the shore, then is left at the high-water line
        o.x += (rand() - 0.5) * 2 * CATCHUP.drift * waves * share;
        const y = lineAt(o.x, hi + R * 0.5);
        if (y !== null) o.y = y;
      } else {
        // rolled about, a little seaward
        o.x += (rand() - 0.5) * 0.6 * waves * share;
        o.y -= rand() * 0.3 * waves * share;
      }
      o.angle += (rand() - 0.5) * 2 * share;
      o.x = Math.min(nx * dx - 0.3, Math.max(0.3, o.x));
      o.y = Math.min(ny * dx - 0.3, Math.max(0.3, o.y));
    }
  }

  // owned things that spent too long in the sea are taken (back in the bag)
  let kept = objects.filter((o) => {
    if (o.wild) return true;
    const s = soaked.get(o.id) ?? 0;
    const b = BEHAVIOUR[o.kind];
    const limit = b === 'float' ? CATCHUP.lostFloatH : b === 'tumble' ? CATCHUP.lostRollH : Infinity;
    if (s >= limit * 3600) {
      lost.push(o);
      return false;
    }
    return true;
  });

  // a high tide came and went: the old strays are gone, fresh ones lie along its line
  let broughtIn = 0;
  if (highTides > 0 && Number.isFinite(lastHigh)) {
    kept = kept.filter((o) => !o.wild);
    let nextId = kept.reduce((m, o) => Math.max(m, o.id), 0) + 1;
    for (let w = 0; w < MAX_WILD; w++) {
      const x = 2 + rand() * (nx * dx - 4);
      const y = lineAt(x, lastHigh + R * 0.5);
      if (y === null || y < 1) continue;
      const r = rand();
      const base = { id: nextId++, x, y: y - 0.2, angle: rand() * 6.28, wild: true as const };
      kept.push(
        r < 0.3
          ? { ...base, kind: 'driftwood', item: 'driftwood', size: 0.7 + rand() * 1.1, variant: 1 + Math.floor(rand() * 6) }
          : r < 0.85
            ? { ...base, kind: 'shell', item: 'shell', size: 0.07 + rand() * 0.06, variant: 1 + Math.floor(rand() * 6) }
            : { ...base, kind: 'seaglass', item: 'seaglass', size: 0.07 + rand() * 0.04, variant: 1 + Math.floor(rand() * 4) },
      );
      broughtIn++;
    }
  }

  const delta = new Float32Array(n);
  let moved = 0;
  for (let k = 0; k < n; k++) {
    // untouched cells keep their saved value exactly (no float round trip)
    delta[k] = sand[k] === start[k] ? input.delta[k] : sand[k] - rest[k];
    moved += Math.abs(sand[k] - start[k]);
  }
  return { delta, objects: kept, lost, broughtIn, highTides, sandMoved: moved * dx * dx, from, to };
}
