import '@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration';
import '@babylonjs/core/Shaders/ShadersInclude/instancesVertex';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector2, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';

import { WAVES, WORLD_SIZE_X, WORLD_SIZE_Z, type GridSpec } from '../config';
import type { Palette, RGB } from '../palette';
import { swellEnvelope, type Swell } from '../sim/waves';
import * as S from './shaders';

const c3 = (c: RGB) => new Color3(c[0], c[1], c[2]);

/** World X of the left edge / world Z of the offshore edge. */
export const ORIGIN_X = -WORLD_SIZE_X / 2;
export const ORIGIN_Z = -WORLD_SIZE_Z / 2;
const SLAB_BOTTOM = -2.6;

interface LitMaterial {
  mat: ShaderMaterial;
}

/**
 * Owns every mesh/material that draws the beach. The simulation fields arrive
 * as packed RGBA float frames; we keep the previous and current frame and blend
 * between them in the vertex shaders so 30 Hz sim updates look smooth at 60 fps.
 */
export class BeachRenderer {
  readonly grid: GridSpec;
  private texPrev: RawTexture;
  private texCur: RawTexture;
  private restTex: RawTexture;
  private frameMix = 1;
  private readonly lit: LitMaterial[] = [];
  readonly sandMat: ShaderMaterial;
  readonly waterMat: ShaderMaterial;
  readonly oceanMat: ShaderMaterial;
  private readonly skirtMat: ShaderMaterial;
  private readonly waterSkirtMat: ShaderMaterial;
  private readonly rockMat: ShaderMaterial;
  readonly meshes: Mesh[] = [];
  private apronMesh!: Mesh;
  private waterSkirt!: Mesh;
  private brush = new Vector4(0, 0, 0.3, 0);

  constructor(
    private readonly scene: Scene,
    grid: GridSpec,
    rest: Float32Array,
    private readonly swell: Swell,
    /** world X offset of this slab (neighbors sit either side of the player's beach) */
    readonly offsetX = 0,
  ) {
    this.grid = grid;
    const { nx, ny } = grid;
    const empty = new Float32Array(nx * ny * 4);
    this.texPrev = this.makeFieldTexture(empty, 'fieldA');
    this.texCur = this.makeFieldTexture(empty, 'fieldB');
    const restPacked = new Float32Array(nx * ny * 4);
    for (let k = 0; k < nx * ny; k++) restPacked[k * 4] = rest[k];
    this.restTex = this.makeFieldTexture(restPacked, 'rest');

    Effect.ShadersStore['beachSandVertexShader'] = S.sandVertex;
    Effect.ShadersStore['beachSandFragmentShader'] = S.sandFragment;
    Effect.ShadersStore['beachWaterVertexShader'] = S.waterVertex;
    Effect.ShadersStore['beachWaterFragmentShader'] = S.waterFragment;
    Effect.ShadersStore['beachOceanVertexShader'] = S.oceanVertex;
    Effect.ShadersStore['beachOceanFragmentShader'] = S.oceanFragment;
    Effect.ShadersStore['beachSkirtVertexShader'] = S.skirtVertex;
    Effect.ShadersStore['beachSkirtFragmentShader'] = S.skirtFragment;
    Effect.ShadersStore['beachFlatVertexShader'] = S.flatVertex;
    Effect.ShadersStore['beachFlatFragmentShader'] = S.flatFragment;

    const light = ['sunDir', 'sunCol', 'ambCol', 'shadowCol', 'cameraDir'];
    const field = ['frameMix', 'gridSize'];
    const fieldSamplers = ['fieldPrev', 'fieldCur'];

    this.sandMat = this.material('beachSand', {
      attributes: ['position', 'uv'],
      uniforms: [...light, ...field, 'sandDry', 'sandWet', 'sandDeep', 'brush', 'brushCol', 'cellSize'],
      samplers: [...fieldSamplers, 'restTex'],
    });
    this.sandMat.setTexture('restTex', this.restTex);
    this.sandMat.setFloat('cellSize', grid.dx);
    this.sandMat.backFaceCulling = false;

    this.waterMat = this.material('beachWater', {
      attributes: ['position', 'uv'],
      uniforms: [...light, ...field, 'shallowCol', 'deepCol', 'foamCol', 'time'],
      samplers: fieldSamplers,
    });
    this.makeTransparent(this.waterMat);

    this.oceanMat = this.material('beachOcean', {
      attributes: ['position'],
      uniforms: [
        ...light,
        'swellA',
        'swellW',
        'swellP',
        'swellK',
        'swellEnv',
        'simTime',
        'tide',
        'zEdge',
        'waveSpeed',
        'oceanCol',
        'deepCol',
        'foamCol',
        'fogCol',
        'halfX',
        'centerX',
        'fadeNear',
        'fadeFar',
        'apron',
        'slabRange',
        'slabHalf',
      ],
      samplers: [],
    });
    this.makeTransparent(this.oceanMat);

    this.skirtMat = this.material('beachSkirt', {
      attributes: ['position', 'normal', 'uv'],
      uniforms: [
        ...light,
        ...field,
        'bottomY',
        'isWater',
        'sandDry',
        'sandWet',
        'strataA',
        'strataB',
        'rock',
        'shallowCol',
        'deepCol',
      ],
      samplers: fieldSamplers,
    });
    this.skirtMat.setFloat('bottomY', SLAB_BOTTOM);
    this.skirtMat.setFloat('isWater', 0);
    this.skirtMat.backFaceCulling = false;

    this.waterSkirtMat = this.material('beachSkirt', {
      attributes: ['position', 'normal', 'uv'],
      uniforms: [
        ...light,
        ...field,
        'bottomY',
        'isWater',
        'sandDry',
        'sandWet',
        'strataA',
        'strataB',
        'rock',
        'shallowCol',
        'deepCol',
      ],
      samplers: fieldSamplers,
    });
    this.waterSkirtMat.setFloat('bottomY', SLAB_BOTTOM);
    this.waterSkirtMat.setFloat('isWater', 1);
    this.waterSkirtMat.backFaceCulling = false;
    this.makeTransparent(this.waterSkirtMat);

    this.rockMat = this.material('beachFlat', {
      attributes: ['position', 'normal'],
      uniforms: [...light, 'baseCol', 'fogCol', 'fadeTop', 'fadeBottom'],
      samplers: [],
    });
    this.rockMat.backFaceCulling = false;
    this.rockMat.setFloat('fadeTop', -2.8);
    this.rockMat.setFloat('fadeBottom', -7.5);

    this.buildMeshes();
    this.bindFieldTextures();
  }

  /** A flat-shaded lit material with a fixed colour (props such as shells). */
  createPropMaterial(color: RGB): ShaderMaterial {
    const m = this.material('beachFlat', {
      attributes: ['position', 'normal'],
      uniforms: ['sunDir', 'sunCol', 'ambCol', 'shadowCol', 'cameraDir', 'baseCol', 'fogCol', 'fadeTop', 'fadeBottom'],
      samplers: [],
    });
    m.setColor3('baseCol', c3(color));
    m.setColor3('fogCol', c3(color));
    m.setFloat('fadeTop', -40);
    m.setFloat('fadeBottom', -50);
    m.backFaceCulling = false;
    return m;
  }

  private makeFieldTexture(data: Float32Array, name: string): RawTexture {
    const t = new RawTexture(
      data,
      this.grid.nx,
      this.grid.ny,
      Constants.TEXTUREFORMAT_RGBA,
      this.scene,
      false,
      false,
      Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      Constants.TEXTURETYPE_FLOAT,
    );
    t.name = name;
    t.wrapU = Texture.CLAMP_ADDRESSMODE;
    t.wrapV = Texture.CLAMP_ADDRESSMODE;
    return t;
  }

  private material(
    shader: string,
    opts: { attributes: string[]; uniforms: string[]; samplers: string[] },
  ): ShaderMaterial {
    const mat = new ShaderMaterial(shader, this.scene, shader, {
      attributes: opts.attributes,
      uniforms: ['world', 'viewProjection', ...opts.uniforms],
      samplers: opts.samplers,
    });
    this.lit.push({ mat });
    return mat;
  }

  private makeTransparent(mat: ShaderMaterial) {
    mat.needAlphaBlending = () => true;
    mat.alphaMode = Constants.ALPHA_COMBINE;
    mat.backFaceCulling = false;
  }

  // ---------------------------------------------------------------- meshes

  private gridMesh(name: string): Mesh {
    const { nx, ny, dx } = this.grid;
    const positions = new Float32Array(nx * ny * 3);
    const uvs = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        positions[k * 3] = ORIGIN_X + (i + 0.5) * dx;
        positions[k * 3 + 1] = 0;
        positions[k * 3 + 2] = ORIGIN_Z + (j + 0.5) * dx;
        uvs[k * 2] = (i + 0.5) / nx;
        uvs[k * 2 + 1] = (j + 0.5) / ny;
      }
    }
    const indices = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let o = 0;
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        // alternate the diagonal for a less directional facet pattern
        if ((i + j) & 1) {
          indices.set([a, c, b, b, c, d], o);
        } else {
          indices.set([a, c, d, a, d, b], o);
        }
        o += 6;
      }
    }
    const vd = new VertexData();
    vd.positions = positions;
    vd.uvs = uvs;
    vd.indices = indices;
    const mesh = new Mesh(name, this.scene);
    vd.applyToMesh(mesh, false);
    return mesh;
  }

  /** Vertical strip along the slab edges: one top + one bottom vertex per edge cell. */
  private skirtMesh(name: string, edges: ('left' | 'right' | 'front' | 'back')[]): Mesh {
    const { nx, ny, dx } = this.grid;
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const addEdge = (cells: [number, number][], normal: [number, number, number]) => {
      const base = pos.length / 3;
      for (const [i, j] of cells) {
        const x = ORIGIN_X + (i + 0.5) * dx;
        const z = ORIGIN_Z + (j + 0.5) * dx;
        const u = (i + 0.5) / nx;
        const v = (j + 0.5) / ny;
        pos.push(x, 1, z, x, 0, z);
        nrm.push(...normal, ...normal);
        uv.push(u, v, u, v);
      }
      for (let s = 0; s < cells.length - 1; s++) {
        const t0 = base + s * 2;
        idx.push(t0, t0 + 1, t0 + 2, t0 + 2, t0 + 1, t0 + 3);
      }
    };
    const range = (n: number) => Array.from({ length: n }, (_, q) => q);
    for (const e of edges) {
      if (e === 'left') addEdge(range(ny).map((j) => [0, j]), [-1, 0, 0]);
      if (e === 'right') addEdge(range(ny).map((j) => [nx - 1, j]), [1, 0, 0]);
      if (e === 'front') addEdge(range(nx).map((i) => [i, 0]), [0, 0, -1]);
      if (e === 'back') addEdge(range(nx).map((i) => [i, ny - 1]), [0, 0, 1]);
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.normals = nrm;
    vd.uvs = uv;
    vd.indices = idx;
    const mesh = new Mesh(name, this.scene);
    vd.applyToMesh(mesh, false);
    return mesh;
  }

  private planeMesh(name: string, x0: number, x1: number, z0: number, z1: number, sx: number, sz: number): Mesh {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= sz; j++) {
      // denser rows near the slab, sparser toward the horizon
      const tz = Math.pow(j / sz, 1.6);
      const z = z1 + (z0 - z1) * tz;
      for (let i = 0; i <= sx; i++) pos.push(x0 + ((x1 - x0) * i) / sx, 0, z);
    }
    for (let j = 0; j < sz; j++) {
      for (let i = 0; i < sx; i++) {
        const a = j * (sx + 1) + i;
        const b = a + 1;
        const c = a + sx + 1;
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    const mesh = new Mesh(name, this.scene);
    vd.applyToMesh(mesh, false);
    return mesh;
  }

  private box(name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Mesh {
    // flat-shaded box with per-face normals (no top: always covered)
    const P: number[] = [];
    const N: number[] = [];
    const I: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
      const o = P.length / 3;
      P.push(...a, ...b, ...c, ...d);
      N.push(...n, ...n, ...n, ...n);
      I.push(o, o + 1, o + 2, o, o + 2, o + 3);
    };
    quad([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [0, 0, -1]);
    quad([x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [0, 0, 1]);
    quad([x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [-1, 0, 0]);
    quad([x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [1, 0, 0]);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
    const vd = new VertexData();
    vd.positions = P;
    vd.normals = N;
    vd.indices = I;
    const m = new Mesh(name, this.scene);
    vd.applyToMesh(m, false);
    return m;
  }

  private buildMeshes(): void {
    const hx = WORLD_SIZE_X / 2;
    const hz = WORLD_SIZE_Z / 2;

    const sand = this.gridMesh('sand');
    sand.material = this.sandMat;

    const water = this.gridMesh('water');
    water.material = this.waterMat;
    water.alphaIndex = 2;

    const skirt = this.skirtMesh('skirt', ['left', 'right', 'front', 'back']);
    skirt.material = this.skirtMat;

    const wskirt = this.skirtMesh('waterSkirt', ['left', 'right']);
    wskirt.material = this.waterSkirtMat;
    wskirt.alphaIndex = 3;

    // overlap the simulated water by one cell so no hairline crack shows at the seam
    const edgeZ = ORIGIN_Z + this.grid.dx * 1.5;
    const ocean = this.planeMesh('ocean', -hx + this.grid.dx * 0.5, hx - this.grid.dx * 0.5, edgeZ - 34, edgeZ, 96, 48);
    ocean.material = this.oceanMat;
    ocean.alphaIndex = 1;
    this.oceanMat.setFloat('zEdge', edgeZ);
    this.oceanMat.setFloat('halfX', hx);
    this.oceanMat.setFloat('centerX', this.offsetX);
    this.oceanMat.setFloat('fadeNear', 2);
    this.oceanMat.setFloat('fadeFar', 17);
    this.oceanMat.setFloat('apron', 1);
    this.oceanMat.setVector3('slabRange', new Vector3(0, 0, 1e6));
    this.oceanMat.setFloat('slabHalf', 0);
    this.apronMesh = ocean;
    this.waterSkirt = wskirt;
    this.oceanMat.setFloat('waveSpeed', WAVES.farSpeed);

    // stepped rock base under the slab: the floating-diorama look
    const rocks = [
      this.box('rock0', -hx, hx, SLAB_BOTTOM - 0.9, SLAB_BOTTOM + 0.01, -hz, hz),
      this.box('rock1', -hx + 1.6, hx - 1.6, SLAB_BOTTOM - 2.0, SLAB_BOTTOM - 0.9, -hz + 1.6, hz - 1.6),
      this.box('rock2', -hx + 4.5, hx - 4.5, SLAB_BOTTOM - 3.4, SLAB_BOTTOM - 2.0, -hz + 4.5, hz - 4.5),
      this.box('rock3', -hx + 9, hx - 9, SLAB_BOTTOM - 4.8, SLAB_BOTTOM - 3.4, -hz + 7.5, hz - 7.5),
    ];
    for (const r of rocks) r.material = this.rockMat;

    for (const m of [sand, water, skirt, wskirt, ocean, ...rocks]) {
      m.position.x = this.offsetX;
      m.alwaysSelectAsActiveMesh = true;
      m.isPickable = false;
      m.freezeWorldMatrix();
      this.meshes.push(m);
    }
  }

  private bindFieldTextures(): void {
    for (const m of [this.sandMat, this.waterMat, this.skirtMat, this.waterSkirtMat]) {
      m.setTexture('fieldPrev', this.texPrev);
      m.setTexture('fieldCur', this.texCur);
      m.setVector2('gridSize', new Vector2(this.grid.nx, this.grid.ny));
    }
  }

  private chair = false;
  private visible = true;

  /** The chair view has an open sea instead of the diorama's apron and cut-away water. */
  setChairView(on: boolean): void {
    this.chair = on;
    this.applyVisibility();
  }

  /** Hide the whole beach (yours, while you're visiting or far down the shore). */
  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    for (const m of this.meshes) m.setEnabled(this.visible);
    this.apronMesh.setEnabled(this.visible && !this.chair);
    this.waterSkirt.setEnabled(this.visible && !this.chair);
  }

  /** Show a still snapshot (neighbors): the same packed frame as both prev and current. */
  showStatic(buf: Float32Array): void {
    this.uploadFrame(buf);
    this.uploadFrame(buf);
    this.frameMix = 1;
  }

  dispose(): void {
    const mats = new Set<ShaderMaterial>();
    for (const m of this.meshes) {
      if (m.material) mats.add(m.material as ShaderMaterial);
      m.dispose();
    }
    for (const m of mats) m.dispose();
    this.texPrev.dispose();
    this.texCur.dispose();
    this.restTex.dispose();
  }

  // ---------------------------------------------------------------- per frame

  /** Upload a new sim frame (becomes "current"; the old current becomes "previous"). */
  uploadFrame(buf: Float32Array): void {
    const t = this.texPrev;
    this.texPrev = this.texCur;
    this.texCur = t;
    this.texCur.update(buf);
    this.bindFieldTextures();
    this.frameMix = 0;
  }

  setFrameMix(m: number): void {
    this.frameMix = Math.max(0, Math.min(1, m));
  }

  /** Brush ring under the finger. x,z world; r metres; alpha 0..1 */
  setBrush(x: number, z: number, r: number, alpha: number, color: RGB): void {
    this.brush.set(x, z, r, alpha);
    this.sandMat.setVector4('brush', this.brush);
    this.sandMat.setColor3('brushCol', c3(color));
  }

  update(p: Palette, cameraDir: Vector3, time: number, simTime: number, tide: number, ampScale: number): void {
    const sun = new Vector3(p.sunDir[0], p.sunDir[1], p.sunDir[2]).normalize();
    for (const { mat } of this.lit) {
      mat.setVector3('sunDir', sun);
      mat.setColor3('sunCol', c3(p.sun));
      mat.setColor3('ambCol', c3(p.ambient));
      mat.setColor3('shadowCol', c3(p.shadow));
      mat.setVector3('cameraDir', cameraDir);
    }
    for (const m of [this.sandMat, this.waterMat, this.skirtMat, this.waterSkirtMat]) {
      m.setFloat('frameMix', this.frameMix);
    }
    this.sandMat.setColor3('sandDry', c3(p.sandDry));
    this.sandMat.setColor3('sandWet', c3(p.sandWet));
    this.sandMat.setColor3('sandDeep', c3(p.sandDeep));
    this.sandMat.setVector4('brush', this.brush);

    this.waterMat.setColor3('shallowCol', c3(p.waterShallow));
    this.waterMat.setColor3('deepCol', c3(p.waterDeep));
    this.waterMat.setColor3('foamCol', c3(p.foam));
    this.waterMat.setFloat('time', time);

    for (const m of [this.skirtMat, this.waterSkirtMat]) {
      m.setColor3('sandDry', c3(p.sandDry));
      m.setColor3('sandWet', c3(p.sandWet));
      m.setColor3('strataA', c3(p.strataA));
      m.setColor3('strataB', c3(p.strataB));
      m.setColor3('rock', c3(p.rock));
      m.setColor3('shallowCol', c3(p.waterShallow));
      m.setColor3('deepCol', c3(p.waterDeep));
    }

    const sw = this.swell;
    this.oceanMat.setVector3('swellA', new Vector3(sw[0].amp * ampScale, sw[1].amp * ampScale, sw[2].amp * ampScale));
    this.oceanMat.setVector3('swellW', new Vector3(sw[0].omega, sw[1].omega, sw[2].omega));
    this.oceanMat.setVector3('swellP', new Vector3(sw[0].phase, sw[1].phase, sw[2].phase));
    this.oceanMat.setVector3('swellK', new Vector3(sw[0].k, sw[1].k, sw[2].k));
    this.oceanMat.setFloat('swellEnv', swellEnvelope(simTime, sw));
    this.oceanMat.setFloat('simTime', simTime);
    this.oceanMat.setFloat('tide', tide);
    this.oceanMat.setColor3('oceanCol', c3(p.farOcean));
    this.oceanMat.setColor3('deepCol', c3(p.waterDeep));
    this.oceanMat.setColor3('foamCol', c3(p.foam));
    this.oceanMat.setColor3('fogCol', c3(p.fog));

    this.rockMat.setColor3('baseCol', c3(p.rock));
    this.rockMat.setColor3('fogCol', c3(p.fog));
  }
}
