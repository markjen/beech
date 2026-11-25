import {
  BRUSH,
  EROSION,
  PROFILE,
  SAND,
  SANDCASTLE,
  UNDO_DEPTH,
  WATER,
  WAVES,
  type GridSpec,
} from '../config';
import { buildRestProfile } from './profile';
import { makeSwell, swellAt, swellEnvelope, tideAt, type Swell } from './waves';
import { UndoStack, type UndoEntry, type UndoHistory } from './undoStack';
import { BeachObjects, type PlacedObject } from './objects';

/** dig, build up, smooth, or bulldoze (flatten back to the untouched beach) */
export type CastleShape = 'round' | 'square';

export type BrushMode = 'dig' | 'pile' | 'smooth' | 'flatten' | 'dozer' | 'vacuum';

/**
 * The three modes of the sand tool: dig, build up a dune, or blend/rake.
 */
export type SandMode = 'dig' | 'pile' | 'smooth';
export const SAND_MODES: SandMode[] = ['dig', 'pile', 'smooth'];
export const isSandMode = (id: string): id is SandMode =>
  (SAND_MODES as string[]).includes(id);

/**
 * The three modes of the one top-level clearing tool: bulldoze (flatten + scoop
 * up what's in the blade's path), flatten the sand back to the untouched beach,
 * or vacuum (pick items up, sand untouched).
 */
export type ClearingMode = 'dozer' | 'flatten' | 'vacuum';
export const CLEARING_MODES: ClearingMode[] = ['dozer', 'flatten', 'vacuum'];
export const isClearingMode = (id: string): id is ClearingMode =>
  (CLEARING_MODES as string[]).includes(id);

export interface SimFlags {
  waves: boolean;
  /** swell multiplier the sea eases toward (WAVES.levels: calm … surf; 1 = the beach's own) */
  waveLevel: number;
  tide: boolean;
  erosion: boolean;
  healing: boolean;
  seep: boolean;
  /** close the offshore boundary (no forcing). Used by tests. */
  closed: boolean;
}

export const DEFAULT_FLAGS: SimFlags = {
  waves: true,
  waveLevel: 1,
  tide: true,
  erosion: true,
  healing: true,
  seep: true,
  closed: false,
};

export interface SimStats {
  totalSand: number;
  totalWater: number;
  wetCells: number;
}

const DEG = Math.PI / 180;
/** undo/redo ease in over this many ticks (~150 ms) */
const UNDO_EASE_TICKS = 5;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * The whole beach: sand heightfield, shallow water (virtual pipes), sediment
 * transport, slumping and the brush/undo logic. Pure TypeScript with typed
 * arrays; runs in a worker in the app and directly in unit tests.
 *
 * Grid coordinates: x = alongshore metres from the left edge (index i),
 * y = cross-shore metres from the offshore edge (index j). Cell k = j*nx + i.
 */
export class BeachSim {
  readonly g: GridSpec;
  readonly nx: number;
  readonly ny: number;
  readonly n: number;
  readonly dx: number;

  readonly rest: Float32Array;
  readonly bottom: Float32Array;
  readonly sand: Float32Array;
  readonly water: Float32Array;
  readonly sediment: Float32Array;
  readonly wet: Float32Array;
  readonly foam: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  // outflow fluxes (m^3/s) towards -x, +x, -y, +y
  private readonly fL: Float32Array;
  private readonly fR: Float32Array;
  private readonly fD: Float32Array;
  private readonly fU: Float32Array;
  private readonly tmp: Float32Array;
  private readonly slumpDelta: Float32Array;
  private readonly slumpRowA: Uint8Array;
  private readonly slumpRowB: Uint8Array;
  private readonly restRowMin: Float32Array;
  private readonly restRowMax: Float32Array;

  flags: SimFlags;
  time = 0;
  /** eased swell multiplier (toward flags.waveLevel, so a change doesn't jolt the water) */
  waveMul = 1;
  /** tide level set from outside (the real tide at a real beach), or null for the built-in demo tide */
  private externalTide: number | null = null;
  private tideNow = 0;
  /** swell height multiplier (calm Mediterranean vs. Atlantic surf) */
  waveScale = 1;
  readonly swell: Swell;
  private etaRow: Float32Array | null = null;
  readonly seed: number;

  /** the highest row the water step covered last time (see flow) */
  private flowTop: number;
  /** the highest row that may hold suspended sediment (see erode) */
  private sedTop = -1;
  /** the highest row that may still be wet or foamy (see updateWetFoam / heal) */
  private wetTop: number;
  readonly undo = new UndoStack(UNDO_DEPTH);
  /** rocks, driftwood and future items on the sand */
  readonly objects: BeachObjects;
  private easing: { entry: UndoEntry; sign: number; ticksLeft: number }[] = [];

  // brush state
  private stroke: {
    mode: BrushMode;
    x: number;
    y: number;
    r: number;
    lastX: number;
    lastY: number;
    hold: number;
    dirX: number;
    dirY: number;
    snapshot: Float32Array;
    i0: number;
    j0: number;
    i1: number;
    j1: number;
    /** objects the stroke swept up (dozer blade or vacuum) */
    swept: PlacedObject[];
    /**
     * sand a swept rock lifted back (cell index, change in m), in the order
     * the rocks were taken. Undo re-embeds the rocks and restores this sand
     * itself, so it is taken out of the undo delta in endStroke.
     */
    lift: { k: number; d: number }[];
  } | null = null;
  /** 0..1 how hard the brush is working this tick (for audio/haptics) */
  digIntensity = 0;
  /** water volume (m^3) sitting on the beach face above the mean sea level (for audio) */
  swashVolume = 0;

  constructor(g: GridSpec, seed = 1, flags: Partial<SimFlags> = {}) {
    this.g = g;
    this.nx = g.nx;
    this.ny = g.ny;
    this.n = g.nx * g.ny;
    this.dx = g.dx;
    this.seed = seed;
    this.flags = { ...DEFAULT_FLAGS, ...flags };
    const n = this.n;
    this.rest = buildRestProfile(g, seed);
    this.bottom = new Float32Array(n);
    for (let k = 0; k < n; k++) this.bottom[k] = this.rest[k] - PROFILE.digDepthLimit;
    this.sand = this.rest.slice();
    this.water = new Float32Array(n);
    this.sediment = new Float32Array(n);
    this.wet = new Float32Array(n);
    this.foam = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.fL = new Float32Array(n);
    this.fR = new Float32Array(n);
    this.fD = new Float32Array(n);
    this.fU = new Float32Array(n);
    this.tmp = new Float32Array(n);
    this.slumpDelta = new Float32Array(n);
    this.slumpRowA = new Uint8Array(g.ny);
    this.slumpRowB = new Uint8Array(g.ny);
    this.restRowMin = new Float32Array(g.ny);
    this.restRowMax = new Float32Array(g.ny);
    for (let j = 0; j < g.ny; j++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = j * g.nx, e = k + g.nx; k < e; k++) {
        const v = this.rest[k];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      this.restRowMin[j] = lo;
      this.restRowMax[j] = hi;
    }
    this.flowTop = g.ny - 1;
    this.wetTop = g.ny - 1;
    this.swell = makeSwell(seed);
    this.objects = new BeachObjects(this, seed);
    const eta = this.seaLevel(0);
    for (let k = 0; k < n; k++) {
      this.water[k] = Math.max(0, eta - this.sand[k]);
      this.wet[k] = this.water[k] > 0 ? 1 : 0;
    }
  }

  /** Mean water level (tide only) at time t. */
  meanLevel(t = this.time): number {
    if (this.flags.closed || !this.flags.tide) return 0;
    if (this.externalTide !== null) return this.tideNow;
    return tideAt(t);
  }

  /** Drive the tide from outside (m). The first call snaps, later ones ease in. */
  setSea(tide: number, waveScale: number): void {
    if (this.externalTide === null) this.tideNow = tide;
    this.externalTide = tide;
    this.waveScale = Math.max(0, Math.min(WAVES.maxScale, waveScale));
  }

  private swellAmp(): number {
    return this.flags.waves ? this.waveMul * this.waveScale : 0;
  }

  /** Water surface imposed at the offshore boundary (at world x, m along the shore; 0 = the middle). */
  seaLevel(t = this.time, x = 0): number {
    if (this.flags.closed) return 0;
    return this.meanLevel(t) + swellAt(t, this.swell, this.swellAmp(), x);
  }

  /** The offshore surface for every column right now (waves arrive at an angle). */
  private seaRow(out: Float32Array): void {
    const t = this.time;
    const mean = this.meanLevel(t);
    const amp = this.swellAmp() * swellEnvelope(t, this.swell);
    const half = (this.nx * this.dx) / 2;
    for (let i = 0; i < this.nx; i++) {
      const x = (i + 0.5) * this.dx - half;
      let s = 0;
      for (const c of this.swell) s += c.amp * Math.sin(c.omega * t - c.k * x + c.phase);
      out[i] = mean + s * amp;
    }
  }

  // ---------------------------------------------------------------- stepping

  /** Advance the whole simulation by dt seconds (one tick). */
  step(dt: number): void {
    const level = Math.max(0, Math.min(WAVES.levels.surf, this.flags.waveLevel));
    this.waveMul += (level - this.waveMul) * Math.min(1, dt / 2.5);
    if (this.externalTide !== null) this.tideNow += (this.externalTide - this.tideNow) * Math.min(1, dt / 20);

    this.applyBrush(dt);
    this.applyUndoEasing();

    const sub = WATER.substeps;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      this.time += h;
      if (!this.flags.closed) this.force(h);
      this.flow(h);
    }
    this.objects.step(dt, this.flags.waves);
    if (this.flags.seep) this.seep(dt);
    if (this.flags.erosion) this.erode(dt);
    this.slump();
    if (this.flags.healing) this.heal(dt);
    this.updateWetFoam(dt);
    this.measureSwash();
  }

  /** True while an undo/redo ease animation is in progress. */
  get easingActive(): boolean {
    return this.easing.length > 0;
  }

  /**
   * Lightweight step for editing an adjacent owned beach: applies the active
   * brush, undo easing, object settling, and angle-of-repose slumping without
   * running the shallow-water wave solver.
   */
  stepEdit(dt: number): void {
    this.applyBrush(dt);
    this.applyUndoEasing();
    this.objects.step(dt, false);
    this.slump();
  }

  private measureSwash(): void {
    const { nx, rest, water, restRowMax } = this;
    const level = this.meanLevel() - 0.05;
    const top = this.flowTop;
    let v = 0;
    for (let j = 0; j <= top; j++) {
      if (restRowMax[j] <= level) continue;
      for (let k = j * nx, e = k + nx; k < e; k++) {
        if (rest[k] > level) v += water[k];
      }
    }
    this.swashVolume = v * this.dx * this.dx;
  }

  /** Offshore boundary: hard-set the first row, relax a sponge layer behind it. */
  private force(dt: number): void {
    const { nx, sand, water, fL, fR } = this;
    if (this.flags.closed) return;
    const row = (this.etaRow ??= new Float32Array(nx));
    this.seaRow(row);
    const rows = Math.min(WAVES.spongeRows, this.ny - 1);
    for (let j = 0; j < rows; j++) {
      const f = 1 - j / rows;
      const f2 = f * f;
      const w = j === 0 ? 1 : Math.min(1, dt * 6 * f2);
      const damp = 1 - Math.min(1, dt * 3 * f2);
      for (let i = 0, k = j * nx; i < nx; i++, k++) {
        const diff = row[i] - sand[k];
        const target = diff > 0 ? diff : 0;
        water[k] += (target - water[k]) * w;
        fL[k] *= damp;
        fR[k] *= damp;
      }
    }
  }

  /** Virtual-pipes shallow water step (Mei et al. 2007). */
  private flow(dt: number): void {
    const { nx, ny, dx, sand, water, fL, fR, fD, fU, vx, vy, tmp } = this;
    const dtG = dt * WATER.gravity;
    const maxD = WATER.maxFluxDepth;
    const dtCfDx = (dt * WATER.friction) / dx;
    const lin0 = WATER.linearDamping;
    const linDeep = WATER.deepDamping;
    const linSlope = (linDeep - lin0) / 0.4;
    const dtLin0 = 1 + dt * lin0;
    const dtLinDeep = 1 + dt * linDeep;
    const sponge = WAVES.spongeRows;
    const area = dx * dx;
    const areaOverDt = area / dt;
    const dtOverArea = dt / area;
    const halfInvDx = 0.5 / dx;
    const nx1 = nx - 1;
    const ny1 = ny - 1;

    // Rows above the highest wet one can't change this step (water moves at
    // most one cell per substep), so both passes stop one row above it. Rows
    // that drop out of that range get their fluxes and velocities zeroed, so
    // what's skipped is always exactly "dry and still".
    let wetTop = -1;
    for (let j = ny1; j >= 0 && wetTop < 0; j--) {
      for (let k = j * nx, e = k + nx; k < e; k++) {
        if (water[k] > 0) {
          wetTop = j;
          break;
        }
      }
    }
    const top = wetTop < 0 ? -1 : wetTop + 1 < ny1 ? wetTop + 1 : ny1;
    if (top < this.flowTop) {
      const from = (top + 1) * nx;
      const to = (this.flowTop + 1) * nx;
      fL.fill(0, from, to);
      fR.fill(0, from, to);
      fD.fill(0, from, to);
      fU.fill(0, from, to);
      vx.fill(0, from, to);
      vy.fill(0, from, to);
    }
    this.flowTop = top;
    if (top < 0) return;

    // Precompute surface elevation (sand + water) once for the active region so
    // each 4-neighbor head difference does 1 array read instead of 2.
    const etaEnd = (top + 1 < ny ? top + 2 : ny) * nx;
    for (let k = 0; k < etaEnd; k++) tmp[k] = sand[k] + water[k];

    for (let j = 0; j <= top; j++) {
      const inSponge = j < sponge;
      const hasD = j > 0;
      const hasU = j < ny1;
      for (let i = 0, k = j * nx; i < nx; i++, k++) {
        const d = water[k];
        if (d <= 0) {
          fL[k] = 0;
          fR[k] = 0;
          fD[k] = 0;
          fU[k] = 0;
          continue;
        }
        const hk = tmp[k];
        // full damping in the shallows (where the checkerboard mode lives),
        // much less out in deep water so waves keep their height on the way in
        // (and full damping in the sponge at the forced edge, which smooths the
        // step between the hard-set first row and the free water behind it)
        const dtLin = inSponge || d < 0.7 ? dtLin0 : d > 1.1 ? dtLinDeep : 1 + dt * (lin0 + linSlope * (d - 0.7));
        let l = 0;
        let r = 0;
        let dn = 0;
        let up = 0;
        if (i > 0) {
          const kn = k - 1;
          const dh = hk - tmp[kn];
          const prev = fL[k];
          if (dh > 0 || prev > 0) {
            let da = 0.5 * (d + water[kn]);
            if (da < 0.002) da = 0.002;
            else if (da > maxD) da = maxD;
            l = prev + dtG * da * dh;
            if (l > 0) {
              const da2 = da * da;
              l = (l * da2) / (dtLin * da2 + dtCfDx * l);
            } else l = 0;
          }
        }
        if (i < nx1) {
          const kn = k + 1;
          const dh = hk - tmp[kn];
          const prev = fR[k];
          if (dh > 0 || prev > 0) {
            let da = 0.5 * (d + water[kn]);
            if (da < 0.002) da = 0.002;
            else if (da > maxD) da = maxD;
            r = prev + dtG * da * dh;
            if (r > 0) {
              const da2 = da * da;
              r = (r * da2) / (dtLin * da2 + dtCfDx * r);
            } else r = 0;
          }
        }
        if (hasD) {
          const kn = k - nx;
          const dh = hk - tmp[kn];
          const prev = fD[k];
          if (dh > 0 || prev > 0) {
            let da = 0.5 * (d + water[kn]);
            if (da < 0.002) da = 0.002;
            else if (da > maxD) da = maxD;
            dn = prev + dtG * da * dh;
            if (dn > 0) {
              const da2 = da * da;
              dn = (dn * da2) / (dtLin * da2 + dtCfDx * dn);
            } else dn = 0;
          }
        }
        if (hasU) {
          const kn = k + nx;
          const dh = hk - tmp[kn];
          const prev = fU[k];
          if (dh > 0 || prev > 0) {
            let da = 0.5 * (d + water[kn]);
            if (da < 0.002) da = 0.002;
            else if (da > maxD) da = maxD;
            up = prev + dtG * da * dh;
            if (up > 0) {
              const da2 = da * da;
              up = (up * da2) / (dtLin * da2 + dtCfDx * up);
            } else up = 0;
          }
        }
        const sum = l + r + dn + up;
        const maxSum = d * areaOverDt;
        if (sum > maxSum) {
          const K = maxSum / sum;
          l *= K;
          r *= K;
          dn *= K;
          up *= K;
        }
        fL[k] = l;
        fR[k] = r;
        fD[k] = dn;
        fU[k] = up;
      }
    }

    for (let j = 0; j <= top; j++) {
      const hasD = j > 0;
      const hasU = j < ny1;
      for (let i = 0, k = j * nx; i < nx; i++, k++) {
        const inL = i > 0 ? fR[k - 1] : 0;
        const inR = i < nx1 ? fL[k + 1] : 0;
        const inD = hasD ? fU[k - nx] : 0;
        const inU = hasU ? fD[k + nx] : 0;
        const inSum = inL + inR + inD + inU;
        const d0 = water[k];
        if (d0 === 0 && inSum === 0) {
          vx[k] = 0;
          vy[k] = 0;
          continue;
        }
        const oL = fL[k];
        const oR = fR[k];
        const oD = fD[k];
        const oU = fU[k];
        let d1 = d0 + dtOverArea * (inSum - (oL + oR + oD + oU));
        if (d1 < 0) d1 = 0;
        water[k] = d1;
        const db = 0.5 * (d0 + d1);
        if (db > 1e-3) {
          // thin films get a floor on depth so their velocity stays sane
          const dv = db < 0.02 ? 0.02 : db;
          const inv = halfInvDx / dv;
          let ux = (inL - oL + oR - inR) * inv;
          let uy = (inD - oD + oU - inU) * inv;
          const sp2 = ux * ux + uy * uy;
          if (sp2 > 16) {
            const f = 4 / Math.sqrt(sp2);
            ux *= f;
            uy *= f;
          }
          vx[k] = ux;
          vy[k] = uy;
        } else {
          vx[k] = 0;
          vy[k] = 0;
        }
      }
    }
  }

  /** Holes dug below the water table near the sea slowly fill with seep water. */
  private seep(dt: number): void {
    const { nx, ny, sand, water, rest, restRowMin, restRowMax } = this;
    const level = this.meanLevel();
    const rate = dt / 6 < 1 ? dt / 6 : 1;
    const maxLevel = level + 0.9;
    for (let j = 1; j < ny; j++) {
      if (restRowMax[j] <= level || restRowMin[j] > maxLevel) continue;
      for (let k = j * nx, e = k + nx; k < e; k++) {
        // water table: sea level at the shoreline, rising slightly then
        // falling away under the dry beach
        const above = rest[k] - level;
        if (above <= 0 || above > 0.9) continue;
        const table = level + 0.05 - above * 0.35;
        const target = table - sand[k];
        if (target > water[k]) {
          water[k] += (target - water[k]) * rate;
          if (j > this.flowTop) this.flowTop = j;
        }
      }
    }
  }

  /** Sediment pick-up / drop and transport by the water. */
  private erode(dt: number): void {
    const { nx, ny, dx, sand, water, sediment, vx, vy, bottom, tmp, rest } = this;
    // (tmp is reused below for the transport step)
    const Kc = EROSION.capacity;
    const KsDt = EROSION.dissolve * dt;
    const KdDt = EROSION.deposit * dt;
    const minS = EROSION.minSlope;
    const dry = WATER.dryDepth * 2;
    const inv2dx = 1 / (2 * dx);
    const inv005 = 20; // 1 / 0.05
    const inv06 = 1 / 0.6;
    const ny1 = ny - 1;
    const nx1 = nx - 1;

    const scanTop = Math.min(ny - 2, Math.max(this.flowTop, this.sedTop));
    let nextSedTop = -1;

    for (let j = 1; j <= scanTop; j++) {
      let rowHasSed = false;
      for (let i = 1, k = j * nx + 1; i < nx1; i++, k++) {
        const d = water[k];
        let s = sediment[k];
        if (d < dry) {
          if (s > 0) {
            sand[k] += s;
            sediment[k] = 0;
          }
          continue;
        }
        // deep water (d >= 0.95 => depthF === 0) carries nothing: skip slope and speed
        if (d >= 0.95) {
          if (s > 0) {
            const amt = KdDt * s;
            sand[k] += amt;
            s -= amt;
            sediment[k] = s;
            if (s > 0) rowHasSed = true;
          }
          continue;
        }
        // The rest profile is in equilibrium with the waves, so capacity is
        // driven by the slope of the *disturbance* (what the player made).
        // That keeps the natural beach stable while castles and pits erode.
        let C = 0;
        const ux = vx[k];
        const uy = vy[k];
        const sp2 = ux * ux + uy * uy;
        if (sp2 > 0) {
          const f1 = d < 0.05 ? d * inv005 : 1;
          const f2 = d <= 0.35 ? 1 : 1 - (d - 0.35) * inv06;
          const depthF = f1 * f2;
          const gx = (sand[k + 1] - rest[k + 1] - sand[k - 1] + rest[k - 1]) * inv2dx;
          const gy = (sand[k + nx] - rest[k + nx] - sand[k - nx] + rest[k - nx]) * inv2dx;
          const g2 = gx * gx + gy * gy;
          let sinA = Math.sqrt(g2 / (1 + g2));
          if (sinA < minS) sinA = minS;
          C = Kc * sinA * Math.sqrt(sp2) * depthF;
        }
        if (C > s) {
          const avail = sand[k] - bottom[k];
          if (avail > 0) {
            const raw = KsDt * (C - s);
            const amt = raw < avail ? raw : avail;
            sand[k] -= amt;
            s += amt;
          }
        } else if (s > C) {
          const amt = KdDt * (s - C);
          sand[k] += amt;
          s -= amt;
        }
        sediment[k] = s;
        if (s > 0) rowHasSed = true;
      }
      if (rowHasSed) nextSedTop = j;
    }

    if (nextSedTop < 0) {
      this.sedTop = -1;
      return;
    }

    // Conservative transport: suspended sand rides along the same pipe fluxes
    // as the water (donor cell), so no sand is created or lost in transit.
    const { fL, fR, fD, fU } = this;
    const dtOverArea = dt / (dx * dx);
    const transTop = nextSedTop < ny1 ? nextSedTop + 1 : ny1;
    const sliceEnd = (transTop + 1) * nx;
    tmp.set(sediment.subarray(0, sliceEnd));
    let outSedTop = -1;
    for (let j = 0; j <= nextSedTop; j++) {
      const hasD = j > 0;
      const hasU = j < ny1;
      for (let i = 0, k = j * nx; i < nx; i++, k++) {
        const s0 = sediment[k];
        if (s0 <= 0) continue;
        if (j > outSedTop) outSedTop = j;
        const d = water[k];
        if (d < 1e-4) continue;
        const fl = fL[k];
        const fr = fR[k];
        const fd = fD[k];
        const fu = fU[k];
        const sum = fl + fr + fd + fu;
        if (sum <= 0) continue;
        const rawFrac = (sum * dtOverArea) / d;
        const frac = rawFrac < 1 ? rawFrac : 1;
        const moved = s0 * frac;
        const per = moved / sum;
        tmp[k] -= moved;
        if (i > 0) tmp[k - 1] += fl * per;
        else tmp[k] += fl * per;
        if (i < nx1) tmp[k + 1] += fr * per;
        else tmp[k] += fr * per;
        if (hasD) tmp[k - nx] += fd * per;
        else tmp[k] += fd * per;
        if (hasU) {
          tmp[k + nx] += fu * per;
          if (fu > 0 && j + 1 > outSedTop) outSedTop = j + 1;
        } else tmp[k] += fu * per;
      }
    }
    sediment.set(tmp.subarray(0, sliceEnd));
    this.sedTop = outSedTop;
  }

  /** Move sand down slopes steeper than the (wetness dependent) angle of repose. */
  private slump(): void {
    const { nx, ny, dx, sand, water, wet, bottom, slumpDelta } = this;
    const tDry = Math.tan(SAND.reposeDry * DEG) * dx;
    const tDamp = Math.tan(SAND.reposeDamp * DEG) * dx;
    const tSat = Math.tan(SAND.reposeSaturated * DEG) * dx;
    const tDiff = tDamp - tDry;
    const tMin = tSat < tDry ? (tSat < tDamp ? tSat : tDamp) : (tDry < tDamp ? tDry : tDamp);
    const sub = WATER.dryDepth * 3;
    const rate = SAND.slumpRate * 0.5;
    const nx1 = nx - 1;
    const ny1 = ny - 1;

    // Saturated sand (under water, or right next to moving water) gives way at
    // a low angle: this is what lets waves undercut walls and castles.
    // Evaluated lazily only on cells beside an edge steeper than tMin.
    const tanAt = (k: number, i: number, j: number): number => {
      if (
        water[k] > sub ||
        (i > 0 && water[k - 1] > sub) ||
        (i < nx1 && water[k + 1] > sub) ||
        (j > 0 && water[k - nx] > sub) ||
        (j < ny1 && water[k + nx] > sub)
      ) {
        return tSat;
      }
      const w = wet[k] * 1.25;
      return tDry + tDiff * (w > 1 ? 1 : w);
    };

    let prevDirty = this.slumpRowA;
    let nextDirty = this.slumpRowB;

    for (let it = 0; it < SAND.slumpIterations; it++) {
      let anyMoved = false;
      nextDirty.fill(0);
      for (let j = 0; j < ny; j++) {
        if (it > 0 && !(prevDirty[j] || (j > 0 && prevDirty[j - 1]) || (j < ny1 && prevDirty[j + 1]))) continue;
        const hasU = j < ny1;
        for (let i = 0, k = j * nx; i < nx; i++, k++) {
          const hk = sand[k];
          if (i < nx1) {
            const kn = k + 1;
            const hkn = sand[kn];
            const dh = hk - hkn;
            if (dh > tMin) {
              const tk = tanAt(k, i, j);
              const tkn = tanAt(kn, i + 1, j);
              const t = tk < tkn ? tk : tkn;
              if (dh > t) {
                const avail = (hk - bottom[k]) * 0.25;
                if (avail > 0) {
                  const raw = (dh - t) * rate;
                  const m = raw < avail ? raw : avail;
                  slumpDelta[k] -= m;
                  slumpDelta[kn] += m;
                  nextDirty[j] = 1;
                  anyMoved = true;
                }
              }
            } else if (-dh > tMin) {
              const tk = tanAt(k, i, j);
              const tkn = tanAt(kn, i + 1, j);
              const t = tk < tkn ? tk : tkn;
              if (-dh > t) {
                const avail = (hkn - bottom[kn]) * 0.25;
                if (avail > 0) {
                  const raw = (-dh - t) * rate;
                  const m = raw < avail ? raw : avail;
                  slumpDelta[k] += m;
                  slumpDelta[kn] -= m;
                  nextDirty[j] = 1;
                  anyMoved = true;
                }
              }
            }
          }
          if (hasU) {
            const kn = k + nx;
            const hkn = sand[kn];
            const dh = hk - hkn;
            if (dh > tMin) {
              const tk = tanAt(k, i, j);
              const tkn = tanAt(kn, i, j + 1);
              const t = tk < tkn ? tk : tkn;
              if (dh > t) {
                const avail = (hk - bottom[k]) * 0.25;
                if (avail > 0) {
                  const raw = (dh - t) * rate;
                  const m = raw < avail ? raw : avail;
                  slumpDelta[k] -= m;
                  slumpDelta[kn] += m;
                  nextDirty[j] = 1;
                  nextDirty[j + 1] = 1;
                  anyMoved = true;
                }
              }
            } else if (-dh > tMin) {
              const tk = tanAt(k, i, j);
              const tkn = tanAt(kn, i, j + 1);
              const t = tk < tkn ? tk : tkn;
              if (-dh > t) {
                const avail = (hkn - bottom[kn]) * 0.25;
                if (avail > 0) {
                  const raw = (-dh - t) * rate;
                  const m = raw < avail ? raw : avail;
                  slumpDelta[k] += m;
                  slumpDelta[kn] -= m;
                  nextDirty[j] = 1;
                  nextDirty[j + 1] = 1;
                  anyMoved = true;
                }
              }
            }
          }
        }
      }
      if (!anyMoved) break;
      for (let j = 0; j < ny; j++) {
        if (!nextDirty[j]) continue;
        for (let k = j * nx, e = k + nx; k < e; k++) {
          const d = slumpDelta[k];
          if (d !== 0) {
            sand[k] += d;
            slumpDelta[k] = 0;
          }
        }
      }
      const swap = prevDirty;
      prevDirty = nextDirty;
      nextDirty = swap;
    }
  }

  /** Very slow pull back to the rest profile wherever the sea reaches. */
  private heal(dt: number): void {
    const { nx, sand, rest, water, wet, bottom } = this;
    const a = dt / EROSION.healingTime;
    const dry = WATER.dryDepth;
    const top = Math.max(this.flowTop, this.wetTop);
    if (top < 0) return;
    const end = (top + 1) * nx;
    for (let k = 0; k < end; k++) {
      if (water[k] > dry || wet[k] > 0.97) {
        const sk = sand[k];
        const rk = rest[k];
        if (sk !== rk) {
          const v = sk + (rk - sk) * a;
          const b = bottom[k];
          sand[k] = v < b ? b : v; // never through a rock
        }
      }
    }
  }

  private updateWetFoam(dt: number): void {
    const { nx, ny, dx, sand, water, wet, foam, vx, vy } = this;
    const dryK = Math.exp(-dt / SAND.dryingTime);
    const foamK = Math.exp(-dt / 1.3);
    const foamDryK = Math.exp(-dt / 0.5);
    const level = this.meanLevel();
    const capH = SAND.capillaryHeight;
    const capLevel = level + capH;
    const invCapH = 1 / capH;
    const dry = WATER.dryDepth;
    const sponge = Math.min(WAVES.spongeRows, ny);
    const inv2dx = 1 / (2 * dx);
    const boreThresh = 0.06 * 2 * dx;
    const boreThresh2 = boreThresh * boreThresh;
    const nx1 = nx - 1;
    const ny1 = ny - 1;

    // the forced boundary rows would otherwise sprout a line of foam
    for (let j = 0; j < sponge; j++) {
      for (let k = j * nx, e = k + nx; k < e; k++) {
        if (water[k] > dry && wet[k] !== 1) wet[k] = 1;
        if (foam[k] !== 0) foam[k] = 0;
      }
    }

    const activeTop = Math.min(ny1, Math.max(this.flowTop, sponge - 1));
    let nextWetTop = sponge - 1;

    for (let j = sponge; j <= activeTop; j++) {
      let rowWet = false;
      const inY = j > 0 && j < ny1;
      for (let i = 0, k = j * nx; i < nx; i++, k++) {
        const d = water[k];
        if (d > dry) {
          if (wet[k] !== 1) wet[k] = 1;
          rowWet = true;
          // foam forms where the wave front runs up the sand (thin, fast,
          // moving landward) and on steep incoming bores
          const up = vy[k];
          let f = 0;
          if (d < 0.12 && up > 0.25) {
            f = smoothstep(0.25, 0.9, up) * (1 - smoothstep(0.03, 0.12, d));
          }
          if (d < 0.3) {
            const ux = vx[k];
            const sp2 = ux * ux + up * up;
            if (sp2 > 0.36) {
              const f2 = smoothstep(0.6, 1.8, Math.sqrt(sp2)) * (1 - smoothstep(0.02, 0.3, d)) * 0.6;
              if (f2 > f) f = f2;
            }
          }
          if (inY && i > 0 && i < nx1 && d > 0.015 && up > 0.05) {
            const dex = sand[k + 1] + water[k + 1] - sand[k - 1] - water[k - 1];
            const dey = sand[k + nx] + water[k + nx] - sand[k - nx] - water[k - nx];
            const de2 = dex * dex + dey * dey;
            if (de2 > boreThresh2) {
              const f3 = smoothstep(0.06, 0.2, Math.sqrt(de2) * inv2dx) * 0.85;
              if (f3 > f) f = f3;
            }
          }
          const fk = foam[k];
          if (f > 0 || fk > 0) {
            const fo = fk * foamK;
            const nf = fo > f ? fo : f;
            foam[k] = nf < 1e-6 ? 0 : nf;
          }
        } else {
          const sk = sand[k];
          const wk = wet[k];
          if (sk < capLevel || wk > 0) {
            const cap = sk >= capLevel ? 0 : sk <= level ? 0.8 : (1 - (sk - level) * invCapH) * 0.8;
            let w = wk * dryK;
            if (w < 1e-6) w = 0;
            const nw = w > cap ? w : cap;
            wet[k] = nw;
            if (nw > 0) rowWet = true;
          }
          const fk = foam[k];
          if (fk > 0) {
            const nf = fk * foamDryK;
            foam[k] = nf < 1e-6 ? 0 : nf;
            if (nf >= 1e-6) rowWet = true;
          }
        }
      }
      if (rowWet) nextWetTop = j;
    }

    // Above flowTop water is guaranteed 0: dry-only pass (no water/vx/vy reads)
    for (let j = activeTop + 1; j < ny; j++) {
      let rowWet = false;
      for (let k = j * nx, e = k + nx; k < e; k++) {
        const sk = sand[k];
        const wk = wet[k];
        if (sk < capLevel || wk > 0) {
          const cap = sk >= capLevel ? 0 : sk <= level ? 0.8 : (1 - (sk - level) * invCapH) * 0.8;
          let w = wk * dryK;
          if (w < 1e-6) w = 0;
          const nw = w > cap ? w : cap;
          wet[k] = nw;
          if (nw > 0) rowWet = true;
        }
        const fk = foam[k];
        if (fk > 0) {
          const nf = fk * foamDryK;
          foam[k] = nf < 1e-6 ? 0 : nf;
          if (nf >= 1e-6) rowWet = true;
        }
      }
      if (rowWet) nextWetTop = j;
    }
    this.wetTop = nextWetTop;
  }

  // ---------------------------------------------------------------- brush

  /** Convert world metres (alongshore x, cross-shore y) to a fractional cell index. */
  private toCell(x: number, y: number): [number, number] {
    return [x / this.dx - 0.5, y / this.dx - 0.5];
  }

  beginStroke(x: number, y: number, r: number, mode: BrushMode = 'dig'): void {
    if (this.stroke) this.endStroke();
    const [ci, cj] = this.toCell(x, y);
    this.stroke = {
      mode,
      x,
      y,
      r,
      lastX: x,
      lastY: y,
      hold: 0,
      dirX: 0,
      dirY: 0,
      snapshot: this.sand.slice(),
      i0: Math.floor(ci),
      j0: Math.floor(cj),
      i1: Math.ceil(ci),
      j1: Math.ceil(cj),
      swept: [],
      lift: [],
    };
  }

  /** Mold a tower out of sand. It erodes and saves just like the rest of the beach. */
  moldCastle(x: number, y: number, shape: CastleShape): void {
    const [ci, cj] = this.toCell(x, y);
    const radius = SANDCASTLE.radius / this.dx;
    const i0 = Math.max(0, Math.floor(ci - radius));
    const i1 = Math.min(this.nx - 1, Math.ceil(ci + radius));
    const j0 = Math.max(0, Math.floor(cj - radius));
    const j1 = Math.min(this.ny - 1, Math.ceil(cj + radius));
    const before = this.sand.slice();
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = Math.abs(i - ci);
        const dy = Math.abs(j - cj);
        const distance = shape === 'square' ? Math.max(dx, dy) : Math.hypot(dx, dy);
        this.sand[j * this.nx + i] += SANDCASTLE.height * (1 - smoothstep(SANDCASTLE.flatTop, 1, distance / radius));
      }
    }
    const entry = this.diffRegion(before, i0, j0, i1, j1);
    if (entry) this.undo.push(entry);
  }

  moveStroke(x: number, y: number, r: number): void {
    if (!this.stroke) return;
    this.stroke.x = x;
    this.stroke.y = y;
    this.stroke.r = r;
  }

  get strokeActive(): boolean {
    return this.stroke !== null;
  }

  /** Finish the current stroke and record it for undo. */
  endStroke(): void {
    const st = this.stroke;
    if (!st) return;
    this.stroke = null;
    let entry = this.diffRegion(st.snapshot, st.i0, st.j0, st.i1, st.j1);
    if (entry && st.lift.length) entry = this.withoutLift(entry, st.lift);
    if (entry) {
      if (st.swept.length) entry.removed = st.swept;
      this.undo.push(entry);
    } else if (st.swept.length) {
      // the stroke only swept up objects: still undoable, sand untouched
      this.undo.push({ i0: 0, j0: 0, w: 0, h: 0, delta: new Float32Array(0), removed: st.swept });
    }
  }

  /**
   * Take the sand a swept rock lifted back out of a stroke's undo delta.
   * The lift is the rock's own doing — undo re-embeds the rock, which
   * raises that sand again — so leaving it in the delta would count it
   * twice and leave a sand dome where the rock was. Returns null when
   * the delta has nothing left (the stroke only swept rocks up).
   */
  private withoutLift(entry: UndoEntry, lift: { k: number; d: number }[]): UndoEntry | null {
    for (const { k, d } of lift) {
      const i = (k % this.nx) - entry.i0;
      const j = Math.floor(k / this.nx) - entry.j0;
      if (i < 0 || i >= entry.w || j < 0 || j >= entry.h) continue;
      entry.delta[j * entry.w + i] -= d;
    }
    for (let n = 0; n < entry.delta.length; n++) {
      if (entry.delta[n] > 1e-5 || entry.delta[n] < -1e-5) return entry;
    }
    return null;
  }

  /** Abort the current stroke and put the sand back exactly as it was. */
  cancelStroke(): void {
    const st = this.stroke;
    if (!st) return;
    this.stroke = null;
    // anything the blade or vacuum already swept up goes back on the beach
    // first, while the sand is still as the stroke left it: a rock re-embeds
    // against the sand it was lifted from, so it keeps the base it was
    // placed at (and the sand it was sitting on) instead of the lifted sand
    for (const o of st.swept) this.objects.add({ ...o });
    const { i0, j0, i1, j1 } = this.clipBox(st.i0, st.j0, st.i1, st.j1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.nx + i;
        this.sand[k] = st.snapshot[k];
      }
    }
  }

  private clipBox(i0: number, j0: number, i1: number, j1: number) {
    const m = 6;
    return {
      i0: Math.max(0, i0 - m),
      j0: Math.max(0, j0 - m),
      i1: Math.min(this.nx - 1, i1 + m),
      j1: Math.min(this.ny - 1, j1 + m),
    };
  }

  private diffRegion(
    before: Float32Array,
    bi0: number,
    bj0: number,
    bi1: number,
    bj1: number,
  ): UndoEntry | null {
    const { i0, j0, i1, j1 } = this.clipBox(bi0, bj0, bi1, bj1);
    const w = i1 - i0 + 1;
    const h = j1 - j0 + 1;
    const delta = new Float32Array(w * h);
    let any = false;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = (j + j0) * this.nx + i + i0;
        const d = this.sand[k] - before[k];
        delta[j * w + i] = d;
        if (d > 1e-5 || d < -1e-5) any = true;
      }
    }
    return any ? { i0, j0, w, h, delta } : null;
  }

  private applyBrush(dt: number): void {
    const st = this.stroke;
    this.digIntensity *= 0.6;
    if (!st) return;
    const dxm = st.x - st.lastX;
    const dym = st.y - st.lastY;
    const dist = Math.sqrt(dxm * dxm + dym * dym);
    const speed = dist / dt;
    if (speed < BRUSH.moveSpeed) st.hold += dt;
    else st.hold = Math.max(0, st.hold - dt * 3);
    if (dist > 1e-6) {
      st.dirX = st.dirX * 0.5 + (dxm / dist) * 0.5;
      st.dirY = st.dirY * 0.5 + (dym / dist) * 0.5;
      const dl = Math.sqrt(st.dirX * st.dirX + st.dirY * st.dirY) || 1;
      st.dirX /= dl;
      st.dirY /= dl;
    }
    const rate =
      BRUSH.rateStart + (BRUSH.rateHeld - BRUSH.rateStart) * smoothstep(0, BRUSH.holdRamp, st.hold);
    const spacing = Math.max(st.r * 0.35, this.dx * 0.5);
    const stamps = Math.max(1, Math.ceil(dist / spacing));
    const amount = (rate * dt) / stamps;
    for (let s = 1; s <= stamps; s++) {
      const t = s / stamps;
      const x = st.lastX + dxm * t;
      const y = st.lastY + dym * t;
      this.stamp(st.mode, x, y, st.r, amount, dist > 1e-6 ? st.dirX : 0, dist > 1e-6 ? st.dirY : 0);
      if (st.mode === 'dozer') this.sweepAt(st, x, y, st.r * BRUSH.flattenWidth);
      else if (st.mode === 'vacuum') this.sweepAt(st, x, y, st.r);
      const [ci, cj] = this.toCell(x, y);
      const rc = Math.ceil((st.r * Math.max(BRUSH.rimOuter, BRUSH.flattenWidth)) / this.dx) + 1;
      st.i0 = Math.min(st.i0, Math.floor(ci) - rc);
      st.j0 = Math.min(st.j0, Math.floor(cj) - rc);
      st.i1 = Math.max(st.i1, Math.ceil(ci) + rc);
      st.j1 = Math.max(st.j1, Math.ceil(cj) + rc);
    }
    st.lastX = st.x;
    st.lastY = st.y;
    this.digIntensity = Math.min(1, 0.25 + rate / BRUSH.rateHeld * 0.5 + Math.min(1, speed / 3) * 0.5);
  }

  /**
   * The dozer blade or the vacuum nozzle sweeps up whatever it passes over.
   * Taking it off the beach is the return to the bag: the inventory counts
   * what's placed, so the next save (which persists the objects list) puts
   * it back in hand. Rocks are placed items like the rest — a rock in the
   * path is swept up and its floor lifted back — so the blade and the
   * vacuum can clear them. (The terrain rock — the non-erodible floor you
   * can't dig below — is untouched: it is the heightmap, not an object.)
   * The sea's strays (wild) are swept away too, but they were never yours.
   */
  private sweepAt(st: NonNullable<typeof this.stroke>, x: number, y: number, radius: number): void {
    for (const o of this.objects.within(x, y, radius)) {
      const taken = this.objects.removeWithLift(o.id);
      if (!taken) continue;
      st.swept.push(taken.data);
      st.lift.push(...taken.lift);
    }
  }

  /** One brush dab. amount = depth (m) at the centre. */
  stamp(mode: BrushMode, x: number, y: number, r: number, amount: number, dirX = 0, dirY = 0): void {
    const { nx, ny, dx, sand, bottom } = this;
    // the vacuum moves no sand at all: it only sweeps up objects (see sweepAt)
    if (mode === 'vacuum') return;
    const [ci, cj] = this.toCell(x, y);
    const rc = r / dx;
    const outer = rc * BRUSH.rimOuter;
    const i0 = Math.max(0, Math.floor(ci - outer));
    const i1 = Math.min(nx - 1, Math.ceil(ci + outer));
    const j0 = Math.max(0, Math.floor(cj - outer));
    const j1 = Math.min(ny - 1, Math.ceil(cj + outer));
    if (i0 > i1 || j0 > j1) return;

    if (mode === 'smooth') {
      for (let j = Math.max(1, j0); j <= Math.min(ny - 2, j1); j++) {
        for (let i = Math.max(1, i0); i <= Math.min(nx - 2, i1); i++) {
          const q = Math.sqrt((i - ci) * (i - ci) + (j - cj) * (j - cj)) / rc;
          if (q >= 1) continue;
          const w = (1 - q * q) * (1 - q * q);
          const k = j * nx + i;
          const avg = (sand[k - 1] + sand[k + 1] + sand[k - nx] + sand[k + nx]) * 0.25;
          sand[k] += (avg - sand[k]) * Math.min(1, w * amount * 25);
        }
      }
      return;
    }

    if (mode === 'flatten' || mode === 'dozer') {
      // the bulldozer: a wide blade with a flat middle that pushes the sand
      // back to the untouched beach (never through a rock: those raise `bottom`)
      const { rest } = this;
      const rb = rc * BRUSH.flattenWidth;
      for (let j = Math.max(0, Math.floor(cj - rb)); j <= Math.min(ny - 1, Math.ceil(cj + rb)); j++) {
        for (let i = Math.max(0, Math.floor(ci - rb)); i <= Math.min(nx - 1, Math.ceil(ci + rb)); i++) {
          const q = Math.sqrt((i - ci) * (i - ci) + (j - cj) * (j - cj)) / rb;
          if (q >= 1) continue;
          const w = q < 0.6 ? 1 : 1 - smoothstep(0.6, 1, q);
          const k = j * nx + i;
          const target = Math.max(rest[k], bottom[k]);
          sand[k] += (target - sand[k]) * Math.min(1, w * amount * BRUSH.flattenRate);
        }
      }
      return;
    }

    if (mode === 'pile') {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const q = Math.sqrt((i - ci) * (i - ci) + (j - cj) * (j - cj)) / rc;
          if (q >= 1) continue;
          const w = (1 - q * q) * (1 - q * q);
          sand[j * nx + i] += amount * w * 0.8;
        }
      }
      return;
    }

    // dig
    let removed = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const q = Math.sqrt((i - ci) * (i - ci) + (j - cj) * (j - cj)) / rc;
        if (q >= 1) continue;
        const k = j * nx + i;
        const w = (1 - q * q) * (1 - q * q);
        const a = Math.min(amount * w, Math.max(0, sand[k] - bottom[k]));
        sand[k] -= a;
        removed += a;
      }
    }
    if (removed <= 0) return;
    // rim: put the sand on a ring around the dab, favouring the sides of the stroke
    const moving = dirX !== 0 || dirY !== 0;
    let wsum = 0;
    const ring = BRUSH.rimOuter - 1;
    const weights = this.tmpRim(i1 - i0 + 1, j1 - j0 + 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const di = i - ci;
        const dj = j - cj;
        const dist = Math.sqrt(di * di + dj * dj);
        const q = dist / rc;
        let w = 0;
        if (q > 0.85 && q < BRUSH.rimOuter) {
          w = Math.sin((Math.PI * (q - 0.85)) / (ring + 0.15));
          if (moving && dist > 0) {
            const side = Math.abs(dirX * (dj / dist) - dirY * (di / dist));
            const ahead = dirX * (di / dist) + dirY * (dj / dist);
            w *= 0.15 + side + Math.max(0, -ahead) * 0.3;
          }
        }
        weights[(j - j0) * (i1 - i0 + 1) + (i - i0)] = w;
        wsum += w;
      }
    }
    if (wsum <= 0) return;
    const put = (removed * BRUSH.rimFraction) / wsum;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w = weights[(j - j0) * (i1 - i0 + 1) + (i - i0)];
        if (w > 0) sand[j * nx + i] += put * w;
      }
    }
  }

  private rimBuf = new Float32Array(1024);
  private tmpRim(w: number, h: number): Float32Array {
    if (this.rimBuf.length < w * h) this.rimBuf = new Float32Array(w * h * 2);
    return this.rimBuf;
  }

  // ---------------------------------------------------------------- undo

  private applyUndoEasing(): void {
    if (!this.easing.length) return;
    for (const e of this.easing) {
      this.applyDelta(e.entry, e.sign / UNDO_EASE_TICKS);
      e.ticksLeft--;
    }
    this.easing = this.easing.filter((e) => e.ticksLeft > 0);
  }

  private applyDelta(entry: UndoEntry, scale: number): void {
    const { i0, j0, w, h, delta } = entry;
    const { sand, bottom, nx } = this;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const d = delta[j * w + i];
        if (d === 0) continue;
        const k = (j + j0) * nx + i + i0;
        const v = sand[k] + d * scale;
        sand[k] = v < bottom[k] ? bottom[k] : v;
      }
    }
  }

  /** Undo the most recent stroke (subtract its delta). Returns false if nothing to undo. */
  undoStroke(ease = true): boolean {
    if (this.stroke) this.endStroke();
    const e = this.undo.popUndo();
    if (!e) return false;
    if (e.swap) return this.applySwap(e, -1);
    if (e.obj) this.applyObject(e.obj, -1);
    if (e.removed) this.applyRemoved(e.removed, -1);
    if (e.w > 0 && e.h > 0) this.scheduleDelta(e, -1, ease);
    return true;
  }

  redoStroke(ease = true): boolean {
    if (this.stroke) this.endStroke();
    const e = this.undo.popRedo();
    if (!e) return false;
    if (e.swap) return this.applySwap(e, 1);
    if (e.obj) this.applyObject(e.obj, 1);
    if (e.removed) this.applyRemoved(e.removed, 1);
    if (e.w > 0 && e.h > 0) this.scheduleDelta(e, 1, ease);
    return true;
  }

  private scheduleDelta(e: UndoEntry, sign: number, ease: boolean): void {
    if (!ease) {
      this.applyDelta(e, sign);
      return;
    }
    this.easing.push({ entry: e, sign, ticksLeft: UNDO_EASE_TICKS });
  }

  // ---------------------------------------------------------------- objects

  /** Place an item on the beach (undoable). */
  placeObject(o: Omit<PlacedObject, 'id'>): PlacedObject {
    if (this.stroke) this.endStroke();
    const data = this.objects.add(o);
    this.undo.push({ i0: 0, j0: 0, w: 0, h: 0, delta: new Float32Array(0), obj: { op: 'add', data: { ...data } } });
    return data;
  }

  /** Take an item back off the beach (undoable). */
  removeObject(id: number): PlacedObject | null {
    const data = this.objects.remove(id);
    if (data) this.undo.push({ i0: 0, j0: 0, w: 0, h: 0, delta: new Float32Array(0), obj: { op: 'remove', data } });
    return data;
  }

  /**
   * Pick a thing up and put it down somewhere else (long-press and drag), as
   * one undo step. A rock lifts out of the floor where it was and settles
   * into the sand where it lands.
   */
  moveObject(id: number, x: number, y: number): PlacedObject | null {
    const prev = this.objects.remove(id);
    if (!prev) return null;
    const W = this.nx * this.dx;
    const H = this.ny * this.dx;
    const moved: PlacedObject = { ...prev, x: Math.min(W - 0.3, Math.max(0.3, x)), y: Math.min(H - 0.3, Math.max(0.3, y)) };
    delete moved.base; // a rock sits on the sand where it lands
    // something the sea brought in, picked up and put down: it's yours now,
    // and the sea won't take it back (the "found" collection)
    if (moved.wild) {
      delete moved.wild;
      moved.found = true;
    }
    const data = this.objects.add(moved);
    this.undo.push({ i0: 0, j0: 0, w: 0, h: 0, delta: new Float32Array(0), obj: { op: 'move', data: { ...data }, prev } });
    return data;
  }

  private applyObject(obj: NonNullable<UndoEntry['obj']>, sign: number): void {
    if (obj.op === 'move') {
      // undo: back where it was; redo: where it was put
      const from = sign < 0 ? obj.data : obj.prev!;
      const to = sign < 0 ? obj.prev! : obj.data;
      this.objects.remove(from.id);
      this.objects.add({ ...to });
      return;
    }
    // undo of an add / redo of a remove takes it away; the others put it back
    const putBack = (obj.op === 'add') === sign > 0;
    if (putBack) this.objects.add({ ...obj.data });
    else this.objects.remove(obj.data.id);
  }

  /** Undo of a dozer/vacuum stroke puts the swept-up objects back; redo takes them off again. */
  private applyRemoved(removed: PlacedObject[], sign: number): void {
    if (sign < 0) {
      for (const o of removed) this.objects.add({ ...o });
    } else {
      for (const o of removed) this.objects.remove(o.id);
    }
  }

  /**
   * Replace the whole beach (an imported beach file) as one undo step: the
   * old objects come off, the sand takes the new shape, the new objects go
   * on. Undo puts the old beach back exactly, and redo the imported one: a
   * whole-beach swap restores a snapshot, since subtracting the change would
   * leave ghosts of every edge that has slumped since.
   */
  importBeach(delta: Float32Array, objects: PlacedObject[], cover?: Float32Array): void {
    if (delta.length !== this.n) throw new Error('grid size mismatch');
    if (cover && cover.length !== this.n) throw new Error('grid size mismatch');
    if (this.stroke) this.cancelStroke();
    const before = this.objects.persisted();
    const beforeCover = this.objects.rockCover(this.sand);
    const beforeSand = this.objects.withoutRocks(this.sand.slice());
    this.objects.clear();
    if (beforeCover) {
      for (let k = 0; k < this.n; k++) {
        const floor = this.bottom[k];
        const saved = Math.max(floor, beforeSand[k]);
        const c = Math.min(beforeCover[k], saved - floor);
        beforeCover[k] = c;
        beforeSand[k] = saved - c;
      }
    }
    const afterCover = this.applyTerrain(delta, cover);
    this.sediment.fill(0);
    this.sedTop = -1;
    this.easing = [];
    // an imported beach may carry the old stacked-rock saves: repair
    // the rocks before embedding them (see loadDelta)
    const fixed = this.objects.repairLoaded(objects);
    // the change covers the sand shape including the repair; the rock
    // lifts and cover are re-applied by embedding on undo/redo
    const change = new Float32Array(this.n);
    for (let k = 0; k < this.n; k++) change[k] = this.sand[k] - beforeSand[k];
    const terrain = fixed.noRock ?? this.sand.slice();
    const after = fixed.objects.map((o) => this.objects.add({ ...o, id: undefined }, terrain));
    if (afterCover) {
      for (let k = 0; k < this.n; k++) if (afterCover[k] > 0) this.sand[k] += afterCover[k];
    }
    this.undo.push({
      i0: 0,
      j0: 0,
      w: this.nx,
      h: this.ny,
      delta: change,
      swap: { before, after, sand: beforeSand, beforeCover, afterCover },
    });
  }

  private applySwap(e: UndoEntry, sign: number): boolean {
    const { before, after, sand, beforeCover, afterCover } = e.swap!;
    // bulk: the sand is overwritten from the snapshot right after, so
    // there is nothing to restore rock by rock
    this.objects.clear();
    for (let k = 0; k < this.n; k++) {
      const v = sign < 0 ? sand[k] : sand[k] + e.delta[k];
      this.sand[k] = v < this.bottom[k] ? this.bottom[k] : v;
    }
    this.sediment.fill(0);
    this.sedTop = -1;
    this.easing = [];
    const terrain = this.sand.slice();
    for (const o of sign < 0 ? before : after) this.objects.add({ ...o }, terrain);
    const cover = sign < 0 ? beforeCover : afterCover;
    if (cover) {
      for (let k = 0; k < this.n; k++) if (cover[k] > 0) this.sand[k] += cover[k];
    }
    return true;
  }

  /**
   * Write the terrain before rocks (saved sand minus any rock cover) into
   * `this.sand` and return the clamped cover that was subtracted (undefined
   * when no cover was given). Clamping cover to `saved - bottom` ensures
   * adding it back after embedding rocks can never create sand outside rock
   * footprints.
   */
  private applyTerrain(delta: Float32Array, cover?: Float32Array): Float32Array | undefined {
    let applied: Float32Array | undefined;
    for (let k = 0; k < this.n; k++) {
      const floor = this.bottom[k];
      const saved = Math.max(floor, this.rest[k] + delta[k]);
      const c = cover && cover[k] > 0 ? Math.min(cover[k], saved - floor) : 0;
      if (c > 0) {
        if (!applied) applied = new Float32Array(this.n);
        applied[k] = c;
      }
      this.sand[k] = saved - c;
    }
    return applied;
  }

  /** Put the whole beach back to its rest shape (undoable). */
  resetBeach(): void {
    if (this.stroke) this.endStroke();
    const before = this.sand.slice();
    // back to the rest shape, but rocks stay where they are
    for (let k = 0; k < this.n; k++) this.sand[k] = Math.max(this.rest[k], this.bottom[k]);
    this.sediment.fill(0);
    this.sedTop = -1;
    const e = this.diffRegion(before, 0, 0, this.nx - 1, this.ny - 1);
    if (e) this.undo.push(e);
  }

  // ---------------------------------------------------------------- save / load

  /** The player's changes: sand minus the untouched beach. */
  sandDelta(): Float32Array {
    // rocks are saved as objects, not as sand
    const out = this.objects.withoutRocks(this.sand.slice());
    for (let k = 0; k < this.n; k++) out[k] -= this.rest[k];
    return out;
  }

  /** Sand piled on top of rocks (thickness above the rock dome, m), or undefined when none. */
  sandCover(): Float32Array | undefined {
    return this.objects.rockCover(this.sand);
  }

  /** Restore a saved beach (same grid size). Clears undo history, or takes the beach's own `history`. */
  loadDelta(delta: Float32Array, objects: PlacedObject[] = [], cover?: Float32Array, history?: UndoHistory): void {
    if (delta.length !== this.n) throw new Error('grid size mismatch');
    if (cover && cover.length !== this.n) throw new Error('grid size mismatch');
    if (this.stroke) this.cancelStroke();
    this.objects.clear();
    const appliedCover = this.applyTerrain(delta, cover);
    this.sediment.fill(0);
    this.sedTop = -1;
    // old saves can hold rocks stacked on each other's lifted sand:
    // repair them before embedding, or the stack (and its sand pillar)
    // comes back with the load
    const fixed = this.objects.repairLoaded(objects);
    const terrain = fixed.noRock ?? this.sand.slice();
    for (const o of fixed.objects) this.objects.add(o, terrain);
    if (appliedCover) {
      for (let k = 0; k < this.n; k++) if (appliedCover[k] > 0) this.sand[k] += appliedCover[k];
    }
    this.undo.clear();
    if (history) this.undo.restore(history);
    this.easing = [];
  }

  // ---------------------------------------------------------------- output

  /** Pack sand/water/wet/foam into an RGBA float buffer (for one texture upload). */
  pack(out: Float32Array): void {
    const { sand, water, wet, foam, n } = this;
    let k = 0;
    let o = 0;
    const n4 = n & ~3;
    for (; k < n4; k += 4, o += 16) {
      out[o] = sand[k];
      out[o + 1] = water[k];
      out[o + 2] = wet[k];
      out[o + 3] = foam[k];
      out[o + 4] = sand[k + 1];
      out[o + 5] = water[k + 1];
      out[o + 6] = wet[k + 1];
      out[o + 7] = foam[k + 1];
      out[o + 8] = sand[k + 2];
      out[o + 9] = water[k + 2];
      out[o + 10] = wet[k + 2];
      out[o + 11] = foam[k + 2];
      out[o + 12] = sand[k + 3];
      out[o + 13] = water[k + 3];
      out[o + 14] = wet[k + 3];
      out[o + 15] = foam[k + 3];
    }
    for (; k < n; k++, o += 4) {
      out[o] = sand[k];
      out[o + 1] = water[k];
      out[o + 2] = wet[k];
      out[o + 3] = foam[k];
    }
  }

  stats(): SimStats {
    let s = 0;
    let w = 0;
    let c = 0;
    for (let k = 0; k < this.n; k++) {
      s += this.sand[k];
      w += this.water[k];
      if (this.water[k] > WATER.dryDepth) c++;
    }
    const a = this.dx * this.dx;
    return { totalSand: s * a, totalWater: w * a, wetCells: c };
  }

  /** Cheap deterministic fingerprint of the fields, for regression tests. */
  hash(): number {
    let h = 2166136261;
    for (let k = 0; k < this.n; k += 7) {
      const v = Math.round(this.sand[k] * 1e4) ^ (Math.round(this.water[k] * 1e4) << 1);
      h = Math.imul(h ^ v, 16777619);
    }
    return h >>> 0;
  }
}
