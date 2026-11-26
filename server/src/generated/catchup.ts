// @ts-nocheck
// GENERATED from src/world/catchupBeach.ts by scripts/bundle-server.mjs. Do not edit: run `npm run bundle:server`.
/* eslint-disable */

var WORLD_SIZE_X = 32;
var WORLD_SIZE_Z = 32;
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
var WATER = {
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
  dryDepth: 4e-3,
  /** substeps per sim tick */
  substeps: 2
};
var SAND = {
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
  capillaryHeight: 0.35
};
var EROSION = {
  /** sediment capacity constant */
  capacity: 0.08,
  /** pick-up rate (1/s) */
  dissolve: 1.6,
  /** drop rate (1/s) */
  deposit: 1.2,
  /** minimum effective slope so flat but fast water can still carry a bit */
  minSlope: 0.02,
  /** time constant (s) of the slow return to the rest profile where water reaches */
  healingTime: 150
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
var CATCHUP = {
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
  drift: 3
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

var OBJECT_KINDS = [
  "rock",
  "driftwood",
  "shell",
  "seaglass",
  "trash",
  "seaweed",
  "flag",
  "conch",
  "sanddollar",
  "starfish",
  "bottle",
  "nautilus",
  "beachball",
  "sandals",
  "bucket",
  "coral",
  "coconut",
  "deckchair",
  "parasol",
  "surfboard",
  "sandcastle",
  "beachhut",
  "lighthouse",
  "tikitorch",
  "palmtree",
  "lifeguardtower",
  "bonfire",
  "hammock",
  "towel",
  "footprints"
];
var BEHAVIOUR = {
  rock: "rock",
  driftwood: "float",
  shell: "tumble",
  seaglass: "tumble",
  // trash and seaweed tumble like shells: the swash rolls them along,
  // then they settle on the sand
  trash: "tumble",
  seaweed: "tumble",
  flag: "fixed",
  conch: "tumble",
  sanddollar: "tumble",
  starfish: "tumble",
  // a message in a bottle floats like driftwood
  bottle: "float",
  // a nautilus shell sits and tumbles like the other shells
  nautilus: "tumble",
  // a beach ball floats like driftwood — light, so it rides high
  beachball: "float",
  // sandals tumble like shells: the swash slides them along, then leaves them
  sandals: "tumble",
  // a bucket sits upright where you put it, even when the water comes up
  bucket: "fixed",
  // a coral fragment tumbles like a shell: the swash rolls it along, then leaves it
  coral: "tumble",
  // a coconut floats like a bottle — round and buoyant, so it rides high
  coconut: "float",
  // a deckchair (and everything from the shop) is set up on the sand and stays there
  deckchair: "fixed",
  parasol: "fixed",
  surfboard: "fixed",
  sandcastle: "fixed",
  beachhut: "fixed",
  lighthouse: "fixed",
  tikitorch: "fixed",
  // the five new shop centrepieces: set up on the sand, staying put
  palmtree: "fixed",
  lifeguardtower: "fixed",
  bonfire: "fixed",
  hammock: "fixed",
  towel: "fixed",
  footprints: "wash"
};
var sandWashDepth = () => WATER.dryDepth * 2;
var MAX_WILD = 6;

function hash2(x, y, seed = 1) {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647 | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  h = h ^ h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise1(x, seed = 1) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash2(i, 0, seed);
  const b = hash2(i + 1, 0, seed);
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}
function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function restHeight(x, y, seed = 1) {
  const P = PROFILE;
  const wobble = P.cuspAmp * Math.sin(2 * Math.PI * x / P.cuspLength + 0.7) * 0.6 + (noise1(x / 9, seed) - 0.5) * P.cuspAmp * 1.6;
  const s = y - (P.shoreline + wobble);
  let h;
  if (s < 0) {
    const c = 2;
    const A = P.offshoreDepth / (Math.pow(P.shoreline + c, 2 / 3) - Math.pow(c, 2 / 3));
    h = -A * (Math.pow(-s + c, 2 / 3) - Math.pow(c, 2 / 3));
  } else {
    const swash = s * P.swashSlope;
    const bermStart = P.bermHeight / P.swashSlope;
    if (s < bermStart) {
      h = swash;
    } else {
      const t = s - bermStart;
      const crest = P.bermHeight + 0.08 * Math.sin(Math.min(1, t / 2.5) * Math.PI * 0.5);
      h = crest + (P.backHeight - P.bermHeight) * smoothstep(2.5, 14, t);
    }
    const k = smoothstep(bermStart - 1.5, bermStart + 1.5, s);
    h = h * (0.75 + 0.25 * k) + Math.min(swash, P.bermHeight + 0.05) * (0.25 - 0.25 * k);
  }
  const ripple = (hash2(Math.floor(x * 3), Math.floor(y * 3), seed + 7) - 0.5) * 4e-3;
  return h + ripple * smoothstep(0, 3, s);
}
function buildRestProfile(g, seed = 1) {
  const out = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      out[j * g.nx + i] = restHeight((i + 0.5) * g.dx, (j + 0.5) * g.dx, seed);
    }
  }
  return out;
}

var DEG = Math.PI / 180;
function halfCycles(tide, from, to) {
  const step = CATCHUP.sampleMin * 6e4;
  const n = Math.max(1, Math.ceil((to - from) / step));
  const ts = [];
  const ls = [];
  for (let i = 0; i <= n; i++) {
    const t = i === n ? to : from + i * step;
    ts.push(t);
    ls.push(tide(t));
  }
  const segs = [];
  let highTides = 0;
  let start = 0;
  let dir = 0;
  for (let i = 1; i <= n; i++) {
    const dPrev = Math.sign(ls[i] - ls[i - 1]);
    if (dPrev !== 0) dir = dPrev;
    const dNext = i < n ? Math.sign(ls[i + 1] - ls[i]) : 0;
    const turning = i < n && dir !== 0 && dNext !== 0 && dir !== dNext;
    if (turning && dir > 0) highTides++;
    if (turning || i === n) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = start; k <= i; k++) {
        lo = Math.min(lo, ls[k]);
        hi = Math.max(hi, ls[k]);
      }
      if (ts[i] > ts[start]) segs.push([ts[start], ts[i], lo, hi]);
      start = i;
    }
  }
  return { segs, highTides };
}
function above(z, lo, hi) {
  if (z <= lo) return 1;
  if (z >= hi) return 0;
  return Math.acos((2 * z - hi - lo) / (hi - lo)) / Math.PI;
}
var BAND = [1 / 6, 1 / 2, 5 / 6];
function catchUp(input) {
  const { nx, ny, waves } = input;
  const n = nx * ny;
  if (input.delta.length !== n) throw new Error("grid size mismatch");
  const dx = WORLD_SIZE_X / nx;
  const cap = (input.maxGapDays ?? CATCHUP.maxGapDays) * 864e5;
  const to = input.to;
  const from = Math.max(input.from, to - cap);
  const objects = input.objects.map((o) => ({ ...o }));
  const empty = { delta: input.delta.slice(), objects, lost: [], broughtIn: 0, highTides: 0, sandMoved: 0, from, to };
  if (!(to > from)) return empty;
  const rest = buildRestProfile({ nx, ny, dx }, input.seed ?? 1);
  const sand = new Float32Array(n);
  const bottom = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    sand[k] = rest[k] + input.delta[k];
    bottom[k] = rest[k] - PROFILE.digDepthLimit;
  }
  const start = sand.slice();
  const wetTime = new Float32Array(n);
  const tanMax = new Float32Array(n);
  const tmp = new Float32Array(n);
  const R = CATCHUP.runup * waves;
  const tDry = Math.tan(SAND.reposeDry * DEG) * dx;
  const tSat = Math.tan(SAND.reposeSaturated * DEG) * dx;
  let st = (Math.imul((input.seed ?? 1) | 0, 2654435761) ^ (Math.floor(from / 6e4) | 0) ^ 1540483477) >>> 0 || 1;
  const rand = () => {
    st ^= st << 13;
    st ^= st >>> 17;
    st ^= st << 5;
    return (st >>> 0) / 4294967296;
  };
  const cellOf = (x, y) => Math.min(ny - 1, Math.max(0, Math.floor(y / dx))) * nx + Math.min(nx - 1, Math.max(0, Math.floor(x / dx)));
  const lineAt = (x, z) => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor(x / dx)));
    for (let j = 0; j < ny; j++) if (sand[j * nx + i] >= z) return (j + 0.5) * dx;
    return null;
  };
  const rate = SAND.slumpRate * 0.5;
  const slump = (j0, j12) => {
    for (let it = 0; it < CATCHUP.slumpPasses; it++) {
      for (let j = j0; j <= j12; j++) tmp.fill(0, j * nx, (j + 1) * nx);
      for (let j = j0; j <= j12; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          const hk = sand[k];
          if (i < nx - 1) {
            const kn = k + 1;
            const dh = hk - sand[kn];
            const t = Math.min(tanMax[k], tanMax[kn]);
            if (dh > t) {
              const m = Math.min((dh - t) * rate, Math.max(0, hk - bottom[k]) * 0.25);
              tmp[k] -= m;
              tmp[kn] += m;
            } else if (-dh > t) {
              const m = Math.min((-dh - t) * rate, Math.max(0, sand[kn] - bottom[kn]) * 0.25);
              tmp[k] += m;
              tmp[kn] -= m;
            }
          }
          if (j < j12) {
            const kn = k + nx;
            const dh = hk - sand[kn];
            const t = Math.min(tanMax[k], tanMax[kn]);
            if (dh > t) {
              const m = Math.min((dh - t) * rate, Math.max(0, hk - bottom[k]) * 0.25);
              tmp[k] -= m;
              tmp[kn] += m;
            } else if (-dh > t) {
              const m = Math.min((-dh - t) * rate, Math.max(0, sand[kn] - bottom[kn]) * 0.25);
              tmp[k] += m;
              tmp[kn] -= m;
            }
          }
        }
      }
      for (let k = j0 * nx; k < (j12 + 1) * nx; k++) sand[k] += tmp[k];
    }
  };
  const { segs, highTides } = halfCycles(input.tide, from, to);
  const soaked = /* @__PURE__ */ new Map();
  const washed = /* @__PURE__ */ new Set();
  const washDepth = sandWashDepth();
  const lost = [];
  let lastHigh = -Infinity;
  for (const [t0, t1, lo, hi] of segs) {
    const D = (t1 - t0) / 1e3;
    const reach = hi + R;
    lastHigh = Math.max(lastHigh, hi);
    let dlo = ny;
    let dhi = -1;
    for (let j = 0; j < ny; j++) {
      for (let k = j * nx, e = k + nx; k < e; k++) {
        if (sand[k] !== rest[k]) {
          if (j < dlo) dlo = j;
          dhi = j;
          break;
        }
      }
    }
    let jlo = ny;
    let jhi = -1;
    const b0 = Math.max(0, dlo - 3);
    const b1 = Math.min(ny - 1, dhi + 3);
    for (let j = b0; j <= b1 && dhi >= 0; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const r0 = rest[k];
        const h = sand[k] > r0 ? r0 + (sand[k] - r0) * CATCHUP.overtop : sand[k];
        if (h >= reach) {
          wetTime[k] = 0;
          continue;
        }
        let f = 0;
        for (const q of BAND) f += above(h - q * R, lo, hi);
        wetTime[k] = D * f / BAND.length;
        if (wetTime[k] > 0) {
          if (j < jlo) jlo = j;
          if (j > jhi) jhi = j;
        }
      }
    }
    const j0 = Math.max(b0, jlo - 2);
    const j12 = Math.min(b1, jhi + 2);
    for (let j = j0; j <= j12; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        tanMax[k] = wetTime[k] > 0 ? tSat : tDry;
      }
    }
    for (let round2 = 0; round2 < CATCHUP.rounds && jhi >= 0; round2++) {
      for (let k = j0 * nx; k < (j12 + 1) * nx; k++) {
        const w = wetTime[k];
        if (w <= 0) continue;
        const a = 1 - Math.exp(-w / CATCHUP.rounds / EROSION.healingTime);
        const v = sand[k] + (rest[k] - sand[k]) * a;
        sand[k] = v < bottom[k] ? bottom[k] : v;
      }
      slump(j0, j12);
    }
    for (const o of objects) {
      const b = BEHAVIOUR[o.kind];
      if (b === "wash") {
        const z = sand[cellOf(o.x, o.y)] + washDepth;
        if (BAND.some((q) => above(z - q * R, lo, hi) > 0)) washed.add(o.id);
        continue;
      }
      if (b !== "float" && b !== "tumble") continue;
      const h = sand[cellOf(o.x, o.y)];
      const inSea = D * above(h + 0.03, lo, hi);
      if (inSea <= 0) continue;
      soaked.set(o.id, (soaked.get(o.id) ?? 0) + inSea);
      const share = inSea / D;
      if (b === "float") {
        o.x += (rand() - 0.5) * 2 * CATCHUP.drift * waves * share;
        const y = lineAt(o.x, hi + R * 0.5);
        if (y !== null) o.y = y;
      } else {
        o.x += (rand() - 0.5) * 0.6 * waves * share;
        o.y -= rand() * 0.3 * waves * share;
      }
      o.angle += (rand() - 0.5) * 2 * share;
      o.x = Math.min(nx * dx - 0.3, Math.max(0.3, o.x));
      o.y = Math.min(ny * dx - 0.3, Math.max(0.3, o.y));
    }
  }
  let kept = objects.filter((o) => {
    if (washed.has(o.id)) return false;
    if (o.wild) return true;
    const s = soaked.get(o.id) ?? 0;
    const b = BEHAVIOUR[o.kind];
    const limit = b === "float" ? CATCHUP.lostFloatH : b === "tumble" ? CATCHUP.lostRollH : Infinity;
    if (s >= limit * 3600) {
      lost.push(o);
      return false;
    }
    return true;
  });
  let broughtIn = 0;
  if (highTides > 0 && Number.isFinite(lastHigh)) {
    kept = kept.filter((o) => !o.wild);
    let nextId = kept.reduce((m, o) => Math.max(m, o.id), 0) + 1;
    for (let w = 0; w < MAX_WILD; w++) {
      const x = 2 + rand() * (nx * dx - 4);
      const y = lineAt(x, lastHigh + R * 0.5);
      if (y === null || y < 1) continue;
      const r = rand();
      const base = { id: nextId++, x, y: y - 0.2, angle: rand() * 6.28, wild: true };
      kept.push(
        r < 0.3 ? { ...base, kind: "driftwood", item: "driftwood", size: 0.7 + rand() * 1.1, variant: 1 + Math.floor(rand() * 6) } : r < 0.85 ? { ...base, kind: "shell", item: "shell", size: 0.07 + rand() * 0.06, variant: 1 + Math.floor(rand() * 6) } : { ...base, kind: "seaglass", item: "seaglass", size: 0.07 + rand() * 0.04, variant: 1 + Math.floor(rand() * 4) }
      );
      broughtIn++;
    }
  }
  const delta = new Float32Array(n);
  let moved = 0;
  for (let k = 0; k < n; k++) {
    delta[k] = sand[k] === start[k] ? input.delta[k] : sand[k] - rest[k];
    moved += Math.abs(sand[k] - start[k]);
  }
  return { delta, objects: kept, lost, broughtIn, highTides, sandMoved: moved * dx * dx, from, to };
}

var MAGIC = [66, 67, 72, 49];
var MAGIC2 = [66, 67, 72, 50];
var MAGIC3 = [66, 67, 72, 51];
var KINDS = new Set(OBJECT_KINDS);
var MAX_OBJECTS = 2e3;
function objectsToSave(objects) {
  const mine = objects.filter((o) => !o.wild);
  const keep = [...mine, ...objects.filter((o) => o.wild)].slice(0, MAX_OBJECTS);
  return { keep, dropped: Math.max(0, mine.length - MAX_OBJECTS) };
}
var MM = 1e3;
async function pipe(data, stream) {
  const out = new Blob([data]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
function quantize(delta) {
  const q = new Int16Array(delta.length);
  for (let k = 0; k < q.length; k++) {
    const v = Math.round(delta[k] * MM);
    q[k] = v > 32767 ? 32767 : v < -32767 ? -32767 : v;
  }
  return q;
}
function quantizeCover(cover) {
  const q = new Int16Array(cover.length);
  let any = false;
  for (let k = 0; k < q.length; k++) {
    const v = Math.round(cover[k] * MM);
    if (v > 0) {
      q[k] = v > 32767 ? 32767 : v;
      any = true;
    }
  }
  return any ? q : null;
}
async function encodeSand(delta, nx, ny, objects = [], cover) {
  if (delta.length !== nx * ny) throw new Error("size mismatch");
  if (cover && cover.length !== nx * ny) throw new Error("size mismatch");
  const q = quantize(delta);
  if (objects.length) {
    const sand = await pipe(new Uint8Array(q.buffer), new CompressionStream("deflate"));
    const json = new TextEncoder().encode(JSON.stringify(objectsToSave(objects).keep.map(round)));
    const objs = await pipe(json, new CompressionStream("deflate"));
    const qc = cover ? quantizeCover(cover) : null;
    if (qc) {
      const cov = await pipe(new Uint8Array(qc.buffer), new CompressionStream("deflate"));
      const out3 = new Uint8Array(16 + sand.length + objs.length + cov.length);
      out3.set(MAGIC3, 0);
      const dv3 = new DataView(out3.buffer);
      dv3.setUint16(4, nx, true);
      dv3.setUint16(6, ny, true);
      dv3.setUint32(8, sand.length, true);
      dv3.setUint32(12, objs.length, true);
      out3.set(sand, 16);
      out3.set(objs, 16 + sand.length);
      out3.set(cov, 16 + sand.length + objs.length);
      return out3;
    }
    const out2 = new Uint8Array(12 + sand.length + objs.length);
    out2.set(MAGIC2, 0);
    const dv2 = new DataView(out2.buffer);
    dv2.setUint16(4, nx, true);
    dv2.setUint16(6, ny, true);
    dv2.setUint32(8, sand.length, true);
    out2.set(sand, 12);
    out2.set(objs, 12 + sand.length);
    return out2;
  }
  const packed = await pipe(new Uint8Array(q.buffer), new CompressionStream("deflate"));
  const out = new Uint8Array(8 + packed.length);
  out.set(MAGIC, 0);
  const dv = new DataView(out.buffer);
  dv.setUint16(4, nx, true);
  dv.setUint16(6, ny, true);
  out.set(packed, 8);
  return out;
}
async function decodeSand(bytes) {
  const v1 = bytes.length >= 8 && MAGIC.every((m, i) => bytes[i] === m);
  const v2 = bytes.length >= 12 && MAGIC2.every((m, i) => bytes[i] === m);
  const v3 = bytes.length >= 16 && MAGIC3.every((m, i) => bytes[i] === m);
  if (!v1 && !v2 && !v3) throw new Error("not a saved beach");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nx = dv.getUint16(4, true);
  const ny = dv.getUint16(6, true);
  let sandBytes = bytes.subarray(8);
  let objects = [];
  let coverBytes = null;
  if (v2) {
    const len = dv.getUint32(8, true);
    if (12 + len > bytes.length) throw new Error("corrupt saved beach");
    sandBytes = bytes.subarray(12, 12 + len);
    const json = await pipe(bytes.subarray(12 + len), new DecompressionStream("deflate"));
    objects = sanitizeObjects(JSON.parse(new TextDecoder().decode(json)));
  } else if (v3) {
    const sandLen = dv.getUint32(8, true);
    const objsLen = dv.getUint32(12, true);
    if (16 + sandLen + objsLen > bytes.length) throw new Error("corrupt saved beach");
    sandBytes = bytes.subarray(16, 16 + sandLen);
    const json = await pipe(bytes.subarray(16 + sandLen, 16 + sandLen + objsLen), new DecompressionStream("deflate"));
    objects = sanitizeObjects(JSON.parse(new TextDecoder().decode(json)));
    coverBytes = bytes.subarray(16 + sandLen + objsLen);
  }
  const raw = await pipe(sandBytes, new DecompressionStream("deflate"));
  if (raw.byteLength !== nx * ny * 2) throw new Error("corrupt saved beach");
  const q = new Int16Array(raw.buffer, raw.byteOffset, nx * ny);
  const delta = new Float32Array(nx * ny);
  for (let k = 0; k < delta.length; k++) delta[k] = q[k] / MM;
  let cover;
  if (coverBytes) {
    const rawCov = await pipe(coverBytes, new DecompressionStream("deflate"));
    if (rawCov.byteLength !== nx * ny * 2) throw new Error("corrupt saved beach");
    const qc = new Int16Array(rawCov.buffer, rawCov.byteOffset, nx * ny);
    const cov = new Float32Array(nx * ny);
    let any = false;
    for (let k = 0; k < cov.length; k++) {
      if (qc[k] > 0) {
        cov[k] = qc[k] / MM;
        any = true;
      }
    }
    if (any) cover = cov;
  }
  return { nx, ny, delta, objects, ...cover ? { cover } : {} };
}
var r3 = (v) => Math.round(v * 1e3) / 1e3;
var round = (o) => ({
  ...o,
  x: r3(o.x),
  y: r3(o.y),
  angle: r3(o.angle),
  size: r3(o.size),
  ...o.base !== void 0 ? { base: r3(o.base) } : {}
});
function sanitizeObjects(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const ids = /* @__PURE__ */ new Set();
  const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  for (const o of raw.slice(0, MAX_OBJECTS)) {
    if (!o || typeof o !== "object") continue;
    const p = o;
    if (typeof p.kind !== "string" || !KINDS.has(p.kind)) continue;
    if (typeof p.item !== "string" || p.item.length > 64) continue;
    if (!num(p.id, 1, 1e9) || ids.has(p.id)) continue;
    if (!num(p.x, 0, 64) || !num(p.y, 0, 64) || !num(p.angle, -1e4, 1e4) || !num(p.size, 0.05, 4) || !num(p.variant, 0, 1e6)) continue;
    ids.add(p.id);
    out.push({
      id: p.id,
      kind: p.kind,
      item: p.item,
      x: p.x,
      y: p.y,
      angle: p.angle,
      size: p.size,
      variant: p.variant,
      ...p.kind === "rock" && num(p.base, -10, 10) ? { base: p.base } : {},
      ...p.wild === true ? { wild: true } : {},
      ...p.found === true ? { found: true } : {}
    });
  }
  return out;
}
var OLD_WORLD_Z = 24;
var EDGE = 0.3;
function fitWorld(b) {
  const dx = WORLD_SIZE_X / b.nx;
  const savedZ = b.ny * dx;
  const extra = WORLD_SIZE_Z - savedZ;
  let out = b;
  const pad = Math.round(extra / dx);
  if (Math.abs(extra) >= dx * 0.5 && pad > 0) {
    const ny = b.ny + pad;
    const delta = new Float32Array(b.nx * ny);
    delta.set(b.delta, pad * b.nx);
    let cover;
    if (b.cover) {
      cover = new Float32Array(b.nx * ny);
      cover.set(b.cover, pad * b.nx);
    }
    const inNewWorld = b.objects.some((o) => o.y > savedZ + EDGE);
    const shift = inNewWorld ? 0 : pad * dx;
    out = { nx: b.nx, ny, delta, objects: b.objects.map((o) => ({ ...o, y: o.y + shift })), ...cover ? { cover } : {} };
  }
  const stray = (o) => o.y > WORLD_SIZE_Z - EDGE || o.x > WORLD_SIZE_X - EDGE || o.x < EDGE || o.y < EDGE;
  if (!out.objects.some(stray)) return out;
  const step = WORLD_SIZE_Z - OLD_WORLD_Z;
  const clamp = (v, hi) => Math.min(hi - EDGE, Math.max(EDGE, v));
  const objects = out.objects.map((o) => {
    if (!stray(o)) return o;
    let y = o.y;
    while (y > WORLD_SIZE_Z - EDGE) y -= step;
    return { ...o, x: clamp(o.x, WORLD_SIZE_X), y: clamp(y, WORLD_SIZE_Z) };
  });
  return { ...out, objects };
}

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

var RAD = Math.PI / 180;
var OBLIQUITY = RAD * 23.4397;

var RAD2 = Math.PI / 180;
function astro(date) {
  const jd = date.getTime() / 864e5 + 24405875e-1;
  const Tc = (jd - 2451545) / 36525;
  const ut = (date.getTime() / 36e5 % 24 + 24) % 24;
  return {
    T: 15 * ut + 180,
    s: 218.3164477 + 481267.88123421 * Tc,
    h: 280.46646 + 36000.76983 * Tc,
    p: 83.3532465 + 4069.0137287 * Tc,
    N: 125.04452 - 1934.136261 * Tc,
    p1: 282.93735 + 1.71946 * Tc
  };
}
var one = () => [1, 0];
var m2 = (N) => [1.0004 - 0.0373 * Math.cos(N * RAD2) + 2e-4 * Math.cos(2 * N * RAD2), -2.14 * Math.sin(N * RAD2)];
var k1 = (N) => [
  1.006 + 0.115 * Math.cos(N * RAD2) - 88e-4 * Math.cos(2 * N * RAD2) + 6e-4 * Math.cos(3 * N * RAD2),
  -8.86 * Math.sin(N * RAD2) + 0.68 * Math.sin(2 * N * RAD2) - 0.07 * Math.sin(3 * N * RAD2)
];
var o1 = (N) => [
  1.0089 + 0.1871 * Math.cos(N * RAD2) - 0.0147 * Math.cos(2 * N * RAD2) + 14e-4 * Math.cos(3 * N * RAD2),
  10.8 * Math.sin(N * RAD2) - 1.34 * Math.sin(2 * N * RAD2) + 0.19 * Math.sin(3 * N * RAD2)
];
var k2 = (N) => [
  1.0241 + 0.2863 * Math.cos(N * RAD2) + 83e-4 * Math.cos(2 * N * RAD2) - 15e-4 * Math.cos(3 * N * RAD2),
  -17.74 * Math.sin(N * RAD2) + 0.68 * Math.sin(2 * N * RAD2) - 0.04 * Math.sin(3 * N * RAD2)
];
var j1 = (N) => [
  1.0129 + 0.1676 * Math.cos(N * RAD2) - 0.017 * Math.cos(2 * N * RAD2) + 16e-4 * Math.cos(3 * N * RAD2),
  -12.94 * Math.sin(N * RAD2) + 1.34 * Math.sin(2 * N * RAD2) - 0.19 * Math.sin(3 * N * RAD2)
];
var mf = (N) => [
  1.043 + 0.414 * Math.cos(N * RAD2),
  -23.74 * Math.sin(N * RAD2) + 2.68 * Math.sin(2 * N * RAD2) - 0.38 * Math.sin(3 * N * RAD2)
];
var mm = (N) => [1 - 0.13 * Math.cos(N * RAD2), 0];
var pow = (base, n) => (N) => {
  const [f, u] = base(N);
  return [Math.pow(f, n), u * n];
};
var prod = (a, b) => (N) => {
  const [fa, ua] = a(N);
  const [fb, ub] = b(N);
  return [fa * fb, ua + ub];
};
var TABLE = {
  M2: { d: [2, -2, 2, 0, 0, 0], off: 0, nodal: m2 },
  S2: { d: [2, 0, 0, 0, 0, 0], off: 0, nodal: one },
  N2: { d: [2, -3, 2, 1, 0, 0], off: 0, nodal: m2 },
  K2: { d: [2, 0, 2, 0, 0, 0], off: 0, nodal: k2 },
  "2N2": { d: [2, -4, 2, 2, 0, 0], off: 0, nodal: m2 },
  MU2: { d: [2, -4, 4, 0, 0, 0], off: 0, nodal: m2 },
  NU2: { d: [2, -3, 4, -1, 0, 0], off: 0, nodal: m2 },
  L2: { d: [2, -1, 2, -1, 0, 0], off: 180, nodal: m2 },
  T2: { d: [2, 0, -1, 0, 0, 1], off: 0, nodal: one },
  LDA2: { d: [2, -1, 0, 1, 0, 0], off: 180, nodal: m2 },
  K1: { d: [1, 0, 1, 0, 0, 0], off: -90, nodal: k1 },
  O1: { d: [1, -2, 1, 0, 0, 0], off: 90, nodal: o1 },
  P1: { d: [1, 0, -1, 0, 0, 0], off: 90, nodal: one },
  Q1: { d: [1, -3, 1, 1, 0, 0], off: 90, nodal: o1 },
  "2Q1": { d: [1, -4, 1, 2, 0, 0], off: 90, nodal: o1 },
  J1: { d: [1, 1, 1, -1, 0, 0], off: -90, nodal: j1 },
  OO1: { d: [1, 2, 1, 0, 0, 0], off: -90, nodal: (N) => [1.1027 + 0.6504 * Math.cos(N * RAD2) + 0.0317 * Math.cos(2 * N * RAD2), -36.68 * Math.sin(N * RAD2) + 4.02 * Math.sin(2 * N * RAD2)] },
  M3: { d: [3, -3, 3, 0, 0, 0], off: 0, nodal: pow(m2, 1.5) },
  MK3: { d: [3, -2, 3, 0, 0, 0], off: -90, nodal: prod(m2, k1) },
  M4: { d: [4, -4, 4, 0, 0, 0], off: 0, nodal: pow(m2, 2) },
  MS4: { d: [4, -2, 2, 0, 0, 0], off: 0, nodal: m2 },
  MN4: { d: [4, -5, 4, 1, 0, 0], off: 0, nodal: pow(m2, 2) },
  S4: { d: [4, 0, 0, 0, 0, 0], off: 0, nodal: one },
  M6: { d: [6, -6, 6, 0, 0, 0], off: 0, nodal: pow(m2, 3) },
  MF: { d: [0, 2, 0, 0, 0, 0], off: 0, nodal: mf },
  MM: { d: [0, 1, 0, -1, 0, 0], off: 0, nodal: mm },
  SSA: { d: [0, 0, 2, 0, 0, 0], off: 0, nodal: one },
  SA: { d: [0, 0, 1, 0, 0, 0], off: 0, nodal: one }
};
var SUPPORTED_CONSTITUENTS = Object.keys(TABLE);
function tideHeight(cons, date, includeSeasonal = false) {
  const a = astro(date);
  const vars = [a.T, a.s, a.h, a.p, -a.N, a.p1];
  let h = 0;
  for (const name in cons) {
    const c = TABLE[name];
    if (!c) continue;
    if (!includeSeasonal && (name === "SA" || name === "SSA")) continue;
    const [A, G] = cons[name];
    let V = c.off;
    for (let i = 0; i < 6; i++) V += c.d[i] * vars[i];
    const [f, u] = c.nodal(a.N);
    h += f * A * Math.cos((V + u - G) * RAD2);
  }
  return h;
}

var RAD3 = Math.PI / 180;
function diorama(tide) {
  return Math.sign(tide) * 0.3 * (1 - Math.exp(-Math.abs(tide) / 1));
}

var tideStations_default = {
  _source: "TICON-3 (Hart-Davis et al.), https://doi.org/10.1594/PANGAEA.951610, CC-BY 4.0. Amplitudes in metres, Greenwich phase lags in degrees.",
  stations: {
    bondi: {
      gauge: {
        lat: -33.855,
        lon: 151.226,
        km: 6.2,
        source: "gesla.nhs"
      },
      cons: {
        M2: [
          0.5121,
          308.08
        ],
        K1: [
          0.149,
          329.43
        ],
        N2: [
          0.1139,
          299.53
        ],
        O1: [
          0.0968,
          300.58
        ],
        P1: [
          0.0442,
          326.39
        ],
        Q1: [
          0.0231,
          278.81
        ],
        K2: [
          0.0378,
          310.84
        ],
        S2: [
          0.1263,
          322.18
        ],
        SA: [
          0.0406,
          122.19
        ],
        T2: [
          77e-4,
          343.56
        ],
        MF: [
          15e-4,
          152.39
        ],
        MM: [
          6e-4,
          211.93
        ],
        "2N2": [
          0.0206,
          281.06
        ],
        M4: [
          38e-4,
          254.4
        ],
        J1: [
          89e-4,
          347.23
        ],
        SSA: [
          0.0235,
          139.65
        ],
        L2: [
          0.0141,
          309.46
        ],
        M3: [
          24e-4,
          255.56
        ],
        MN4: [
          12e-4,
          238.17
        ],
        MS4: [
          17e-4,
          297.09
        ],
        M6: [
          27e-4,
          276.92
        ],
        S4: [
          6e-4,
          51.39
        ],
        "2Q1": [
          37e-4,
          244.51
        ],
        OO1: [
          61e-4,
          17.84
        ]
      }
    },
    waikiki: {
      gauge: {
        lat: 21.295,
        lon: 202.138,
        km: 4.1,
        source: "gesla.meds"
      },
      cons: {
        M2: [
          0.1614,
          60.61
        ],
        K1: [
          0.1475,
          227
        ],
        N2: [
          0.0315,
          52.33
        ],
        O1: [
          0.0809,
          216.07
        ],
        P1: [
          0.0451,
          225.56
        ],
        Q1: [
          0.0121,
          212.06
        ],
        K2: [
          0.0154,
          42.38
        ],
        S2: [
          0.0496,
          55.44
        ],
        SA: [
          0.0368,
          277.67
        ],
        T2: [
          36e-4,
          51.77
        ],
        MF: [
          64e-4,
          45.83
        ],
        MM: [
          42e-4,
          8.12
        ],
        "2N2": [
          42e-4,
          39.09
        ],
        M4: [
          13e-4,
          159.28
        ],
        J1: [
          85e-4,
          241.64
        ],
        SSA: [
          0.0115,
          312.71
        ],
        L2: [
          35e-4,
          64.62
        ],
        M3: [
          8e-4,
          169.63
        ],
        MN4: [
          7e-4,
          110.11
        ],
        MS4: [
          1e-3,
          115.16
        ],
        M6: [
          3e-4,
          265.99
        ],
        S4: [
          5e-4,
          162.14
        ],
        "2Q1": [
          14e-4,
          218.85
        ],
        OO1: [
          52e-4,
          282.2
        ]
      }
    },
    santamonica: {
      gauge: {
        lat: 33.45,
        lon: 241.517,
        km: 62.2,
        source: "gesla.meds"
      },
      cons: {
        M2: [
          0.4763,
          148.92
        ],
        K1: [
          0.3378,
          210.54
        ],
        N2: [
          0.1155,
          127.52
        ],
        O1: [
          0.2143,
          194.3
        ],
        P1: [
          0.1033,
          209.55
        ],
        Q1: [
          0.0394,
          186.88
        ],
        K2: [
          0.0568,
          132.88
        ],
        S2: [
          0.1904,
          142.1
        ],
        SA: [
          0.0639,
          255.71
        ],
        T2: [
          33e-4,
          151.1
        ],
        MF: [
          47e-4,
          119.84
        ],
        MM: [
          29e-4,
          76.54
        ],
        "2N2": [
          0.015,
          97.99
        ],
        M4: [
          2e-3,
          270.07
        ],
        J1: [
          0.0188,
          220.69
        ],
        SSA: [
          0.0233,
          305.65
        ],
        L2: [
          86e-4,
          159.91
        ],
        M3: [
          27e-4,
          353.99
        ],
        MN4: [
          11e-4,
          222.53
        ],
        MS4: [
          8e-4,
          204.61
        ],
        M6: [
          1e-4,
          260.88
        ],
        S4: [
          12e-4,
          252.85
        ],
        "2Q1": [
          48e-4,
          177.64
        ],
        OO1: [
          0.0123,
          263.6
        ]
      }
    },
    southbeach: {
      gauge: {
        lat: 25.768,
        lon: 279.868,
        km: 1.6,
        source: "gesla.cmems"
      },
      cons: {
        M2: [
          0.3687,
          21.06
        ],
        K1: [
          0.0415,
          243.23
        ],
        N2: [
          0.0844,
          359.4
        ],
        O1: [
          0.0339,
          269.07
        ],
        P1: [
          0.0128,
          248.32
        ],
        Q1: [
          76e-4,
          271.12
        ],
        K2: [
          0.0187,
          50.61
        ],
        S2: [
          0.0719,
          47.03
        ],
        SA: [
          0.071,
          275.91
        ],
        T2: [
          65e-4,
          26.8
        ],
        MF: [
          0.0144,
          337.33
        ],
        MM: [
          48e-4,
          339.65
        ],
        "2N2": [
          0.0109,
          343.06
        ],
        M4: [
          48e-4,
          199.71
        ],
        J1: [
          26e-4,
          229.71
        ],
        SSA: [
          0.0408,
          90.59
        ],
        L2: [
          95e-4,
          37.61
        ],
        M3: [
          7e-4,
          24.97
        ],
        MN4: [
          32e-4,
          195.72
        ],
        MS4: [
          34e-4,
          170.08
        ],
        M6: [
          8e-4,
          131.11
        ],
        S4: [
          21e-4,
          273.48
        ],
        "2Q1": [
          1e-3,
          261.76
        ],
        OO1: [
          15e-4,
          266.76
        ]
      }
    },
    copacabana: {
      gauge: {
        lat: -22.933,
        lon: 316.867,
        km: 6.6,
        source: "gesla.noaa"
      },
      cons: {
        M2: [
          0.3064,
          172.57
        ],
        K1: [
          0.0615,
          191.34
        ],
        N2: [
          0.0396,
          211.98
        ],
        O1: [
          0.1085,
          130.6
        ],
        P1: [
          0.0212,
          180.72
        ],
        Q1: [
          0.0279,
          105.86
        ],
        K2: [
          0.0519,
          170.6
        ],
        S2: [
          0.163,
          180.57
        ],
        SA: [
          0.0449,
          95.58
        ],
        T2: [
          41e-4,
          199.08
        ],
        MF: [
          62e-4,
          246.15
        ],
        MM: [
          59e-4,
          257.02
        ],
        "2N2": [
          0.0125,
          213.72
        ],
        M4: [
          0.0347,
          255.6
        ],
        J1: [
          6e-4,
          258.69
        ],
        SSA: [
          0.0103,
          86.91
        ],
        L2: [
          0.0101,
          153
        ],
        M3: [
          59e-4,
          324.97
        ],
        MN4: [
          0.0152,
          204.52
        ],
        MS4: [
          0.0179,
          355.86
        ],
        M6: [
          28e-4,
          118.92
        ],
        S4: [
          7e-4,
          239.05
        ],
        "2Q1": [
          42e-4,
          75.74
        ],
        OO1: [
          22e-4,
          23.23
        ]
      }
    },
    brighton: {
      gauge: {
        lat: 50.812,
        lon: 359.899,
        km: 2.7,
        source: "gesla.meds"
      },
      cons: {
        M2: [
          2.165,
          321.33
        ],
        K1: [
          0.0761,
          107.2
        ],
        N2: [
          0.4085,
          301.36
        ],
        O1: [
          0.0118,
          349.71
        ],
        P1: [
          0.0256,
          104.78
        ],
        Q1: [
          41e-4,
          148.75
        ],
        K2: [
          0.1991,
          10.1
        ],
        S2: [
          0.696,
          10.92
        ],
        SA: [
          0.0686,
          307.31
        ],
        T2: [
          0.0388,
          357.73
        ],
        MF: [
          0.0158,
          127
        ],
        MM: [
          83e-4,
          25.14
        ],
        "2N2": [
          0.0503,
          290.86
        ],
        M4: [
          0.0727,
          263.59
        ],
        J1: [
          24e-4,
          187.01
        ],
        SSA: [
          0.0113,
          172.47
        ],
        L2: [
          0.0955,
          324.54
        ],
        M3: [
          58e-4,
          344.2
        ],
        MN4: [
          0.0267,
          237.88
        ],
        MS4: [
          0.0452,
          315.93
        ],
        M6: [
          0.0234,
          161.71
        ],
        S4: [
          34e-4,
          56.68
        ],
        "2Q1": [
          9e-4,
          124.64
        ],
        OO1: [
          76e-4,
          311.93
        ]
      }
    },
    biarritz: {
      gauge: {
        lat: 43.527,
        lon: 358.485,
        km: 6,
        source: "gesla.meds"
      },
      cons: {
        M2: [
          1.2258,
          96.49
        ],
        K1: [
          0.0573,
          71.27
        ],
        N2: [
          0.2568,
          76.61
        ],
        O1: [
          0.0671,
          323.49
        ],
        P1: [
          0.0188,
          59.1
        ],
        Q1: [
          0.0204,
          277.79
        ],
        K2: [
          0.1218,
          126.69
        ],
        S2: [
          0.427,
          129.04
        ],
        SA: [
          0.0362,
          357.04
        ],
        T2: [
          0.0236,
          126.78
        ],
        MF: [
          43e-4,
          171.93
        ],
        MM: [
          21e-4,
          164.07
        ],
        "2N2": [
          0.0356,
          58.09
        ],
        M4: [
          0.0101,
          295.19
        ],
        J1: [
          18e-4,
          129.57
        ],
        SSA: [
          0.0313,
          110.01
        ],
        L2: [
          0.0303,
          109.88
        ],
        M3: [
          0.0128,
          332.54
        ],
        MN4: [
          89e-4,
          250.76
        ],
        MS4: [
          57e-4,
          166.35
        ],
        M6: [
          16e-4,
          14.56
        ],
        S4: [
          29e-4,
          204.21
        ],
        "2Q1": [
          36e-4,
          234.49
        ],
        OO1: [
          15e-4,
          221.02
        ]
      }
    },
    campsbay: {
      gauge: {
        lat: -33.9,
        lon: 18.433,
        km: 7.7,
        source: "gesla.meds"
      },
      cons: {
        M2: [
          0.4993,
          35.06
        ],
        K1: [
          0.0577,
          109.57
        ],
        N2: [
          0.1105,
          27.22
        ],
        O1: [
          0.0146,
          235.29
        ],
        P1: [
          0.0156,
          110.44
        ],
        Q1: [
          89e-4,
          221.65
        ],
        K2: [
          0.0613,
          51.7
        ],
        S2: [
          0.2188,
          54.95
        ],
        SA: [
          0.021,
          30.69
        ],
        T2: [
          0.0122,
          60.57
        ],
        MF: [
          29e-4,
          351.74
        ],
        MM: [
          13e-4,
          318.82
        ],
        "2N2": [
          0.0167,
          8.66
        ],
        M4: [
          56e-4,
          55.93
        ],
        J1: [
          46e-4,
          134.06
        ],
        SSA: [
          77e-4,
          310.87
        ],
        L2: [
          0.014,
          36.45
        ],
        M3: [
          54e-4,
          296.26
        ],
        MN4: [
          27e-4,
          2.08
        ],
        MS4: [
          3e-3,
          132.31
        ],
        M6: [
          6e-4,
          149.43
        ],
        S4: [
          14e-4,
          186.1
        ],
        "2Q1": [
          2e-3,
          191.01
        ],
        OO1: [
          49e-4,
          163.18
        ]
      }
    },
    patong: {
      gauge: {
        lat: 7.832,
        lon: 98.425,
        km: 15.9,
        source: "gesla.rws"
      },
      cons: {
        M2: [
          0.7878,
          99.46
        ],
        K1: [
          0.1305,
          224.84
        ],
        N2: [
          0.1508,
          94.04
        ],
        O1: [
          0.0484,
          190.96
        ],
        P1: [
          0.0384,
          222.79
        ],
        Q1: [
          72e-4,
          136.53
        ],
        K2: [
          0.1123,
          130.67
        ],
        S2: [
          0.3995,
          135.82
        ],
        SA: [
          0.0817,
          216.37
        ],
        T2: [
          0.0233,
          135.03
        ],
        MF: [
          0.013,
          8.35
        ],
        MM: [
          9e-3,
          12.22
        ],
        "2N2": [
          0.021,
          81.07
        ],
        M4: [
          88e-4,
          351.21
        ],
        J1: [
          8e-3,
          234.13
        ],
        SSA: [
          0.0663,
          125.65
        ],
        L2: [
          0.0286,
          93.4
        ],
        M3: [
          32e-4,
          85.15
        ],
        MN4: [
          32e-4,
          7.51
        ],
        MS4: [
          0.0101,
          53.49
        ],
        M6: [
          16e-4,
          197.47
        ],
        S4: [
          14e-4,
          164.59
        ],
        "2Q1": [
          16e-4,
          51.4
        ],
        OO1: [
          86e-4,
          234
        ]
      }
    },
    kuta: {
      gauge: {
        lat: -8.747,
        lon: 115.212,
        km: 5.8,
        source: "gesla.usgs"
      },
      cons: {
        M2: [
          0.6422,
          53.12
        ],
        K1: [
          0.253,
          177.19
        ],
        N2: [
          0.1142,
          27.78
        ],
        O1: [
          0.1618,
          164.23
        ],
        P1: [
          0.0729,
          173.18
        ],
        Q1: [
          0.0359,
          155.26
        ],
        K2: [
          0.1027,
          106.31
        ],
        S2: [
          0.3667,
          107.69
        ],
        SA: [
          0.1522,
          45.23
        ],
        T2: [
          0.0184,
          104.21
        ],
        MF: [
          0.0157,
          6.67
        ],
        MM: [
          43e-4,
          338.04
        ],
        "2N2": [
          0.0112,
          357.05
        ],
        M4: [
          0.01,
          208.7
        ],
        J1: [
          0.013,
          195.41
        ],
        SSA: [
          0.0624,
          169.25
        ],
        L2: [
          0.0212,
          64.62
        ],
        M3: [
          34e-4,
          42.97
        ],
        MN4: [
          42e-4,
          177.18
        ],
        MS4: [
          0.0102,
          260.63
        ],
        M6: [
          3e-3,
          128.7
        ],
        S4: [
          43e-4,
          321.63
        ],
        "2Q1": [
          58e-4,
          134.09
        ],
        OO1: [
          89e-4,
          210.63
        ]
      }
    },
    nice: {
      gauge: {
        lat: 43.696,
        lon: 7.285,
        km: 1.6,
        source: "gesla.noc"
      },
      cons: {
        M2: [
          0.077,
          221.41
        ],
        K1: [
          0.0351,
          182.72
        ],
        N2: [
          0.0159,
          210.69
        ],
        O1: [
          0.0173,
          105.83
        ],
        P1: [
          0.0115,
          173.88
        ],
        Q1: [
          26e-4,
          33.72
        ],
        K2: [
          85e-4,
          236.22
        ],
        S2: [
          0.0295,
          240.03
        ],
        SA: [
          0.0517,
          266.91
        ],
        T2: [
          13e-4,
          228.66
        ],
        MF: [
          65e-4,
          170.08
        ],
        MM: [
          42e-4,
          200.93
        ],
        "2N2": [
          22e-4,
          200.78
        ],
        M4: [
          6e-3,
          337.95
        ],
        J1: [
          15e-4,
          206.51
        ],
        SSA: [
          0.0217,
          96.53
        ],
        L2: [
          21e-4,
          230.65
        ],
        M3: [
          1e-3,
          160.96
        ],
        MN4: [
          24e-4,
          296.63
        ],
        MS4: [
          39e-4,
          42.58
        ],
        M6: [
          5e-4,
          87.49
        ],
        S4: [
          6e-4,
          252.72
        ],
        "2Q1": [
          5e-4,
          300.68
        ],
        OO1: [
          3e-4,
          256.92
        ]
      }
    },
    kamakura: {
      gauge: {
        lat: 35.288,
        lon: 139.651,
        km: 10.1,
        source: "gesla.uhslc"
      },
      cons: {
        M2: [
          0.4117,
          233.2
        ],
        K1: [
          0.2409,
          39.36
        ],
        N2: [
          0.0618,
          229.72
        ],
        O1: [
          0.1893,
          20.96
        ],
        P1: [
          0.0784,
          37.3
        ],
        Q1: [
          0.0391,
          10.68
        ],
        K2: [
          0.0548,
          256.62
        ],
        S2: [
          0.2003,
          261.94
        ],
        SA: [
          0.0914,
          245.98
        ],
        T2: [
          0.0112,
          242.62
        ],
        MF: [
          48e-4,
          116.47
        ],
        MM: [
          5e-3,
          114.62
        ],
        "2N2": [
          8e-3,
          237.59
        ],
        M4: [
          59e-4,
          7
        ],
        J1: [
          0.0115,
          57.21
        ],
        SSA: [
          59e-4,
          233.83
        ],
        L2: [
          0.014,
          241.19
        ],
        M3: [
          83e-4,
          92.47
        ],
        MN4: [
          3e-4,
          52.3
        ],
        MS4: [
          37e-4,
          63.56
        ],
        M6: [
          3e-4,
          63.19
        ],
        S4: [
          27e-4,
          93.64
        ],
        "2Q1": [
          52e-4,
          3.46
        ],
        OO1: [
          75e-4,
          79.64
        ]
      }
    },
    piha: {
      gauge: {
        lat: -36.85,
        lon: 174.767,
        km: 29,
        source: "gesla.uhslc"
      },
      cons: {
        M2: [
          1.1458,
          216.94
        ],
        K1: [
          0.0711,
          355.43
        ],
        N2: [
          0.2334,
          190.97
        ],
        O1: [
          0.0173,
          324.57
        ],
        P1: [
          0.0232,
          352.38
        ],
        Q1: [
          15e-4,
          249.97
        ],
        K2: [
          0.0439,
          265.42
        ],
        S2: [
          0.1745,
          276.56
        ],
        SA: [
          0.022,
          99.33
        ],
        T2: [
          0.0138,
          321.47
        ],
        MF: [
          64e-4,
          257.67
        ],
        MM: [
          1e-3,
          153.22
        ],
        "2N2": [
          0.0284,
          176.55
        ],
        M4: [
          0.0215,
          137.57
        ],
        J1: [
          46e-4,
          19.45
        ],
        SSA: [
          0.0152,
          236.77
        ],
        L2: [
          0.0319,
          233.14
        ],
        M3: [
          0.0138,
          42.77
        ],
        MN4: [
          4e-3,
          128.73
        ],
        MS4: [
          0.013,
          225.6
        ],
        M6: [
          0.012,
          330.94
        ],
        S4: [
          63e-4,
          6.28
        ],
        "2Q1": [
          11e-4,
          234.37
        ],
        OO1: [
          57e-4,
          50.02
        ]
      }
    },
    whitehaven: {
      gauge: {
        lat: -20.283,
        lon: 148.783,
        km: 26.7,
        source: "gesla.jodc_pahb"
      },
      cons: {
        M2: [
          1.0192,
          24.95
        ],
        K1: [
          0.3621,
          39.33
        ],
        N2: [
          0.2686,
          8.29
        ],
        O1: [
          0.1803,
          12.54
        ],
        P1: [
          0.1087,
          36.29
        ],
        Q1: [
          0.0336,
          354.37
        ],
        K2: [
          0.1031,
          355.59
        ],
        S2: [
          0.3646,
          357.49
        ],
        SA: [
          0.0951,
          69.46
        ],
        T2: [
          0.0201,
          332.51
        ],
        MF: [
          97e-4,
          2.28
        ],
        MM: [
          58e-4,
          40.75
        ],
        "2N2": [
          0.0367,
          4.33
        ],
        M4: [
          8e-3,
          77.75
        ],
        J1: [
          0.021,
          66.69
        ],
        SSA: [
          86e-4,
          353.81
        ],
        L2: [
          0.0408,
          16.88
        ],
        M3: [
          72e-4,
          23.1
        ],
        MN4: [
          38e-4,
          68.19
        ],
        MS4: [
          65e-4,
          80.88
        ],
        M6: [
          0.0151,
          151.95
        ],
        S4: [
          16e-4,
          165.22
        ],
        "2Q1": [
          38e-4,
          319.21
        ],
        OO1: [
          0.017,
          88.7
        ]
      }
    },
    surfers: {
      gauge: {
        lat: -27.967,
        lon: 153.417,
        km: 4.2,
        source: "gesla.noaa"
      },
      cons: {
        M2: [
          0.5049,
          312.44
        ],
        K1: [
          0.1805,
          358.32
        ],
        N2: [
          0.1047,
          304.87
        ],
        O1: [
          0.1053,
          328.06
        ],
        P1: [
          0.0536,
          354.19
        ],
        Q1: [
          0.0214,
          307.43
        ],
        K2: [
          0.0433,
          314.35
        ],
        S2: [
          0.1421,
          322.27
        ],
        SA: [
          0.0635,
          120.03
        ],
        T2: [
          85e-4,
          336.29
        ],
        MF: [
          48e-4,
          3.56
        ],
        MM: [
          62e-4,
          41.11
        ],
        "2N2": [
          0.0179,
          295.17
        ],
        M4: [
          55e-4,
          119.52
        ],
        J1: [
          0.0101,
          23.58
        ],
        SSA: [
          0.0104,
          148.47
        ],
        L2: [
          0.0176,
          311.61
        ],
        M3: [
          51e-4,
          240.76
        ],
        MN4: [
          3e-3,
          107.8
        ],
        MS4: [
          43e-4,
          128.51
        ],
        M6: [
          36e-4,
          233.75
        ],
        S4: [
          13e-4,
          101.11
        ],
        "2Q1": [
          32e-4,
          272.26
        ],
        OO1: [
          77e-4,
          55.4
        ]
      }
    },
    cable: {
      gauge: {
        lat: -18.001,
        lon: 122.219,
        km: 7.6,
        source: "gesla.nhs"
      },
      cons: {
        M2: [
          2.3723,
          66.13
        ],
        K1: [
          0.2551,
          172.03
        ],
        N2: [
          0.3966,
          40.6
        ],
        O1: [
          0.1568,
          161.37
        ],
        P1: [
          0.0714,
          173.64
        ],
        Q1: [
          0.035,
          154.44
        ],
        K2: [
          0.4134,
          124.11
        ],
        S2: [
          1.4714,
          126.11
        ],
        SA: [
          0.0962,
          48.06
        ],
        T2: [
          0.0738,
          127.46
        ],
        MF: [
          85e-4,
          336.42
        ],
        MM: [
          39e-4,
          7.97
        ],
        "2N2": [
          0.0408,
          7.19
        ],
        M4: [
          0.0608,
          36.1
        ],
        J1: [
          0.015,
          191.44
        ],
        SSA: [
          0.0411,
          99.28
        ],
        L2: [
          0.0874,
          80.31
        ],
        M3: [
          0.0181,
          176.01
        ],
        MN4: [
          0.0241,
          3.56
        ],
        MS4: [
          0.0651,
          85.77
        ],
        M6: [
          0.0324,
          198.72
        ],
        S4: [
          0.0321,
          160.57
        ],
        "2Q1": [
          54e-4,
          132.67
        ],
        OO1: [
          0.01,
          225.38
        ]
      }
    },
    railay: {
      gauge: {
        lat: 7.832,
        lon: 98.425,
        km: 49.7,
        source: "gesla.rws"
      },
      cons: {
        M2: [
          0.7878,
          99.46
        ],
        K1: [
          0.1305,
          224.84
        ],
        N2: [
          0.1508,
          94.04
        ],
        O1: [
          0.0484,
          190.96
        ],
        P1: [
          0.0384,
          222.79
        ],
        Q1: [
          72e-4,
          136.53
        ],
        K2: [
          0.1123,
          130.67
        ],
        S2: [
          0.3995,
          135.82
        ],
        SA: [
          0.0817,
          216.37
        ],
        T2: [
          0.0233,
          135.03
        ],
        MF: [
          0.013,
          8.35
        ],
        MM: [
          9e-3,
          12.22
        ],
        "2N2": [
          0.021,
          81.07
        ],
        M4: [
          88e-4,
          351.21
        ],
        J1: [
          8e-3,
          234.13
        ],
        SSA: [
          0.0663,
          125.65
        ],
        L2: [
          0.0286,
          93.4
        ],
        M3: [
          32e-4,
          85.15
        ],
        MN4: [
          32e-4,
          7.51
        ],
        MS4: [
          0.0101,
          53.49
        ],
        M6: [
          16e-4,
          197.47
        ],
        S4: [
          14e-4,
          164.59
        ],
        "2Q1": [
          16e-4,
          51.4
        ],
        OO1: [
          86e-4,
          234
        ]
      }
    },
    haeundae: {
      gauge: {
        lat: 34.655,
        lon: 129.478,
        km: 63.1,
        source: "gesla.noaa"
      },
      cons: {
        M2: [
          0.321,
          354.26
        ],
        K1: [
          0.0306,
          116.76
        ],
        N2: [
          0.0625,
          350.69
        ],
        O1: [
          0.0368,
          122.87
        ],
        P1: [
          0.0118,
          114.35
        ],
        Q1: [
          94e-4,
          112.28
        ],
        K2: [
          0.0432,
          12.4
        ],
        S2: [
          0.158,
          19.64
        ],
        SA: [
          0.1743,
          227.38
        ],
        T2: [
          0.0123,
          19.23
        ],
        MF: [
          87e-4,
          201.18
        ],
        MM: [
          4e-3,
          64.14
        ],
        "2N2": [
          93e-4,
          343.14
        ],
        M4: [
          0.0131,
          76.68
        ],
        J1: [
          2e-3,
          107.55
        ],
        SSA: [
          94e-4,
          344.88
        ],
        L2: [
          69e-4,
          335.49
        ],
        M3: [
          0.011,
          313.35
        ],
        MN4: [
          57e-4,
          53.99
        ],
        MS4: [
          67e-4,
          106.69
        ],
        M6: [
          4e-4,
          50.04
        ],
        S4: [
          11e-4,
          114.59
        ],
        "2Q1": [
          17e-4,
          112.74
        ],
        OO1: [
          5e-4,
          166.53
        ]
      }
    },
    anse: {
      gauge: {
        lat: -4.343,
        lon: 55.767,
        km: 7.1,
        source: "gesla.uhslc"
      },
      cons: {
        M2: [
          0.3534,
          12.96
        ],
        K1: [
          0.1872,
          358.4
        ],
        N2: [
          0.0773,
          349.17
        ],
        O1: [
          0.106,
          4.18
        ],
        P1: [
          0.0547,
          357.18
        ],
        Q1: [
          0.0248,
          6.37
        ],
        K2: [
          0.0407,
          47.26
        ],
        S2: [
          0.1564,
          50.68
        ],
        SA: [
          0.0123,
          310.54
        ],
        T2: [
          0.0113,
          37.08
        ],
        MF: [
          0.0148,
          11.2
        ],
        MM: [
          89e-4,
          42.22
        ],
        "2N2": [
          75e-4,
          317.73
        ],
        M4: [
          27e-4,
          309.43
        ],
        J1: [
          0.0139,
          358.37
        ],
        SSA: [
          0.1082,
          338.65
        ],
        L2: [
          0.01,
          35.78
        ],
        M3: [
          38e-4,
          318.89
        ],
        MN4: [
          19e-4,
          223.21
        ],
        MS4: [
          19e-4,
          85.67
        ],
        M6: [
          11e-4,
          260.9
        ],
        S4: [
          6e-4,
          80.34
        ],
        "2Q1": [
          46e-4,
          8.71
        ],
        OO1: [
          0.0189,
          14.81
        ]
      }
    },
    nungwi: {
      gauge: {
        lat: -6.155,
        lon: 39.19,
        km: 49,
        source: "gesla.meds"
      },
      cons: {
        M2: [
          1.2056,
          25.68
        ],
        K1: [
          0.1841,
          356.1
        ],
        N2: [
          0.2203,
          5.12
        ],
        O1: [
          0.1107,
          0.9
        ],
        P1: [
          0.0543,
          354.42
        ],
        Q1: [
          0.0251,
          353.6
        ],
        K2: [
          0.1666,
          61.63
        ],
        S2: [
          0.609,
          64.87
        ],
        SA: [
          0.0162,
          79.65
        ],
        T2: [
          0.0393,
          65.81
        ],
        MF: [
          0.0158,
          6.33
        ],
        MM: [
          71e-4,
          5.43
        ],
        "2N2": [
          0.0215,
          330.76
        ],
        M4: [
          0.0147,
          182.31
        ],
        J1: [
          0.0119,
          4.08
        ],
        SSA: [
          0.0208,
          71.38
        ],
        L2: [
          0.0396,
          42.75
        ],
        M3: [
          44e-4,
          138.49
        ],
        MN4: [
          6e-3,
          118.63
        ],
        MS4: [
          99e-4,
          282.21
        ],
        M6: [
          0.0215,
          43.38
        ],
        S4: [
          2e-4,
          91.48
        ],
        "2Q1": [
          38e-4,
          331.09
        ],
        OO1: [
          0.0105,
          22.17
        ]
      }
    },
    sylt: {
      gauge: {
        lat: 54.758,
        lon: 8.296,
        km: 16.7,
        source: "gesla.usgs"
      },
      cons: {
        M2: [
          0.9178,
          2.02
        ],
        K1: [
          0.0664,
          48.23
        ],
        N2: [
          0.1524,
          334.2
        ],
        O1: [
          0.0824,
          261.2
        ],
        P1: [
          0.029,
          55.63
        ],
        Q1: [
          0.0254,
          205.87
        ],
        K2: [
          0.0676,
          69.63
        ],
        S2: [
          0.2227,
          73.04
        ],
        SA: [
          0.1466,
          323.21
        ],
        T2: [
          0.0135,
          74.23
        ],
        MF: [
          0.0201,
          234.26
        ],
        MM: [
          0.0402,
          226.84
        ],
        "2N2": [
          61e-4,
          11.58
        ],
        M4: [
          0.0574,
          193.83
        ],
        J1: [
          4e-3,
          158.16
        ],
        SSA: [
          0.0674,
          182.6
        ],
        L2: [
          0.0873,
          23.68
        ],
        M3: [
          26e-4,
          235.81
        ],
        MN4: [
          0.0239,
          171.15
        ],
        MS4: [
          0.0298,
          263.3
        ],
        M6: [
          0.0231,
          68.61
        ],
        S4: [
          24e-4,
          45.81
        ],
        "2Q1": [
          57e-4,
          144.85
        ],
        OO1: [
          74e-4,
          314.81
        ]
      }
    },
    scheveningen: {
      gauge: {
        lat: 52.205,
        lon: 4.362,
        km: 11.8,
        source: "gesla.cmems"
      },
      cons: {
        M2: [
          0.7136,
          77.94
        ],
        K1: [
          0.0795,
          345.57
        ],
        N2: [
          0.1064,
          45.79
        ],
        O1: [
          0.1151,
          177.4
        ],
        P1: [
          0.0335,
          331.8
        ],
        Q1: [
          0.0385,
          135.31
        ],
        K2: [
          0.0542,
          139.97
        ],
        S2: [
          0.1765,
          141.38
        ],
        SA: [
          0.0737,
          287.59
        ],
        T2: [
          0.0101,
          113.38
        ],
        MF: [
          0.0278,
          141.5
        ],
        MM: [
          0.0269,
          291.44
        ],
        "2N2": [
          0.0145,
          338.79
        ],
        M4: [
          0.2011,
          110.64
        ],
        J1: [
          7e-3,
          68.3
        ],
        SSA: [
          0.0506,
          121.64
        ],
        L2: [
          0.0744,
          110.79
        ],
        M3: [
          64e-4,
          275.1
        ],
        MN4: [
          0.0756,
          87.85
        ],
        MS4: [
          0.1237,
          171.3
        ],
        M6: [
          0.0199,
          121.61
        ],
        S4: [
          99e-4,
          235.02
        ],
        "2Q1": [
          0.0111,
          70.25
        ],
        OO1: [
          49e-4,
          111.68
        ]
      }
    },
    fistral: {
      gauge: {
        lat: 50.594,
        lon: 355.166,
        km: 27.2,
        source: "gesla.meds"
      },
      cons: {
        M2: [
          2.4575,
          146.96
        ],
        K1: [
          0.0629,
          117.12
        ],
        N2: [
          0.4735,
          127.97
        ],
        O1: [
          0.0622,
          345.64
        ],
        P1: [
          0.021,
          108.81
        ],
        Q1: [
          0.0192,
          292.03
        ],
        K2: [
          0.2535,
          189.79
        ],
        S2: [
          0.8792,
          191.41
        ],
        SA: [
          0.0678,
          296.74
        ],
        T2: [
          0.0477,
          185.97
        ],
        MF: [
          0.0111,
          207.98
        ],
        MM: [
          0.0101,
          166.65
        ],
        "2N2": [
          0.0609,
          110.59
        ],
        M4: [
          0.0603,
          253.25
        ],
        J1: [
          6e-4,
          145.03
        ],
        SSA: [
          0.0208,
          119.52
        ],
        L2: [
          0.1015,
          145.69
        ],
        M3: [
          0.0208,
          85.28
        ],
        MN4: [
          0.0237,
          216.97
        ],
        MS4: [
          0.0242,
          307.36
        ],
        M6: [
          98e-4,
          94.76
        ],
        S4: [
          32e-4,
          299.13
        ],
        "2Q1": [
          38e-4,
          245.68
        ],
        OO1: [
          3e-4,
          314.97
        ]
      }
    },
    nazare: {
      gauge: {
        lat: 39.586,
        lon: 350.926,
        km: 1.7,
        source: "gesla.uhslc"
      },
      cons: {
        M2: [
          0.9722,
          71.05
        ],
        K1: [
          0.0676,
          61.25
        ],
        N2: [
          0.2154,
          52.26
        ],
        O1: [
          0.0624,
          318.78
        ],
        P1: [
          0.0218,
          47.1
        ],
        Q1: [
          0.0179,
          267.92
        ],
        K2: [
          0.0756,
          91.01
        ],
        S2: [
          0.3353,
          99.85
        ],
        SA: [
          0.0295,
          265.38
        ],
        T2: [
          0.0268,
          124.8
        ],
        MF: [
          8e-3,
          13.35
        ],
        MM: [
          23e-4,
          270.2
        ],
        "2N2": [
          0.0315,
          36.89
        ],
        M4: [
          82e-4,
          203.39
        ],
        J1: [
          31e-4,
          68.55
        ],
        SSA: [
          0.0467,
          79.37
        ],
        L2: [
          0.019,
          96.75
        ],
        M3: [
          49e-4,
          285.73
        ],
        MN4: [
          31e-4,
          159.82
        ],
        MS4: [
          53e-4,
          278.42
        ],
        M6: [
          17e-4,
          150.43
        ],
        S4: [
          11e-4,
          275.17
        ],
        "2Q1": [
          28e-4,
          207.59
        ],
        OO1: [
          57e-4,
          207.13
        ]
      }
    },
    marinha: {
      gauge: {
        lat: 37.098,
        lon: 351.332,
        km: 22.7,
        source: "gesla.meds"
      },
      cons: {
        M2: [
          1.0105,
          57.46
        ],
        K1: [
          0.0699,
          49.06
        ],
        N2: [
          0.2157,
          41.44
        ],
        O1: [
          0.0614,
          309.12
        ],
        P1: [
          0.022,
          39.27
        ],
        Q1: [
          0.0181,
          259.11
        ],
        K2: [
          0.103,
          80.3
        ],
        S2: [
          0.364,
          83.31
        ],
        SA: [
          0.0433,
          250.79
        ],
        T2: [
          0.0218,
          82.37
        ],
        MF: [
          56e-4,
          228.52
        ],
        MM: [
          4e-3,
          200.98
        ],
        "2N2": [
          0.0311,
          25.79
        ],
        M4: [
          0.015,
          163.25
        ],
        J1: [
          22e-4,
          98.2
        ],
        SSA: [
          0.0341,
          121.36
        ],
        L2: [
          0.0214,
          65.58
        ],
        M3: [
          43e-4,
          244.46
        ],
        MN4: [
          69e-4,
          109.99
        ],
        MS4: [
          9e-3,
          249.16
        ],
        M6: [
          28e-4,
          105.14
        ],
        S4: [
          16e-4,
          330.4
        ],
        "2Q1": [
          39e-4,
          207.47
        ],
        OO1: [
          1e-3,
          189.93
        ]
      }
    },
    barceloneta: {
      gauge: {
        lat: 41.342,
        lon: 2.163,
        km: 4.7,
        source: "gesla.uhslc"
      },
      cons: {
        M2: [
          0.0459,
          213.26
        ],
        K1: [
          0.0368,
          168.05
        ],
        N2: [
          98e-4,
          201.48
        ],
        O1: [
          0.0236,
          102.76
        ],
        P1: [
          0.0125,
          161.06
        ],
        Q1: [
          31e-4,
          53.41
        ],
        K2: [
          49e-4,
          228.81
        ],
        S2: [
          0.0164,
          230.44
        ],
        SA: [
          0.065,
          259.65
        ],
        T2: [
          1e-3,
          225.24
        ],
        MF: [
          57e-4,
          164.04
        ],
        MM: [
          44e-4,
          216.84
        ],
        "2N2": [
          15e-4,
          189.85
        ],
        M4: [
          52e-4,
          347.92
        ],
        J1: [
          12e-4,
          179.07
        ],
        SSA: [
          0.0317,
          90.78
        ],
        L2: [
          12e-4,
          221.99
        ],
        M3: [
          15e-4,
          158.84
        ],
        MN4: [
          21e-4,
          304.04
        ],
        MS4: [
          34e-4,
          51.05
        ],
        M6: [
          1e-4,
          143.71
        ],
        S4: [
          5e-4,
          282.46
        ],
        "2Q1": [
          4e-4,
          300.81
        ],
        OO1: [
          2e-4,
          204.51
        ]
      }
    },
    zlatnirat: {
      gauge: {
        lat: 43.507,
        lon: 16.442,
        km: 31.9,
        source: "gesla.cmems"
      },
      cons: {
        M2: [
          0.0612,
          124.13
        ],
        K1: [
          0.0797,
          54.19
        ],
        N2: [
          0.0111,
          155.62
        ],
        O1: [
          0.0242,
          40.07
        ],
        P1: [
          0.0281,
          46.3
        ],
        Q1: [
          43e-4,
          53.95
        ],
        K2: [
          0.0106,
          131.3
        ],
        S2: [
          0.0417,
          125.43
        ],
        SA: [
          0.0266,
          332.04
        ],
        T2: [
          38e-4,
          338.29
        ],
        MF: [
          0.0147,
          157.08
        ],
        MM: [
          0.0149,
          71.14
        ],
        "2N2": [
          14e-4,
          140.32
        ],
        M4: [
          7e-4,
          21.16
        ],
        J1: [
          49e-4,
          62.81
        ],
        SSA: [
          0.0258,
          136.36
        ],
        L2: [
          3e-3,
          177.89
        ],
        M3: [
          15e-4,
          8.26
        ],
        MN4: [
          4e-4,
          353.19
        ],
        MS4: [
          2e-4,
          19.34
        ],
        M6: [
          2e-4,
          353.26
        ],
        S4: [
          1e-4,
          129.67
        ],
        "2Q1": [
          12e-4,
          40.46
        ],
        OO1: [
          2e-3,
          46.99
        ]
      }
    },
    tofino: {
      gauge: {
        lat: 48.95,
        lon: 234.45,
        km: 13,
        source: "gesla.noaa"
      },
      cons: {
        M2: [
          0.9366,
          235.55
        ],
        K1: [
          0.3788,
          245.56
        ],
        N2: [
          0.1952,
          211.03
        ],
        O1: [
          0.2417,
          230.16
        ],
        P1: [
          0.1174,
          241.2
        ],
        Q1: [
          0.043,
          222.53
        ],
        K2: [
          0.0722,
          255.36
        ],
        S2: [
          0.2685,
          264.05
        ],
        SA: [
          0.1251,
          2.56
        ],
        T2: [
          0.0165,
          258.59
        ],
        MF: [
          0.0115,
          172
        ],
        MM: [
          58e-4,
          251.74
        ],
        "2N2": [
          0.0223,
          186
        ],
        M4: [
          39e-4,
          167.68
        ],
        J1: [
          0.0211,
          251.67
        ],
        SSA: [
          0.0317,
          246.8
        ],
        L2: [
          0.0227,
          251.3
        ],
        M3: [
          17e-4,
          287.75
        ],
        MN4: [
          17e-4,
          126.66
        ],
        MS4: [
          13e-4,
          212.26
        ],
        M6: [
          17e-4,
          324.38
        ],
        S4: [
          7e-4,
          49.01
        ],
        "2Q1": [
          62e-4,
          228.29
        ],
        OO1: [
          0.0153,
          256.55
        ]
      }
    },
    cannon: {
      gauge: {
        lat: 46.172,
        lon: 236.165,
        km: 32.7,
        source: "gesla.mi_c"
      },
      cons: {
        M2: [
          0.9354,
          262.32
        ],
        K1: [
          0.4025,
          255.07
        ],
        N2: [
          0.176,
          239.07
        ],
        O1: [
          0.24,
          241.01
        ],
        P1: [
          0.1122,
          252.14
        ],
        Q1: [
          0.0403,
          242.26
        ],
        K2: [
          0.0685,
          283.18
        ],
        S2: [
          0.2279,
          294.48
        ],
        SA: [
          0.0909,
          30.69
        ],
        T2: [
          0.0107,
          297.41
        ],
        MF: [
          0.0204,
          137.33
        ],
        MM: [
          0.0198,
          45.48
        ],
        "2N2": [
          0.0172,
          216.14
        ],
        M4: [
          0.0147,
          60.35
        ],
        J1: [
          0.0153,
          281.96
        ],
        SSA: [
          0.0525,
          181.45
        ],
        L2: [
          0.0414,
          277.15
        ],
        M3: [
          22e-4,
          322.02
        ],
        MN4: [
          84e-4,
          40.75
        ],
        MS4: [
          0.0109,
          85.64
        ],
        M6: [
          77e-4,
          106.66
        ],
        S4: [
          37e-4,
          127.66
        ],
        "2Q1": [
          48e-4,
          231.98
        ],
        OO1: [
          0.0116,
          282.29
        ]
      }
    },
    huntington: {
      gauge: {
        lat: 33.45,
        lon: 241.517,
        km: 50,
        source: "gesla.meds"
      },
      cons: {
        M2: [
          0.4763,
          148.92
        ],
        K1: [
          0.3378,
          210.54
        ],
        N2: [
          0.1155,
          127.52
        ],
        O1: [
          0.2143,
          194.3
        ],
        P1: [
          0.1033,
          209.55
        ],
        Q1: [
          0.0394,
          186.88
        ],
        K2: [
          0.0568,
          132.88
        ],
        S2: [
          0.1904,
          142.1
        ],
        SA: [
          0.0639,
          255.71
        ],
        T2: [
          33e-4,
          151.1
        ],
        MF: [
          47e-4,
          119.84
        ],
        MM: [
          29e-4,
          76.54
        ],
        "2N2": [
          0.015,
          97.99
        ],
        M4: [
          2e-3,
          270.07
        ],
        J1: [
          0.0188,
          220.69
        ],
        SSA: [
          0.0233,
          305.65
        ],
        L2: [
          86e-4,
          159.91
        ],
        M3: [
          27e-4,
          353.99
        ],
        MN4: [
          11e-4,
          222.53
        ],
        MS4: [
          8e-4,
          204.61
        ],
        M6: [
          1e-4,
          260.88
        ],
        S4: [
          12e-4,
          252.85
        ],
        "2Q1": [
          48e-4,
          177.64
        ],
        OO1: [
          0.0123,
          263.6
        ]
      }
    },
    capecod: {
      gauge: {
        lat: 41.688,
        lon: 290.049,
        km: 16.9,
        source: "gesla.usgs"
      },
      cons: {
        M2: [
          0.766,
          135.2
        ],
        K1: [
          0.1085,
          231.58
        ],
        N2: [
          0.1578,
          104.03
        ],
        O1: [
          0.0912,
          215.82
        ],
        P1: [
          0.0331,
          227.36
        ],
        Q1: [
          0.0164,
          214.29
        ],
        K2: [
          0.0292,
          172.5
        ],
        S2: [
          0.0987,
          174.91
        ],
        SA: [
          0.0186,
          260.24
        ],
        T2: [
          84e-4,
          156.31
        ],
        MF: [
          89e-4,
          320.99
        ],
        MM: [
          0.0447,
          33.41
        ],
        "2N2": [
          0.019,
          83.18
        ],
        M4: [
          0.0411,
          183.07
        ],
        J1: [
          36e-4,
          270.72
        ],
        SSA: [
          0.0103,
          70.03
        ],
        L2: [
          0.047,
          171.9
        ],
        M3: [
          2e-3,
          132.09
        ],
        MN4: [
          0.0215,
          160.34
        ],
        MS4: [
          0.0149,
          229.39
        ],
        M6: [
          0.017,
          137.44
        ],
        S4: [
          17e-4,
          275.35
        ],
        "2Q1": [
          16e-4,
          236.13
        ],
        OO1: [
          24e-4,
          251.83
        ]
      }
    },
    cancun: {
      gauge: {
        lat: 20.868,
        lon: 273.133,
        km: 23.2,
        source: "gesla.cmems"
      },
      cons: {
        M2: [
          71e-4,
          73.98
        ],
        K1: [
          6e-4,
          274.66
        ],
        N2: [
          23e-4,
          60.98
        ],
        O1: [
          27e-4,
          13.41
        ],
        P1: [
          1e-4,
          312.57
        ],
        Q1: [
          8e-4,
          0.06
        ],
        K2: [
          7e-4,
          30.91
        ],
        S2: [
          26e-4,
          40.05
        ],
        SA: [
          55e-4,
          275.11
        ],
        T2: [
          1e-4,
          72.23
        ],
        MF: [
          14e-4,
          338.63
        ],
        MM: [
          13e-4,
          316.73
        ],
        "2N2": [
          4e-4,
          48.06
        ],
        M4: [
          0,
          344.15
        ],
        J1: [
          1e-4,
          261.16
        ],
        SSA: [
          38e-4,
          52.02
        ],
        L2: [
          2e-4,
          146.63
        ],
        M3: [
          2e-4,
          243.46
        ],
        MN4: [
          0,
          47.99
        ],
        MS4: [
          0,
          348.51
        ],
        M6: [
          1e-4,
          201.01
        ],
        S4: [
          0,
          127.04
        ],
        "2Q1": [
          1e-4,
          10.96
        ],
        OO1: [
          1e-4,
          204.44
        ]
      }
    },
    zicatela: {
      gauge: {
        lat: 15.667,
        lon: 263.508,
        km: 63.8,
        source: "gesla.noaa"
      },
      cons: {
        M2: [
          0.4149,
          243.49
        ],
        K1: [
          0.0989,
          124.51
        ],
        N2: [
          0.0946,
          200.94
        ],
        O1: [
          0.0723,
          139.29
        ],
        P1: [
          0.0316,
          124.41
        ],
        Q1: [
          0.0156,
          143.73
        ],
        K2: [
          0.0126,
          359.4
        ],
        S2: [
          0.0646,
          354.36
        ],
        SA: [
          0.0535,
          226.7
        ],
        T2: [
          79e-4,
          5.49
        ],
        MF: [
          7e-3,
          45.44
        ],
        MM: [
          0.0117,
          5.56
        ],
        "2N2": [
          0.0119,
          165.75
        ],
        M4: [
          1e-3,
          136.98
        ],
        J1: [
          67e-4,
          122.65
        ],
        SSA: [
          0.0147,
          161.66
        ],
        L2: [
          61e-4,
          300.43
        ],
        M3: [
          2e-3,
          122.58
        ],
        MN4: [
          6e-4,
          61.75
        ],
        MS4: [
          8e-4,
          290.17
        ],
        M6: [
          14e-4,
          88.2
        ],
        S4: [
          5e-4,
          43.72
        ],
        "2Q1": [
          24e-4,
          134.87
        ],
        OO1: [
          45e-4,
          120.56
        ]
      }
    },
    vinadelmar: {
      gauge: {
        lat: -33.027,
        lon: 288.375,
        km: 6.8,
        source: "gesla.noaa"
      },
      cons: {
        M2: [
          0.4302,
          60.88
        ],
        K1: [
          0.1542,
          41.23
        ],
        N2: [
          0.0952,
          29.82
        ],
        O1: [
          0.0999,
          355.96
        ],
        P1: [
          0.0486,
          34.91
        ],
        Q1: [
          0.0206,
          327.19
        ],
        K2: [
          0.0442,
          73.93
        ],
        S2: [
          0.146,
          82.94
        ],
        SA: [
          0.0353,
          72.3
        ],
        T2: [
          56e-4,
          76.58
        ],
        MF: [
          11e-4,
          349.31
        ],
        MM: [
          64e-4,
          36.07
        ],
        "2N2": [
          0.0123,
          355.44
        ],
        M4: [
          24e-4,
          21.04
        ],
        J1: [
          61e-4,
          78.97
        ],
        SSA: [
          0.0234,
          168.47
        ],
        L2: [
          95e-4,
          71.01
        ],
        M3: [
          28e-4,
          265.49
        ],
        MN4: [
          9e-4,
          313.15
        ],
        MS4: [
          5e-4,
          107.65
        ],
        M6: [
          2e-4,
          12.57
        ],
        S4: [
          9e-4,
          246.22
        ],
        "2Q1": [
          19e-4,
          311.16
        ],
        OO1: [
          3e-3,
          127.61
        ]
      }
    }
  }
};

var hex2 = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};
var STATIONS = tideStations_default.stations;
var SPECS = [
  { id: "bondi", region: "Oceania", name: "Bondi Beach", place: "Sydney", lat: -33.8915, lon: 151.2767, timeZone: "Australia/Sydney", facing: 115, waves: 1.05, sand: hex2("#f2d9a8"), sandMix: 0.5, water: hex2("#2aa7c0"), waterMix: 0.3 },
  { id: "waikiki", region: "Oceania", name: "Waik\u012Bk\u012B", place: "Honolulu", lat: 21.2766, lon: -157.8278, timeZone: "Pacific/Honolulu", facing: 200, waves: 0.75, sand: hex2("#f6e6c6"), sandMix: 0.5, water: hex2("#22c4c9"), waterMix: 0.45 },
  { id: "santamonica", region: "North America", name: "Santa Monica", place: "Los Angeles", lat: 34.0095, lon: -118.497, timeZone: "America/Los_Angeles", facing: 220, waves: 0.9, sand: hex2("#e8d2a6"), sandMix: 0.45, water: hex2("#3b8fa6"), waterMix: 0.35 },
  { id: "southbeach", region: "North America", name: "South Beach", place: "Miami", lat: 25.7826, lon: -80.13, timeZone: "America/New_York", facing: 90, waves: 0.6, sand: hex2("#f7ecd6"), sandMix: 0.55, water: hex2("#36d0c4"), waterMix: 0.45 },
  { id: "copacabana", region: "South America", name: "Copacabana", place: "Rio de Janeiro", lat: -22.9711, lon: -43.1822, timeZone: "America/Sao_Paulo", facing: 150, waves: 0.95, sand: hex2("#f4e4c4"), sandMix: 0.5, water: hex2("#2f9fb0"), waterMix: 0.35 },
  { id: "brighton", region: "Europe", name: "Brighton Beach", place: "England", lat: 50.8197, lon: -0.1372, timeZone: "Europe/London", facing: 180, waves: 0.8, sand: hex2("#b9a890"), sandMix: 0.6, water: hex2("#5f8f8e"), waterMix: 0.5 },
  { id: "biarritz", region: "Europe", name: "Grande Plage", place: "Biarritz", lat: 43.4832, lon: -1.5586, timeZone: "Europe/Paris", facing: 300, waves: 1.15, sand: hex2("#e9cfa0"), sandMix: 0.45, water: hex2("#2f7f9c"), waterMix: 0.35 },
  { id: "campsbay", region: "Africa & Middle East", name: "Camps Bay", place: "Cape Town", lat: -33.951, lon: 18.377, timeZone: "Africa/Johannesburg", facing: 270, waves: 1.05, sand: hex2("#f8f1e2"), sandMix: 0.6, water: hex2("#2b8f9e"), waterMix: 0.4 },
  { id: "patong", region: "Asia", name: "Patong Beach", place: "Phuket", lat: 7.8961, lon: 98.296, timeZone: "Asia/Bangkok", facing: 260, waves: 0.7, sand: hex2("#f1dfbd"), sandMix: 0.45, water: hex2("#2fb3b0"), waterMix: 0.4 },
  { id: "kuta", region: "Asia", name: "Kuta Beach", place: "Bali", lat: -8.718, lon: 115.1686, timeZone: "Asia/Makassar", facing: 250, waves: 1, sand: hex2("#e2c896"), sandMix: 0.45, water: hex2("#2a9fb6"), waterMix: 0.35 },
  { id: "nice", region: "Europe", name: "Promenade des Anglais", place: "Nice", lat: 43.6947, lon: 7.265, timeZone: "Europe/Paris", facing: 180, waves: 0.45, sand: hex2("#c9bfae"), sandMix: 0.6, water: hex2("#1f8fc0"), waterMix: 0.5 },
  { id: "kamakura", region: "Asia", name: "Yuigahama", place: "Kamakura", lat: 35.3106, lon: 139.543, timeZone: "Asia/Tokyo", facing: 180, waves: 0.85, sand: hex2("#9c8a78"), sandMix: 0.55, water: hex2("#3b8597"), waterMix: 0.35 },
  { id: "piha", region: "Oceania", name: "Piha", place: "Auckland", lat: -36.954, lon: 174.468, timeZone: "Pacific/Auckland", facing: 270, waves: 1.15, sand: hex2("#4f4a49"), sandMix: 0.7, water: hex2("#2f7d88"), waterMix: 0.35 },
  // added 2026-11-26
  { id: "whitehaven", region: "Oceania", name: "Whitehaven Beach", place: "Whitsundays", lat: -20.2826, lon: 149.0386, timeZone: "Australia/Brisbane", facing: 120, waves: 0.5, sand: hex2("#fbfaf5"), sandMix: 0.7, water: hex2("#2fc6d0"), waterMix: 0.5 },
  { id: "surfers", region: "Oceania", name: "Surfers Paradise", place: "Gold Coast", lat: -28.0023, lon: 153.431, timeZone: "Australia/Brisbane", facing: 90, waves: 1.05, sand: hex2("#f3dfb6"), sandMix: 0.5, water: hex2("#2a9fbe"), waterMix: 0.35 },
  { id: "cable", region: "Oceania", name: "Cable Beach", place: "Broome", lat: -17.933, lon: 122.21, timeZone: "Australia/Perth", facing: 270, waves: 0.6, sand: hex2("#f3dcb3"), sandMix: 0.5, water: hex2("#3bb3b3"), waterMix: 0.45 },
  { id: "railay", region: "Asia", name: "Railay West", place: "Krabi", lat: 8.0115, lon: 98.8378, timeZone: "Asia/Bangkok", facing: 250, waves: 0.45, sand: hex2("#f3e6c8"), sandMix: 0.5, water: hex2("#33b8b0"), waterMix: 0.45 },
  { id: "haeundae", region: "Asia", name: "Haeundae", place: "Busan", lat: 35.1587, lon: 129.1604, timeZone: "Asia/Seoul", facing: 160, waves: 0.7, sand: hex2("#d9c7a4"), sandMix: 0.5, water: hex2("#3a8fa6"), waterMix: 0.35 },
  { id: "anse", region: "Africa & Middle East", name: "Anse Source d'Argent", place: "La Digue", lat: -4.3707, lon: 55.8247, timeZone: "Indian/Mahe", facing: 250, waves: 0.4, sand: hex2("#f7efe0"), sandMix: 0.6, water: hex2("#3dd0c8"), waterMix: 0.5 },
  { id: "nungwi", region: "Africa & Middle East", name: "Nungwi", place: "Zanzibar", lat: -5.727, lon: 39.295, timeZone: "Africa/Dar_es_Salaam", facing: 270, waves: 0.5, sand: hex2("#faf3e3"), sandMix: 0.6, water: hex2("#36c9c4"), waterMix: 0.5 },
  { id: "sylt", region: "Europe", name: "Westerland", place: "Sylt", lat: 54.9079, lon: 8.303, timeZone: "Europe/Berlin", facing: 270, waves: 0.9, sand: hex2("#e8dcc0"), sandMix: 0.55, water: hex2("#5f8a8c"), waterMix: 0.5 },
  { id: "scheveningen", region: "Europe", name: "Scheveningen", place: "The Hague", lat: 52.1113, lon: 4.2797, timeZone: "Europe/Amsterdam", facing: 300, waves: 0.75, sand: hex2("#e3d4b4"), sandMix: 0.5, water: hex2("#5e8584"), waterMix: 0.5 },
  { id: "fistral", region: "Europe", name: "Fistral Beach", place: "Newquay", lat: 50.4168, lon: -5.1, timeZone: "Europe/London", facing: 300, waves: 1.1, sand: hex2("#e6d3a9"), sandMix: 0.5, water: hex2("#3d8696"), waterMix: 0.4 },
  { id: "nazare", region: "Europe", name: "Praia da Nazar\xE9", place: "Portugal", lat: 39.6012, lon: -9.0736, timeZone: "Europe/Lisbon", facing: 270, waves: 1.15, sand: hex2("#e9d6ae"), sandMix: 0.5, water: hex2("#2f7f96"), waterMix: 0.35 },
  { id: "marinha", region: "Europe", name: "Praia da Marinha", place: "Algarve", lat: 37.0899, lon: -8.4123, timeZone: "Europe/Lisbon", facing: 180, waves: 0.6, sand: hex2("#e7c58f"), sandMix: 0.55, water: hex2("#2aa6b8"), waterMix: 0.45 },
  { id: "barceloneta", region: "Europe", name: "Barceloneta", place: "Barcelona", lat: 41.3784, lon: 2.1925, timeZone: "Europe/Madrid", facing: 135, waves: 0.5, sand: hex2("#dcc59a"), sandMix: 0.5, water: hex2("#2f95b8"), waterMix: 0.4 },
  { id: "zlatnirat", region: "Europe", name: "Zlatni Rat", place: "Bra\u010D", lat: 43.2558, lon: 16.6339, timeZone: "Europe/Zagreb", facing: 180, waves: 0.4, sand: hex2("#ddd6c8"), sandMix: 0.6, water: hex2("#1d9fc8"), waterMix: 0.55 },
  { id: "tofino", region: "North America", name: "Long Beach", place: "Tofino", lat: 49.03, lon: -125.68, timeZone: "America/Vancouver", facing: 225, waves: 1.15, sand: hex2("#cbbb9c"), sandMix: 0.5, water: hex2("#3f7a84"), waterMix: 0.4 },
  { id: "cannon", region: "North America", name: "Cannon Beach", place: "Oregon", lat: 45.8918, lon: -123.9615, timeZone: "America/Los_Angeles", facing: 270, waves: 1.1, sand: hex2("#c9b89a"), sandMix: 0.5, water: hex2("#4a7f8a"), waterMix: 0.4 },
  { id: "huntington", region: "North America", name: "Huntington Beach", place: "California", lat: 33.6553, lon: -118.003, timeZone: "America/Los_Angeles", facing: 210, waves: 1, sand: hex2("#e4cfa3"), sandMix: 0.45, water: hex2("#3a8ea4"), waterMix: 0.35 },
  { id: "capecod", region: "North America", name: "Coast Guard Beach", place: "Cape Cod", lat: 41.8395, lon: -69.9435, timeZone: "America/New_York", facing: 90, waves: 0.9, sand: hex2("#e2d1ad"), sandMix: 0.5, water: hex2("#3e7f8e"), waterMix: 0.4 },
  { id: "cancun", region: "Caribbean & Central America", name: "Playa Delfines", place: "Canc\xFAn", lat: 21.06, lon: -86.78, timeZone: "America/Cancun", facing: 90, waves: 0.6, sand: hex2("#faf5e8"), sandMix: 0.6, water: hex2("#33d0c8"), waterMix: 0.55 },
  { id: "zicatela", region: "Caribbean & Central America", name: "Zicatela", place: "Puerto Escondido", lat: 15.853, lon: -97.056, timeZone: "America/Mexico_City", facing: 200, waves: 1.15, sand: hex2("#e0c595"), sandMix: 0.5, water: hex2("#2b8fab"), waterMix: 0.35 },
  { id: "vinadelmar", region: "South America", name: "Vi\xF1a del Mar", place: "Chile", lat: -33.015, lon: -71.553, timeZone: "America/Santiago", facing: 280, waves: 1, sand: hex2("#c9b693"), sandMix: 0.5, water: hex2("#3a7f90"), waterMix: 0.35 }
];
var BEACHES = SPECS.map((s) => ({
  ...s,
  tide: STATIONS[s.id].cons,
  gaugeKm: STATIONS[s.id].gauge.km
}));
function beachById(id) {
  return BEACHES.find((b) => b.id === id);
}

function placeCoords() {
  return BEACHES.map((b) => ({ id: b.id, lat: b.lat, lon: b.lon }));
}
var CATCHUP_DEFAULTS = { ...CATCHUP };
async function catchUpSaved(bytes, location, from, to, maxGapDays = CATCHUP.maxGapDays) {
  const place = beachById(location);
  if (!place) return null;
  const saved = fitWorld(await decodeSand(bytes));
  const out = catchUp({
    nx: saved.nx,
    ny: saved.ny,
    delta: saved.delta,
    objects: saved.objects,
    tide: (ms) => diorama(tideHeight(place.tide, new Date(ms))),
    waves: place.waves,
    from,
    to,
    maxGapDays
  });
  const changed = out.sandMoved > 1e-6 || out.objects.length < saved.objects.length || out.broughtIn > 0;
  return {
    // the sand piled on buried rocks (BCH3) is kept as it was: the catch-up
    // works on the sand around them
    bytes: changed ? await encodeSand(out.delta, saved.nx, saved.ny, out.objects, saved.cover) : bytes,
    nx: saved.nx,
    ny: saved.ny,
    changed,
    lost: out.lost.map((o) => o.item),
    broughtIn: out.broughtIn,
    highTides: out.highTides,
    sandMoved: out.sandMoved,
    from: out.from,
    to: out.to
  };
}
export {
  CATCHUP_DEFAULTS,
  catchUpSaved,
  placeCoords,
  sanitizeObjects
};
