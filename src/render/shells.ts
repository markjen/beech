import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import type { Scene } from '@babylonjs/core/scene';

import { WORLD_SIZE_X } from '../config';
import type { SandPicker } from '../input/sandPicker';
import type { RGB } from '../palette';
import type { BeachRenderer } from './beachRenderer';

/** Tiny low-poly props: a ridged scallop, a whelk cone and a pebble. */
function scallop(scene: Scene): Mesh {
  const P: number[] = [0, 0.012, -0.03];
  const ribs = 9;
  for (let r = 0; r <= ribs; r++) {
    const a = Math.PI * (0.1 + (0.8 * r) / ribs);
    const rad = 0.085;
    P.push(Math.cos(a) * rad, r % 2 ? 0.026 : 0.012, Math.sin(a) * rad - 0.03);
  }
  const I: number[] = [];
  for (let r = 1; r <= ribs; r++) I.push(0, r, r + 1);
  // underside
  const base = P.length / 3;
  P.push(0, 0, -0.03);
  for (let r = 0; r <= ribs; r++) {
    const a = Math.PI * (0.1 + (0.8 * r) / ribs);
    P.push(Math.cos(a) * 0.085, 0, Math.sin(a) * 0.085 - 0.03);
  }
  for (let r = 1; r <= ribs; r++) I.push(base, base + r + 1, base + r);
  for (let r = 1; r <= ribs; r++) I.push(r, base + r, base + r + 1, r, base + r + 1, r + 1);
  return build(scene, 'scallop', P, I);
}

function whelk(scene: Scene): Mesh {
  const P: number[] = [];
  const I: number[] = [];
  const seg = 6;
  const len = 0.14;
  P.push(len / 2, 0.025, 0); // tip
  for (let s = 0; s < seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    P.push(-len / 2, 0.03 + Math.sin(a) * 0.03, Math.cos(a) * 0.035);
  }
  P.push(-len / 2 - 0.02, 0.03, 0); // back cap
  for (let s = 0; s < seg; s++) {
    const a = 1 + s;
    const b = 1 + ((s + 1) % seg);
    I.push(0, a, b, seg + 1, b, a);
  }
  return build(scene, 'whelk', P, I);
}

function pebble(scene: Scene): Mesh {
  const P: number[] = [0, 0.04, 0];
  const I: number[] = [];
  const seg = 7;
  for (let s = 0; s < seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    P.push(Math.cos(a) * 0.07, 0.018, Math.sin(a) * 0.05);
  }
  for (let s = 0; s < seg; s++) {
    const a = 1 + s;
    const b = 1 + ((s + 1) % seg);
    I.push(0, b, a);
  }
  return build(scene, 'pebble', P, I);
}

function build(scene: Scene, name: string, P: number[], I: number[]): Mesh {
  const vd = new VertexData();
  vd.positions = P;
  vd.indices = I;
  const normals: number[] = [];
  VertexData.ComputeNormals(P, I, normals);
  vd.normals = normals;
  const m = new Mesh(name, scene);
  vd.applyToMesh(m, true);
  m.convertToFlatShadedMesh();
  m.isVisible = false;
  m.isPickable = false;
  return m;
}

interface Shell {
  mesh: Mesh;
  x: number;
  z: number;
  yaw: number;
  size: number;
  age: number;
  life: number;
}

const COLORS: RGB[] = [
  [0.98, 0.84, 0.8], // shell pink
  [0.99, 0.95, 0.88], // cream
  [0.93, 0.75, 0.6], // apricot
  [0.62, 0.62, 0.68], // pebble grey
];

/**
 * Shells and pebbles that the waves leave behind at the top of the swash.
 * Purely decorative: they sit on whatever the sand is doing, drift a little
 * in the backwash and fade after a few minutes.
 */
export class ShellField {
  private readonly protos: Mesh[];
  private readonly mats: ShaderMaterial[];
  private readonly shells: Shell[] = [];
  private nextSpawn = 8;
  private armed = false;
  private time = 0;

  constructor(
    scene: Scene,
    renderer: BeachRenderer,
    private readonly picker: SandPicker,
    private readonly max = 10,
  ) {
    this.protos = [scallop(scene), whelk(scene), pebble(scene)];
    this.mats = COLORS.map((c) => renderer.createPropMaterial(c));
  }

  get count(): number {
    return this.shells.length;
  }

  private spawn(): void {
    const half = WORLD_SIZE_X / 2 - 1;
    for (let attempt = 0; attempt < 6; attempt++) {
      const x = (Math.random() * 2 - 1) * half;
      const zr = this.picker.runupZ(x);
      if (Number.isNaN(zr)) continue;
      const z = zr - 0.15 - Math.random() * 0.4;
      const type = Math.random() < 0.2 ? 2 : Math.random() < 0.6 ? 0 : 1;
      const mat = type === 2 ? this.mats[3] : this.mats[Math.floor(Math.random() * 3)];
      const mesh = this.protos[type].clone(`shell${this.time.toFixed(2)}`);
      mesh.material = mat;
      mesh.isVisible = true;
      mesh.alwaysSelectAsActiveMesh = true;
      this.shells.push({ mesh, x, z, yaw: Math.random() * Math.PI * 2, size: 1.5 + Math.random() * 0.8, age: 0, life: 150 + Math.random() * 150 });
      if (this.shells.length > this.max) this.shells.shift()!.mesh.dispose();
      return;
    }
  }

  /** swashRate > 0 while water runs up the beach, < 0 as it drains back. */
  update(dt: number, swashRate: number): void {
    this.time += dt;
    // a receding wave after a decent run-up leaves things behind
    if (swashRate > 0.25) this.armed = true;
    if (this.armed && swashRate < 0) {
      this.armed = false;
      if (this.time > this.nextSpawn) {
        this.spawn();
        if (Math.random() < 0.3) this.spawn();
        this.nextSpawn = this.time + 14 + Math.random() * 22;
      }
    }

    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.age += dt;
      const depth = this.picker.waterAt(s.x, s.z);
      if (depth > 0.02) {
        // nudged around by the water: up with the swash, down with the backwash
        s.z += Math.sign(swashRate) * dt * 0.08 * Math.min(1, depth * 10);
        s.x += (Math.random() - 0.5) * dt * 0.05;
        s.yaw += (Math.random() - 0.5) * dt * 0.6;
      }
      const h = this.picker.heightAt(s.x, s.z);
      if (Number.isNaN(h) || s.age > s.life) {
        s.mesh.dispose();
        this.shells.splice(i, 1);
        continue;
      }
      const grow = Math.min(1, s.age / 0.8) * Math.min(1, (s.life - s.age) / 3);
      const sc = s.size * grow;
      s.mesh.position.set(s.x, h - 0.004, s.z);
      s.mesh.rotation.y = s.yaw;
      s.mesh.scaling.setAll(Math.max(0.001, sc));
    }
  }
}
