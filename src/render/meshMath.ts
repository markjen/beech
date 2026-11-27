// Mesh maths with no Babylon in it (boxes as raw vertex lists, a seeded
// random), so the server's pictures can share the scenery's shapes
// (scripts/bundle-server.mjs). meshKit.ts re-exports these.

export function rng(seed: number): () => number {
  let s = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5) >>> 0;
    s ^= s >>> 13;
    return (s >>> 0) / 4294967296;
  };
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
