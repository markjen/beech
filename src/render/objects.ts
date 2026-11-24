import type { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';

import { ITEM_LOOKS, PROP_COLORS } from '../palette';
import { OBJECT_KINDS, ROCK_HEIGHT, WOOD_RADIUS, floatRadius, type ObjectKind, type ObjectState, type PlacedObject } from '../sim/objects';
import { ORIGIN_X, ORIGIN_Z, type BeachRenderer } from './beachRenderer';
import { box, finish, lathe, orient, rng } from './meshKit';
import { Glow, type GlowHandle } from './glow';
import { STORE_BUILDERS, STORE_REACH, isStoreKind } from './storeMeshes';
import { itemById } from '../world/items';

/**
 * A faceted boulder: a squashed, jittered dome over the same ellipse the
 * simulation uses for its footprint, with a skirt that sinks into the sand.
 */
function rockMesh(scene: Scene, o: PlacedObject): Mesh {
  const r = rng(o.variant * 7919 + 13);
  const rx = o.size;
  const ry = o.size * (0.7 + 0.3 * frac(o.variant * 0.618));
  const H = o.size * ROCK_HEIGHT;
  const seg = 7 + (o.variant % 3);
  const rings = 3;
  const P: number[] = [];
  const I: number[] = [];
  // ring 0 is a skirt below the sand, then rings up the dome, then the top
  const jitter: number[] = [];
  for (let s = 0; s < seg; s++) jitter.push(1.0 + r() * 0.18);
  for (let k = 0; k <= rings; k++) {
    const t = k / (rings + 0.6);
    const rad = k === 0 ? 1.02 : Math.cos((t * Math.PI) / 2);
    const y = k === 0 ? -0.25 * H : Math.sin((t * Math.PI) / 2) * H * (0.9 + r() * 0.15);
    const twist = r() * 0.4;
    for (let s = 0; s < seg; s++) {
      const a = ((s + twist) / seg) * Math.PI * 2;
      const j = jitter[s] * (0.97 + r() * 0.08);
      P.push(Math.cos(a) * rx * rad * j, y, Math.sin(a) * ry * rad * j);
    }
  }
  const top = P.length / 3;
  P.push((r() - 0.5) * rx * 0.2, H * (1 + r() * 0.08), (r() - 0.5) * ry * 0.2);
  for (let k = 0; k < rings; k++) {
    for (let s = 0; s < seg; s++) {
      const a = k * seg + s;
      const b = k * seg + ((s + 1) % seg);
      I.push(a, a + seg, b, b, a + seg, b + seg);
    }
  }
  for (let s = 0; s < seg; s++) I.push(rings * seg + s, top, rings * seg + ((s + 1) % seg));
  orient(P, I, (_x, y) => [0, Math.min(y, H * 0.3) - H * 0.2, 0]);
  return finish(scene, `rock${o.id}`, P, I);
}

/** A weathered log: a tapering, slightly bent prism with a stub of a branch. */
function woodMesh(scene: Scene, o: PlacedObject): Mesh {
  const r = rng(o.variant * 104729 + 7);
  const len = o.size;
  const rad = WOOD_RADIUS(len);
  const seg = 6;
  const slices = 6;
  const bend = (r() - 0.5) * 0.12 * len;
  const P: number[] = [];
  const I: number[] = [];
  const ring = (x: number, cy: number, cz: number, rr: number, twist: number) => {
    for (let s = 0; s < seg; s++) {
      const a = ((s + twist) / seg) * Math.PI * 2;
      const w = rr * (0.85 + r() * 0.3);
      P.push(x, cy + Math.sin(a) * w * 0.85, cz + Math.cos(a) * w);
    }
  };
  for (let k = 0; k <= slices; k++) {
    const t = k / slices;
    const x = (t - 0.5) * len;
    const taper = 1 - 0.35 * Math.abs(t - 0.4) * 2;
    ring(x, 0, Math.sin(t * Math.PI) * bend, rad * taper, k * 0.15);
  }
  for (let k = 0; k < slices; k++) {
    for (let s = 0; s < seg; s++) {
      const a = k * seg + s;
      const b = k * seg + ((s + 1) % seg);
      I.push(a, b, a + seg, b, b + seg, a + seg);
    }
  }
  // end caps
  const c0 = P.length / 3;
  P.push(-len / 2 - rad * 0.3, 0, 0);
  const c1 = P.length / 3;
  P.push(len / 2 + rad * 0.2, 0, bend * 0);
  for (let s = 0; s < seg; s++) {
    I.push(c0, (s + 1) % seg, s);
    I.push(c1, slices * seg + s, slices * seg + ((s + 1) % seg));
  }
  // a broken-off branch
  if (o.variant % 2 === 0) {
    const bx = (r() * 0.4 - 0.1) * len;
    const side = r() < 0.5 ? -1 : 1;
    const bl = len * (0.18 + r() * 0.12);
    const b0 = P.length / 3;
    P.push(bx - rad * 0.6, 0, side * rad * 0.5, bx + rad * 0.6, 0, side * rad * 0.5, bx, rad * 0.5, side * rad * 0.4);
    P.push(bx + bl * 0.5, rad * 0.1, side * (rad + bl * 0.8));
    I.push(b0, b0 + 2, b0 + 3, b0 + 2, b0 + 1, b0 + 3, b0 + 1, b0, b0 + 3);
  }
  orient(P, I, (x) => [Math.max(-len / 2, Math.min(len / 2, x)) * 0.9, 0, Math.sin((x / len + 0.5) * Math.PI) * bend]);
  return finish(scene, `wood${o.id}`, P, I);
}

/** A ribbed scallop, `size` metres across its fan. */
function shellMesh(scene: Scene, o: PlacedObject, spotMaterial?: ShaderMaterial): Mesh {
  const r = rng(o.variant * 31 + 5);
  const rad = o.size;
  const ribs = 7 + (o.variant % 4);
  const h = rad * (0.25 + r() * 0.12);
  const P: number[] = [0, h * 0.4, -rad * 0.35];
  for (let k = 0; k <= ribs; k++) {
    const a = Math.PI * (0.08 + (0.84 * k) / ribs);
    P.push(Math.cos(a) * rad, k % 2 ? h : h * 0.45, Math.sin(a) * rad - rad * 0.35);
  }
  const base = P.length / 3;
  P.push(0, 0, -rad * 0.35);
  for (let k = 0; k <= ribs; k++) {
    const a = Math.PI * (0.08 + (0.84 * k) / ribs);
    P.push(Math.cos(a) * rad, 0, Math.sin(a) * rad - rad * 0.35);
  }
  const I: number[] = [];
  for (let k = 1; k <= ribs; k++) I.push(0, k, k + 1, base, base + k + 1, base + k, k, base + k, base + k + 1, k, base + k + 1, k + 1);
  orient(P, I, (x, y, z) => [x * 0.5, y > h * 0.3 ? -1 : 1, z * 0.5]);
  const shell = finish(scene, `shell${o.id}`, P, I);
  if (spotMaterial) {
    const spots: number[] = [];
    const faces: number[] = [];
    // The first triangle in each group lies on top of the fan. Inset a
    // patch on its plane so the pattern follows the shell's ridges.
    for (let k = 0; k < I.length; k += 12) {
      const a = I[k] * 3;
      const b = I[k + 1] * 3;
      const c = I[k + 2] * 3;
      const center = [0, 1, 2].map((axis) => (P[a + axis] + P[b + axis] + P[c + axis]) / 3);
      const scale = 0.34 + r() * 0.25;
      const first = spots.length / 3;
      for (const point of [a, b, c]) {
        const [x, y, z] = center.map((v, axis) => v + (P[point + axis] - v) * scale);
        spots.push(x, y + rad * 0.004, z);
      }
      faces.push(first, first + 1, first + 2);
    }
    const pattern = finish(scene, `shellSpots${o.id}`, spots, faces);
    pattern.material = spotMaterial;
    pattern.parent = shell;
  }
  return shell;
}

/** A crumpled plastic bottle: a squashed, dented lathe lying on its side, its axis at the given height. */
function trashMesh(scene: Scene, o: PlacedObject): Mesh {
  const r = rng(o.variant * 167 + 3);
  const L = o.size;
  const R = L * 0.32;
  const { P, I } = lathe(
    [
      [-L * 0.5, R * 0.55],
      [-L * 0.35, R],
      [-L * 0.1, R * 0.82],
      [L * 0.15, R * 0.9],
      [L * 0.35, R * 0.7],
      [L * 0.5, R * 0.4],
    ],
    7,
    0.6,
    () => 0.72 + r() * 0.55,
  );
  orient(P, I, (x) => [x, 0, 0]);
  let bottom = 0;
  for (let i = 1; i < P.length; i += 3) bottom = Math.min(bottom, P[i]);
  for (let i = 1; i < P.length; i += 3) P[i] -= bottom;
  return finish(scene, `trash${o.id}`, P, I);
}

/** A clump of seaweed: a few thin ribbons lying flat on the sand, radiating from the middle. */
function seaweedMesh(scene: Scene, o: PlacedObject): Mesh {
  const r = rng(o.variant * 211 + 9);
  const P: number[] = [];
  const I: number[] = [];
  const strands = 3 + (o.variant % 2);
  for (let s = 0; s < strands; s++) {
    const a = (s / strands) * Math.PI * 2 + r() * 0.9;
    const len = o.size * (0.6 + r() * 0.4);
    const w = o.size * 0.07;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const segs = 5;
    const base = P.length / 3;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      // the strand wanders a little as it runs out
      const bend = Math.sin(t * Math.PI * 1.5 + s) * o.size * 0.12;
      const cx = ca * len * t - sa * bend;
      const cz = sa * len * t + ca * bend;
      const px = -sa * w * (1 - t * 0.4);
      const pz = ca * w * (1 - t * 0.4);
      P.push(cx + px, 0.012, cz + pz, cx - px, 0.012, cz - pz);
    }
    for (let k = 0; k < segs; k++) {
      const a0 = base + k * 2;
      I.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
    }
  }
  orient(P, I, () => [0, -0.01, 0]);
  return finish(scene, `seaweed${o.id}`, P, I);
}

/** A frosted, tumbled pebble of glass. */
function glassMesh(scene: Scene, o: PlacedObject): Mesh {
  const r = rng(o.variant * 977 + 3);
  const seg = 6;
  const P: number[] = [0, o.size * 0.55, 0];
  for (let k = 0; k < seg; k++) {
    const a = (k / seg) * Math.PI * 2;
    const w = o.size * (0.75 + r() * 0.35);
    P.push(Math.cos(a) * w, o.size * 0.22, Math.sin(a) * w * 0.7);
  }
  P.push(0, 0, 0);
  const I: number[] = [];
  for (let k = 0; k < seg; k++) {
    const a = 1 + k;
    const b = 1 + ((k + 1) % seg);
    I.push(0, a, b, seg + 1, b, a);
  }
  orient(P, I, () => [0, o.size * 0.25, 0]);
  return finish(scene, `glass${o.id}`, P, I);
}

/** A little beach flag: a pole, and a pennant (a child mesh, so it can flutter). */
function flagMesh(scene: Scene, o: PlacedObject): { pole: Mesh; cloth: Mesh } {
  const H = 0.9 + (o.variant % 3) * 0.15;
  const w = 0.025;
  const P: number[] = [];
  const I: number[] = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    P.push(Math.cos(a) * w, -0.15, Math.sin(a) * w, Math.cos(a) * w, H, Math.sin(a) * w);
  }
  for (let k = 0; k < 4; k++) {
    const a = k * 2;
    const b = ((k + 1) % 4) * 2;
    I.push(a, a + 1, b, b, a + 1, b + 1);
  }
  orient(P, I, (_x, y) => [0, y, 0]);
  const pole = finish(scene, `flag${o.id}`, P, I);
  const L = 0.42;
  const C = [0, 0, 0, 0, -0.26, 0, L * 0.5, -0.12, 0.02, L, -0.06, 0];
  const cloth = finish(scene, `cloth${o.id}`, C, [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
  cloth.parent = pole;
  cloth.position.y = H;
  return { pole, cloth };
}

/** A conch: a knobbly spiral cone lying on its side, its axis at the given height. */
function conchMesh(scene: Scene, o: PlacedObject): Mesh {
  const r = rng(o.variant * 53 + 11);
  const L = o.size;
  const R = L * 0.32;
  const { P, I } = lathe(
    [
      [-L * 0.5, R * 0.15],
      [-L * 0.35, R * 0.7],
      [-L * 0.15, R],
      [L * 0.05, R * 0.9],
      [L * 0.25, R * 0.55],
      [L * 0.42, R * 0.25],
      [L * 0.5, R * 0.05],
    ],
    7,
    0.85,
    () => 0.88 + r() * 0.24,
  );
  orient(P, I, (x) => [x, 0, 0]);
  return finish(scene, `conch${o.id}`, P, I);
}

/** A sand dollar: a flat, slightly domed disc. */
function sanddollarMesh(scene: Scene, o: PlacedObject): Mesh {
  const R = o.size;
  const seg = 12;
  const P: number[] = [0, R * 0.16, 0];
  for (let k = 0; k < seg; k++) {
    const a = (k / seg) * Math.PI * 2;
    P.push(Math.cos(a) * R * 0.55, R * 0.12, Math.sin(a) * R * 0.55);
  }
  for (let k = 0; k < seg; k++) {
    const a = ((k + 0.5) / seg) * Math.PI * 2;
    P.push(Math.cos(a) * R, R * 0.03, Math.sin(a) * R);
  }
  P.push(0, 0, 0);
  const I: number[] = [];
  const bottom = 1 + seg * 2;
  for (let k = 0; k < seg; k++) {
    const a = 1 + k;
    const b = 1 + ((k + 1) % seg);
    const o1 = 1 + seg + k;
    I.push(0, a, b, a, o1, b, o1, 1 + seg + ((k + 1) % seg), b, bottom, o1, 1 + seg + ((k + 1) % seg));
  }
  orient(P, I, () => [0, R * 0.06, 0]);
  return finish(scene, `sanddollar${o.id}`, P, I);
}

/** A five-armed starfish, plump in the middle. */
function starfishMesh(scene: Scene, o: PlacedObject): Mesh {
  const r = rng(o.variant * 89 + 7);
  const R = o.size;
  const P: number[] = [0, R * 0.22, 0, 0, 0, 0];
  const I: number[] = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const tip = k % 2 === 0;
    const rad = tip ? R * (0.9 + r() * 0.2) : R * 0.36;
    P.push(Math.cos(a) * rad, tip ? R * 0.03 : R * 0.1, Math.sin(a) * rad);
  }
  for (let k = 0; k < 10; k++) {
    const a = 2 + k;
    const b = 2 + ((k + 1) % 10);
    I.push(0, a, b, 1, b, a);
  }
  orient(P, I, () => [0, R * 0.08, 0]);
  return finish(scene, `starfish${o.id}`, P, I);
}

/** A nautilus: a plump coiled shell, flattened into a disc, its chambers a wobble in the lathe. */
function nautilusMesh(scene: Scene, o: PlacedObject): Mesh {
  const r = rng(o.variant * 131 + 5);
  const R = o.size;
  const { P, I } = lathe(
    [
      [-R * 0.55, R * 0.05],
      [-R * 0.42, R * 0.3],
      [-R * 0.15, R * 0.42],
      [R * 0.15, R * 0.4],
      [R * 0.38, R * 0.26],
      [R * 0.52, R * 0.06],
    ],
    9,
    0.6,
    () => 0.9 + r() * 0.2,
  );
  orient(P, I, (x) => [x, 0, 0]);
  return finish(scene, `nautilus${o.id}`, P, I);
}

/** A message in a bottle: green glass, a cork (child mesh), its axis at the given height. */
function bottleMesh(scene: Scene, o: PlacedObject): { body: Mesh; cork: Mesh } {
  const L = o.size;
  const R = floatRadius(o);
  const b = lathe(
    [
      [-L * 0.5, R * 0.8],
      [-L * 0.45, R],
      [L * 0.12, R],
      [L * 0.24, R * 0.45],
      [L * 0.42, R * 0.38],
    ],
    8,
  );
  orient(b.P, b.I, (x) => [x, 0, 0]);
  const body = finish(scene, `bottle${o.id}`, b.P, b.I);
  const c = lathe(
    [
      [L * 0.42, R * 0.36],
      [L * 0.5, R * 0.32],
    ],
    6,
  );
  orient(c.P, c.I, (x) => [x, 0, 0]);
  const cork = finish(scene, `cork${o.id}`, c.P, c.I);
  cork.parent = body;
  return { body, cork };
}

/**
 * A striped beach ball: six wedges of a sphere in two meshes, one per
 * material. Its centre is one radius up and its bottom point is at y = 0.
 */
function beachballMesh(scene: Scene, o: PlacedObject): { root: Mesh; panels: Mesh[] } {
  const R = o.size;
  const root = new Mesh(`ball${o.id}`, scene);
  const groups = [{ positions: [] as number[], indices: [] as number[] }, { positions: [] as number[], indices: [] as number[] }];
  const WEDGES = 6;
  const lats = [-90, -60, -30, 0, 30, 60, 90];
  const pt = (phi: number, lam: number): [number, number, number] => {
    const p = (phi * Math.PI) / 180;
    const l = lam;
    return [R * Math.cos(p) * Math.cos(l), R + R * Math.sin(p), R * Math.cos(p) * Math.sin(l)];
  };
  for (let w = 0; w < WEDGES; w++) {
    const l0 = (w / WEDGES) * Math.PI * 2;
    const l1 = ((w + 1) / WEDGES) * Math.PI * 2;
    const lm = (l0 + l1) / 2;
    const lons = [l0, lm, l1];
    const P: number[] = [];
    const I: number[] = [];
    // vertex 0 is the south pole, then one ring per latitude (3 lon
    // steps each), then the north pole
    P.push(...pt(-90, l0));
    for (let k = 1; k < lats.length - 1; k++) {
      for (const l of lons) P.push(...pt(lats[k], l));
    }
    const north = P.length / 3;
    P.push(...pt(90, l0));
    const ring = (k: number) => 1 + (k - 1) * 3; // first vertex of latitude ring k (1..5)
    for (let s = 0; s < 2; s++) {
      I.push(0, ring(1) + s + 1, ring(1) + s);
      I.push(north, ring(5) + s, ring(5) + s + 1);
    }
    for (let k = 1; k < 5; k++) {
      for (let s = 0; s < 2; s++) {
        const a = ring(k) + s;
        const b = ring(k) + s + 1;
        I.push(a, a + 3, b, b, a + 3, b + 3);
      }
    }
    orient(P, I, () => [0, R, 0]);
    const group = groups[w % 2];
    const base = group.positions.length / 3;
    group.positions.push(...P);
    group.indices.push(...I.map((i) => base + i));
  }
  const panels = groups.map(({ positions, indices }, i) => {
    const panel = finish(scene, `ball${o.id}p${i}`, positions, indices);
    panel.parent = root;
    return panel;
  });
  return { root, panels };
}

/** A pair of sandals: two flat lathed soles side by side, with a strap across each. */
function sandalsMesh(scene: Scene, o: PlacedObject): { soles: Mesh; straps: Mesh } {
  const L = o.size;
  const W = L * 0.24; // half-width of one sole
  const squash = 0.14; // soles are flat
  const P: number[] = [];
  const I: number[] = [];
  for (const side of [-1, 1]) {
    const zoff = side * L * 0.3;
    const s = lathe(
      [
        [-L * 0.5, W * 0.55],
        [-L * 0.25, W],
        [0, W * 1.02],
        [L * 0.25, W * 0.95],
        [L * 0.5, W * 0.6],
      ],
      8,
      squash,
    );
    orient(s.P, s.I, (x) => [x, 0, 0]);
    const base = P.length / 3;
    for (let n = 0; n < s.P.length; n += 3) P.push(s.P[n], s.P[n + 1] + squash * W, s.P[n + 2] + zoff);
    for (const idx of s.I) I.push(base + idx);
  }
  const soles = finish(scene, `soles${o.id}`, P, I);
  // each strap is a shallow Λ of two thin boxes, rising from the sole's
  // edges to a peak over the middle (the tilt leans in the y-z plane)
  const S: number[] = [];
  const SI: number[] = [];
  for (const side of [-1, 1]) {
    const zoff = side * L * 0.3;
    // the sole's top is ~0.07L at the middle and ~0.05L where the strap
    // meets it, so the strap has to start above the sole and peak higher
    const apexY = L * 0.115;
    const edgeY = L * 0.045;
    const half = L * 0.2;
    const len = Math.hypot(half, apexY - edgeY);
    const tilt = Math.atan2(apexY - edgeY, half);
    box(S, SI, L * 0.12, (apexY + edgeY) / 2, zoff + half / 2, L * 0.09, L * 0.02, len, tilt);
    box(S, SI, L * 0.12, (apexY + edgeY) / 2, zoff - half / 2, L * 0.09, L * 0.02, len, -tilt);
  }
  orient(S, SI, (x, y, z) => [x * 0.98, y, z]);
  const straps = finish(scene, `straps${o.id}`, S, SI);
  straps.parent = soles;
  return { soles, straps };
}

/**
 * A pail, standing upright: one lathe traces the outside up, over the
 * rim, and back down the inside to the floor, so the open top reads
 * from above; a wire handle arches over it (child mesh).
 */
function bucketMesh(scene: Scene, o: PlacedObject): { body: Mesh; handle: Mesh } {
  const H = o.size;
  const R = o.size * 0.5;
  const b = lathe(
    [
      [0, 0.02],
      [0, R * 0.8],
      [H * 0.75, R * 0.95],
      [H * 0.95, R],
      [H, R * 1.02],
      [H * 0.97, R * 0.88],
      [H * 0.2, R * 0.8],
      [H * 0.12, 0.02],
    ],
    10,
  );
  // the lathe runs along x; stand it up (a proper rotation, so the
  // winding survives: +x becomes +y)
  for (let n = 0; n < b.P.length; n += 3) {
    const [x, y, z] = [b.P[n], b.P[n + 1], b.P[n + 2]];
    b.P[n] = -y;
    b.P[n + 1] = x;
    b.P[n + 2] = z;
  }
  const body = finish(scene, `bucket${o.id}`, b.P, b.I);
  // the handle arches over the top in the y-z plane
  const S: number[] = [];
  const SI: number[] = [];
  const apexY = H + R * 0.75;
  const edgeY = H + 0.01;
  const half = R * 0.9;
  const len = Math.hypot(half, apexY - edgeY);
  const tilt = Math.atan2(apexY - edgeY, half);
  box(S, SI, 0, (apexY + edgeY) / 2, half / 2, H * 0.035, H * 0.035, len, tilt);
  box(S, SI, 0, (apexY + edgeY) / 2, -half / 2, H * 0.035, H * 0.035, len, -tilt);
  orient(S, SI, (x, y, z) => [x * 0.98, y, z]);
  const handle = finish(scene, `handle${o.id}`, S, SI);
  handle.parent = body;
  return { body, handle };
}

/**
 * A branching coral fragment: a low base with a few tapered arms rising
 * from it, each a 4-sided prism along its own direction.
 */
function coralMesh(scene: Scene, o: PlacedObject): Mesh {
  const r = rng(o.variant * 167 + 21);
  const S = o.size;
  const P: number[] = [];
  const I: number[] = [];
  // a low base the arms grow from — small and half-buried, so it reads
  // as the fragment's foot, not a tile
  box(P, I, 0, 0, 0, S * 0.35, S * 0.06, S * 0.35);
  const arm = (dir: [number, number, number], len: number, w0: number, w1: number) => {
    const [dx, dy, dz] = dir;
    const ax = Math.abs(dy) < 0.9 ? 0 : 1;
    const ay = Math.abs(dy) < 0.9 ? 1 : 0;
    // u = dir x a, v = dir x u (a = (ax, ay, 0))
    let ux = -dz * ay;
    let uy = dz * ax;
    let uz = dx * ay - dy * ax;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = dy * uz - dz * uy;
    const vy = dz * ux - dx * uz;
    const vz = dx * uy - dy * ux;
    const b = P.length / 3;
    const cy = S * 0.02; // arms start at the top of the base
    for (const [s, w] of [
      [0, w0],
      [len, w1],
    ] as const) {
      const cx = dx * s;
      const cyy = cy + dy * s;
      const cz = dz * s;
      for (const [su, sv] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        P.push(cx + (ux * su * w) / 2 + (vx * sv * w) / 2, cyy + (uy * su * w) / 2 + (vy * sv * w) / 2, cz + (uz * su * w) / 2 + (vz * sv * w) / 2);
      }
    }
    // four sides, plus the tip cap (the base is buried in the mound)
    for (let k = 0; k < 4; k++) {
      const a0 = b + k;
      const a1 = b + ((k + 1) % 4);
      I.push(a0, a0 + 4, a1, a1, a0 + 4, a1 + 4);
    }
    I.push(b + 4, b + 6, b + 5, b + 4, b + 7, b + 6);
  };
  // one upright arm in the middle, then arms leaning out around it
  arm([0, 1, 0], S * (0.65 + r() * 0.25), S * 0.15, S * 0.05);
  const n = 3 + (o.variant % 2);
  for (let k = 0; k < n; k++) {
    const az = (k / n) * Math.PI * 2 + r() * 0.6;
    const tilt = 0.35 + r() * 0.45; // from vertical
    const dir: [number, number, number] = [Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)];
    arm(dir, S * (0.55 + r() * 0.4), S * 0.13, S * 0.04);
  }
  return finish(scene, `coral${o.id}`, P, I);
}

/** A round brown nut, squashed a little, with its origin at the bottom. */
function coconutMesh(scene: Scene, o: PlacedObject): Mesh {
  const R = o.size * 0.5;
  const squash = 0.85;
  const { P, I } = lathe(
    [
      [-R, R * 0.15],
      [-R * 0.7, R * 0.8],
      [0, R],
      [R * 0.7, R * 0.8],
      [R, R * 0.15],
    ],
    12,
    squash,
  );
  orient(P, I, (x) => [x, 0, 0]);
  for (let n = 1; n < P.length; n += 3) P[n] += R * squash;
  return finish(scene, `coconut${o.id}`, P, I);
}

/** A striped deckchair: a wooden frame and a canvas sling (child mesh), facing the sea. */
function deckchairMesh(scene: Scene, o: PlacedObject): { frame: Mesh; canvas: Mesh } {
  const P: number[] = [];
  const I: number[] = [];
  const w = 0.56; // width
  const t = 0.035; // timber
  // side rails run from the front bar (low, toward the sea, -z) up to the
  // top bar (high, at the back, +z); front legs drop from the front bar, back
  // legs prop up the top bar
  const front = { y: 0.26, z: -0.45 };
  const top = { y: 0.72, z: 0.48 };
  const railLen = Math.hypot(top.z - front.z, top.y - front.y);
  const railTilt = -Math.atan2(top.y - front.y, top.z - front.z);
  const backFoot = 0.78;
  const legLen = Math.hypot(backFoot - top.z, top.y);
  const legTilt = -Math.atan2(backFoot - top.z, top.y);
  for (const side of [-1, 1]) {
    const x = (side * w) / 2;
    box(P, I, x, (front.y + top.y) / 2, (front.z + top.z) / 2, t, t, railLen, railTilt);
    box(P, I, x, front.y / 2, front.z, t, front.y, t);
    box(P, I, x, top.y / 2, (top.z + backFoot) / 2, t, legLen, t, legTilt);
  }
  box(P, I, 0, front.y, front.z, w + t, t, t); // front bar
  box(P, I, 0, top.y, top.z, w + t, t, t); // top bar
  orient(P, I, (x, y, z) => [x * 0.98, y, z]);
  const frame = finish(scene, `chair${o.id}`, P, I);
  const C: number[] = [];
  const CI: number[] = [];
  // the sling sags between the front bar and the top bar
  const n = 8;
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const z = front.z + u * (top.z - front.z);
    const y = front.y + u * (top.y - front.y) - Math.sin(u * Math.PI) * 0.13;
    C.push(-w / 2 + t, y, z, w / 2 - t, y, z);
  }
  for (let k = 0; k < n; k++) {
    const a = k * 2;
    CI.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const canvas = finish(scene, `sling${o.id}`, C, CI);
  canvas.parent = frame;
  return { frame, canvas };
}

function extent(o: PlacedObject): { reach: number; height: number } {
  if (isStoreKind(o.kind)) return { reach: STORE_REACH[o.kind], height: o.kind === 'lighthouse' ? 2.9 : o.kind === 'parasol' || o.kind === 'surfboard' ? 2 : 1.4 };
  switch (o.kind) {
    case 'deckchair':
      return { reach: 0.6, height: 0.8 };
    case 'beachball':
      return { reach: o.size, height: o.size * 2 };
    case 'bucket':
      return { reach: o.size * 0.6, height: o.size * 1.4 };
    case 'driftwood':
      return { reach: o.size / 2, height: 0.3 };
    case 'bottle':
    case 'conch':
      return { reach: o.size * 0.6, height: 0.3 };
    case 'flag':
      return { reach: 0.3, height: 1.1 };
    default:
      return { reach: Math.max(0.15, o.size), height: Math.max(0.25, o.size * 1.2) };
  }
}

/**
 * Draws the rocks and driftwood on one beach. Positions come from the
 * simulation at 30 Hz; the meshes ease toward them every rendered frame so
 * floating wood moves smoothly, and bob a little while afloat.
 */
// ---------------------------------------------------------------- the prop bank
//
// Every thing on every beach (yours and the neighbors') is drawn with GPU
// thin instances: one hidden source mesh per distinct look and part, and a
// buffer of matrices, one per thing that looks like it. A thousand rocks of
// eight shapes are eight draw calls, not a thousand.
//
// A "look" is a kind, a variant and (for driftwood only) a size bucket.
// The other kinds are built at size 1 and scaled, or are a fixed size.

/** kinds whose every dimension is proportional to `size` */
const LINEAR = new Set<ObjectKind>(['rock', 'shell', 'seaglass', 'trash', 'seaweed', 'conch', 'sanddollar', 'starfish', 'nautilus', 'bottle', 'beachball', 'sandals', 'bucket', 'coral', 'coconut']);
/**
 * Driftwood's thickness isn't proportional to its length: it's built in
 * size buckets and stretched to the exact length along the log and to
 * the matching thickness across it.
 */
const WOOD_STEP = Math.log(2.0);

interface Source {
  mesh: Mesh;
  buf: Float32Array;
  count: number;
  slots: Inst[];
  dirty: boolean;
  resized: boolean;
  users: number;
  sharedKey?: string;
}

interface Inst {
  src: Source;
  /** index in src.slots, or -1 when not drawn */
  slot: number;
}

interface Part {
  src: Source;
  /** this part relative to the thing's root */
  local: Matrix;
}

interface Look {
  key: string;
  parts: Part[];
  /** the size it was built at: things are scaled by size / base (1 for fixed-size kinds) */
  base: number;
  /** lamp positions (store items), relative to the root */
  lights: Vector3[];
  users: number;
}

function colorCountFor(o: PlacedObject): number {
  const look = ITEM_LOOKS[o.item];
  return look ? look.colors.length : PROP_COLORS[o.kind].length;
}

function lookKey(o: PlacedObject): { key: string; base: number } {
  // a prize item shares its kind's shape but not its look — pink-shell is
  // kind shell — so the look key carries the item too (src/palette.ts)
  const item = ITEM_LOOKS[o.item] ? `:${o.item}` : '';
  // Store items do not depend on variant at all (fixed geometry and palette)
  if (isStoreKind(o.kind)) return { key: `${o.kind}${item}`, base: 1 };
  // Geometry-invariant kinds only vary by colour (variant % colorCount)
  if (o.kind === 'deckchair' || o.kind === 'sanddollar' || o.kind === 'bottle' || o.kind === 'coconut') {
    return { key: `${o.kind}${item}:${o.variant % colorCountFor(o)}`, base: 1 };
  }
  // Flags vary only by pole height (variant % 3) and cloth colour (variant % colorCount)
  if (o.kind === 'flag') {
    return { key: `flag${item}:${o.variant % 3}:${o.variant % colorCountFor(o)}`, base: 1 };
  }
  if (LINEAR.has(o.kind)) return { key: `${o.kind}${item}:${o.variant}`, base: 1 };
  if (o.kind === 'driftwood') {
    const b = Math.round(Math.log(Math.max(0.05, o.size)) / WOOD_STEP);
    return { key: `driftwood${item}:${o.variant}:${b}`, base: Math.exp(b * WOOD_STEP) };
  }
  return { key: `${o.kind}${item}:${o.variant}`, base: 1 };
}

class PropBank {
  private readonly looks = new Map<string, Look>();
  private readonly sources = new Set<Source>();
  private readonly sharedSources = new Map<string, Source>();
  private readonly clothMats = new Set<ShaderMaterial>();
  readonly mats: Record<ObjectKind, ShaderMaterial[]>;
  readonly poleMat: ShaderMaterial;
  readonly glow: Glow;
  private n = 0;
  private windTime = 1;

  constructor(
    private readonly scene: Scene,
    private readonly renderer: BeachRenderer,
  ) {
    this.mats = Object.fromEntries(OBJECT_KINDS.map((k) => [k, PROP_COLORS[k].map((c) => renderer.createPropMaterial(c))])) as Record<ObjectKind, ShaderMaterial[]>;
    this.poleMat = renderer.createPropMaterial(PROP_COLORS.pole);
    this.glow = new Glow(scene);
    // one upload per changed source per frame, whatever moved
    scene.onBeforeRenderObservable.add(() => this.flush());
  }

  tick(dt: number): void {
    this.glow.tick(dt);
    if (this.clothMats.size) {
      this.windTime += dt;
      for (const m of this.clothMats) m.setFloat('windTime', this.windTime);
    }
  }

  /** Materials for one thing: its own item's colours and finish, or its kind's. */
  private readonly itemMats = new Map<string, ShaderMaterial[]>();
  private matsFor(o: PlacedObject): ShaderMaterial[] {
    const look = ITEM_LOOKS[o.item];
    if (!look) return this.mats[o.kind];
    let set = this.itemMats.get(o.item);
    if (!set) {
      set = look.colors.map((c) => this.renderer.createPropMaterial(c, look.gloss));
      this.itemMats.set(o.item, set);
    }
    return set;
  }

  /** The look for this thing (built the first time it's needed). */
  look(o: PlacedObject): Look {
    const { key, base } = lookKey(o);
    let l = this.looks.get(key);
    if (!l) {
      l = this.build(key, { ...o, id: 0, x: 0, y: 0, angle: 0, size: base }, base);
      this.looks.set(key, l);
    }
    l.users++;
    return l;
  }

  release(l: Look): void {
    if (--l.users > 0) return;
    this.looks.delete(l.key);
    for (const p of l.parts) {
      if (--p.src.users > 0) continue;
      if (p.src.sharedKey) this.sharedSources.delete(p.src.sharedKey);
      this.sources.delete(p.src);
      p.src.mesh.dispose();
    }
  }

  private wrapSource(m: Mesh, name: string, sharedKey?: string): Source {
    m.position.setAll(0);
    m.rotationQuaternion = null;
    m.rotation.setAll(0);
    m.scaling.setAll(1);
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    m.doNotSyncBoundingInfo = true;
    m.name = name;
    m.freezeWorldMatrix();
    const src: Source = { mesh: m, buf: new Float32Array(16 * 4), count: 0, slots: [], dirty: true, resized: true, users: 1, sharedKey };
    m.thinInstanceSetBuffer('matrix', src.buf, 16, false);
    m.thinInstanceCount = 0;
    m.setEnabled(false);
    this.sources.add(src);
    if (sharedKey) this.sharedSources.set(sharedKey, src);
    return src;
  }

  private acquireShared(sharedKey: string, make: () => Mesh): Source {
    const existing = this.sharedSources.get(sharedKey);
    if (existing) {
      existing.users++;
      return existing;
    }
    return this.wrapSource(make(), `${sharedKey}#${this.n++}`, sharedKey);
  }

  private build(key: string, o: PlacedObject, base: number): Look {
    const set = this.matsFor(o);
    const mat = set[o.variant % set.length];
    // Placement rolls start at 1. Beach files also accept variant 0.
    const vendingVariant = Math.max(0, Math.floor(o.variant) - 1);
    const item = ITEM_LOOKS[o.item] ? `:${o.item}` : '';

    // Shared-part kinds: reuse identical sub-part sources (pole, cloth, frame, cork)
    // across colour/height variants to cut draw calls further.
    if (o.kind === 'flag') {
      const hIdx = o.variant % 3;
      const cIdx = o.variant % set.length;
      const H = 0.9 + hIdx * 0.15;
      const poleSrc = this.acquireShared(`flag:pole:${hIdx}`, () => {
        const f = flagMesh(this.scene, o);
        f.cloth.parent = null;
        f.cloth.dispose();
        f.pole.material = this.poleMat;
        return f.pole;
      });
      const clothSrc = this.acquireShared(`flag:cloth${item}:${cIdx}`, () => {
        const f = flagMesh(this.scene, o);
        f.cloth.parent = null;
        f.pole.dispose();
        f.cloth.material = mat;
        this.clothMats.add(mat);
        mat.setFloat('windTime', this.windTime);
        return f.cloth;
      });
      return {
        key,
        parts: [
          { src: poleSrc, local: Matrix.Identity() },
          { src: clothSrc, local: Matrix.Translation(0, H, 0) },
        ],
        base,
        lights: [],
        users: 0,
      };
    }

    if (o.kind === 'deckchair') {
      const cIdx = o.variant % set.length;
      const frameSrc = this.acquireShared('deckchair:frame', () => {
        const d = deckchairMesh(this.scene, o);
        d.canvas.parent = null;
        d.canvas.dispose();
        d.frame.material = this.poleMat;
        return d.frame;
      });
      const canvasSrc = this.acquireShared(`deckchair:canvas${item}:${cIdx}`, () => {
        const d = deckchairMesh(this.scene, o);
        d.canvas.parent = null;
        d.frame.dispose();
        d.canvas.material = mat;
        return d.canvas;
      });
      return {
        key,
        parts: [
          { src: frameSrc, local: Matrix.Identity() },
          { src: canvasSrc, local: Matrix.Identity() },
        ],
        base,
        lights: [],
        users: 0,
      };
    }

    if (o.kind === 'bottle') {
      const cIdx = o.variant % set.length;
      const bodySrc = this.acquireShared(`bottle:body${item}:${cIdx}`, () => {
        const bt = bottleMesh(this.scene, o);
        bt.cork.parent = null;
        bt.cork.dispose();
        bt.body.material = mat;
        return bt.body;
      });
      const corkSrc = this.acquireShared('bottle:cork', () => {
        const bt = bottleMesh(this.scene, o);
        bt.cork.parent = null;
        bt.body.dispose();
        bt.cork.material = this.poleMat;
        return bt.cork;
      });
      return {
        key,
        parts: [
          { src: bodySrc, local: Matrix.Identity() },
          { src: corkSrc, local: Matrix.Identity() },
        ],
        base,
        lights: [],
        users: 0,
      };
    }

    let root: Mesh;
    let lights: Vector3[] = [];
    if (isStoreKind(o.kind)) {
      const b = STORE_BUILDERS[o.kind](this.scene, o);
      for (const p of b.parts) p.mesh.material = p.mat === 'pole' ? this.poleMat : set[p.mat % set.length];
      root = b.root;
      lights = b.lights;
    } else if (o.kind === 'beachball') {
      const bb = beachballMesh(this.scene, o);
      root = bb.root;
      // panels alternate bright and white; the variant picks the bright
      // colour (red, blue, yellow — PROP_COLORS.beachball indices 0, 2, 3)
      const bright = [0, 2, 3][vendingVariant % 3];
      bb.panels[0].material = set[bright];
      bb.panels[1].material = set[1];
    } else if (o.kind === 'sandals') {
      const sd = sandalsMesh(this.scene, o);
      root = sd.soles;
      // PROP_COLORS.sandals is [sole, strap] per variant
      const pair = (vendingVariant % 2) * 2;
      root.material = set[pair];
      sd.straps.material = set[pair + 1];
    } else if (o.kind === 'bucket') {
      const bk = bucketMesh(this.scene, o);
      root = bk.body;
      root.material = set[vendingVariant % set.length];
      bk.handle.material = this.poleMat;
    } else if (o.kind === 'coral') {
      root = coralMesh(this.scene, o);
      root.material = mat;
    } else if (o.kind === 'coconut') {
      root = coconutMesh(this.scene, o);
      root.material = mat;
    } else {
      root =
        o.kind === 'rock' ? rockMesh(this.scene, o)
        : o.kind === 'driftwood' ? woodMesh(this.scene, o)
        : o.kind === 'shell' ? shellMesh(this.scene, o, o.item === 'cowrie' ? set[(o.variant + 1) % set.length] : undefined)
        : o.kind === 'conch' ? conchMesh(this.scene, o)
        : o.kind === 'sanddollar' ? sanddollarMesh(this.scene, o)
        : o.kind === 'starfish' ? starfishMesh(this.scene, o)
        : o.kind === 'nautilus' ? nautilusMesh(this.scene, o)
        : o.kind === 'trash' ? trashMesh(this.scene, o)
        : o.kind === 'seaweed' ? seaweedMesh(this.scene, o)
        : glassMesh(this.scene, o);
      root.material = mat;
    }
    // flatten the little hierarchy into parts, each with its matrix relative to the root
    root.position.setAll(0);
    root.rotation.setAll(0);
    root.scaling.setAll(1);
    const meshes = [root, ...(root.getChildMeshes(false) as Mesh[])];
    for (const m of meshes) m.computeWorldMatrix(true);
    const parts: Part[] = [];
    for (const m of meshes) {
      const local = m.getWorldMatrix().clone();
      if (m !== root) m.parent = null;
      if (!m.getTotalVertices()) {
        if (m !== root) m.dispose();
        continue;
      }
      const src = this.wrapSource(m, `${key}#${this.n++}`);
      parts.push({ src, local });
    }
    if (!root.getTotalVertices()) root.dispose();
    return { key, parts, base, lights, users: 0 };
  }

  /** Start drawing one more of this part. */
  show(inst: Inst): void {
    if (inst.slot >= 0) return;
    const s = inst.src;
    if ((s.count + 1) * 16 > s.buf.length) {
      const bigger = new Float32Array(s.buf.length * 2);
      bigger.set(s.buf);
      s.buf = bigger;
      s.resized = true;
    }
    inst.slot = s.count;
    s.slots[s.count++] = inst;
    s.dirty = true;
  }

  /** Stop drawing it (the last one moves into its slot). */
  hide(inst: Inst): void {
    if (inst.slot < 0) return;
    const s = inst.src;
    const last = --s.count;
    if (inst.slot !== last) {
      const moved = s.slots[last];
      s.buf.copyWithin(inst.slot * 16, last * 16, last * 16 + 16);
      moved.slot = inst.slot;
      s.slots[inst.slot] = moved;
    }
    s.slots.length = s.count;
    inst.slot = -1;
    s.dirty = true;
  }

  write(inst: Inst, m: Matrix): void {
    if (inst.slot < 0) return;
    m.copyToArray(inst.src.buf, inst.slot * 16);
    inst.src.dirty = true;
  }

  private flush(): void {
    for (const s of this.sources) {
      if (!s.dirty) continue;
      s.dirty = false;
      if (s.resized) {
        s.resized = false;
        s.mesh.thinInstanceSetBuffer('matrix', s.buf, 16, false);
      } else s.mesh.thinInstanceBufferUpdated('matrix');
      s.mesh.thinInstanceCount = s.count;
      s.mesh.setEnabled(s.count > 0);
    }
  }

  /** how many draw calls things take (for profiling) */
  get drawn(): number {
    let n = 0;
    for (const s of this.sources) if (s.count) n++;
    return n;
  }
}

const banks = new WeakMap<Scene, PropBank>();
function bankFor(scene: Scene, renderer: BeachRenderer): PropBank {
  let b = banks.get(scene);
  if (!b) banks.set(scene, (b = new PropBank(scene, renderer)));
  return b;
}

interface Shown {
  /** the simulation's state for it (the same object, updated in place each frame) */
  st: ObjectState;
  look: Look;
  insts: Inst[];
  x: number;
  y: number;
  z: number;
  angle: number;
  bob: number;
  /** scale along the thing's own x, y, z */
  sx: number;
  sy: number;
  sz: number;
  /** nothing moves it (resting, not afloat): its matrices are already right */
  settled: boolean;
  glow?: GlowHandle;
}

/** closer than this (m, radians, summed) counts as where it should be */
const SETTLED = 1e-3;
const tmpRoot = new Matrix();
const tmpPart = new Matrix();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpT = new Vector3();

/**
 * The things on one beach (yours, or a neighbor's at `offsetX`), drawn
 * through the shared prop bank.
 */
export class ObjectView {
  private readonly shown = new Map<number, Shown>();
  /** only the unsettled (moving / floating) items, so update(dt) skips resting things in O(active) */
  private readonly active = new Set<Shown>();
  private readonly bank: PropBank;
  private time = 0;
  private hidden = false;

  constructor(
    scene: Scene,
    renderer: BeachRenderer,
    private readonly offsetX = 0,
  ) {
    this.bank = bankFor(scene, renderer);
  }

  get count(): number {
    return this.shown.size;
  }

  /** things on this beach that moved or animated in the last update (profiling) */
  get moving(): number {
    return this.active.size;
  }

  /** draw calls all things on all beaches take now, glows included (profiling) */
  get drawCalls(): number {
    return this.bank.drawn + this.bank.glow.drawn;
  }

  /**
   * What's on the beach. Call when things are added or removed; the states
   * are kept and read again each update (the caller updates them in place).
   */
  set(states: ObjectState[]): void {
    const bulk = Math.abs(states.length - this.shown.size) > 4;
    const seen = new Set<number>();
    for (const st of states) {
      seen.add(st.id);
      const cur = this.shown.get(st.id);
      if (cur && cur.st.kind === st.kind && cur.st.item === st.item && cur.st.variant === st.variant && cur.st.size === st.size) {
        cur.st = st;
        if (
          st.floating ||
          Math.abs(st.x - cur.x) + Math.abs(st.y - cur.y) + Math.abs(st.z - cur.z) + Math.abs(st.angle - cur.angle) > SETTLED
        ) {
          if (bulk && !st.floating) {
            this.place(cur, 0);
          } else {
            cur.settled = false;
            this.active.add(cur);
          }
        }
        continue;
      }
      if (cur) this.drop(cur);
      this.add(st);
    }
    for (const [id, s] of this.shown) if (!seen.has(id)) this.drop(s);
  }

  private add(st: ObjectState): void {
    const look = this.bank.look(st);
    const insts: Inst[] = look.parts.map((p) => ({ src: p.src, slot: -1 }));
    let sx = 1;
    let sy = 1;
    let sz = 1;
    if (LINEAR.has(st.kind)) sx = sy = sz = st.size / look.base;
    else if (st.kind === 'driftwood') {
      sx = st.size / look.base;
      sy = sz = WOOD_RADIUS(st.size) / WOOD_RADIUS(look.base);
    }
    const s: Shown = { st, look, insts, x: st.x, y: st.y, z: st.z, angle: st.angle, bob: Math.random() * 6, sx, sy, sz, settled: false };
    // rare, legendary, unique and shop things glow and sparkle; lamps shine.
    // A prize item can also carry its own glow (the golden sand dollar's gold halo).
    const rarity = itemById(st.item)?.rarity;
    const special = ITEM_LOOKS[st.item]?.glow ?? (rarity === 'rare' || rarity === 'legendary' || rarity === 'unique' ? rarity : null);
    if (special || look.lights.length) {
      const { reach, height } = extent(st);
      s.glow = this.bank.glow.attach(special, reach, height, look.lights, st.id + st.variant * 7);
      if (this.hidden) s.glow.setEnabled(false);
    }
    this.shown.set(st.id, s);
    this.active.add(s);
    if (!this.hidden) for (const i of insts) this.bank.show(i);
    this.place(s, 0);
  }

  private drop(s: Shown): void {
    this.active.delete(s);
    for (const i of s.insts) this.bank.hide(i);
    this.bank.release(s.look);
    s.glow?.dispose();
    this.shown.delete(s.st.id);
  }

  /** Static objects (a neighbor's beach): heights from their sand. */
  setStatic(objects: PlacedObject[], heightAt: (x: number, y: number) => number): void {
    this.set(
      objects.map((o) => ({
        ...o,
        z:
          o.kind === 'rock' && o.base !== undefined
            ? o.base
            : heightAt(o.x, o.y) + (o.kind === 'driftwood' || o.kind === 'bottle' ? floatRadius(o) * 0.7 : 0),
        floating: false,
      })),
    );
  }

  update(dt: number): void {
    this.time += dt;
    this.bank.tick(dt);
    if (this.hidden || this.active.size === 0) return;
    const ease = 1 - Math.exp(-dt * 12);
    for (const s of this.active) {
      this.place(s, ease);
    }
  }

  private place(s: Shown, ease: number): void {
    const t = s.st;
    const k = ease === 0 ? 1 : ease;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const dz = t.z - s.z;
    let da = t.angle - s.angle;
    da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
    const rem = (1 - k) * (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) + Math.abs(da));
    // nothing left to ease and nothing animating: snap and stop touching it until the sim moves it
    // (flag pennants flutter in the vertex shader via windTime, so flags settle too)
    const still = rem < SETTLED;
    if (still) {
      s.x = t.x;
      s.y = t.y;
      s.z = t.z;
      s.angle = t.angle;
    } else {
      s.x += dx * k;
      s.y += dy * k;
      s.z += dz * k;
      s.angle += da * k;
    }
    const flag = t.kind === 'flag';
    const afloat = t.floating && (t.kind === 'driftwood' || t.kind === 'bottle');
    const bob = t.floating ? Math.sin(this.time * 1.7 + s.bob) * 0.015 : 0;
    // a conch lies on its side: lift its axis off the sand
    const lift = t.kind === 'conch' ? t.size * 0.24 : 0;
    // sim angles turn x toward y (world z); Babylon's yaw turns x away from z.
    // The flag always points downwind (the sea breeze blows inland).
    const yaw = flag ? -Math.PI / 2 : -s.angle;
    const pitch = afloat ? Math.sin(this.time * 1.3 + s.bob) * 0.06 : 0;
    tmpT.set(s.x + ORIGIN_X + this.offsetX, s.z + bob + lift, s.y + ORIGIN_Z);
    Quaternion.RotationYawPitchRollToRef(yaw, pitch, 0, tmpQ);
    tmpS.set(s.sx, s.sy, s.sz);
    Matrix.ComposeToRef(tmpS, tmpQ, tmpT, tmpRoot);
    const parts = s.look.parts;
    for (let p = 0; p < parts.length; p++) {
      parts[p].local.multiplyToRef(tmpRoot, tmpPart);
      this.bank.write(s.insts[p], tmpPart);
    }
    s.glow?.setPose(tmpT, yaw);
    s.settled = still && !t.floating;
    if (s.settled) this.active.delete(s);
    else this.active.add(s);
  }

  /**
   * The simulation moved things (a new frame): wake the ones that moved more
   * than a millimetre. (The sand under everything shifts by tiny amounts all
   * the time, which isn't worth redrawing.)
   */
  touch(): void {
    for (const s of this.shown.values()) {
      if (!s.settled) continue;
      const t = s.st;
      if (t.floating || Math.abs(t.x - s.x) + Math.abs(t.y - s.y) + Math.abs(t.z - s.z) + Math.abs(t.angle - s.angle) > SETTLED) {
        s.settled = false;
        this.active.add(s);
      }
    }
  }

  setVisible(on: boolean): void {
    if (on === !this.hidden) return;
    this.hidden = !on;
    for (const s of this.shown.values()) {
      for (const i of s.insts) {
        if (on) this.bank.show(i);
        else this.bank.hide(i);
      }
      s.glow?.setEnabled(on);
      if (on) this.place(s, 0);
    }
  }

  clear(): void {
    for (const s of [...this.shown.values()]) this.drop(s);
  }

  dispose(): void {
    this.clear();
  }
}

const frac = (x: number) => x - Math.floor(x);
