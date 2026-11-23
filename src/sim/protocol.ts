import type { GridSpec } from '../config';
import type { BrushMode, SimFlags, SimStats } from './beachSim';
import type { ObjectState, PlacedObject } from './objects';

/** Config sections the debug panel may change live (they're mirrored into the worker). */
export type TunableSection = 'WATER' | 'SAND' | 'EROSION' | 'BRUSH' | 'WAVES';

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
  | { type: 'tune'; section: TunableSection; key: string; value: number }
  | { type: 'return'; buf: Float32Array }
  | { type: 'bench' }
  /** ask for the player's sand (minus the rest beach) for saving */
  | { type: 'getSand'; id: number }
  /** replace the sand with a saved beach (same grid size) */
  | { type: 'setSand'; delta: Float32Array; objects?: PlacedObject[] }
  /** replace the whole beach with an imported one, as one undo step */
  | { type: 'importBeach'; delta: Float32Array; objects: PlacedObject[] }
  /** put an inventory item on the beach (undoable) */
  | { type: 'placeObject'; obj: Omit<PlacedObject, 'id'> }
  /** take one off again (undoable) */
  | { type: 'removeObject'; id: number }
  /** real-world sea state: diorama tide level (m) and swell multiplier */
  | { type: 'sea'; tide: number; waves: number };

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
  /** water volume on the beach face (m^3) */
  swash: number;
  /** things on the beach, where they are now */
  objects: ObjectState[];
  stats?: SimStats;
  tickMs: number;
}

/** Messages from the worker to the main thread. */
export type FromWorker =
  | { type: 'ready'; grid: GridSpec; rest: Float32Array; seed: number }
  | { type: 'bench'; msPerTickLow: number }
  | { type: 'sand'; id: number; delta: Float32Array; objects: PlacedObject[] }
  | ({ type: 'frame'; buf: Float32Array } & FrameInfo);
