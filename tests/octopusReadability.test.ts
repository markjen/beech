// The octopus must read as an octopus from the default top-down play
// camera. The swimmer sits so only local y ≈ 0.50 and up breaks the water
// surface (`swimY` in src/world/animals.ts places the origin at
// surface − kind.top × size + 0.05; octopus top 0.55, size 0.9, so local
// y 0.50 is ~0.005 above the surface), and before this fix the eyes topped
// out at y 0.26 and the arms at y 0.07 — both underwater, so from above the
// animal was just a flat orange slab. These tests pin the features that
// have to sit above the waterline: the eyes on the mantle crown, the pale
// glint on each eye, and the arm tops fanning out at the waterline.
import { describe, expect, it } from 'vitest';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';

import { ANIMAL_COLORS, type RGB } from '../src/palette';
import { buildOctopusMesh } from '../src/render/animals';

/** Local y at which the swimming octopus breaks the water surface. */
const WATERLINE = 0.5;

function heightsOf(mesh: Mesh, color: RGB): number[] {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const colors = mesh.getVerticesData(VertexBuffer.ColorKind) ?? [];
  const heights: number[] = [];
  for (let v = 0; v < positions.length / 3; v++) {
    const r = colors[v * 4];
    const g = colors[v * 4 + 1];
    const b = colors[v * 4 + 2];
    if (Math.abs(r - color[0]) < 1e-4 && Math.abs(g - color[1]) < 1e-4 && Math.abs(b - color[2]) < 1e-4) {
      heights.push(positions[v * 3 + 1]);
    }
  }
  return heights;
}

describe('octopus readability from the top-down camera', () => {
  it('keeps the eyes, eye glints and arm tops above the waterline', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const mesh = buildOctopusMesh(scene);
      const c = ANIMAL_COLORS.octopus;

      const eyes = heightsOf(mesh, c.eyes);
      expect(eyes.length).toBeGreaterThan(0);
      expect(Math.max(...eyes)).toBeGreaterThan(WATERLINE); // peak ≈ 0.604

      const glints = heightsOf(mesh, c.eyeGlint);
      expect(glints.length).toBeGreaterThan(0);
      expect(Math.min(...glints)).toBeGreaterThan(WATERLINE); // span ≈ 0.562–0.598, fully above water

      const arms = heightsOf(mesh, c.arms);
      expect(arms.length).toBeGreaterThan(0);
      expect(Math.max(...arms)).toBeGreaterThan(WATERLINE); // tops ≈ 0.520

      // The domed mantle the eyes sit on breaks the surface too — otherwise
      // the eyes would float on nothing.
      const body = heightsOf(mesh, c.body);
      expect(body.length).toBeGreaterThan(0);
      expect(Math.max(...body)).toBeGreaterThan(WATERLINE); // crown ≈ 0.55
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
