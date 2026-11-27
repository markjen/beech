import type { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { PIER } from '../config';
import { PROP_COLORS, type RGB } from '../palette';
import { ORIGIN_Z } from './beachRenderer';
import { box, finish } from './meshKit';

// The pier (docs/PIERS.md): a timber deck from the sand out over the water,
// on the middle of three of a player's beaches. Decorative: nothing in the
// simulation knows it's there, so waves and foam run between its pilings.
// Built in the beach's own frame: x across the beach (0 = its middle), y up,
// z = metres from the offshore edge + ORIGIN_Z, like everything else drawn.

export interface PierGeometry {
  deck: { P: number[]; I: number[] };
  pilings: { P: number[]; I: number[] };
  rails: { P: number[]; I: number[] };
}

/** The pier's three parts as raw geometry (pure, so a test can measure it). */
export function pierGeometry(): PierGeometry {
  const p = PIER;
  const z = (y: number) => y + ORIGIN_Z;
  const top = p.deckHeight;
  const mid = top - p.deckThickness / 2;
  const deck = { P: [] as number[], I: [] as number[] };
  const pilings = { P: [] as number[], I: [] as number[] };
  const rails = { P: [] as number[], I: [] as number[] };

  // the deck, the wider platform at its end, and the ramp down to the sand
  box(deck.P, deck.I, 0, mid, z((p.rampTopY + p.platformY) / 2), p.width, p.deckThickness, p.rampTopY - p.platformY);
  box(deck.P, deck.I, 0, mid, z((p.platformY + p.endY) / 2), p.platformWidth, p.deckThickness, p.platformY - p.endY);
  const run = p.landY - p.rampTopY;
  const rise = top - p.footHeight;
  const slope = Math.atan2(rise, run);
  // the ramp tilts about x: its far (landward) end goes down
  box(deck.P, deck.I, 0, (top + p.footHeight) / 2 - p.deckThickness / 2, z(p.rampTopY + run / 2), p.width, p.deckThickness, Math.hypot(run, rise), slope);
  // stringers under the deck, edge to edge
  for (const x of [-p.width / 2 + 0.15, p.width / 2 - 0.15]) {
    box(deck.P, deck.I, x, top - p.deckThickness - 0.09, z((p.rampTopY + p.endY) / 2), 0.12, 0.18, p.rampTopY - p.endY);
  }

  // paired pilings, from under the deck down into the seabed
  const pile = (x: number, y: number) => {
    const h = top - p.deckThickness - p.pilingDepth;
    box(pilings.P, pilings.I, x, p.pilingDepth + h / 2, z(y), p.pilingSize, h, p.pilingSize);
  };
  for (let y = p.rampTopY; y > p.platformY; y -= p.pilingStep) {
    pile(-p.width / 2 + 0.15, y);
    pile(p.width / 2 - 0.15, y);
  }
  for (const y of [p.platformY - 0.2, p.endY + 0.2]) {
    pile(-p.platformWidth / 2 + 0.15, y);
    pile(p.platformWidth / 2 - 0.15, y);
  }

  // rails: posts and a top rail along each side of the deck and round the end
  const post = (x: number, y: number) => box(rails.P, rails.I, x, top + p.railHeight / 2, z(y), 0.09, p.railHeight, 0.09);
  const railTop = top + p.railHeight;
  for (const s of [-1, 1]) {
    const x = (s * p.width) / 2 - s * 0.05;
    for (let y = p.rampTopY; y > p.platformY; y -= p.pilingStep / 2) post(x, y);
    box(rails.P, rails.I, x, railTop, z((p.rampTopY + p.platformY) / 2), 0.08, 0.07, p.rampTopY - p.platformY);
    box(rails.P, rails.I, x, top + p.railHeight * 0.5, z((p.rampTopY + p.platformY) / 2), 0.05, 0.05, p.rampTopY - p.platformY);
    const px = (s * p.platformWidth) / 2 - s * 0.05;
    for (const y of [p.platformY, (p.platformY + p.endY) / 2, p.endY]) post(px, y);
    box(rails.P, rails.I, px, railTop, z((p.platformY + p.endY) / 2), 0.08, 0.07, p.platformY - p.endY);
    // the platform's landward edge, outside the deck
    box(rails.P, rails.I, (s * (p.platformWidth + p.width)) / 4, railTop, z(p.platformY), (p.platformWidth - p.width) / 2, 0.07, 0.08);
    // the ramp's rail follows its slope
    box(rails.P, rails.I, x, (railTop + p.footHeight + p.railHeight) / 2, z(p.rampTopY + run / 2), 0.08, 0.07, Math.hypot(run, rise), slope);
    post(x, p.landY - 0.1);
  }
  // across the seaward end
  box(rails.P, rails.I, 0, railTop, z(p.endY), p.platformWidth, 0.07, 0.08);
  return { deck, pilings, rails };
}

/** Where a pier goes: the beach's world-X centre. */
export interface PierSpot {
  /** what it's for (a beach id, or a preview) */
  key: string;
  x: number;
  /** not placed yet: drawn see-through and paler */
  ghost?: boolean;
}

/**
 * Every pier in view. `sync` is given the piers that should show, and
 * builds, moves or drops meshes to match; the geometry is made once.
 */
export class PierLayer {
  private geometry: PierGeometry | null = null;
  /** the materials, solid and ghost, made when first needed */
  private mats = new Map<boolean, Record<keyof PierGeometry, ShaderMaterial>>();
  private shown = new Map<string, { x: number; ghost: boolean; root: Mesh; parts: Record<keyof PierGeometry, Mesh> }>();
  /** piers that left the view, hidden, to show again without a rebuild (they're all alike) */
  private spare: { x: number; ghost: boolean; root: Mesh; parts: Record<keyof PierGeometry, Mesh> }[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly material: (color: RGB, ghost: boolean) => ShaderMaterial,
  ) {}

  private matsFor(ghost: boolean): Record<keyof PierGeometry, ShaderMaterial> {
    let m = this.mats.get(ghost);
    if (!m) {
      m = {
        deck: this.material(PROP_COLORS.pierDeck, ghost),
        pilings: this.material(PROP_COLORS.pierPiling, ghost),
        rails: this.material(PROP_COLORS.pierRail, ghost),
      };
      this.mats.set(ghost, m);
    }
    return m;
  }

  private build(key: string, ghost: boolean): { root: Mesh; parts: Record<keyof PierGeometry, Mesh> } {
    const geometry = (this.geometry ??= pierGeometry());
    const mats = this.matsFor(ghost);
    const root = new Mesh(`pier:${key}`, this.scene);
    const part = (name: keyof PierGeometry): Mesh => {
      const g = geometry[name];
      const m = finish(this.scene, `pier:${key}:${name}`, [...g.P], [...g.I]);
      m.material = mats[name];
      m.parent = root;
      return m;
    };
    return { root, parts: { deck: part('deck'), pilings: part('pilings'), rails: part('rails') } };
  }

  /** How many are drawn as previews (e2e). */
  get ghosts(): number {
    let n = 0;
    for (const s of this.shown.values()) if (s.ghost) n++;
    return n;
  }

  sync(want: PierSpot[]): void {
    const keep = new Set(want.map((w) => w.key));
    for (const [key, s] of this.shown) {
      if (keep.has(key)) continue;
      this.shown.delete(key);
      if (this.spare.length < 3) {
        s.root.setEnabled(false);
        this.spare.push(s);
      } else s.root.dispose(false, false);
    }
    for (const w of want) {
      const ghost = !!w.ghost;
      let s = this.shown.get(w.key);
      // placed after its preview (or the other way round): the other look
      if (s && s.ghost !== ghost) {
        const mats = this.matsFor(ghost);
        for (const name of ['deck', 'pilings', 'rails'] as const) s.parts[name].material = mats[name];
        s.ghost = ghost;
      }
      if (!s) {
        s = this.spare.pop();
        if (s) {
          s.root.setEnabled(true);
          if (s.ghost !== ghost) {
            const mats = this.matsFor(ghost);
            for (const name of ['deck', 'pilings', 'rails'] as const) s.parts[name].material = mats[name];
            s.ghost = ghost;
          }
        } else s = { x: Number.NaN, ghost, ...this.build(w.key, ghost) };
        this.shown.set(w.key, s);
      }
      if (s.x !== w.x) {
        s.x = w.x;
        s.root.position.x = w.x;
      }
    }
  }

  get count(): number {
    return this.shown.size;
  }

  dispose(): void {
    this.sync([]);
    for (const s of this.spare) s.root.dispose(false, false);
    this.spare = [];
    for (const set of this.mats.values()) for (const m of Object.values(set)) m.dispose();
    this.mats.clear();
  }
}
