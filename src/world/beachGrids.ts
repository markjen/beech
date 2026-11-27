import type { GridSpec } from '../config';
import { buildRestProfile } from '../sim/profile';
import { gridWithSand, sandRowsInGrid } from './sections';

/**
 * The grids a beach can have on this device: the square beach, deeper by
 * each sand row straight behind it (docs/INLAND_SECTIONS.md), all the same
 * width and cell size, and each one's rest beach (made once, then kept).
 */
export class BeachGrids {
  private readonly rests = new Map<number, Float32Array>();

  constructor(
    readonly base: GridSpec,
    private readonly seed: number,
    baseRest?: Float32Array,
  ) {
    if (baseRest) this.rests.set(base.ny, baseRest);
  }

  /** the grid with `k` sand rows */
  withSand(k: number): GridSpec {
    return gridWithSand(this.base, k);
  }

  /** the grid `ny` rows deep */
  deep(ny: number): GridSpec {
    return { ...this.base, ny };
  }

  /** how many sand rows a grid `ny` deep has */
  sandRows(ny: number): number {
    return sandRowsInGrid(ny, this.base.ny, this.base.dx);
  }

  /** the untouched beach on the grid `ny` rows deep (the rows behind continue the back of the beach) */
  rest(ny: number): Float32Array {
    let r = this.rests.get(ny);
    if (!r) {
      r = buildRestProfile(this.deep(ny), this.seed);
      this.rests.set(ny, r);
    }
    return r;
  }
}
