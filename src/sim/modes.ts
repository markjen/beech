/** dig, build up, smooth, or bulldoze (flatten back to the untouched beach) */
export type CastleShape = 'round' | 'square';

export type BrushMode = 'dig' | 'pile' | 'smooth' | 'flatten' | 'dozer' | 'vacuum';

/**
 * The three modes of the sand tool: dig, build up a dune, or blend/rake.
 */
export type SandMode = 'dig' | 'pile' | 'smooth';
export const SAND_MODES: SandMode[] = ['dig', 'pile', 'smooth'];
export const isSandMode = (id: string): id is SandMode =>
  (SAND_MODES as string[]).includes(id);

/**
 * The three modes of the one top-level clearing tool: bulldoze (flatten + scoop
 * up what's in the blade's path), flatten the sand back to the untouched beach,
 * or vacuum (pick items up, sand untouched).
 */
export type ClearingMode = 'dozer' | 'flatten' | 'vacuum';
export const CLEARING_MODES: ClearingMode[] = ['dozer', 'flatten', 'vacuum'];
export const isClearingMode = (id: string): id is ClearingMode =>
  (CLEARING_MODES as string[]).includes(id);
