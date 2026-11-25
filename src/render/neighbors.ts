import type { Ray } from '@babylonjs/core/Culling/ray';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';

import { SIM_HZ, WORLD_SIZE_X, type GridSpec } from '../config';
import type { CameraController } from '../input/cameraController';
import { pickHeightfield } from '../input/sandPicker';
import type { Account, MyBeach, Neighbors, ShoreBeach, Side } from '../net/account';
import { ApiError, NeighborApi } from '../net/account';
import { countItems } from '../net/beachSync';
import { reportError } from '../net/telemetry';
import type { Palette } from '../palette';
import { BeachSim, type BrushMode } from '../sim/beachSim';
import { applyRockCover, type PlacedObject } from '../sim/objects';
import { decodeSand, encodeSand, fitWorld, resampleField } from '../sim/sandCodec';
import type { Swell } from '../sim/waves';
import { beachById } from '../world/locations';
import { BeachRenderer, ORIGIN_Z } from './beachRenderer';
import { ObjectView } from './objects';
import { boundaryLinked, nearestShoreIndex, shoreLayout, UNLINKED_STEP, windowBeachCenters } from './shoreSpacing';
import { placeTag } from '../ui/tagPlace';
import { isViewingMode, orderInfoRows, ShoreInfo } from '../ui/shoreInfo';
/** how far down the shore to load at first, each way */
const DEPTH = 6;
/** load more of the shore when the view gets this close to the end of what's loaded */
const AHEAD = 3;
/** how many more to load at a time */
const PAGE = 6;
/** beaches drawn either side of the one you're looking at */
const RENDER = 2;
/** beaches kept in memory (decoded) either side of it */
const KEEP = 5;
/** how often to look for new saves along the shore */
const POLL_MS = 30000;
/** debounce before saving an edited adjacent beach */
const EDIT_SAVE_MS = 4000;

export interface OwnedPick {
  x: number;
  y: number;
  z: number;
  index: number;
  beachId: string;
  offsetX: number;
}

interface Loaded {
  /** display delta (sand minus rest, with rock cover baked in) */
  delta: Float32Array;
  /** un-baked delta and cover kept for owned beaches so BeachSim can edit them losslessly */
  rawDelta?: Float32Array;
  rawCover?: Float32Array;
  epoch?: number;
  objects: PlacedObject[];
  updatedAt: number | null;
}

interface Slot {
  renderer: BeachRenderer;
  objects: ObjectView;
  label: HTMLDivElement;
  yours: HTMLSpanElement;
  star: HTMLButtonElement;
  /** "ask to be neighbors", on beaches at the end of a stretch */
  ask: HTMLButtonElement;
  /** "leave something" (docs/INBOX_NOTIFICATIONS.md), on beaches that aren't yours */
  leave: HTMLButtonElement;
}

/** One beach along the shore. Index 0 is yours (or the one you're visiting); +1 is the next one on the left, and so on. */
interface Entry {
  index: number;
  beach: ShoreBeach;
  data?: Loaded;
  /** a load is in flight */
  loading?: Promise<void>;
  slot?: Slot;
  /** lazy simulation for editing an owned beach directly in the shore view */
  sim?: BeachSim;
  dirty?: boolean;
  editRevision?: number;
  saveTimer?: number;
  saving?: Promise<void> | null;
  editAcc?: number;
  /** live drag preview override for one object on this beach */
  dragPreview?: { id: number; x: number; y: number } | null;
}

/**
 * The shore: your beach in the middle, your neighbors either side, their
 * neighbors beyond them, and so on (following each beach's left / right
 * neighbor), as far as anyone has linked up. Walk or pan along it; the
 * beaches near the view are drawn as snapshots of their last save (their
 * sand and things, your sky, sea and tide), the rest load as you get close.
 *
 * Any of your own beaches visible along the shore can be edited directly:
 * writes are simulated locally and saved automatically to that beach's ID.
 *
 * You can also visit anyone's beach by code: their beach takes the middle,
 * with their shore either side, until you head home.
 *
 * Facing the sea, "left" is world +X (your right hand points to -X).
 */
export class NeighborView {
  readonly api: NeighborApi;
  /** your own neighbor slots and code (for the settings panel) */
  state: Neighbors | null = null;
  /** the beach you're visiting (by code), or null when at home */
  visiting: ShoreBeach | null = null;
  /** "⌂ my beach" from the viewing-mode info card */
  onHome?: () => void;
  /** fired when an edited owned neighbor's items or save state change */
  onOwnedChanged?: () => void;
  /** fired when saving an edited owned neighbor hits a terminal error or external restore */
  onSaveError?: (kind: 'tooBig' | 'outdated' | 'restored') => void;
  /** the visitor card for a beach (set by main once accounts exist); unset: no button */
  onLeave?: (b: ShoreBeach) => void;
  readonly favorites = new Map<string, ShoreBeach>();
  private entries = new Map<number, Entry>();
  /** world-X centre of each entry (linked neighbours touch, the rest keep the diorama gap) */
  private pos = new Map<number, number>();
  private tide = 0;
  private listeners: ((n: Neighbors | null) => void)[] = [];
  private favListeners: (() => void)[] = [];
  /** bumps on every refresh/clear so a slow, older refresh can't overwrite a newer one */
  private generation = 0;
  private chairView = false;
  private pollTimer = 0;
  private win: [number, number] = [0, 0];
  /** the viewing-mode info control: the "i" button and its card */
  private readonly shoreInfo: ShoreInfo;
  /** a direction where the whole world has been walked (the shore came round) */
  private exhausted = new Set<Side>();
  private paging = new Set<Side>();
  private lastUpdateAt = 0;
  private brushIndex: number | null = null;
  private paintBuf: Float32Array | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly grid: GridSpec,
    private readonly rest: Float32Array,
    private readonly swell: Swell,
    private readonly cam: CameraController,
    private readonly uiRoot: HTMLElement,
    private readonly account: Account,
    private readonly ownRenderer?: BeachRenderer,
    private readonly seed = 1,
  ) {
    this.api = new NeighborApi(account);
    this.shoreInfo = new ShoreInfo(uiRoot, { onHome: () => this.onHome?.() });
  }

  onChange(fn: (n: Neighbors | null) => void): void {
    this.listeners.push(fn);
  }

  onFavorites(fn: () => void): void {
    this.favListeners.push(fn);
  }

  /** World-X centre of the beach at a shore index (0 = the middle one). */
  xFor(index: number): number {
    return this.pos.get(index) ?? index * UNLINKED_STEP;
  }

  /** The shore index whose beach is nearest to a world-X point (0 is always at x = 0). */
  nearestIndex(x: number): number {
    return nearestShoreIndex(x, this.entries.keys(), this.pos);
  }

  /** World-X centres of the drawn beaches, left to right (includes index 0 when in view). */
  windowCenters(): number[] {
    return windowBeachCenters(this.win, (i) => this.entries.has(i), this.pos);
  }

  /** Recompute every entry's centre from the entries' `linked` flags, rebuilding any slot that moved. */
  private relayout(): void {
    this.pos = shoreLayout([...this.entries.values()].map((e) => ({ index: e.index, linked: e.beach.linked })));
    for (const e of this.entries.values()) {
      if (e.slot && e.slot.renderer.offsetX !== this.xFor(e.index)) this.dropSlot(e);
    }
    this.syncSeams();
  }

  /** Link adjacent rendered beaches along linked-neighbour boundaries so sand, water and waves blend seamlessly. */
  private syncSeams(): void {
    const active = new Map<number, BeachRenderer>();
    if (this.ownRenderer && this.ownVisible) active.set(0, this.ownRenderer);
    for (const e of this.entries.values()) {
      if (e.slot) active.set(e.index, e.slot.renderer);
    }
    const isLinked = (k: number) => this.entries.get(k)?.beach.linked === true;
    for (const [i, r] of active) {
      const neg = boundaryLinked(i - 1, isLinked) ? active.get(i - 1) ?? null : null;
      const pos = boundaryLinked(i, isLinked) ? active.get(i + 1) ?? null : null;
      r.setNeighbors(neg, pos);
    }
    if (this.ownRenderer && !active.has(0)) this.ownRenderer.setNeighbors(null, null);
  }

  /** The beaches currently drawn, as shore indices [from, to] (0 = the middle one). */
  get window(): [number, number] {
    return this.win;
  }

  /** If this shore beach belongs to the signed-in player, return their MyBeach record. */
  ownedBeach(b: ShoreBeach): MyBeach | undefined {
    return this.account.beaches.find((m) => m.code === b.code);
  }

  /** Is your own (live) beach in view? False while visiting or far down the shore. */
  get ownVisible(): boolean {
    return !this.visiting && this.win[0] <= 0 && this.win[1] >= 0;
  }

  /** Is *any* of your own beaches currently drawn in the window? */
  get anyOwnVisible(): boolean {
    if (this.ownVisible) return true;
    for (const e of this.entries.values()) {
      if (e.slot && this.ownedBeach(e.beach)) return true;
    }
    return false;
  }

  /** Shore index of one of your beaches if it's on the current shore (0 = live center), else null. */
  indexOfBeach(beachId: string): number | null {
    if (!this.visiting && this.account.beachId === beachId) return 0;
    for (const e of this.entries.values()) {
      if (this.ownedBeach(e.beach)?.id === beachId) return e.index;
    }
    return null;
  }

  /** Viewing mode: looking at someone else's stretch of shore. No floating name tags. */
  get viewing(): boolean {
    return isViewingMode(!!this.visiting, this.anyOwnVisible);
  }

  /** Point at the "i" button: the viewer tried to dig on someone else's beach. */
  nudgeInfo(): void {
    this.shoreInfo.nudge();
  }

  /** How many beaches the shore has each way (for tests and the UI). */
  get extent(): { left: number; right: number } {
    let left = 0;
    let right = 0;
    for (const i of this.entries.keys()) {
      left = Math.max(left, i);
      right = Math.max(right, -i);
    }
    return { left, right };
  }

  /** The beach at a shore index, if there is one. */
  beachAt(index: number): ShoreBeach | null {
    return this.entries.get(index)?.beach ?? null;
  }

  /** Reload your neighbors and the shore (from you, or from the beach you're visiting). */
  refresh(): Promise<void> {
    const gen = ++this.generation;
    const p: Promise<void> = Promise.resolve().then(() => this.doRefresh(gen, p));
    this.latest = p;
    return p;
  }

  /** the newest refresh: an older one that's overtaken waits for it, so callers see fresh data */
  private latest: Promise<void> = Promise.resolve();

  private async doRefresh(gen: number, mine: Promise<void>): Promise<void> {
    const signedIn = !!this.account.user;
    const [n, shore] = await Promise.all([
      signedIn ? this.api.get().catch(() => null) : Promise.resolve(null),
      this.api.shore(this.visiting?.code ?? null, DEPTH).catch(() => null),
    ]);
    if (gen !== this.generation) return this.latest === mine ? undefined : this.latest;
    if (signedIn !== !!this.account.user) return;
    if (!shore) {
      // Keep the loaded shore and its pending edits through a network failure.
      this.schedulePoll();
      return;
    }
    // signed into the account that owns the beach you were visiting: hand back control of it
    if (signedIn && this.visiting && shore.center?.you) {
      this.visiting = null;
      this.clearEntries();
      await this.doRefresh(gen, mine);
      return;
    }
    if (n || !signedIn) this.state = n;
    const next = new Map<number, ShoreBeach>();
    if (this.visiting && shore.center) {
      next.set(0, shore.center);
      this.visiting = shore.center;
    }
    shore.left.forEach((b, i) => next.set(i + 1, b));
    shore.right.forEach((b, i) => next.set(-(i + 1), b));
    // beaches loaded further out by scrolling stay, unless the shore near the middle changed
    const changed = [...next].some(([i, b]) => this.entries.has(i) && this.entries.get(i)!.beach.code !== b.code);
    const reach = { left: shore.left.length, right: shore.right.length };
    for (const [i, e] of this.entries) {
      const beyond = i > 0 ? i > reach.left : i < 0 && -i > reach.right;
      if (beyond && !changed && (i > 0 ? reach.left >= DEPTH : reach.right >= DEPTH)) continue;
      const b = next.get(i);
      if (!b || b.code !== e.beach.code) this.forget(i);
    }
    if (changed) this.exhausted.clear();
    if (shore.left.length < DEPTH) this.exhausted.add('left');
    if (shore.right.length < DEPTH) this.exhausted.add('right');
    for (const [i, b] of next) {
      const e = this.entries.get(i);
      if (e) {
        e.beach = b;
        // a newer save: fetch it again when it's near the view (never clobber unsaved local edits)
        if (e.data && e.data.updatedAt !== b.updatedAt && !e.dirty && !e.saving) {
          e.data = { ...e.data, updatedAt: -1 };
        }
        if (e.slot) e.slot.label.querySelector('.name')!.textContent = this.title(b);
      } else {
        this.entries.set(i, { index: i, beach: b });
      }
    }
    this.updateBounds();
    for (const en of this.entries.values()) {
      this.paintStar(en);
      this.paintAsk(en);
      this.paintLeave(en);
    }
    for (const fn of this.listeners) fn(this.state);
    this.schedulePoll();
    await this.fillWindow(true);
  }

  /** Another of your beaches is now this device's: show its stretch of shore. */
  async recentre(): Promise<void> {
    this.visiting = null;
    this.clearEntries();
    await this.refresh();
  }

  /** Visit anyone's beach by code (null: go home). Throws if there's no such beach. */
  async visit(code: string | null): Promise<void> {
    if (code) {
      const shore = await this.api.shore(code, 0); // check it exists first
      if (!shore.center) throw new Error('could not find that beach');
      if (shore.center.you) code = null;
      else {
        this.clearEntries();
        this.visiting = shore.center;
      }
    }
    if (!code) {
      if (!this.visiting) return;
      this.visiting = null;
      this.clearEntries();
    }
    await this.refresh();
  }

  async loadFavorites(): Promise<void> {
    try {
      const list = await this.api.favorites();
      this.favorites.clear();
      for (const f of list) this.favorites.set(f.code, f);
    } catch {
      /* offline: keep what we had */
    }
    this.favChanged();
  }

  async toggleFavorite(b: ShoreBeach): Promise<void> {
    await this.setFavorite(b, !this.favorites.has(b.code));
  }

  /** Star (or un-star) a beach. Saying the same twice is fine. */
  async setFavorite(b: ShoreBeach, on: boolean): Promise<void> {
    if (on) this.favorites.set(b.code, b);
    else this.favorites.delete(b.code);
    this.favChanged();
    try {
      await this.api.favorite(b.code, on);
    } catch (e) {
      await this.loadFavorites();
      throw e;
    }
  }

  private favChanged(): void {
    for (const e of this.entries.values()) if (e.slot) this.paintStar(e);
    for (const fn of this.favListeners) fn();
  }

  private schedulePoll(): void {
    window.clearTimeout(this.pollTimer);
    this.pollTimer = window.setTimeout(() => void this.poll().finally(() => this.schedulePoll()), POLL_MS);
  }

  /** Look for new saves along the shore (skipped while the app is in the background). */
  async poll(): Promise<void> {
    if (document.hidden) return;
    await this.refresh();
  }

  /** What's drawn next door (for tests): left = index 1, right = index -1. */
  snapshot(side: Side | number): { who: string; updatedAt: number | null; objects: number } | null {
    const e = this.entries.get(typeof side === 'number' ? side : side === 'left' ? 1 : -1);
    if (!e?.data) return null;
    return { who: e.beach.code, updatedAt: e.data.updatedAt, objects: e.data.objects.length };
  }

  clear(): void {
    this.generation++;
    // (no newer refresh to wait for: an overtaken one just stops)
    this.latest = Promise.resolve();
    window.clearTimeout(this.pollTimer);
    // first: close the info card, so its tags are back on the root before
    // their slots drop them
    this.shoreInfo.setVisible(false);
    this.clearEntries();
    this.visiting = null;
    this.state = null;
    this.favorites.clear();
    this.updateBounds();
    for (const fn of this.listeners) fn(null);
    this.favChanged();
  }

  private clearEntries(): void {
    for (const i of [...this.entries.keys()]) this.forget(i);
    this.win = [0, 0];
    this.exhausted.clear();
  }

  /** Near the end of what's loaded: fetch the next stretch of shore that way (infinite scroll). */
  private async more(dir: Side): Promise<void> {
    if (this.paging.has(dir) || this.exhausted.has(dir) || !this.entries.size) return;
    const { left, right } = this.extent;
    const last = dir === 'left' ? left : -right;
    const from = last === 0 ? (this.visiting?.code ?? this.state?.code) : this.entries.get(last)?.beach.code;
    if (!from) return;
    this.paging.add(dir);
    const gen = this.generation;
    try {
      const got = await this.api.shoreMore(from, dir, PAGE);
      if (gen !== this.generation) return;
      const known = new Set([...this.entries.values()].map((e) => e.beach.code));
      if (this.state?.code && !this.visiting) known.add(this.state.code);
      let i = last;
      for (const b of got) {
        if (known.has(b.code)) {
          // came all the way round the world
          this.exhausted.add(dir);
          break;
        }
        i += dir === 'left' ? 1 : -1;
        this.entries.set(i, { index: i, beach: b });
      }
      if (got.length < PAGE) this.exhausted.add(dir);
      this.updateBounds();
    } catch {
      /* offline: try again when the view moves */
    } finally {
      this.paging.delete(dir);
    }
  }

  setChairView(on: boolean): void {
    this.chairView = on;
    for (const e of this.entries.values()) e.slot?.renderer.setChairView(on);
  }

  private forget(i: number): void {
    const e = this.entries.get(i);
    if (!e) return;
    if (e.saveTimer) {
      window.clearTimeout(e.saveTimer);
      e.saveTimer = 0;
    }
    if (e.dirty && e.sim) void this.saveEntry(e, false);
    this.dropSlot(e);
    this.entries.delete(i);
  }

  private updateBounds(): void {
    this.relayout();
    const half = WORLD_SIZE_X / 2;
    const { left, right } = this.extent;
    this.cam.maxX = this.xFor(left) + half;
    this.cam.minX = this.xFor(-right) - half;
  }

  private title(b: ShoreBeach): string {
    const place = b.location ? beachById(b.location) : undefined;
    return `${b.name || 'a neighbor'}${place ? ` · ${place.name}` : ''}`;
  }

  // ------------------------------------------------------------ loading and drawing

  /** Draw the beaches near the view, load the ones about to come into view, let go of far ones. */
  private async fillWindow(wait = false): Promise<void> {
    const c = this.nearestIndex(this.cam.focusX);
    const { left, right } = this.extent;
    const lo = Math.max(-right, c - RENDER);
    const hi = Math.min(left, c + RENDER);
    this.win = [lo, hi];
    const pending: Promise<void>[] = [];
    for (const e of this.entries.values()) {
      const d = Math.abs(e.index - c);
      if (e.index >= lo && e.index <= hi) {
        if (!e.data || e.data.updatedAt === -1) pending.push(this.load(e));
        else if (!e.slot) this.makeSlot(e);
      } else {
        this.dropSlot(e);
        if (d > KEEP && !e.dirty && !e.saving) {
          e.data = undefined;
          e.sim = undefined;
        }
      }
    }
    if (wait) await Promise.all(pending);
  }

  private load(e: Entry): Promise<void> {
    // already fetching: if that turns out older than the newest save we know
    // of, fetch once more when it lands
    if (e.loading) return e.loading.then(() => (e.data && e.data.updatedAt !== e.beach.updatedAt && !e.dirty ? this.fetch(e) : undefined));
    return this.fetch(e);
  }

  private fetch(e: Entry): Promise<void> {
    if (e.loading) return e.loading;
    if (e.dirty || e.saving) return Promise.resolve();
    e.loading = (async () => {
      const mine = this.ownedBeach(e.beach);
      const saved = mine
        ? await this.account.loadBeach(mine.id).catch(() => undefined)
        : e.beach.location
          ? await this.api.beachByCode(e.beach.code).catch(() => null)
          : null;
      // A 404 means the owned beach has no saved sand. Other errors must leave it alone.
      if (saved === undefined) return;
      let delta: Float32Array = new Float32Array(this.grid.nx * this.grid.ny);
      let rawDelta: Float32Array | undefined;
      let rawCover: Float32Array | undefined;
      let objects: PlacedObject[] = [];
      if (saved) {
        try {
          const d = fitWorld(await decodeSand(saved.bytes));
          delta = resampleField(d.delta, d.nx, d.ny, this.grid.nx, this.grid.ny);
          objects = d.objects;
          if (mine) rawDelta = delta.slice();
          if (d.cover) {
            const cover = resampleField(d.cover, d.nx, d.ny, this.grid.nx, this.grid.ny);
            if (mine) rawCover = cover.slice();
            applyRockCover(delta, this.rest, this.grid.nx, this.grid.ny, this.grid.dx, objects, cover);
          }
        } catch {
          if (mine) return; // Never make an unreadable owned save editable as an empty beach.
        }
      } else if (mine) {
        rawDelta = delta.slice();
      }
      if (this.entries.get(e.index) !== e || e.dirty || e.saving) return; // the shore changed or user started editing
      e.data = {
        delta,
        ...(rawDelta ? { rawDelta } : {}),
        ...(rawCover ? { rawCover } : {}),
        ...(saved?.epoch !== undefined ? { epoch: saved.epoch } : mine ? { epoch: 0 } : {}),
        objects,
        updatedAt: saved?.updatedAt ?? e.beach.updatedAt,
      };
      if (e.sim) e.sim.loadDelta(rawDelta ?? delta, objects, rawCover);
      if (e.slot) this.repaint(e);
      else if (e.index >= this.win[0] && e.index <= this.win[1]) this.makeSlot(e);
    })().finally(() => (e.loading = undefined));
    return e.loading;
  }

  private makeSlot(e: Entry): void {
    if (!e.data || e.slot) return;
    const x = this.xFor(e.index);
    const renderer = new BeachRenderer(this.scene, this.grid, this.rest, this.swell, x);
    renderer.setChairView(this.chairView);
    const objects = new ObjectView(this.scene, renderer, x);
    const label = document.createElement('div');
    label.className = 'neighbor-tag';
    label.innerHTML = `<span class="name"></span>`;
    label.querySelector('.name')!.textContent = this.title(e.beach);
    const yours = document.createElement('span');
    yours.className = 'yours';
    yours.textContent = 'yours';
    yours.hidden = true;
    label.appendChild(yours);
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'fav';
    star.addEventListener('click', () => void this.toggleFavorite(e.beach).catch(() => {}));
    label.appendChild(star);
    const ask = document.createElement('button');
    ask.type = 'button';
    ask.className = 'ask';
    ask.hidden = true;
    ask.addEventListener('click', () => void this.askFromTag(e));
    label.appendChild(ask);
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'leave';
    leave.dataset.act = `leave-${e.beach.code}`;
    leave.textContent = 'leave something';
    leave.addEventListener('click', () => this.onLeave?.(e.beach));
    label.appendChild(leave);
    this.uiRoot.appendChild(label);
    e.slot = { renderer, objects, label, yours, star, ask, leave };
    this.paintStar(e);
    this.paintAsk(e);
    this.paintLeave(e);
    this.repaint(e);
    this.syncSeams();
  }

  /** one of your own beaches (your home code, or any of your other beaches) */
  private isMine(code: string): boolean {
    return code === this.state?.code || this.account.beaches.some((b) => b.code === code);
  }

  private paintStar(e: Entry): void {
    if (!e.slot) return;
    const mine = !!this.ownedBeach(e.beach);
    e.slot.yours.hidden = !mine;
    e.slot.star.hidden = !this.account.user || mine;
    const on = this.favorites.has(e.beach.code);
    e.slot.star.textContent = on ? '★' : '☆';
    e.slot.star.classList.toggle('on', on);
    e.slot.star.setAttribute('aria-label', on ? 'Remove from favorites' : 'Add to favorites');
    e.slot.star.title = e.slot.star.getAttribute('aria-label')!;
  }

  /**
   * Which side of *your* beach this beach could join, if it's at the end of a
   * stretch of shore (a free side, as the walk shows it) and your matching
   * side is free too. Index > 0 runs left from the middle, < 0 right; `linked`
   * is a beach's link to the one before it (nearer the middle).
   */
  askSide(e: Entry): Side | null {
    if (this.visiting || !this.state || e.index === 0) return null;
    if (this.account.beaches.some((b) => b.code === e.beach.code)) return null;
    const i = e.index;
    const unlinked = (j: number) => {
      const x = this.entries.get(j);
      return !!x && x.beach.linked === false;
    };
    // their free sides, from the gaps either side of them
    const free: Side[] = [];
    if (i > 0) {
      if (unlinked(i)) free.push('right');
      if (unlinked(i + 1)) free.push('left');
    } else {
      if (unlinked(i)) free.push('left');
      if (unlinked(i - 1)) free.push('right');
    }
    for (const theirs of free) {
      // their free left means you'd sit on their left: they'd be on your right
      const mine: Side = theirs === 'left' ? 'right' : 'left';
      if (!this.state[mine] && !this.state.asked[mine]) return mine;
    }
    return null;
  }

  /** "leave something": on beaches that aren't yours, once the app has a visitor card */
  private paintLeave(e: Entry): void {
    if (!e.slot) return;
    e.slot.leave.hidden = !this.onLeave || this.isMine(e.beach.code);
  }

  private paintAsk(e: Entry): void {
    if (!e.slot) return;
    const side = this.askSide(e);
    e.slot.ask.hidden = !side;
    if (side) {
      e.slot.ask.textContent = 'ask to be neighbors';
      e.slot.ask.disabled = false;
      e.slot.ask.title = `Ask ${e.beach.name || 'them'} to move in on your ${side}`;
    }
  }

  private async askFromTag(e: Entry): Promise<void> {
    const side = this.askSide(e);
    const s = e.slot;
    if (!side || !s) return;
    s.ask.disabled = true;
    try {
      const r = await this.api.set(side, e.beach.code);
      s.ask.textContent = r.status === 'linked' ? 'neighbors now' : 'asked ✓';
      await this.refresh();
    } catch (err) {
      s.ask.textContent = (err as Error).message || 'could not ask';
    }
  }

  private dropSlot(e: Entry): void {
    if (!e.slot) return;
    e.slot.objects.dispose();
    e.slot.renderer.dispose();
    e.slot.label.remove();
    e.slot = undefined;
    this.syncSeams();
  }

  private repaint(e: Entry): void {
    const s = e.slot;
    const d = e.data;
    if (!s || !d) return;
    const preview = e.dragPreview;
    const objs = preview
      ? d.objects.map((o) => (o.id === preview.id ? { ...o, x: preview.x, y: preview.y } : o))
      : d.objects;
    s.objects.setStatic(objs, (x, y) => this.heightAt(d.delta, x, y) + (preview && Math.abs(x - preview.x) < 1e-4 && Math.abs(y - preview.y) < 1e-4 ? 0.12 : 0));
    this.paint(s.renderer, d.delta);
  }

  /** Sync an entry's display `data` from its active local `BeachSim` and redraw its slot. */
  private syncFromSim(e: Entry): void {
    const sim = e.sim;
    if (!sim || !e.data) return;
    const n = this.grid.nx * this.grid.ny;
    if (e.data.delta.length !== n) e.data.delta = new Float32Array(n);
    const delta = e.data.delta;
    const sand = sim.sand;
    const rest = this.rest;
    for (let k = 0; k < n; k++) delta[k] = sand[k] - rest[k];
    e.data.objects = sim.objects.persisted();
    if (e.slot) this.repaint(e);
  }

  /** Lazily spin up a local BeachSim for an owned neighbor entry so it can be edited directly. */
  private ensureSim(e: Entry): BeachSim | null {
    if (!this.ownedBeach(e.beach) || !e.data) return null;
    if (!e.sim) {
      e.sim = new BeachSim(this.grid, this.seed, {
        waves: false,
        tide: false,
        erosion: false,
        healing: false,
        seep: false,
      });
      e.sim.loadDelta(e.data.rawDelta ?? e.data.delta, e.data.objects, e.data.rawCover);
      e.editAcc = 0;
    }
    return e.sim;
  }

  private entryByBeachId(beachId: string): Entry | null {
    for (const e of this.entries.values()) {
      if (this.ownedBeach(e.beach)?.id === beachId) return e;
    }
    return null;
  }

  /** Raycast against all currently drawn *owned* neighbor beaches; returns the closest hit. */
  pickOwned(ray: Ray): OwnedPick | null {
    let best: OwnedPick | null = null;
    let bestD2 = Infinity;
    const o = ray.origin;
    const maxZ = this.grid.ny * this.grid.dx;
    for (const e of this.entries.values()) {
      if (!e.slot || !e.data) continue;
      if (e.index === 0 && !this.visiting) continue;
      const mine = this.ownedBeach(e.beach);
      if (!mine) continue;
      const ox = this.xFor(e.index);
      const delta = e.data.delta;
      const hit = pickHeightfield(ray, this.grid.dx, (x, z) => {
        const sx = x - ox + WORLD_SIZE_X / 2;
        const sy = z - ORIGIN_Z;
        if (sx < 0 || sx > WORLD_SIZE_X || sy < 0 || sy > maxZ) return NaN;
        return this.heightAt(delta, sx, sy);
      });
      if (!hit) continue;
      const d2 = (hit.x - o.x) ** 2 + (hit.y - o.y) ** 2 + (hit.z - o.z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { ...hit, index: e.index, beachId: mine.id, offsetX: ox };
      }
    }
    return best;
  }

  /** Object under sim coordinates (sx, sy) on an owned neighbor entry. */
  ownedObjectAt(index: number, sx: number, sy: number): PlacedObject | null {
    const e = this.entries.get(index);
    if (!e?.data || !this.ownedBeach(e.beach)) return null;
    let best: PlacedObject | null = null;
    let bestD = Infinity;
    for (const o of e.data.objects) {
      const reach = o.kind === 'driftwood' ? o.size * 0.5 : Math.max(0.22, Math.min(1, o.size) * 0.9);
      const d = Math.hypot(o.x - sx, o.y - sy);
      if (d < reach && d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  hasOwnedObject(index: number, id: number): boolean {
    const e = this.entries.get(index);
    return !!e?.data && !!this.ownedBeach(e.beach) && e.data.objects.some((obj) => obj.id === id);
  }

  /** Non-wild object count on an owned neighbor entry (for MAX_OBJECTS check). */
  ownedCount(index: number): number {
    const e = this.entries.get(index);
    if (!e?.data) return 0;
    return e.data.objects.filter((o) => !o.wild).length;
  }

  /** Live item counts for an edited owned neighbor (null if not locally edited). */
  itemsOn(beachId: string): Record<string, number> | null {
    const e = this.entryByBeachId(beachId);
    if (!e?.sim) return null;
    return countItems(e.sim.objects.persisted());
  }

  /** Live brush stroke on an owned neighbor beach. */
  beginStroke(index: number, sx: number, sy: number, r: number, mode: BrushMode): void {
    const e = this.entries.get(index);
    if (!e) return;
    const sim = this.ensureSim(e);
    if (!sim) return;
    sim.beginStroke(sx, sy, r, mode);
    sim.stepEdit(1 / SIM_HZ);
    this.syncFromSim(e);
  }

  moveStroke(index: number, sx: number, sy: number, r: number): void {
    const e = this.entries.get(index);
    if (!e?.sim) return;
    e.sim.moveStroke(sx, sy, r);
  }

  endStroke(index: number): void {
    const e = this.entries.get(index);
    if (!e?.sim) return;
    e.sim.endStroke();
    this.syncFromSim(e);
    this.markOwnedDirty(e);
  }

  cancelStroke(index: number): void {
    const e = this.entries.get(index);
    if (!e?.sim) return;
    e.sim.cancelStroke();
    this.syncFromSim(e);
  }

  placeObject(index: number, obj: Omit<PlacedObject, 'id'>): PlacedObject | null {
    const e = this.entries.get(index);
    if (!e) return null;
    const sim = this.ensureSim(e);
    if (!sim) return null;
    const placed = sim.placeObject(obj);
    sim.stepEdit(1 / SIM_HZ);
    this.syncFromSim(e);
    this.markOwnedDirty(e);
    return placed;
  }

  moveObject(index: number, id: number, sx: number, sy: number): PlacedObject | null {
    const e = this.entries.get(index);
    if (!e) return null;
    const sim = this.ensureSim(e);
    if (!sim) return null;
    e.dragPreview = null;
    const moved = sim.moveObject(id, sx, sy);
    sim.stepEdit(1 / SIM_HZ);
    this.syncFromSim(e);
    this.markOwnedDirty(e);
    return moved;
  }

  removeObject(index: number, id: number): PlacedObject | null {
    const e = this.entries.get(index);
    if (!e) return null;
    const sim = this.ensureSim(e);
    if (!sim) return null;
    e.dragPreview = null;
    const removed = sim.removeObject(id);
    if (removed) {
      sim.stepEdit(1 / SIM_HZ);
      this.syncFromSim(e);
      this.markOwnedDirty(e);
    }
    return removed;
  }

  previewDrag(index: number, id: number | null, sx = 0, sy = 0): void {
    const e = this.entries.get(index);
    if (!e) return;
    e.dragPreview = id === null ? null : { id, x: sx, y: sy };
    if (e.slot) this.repaint(e);
  }

  canReplay(beachId: string, action: 'undo' | 'redo'): boolean {
    const history = this.entryByBeachId(beachId)?.sim?.undo;
    return !!history && (action === 'undo' ? history.undoCount : history.redoCount) > 0;
  }

  undo(beachId: string): boolean {
    const e = this.entryByBeachId(beachId);
    if (!e?.sim) return false;
    const ok = e.sim.undoStroke(true);
    if (ok) {
      e.sim.stepEdit(1 / SIM_HZ);
      this.syncFromSim(e);
      this.markOwnedDirty(e);
    }
    return ok;
  }

  redo(beachId: string): boolean {
    const e = this.entryByBeachId(beachId);
    if (!e?.sim) return false;
    const ok = e.sim.redoStroke(true);
    if (ok) {
      e.sim.stepEdit(1 / SIM_HZ);
      this.syncFromSim(e);
      this.markOwnedDirty(e);
    }
    return ok;
  }

  /** Smooth (reset) one of your visible neighbor beaches. */
  resetOwned(beachId: string): boolean {
    const e = this.entryByBeachId(beachId);
    if (!e) return false;
    const sim = this.ensureSim(e);
    if (!sim) return false;
    sim.resetBeach();
    this.syncFromSim(e);
    this.markOwnedDirty(e, 1500);
    return true;
  }

  totalUndoCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.sim) n += e.sim.undo.undoCount;
    return n;
  }

  totalRedoCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.sim) n += e.sim.undo.redoCount;
    return n;
  }

  /** Show the brush hover/active ring on one owned neighbor slot (or clear all with index = null). */
  setBrush(index: number | null, x: number, z: number, r: number, alpha: number, color: [number, number, number]): void {
    if (this.brushIndex !== null && this.brushIndex !== index) {
      this.entries.get(this.brushIndex)?.slot?.renderer.setBrush(0, 0, 1, 0, color);
    }
    this.brushIndex = index;
    if (index !== null) {
      this.entries.get(index)?.slot?.renderer.setBrush(x, z, r, alpha, color);
    }
  }

  /** Whether any edited owned neighbor beach has unsaved changes or an in-flight save. */
  hasPendingSaves(): boolean {
    for (const e of this.entries.values()) if (e.dirty || e.saving) return true;
    return false;
  }

  private markOwnedDirty(e: Entry, delayMs = EDIT_SAVE_MS): void {
    if (!this.account.user) return;
    e.dirty = true;
    e.editRevision = (e.editRevision ?? 0) + 1;
    this.onOwnedChanged?.();
    if (e.saveTimer) window.clearTimeout(e.saveTimer);
    e.saveTimer = window.setTimeout(() => void this.saveEntry(e, false), delayMs);
  }

  /** Flush all dirty edited owned neighbor beaches to the server. */
  async flushAll(keepalive = false): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const e of this.entries.values()) {
      if (e.dirty || e.saving) tasks.push(this.saveEntry(e, keepalive));
    }
    if (tasks.length) await Promise.all(tasks);
  }

  private async saveEntry(e: Entry, keepalive: boolean): Promise<void> {
    if (!this.account.user || !e.sim) return;
    const mine = this.ownedBeach(e.beach);
    if (!mine) return;
    if (e.saveTimer) {
      window.clearTimeout(e.saveTimer);
      e.saveTimer = 0;
    }
    while (e.saving) await e.saving;
    if (!e.dirty) return;
    const forUser = this.account.user.id;
    const sim = e.sim;
    const revision = e.editRevision;
    const p = (async () => {
      try {
        const delta = sim.sandDelta();
        const cover = sim.sandCover();
        const objects = sim.objects.persisted();
        const bytes = await encodeSand(delta, this.grid.nx, this.grid.ny, objects, cover);
        if (this.account.user?.id !== forUser) return;
        const items = countItems(objects);
        const loc = mine.location || e.beach.location || 'santa-monica';
        const updatedAt = await this.account.saveBeach(
          bytes,
          loc,
          this.grid.nx,
          this.grid.ny,
          keepalive,
          items,
          e.data?.epoch,
          mine.id,
        );
        e.dirty = e.editRevision !== revision;
        if (e.data) {
          e.data.updatedAt = updatedAt;
          e.data.rawDelta = delta;
          e.data.rawCover = cover;
        }
        e.beach.updatedAt = updatedAt;
        mine.updatedAt = updatedAt;
        mine.items = items;
        this.onOwnedChanged?.();
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          e.dirty = false;
          e.sim = undefined;
          e.data = undefined;
          void this.fetch(e);
          this.onSaveError?.('restored');
          return;
        }
        if (err instanceof ApiError && err.status === 426) {
          reportError('sync', err, { source: 'neighborEdit:save', meta: { status: 426 } });
          this.onSaveError?.('outdated');
          return;
        }
        if (err instanceof ApiError && err.status === 413) {
          reportError('sync', err, { source: 'neighborEdit:save', meta: { status: 413 } });
          this.onSaveError?.('tooBig');
          return;
        }
        reportError('sync', err, {
          source: 'neighborEdit:save',
          meta: err instanceof ApiError ? { status: err.status } : undefined,
        });
        e.saveTimer = window.setTimeout(() => void this.saveEntry(e, false), 30000);
      }
    })();
    e.saving = p;
    try {
      await p;
    } finally {
      e.saving = null;
    }
  }

  /** Sand height at a world point on a drawn beach along the shore, or NaN if it isn't on one. */
  heightAtWorld(x: number, z: number): number {
    let best: Entry | null = null;
    let bestData: Loaded | null = null;
    let bestD = Infinity;
    for (const e of this.entries.values()) {
      if (!e.data || (e.index === 0 && !this.visiting)) continue;
      const d = Math.abs(x - this.xFor(e.index));
      if (d <= WORLD_SIZE_X / 2 && d < bestD) {
        bestD = d;
        best = e;
        bestData = e.data;
      }
    }
    if (!best || !bestData) return NaN;
    const sx = x - this.xFor(best.index) + WORLD_SIZE_X / 2;
    const sy = z - ORIGIN_Z;
    if (sx < 0 || sx > WORLD_SIZE_X || sy < 0 || sy > this.grid.ny * this.grid.dx) return NaN;
    return this.heightAt(bestData.delta, sx, sy);
  }

  /** Their sand height at sim metres (bilinear). */
  private heightAt(delta: Float32Array, x: number, y: number): number {
    const { nx, ny, dx } = this.grid;
    const fi = Math.min(nx - 1.001, Math.max(0, x / dx - 0.5));
    const fj = Math.min(ny - 1.001, Math.max(0, y / dx - 0.5));
    const i = fi | 0;
    const j = fj | 0;
    const tx = fi - i;
    const ty = fj - j;
    const h = (k: number) => this.rest[k] + delta[k];
    const k = j * nx + i;
    return (h(k) * (1 - tx) + h(k + 1) * tx) * (1 - ty) + (h(k + nx) * (1 - tx) + h(k + nx + 1) * tx) * ty;
  }

  /** Pack their sand with still water at the current tide into a field frame. */
  private paint(r: BeachRenderer, delta: Float32Array): void {
    const n = this.grid.nx * this.grid.ny;
    if (!this.paintBuf || this.paintBuf.length !== n * 4) this.paintBuf = new Float32Array(n * 4);
    const buf = this.paintBuf;
    for (let k = 0, o = 0; k < n; k++, o += 4) {
      const sand = this.rest[k] + delta[k];
      const water = Math.max(0, this.tide - sand);
      buf[o] = sand;
      buf[o + 1] = water;
      buf[o + 2] = water > 0.004 ? 1 : Math.max(0, Math.min(0.8, 1 - (sand - this.tide) / 0.35));
      buf[o + 3] = 0;
    }
    r.showStatic(buf);
  }

  private readonly _projIn = new Vector3();
  private readonly _projOut = new Vector3();
  private keepOutCache: DOMRect[] = [];
  private keepOutAt = 0;

  /** Per frame: which beaches to draw, shared lighting/sea, animated neighbor waves, name tags. */
  update(p: Palette, camForward: Vector3, time: number, simTime: number, tide: number, amp: number): void {
    this.tide = tide;
    const now = performance.now();
    const dt = this.lastUpdateAt ? Math.min(0.1, (now - this.lastUpdateAt) / 1000) : 1 / 60;
    this.lastUpdateAt = now;
    // Step any owned neighbor currently being stroked or easing an undo/redo
    const stepDt = 1 / SIM_HZ;
    for (const e of this.entries.values()) {
      if (!e.sim || (!e.sim.strokeActive && !e.sim.easingActive)) continue;
      e.editAcc = (e.editAcc ?? 0) + dt;
      let stepped = false;
      let n = 0;
      while (e.editAcc >= stepDt && n < 2) {
        e.sim.stepEdit(stepDt);
        e.editAcc -= stepDt;
        n++;
        stepped = true;
      }
      if (n === 2) e.editAcc = 0;
      if (stepped) this.syncFromSim(e);
    }
    if (!this.entries.size) {
      this.win = [0, 0];
      this.syncSeams();
      this.shoreInfo.setVisible(false);
      return;
    }
    void this.fillWindow();
    this.syncSeams();
    // infinite scroll: keep the shore loaded a few beaches past the view
    const c = this.nearestIndex(this.cam.focusX);
    const ext = this.extent;
    if (ext.left - c < AHEAD) void this.more('left');
    if (ext.right + c < AHEAD) void this.more('right');
    let anySlot = false;
    for (const e of this.entries.values()) {
      if (e.slot) {
        anySlot = true;
        break;
      }
    }
    if (!anySlot) {
      this.shoreInfo.setVisible(false);
      return;
    }
    // viewing mode: the floating name tags go away and the beach info
    // lives behind the "i" button at the bottom instead
    const viewing = this.viewing;
    this.shoreInfo.setVisible(viewing);
    const engine = this.scene.getEngine();
    const cam = this.scene.activeCamera!;
    const vp = cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const scale = engine.getHardwareScalingLevel();
    const transform = this.scene.getTransformMatrix();
    const identity = Matrix.IdentityReadOnly;
    // the HUD the name tags must not cover: when collapsed, only the subtle
    // restore button stays visible; otherwise avoid the place card, shore bar,
    // and both bottom HUD clusters. Measure at most every 250 ms to avoid
    // per-frame reflow.
    if (now - this.keepOutAt > 250) {
      this.keepOutAt = now;
      const sel = this.uiRoot.classList.contains('ui-collapsed')
        ? '.hud-collapse'
        : '.place, .shore-bar.shown, .hud-right, .hud-left';
      this.keepOutCache = [...this.uiRoot.querySelectorAll<HTMLElement>(sel)]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
    }
    const keepOut: { left: number; top: number; right: number; bottom: number }[] = [...this.keepOutCache];
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    for (const e of this.entries.values()) {
      const s = e.slot;
      if (!s) continue;
      s.renderer.update(p, camForward, time, simTime, tide, amp);
      if (viewing) {
        // no floating tags in viewing mode (unless the tag is sitting in
        // the open info card, where the card's CSS lays it out as a row)
        if (!this.shoreInfo.isInCard(s.label)) s.label.style.display = 'none';
        continue;
      }
      this._projIn.set(s.renderer.offsetX, 1.4, 0);
      Vector3.ProjectToRef(this._projIn, identity, transform, vp, this._projOut);
      const x = this._projOut.x * scale;
      const y = this._projOut.y * scale;
      const visible = this._projOut.z > 0 && this._projOut.z < 1 && x > -100 && x < winW + 100;
      const disp = visible ? 'flex' : 'none';
      if (s.label.style.display !== disp) s.label.style.display = disp;
      if (!visible) continue;
      const w = s.label.offsetWidth;
      const h = s.label.offsetHeight;
      const at2 = placeTag(x, y, w, h, winW, winH, keepOut);
      keepOut.push({ left: at2.left, top: at2.top, right: at2.left + w, bottom: at2.top + h });
      const tf = `translate(${Math.round(at2.left)}px, ${Math.round(at2.top)}px)`;
      if (s.label.style.transform !== tf) s.label.style.transform = tf;
    }
    if (viewing) this.syncInfoRows();
  }

  /** The open info card's rows: the drawn beaches, nearest the view first. */
  private syncInfoRows(): void {
    if (!this.shoreInfo.isOpen) return;
    const focus = this.nearestIndex(this.cam.focusX);
    const indices = [...this.entries.values()].filter((e) => e.slot).map((e) => e.index);
    const labels = orderInfoRows(indices, focus).map((i) => this.entries.get(i)!.slot!.label);
    this.shoreInfo.setRows(labels);
  }
}

