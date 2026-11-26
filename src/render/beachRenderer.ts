import '@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration';
import '@babylonjs/core/Shaders/ShadersInclude/instancesVertex';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Engine } from '@babylonjs/core/Engines/engine';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
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
/** how far the open sea runs offshore past the slab's offshore edge (m) */
export const OCEAN_REACH = 34;

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
  private skipFrameInterpolation = false;
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
  private brushCol = new Color3(1, 1, 1);
  /** 1: snapshot water (analytic waves over still sand); 0: the simulation's; between: easing from one to the other */
  private staticMix = 0;
  private ease: { t0: number; ms: number } | null = null;
  /** a snapshot easing from its last frame to a new one (a viewer's live update) */
  private frameEase: { t0: number; ms: number } | null = null;
  private negNeighbor: BeachRenderer | null = null;
  private posNeighbor: BeachRenderer | null = null;
  private readonly edgeZ: number;
  private readonly fieldMats: ShaderMaterial[];

  // Reusable scratch objects & change tracking to avoid per-frame allocations
  // and redundant uniform pushes across all ~85 prop materials.
  private readonly _sun = new Vector3(0.35, -0.8, 0.5).normalize();
  private readonly _sunCol = new Color3(1, 1, 1);
  private readonly _ambCol = new Color3(0.5, 0.5, 0.5);
  private readonly _shadowCol = new Color3(0.5, 0.5, 0.5);
  private readonly _camDir = new Vector3(0, -1, 0);
  private readonly _swellA = new Vector3();
  private readonly _sandDry = new Color3();
  private readonly _sandWet = new Color3();
  private readonly _sandDeep = new Color3();
  private readonly _shallowCol = new Color3();
  private readonly _deepCol = new Color3();
  private readonly _foamCol = new Color3();
  private readonly _strataA = new Color3();
  private readonly _strataB = new Color3();
  private readonly _rock = new Color3();
  private readonly _oceanCol = new Color3();
  private readonly _fogCol = new Color3();
  private readonly _linked = new Vector2(0, 0);
  private lastPalette: Palette | null = null;
  private lastAmpScale = NaN;
  private lastBrushR = -1;
  private lastBrushG = -1;
  private lastBrushB = -1;
  private hasLitState = false;
  private texGen = 0;
  private lastNegGen = -1;
  private lastPosGen = -1;
  private lastNegRef: BeachRenderer | null | undefined = undefined;
  private lastPosRef: BeachRenderer | null | undefined = undefined;

  /** world X of this slab's centre */
  get offsetX(): number {
    return this._offsetX;
  }

  /** Move the slab along the shore (the waves moved to another of your beaches). */
  setOffsetX(x: number): void {
    if (x === this._offsetX) return;
    this._offsetX = x;
    for (const m of this.fieldMats) m.setFloat('centerX', x);
    this.oceanMat.setFloat('centerX', x);
    for (const m of this.meshes) {
      m.unfreezeWorldMatrix();
      m.position.x = x;
      m.freezeWorldMatrix();
    }
  }

  constructor(
    private readonly scene: Scene,
    grid: GridSpec,
    rest: Float32Array,
    private readonly swell: Swell,
    /** world X offset of this slab (where its beach sits along the shore) */
    private _offsetX = 0,
  ) {
    this.grid = grid;
    this.edgeZ = ORIGIN_Z + grid.dx * 0.5;
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
    Effect.ShadersStore['beachAnimalVertexShader'] = S.animalVertex;
    Effect.ShadersStore['beachAnimalFragmentShader'] = S.animalFragment;

    const light = ['sunDir', 'sunCol', 'ambCol', 'shadowCol', 'cameraDir'];
    const swellUniforms = ['swellA', 'swellW', 'swellP', 'swellK', 'swellEnv', 'simTime', 'tide', 'zEdge'];
    const field = [
      'frameMix',
      'gridSize',
      'cellSize',
      'centerX',
      'originZ',
      'staticWater',
      'linkedSides',
      'negMix',
      'negStatic',
      'posMix',
      'posStatic',
      ...swellUniforms,
    ];
    const fieldSamplers = ['fieldPrev', 'fieldCur', 'negFieldPrev', 'negFieldCur', 'posFieldPrev', 'posFieldCur'];

    this.sandMat = this.material('beachSand', {
      attributes: ['position', 'uv'],
      uniforms: [...light, ...field, 'sandDry', 'sandWet', 'sandDeep', 'brush', 'brushCol'],
      samplers: [...fieldSamplers, 'restTex'],
    });
    this.sandMat.setTexture('restTex', this.restTex);
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
        ...swellUniforms,
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
        'linkedSides',
        'slabA',
        'slabB',
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

    const gs = new Vector2(grid.nx, grid.ny);
    const swellW = new Vector3(swell[0].omega, swell[1].omega, swell[2].omega);
    const swellP = new Vector3(swell[0].phase, swell[1].phase, swell[2].phase);
    const swellK = new Vector3(swell[0].k, swell[1].k, swell[2].k);

    this.fieldMats = [this.sandMat, this.waterMat, this.skirtMat, this.waterSkirtMat];
    for (const m of this.fieldMats) {
      m.setVector2('gridSize', gs);
      m.setFloat('cellSize', grid.dx);
      m.setFloat('centerX', this._offsetX);
      m.setFloat('originZ', ORIGIN_Z);
      m.setFloat('staticWater', 0);
      m.setFloat('zEdge', this.edgeZ);
      m.setVector2('linkedSides', this._linked);
      m.setFloat('negMix', 1);
      m.setFloat('negStatic', 0);
      m.setFloat('posMix', 1);
      m.setFloat('posStatic', 0);
      m.setVector3('swellW', swellW);
      m.setVector3('swellP', swellP);
      m.setVector3('swellK', swellK);
    }
    this.oceanMat.setVector3('swellW', swellW);
    this.oceanMat.setVector3('swellP', swellP);
    this.oceanMat.setVector3('swellK', swellK);

    this.rockMat = this.material('beachFlat', {
      attributes: ['position', 'normal'],
      uniforms: [...light, 'windTime', 'baseCol', 'fogCol', 'fadeTop', 'fadeBottom', 'shine'],
      samplers: [],
    });
    this.rockMat.backFaceCulling = false;
    this.rockMat.setFloat('windTime', 0);
    this.rockMat.setFloat('fadeTop', -2.8);
    this.rockMat.setFloat('fadeBottom', -7.5);
    this.rockMat.setFloat('shine', 0);

    this.buildMeshes();
    this.bindFieldTextures();
    this.syncNeighborUniforms(performance.now(), true);
  }

  /** A flat-shaded lit material with a fixed colour (props such as shells). `shine` is its specular strength, 0 for matte. */
  createPropMaterial(color: RGB, shine = 0): ShaderMaterial {
    const m = this.material('beachFlat', {
      attributes: ['position', 'normal'],
      uniforms: ['sunDir', 'sunCol', 'ambCol', 'shadowCol', 'cameraDir', 'windTime', 'baseCol', 'fogCol', 'fadeTop', 'fadeBottom', 'shine'],
      samplers: [],
    });
    m.setFloat('windTime', 0);
    m.setColor3('baseCol', c3(color));
    m.setColor3('fogCol', c3(color));
    m.setFloat('fadeTop', -40);
    m.setFloat('fadeBottom', -50);
    m.setFloat('shine', shine);
    m.backFaceCulling = false;
    if (this.hasLitState) {
      m.setVector3('sunDir', this._sun);
      m.setColor3('sunCol', this._sunCol);
      m.setColor3('ambCol', this._ambCol);
      m.setColor3('shadowCol', this._shadowCol);
      m.setVector3('cameraDir', this._camDir);
    }
    return m;
  }

  /** A flat-shaded vertex-coloured lit material for beach animals with GPU scuttle/claw uniforms. */
  createAnimalMaterial(shine = 0.25): ShaderMaterial {
    const m = this.material('beachAnimal', {
      attributes: ['position', 'normal', 'color', 'uv'],
      uniforms: ['sunDir', 'sunCol', 'ambCol', 'shadowCol', 'cameraDir', 'scuttlePhase', 'scuttleAmp', 'clawWave', 'shine', 'tint', 'tintCol'],
      samplers: [],
    });
    m.setFloat('tint', 0);
    m.setColor3('tintCol', new Color3(0, 0, 0));
    m.setFloat('scuttlePhase', 0);
    m.setFloat('scuttleAmp', 0);
    m.setFloat('clawWave', 0);
    m.setFloat('shine', shine);
    m.backFaceCulling = false;
    if (this.hasLitState) {
      m.setVector3('sunDir', this._sun);
      m.setColor3('sunCol', this._sunCol);
      m.setColor3('ambCol', this._ambCol);
      m.setColor3('shadowCol', this._shadowCol);
      m.setVector3('cameraDir', this._camDir);
    }
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
    t.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    t.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
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
        // outer columns reach the exact slab edge [-hx, +hx] so linked beaches meet with zero gap
        positions[k * 3] = i === 0 ? ORIGIN_X : i === nx - 1 ? ORIGIN_X + WORLD_SIZE_X : ORIGIN_X + (i + 0.5) * dx;
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
        const x = i === 0 ? ORIGIN_X : i === nx - 1 ? ORIGIN_X + WORLD_SIZE_X : ORIGIN_X + (i + 0.5) * dx;
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

    // tuck half a cell under the opaque deep offshore edge of water to seal T-junction pinholes
    const edgeZ = this.edgeZ;
    const ocean = this.planeMesh('ocean', -hx, hx, edgeZ - OCEAN_REACH, edgeZ + this.grid.dx * 0.5, 96, 48);
    ocean.material = this.oceanMat;
    ocean.alphaIndex = 1;
    this.oceanMat.setFloat('zEdge', edgeZ);
    this.oceanMat.setFloat('halfX', hx);
    this.oceanMat.setFloat('centerX', this._offsetX);
    this.oceanMat.setFloat('fadeNear', 1);
    this.oceanMat.setFloat('fadeFar', 18);
    this.oceanMat.setFloat('apron', 1);
    this.oceanMat.setVector2('linkedSides', new Vector2(0, 0));
    this.oceanMat.setVector4('slabA', new Vector4(1e7, 1e7, 1e7, 1e7));
    this.oceanMat.setVector4('slabB', new Vector4(1e7, 1e7, 1e7, 1e7));
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
      m.position.x = this._offsetX;
      m.alwaysSelectAsActiveMesh = true;
      m.isPickable = false;
      m.freezeWorldMatrix();
      this.meshes.push(m);
    }
  }

  private bindFieldTextures(): void {
    for (const m of this.fieldMats) {
      m.setTexture('fieldPrev', this.texPrev);
      m.setTexture('fieldCur', this.texCur);
    }
  }

  /**
   * Link this beach to adjacent rendered beaches on its -X (right when facing
   * the sea) and/or +X (left) boundaries. Linked boundaries hide their internal
   * skirts, disable the ocean apron's side mist fade, and blend sand, water and
   * wave fronts smoothly across the shared edge.
   */
  setNeighbors(negX: BeachRenderer | null, posX: BeachRenderer | null): void {
    if (this.negNeighbor === negX && this.posNeighbor === posX) return;
    this.negNeighbor = negX;
    this.posNeighbor = posX;
    this.syncNeighborUniforms(performance.now(), true);
  }

  private syncNeighborUniforms(now: number, force = false): void {
    const neg = this.negNeighbor;
    const pos = this.posNeighbor;
    const negGen = neg ? neg.texGen : this.texGen;
    const posGen = pos ? pos.texGen : this.texGen;
    const refsChanged = force || neg !== this.lastNegRef || pos !== this.lastPosRef;
    const negChanged = refsChanged || negGen !== this.lastNegGen;
    const posChanged = refsChanged || posGen !== this.lastPosGen;
    if (refsChanged) {
      this.lastNegRef = neg;
      this.lastPosRef = pos;
      this._linked.set(neg ? 1 : 0, pos ? 1 : 0);
      this.oceanMat.setVector2('linkedSides', this._linked);
      for (const m of this.fieldMats) {
        m.setVector2('linkedSides', this._linked);
      }
    }
    if (negChanged) {
      this.lastNegGen = negGen;
      const np = neg ? neg.texPrev : this.texPrev;
      const nc = neg ? neg.texCur : this.texCur;
      for (const m of this.fieldMats) {
        m.setTexture('negFieldPrev', np);
        m.setTexture('negFieldCur', nc);
      }
    }
    if (posChanged) {
      this.lastPosGen = posGen;
      const pp = pos ? pos.texPrev : this.texPrev;
      const pc = pos ? pos.texCur : this.texCur;
      for (const m of this.fieldMats) {
        m.setTexture('posFieldPrev', pp);
        m.setTexture('posFieldCur', pc);
      }
    }
    if (neg || refsChanged) {
      const nm = neg ? neg.frameMixAt(now) : 1;
      const ns = neg ? neg.staticMix : 0;
      for (const m of this.fieldMats) {
        m.setFloat('negMix', nm);
        m.setFloat('negStatic', ns);
      }
    }
    if (pos || refsChanged) {
      const pm = pos ? pos.frameMixAt(now) : 1;
      const ps = pos ? pos.staticMix : 0;
      for (const m of this.fieldMats) {
        m.setFloat('posMix', pm);
        m.setFloat('posStatic', ps);
      }
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

  /** Show a neighbor snapshot: static sand, with rolling waves and foam animated in the shader. */
  showStatic(buf: Float32Array): void {
    this.ease = null;
    this.frameEase = null;
    this.setStaticMix(1);
    this.uploadFrame(buf);
    this.uploadFrame(buf);
    this.frameMix = 1;
  }

  /**
   * Show a new snapshot of the same beach, eased from the one drawn now over
   * `ms` (a viewer's live update, docs/LIVE_SIM.md section 7) instead of
   * swapping it in one frame. The last frame becomes "previous" and the
   * vertex shaders blend across, as they do between simulation frames.
   */
  easeStatic(buf: Float32Array, ms: number): void {
    if (ms <= 0 || this.staticMix !== 1 || this.ease) {
      this.showStatic(buf);
      return;
    }
    // (a save landing mid-ease starts from the last target: saves come 5 s apart, eases last ~1 s)
    this.uploadFrame(buf);
    this.frameEase = { t0: performance.now(), ms };
  }

  /**
   * The waves just moved onto this beach (docs/BEACH_STORE.md): start from
   * the snapshot's water, as the snapshot drew it a moment ago, and ease to
   * the simulation's over `ms` instead of swapping in one frame.
   */
  easeFromStatic(ms: number): void {
    this.setStaticMix(ms > 0 ? 1 : 0);
    this.ease = ms > 0 ? { t0: performance.now(), ms } : null;
  }

  private setStaticMix(v: number): void {
    if (v === this.staticMix) return;
    this.staticMix = v;
    for (const m of this.fieldMats) m.setFloat('staticWater', v);
  }

  dispose(): void {
    // detach from any linked neighbors before disposing our textures
    const neg = this.negNeighbor;
    const pos = this.posNeighbor;
    this.negNeighbor = null;
    this.posNeighbor = null;
    if (neg && neg.posNeighbor === this) neg.setNeighbors(neg.negNeighbor, null);
    if (pos && pos.negNeighbor === this) pos.setNeighbors(null, pos.posNeighbor);
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
  uploadFrame(buf: Float32Array, startsBeach = false): void {
    const t = this.texPrev;
    this.texPrev = this.texCur;
    this.texCur = t;
    const it = this.texCur.getInternalTexture();
    const eng = this.scene.getEngine() as Engine;
    if (it && typeof eng.updateTextureData === 'function') {
      eng.updateTextureData(it, buf, 0, 0, this.grid.nx, this.grid.ny);
    } else {
      this.texCur.update(buf);
    }
    this.texGen++;
    this.bindFieldTextures();
    this.skipFrameInterpolation = startsBeach;
    this.frameMix = startsBeach ? 1 : 0;
  }

  setFrameMix(m: number): void {
    this.frameMix = this.skipFrameInterpolation ? 1 : Math.max(0, Math.min(1, m));
  }

  /** Sample the blend at the same time on both sides of a linked edge. */
  private frameMixAt(now: number): number {
    if (!this.frameEase) return this.frameMix;
    const u = Math.max(0, Math.min(1, (now - this.frameEase.t0) / this.frameEase.ms));
    return u * u * (3 - 2 * u);
  }

  /** Brush ring under the finger. x,z world; r metres; alpha 0..1 */
  setBrush(x: number, z: number, r: number, alpha: number, color: RGB): void {
    if (this.brush.x !== x || this.brush.y !== z || this.brush.z !== r || this.brush.w !== alpha) {
      this.brush.set(x, z, r, alpha);
      this.sandMat.setVector4('brush', this.brush);
    }
    if (this.lastBrushR !== color[0] || this.lastBrushG !== color[1] || this.lastBrushB !== color[2]) {
      this.lastBrushR = color[0];
      this.lastBrushG = color[1];
      this.lastBrushB = color[2];
      this.brushCol.set(color[0], color[1], color[2]);
      this.sandMat.setColor3('brushCol', this.brushCol);
    }
  }

  update(p: Palette, cameraDir: Vector3, time: number, simTime: number, tide: number, ampScale: number, now = performance.now()): void {
    const palChanged = p !== this.lastPalette;
    const camChanged = !this.hasLitState || this._camDir.x !== cameraDir.x || this._camDir.y !== cameraDir.y || this._camDir.z !== cameraDir.z;
    if (palChanged || camChanged) {
      this.hasLitState = true;
      if (palChanged) {
        this._sun.set(p.sunDir[0], p.sunDir[1], p.sunDir[2]).normalize();
        this._sunCol.set(p.sun[0], p.sun[1], p.sun[2]);
        this._ambCol.set(p.ambient[0], p.ambient[1], p.ambient[2]);
        this._shadowCol.set(p.shadow[0], p.shadow[1], p.shadow[2]);
      }
      if (camChanged) this._camDir.copyFrom(cameraDir);
      for (const { mat } of this.lit) {
        if (palChanged) {
          mat.setVector3('sunDir', this._sun);
          mat.setColor3('sunCol', this._sunCol);
          mat.setColor3('ambCol', this._ambCol);
          mat.setColor3('shadowCol', this._shadowCol);
        }
        if (camChanged) mat.setVector3('cameraDir', this._camDir);
      }
    }
    const sw = this.swell;
    const ampChanged = ampScale !== this.lastAmpScale;
    if (ampChanged) {
      this.lastAmpScale = ampScale;
      this._swellA.set(sw[0].amp * ampScale, sw[1].amp * ampScale, sw[2].amp * ampScale);
    }
    const swellEnv = swellEnvelope(simTime, sw);

    const frameMix = this.frameMixAt(now);
    if (this.frameEase && frameMix === 1) {
      this.frameMix = 1;
      this.frameEase = null;
    }
    if (this.ease) {
      const u = Math.min(1, (performance.now() - this.ease.t0) / this.ease.ms);
      this.setStaticMix(1 - u * u * (3 - 2 * u));
      if (u >= 1) this.ease = null;
    }
    for (const m of this.fieldMats) {
      m.setFloat('frameMix', frameMix);
      if (ampChanged) m.setVector3('swellA', this._swellA);
      m.setFloat('swellEnv', swellEnv);
      m.setFloat('simTime', simTime);
      m.setFloat('tide', tide);
    }
    // keep linked neighbor texture swaps & frameMix in sync every frame
    if (this.negNeighbor || this.posNeighbor) this.syncNeighborUniforms(now);

    this.waterMat.setFloat('time', time);

    if (ampChanged) this.oceanMat.setVector3('swellA', this._swellA);
    this.oceanMat.setFloat('swellEnv', swellEnv);
    this.oceanMat.setFloat('simTime', simTime);
    this.oceanMat.setFloat('tide', tide);

    if (palChanged) {
      this.lastPalette = p;
      this._sandDry.set(p.sandDry[0], p.sandDry[1], p.sandDry[2]);
      this._sandWet.set(p.sandWet[0], p.sandWet[1], p.sandWet[2]);
      this._sandDeep.set(p.sandDeep[0], p.sandDeep[1], p.sandDeep[2]);
      this._shallowCol.set(p.waterShallow[0], p.waterShallow[1], p.waterShallow[2]);
      this._deepCol.set(p.waterDeep[0], p.waterDeep[1], p.waterDeep[2]);
      this._foamCol.set(p.foam[0], p.foam[1], p.foam[2]);
      this._strataA.set(p.strataA[0], p.strataA[1], p.strataA[2]);
      this._strataB.set(p.strataB[0], p.strataB[1], p.strataB[2]);
      this._rock.set(p.rock[0], p.rock[1], p.rock[2]);
      this._oceanCol.set(p.farOcean[0], p.farOcean[1], p.farOcean[2]);
      this._fogCol.set(p.fog[0], p.fog[1], p.fog[2]);

      this.sandMat.setColor3('sandDry', this._sandDry);
      this.sandMat.setColor3('sandWet', this._sandWet);
      this.sandMat.setColor3('sandDeep', this._sandDeep);

      this.waterMat.setColor3('shallowCol', this._shallowCol);
      this.waterMat.setColor3('deepCol', this._deepCol);
      this.waterMat.setColor3('foamCol', this._foamCol);

      for (const m of [this.skirtMat, this.waterSkirtMat]) {
        m.setColor3('sandDry', this._sandDry);
        m.setColor3('sandWet', this._sandWet);
        m.setColor3('strataA', this._strataA);
        m.setColor3('strataB', this._strataB);
        m.setColor3('rock', this._rock);
        m.setColor3('shallowCol', this._shallowCol);
        m.setColor3('deepCol', this._deepCol);
      }

      this.oceanMat.setColor3('oceanCol', this._oceanCol);
      this.oceanMat.setColor3('deepCol', this._deepCol);
      this.oceanMat.setColor3('foamCol', this._foamCol);
      this.oceanMat.setColor3('fogCol', this._fogCol);

      this.rockMat.setColor3('baseCol', this._rock);
      this.rockMat.setColor3('fogCol', this._fogCol);
    }
  }
}
