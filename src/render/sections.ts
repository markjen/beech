import type { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { SECTION, WORLD_SIZE_Z } from '../config';
import type { RGB } from '../palette';
import { ORIGIN_Z } from './beachRenderer';
import { finish } from './meshKit';
import { colorOf, SAND_GROUND_KEY, sectionGeometry, type ColorKey, type SectionParts } from './sectionShapes';
import { sandRowsOf } from '../world/sections';

export { colorOf, SAND_GROUND_KEY, sectionGeometry, type SectionParts };

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
/** how many beaches' rows are kept hidden after they leave the view, to show again without a rebuild */
const SPARE = 6;

export class SectionLayer {
  private mats = new Map<string, ShaderMaterial>();
  /** the ground that is beach sand: one material, painted with the live
      sandDry by the renderer instead of the fixed fallback colour */
  private sandMat?: ShaderMaterial;
  private shown = new Map<string, { sig: string; x: number; root: Mesh }>();
  /** rows that left the view, by key and layout, oldest first */
  private spare = new Map<string, { sig: string; x: number; root: Mesh }>();

  constructor(
    private readonly scene: Scene,
    private readonly material: (color: RGB) => ShaderMaterial,
    private readonly sandMaterial?: () => ShaderMaterial,
  ) {}

  private mat(key: ColorKey): ShaderMaterial {
    if (key === SAND_GROUND_KEY) {
      // without a live-sand material, fall back to the fixed colour
      if (!this.sandMaterial) return this.propMat(key);
      if (!this.sandMat) this.sandMat = this.sandMaterial();
      return this.sandMat;
    }
    return this.propMat(key);
  }

  private propMat(key: ColorKey): ShaderMaterial {
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
    // sand rows straight behind the beach are the beach's own sand, not
    // scenery: the ones the grid hasn't drawn yet (a preview, or a beach
    // still refitting after a save) show as plain sand, like they will be
    const sandRows = sandRowsOf(spot.rows.map((r) => r.type));
    spot.rows.forEach((row, i) => {
      if (i < (spot.from ?? 0)) return;
      const z0 = rowZ(i);
      const plainSand = row.type === 'section-sand' && i < sandRows;
      for (const [key, g] of sectionGeometry(row.type, row.neg, row.pos, i + 1, plainSand ? { plainSand: true } : undefined)) {
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
      this.shown.delete(key);
      if (keep.has(key)) {
        s.root.dispose(false, false); // a new layout: this one won't be back
        continue;
      }
      // scrolled out of view: keep it a while, scrolling back is common
      s.root.setEnabled(false);
      this.spare.set(`${key}|${s.sig}`, s);
      for (const [k, old] of this.spare) {
        if (this.spare.size <= SPARE) break;
        old.root.dispose(false, false);
        this.spare.delete(k);
      }
    }
    for (const w of want) {
      if (w.rows.length <= (w.from ?? 0)) continue;
      let s = this.shown.get(w.key);
      if (!s) {
        const sig = sigOf(w);
        const k = `${w.key}|${sig}`;
        s = this.spare.get(k);
        if (s) {
          this.spare.delete(k);
          s.root.setEnabled(true);
        } else s = { sig, x: Number.NaN, root: this.build(w) };
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
    for (const s of this.spare.values()) s.root.dispose(false, false);
    this.spare.clear();
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
    this.sandMat?.dispose();
    this.sandMat = undefined;
  }
}
