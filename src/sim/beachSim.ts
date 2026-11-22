import {
  BRUSH,
  EROSION,
  PROFILE,
  SAND,
  UNDO_DEPTH,
  WATER,
  WAVES,
  type GridSpec,
} from '../config';
import { buildRestProfile } from './profile';
import { makeSwell, swellAt, tideAt, type SwellComponent } from './waves';
import { UndoStack, type UndoEntry } from './undoStack';

export type BrushMode = 'dig' | 'pile' | 'smooth';

export interface SimFlags {
  waves: boolean;
  calm: boolean;
  tide: boolean;
  erosion: boolean;
  healing: boolean;
  seep: boolean;
  /** close the offshore boundary (no forcing). Used by tests. */
  closed: boolean;
}

export const DEFAULT_FLAGS: SimFlags = {
  waves: true,
  calm: false,
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
  private readonly tanMax: Float32Array;

  flags: SimFlags;
  time = 0;
  /** eased 0..1 amount of "calm" (so toggling doesn't jolt the water) */
  calmMix = 0;
  readonly swell: SwellComponent[];
  readonly seed: number;

  readonly undo = new UndoStack(UNDO_DEPTH);
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
  } | null = null;
  /** 0..1 how hard the brush is working this tick (for audio/haptics) */
  digIntensity = 0;

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
    this.tanMax = new Float32Array(n);
    this.swell = makeSwell(seed);
    const eta = this.seaLevel(0);
    for (let k = 0; k < n; k++) {
      this.water[k] = Math.max(0, eta - this.sand[k]);
      this.wet[k] = this.water[k] > 0 ? 1 : 0;
    }
  }

  /** Mean water level (tide only) at time t. */
  meanLevel(t = this.time): number {
    return tideAt(t, this.flags.tide && !this.flags.closed);
  }

  /** Water surface imposed at the offshore boundary. */
  seaLevel(t = this.time): number {
    if (this.flags.closed) return 0;
    const amp = this.flags.waves ? 1 - (1 - WAVES.calmFactor) * this.calmMix : 0;
    return this.meanLevel(t) + swellAt(t, this.swell, amp);
  }

  // ---------------------------------------------------------------- stepping

  /** Advance the whole simulation by dt seconds (one tick). */
  step(dt: number): void {
    const calmTarget = this.flags.calm ? 1 : 0;
    this.calmMix += (calmTarget - this.calmMix) * Math.min(1, dt / 2.5);

    this.applyBrush(dt);
    this.applyUndoEasing();

    const sub = WATER.substeps;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      this.time += h;
      if (!this.flags.closed) this.force(h);
      this.flow(h);
    }
    if (this.flags.seep) this.seep(dt);
    if (this.flags.erosion) this.erode(dt);
    this.slump();
    if (this.flags.healing) this.heal(dt);
    this.updateWetFoam(dt);
  }

  /** Offshore boundary: hard-set the first row, relax a sponge layer behind it. */
  private force(dt: number): void {
    const { nx, sand, water } = this;
    const eta = this.seaLevel();
    const rows = Math.min(WAVES.spongeRows, this.ny - 1);
    for (let j = 0; j < rows; j++) {
      const w = j === 0 ? 1 : Math.min(1, dt * 6 * Math.pow(1 - j / rows, 2));
      const damp = 1 - Math.min(1, dt * 3 * Math.pow(1 - j / rows, 2));
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const target = Math.max(0, eta - sand[k]);
        water[k] += (target - water[k]) * w;
        this.fL[k] *= damp;
        this.fR[k] *= damp;
      }
    }
  }

  /** Virtual-pipes shallow water step (Mei et al. 2007). */
  private flow(dt: number): void {
    const { nx, ny, dx, sand, water, fL, fR, fD, fU, vx, vy } = this;
    const g = WATER.gravity;
    const maxD = WATER.maxFluxDepth;
    const cf = WATER.friction;
    const lin = WATER.linearDamping;
    const area = dx * dx;

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const d = water[k];
        if (d <= 0) {
          fL[k] = fR[k] = fD[k] = fU[k] = 0;
          continue;
        }
        const hk = sand[k] + d;
        let l = 0;
        let r = 0;
        let dn = 0;
        let up = 0;
        if (i > 0) {
          const kn = k - 1;
          const dh = hk - sand[kn] - water[kn];
          const da = Math.max(0.002, Math.min(maxD, 0.5 * (d + water[kn])));
          l = fL[k] + dt * g * da * dh;
          if (l > 0) l /= 1 + dt * (lin + (cf * l) / (dx * da * da));
          else l = 0;
        }
        if (i < nx - 1) {
          const kn = k + 1;
          const dh = hk - sand[kn] - water[kn];
          const da = Math.max(0.002, Math.min(maxD, 0.5 * (d + water[kn])));
          r = fR[k] + dt * g * da * dh;
          if (r > 0) r /= 1 + dt * (lin + (cf * r) / (dx * da * da));
          else r = 0;
        }
        if (j > 0) {
          const kn = k - nx;
          const dh = hk - sand[kn] - water[kn];
          const da = Math.max(0.002, Math.min(maxD, 0.5 * (d + water[kn])));
          dn = fD[k] + dt * g * da * dh;
          if (dn > 0) dn /= 1 + dt * (lin + (cf * dn) / (dx * da * da));
          else dn = 0;
        }
        if (j < ny - 1) {
          const kn = k + nx;
          const dh = hk - sand[kn] - water[kn];
          const da = Math.max(0.002, Math.min(maxD, 0.5 * (d + water[kn])));
          up = fU[k] + dt * g * da * dh;
          if (up > 0) up /= 1 + dt * (lin + (cf * up) / (dx * da * da));
          else up = 0;
        }
        const sum = l + r + dn + up;
        if (sum > 0) {
          const K = Math.min(1, (d * area) / (sum * dt));
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

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const inL = i > 0 ? fR[k - 1] : 0;
        const inR = i < nx - 1 ? fL[k + 1] : 0;
        const inD = j > 0 ? fU[k - nx] : 0;
        const inU = j < ny - 1 ? fD[k + nx] : 0;
        const out = fL[k] + fR[k] + fD[k] + fU[k];
        const d0 = water[k];
        let d1 = d0 + (dt * (inL + inR + inD + inU - out)) / area;
        if (d1 < 0) d1 = 0;
        water[k] = d1;
        const db = 0.5 * (d0 + d1);
        if (db > 1e-3) {
          // thin films get a floor on depth so their velocity stays sane
          const dv = db < 0.02 ? 0.02 : db;
          const wx = 0.5 * (inL - fL[k] + fR[k] - inR);
          const wy = 0.5 * (inD - fD[k] + fU[k] - inU);
          let ux = wx / (dx * dv);
          let uy = wy / (dx * dv);
          const sp = Math.hypot(ux, uy);
          if (sp > 4) {
            ux *= 4 / sp;
            uy *= 4 / sp;
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
    const { nx, ny, sand, water, rest } = this;
    const level = this.meanLevel();
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        // water table: sea level at the shoreline, rising slightly then
        // falling away under the dry beach
        const above = rest[k] - level;
        if (above <= 0 || above > 0.9) continue;
        const table = level + 0.05 - above * 0.35;
        const target = table - sand[k];
        if (target > water[k]) water[k] += (target - water[k]) * Math.min(1, dt / 6);
      }
    }
  }

  /** Sediment pick-up / drop and transport by the water. */
  private erode(dt: number): void {
    const { nx, ny, dx, sand, water, sediment, vx, vy, bottom, tmp } = this;
    // (tmp is reused below for the transport step)
    const Kc = EROSION.capacity;
    const Ks = EROSION.dissolve;
    const Kd = EROSION.deposit;
    const minS = EROSION.minSlope;
    const dry = WATER.dryDepth * 2;

    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        const d = water[k];
        let s = sediment[k];
        if (d < dry) {
          if (s > 0) {
            sand[k] += s;
            sediment[k] = 0;
          }
          continue;
        }
        const gx = (sand[k + 1] - sand[k - 1]) / (2 * dx);
        const gy = (sand[k + nx] - sand[k - nx]) / (2 * dx);
        const g2 = gx * gx + gy * gy;
        const sinA = Math.max(minS, Math.sqrt(g2 / (1 + g2)));
        const speed = Math.hypot(vx[k], vy[k]);
        const depthF = Math.min(1, d / 0.05) * Math.max(0, Math.min(1, 1 - (d - 0.35) / 0.6));
        const C = Kc * sinA * speed * depthF;
        if (C > s) {
          const amt = Math.min(Ks * (C - s) * dt, Math.max(0, sand[k] - bottom[k]));
          sand[k] -= amt;
          s += amt;
        } else {
          const amt = Kd * (s - C) * dt;
          sand[k] += amt;
          s -= amt;
        }
        sediment[k] = s;
      }
    }

    // Conservative transport: suspended sand rides along the same pipe fluxes
    // as the water (donor cell), so no sand is created or lost in transit.
    const { fL, fR, fD, fU } = this;
    const area = dx * dx;
    tmp.set(sediment);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const s0 = sediment[k];
        if (s0 <= 0) continue;
        const d = water[k];
        const sum = fL[k] + fR[k] + fD[k] + fU[k];
        if (d < 1e-4 || sum <= 0) continue;
        const frac = Math.min(1, (sum * dt) / (d * area));
        const moved = s0 * frac;
        const per = moved / sum;
        tmp[k] -= moved;
        if (i > 0) tmp[k - 1] += fL[k] * per;
        else tmp[k] += fL[k] * per;
        if (i < nx - 1) tmp[k + 1] += fR[k] * per;
        else tmp[k] += fR[k] * per;
        if (j > 0) tmp[k - nx] += fD[k] * per;
        else tmp[k] += fD[k] * per;
        if (j < ny - 1) tmp[k + nx] += fU[k] * per;
        else tmp[k] += fU[k] * per;
      }
    }
    sediment.set(tmp);
  }

  /** Move sand down slopes steeper than the (wetness dependent) angle of repose. */
  private slump(): void {
    const { nx, ny, dx, sand, water, wet, bottom, tanMax, tmp } = this;
    const tDry = Math.tan(SAND.reposeDry * DEG) * dx;
    const tDamp = Math.tan(SAND.reposeDamp * DEG) * dx;
    const tSat = Math.tan(SAND.reposeSaturated * DEG) * dx;
    const sub = WATER.dryDepth * 3;
    for (let k = 0; k < this.n; k++) {
      tanMax[k] = water[k] > sub ? tSat : tDry + (tDamp - tDry) * Math.min(1, wet[k] * 1.25);
    }
    const rate = SAND.slumpRate * 0.5;
    for (let it = 0; it < SAND.slumpIterations; it++) {
      tmp.fill(0);
      for (let j = 0; j < ny; j++) {
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
          if (j < ny - 1) {
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
      for (let k = 0; k < this.n; k++) sand[k] += tmp[k];
    }
  }

  /** Very slow pull back to the rest profile wherever the sea reaches. */
  private heal(dt: number): void {
    const { sand, rest, water, wet } = this;
    const a = dt / EROSION.healingTime;
    const dry = WATER.dryDepth;
    for (let k = 0; k < this.n; k++) {
      if (water[k] > dry || wet[k] > 0.97) sand[k] += (rest[k] - sand[k]) * a;
    }
  }

  private updateWetFoam(dt: number): void {
    const { nx, ny, dx, sand, water, wet, foam, vx, vy } = this;
    const dryK = Math.exp(-dt / SAND.dryingTime);
    const foamK = Math.exp(-dt / 1.7);
    const foamDryK = Math.exp(-dt / 0.5);
    const level = this.meanLevel();
    const capH = SAND.capillaryHeight;
    const dry = WATER.dryDepth;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const d = water[k];
        if (d > dry) {
          wet[k] = 1;
          const sp = Math.hypot(vx[k], vy[k]);
          let f = smoothstep(0.35, 1.4, sp) * (1 - smoothstep(0.03, 0.45, d));
          if (i > 0 && i < nx - 1 && j > 0 && j < ny - 1 && d > 0.015) {
            const ex = (sand[k + 1] + water[k + 1] - sand[k - 1] - water[k - 1]) / (2 * dx);
            const ey = (sand[k + nx] + water[k + nx] - sand[k - nx] - water[k - nx]) / (2 * dx);
            f = Math.max(f, smoothstep(0.05, 0.22, Math.hypot(ex, ey)) * 0.9);
          }
          const fo = foam[k] * foamK;
          foam[k] = fo > f ? fo : f;
        } else {
          const cap = Math.max(0, Math.min(1, 1 - (sand[k] - level) / capH)) * 0.8;
          const w = wet[k] * dryK;
          wet[k] = w > cap ? w : cap;
          foam[k] *= foamDryK;
        }
      }
    }
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
    };
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
    const entry = this.diffRegion(st.snapshot, st.i0, st.j0, st.i1, st.j1);
    if (entry) this.undo.push(entry);
  }

  /** Abort the current stroke and put the sand back exactly as it was. */
  cancelStroke(): void {
    const st = this.stroke;
    if (!st) return;
    this.stroke = null;
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
    const dist = Math.hypot(dxm, dym);
    const speed = dist / dt;
    if (speed < BRUSH.moveSpeed) st.hold += dt;
    else st.hold = Math.max(0, st.hold - dt * 3);
    if (dist > 1e-6) {
      st.dirX = st.dirX * 0.5 + (dxm / dist) * 0.5;
      st.dirY = st.dirY * 0.5 + (dym / dist) * 0.5;
      const dl = Math.hypot(st.dirX, st.dirY) || 1;
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
      const [ci, cj] = this.toCell(x, y);
      const rc = Math.ceil((st.r * BRUSH.rimOuter) / this.dx) + 1;
      st.i0 = Math.min(st.i0, Math.floor(ci) - rc);
      st.j0 = Math.min(st.j0, Math.floor(cj) - rc);
      st.i1 = Math.max(st.i1, Math.ceil(ci) + rc);
      st.j1 = Math.max(st.j1, Math.ceil(cj) + rc);
    }
    st.lastX = st.x;
    st.lastY = st.y;
    this.digIntensity = Math.min(1, 0.25 + rate / BRUSH.rateHeld * 0.5 + Math.min(1, speed / 3) * 0.5);
  }

  /** One brush dab. amount = depth (m) at the centre. */
  stamp(mode: BrushMode, x: number, y: number, r: number, amount: number, dirX = 0, dirY = 0): void {
    const { nx, ny, dx, sand, bottom } = this;
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
          const q = Math.hypot(i - ci, j - cj) / rc;
          if (q >= 1) continue;
          const w = (1 - q * q) * (1 - q * q);
          const k = j * nx + i;
          const avg = (sand[k - 1] + sand[k + 1] + sand[k - nx] + sand[k + nx]) * 0.25;
          sand[k] += (avg - sand[k]) * Math.min(1, w * amount * 25);
        }
      }
      return;
    }

    if (mode === 'pile') {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const q = Math.hypot(i - ci, j - cj) / rc;
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
        const q = Math.hypot(i - ci, j - cj) / rc;
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
        const dist = Math.hypot(di, dj);
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
    this.scheduleDelta(e, -1, ease);
    return true;
  }

  redoStroke(ease = true): boolean {
    if (this.stroke) this.endStroke();
    const e = this.undo.popRedo();
    if (!e) return false;
    this.scheduleDelta(e, 1, ease);
    return true;
  }

  private scheduleDelta(e: UndoEntry, sign: number, ease: boolean): void {
    if (!ease) {
      this.applyDelta(e, sign);
      return;
    }
    this.easing.push({ entry: e, sign, ticksLeft: UNDO_EASE_TICKS });
  }

  /** Put the whole beach back to its rest shape (undoable). */
  resetBeach(): void {
    if (this.stroke) this.endStroke();
    const before = this.sand.slice();
    this.sand.set(this.rest);
    this.sediment.fill(0);
    const e = this.diffRegion(before, 0, 0, this.nx - 1, this.ny - 1);
    if (e) this.undo.push(e);
  }

  // ---------------------------------------------------------------- output

  /** Pack sand/water/wet/foam into an RGBA float buffer (for one texture upload). */
  pack(out: Float32Array): void {
    const { sand, water, wet, foam } = this;
    for (let k = 0, o = 0; k < this.n; k++, o += 4) {
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
