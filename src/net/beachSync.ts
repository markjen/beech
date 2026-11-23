import { decodeSand, encodeSand, fitWorld, resampleField } from '../sim/sandCodec';
import type { PlacedObject } from '../sim/objects';
import type { Account } from './account';

export type SyncState = 'idle' | 'saving' | 'saved' | 'offline';

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
  private listeners: ((s: SyncState) => void)[] = [];

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

  private set(s: SyncState): void {
    this.state = s;
    for (const fn of this.listeners) fn(s);
  }

  /** Something changed; save a few seconds after the player pauses. */
  markDirty(delayMs = 6000): void {
    if (!this.account.user) return;
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
      const { delta, objects } = await this.host.getSand();
      const bytes = await encodeSand(delta, this.host.grid.nx, this.host.grid.ny, objects);
      if (this.account.user?.id !== forUser) return; // switched accounts mid-save
      this.savedAt = await this.account.saveBeach(bytes, this.host.location(), this.host.grid.nx, this.host.grid.ny, keepalive);
      this.dirty = false;
      this.set('saved');
    } catch {
      this.set('offline');
      // try again later
      this.timer = window.setTimeout(() => void this.flush(), 30000);
    }
  }

  /**
   * After signing in: bring back the saved beach, or (first time) save the
   * beach the player is on now.
   */
  async restoreOrCreate(): Promise<'restored' | 'created'> {
    const saved = await this.account.loadBeach();
    if (!saved) {
      await this.flush();
      return 'created';
    }
    const { nx, ny, delta, objects } = fitWorld(await decodeSand(saved.bytes));
    if (saved.location) this.host.setLocation(saved.location);
    this.host.setSand(resampleField(delta, nx, ny, this.host.grid.nx, this.host.grid.ny), objects);
    this.savedAt = saved.updatedAt;
    this.dirty = false;
    this.set('saved');
    return 'restored';
  }
}
