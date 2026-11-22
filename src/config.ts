// Central tuning constants. Everything that shapes the feel of the toy lives
// here so it can be tweaked in one place (and from the ?debug=1 panel).

export interface GridSpec {
  /** cells alongshore (world X) */
  nx: number;
  /** cells cross-shore (world Z). j = 0 is the offshore edge, j = ny-1 the back of the beach */
  ny: number;
  /** cell size in metres */
  dx: number;
}

export type QualityTier = 'low' | 'medium' | 'high';

/**
 * World footprint is fixed (32 m x 32 m); tiers only change resolution.
 * Until 2026-11 it was 32 x 24: the extra 8 m are sea, added on the offshore
 * side (older saves are padded on load, see sandCodec.fitWorld).
 */
export const WORLD_SIZE_X = 32;
export const WORLD_SIZE_Z = 32;
/** how much further out the sea goes than in the first (32 x 24) world */
export const EXTRA_SEA = 8;

export const GRID_TIERS: Record<QualityTier, GridSpec> = {
  low: { nx: 192, ny: 192, dx: WORLD_SIZE_X / 192 },
  medium: { nx: 256, ny: 256, dx: WORLD_SIZE_X / 256 },
  high: { nx: 320, ny: 320, dx: WORLD_SIZE_X / 320 },
};

/** Beach rest profile, in metres along the cross-shore axis measured from the offshore edge. */
export const PROFILE = {
  /** distance of the still-water shoreline from the offshore edge */
  shoreline: 8.5 + EXTRA_SEA,
  /** depth at the offshore edge (positive number): the same nearshore
   * profile as the old 8.5 m sea (1.4 m deep), continued 8 m further out */
  offshoreDepth: 2.36,
  /** swash slope (rise over run) */
  swashSlope: 1 / 12,
  /** berm crest height above sea level */
  bermHeight: 0.62,
  /** height at the very back of the beach */
  backHeight: 0.85,
  /** amplitude (m) of the alongshore shoreline wiggle (beach cusps) */
  cuspAmp: 0.45,
  /** wavelength (m) of the cusps */
  cuspLength: 7.5,
  /** how far below the rest surface you can dig before hitting "rock" */
  digDepthLimit: 1.2,
};

export const WAVES = {
  /** swell components: amplitude (m), period (s). Beat between them creates sets. */
  components: [
    { amp: 0.21, period: 9.0 },
    { amp: 0.14, period: 11.3 },
    { amp: 0.08, period: 7.4 },
  ],
  /** most a swell component's crests turn from square-on (radians): waves
   * come in at an angle and cross each other along the beach */
  maxAngle: 0.38,
  /** wave groups: slow swings of the whole swell (quiet spells and sets) */
  groups: [
    { amp: 0.3, period: 75 },
    { amp: 0.2, period: 190 },
  ],
  /** now and then a set much bigger than the rest (sharp peak every `period` s) */
  bigSet: { amp: 0.55, period: 330, sharpness: 8 },
  /** amplitude multiplier while "calm waves" is on */
  calmFactor: 0.25,
  /** tide amplitude (m) and period (s) */
  tideAmp: 0.18,
  tidePeriod: 600,
  /** rows of the offshore sponge layer that relax toward the forcing */
  spongeRows: 10,
  /** decorative wave speed used by the far ocean (m/s) */
  farSpeed: 3.6,
};

export const WATER = {
  gravity: 9.81,
  /** quadratic bed friction coefficient */
  friction: 0.012,
  /** additional linear damping of fluxes (1/s); below ~0.4 a checkerboard mode can grow */
  linearDamping: 0.5,
  /** linear damping in water deeper than ~1 m (offshore), so waves don't lose
   * their height crossing the extra sea */
  deepDamping: 0.12,
  /** depth used to cap wave speed in the flux update (keeps CFL comfortably safe) */
  maxFluxDepth: 0.9,
  /** below this depth a cell counts as dry */
  dryDepth: 0.004,
  /** substeps per sim tick */
  substeps: 2,
};

export const SAND = {
  /** angle of repose in degrees */
  reposeDry: 36,
  reposeDamp: 52,
  reposeSaturated: 17,
  /** fraction of excess moved per slump iteration */
  slumpRate: 0.35,
  slumpIterations: 2,
  /** seconds for wet sand to dry (time constant) */
  dryingTime: 25,
  /** capillary dampness: sand this far (m) above the water line stays damp */
  capillaryHeight: 0.35,
};

export const EROSION = {
  /** sediment capacity constant */
  capacity: 0.08,
  /** pick-up rate (1/s) */
  dissolve: 1.6,
  /** drop rate (1/s) */
  deposit: 1.2,
  /** minimum effective slope so flat but fast water can still carry a bit */
  minSlope: 0.02,
  /** time constant (s) of the slow return to the rest profile where water reaches */
  healingTime: 150,
};

export const BRUSH = {
  /** brush radius on screen, CSS pixels (constant regardless of zoom) */
  screenRadiusPx: 24,
  /** dig rate at the brush centre when first touching (m/s) */
  rateStart: 0.16,
  /** dig rate after holding (m/s) */
  rateHeld: 0.6,
  /** seconds of holding to reach the held rate */
  holdRamp: 1.2,
  /** pointer speed (m/s) above which holding counts as moving */
  moveSpeed: 0.6,
  /** bulldozer: blade radius as a multiple of the brush, and how fast it
   * pushes the sand back (fraction per metre of brush "depth") */
  flattenWidth: 1.5,
  flattenRate: 120,
  /** rim ring extends from R to rimOuter * R */
  rimOuter: 1.9,
  /** fraction of dug sand placed on the rim (rest is "carried away") */
  rimFraction: 0.85,
  /** minimum world radius in grid cells; zoom-in is limited so the brush never goes below this */
  minCells: 2.0,
  /** maximum world radius (m) at full zoom-out */
  maxRadius: 1.4,
};

export const CAMERA = {
  /** elevation of the view above the horizon (degrees) */
  elevation: 34,
  /** default rotation around the vertical axis (radians) */
  alpha: Math.PI * 0.75,
  /** largest allowed ortho half-height (m) */
  maxHalfHeight: 17,
  /** closest zoom: ortho half-height (m). Past the brush's own limit the brush
   * stops shrinking on the sand (it grows on screen instead). */
  minHalfHeight: 0.45,
  /** default ortho half-height (m) */
  defaultHalfHeight: 11,
  /** rotation snap step after a twist (radians) */
  snapStep: Math.PI / 4,
  radius: 80,
};

export const SIM_HZ = 30;
export const UNDO_DEPTH = 32;
