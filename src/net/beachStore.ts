import { BEACH_STORE, type GridSpec } from '../config';
import { BeachSim } from '../sim/beachSim';
import { applyRockCover, type PlacedObject } from '../sim/objects';
import { decodeSand, encodeSand, fitWorld, objectsToSave, resampleField } from '../sim/sandCodec';
import type { UndoHistory } from '../sim/undoStack';
import { itemById } from '../world/items';

/**
 * Beach state on the client, kept in memory by beach id
 * (docs/BEACH_STORE.md). Drawing, editing and saving all name a beach id;
 * there is no "current" beach here. The view says which ids it shows
 * (`retain`), and the least recently used of the rest are let go (`gc`).
 */

/** The signed-out / sandbox beach: on this device only. */
export const LOCAL_BEACH = 'local';

/** What the store needs to know to fetch a beach. */
export interface BeachRef {
  id: string;
  /** anyone's beach is fetched by its code; yours by id */
  code?: string | null;
  /** one of yours (or the local one): editable and saved */
  owned: boolean;
  location?: string | null;
  /** the newest save the shore knows of (a newer one than held makes it stale) */
  updatedAt?: number | null;
}

/** A beach's sand at this device's grid: minus the rest beach, rock cover apart, and what's on it. */
export interface Sand {
  delta: Float32Array;
  objects: PlacedObject[];
  cover?: Float32Array;
}

export interface Saved {
  location: string;
  nx: number;
  ny: number;
  bytes: Uint8Array;
  updatedAt: number;
  epoch?: number;
  version?: number;
}

export interface SaveResult {
  updatedAt: number;
  largeEdit?: boolean;
  largeEditCheckpoint?: boolean;
}

/** Where beaches come from and go to (the server, the device, or a test). */
export interface StoreBackend {
  /** The saved beach, or null when there is none. Throws when it can't be reached. */
  load(ref: BeachRef): Promise<Saved | null>;
  /** Save one of your beaches. Throws an error with `status` (409 / 413 / 426…) when refused. */
  save(
    ref: BeachRef,
    bytes: Uint8Array,
    opts: { location: string; nx: number; ny: number; keepalive: boolean; items: Record<string, number>; epoch?: number },
  ): Promise<SaveResult>;
}

/** A simulation that holds a beach right now (the wave worker): saves read it first. */
export interface SandSource {
  read(): Promise<Sand>;
}

export interface BeachState {
  readonly id: string;
  code: string | null;
  owned: boolean;
  location: string | null;
  /** sand minus rest, rock cover apart (authoritative unless a sim or source holds the beach) */
  delta: Float32Array;
  cover?: Float32Array;
  objects: PlacedObject[];
  /** what to draw: sand minus rest with the rock cover baked in */
  display: Float32Array;
  epoch?: number;
  updatedAt: number | null;
  version?: number;
  /** nothing was saved on the server when it was loaded */
  fresh: boolean;
  /** a newer save exists than the one held */
  stale: boolean;
  /** undo history while no simulation holds the beach */
  history?: UndoHistory;
  /** the main-thread edit simulation, once edited here (never while a source holds it) */
  sim?: BeachSim;
  /** bumps on each change; the beach is dirty while it's ahead of `savedRevision` */
  revision: number;
  savedRevision: number;
  lastUsed: number;
}

/** `tooBig`: refused as too large; `outdated`: this app is too old (426); `fenced`: another instance edits now */
export type SyncState = 'idle' | 'saving' | 'saved' | 'offline' | 'tooBig' | 'outdated' | 'fenced';
export type SaveProblem = 'tooBig' | 'outdated' | 'restored' | 'fenced';

/**
 * How many of each non-free item are on a beach (so your bag can count across
 * beaches). Wild ones count too, as the server counts them.
 */
export function countItems(objects: PlacedObject[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of objects) {
    if (itemById(o.item)?.unlimited !== false) continue;
    out[o.item] = (out[o.item] ?? 0) + 1;
  }
  return out;
}

const statusOf = (e: unknown): number | undefined => (e as { status?: number } | null)?.status;

export class BeachStore {
  private readonly states = new Map<string, BeachState>();
  private readonly loading = new Map<string, Promise<BeachState | null>>();
  private readonly saving = new Map<string, Promise<void>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly sources = new Map<string, SandSource>();
  private retained = new Set<string>();
  private clock = 0;
  /** bumps on reset (another person): late answers for the last one are dropped */
  private generation = 0;
  /** this instance is no longer the editor: nothing saves until it takes over */
  fenced = false;
  /** the last save's outcome, for the settings panel */
  state: SyncState = 'idle';
  /** when a beach last saved */
  savedAt = 0;
  /** your things the last save had to leave out (over MAX_OBJECTS) */
  dropped = 0;
  /** saves are allowed at all (signed in, or the sandbox's device storage) */
  canSave: () => boolean = () => true;
  private readonly listeners = {
    state: [] as ((s: SyncState) => void)[],
    changed: [] as ((id: string) => void)[],
    reloaded: [] as ((id: string) => void)[],
    saved: [] as ((id: string, r: SaveResult & { items: Record<string, number> }) => void)[],
    problem: [] as ((id: string, p: SaveProblem) => void)[],
    dropped: [] as ((n: number) => void)[],
    largeEditUnprotected: [] as ((id: string) => void)[],
  };

  constructor(
    private readonly grid: GridSpec,
    private readonly rest: Float32Array,
    private backend: StoreBackend,
    private readonly seed = 1,
    readonly capacity = BEACH_STORE.capacity,
  ) {}

  setBackend(b: StoreBackend): void {
    this.backend = b;
  }

  // ------------------------------------------------------------------ events
  onState(fn: (s: SyncState) => void): void {
    this.listeners.state.push(fn);
  }
  /** a beach's sand or things changed here (an edit, a load) */
  onChanged(fn: (id: string) => void): void {
    this.listeners.changed.push(fn);
  }
  /** a beach was replaced by what the server has (a restore, a catch-up) */
  onReloaded(fn: (id: string) => void): void {
    this.listeners.reloaded.push(fn);
  }
  onSaved(fn: (id: string, r: SaveResult & { items: Record<string, number> }) => void): void {
    this.listeners.saved.push(fn);
  }
  onProblem(fn: (id: string, p: SaveProblem) => void): void {
    this.listeners.problem.push(fn);
  }
  onDropped(fn: (n: number) => void): void {
    this.listeners.dropped.push(fn);
  }
  onLargeEditUnprotected(fn: (id: string) => void): void {
    this.listeners.largeEditUnprotected.push(fn);
  }
  private set(s: SyncState): void {
    this.state = s;
    for (const fn of this.listeners.state) fn(s);
  }
  private changed(id: string): void {
    for (const fn of this.listeners.changed) fn(id);
  }

  // ------------------------------------------------------------------ reading
  /** The state held for a beach (marks it recently used), or undefined. */
  get(id: string): BeachState | undefined {
    const st = this.states.get(id);
    if (st) st.lastUsed = ++this.clock;
    return st;
  }

  /** The state without touching its place in the LRU order. */
  peek(id: string): BeachState | undefined {
    return this.states.get(id);
  }

  has(id: string): boolean {
    return this.states.has(id);
  }

  get size(): number {
    return this.states.size;
  }

  ids(): string[] {
    return [...this.states.keys()];
  }

  isDirty(id: string): boolean {
    const st = this.states.get(id);
    return !!st && st.revision !== st.savedRevision;
  }

  isLoading(id: string): boolean {
    return this.loading.has(id);
  }

  isAttached(id: string): boolean {
    return this.sources.has(id);
  }

  hasPendingSaves(): boolean {
    for (const st of this.states.values()) if (st.revision !== st.savedRevision) return true;
    return this.saving.size > 0;
  }

  /** What's on a beach right now: the source's or the edit sim's if one holds it. */
  async current(id: string): Promise<Sand | null> {
    const src = this.sources.get(id);
    if (src) return src.read();
    const st = this.states.get(id);
    if (!st) return null;
    if (st.sim) return { delta: st.sim.sandDelta(), objects: st.sim.objects.persisted(), cover: st.sim.sandCover() };
    return { delta: st.delta, objects: st.objects, ...(st.cover ? { cover: st.cover } : {}) };
  }

  /** The things on a beach as the store has them (edit sim included), without asking a source. */
  objectsOf(id: string): PlacedObject[] | null {
    const st = this.states.get(id);
    if (!st) return null;
    return st.sim ? st.sim.objects.persisted() : st.objects;
  }

  // ------------------------------------------------------------------ loading
  /**
   * The beach's state: held (and not stale) right away, else fetched once
   * however many ask. Unsaved edits are never replaced. Null when it can't
   * be had (offline, or an unreadable save of yours: never edited as empty).
   */
  load(ref: BeachRef): Promise<BeachState | null> {
    const held = this.states.get(ref.id);
    if (held) {
      held.lastUsed = ++this.clock;
      held.code = ref.code ?? held.code;
      held.owned = ref.owned;
      if (ref.updatedAt !== undefined && ref.updatedAt !== null && held.updatedAt !== null && ref.updatedAt > held.updatedAt) held.stale = true;
      const busy = this.isDirty(ref.id) || this.saving.has(ref.id) || this.sources.has(ref.id);
      if (!held.stale || busy) return Promise.resolve(held);
    }
    return this.fetch(ref);
  }

  /** Fetch it again from the server, unless it has unsaved edits (or `force`: drop them). */
  reload(ref: BeachRef, force = false): Promise<BeachState | null> {
    const held = this.states.get(ref.id);
    if (held && !force && (this.isDirty(ref.id) || this.saving.has(ref.id))) return Promise.resolve(held);
    if (held) held.stale = true;
    return this.fetch(ref, force);
  }

  /** A newer save than the one held exists (the shore said so). */
  markStale(id: string, updatedAt: number | null): void {
    const st = this.states.get(id);
    if (st && updatedAt !== null && st.updatedAt !== updatedAt) st.stale = true;
  }

  private fetch(ref: BeachRef, force = false): Promise<BeachState | null> {
    const inflight = this.loading.get(ref.id);
    if (inflight) return inflight;
    const gen = this.generation;
    const p = (async () => {
      let saved: Saved | null;
      try {
        saved = await this.backend.load(ref);
      } catch {
        return this.states.get(ref.id) ?? null;
      }
      const n = this.grid.nx * this.grid.ny;
      let sand: Sand = { delta: new Float32Array(n), objects: [] };
      if (saved) {
        try {
          const d = fitWorld(await decodeSand(saved.bytes));
          sand = {
            delta: resampleField(d.delta, d.nx, d.ny, this.grid.nx, this.grid.ny),
            objects: d.objects,
            ...(d.cover ? { cover: resampleField(d.cover, d.nx, d.ny, this.grid.nx, this.grid.ny) } : {}),
          };
        } catch {
          // never make an unreadable save of yours editable as an empty beach
          if (ref.owned) return this.states.get(ref.id) ?? null;
        }
      }
      if (gen !== this.generation) return null;
      const held = this.states.get(ref.id);
      // edited while it loaded: what's here wins (the save will say if the server moved on)
      if (held && !force && (this.isDirty(ref.id) || this.saving.has(ref.id))) return held;
      const st: BeachState = held ?? {
        id: ref.id,
        code: ref.code ?? null,
        owned: ref.owned,
        location: null,
        delta: sand.delta,
        objects: [],
        display: new Float32Array(n),
        updatedAt: null,
        fresh: false,
        stale: false,
        revision: 0,
        savedRevision: 0,
        lastUsed: 0,
      };
      st.code = ref.code ?? st.code;
      st.owned = ref.owned;
      st.location = saved?.location || ref.location || st.location;
      st.updatedAt = saved?.updatedAt ?? ref.updatedAt ?? null;
      st.version = saved?.version;
      st.epoch = saved ? saved.epoch : ref.owned ? 0 : undefined;
      st.fresh = !saved;
      st.stale = false;
      st.revision = st.savedRevision;
      st.lastUsed = ++this.clock;
      st.history = undefined;
      this.applySand(st, sand);
      if (st.sim) st.sim.loadDelta(sand.delta, sand.objects, sand.cover);
      this.states.set(ref.id, st);
      if (held) for (const fn of this.listeners.reloaded) fn(ref.id);
      this.changed(ref.id);
      return st;
    })().finally(() => this.loading.delete(ref.id));
    this.loading.set(ref.id, p);
    return p;
  }

  private applySand(st: BeachState, sand: Sand): void {
    st.delta = sand.delta;
    st.cover = sand.cover;
    st.objects = sand.objects;
    this.refreshDisplay(st);
  }

  private refreshDisplay(st: BeachState): void {
    const n = this.grid.nx * this.grid.ny;
    if (st.sim) {
      if (st.display.length !== n) st.display = new Float32Array(n);
      const sand = st.sim.sand;
      for (let k = 0; k < n; k++) st.display[k] = sand[k] - this.rest[k];
      return;
    }
    const display = st.delta.slice();
    if (st.cover) applyRockCover(display, this.rest, this.grid.nx, this.grid.ny, this.grid.dx, st.objects, st.cover);
    st.display = display;
  }

  /** Put a beach into the store as given (the sandbox's device beach, a first sign-in's sand). */
  put(ref: BeachRef, sand: Sand, opts: { dirty?: boolean; epoch?: number; updatedAt?: number | null } = {}): BeachState {
    const n = this.grid.nx * this.grid.ny;
    const st: BeachState = this.states.get(ref.id) ?? {
      id: ref.id,
      code: ref.code ?? null,
      owned: ref.owned,
      location: ref.location ?? null,
      delta: new Float32Array(n),
      objects: [],
      display: new Float32Array(n),
      updatedAt: opts.updatedAt ?? null,
      fresh: false,
      stale: false,
      revision: 0,
      savedRevision: 0,
      lastUsed: 0,
    };
    if (ref.location) st.location = ref.location;
    if (opts.epoch !== undefined) st.epoch = opts.epoch;
    st.lastUsed = ++this.clock;
    if (st.sim) st.sim.loadDelta(sand.delta, sand.objects, sand.cover);
    this.applySand(st, sand);
    this.states.set(ref.id, st);
    if (opts.dirty) this.markDirty(ref.id, 0);
    this.changed(ref.id);
    return st;
  }

  setLocation(id: string, location: string): void {
    const st = this.states.get(id);
    if (st && st.location !== location) {
      st.location = location;
      if (st.owned) this.markDirty(id, 1500);
    }
  }

  // ------------------------------------------------------------------ a simulation holds it
  /**
   * Hand a beach to a simulation (the wave worker): its sand and its undo
   * history leave the store (an edit sim's too), and saves read the source.
   */
  checkout(id: string, source: SandSource): (Sand & { history?: UndoHistory }) | null {
    const st = this.states.get(id);
    if (!st) return null;
    st.lastUsed = ++this.clock;
    let out: Sand & { history?: UndoHistory };
    if (st.sim) {
      out = { delta: st.sim.sandDelta(), objects: st.sim.objects.persisted(), cover: st.sim.sandCover(), history: st.sim.undo.take() };
      st.sim = undefined;
    } else {
      out = { delta: st.delta.slice(), objects: st.objects.map((o) => ({ ...o })), ...(st.cover ? { cover: st.cover.slice() } : {}), ...(st.history ? { history: st.history } : {}) };
    }
    st.history = undefined;
    this.sources.set(id, source);
    return out;
  }

  /** The simulation gives the beach back (with its history); the store holds it again. */
  checkin(id: string, sand: Sand & { history?: UndoHistory }): void {
    this.sources.delete(id);
    const st = this.states.get(id);
    if (!st) return;
    this.applySand(st, sand);
    st.history = sand.history;
    this.changed(id);
  }

  /** A simulation's newest sand (for drawing it as a snapshot later), without giving it back. */
  absorb(id: string, sand: Sand): void {
    const st = this.states.get(id);
    if (!st) return;
    this.applySand(st, sand);
  }

  // ------------------------------------------------------------------ editing on the main thread
  /** The beach's edit simulation (made on first use): yours, loaded, and not held by a source. */
  editSim(id: string): BeachSim | null {
    const st = this.states.get(id);
    if (!st || !st.owned || this.sources.has(id)) return null;
    st.lastUsed = ++this.clock;
    if (!st.sim) {
      const sim = new BeachSim(this.grid, this.seed, { waves: false, tide: false, erosion: false, healing: false, seep: false });
      sim.loadDelta(st.delta, st.objects, st.cover, st.history);
      st.history = undefined;
      st.sim = sim;
    }
    return st.sim;
  }

  /** An edit sim changed the beach: refresh what's drawn (and save soon, with `save`). */
  edited(id: string, save = true, delayMs: number = BEACH_STORE.saveDelayMs): void {
    const st = this.states.get(id);
    if (!st?.sim) return;
    st.objects = st.sim.objects.persisted();
    this.refreshDisplay(st);
    if (save) this.markDirty(id, delayMs);
    this.changed(id);
  }

  undoCount(id: string): { undo: number; redo: number } {
    const st = this.states.get(id);
    if (st?.sim) return { undo: st.sim.undo.undoCount, redo: st.sim.undo.redoCount };
    return { undo: st?.history?.undos.length ?? 0, redo: st?.history?.redos.length ?? 0 };
  }

  // ------------------------------------------------------------------ saving
  /** Something changed on a beach of yours: save it a little after the last change. */
  markDirty(id: string, delayMs: number = BEACH_STORE.saveDelayMs): void {
    const st = this.states.get(id);
    if (!st || !st.owned || this.fenced || !this.canSave()) return;
    st.revision++;
    const t = this.timers.get(id);
    if (t !== undefined) clearTimeout(t);
    this.timers.set(id, setTimeout(() => void this.flush(id), delayMs));
  }

  /** Save one beach now if it has changes (waits for a save already running, then saves again). */
  async flush(id: string, keepalive = false): Promise<void> {
    const t = this.timers.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      this.timers.delete(id);
    }
    while (this.saving.has(id)) await this.saving.get(id);
    if (!this.isDirty(id) || this.fenced || !this.canSave()) return;
    const p = this.save(id, keepalive).finally(() => this.saving.delete(id));
    this.saving.set(id, p);
    await p;
  }

  /** Save every beach with changes. */
  async flushAll(keepalive = false): Promise<void> {
    const ids = [...this.states.keys()].filter((id) => this.isDirty(id) || this.saving.has(id));
    await Promise.all(ids.map((id) => this.flush(id, keepalive)));
  }

  private async save(id: string, keepalive: boolean): Promise<void> {
    const st = this.states.get(id);
    if (!st) return;
    const gen = this.generation;
    const revision = st.revision;
    this.set('saving');
    try {
      const sand = await this.current(id);
      if (!sand || gen !== this.generation) return;
      const bytes = await encodeSand(sand.delta, this.grid.nx, this.grid.ny, sand.objects, sand.cover);
      if (gen !== this.generation) return;
      const items = countItems(sand.objects);
      const ref: BeachRef = { id, code: st.code, owned: true, location: st.location };
      const r = await this.backend.save(ref, bytes, {
        location: st.location || 'santa-monica',
        nx: this.grid.nx,
        ny: this.grid.ny,
        keepalive,
        items,
        epoch: st.epoch,
      });
      if (gen !== this.generation) return;
      st.savedRevision = Math.max(st.savedRevision, revision);
      st.updatedAt = r.updatedAt;
      st.fresh = false;
      this.savedAt = r.updatedAt;
      // what was saved is what's held now, unless a sim still holds it
      if (!st.sim && !this.sources.has(id)) this.applySand(st, sand);
      for (const fn of this.listeners.saved) fn(id, { ...r, items });
      if (r.largeEdit && r.largeEditCheckpoint === false) for (const fn of this.listeners.largeEditUnprotected) fn(id);
      const dropped = objectsToSave(sand.objects).dropped;
      if (dropped !== this.dropped) {
        this.dropped = dropped;
        for (const fn of this.listeners.dropped) fn(dropped);
      }
      this.set('saved');
    } catch (e) {
      if (gen !== this.generation) return;
      const status = statusOf(e);
      const message = (e as Error | null)?.message;
      if (status === 409 && message === 'fenced') {
        this.enterFenced(id);
        return;
      }
      if (status === 409) {
        // a checkpoint was restored onto this beach since it loaded here:
        // don't save the old sand over it; load the restored beach instead
        st.savedRevision = st.revision;
        this.set('idle');
        for (const fn of this.listeners.problem) fn(id, 'restored');
        void this.reload({ id, code: st.code, owned: st.owned }, true);
        return;
      }
      if (status === 426) {
        this.set('outdated');
        for (const fn of this.listeners.problem) fn(id, 'outdated');
        return;
      }
      if (status === 413) {
        this.set('tooBig');
        for (const fn of this.listeners.problem) fn(id, 'tooBig');
        return;
      }
      this.set('offline');
      this.timers.set(id, setTimeout(() => void this.flush(id), BEACH_STORE.retryMs));
    }
  }

  /** Another instance took over editing: nothing here saves until it takes over again. */
  enterFenced(id?: string): void {
    if (this.fenced) return;
    this.fenced = true;
    for (const [k, t] of this.timers) {
      clearTimeout(t);
      this.timers.delete(k);
    }
    for (const st of this.states.values()) st.savedRevision = st.revision;
    this.set('fenced');
    for (const fn of this.listeners.problem) fn(id ?? '', 'fenced');
  }

  /** Nothing waiting to save: say saved (a beach just came in from the server as it is there). */
  settle(): void {
    if (!this.fenced && !this.hasPendingSaves() && (this.state === 'idle' || this.state === 'saved')) this.set('saved');
  }

  /** Editing is back here: saves run again. */
  unfence(): void {
    if (!this.fenced) return;
    this.fenced = false;
    this.set('idle');
  }

  // ------------------------------------------------------------------ memory
  /** The beaches in view now: never let go. */
  retain(ids: Iterable<string>): void {
    this.retained = new Set(ids);
  }

  /**
   * Keep at most `capacity` beaches: let go of the least recently used that
   * aren't in view, held by a simulation, changed, saving or loading.
   */
  gc(): string[] {
    const dropped: string[] = [];
    if (this.states.size <= this.capacity) return dropped;
    const candidates = [...this.states.values()]
      .filter((st) => !this.retained.has(st.id) && !this.sources.has(st.id) && !this.isDirty(st.id) && !this.saving.has(st.id) && !this.loading.has(st.id) && !this.timers.has(st.id))
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const st of candidates) {
      if (this.states.size <= this.capacity) break;
      this.states.delete(st.id);
      dropped.push(st.id);
    }
    return dropped;
  }

  /** Someone else signed in (or nobody): forget everything held for the last person. */
  reset(): void {
    this.generation++;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.states.clear();
    this.loading.clear();
    this.saving.clear();
    this.sources.clear();
    this.retained.clear();
    this.fenced = false;
    this.savedAt = 0;
    this.dropped = 0;
    this.set('idle');
  }

  /** Forget one beach (it was deleted). */
  forget(id: string): void {
    const t = this.timers.get(id);
    if (t !== undefined) clearTimeout(t);
    this.timers.delete(id);
    this.sources.delete(id);
    this.states.delete(id);
  }
}
