import type { Ray } from '@babylonjs/core/Culling/ray';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';

import { BEACH_STORE, SECTION, SIM_HZ, WORLD_SIZE_X, WORLD_SIZE_Z, type GridSpec } from '../config';
import type { CameraController } from '../input/cameraController';
import { pickHeightfield } from '../input/sandPicker';
import type { Account, MyBeach, Neighbors, ShoreBeach, Side } from '../net/account';
import { NeighborApi } from '../net/account';
import { LOCAL_BEACH, type BeachRef, type BeachState, type BeachStore } from '../net/beachStore';
import type { Palette } from '../palette';
import type { BrushMode, CastleShape } from '../sim/beachSim';
import type { PlacedObject } from '../sim/objects';
import type { Swell } from '../sim/waves';
import { BeachRenderer, OCEAN_REACH, ORIGIN_Z } from './beachRenderer';
import { ObjectView } from './objects';
import { PierLayer, type PierSpot } from './pier';
import type { SectionLayer, SectionSpot } from './sections';
import { sandRowsOf, sectionJoins } from '../world/sections';
import {
  boundaryLinked,
  indicesOverlapping,
  nearestShoreIndex,
  shoreLayout,
  stickyWindow,
  UNLINKED_STEP,
  visibleShoreSpan,
  windowBeachCenters,
} from './shoreSpacing';
/** how far down the shore to load at first, each way */
const DEPTH = 6;
/** load more of the shore when the view gets this close to the end of what's loaded */
const AHEAD = 3;
/** how many more to load at a time */
const PAGE = 6;
/** beaches drawn either side of the one you're looking at in the chair view */
const RENDER = 2;
/** most beaches drawn either side of the middle of the view, however far out you zoom */
const RENDER_MAX = 6;
/** a drawn beach stays drawn until it's this far (m) out of view, so panning to and fro doesn't rebuild it */
const KEEP_MARGIN = UNLINKED_STEP;
/** beaches fetched (not drawn) past each end of what's drawn, so they're ready as they scroll in */
const PREFETCH = 2;
/** how often to look for new saves along the shore */
const POLL_MS = 30000;
/** while a beach's owner is on it, a viewer asks about it this often (docs/LIVE_SIM.md) */
const LIVE_POLL_MS = 5000;

/** The signed-out beach on this device, at the middle of the public shore. */
const LOCAL_SHORE_BEACH: ShoreBeach = { id: LOCAL_BEACH, code: '', name: '', location: null, updatedAt: null };

export interface OwnedPick {
  x: number;
  y: number;
  z: number;
  beachId: string;
  offsetX: number;
}

interface Slot {
  /** the snapshot drawing (null while the wave worker draws this beach) */
  renderer: BeachRenderer | null;
  objects: ObjectView | null;
  /** save identity of the snapshot currently drawn */
  snapshot?: Pick<BeachState, 'updatedAt' | 'version'>;
}

/**
 * One place along the shore. Index 0 is the anchor (your home, a beach of
 * yours you went to, or a beach you're visiting); +1 is the next one on the
 * left, and so on. Its sand lives in the BeachStore under `beach.id`.
 */
interface Entry {
  index: number;
  beach: ShoreBeach;
  slot?: Slot;
  /** live drag preview override for one object on this beach */
  dragPreview?: { id: number; x: number; y: number } | null;
}

/**
 * The shore: the beaches along the chain of neighbor links, laid out around
 * an anchor. Walk or pan along it; the beaches near the view are drawn from
 * the BeachStore (docs/BEACH_STORE.md), by id, and the ones about to come
 * into view are loaded into it. There is no "current" beach: any beach of
 * yours in view can be edited, and the one the wave worker simulates (the
 * live one, chosen by the view) is drawn by the live renderer instead of a
 * snapshot.
 *
 * You can also visit anyone's beach by code: the shore re-anchors there.
 *
 * Facing the sea, "left" is world +X (your right hand points to -X).
 */
export class NeighborView {
  readonly api: NeighborApi;
  /** the neighbor slots and code of the anchor beach if it's yours, else your home's (for the settings panel) */
  state: Neighbors | null = null;
  /** the beach you're visiting (the anchor, when it isn't yours), or null */
  visiting: ShoreBeach | null = null;
  readonly favorites = new Map<string, ShoreBeach>();
  private entries = new Map<number, Entry>();
  /** world-X centre of each entry (linked neighbours touch, the rest keep the diorama gap) */
  private pos = new Map<number, number>();
  private tide = 0;
  private listeners: ((n: Neighbors | null) => void)[] = [];
  private favListeners: (() => void)[] = [];
  private shoreListeners: (() => void)[] = [];
  /** bumps on every refresh/clear so a slow, older refresh can't overwrite a newer one */
  private generation = 0;
  /** bumps on every anchorAt/clear so a slow, older visit can't overwrite a newer one */
  private anchorGeneration = 0;
  private chairView = false;
  private pollTimer = 0;
  private liveTimer = 0;
  /** when to next ask about each beach (fast while its owner is on it) */
  private liveNext = new Map<string, number>();
  private win: [number, number] = [0, 0];
  /** a direction where the whole world has been walked (the shore came round) */
  private exhausted = new Set<Side>();
  private paging = new Set<Side>();
  private lastUpdateAt = 0;
  private brushId: string | null = null;
  private paintBuf: Float32Array | null = null;
  /** the beach the shore is laid out around, by code (null: your home) */
  private anchor: string | null = null;
  /** the beach the wave worker simulates, and the renderer that draws it */
  private liveId: string | null = null;
  private liveRenderer: BeachRenderer | null = null;
  /** step accumulators for the main-thread edit sims, by beach id */
  private editAcc = new Map<string, number>();
  /** the piers along the shore (docs/PIERS.md), drawn whoever's beach they're on */
  private piers: PierLayer | null = null;
  /** a beach of yours showing a pier you haven't placed yet (the "place pier" preview) */
  private piersPreview: string | null = null;
  /** the inland sections behind each beach (docs/INLAND_SECTIONS.md), whoever's beach they're on */
  private sections: SectionLayer | null = null;
  /** the section renderer loads on first use (most beaches have no rows) */
  private sectionsLoading = false;
  /** a beach of yours showing a layout you haven't saved yet (the Inland sections preview) */
  private sectionsPreview: { id: string; rows: string[] } | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly grid: GridSpec,
    _rest: Float32Array,
    private readonly swell: Swell,
    private readonly cam: CameraController,
    private readonly account: Account,
    private readonly store: BeachStore,
  ) {
    this.api = new NeighborApi(account);
    // a beach changed in the store (an edit, a load, a restore): redraw wherever it's shown
    store.onChanged((id) => {
      for (const e of this.entries.values()) if (e.beach.id === id && e.slot) this.repaint(e);
    });
  }

  onChange(fn: (n: Neighbors | null) => void): void {
    this.listeners.push(fn);
  }

  onFavorites(fn: () => void): void {
    this.favListeners.push(fn);
  }

  /** The shore's beaches or layout changed (a refresh, more loaded, a relink). */
  onShore(fn: () => void): void {
    this.shoreListeners.push(fn);
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
      if (e.slot?.renderer && e.slot.renderer.offsetX !== this.xFor(e.index)) this.dropSlot(e);
    }
    this.syncSeams();
    for (const fn of this.shoreListeners) fn();
  }

  /** Link adjacent rendered beaches along linked-neighbour boundaries so sand, water and waves blend seamlessly. */
  private syncSeams(): void {
    const active = new Map<number, BeachRenderer>();
    const li = this.liveIndex;
    if (this.liveRenderer && li !== null && li >= this.win[0] && li <= this.win[1]) active.set(li, this.liveRenderer);
    for (const e of this.entries.values()) {
      if (e.slot?.renderer) active.set(e.index, e.slot.renderer);
    }
    const isLinked = (k: number) => this.entries.get(k)?.beach.linked === true;
    for (const [i, r] of active) {
      const neg = boundaryLinked(i - 1, isLinked) ? active.get(i - 1) ?? null : null;
      const pos = boundaryLinked(i, isLinked) ? active.get(i + 1) ?? null : null;
      r.setNeighbors(neg, pos);
    }
    if (this.liveRenderer && ![...active.values()].includes(this.liveRenderer)) this.liveRenderer.setNeighbors(null, null);
  }

  /** The beaches currently drawn, as shore indices [from, to] (0 = the middle one). */
  get window(): [number, number] {
    return this.win;
  }

  /** If this shore beach belongs to the signed-in player, return their MyBeach record. */
  ownedBeach(b: ShoreBeach): MyBeach | undefined {
    return this.account.beaches.find((m) => m.id === b.id);
  }

  /** Yours to edit: one of your beaches, or the signed-out beach on this device. */
  isOwned(b: ShoreBeach): boolean {
    return b.id === LOCAL_BEACH || !!this.ownedBeach(b);
  }

  /** How the store should fetch this shore beach. */
  refOf(b: ShoreBeach): BeachRef {
    return { id: b.id, code: b.code, owned: this.isOwned(b), location: b.location, updatedAt: b.updatedAt };
  }

  /** The beach the wave worker simulates, and its renderer (the view decides which; main binds it). */
  setLive(id: string | null, renderer: BeachRenderer): void {
    this.liveRenderer = renderer;
    if (id === this.liveId) return;
    const was = this.liveId;
    this.liveId = id;
    for (const e of this.entries.values()) {
      if (e.beach.id === was || e.beach.id === id) this.syncSlot(e);
    }
    this.syncSeams();
  }

  /** Is this beach drawn as a snapshot right now (so the waves moving onto it can ease from it)? */
  showsSnapshot(id: string): boolean {
    for (const e of this.entries.values()) if (e.beach.id === id && e.slot?.renderer) return true;
    return false;
  }

  /** How many piers are drawn now (e2e). */
  get piersDrawn(): number {
    return this.piers?.count ?? 0;
  }

  /** How many of those are the preview's see-through look (e2e). */
  get piersGhost(): number {
    return this.piers?.ghosts ?? 0;
  }

  /** Show a pier on this beach before it's placed (null: stop). */
  previewPier(beachId: string | null): void {
    this.piersPreview = beachId;
    this.syncPiers();
  }

  /** How many inland section rows are drawn now (e2e). */
  sectionRowsDrawn(beachId?: string): number {
    return this.sections?.rows(beachId) ?? 0;
  }

  /** A beach drawn here changed depth (sand rows inland): the scenery rows behind follow. */
  depthChanged(): void {
    this.syncSections();
  }

  /** A beach's saved inland rows, as the shore has them (null: not on the shore here). */
  sectionsOf(beachId: string): string[] | null {
    for (const e of this.entries.values()) if (e.beach.id === beachId) return e.beach.sections ?? [];
    return null;
  }

  /** Show this layout behind one of your beaches before it's saved (null: stop). */
  previewSections(beachId: string | null, rows: string[] = []): void {
    this.sectionsPreview = beachId ? { id: beachId, rows: [...rows] } : null;
    this.syncSections();
  }

  /** The rows behind a beach as drawn: its own, or the preview's. */
  private rowsOf(b: ShoreBeach): readonly string[] {
    return this.sectionsPreview?.id === b.id ? this.sectionsPreview.rows : (b.sections ?? []);
  }

  /**
   * The rows that should show behind every beach near the view, each edge
   * joined to a directly linked neighbor with the same type in the same row
   * (derived here, so a culled or not-yet-built neighbor still joins).
   */
  private syncSections(): void {
    if (!this.sections) {
      const r = this.liveRenderer;
      if (!r || this.sectionsLoading) return;
      const any = this.sectionsPreview?.rows.length || [...this.entries.values()].some((e) => e.beach.sections?.length);
      if (!any) return;
      this.sectionsLoading = true;
      void import('./sections')
        .then(({ SectionLayer }) => {
          this.sections = new SectionLayer(this.scene, (c) => r.createPropMaterial(c));
          this.syncSections();
        })
        .finally(() => (this.sectionsLoading = false));
      return;
    }
    const isLinked = (k: number) => this.entries.get(k)?.beach.linked === true;
    const want: SectionSpot[] = [];
    for (const e of this.entries.values()) {
      if (e.index < this.win[0] - 1 || e.index > this.win[1] + 1) continue;
      const rows = this.rowsOf(e.beach);
      if (!rows.length) continue;
      const side = (k: number) => {
        const lower = Math.min(e.index, k);
        const n = this.entries.get(k);
        return n && boundaryLinked(lower, isLinked) ? this.rowsOf(n.beach) : null;
      };
      const up = side(e.index + 1);
      const down = side(e.index - 1);
      // which of the two is towards +x
      const upIsPos = this.xFor(e.index + 1) > this.xFor(e.index);
      const rowsJoined = sectionJoins(rows, upIsPos ? down : up, upIsPos ? up : down);
      // sand rows straight behind are the beach's own sand, as deep as it's
      // drawn. A beach just outside the window has no slot yet: use the depth
      // it's loaded at (prefetched), so its rows aren't built once without
      // the sand and again with it as it scrolls in and out.
      const st = this.store.peek(e.beach.id);
      const drawn = e.beach.id === this.liveId ? this.liveRenderer?.grid : (e.slot?.renderer?.grid ?? (st ? this.store.gridOf(st) : undefined));
      const from = Math.min(sandRowsOf(rows), drawn ? this.store.grids.sandRows(drawn.ny) : 0);
      want.push({ key: `${e.beach.id}@${e.index}`, x: this.xFor(e.index), rows: rowsJoined, from });
    }
    this.sections.sync(want);
    const deepest = want.reduce((m, w) => Math.max(m, w.rows.length), 0);
    this.cam.maxZ = WORLD_SIZE_Z / 2 + deepest * SECTION.depth;
  }

  /** The piers that should show: on beaches that have one, and the preview. */
  private syncPiers(): void {
    if (!this.piers) {
      const r = this.liveRenderer;
      if (!r) return;
      this.piers = new PierLayer(this.scene, (c, ghost) => r.createPropMaterial(c, 0, ghost));
    }
    const want: PierSpot[] = [];
    for (const e of this.entries.values()) {
      if (e.index < this.win[0] - 1 || e.index > this.win[1] + 1) continue;
      // the preview is a ghost until the beach really has one
      if (e.beach.pier || e.beach.id === this.piersPreview) want.push({ key: `${e.beach.id}@${e.index}`, x: this.xFor(e.index), ghost: !e.beach.pier });
    }
    this.piers.sync(want);
  }

  /** Shore index of the live beach, if it's on this shore. */
  get liveIndex(): number | null {
    return this.liveId ? this.indexOfBeach(this.liveId) : null;
  }

  /** Is the live beach drawn now (on this shore, near the view)? */
  get liveVisible(): boolean {
    const i = this.liveIndex;
    return i !== null && i >= this.win[0] && i <= this.win[1];
  }

  /** World-X centre of a beach on this shore, or null. */
  xForBeach(id: string): number | null {
    const i = this.indexOfBeach(id);
    return i === null ? null : this.xFor(i);
  }

  /** Is *any* of your own beaches currently drawn in the window? */
  get anyOwnVisible(): boolean {
    for (const e of this.entries.values()) {
      if (e.index >= this.win[0] && e.index <= this.win[1] && this.isOwned(e.beach)) return true;
    }
    return false;
  }

  /**
   * The beach of yours nearest the centre of the view, among those drawn:
   * where the waves should run. Null when none of yours is in view.
   */
  ownedNearest(x: number): { beach: ShoreBeach; index: number; dist: number } | null {
    let best: { beach: ShoreBeach; index: number; dist: number } | null = null;
    for (const e of this.entries.values()) {
      if (e.index < this.win[0] || e.index > this.win[1] || !this.isOwned(e.beach)) continue;
      const d = Math.abs(this.xFor(e.index) - x);
      if (!best || d < best.dist) best = { beach: e.beach, index: e.index, dist: d };
    }
    return best;
  }

  /** The beaches drawn now (plus one either side), with their world-X centres. */
  drawnBeaches(): { beach: ShoreBeach; x: number }[] {
    const out: { beach: ShoreBeach; x: number }[] = [];
    for (const e of this.entries.values()) {
      if (e.index < this.win[0] - 1 || e.index > this.win[1] + 1) continue;
      out.push({ beach: e.beach, x: this.xFor(e.index) });
    }
    return out;
  }

  /** Shore index of a beach (by id) if it's on the current shore, else null. */
  indexOfBeach(beachId: string): number | null {
    let found: number | null = null;
    for (const e of this.entries.values()) {
      if (e.beach.id !== beachId) continue;
      if (found === null || Math.abs(e.index) < Math.abs(found)) found = e.index;
    }
    return found;
  }

  /** Viewing mode: looking at someone else's stretch of shore. */
  get viewing(): boolean {
    return !!this.visiting || !this.anyOwnVisible;
  }

  /**
   * Away from home: the view is on someone else's beach.
   */
  get away(): boolean {
    const b = this.beachAt(this.nearestIndex(this.cam.focusX));
    return !b || !this.isOwned(b);
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

  /** Reload your neighbors and the shore (around the anchor). */
  refresh(): Promise<void> {
    const gen = ++this.generation;
    const p: Promise<void> = Promise.resolve().then(() => this.doRefresh(gen, p));
    this.latest = p;
    return p;
  }

  /** the newest refresh: an older one that's overtaken waits for it, so callers see fresh data */
  private latest: Promise<void> = Promise.resolve();

  /** The beach of yours whose neighbor slots the settings panel shows: the anchor if it's yours, else home (the server's default). */
  get stateBeachId(): string | undefined {
    return this.account.beaches.find((b) => b.code === this.anchor)?.id;
  }

  private async doRefresh(gen: number, mine: Promise<void>): Promise<void> {
    const signedIn = !!this.account.user;
    const [n, shore] = await Promise.all([
      signedIn ? this.api.get(this.stateBeachId).catch(() => null) : Promise.resolve(null),
      this.api.shore(this.anchor, DEPTH).catch(() => null),
    ]);
    if (gen !== this.generation) return this.latest === mine ? undefined : this.latest;
    if (signedIn !== !!this.account.user) return;
    if (!shore) {
      // Keep the loaded shore through a network failure.
      this.schedulePoll();
      return;
    }
    if (n || !signedIn) this.state = n;
    // the anchor is the middle: yours (home, or one you went to), someone
    // else's you're visiting, or — signed out with no beach asked for — the
    // beach on this device
    const center: ShoreBeach = shore.center ?? LOCAL_SHORE_BEACH;
    this.visiting = shore.center && !shore.center.you && !this.ownedBeach(shore.center) ? shore.center : null;
    const next = new Map<number, ShoreBeach>();
    next.set(0, center);
    shore.left.forEach((b, i) => next.set(i + 1, b));
    shore.right.forEach((b, i) => next.set(-(i + 1), b));
    // beaches loaded further out by scrolling stay, unless the shore near the middle changed
    const changed = [...next].some(([i, b]) => this.entries.has(i) && this.entries.get(i)!.beach.id !== b.id);
    const reach = { left: shore.left.length, right: shore.right.length };
    for (const [i, e] of this.entries) {
      const beyond = i > 0 ? i > reach.left : i < 0 && -i > reach.right;
      if (beyond && !changed && (i > 0 ? reach.left >= DEPTH : reach.right >= DEPTH)) continue;
      const b = next.get(i);
      if (!b || b.id !== e.beach.id) this.forget(i);
    }
    if (changed) this.exhausted.clear();
    if (shore.left.length < DEPTH) this.exhausted.add('left');
    if (shore.right.length < DEPTH) this.exhausted.add('right');
    for (const [i, b] of next) {
      const e = this.entries.get(i);
      // a newer save: the store fetches it again when it's near the view (never over unsaved edits)
      this.store.markStale(b.id, b.updatedAt);
      if (e) {
        e.beach = b;
      } else {
        this.entries.set(i, { index: i, beach: b });
      }
    }
    this.updateBounds();
    for (const fn of this.listeners) fn(this.state);
    this.schedulePoll();
    await this.fillWindow(true);
  }

  /**
   * Lay the shore out around a beach, by code (null: your home). A beach of
   * yours is just somewhere to look; anyone else's is a visit. Throws if
   * there's no such beach.
   */
  async anchorAt(code: string | null): Promise<void> {
    const gen = ++this.anchorGeneration;
    if (code) {
      const shore = await this.api.shore(code, 0); // check it exists first
      // a newer visit started while the check was in flight: it owns the
      // anchor now, so this one stands down instead of overwriting it (the
      // last call wins, not the last fetch to finish)
      if (gen !== this.anchorGeneration) return;
      if (!shore.center) throw new Error('could not find that beach');
    }
    if (code === this.anchor && this.entries.size) {
      await this.refresh();
      return;
    }
    this.anchor = code;
    this.visiting = null;
    this.clearEntries();
    await this.refresh();
  }

  /** The code the shore is anchored at (null: home). */
  get anchorCode(): string | null {
    return this.anchor;
  }

  /** Visit anyone's beach by code (null: go home). Throws if there's no such beach. */
  visit(code: string | null): Promise<void> {
    return this.anchorAt(code);
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
    for (const fn of this.favListeners) fn();
  }

  /**
   * Live viewers (docs/LIVE_SIM.md, L5): the beach in front of you, if it
   * isn't yours, is asked about every 5 s while its owner is on it (every
   * 30 s otherwise), and fetched again whenever its version moves on: the
   * owner's saves (every 5 s while watched) and the server's catch-ups.
   */
  private scheduleLive(): void {
    window.clearTimeout(this.liveTimer);
    this.liveTimer = window.setTimeout(() => void this.livePoll().finally(() => this.scheduleLive()), LIVE_POLL_MS);
  }

  private async livePoll(): Promise<void> {
    if (document.hidden) return;
    const c = this.nearestIndex(this.cam.focusX);
    const e = this.entries.get(c);
    if (!e || !e.beach.location || this.isOwned(e.beach)) return;
    const st = this.store.peek(e.beach.id);
    if (!st || this.store.isLoading(e.beach.id)) return;
    const code = e.beach.code;
    const now = Date.now();
    if ((this.liveNext.get(code) ?? 0) > now) return;
    const live = await this.api.beachLive(code).catch(() => null);
    this.liveNext.set(code, now + (live?.live ? LIVE_POLL_MS : POLL_MS) - 100);
    if (!live || this.entries.get(c) !== e) return;
    if (st.version !== undefined && live.version !== st.version) await this.store.reload(this.refOf(e.beach));
  }

  private schedulePoll(): void {
    if (!this.liveTimer) this.scheduleLive();
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
    const st = e ? this.store.peek(e.beach.id) : undefined;
    if (!e || !st) return null;
    return { who: e.beach.code, updatedAt: st.updatedAt, objects: (this.store.objectsOf(e.beach.id) ?? []).length };
  }

  clear(): void {
    this.generation++;
    this.anchorGeneration++;
    // (no newer refresh to wait for: an overtaken one just stops)
    this.latest = Promise.resolve();
    window.clearTimeout(this.pollTimer);
    window.clearTimeout(this.liveTimer);
    this.liveTimer = 0;
    this.liveNext.clear();
    this.clearEntries();
    this.anchor = null;
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
    const from = this.entries.get(last)?.beach.code;
    if (!from) return;
    this.paging.add(dir);
    const gen = this.generation;
    try {
      const got = await this.api.shoreMore(from, dir, PAGE);
      if (gen !== this.generation) return;
      const known = new Set([...this.entries.values()].map((e) => e.beach.id));
      let i = last;
      for (const b of got) {
        if (known.has(b.id)) {
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
    for (const e of this.entries.values()) e.slot?.renderer?.setChairView(on);
  }

  private forget(i: number): void {
    const e = this.entries.get(i);
    if (!e) return;
    // (its state stays in the store: edits keep saving, and it's let go by the LRU)
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

  // ------------------------------------------------------------ loading and drawing

  /**
   * The shore indices to draw: every beach the view covers (in the diorama
   * that's the stretch under the camera's footprint, more as you zoom out),
   * kept drawn a little past the edge of the view so panning to and fro
   * doesn't drop and rebuild them.
   */
  private drawWindow(): [number, number] {
    const c = this.nearestIndex(this.cam.focusX);
    const { left, right } = this.extent;
    const min = Math.max(-right, c - RENDER_MAX);
    const max = Math.min(left, c + RENDER_MAX);
    const fallback: [number, number] = [Math.max(-right, c - RENDER), Math.min(left, c + RENDER)];
    const foot = this.cam.groundFootprint();
    const span = foot ? visibleShoreSpan(foot, ORIGIN_Z - OCEAN_REACH, ORIGIN_Z + WORLD_SIZE_Z) : null;
    if (!span) return fallback;
    const xFor = (i: number) => this.xFor(i);
    const need = indicesOverlapping(span[0], span[1], min, max, xFor) ?? [c, c];
    const keep = indicesOverlapping(span[0] - KEEP_MARGIN, span[1] + KEEP_MARGIN, min, max, xFor) ?? need;
    const had = this.win[0] <= this.win[1] && this.entries.size ? this.win : null;
    return stickyWindow(had, need, keep);
  }

  /** Draw the beaches in view, fetch the ones about to scroll in, let the store forget far ones. */
  private async fillWindow(wait = false): Promise<void> {
    const { left, right } = this.extent;
    const [lo, hi] = this.drawWindow();
    const moved = lo !== this.win[0] || hi !== this.win[1];
    this.win = [lo, hi];
    const pLo = Math.max(-right, lo - PREFETCH);
    const pHi = Math.min(left, hi + PREFETCH);
    const pending: Promise<void>[] = [];
    const held: string[] = [];
    for (const e of this.entries.values()) {
      const drawn = e.index >= lo && e.index <= hi;
      const near = e.index >= pLo && e.index <= pHi;
      if (!drawn) this.dropSlot(e);
      if (!near) continue;
      held.push(e.beach.id);
      const id = e.beach.id;
      const st = this.store.peek(id);
      if (drawn && st && !e.slot) this.makeSlot(e);
      const needsLoad = !st || (st.stale && !this.store.isAttached(id) && !this.store.isDirty(id));
      // what's drawn is waited for; what's ahead is fetched in the background
      if (needsLoad && ((wait && drawn) || !this.store.isLoading(id))) {
        const p = this.load(e);
        if (drawn) pending.push(p);
      }
    }
    if (moved || wait) {
      this.store.retain(held);
      this.store.gc();
    }
    if (wait) await Promise.all(pending);
  }

  private load(e: Entry): Promise<void> {
    if (e.beach.id === LOCAL_BEACH && !this.store.has(LOCAL_BEACH)) return Promise.resolve();
    return this.store.load(this.refOf(e.beach)).then((st) => {
      if (st && this.entries.get(e.index) === e && e.index >= this.win[0] && e.index <= this.win[1]) this.makeSlot(e);
      this.store.gc();
    });
  }

  private makeSlot(e: Entry): void {
    if (e.slot || !this.store.has(e.beach.id)) return;
    e.slot = { renderer: null, objects: null };
    this.syncSlot(e);
  }

  /** A slot draws its beach as a snapshot unless the wave worker has it (then the live renderer does). */
  private syncSlot(e: Entry): void {
    const s = e.slot;
    if (!s) return;
    const live = e.beach.id === this.liveId;
    if (live && s.renderer) {
      s.objects?.dispose();
      s.renderer.dispose();
      s.renderer = null;
      s.objects = null;
      s.snapshot = undefined;
    } else if (!live && !s.renderer) {
      const x = this.xFor(e.index);
      const st = this.store.peek(e.beach.id);
      const g = st ? this.store.gridOf(st) : this.grid;
      s.renderer = new BeachRenderer(this.scene, g, this.store.grids.rest(g.ny), this.swell, x);
      s.renderer.setChairView(this.chairView);
      s.objects = new ObjectView(this.scene, s.renderer, x);
      this.repaint(e);
    }
    this.syncSeams();
  }

  /**
   * Which side of *your* beach this beach could join, if it's at the end of a
   * stretch of shore (a free side, as the walk shows it) and your matching
   * side is free too. Index > 0 runs left from the middle, < 0 right; `linked`
   * is a beach's link to the one before it (nearer the middle).
   */
  askSide(e: Entry): Side | null {
    if (this.visiting || !this.state || e.index === 0) return null;
    if (this.isOwned(e.beach)) return null;
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

  /** Which side of your beach the shore entry at `index` could join, or null. */
  askSideAt(index: number): Side | null {
    const e = this.entries.get(index);
    return e ? this.askSide(e) : null;
  }

  /** Ask the beach at shore `index` to become your neighbor on the matching free side. */
  async askAt(index: number): Promise<'linked' | 'asked' | null> {
    const e = this.entries.get(index);
    if (!e) return null;
    const side = this.askSide(e);
    if (!side) return null;
    const r = await this.api.set(side, e.beach.code, this.stateBeachId);
    await this.refresh();
    return r.status;
  }

  private dropSlot(e: Entry): void {
    if (!e.slot) return;
    e.slot.objects?.dispose();
    e.slot.renderer?.dispose();
    e.slot = undefined;
    this.syncSeams();
  }

  private repaint(e: Entry): void {
    const s = e.slot;
    const d = this.store.peek(e.beach.id);
    if (!s?.renderer || !s.objects || !d) return;
    const preview = e.dragPreview;
    const base = this.store.objectsOf(e.beach.id) ?? d.objects;
    const objs = preview ? base.map((o) => (o.id === preview.id ? { ...o, x: preview.x, y: preview.y } : o)) : base;
    const display = d.display;
    // (the beach changed depth: sand rows inland)
    const g = this.store.gridOf(d);
    if (g.ny !== s.renderer.grid.ny) {
      s.renderer.resize(g, this.store.grids.rest(g.ny));
      this.syncSections();
    }
    s.objects.setStatic(objs, (x, y) => this.heightAt(display, x, y) + (preview && Math.abs(x - preview.x) < 1e-4 && Math.abs(y - preview.y) < 1e-4 ? 0.12 : 0));
    const previous = s.snapshot;
    const newerSave =
      previous && !d.owned && !d.fresh &&
      (previous.version !== undefined && d.version !== undefined
        ? d.version > previous.version
        : d.updatedAt !== null && (previous.updatedAt === null || d.updatedAt > previous.updatedAt));
    this.paint(s.renderer, display, newerSave ? BEACH_STORE.viewerEaseMs : 0);
    s.snapshot = { version: d.version, updatedAt: d.updatedAt };
  }

  private entryOf(beachId: string): Entry | null {
    const i = this.indexOfBeach(beachId);
    return i === null ? null : (this.entries.get(i) ?? null);
  }

  /** Raycast against the drawn snapshots of *your* beaches (not the live one); the closest hit. */
  pickOwned(ray: Ray): OwnedPick | null {
    return this.pickWhere(ray, (b) => this.isOwned(b));
  }

  /** The sand point under a ray on one drawn beach (anyone's, by id), or null. */
  pickBeach(ray: Ray, beachId: string): OwnedPick | null {
    return this.pickWhere(ray, (b) => b.id === beachId);
  }

  private pickWhere(ray: Ray, want: (b: ShoreBeach) => boolean): OwnedPick | null {
    let best: OwnedPick | null = null;
    let bestD2 = Infinity;
    const o = ray.origin;
    for (const e of this.entries.values()) {
      if (!e.slot?.renderer || !want(e.beach)) continue;
      const st = this.store.peek(e.beach.id);
      if (!st) continue;
      const maxZ = (st.display.length / this.grid.nx) * this.grid.dx;
      const ox = this.xFor(e.index);
      const display = st.display;
      const hit = pickHeightfield(ray, this.grid.dx, (x, z) => {
        const sx = x - ox + WORLD_SIZE_X / 2;
        const sy = z - ORIGIN_Z;
        if (sx < 0 || sx > WORLD_SIZE_X || sy < 0 || sy > maxZ) return NaN;
        return this.heightAt(display, sx, sy);
      });
      if (!hit) continue;
      const d2 = (hit.x - o.x) ** 2 + (hit.y - o.y) ** 2 + (hit.z - o.z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { ...hit, beachId: e.beach.id, offsetX: ox };
      }
    }
    return best;
  }

  /** Object under sim coordinates (sx, sy) on one of your beaches (as the store has it). */
  ownedObjectAt(beachId: string, sx: number, sy: number): PlacedObject | null {
    const objs = this.store.objectsOf(beachId);
    if (!objs || !this.store.peek(beachId)?.owned) return null;
    let best: PlacedObject | null = null;
    let bestD = Infinity;
    for (const o of objs) {
      const reach = o.kind === 'driftwood' ? o.size * 0.5 : Math.max(0.22, Math.min(1, o.size) * 0.9);
      const d = Math.hypot(o.x - sx, o.y - sy);
      if (d < reach && d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  hasOwnedObject(beachId: string, id: number): boolean {
    return !!this.store.objectsOf(beachId)?.some((obj) => obj.id === id);
  }

  /** Non-wild object count on one of your beaches (for the MAX_OBJECTS check). */
  ownedCount(beachId: string): number {
    return (this.store.objectsOf(beachId) ?? []).filter((o) => !o.wild).length;
  }

  // ------------------------------------------------------------ editing a beach of yours on the main thread
  // (the live one is edited in the worker; these go through the store's edit sim)

  private sim(beachId: string) {
    return this.store.editSim(beachId);
  }

  /** Live brush stroke on one of your beaches. */
  beginStroke(beachId: string, sx: number, sy: number, r: number, mode: BrushMode): void {
    const sim = this.sim(beachId);
    if (!sim) return;
    sim.beginStroke(sx, sy, r, mode);
    sim.stepEdit(1 / SIM_HZ);
    this.store.edited(beachId, false);
  }

  moveStroke(beachId: string, sx: number, sy: number, r: number): void {
    this.store.peek(beachId)?.sim?.moveStroke(sx, sy, r);
  }

  endStroke(beachId: string): PlacedObject[] {
    const sim = this.store.peek(beachId)?.sim;
    if (!sim) return [];
    sim.endStroke();
    this.store.edited(beachId);
    // what the vacuum swept up on this stroke (each once)
    return sim.takeVacuumed();
  }

  cancelStroke(beachId: string): void {
    const sim = this.store.peek(beachId)?.sim;
    if (!sim) return;
    sim.cancelStroke();
    this.store.edited(beachId, false);
  }

  placeObject(beachId: string, obj: Omit<PlacedObject, 'id'>, group?: string): PlacedObject | null {
    const sim = this.sim(beachId);
    if (!sim) return null;
    const placed = sim.placeObject(obj, group);
    sim.stepEdit(1 / SIM_HZ);
    this.store.edited(beachId);
    return placed;
  }

  /** Mold a sandcastle tower on one of your beaches. */
  moldCastle(beachId: string, sx: number, sy: number, shape: CastleShape): void {
    const sim = this.sim(beachId);
    if (!sim) return;
    sim.moldCastle(sx, sy, shape);
    sim.stepEdit(1 / SIM_HZ);
    this.store.edited(beachId);
  }

  moveObject(beachId: string, id: number, sx: number, sy: number): PlacedObject | null {
    const sim = this.sim(beachId);
    if (!sim) return null;
    const e = this.entryOf(beachId);
    if (e) e.dragPreview = null;
    const moved = sim.moveObject(id, sx, sy);
    sim.stepEdit(1 / SIM_HZ);
    this.store.edited(beachId);
    return moved;
  }

  removeObject(beachId: string, id: number): PlacedObject | null {
    const sim = this.sim(beachId);
    if (!sim) return null;
    const e = this.entryOf(beachId);
    if (e) e.dragPreview = null;
    const removed = sim.removeObject(id);
    if (removed) {
      sim.stepEdit(1 / SIM_HZ);
      this.store.edited(beachId);
    }
    return removed;
  }

  previewDrag(beachId: string, id: number | null, sx = 0, sy = 0): void {
    const e = this.entryOf(beachId);
    if (!e) return;
    e.dragPreview = id === null ? null : { id, x: sx, y: sy };
    if (e.slot) this.repaint(e);
  }

  canReplay(beachId: string, action: 'undo' | 'redo'): boolean {
    const c = this.store.undoCount(beachId);
    return (action === 'undo' ? c.undo : c.redo) > 0;
  }

  undo(beachId: string): boolean {
    return this.replay(beachId, 'undo');
  }

  redo(beachId: string): boolean {
    return this.replay(beachId, 'redo');
  }

  private replay(beachId: string, action: 'undo' | 'redo'): boolean {
    if (!this.canReplay(beachId, action)) return false;
    const sim = this.sim(beachId);
    if (!sim) return false;
    const ok = action === 'undo' ? sim.undoStroke(true) : sim.redoStroke(true);
    if (ok) {
      sim.stepEdit(1 / SIM_HZ);
      this.store.edited(beachId);
    }
    return ok;
  }

  /** Smooth (reset) one of your beaches that isn't the live one. */
  resetOwned(beachId: string): boolean {
    const sim = this.sim(beachId);
    if (!sim) return false;
    sim.resetBeach();
    this.store.edited(beachId, true, 1500);
    return true;
  }

  /** Show the brush ring on one of your beaches' snapshots (or clear it with null). */
  setBrush(beachId: string | null, x: number, z: number, r: number, alpha: number, color: [number, number, number]): void {
    if (this.brushId !== null && this.brushId !== beachId) {
      this.entryOf(this.brushId)?.slot?.renderer?.setBrush(0, 0, 1, 0, color);
    }
    this.brushId = beachId;
    if (beachId !== null) {
      this.entryOf(beachId)?.slot?.renderer?.setBrush(x, z, r, alpha, color);
    }
  }

  /** Sand height at a world point on a beach drawn as a snapshot, or NaN if it isn't on one. */
  heightAtWorld(x: number, z: number): number {
    let best: Entry | null = null;
    let bestD = Infinity;
    for (const e of this.entries.values()) {
      if (!e.slot?.renderer || !this.store.has(e.beach.id)) continue;
      const d = Math.abs(x - this.xFor(e.index));
      if (d <= WORLD_SIZE_X / 2 && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    const st = best ? this.store.peek(best.beach.id) : undefined;
    if (!best || !st) return NaN;
    const sx = x - this.xFor(best.index) + WORLD_SIZE_X / 2;
    const sy = z - ORIGIN_Z;
    if (sx < 0 || sx > WORLD_SIZE_X || sy < 0 || sy > (st.display.length / this.grid.nx) * this.grid.dx) return NaN;
    return this.heightAt(st.display, sx, sy);
  }

  /** Still-water depth (at the current tide) over a beach drawn as a snapshot; 0 off them. */
  waterAtWorld(x: number, z: number): number {
    const h = this.heightAtWorld(x, z);
    return Number.isFinite(h) ? Math.max(0, this.tide - h) : 0;
  }

  /** Their sand height at sim metres (bilinear). */
  private heightAt(delta: Float32Array, x: number, y: number): number {
    const { nx, dx } = this.grid;
    const ny = delta.length / nx;
    const rest = this.store.grids.rest(ny);
    const fi = Math.min(nx - 1.001, Math.max(0, x / dx - 0.5));
    const fj = Math.min(ny - 1.001, Math.max(0, y / dx - 0.5));
    const i = fi | 0;
    const j = fj | 0;
    const tx = fi - i;
    const ty = fj - j;
    const h = (k: number) => rest[k] + delta[k];
    const k = j * nx + i;
    return (h(k) * (1 - tx) + h(k + 1) * tx) * (1 - ty) + (h(k + nx) * (1 - tx) + h(k + nx + 1) * tx) * ty;
  }

  /** Pack their sand with still water at the current tide into a field frame. */
  private paint(r: BeachRenderer, delta: Float32Array, easeMs = 0): void {
    const n = delta.length;
    const rest = this.store.grids.rest(n / this.grid.nx);
    if (!this.paintBuf || this.paintBuf.length !== n * 4) this.paintBuf = new Float32Array(n * 4);
    const buf = this.paintBuf;
    for (let k = 0, o = 0; k < n; k++, o += 4) {
      const sand = rest[k] + delta[k];
      const water = Math.max(0, this.tide - sand);
      buf[o] = sand;
      buf[o + 1] = water;
      buf[o + 2] = water > 0.004 ? 1 : Math.max(0, Math.min(0.8, 1 - (sand - this.tide) / 0.35));
      buf[o + 3] = 0;
    }
    if (easeMs > 0) r.easeStatic(buf, easeMs);
    else r.showStatic(buf);
  }

  /** Per frame: which beaches to draw, shared lighting/sea, animated neighbor waves. */
  update(p: Palette, camForward: Vector3, time: number, simTime: number, tide: number, amp: number, now = performance.now()): void {
    this.tide = tide;
    const dt = this.lastUpdateAt ? Math.min(0.1, (now - this.lastUpdateAt) / 1000) : 1 / 60;
    this.lastUpdateAt = now;
    // Step any edit sim being stroked or easing an undo/redo
    const stepDt = 1 / SIM_HZ;
    for (const e of this.entries.values()) {
      const id = e.beach.id;
      const sim = this.store.peek(id)?.sim;
      if (!sim || (!sim.strokeActive && !sim.easingActive)) continue;
      let acc = (this.editAcc.get(id) ?? 0) + dt;
      let n = 0;
      while (acc >= stepDt && n < 2) {
        sim.stepEdit(stepDt);
        acc -= stepDt;
        n++;
      }
      if (n === 2) acc = 0;
      this.editAcc.set(id, acc);
      if (n) this.store.edited(id, false);
    }
    if (!this.entries.size) {
      this.win = [0, 0];
      this.syncSeams();
      this.syncPiers();
      this.syncSections();
      return;
    }
    void this.fillWindow();
    this.syncSeams();
    this.syncPiers();
    this.syncSections();
    // infinite scroll: keep the shore loaded a few beaches past the view
    const c = this.nearestIndex(this.cam.focusX);
    const ext = this.extent;
    if (ext.left - c < AHEAD) void this.more('left');
    if (ext.right + c < AHEAD) void this.more('right');
    for (const e of this.entries.values()) {
      e.slot?.renderer?.update(p, camForward, time, simTime, tide, amp, now);
      // things that moved in a new snapshot glide to their new places
      e.slot?.objects?.glide(dt);
    }
  }
}
