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
//  trash,     A crumpled bottle or can: light, so the swash rolls it along
//  seaweed    like a shell, until it snags on the sand. Seaweed is a strand
//             or clump lying flat: the water slides it about, then leaves it.
//  flag       Pushed into the sand: stays put.
//
// Now and then the sea also brings things in by itself (driftwood far out,
// shells and sea glass at the waterline). Those are marked `wild`; only a few
// stay at a time, and the oldest is taken back by the sea.
//
// Things you own that the sea carries out past the offshore edge are lost to
// it: they leave the beach and so are back in your bag (the bag counts what's
// placed). Fixed things and rocks never move, so they're never lost.

import { LOST_TO_SEA, WATER } from '../config';

//  beachball  Light and round: it floats like driftwood, bobbing on
//             the water, and the swash rolls it up the beach.
//  sandals    A pair, flat on the sand: the water slides them about
//             like shells, then leaves them.
//  bucket     A pail, upright and heavy enough to stay put: it sits
//             where you put it, even when the water comes up.
//  coral      A branching fragment: light enough for the swash to roll
//             it along like a shell, then leave it on the sand.
//  coconut    Round and buoyant: it floats like a bottle, riding high
//             in the water, and the swash rolls it up the beach.
//  palmtree,  Set up on the sand and staying there, like everything
//  lifeguardtower, else from the shop: a tall palm, a tower with a
//  bonfire,   cabin and a ramp, a stone-ringed fire, a slung cloth
//  hammock,   between two posts, and a striped towel lying flat.
//  towel
//  footprints  A trail of prints pressed into the sand until water washes it away.
export type ObjectKind =
  | 'rock'
  | 'driftwood'
  | 'shell'
  | 'seaglass'
  | 'trash'
  | 'seaweed'
  | 'flag'
  | 'conch'
  | 'sanddollar'
  | 'starfish'
  | 'bottle'
  | 'nautilus'
  | 'beachball'
  | 'sandals'
  | 'bucket'
  | 'coral'
  | 'coconut'
  | 'deckchair'
  // from the shop
  | 'parasol'
  | 'surfboard'
  | 'sandcastle'
  | 'beachhut'
  | 'lighthouse'
  | 'tikitorch'
  | 'palmtree'
  | 'lifeguardtower'
  | 'bonfire'
  | 'hammock'
  | 'towel'
  | 'footprints';
export const OBJECT_KINDS: ObjectKind[] = [
  'rock', 'driftwood', 'shell', 'seaglass', 'trash', 'seaweed', 'flag', 'conch', 'sanddollar', 'starfish', 'bottle', 'nautilus', 'beachball', 'sandals', 'bucket', 'coral', 'coconut', 'deckchair',
  'parasol', 'surfboard', 'sandcastle', 'beachhut', 'lighthouse', 'tikitorch',
  'palmtree', 'lifeguardtower', 'bonfire', 'hammock', 'towel',
  'footprints',
];

export type Behaviour = 'rock' | 'float' | 'tumble' | 'fixed' | 'wash';
export const BEHAVIOUR: Record<ObjectKind, Behaviour> = {
  rock: 'rock',
  driftwood: 'float',
  shell: 'tumble',
  seaglass: 'tumble',
  // trash and seaweed tumble like shells: the swash rolls them along,
  // then they settle on the sand
  trash: 'tumble',
  seaweed: 'tumble',
  flag: 'fixed',
  conch: 'tumble',
  sanddollar: 'tumble',
  starfish: 'tumble',
  // a message in a bottle floats like driftwood
  bottle: 'float',
  // a nautilus shell sits and tumbles like the other shells
  nautilus: 'tumble',
  // a beach ball floats like driftwood — light, so it rides high
  beachball: 'float',
  // sandals tumble like shells: the swash slides them along, then leaves them
  sandals: 'tumble',
  // a bucket sits upright where you put it, even when the water comes up
  bucket: 'fixed',
  // a coral fragment tumbles like a shell: the swash rolls it along, then leaves it
  coral: 'tumble',
  // a coconut floats like a bottle — round and buoyant, so it rides high
  coconut: 'float',
  // a deckchair (and everything from the shop) is set up on the sand and stays there
  deckchair: 'fixed',
  parasol: 'fixed',
  surfboard: 'fixed',
  sandcastle: 'fixed',
  beachhut: 'fixed',
  lighthouse: 'fixed',
  tikitorch: 'fixed',
  // the five new shop centrepieces: set up on the sand, staying put
  palmtree: 'fixed',
  lifeguardtower: 'fixed',
  bonfire: 'fixed',
  hammock: 'fixed',
  towel: 'fixed',
  footprints: 'wash',
};

/** Mobile sediment and footprints need water above the thin film left by flow. */
export const sandWashDepth = () => WATER.dryDepth * 2;

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
  /**
   * rock: sand height at the centre when the rock was placed (where it
   * sits). A rock raises the floor under its footprint, so the sand under
   * it is higher than this once it is embedded — re-embedding a rock
   * (undo, cancel, reload) must use the placed height, not the lifted
   * sand, or the rock would come back floating. Old saves omit it and
   * fall back to the sand at the time.
   */
  base?: number;
  /** shape/colour variation seed */
  variant: number;
  /** brought in by the sea rather than put there by you */
  wild?: boolean;
  /** brought in by the sea, and kept: you picked it up and put it down (the "found" collection) */
  found?: boolean;
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
  /** sand surface before the rock (kept for saving) */
  under: Float32Array;
  /** rock top height per cell */
  top: Float32Array;
  /** sand height at the centre when placed: where the rock sits */
  base: number;
  /** footprint bounds in cells, for overlap checks on removal */
  i0: number;
  j0: number;
  i1: number;
  j1: number;
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
export const floatRadius = (o: { kind: ObjectKind; size: number }) =>
  o.kind === 'bottle' ? o.size * 0.2 : o.kind === 'beachball' || o.kind === 'coconut' ? o.size * 0.3 : WOOD_RADIUS(o.size);

/** Floats per object in a packed positions buffer: x, y, z, angle, floating. */
export const POS_STRIDE = 5;

export class BeachObjects {
  private live = new Map<number, Live>();
  /** goes up whenever something is added or removed (the roster changes) */
  version = 0;
  private nextId = 1;
  private washClock: number;
  private rand: () => number;
  /** the untouched floor, before any rock raised it */
  private readonly floor0: Float32Array;
  /** owned things the sea took since the last `takeLost()` */
  private lost: PlacedObject[] = [];
  private washedFootprints = false;

  constructor(
    private readonly h: ObjectHost,
    seed = 1,
  ) {
    this.floor0 = this.h.bottom.slice();
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
    return this.sampleField(this.h.sand, x, y);
  }

  /** Bilinear sample of any grid field at sim metres. */
  private sampleField(field: Float32Array, x: number, y: number): number {
    const { nx, ny, dx } = this.h;
    const fi = Math.min(nx - 1.001, Math.max(0, x / dx - 0.5));
    const fj = Math.min(ny - 1.001, Math.max(0, y / dx - 0.5));
    const i = fi | 0;
    const j = fj | 0;
    const tx = fi - i;
    const ty = fj - j;
    const k = j * nx + i;
    return (field[k] * (1 - tx) + field[k + 1] * tx) * (1 - ty) + (field[k + nx] * (1 - tx) + field[k + nx + 1] * tx) * ty;
  }

  /**
   * The sand field with every live rock's lift stripped: what the sand
   * would be if the rocks were not there (the terrain, plus anything
   * piled above the highest rock top). Exact for overlapping rocks, in
   * any order: each rock's `under` is the terrain at the time it was
   * embedded, so for a cell the rock with the highest top gives
   * terrain + deposits, and the minimum over the covering rocks is that.
   */
  private stripLifts(field: Float32Array): Float32Array {
    const out = field.slice();
    for (const l of this.live.values()) {
      if (!l.rock) continue;
      const rc = l.rock;
      for (let n = 0; n < rc.cells.length; n++) {
        const k = rc.cells[n];
        // sand above the higher of the rock's top and what was under it
        // is a deposit, not lift; measuring above the top alone would
        // double-count terrain that already stood above the top (a slope,
        // a pile beside the centre)
        const cand = rc.under[n] + Math.max(0, field[k] - Math.max(rc.top[n], rc.under[n]));
        if (cand < out[k]) out[k] = cand;
      }
    }
    return out;
  }

  private cellAt(x: number, y: number): number {
    const { nx, ny, dx } = this.h;
    const i = Math.min(nx - 1, Math.max(0, Math.floor(x / dx)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor(y / dx)));
    return j * nx + i;
  }

  /**
   * Put something on the beach. Returns it with its id.
   * `noRock` is the sand field with no rock lifts in it (terrain +
   * deposits); a fresh rock's base and `under` are sampled from it, so a
   * rock placed on another rock's dome sits on the terrain underneath,
   * not on the dome — rocks never stack their lifts. Callers loading a
   * beach pass the repaired field; everyone else leaves it out and the
   * lifts are stripped from the live sand here.
   */
  add(o: Omit<PlacedObject, 'id'> & { id?: number }, noRock?: Float32Array): PlacedObject {
    const data: PlacedObject = { ...o, id: o.id ?? this.nextId++ };
    this.nextId = Math.max(this.nextId, data.id + 1);
    if (data.kind === 'rock') {
      const terrain = noRock ?? this.stripLifts(this.h.sand);
      if (data.base === undefined) data.base = this.sampleField(terrain, data.x, data.y);
      // a rock sits at its base, not at the lifted sand under it (a rock
      // re-added on top of another rock's dome would otherwise report the
      // dome height until the next step corrects it)
      const l: Live = { data, z: data.base, floating: false, vx: 0, vy: 0, spin: 0 };
      l.rock = this.embedRock(data, terrain);
      this.live.set(data.id, l);
    } else {
      const l: Live = { data, z: this.sandAt(data.x, data.y), floating: false, vx: 0, vy: 0, spin: 0 };
      this.live.set(data.id, l);
    }
    this.version++;
    return data;
  }

  remove(id: number): PlacedObject | null {
    const l = this.live.get(id);
    if (!l) return null;
    // off the roster first: lifting the rock rebuilds the floor from the
    // rocks still there, and this one must not count
    this.live.delete(id);
    if (l.rock) this.liftRock(l.rock);
    this.version++;
    // report where it actually was (driftwood may have drifted)
    return { ...l.data };
  }

  /**
   * Remove an object and report the sand the removal itself moved. Taking
   * a rock off lifts the floor back under its footprint, so the sand there
   * drops; every other kind moves no sand. The caller (a dozer/vacuum
   * stroke) needs the lift to keep it out of the stroke's undo delta —
   * undo re-embeds the rock and restores that sand itself.
   */
  removeWithLift(id: number): { data: PlacedObject; lift: { k: number; d: number }[] } | null {
    const l = this.live.get(id);
    if (!l) return null;
    if (!l.rock) {
      const data = this.remove(id);
      return data ? { data, lift: [] } : null;
    }
    const { sand } = this.h;
    const cells = l.rock.cells;
    const before = new Float32Array(cells.length);
    for (let n = 0; n < cells.length; n++) before[n] = sand[cells[n]];
    const data = this.remove(id)!;
    const lift: { k: number; d: number }[] = [];
    for (let n = 0; n < cells.length; n++) {
      const d = sand[cells[n]] - before[n];
      if (d !== 0) lift.push({ k: cells[n], d });
    }
    return { data, lift };
  }

  /**
   * Take everything off at once. The floor goes back to the untouched
   * beach; the sand is left alone — every caller overwrites it right
   * after (load, import, whole-beach swap), so restoring it cell by
   * cell here would be thrown away. Do not use this for a single
   * removal: `remove` rebuilds the floor and sand for that rock.
   */
  clear(): void {
    this.h.bottom.set(this.floor0);
    this.live.clear();
    this.washedFootprints = false;
    this.version++;
  }

  /** The nearest object within `radius` metres of a point, if any. */
  nearest(x: number, y: number, radius: number): PlacedObject | null {
    let best: PlacedObject | null = null;
    let bestD = radius;
    for (const l of this.live.values()) {
      const reach = l.data.kind === 'driftwood' ? l.data.size / 2 : l.data.size;
      const d = Math.sqrt((l.data.x - x) * (l.data.x - x) + (l.data.y - y) * (l.data.y - y)) - reach * 0.6;
      if (d < bestD) {
        bestD = d;
        best = l.data;
      }
    }
    return best ? { ...best } : null;
  }

  /** Every object within `radius` metres of a point (a big object's reach counts, as in nearest). */
  within(x: number, y: number, radius: number): PlacedObject[] {
    const out: PlacedObject[] = [];
    for (const l of this.live.values()) {
      const reach = l.data.kind === 'driftwood' ? l.data.size / 2 : l.data.size;
      if (Math.sqrt((l.data.x - x) * (l.data.x - x) + (l.data.y - y) * (l.data.y - y)) - reach * 0.6 <= radius) out.push({ ...l.data });
    }
    return out;
  }

  /**
   * The cells a rock covers and the top height at each, from its
   * geometry alone. The footprint does not depend on the base; the tops
   * do. Shared by embedding and by the load repair, which needs the
   * footprints before any rock is live.
   */
  private rockFootprint(o: PlacedObject, base: number): { cells: Int32Array; top: Float32Array; i0: number; j0: number; i1: number; j1: number } {
    return rockFootprintAt(o, base, this.h.nx, this.h.ny, this.h.dx);
  }

  private embedRock(o: PlacedObject, terrain: Float32Array): RockCells {
    const { sand, bottom } = this.h;
    // where the rock sits: the height it was placed at, not the sand now
    // (which may already be lifted by another rock)
    const base = o.base ?? this.sampleField(terrain, o.x, o.y);
    const fp = this.rockFootprint(o, base);
    const rc: RockCells = {
      cells: fp.cells,
      under: new Float32Array(fp.cells.length),
      top: fp.top,
      base,
      i0: fp.i0,
      j0: fp.j0,
      i1: fp.i1,
      j1: fp.j1,
    };
    for (let n = 0; n < fp.cells.length; n++) {
      const k = fp.cells[n];
      rc.under[n] = terrain[k];
      if (bottom[k] < rc.top[n]) bottom[k] = rc.top[n];
      if (sand[k] < rc.top[n]) sand[k] = rc.top[n];
    }
    return rc;
  }

  private liftRock(rc: RockCells): void {
    const { sand, bottom } = this.h;
    // The floor under the removed rock is the untouched floor, raised to
    // the top of any rock still covering the cell. The old code restored
    // a per-rock snapshot taken at embed time, which was stale whenever
    // another rock had been placed on top since — taking overlapping
    // rocks off in placement order left the floor (and the sand) raised.
    const inFootprint = new Set<number>(rc.cells);
    for (let n = 0; n < rc.cells.length; n++) bottom[rc.cells[n]] = this.floor0[rc.cells[n]];
    for (const l of this.live.values()) {
      if (!l.rock) continue;
      const other = l.rock;
      if (other.i1 < rc.i0 || other.i0 > rc.i1 || other.j1 < rc.j0 || other.j0 > rc.j1) continue;
      for (let m = 0; m < other.cells.length; m++) {
        const k = other.cells[m];
        if (inFootprint.has(k) && other.top[m] > bottom[k]) bottom[k] = other.top[m];
      }
    }
    for (let n = 0; n < rc.cells.length; n++) {
      const k = rc.cells[n];
      // keep any sand that settled on the rock; give back what was under it.
      // Sand above the higher of the top and the under is a deposit — it
      // stays. Measuring above the top alone would double-count terrain
      // that already stood above the top (a slope, a pile beside the
      // centre).
      const onTop = Math.max(0, sand[k] - Math.max(rc.top[n], rc.under[n]));
      sand[k] = Math.max(bottom[k], rc.under[n] + onTop);
    }
  }

  /** For saving: what the sand would be without the rocks. */
  withoutRocks(sandCopy: Float32Array): Float32Array {
    return this.stripLifts(sandCopy);
  }

  /**
   * For saving: sand piled on top of rocks (thickness above the highest rock
   * dome, metres), or undefined when no rock is buried. Without this, saving
   * `under + deposit` collapses the terrain under a rock and the deposit on
   * top of it into one number, so reloading embeds the rock on `under + deposit`
   * and loses the cover.
   */
  rockCover(sand: Float32Array): Float32Array | undefined {
    let hasRock = false;
    for (const l of this.live.values()) {
      if (l.rock) {
        hasRock = true;
        break;
      }
    }
    if (!hasRock) return undefined;
    const n = this.h.nx * this.h.ny;
    const topMax = new Float32Array(n).fill(-Infinity);
    for (const l of this.live.values()) {
      if (!l.rock) continue;
      const rc = l.rock;
      for (let m = 0; m < rc.cells.length; m++) {
        const k = rc.cells[m];
        if (rc.top[m] > topMax[k]) topMax[k] = rc.top[m];
      }
    }
    const stripped = this.stripLifts(sand);
    let out: Float32Array | undefined;
    for (let k = 0; k < n; k++) {
      const top = topMax[k];
      if (top === -Infinity) continue;
      // only where sand rises above both the rock dome and the stripped terrain
      // (a rock cell on a slope where `under >= top` has stripped === sand, so
      // reload already restores it without cover)
      if (sand[k] > Math.max(top, stripped[k]) + 1e-4) {
        if (!out) out = new Float32Array(n);
        out[k] = sand[k] - top;
      }
    }
    return out;
  }

  /**
   * Repair rocks from an old save (or an imported beach) before they are
   * embedded. Old saves can hold rocks whose bases were sampled from
   * sand already lifted by earlier rocks, so a wall of overlapping rocks
   * stacks higher and higher and its sand is a pillar.
   *
   * The repair only runs when it finds that stacking: a rock whose centre
   * sits on another rock's dome, at (or above) the height of that dome
   * (see `stackedRocks`). The current code never saves that — a new
   * rock's base is the terrain under the dome — so a healthy beach,
   * including rocks on piles and rocks buried under sand, loads exactly
   * as saved (`noRock` null: the exact strip is used instead).
   *
   * When it does run, it only touches the stacked rocks and the rocks
   * they sit on: the stacked ones are re-based to the sand around them,
   * and sand inside that cluster's footprints standing more than 25 cm
   * above what the re-based rocks justify is replaced with the terrain
   * estimate plus that margin. Everything else on the beach is left
   * alone. Idempotent: a repaired beach is no longer stacked.
   */
  repairLoaded(objects: PlacedObject[]): { objects: PlacedObject[]; noRock: Float32Array | null } {
    const { stacked, cluster } = this.stackedRocks(objects);
    if (stacked.size === 0) return { objects, noRock: null };
    const { nx, ny, sand } = this.h;
    const n = nx * ny;
    // union of all rock footprints (the terrain estimate samples outside
    // every rock), and the cluster's footprints (the only cells repaired)
    const inU = new Uint8Array(n);
    const inC = new Uint8Array(n);
    objects.forEach((o, idx) => {
      if (o.kind !== 'rock') return;
      const fp = this.rockFootprint(o, 0);
      for (let m = 0; m < fp.cells.length; m++) {
        inU[fp.cells[m]] = 1;
        if (cluster.has(idx)) inC[fp.cells[m]] = 1;
      }
    });
    // terrain estimate: the sand outside the footprints, filled inward so
    // every cell under a rock takes the nearest sand outside the wall
    const terrain = new Float32Array(n);
    const filled = new Uint8Array(n);
    const queue = new Int32Array(n);
    let qh = 0;
    let qt = 0;
    for (let k = 0; k < n; k++) {
      if (inU[k]) continue;
      terrain[k] = sand[k];
      filled[k] = 1;
      queue[qt++] = k;
    }
    if (qt === 0) return { objects, noRock: null }; // rocks cover the whole beach: nothing to sample
    while (qh < qt) {
      const k = queue[qh++];
      const i = k % nx;
      const j = (k / nx) | 0;
      const v = terrain[k];
      if (i > 0 && !filled[k - 1]) { filled[k - 1] = 1; terrain[k - 1] = v; queue[qt++] = k - 1; }
      if (i < nx - 1 && !filled[k + 1]) { filled[k + 1] = 1; terrain[k + 1] = v; queue[qt++] = k + 1; }
      if (j > 0 && !filled[k - nx]) { filled[k - nx] = 1; terrain[k - nx] = v; queue[qt++] = k - nx; }
      if (j < ny - 1 && !filled[k + nx]) { filled[k + nx] = 1; terrain[k + nx] = v; queue[qt++] = k + nx; }
    }
    // re-base the stacked rocks: a rock sits on the terrain around it,
    // never on lifted sand. Sample the terrain in the rock's own row,
    // where the rest profile is flat: the BFS fill's nearest outside cell
    // can be rows away, and on the sloping beach that reads the terrain
    // low by the slope.
    const newTops = new Float32Array(n);
    const fixed = objects.map((o, idx) => {
      if (o.kind !== 'rock') return { ...o };
      let base = o.base;
      if (stacked.has(idx)) {
        let around = this.sampleField(terrain, o.x, o.y);
        const ci = Math.min(nx - 1, Math.max(0, Math.floor(o.x / this.h.dx)));
        const cj = Math.min(ny - 1, Math.max(0, Math.floor(o.y / this.h.dx)));
        for (let d = 0; d < nx; d++) {
          if (ci - d >= 0 && !inU[cj * nx + ci - d]) { around = terrain[cj * nx + ci - d]; break; }
          if (ci + d < nx && !inU[cj * nx + ci + d]) { around = terrain[cj * nx + ci + d]; break; }
        }
        if (base === undefined || around < base) base = around;
      }
      if (cluster.has(idx) && base !== undefined) {
        const fp = this.rockFootprint(o, base);
        for (let m = 0; m < fp.cells.length; m++) {
          const k = fp.cells[m];
          if (fp.top[m] > newTops[k]) newTops[k] = fp.top[m];
        }
      }
      return { ...o, base };
    });
    // The pre-rock sand under the cluster: sand standing at most 25 cm
    // above the re-based tops (or the terrain) is kept as it is. Anything
    // higher is stacked lift from the old saves: it is replaced by the
    // terrain plus the same 25 cm margin. This mutates the host sand in
    // place, before the rocks are embedded, so `under` is the estimate
    // and taking a rock off later gives the estimate back exactly.
    const noRock = sand.slice();
    for (let k = 0; k < n; k++) {
      if (!inC[k]) continue;
      const excess = sand[k] - Math.max(newTops[k], terrain[k]);
      if (excess > 0.25) {
        noRock[k] = terrain[k] + 0.25;
        sand[k] = noRock[k];
      }
    }
    return { objects: fixed, noRock };
  }

  /**
   * Which saved rocks were stacked by the old code. Rock B is stacked when
   * its centre lies on rock A's dome where the dome rises at least 10 cm,
   * and B's saved base is at (or above, within 5 cm) the dome's height
   * there: the old code sampled B's base from the sand A had lifted. The
   * current code samples the terrain under the dome, so B's base is the
   * sand under A plus whatever is piled on A — it only reaches A's dome
   * height if A is buried by about its own height first, which is rare.
   * `cluster` is the stacked rocks plus the rocks they sit on (indices
   * into `objects`).
   */
  private stackedRocks(objects: PlacedObject[]): { stacked: Set<number>; cluster: Set<number> } {
    const stacked = new Set<number>();
    const cluster = new Set<number>();
    const rocks: { idx: number; o: PlacedObject; fp: ReturnType<BeachObjects['rockFootprint']> }[] = [];
    objects.forEach((o, idx) => {
      if (o.kind === 'rock' && o.base !== undefined) rocks.push({ idx, o, fp: this.rockFootprint(o, o.base) });
    });
    const { nx } = this.h;
    for (const b of rocks) {
      const kb = this.cellAt(b.o.x, b.o.y);
      const ib = kb % nx;
      const jb = (kb / nx) | 0;
      for (const a of rocks) {
        if (a === b) continue;
        if (ib < a.fp.i0 || ib > a.fp.i1 || jb < a.fp.j0 || jb > a.fp.j1) continue;
        const m = a.fp.cells.indexOf(kb);
        if (m < 0) continue;
        const lift = a.fp.top[m] - a.o.base!;
        if (lift >= 0.1 && b.o.base! >= a.fp.top[m] - 0.05) {
          stacked.add(b.idx);
          cluster.add(b.idx);
          cluster.add(a.idx);
        }
      }
    }
    return { stacked, cluster };
  }

  /** For tests: the sea brings the next thing in on the next step. */
  washSoon(): void {
    this.washClock = 0;
  }

  /** The owned things the sea has taken since the last call (each once). */
  takeLost(): PlacedObject[] {
    if (!this.lost.length) return this.lost;
    const out = this.lost;
    this.lost = [];
    return out;
  }

  /** Whether footprints have washed away since the last call. */
  takeWashedFootprints(): boolean {
    const washed = this.washedFootprints;
    this.washedFootprints = false;
    return washed;
  }

  /** `sea` enables wash-ins. `erosion` enables washing away sand impressions. */
  step(dt: number, sea = false, erosion = false): void {
    const { nx, ny, dx, water, vx, vy } = this.h;
    const W = nx * dx;
    const Hh = ny * dx;
    if (sea) this.washIn(dt);
    if (this.live.size === 0) return;
    const tumbleGrip = Math.min(1, dt * 4);
    const tumbleDamp = Math.exp(-dt * 8);
    const tumbleSpinDamp = Math.exp(-dt * 3);
    const floatGrip = Math.min(1, dt * 2.2);
    const floatSpinDamp = Math.exp(-dt * 1.5);
    const strandDamp = Math.exp(-dt * 6);
    const tumbleSp2 = TUMBLE_SPEED * TUMBLE_SPEED;
    const wMax = W - 0.3;
    const hMax = Hh - 0.3;
    let gone: number[] | null = null;
    for (const l of this.live.values()) {
      const o = l.data;
      const b = BEHAVIOUR[o.kind];
      if (b === 'rock') {
        l.z = l.rock!.base;
        continue;
      }
      if (b === 'fixed' || b === 'wash') {
        if (b === 'wash' && erosion && this.sampleField(water, o.x, o.y) >= sandWashDepth()) {
          this.remove(o.id);
          this.washedFootprints = true;
          continue;
        }
        l.z = this.sandAt(o.x, o.y);
        continue;
      }
      if (b === 'tumble') {
        const k = this.cellAt(o.x, o.y);
        const d = water[k];
        const rolling = d > o.size * 0.25 && vx[k] * vx[k] + vy[k] * vy[k] > tumbleSp2;
        if (rolling) {
          // rolled along at a fraction of the flow, nudged landward by the waves
          l.vx += (vx[k] * 0.45 - l.vx) * tumbleGrip;
          l.vy += (vy[k] * 0.45 + STOKES_DRIFT * 0.5 - l.vy) * tumbleGrip;
          l.spin += (this.rand() - 0.5) * dt * 6;
          l.spin *= tumbleSpinDamp;
          l.floating = true;
          if (this.takenOut(o, l.vy, dt)) (gone ??= []).push(o.id);
          o.x = Math.min(wMax, Math.max(0.3, o.x + l.vx * dt));
          o.y = Math.min(hMax, Math.max(0.3, o.y + l.vy * dt));
          o.angle += l.spin * dt;
        } else {
          l.floating = false;
          if (l.vx !== 0 || l.vy !== 0 || l.spin !== 0) {
            l.vx *= tumbleDamp;
            l.vy *= tumbleDamp;
            l.spin *= tumbleSpinDamp;
            if (Math.abs(l.vx) < 1e-6) l.vx = 0;
            if (Math.abs(l.vy) < 1e-6) l.vy = 0;
            if (Math.abs(l.spin) < 1e-6) l.spin = 0;
            o.x = Math.min(wMax, Math.max(0.3, o.x + l.vx * dt));
            o.y = Math.min(hMax, Math.max(0.3, o.y + l.vy * dt));
            o.angle += l.spin * dt;
          }
        }
        l.z = this.sandAt(o.x, o.y);
        continue;
      }
      // driftwood, bottles, beach balls and coconuts
      const r = floatRadius(o);
      const bottomOrigin = o.kind === 'beachball' || o.kind === 'coconut';
      const k = this.cellAt(o.x, o.y);
      const d = water[k];
      if (d > r * 1.1) {
        const ca = Math.cos(o.angle);
        const sa = Math.sin(o.angle);
        const half = o.size * 0.5;
        const ka = this.cellAt(o.x - ca * half, o.y - sa * half);
        const kb = this.cellAt(o.x + ca * half, o.y + sa * half);
        l.floating = true;
        // pushed by the average current along its length
        const wx = (vx[k] * 2 + vx[ka] + vx[kb]) * 0.25;
        // plus a gentle landward drift: waves carry floating things toward
        // the shore (Stokes drift), so wood ends up on the beach, not out at sea
        const wy = (vy[k] * 2 + vy[ka] + vy[kb]) * 0.25 + STOKES_DRIFT;
        l.vx += (wx - l.vx) * floatGrip;
        l.vy += (wy - l.vy) * floatGrip;
        // the ends feel different flow: that turns it
        const across = (vx[kb] - vx[ka]) * -sa + (vy[kb] - vy[ka]) * ca;
        l.spin += (across / (o.size > 0.5 ? o.size : 0.5)) * dt * 1.5;
        l.spin *= floatSpinDamp;
        l.z = this.sandAt(o.x, o.y) + d - r * (bottomOrigin ? 1 : 0.6);
        if (this.takenOut(o, l.vy, dt)) (gone ??= []).push(o.id);
        o.x = Math.min(wMax, Math.max(0.3, o.x + l.vx * dt));
        o.y = Math.min(hMax, Math.max(0.3, o.y + l.vy * dt));
        o.angle += l.spin * dt;
      } else {
        // stranded: sand friction stops it quickly
        l.floating = false;
        if (l.vx !== 0 || l.vy !== 0 || l.spin !== 0) {
          l.vx *= strandDamp;
          l.vy *= strandDamp;
          l.spin *= strandDamp;
          if (Math.abs(l.vx) < 1e-6) l.vx = 0;
          if (Math.abs(l.vy) < 1e-6) l.vy = 0;
          if (Math.abs(l.spin) < 1e-6) l.spin = 0;
          o.x = Math.min(wMax, Math.max(0.3, o.x + l.vx * dt));
          o.y = Math.min(hMax, Math.max(0.3, o.y + l.vy * dt));
          o.angle += l.spin * dt;
        }
        l.z = this.sandAt(o.x, o.y) + (bottomOrigin ? 0 : r * 0.7);
      }
    }
    if (gone) {
      for (const id of gone) {
        const data = this.remove(id);
        if (data) this.lost.push(data);
      }
    }
  }

  /** An owned thing, moving offshore, about to cross the offshore edge: the sea takes it. */
  private takenOut(o: PlacedObject, vy: number, dt: number): boolean {
    return !o.wild && vy < 0 && o.y + vy * dt < LOST_TO_SEA.edge;
  }

  /** The sea brings in driftwood, shells, sea glass — and now trash, seaweed and cowries too. */
  private washIn(dt: number): void {
    this.washClock -= dt;
    if (this.washClock > 0) return;
    this.washClock = WASH_IN[0] + this.rand() * (WASH_IN[1] - WASH_IN[0]);
    const { nx, ny, dx, water } = this.h;
    const r = this.rand();
    const x = 2 + this.rand() * (nx * dx - 4);
    let item: Omit<PlacedObject, 'id'>;
    // out at sea; the waves carry it in. Driftwood is still the most
    // common thing the sea brings: 35%.
    if (r < 0.35) {
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
      // shells are the everyday find (22%); trash is kept rarer than
      // shells (8%) so the beach doesn't fill with it, and cowries are
      // rare (8%) — a spotted shell worth keeping.
      const a = this.rand() * Math.PI * 2;
      if (r < 0.57) item = { kind: 'shell', item: 'shell', x, y, angle: a, size: 0.07 + this.rand() * 0.06, variant: 1 + Math.floor(this.rand() * 6), wild: true };
      else if (r < 0.72) item = { kind: 'seaglass', item: 'seaglass', x, y, angle: a, size: 0.07 + this.rand() * 0.04, variant: 1 + Math.floor(this.rand() * 4), wild: true };
      else if (r < 0.84) item = { kind: 'seaweed', item: 'seaweed', x, y, angle: a, size: 0.15 + this.rand() * 0.45, variant: 1 + Math.floor(this.rand() * 3), wild: true };
      else if (r < 0.92) item = { kind: 'shell', item: 'cowrie', x, y, angle: a, size: 0.05 + this.rand() * 0.15, variant: 1 + Math.floor(this.rand() * 3), wild: true };
      else item = { kind: 'trash', item: 'trash', x, y, angle: a, size: 0.08 + this.rand() * 0.17, variant: 1 + Math.floor(this.rand() * 3), wild: true };
    }
    this.add(item);
    // the sea takes the oldest stray back
    const wild = [...this.live.values()].filter((l) => l.data.wild).map((l) => l.data.id);
    if (wild.length > MAX_WILD) this.remove(Math.min(...wild));
  }

  /** Saved form (positions as they are now). */
  persisted(): PlacedObject[] {
    return [...this.live.values()].map((l) => ({ ...l.data }));
  }

  /**
   * Where everything is now, packed in roster order (persisted() order):
   * POS_STRIDE floats each. Sent every frame instead of the objects
   * themselves, which only go across when the roster changes.
   */
  packPositions(buf?: Float32Array): Float32Array {
    const need = this.live.size * POS_STRIDE;
    const out = buf && buf.length === need ? buf : new Float32Array(need);
    let o = 0;
    for (const l of this.live.values()) {
      out[o] = l.data.x;
      out[o + 1] = l.data.y;
      out[o + 2] = l.z;
      out[o + 3] = l.data.angle;
      out[o + 4] = l.floating ? 1 : 0;
      o += POS_STRIDE;
    }
    return out;
  }

  states(): ObjectState[] {
    return [...this.live.values()].map((l) => ({ ...l.data, z: l.z, floating: l.floating }));
  }
}

const frac = (x: number) => x - Math.floor(x);

function sampleGrid(field: Float32Array, nx: number, ny: number, dx: number, x: number, y: number): number {
  const fi = Math.min(nx - 1.001, Math.max(0, x / dx - 0.5));
  const fj = Math.min(ny - 1.001, Math.max(0, y / dx - 0.5));
  const i = fi | 0;
  const j = fj | 0;
  const tx = fi - i;
  const ty = fj - j;
  const k = j * nx + i;
  return (field[k] * (1 - tx) + field[k + 1] * tx) * (1 - ty) + (field[k + nx] * (1 - tx) + field[k + nx + 1] * tx) * ty;
}

/** The grid cells a rock covers and its dome top height at each cell. */
export function rockFootprintAt(
  o: Pick<PlacedObject, 'x' | 'y' | 'angle' | 'size' | 'variant'>,
  base: number,
  nx: number,
  ny: number,
  dx: number,
): { cells: Int32Array; top: Float32Array; i0: number; j0: number; i1: number; j1: number } {
  // a little inside the drawn rock, so the rock always covers the sand it lifts
  const rx = o.size * 0.88;
  const ry = o.size * (0.7 + 0.3 * frac(o.variant * 0.618)) * 0.88;
  const H = o.size * ROCK_HEIGHT * 0.75;
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const cells: number[] = [];
  const tops: number[] = [];
  const r = Math.ceil(rx / dx) + 1;
  const ci = Math.floor(o.x / dx);
  const cj = Math.floor(o.y / dx);
  let i0 = nx;
  let j0 = ny;
  let i1 = -1;
  let j1 = -1;
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
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
    }
  }
  return { cells: Int32Array.from(cells), top: Float32Array.from(tops), i0, j0, i1, j1 };
}

/**
 * Raise a saved (stripped) sand delta in place where rocks have cover piled on
 * top of them, for static views (neighbor beaches) that don't run BeachSim.
 */
export function applyRockCover(
  delta: Float32Array,
  rest: Float32Array,
  nx: number,
  ny: number,
  dx: number,
  objects: PlacedObject[],
  cover: Float32Array,
): void {
  const n = nx * ny;
  const terrain = new Float32Array(n);
  for (let k = 0; k < n; k++) terrain[k] = rest[k] + delta[k] - (cover[k] > 0 ? cover[k] : 0);
  const topMax = new Float32Array(n).fill(-Infinity);
  for (const o of objects) {
    if (o.kind !== 'rock') continue;
    const base = o.base ?? sampleGrid(terrain, nx, ny, dx, o.x, o.y);
    const fp = rockFootprintAt(o, base, nx, ny, dx);
    for (let m = 0; m < fp.cells.length; m++) {
      const k = fp.cells[m];
      if (fp.top[m] > topMax[k]) topMax[k] = fp.top[m];
    }
  }
  for (let k = 0; k < n; k++) {
    if (cover[k] > 0 && topMax[k] > -Infinity) {
      const lifted = topMax[k] + cover[k] - rest[k];
      if (lifted > delta[k]) delta[k] = lifted;
    }
  }
}
