import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import type { PlacedObject } from '../sim/objects';
import { box, finish, lathe, orient } from './meshKit';

/**
 * The shop's bigger pieces, built from simple low-poly parts. Each part
 * names its material: 'pole' (weathered wood) or an index into the item's
 * colours in PROP_COLORS. `lights` are spots that glow (lamps, flames).
 */
export interface Built {
  root: Mesh;
  parts: { mesh: Mesh; mat: 'pole' | number }[];
  lights: Vector3[];
}

/** A lathe stood upright: profile is (height, radius) pairs. */
function tower(profile: [number, number][], seg: number): { P: number[]; I: number[] } {
  const { P, I } = lathe(profile, seg);
  // lathe runs along x; turn it to run up y
  for (let k = 0; k < P.length; k += 3) {
    const x = P[k];
    P[k] = P[k + 1];
    P[k + 1] = x;
  }
  orient(P, I, (_x, y) => [0, y, 0]);
  return { P, I };
}

function part(scene: Scene, name: string, g: { P: number[]; I: number[] }): Mesh {
  return finish(scene, name, g.P, g.I);
}

function assemble(root: Mesh, parts: { mesh: Mesh; mat: 'pole' | number }[]): void {
  for (const p of parts) if (p.mesh !== root) p.mesh.parent = root;
}

/** A striped beach parasol, tilted a little toward the sun side. */
function parasol(scene: Scene, o: PlacedObject): Built {
  const pole = part(scene, `parasol${o.id}`, tower([[-0.25, 0.025], [2.0, 0.02]], 6));
  const R = 1.05;
  const seg = 10;
  const stripes: [number[], number[]][] = [[[], []], [[], []]];
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2;
    const a1 = ((k + 1) / seg) * Math.PI * 2;
    const [P, I] = stripes[k % 2];
    const b = P.length / 3;
    P.push(0, 2.02, 0, Math.cos(a0) * R, 1.62, Math.sin(a0) * R, Math.cos(a1) * R, 1.62, Math.sin(a1) * R);
    I.push(b, b + 1, b + 2);
  }
  const parts: Built['parts'] = [{ mesh: pole, mat: 'pole' }];
  stripes.forEach(([P, I], i) => {
    orient(P, I, () => [0, 1.5, 0]);
    parts.push({ mesh: finish(scene, `canopy${o.id}_${i}`, P, I), mat: i });
  });
  assemble(pole, parts);
  pole.rotation.z = 0.08;
  return { root: pole, parts, lights: [] };
}

/** A surfboard stuck upright in the sand, with a stripe. */
function surfboard(scene: Scene, o: PlacedObject): Built {
  const L = 2.0;
  const W = 0.27;
  const prof: [number, number][] = [
    [-0.25, W * 0.5],
    [0.2, W * 0.95],
    [0.8, W],
    [1.35, W * 0.8],
    [1.65, W * 0.45],
    [L - 0.25, 0.02],
  ];
  const g = lathe(prof, 10, 0.18);
  // long axis up, thin side facing the sea
  for (let k = 0; k < g.P.length; k += 3) {
    const x = g.P[k];
    const y = g.P[k + 1];
    const z = g.P[k + 2];
    g.P[k] = z;
    g.P[k + 1] = x;
    g.P[k + 2] = y;
  }
  orient(g.P, g.I, (_x, y) => [0, y, 0]);
  const board = finish(scene, `surf${o.id}`, g.P, g.I);
  const S: number[] = [];
  const SI: number[] = [];
  box(S, SI, 0, 1.0, 0, W * 1.94, 0.12, W * 0.42);
  const stripe = finish(scene, `stripe${o.id}`, S, SI);
  const parts: Built['parts'] = [
    { mesh: board, mat: 0 },
    { mesh: stripe, mat: 1 },
  ];
  assemble(board, parts);
  board.rotation.x = -0.12;
  return { root: board, parts, lights: [] };
}

/** A proper sandcastle: a wall, four turrets with battlements, a keep and a little flag. */
function sandcastle(scene: Scene, o: PlacedObject): Built {
  const P: number[] = [];
  const I: number[] = [];
  const h = 0.42;
  box(P, I, 0, h / 2, 0, 1.0, h, 1.0);
  for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
    const t = tower([[0, 0.17], [0.62, 0.15], [0.62, 0.19], [0.72, 0.19]], 8);
    const b = P.length / 3;
    for (let k = 0; k < t.P.length; k += 3) P.push(t.P[k] + x, t.P[k + 1], t.P[k + 2] + z);
    for (const i of t.I) I.push(i + b);
    // battlements
    for (let c = 0; c < 4; c++) {
      const a = (c / 4) * Math.PI * 2 + 0.4;
      box(P, I, x + Math.cos(a) * 0.15, 0.78, z + Math.sin(a) * 0.15, 0.08, 0.1, 0.08);
    }
  }
  const keep = tower([[0, 0.26], [0.85, 0.22], [0.85, 0.27], [0.95, 0.27]], 8);
  const kb = P.length / 3;
  for (let k = 0; k < keep.P.length; k += 3) P.push(keep.P[k], keep.P[k + 1], keep.P[k + 2]);
  for (const i of keep.I) I.push(i + kb);
  const castle = finish(scene, `castle${o.id}`, P, I);
  const F: number[] = [0, 1.25, 0, 0.22, 1.18, 0, 0, 1.1, 0];
  const flag = finish(scene, `cflag${o.id}`, F, [0, 1, 2, 0, 2, 1]);
  const S: number[] = [];
  const SI: number[] = [];
  box(S, SI, 0, 1.08, 0, 0.02, 0.36, 0.02);
  const staff = finish(scene, `cstaff${o.id}`, S, SI);
  const parts: Built['parts'] = [
    { mesh: castle, mat: 0 },
    { mesh: flag, mat: 1 },
    { mesh: staff, mat: 'pole' },
  ];
  assemble(castle, parts);
  return { root: castle, parts, lights: [] };
}

/** A painted beach hut: walls, a pitched roof and a door facing the sea. */
function beachhut(scene: Scene, o: PlacedObject): Built {
  const w = 1.3;
  const d = 1.1;
  const h = 1.25;
  const P: number[] = [];
  const I: number[] = [];
  box(P, I, 0, h / 2 + 0.08, 0, w, h, d);
  // stilts
  for (const [x, z] of [[-w / 2 + 0.06, -d / 2 + 0.06], [w / 2 - 0.06, -d / 2 + 0.06], [w / 2 - 0.06, d / 2 - 0.06], [-w / 2 + 0.06, d / 2 - 0.06]])
    box(P, I, x, 0.04, z, 0.08, 0.16, 0.08);
  const walls = finish(scene, `hut${o.id}`, P, I);
  // roof: a prism along x
  const top = h + 0.08;
  const R: number[] = [
    -w / 2 - 0.08, top, -d / 2 - 0.12, w / 2 + 0.08, top, -d / 2 - 0.12, w / 2 + 0.08, top + 0.45, 0, -w / 2 - 0.08, top + 0.45, 0,
    -w / 2 - 0.08, top, d / 2 + 0.12, w / 2 + 0.08, top, d / 2 + 0.12,
  ];
  const RI = [0, 1, 2, 0, 2, 3, 3, 2, 5, 3, 5, 4, 0, 3, 4, 1, 5, 2];
  orient(R, RI, () => [0, top + 0.1, 0]);
  const roof = finish(scene, `roof${o.id}`, R, RI);
  const D: number[] = [];
  const DI: number[] = [];
  box(D, DI, 0, 0.55, -d / 2 - 0.01, 0.46, 0.82, 0.03);
  const door = finish(scene, `door${o.id}`, D, DI);
  const parts: Built['parts'] = [
    { mesh: walls, mat: 0 },
    { mesh: roof, mat: 1 },
    { mesh: door, mat: 2 },
  ];
  assemble(walls, parts);
  return { root: walls, parts, lights: [] };
}

/** Append geometry b into a. */
function appendGeom(a: { P: number[]; I: number[] }, b: { P: number[]; I: number[] }): void {
  const base = a.P.length / 3;
  for (let i = 0; i < b.P.length; i++) a.P.push(b.P[i]);
  for (let i = 0; i < b.I.length; i++) a.I.push(b.I[i] + base);
}

/** A little striped lighthouse with a lamp that glows. */
function lighthouse(scene: Scene, o: PlacedObject): Built {
  const bands = 5;
  const H = 2.2;
  const r0 = 0.42;
  const r1 = 0.26;
  const stripe0 = { P: [] as number[], I: [] as number[] };
  const stripe1 = { P: [] as number[], I: [] as number[] };
  for (let b = 0; b < bands; b++) {
    const y0 = (b / bands) * H;
    const y1 = ((b + 1) / bands) * H;
    const ra = r0 + (r1 - r0) * (b / bands);
    const rb = r0 + (r1 - r0) * ((b + 1) / bands);
    appendGeom(b % 2 === 0 ? stripe0 : stripe1, tower([[y0, ra], [y1, rb]], 10));
  }
  const trim = tower([[H, r1 + 0.1], [H + 0.06, r1 + 0.1]], 10);
  appendGeom(trim, tower([[H + 0.42, r1 * 0.95], [H + 0.72, 0.02]], 8));
  const root = part(scene, `lh${o.id}_0`, stripe0);
  const accent = part(scene, `lh${o.id}_1`, stripe1);
  const trimMesh = part(scene, `gal${o.id}`, trim);
  const lamp = part(scene, `lamp${o.id}`, tower([[H + 0.06, r1 * 0.8], [H + 0.42, r1 * 0.8]], 8));
  const parts: Built['parts'] = [
    { mesh: root, mat: 0 },
    { mesh: accent, mat: 1 },
    { mesh: trimMesh, mat: 2 },
    { mesh: lamp, mat: 3 },
  ];
  assemble(root, parts);
  return { root, parts, lights: [new Vector3(0, H + 0.24, 0)] };
}

/** A bamboo tiki torch with a flame. */
function tikitorch(scene: Scene, o: PlacedObject): Built {
  const pole = part(scene, `tiki${o.id}`, tower([[-0.2, 0.035], [1.45, 0.03]], 6));
  const cup = part(scene, `cup${o.id}`, tower([[1.42, 0.05], [1.58, 0.09], [1.62, 0.09]], 7));
  const flame = part(scene, `flame${o.id}`, tower([[1.6, 0.07], [1.72, 0.06], [1.9, 0.0]], 6));
  const parts: Built['parts'] = [
    { mesh: pole, mat: 'pole' },
    { mesh: cup, mat: 0 },
    { mesh: flame, mat: 1 },
  ];
  assemble(pole, parts);
  return { root: pole, parts, lights: [new Vector3(0, 1.72, 0)] };
}

export const STORE_BUILDERS = { parasol, surfboard, sandcastle, beachhut, lighthouse, tikitorch } as const;
export type StoreKind = keyof typeof STORE_BUILDERS;
export const isStoreKind = (k: string): k is StoreKind => k in STORE_BUILDERS;

/** How far an item reaches from its centre (m), for its glow on the sand. */
export const STORE_REACH: Record<StoreKind, number> = {
  parasol: 1.1,
  surfboard: 0.5,
  sandcastle: 0.85,
  beachhut: 0.95,
  lighthouse: 0.6,
  tikitorch: 0.35,
};
