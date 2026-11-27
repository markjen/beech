import type { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { SECTION, WORLD_SIZE_Z } from '../config';
import type { RGB } from '../palette';
import { ORIGIN_Z } from './beachRenderer';
import { finish } from './meshKit';
import { colorOf, sectionGeometry, type ColorKey, type SectionParts } from './sectionShapes';

export { colorOf, sectionGeometry, type SectionParts };

// Inland beach sections (docs/INLAND_SECTIONS.md): rows of scenery behind a
// beach, each a slab as wide as the beach and SECTION.depth deep. Row 0
// touches the back of the sand. Scenery only: nothing in the simulation
// knows they're there.
//
// Each row's left (-x) and right (+x) edge either joins the same section on
// a directly linked neighbor (the surface runs straight on) or ends in the
// type's finished edge. Every type has an access point in the middle of its
// front and back so different types connect inland.
//
// Geometry is built in the row's own frame: x across (0 = the beach's
// middle), y up, z = metres inland from the row's front edge. Parts are
// grouped by colour so a row is a handful of meshes.

/** Where a beach's rows go: its world-X centre and the types, front row first. */
export interface SectionSpot {
  /** what it's for (a beach id at a shore index, or a preview) */
  key: string;
  x: number;
  rows: { type: string; neg: boolean; pos: boolean }[];
  /** the rows before this one are sand the beach itself draws (its grid runs that deep) */
  from?: number;
}

/** The world z of the front of row `i` (row 0 meets the back of the sand). */
export const rowZ = (i: number): number => WORLD_SIZE_Z + ORIGIN_Z + i * SECTION.depth;

/**
 * Every beach's rows in view. `sync` is given the rows that should show,
 * and builds, moves or drops meshes to match.
 */
export class SectionLayer {
  private mats = new Map<string, ShaderMaterial>();
  private shown = new Map<string, { sig: string; x: number; root: Mesh }>();

  constructor(
    private readonly scene: Scene,
    private readonly material: (color: RGB) => ShaderMaterial,
  ) {}

  private mat(key: ColorKey): ShaderMaterial {
    const c = colorOf(key);
    const k = c.join(',');
    let m = this.mats.get(k);
    if (!m) this.mats.set(k, (m = this.material(c)));
    return m;
  }

  /** One mesh per colour for all of a beach's rows (few draw calls however many rows). */
  private build(spot: SectionSpot): Mesh {
    const root = new Mesh(`sections:${spot.key}`, this.scene);
    const byColor = new Map<string, { key: ColorKey; P: number[]; I: number[] }>();
    spot.rows.forEach((row, i) => {
      if (i < (spot.from ?? 0)) return;
      const z0 = rowZ(i);
      for (const [key, g] of sectionGeometry(row.type, row.neg, row.pos, i + 1)) {
        const ck = colorOf(key).join(',');
        let out = byColor.get(ck);
        if (!out) byColor.set(ck, (out = { key, P: [], I: [] }));
        const base = out.P.length / 3;
        for (let k = 0; k < g.P.length; k += 3) out.P.push(g.P[k], g.P[k + 1], g.P[k + 2] + z0);
        for (const v of g.I) out.I.push(base + v);
      }
    });
    for (const [ck, g] of byColor) {
      const m = finish(this.scene, `sections:${spot.key}:${ck}`, g.P, g.I);
      m.material = this.mat(g.key);
      m.parent = root;
    }
    return root;
  }

  sync(want: SectionSpot[]): void {
    const sigOf = (w: SectionSpot) =>
      w.rows
        .slice(w.from ?? 0)
        .map((r) => `${r.type}${r.neg ? '<' : ''}${r.pos ? '>' : ''}`)
        .join('|') + `@${w.from ?? 0}`;
    const keep = new Map(want.map((w) => [w.key, sigOf(w)]));
    for (const [key, s] of this.shown) {
      if (keep.get(key) === s.sig) continue;
      s.root.dispose(false, false);
      this.shown.delete(key);
    }
    for (const w of want) {
      if (w.rows.length <= (w.from ?? 0)) continue;
      let s = this.shown.get(w.key);
      if (!s) {
        s = { sig: sigOf(w), x: Number.NaN, root: this.build(w) };
        this.shown.set(w.key, s);
      }
      if (s.x !== w.x) {
        s.x = w.x;
        s.root.position.x = w.x;
      }
    }
  }

  /** how many rows are drawn (e2e), behind every beach or one beach */
  rows(beachId?: string): number {
    let n = 0;
    for (const [key, s] of this.shown) if (!beachId || key.startsWith(`${beachId}@`)) n += s.sig.split('@')[0].split('|').length;
    return n;
  }

  dispose(): void {
    this.sync([]);
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }
}
