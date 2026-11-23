import { Constants } from '@babylonjs/core/Engines/constants';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';

import { RARITY_GLOW, type RGB } from '../palette';

// Makes rare, legendary and shop things stand out on the beach: a soft glow
// on the sand around them, and a few sparkles that twinkle above (rare: sea
// blue, legendary: gold). Lamps and flames get a warm glow of their own.
// All additive, so they read by day and shine at night.
//
// Every glow on every beach is a GPU thin instance of one quad per material
// (a handful of draw calls in all). Sparkles and lamps face the camera and
// sparkles twinkle in the vertex shader, so nothing is animated per glow in
// JavaScript. Per instance: a matrix (where, and the halo's size) and
// `glowData` = (phase, speed, size, 0).

const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
#include<instancesDeclaration>
#ifdef INSTANCES
attribute vec4 glowData;
#endif
uniform mat4 viewProjection;
uniform vec3 camRight;
uniform vec3 camUp;
uniform float time;
uniform float mode;
varying vec2 vUv;
void main() {
  #include<instancesVertex>
  vUv = uv;
#ifdef INSTANCES
  vec4 g = glowData;
#else
  vec4 g = vec4(0.0, 0.0, 1.0, 0.0);
#endif
  vec3 wp;
  if (mode < 0.5) {
    // a glow lying on the sand (flat quad, sized by its matrix)
    wp = (finalWorld * vec4(position, 1.0)).xyz;
  } else {
    // sparkles and lamps face the camera; sparkles glint now and then
    float s = g.z;
    if (mode < 1.5) s *= pow(max(0.0, sin(time * g.y + g.x)), 10.0);
    wp = finalWorld[3].xyz + (camRight * position.x + camUp * position.y) * s;
  }
  gl_Position = viewProjection * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 col;
uniform float time;
/** 0: a glow on the sand, 1: a four-pointed sparkle, 2: a lamp's soft glow */
uniform float mode;
void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float r = length(d);
  float a;
  if (mode < 0.5) {
    a = smoothstep(1.0, 0.25, r) * (0.42 + 0.12 * sin(time * 1.6));
  } else if (mode < 1.5) {
    float star = max(0.0, 1.0 - abs(d.x) * 7.0) * max(0.0, 1.0 - abs(d.y) * 1.1)
               + max(0.0, 1.0 - abs(d.y) * 7.0) * max(0.0, 1.0 - abs(d.x) * 1.1);
    a = clamp(star + pow(max(0.0, 1.0 - r), 4.0), 0.0, 1.0);
  } else {
    a = pow(max(0.0, 1.0 - r), 2.2) * (0.8 + 0.2 * sin(time * 9.0) * sin(time * 5.3));
  }
  gl_FragColor = vec4(col * a, a);
}
`;

let registered = false;

function quad(scene: Scene, name: string, flat: boolean): Mesh {
  const vd = new VertexData();
  vd.positions = flat ? [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1] : [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
  vd.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  vd.indices = [0, 2, 1, 0, 3, 2];
  const m = new Mesh(name, scene);
  vd.applyToMesh(m);
  m.isPickable = false;
  m.alwaysSelectAsActiveMesh = true;
  m.doNotSyncBoundingInfo = true;
  m.freezeWorldMatrix();
  return m;
}

export interface GlowHandle {
  /** where the thing is (world position of its base) and which way it faces */
  setPose(pos: Vector3, yaw: number): void;
  setEnabled(on: boolean): void;
  dispose(): void;
}

const WARM: RGB = [1, 0.72, 0.36];

/** One material's quad and its instances. */
class Layer {
  mesh: Mesh;
  mat: ShaderMaterial;
  mats = new Float32Array(16 * 8);
  data = new Float32Array(4 * 8);
  slots: Spot[] = [];
  count = 0;
  dirty = false;
  resized = true;

  constructor(scene: Scene, key: string, col: RGB, readonly mode: number) {
    this.mesh = quad(scene, `glow-${key}`, mode === 0);
    this.mat = new ShaderMaterial(`glow-${key}`, scene, 'beachGlow', {
      attributes: ['position', 'uv', 'glowData'],
      uniforms: ['world', 'viewProjection', 'col', 'time', 'mode', 'camRight', 'camUp'],
    });
    this.mat.setColor3('col', new Color3(col[0], col[1], col[2]));
    this.mat.setFloat('mode', mode);
    this.mat.needAlphaBlending = () => true;
    this.mat.alphaMode = Constants.ALPHA_ADD;
    this.mat.disableDepthWrite = true;
    this.mat.backFaceCulling = false;
    this.mesh.material = this.mat;
    this.mesh.setEnabled(false);
  }

  add(s: Spot): void {
    if (s.slot >= 0) return;
    if ((this.count + 1) * 16 > this.mats.length) {
      const m = new Float32Array(this.mats.length * 2);
      m.set(this.mats);
      this.mats = m;
      const d = new Float32Array(this.data.length * 2);
      d.set(this.data);
      this.data = d;
      this.resized = true;
    }
    s.slot = this.count;
    this.slots[this.count++] = s;
    this.data.set(s.data, s.slot * 4);
    this.dirty = true;
  }

  remove(s: Spot): void {
    if (s.slot < 0) return;
    const last = --this.count;
    if (s.slot !== last) {
      const moved = this.slots[last];
      this.mats.copyWithin(s.slot * 16, last * 16, last * 16 + 16);
      this.data.copyWithin(s.slot * 4, last * 4, last * 4 + 4);
      moved.slot = s.slot;
      this.slots[s.slot] = moved;
    }
    this.slots.length = this.count;
    s.slot = -1;
    this.dirty = true;
  }

  write(s: Spot, m: Matrix): void {
    if (s.slot < 0) return;
    m.copyToArray(this.mats, s.slot * 16);
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.resized) {
      this.resized = false;
      this.mesh.thinInstanceSetBuffer('matrix', this.mats, 16, false);
      this.mesh.thinInstanceSetBuffer('glowData', this.data, 4, false);
    } else {
      this.mesh.thinInstanceBufferUpdated('matrix');
      this.mesh.thinInstanceBufferUpdated('glowData');
    }
    this.mesh.thinInstanceCount = this.count;
    this.mesh.setEnabled(this.count > 0);
  }
}

/** One quad of one glow: its layer, its offset from the thing's base, its size. */
interface Spot {
  layer: Layer;
  slot: number;
  /** offset in the thing's own space (turns with it) */
  offset: Vector3;
  /** halo: its radius (the matrix scales the flat quad); others: 1 */
  scale: number;
  data: Float32Array;
}

const tmpM = new Matrix();
const camRight = new Vector3(1, 0, 0);
const camUp = new Vector3(0, 1, 0);

export class Glow {
  private layers = new Map<string, Layer>();
  private time = 0;

  constructor(private readonly scene: Scene) {
    if (!registered) {
      Effect.ShadersStore['beachGlowVertexShader'] = VERT;
      Effect.ShadersStore['beachGlowFragmentShader'] = FRAG;
      registered = true;
    }
    // the camera's right and up, for the billboards; one upload per changed layer
    scene.onBeforeRenderObservable.add(() => {
      const cam = scene.activeCamera;
      if (cam) {
        // (setVector3 keeps the vector itself: one for each, updated in place)
        const v = cam.getViewMatrix().m;
        camRight.set(v[0], v[4], v[8]);
        camUp.set(v[1], v[5], v[9]);
        for (const l of this.layers.values()) {
          if (!l.count) continue;
          l.mat.setVector3('camRight', camRight);
          l.mat.setVector3('camUp', camUp);
        }
      }
      for (const l of this.layers.values()) l.flush();
    });
  }

  private layer(key: string, col: RGB, mode: number): Layer {
    let l = this.layers.get(key);
    if (!l) {
      l = new Layer(this.scene, key, col, mode);
      this.layers.set(key, l);
    }
    return l;
  }

  tick(dt: number): void {
    this.time += dt;
    for (const l of this.layers.values()) if (l.count) l.mat.setFloat('time', this.time);
  }

  /**
   * A glow (and sparkles) for one thing. `reach` is how far the thing spreads
   * from its centre, `height` how tall it is; `lights` are lamp positions in
   * the thing's own space.
   */
  attach(rarity: 'rare' | 'legendary' | 'unique' | null, reach: number, height: number, lights: Vector3[], seed: number): GlowHandle {
    const spots: Spot[] = [];
    const spot = (layer: Layer, offset: Vector3, scale: number, phase: number, speed: number, size: number) => {
      const s: Spot = { layer, slot: -1, offset, scale, data: new Float32Array([phase, speed, size, 0]) };
      spots.push(s);
      layer.add(s);
    };
    if (rarity) {
      const col = RARITY_GLOW[rarity];
      spot(this.layer(`halo-${rarity}`, col, 0), new Vector3(0, 0.02, 0), Math.max(0.35, reach * 1.6), 0, 0, 1);
      const n = rarity === 'legendary' ? 4 : 3;
      const sparks = this.layer(`spark-${rarity}`, col, 1);
      for (let i = 0; i < n; i++) {
        const a = seed * 2.39996 + i * ((Math.PI * 2) / n);
        const off = new Vector3(Math.cos(a) * reach * 0.7, height * (0.55 + 0.35 * ((i * 0.37 + seed * 0.11) % 1)), Math.sin(a) * reach * 0.7);
        const size = Math.max(0.06, Math.min(0.16, reach * 0.18));
        spot(sparks, off, 1, (seed * 1.7 + i * 2.1) % 6.28, 1.2 + ((i * 0.7 + seed) % 1) * 1.3, size);
      }
    }
    const lamps = lights.length ? this.layer('lamp', WARM, 2) : null;
    // a lighthouse lamp (high up) throws a big glow; a torch flame a small one
    for (const p of lights) spot(lamps!, p.clone(), 1, 0, 0, p.y > 2 ? 1.25 : 0.45);
    return {
      setPose: (pos, yaw) => {
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        for (const s of spots) {
          // the offset turns with the thing (Babylon yaw: x toward -z)
          const ox = s.offset.x * c + s.offset.z * sn;
          const oz = -s.offset.x * sn + s.offset.z * c;
          Matrix.ScalingToRef(s.scale, s.scale, s.scale, tmpM);
          tmpM.setTranslationFromFloats(pos.x + ox, pos.y + s.offset.y, pos.z + oz);
          s.layer.write(s, tmpM);
        }
      },
      setEnabled: (on) => {
        for (const s of spots) {
          if (on) s.layer.add(s);
          else s.layer.remove(s);
        }
      },
      dispose: () => {
        for (const s of spots) s.layer.remove(s);
      },
    };
  }

  get now(): number {
    return this.time;
  }

  /** draw calls the glows take now (profiling) */
  get drawn(): number {
    let n = 0;
    for (const l of this.layers.values()) if (l.count) n++;
    return n;
  }

  dispose(): void {
    for (const l of this.layers.values()) {
      l.mesh.dispose();
      l.mat.dispose();
    }
    this.layers.clear();
  }
}
