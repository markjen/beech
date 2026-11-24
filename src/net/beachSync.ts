import { decodeSand, encodeSand, fitWorld, objectsToSave, resampleField } from '../sim/sandCodec';
import type { PlacedObject } from '../sim/objects';
import { ApiError, type Account } from './account';
import { itemById } from '../world/items';

/**
 * How many of each non-free item are on a beach (so your bag can count across
 * beaches). Wild ones count too, as the server counts them: the sea only
 * brings free kinds, so a "wild" lighthouse would be a made-up save.
 */
export function countItems(objects: PlacedObject[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of objects) {
    if (itemById(o.item)?.unlimited !== false) continue;
    out[o.item] = (out[o.item] ?? 0) + 1;
  }
  return out;
}

/** `tooBig`: the server refused the save as too large (it keeps the last one that fit) */
export type SyncState = 'idle' | 'saving' | 'saved' | 'offline' | 'tooBig' | 'outdated';

export interface SyncHost {
  /** current sand minus the rest beach, at the live grid size, plus what's on it */
  getSand(): Promise<{ delta: Float32Array; objects: PlacedObject[] }>;
  setSand(delta: Float32Array, objects: PlacedObject[]): void;
  grid: { nx: number; ny: number };
  location(): string;
  setLocation(id: string): void;
}

/**
 * Keeps the signed-in person's beach saved: after strokes (debounced), every
 * so often while things change, and when the app goes to the background.
 * Last write wins: one beach per person.
 */
export class BeachSync {
  state: SyncState = 'idle';
  savedAt = 0;
  private dirty = false;
  private timer = 0;
  private inflight: Promise<void> | null = null;
  /** loading another beach: hold saves until it's in (they'd save the old sand into it) */
  private switching = false;
  private listeners: ((s: SyncState) => void)[] = [];
  /** the beach's epoch when it was loaded here (a restore elsewhere moves it on) */
  private epoch: number | undefined;
  private restoredListeners: (() => void)[] = [];
  /** your things the last save had to leave out (over MAX_OBJECTS) */
  dropped = 0;
  private droppedListeners: ((n: number) => void)[] = [];

  constructor(
    private readonly account: Account,
    private readonly host: SyncHost,
  ) {
    // a different person (or nobody): drop anything queued for the last one,
    // so one person's sand is never saved into another's account
    let who = account.user?.id ?? null;
    account.onChange((u) => {
      const next = u?.id ?? null;
      if (next === who) return;
      who = next;
      window.clearTimeout(this.timer);
      this.dirty = false;
      this.savedAt = 0;
      this.set('idle');
    });
    // waves keep reshaping the sand, so save now and then while signed in
    window.setInterval(() => {
      if (this.account.user && this.dirty) void this.flush();
    }, 90000);
  }

  onState(fn: (s: SyncState) => void): void {
    this.listeners.push(fn);
  }

  /** The beach was restored from a checkpoint (on another device) and has been reloaded here. */
  onRestoredElsewhere(fn: () => void): void {
    this.restoredListeners.push(fn);
  }

  /** A save had to leave some of your things out (or, with 0, everything fits again). */
  onDropped(fn: (n: number) => void): void {
    this.droppedListeners.push(fn);
  }

  private set(s: SyncState): void {
    this.state = s;
    for (const fn of this.listeners) fn(s);
  }

  /** Something changed; save a few seconds after the player pauses. */
  markDirty(delayMs = 6000): void {
    // (while another beach is loading, a timed save could put the old sand into it)
    if (!this.account.user || this.switching) return;
    this.dirty = true;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), delayMs);
  }

  /**
   * Save now. If a save is already running, wait for it and then save again:
   * it may have started before the latest change.
   */
  async flush(keepalive = false): Promise<void> {
    if (!this.account.user) return;
    while (this.inflight) await this.inflight;
    this.inflight = this.save(keepalive);
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  private async save(keepalive: boolean): Promise<void> {
    if (!this.account.user) return;
    const forUser = this.account.user.id;
    window.clearTimeout(this.timer);
    this.set('saving');
    try {
      const forBeach = this.account.beachId;
      const { delta, objects } = await this.host.getSand();
      const bytes = await encodeSand(delta, this.host.grid.nx, this.host.grid.ny, objects);
      // switched accounts or beaches mid-save: this sand isn't theirs
      if (this.account.user?.id !== forUser || this.account.beachId !== forBeach) return;
      this.savedAt = await this.account.saveBeach(
        bytes,
        this.host.location(),
        this.host.grid.nx,
        this.host.grid.ny,
        keepalive,
        countItems(objects),
        this.epoch,
      );
      this.dirty = false;
      const dropped = objectsToSave(objects).dropped;
      if (dropped !== this.dropped) {
        this.dropped = dropped;
        for (const fn of this.droppedListeners) fn(dropped);
      }
      this.set('saved');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // a checkpoint was restored onto this beach since it loaded here:
        // don't save the old sand over it; load the restored beach instead
        this.dirty = false;
        this.set('idle');
        window.setTimeout(() => void this.reloadRestored(), 0);
        return;
      }
      if (e instanceof ApiError && e.status === 426) {
        // the server won't take saves from this version of the app: only
        // a reload helps, so don't retry (the change stays dirty, and the
        // reloaded app loads the last save)
        this.set('outdated');
        return;
      }
      if (e instanceof ApiError && e.status === 413) {
        // retrying won't help; the next change tries again (it may be smaller)
        this.set('tooBig');
        return;
      }
      this.set('offline');
      // try again later
      this.timer = window.setTimeout(() => void this.flush(), 30000);
    }
  }

  /**
   * After signing in: bring back the saved beach, or (first time) save the
   * beach the player is on now.
   */
  async restoreOrCreate(fresh = false): Promise<'restored' | 'created'> {
    const saved = await this.account.loadBeach();
    if (!saved) {
      // a brand-new extra beach starts untouched; a first sign-in keeps the
      // beach you were already playing on
      if (fresh) this.host.setSand(new Float32Array(this.host.grid.nx * this.host.grid.ny), []);
      this.epoch = 0;
      await this.flush();
      return 'created';
    }
    this.epoch = saved.epoch;
    const { nx, ny, delta, objects } = fitWorld(await decodeSand(saved.bytes));
    if (saved.location) this.host.setLocation(saved.location);
    this.host.setSand(resampleField(delta, nx, ny, this.host.grid.nx, this.host.grid.ny), objects);
    this.savedAt = saved.updatedAt;
    this.dirty = false;
    this.set('saved');
    return 'restored';
  }

  /**
   * Open another of your beaches on this device: save this one, then load
   * that one into the simulation (an untouched beach if it's new).
   */
  async switchTo(id: string): Promise<void> {
    if (id === this.account.beachId) return;
    window.clearTimeout(this.timer);
    await this.flush();
    this.switching = true;
    try {
      this.account.setBeach(id);
      this.savedAt = 0;
      await this.restoreOrCreate(true);
    } finally {
      this.switching = false;
    }
  }

  /**
   * Replace this device's beach on the server (a checkpoint restore): save
   * what's here first, hold saves while `change` runs, then load the result.
   */
  async replaceHere(change: () => Promise<void>): Promise<void> {
    window.clearTimeout(this.timer);
    await this.flush();
    this.switching = true;
    try {
      await change();
      this.savedAt = 0;
      this.dirty = false;
      await this.restoreOrCreate();
    } finally {
      this.switching = false;
    }
  }

  private async reloadRestored(): Promise<void> {
    if (this.switching) return;
    this.switching = true;
    try {
      await this.restoreOrCreate();
    } catch {
      /* offline: the next save tries again and lands here again */
    } finally {
      this.switching = false;
    }
    for (const fn of this.restoredListeners) fn();
  }
}
