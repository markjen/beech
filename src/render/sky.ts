import { Constants } from '@babylonjs/core/Engines/constants';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';

import { rgbToCss, WEATHER_COLORS, type Palette } from '../palette';

const SKY_VERT = `
precision highp float;
attribute vec3 position;
varying vec2 vUv;
void main() {
  vUv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const SKY_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D skyTex;
void main() {
  gl_FragColor = texture2D(skyTex, vUv);
}`;

/** Where to draw a sun or moon on the backdrop (fractions of the screen). */
export interface SkyDisc {
  x: number;
  y: number;
  alpha: number;
}

export interface SkyScene {
  sun?: SkyDisc;
  moon?: SkyDisc & { phase: number; fraction: number };
  /** 0..1 star visibility */
  stars: number;
  /** real weather: cloud puffs (0..1), how grey (0..1) and how far they've drifted (screen widths) */
  clouds?: { amount: number; overcast: number; drift: number };
}

/** Cloud puffs: [x 0..1, height 0..1 from the top, size, seed]. */
const CLOUDS: [number, number, number, number][] = [];
{
  let seed = 19;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) CLOUDS.push([rnd(), 0.06 + Math.pow(rnd(), 1.3) * 0.42, 0.6 + rnd() * 0.8, rnd()]);
}

const STARS: [number, number, number][] = [];
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 140; i++) STARS.push([rnd(), Math.pow(rnd(), 1.6) * 0.62, 0.4 + rnd() * 0.6]);
}

/**
 * Full-screen backdrop: palette gradient, stars at night, and the real sun
 * and moon (with its phase) where they would sit over the sea. Redrawn only
 * when something visible changes.
 */
export class Sky {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly mat: ShaderMaterial;
  private tex: RawTexture;
  private lastKey = '';
  private w = 4;
  private h = 256;

  constructor(private readonly scene: Scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;

    Effect.ShadersStore['beechSkyVertexShader'] = SKY_VERT;
    Effect.ShadersStore['beechSkyFragmentShader'] = SKY_FRAG;

    this.tex = this.makeTex(this.w, this.h);
    this.mat = new ShaderMaterial(
      'skyMat',
      scene,
      { vertex: 'beechSky', fragment: 'beechSky' },
      { attributes: ['position'], uniforms: [], samplers: ['skyTex'], needAlphaBlending: false },
    );
    this.mat.backFaceCulling = false;
    this.mat.disableDepthWrite = true;
    this.mat.depthFunction = Constants.LEQUAL;
    this.mat.setTexture('skyTex', this.tex);

    const mesh = new Mesh('sky', scene);
    const vd = new VertexData();
    vd.positions = [-1, -1, 0, 3, -1, 0, -1, 3, 0];
    vd.indices = [0, 1, 2];
    vd.applyToMesh(mesh);
    mesh.material = this.mat;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
  }

  private makeTex(w: number, h: number): RawTexture {
    const tex = RawTexture.CreateRGBATexture(
      new Uint8Array(w * h * 4),
      w,
      h,
      this.scene,
      false,
      false,
      Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
    );
    tex.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    tex.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    return tex;
  }

  private ensureSize(aspect: number): void {
    const h = 320;
    const w = Math.max(64, Math.round(h * aspect));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.tex.dispose();
    this.tex = this.makeTex(w, h);
    this.mat.setTexture('skyTex', this.tex);
    this.lastKey = '';
  }

  update(p: Palette, sky: SkyScene = { stars: 0 }, aspect = 1): void {
    this.ensureSize(aspect);
    const r = (v: number) => Math.round(v * 200) / 200;
    const key = [
      rgbToCss(p.skyTop),
      rgbToCss(p.skyBottom),
      rgbToCss(p.fog),
      r(sky.stars),
      sky.sun ? [r(sky.sun.x), r(sky.sun.y), r(sky.sun.alpha)].join() : '',
      sky.moon ? [r(sky.moon.x), r(sky.moon.y), r(sky.moon.alpha), r(sky.moon.phase)].join() : '',
      // drift in whole texture pixels, so drifting clouds redraw only now and then
      sky.clouds && sky.clouds.amount > 0.02
        ? [r(sky.clouds.amount), r(sky.clouds.overcast), Math.round(sky.clouds.drift * this.w)].join()
        : '',
    ].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    const { w, h, ctx } = this;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgbToCss(p.skyTop));
    g.addColorStop(0.55, rgbToCss(p.skyBottom));
    g.addColorStop(1, rgbToCss(p.fog));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (sky.stars > 0.01) {
      for (const [sx, sy, b] of STARS) {
        ctx.fillStyle = `rgba(255,255,245,${(sky.stars * b * 0.85).toFixed(3)})`;
        const size = b > 0.9 ? 1.6 : 1.1;
        ctx.fillRect(sx * w, sy * h, size, size);
      }
    }

    const unit = h / 320;
    if (sky.sun && sky.sun.alpha > 0.01) {
      const { x, y, alpha } = sky.sun;
      const cx = x * w;
      const cy = y * h;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 70 * unit);
      glow.addColorStop(0, `rgba(255,246,220,${0.55 * alpha})`);
      glow.addColorStop(1, 'rgba(255,246,220,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - 80 * unit, cy - 80 * unit, 160 * unit, 160 * unit);
      ctx.fillStyle = `rgba(255,250,236,${0.95 * alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 13 * unit, 0, Math.PI * 2);
      ctx.fill();
    }

    if (sky.moon && sky.moon.alpha > 0.01) {
      const { x, y, alpha, phase } = sky.moon;
      const cx = x * w;
      const cy = y * h;
      const rad = 9 * unit;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40 * unit);
      glow.addColorStop(0, `rgba(230,236,255,${0.3 * alpha * sky.moon.fraction})`);
      glow.addColorStop(1, 'rgba(230,236,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - 45 * unit, cy - 45 * unit, 90 * unit, 90 * unit);
      // lit part: a half disc plus an ellipse whose width follows the phase
      ctx.fillStyle = `rgba(244,246,255,${0.95 * alpha})`;
      const waxing = phase < 0.5;
      const k = Math.cos(phase * 2 * Math.PI); // 1 new, -1 full
      ctx.beginPath();
      ctx.arc(cx, cy, rad, -Math.PI / 2, Math.PI / 2, !waxing);
      ctx.ellipse(cx, cy, Math.abs(k) * rad, rad, 0, Math.PI / 2, -Math.PI / 2, k > 0 ? waxing : !waxing);
      ctx.fill();
      // faint earthshine on the dark side
      ctx.fillStyle = `rgba(200,210,240,${0.12 * alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    if (sky.clouds && sky.clouds.amount > 0.02) this.drawClouds(ctx, sky.clouds, unit);
    this.tex.update(ctx.getImageData(0, 0, w, h).data);
  }

  /** Soft puffs drifting with the wind; greyer and flatter as the sky closes over. */
  private drawClouds(ctx: CanvasRenderingContext2D, c: NonNullable<SkyScene['clouds']>, unit: number): void {
    const { w, h } = this;
    const n = Math.round(CLOUDS.length * Math.min(1, c.amount));
    const light = rgbToCss(WEATHER_COLORS.cloud);
    const shade = rgbToCss(WEATHER_COLORS.cloudShade);
    const span = w + 240 * unit;
    for (let i = 0; i < n; i++) {
      const [px, py, size, sd] = CLOUDS[i];
      const x = ((((px + c.drift * (0.6 + 0.4 * sd)) % 1) + 1) % 1) * span - 120 * unit;
      const y = py * h;
      const rx = 46 * unit * size * (1 + c.overcast * 0.6);
      const ry = rx * (0.36 - 0.1 * c.overcast);
      ctx.globalAlpha = (0.42 + 0.3 * sd) * Math.min(1, c.amount * 1.4) * (1 - 0.6 * c.overcast);
      ctx.fillStyle = c.overcast > 0.5 ? shade : light;
      for (let k = 0; k < 4; k++) {
        const ox = (k - 1.5) * rx * 0.5;
        const oy = -Math.abs(k - 1.5) * ry * -0.25 - (k === 1 || k === 2 ? ry * 0.35 : 0);
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, rx * 0.55, ry * (k === 1 || k === 2 ? 1.1 : 0.8), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
