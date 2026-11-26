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
  /** swell amplitude multiplier for each wave strength (beach settings);
   * lively is the beach's own swell */
  levels: { calm: 0.25, gentle: 0.6, lively: 1, surf: 1.3 },
  /** wave strength swing along the tide schedule: weaker at low tide (1 - swing),
   * stronger at high tide (1 + swing), skipped on near-tideless beaches */
  tideWaveSwing: 0.28,
  /** minimum tide excursion (m) before the tide modulates default wave strength */
  tideWaveMinRange: 0.15,
  /** upper clamp on waveScale passed into the sim */
  maxScale: 1.4,
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

export const SANDCASTLE = {
  radius: 0.9,
  height: 0.48,
  flatTop: 0.6,
};

export const BRUSH = {
  /** brush radius on screen, CSS pixels (constant regardless of zoom) */
  screenRadiusPx: 24,
  /** dig rate at the brush centre when first touching (m/s). Kept high on
   * purpose: dragging should dig a real trench, not just scratch the sand —
   * the old 0.16 barely moved anything while the finger was moving. */
  rateStart: 0.5,
  /** dig rate after holding (m/s) */
  rateHeld: 1.0,
  /** seconds of holding to reach the held rate */
  holdRamp: 0.6,
  /** pointer speed (m/s) above which holding counts as moving */
  moveSpeed: 0.6,
  /** bulldozer: blade radius as a multiple of the brush, and how fast it
   * pushes the sand back (fraction per metre of brush "depth"). 300 means one
   * pass of the blade flattens the sand under it at any drag speed — the old
   * 120 left a fast swipe half-flattened. Flattening converges on the rest
   * beach, so a higher rate can't overshoot, it just gets there sooner. */
  flattenWidth: 1.5,
  flattenRate: 300,
  /** rim ring extends from R to rimOuter * R */
  rimOuter: 1.9,
  /** fraction of dug sand placed on the rim (rest is "carried away") */
  rimFraction: 0.85,
  /** minimum world radius in grid cells; zoom-in is limited so the brush never goes below this */
  minCells: 2.0,
  /** maximum world radius (m) on the sand; past full zoom-out the brush stops growing on the sand */
  maxRadius: 2.2,
};

export const CAMERA = {
  /** elevation of the view above the horizon (degrees) */
  elevation: 34,
  /** default rotation around the vertical axis (radians) */
  alpha: Math.PI * 0.75,
  /** largest allowed ortho half-height (m) on wide screens */
  maxHalfHeight: 28,
  /** multiplier on single-beach fit height for max zoom-out on narrow screens */
  maxFitScale: 1.5,
  /** closest zoom: ortho half-height (m). Past the brush's own limit the brush
   * stops shrinking on the sand (it grows on screen instead). */
  minHalfHeight: 0.45,
  /** default ortho half-height (m) */
  defaultHalfHeight: 11,
  /** rotation snap step after a twist (radians) */
  snapStep: Math.PI / 4,
  radius: 120,
};

/**
 * The user guide, help and release notes live on the website, not in the game
 * (the game itself shows no explanatory notes). Served by the production
 * server (server/src/guide.ts); absolute so the apps and the sandbox reach it.
 */
export const GUIDE_URL = 'https://beech.games/guide';

/** longest note a visitor can leave (the server's NOTE_MAX, server/src/inbox.ts) */
export const NOTE_MAX_CHARS = 280;

/** Things you own that the sea can take (docs/LIVE_SIM.md, section 5). */
export const LOST_TO_SEA = {
  /** an owned floater or roller carried within this far (m) of the offshore edge is gone (back in the bag) */
  edge: 0.5,
};

/**
 * The catch-up: what the sea did to a beach while nobody had it open
 * (docs/LIVE_SIM.md, section 4). A coarse model of the live sim's healing
 * and wet slumping, stepped by half tide cycles.
 */
export const CATCHUP = {
  /** gaps shorter than this (min) aren't caught up */
  minGapMin: 10,
  /** most of a gap that's simulated (days); the server's CATCHUP_MAX_GAP_DAYS overrides it */
  maxGapDays: 14,
  /** a gap longer than this (h) first keeps the beach as its "Before the tide" checkpoint */
  tideCheckpointGapH: 12,
  /** tide sampling (min) used to find the half cycles */
  sampleMin: 20,
  /** how far above the still water the swash reaches (m), at waves = 1 */
  runup: 0.3,
  /** waves climb what's built in the swash: a mound is wetted as if it were this fraction of its height */
  overtop: 0.4,
  /** turns of healing then wet slumping per half cycle */
  rounds: 4,
  /** wet-slump passes per turn (at the saturated angle of repose) */
  slumpPasses: 5,
  /** an owned floater afloat this long (h) in all is taken by the sea */
  lostFloatH: 2,
  /** an owned roller (shells and the like) under water this long (h) is taken */
  lostRollH: 6,
  /** how far (m) a floater drifts along the shore per half cycle afloat, at waves = 1 */
  drift: 3,
};

export const SIM_HZ = 30;
export const UNDO_DEPTH = 32;

/**
 * Footprints (free item, `footprints`): one trail is this long at size 1 —
 * the mesh in src/render/objects.ts footprintsMesh spans -0.425..+0.425 m,
 * and the share picture in server/src/beachImage.ts draws the same trail.
 * Dragging with footprints in hand lays one trail per stride (see
 * src/world/footprints.ts), so the spacing follows from this length.
 */
export const FOOTPRINT_TRAIL_M = 0.85;
/** A single drag with the footprints tool lays down at most this many trails. */
export const FOOTPRINTS_PER_STROKE_MAX = 100;

/** The client's beach state, kept in memory by beach id (docs/BEACH_STORE.md). */
export const BEACH_STORE = {
  /** beaches held in memory (in view, fetched ahead and recently seen) before the least recently used goes (about 1 MB each, more once edited); at least what a full zoom-out draws plus the prefetch */
  capacity: 20,
  /** other people's beaches kept on the device as last fetched (IndexedDB; roughly 50–300 KB each) */
  diskCapacity: 40,
  /** save an edited beach this long after the last change (ms) */
  saveDelayMs: 4000,
  /** after a failed save, try again this much later (ms) */
  retryMs: 30000,
  /** the view must be this close to another beach's centre (m) before the waves move there */
  liveSwitchM: 10,
  /** when the waves move onto a beach, ease from its snapshot's water to the simulation's over this long (ms) */
  liveEaseMs: 1200,
  /** a viewer's copy of someone else's beach eases to each new save over this long (ms) */
  viewerEaseMs: 1000,
};

/** The sky over the shore: each beach shows its own real place's light. */
export const SHORE_LIGHT = {
  /**
   * Share of the way between two beach centres over which the light crosses
   * from one place to the next (the middle of the gap); each beach keeps its
   * own light either side of it.
   */
  blendSpan: 0.6,
};

/** Rare wild beach visitors (docs/ANIMALS.md). */
export const ANIMALS = {
  /** quiet wait between wild visit rolls (seconds): an animal is around about half the time */
  waitMin: 60,
  waitMax: 180,
  /** shorter first wait after boot, so a session usually meets an animal early */
  firstWaitMin: 20,
  firstWaitMax: 60,
  /** probability a visit actually starts when the quiet wait expires */
  visitChance: 0.85,
  /** how long a wild sand crab stays before burrowing away (seconds) */
  visitMin: 90,
  visitMax: 180,
  /** crab carapace width (metres — well larger than life so it reads in diorama view and on phones) */
  crabSize: 0.8,
  /** crab movement speeds (m/s): normal scurry and startled flee */
  crabSpeed: 1.2,
  crabFleeSpeed: 2.4,
  /** water depth (m) that makes the crab dart upslope toward drier sand */
  crabWetDepth: 0.035,
  /** distance (m) at which an active digging/building brush startles the crab */
  crabFleeRadius: 2.5,
  /** number of brush startles before the crab burrows away early */
  crabMaxStartles: 3,
  /** wild crabs spawn within this share of the half-width around the beach centre */
  spawnSpreadX: 0.45,
  /** margin (m) kept inside the 32x32 slab edges */
  edgeMargin: 1.5,
  /** how long an uneaten dropped snack lasts before expiring (seconds) */
  foodDuration: 900,
  /** maximum water depth (m) where a player can place a snack */
  snackMaxWaterDepth: 0.02,
  /** spawn-wait speedup while dropped food is acting as bait */
  foodBaitMultiplier: 4,
  /** distance (m) at which an active crab smells and seeks dropped food */
  foodNoticeRadius: 12,
  /** extra visit time (seconds) added when a wild crab eats a treat */
  foodExtendSec: 240,
  /** cap on remaining visit time (seconds) after feeding */
  foodMaxVisit: 420,
  /** seconds after eating during which the crab is calm around the brush */
  foodCalmSec: 60,
  /** reach (m) of a tap or long-press on the snack that's out, to pick it back up */
  snackReach: 0.3,
  /** share of unbaited wild visits that are an offshore dolphin instead of a sand crab */
  dolphinChance: 0.35,
  /** dolphin length scale (metres) */
  dolphinSize: 2.2,
  /** dolphin cruising speed alongshore (m/s) */
  dolphinSpeed: 2.4,
  /** minimum water depth (m) where a dolphin will swim */
  dolphinMinDepth: 0.6,
  /** peak height (m) of a dolphin breach arc above the water surface */
  dolphinBreachHeight: 1.15,
};

