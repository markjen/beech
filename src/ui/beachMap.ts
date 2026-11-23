import { beachById, type Beach } from '../world/locations';

/**
 * A small stylized world map for the settings panel's beach list.
 *
 * Beaches already carry real geography: each one is a place in
 * `src/world/locations.ts` with a longitude and latitude, so the map plots
 * your beaches where they really are — no new location data was needed.
 *
 * The map is self-contained inline SVG (equirectangular projection, no
 * tiles, no network): a faint land silhouette with a gold dot per beach.
 * Left is west, right is east, so the dots read in the same order as the
 * list underneath. The coastline is deliberately simplified — recognizable,
 * not surveyed — while the dots sit at the beaches' true lon/lat.
 */

/** View box of the map, 2:1 like the projection. */
export const MAP_WIDTH = 360;
export const MAP_HEIGHT = 180;

/** Latitude range shown: Antarctica is cropped, the Arctic coast kept. */
const LAT_TOP = 84;
const LAT_BOTTOM = -60;

const LON_MIN = -180;
const LON_MAX = 180;

/** Equirectangular projection: lon → x, lat → y (north up). */
export function project(lon: number, lat: number): { x: number; y: number } {
  const lo = Math.min(LON_MAX, Math.max(LON_MIN, lon));
  const la = Math.min(LAT_TOP, Math.max(LAT_BOTTOM, lat));
  return {
    x: ((lo - LON_MIN) / (LON_MAX - LON_MIN)) * MAP_WIDTH,
    y: ((LAT_TOP - la) / (LAT_TOP - LAT_BOTTOM)) * MAP_HEIGHT,
  };
}

/**
 * Simplified continent outlines as [lon, lat] polygons. Stylized on
 * purpose: enough to recognize the world, not enough to navigate by.
 * Small islands (Hawaii, Bali, Phuket) are left out — their dots mark them.
 */
export const CONTINENTS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  // North America
  [
    [-168, 66], [-162, 60], [-155, 58], [-150, 60], [-142, 60], [-135, 57], [-130, 54],
    [-126, 49], [-124, 42], [-121, 36], [-117, 33], [-112, 29], [-109, 25], [-105, 20],
    [-100, 17], [-95, 16], [-92, 15], [-88, 14], [-84, 12], [-81, 9], [-79, 9],
    [-81, 13], [-84, 16], [-87, 20], [-90, 21], [-91, 18], [-96, 18], [-97, 25],
    [-94, 29], [-90, 29], [-85, 30], [-82, 28], [-80, 26], [-80, 31], [-77, 34],
    [-75, 38], [-74, 40], [-71, 41], [-69, 44], [-66, 45], [-61, 46], [-56, 47],
    [-60, 52], [-64, 58], [-68, 58], [-73, 62], [-78, 62], [-85, 66], [-92, 66],
    [-95, 69], [-105, 68], [-115, 69], [-125, 70], [-135, 69], [-145, 70], [-155, 71],
    [-163, 70], [-168, 66],
  ],
  // South America
  [
    [-79, 9], [-77, 4], [-80, -3], [-81, -6], [-78, -11], [-74, -16], [-71, -19],
    [-70, -23], [-70, -30], [-72, -37], [-73, -43], [-74, -49], [-70, -54], [-66, -55],
    [-68, -50], [-66, -45], [-63, -41], [-59, -35], [-54, -33], [-49, -28], [-42, -23],
    [-39, -17], [-36, -10], [-35, -6], [-38, -4], [-43, -2], [-48, 0], [-51, 3],
    [-54, 6], [-58, 8], [-63, 10], [-68, 11], [-73, 10], [-77, 8], [-79, 9],
  ],
  // Africa
  [
    [-17, 15], [-17, 21], [-15, 27], [-10, 31], [-6, 34], [-1, 35], [3, 37], [9, 37],
    [11, 34], [14, 32], [19, 32], [25, 32], [30, 31], [32, 31], [34, 28], [36, 24],
    [38, 22], [40, 20], [43, 12], [47, 11], [51, 11], [48, 7], [43, 2], [40, -3],
    [40, -9], [39, -14], [37, -19], [34, -25], [30, -30], [26, -34], [20, -35],
    [17, -32], [15, -27], [13, -19], [12, -13], [12, -7], [9, 0], [9, 4], [5, 5],
    [-2, 5], [-7, 4], [-12, 7], [-16, 12], [-17, 15],
  ],
  // Eurasia, Iberia around the north coast to the Pacific and back along the Med
  [
    [-10, 36], [-9, 39], [-9, 43], [-3, 44], [-1, 46], [-4, 48], [-2, 49], [1, 51],
    [3, 53], [7, 54], [8, 57], [6, 58], [5, 60], [8, 62], [12, 64], [16, 66],
    [20, 69], [24, 71], [28, 71], [32, 70], [36, 68], [40, 67], [45, 68], [50, 69],
    [55, 69], [60, 69], [65, 70], [70, 72], [75, 73], [80, 73], [85, 74], [90, 75],
    [95, 76], [100, 77], [105, 77], [110, 74], [115, 73], [120, 73], [125, 72],
    [130, 71], [135, 72], [140, 72], [145, 72], [150, 70], [155, 69], [160, 69],
    [163, 66], [170, 66], [177, 65], [178, 64], [173, 63], [170, 60], [165, 59],
    [162, 57], [158, 53], [156, 51], [152, 56], [150, 59], [147, 59], [143, 59],
    [141, 54], [140, 48], [139, 45], [138, 42], [136, 38], [133, 35], [130, 33],
    [127, 31], [124, 31], [121, 28], [119, 25], [115, 23], [111, 21], [108, 18],
    [106, 12], [104, 9], [101, 7], [99, 9], [97, 13], [95, 16], [92, 21], [90, 22],
    [87, 21], [84, 18], [81, 15], [79, 12], [77, 8], [75, 11], [73, 16], [71, 20],
    [68, 22], [66, 25], [63, 25], [60, 25], [57, 26], [55, 27], [53, 27], [51, 28],
    [49, 30], [48, 29], [50, 26], [52, 25], [54, 24], [56, 24], [58, 23], [59, 22],
    [58, 20], [55, 17], [52, 15], [49, 14], [45, 13], [43, 12], [41, 15], [39, 20],
    [37, 24], [35, 28], [34, 30], [32, 31], [30, 36], [28, 37], [26, 38], [24, 36],
    [22, 37], [20, 40], [18, 42], [16, 44], [14, 45], [12, 44], [9, 44], [6, 43],
    [3, 43], [0, 44], [-2, 44], [-3, 47], [-5, 48], [-8, 48], [-10, 44], [-10, 39],
    [-10, 36],
  ],
  // Australia
  [
    [114, -22], [114, -30], [115, -33], [118, -35], [123, -33], [129, -32], [132, -32],
    [135, -35], [138, -35], [140, -38], [144, -38], [147, -39], [150, -37], [153, -32],
    [153, -27], [151, -24], [148, -20], [145, -15], [142, -11], [141, -13], [138, -12],
    [136, -15], [133, -12], [131, -12], [128, -14], [125, -14], [122, -17], [119, -20],
    [116, -21], [114, -22],
  ],
  // New Zealand, North Island
  [
    [173, -35], [174, -36], [175, -37], [177, -38], [178, -38], [177, -39], [176, -40],
    [175, -41], [174, -41], [173, -40], [173, -38], [173, -36], [173, -35],
  ],
  // New Zealand, South Island
  [
    [167, -45], [168, -44], [169, -43], [171, -42], [172, -41], [174, -42], [173, -43],
    [172, -44], [170, -45], [169, -46], [167, -46], [167, -45],
  ],
  // Great Britain
  [
    [-5, 50], [-4, 51], [-3, 53], [-5, 55], [-4, 57], [-2, 58], [0, 57], [1, 54],
    [1, 52], [0, 51], [-1, 50], [-3, 50], [-5, 50],
  ],
  // Honshu, Japan
  [
    [130, 31], [131, 32], [133, 34], [135, 34], [137, 35], [139, 35], [140, 36],
    [141, 38], [141, 40], [141, 42], [143, 42], [144, 44], [143, 43], [141, 41],
    [140, 39], [139, 37], [137, 37], [135, 35], [133, 34], [131, 33], [130, 31],
  ],
  // Greenland
  [
    [-45, 60], [-40, 64], [-35, 66], [-30, 68], [-25, 70], [-20, 70], [-22, 73],
    [-25, 76], [-30, 78], [-40, 80], [-50, 80], [-55, 76], [-58, 72], [-55, 68],
    [-52, 64], [-48, 60], [-45, 60],
  ],
];

/** The continent outlines as one SVG path `d` string. */
export function continentsPath(): string {
  return CONTINENTS.map((poly) =>
    poly.map(([lon, lat], i) => {
      const { x, y } = project(lon, lat);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ') + ' Z',
  ).join(' ');
}

export interface BeachLike {
  location: string | null;
}

function longitudeOf(b: BeachLike): number | undefined {
  return b.location ? beachById(b.location)?.lon : undefined;
}

/**
 * Beaches ordered west to east by the longitude of their real place.
 * Beaches with no place (not saved yet) or an unknown place sort last,
 * keeping their order relative to each other.
 */
export function sortBeachesWestToEast<T extends BeachLike>(beaches: readonly T[]): T[] {
  return beaches
    .map((b, i) => ({ b, i, lon: longitudeOf(b) }))
    .sort((a, b) => {
      if (a.lon === undefined && b.lon === undefined) return a.i - b.i;
      if (a.lon === undefined) return 1;
      if (b.lon === undefined) return -1;
      return a.lon - b.lon || a.i - b.i;
    })
    .map(({ b }) => b);
}

export interface MapPoint<T> {
  beach: T;
  place: Beach;
  /** True projected position from the beach's real lon/lat. */
  x: number;
  y: number;
  /**
   * Position actually drawn: same as x/y, except markers that would sit on
   * top of each other (two beaches at the same place) are nudged apart so
   * each stays tappable.
   */
  dx: number;
  dy: number;
}

/** Minimum on-screen gap between two markers, in map units. */
const MARKER_GAP = 12;

/**
 * Where each beach goes on the map, west to east. Beaches with no known
 * place come back in `unplaced` instead — the caller says so under the map
 * rather than silently dropping them.
 */
export function beachMapPoints<T extends BeachLike>(beaches: readonly T[]): {
  placed: MapPoint<T>[];
  unplaced: T[];
} {
  const placed: MapPoint<T>[] = [];
  const unplaced: T[] = [];
  for (const beach of sortBeachesWestToEast(beaches)) {
    const place = beach.location ? beachById(beach.location) : undefined;
    if (!place) {
      unplaced.push(beach);
      continue;
    }
    const { x, y } = project(place.lon, place.lat);
    placed.push({ beach, place, x, y, dx: x, dy: y });
  }
  // Nudge markers that would land on top of each other (same place twice).
  for (let i = 1; i < placed.length; i++) {
    const prev = placed[i - 1];
    const cur = placed[i];
    if (Math.abs(cur.dx - prev.dx) < MARKER_GAP && Math.abs(cur.dy - prev.dy) < MARKER_GAP) {
      cur.dx = Math.min(MAP_WIDTH - 6, prev.dx + MARKER_GAP);
    }
  }
  return { placed, unplaced };
}

export interface MapBeach extends BeachLike {
  id: string;
  name: string;
  home: boolean;
}

/**
 * The map itself: ocean, land silhouette, one tappable dot per beach.
 * The dot for the beach this device is showing is ringed and labelled;
 * the others show their name on hover / to a screen reader. Tapping (or
 * Enter/Space on a focused dot) opens that beach, exactly like its
 * "open here" row.
 */
export function renderBeachMap<T extends MapBeach>(
  beaches: readonly T[],
  currentId: string | null,
  onOpen: (id: string) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'beach-map';
  const { placed, unplaced } = beachMapPoints(beaches);
  if (!placed.length) return wrap;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Map of your beaches, west to east');
  const ocean = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  ocean.setAttribute('class', 'ocean');
  ocean.setAttribute('x', '0');
  ocean.setAttribute('y', '0');
  ocean.setAttribute('width', String(MAP_WIDTH));
  ocean.setAttribute('height', String(MAP_HEIGHT));
  svg.appendChild(ocean);
  const land = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  land.setAttribute('class', 'land');
  land.setAttribute('d', continentsPath());
  svg.appendChild(land);

  for (const p of placed) {
    const b = p.beach;
    const here = b.id === currentId;
    const label = `${b.name || (b.home ? 'home' : 'a beach')} · ${p.place.name}`;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `marker${here ? ' here' : ''}`);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', here ? `${label} (showing here)` : `Open ${label} here`);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = label;
    g.appendChild(title);
    if (here) {
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('class', 'ring');
      ring.setAttribute('cx', String(p.dx));
      ring.setAttribute('cy', String(p.dy));
      ring.setAttribute('r', '10');
      g.appendChild(ring);
    }
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class', 'dot');
    dot.setAttribute('cx', String(p.dx));
    dot.setAttribute('cy', String(p.dy));
    dot.setAttribute('r', here ? '6.5' : '6');
    g.appendChild(dot);
    if (here) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      const toRight = p.dx < MAP_WIDTH - 90;
      text.setAttribute('x', String(toRight ? p.dx + 14 : p.dx - 14));
      text.setAttribute('y', String(p.dy + 4));
      text.setAttribute('text-anchor', toRight ? 'start' : 'end');
      text.textContent = p.place.name;
      g.appendChild(text);
    }
    const open = () => {
      if (!here) onOpen(b.id);
    };
    g.addEventListener('click', open);
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
    svg.appendChild(g);
  }
  wrap.appendChild(svg);

  if (unplaced.length) {
    const note = document.createElement('div');
    note.className = 'status';
    note.textContent = `not on the map yet: ${unplaced.map((b) => b.name || 'a beach').join(', ')}`;
    wrap.appendChild(note);
  }
  return wrap;
}
