import type { Account } from './account';
import { BeachStore, LOCAL_BEACH, countItems, type BeachRef, type Sand, type SyncState } from './beachStore';
import type { UndoHistory } from '../sim/undoStack';
import { CATCHUP } from '../config';

export { countItems, type SyncState };

/** how often the app tells the server it has the beach open (the server waits 45 s) */
const HERE_EVERY_MS = 20000;
/** while someone else is looking at this beach, save this often so they see it live */
const WATCHED_SAVE_MS = 5000;

/** The wave worker, seen from the binding: read its beach out, put another in. */
export interface SimHost {
  /** the worker's beach now; `history`: its undo history leaves the worker too */
  read(history?: boolean): Promise<Sand & { history?: UndoHistory }>;
  /** load a beach into the worker (with its own undo history) */
  write(sand: Sand & { history?: UndoHistory }): void;
}

/**
 * Which beach the wave worker simulates (docs/BEACH_STORE.md). There is no
 * "current" beach: the view picks the beach of yours nearest its centre and
 * binds it here. Binding hands the old beach's sand and undo history back to
 * the store under its id and loads the new id's state into the worker — the
 * store already holds it, so nothing is fetched again.
 *
 * While a beach is bound this app is the one simulating it, so this also
 * runs the live-beach duties (docs/LIVE_SIM.md): the `here` heartbeat, the
 * fast saves while someone watches, reloading when the server moved the
 * beach on, and the edit-session heartbeat (docs/EDIT_SESSIONS.md).
 */
export class BeachSync {
  /** the beach in the worker now (null: none of yours yet) */
  id: string | null = null;
  /** someone else is looking at the bound beach (the last heartbeat said so) */
  watched = false;
  /** binds run one at a time, in the order asked */
  private queue: Promise<void> = Promise.resolve();
  private boundListeners: ((id: string | null) => void)[] = [];
  private loadedListeners: ((id: string) => void)[] = [];
  private changedListeners: ((id: string) => void)[] = [];
  /** when the app went to the background (0: it's showing) */
  private hiddenAt = 0;
  /** the newest bind asked for (an older one that's still loading gives way) */
  private wanted: string | null = null;

  constructor(
    private readonly account: Account | null,
    private readonly store: BeachStore,
    private readonly host: SimHost,
  ) {
    // the server sent a newer copy of the bound beach (a restore, a catch-up): into the worker with it
    store.onReloaded((id) => {
      if (id !== this.id) return;
      const st = store.peek(id);
      if (!st) return;
      host.write({ delta: st.delta.slice(), objects: st.objects.map((o) => ({ ...o })), ...(st.cover ? { cover: st.cover.slice() } : {}) });
      for (const fn of this.changedListeners) fn(id);
    });
    if (!account) return;
    account.onChange(() => {
      this.watched = false;
    });
    // the edit heartbeat: every 30 s, ask whether this instance is still
    // the editor, so a takeover elsewhere shows up promptly even while idle
    window.setInterval(() => {
      if (!account.user || !account.editToken || store.fenced) return;
      void account
        .editSessionActive()
        .then((active) => {
          if (!active) store.enterFenced();
        })
        .catch(() => {});
    }, 30000);
    window.setInterval(() => void this.beat(), HERE_EVERY_MS);
    // live viewers (L5): while watched, the waves' work reaches them every few seconds
    window.setInterval(() => {
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (this.watched && this.id && account.user && !store.fenced && !hidden) {
        store.markDirty(this.id, 1e9);
        void store.flush(this.id);
      }
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
        if (away > CATCHUP.minGapMin * 60000) void this.reloadBound();
        else void this.beat();
      });
    }
  }

  // the store's save status, for the settings panel
  get state(): SyncState {
    return this.store.state;
  }
  get savedAt(): number {
    return this.store.savedAt;
  }
  get dropped(): number {
    return this.store.dropped;
  }
  get fenced(): boolean {
    return this.store.fenced;
  }
  /** a beach (any of yours) has changes not saved yet */
  get pending(): boolean {
    return this.store.hasPendingSaves();
  }
  onState(fn: (s: SyncState) => void): void {
    this.store.onState(fn);
  }

  /** The worker has another beach now (null: none). */
  onBound(fn: (id: string | null) => void): void {
    this.boundListeners.push(fn);
  }

  /** A saved beach of yours was bound with what the server has (for "while you were away"). */
  onLoaded(fn: (id: string) => void): void {
    this.loadedListeners.push(fn);
  }

  /** The bound beach changed on the server while this app wasn't simulating it, and the worker has the new one. */
  onChangedElsewhere(fn: (id: string) => void): void {
    this.changedListeners.push(fn);
  }

  /** Something changed on the bound beach: save it soon. */
  markDirty(delayMs?: number): void {
    if (this.id) this.store.markDirty(this.id, delayMs);
  }

  /** Save the bound beach now (if it changed). */
  flush(keepalive = false): Promise<void> {
    return this.id ? this.store.flush(this.id, keepalive) : Promise.resolve();
  }

  private run(work: () => Promise<void>): Promise<void> {
    const p = this.queue.then(work, work);
    this.queue = p.catch(() => {});
    return p;
  }

  /**
   * Put this beach in the worker (null: none). The beach that was there goes
   * back to the store, sand and undo history, under its own id. A newer bind
   * asked while this one loads wins.
   *
   * `adoptLocal`: a first sign-in onto a beach with nothing saved keeps the
   * (local) beach you were already playing on.
   */
  bind(ref: BeachRef | null, opts: { adoptLocal?: boolean } = {}): Promise<void> {
    const want = ref?.id ?? null;
    if (want === this.wanted) return this.queue;
    this.wanted = want;
    return this.run(async () => {
      if (this.wanted !== want || want === this.id) return;
      const st = ref ? await this.store.load(ref) : null;
      if (this.wanted !== want) return; // a newer bind asked meanwhile
      if (ref && !st) {
        // offline (or unreadable): keep what's in the worker, try again on the next ask
        this.wanted = this.id;
        return;
      }
      const old = this.id;
      let leaving: (Sand & { history?: UndoHistory }) | null = null;
      if (old) {
        leaving = await this.host.read(true);
        this.store.checkin(old, leaving);
      }
      this.id = null;
      this.watched = false;
      if (!ref || !st) {
        for (const fn of this.boundListeners) fn(null);
        return;
      }
      if (st.fresh && opts.adoptLocal && old === LOCAL_BEACH && leaving) {
        this.store.put(ref, { delta: leaving.delta.slice(), objects: leaving.objects.map((o) => ({ ...o })), ...(leaving.cover ? { cover: leaving.cover.slice() } : {}) }, { dirty: true });
      }
      const sand = this.store.checkout(ref.id, { read: () => this.host.read(false) });
      if (!sand) return;
      this.host.write(sand);
      this.id = ref.id;
      for (const fn of this.boundListeners) fn(ref.id);
      if (ref.owned && ref.id !== LOCAL_BEACH && !st.fresh) {
        this.store.settle();
        for (const fn of this.loadedListeners) fn(ref.id);
      }
      void this.beat();
    });
  }

  /**
   * Someone else signed in (or out): forget every beach of the last person.
   * The sand in the worker carries on as this device's own beach (`local`):
   * a first sign-in onto a beach with nothing saved keeps it.
   */
  resetToLocal(): Promise<void> {
    this.wanted = LOCAL_BEACH;
    return this.run(async () => {
      // (its undo history stays behind: it was the last person's)
      const sand = await this.host.read(true);
      this.store.reset();
      const was = this.id;
      this.store.put({ id: LOCAL_BEACH, owned: true }, { delta: sand.delta, objects: sand.objects, ...(sand.cover ? { cover: sand.cover } : {}) });
      this.store.checkout(LOCAL_BEACH, { read: () => this.host.read(false) });
      this.id = LOCAL_BEACH;
      this.watched = false;
      if (was !== LOCAL_BEACH) for (const fn of this.boundListeners) fn(LOCAL_BEACH);
    });
  }

  /** Tell the server this app has the bound beach open; reload it if it moved on meanwhile. */
  private async beat(): Promise<void> {
    const id = this.id;
    const a = this.account;
    if (!a?.user || !id || id === LOCAL_BEACH || this.store.fenced || (typeof document !== 'undefined' && document.hidden)) return;
    let r: { epoch: number; watched?: boolean } | null;
    try {
      r = await a.here(id);
    } catch {
      return; // offline: the next beat tries again
    }
    if (id !== this.id) return;
    this.watched = !!r?.watched;
    const st = this.store.peek(id);
    if (r && st && r.epoch > (st.epoch ?? 0)) await this.reloadBound();
  }

  /** Load the bound beach again from the server (it moved on there). */
  private reloadBound(): Promise<void> {
    return this.run(async () => {
      const id = this.id;
      const st = id ? this.store.peek(id) : undefined;
      if (!id || !st || id === LOCAL_BEACH || !this.account?.user) return;
      await this.store.reload({ id, code: st.code, owned: st.owned }, true);
      void this.beat();
    });
  }

  /**
   * Take editing back here: claim a fresh token (fencing the other
   * instances), then reload the bound beach — they may have changed it.
   */
  async takeOver(): Promise<void> {
    if (!this.account?.user) return;
    await this.account.claimEditSession();
    this.store.unfence();
    await this.reloadBound();
  }

  /** A new sign-in (or tab, or device) takes over editing here. */
  async claim(): Promise<void> {
    if (!this.account?.user) return;
    try {
      await this.account.claimEditSession();
      this.store.unfence();
    } catch {
      /* offline: the save will say offline, not fenced */
    }
  }
}
