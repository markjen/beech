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
  obj?: { op: 'add' | 'remove'; data: PlacedObject };
  /** objects a dozer or vacuum stroke swept up along its path (sand change too, or none) */
  removed?: PlacedObject[];
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
}
