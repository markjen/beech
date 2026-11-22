import { Constants } from '@babylonjs/core/Engines/constants';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';

import { WAVES, WORLD_SIZE_X, WORLD_SIZE_Z } from '../config';
import type { Palette, RGB } from '../palette';
import { restHeight } from '../sim/profile';
import type { SwellComponent } from '../sim/waves';
import { ORIGIN_Z } from './beachRenderer';

const c3 = (c: RGB) => new Color3(c[0], c[1], c[2]);
const LIGHT = ['sunDir', 'sunCol', 'ambCol', 'shadowCol', 'cameraDir'];
/** how far the static beach runs along the shore on each side (m) */
const SHORE_LENGTH = 420;

/**
 * Scenery for the chair view (seated, looking out to sea): an open sea to a
 * misty horizon, and the beach continuing along the shore either side of the
 * simulated beaches (the same rest profile, so the waterline lines up; static,
 * since only your own beach is simulated). Hidden in the diorama view.
 */
export class Horizon {
  private readonly seaMat: ShaderMaterial;
  private readonly sandMat: ShaderMaterial;
  private readonly sea: Mesh;
  private shores: Mesh[] = [];
  private enabled = false;
  private extent = { minX: -WORLD_SIZE_X / 2, maxX: WORLD_SIZE_X / 2 };
  private slabCentres: number[] = [0];

  constructor(
    private readonly scene: Scene,
    private readonly swell: SwellComponent[],
    private readonly seed: number,
    dx: number,
  ) {
    // the beachOcean / beachFlat shaders are registered by BeachRenderer
    this.seaMat = new ShaderMaterial('openSea', scene, 'beachOcean', {
      attributes: ['position'],
      uniforms: ['world', 'viewProjection', ...LIGHT, 'swellA', 'swellW', 'swellP', 'simTime', 'tide', 'zEdge', 'waveSpeed',
        'oceanCol', 'deepCol', 'foamCol', 'fogCol', 'halfX', 'centerX', 'fadeNear', 'fadeFar', 'apron', 'slabs', 'slabHalf'],
      samplers: [],
    });
    this.seaMat.needAlphaBlending = () => true;
    this.seaMat.alphaMode = Constants.ALPHA_COMBINE;
    this.seaMat.backFaceCulling = false;
    // meet the simulated water exactly at its outermost row (no overlap band)
    const edgeZ = ORIGIN_Z + dx * 0.5;
    this.seaMat.setFloat('zEdge', edgeZ);
    this.seaMat.setFloat('waveSpeed', WAVES.farSpeed);
    this.seaMat.setFloat('fadeNear', 40);
    this.seaMat.setFloat('fadeFar', 900);
    this.seaMat.setFloat('apron', 0);
    this.seaMat.setFloat('halfX', 1e6);
    this.seaMat.setFloat('centerX', 0);
    this.seaMat.setFloat('slabHalf', WORLD_SIZE_X / 2 - dx * 0.5);

    this.sandMat = new ShaderMaterial('openShore', scene, 'beachFlat', {
      attributes: ['position', 'normal'],
      uniforms: ['world', 'viewProjection', ...LIGHT, 'baseCol', 'fogCol', 'fadeTop', 'fadeBottom'],
      samplers: [],
    });
    this.sandMat.setFloat('fadeTop', -40);
    this.sandMat.setFloat('fadeBottom', -50);
    this.sandMat.backFaceCulling = false;

    this.sea = this.seaMesh(edgeZ);
    this.sea.material = this.seaMat;
    this.sea.alphaIndex = 0;
    this.buildShores();
    this.setEnabled(false);
  }

  /** The simulated beaches occupy [minX, maxX] (yours plus any neighbors). */
  setExtent(minX: number, maxX: number, slabCentres: number[]): void {
    if (minX === this.extent.minX && maxX === this.extent.maxX && slabCentres.join() === this.slabCentres.join()) return;
    this.extent = { minX, maxX };
    this.slabCentres = slabCentres;
    this.buildShores();
    this.setEnabled(this.enabled);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.sea.setEnabled(on);
    for (const m of this.shores) m.setEnabled(on);
  }

  private seaMesh(edgeZ: number): Mesh {
    // dense near the beach, sparse toward the horizon
    const P: number[] = [];
    const I: number[] = [];
    const NX = 140;
    const NZ = 90;
    const zNear = edgeZ + WORLD_SIZE_Z + 2; // runs under the side beaches too
    const zFar = edgeZ - 1400;
    for (let j = 0; j <= NZ; j++) {
      const t = Math.pow(j / NZ, 2.4);
      const z = zNear + (zFar - zNear) * t;
      for (let i = 0; i <= NX; i++) {
        const u = (i / NX) * 2 - 1;
        P.push(Math.sign(u) * Math.pow(Math.abs(u), 1.8) * 1500, 0, z);
      }
    }
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const a = j * (NX + 1) + i;
        I.push(a, a + 1, a + NX + 1, a + 1, a + NX + 2, a + NX + 1);
      }
    }
    const vd = new VertexData();
    vd.positions = P;
    vd.indices = I;
    const m = new Mesh('openSea', this.scene);
    vd.applyToMesh(m);
    m.alwaysSelectAsActiveMesh = true;
    m.isPickable = false;
    return m;
  }

  /** Static beach from `x0` running `dir` (+1 / -1) along the shore. */
  private shore(x0: number, dir: number): Mesh {
    const P: number[] = [];
    const I: number[] = [];
    const NX = 170;
    const NY = 48;
    for (let i = 0; i <= NX; i++) {
      const x = x0 + dir * SHORE_LENGTH * Math.pow(i / NX, 1.7);
      for (let j = 0; j <= NY; j++) {
        const y = (j / NY) * WORLD_SIZE_Z;
        // the profile's x is metres from the left edge of your beach
        P.push(x, restHeight(x + WORLD_SIZE_X / 2, y, this.seed), ORIGIN_Z + y);
      }
    }
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NY; j++) {
        const a = i * (NY + 1) + j;
        I.push(a, a + NY + 1, a + 1, a + 1, a + NY + 1, a + NY + 2);
      }
    }
    const vd = new VertexData();
    vd.positions = P;
    vd.indices = I;
    const normals: number[] = [];
    VertexData.ComputeNormals(P, I, normals);
    vd.normals = normals;
    const m = new Mesh('openShore', this.scene);
    vd.applyToMesh(m);
    m.material = this.sandMat;
    m.alwaysSelectAsActiveMesh = true;
    m.isPickable = false;
    return m;
  }

  private buildShores(): void {
    for (const m of this.shores) m.dispose();
    this.shores = [this.shore(this.extent.maxX, 1), this.shore(this.extent.minX, -1)];
    const c = [...this.slabCentres, 1e6, 1e6, 1e6].slice(0, 3);
    this.seaMat.setVector3('slabs', new Vector3(c[0], c[1], c[2]));
  }

  update(p: Palette, cameraDir: Vector3, simTime: number, tide: number, ampScale: number): void {
    if (!this.enabled) return;
    const sun = new Vector3(p.sunDir[0], p.sunDir[1], p.sunDir[2]).normalize();
    for (const m of [this.seaMat, this.sandMat]) {
      m.setVector3('sunDir', sun);
      m.setColor3('sunCol', c3(p.sun));
      m.setColor3('ambCol', c3(p.ambient));
      m.setColor3('shadowCol', c3(p.shadow));
      m.setVector3('cameraDir', cameraDir);
      m.setColor3('fogCol', c3(p.fog));
    }
    this.sandMat.setColor3('baseCol', c3(p.sandDry));
    const sw = this.swell;
    this.seaMat.setVector3('swellA', new Vector3(sw[0].amp * ampScale, sw[1].amp * ampScale, sw[2].amp * ampScale));
    this.seaMat.setVector3('swellW', new Vector3(sw[0].omega, sw[1].omega, sw[2].omega));
    this.seaMat.setVector3('swellP', new Vector3(sw[0].phase, sw[1].phase, sw[2].phase));
    this.seaMat.setFloat('simTime', simTime);
    this.seaMat.setFloat('tide', tide);
    this.seaMat.setColor3('oceanCol', c3(p.farOcean));
    this.seaMat.setColor3('deepCol', c3(p.waterDeep));
    this.seaMat.setColor3('foamCol', c3(p.foam));
  }
}
