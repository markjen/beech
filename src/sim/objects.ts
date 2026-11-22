// Things you can put on the beach (from the inventory), and how the sea
// treats them.
//
//  rock       Heavy and fixed. It raises the beach's non-erodible floor under
//             its footprint, so water flows around and over it, sand scours
//             beside it, settles in its lee, and can't be dug or washed away.
//  driftwood  Light. It floats once the water is deeper than its draft,
//             drifts with the local current, turns when its two ends feel
//             different flow, and is stranded where the backwash leaves it.

export type ObjectKind = 'rock' | 'driftwood';

/** What is saved with a beach. Coordinates are sim metres (x alongshore, y from the offshore edge). */
export interface PlacedObject {
  id: number;
  kind: ObjectKind;
  /** catalog item id (src/world/items.ts) */
  item: string;
  x: number;
  y: number;
  /** radians */
  angle: number;
  /** rock: radius (m); driftwood: length (m) */
  size: number;
  /** shape/colour variation seed */
  variant: number;
}

/** What the renderer needs each frame. */
export interface ObjectState extends PlacedObject {
  /** height of the object's base above sea level */
  z: number;
  floating: boolean;
}

/** The parts of the simulation objects interact with. */
export interface ObjectHost {
  readonly nx: number;
  readonly ny: number;
  readonly dx: number;
  readonly sand: Float32Array;
  readonly bottom: Float32Array;
  readonly water: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
}

interface RockCells {
  cells: Int32Array;
  /** floor before the rock */
  prevBottom: Float32Array;
  /** sand surface before the rock (kept for saving) */
  under: Float32Array;
  /** rock top height per cell */
  top: Float32Array;
  /** sand height at the centre when placed: where the rock sits */
  base: number;
}

interface Live {
  data: PlacedObject;
  z: number;
  floating: boolean;
  vx: number;
  vy: number;
  spin: number;
  rock?: RockCells;
}

/** m/s toward the land for anything afloat */
const STOKES_DRIFT = 0.12;

export const ROCK_HEIGHT = 0.8; // height as a fraction of radius
export const WOOD_RADIUS = (length: number) => 0.05 + length * 0.028;

export class BeachObjects {
  private live = new Map<number, Live>();
  private nextId = 1;

  constructor(private readonly h: ObjectHost) {}

  get count(): number {
    return this.live.size;
  }

  /** Sand height (bilinear) at sim metres. */
  sandAt(x: number, y: number): number {
    const { nx, ny, dx, sand } = this.h;
    const fi = Math.min(nx - 1.001, Math.max(0, x / dx - 0.5));
    const fj = Math.min(ny - 1.001, Math.max(0, y / dx - 0.5));
    const i = fi | 0;
    const j = fj | 0;
    const tx = fi - i;
    const ty = fj - j;
    const k = j * nx + i;
    return (sand[k] * (1 - tx) + sand[k + 1] * tx) * (1 - ty) + (sand[k + nx] * (1 - tx) + sand[k + nx + 1] * tx) * ty;
  }

  private cellAt(x: number, y: number): number {
    const { nx, ny, dx } = this.h;
    const i = Math.min(nx - 1, Math.max(0, Math.floor(x / dx)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor(y / dx)));
    return j * nx + i;
  }

  /** Put something on the beach. Returns it with its id. */
  add(o: Omit<PlacedObject, 'id'> & { id?: number }): PlacedObject {
    const data: PlacedObject = { ...o, id: o.id ?? this.nextId++ };
    this.nextId = Math.max(this.nextId, data.id + 1);
    const l: Live = { data, z: this.sandAt(data.x, data.y), floating: false, vx: 0, vy: 0, spin: 0 };
    if (data.kind === 'rock') l.rock = this.embedRock(data);
    this.live.set(data.id, l);
    return data;
  }

  remove(id: number): PlacedObject | null {
    const l = this.live.get(id);
    if (!l) return null;
    if (l.rock) this.liftRock(l.rock);
    this.live.delete(id);
    // report where it actually was (driftwood may have drifted)
    return { ...l.data };
  }

  clear(): void {
    for (const id of [...this.live.keys()]) this.remove(id);
  }

  /** The nearest object within `radius` metres of a point, if any. */
  nearest(x: number, y: number, radius: number): PlacedObject | null {
    let best: PlacedObject | null = null;
    let bestD = radius;
    for (const l of this.live.values()) {
      const reach = l.data.kind === 'rock' ? l.data.size : l.data.size / 2;
      const d = Math.hypot(l.data.x - x, l.data.y - y) - reach * 0.6;
      if (d < bestD) {
        bestD = d;
        best = l.data;
      }
    }
    return best ? { ...best } : null;
  }

  private embedRock(o: PlacedObject): RockCells {
    const { nx, ny, dx, sand, bottom } = this.h;
    // a little inside the drawn rock, so the rock always covers the sand it lifts
    const rx = o.size * 0.88;
    const ry = o.size * (0.7 + 0.3 * frac(o.variant * 0.618)) * 0.88;
    const base = this.sandAt(o.x, o.y);
    const H = o.size * ROCK_HEIGHT * 0.75;
    const c = Math.cos(o.angle);
    const s = Math.sin(o.angle);
    const cells: number[] = [];
    const tops: number[] = [];
    const r = Math.ceil(rx / dx) + 1;
    const ci = Math.floor(o.x / dx);
    const cj = Math.floor(o.y / dx);
    for (let j = Math.max(0, cj - r); j <= Math.min(ny - 1, cj + r); j++) {
      for (let i = Math.max(0, ci - r); i <= Math.min(nx - 1, ci + r); i++) {
        const px = (i + 0.5) * dx - o.x;
        const py = (j + 0.5) * dx - o.y;
        const u = (px * c + py * s) / rx;
        const v = (-px * s + py * c) / ry;
        const q = u * u + v * v;
        if (q >= 1) continue;
        cells.push(j * nx + i);
        tops.push(base + H * Math.sqrt(1 - q));
      }
    }
    const rc: RockCells = {
      cells: Int32Array.from(cells),
      prevBottom: new Float32Array(cells.length),
      under: new Float32Array(cells.length),
      top: Float32Array.from(tops),
      base,
    };
    for (let n = 0; n < cells.length; n++) {
      const k = cells[n];
      rc.prevBottom[n] = bottom[k];
      rc.under[n] = sand[k];
      if (bottom[k] < rc.top[n]) bottom[k] = rc.top[n];
      if (sand[k] < rc.top[n]) sand[k] = rc.top[n];
    }
    return rc;
  }

  private liftRock(rc: RockCells): void {
    const { sand, bottom } = this.h;
    for (let n = 0; n < rc.cells.length; n++) {
      const k = rc.cells[n];
      // keep any sand that settled on the rock; give back what was under it
      const onTop = Math.max(0, sand[k] - rc.top[n]);
      bottom[k] = rc.prevBottom[n];
      sand[k] = Math.max(bottom[k], rc.under[n] + onTop);
    }
  }

  /** For saving: what the sand would be without the rocks. */
  withoutRocks(sandCopy: Float32Array): Float32Array {
    for (const l of this.live.values()) {
      if (!l.rock) continue;
      const rc = l.rock;
      for (let n = 0; n < rc.cells.length; n++) {
        const k = rc.cells[n];
        sandCopy[k] = rc.under[n] + Math.max(0, sandCopy[k] - rc.top[n]);
      }
    }
    return sandCopy;
  }

  step(dt: number): void {
    const { nx, ny, dx, water, vx, vy } = this.h;
    const W = nx * dx;
    const Hh = ny * dx;
    for (const l of this.live.values()) {
      const o = l.data;
      if (o.kind === 'rock') {
        l.z = this.sandAtRockBase(l);
        continue;
      }
      // driftwood
      const r = WOOD_RADIUS(o.size);
      const k = this.cellAt(o.x, o.y);
      const d = water[k];
      const ca = Math.cos(o.angle);
      const sa = Math.sin(o.angle);
      const half = o.size / 2;
      const ka = this.cellAt(o.x - ca * half, o.y - sa * half);
      const kb = this.cellAt(o.x + ca * half, o.y + sa * half);
      if (d > r * 1.1) {
        l.floating = true;
        // pushed by the average current along its length
        const wx = (vx[k] * 2 + vx[ka] + vx[kb]) / 4;
        // plus a gentle landward drift: waves carry floating things toward
        // the shore (Stokes drift), so wood ends up on the beach, not out at sea
        const wy = (vy[k] * 2 + vy[ka] + vy[kb]) / 4 + STOKES_DRIFT;
        const grip = Math.min(1, dt * 2.2);
        l.vx += (wx - l.vx) * grip;
        l.vy += (wy - l.vy) * grip;
        // the ends feel different flow: that turns it
        const across = (vx[kb] - vx[ka]) * -sa + (vy[kb] - vy[ka]) * ca;
        l.spin += (across / Math.max(0.5, o.size)) * dt * 1.5;
        l.spin *= Math.exp(-dt * 1.5);
        l.z = this.sandAt(o.x, o.y) + d - r * 0.6;
      } else {
        // stranded: sand friction stops it quickly
        l.floating = false;
        l.vx *= Math.exp(-dt * 6);
        l.vy *= Math.exp(-dt * 6);
        l.spin *= Math.exp(-dt * 6);
        l.z = this.sandAt(o.x, o.y) + r * 0.7;
      }
      o.x = Math.min(W - 0.3, Math.max(0.3, o.x + l.vx * dt));
      o.y = Math.min(Hh - 0.3, Math.max(0.3, o.y + l.vy * dt));
      o.angle += l.spin * dt;
    }
  }

  private sandAtRockBase(l: Live): number {
    // rocks sit where they were placed
    return l.rock!.base;
  }

  /** Saved form (positions as they are now). */
  persisted(): PlacedObject[] {
    return [...this.live.values()].map((l) => ({ ...l.data }));
  }

  states(): ObjectState[] {
    return [...this.live.values()].map((l) => ({ ...l.data, z: l.z, floating: l.floating }));
  }
}

const frac = (x: number) => x - Math.floor(x);
