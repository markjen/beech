// Things you can put on the beach (from the inventory), and how the sea
// treats them.
//
//  rock       Heavy and fixed. It raises the beach's non-erodible floor under
//             its footprint, so water flows around and over it, sand scours
//             beside it, settles in its lee, and can't be dug or washed away.
//  driftwood  Light. It floats once the water is deeper than its draft,
//             drifts with the local current, turns when its two ends feel
//             different flow, and is stranded where the backwash leaves it.
//  shell,     Small and heavy for their size: they sit on the sand and are
//  seaglass   rolled along by fast water (swash and backwash), then settle.
//  flag       Pushed into the sand: stays put.
//
// Now and then the sea also brings things in by itself (driftwood far out,
// shells and sea glass at the waterline). Those are marked `wild`; only a few
// stay at a time, and the oldest is taken back by the sea.

export type ObjectKind =
  | 'rock'
  | 'driftwood'
  | 'shell'
  | 'seaglass'
  | 'flag'
  | 'conch'
  | 'sanddollar'
  | 'starfish'
  | 'bottle'
  | 'nautilus'
  | 'deckchair'
  // from the shop
  | 'parasol'
  | 'surfboard'
  | 'sandcastle'
  | 'beachhut'
  | 'lighthouse'
  | 'tikitorch';
export const OBJECT_KINDS: ObjectKind[] = [
  'rock', 'driftwood', 'shell', 'seaglass', 'flag', 'conch', 'sanddollar', 'starfish', 'bottle', 'nautilus', 'deckchair',
  'parasol', 'surfboard', 'sandcastle', 'beachhut', 'lighthouse', 'tikitorch',
];

type Behaviour = 'rock' | 'float' | 'tumble' | 'fixed';
const BEHAVIOUR: Record<ObjectKind, Behaviour> = {
  rock: 'rock',
  driftwood: 'float',
  shell: 'tumble',
  seaglass: 'tumble',
  flag: 'fixed',
  conch: 'tumble',
  sanddollar: 'tumble',
  starfish: 'tumble',
  // a message in a bottle floats like driftwood
  bottle: 'float',
  // a nautilus shell sits and tumbles like the other shells
  nautilus: 'tumble',
  // a deckchair (and everything from the shop) is set up on the sand and stays there
  deckchair: 'fixed',
  parasol: 'fixed',
  surfboard: 'fixed',
  sandcastle: 'fixed',
  beachhut: 'fixed',
  lighthouse: 'fixed',
  tikitorch: 'fixed',
};

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
  /** brought in by the sea rather than put there by you */
  wild?: boolean;
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
/** water speed (m/s) that starts a shell rolling */
const TUMBLE_SPEED = 0.35;
/** at most this many things the sea brought in stay on the beach */
export const MAX_WILD = 6;
/** seconds between the sea bringing something in (random within) */
const WASH_IN = [70, 160];

export const ROCK_HEIGHT = 0.8; // height as a fraction of radius
export const WOOD_RADIUS = (length: number) => 0.05 + length * 0.028;
/** radius of something afloat (its draft is about this) */
export const floatRadius = (o: { kind: ObjectKind; size: number }) => (o.kind === 'bottle' ? o.size * 0.2 : WOOD_RADIUS(o.size));

export class BeachObjects {
  private live = new Map<number, Live>();
  private nextId = 1;
  private washClock: number;
  private rand: () => number;

  constructor(
    private readonly h: ObjectHost,
    seed = 1,
  ) {
    let st = (Math.imul(seed | 0, 2654435761) ^ 0x5bd1e995) >>> 0 || 1;
    this.rand = () => {
      st ^= st << 13;
      st ^= st >>> 17;
      st ^= st << 5;
      return (st >>> 0) / 4294967296;
    };
    this.washClock = WASH_IN[0] * 0.5 + this.rand() * WASH_IN[0];
  }

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
      const reach = l.data.kind === 'driftwood' ? l.data.size / 2 : l.data.size;
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

  /** For tests: the sea brings the next thing in on the next step. */
  washSoon(): void {
    this.washClock = 0;
  }

  /** `sea`: waves are running, so the sea may bring things in. */
  step(dt: number, sea = false): void {
    const { nx, ny, dx, water, vx, vy } = this.h;
    const W = nx * dx;
    const Hh = ny * dx;
    if (sea) this.washIn(dt);
    for (const l of this.live.values()) {
      const o = l.data;
      const b = BEHAVIOUR[o.kind];
      if (b === 'rock') {
        l.z = this.sandAtRockBase(l);
        continue;
      }
      if (b === 'fixed') {
        l.z = this.sandAt(o.x, o.y);
        continue;
      }
      if (b === 'tumble') {
        const k = this.cellAt(o.x, o.y);
        const d = water[k];
        const speed = Math.hypot(vx[k], vy[k]);
        const rolling = d > o.size * 0.25 && speed > TUMBLE_SPEED;
        if (rolling) {
          // rolled along at a fraction of the flow, nudged landward by the waves
          const grip = Math.min(1, dt * 4);
          l.vx += (vx[k] * 0.45 - l.vx) * grip;
          l.vy += (vy[k] * 0.45 + STOKES_DRIFT * 0.5 - l.vy) * grip;
          l.spin += (this.rand() - 0.5) * dt * 6;
        } else {
          l.vx *= Math.exp(-dt * 8);
          l.vy *= Math.exp(-dt * 8);
        }
        l.spin *= Math.exp(-dt * 3);
        l.floating = rolling;
        o.x = Math.min(W - 0.3, Math.max(0.3, o.x + l.vx * dt));
        o.y = Math.min(Hh - 0.3, Math.max(0.3, o.y + l.vy * dt));
        o.angle += l.spin * dt;
        l.z = this.sandAt(o.x, o.y);
        continue;
      }
      // driftwood and bottles
      const r = floatRadius(o);
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

  /** The sea brings in a piece of driftwood, a shell or a bit of sea glass. */
  private washIn(dt: number): void {
    this.washClock -= dt;
    if (this.washClock > 0) return;
    this.washClock = WASH_IN[0] + this.rand() * (WASH_IN[1] - WASH_IN[0]);
    const { nx, ny, dx, water } = this.h;
    const r = this.rand();
    const x = 2 + this.rand() * (nx * dx - 4);
    let item: Omit<PlacedObject, 'id'>;
    if (r < 0.4) {
      // out at sea; the waves carry it in
      item = { kind: 'driftwood', item: 'driftwood', x, y: 1.2, angle: this.rand() * Math.PI, size: 0.7 + this.rand() * 1.1, variant: 1 + Math.floor(this.rand() * 6), wild: true };
    } else {
      // at the waterline: the highest wet cell in this column
      const i = Math.min(nx - 1, Math.floor(x / dx));
      let y = -1;
      for (let j = ny - 1; j >= 0; j--) {
        if (water[j * nx + i] > 0.03) {
          y = (j + 0.5) * dx - 0.3;
          break;
        }
      }
      if (y < 0.5) return;
      const glass = r > 0.85;
      item = glass
        ? { kind: 'seaglass', item: 'seaglass', x, y, angle: this.rand() * 6.28, size: 0.07 + this.rand() * 0.04, variant: 1 + Math.floor(this.rand() * 4), wild: true }
        : { kind: 'shell', item: 'shell', x, y, angle: this.rand() * 6.28, size: 0.07 + this.rand() * 0.06, variant: 1 + Math.floor(this.rand() * 6), wild: true };
    }
    this.add(item);
    // the sea takes the oldest stray back
    const wild = [...this.live.values()].filter((l) => l.data.wild).map((l) => l.data.id);
    if (wild.length > MAX_WILD) this.remove(Math.min(...wild));
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
