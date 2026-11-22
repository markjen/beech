import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';

import { WORLD_SIZE_X, type GridSpec } from '../config';
import type { CameraController } from '../input/cameraController';
import type { Account, Neighbor, Neighbors, Side } from '../net/account';
import { NeighborApi } from '../net/account';
import type { Palette } from '../palette';
import { decodeSand, resampleField } from '../sim/sandCodec';
import type { SwellComponent } from '../sim/waves';
import { beachById } from '../world/locations';
import type { PlacedObject } from '../sim/objects';
import { BeachRenderer } from './beachRenderer';
import { ObjectView } from './objects';

interface Loaded {
  delta: Float32Array;
  objects: PlacedObject[];
  name: string;
  who: string;
  updatedAt: number | null;
}

/** gap between dioramas, so each beach reads as its own little island */
const GAP = 1.6;
export const NEIGHBOR_OFFSET = WORLD_SIZE_X + GAP;

interface Slot {
  side: Side;
  renderer: BeachRenderer;
  delta: Float32Array;
  objects: ObjectView;
  label: HTMLDivElement;
  name: string;
  /** who is there, and when they last saved (to spot new saves) */
  who: string;
  updatedAt: number | null;
  placed: number;
}

/** how often to look for new saves on the beaches next door */
const POLL_MS = 30000;

/**
 * The beaches on either side of yours, drawn as still snapshots of their
 * last save (their own sand; your sky, sea and tide), each with a name tag.
 * Facing the sea, "left" is world +X (your right hand points to -X).
 */
export class NeighborView {
  readonly api: NeighborApi;
  private slots = new Map<Side, Slot>();
  private tide = 0;
  private lastTideRefresh = 0;
  state: Neighbors | null = null;
  private listeners: ((n: Neighbors | null) => void)[] = [];
  /** bumps on every refresh/clear so a slow, older refresh can't overwrite a newer one */
  private generation = 0;
  private chairView = false;
  private pollTimer = 0;
  private polling = false;

  constructor(
    private readonly scene: Scene,
    private readonly grid: GridSpec,
    private readonly rest: Float32Array,
    private readonly swell: SwellComponent[],
    private readonly cam: CameraController,
    private readonly uiRoot: HTMLElement,
    account: Account,
  ) {
    this.api = new NeighborApi(account);
  }

  onChange(fn: (n: Neighbors | null) => void): void {
    this.listeners.push(fn);
  }

  static offsetFor(side: Side): number {
    return side === 'left' ? NEIGHBOR_OFFSET : -NEIGHBOR_OFFSET;
  }

  /** Reload the neighbor list and their beaches from the server. */
  async refresh(): Promise<void> {
    const gen = ++this.generation;
    let n: Neighbors | null = null;
    try {
      n = await this.api.get();
    } catch {
      n = null;
    }
    if (gen !== this.generation) return;
    // fetch both beaches first, then swap them in together
    const loaded = new Map<Side, Loaded | null>();
    for (const side of ['left', 'right'] as Side[]) {
      const who = n?.[side] ?? null;
      loaded.set(side, who ? await this.load(side, who) : null);
    }
    if (gen !== this.generation) return;
    this.state = n;
    for (const [side, next] of loaded) {
      if (this.slots.has(side)) this.drop(side);
      if (next) this.add(side, next);
    }
    this.updateBounds();
    for (const fn of this.listeners) fn(n);
    this.schedulePoll();
  }

  /** Fetch and decode one neighbor's latest save. */
  private async load(side: Side, who: Neighbor): Promise<Loaded> {
    const saved = who.location ? await this.api.beach(side).catch(() => null) : null;
    let delta: Float32Array = new Float32Array(this.grid.nx * this.grid.ny);
    let objects: PlacedObject[] = [];
    if (saved) {
      try {
        const d = await decodeSand(saved.bytes);
        delta = resampleField(d.delta, d.nx, d.ny, this.grid.nx, this.grid.ny);
        objects = d.objects;
      } catch {
        /* unreadable save: show their beach untouched */
      }
    }
    const place = who.location ? beachById(who.location) : undefined;
    return {
      delta,
      objects,
      name: `${who.name || 'a neighbor'}${place ? ` · ${place.name}` : ''}`,
      who: who.id,
      updatedAt: saved?.updatedAt ?? who.updatedAt,
    };
  }

  private schedulePoll(): void {
    window.clearTimeout(this.pollTimer);
    if (!this.state) return;
    this.pollTimer = window.setTimeout(() => void this.poll().finally(() => this.schedulePoll()), POLL_MS);
  }

  /**
   * Live-ish neighbors: look for new saves next door and swap in the new
   * sand. Cheap when nothing changed (one small request). Skipped while the
   * app is in the background.
   */
  async poll(): Promise<void> {
    if (this.polling || document.hidden || !this.state) return;
    this.polling = true;
    const gen = this.generation;
    try {
      const n = await this.api.get();
      if (gen !== this.generation) return;
      for (const side of ['left', 'right'] as Side[]) {
        const who = n[side];
        const slot = this.slots.get(side);
        if ((who?.id ?? null) !== (slot?.who ?? null)) {
          // someone moved in or away: start over
          await this.refresh();
          return;
        }
        if (!who || !slot || who.updatedAt === slot.updatedAt) continue;
        const next = await this.load(side, who);
        if (gen !== this.generation) return;
        this.replace(side, next);
      }
      this.state = { ...this.state, ...n };
    } catch {
      /* offline: try again next time */
    } finally {
      this.polling = false;
    }
  }

  /** What's shown next door (for tests). */
  snapshot(side: Side): { who: string; updatedAt: number | null; objects: number } | null {
    const s = this.slots.get(side);
    return s ? { who: s.who, updatedAt: s.updatedAt, objects: s.placed } : null;
  }

  clear(): void {
    this.generation++;
    window.clearTimeout(this.pollTimer);
    for (const side of [...this.slots.keys()]) this.drop(side);
    this.state = null;
    this.updateBounds();
    for (const fn of this.listeners) fn(null);
  }

  setChairView(on: boolean): void {
    this.chairView = on;
    for (const s of this.slots.values()) s.renderer.setChairView(on);
  }

  private add(side: Side, l: Loaded): void {
    const { delta, name } = l;
    const renderer = new BeachRenderer(this.scene, this.grid, this.rest, this.swell, NeighborView.offsetFor(side));
    renderer.setChairView(this.chairView);
    const objects = new ObjectView(this.scene, renderer, NeighborView.offsetFor(side));
    objects.setStatic(l.objects, (x, y) => this.heightAt(delta, x, y));
    const label = document.createElement('div');
    label.className = 'neighbor-tag';
    label.textContent = name;
    this.uiRoot.appendChild(label);
    const slot: Slot = { side, renderer, delta, objects, label, name, who: l.who, updatedAt: l.updatedAt, placed: l.objects.length };
    this.slots.set(side, slot);
    this.paint(slot);
  }

  /** A new save from the same neighbor: repaint in place (no flicker). */
  private replace(side: Side, l: Loaded): void {
    const s = this.slots.get(side);
    if (!s) return;
    s.delta = l.delta;
    s.updatedAt = l.updatedAt;
    s.placed = l.objects.length;
    s.objects.setStatic(l.objects, (x, y) => this.heightAt(l.delta, x, y));
    if (l.name !== s.name) {
      s.name = l.name;
      s.label.textContent = l.name;
    }
    this.paint(s);
  }

  private drop(side: Side): void {
    const s = this.slots.get(side);
    if (!s) return;
    s.objects.dispose();
    s.renderer.dispose();
    s.label.remove();
    this.slots.delete(side);
  }

  private updateBounds(): void {
    const half = WORLD_SIZE_X / 2;
    this.cam.maxX = this.slots.has('left') ? NEIGHBOR_OFFSET + half : half;
    this.cam.minX = this.slots.has('right') ? -NEIGHBOR_OFFSET - half : -half;
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
  private paint(s: Slot): void {
    const n = this.grid.nx * this.grid.ny;
    const buf = new Float32Array(n * 4);
    for (let k = 0, o = 0; k < n; k++, o += 4) {
      const sand = this.rest[k] + s.delta[k];
      const water = Math.max(0, this.tide - sand);
      buf[o] = sand;
      buf[o + 1] = water;
      buf[o + 2] = water > 0.004 ? 1 : Math.max(0, Math.min(0.8, 1 - (sand - this.tide) / 0.35));
      buf[o + 3] = 0;
    }
    s.renderer.showStatic(buf);
  }

  /** Per frame: shared lighting/sea, slow tide refresh, name tags follow the slabs. */
  update(p: Palette, camForward: Vector3, time: number, simTime: number, tide: number, amp: number): void {
    if (!this.slots.size) return;
    const now = performance.now();
    if (Math.abs(tide - this.tide) > 0.01 && now - this.lastTideRefresh > 5000) {
      this.tide = tide;
      this.lastTideRefresh = now;
      for (const s of this.slots.values()) this.paint(s);
    }
    const engine = this.scene.getEngine();
    const cam = this.scene.activeCamera!;
    const vp = cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const scale = engine.getHardwareScalingLevel();
    for (const s of this.slots.values()) {
      s.renderer.update(p, camForward, time, simTime, tide, amp);
      const at = Vector3.Project(
        new Vector3(s.renderer.offsetX, 1.4, 0),
        Matrix.Identity(),
        this.scene.getTransformMatrix(),
        vp,
      );
      const x = at.x * scale;
      const y = at.y * scale;
      const visible = at.z > 0 && at.z < 1 && x > -100 && x < window.innerWidth + 100;
      s.label.style.display = visible ? 'block' : 'none';
      if (visible) s.label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    }
  }
}
