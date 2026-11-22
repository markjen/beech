import type { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';

import { PROP_COLORS } from '../palette';
import { OBJECT_KINDS, ROCK_HEIGHT, WOOD_RADIUS, floatRadius, type ObjectKind, type ObjectState, type PlacedObject } from '../sim/objects';
import { ORIGIN_X, ORIGIN_Z, type BeachRenderer } from './beachRenderer';

/** Small deterministic random numbers from an object's variant, so a rock looks the same everywhere. */
function rng(seed: number): () => number {
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
function orient(P: number[], I: number[], core: (x: number, y: number, z: number) => [number, number, number]): void {
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

function finish(scene: Scene, name: string, P: number[], I: number[]): Mesh {
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
function shellMesh(scene: Scene, o: PlacedObject): Mesh {
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
  return finish(scene, `shell${o.id}`, P, I);
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

/** A lathe: rings of (x, radius) along the x axis, `seg` sides, capped at both ends. */
function lathe(profile: [number, number][], seg: number, squash = 1, wobble?: () => number): { P: number[]; I: number[] } {
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

interface Shown {
  mesh: Mesh;
  key: string;
  x: number;
  y: number;
  z: number;
  angle: number;
  bob: number;
  cloth?: Mesh;
}

/**
 * Draws the rocks and driftwood on one beach. Positions come from the
 * simulation at 30 Hz; the meshes ease toward them every rendered frame so
 * floating wood moves smoothly, and bob a little while afloat.
 */
export class ObjectView {
  private readonly shown = new Map<number, Shown>();
  private readonly mats: Record<ObjectKind, ShaderMaterial[]>;
  private readonly poleMat: ShaderMaterial;
  private target = new Map<number, ObjectState>();
  private time = 0;
  private hidden = false;

  constructor(
    private readonly scene: Scene,
    renderer: BeachRenderer,
    private readonly offsetX = 0,
  ) {
    this.mats = Object.fromEntries(
      OBJECT_KINDS.map((k) => [k, PROP_COLORS[k].map((c) => renderer.createPropMaterial(c))]),
    ) as Record<ObjectKind, ShaderMaterial[]>;
    this.poleMat = renderer.createPropMaterial(PROP_COLORS.pole);
  }

  get count(): number {
    return this.shown.size;
  }

  /** The latest positions from the simulation. */
  set(states: ObjectState[]): void {
    this.target = new Map(states.map((s) => [s.id, s]));
    for (const [id, s] of this.shown) {
      if (!this.target.has(id)) {
        s.mesh.dispose();
        this.shown.delete(id);
      }
    }
    for (const st of states) {
      const key = `${st.kind}:${st.variant}:${st.size}`;
      const cur = this.shown.get(st.id);
      if (cur && cur.key === key) continue;
      cur?.mesh.dispose();
      const set = this.mats[st.kind];
      const mat = set[st.variant % set.length];
      let mesh: Mesh;
      let cloth: Mesh | undefined;
      if (st.kind === 'flag') {
        const f = flagMesh(this.scene, st);
        mesh = f.pole;
        cloth = f.cloth;
        mesh.material = this.poleMat;
        cloth.material = mat;
      } else if (st.kind === 'bottle') {
        const bt = bottleMesh(this.scene, st);
        mesh = bt.body;
        mesh.material = mat;
        bt.cork.material = this.poleMat;
      } else {
        mesh =
          st.kind === 'rock' ? rockMesh(this.scene, st)
          : st.kind === 'driftwood' ? woodMesh(this.scene, st)
          : st.kind === 'shell' ? shellMesh(this.scene, st)
          : st.kind === 'conch' ? conchMesh(this.scene, st)
          : st.kind === 'sanddollar' ? sanddollarMesh(this.scene, st)
          : st.kind === 'starfish' ? starfishMesh(this.scene, st)
          : glassMesh(this.scene, st);
        mesh.material = mat;
      }
      this.shown.set(st.id, { mesh, key, x: st.x, y: st.y, z: st.z, angle: st.angle, bob: Math.random() * 6, cloth });
      if (this.hidden) mesh.setEnabled(false);
      this.place(this.shown.get(st.id)!, st, 0);
    }
  }

  /** Static objects (a neighbor's beach): heights from their sand. */
  setStatic(objects: PlacedObject[], heightAt: (x: number, y: number) => number): void {
    this.set(
      objects.map((o) => ({
        ...o,
        z: heightAt(o.x, o.y) + (o.kind === 'driftwood' || o.kind === 'bottle' ? floatRadius(o) * 0.7 : 0),
        floating: false,
      })),
    );
  }

  update(dt: number): void {
    this.time += dt;
    const ease = 1 - Math.exp(-dt * 12);
    for (const [id, s] of this.shown) {
      const t = this.target.get(id);
      if (t) this.place(s, t, ease);
    }
  }

  private place(s: Shown, t: ObjectState, ease: number): void {
    const k = ease === 0 ? 1 : ease;
    s.x += (t.x - s.x) * k;
    s.y += (t.y - s.y) * k;
    s.z += (t.z - s.z) * k;
    let da = t.angle - s.angle;
    da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
    s.angle += da * k;
    const m = s.mesh;
    const bob = t.floating ? Math.sin(this.time * 1.7 + s.bob) * 0.015 : 0;
    // a conch lies on its side: lift its axis off the sand
    const lift = t.kind === 'conch' ? t.size * 0.24 : 0;
    m.position.set(s.x + ORIGIN_X + this.offsetX, s.z + bob + lift, s.y + ORIGIN_Z);
    // sim angles turn x toward y (world z); Babylon's yaw turns x away from z
    m.rotation.y = -s.angle;
    m.rotation.x = t.floating && (t.kind === 'driftwood' || t.kind === 'bottle') ? Math.sin(this.time * 1.3 + s.bob) * 0.06 : 0;
    // the flag always points downwind (the sea breeze blows inland), fluttering
    if (s.cloth) {
      m.rotation.y = -Math.PI / 2;
      s.cloth.rotation.y = Math.sin(this.time * 3.1 + s.bob) * 0.35 + Math.sin(this.time * 7.3 + s.bob) * 0.1;
    }
  }

  setVisible(on: boolean): void {
    for (const s of this.shown.values()) s.mesh.setEnabled(on);
    this.hidden = !on;
  }

  clear(): void {
    for (const s of this.shown.values()) s.mesh.dispose();
    this.shown.clear();
    this.target.clear();
  }

  dispose(): void {
    this.clear();
    for (const set of Object.values(this.mats)) for (const m of set) m.dispose();
    this.poleMat.dispose();
  }
}

const frac = (x: number) => x - Math.floor(x);
