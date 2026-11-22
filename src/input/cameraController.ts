import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Culling/ray';
import type { Scene } from '@babylonjs/core/scene';

import { CAMERA, WORLD_SIZE_X, WORLD_SIZE_Z } from '../config';
import { brushWorldRadius, worldPerPx, zoomLimits } from './brushMath';

const TAU = Math.PI * 2;
const PICK_Y = 0.2;

/**
 * Orthographic diorama camera. Zoom = ortho half-height. All gestures are
 * driven from input/gestures.ts; this class just knows how to move.
 */
export class CameraController {
  readonly camera: ArcRotateCamera;
  halfH: number = CAMERA.defaultHalfHeight;
  private snapTarget: number | null = null;
  private panVel = new Vector3();
  private zoomFlash = 0;
  private lastPanAt = 0;
  /** how far the camera may pan along the shore (widens when neighbors are shown) */
  minX = -WORLD_SIZE_X / 2;
  maxX = WORLD_SIZE_X / 2;
  /** keys currently held for keyboard panning */
  readonly held = new Set<string>();

  constructor(
    private readonly scene: Scene,
    private readonly canvas: HTMLCanvasElement,
    private readonly cellSize: number,
  ) {
    const beta = Math.PI / 2 - (CAMERA.elevation * Math.PI) / 180;
    this.camera = new ArcRotateCamera('cam', CAMERA.alpha, beta, CAMERA.radius, new Vector3(0, PICK_Y, -2.5), scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 1;
    this.camera.maxZ = 400;
    this.camera.inertia = 0;
    // default zoom: frame most of the diorama
    this.halfH = this.clampZoom(this.fitHalfHeight() * (this.aspect() < 1 ? 0.55 : 0.85));
    this.applyOrtho();
  }

  // ------------------------------------------------------------ geometry

  /** Ortho half-height that fits the whole slab horizontally at the current rotation. */
  fitHalfHeight(): number {
    const aspect = this.aspect();
    const a = this.camera.alpha;
    const ext = Math.abs(Math.sin(a)) * WORLD_SIZE_X + Math.abs(Math.cos(a)) * WORLD_SIZE_Z;
    return (ext * 0.5 * 1.08) / aspect;
  }

  aspect(): number {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    return w / h;
  }

  /** World metres per CSS pixel at the current zoom. */
  worldPerPx(): number {
    return worldPerPx(this.halfH, this.canvas.clientHeight);
  }

  /** Brush radius in world metres: constant on screen, so it scales with zoom. */
  brushRadius(): number {
    return brushWorldRadius(this.halfH, this.canvas.clientHeight);
  }

  zoomLimits(): { min: number; max: number } {
    return zoomLimits(this.canvas.clientHeight, this.cellSize, this.fitHalfHeight());
  }

  clampZoom(h: number): number {
    const { min, max } = this.zoomLimits();
    return Math.min(max, Math.max(min, h));
  }

  /** Intersect a screen point (CSS px relative to canvas) with a horizontal plane. */
  groundPoint(sx: number, sy: number, y = PICK_Y): Vector3 | null {
    const ray = this.scene.createPickingRay(sx, sy, null, this.camera);
    if (Math.abs(ray.direction.y) < 1e-4) return null;
    const t = (y - ray.origin.y) / ray.direction.y;
    return ray.origin.add(ray.direction.scale(t));
  }

  ray(sx: number, sy: number) {
    return this.scene.createPickingRay(sx, sy, null, this.camera);
  }

  forward(): Vector3 {
    return this.camera.getForwardRay(1).direction.clone();
  }

  // ------------------------------------------------------------ actions

  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.groundPoint(sx, sy);
    const next = this.clampZoom(this.halfH * factor);
    if (next === this.halfH) return;
    this.halfH = next;
    this.applyOrtho();
    this.zoomFlash = 1;
    if (before) {
      const after = this.groundPoint(sx, sy);
      if (after) this.moveTarget(before.subtract(after));
    }
  }

  panScreen(px: number, py: number, sx: number, sy: number): void {
    const a = this.groundPoint(px, py);
    const b = this.groundPoint(sx, sy);
    if (!a || !b) return;
    const d = a.subtract(b);
    this.moveTarget(d);
    const now = performance.now();
    const dt = Math.max(8, now - this.lastPanAt) / 1000;
    this.lastPanAt = now;
    this.panVel.copyFrom(d.scale(Math.min(60, 1 / dt)));
  }

  /** Fingers lifted: keep gliding only if they were still moving. */
  releasePan(): void {
    if (performance.now() - this.lastPanAt > 80) this.panVel.setAll(0);
  }

  stopGlide(): void {
    this.panVel.setAll(0);
  }

  rotate(dAlpha: number): void {
    this.snapTarget = null;
    this.camera.alpha += dAlpha;
  }

  /** Ease to the nearest 45 degree step (keeps the clean isometric angles). */
  snapRotation(direction = 0): void {
    const step = CAMERA.snapStep;
    const a = this.camera.alpha;
    let target = Math.round(a / step) * step;
    if (direction !== 0) target = Math.round(a / step + direction) * step;
    this.snapTarget = target;
  }

  /** How strongly to show the brush-size hint after a zoom (0..1). */
  get zoomHint(): number {
    return this.zoomFlash;
  }

  private moveTarget(d: Vector3): void {
    const t = this.camera.target;
    t.x = Math.min(this.maxX, Math.max(this.minX, t.x + d.x));
    t.z = Math.min(WORLD_SIZE_Z / 2, Math.max(-WORLD_SIZE_Z / 2 - 4, t.z + d.z));
    t.y = PICK_Y;
    this.camera.target = t;
  }

  applyOrtho(): void {
    const a = this.aspect();
    this.camera.orthoTop = this.halfH;
    this.camera.orthoBottom = -this.halfH;
    this.camera.orthoLeft = -this.halfH * a;
    this.camera.orthoRight = this.halfH * a;
  }

  onResize(): void {
    this.halfH = this.clampZoom(this.halfH);
    this.applyOrtho();
  }

  update(dt: number, panning: boolean): void {
    // keyboard pan / zoom
    if (this.held.size) {
      const speed = this.halfH * 1.2 * dt;
      const a = this.camera.alpha;
      // screen-up on the ground is the direction from the camera to the target
      const fx = -Math.cos(a);
      const fz = -Math.sin(a);
      let mx = 0;
      let mz = 0;
      if (this.held.has('w')) (mx += fx), (mz += fz);
      if (this.held.has('s')) (mx -= fx), (mz -= fz);
      if (this.held.has('a')) (mx += -fz), (mz += fx);
      if (this.held.has('d')) (mx -= -fz), (mz -= fx);
      if (mx || mz) this.moveTarget(new Vector3(mx * speed, 0, mz * speed));
      const cx = this.canvas.clientWidth / 2;
      const cy = this.canvas.clientHeight / 2;
      if (this.held.has('+')) this.zoomAt(Math.exp(-dt * 1.5), cx, cy);
      if (this.held.has('-')) this.zoomAt(Math.exp(dt * 1.5), cx, cy);
    }
    // glide after a pan
    if (!panning && this.panVel.lengthSquared() > 1e-6) {
      this.moveTarget(this.panVel.scale(dt));
      this.panVel.scaleInPlace(Math.exp(-dt * 7));
    }
    if (this.snapTarget !== null) {
      const d = this.snapTarget - this.camera.alpha;
      if (Math.abs(d) < 1e-3) {
        this.camera.alpha = this.snapTarget % TAU;
        this.snapTarget = null;
      } else {
        this.camera.alpha += d * Math.min(1, dt * 7);
      }
    }
    this.zoomFlash = Math.max(0, this.zoomFlash - dt * 1.2);
  }
}
