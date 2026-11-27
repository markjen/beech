// @ts-nocheck
// GENERATED from src/render/sectionShapes.ts by scripts/bundle-server.mjs. Do not edit: run `npm run bundle:server`.
/* eslint-disable */

var WORLD_SIZE_X = 32;
var EXTRA_SEA = 8;
var GRID_TIERS = {
  low: { nx: 192, ny: 192, dx: WORLD_SIZE_X / 192 },
  medium: { nx: 256, ny: 256, dx: WORLD_SIZE_X / 256 },
  high: { nx: 320, ny: 320, dx: WORLD_SIZE_X / 320 }
};
var PROFILE = {
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
  digDepthLimit: 1.2
};
var CAMERA = {
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
  radius: 120
};
var WEATHER = {
  /** how often the app asks the server for the weather (ms) */
  refreshMs: 15 * 60 * 1e3,
  /** a report older than this is ignored (ms) */
  staleMs: 3 * 60 * 60 * 1e3,
  /** real wave height (m) to swell scale: base + k × √height */
  waveBase: 0.35,
  waveK: 0.45,
  /** blend between the beach's usual swell (0) and the measured sea (1) */
  waveTrust: 0.75,
  /** most an onshore wind adds to the swell scale (at windFull km/h) */
  windChop: 0.12,
  windFull: 45,
  /** the swell scale stays in the range the sim is tuned for */
  waveMin: 0.4,
  waveMax: 1.15,
  /** how much a full overcast dims the sunlight */
  overcastDim: 0.45,
  /** the light keeps this share of its colour under full cloud */
  overcastKeep: 0.35,
  /** how fast the shown weather follows a new report (per second) */
  easePerSecond: 0.08,
  /** rain drops and snowflakes at full strength */
  maxDrops: 260
};
var SECTION = {
  /** each row's depth, inland (its width is the beach's) */
  depth: 12,
  /** the ground's height: the beach's own back edge (PROFILE.backHeight) */
  ground: 0.85,
  /** how far down the slab's sides go (the beach's own slab bottom) */
  bottom: -2.6
};

var hex = (h) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};
var PALETTES = [
  {
    name: "dawn",
    skyTop: hex("#a9b8e0"),
    skyBottom: hex("#f7d2c4"),
    sun: hex("#ffe0cc"),
    sunDir: [0.6, -0.55, 0.45],
    ambient: hex("#b9a9c9"),
    shadow: hex("#9c86a8"),
    sandDry: hex("#f2d9bd"),
    sandWet: hex("#c7a68f"),
    sandDeep: hex("#d9b99a"),
    strataA: hex("#e7c3a4"),
    strataB: hex("#d2a58c"),
    rock: hex("#8c7a95"),
    waterShallow: hex("#9fe3d8"),
    waterDeep: hex("#4f9fb3"),
    foam: hex("#fdf8f4"),
    farOcean: hex("#6fa9c3"),
    fog: hex("#f2d4cb"),
    ui: hex("#7a6584")
  },
  {
    name: "day",
    skyTop: hex("#8fd0e6"),
    skyBottom: hex("#fbeedd"),
    sun: hex("#fff5e6"),
    sunDir: [0.35, -0.8, 0.5],
    ambient: hex("#a8c6d6"),
    shadow: hex("#93a9c4"),
    sandDry: hex("#f6e3c3"),
    sandWet: hex("#cdb08e"),
    sandDeep: hex("#e0c49d"),
    strataA: hex("#efd2a8"),
    strataB: hex("#d8b088"),
    rock: hex("#8a97a8"),
    waterShallow: hex("#8ff0de"),
    waterDeep: hex("#2fa4bb"),
    foam: hex("#ffffff"),
    farOcean: hex("#4cb2cc"),
    fog: hex("#f7ead9"),
    ui: hex("#5f7287")
  },
  {
    name: "golden",
    skyTop: hex("#f0a98f"),
    skyBottom: hex("#fde3b3"),
    sun: hex("#ffd29a"),
    sunDir: [-0.55, -0.45, 0.55],
    ambient: hex("#c79a9a"),
    shadow: hex("#b07f86"),
    sandDry: hex("#f8d4a2"),
    sandWet: hex("#c99373"),
    sandDeep: hex("#e2b07f"),
    strataA: hex("#eebb8a"),
    strataB: hex("#d49274"),
    rock: hex("#9a7385"),
    waterShallow: hex("#9fdcca"),
    waterDeep: hex("#3d8ea8"),
    foam: hex("#fff3e3"),
    farOcean: hex("#5a99b0"),
    fog: hex("#fbd9b0"),
    ui: hex("#8a5f6b")
  },
  {
    name: "dusk",
    skyTop: hex("#4a4f85"),
    skyBottom: hex("#e59a9a"),
    sun: hex("#f3b8b0"),
    sunDir: [-0.7, -0.35, 0.35],
    ambient: hex("#7d77a6"),
    shadow: hex("#5f5a8a"),
    sandDry: hex("#d9b2b0"),
    sandWet: hex("#9c8091"),
    sandDeep: hex("#bb95a0"),
    strataA: hex("#c79ba3"),
    strataB: hex("#a8808f"),
    rock: hex("#5c5880"),
    waterShallow: hex("#88c9cf"),
    waterDeep: hex("#3a6c96"),
    foam: hex("#f6e9f0"),
    farOcean: hex("#46709a"),
    fog: hex("#c98f9f"),
    ui: hex("#e9d6e6")
  },
  {
    name: "night",
    skyTop: hex("#141a3a"),
    skyBottom: hex("#3a3f6e"),
    sun: hex("#a9bdf0"),
    // moonlight
    sunDir: [0.3, -0.85, 0.4],
    ambient: hex("#3c4778"),
    shadow: hex("#363d6a"),
    sandDry: hex("#a39db8"),
    sandWet: hex("#6f6b8e"),
    sandDeep: hex("#8a84a2"),
    strataA: hex("#8f89a8"),
    strataB: hex("#76718f"),
    rock: hex("#363a60"),
    waterShallow: hex("#6fb0d6"),
    waterDeep: hex("#1b3566"),
    foam: hex("#f2f6ff"),
    farOcean: hex("#203c6c"),
    fog: hex("#4a4f80"),
    ui: hex("#dfe4ff")
  }
];
var PROP_COLORS = {
  rock: [hex("#b3aeb4"), hex("#a59cab"), hex("#bfb2a6"), hex("#9ba3a8")],
  driftwood: [hex("#e0d2bd"), hex("#cfbfa8"), hex("#eae0d2")],
  shell: [hex("#fdf2e1"), hex("#f0c09a"), hex("#e6d3ae"), hex("#f5e7c8")],
  seaglass: [hex("#9fd8c0"), hex("#a8d4e6"), hex("#e8c27a"), hex("#e6f0ee")],
  /** bright plastic: a crumpled bottle or can reads as litter, never as a shell or sea glass */
  trash: [hex("#e63329"), hex("#1f8fff"), hex("#22b573"), hex("#ffcf00")],
  /** dark olive and green-brown strands */
  seaweed: [hex("#4a5d23"), hex("#3d4a1f"), hex("#5d6b2a"), hex("#6b5e2f")],
  flag: [hex("#f07f6b"), hex("#f4c95d"), hex("#5fb8b2"), hex("#8f7fd1")],
  conch: [hex("#f6c7b6"), hex("#f2dcc4"), hex("#e9b4a8")],
  sanddollar: [hex("#efe6d4"), hex("#e8dcc6")],
  starfish: [hex("#ef8a5f"), hex("#d9645a"), hex("#f2a65a")],
  bottle: [hex("#8fc9b3"), hex("#9cc3d9")],
  nautilus: [hex("#e8d5c4"), hex("#d9a06b"), hex("#c97e5a")],
  /** a striped beach ball: bright panels alternate with white (variant picks the bright colour) */
  beachball: [hex("#e8443a"), hex("#fbf3e4"), hex("#2f8fd0"), hex("#f5c542")],
  /** sandals: [sole, strap] per variant — teal with an orange strap, coral with a navy strap */
  sandals: [hex("#2f8f7a"), hex("#f08a4b"), hex("#e86a5a"), hex("#2f4a6b")],
  /** a pail: red or blue, by variant */
  bucket: [hex("#d8473b"), hex("#2f8fd0")],
  /** a branching coral fragment: deep brick reds — darker and redder than
      the starfish's orange, and never the sunset starfish's magenta */
  coral: [hex("#c73e2e"), hex("#a82e28"), hex("#d95a3a")],
  /** a coconut: dark browns, a shade darker than driftwood */
  coconut: [hex("#6b4a2f"), hex("#7d5a38")],
  /** deckchair canvas stripes (frame uses `pole`) */
  deckchair: [hex("#4f86c6"), hex("#e46f5a"), hex("#3fa58f")],
  // the shop: [main, accent, trim, lamp]
  parasol: [hex("#f06b5a"), hex("#fbf3e4")],
  surfboard: [hex("#f2efe3"), hex("#2f8fd0")],
  sandcastle: [hex("#e9cf9c"), hex("#e0533f")],
  beachhut: [hex("#6cc3d5"), hex("#f2f0e8"), hex("#e46f5a")],
  lighthouse: [hex("#f4f1ea"), hex("#d8473b"), hex("#3c4652"), hex("#ffe6a8")],
  tikitorch: [hex("#8a5a33"), hex("#ffb347")],
  /** a palm: fronds, then the coconuts at the top (the trunk uses `pole`) */
  palmtree: [hex("#3f8f4f"), hex("#6b4a2f")],
  /** a lifeguard tower: white frame, red cabin, navy roof */
  lifeguardtower: [hex("#f2f0e8"), hex("#d8473b"), hex("#2f4a6b")],
  /** a bonfire: grey stones, then the flame (the logs use `pole`) */
  bonfire: [hex("#9aa0a8"), hex("#ff8c2e")],
  /** a hammock: the slung cloth (the posts use `pole`) */
  hammock: [hex("#e86a5a")],
  /** a striped towel: teal cloth, white stripes */
  towel: [hex("#2f8f7a"), hex("#fbf3e4")],
  /** footprints pressed into the sand: darker than dry sand, so the
      trail reads as a dip rather than something sitting on it */
  footprints: [hex("#b08d68"), hex("#a5825f"), hex("#c09a72")],
  pole: hex("#d8c7ae"),
  /** a pier (docs/PIERS.md): weathered deck planks, darker wet pilings, pale rails */
  pierDeck: hex("#a8927a"),
  pierPiling: hex("#6f6052"),
  pierRail: hex("#c9b89f"),
  /** inland sections (docs/INLAND_SECTIONS.md, src/render/sections.ts) */
  secSoil: hex("#c9a985"),
  secSand: hex("#f2dcbc"),
  secTrail: hex("#e6c9a2"),
  secGrass: hex("#9dbb7a"),
  secGrassDark: hex("#7c9f62"),
  secLeaf: hex("#6f9a58"),
  secTrunk: hex("#7d6450"),
  secPlank: hex("#b89b7c"),
  secRail: hex("#d9c8ae"),
  secPave: hex("#a7a6a8"),
  secAsphalt: hex("#6d6e75"),
  secCurb: hex("#d6d3cc"),
  secLine: hex("#f7f4ea"),
  secLineYellow: hex("#f0c75a"),
  secPlay: hex("#d98a6a"),
  secPlayBright: hex("#5aa6d8"),
  secPlayYellow: hex("#f2c14e"),
  secMetal: hex("#8d96a0"),
  secGravel: hex("#d8cdbd"),
  secTable: hex("#a07656"),
  secWall: [hex("#f3e6d3"), hex("#cfe3e6"), hex("#f2d0c4"), hex("#e6e0b8"), hex("#d9d4ec")],
  secAwning: [hex("#d8473b"), hex("#2f7f8f"), hex("#e0a13a"), hex("#4f7a4a"), hex("#7a5aa6")],
  secRoof: hex("#c79f8a"),
  secGlass: hex("#7f9fb3"),
  /** the rolled-up message inside a bottle */
  paper: hex("#f7efd9")
};
var RARITY_GLOW = {
  rare: hex("#7cc4ff"),
  legendary: hex("#ffcf5a"),
  unique: hex("#c06fd6")
};
var ITEM_LOOKS = {
  // A spotted cowrie: deep chestnut and caramel browns with a polished
  // sheen — disjoint from the free shell palette (warm cream, tan and
  // peach) and from the pink shell, and never pink.
  cowrie: { colors: [hex("#5d3a1a"), hex("#8a5a2b"), hex("#c98f4e")], gloss: 0.5 },
  // Week 1 vending set ("First light", server/src/vending.ts).
  "pink-shell": { colors: [hex("#f27ba7"), hex("#ef5d8f"), hex("#f8a8c4"), hex("#e8437a")], gloss: 0.45 },
  "blue-seaglass": { colors: [hex("#2f7fc9"), hex("#1f6fb8"), hex("#4aa3e0"), hex("#185a9e")], gloss: 0.8 },
  pebble: { colors: [hex("#5a5f6b"), hex("#6e7683"), hex("#3f4650"), hex("#7d838e")], gloss: 0.6 },
  "spiral-conch": { colors: [hex("#e86a4a"), hex("#f08a4b"), hex("#d94f30"), hex("#f2a65a")], gloss: 0.5 },
  "gold-sanddollar": { colors: [hex("#d4a017"), hex("#e8b923"), hex("#f5c542"), hex("#b8860b")], gloss: 1, glow: "legendary" },
  "sunset-starfish": { colors: [hex("#ff7e3d"), hex("#e84a7a"), hex("#b84a8f"), hex("#ffb347")], gloss: 0.4 },
  "green-bottle": { colors: [hex("#0f7a4d"), hex("#15965f"), hex("#0a5c38"), hex("#1fae6e")], gloss: 0.9 },
  // the claw's unique prize: same colours as the kind palette, with a pearl sheen
  nautilus: { colors: [hex("#e8d5c4"), hex("#d9a06b"), hex("#c97e5a")], gloss: 0.7 }
};
var ANIMAL_COLORS = {
  crab: {
    shell: hex("#e05b40"),
    claws: hex("#f26e4a"),
    legs: hex("#d47a54"),
    belly: hex("#f2cbb0"),
    eyes: hex("#231e24")
  },
  treat: {
    crumb: hex("#e6b96c"),
    shrimp: hex("#f28c6b"),
    kelp: hex("#5b7a3a")
  },
  dolphin: {
    back: hex("#5d84a6"),
    belly: hex("#d2e2ed"),
    fin: hex("#4a6e8f"),
    eyes: hex("#1e2228")
  },
  sandpiper: {
    back: hex("#9a8466"),
    belly: hex("#f4efe4"),
    wing: hex("#7d6a50"),
    beak: hex("#2b2622"),
    legs: hex("#3a332c")
  },
  octopus: {
    body: hex("#d9603f"),
    arms: hex("#e2775a"),
    /** what it blends to when still (sandy shallows) */
    camo: hex("#c9b48c"),
    eyes: hex("#231e24"),
    ink: hex("#2a2433")
  },
  seal: {
    back: hex("#8d8a86"),
    belly: hex("#c9c3b8"),
    spots: hex("#5f5c5a"),
    eyes: hex("#1c1a1a")
  },
  turtle: {
    shell: hex("#6f7f43"),
    scutes: hex("#8c9a52"),
    skin: hex("#a89b6a"),
    belly: hex("#e3d7a5"),
    eyes: hex("#1d1d18"),
    track: hex("#b89f74")
  }
};
var WEATHER_COLORS = {
  /** a grey, overcast sky (day) */
  overcastSky: hex("#b9bec4"),
  /** the horizon under cloud */
  overcastHorizon: hex("#cfd2d4"),
  /** storm clouds */
  stormSky: hex("#6b7179"),
  /** sea fog */
  fog: hex("#dfe2e3"),
  /** grey-green water under cloud */
  greySea: hex("#5d7c80"),
  /** cloud puffs drawn on the sky backdrop */
  cloud: hex("#f4f5f6"),
  cloudShade: hex("#9aa1a8"),
  /** rain streaks and snowflakes */
  rain: hex("#dde6ee"),
  snow: hex("#ffffff")
};

function rng(seed) {
  let s = (Math.imul(seed | 0, 2654435761) ^ 2654435769) >>> 0;
  return () => {
    s = Math.imul(s ^ s >>> 15, 2246822507) + 1831565813 >>> 0;
    s ^= s >>> 13;
    return (s >>> 0) / 4294967296;
  };
}
function box(P, I, cx, cy, cz, sx, sy, sz, tilt = 0) {
  const b = P.length / 3;
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  for (const [x, y, z] of [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1]
  ]) {
    const ly = y * sy / 2;
    const lz = z * sz / 2;
    P.push(cx + x * sx / 2, cy + ly * c - lz * s, cz + ly * s + lz * c);
  }
  for (const f of [[0, 1, 2, 0, 2, 3], [4, 6, 5, 4, 7, 6], [0, 4, 5, 0, 5, 1], [3, 2, 6, 3, 6, 7], [0, 3, 7, 0, 7, 4], [1, 5, 6, 1, 6, 2]])
    for (const k of f) I.push(b + k);
}

var HALF = WORLD_SIZE_X / 2;
function colorOf(key) {
  const m = /^(secWall|secAwning)(\d+)$/.exec(key);
  if (m) {
    const list = PROP_COLORS[m[1]];
    return list[Number(m[2]) % list.length];
  }
  return PROP_COLORS[key];
}
function sectionGeometry(type, joinNeg, joinPos, seed = 1) {
  const D = SECTION.depth;
  const G = SECTION.ground;
  const parts = /* @__PURE__ */ new Map();
  const put = (c, cx, cy, cz, sx, sy, sz, tilt = 0) => {
    let g = parts.get(c);
    if (!g) parts.set(c, g = { P: [], I: [] });
    box(g.P, g.I, cx, cy, cz, sx, sy, sz, tilt);
  };
  const flat = (c, x0, x1, z0, z1, h = 0.04, lift = 0) => put(c, (x0 + x1) / 2, G + lift + h / 2, (z0 + z1) / 2, x1 - x0, h, z1 - z0);
  const post = (c, x, z, h, w = 0.1, base = G) => put(c, x, base + h / 2, z, w, h, w);
  const railX = (c, x0, x1, z, y, t = 0.07) => put(c, (x0 + x1) / 2, y, z, Math.abs(x1 - x0), t, t);
  const railZ = (c, x, z0, z1, y, t = 0.07) => put(c, x, y, (z0 + z1) / 2, t, t, Math.abs(z1 - z0));
  const r = rng(seed * 7919 + type.length);
  const tuft = (tx, tz, s = 1) => {
    const x = Math.min(HALF - 0.4, Math.max(-HALF + 0.4, tx));
    const z = Math.min(D - 0.4, Math.max(0.4, tz));
    const h = (0.35 + r() * 0.35) * s;
    put(r() < 0.5 ? "secGrass" : "secGrassDark", x, G + h / 2, z, 0.12 * s, h, 0.12 * s, (r() - 0.5) * 0.5);
    put("secGrass", x + 0.12 * s, G + h * 0.4, z + 0.08, 0.1 * s, h * 0.8, 0.1 * s, (r() - 0.5) * 0.6);
  };
  const shrub = (x, z, s = 1) => {
    put("secLeaf", x, G + 0.35 * s, z, 0.9 * s, 0.7 * s, 0.9 * s);
    put("secGrassDark", x + 0.15 * s, G + 0.65 * s, z - 0.1 * s, 0.55 * s, 0.4 * s, 0.6 * s);
  };
  const tree = (x, z, s = 1) => {
    post("secTrunk", x, z, 2.2 * s, 0.25 * s);
    put("secLeaf", x, G + 2.7 * s, z, 2.4 * s, 1.4 * s, 2.4 * s);
    put("secGrassDark", x, G + 3.5 * s, z, 1.6 * s, 0.9 * s, 1.6 * s);
  };
  const bench = (x, z, alongX = true) => {
    const [w, d] = alongX ? [1.6, 0.45] : [0.45, 1.6];
    put("secTable", x, G + 0.45, z, w, 0.07, d);
    for (const s of [-1, 1]) put("secTrunk", x + (alongX ? s * 0.65 : 0), G + 0.21, z + (alongX ? 0 : s * 0.65), 0.08, 0.42, 0.08);
  };
  const picnicTable = (x, z) => {
    put("secTable", x, G + 0.75, z, 1.8, 0.06, 0.8);
    for (const s of [-1, 1]) {
      put("secTable", x, G + 0.45, z + s * 0.65, 1.8, 0.05, 0.3);
      put("secTrunk", x + s * 0.7, G + 0.37, z, 0.08, 0.74, 0.9);
    }
  };
  const span = (inset) => [joinNeg ? -HALF : -HALF + inset, joinPos ? HALF : HALF - inset];
  const ends = (fn) => {
    if (!joinNeg) fn(-1, -HALF);
    if (!joinPos) fn(1, HALF);
  };
  const groundColor = type === "section-path" || type === "section-picnic" || type === "section-playground" ? "secGrass" : type === "section-road" || type === "section-shops" ? "secCurb" : "secSand";
  put("secSoil", 0, (G - 0.05 + SECTION.bottom) / 2, D / 2, WORLD_SIZE_X, G - 0.05 - SECTION.bottom, D);
  flat(groundColor, -HALF, HALF, 0, D, 0.05, -0.05);
  switch (type) {
    case "section-sand": {
      ends((s, e) => {
        put("secTrail", e - s * 0.9, G + 0.12, D / 2, 1.8, 0.24, D);
        put("secTrail", e - s * 0.5, G + 0.3, D / 2, 1, 0.25, D - 0.6);
        for (let z = 0.6; z < D; z += 0.9 + r() * 0.6) tuft(e - s * (0.3 + r() * 1.2), z);
      });
      break;
    }
    case "section-boardwalk": {
      const top = G + 0.5;
      const z0 = 4;
      const z1 = 8;
      const [a, b] = span(4);
      put("secPlank", (a + b) / 2, top - 0.06, (z0 + z1) / 2, b - a, 0.12, z1 - z0);
      for (let x = Math.ceil(a / 0.6) * 0.6; x < b; x += 0.6) put("secTrunk", x, top + 2e-3, (z0 + z1) / 2, 0.03, 0.01, z1 - z0);
      for (let x = a + 1; x < b; x += 2.5) for (const z of [z0 + 0.15, z1 - 0.15]) post("secTrunk", x, z, top - G - 0.12, 0.16);
      const gap = (x) => Math.abs(x) < 1.3;
      for (const z of [z0 + 0.05, z1 - 0.05]) {
        for (let x = a + 0.05; x <= b; x += 2) if (!gap(x)) post("secRail", x, z, 0.9, 0.08, top);
        railX("secRail", a, -1.25, z, top + 0.9);
        railX("secRail", 1.25, b, z, top + 0.9);
      }
      const ramp = (zFrom, zTo) => {
        const run = Math.abs(zTo - zFrom);
        const ang = Math.atan2(top - G, run) * Math.sign(zTo - zFrom);
        put("secPlank", 0, (top + G) / 2 - 0.06, (zFrom + zTo) / 2, 2.4, 0.1, Math.hypot(run, top - G), ang);
      };
      ramp(z0, 0.6);
      ramp(z1, D - 0.6);
      ends((s, e) => {
        const x = e - s * 4;
        put("secPlank", x - s * 1.6, top - 0.06, D / 2, 3.2, 0.12, 6.4);
        for (const z of [D / 2 - 3.2, D / 2 + 3.2]) for (const dx of [0.2, 1.6, 3]) post("secTrunk", x - s * dx, z, top - G - 0.12, 0.16);
        railX("secRail", x, x - s * 3.2, D / 2 - 3.15, top + 0.9);
        railX("secRail", x, x - s * 3.2, D / 2 + 3.15, top + 0.9);
        railZ("secRail", x - s * 0.05, D / 2 - 3.2, D / 2 + 3.2, top + 0.9);
        for (const z of [D / 2 - 3.15, D / 2, D / 2 + 3.15]) post("secRail", x - s * 0.05, z, 0.9, 0.08, top);
        put("secTable", x - s * 1.2, top + 0.45, D / 2, 0.45, 0.07, 1.6);
        put("secTrunk", x - s * 1.2, top + 0.22, D / 2, 0.4, 0.44, 1.2);
        for (let z = 1; z < D; z += 1.5) tuft(e - s * (0.6 + r() * 2.4), z);
      });
      break;
    }
    case "section-path": {
      const z0 = 3.5;
      const z1 = 8.5;
      const [a, b] = span(6);
      flat("secPave", a, b, z0, z1, 0.06);
      for (let x = Math.ceil(a / 3) * 3 + 0.75; x < b - 1; x += 3) flat("secLine", x - 0.75, x + 0.75, D / 2 - 0.07, D / 2 + 0.07, 0.07);
      flat("secPave", -1.2, 1.2, 0, z0, 0.06);
      flat("secPave", -1.2, 1.2, z1, D, 0.06);
      for (let x = a + 1.5; x < b; x += 4 + r() * 2) if (Math.abs(x) > 2.5) shrub(x, 1.4 + r() * 0.6, 0.8);
      for (let x = a + 3; x < b - 1; x += 5 + r() * 2) if (Math.abs(x) > 2.5) tree(x, D - 2, 0.8);
      ends((s, e) => {
        const cx = e - s * 4.5;
        flat("secPave", Math.min(cx - 3.2, cx + 3.2), Math.max(cx - 3.2, cx + 3.2), D / 2 - 3.6, D / 2 + 3.6, 0.06);
        flat("secPave", Math.min(cx - 2.4, cx + 2.4), Math.max(cx - 2.4, cx + 2.4), D / 2 - 4.3, D / 2 + 4.3, 0.06);
        flat("secGrass", cx - 1.4, cx + 1.4, D / 2 - 1.4, D / 2 + 1.4, 0.12);
        shrub(cx, D / 2, 0.9);
        for (let z = 0.8; z < D - 0.8; z += 1.6) shrub(e - s * 0.7, z, 0.6 + r() * 0.3);
      });
      break;
    }
    case "section-playground": {
      const [a, b] = span(2.5);
      flat("secPlay", a, b, 1, D - 1, 0.06);
      for (const z of [1, D - 1]) {
        for (let x = a + 0.1; x <= b - 0.1; x += 2) if (Math.abs(x) > 1.4) post("secRail", x, z, 0.8, 0.08);
        railX("secRail", a, -1.4, z, G + 0.8);
        railX("secRail", 1.4, b, z, G + 0.8);
        railX("secRail", a, -1.4, z, G + 0.4, 0.05);
        railX("secRail", 1.4, b, z, G + 0.4, 0.05);
      }
      const swing = (cx, cz) => {
        for (const s of [-1, 1]) {
          put("secMetal", cx + s * 1.6, G + 1.1, cz - 0.5, 0.08, 2.3, 0.08, 0.25);
          put("secMetal", cx + s * 1.6, G + 1.1, cz + 0.5, 0.08, 2.3, 0.08, -0.25);
        }
        railX("secMetal", cx - 1.6, cx + 1.6, cz, G + 2.2, 0.1);
        for (const s of [-0.7, 0.7]) {
          put("secMetal", cx + s, G + 1.4, cz, 0.03, 1.6, 0.03);
          put("secPlayBright", cx + s, G + 0.6, cz, 0.5, 0.05, 0.25);
        }
      };
      const slide = (cx, cz) => {
        for (const dx of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) post("secMetal", cx + dx, cz + dz, 1.8, 0.1);
        put("secPlayYellow", cx, G + 1.5, cz, 1.2, 0.08, 1.2);
        put("secPlayYellow", cx, G + 2.2, cz, 1.3, 0.12, 1.3);
        const run = 2.8;
        const ang = Math.atan2(1.4, run);
        put("secPlayBright", cx, G + 0.8, cz + 0.6 + run / 2, 0.7, 0.08, Math.hypot(run, 1.4), ang);
        for (const s of [-0.35, 0.35]) put("secPlayBright", cx + s, G + 0.95, cz + 0.6 + run / 2, 0.06, 0.2, Math.hypot(run, 1.4), ang);
        for (let y = 0.3; y < 1.5; y += 0.3) railZ("secMetal", cx - 0.6, cz - 0.35, cz + 0.35, G + y, 0.05);
      };
      swing(-8, D / 2);
      slide(5, D / 2 - 1.5);
      for (const dx of [-0.6, 0.6]) for (const dz of [-0.6, 0.6]) post("secPlayYellow", 1 + dx, D / 2 + 2.5 + dz, 1.2, 0.08);
      put("secPlayBright", 1, G + 1.2, D / 2 + 2.5, 1.3, 0.08, 1.3);
      put("secPlayYellow", -2.5, G + 0.25, D / 2 + 2, 1.2, 0.5, 1.2);
      put("secSand", -2.5, G + 0.3, D / 2 + 2, 1, 0.5, 1);
      ends((s, e) => {
        const x = e - s * 2.5;
        for (let z = 1; z <= D - 1; z += 2) post("secRail", x, z, 0.8, 0.08);
        railZ("secRail", x, 1, D - 1, G + 0.8);
        railZ("secRail", x, 1, D - 1, G + 0.4, 0.05);
        for (let z = 1.8; z < D - 1; z += 2.2) shrub(e - s * 1.1, z, 0.8);
        bench(e - s * 1.2, 0.5);
      });
      break;
    }
    case "section-road": {
      const [a, b] = span(1.5);
      flat("secCurb", a, b, 0.6, 2.8, 0.16);
      flat("secCurb", a, b, D - 2.8, D - 0.6, 0.16);
      flat("secAsphalt", a, b, 2.8, D - 2.8, 0.04);
      for (let x = Math.ceil(a / 4) * 4 + 1; x < b - 1; x += 4) flat("secLineYellow", x - 1, x + 1, D / 2 - 0.06, D / 2 + 0.06, 0.05);
      for (const z of [3, D - 3]) flat("secLine", a + (joinNeg ? 0 : 3), b - (joinPos ? 0 : 3), z - 0.05, z + 0.05, 0.05);
      for (let z = 3.2; z < D - 3; z += 0.7) flat("secLine", -1.2, 1.2, z, z + 0.35, 0.05);
      for (let x = a + 4; x < b; x += 8) if (Math.abs(x) > 3) post("secMetal", x, 1, 3.2, 0.12);
      ends((s, e) => {
        const cx = e - s * 4;
        flat("secAsphalt", Math.min(cx - 2.5, cx + 2.5), Math.max(cx - 2.5, cx + 2.5), 2.2, D - 2.2, 0.04);
        put("secCurb", e - s * 1.3, G + 0.1, D / 2, 0.3, 0.2, D - 1.2);
        flat("secGrass", Math.min(e, e - s * 1.15), Math.max(e, e - s * 1.15), 0.6, D - 0.6, 0.18);
        for (let z = 1.2; z < D; z += 2) shrub(e - s * 0.6, z, 0.6);
      });
      break;
    }
    case "section-shops": {
      flat("secCurb", -HALF, HALF, 0, 4, 0.12);
      const [a, b] = span(4.5);
      const widths = [];
      for (let x2 = a; x2 < b - 0.5; ) {
        const w = Math.min(b - x2, 5 + Math.floor(r() * 3));
        widths.push(w);
        x2 += w;
      }
      let x = a;
      widths.forEach((w, i) => {
        const h = 3 + r() * 1.8;
        const k = Math.floor(r() * 5) + i;
        const cx = x + w / 2;
        put(`secWall${k}`, cx, G + h / 2, 7.5, w - 0.12, h, 7);
        put("secRoof", cx, G + h + 0.08, 7.5, w, 0.16, 7.2);
        put("secGlass", cx, G + 1.2, 3.99, w - 1.2, 1.4, 0.04);
        put("secTrunk", cx + w / 2 - 1.1, G + 1, 3.99, 0.9, 2, 0.05);
        put(`secAwning${k}`, cx, G + 2.6, 3.4, w - 0.3, 0.06, 1.4, -0.35);
        x += w;
      });
      ends((s, e) => {
        const ex = e - s * 4.5;
        put("secGlass", ex - s * 0.01, G + 1.2, 6, 0.04, 1.4, 2.5);
        for (const z of [1.4, 2.9]) {
          const cx = e - s * 2.2;
          put("secTable", cx, G + 0.72, z, 0.7, 0.05, 0.7);
          post("secMetal", cx, z, 0.7, 0.06, G + 0.12);
          for (const d of [-0.6, 0.6]) put("secTable", cx + d, G + 0.45, z, 0.4, 0.05, 0.4);
        }
        post("secMetal", e - s * 2.2, 2.15, 2.3, 0.05, G + 0.12);
        put("secAwning0", e - s * 2.2, G + 2.4, 2.15, 2.2, 0.06, 2.2);
        for (let z = 5; z < D; z += 1.8) shrub(e - s * 2, z, 0.9);
      });
      break;
    }
    case "section-dunes": {
      const [a, b] = span(2);
      flat("secTrail", a, b, D / 2 - 0.7, D / 2 + 0.7, 0.03);
      flat("secTrail", -0.7, 0.7, 0, D, 0.03);
      for (const [z0, z1] of [[0.4, D / 2 - 1.2], [D / 2 + 1.2, D - 0.4]]) {
        for (let x = -HALF + 1.2; x < HALF - 0.6; x += 2.3 + r() * 1.5) {
          if (Math.abs(x) < 1.6) continue;
          const z = Math.max(z0 + 0.7, Math.min(z1 - 0.7, z0 + r() * (z1 - z0)));
          put("secTrail", x, G + 0.1, z, 1.6 + r(), 0.25, 1.2 + r() * 0.8);
          for (let k = 0; k < 4; k++) tuft(x + (r() - 0.5) * 1.6, z + (r() - 0.5) * 1.2);
        }
      }
      ends((s, e) => {
        const x = e - s * 1.4;
        const pts = [0.6, 3, 5.2, D / 2 - 0.9, D / 2 + 0.9, 8.8, 11.4];
        for (const z of pts) {
          const off = Math.abs(z - D / 2) < 1 ? 0.9 : 0.25 * Math.sin(z / D * Math.PI);
          post("secTrunk", x - s * off, z, 0.9, 0.12);
        }
        for (let i = 0; i + 1 < pts.length; i++) {
          if (pts[i] === D / 2 - 0.9) continue;
          const za = pts[i];
          const zb = pts[i + 1];
          const xa = x - s * (Math.abs(za - D / 2) < 1 ? 0.9 : 0.25 * Math.sin(za / D * Math.PI));
          const xb = x - s * (Math.abs(zb - D / 2) < 1 ? 0.9 : 0.25 * Math.sin(zb / D * Math.PI));
          const len = Math.hypot(xb - xa, zb - za);
          for (const y of [0.45, 0.8]) {
            const P = [];
            const I = [];
            box(P, I, 0, 0, 0, 0.07, 0.07, len);
            const ang = Math.atan2(xb - xa, zb - za);
            let g = parts.get("secTrunk");
            if (!g) parts.set("secTrunk", g = { P: [], I: [] });
            const base = g.P.length / 3;
            for (let k = 0; k < P.length; k += 3) {
              const px = P[k];
              const pz = P[k + 2];
              g.P.push((xa + xb) / 2 + px * Math.cos(ang) + pz * Math.sin(ang), G + y + P[k + 1], (za + zb) / 2 - px * Math.sin(ang) + pz * Math.cos(ang));
            }
            for (const v of I) g.I.push(base + v);
          }
        }
        for (let z = 0.8; z < D; z += 1.2) tuft(e - s * (0.3 + r() * 0.6), z, 1.2);
      });
      break;
    }
    case "section-picnic": {
      const [a, b] = span(5);
      flat("secGravel", a, b, D / 2 - 1, D / 2 + 1, 0.05);
      flat("secGravel", -1, 1, 0, D, 0.05);
      for (let x = a + 2; x < b - 1; x += 6) {
        if (Math.abs(x) < 2.5) continue;
        tree(x, 2.4, 1);
        picnicTable(x + 2.2, 3.4);
        tree(x + 3, D - 2.2, 0.9);
        picnicTable(x, D - 3.4);
      }
      ends((s, e) => {
        const cx = e - s * 3;
        flat("secGravel", Math.min(cx - 3, cx + 3), Math.max(cx - 3, cx + 3), D / 2 - 3, D / 2 + 3, 0.05);
        picnicTable(cx, D / 2);
        tree(e - s * 1.5, D / 2 - 3.6, 1.1);
        tree(e - s * 1.5, D / 2 + 3.6, 1);
        bench(cx, D / 2 - 2.4);
        bench(cx, D / 2 + 2.4);
      });
      break;
    }
  }
  return parts;
}
export {
  PROP_COLORS,
  SECTION,
  colorOf,
  sectionGeometry
};
