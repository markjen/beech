import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';

// Small helpers for building the low-poly props (src/render/objects.ts,
// src/render/storeMeshes.ts).

/** Small deterministic random numbers from an object's variant, so a rock looks the same everywhere. */
export function rng(seed: number): () => number {
  let s = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5) >>> 0;
    s ^= s >>> 13;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Turn every triangle to face away from the shape's core (a point on its
 * axis), so the lighting is right whichever way the triangles were listed.
 */
export function orient(P: number[], I: number[], core: (x: number, y: number, z: number) => [number, number, number]): void {
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const cx = (P[a] + P[b] + P[c]) / 3;
    const cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3;
    const cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    const k = core(cx, cy, cz);
    // Babylon (left-handed, clockwise front faces) wants this cross product pointing inward
    if (n[0] * (cx - k[0]) + n[1] * (cy - k[1]) + n[2] * (cz - k[2]) > 0) {
      const tmp = I[t + 1];
      I[t + 1] = I[t + 2];
      I[t + 2] = tmp;
    }
  }
}

export function finish(scene: Scene, name: string, P: number[], I: number[]): Mesh {
  const vd = new VertexData();
  vd.positions = P;
  vd.indices = I;
  const normals: number[] = [];
  VertexData.ComputeNormals(P, I, normals);
  vd.normals = normals;
  const m = new Mesh(name, scene);
  vd.applyToMesh(m, false);
  m.convertToFlatShadedMesh();
  m.isPickable = false;
  m.alwaysSelectAsActiveMesh = true;
  return m;
}

/** A lathe: rings of (x, radius) along the x axis, `seg` sides, capped at both ends. */
export function lathe(profile: [number, number][], seg: number, squash = 1, wobble?: () => number): { P: number[]; I: number[] } {
  const P: number[] = [];
  const I: number[] = [];
  for (const [x, rad] of profile) {
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const w = rad * (wobble ? wobble() : 1);
      P.push(x, Math.sin(a) * w * squash, Math.cos(a) * w);
    }
  }
  for (let k = 0; k < profile.length - 1; k++) {
    for (let s = 0; s < seg; s++) {
      const a = k * seg + s;
      const b = k * seg + ((s + 1) % seg);
      I.push(a, b, a + seg, b, b + seg, a + seg);
    }
  }
  const c0 = P.length / 3;
  P.push(profile[0][0], 0, 0);
  const last = profile.length - 1;
  const c1 = P.length / 3;
  P.push(profile[last][0], 0, 0);
  for (let s = 0; s < seg; s++) {
    I.push(c0, (s + 1) % seg, s);
    I.push(c1, last * seg + s, last * seg + ((s + 1) % seg));
  }
  return { P, I };
}

/** Append an axis-aligned box (rotated by `tilt` about x) to P/I. */
export function box(P: number[], I: number[], cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, tilt = 0): void {
  const b = P.length / 3;
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  for (const [x, y, z] of [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ]) {
    const ly = (y * sy) / 2;
    const lz = (z * sz) / 2;
    P.push(cx + (x * sx) / 2, cy + ly * c - lz * s, cz + ly * s + lz * c);
  }
  for (const f of [[0, 1, 2, 0, 2, 3], [4, 6, 5, 4, 7, 6], [0, 4, 5, 0, 5, 1], [3, 2, 6, 3, 6, 7], [0, 3, 7, 0, 7, 4], [1, 5, 6, 1, 6, 2]])
    for (const k of f) I.push(b + k);
}

