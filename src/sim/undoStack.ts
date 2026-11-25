import type { PlacedObject } from './objects';

/** A rectangular patch of sand height changes made by one stroke. */
export interface UndoEntry {
  i0: number;
  j0: number;
  w: number;
  h: number;
  /** sand height after - before, row-major w*h */
  delta: Float32Array;
  /** an object placed on / taken off the beach (no sand change) */
  /** an object placed, taken off, or moved (move: `prev` is where it was) */
  obj?: { op: 'add' | 'remove' | 'move'; data: PlacedObject; prev?: PlacedObject };
  /** objects a dozer or vacuum stroke swept up along its path (sand change too, or none) */
  removed?: PlacedObject[];
  /**
   * a whole beach replaced (an import): the objects before and after, and
   * the whole sand before (after = before + delta). Undo and redo restore
   * these exactly, rather than subtracting.
   */
  swap?: { before: PlacedObject[]; after: PlacedObject[]; sand: Float32Array; beforeCover?: Float32Array; afterCover?: Float32Array };
}

/** An undo stack's entries, to hand a beach's history between simulations (docs/BEACH_STORE.md). */
export interface UndoHistory {
  undos: UndoEntry[];
  redos: UndoEntry[];
}

/**
 * Undo/redo of stroke deltas. Undo *subtracts* a stroke's change rather than
 * restoring a snapshot, so wave erosion that happened since is kept.
 */
export class UndoStack {
  private undos: UndoEntry[] = [];
  private redos: UndoEntry[] = [];

  constructor(private readonly depth: number) {}

  push(e: UndoEntry): void {
    this.undos.push(e);
    if (this.undos.length > this.depth) this.undos.shift();
    this.redos.length = 0;
  }

  popUndo(): UndoEntry | undefined {
    const e = this.undos.pop();
    if (e) this.redos.push(e);
    return e;
  }

  popRedo(): UndoEntry | undefined {
    const e = this.redos.pop();
    if (e) this.undos.push(e);
    return e;
  }

  get undoCount(): number {
    return this.undos.length;
  }

  get redoCount(): number {
    return this.redos.length;
  }

  clear(): void {
    this.undos.length = 0;
    this.redos.length = 0;
  }

  /** The entries, oldest first (the stack keeps no copy: it starts empty). */
  take(): UndoHistory {
    const h = { undos: this.undos, redos: this.redos };
    this.undos = [];
    this.redos = [];
    return h;
  }

  /** Replace the entries with a handed-over history (trimmed to this stack's depth). */
  restore(h: UndoHistory): void {
    this.undos = h.undos.slice(-this.depth);
    this.redos = h.redos.slice(-this.depth);
  }
}
