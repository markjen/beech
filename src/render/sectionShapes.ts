// The inland sections' shapes (docs/INLAND_SECTIONS.md), with no Babylon in
// them: the app's SectionLayer (sections.ts) makes meshes of them, and the
// server's pictures draw them from above (scripts/bundle-server.mjs bundles
// this file into server/src/generated/sections.ts).
//
// Rows of scenery behind a
// beach, each a slab as wide as the beach and SECTION.depth deep. Row 0
// touches the back of the sand. Scenery only: nothing in the simulation
// knows they're there.
//
// Each row's left (-x) and right (+x) edge either joins the same section on
// a directly linked neighbor (the surface runs straight on) or ends in the
// type's finished edge. Every type has an access point in the middle of its
// front and back so different types connect inland.
//
// Geometry is built in the row's own frame: x across (0 = the beach's
// middle), y up, z = metres inland from the row's front edge. Parts are
// grouped by colour so a row is a handful of meshes.


import { SECTION, WORLD_SIZE_X } from '../config';
import { PROP_COLORS, type RGB } from '../palette';
import { box, rng } from './meshMath';

export { SECTION, PROP_COLORS };

export type ColorKey = keyof typeof PROP_COLORS | `${'secWall' | 'secAwning'}${number}`;
export type SectionParts = Map<ColorKey, { P: number[]; I: number[] }>;

/** The ground of a row that is beach sand (boardwalk, dunes, sand): the
    layer paints this with the live sandDry, so the row's sand matches the
    beach's instead of the fixed secSand. The fixed colour behind the key is
    only the fallback for the shore site's pictures. */
export const SAND_GROUND_KEY: ColorKey = 'secSandGround';

const HALF = WORLD_SIZE_X / 2;

export function colorOf(key: ColorKey): RGB {
  const m = /^(secWall|secAwning)(\d+)$/.exec(key);
  if (m) {
    const list = PROP_COLORS[m[1] as 'secWall' | 'secAwning'];
    return list[Number(m[2]) % list.length];
  }
  return PROP_COLORS[key as keyof typeof PROP_COLORS] as RGB;
}

/** One row's geometry (pure, so a test can measure it). `plainSand` renders
    a sand row as the beach's own sand: just the slab, no dune lip or grass
    at its finished edges — the preview of rows the grid will draw after
    save, so the preview looks like the sand they will become. */
export function sectionGeometry(type: string, joinNeg: boolean, joinPos: boolean, seed = 1, opts: { plainSand?: boolean } = {}): SectionParts {
  const D = SECTION.depth;
  const G = SECTION.ground;
  const parts: SectionParts = new Map();
  const put = (c: ColorKey, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, tilt = 0) => {
    let g = parts.get(c);
    if (!g) parts.set(c, (g = { P: [], I: [] }));
    box(g.P, g.I, cx, cy, cz, sx, sy, sz, tilt);
  };
  /** a flat layer `h` thick on the ground, from x0 to x1 and z0 to z1 */
  const flat = (c: ColorKey, x0: number, x1: number, z0: number, z1: number, h = 0.04, lift = 0) =>
    put(c, (x0 + x1) / 2, G + lift + h / 2, (z0 + z1) / 2, x1 - x0, h, z1 - z0);
  /** a post standing on the ground (or on `base`) */
  const post = (c: ColorKey, x: number, z: number, h: number, w = 0.1, base = G) => put(c, x, base + h / 2, z, w, h, w);
  /** a rail between two points at height y, along x or along z */
  const railX = (c: ColorKey, x0: number, x1: number, z: number, y: number, t = 0.07) => put(c, (x0 + x1) / 2, y, z, Math.abs(x1 - x0), t, t);
  const railZ = (c: ColorKey, x: number, z0: number, z1: number, y: number, t = 0.07) => put(c, x, y, (z0 + z1) / 2, t, t, Math.abs(z1 - z0));
  const r = rng(seed * 7919 + type.length);
  const tuft = (tx: number, tz: number, s = 1) => {
    const x = Math.min(HALF - 0.4, Math.max(-HALF + 0.4, tx));
    const z = Math.min(D - 0.4, Math.max(0.4, tz));
    const h = (0.35 + r() * 0.35) * s;
    put(r() < 0.5 ? 'secGrass' : 'secGrassDark', x, G + h / 2, z, 0.12 * s, h, 0.12 * s, (r() - 0.5) * 0.5);
    put('secGrass', x + 0.12 * s, G + h * 0.4, z + 0.08, 0.1 * s, h * 0.8, 0.1 * s, (r() - 0.5) * 0.6);
  };
  const shrub = (x: number, z: number, s = 1) => {
    put('secLeaf', x, G + 0.35 * s, z, 0.9 * s, 0.7 * s, 0.9 * s);
    put('secGrassDark', x + 0.15 * s, G + 0.65 * s, z - 0.1 * s, 0.55 * s, 0.4 * s, 0.6 * s);
  };
  const tree = (x: number, z: number, s = 1) => {
    post('secTrunk', x, z, 2.2 * s, 0.25 * s);
    put('secLeaf', x, G + 2.7 * s, z, 2.4 * s, 1.4 * s, 2.4 * s);
    put('secGrassDark', x, G + 3.5 * s, z, 1.6 * s, 0.9 * s, 1.6 * s);
  };
  const bench = (x: number, z: number, alongX = true) => {
    const [w, d] = alongX ? [1.6, 0.45] : [0.45, 1.6];
    put('secTable', x, G + 0.45, z, w, 0.07, d);
    for (const s of [-1, 1]) put('secTrunk', x + (alongX ? s * 0.65 : 0), G + 0.21, z + (alongX ? 0 : s * 0.65), 0.08, 0.42, 0.08);
  };
  const picnicTable = (x: number, z: number) => {
    put('secTable', x, G + 0.75, z, 1.8, 0.06, 0.8);
    for (const s of [-1, 1]) {
      put('secTable', x, G + 0.45, z + s * 0.65, 1.8, 0.05, 0.3);
      put('secTrunk', x + s * 0.7, G + 0.37, z, 0.08, 0.74, 0.9);
    }
  };
  /** the run of a feature along x: to the edge where it joins, short of it where it ends */
  const span = (inset: number): [number, number] => [joinNeg ? -HALF : -HALF + inset, joinPos ? HALF : HALF - inset];
  const ends = (fn: (side: -1 | 1, edge: number) => void) => {
    if (!joinNeg) fn(-1, -HALF);
    if (!joinPos) fn(1, HALF);
  };

  // the slab: earth sides, and the type's ground on top
  const groundColor: ColorKey =
    type === 'section-path' || type === 'section-picnic' || type === 'section-playground' ? 'secGrass' : type === 'section-road' || type === 'section-shops' ? 'secCurb' : SAND_GROUND_KEY;
  put('secSoil', 0, (G - 0.05 + SECTION.bottom) / 2, D / 2, WORLD_SIZE_X, G - 0.05 - SECTION.bottom, D);
  flat(groundColor, -HALF, HALF, 0, D, 0.05, -0.05);

  switch (type) {
    case 'section-sand': {
      // dry sand at the beach's grade; a finished edge is a low dune lip with grass.
      // Plain sand is the beach's own sand, not scenery, so it has no finished edge.
      if (!opts.plainSand) {
        ends((s, e) => {
          put('secTrail', e - s * 0.9, G + 0.12, D / 2, 1.8, 0.24, D);
          put('secTrail', e - s * 0.5, G + 0.3, D / 2, 1.0, 0.25, D - 0.6);
          for (let z = 0.6; z < D; z += 0.9 + r() * 0.6) tuft(e - s * (0.3 + r() * 1.2), z);
        });
      }
      break;
    }
    case 'section-boardwalk': {
      // a raised deck along the row, rails both sides, a ramp down to the
      // front access point (and one at the back). A finished end widens into
      // a viewing deck with a bench.
      const top = G + 0.5;
      const z0 = 4;
      const z1 = 8;
      const [a, b] = span(4);
      put('secPlank', (a + b) / 2, top - 0.06, (z0 + z1) / 2, b - a, 0.12, z1 - z0);
      for (let x = Math.ceil(a / 0.6) * 0.6; x < b; x += 0.6) put('secTrunk', x, top + 0.002, (z0 + z1) / 2, 0.03, 0.01, z1 - z0);
      for (let x = a + 1; x < b; x += 2.5) for (const z of [z0 + 0.15, z1 - 0.15]) post('secTrunk', x, z, top - G - 0.12, 0.16);
      const gap = (x: number) => Math.abs(x) < 1.3; // where the ramps meet the rail
      for (const z of [z0 + 0.05, z1 - 0.05]) {
        for (let x = a + 0.05; x <= b; x += 2) if (!gap(x)) post('secRail', x, z, 0.9, 0.08, top);
        railX('secRail', a, -1.25, z, top + 0.9);
        railX('secRail', 1.25, b, z, top + 0.9);
      }
      const ramp = (zFrom: number, zTo: number) => {
        const run = Math.abs(zTo - zFrom);
        const ang = Math.atan2(top - G, run) * Math.sign(zTo - zFrom);
        put('secPlank', 0, (top + G) / 2 - 0.06, (zFrom + zTo) / 2, 2.4, 0.1, Math.hypot(run, top - G), ang);
      };
      ramp(z0, 0.6);
      ramp(z1, D - 0.6);
      ends((s, e) => {
        const x = e - s * 4;
        // the viewing deck
        put('secPlank', x - s * 1.6, top - 0.06, D / 2, 3.2, 0.12, 6.4);
        for (const z of [D / 2 - 3.2, D / 2 + 3.2]) for (const dx of [0.2, 1.6, 3]) post('secTrunk', x - s * dx, z, top - G - 0.12, 0.16);
        railX('secRail', x, x - s * 3.2, D / 2 - 3.15, top + 0.9);
        railX('secRail', x, x - s * 3.2, D / 2 + 3.15, top + 0.9);
        railZ('secRail', x - s * 0.05, D / 2 - 3.2, D / 2 + 3.2, top + 0.9);
        for (const z of [D / 2 - 3.15, D / 2, D / 2 + 3.15]) post('secRail', x - s * 0.05, z, 0.9, 0.08, top);
        put('secTable', x - s * 1.2, top + 0.45, D / 2, 0.45, 0.07, 1.6);
        put('secTrunk', x - s * 1.2, top + 0.22, D / 2, 0.4, 0.44, 1.2);
        // no grass here: the deck stands on bare sand, and tufts scattered
        // on the sand around it read as weeds (Discord #bugs, kt22chute75)
      });
      break;
    }
    case 'section-path': {
      // pavement with a dashed centre line, a planted verge each side; a
      // finished end loops round in a wider turnaround
      const z0 = 3.5;
      const z1 = 8.5;
      const [a, b] = span(6);
      flat('secPave', a, b, z0, z1, 0.06);
      for (let x = Math.ceil(a / 3) * 3 + 0.75; x < b - 1; x += 3) flat('secLine', x - 0.75, x + 0.75, D / 2 - 0.07, D / 2 + 0.07, 0.07);
      flat('secPave', -1.2, 1.2, 0, z0, 0.06); // access, front and back
      flat('secPave', -1.2, 1.2, z1, D, 0.06);
      for (let x = a + 1.5; x < b; x += 4 + r() * 2) if (Math.abs(x) > 2.5) shrub(x, 1.4 + r() * 0.6, 0.8);
      for (let x = a + 3; x < b - 1; x += 5 + r() * 2) if (Math.abs(x) > 2.5) tree(x, D - 2, 0.8);
      ends((s, e) => {
        const cx = e - s * 4.5;
        flat('secPave', Math.min(cx - 3.2, cx + 3.2), Math.max(cx - 3.2, cx + 3.2), D / 2 - 3.6, D / 2 + 3.6, 0.06);
        flat('secPave', Math.min(cx - 2.4, cx + 2.4), Math.max(cx - 2.4, cx + 2.4), D / 2 - 4.3, D / 2 + 4.3, 0.06);
        flat('secGrass', cx - 1.4, cx + 1.4, D / 2 - 1.4, D / 2 + 1.4, 0.12);
        shrub(cx, D / 2, 0.9);
        for (let z = 0.8; z < D - 0.8; z += 1.6) shrub(e - s * 0.7, z, 0.6 + r() * 0.3);
      });
      break;
    }
    case 'section-playground': {
      // a soft play surface inside a low fence, open where it joins
      const [a, b] = span(2.5);
      flat('secPlay', a, b, 1, D - 1, 0.06);
      for (const z of [1, D - 1]) {
        for (let x = a + 0.1; x <= b - 0.1; x += 2) if (Math.abs(x) > 1.4) post('secRail', x, z, 0.8, 0.08);
        railX('secRail', a, -1.4, z, G + 0.8);
        railX('secRail', 1.4, b, z, G + 0.8);
        railX('secRail', a, -1.4, z, G + 0.4, 0.05);
        railX('secRail', 1.4, b, z, G + 0.4, 0.05);
      }
      // swings
      const swing = (cx: number, cz: number) => {
        for (const s of [-1, 1]) {
          put('secMetal', cx + s * 1.6, G + 1.1, cz - 0.5, 0.08, 2.3, 0.08, 0.25);
          put('secMetal', cx + s * 1.6, G + 1.1, cz + 0.5, 0.08, 2.3, 0.08, -0.25);
        }
        railX('secMetal', cx - 1.6, cx + 1.6, cz, G + 2.2, 0.1);
        for (const s of [-0.7, 0.7]) {
          put('secMetal', cx + s, G + 1.4, cz, 0.03, 1.6, 0.03);
          put('secPlayBright', cx + s, G + 0.6, cz, 0.5, 0.05, 0.25);
        }
      };
      const slide = (cx: number, cz: number) => {
        for (const dx of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) post('secMetal', cx + dx, cz + dz, 1.8, 0.1);
        put('secPlayYellow', cx, G + 1.5, cz, 1.2, 0.08, 1.2);
        put('secPlayYellow', cx, G + 2.2, cz, 1.3, 0.12, 1.3);
        // the chute runs down towards the back of the row
        const run = 2.8;
        const ang = Math.atan2(1.4, run);
        put('secPlayBright', cx, G + 0.8, cz + 0.6 + run / 2, 0.7, 0.08, Math.hypot(run, 1.4), ang);
        for (const s of [-0.35, 0.35]) put('secPlayBright', cx + s, G + 0.95, cz + 0.6 + run / 2, 0.06, 0.2, Math.hypot(run, 1.4), ang);
        // ladder
        for (let y = 0.3; y < 1.5; y += 0.3) railZ('secMetal', cx - 0.6, cz - 0.35, cz + 0.35, G + y, 0.05);
      };
      swing(-8, D / 2);
      slide(5, D / 2 - 1.5);
      // a climbing cube
      for (const dx of [-0.6, 0.6]) for (const dz of [-0.6, 0.6]) post('secPlayYellow', 1 + dx, D / 2 + 2.5 + dz, 1.2, 0.08);
      put('secPlayBright', 1, G + 1.2, D / 2 + 2.5, 1.3, 0.08, 1.3);
      put('secPlayYellow', -2.5, G + 0.25, D / 2 + 2, 1.2, 0.5, 1.2); // sandpit wall
      put('secSand', -2.5, G + 0.3, D / 2 + 2, 1.0, 0.5, 1.0);
      ends((s, e) => {
        const x = e - s * 2.5;
        // the fence closes the end, with planting and a bench outside it
        for (let z = 1; z <= D - 1; z += 2) post('secRail', x, z, 0.8, 0.08);
        railZ('secRail', x, 1, D - 1, G + 0.8);
        railZ('secRail', x, 1, D - 1, G + 0.4, 0.05);
        for (let z = 1.8; z < D - 1; z += 2.2) shrub(e - s * 1.1, z, 0.8);
        bench(e - s * 1.2, 0.5);
      });
      break;
    }
    case 'section-road': {
      // sidewalks either side, curbs, two lanes with a dashed yellow centre
      // line; a finished end turns round in a compact loop with a verge
      const [a, b] = span(1.5);
      flat('secCurb', a, b, 0.6, 2.8, 0.16);
      flat('secCurb', a, b, D - 2.8, D - 0.6, 0.16);
      flat('secAsphalt', a, b, 2.8, D - 2.8, 0.04);
      for (let x = Math.ceil(a / 4) * 4 + 1; x < b - 1; x += 4) flat('secLineYellow', x - 1, x + 1, D / 2 - 0.06, D / 2 + 0.06, 0.05);
      for (const z of [3, D - 3]) flat('secLine', a + (joinNeg ? 0 : 3), b - (joinPos ? 0 : 3), z - 0.05, z + 0.05, 0.05);
      // crossings at the access points
      for (let z = 3.2; z < D - 3; z += 0.7) flat('secLine', -1.2, 1.2, z, z + 0.35, 0.05);
      for (let x = a + 4; x < b; x += 8) if (Math.abs(x) > 3) post('secMetal', x, 1, 3.2, 0.12);
      ends((s, e) => {
        const cx = e - s * 4;
        flat('secAsphalt', Math.min(cx - 2.5, cx + 2.5), Math.max(cx - 2.5, cx + 2.5), 2.2, D - 2.2, 0.04);
        put('secCurb', e - s * 1.3, G + 0.1, D / 2, 0.3, 0.2, D - 1.2);
        flat('secGrass', Math.min(e, e - s * 1.15), Math.max(e, e - s * 1.15), 0.6, D - 0.6, 0.18);
        for (let z = 1.2; z < D; z += 2) shrub(e - s * 0.6, z, 0.6);
      });
      break;
    }
    case 'section-shops': {
      // a sidewalk at the front, a row of little shops with awnings behind;
      // a finished end is a corner shop and a pocket of seating
      flat('secCurb', -HALF, HALF, 0, 4, 0.12);
      const [a, b] = span(4.5);
      const widths: number[] = [];
      for (let x = a; x < b - 0.5; ) {
        const w = Math.min(b - x, 5 + Math.floor(r() * 3));
        widths.push(w);
        x += w;
      }
      let x = a;
      widths.forEach((w, i) => {
        const h = 3 + r() * 1.8;
        const k = Math.floor(r() * 5) + i;
        const cx = x + w / 2;
        put(`secWall${k}`, cx, G + h / 2, 7.5, w - 0.12, h, 7);
        put('secRoof', cx, G + h + 0.08, 7.5, w, 0.16, 7.2);
        put('secGlass', cx, G + 1.2, 3.99, w - 1.2, 1.4, 0.04);
        put('secTrunk', cx + w / 2 - 1.1, G + 1, 3.99, 0.9, 2, 0.05);
        put(`secAwning${k}`, cx, G + 2.6, 3.4, w - 0.3, 0.06, 1.4, -0.35);
        x += w;
      });
      // the alley at the back access point: a gap only where it lands in a shop
      ends((s, e) => {
        const ex = e - s * 4.5;
        // the corner shop's side wall and window
        put('secGlass', ex - s * 0.01, G + 1.2, 6, 0.04, 1.4, 2.5);
        // seating: two tables with chairs, under a parasol
        for (const z of [1.4, 2.9]) {
          const cx = e - s * 2.2;
          put('secTable', cx, G + 0.72, z, 0.7, 0.05, 0.7);
          post('secMetal', cx, z, 0.7, 0.06, G + 0.12);
          for (const d of [-0.6, 0.6]) put('secTable', cx + d, G + 0.45, z, 0.4, 0.05, 0.4);
        }
        post('secMetal', e - s * 2.2, 2.15, 2.3, 0.05, G + 0.12);
        put('secAwning0', e - s * 2.2, G + 2.4, 2.15, 2.2, 0.06, 2.2);
        for (let z = 5; z < D; z += 1.8) shrub(e - s * 2, z, 0.9);
      });
      break;
    }
    case 'section-dunes': {
      // low dunes thick with grass, a sandy trail along the middle and a
      // cross trail at the access points; a finished end curves split-rail fencing
      const [a, b] = span(2);
      flat('secTrail', a, b, D / 2 - 0.7, D / 2 + 0.7, 0.03);
      flat('secTrail', -0.7, 0.7, 0, D, 0.03);
      for (const [z0, z1] of [[0.4, D / 2 - 1.2], [D / 2 + 1.2, D - 0.4]]) {
        for (let x = -HALF + 1.2; x < HALF - 0.6; x += 2.3 + r() * 1.5) {
          if (Math.abs(x) < 1.6) continue;
          const z = Math.max(z0 + 0.7, Math.min(z1 - 0.7, z0 + r() * (z1 - z0)));
          put('secTrail', x, G + 0.1, z, 1.6 + r(), 0.25, 1.2 + r() * 0.8);
          for (let k = 0; k < 4; k++) tuft(x + (r() - 0.5) * 1.6, z + (r() - 0.5) * 1.2);
        }
      }
      ends((s, e) => {
        const x = e - s * 1.4;
        const pts = [0.6, 3, 5.2, D / 2 - 0.9, D / 2 + 0.9, 8.8, 11.4];
        for (const z of pts) {
          const off = Math.abs(z - D / 2) < 1 ? 0.9 : 0.25 * Math.sin((z / D) * Math.PI);
          post('secTrunk', x - s * off, z, 0.9, 0.12);
        }
        for (let i = 0; i + 1 < pts.length; i++) {
          if (pts[i] === D / 2 - 0.9) continue; // the trail runs out through the gap
          const za = pts[i];
          const zb = pts[i + 1];
          const xa = x - s * (Math.abs(za - D / 2) < 1 ? 0.9 : 0.25 * Math.sin((za / D) * Math.PI));
          const xb = x - s * (Math.abs(zb - D / 2) < 1 ? 0.9 : 0.25 * Math.sin((zb / D) * Math.PI));
          const len = Math.hypot(xb - xa, zb - za);
          for (const y of [0.45, 0.8]) {
            const P: number[] = [];
            const I: number[] = [];
            box(P, I, 0, 0, 0, 0.07, 0.07, len);
            const ang = Math.atan2(xb - xa, zb - za);
            let g = parts.get('secTrunk');
            if (!g) parts.set('secTrunk', (g = { P: [], I: [] }));
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
    case 'section-picnic': {
      // shade trees and tables either side of a gravel walk; a finished end
      // widens into a shaded seating pocket
      const [a, b] = span(5);
      flat('secGravel', a, b, D / 2 - 1, D / 2 + 1, 0.05);
      flat('secGravel', -1, 1, 0, D, 0.05);
      for (let x = a + 2; x < b - 1; x += 6) {
        if (Math.abs(x) < 2.5) continue;
        tree(x, 2.4, 1);
        picnicTable(x + 2.2, 3.4);
        tree(x + 3, D - 2.2, 0.9);
        picnicTable(x, D - 3.4);
      }
      ends((s, e) => {
        const cx = e - s * 3;
        flat('secGravel', Math.min(cx - 3, cx + 3), Math.max(cx - 3, cx + 3), D / 2 - 3, D / 2 + 3, 0.05);
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

