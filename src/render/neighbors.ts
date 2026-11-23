import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';

import { WORLD_SIZE_X, type GridSpec } from '../config';
import type { CameraController } from '../input/cameraController';
import type { Account, Neighbors, ShoreBeach, Side } from '../net/account';
import { NeighborApi } from '../net/account';
import type { Palette } from '../palette';
import type { PlacedObject } from '../sim/objects';
import { decodeSand, fitWorld, resampleField } from '../sim/sandCodec';
import type { Swell } from '../sim/waves';
import { beachById } from '../world/locations';
import { BeachRenderer, ORIGIN_Z } from './beachRenderer';
import { ObjectView } from './objects';

/** gap between dioramas, so each beach reads as its own little island */
const GAP = 1.6;
export const NEIGHBOR_OFFSET = WORLD_SIZE_X + GAP;
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

interface Loaded {
  delta: Float32Array;
  objects: PlacedObject[];
  updatedAt: number | null;
}

interface Slot {
  renderer: BeachRenderer;
  objects: ObjectView;
  label: HTMLDivElement;
  star: HTMLButtonElement;
}

/** One beach along the shore. Index 0 is yours (or the one you're visiting); +1 is the next one on the left, and so on. */
interface Entry {
  index: number;
  beach: ShoreBeach;
  data?: Loaded;
  /** a load is in flight */
  loading?: Promise<void>;
  slot?: Slot;
}

/**
 * The shore: your beach in the middle, your neighbors either side, their
 * neighbors beyond them, and so on (following each beach's left / right
 * neighbor), as far as anyone has linked up. Walk or pan along it; the
 * beaches near the view are drawn as snapshots of their last save (their
 * sand and things, your sky, sea and tide), the rest load as you get close.
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
  readonly favorites = new Map<string, ShoreBeach>();
  private entries = new Map<number, Entry>();
  private tide = 0;
  private lastTideRefresh = 0;
  private listeners: ((n: Neighbors | null) => void)[] = [];
  private favListeners: (() => void)[] = [];
  /** bumps on every refresh/clear so a slow, older refresh can't overwrite a newer one */
  private generation = 0;
  private chairView = false;
  private pollTimer = 0;
  private win: [number, number] = [0, 0];
  /** a direction where the whole world has been walked (the shore came round) */
  private exhausted = new Set<Side>();
  private paging = new Set<Side>();

  constructor(
    private readonly scene: Scene,
    private readonly grid: GridSpec,
    private readonly rest: Float32Array,
    private readonly swell: Swell,
    private readonly cam: CameraController,
    private readonly uiRoot: HTMLElement,
    account: Account,
  ) {
    this.api = new NeighborApi(account);
  }

  onChange(fn: (n: Neighbors | null) => void): void {
    this.listeners.push(fn);
  }

  onFavorites(fn: () => void): void {
    this.favListeners.push(fn);
  }

  static offsetFor(side: Side): number {
    return side === 'left' ? NEIGHBOR_OFFSET : -NEIGHBOR_OFFSET;
  }

  /** The beaches currently drawn, as shore indices [from, to] (0 = the middle one). */
  get window(): [number, number] {
    return this.win;
  }

  /** Is your own (live) beach in view? False while visiting or far down the shore. */
  get ownVisible(): boolean {
    return !this.visiting && this.win[0] <= 0 && this.win[1] >= 0;
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
    const [n, shore] = await Promise.all([
      this.api.get().catch(() => null),
      this.api.shore(this.visiting?.code ?? null, DEPTH).catch(() => null),
    ]);
    if (gen !== this.generation) return this.latest === mine ? undefined : this.latest;
    this.state = n;
    const next = new Map<number, ShoreBeach>();
    if (shore) {
      if (this.visiting) {
        next.set(0, shore.center);
        this.visiting = shore.center;
      }
      shore.left.forEach((b, i) => next.set(i + 1, b));
      shore.right.forEach((b, i) => next.set(-(i + 1), b));
    }
    // beaches loaded further out by scrolling stay, unless the shore near the middle changed
    const changed = [...next].some(([i, b]) => this.entries.has(i) && this.entries.get(i)!.beach.code !== b.code);
    const reach = { left: shore?.left.length ?? 0, right: shore?.right.length ?? 0 };
    for (const [i, e] of this.entries) {
      const beyond = i > 0 ? i > reach.left : i < 0 && -i > reach.right;
      if (beyond && !changed && (i > 0 ? reach.left >= DEPTH : reach.right >= DEPTH)) continue;
      const b = next.get(i);
      if (!b || b.code !== e.beach.code) this.forget(i);
    }
    if (changed || !shore) this.exhausted.clear();
    if (shore && shore.left.length < DEPTH) this.exhausted.add('left');
    if (shore && shore.right.length < DEPTH) this.exhausted.add('right');
    for (const [i, b] of next) {
      const e = this.entries.get(i);
      if (e) {
        e.beach = b;
        // a newer save: fetch it again when it's near the view
        if (e.data && e.data.updatedAt !== b.updatedAt) e.data = { ...e.data, updatedAt: -1 };
        if (e.slot) e.slot.label.querySelector('.name')!.textContent = this.title(b);
      } else {
        this.entries.set(i, { index: i, beach: b });
      }
    }
    this.updateBounds();
    for (const fn of this.listeners) fn(n);
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
    const on = !this.favorites.has(b.code);
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
    this.dropSlot(e);
    this.entries.delete(i);
  }

  private updateBounds(): void {
    const half = WORLD_SIZE_X / 2;
    const { left, right } = this.extent;
    this.cam.maxX = left * NEIGHBOR_OFFSET + half;
    this.cam.minX = -right * NEIGHBOR_OFFSET - half;
  }

  private title(b: ShoreBeach): string {
    const place = b.location ? beachById(b.location) : undefined;
    return `${b.name || 'a neighbor'}${place ? ` · ${place.name}` : ''}`;
  }

  // ------------------------------------------------------------ loading and drawing

  /** Draw the beaches near the view, load the ones about to come into view, let go of far ones. */
  private async fillWindow(wait = false): Promise<void> {
    const c = Math.round(this.cam.focusX / NEIGHBOR_OFFSET);
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
        if (d > KEEP) e.data = undefined;
      }
    }
    if (wait) await Promise.all(pending);
  }

  private load(e: Entry): Promise<void> {
    // already fetching: if that turns out older than the newest save we know
    // of, fetch once more when it lands
    if (e.loading) return e.loading.then(() => (e.data && e.data.updatedAt !== e.beach.updatedAt ? this.fetch(e) : undefined));
    return this.fetch(e);
  }

  private fetch(e: Entry): Promise<void> {
    if (e.loading) return e.loading;
    e.loading = (async () => {
      const saved = e.beach.location ? await this.api.beachByCode(e.beach.code).catch(() => null) : null;
      let delta: Float32Array = new Float32Array(this.grid.nx * this.grid.ny);
      let objects: PlacedObject[] = [];
      if (saved) {
        try {
          const d = fitWorld(await decodeSand(saved.bytes));
          delta = resampleField(d.delta, d.nx, d.ny, this.grid.nx, this.grid.ny);
          objects = d.objects;
        } catch {
          /* unreadable save: show their beach untouched */
        }
      }
      if (this.entries.get(e.index) !== e) return; // the shore changed meanwhile
      e.data = { delta, objects, updatedAt: saved?.updatedAt ?? e.beach.updatedAt };
      if (e.slot) this.repaint(e);
      else if (e.index >= this.win[0] && e.index <= this.win[1]) this.makeSlot(e);
    })().finally(() => (e.loading = undefined));
    return e.loading;
  }

  private makeSlot(e: Entry): void {
    if (!e.data || e.slot) return;
    const x = e.index * NEIGHBOR_OFFSET;
    const renderer = new BeachRenderer(this.scene, this.grid, this.rest, this.swell, x);
    renderer.setChairView(this.chairView);
    const objects = new ObjectView(this.scene, renderer, x);
    const label = document.createElement('div');
    label.className = 'neighbor-tag';
    label.innerHTML = `<span class="name"></span>`;
    label.querySelector('.name')!.textContent = this.title(e.beach);
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'fav';
    star.addEventListener('click', () => void this.toggleFavorite(e.beach).catch(() => {}));
    label.appendChild(star);
    this.uiRoot.appendChild(label);
    e.slot = { renderer, objects, label, star };
    this.paintStar(e);
    this.repaint(e);
  }

  private paintStar(e: Entry): void {
    if (!e.slot) return;
    const on = this.favorites.has(e.beach.code);
    e.slot.star.textContent = on ? '★' : '☆';
    e.slot.star.classList.toggle('on', on);
    e.slot.star.setAttribute('aria-label', on ? 'Remove from favorites' : 'Add to favorites');
    e.slot.star.title = e.slot.star.getAttribute('aria-label')!;
  }

  private dropSlot(e: Entry): void {
    if (!e.slot) return;
    e.slot.objects.dispose();
    e.slot.renderer.dispose();
    e.slot.label.remove();
    e.slot = undefined;
  }

  private repaint(e: Entry): void {
    const s = e.slot;
    const d = e.data;
    if (!s || !d) return;
    s.objects.setStatic(d.objects, (x, y) => this.heightAt(d.delta, x, y));
    this.paint(s.renderer, d.delta);
  }

  /** Sand height at a world point on a drawn beach along the shore, or NaN if it isn't on one. */
  heightAtWorld(x: number, z: number): number {
    const i = Math.round(x / NEIGHBOR_OFFSET);
    const e = this.entries.get(i);
    if (!e?.data || (i === 0 && !this.visiting)) return NaN;
    const sx = x - i * NEIGHBOR_OFFSET + WORLD_SIZE_X / 2;
    const sy = z - ORIGIN_Z;
    if (sx < 0 || sx > WORLD_SIZE_X || sy < 0 || sy > this.grid.ny * this.grid.dx) return NaN;
    return this.heightAt(e.data.delta, sx, sy);
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
    const buf = new Float32Array(n * 4);
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

  /** Per frame: which beaches to draw, shared lighting/sea, slow tide refresh, name tags. */
  update(p: Palette, camForward: Vector3, time: number, simTime: number, tide: number, amp: number): void {
    if (!this.entries.size) {
      this.win = [0, 0];
      return;
    }
    void this.fillWindow();
    // infinite scroll: keep the shore loaded a few beaches past the view
    const c = Math.round(this.cam.focusX / NEIGHBOR_OFFSET);
    const ext = this.extent;
    if (ext.left - c < AHEAD) void this.more('left');
    if (ext.right + c < AHEAD) void this.more('right');
    const now = performance.now();
    const slots = [...this.entries.values()].filter((e) => e.slot);
    if (Math.abs(tide - this.tide) > 0.01 && now - this.lastTideRefresh > 5000) {
      this.tide = tide;
      this.lastTideRefresh = now;
      for (const e of slots) this.repaint(e);
    }
    const engine = this.scene.getEngine();
    const cam = this.scene.activeCamera!;
    const vp = cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const scale = engine.getHardwareScalingLevel();
    for (const e of slots) {
      const s = e.slot!;
      s.renderer.update(p, camForward, time, simTime, tide, amp);
      const at = Vector3.Project(new Vector3(s.renderer.offsetX, 1.4, 0), Matrix.Identity(), this.scene.getTransformMatrix(), vp);
      const x = at.x * scale;
      const y = at.y * scale;
      const visible = at.z > 0 && at.z < 1 && x > -100 && x < window.innerWidth + 100;
      s.label.style.display = visible ? 'flex' : 'none';
      if (visible) s.label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    }
  }
}
