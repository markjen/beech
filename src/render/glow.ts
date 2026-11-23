import { Constants } from '@babylonjs/core/Engines/constants';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';

import { RARITY_GLOW, type RGB } from '../palette';

// Makes rare, legendary and shop things stand out on the beach: a soft glow
// on the sand around them, and a few sparkles that twinkle above (rare: sea
// blue, legendary: gold). Lamps and flames get a warm glow of their own.
// All additive, so they read by day and shine at night.

const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = viewProjection * world * vec4(position, 1.0);
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
  return m;
}

export interface GlowHandle {
  update(t: number): void;
  setEnabled(on: boolean): void;
  dispose(): void;
}

const WARM: RGB = [1, 0.72, 0.36];

export class Glow {
  private mats = new Map<string, ShaderMaterial>();
  private time = 0;

  constructor(private readonly scene: Scene) {
    if (!registered) {
      Effect.ShadersStore['beachGlowVertexShader'] = VERT;
      Effect.ShadersStore['beachGlowFragmentShader'] = FRAG;
      registered = true;
    }
  }

  private mat(key: string, col: RGB, mode: number): ShaderMaterial {
    let m = this.mats.get(key);
    if (!m) {
      m = new ShaderMaterial(`glow-${key}`, this.scene, 'beachGlow', {
        attributes: ['position', 'uv'],
        uniforms: ['world', 'viewProjection', 'col', 'time', 'mode'],
      });
      m.setColor3('col', new Color3(col[0], col[1], col[2]));
      m.setFloat('mode', mode);
      m.needAlphaBlending = () => true;
      m.alphaMode = Constants.ALPHA_ADD;
      m.disableDepthWrite = true;
      m.backFaceCulling = false;
      this.mats.set(key, m);
    }
    return m;
  }

  tick(dt: number): void {
    this.time += dt;
    for (const m of this.mats.values()) m.setFloat('time', this.time);
  }

  /**
   * Put a glow (and sparkles) on `root`. `reach` is how far the thing spreads
   * from its centre, `height` how tall it is; `lights` are lamp positions in
   * the root's space.
   */
  attach(root: Mesh, rarity: 'rare' | 'legendary' | null, reach: number, height: number, lights: Vector3[], seed: number): GlowHandle {
    const parts: Mesh[] = [];
    const sparkles: { m: Mesh; phase: number; speed: number; size: number }[] = [];
    if (rarity) {
      const col = RARITY_GLOW[rarity];
      const halo = quad(this.scene, 'halo', true);
      halo.material = this.mat(`halo-${rarity}`, col, 0);
      halo.parent = root;
      halo.position.y = 0.02;
      halo.scaling.setAll(Math.max(0.35, reach * 1.6));
      parts.push(halo);
      const n = rarity === 'legendary' ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const a = seed * 2.39996 + i * ((Math.PI * 2) / n);
        const m = quad(this.scene, 'sparkle', false);
        m.material = this.mat(`spark-${rarity}`, col, 1);
        m.billboardMode = Mesh.BILLBOARDMODE_ALL;
        m.parent = root;
        m.position.set(Math.cos(a) * reach * 0.7, height * (0.55 + 0.35 * ((i * 0.37 + seed * 0.11) % 1)), Math.sin(a) * reach * 0.7);
        const size = Math.max(0.06, Math.min(0.16, reach * 0.18));
        sparkles.push({ m, phase: (seed * 1.7 + i * 2.1) % 6.28, speed: 1.2 + ((i * 0.7 + seed) % 1) * 1.3, size });
        parts.push(m);
      }
    }
    for (const p of lights) {
      const m = quad(this.scene, 'lamp', false);
      m.material = this.mat('lamp', WARM, 2);
      m.billboardMode = Mesh.BILLBOARDMODE_ALL;
      m.parent = root;
      m.position.copyFrom(p);
      // a lighthouse lamp (high up) throws a big glow; a torch flame a small one
      m.scaling.setAll(p.y > 2 ? 1.25 : 0.45);
      parts.push(m);
    }
    return {
      update: (t: number) => {
        for (const s of sparkles) {
          // a quick glint now and then
          const tw = Math.pow(Math.max(0, Math.sin(t * s.speed + s.phase)), 10);
          s.m.scaling.setAll(Math.max(0.001, s.size * tw));
        }
      },
      setEnabled: (on) => {
        for (const p of parts) p.setEnabled(on);
      },
      dispose: () => {
        for (const p of parts) p.dispose();
      },
    };
  }

  get now(): number {
    return this.time;
  }

  dispose(): void {
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }
}
