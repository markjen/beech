import { decodeSand, encodeSand, fitWorld, objectsToSave, resampleField } from '../sim/sandCodec';
import type { PlacedObject } from '../sim/objects';
import { ApiError, type Account } from './account';
import { reportError } from './telemetry';
import { itemById } from '../world/items';
import { CATCHUP } from '../config';

/** how often the app tells the server it has the beach open (the server waits 45 s) */
const HERE_EVERY_MS = 20000;
/** while someone else is looking at this beach, save this often so they see it live */
const WATCHED_SAVE_MS = 5000;

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
/** `outdated`: the server refused the save from this (old) app (426): it needs a reload */
/** `fenced`: another tab or device took over editing (docs/EDIT_SESSIONS.md): this one can look, not touch */
export type SyncState = 'idle' | 'saving' | 'saved' | 'offline' | 'tooBig' | 'outdated' | 'fenced';

export interface SyncHost {
  /** current sand minus the rest beach, at the live grid size, plus what's on it */
  getSand(): Promise<{ delta: Float32Array; objects: PlacedObject[]; cover?: Float32Array }>;
  setSand(delta: Float32Array, objects: PlacedObject[], cover?: Float32Array): void;
  grid: { nx: number; ny: number };
  location(): string;
  setLocation(id: string): void;
}

/**
 * Keeps the signed-in person's beach saved: after strokes (debounced), every
 * so often while things change, and when the app goes to the background.
 * Each beach saves independently.
 * Only one instance edits at a time (docs/EDIT_SESSIONS.md): this one claims
 * an edit token when it opens the beach, and another instance claiming one
 * fences this one — it stops saving and turns view-only until it takes over.
 */
export class BeachSync {
  state: SyncState = 'idle';
  savedAt = 0;
  /** this instance is no longer the editor: it can look, not touch */
  fenced = false;
  private dirty = false;
  private timer = 0;
  private inflight: Promise<void> | null = null;
  /** loading another beach: hold saves until it's in (they'd save the old sand into it) */
  private switching = false;
  /**
   * Switches/restores run one at a time: two overlapping switchTo() calls
   * used to interleave their loads, so the second call's pre-switch flush
   * saved the still-loaded old beach's sand into the first target beach.
   */
  private switchQueue: Promise<void> = Promise.resolve();
  /**
   * The beach whose sand is currently in the simulation. A save is only
   * valid for this beach: while a switch is loading, the sim still shows
   * the old beach even though account.beachId already names the new one,
   * so a timer-fired save then would write the old sand under the new id.
   */
  private simBeach: string | null;
  private listeners: ((s: SyncState) => void)[] = [];
  /** the beach's epoch when it was loaded here (a restore elsewhere moves it on) */
  private epoch: number | undefined;
  private restoredListeners: (() => void)[] = [];
  private fencedListeners: (() => void)[] = [];
  /** your things the last save had to leave out (over MAX_OBJECTS) */
  dropped = 0;
  private droppedListeners: ((n: number) => void)[] = [];
  private largeEditUnprotectedListeners: (() => void)[] = [];
  private changedListeners: (() => void)[] = [];
  private loadedListeners: (() => void)[] = [];
  /** when the app went to the background (0: it's showing) */
  private hiddenAt = 0;
  /** someone else is looking at this beach (the last heartbeat said so) */
  watched = false;

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
      this.watched = false;
      this.savedAt = 0;
      this.fenced = false;
      this.set('idle');
    });
    // waves keep reshaping the sand, so save now and then while signed in
    window.setInterval(() => {
      if (this.account.user && this.dirty) void this.flush();
    }, 90000);
    this.simBeach = account.beachId;
    // the edit heartbeat: every 30 s, ask whether this instance is still
    // the editor, so a takeover elsewhere shows up promptly even while idle
    // (offline: keep editing — the next save decides, and a save that can't
    // reach the server reports offline, never fenced)
    window.setInterval(() => {
      if (!this.account.user || !this.account.editToken || this.fenced) return;
      void this.account.editSessionActive().then((active) => {
        if (!active) this.enterFenced();
      }).catch(() => {});
    }, 30000);
    // live beaches (docs/LIVE_SIM.md): while this app shows the beach it is
    // the one simulating it, so it tells the server to hold off its catch-up
    window.setInterval(() => void this.beat(), HERE_EVERY_MS);
    // live viewers (L5): while watched, the waves' work reaches them every few seconds
    window.setInterval(() => {
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (this.watched && this.account.user && !this.fenced && !this.switching && !hidden && !this.inflight) void this.flush();
    }, WATCHED_SAVE_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.hiddenAt = Date.now();
          return;
        }
        const away = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
        this.hiddenAt = 0;
        // back after a while: the server's catch-up has the sea's work since the
        // save made on the way out, so load that rather than carry on from here
        if (away > CATCHUP.minGapMin * 60000) void this.reloadChanged();
        else void this.beat();
      });
    }
  }

  /** A saved beach was loaded here (sign-in, another beach, a reload). */
  onLoaded(fn: () => void): void {
    this.loadedListeners.push(fn);
  }

  /** The beach changed on the server while this app wasn't simulating it (a catch-up or a restore), and has been reloaded. */
  onChangedElsewhere(fn: () => void): void {
    this.changedListeners.push(fn);
  }

  /** Tell the server this app has the beach open; reload it if it moved on meanwhile. */
  private async beat(): Promise<void> {
    if (!this.account.user || this.fenced || this.switching || (typeof document !== 'undefined' && document.hidden) || this.epoch === undefined) return;
    let r: { epoch: number; watched?: boolean } | null;
    try {
      r = await this.account.here();
    } catch {
      return; // offline: the next beat tries again
    }
    this.watched = !!r?.watched;
    if (r && r.epoch > (this.epoch ?? 0)) await this.reloadChanged();
  }

  private async reloadChanged(): Promise<void> {
    if (this.switching || !this.account.user) return;
    return this.runExclusive(async () => {
      if (!this.account.user) return;
      this.switching = true;
      try {
        await this.restoreOrCreate();
      } catch {
        return; /* offline: the next beat tries again */
      } finally {
        this.switching = false;
      }
      for (const fn of this.changedListeners) fn();
      void this.beat();
    });
  }

  onState(fn: (s: SyncState) => void): void {
    this.listeners.push(fn);
  }

  /** Another instance took over editing: this one is view-only now. */
  onFenced(fn: () => void): void {
    this.fencedListeners.push(fn);
  }

  /** The beach was restored from a checkpoint (on another device) and has been reloaded here. */
  onRestoredElsewhere(fn: () => void): void {
    this.restoredListeners.push(fn);
  }

  /** A save had to leave some of your things out (or, with 0, everything fits again). */
  onDropped(fn: (n: number) => void): void {
    this.droppedListeners.push(fn);
  }

  /** a big edit landed without its safety copy (the auto slot could not be written) */
  onLargeEditUnprotected(fn: () => void): void {
    this.largeEditUnprotectedListeners.push(fn);
  }

  private set(s: SyncState): void {
    this.state = s;
    for (const fn of this.listeners) fn(s);
  }

  /** Something changed; save a few seconds after the player pauses. */
  markDirty(delayMs = 6000): void {
    // (while another beach is loading, a timed save could put the old sand into it)
    // (fenced: this instance doesn't save at all — the editor does)
    if (!this.account.user || this.switching || this.fenced) return;
    this.dirty = true;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), delayMs);
  }

  /**
   * Save now. If a save is already running, wait for it and then save again:
   * it may have started before the latest change.
   */
  async flush(keepalive = false): Promise<void> {
    if (!this.account.user || this.fenced) return;
    while (this.inflight) await this.inflight;
    this.inflight = this.save(keepalive);
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  /** This instance is no longer the editor: stop saving, and say so. */
  private enterFenced(): void {
    if (this.fenced) return;
    this.fenced = true;
    this.dirty = false;
    window.clearTimeout(this.timer);
    this.set('fenced');
    for (const fn of this.fencedListeners) fn();
  }

  /**
   * Take editing back here: claim a fresh token (fencing the other
   * instances), then reload the beach — they may have changed it since this
   * instance last saved, and what is on screen is not necessarily what is saved.
   */
  async takeOver(): Promise<void> {
    if (!this.account.user) return;
    await this.account.claimEditSession();
    this.fenced = false;
    this.set('idle');
    await this.restoreOrCreate();
  }

  private async save(keepalive: boolean): Promise<void> {
    if (!this.account.user) return;
    const forUser = this.account.user.id;
    const forBeach = this.account.beachId;
    window.clearTimeout(this.timer);
    this.set('saving');
    try {
      // the sim still shows another beach (a switch is loading it in):
      // this sand isn't forBeach's, so don't write it under that id
      if (this.simBeach !== forBeach) return;
      const { delta, objects, cover } = await this.host.getSand();
      const bytes = await encodeSand(delta, this.host.grid.nx, this.host.grid.ny, objects, cover);
      // switched accounts or beaches mid-save: this sand isn't theirs
      if (this.account.user?.id !== forUser || this.account.beachId !== forBeach || this.simBeach !== forBeach)
        return;
      const items = countItems(objects);
      const saved = await this.account.saveBeach(
        bytes,
        this.host.location(),
        this.host.grid.nx,
        this.host.grid.ny,
        keepalive,
        items,
        this.epoch,
      );
      if (this.account.user?.id !== forUser || this.account.beachId !== forBeach) return;
      this.savedAt = saved.updatedAt;
      if (this.account.beach) Object.assign(this.account.beach, { updatedAt: saved.updatedAt, items });
      if (saved.largeEdit && saved.largeEditCheckpoint === false) {
        // the big edit is saved, but there is no checkpoint to go back to:
        // tell the player (and log it) rather than letting the auto slot's
        // absence pass unnoticed
        reportError('sync', new Error('large edit saved without a checkpoint'), { source: 'beachSync:largeEdit' });
        for (const fn of this.largeEditUnprotectedListeners) fn();
      }
      this.dirty = false;
      const dropped = objectsToSave(objects).dropped;
      if (dropped !== this.dropped) {
        this.dropped = dropped;
        for (const fn of this.droppedListeners) fn(dropped);
      }
      this.set('saved');
    } catch (e) {
      if (this.account.user?.id !== forUser || this.account.beachId !== forBeach) return;
      if (e instanceof ApiError && e.status === 409 && e.message === 'fenced') {
        // another tab or device took over editing: don't save over it, and
        // don't reload either — what is on screen stays to look at
        this.dirty = false;
        this.enterFenced();
        return;
      }
      if (e instanceof ApiError && e.status === 409) {
        // a checkpoint was restored onto this beach since it loaded here:
        // don't save the old sand over it; load the restored beach instead
        this.dirty = false;
        this.set('idle');
        window.setTimeout(() => void this.reloadRestored(), 0);
        return;
      }
      if (e instanceof ApiError && e.status === 426) {
        // this app is older than the server's data: saving again won't help; reload
        reportError('sync', e, { source: 'beachSync:save', meta: { status: 426 } });
        this.set('outdated');
        return;
      }
      if (e instanceof ApiError && e.status === 413) {
        // retrying won't help; the next change tries again (it may be smaller)
        reportError('sync', e, { source: 'beachSync:save', meta: { status: 413 } });
        this.set('tooBig');
        return;
      }
      reportError('sync', e, {
        source: 'beachSync:save',
        meta: e instanceof ApiError ? { status: e.status } : undefined,
      });
      this.set('offline');
      // try again later
      this.timer = window.setTimeout(() => void this.flush(), 30000);
    }
  }

  /**
   * After signing in: bring back the saved beach, or (first time) save the
   * beach the player is on now. `claim` takes over editing here — a new
   * sign-in, tab or device showing up — and fences older instances. Every
   * other load (switching beaches, reloading after a restore) keeps the
   * token this instance already holds, so it never steals editing back
   * from an instance that took over.
   */
  async restoreOrCreate(fresh = false, claim = false): Promise<'restored' | 'created'> {
    if (claim && this.account.user) {
      try {
        await this.account.claimEditSession();
        this.fenced = false;
      } catch {
        /* offline: load what we have; the save will say offline, not fenced */
      }
    }
    const saved = await this.account.loadBeach();
    if (!saved) {
      // a brand-new extra beach starts untouched; a first sign-in keeps the
      // beach you were already playing on
      if (fresh) this.host.setSand(new Float32Array(this.host.grid.nx * this.host.grid.ny), []);
      this.epoch = 0;
      this.simBeach = this.account.beachId;
      await this.flush();
      return 'created';
    }
    this.epoch = saved.epoch;
    const { nx, ny, delta, objects, cover } = fitWorld(await decodeSand(saved.bytes));
    if (saved.location) this.host.setLocation(saved.location);
    const resampledCover = cover ? resampleField(cover, nx, ny, this.host.grid.nx, this.host.grid.ny) : undefined;
    this.host.setSand(resampleField(delta, nx, ny, this.host.grid.nx, this.host.grid.ny), objects, resampledCover);
    this.simBeach = this.account.beachId;
    this.savedAt = saved.updatedAt;
    this.dirty = false;
    this.set('saved');
    for (const fn of this.loadedListeners) fn();
    return 'restored';
  }

  /**
   * Run switches/restores one at a time, in the order asked: a second
   * switch waits for the first beach to finish loading, so its pre-switch
   * flush saves that beach's own sand instead of the old beach's.
   * A failure still lets the next one run, and the caller sees the error.
   */
  private runExclusive(work: () => Promise<void>): Promise<void> {
    const run = this.switchQueue.then(work, work);
    this.switchQueue = run.catch(() => {});
    return run;
  }

  /**
   * Open another of your beaches on this device: save this one, then load
   * that one into the simulation (an untouched beach if it's new).
   */
  async switchTo(id: string): Promise<void> {
    if (id === this.account.beachId) return;
    return this.runExclusive(async () => {
      if (id === this.account.beachId) return;
      window.clearTimeout(this.timer);
      await this.flush();
      this.switching = true;
      try {
        this.account.setBeach(id);
        this.watched = false;
        this.savedAt = 0;
        await this.restoreOrCreate(true);
      } finally {
        this.switching = false;
      }
    });
  }

  /**
   * Replace this device's beach on the server (a checkpoint restore): save
   * what's here first, hold saves while `change` runs, then load the result.
   */
  async replaceHere(change: () => Promise<void>): Promise<void> {
    return this.runExclusive(async () => {
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
    });
  }

  private async reloadRestored(): Promise<void> {
    return this.runExclusive(async () => {
      this.switching = true;
      try {
        await this.restoreOrCreate();
      } catch (e) {
        reportError('sync', e, { source: 'beachSync:reloadRestored' });
        /* offline: the next save tries again and lands here again */
      } finally {
        this.switching = false;
      }
      for (const fn of this.restoredListeners) fn();
    });
  }
}
