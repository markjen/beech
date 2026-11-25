// Renders wild beach visitors (and later, resident pets).
//
// Each species is built as a single merged low-poly mesh with per-vertex
// colours and GPU animation weights packed in UVs, so an active visitor costs
// exactly 1 draw call — and 0 draw calls when absent (setEnabled(false)),
// keeping the idle scene inside perf/budget.json.

import type { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';

import { ANIMAL_COLORS, type RGB } from '../palette';
import type { AnimalSnapshot } from '../world/animals';
import type { BeachRenderer } from './beachRenderer';

interface Builder {
  P: number[];
  C: number[];
  UV: number[];
  I: number[];
}

function makeBuilder(): Builder {
  return { P: [], C: [], UV: [], I: [] };
}

/** Append an oriented box with a solid vertex colour and UV animation weights. */
function addBox(
  b: Builder,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  col: RGB,
  uvx: number,
  uvy: number,
  rx = 0,
  ry = 0,
  rz = 0,
): void {
  const base = b.P.length / 3;
  const cxR = Math.cos(rx), sxR = Math.sin(rx);
  const cyR = Math.cos(ry), syR = Math.sin(ry);
  const czR = Math.cos(rz), szR = Math.sin(rz);
  for (const [x, y, z] of [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ]) {
    let lx = (x * sx) * 0.5;
    let ly = (y * sy) * 0.5;
    let lz = (z * sz) * 0.5;
    // rotate X, then Z, then Y
    let ty = ly * cxR - lz * sxR;
    let tz = ly * sxR + lz * cxR;
    ly = ty; lz = tz;
    const tx = lx * czR - ly * szR;
    ty = lx * szR + ly * czR;
    lx = tx; ly = ty;
    const fx = lx * cyR + lz * syR;
    const fz = -lx * syR + lz * cyR;
    b.P.push(cx + fx, cy + ly, cz + fz);
    b.C.push(col[0], col[1], col[2], 1);
    b.UV.push(uvx, uvy);
  }
  for (const f of [
    [0, 1, 2, 0, 2, 3],
    [4, 6, 5, 4, 7, 6],
    [0, 4, 5, 0, 5, 1],
    [3, 2, 6, 3, 6, 7],
    [0, 3, 7, 0, 7, 4],
    [1, 5, 6, 1, 6, 2],
  ]) {
    for (const k of f) b.I.push(base + k);
  }
}

/**
 * Low-poly sand crab, unit carapace width = 1.0 along X, facing +Z, resting
 * its feet at y = 0.
 */
function buildCrabMesh(scene: Scene): Mesh {
  const b = makeBuilder();
  const c = ANIMAL_COLORS.crab;

  // Carapace: wide hexagonal-ish faceted dome (upper shell + tapered lower belly)
  const seg = 8;
  const rx = 0.5;
  const rz = 0.36;
  const yMid = 0.24;
  const yTop = 0.41;
  const yBot = 0.14;

  const midRing = b.P.length / 3;
  for (let s = 0; s < seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    // slightly broader in front than back, like a real beach crab
    const frontWiden = Math.sin(a) > 0 ? 1.06 : 0.92;
    b.P.push(Math.cos(a) * rx * frontWiden, yMid, Math.sin(a) * rz);
    b.C.push(c.shell[0], c.shell[1], c.shell[2], 1);
    b.UV.push(0, 0);
  }
  const topRing = b.P.length / 3;
  for (let s = 0; s < seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    b.P.push(Math.cos(a) * rx * 0.62, yTop, Math.sin(a) * rz * 0.62);
    b.C.push(c.shell[0], c.shell[1], c.shell[2], 1);
    b.UV.push(0, 0);
  }
  const topCenter = b.P.length / 3;
  b.P.push(0, yTop + 0.04, 0);
  b.C.push(c.shell[0], c.shell[1], c.shell[2], 1);
  b.UV.push(0, 0);

  const botCenter = b.P.length / 3;
  b.P.push(0, yBot, 0);
  b.C.push(c.belly[0], c.belly[1], c.belly[2], 1);
  b.UV.push(0, 0);

  for (let s = 0; s < seg; s++) {
    const n = (s + 1) % seg;
    // upper bevel
    b.I.push(midRing + s, topRing + s, midRing + n, midRing + n, topRing + s, topRing + n);
    // flat crown
    b.I.push(topRing + s, topCenter, topRing + n);
    // underside
    b.I.push(midRing + n, botCenter, midRing + s);
  }

  // Two cute eyestalks & dark bead eyes on the front (+Z)
  for (const side of [-1, 1]) {
    addBox(b, side * 0.16, yTop + 0.03, rz * 0.72, 0.055, 0.13, 0.055, c.legs, 0, 0, 0.2, 0, -side * 0.18);
    addBox(b, side * 0.18, yTop + 0.10, rz * 0.76, 0.085, 0.085, 0.085, c.eyes, 0, 0);
  }

  // Two front claws (chelipeds): upper arm + chunky pincer, tagged with uv.y = 1 for waving
  for (const side of [-1, 1]) {
    // arm reaching forward-outward
    addBox(b, side * 0.42, yMid - 0.02, rz * 0.88, 0.26, 0.11, 0.13, c.claws, 0, 0.6, 0, -side * 0.65, 0);
    // main pincer claw curving inward
    addBox(b, side * 0.44, yMid + 0.03, rz * 1.32, 0.28, 0.16, 0.18, c.claws, 0, 1.0, 0, side * 0.45, -side * 0.12);
    // small inner thumb
    addBox(b, side * 0.30, yMid - 0.01, rz * 1.44, 0.14, 0.08, 0.09, c.claws, 0, 1.0, 0, side * 0.25, 0);
  }

  // 8 walking legs (4 per side): alternating uv.x = +1 / -1 for tripod crab scuttle
  const legZ = [0.16, 0.04, -0.09, -0.21];
  const legYaw = [0.28, 0.08, -0.14, -0.36];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const group = (i + (side > 0 ? 0 : 1)) % 2 === 0 ? 1 : -1;
      const z0 = legZ[i];
      const yaw = side * legYaw[i];
      // upper segment going out and slightly up
      addBox(b, side * 0.58, yMid - 0.02, z0, 0.30, 0.075, 0.075, c.legs, group, 0, 0, yaw, side * 0.28);
      // lower segment going out and down to the sand (y ≈ 0.03)
      addBox(b, side * 0.78, 0.11, z0 - Math.sin(yaw) * 0.10, 0.07, 0.24, 0.07, c.legs, group, 0, 0, yaw, side * 0.42);
    }
  }

  const vd = new VertexData();
  vd.positions = b.P;
  vd.indices = b.I;
  vd.colors = b.C;
  vd.uvs = b.UV;
  const normals: number[] = [];
  VertexData.ComputeNormals(b.P, b.I, normals);
  vd.normals = normals;

  const mesh = new Mesh('wildCrab', scene);
  vd.applyToMesh(mesh, false);
  mesh.convertToFlatShadedMesh();
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.setEnabled(false);
  return mesh;
}

/** A small pile of golden crumbs, shrimp bits, and kelp on the sand (1 draw call, hidden when absent). */
function buildTreatMesh(scene: Scene): Mesh {
  const b = makeBuilder();
  const c = ANIMAL_COLORS.treat;
  addBox(b, -0.05, 0.03, 0.02, 0.08, 0.06, 0.07, c.crumb, 0, 0, 0.1, 0.4, 0.1);
  addBox(b, 0.05, 0.035, -0.03, 0.09, 0.07, 0.08, c.shrimp, 0, 0, -0.1, 1.1, 0.15);
  addBox(b, 0.0, 0.025, 0.05, 0.07, 0.05, 0.06, c.crumb, 0, 0, 0.2, 0.8, 0);
  addBox(b, 0.02, 0.015, -0.01, 0.16, 0.025, 0.05, c.kelp, 0, 0, 0, 0.5, 0);

  const vd = new VertexData();
  vd.positions = b.P;
  vd.indices = b.I;
  vd.colors = b.C;
  vd.uvs = b.UV;
  const normals: number[] = [];
  VertexData.ComputeNormals(b.P, b.I, normals);
  vd.normals = normals;

  const mesh = new Mesh('animalTreat', scene);
  vd.applyToMesh(mesh, false);
  mesh.convertToFlatShadedMesh();
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.setEnabled(false);
  return mesh;
}

/** Low-poly offshore dolphin, unit length = 1.0 along +Z, dorsal fin along +Y (1 draw call). */
function buildDolphinMesh(scene: Scene): Mesh {
  const b = makeBuilder();
  const c = ANIMAL_COLORS.dolphin;
  // Torso segments (tapered sleek body, slate-blue back + pale belly)
  addBox(b, 0, 0.05, 0.04, 0.22, 0.16, 0.44, c.back, 0, 0);
  addBox(b, 0, -0.04, 0.04, 0.18, 0.10, 0.40, c.belly, 0, 0);
  // Head & rostrum (snout pointing +Z)
  addBox(b, 0, 0.03, 0.30, 0.16, 0.13, 0.18, c.back, 0, 0, 0.12, 0, 0);
  addBox(b, 0, -0.01, 0.44, 0.08, 0.06, 0.16, c.back, 0, 0, 0.05, 0, 0);
  // Eyes
  for (const side of [-1, 1]) {
    addBox(b, side * 0.085, 0.03, 0.30, 0.025, 0.025, 0.025, c.eyes, 0, 0);
  }
  // Curved dorsal fin
  addBox(b, 0, 0.19, -0.02, 0.04, 0.18, 0.14, c.fin, 0, 0, -0.35, 0, 0);
  // Pectoral fins
  for (const side of [-1, 1]) {
    addBox(b, side * 0.16, -0.03, 0.10, 0.18, 0.035, 0.10, c.fin, 0, 0, 0, -side * 0.45, -side * 0.32);
  }
  // Tail peduncle & horizontal flukes
  addBox(b, 0, 0.01, -0.28, 0.12, 0.10, 0.24, c.back, 0, 0, -0.06, 0, 0);
  addBox(b, 0, 0.0, -0.45, 0.34, 0.035, 0.12, c.fin, 0, 0);

  const vd = new VertexData();
  vd.positions = b.P;
  vd.indices = b.I;
  vd.colors = b.C;
  vd.uvs = b.UV;
  const normals: number[] = [];
  VertexData.ComputeNormals(b.P, b.I, normals);
  vd.normals = normals;

  const mesh = new Mesh('wildDolphin', scene);
  vd.applyToMesh(mesh, false);
  mesh.convertToFlatShadedMesh();
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.setEnabled(false);
  return mesh;
}

/**
 * Owns the single-draw-call crab, dolphin, and dropped treat meshes, syncing
 * their transforms and shader animation uniforms from `AnimalController.snapshot()`.
 */
export class AnimalView {
  readonly mesh: Mesh;
  readonly dolphinMesh: Mesh;
  readonly treatMesh: Mesh;
  readonly mat: ShaderMaterial;
  private visible = false;
  private dolphinVisible = false;
  private treatVisible = false;
  /** animals live in their beach's own frame (centred on x = 0): this is where that beach sits along the shore */
  offsetX = 0;

  constructor(scene: Scene, renderer: BeachRenderer) {
    this.mat = renderer.createAnimalMaterial(0.25);
    this.mesh = buildCrabMesh(scene);
    this.mesh.material = this.mat;
    this.dolphinMesh = buildDolphinMesh(scene);
    this.dolphinMesh.material = this.mat;
    this.treatMesh = buildTreatMesh(scene);
    this.treatMesh.material = this.mat;
  }

  update(snap: Readonly<AnimalSnapshot>, beachVisible: boolean): void {
    const showTreat = snap.food.active && beachVisible;
    if (showTreat !== this.treatVisible) {
      this.treatVisible = showTreat;
      this.treatMesh.setEnabled(showTreat);
    }
    if (showTreat) {
      this.treatMesh.position.set(snap.food.x + this.offsetX, snap.food.y, snap.food.z);
    }

    const showCrab = snap.active && snap.species === 'crab' && beachVisible;
    if (showCrab !== this.visible) {
      this.visible = showCrab;
      this.mesh.setEnabled(showCrab);
    }

    const showDolphin = snap.active && snap.species === 'dolphin' && beachVisible;
    if (showDolphin !== this.dolphinVisible) {
      this.dolphinVisible = showDolphin;
      this.dolphinMesh.setEnabled(showDolphin);
    }

    if (showDolphin) {
      const s = snap.size;
      this.dolphinMesh.position.set(snap.x + this.offsetX, snap.y, snap.z);
      this.dolphinMesh.scaling.set(s, s, s);
      this.dolphinMesh.rotation.y = snap.facing;
      this.dolphinMesh.rotation.x = snap.pitch;
      this.dolphinMesh.rotation.z = Math.sin(snap.scuttlePhase * 0.5) * 0.08;
      this.mat.setFloat('scuttlePhase', 0);
      this.mat.setFloat('scuttleAmp', 0);
      this.mat.setFloat('clawWave', 0);
      return;
    }

    if (!showCrab) return;

    const s = snap.size;
    // Sink smoothly below the sand during emerging / burrowing; gentle hop when freshly fed
    const sink = (1 - snap.emerge) * s * 0.55;
    const hop = snap.happyTimer > 0 ? Math.abs(Math.sin(snap.happyTimer * 8)) * s * 0.25 : 0;
    this.mesh.position.set(snap.x + this.offsetX, snap.y - sink + hop, snap.z);
    this.mesh.scaling.set(s, s, s);
    this.mesh.rotation.y = snap.facing;

    // Subtle body rock while scuttling or burrowing
    const moving = snap.speed > 0.05;
    const burrowing = snap.phase === 'emerging' || snap.phase === 'burrowing';
    this.mesh.rotation.z = moving ? Math.sin(snap.scuttlePhase) * 0.06 : burrowing ? Math.sin(snap.scuttlePhase * 1.3) * 0.14 : 0;
    this.mesh.rotation.x = burrowing ? (1 - snap.emerge) * 0.25 : 0;

    this.mat.setFloat('scuttlePhase', snap.scuttlePhase);
    this.mat.setFloat('scuttleAmp', moving ? Math.min(1.2, snap.speed) : burrowing ? 0.85 : 0);
    this.mat.setFloat('clawWave', snap.happyTimer > 0 ? 1 : snap.clawWave);
  }

  dispose(): void {
    this.mesh.dispose();
    this.dolphinMesh.dispose();
    this.treatMesh.dispose();
    this.mat.dispose();
  }
}
