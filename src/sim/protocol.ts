import type { GridSpec } from '../config';
import type { BrushMode, SimFlags, SimStats } from './beachSim';

/** Messages from the main thread to the simulation worker. */
export type ToWorker =
  | { type: 'init'; grid: GridSpec; seed: number; flags: Partial<SimFlags> }
  | { type: 'brush'; phase: 'start' | 'move'; x: number; y: number; r: number; mode: BrushMode }
  | { type: 'brush'; phase: 'end' | 'cancel' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' }
  | { type: 'flags'; flags: Partial<SimFlags> }
  | { type: 'pause'; paused: boolean }
  | { type: 'return'; buf: Float32Array };

export interface FrameInfo {
  /** sim time (s) */
  t: number;
  /** offshore sea surface (m) */
  eta: number;
  /** tide level (m) */
  tide: number;
  calmMix: number;
  undoCount: number;
  redoCount: number;
  digIntensity: number;
  stats?: SimStats;
  tickMs: number;
}

/** Messages from the worker to the main thread. */
export type FromWorker =
  | { type: 'ready'; grid: GridSpec; rest: Float32Array; seed: number }
  | ({ type: 'frame'; buf: Float32Array } & FrameInfo);
