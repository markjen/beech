import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Culling/ray';
import type { Scene } from '@babylonjs/core/scene';

import { BRUSH, CAMERA, WORLD_SIZE_X, WORLD_SIZE_Z } from '../config';
import { brushWorldRadius, worldPerPx, zoomLimits } from './brushMath';

const TAU = Math.PI * 2;
const PICK_Y = 0.2;
const DEG = Math.PI / 180;

export type ViewMode = 'diorama' | 'chair';

/** Chair view: sitting on the sand, looking out to sea. */
export const CHAIR = {
  /** eye height above the sand (m) */
  eye: 1.15,
  /** where the chair stands, world metres (sea is toward -Z) */
  seatX: 0,
  seatZ: 6.5,
  fov: 0.95,
  minFov: 0.3,
  maxFov: 1.35,
  /** look up / down limits (radians, + = up) */
  minPitch: -40 * DEG,
  maxPitch: 30 * DEG,
  defaultPitch: -7 * DEG,
};

/** Diorama tilt: elevation of the view above the horizon. */
export const TILT = { min: 12 * DEG, max: 80 * DEG };

/**
 * Two cameras, one active:
 *  - diorama: orthographic, orbit/pan/zoom/tilt, the floating-island view
 *  - chair: perspective at seated eye height, looking out to the horizon
 * Gestures (input/gestures.ts) call the same actions in both; each does the
 * natural thing for the current view.
 */
export class CameraController {
  readonly camera: ArcRotateCamera;
  readonly chairCam: FreeCamera;
  mode: ViewMode = 'diorama';
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
  /** chair state */
  yaw = 0; // 0 = straight out to sea
  pitch = CHAIR.defaultPitch;
  fov = CHAIR.fov;
  seatX = CHAIR.seatX;
  /** sand height lookup (set by main), so the chair sits on the real surface */
  groundHeight: (x: number, z: number) => number = () => 0.8;
  private listeners: ((m: ViewMode) => void)[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly canvas: HTMLCanvasElement,
    private readonly cellSize: number,
  ) {
    const beta = Math.PI / 2 - CAMERA.elevation * DEG;
    this.camera = new ArcRotateCamera('cam', CAMERA.alpha, beta, CAMERA.radius, new Vector3(0, PICK_Y, -2.5), scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 1;
    this.camera.maxZ = 400;
    this.camera.inertia = 0;
    this.halfH = this.clampZoom(this.fitHalfHeight() * (this.aspect() < 1 ? 0.55 : 0.85));
    this.applyOrtho();

    this.chairCam = new FreeCamera('chair', new Vector3(0, 2, CHAIR.seatZ), scene, false);
    this.chairCam.minZ = 0.05;
    this.chairCam.maxZ = 2000;
    this.chairCam.inertia = 0;
    this.chairCam.inputs.clear();
    this.applyChair();
    scene.activeCamera = this.camera;
  }

  get active(): Camera {
    return this.mode === 'chair' ? this.chairCam : this.camera;
  }

  onModeChange(fn: (m: ViewMode) => void): void {
    this.listeners.push(fn);
  }

  setMode(m: ViewMode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.panVel.setAll(0);
    if (m === 'chair') {
      // sit facing where the diorama camera was looking, roughly
      this.seatX = Math.min(this.maxX - 2, Math.max(this.minX + 2, this.camera.target.x));
      this.applyChair();
    }
    this.scene.activeCamera = this.active;
    for (const fn of this.listeners) fn(m);
  }

  toggleMode(): void {
    this.setMode(this.mode === 'chair' ? 'diorama' : 'chair');
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

  /** World metres per CSS pixel at the current zoom (diorama). */
  worldPerPx(): number {
    return worldPerPx(this.halfH, this.canvas.clientHeight);
  }

  /**
   * Brush radius in world metres: constant on screen. In the chair view it
   * depends on how far away the touched sand is.
   */
  brushRadius(at?: { x: number; y: number; z: number } | null): number {
    if (this.mode === 'diorama') return brushWorldRadius(this.halfH, this.canvas.clientHeight);
    const p = this.chairCam.position;
    const dist = at ? Math.hypot(at.x - p.x, at.y - p.y, at.z - p.z) : 6;
    const wpp = (2 * dist * Math.tan(this.fov / 2)) / (this.canvas.clientHeight || 1);
    return Math.min(2.2, Math.max(BRUSH.minCells * this.cellSize, BRUSH.screenRadiusPx * wpp));
  }

  zoomLimits(): { min: number; max: number } {
    return zoomLimits(this.canvas.clientHeight, this.cellSize, this.fitHalfHeight());
  }

  /** 0 = zoomed in close, 1 = zoomed right out (used for the sound mix). */
  zoomOut01(): number {
    if (this.mode === 'chair') return (this.fov - CHAIR.minFov) / (CHAIR.maxFov - CHAIR.minFov);
    const lim = this.zoomLimits();
    return (this.halfH - lim.min) / Math.max(1e-3, lim.max - lim.min);
  }

  clampZoom(h: number): number {
    const { min, max } = this.zoomLimits();
    return Math.min(max, Math.max(min, h));
  }

  /** Diorama: intersect a screen point (CSS px) with a horizontal plane. */
  groundPoint(sx: number, sy: number, y = PICK_Y): Vector3 | null {
    const ray = this.scene.createPickingRay(sx, sy, null, this.camera);
    if (Math.abs(ray.direction.y) < 1e-4) return null;
    const t = (y - ray.origin.y) / ray.direction.y;
    return ray.origin.add(ray.direction.scale(t));
  }

  ray(sx: number, sy: number) {
    return this.scene.createPickingRay(sx, sy, null, this.active);
  }

  forward(): Vector3 {
    return this.active.getForwardRay(1).direction.clone();
  }

  /**
   * Where a direction (e.g. toward the sun) appears on screen, as fractions
   * 0..1, and whether it is in front of the camera.
   */
  projectDirection(dir: [number, number, number]): { x: number; y: number; front: boolean } {
    const cam = this.active;
    const origin = cam.globalPosition;
    const far = origin.add(new Vector3(dir[0], dir[1], dir[2]).scale(1000));
    const engine = this.scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const p = Vector3.Project(far, Matrix.Identity(), cam.getViewMatrix().multiply(cam.getProjectionMatrix()), cam.viewport.toGlobal(w, h));
    const fwd = this.forward();
    return { x: p.x / w, y: p.y / h, front: fwd.x * dir[0] + fwd.y * dir[1] + fwd.z * dir[2] > 0 };
  }

  // ------------------------------------------------------------ actions

  zoomAt(factor: number, sx: number, sy: number): void {
    if (this.mode === 'chair') {
      this.fov = Math.min(CHAIR.maxFov, Math.max(CHAIR.minFov, this.fov * factor));
      this.applyChair();
      return;
    }
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
    if (this.mode === 'chair') {
      // drag the view: the scene follows the fingers
      const k = this.fov / (this.canvas.clientHeight || 1);
      this.look(-(sx - px) * k, (sy - py) * k);
      return;
    }
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

  /** Chair: turn the head (yaw right +, pitch up +). */
  look(dYaw: number, dPitch: number): void {
    this.yaw = Math.max(-1.9, Math.min(1.9, this.yaw + dYaw));
    this.pitch = Math.max(CHAIR.minPitch, Math.min(CHAIR.maxPitch, this.pitch + dPitch));
    this.applyChair();
  }

  /** Fingers lifted: keep gliding only if they were still moving. */
  releasePan(): void {
    if (performance.now() - this.lastPanAt > 80) this.panVel.setAll(0);
  }

  stopGlide(): void {
    this.panVel.setAll(0);
  }

  rotate(dAlpha: number): void {
    if (this.mode === 'chair') {
      this.look(-dAlpha, 0);
      return;
    }
    this.snapTarget = null;
    this.camera.alpha += dAlpha;
  }

  /**
   * Tilt: diorama = raise/lower the viewing angle (lower shows more horizon);
   * chair = look up/down. Positive = toward the horizon.
   */
  tilt(d: number): void {
    if (this.mode === 'chair') {
      this.look(0, d * 0.6);
      return;
    }
    const elev = Math.PI / 2 - this.camera.beta;
    const next = Math.min(TILT.max, Math.max(TILT.min, elev - d));
    this.camera.beta = Math.PI / 2 - next;
  }

  /** Diorama elevation in degrees (for tests and the UI). */
  get elevationDeg(): number {
    return 90 - this.camera.beta / DEG;
  }

  /** Ease to the nearest 45 degree step (keeps the clean isometric angles). */
  snapRotation(direction = 0): void {
    if (this.mode === 'chair') return;
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

  private applyChair(): void {
    const ground = this.groundHeight(this.seatX, CHAIR.seatZ);
    this.chairCam.position.set(this.seatX, (Number.isFinite(ground) ? ground : 0.8) + CHAIR.eye, CHAIR.seatZ);
    // FreeCamera looks down +Z at rotation 0; the sea is toward -Z
    this.chairCam.rotation.set(-this.pitch, Math.PI + this.yaw, 0);
    this.chairCam.fov = this.fov;
  }

  onResize(): void {
    this.halfH = this.clampZoom(this.halfH);
    this.applyOrtho();
  }

  update(dt: number, panning: boolean): void {
    if (this.mode === 'chair') {
      // keys / TV remote: look around, +/- zoom
      if (this.held.size) {
        const s = dt * 0.9;
        const up = (this.held.has('w') || this.held.has('r') ? s : 0) - (this.held.has('s') || this.held.has('f') ? s : 0);
        this.look((this.held.has('d') ? s : 0) - (this.held.has('a') ? s : 0), up);
        if (this.held.has('+')) this.zoomAt(Math.exp(-dt * 1.2), 0, 0);
        if (this.held.has('-')) this.zoomAt(Math.exp(dt * 1.2), 0, 0);
      }
      this.applyChair(); // the sand under the chair can change
      return;
    }
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
      if (this.held.has('r')) this.tilt(dt * 0.8);
      if (this.held.has('f')) this.tilt(-dt * 0.8);
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
