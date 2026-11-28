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

import { Color3 } from '@babylonjs/core/Maths/math.color';

import { ANIMAL_COLORS, type RGB } from '../palette';
import type { AnimalSnapshot, AnimalSpecies } from '../world/animals';
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
  alpha = 1,
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
    b.C.push(col[0], col[1], col[2], alpha);
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
  addBox(b, -0.05, 0.03, 0.02, 0.08, 0.06, 0.07, c.crumb, 0, 0, 0.1, 0.4, 0.1, 0);
  addBox(b, 0.05, 0.035, -0.03, 0.09, 0.07, 0.08, c.shrimp, 0, 0, -0.1, 1.1, 0.15, 0);
  addBox(b, 0.0, 0.025, 0.05, 0.07, 0.05, 0.06, c.crumb, 0, 0, 0.2, 0.8, 0, 0);
  addBox(b, 0.02, 0.015, -0.01, 0.16, 0.025, 0.05, c.kelp, 0, 0, 0, 0.5, 0, 0);

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

function finishAnimal(scene: Scene, b: Builder, name: string): Mesh {
  const vd = new VertexData();
  vd.positions = b.P;
  vd.indices = b.I;
  vd.colors = b.C;
  vd.uvs = b.UV;
  const normals: number[] = [];
  VertexData.ComputeNormals(b.P, b.I, normals);
  vd.normals = normals;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh, false);
  mesh.convertToFlatShadedMesh();
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.setEnabled(false);
  return mesh;
}

/** Sandpiper: unit height ≈ 0.9, facing +Z, feet at y = 0. Wings (uv.y = 1) flap; legs (uv.x = ±1) step. */
function buildSandpiperMesh(scene: Scene): Mesh {
  const b = makeBuilder();
  const c = ANIMAL_COLORS.sandpiper;
  // round body: brown back, white breast
  addBox(b, 0, 0.5, 0, 0.3, 0.22, 0.46, c.back, 0, 0, -0.12, 0, 0);
  addBox(b, 0, 0.44, 0.06, 0.26, 0.16, 0.36, c.belly, 0, 0, -0.12, 0, 0);
  // head and a long thin beak
  addBox(b, 0, 0.7, 0.24, 0.17, 0.16, 0.17, c.back, 0, 0);
  addBox(b, 0, 0.67, 0.44, 0.035, 0.035, 0.26, c.beak, 0, 0, 0.12, 0, 0, 0);
  for (const side of [-1, 1]) {
    addBox(b, side * 0.075, 0.73, 0.3, 0.03, 0.03, 0.03, c.beak, 0, 0, 0, 0, 0, 0);
    // folded wings that lift when it flies
    addBox(b, side * 0.17, 0.55, -0.04, 0.06, 0.12, 0.4, c.wing, 0, 1, -0.1, 0, side * 0.2);
    // thin legs, alternating
    addBox(b, side * 0.07, 0.18, 0.02, 0.035, 0.36, 0.035, c.legs, side, 0, 0, 0, 0, 0);
    addBox(b, side * 0.07, 0.01, 0.06, 0.07, 0.02, 0.12, c.legs, side, 0, 0, 0, 0, 0);
  }
  // tail
  addBox(b, 0, 0.53, -0.3, 0.14, 0.05, 0.16, c.wing, 0, 0, 0.25, 0, 0);
  return finishAnimal(scene, b, 'petSandpiper');
}

/**
 * Octopus: mantle up to y ≈ 0.55 at unit size, eight arms spread around y = 0 (uv.x = ±1: they ripple).
 *
 * Readability from the default top-down play camera: the swimmer sits so
 * only local y ≈ 0.50 and up breaks the water surface (see `swimY`), so the
 * features that have to read as an octopus live at the top of the mesh. The
 * eyes sit on the front of the mantle crown, tipped up-forward, with a pale
 * glint on each, and the arms fan out at the waterline (tops at y ≈ 0.52)
 * instead of trailing along the seabed — from above the animal reads as a
 * domed mantle, two dark eyes, and eight arms, at any facing. Eyes and
 * glints pass alpha 0 so the camo tint never washes them out.
 */
function buildOctopusMesh(scene: Scene): Mesh {
  const b = makeBuilder();
  const c = ANIMAL_COLORS.octopus;
  // bulbous mantle, tipped back a little; the crown is narrower than the
  // base so the top reads as a dome, not a flat slab
  addBox(b, 0, 0.3, -0.06, 0.42, 0.34, 0.46, c.body, 0, 0, 0.25, 0, 0);
  addBox(b, 0, 0.47, -0.12, 0.3, 0.16, 0.32, c.body, 0, 0, 0.3, 0, 0);
  addBox(b, 0, 0.14, 0.08, 0.36, 0.14, 0.3, c.body, 0, 0, 0, 0, 0);
  // two big eyes on the front of the crown, tipped up-forward so they read
  // from the top-down camera, each with a pale glint on top
  for (const side of [-1, 1]) {
    addBox(b, side * 0.13, 0.53, 0.08, 0.12, 0.11, 0.12, c.eyes, 0, 0, -0.4, 0, 0, 0);
    addBox(b, side * 0.13, 0.58, 0.06, 0.045, 0.02, 0.045, c.eyeGlint, 0, 0, -0.4, 0, 0, 0);
  }
  // eight arms fanning out at the waterline, thick enough to read from above
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const g = i % 2 === 0 ? 1 : -1;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    addBox(b, ca * 0.3, 0.47, sa * 0.3 + 0.04, 0.34, 0.1, 0.14, c.arms, g, 0, 0, -a, 0);
    addBox(b, ca * 0.55, 0.48, sa * 0.55 + 0.04, 0.26, 0.08, 0.11, c.arms, g, 0, 0, -a + 0.4, 0);
  }
  return finishAnimal(scene, b, 'petOctopus');
}

/** A puff of ink: a few dark lumps (scaled by how fresh it is). */
function buildInkMesh(scene: Scene): Mesh {
  const b = makeBuilder();
  const c = ANIMAL_COLORS.octopus.ink;
  addBox(b, 0, 0.1, 0, 0.5, 0.2, 0.5, c, 0, 0, 0, 0.3, 0, 0);
  addBox(b, 0.25, 0.08, 0.2, 0.36, 0.16, 0.36, c, 0, 0, 0, 0.9, 0, 0);
  addBox(b, -0.22, 0.07, 0.18, 0.32, 0.14, 0.3, c, 0, 0, 0, 1.4, 0, 0);
  addBox(b, 0.05, 0.06, -0.28, 0.34, 0.12, 0.32, c, 0, 0, 0, 0.6, 0, 0);
  return finishAnimal(scene, b, 'octopusInk');
}

/** Harbor seal: unit length along +Z, top of the back at y ≈ 0.32; flippers (uv.x) paddle. */
function buildSealMesh(scene: Scene): Mesh {
  const b = makeBuilder();
  const c = ANIMAL_COLORS.seal;
  addBox(b, 0, 0.16, 0.02, 0.3, 0.3, 0.56, c.back, 0, 0);
  addBox(b, 0, 0.09, 0.04, 0.26, 0.14, 0.5, c.belly, 0, 0);
  // tapering to the tail
  addBox(b, 0, 0.12, -0.32, 0.2, 0.18, 0.2, c.back, 0, 0, -0.1, 0, 0);
  // round head with whiskered snout
  addBox(b, 0, 0.22, 0.36, 0.22, 0.2, 0.2, c.back, 0, 0, 0, 0, 0);
  addBox(b, 0, 0.18, 0.48, 0.12, 0.1, 0.08, c.belly, 0, 0);
  for (const side of [-1, 1]) {
    addBox(b, side * 0.07, 0.27, 0.45, 0.04, 0.04, 0.03, c.eyes, 0, 0, 0, 0, 0, 0);
    addBox(b, side * 0.1, 0.2, 0.15, 0.04, 0.03, 0.04, c.spots, 0, 0);
    addBox(b, side * 0.08, 0.27, -0.08, 0.04, 0.03, 0.05, c.spots, 0, 0);
    // fore flippers and the hind pair
    addBox(b, side * 0.18, 0.04, 0.18, 0.12, 0.03, 0.12, c.back, side, 0, 0, side * 0.4, 0);
    addBox(b, side * 0.07, 0.08, -0.5, 0.1, 0.03, 0.16, c.spots, -side, 0, 0, side * 0.3, 0);
  }
  return finishAnimal(scene, b, 'petSeal');
}

/** Sea turtle: unit shell length along +Z, top of the shell at y ≈ 0.3; flippers (uv.x) row. */
function buildTurtleMesh(scene: Scene): Mesh {
  const b = makeBuilder();
  const c = ANIMAL_COLORS.turtle;
  // domed shell: base plate, middle and top, with lighter scutes
  addBox(b, 0, 0.08, 0, 0.62, 0.08, 0.74, c.belly, 0, 0);
  addBox(b, 0, 0.16, 0, 0.6, 0.1, 0.7, c.shell, 0, 0);
  addBox(b, 0, 0.24, -0.02, 0.4, 0.08, 0.5, c.shell, 0, 0);
  addBox(b, 0, 0.29, -0.02, 0.16, 0.03, 0.18, c.scutes, 0, 0);
  addBox(b, 0.13, 0.27, 0.1, 0.12, 0.03, 0.14, c.scutes, 0, 0, 0, 0.3, 0);
  addBox(b, -0.13, 0.27, 0.1, 0.12, 0.03, 0.14, c.scutes, 0, 0, 0, -0.3, 0);
  addBox(b, 0.13, 0.27, -0.16, 0.12, 0.03, 0.14, c.scutes, 0, 0, 0, -0.3, 0);
  addBox(b, -0.13, 0.27, -0.16, 0.12, 0.03, 0.14, c.scutes, 0, 0, 0, 0.3, 0);
  // head and neck
  addBox(b, 0, 0.13, 0.44, 0.14, 0.1, 0.18, c.skin, 0, 0);
  addBox(b, 0, 0.15, 0.54, 0.16, 0.12, 0.12, c.skin, 0, 0);
  for (const side of [-1, 1]) {
    addBox(b, side * 0.06, 0.18, 0.58, 0.03, 0.03, 0.03, c.eyes, 0, 0, 0, 0, 0, 0);
    // long front flippers, short back ones, rowing in turn
    addBox(b, side * 0.42, 0.07, 0.2, 0.36, 0.03, 0.14, c.skin, side, 0, 0, side * -0.5, 0);
    addBox(b, side * 0.28, 0.06, -0.38, 0.18, 0.03, 0.1, c.skin, -side, 0, 0, side * 0.5, 0);
  }
  addBox(b, 0, 0.08, -0.42, 0.06, 0.04, 0.1, c.skin, 0, 0);
  return finishAnimal(scene, b, 'petTurtle');
}

/** Flipper tracks behind a turtle: a flat print per mark, moved as prints are laid (1 draw call). */
class TrackMarks {
  readonly mesh: Mesh;
  /** where every print's vertices start (all parked out of sight at y = -1000) */
  private readonly template: Float32Array;
  private readonly pos: Float32Array;
  private shown = -1;

  constructor(scene: Scene, private readonly max: number) {
    const b = makeBuilder();
    const col = ANIMAL_COLORS.turtle.track;
    for (let i = 0; i < max; i++) addBox(b, 0, -1000, 0, 0.22, 0.01, 0.12, col, 0, 0, 0, 0, 0, 0);
    this.mesh = finishAnimal(scene, b, 'turtleTracks');
    this.template = new Float32Array(this.mesh.getVerticesData('position') ?? []);
    this.pos = new Float32Array(this.template);
    this.mesh.markVerticesDataAsUpdatable('position', true);
  }

  update(tracks: Float32Array, count: number, heightAt: (x: number, z: number) => number, offsetX: number): void {
    if (count === this.shown) return;
    this.shown = count;
    const per = this.template.length / this.max;
    for (let i = 0; i < this.max; i++) {
      const on = i < count;
      const x = on ? tracks[i * 2] : 0;
      const z = on ? tracks[i * 2 + 1] : 0;
      const h = on ? heightAt(x, z) : NaN;
      const dy = on && Number.isFinite(h) ? h + 0.012 + 1000 : 0;
      for (let v = 0; v < per; v += 3) {
        const k = i * per + v;
        this.pos[k] = this.template[k] + (dy ? x + offsetX : 0);
        this.pos[k + 1] = this.template[k + 1] + dy;
        this.pos[k + 2] = this.template[k + 2] + (dy ? z : 0);
      }
    }
    this.mesh.updateVerticesData('position', this.pos);
    this.mesh.refreshBoundingInfo();
  }
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
 * Owns one single-draw-call mesh per species (built the first time it's
 * needed), the dropped treat, the octopus's ink and the turtle's tracks,
 * syncing them from `AnimalController.snapshot()`. Only the animal that's out
 * is enabled, so an empty beach costs 0 draw calls.
 */
export class AnimalView {
  readonly mat: ShaderMaterial;
  readonly treatMesh: Mesh;
  private readonly scene: Scene;
  private readonly meshes = new Map<AnimalSpecies, Mesh>();
  private shownSpecies: AnimalSpecies | null = null;
  private treatVisible = false;
  private ink: Mesh | null = null;
  private tracks: TrackMarks | null = null;
  private readonly camo = new Color3(0, 0, 0);
  /** animals live in their beach's own frame (centred on x = 0): this is where that beach sits along the shore */
  offsetX = 0;
  /** sand height in the beach's frame (for the turtle's tracks) */
  heightAt: (x: number, z: number) => number = () => 0;

  constructor(scene: Scene, renderer: BeachRenderer) {
    this.scene = scene;
    this.mat = renderer.createAnimalMaterial(0.25);
    const camo = ANIMAL_COLORS.octopus.camo;
    this.camo.set(camo[0], camo[1], camo[2]);
    this.treatMesh = buildTreatMesh(scene);
    this.treatMesh.material = this.mat;
  }

  /** The crab's mesh (kept for callers that used it directly). */
  get mesh(): Mesh {
    return this.meshFor('crab');
  }

  private meshFor(species: AnimalSpecies): Mesh {
    let m = this.meshes.get(species);
    if (!m) {
      m =
        species === 'dolphin'
          ? buildDolphinMesh(this.scene)
          : species === 'sandpiper'
            ? buildSandpiperMesh(this.scene)
            : species === 'octopus'
              ? buildOctopusMesh(this.scene)
              : species === 'seal'
                ? buildSealMesh(this.scene)
                : species === 'turtle'
                  ? buildTurtleMesh(this.scene)
                  : buildCrabMesh(this.scene);
      m.material = this.mat;
      this.meshes.set(species, m);
    }
    return m;
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

    const want = snap.active && beachVisible ? snap.species : null;
    if (want !== this.shownSpecies) {
      if (this.shownSpecies) this.meshes.get(this.shownSpecies)?.setEnabled(false);
      if (want) this.meshFor(want).setEnabled(true);
      this.shownSpecies = want;
    }
    this.updateExtras(snap, want);
    if (!want) return;
    const mesh = this.meshFor(want);
    const s = snap.size;
    const happy = snap.happyTimer > 0;
    this.mat.setFloat('tint', 0);
    this.mat.setColor3('tintCol', this.camo);
    mesh.scaling.set(s, s, s);
    mesh.rotation.y = snap.facing;
    mesh.rotation.x = 0;
    mesh.rotation.z = 0;

    if (snap.carried) {
      // held up, legs dangling
      mesh.position.set(snap.x + this.offsetX, snap.y, snap.z);
      mesh.rotation.z = Math.sin(snap.scuttlePhase) * 0.12;
      this.mat.setFloat('scuttlePhase', snap.scuttlePhase * 2);
      this.mat.setFloat('scuttleAmp', 0.6);
      this.mat.setFloat('clawWave', want === 'sandpiper' ? 1 : 0);
      return;
    }

    if (want === 'dolphin') {
      mesh.position.set(snap.x + this.offsetX, snap.y, snap.z);
      mesh.rotation.x = snap.pitch;
      // a fed dolphin spins in the air
      mesh.rotation.z = happy ? snap.happyTimer * Math.PI * 2 : Math.sin(snap.scuttlePhase * 0.5) * 0.08;
      this.mat.setFloat('scuttlePhase', 0);
      this.mat.setFloat('scuttleAmp', 0);
      this.mat.setFloat('clawWave', 0);
      return;
    }

    if (want === 'octopus') {
      const e = Math.max(0.05, snap.emerge);
      mesh.scaling.set(s * e, s * e, s * e);
      mesh.position.set(snap.x + this.offsetX, snap.y + (happy ? Math.abs(Math.sin(snap.happyTimer * 6)) * 0.15 : 0), snap.z);
      this.mat.setFloat('tint', snap.tint * 0.85);
      this.mat.setFloat('scuttlePhase', snap.scuttlePhase);
      this.mat.setFloat('scuttleAmp', 0.35 + Math.min(1, snap.speed));
      this.mat.setFloat('clawWave', 0);
      return;
    }

    if (want === 'seal' || want === 'turtle') {
      mesh.position.set(snap.x + this.offsetX, snap.y, snap.z);
      mesh.rotation.x = snap.pitch;
      const moving = snap.speed > 0.05;
      // a seal on the sand rolls onto its side to sunbathe now and then
      if (want === 'seal' && !snap.inWater && snap.phase === 'pausing') mesh.rotation.z = Math.max(0, Math.sin(snap.scuttlePhase * 0.05)) * 0.9;
      else if (snap.inWater) mesh.rotation.z = Math.sin(snap.scuttlePhase * 0.7) * 0.06;
      this.mat.setFloat('scuttlePhase', snap.inWater ? snap.scuttlePhase * 1.4 : snap.scuttlePhase);
      this.mat.setFloat('scuttleAmp', moving || snap.inWater ? 0.9 : 0);
      this.mat.setFloat('clawWave', 0);
      return;
    }

    if (want === 'sandpiper') {
      // flies in and out: up off the sand while flapping
      const alt = snap.flap * 2.2;
      const hop = happy ? Math.abs(Math.sin(snap.happyTimer * 10)) * s * 0.2 : 0;
      mesh.position.set(snap.x + this.offsetX, snap.y + alt + hop, snap.z);
      const moving = snap.speed > 0.05;
      // quick little legs when it runs; pecking when it stops
      mesh.rotation.x = !moving && snap.phase === 'pausing' ? Math.max(0, Math.sin(snap.scuttlePhase * 3 + snap.x)) * 0.5 : 0;
      this.mat.setFloat('scuttlePhase', snap.flap > 0 ? snap.scuttlePhase * 4 : snap.scuttlePhase);
      this.mat.setFloat('scuttleAmp', moving ? Math.min(1.2, snap.speed * 0.6) : 0);
      this.mat.setFloat('clawWave', snap.flap > 0.02 ? 1 : 0);
      return;
    }

    // crab
    const sink = (1 - snap.emerge) * s * 0.55;
    const hop = happy ? Math.abs(Math.sin(snap.happyTimer * 8)) * s * 0.25 : 0;
    mesh.position.set(snap.x + this.offsetX, snap.y - sink + hop, snap.z);

    // Subtle body rock while scuttling or burrowing
    const moving = snap.speed > 0.05;
    const burrowing = snap.phase === 'emerging' || snap.phase === 'burrowing';
    mesh.rotation.z = moving ? Math.sin(snap.scuttlePhase) * 0.06 : burrowing ? Math.sin(snap.scuttlePhase * 1.3) * 0.14 : 0;
    mesh.rotation.x = burrowing ? (1 - snap.emerge) * 0.25 : 0;

    this.mat.setFloat('scuttlePhase', snap.scuttlePhase);
    this.mat.setFloat('scuttleAmp', moving ? Math.min(1.2, snap.speed) : burrowing ? 0.85 : 0);
    this.mat.setFloat('clawWave', happy ? 1 : snap.clawWave);
  }

  /** The octopus's ink and the turtle's tracks (each 1 draw call, only while there's something to show). */
  private updateExtras(snap: Readonly<AnimalSnapshot>, shown: AnimalSpecies | null): void {
    const inking = shown === 'octopus' && snap.ink > 0;
    if (inking && !this.ink) {
      this.ink = buildInkMesh(this.scene);
      this.ink.material = this.mat;
    }
    if (this.ink) {
      this.ink.setEnabled(inking);
      if (inking) {
        const k = snap.ink / 1.6;
        const r = (1.6 - k * 0.8) * snap.size;
        this.ink.scaling.set(r, r * 0.6, r);
        const back = 0.6 * snap.size;
        this.ink.position.set(snap.x + this.offsetX - Math.sin(snap.facing) * back, snap.y + snap.size * 0.35, snap.z - Math.cos(snap.facing) * back);
      }
    }
    const tracked = shown === 'turtle' && snap.trackCount > 0;
    if (tracked && !this.tracks) {
      this.tracks = new TrackMarks(this.scene, snap.tracks.length / 2);
      this.tracks.mesh.material = this.mat;
    }
    if (this.tracks) {
      this.tracks.mesh.setEnabled(tracked);
      if (tracked) this.tracks.update(snap.tracks, snap.trackCount, this.heightAt, this.offsetX);
    }
  }

  dispose(): void {
    for (const m of this.meshes.values()) m.dispose();
    this.treatMesh.dispose();
    this.ink?.dispose();
    this.tracks?.mesh.dispose();
    this.mat.dispose();
  }
}
