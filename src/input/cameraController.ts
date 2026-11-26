import { Camera } from '@babylonjs/core/Cameras/camera';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Culling/ray';
import type { Scene } from '@babylonjs/core/scene';

import { BRUSH, CAMERA, EXTRA_SEA, PROFILE, WORLD_SIZE_X, WORLD_SIZE_Z } from '../config';
import { brushRadiusOnSand, worldPerPx, zoomLimits } from './brushMath';

const TAU = Math.PI * 2;
const PICK_Y = 0.2;
const DEG = Math.PI / 180;

/**
 * Minimal spherical-orbit camera over TargetCamera. Replaces Babylon's
 * ArcRotateCamera (which pulls in pointer/keyboard/wheel inputs, bouncing &
 * framing behaviors, and the Animation subsystem) since CameraController drives
 * all gestures and easing itself.
 */
class OrbitCamera extends TargetCamera {
  alpha: number;
  beta: number;
  radius: number;
  private _orbitTarget: Vector3;
  private _lastAlpha = Number.NaN;
  private _lastBeta = Number.NaN;
  private _lastRadius = Number.NaN;
  private readonly _lastTarget = new Vector3(Number.NaN, Number.NaN, Number.NaN);

  constructor(name: string, alpha: number, beta: number, radius: number, target: Vector3, scene: Scene) {
    super(name, Vector3.Zero(), scene);
    this.alpha = alpha;
    this.beta = beta;
    this.radius = radius;
    this._orbitTarget = target;
    this._syncPosition();
  }

  override get target(): Vector3 {
    return this._orbitTarget;
  }

  override set target(v: Vector3) {
    this._orbitTarget = v;
  }

  private _syncPosition(): void {
    const sinb = Math.sin(this.beta) || 0.0001;
    const t = this._orbitTarget;
    this.position.set(
      t.x + this.radius * Math.cos(this.alpha) * sinb,
      t.y + this.radius * Math.cos(this.beta),
      t.z + this.radius * Math.sin(this.alpha) * sinb,
    );
  }

  override _updateCache(ignoreParentClass?: boolean): void {
    if (!ignoreParentClass) super._updateCache();
    this._lastAlpha = this.alpha;
    this._lastBeta = this.beta;
    this._lastRadius = this.radius;
    this._lastTarget.copyFrom(this._orbitTarget);
  }

  override _isSynchronizedViewMatrix(): boolean {
    if (!super._isSynchronizedViewMatrix()) return false;
    return (
      this._lastAlpha === this.alpha &&
      this._lastBeta === this.beta &&
      this._lastRadius === this.radius &&
      this._lastTarget.equals(this._orbitTarget)
    );
  }

  override _getViewMatrix(): Matrix {
    this._syncPosition();
    this._currentTarget.copyFrom(this._orbitTarget);
    this._computeViewMatrix(this.position, this._orbitTarget, this.upVector);
    return this._viewMatrix;
  }
}

export type ViewMode = 'diorama' | 'chair';

/** Chair view: sitting on the sand, looking out to sea. */
export const CHAIR = {
  /** eye height above the sand (m) */
  eye: 1.15,
  /** where the chair stands, world metres (sea is toward -Z) */
  seatX: 0,
  seatZ: WORLD_SIZE_Z / 2 - 5.5,
  /** m/s when walking along the beach */
  walkSpeed: 1.8,
  fov: 0.95,
  minFov: 0.12,
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
  readonly camera: OrbitCamera;
  readonly chairCam: TargetCamera;
  mode: ViewMode = 'diorama';
  halfH: number = CAMERA.defaultHalfHeight;
  private snapTarget: number | null = null;
  private panVel = new Vector3();
  private zoomFlash = 0;
  private lastPanAt = 0;
  /** how far the camera may pan along the shore (widens when neighbors are shown) */
  minX = -WORLD_SIZE_X / 2;
  maxX = WORLD_SIZE_X / 2;
  /** how far inland the view can pan (past the sand when a beach has inland sections, docs/INLAND_SECTIONS.md) */
  maxZ = WORLD_SIZE_Z / 2;
  /** keys currently held for keyboard panning */
  readonly held = new Set<string>();
  /** chair state */
  yaw = 0; // 0 = straight out to sea
  pitch = CHAIR.defaultPitch;
  fov = CHAIR.fov;
  seatX = CHAIR.seatX;
  /** chair: walking along the beach, -1 (to your left) .. 1 (to your right); set by the on-screen buttons */
  walk = 0;
  private walkVel = 0;
  /** seconds the walk has been held (walking speeds up the longer you hold) */
  private walkHeld = 0;
  /** gliding along the shore to this x (the home button) */
  private glideX: number | null = null;
  private glideZ: number | null = null;
  /** sand height lookup (set by main), so the chair sits on the real surface */
  groundHeight: (x: number, z: number) => number = () => 0.8;
  private listeners: ((m: ViewMode) => void)[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly canvas: HTMLCanvasElement,
    private readonly cellSize: number,
  ) {
    const beta = Math.PI / 2 - CAMERA.elevation * DEG;
    this.camera = new OrbitCamera('cam', CAMERA.alpha, beta, CAMERA.radius, new Vector3(0, PICK_Y, PROFILE.shoreline - WORLD_SIZE_Z / 2 + 1), scene); // just up from the waterline
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 1;
    this.camera.maxZ = 400;
    this.camera.inertia = 0;
    // start framed on the beach and the nearshore (zoom out to see all the sea)
    this.halfH = this.clampZoom(this.fitHalfHeight(WORLD_SIZE_Z - EXTRA_SEA) * (this.aspect() < 1 ? 0.55 : 0.85));
    this.applyOrtho();

    this.chairCam = new TargetCamera('chair', new Vector3(0, 2, CHAIR.seatZ), scene, false);
    this.chairCam.minZ = 0.05;
    this.chairCam.maxZ = 2000;
    this.chairCam.inertia = 0;
    this.applyChair();
    scene.activeCamera = this.camera;
  }

  get active(): Camera {
    return this.mode === 'chair' || this.anim ? this.chairCam : this.camera;
  }

  onModeChange(fn: (m: ViewMode) => void): void {
    this.listeners.push(fn);
  }

  /**
   * Switch views. Animated by default: a dolly-zoom from the floating island
   * down into the beach chair (or back up). The scenery swaps halfway.
   */
  setMode(m: ViewMode, animate = true): void {
    if (this.anim) {
      // reversing mid-flight: turn around from where we are
      if ((m === 'chair') !== this.anim.toChair) {
        this.anim.toChair = m === 'chair';
        this.anim.t = 1 - this.anim.t;
        this.anim.switched = this.anim.t >= 0.5;
      }
      return;
    }
    if (m === this.mode) return;
    this.panVel.setAll(0);
    // stand up where you were sitting
    if (m === 'diorama') this.camera.target.x = Math.min(this.maxX, Math.max(this.minX, this.seatX));
    if (m === 'chair') {
      // sit facing where the diorama camera was looking, roughly
      this.seatX = Math.min(this.maxX - 2, Math.max(this.minX + 2, this.camera.target.x));
      this.yaw = 0;
      this.pitch = CHAIR.defaultPitch;
      this.fov = CHAIR.fov;
    }
    if (!animate) {
      this.finishMode(m);
      return;
    }
    this.anim = { toChair: m === 'chair', t: 0, switched: false };
    this.scene.activeCamera = this.chairCam;
    this.applyAnim();
  }

  /** true while the view is flying between diorama and chair */
  get animating(): boolean {
    return this.anim !== null;
  }

  private anim: { toChair: boolean; t: number; switched: boolean } | null = null;

  private finishMode(m: ViewMode): void {
    const changed = m !== this.mode;
    this.mode = m;
    if (m === 'chair') this.applyChair();
    this.chairCam.minZ = 0.05;
    this.scene.activeCamera = this.active;
    if (changed) for (const fn of this.listeners) fn(m);
  }

  /** Camera pose a fraction s of the way from the diorama (0) to the chair (1). */
  private applyAnim(): void {
    const a = this.anim!;
    const s0 = a.toChair ? a.t : 1 - a.t;
    const e = s0 * s0 * s0 * (s0 * (s0 * 6 - 15) + 10); // smootherstep
    // diorama end: far away along the orbit direction with a narrow lens that
    // frames exactly what the orthographic camera shows
    const focus0 = this.camera.target.clone();
    const dir0 = this.camera.position.subtract(this.camera.target).normalize();
    const D0 = 300;
    const H0 = 2 * this.halfH;
    // chair end
    const ground = this.groundHeight(this.seatX, CHAIR.seatZ);
    const eye1 = new Vector3(this.seatX, (Number.isFinite(ground) ? ground : 0.8) + CHAIR.eye, CHAIR.seatZ);
    const cp = Math.cos(this.pitch);
    const fwd = new Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const D1 = 12;
    const focus1 = eye1.add(fwd.scale(D1));
    const dir1 = fwd.scale(-1);
    const H1 = 2 * D1 * Math.tan(this.fov / 2);
    const lerp = (x: number, y: number) => x + (y - x) * e;
    const focus = Vector3.Lerp(focus0, focus1, e);
    const dir = Vector3.Lerp(dir0, dir1, e).normalize();
    const D = Math.exp(lerp(Math.log(D0), Math.log(D1)));
    const H = Math.exp(lerp(Math.log(H0), Math.log(H1)));
    this.chairCam.position.copyFrom(focus.add(dir.scale(D)));
    this.chairCam.setTarget(focus);
    this.chairCam.fov = 2 * Math.atan(H / (2 * D));
    // keep depth precision sensible while far away
    this.chairCam.minZ = Math.max(0.05, D * 0.05);
  }

  private stepAnim(dt: number): void {
    const a = this.anim!;
    a.t = Math.min(1, a.t + dt / 1.7);
    const target: ViewMode = a.toChair ? 'chair' : 'diorama';
    if (!a.switched && a.t >= 0.5) {
      a.switched = true;
      // swap the scenery (island apron vs open sea) mid-flight
      if (target !== this.mode) {
        this.mode = target;
        for (const fn of this.listeners) fn(target);
      }
    }
    if (a.t >= 1) {
      this.anim = null;
      this.finishMode(target);
      return;
    }
    this.applyAnim();
  }

  toggleMode(): void {
    this.setMode(this.mode === 'chair' ? 'diorama' : 'chair');
  }

  // ------------------------------------------------------------ geometry

  /** Ortho half-height that fits the slab (or `depth` m of it, cross-shore) horizontally at the current rotation. */
  fitHalfHeight(depth = WORLD_SIZE_Z): number {
    const aspect = this.aspect();
    const a = this.camera.alpha;
    const ext = Math.abs(Math.sin(a)) * WORLD_SIZE_X + Math.abs(Math.cos(a)) * depth;
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
    if (this.mode === 'diorama') return brushRadiusOnSand(this.halfH, this.canvas.clientHeight, this.cellSize);
    const p = this.chairCam.position;
    const dist = at ? Math.hypot(at.x - p.x, at.y - p.y, at.z - p.z) : 6;
    const wpp = (2 * dist * Math.tan(this.fov / 2)) / (this.canvas.clientHeight || 1);
    return Math.min(BRUSH.maxRadius, Math.max(BRUSH.minCells * this.cellSize, BRUSH.screenRadiusPx * wpp));
  }

  zoomLimits(): { min: number; max: number } {
    return zoomLimits(this.canvas.clientHeight, this.cellSize, this.fitHalfHeight());
  }

  private readonly _invMat = new Matrix();
  private readonly _vpMat = new Matrix();
  private readonly _idMat = Matrix.Identity();
  private readonly _v0 = new Vector3();
  private readonly _v1 = new Vector3();
  private readonly _fwd = new Vector3();
  private readonly _unitZ = new Vector3(0, 0, 1);
  private readonly _foot: { x: number; z: number }[] = [
    { x: 0, z: 0 },
    { x: 0, z: 0 },
    { x: 0, z: 0 },
    { x: 0, z: 0 },
  ];

  /**
   * The diorama view's footprint on the ground plane at height `y`: the four
   * screen corners carried along the view direction, in order. Null in the
   * chair view or mid-switch (a perspective view sees down the shore anyway).
   */
  groundFootprint(y = 0): { x: number; z: number }[] | null {
    if (this.mode !== 'diorama' || this.anim) return null;
    const cam = this.camera;
    cam.getViewMatrix().invertToRef(this._invMat);
    const dir = this._v0;
    cam.target.subtractToRef(cam.position, dir).normalize();
    if (Math.abs(dir.y) < 1e-4) return null;
    const a = this.aspect();
    const h = this.halfH;
    const ha = h * a;
    const p = this._v1;
    const corners: readonly [number, number][] = [
      [-ha, h],
      [ha, h],
      [ha, -h],
      [-ha, -h],
    ];
    for (let i = 0; i < 4; i++) {
      p.set(corners[i][0], corners[i][1], 0);
      Vector3.TransformCoordinatesToRef(p, this._invMat, p);
      const t = (y - p.y) / dir.y;
      this._foot[i].x = p.x + dir.x * t;
      this._foot[i].z = p.z + dir.z * t;
    }
    return this._foot;
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
    this.active.getDirectionToRef(this._unitZ, this._fwd);
    return this._fwd;
  }

  /**
   * Where a direction (e.g. toward the sun) appears on screen, as fractions
   * 0..1, and whether it is in front of the camera.
   */
  projectDirection(dir: [number, number, number]): { x: number; y: number; front: boolean } {
    const cam = this.active;
    const origin = cam.globalPosition;
    const far = this._v0.set(origin.x + dir[0] * 1000, origin.y + dir[1] * 1000, origin.z + dir[2] * 1000);
    const engine = this.scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    cam.getViewMatrix().multiplyToRef(cam.getProjectionMatrix(), this._vpMat);
    Vector3.ProjectToRef(far, this._idMat, this._vpMat, cam.viewport.toGlobal(w, h), this._v1);
    const fwd = this.forward();
    return { x: this._v1.x / w, y: this._v1.y / h, front: fwd.x * dir[0] + fwd.y * dir[1] + fwd.z * dir[2] > 0 };
  }

  // ------------------------------------------------------------ actions

  zoomAt(factor: number, sx: number, sy: number): void {
    if (this.anim) return;
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

  /** Where along the shore the view is (world x): the chair, or the diorama's centre. */
  get focusX(): number {
    return this.mode === 'chair' || this.anim ? this.seatX : this.camera.target.x;
  }

  /** Move along the shore to world x: glide there, or jump. */
  goTo(x: number, instant = false): void {
    this.panVel.setAll(0);
    this.walkVel = 0;
    if (instant) {
      this.glideX = null;
      this.seatX = x;
      this.camera.target.x = x;
      if (this.mode === 'chair') this.applyChair();
      return;
    }
    this.glideX = x;
  }

  /** Glide inland or seaward to world z (diorama), within the pan limits. */
  goToZ(z: number): void {
    this.glideZ = Math.min(this.maxZ, Math.max(-WORLD_SIZE_Z / 2 - 4, z));
  }

  /** The diorama view's focus inland (world z). */
  get focusZ(): number {
    return this.camera.target.z;
  }

  panScreen(px: number, py: number, sx: number, sy: number): void {
    if (this.anim) return;
    this.glideX = null;
    this.glideZ = null;
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
    if (this.anim) return;
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
    if (this.anim) return;
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

  /**
   * Is the diorama turned around, looking back at the beach from the sea?
   * (within a quarter turn of the opposite of the starting angle)
   */
  get reversed(): boolean {
    const a = this.snapTarget ?? this.camera.alpha;
    const d = Math.abs((((a - CAMERA.alpha) % TAU) + TAU) % TAU - Math.PI);
    return d < Math.PI / 2;
  }

  /** Ease the diorama round to the starting isometric angle, or the reverse one (from the sea). */
  faceShore(reverse: boolean): void {
    const goal = CAMERA.alpha + (reverse ? Math.PI : 0);
    const a = this.camera.alpha;
    // the nearest equivalent angle, so it turns the short way
    this.snapTarget = a + ((((goal - a) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
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
    t.z = Math.min(this.maxZ, Math.max(-WORLD_SIZE_Z / 2 - 4, t.z + d.z));
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
    if (this.anim) {
      this.stepAnim(dt);
      return;
    }
    if (this.mode === 'chair') {
      // keys / TV remote: look around, +/- zoom
      if (this.held.size) {
        const s = dt * 0.9;
        const up = (this.held.has('w') || this.held.has('r') ? s : 0) - (this.held.has('s') || this.held.has('f') ? s : 0);
        this.look((this.held.has('d') ? s : 0) - (this.held.has('a') ? s : 0), up);
        if (this.held.has('+')) this.zoomAt(Math.exp(-dt * 1.2), 0, 0);
        if (this.held.has('-')) this.zoomAt(Math.exp(dt * 1.2), 0, 0);
      }
      // walking along the beach (buttons, or Q/E). Facing the sea, your right is -X.
      const dir = Math.max(-1, Math.min(1, this.walk + (this.held.has('e') ? 1 : 0) - (this.held.has('q') ? 1 : 0)));
      // hold longer to stride out (up to 4x): beaches down the shore are 34 m apart
      this.walkHeld = dir ? this.walkHeld + dt : 0;
      if (dir) this.glideX = null;
      const speed = CHAIR.walkSpeed * (1 + Math.min(3, Math.max(0, this.walkHeld - 1) * 1.2));
      this.walkVel += (dir * speed - this.walkVel) * Math.min(1, dt * 4);
      if (this.glideX !== null) {
        const d = this.glideX - this.seatX;
        this.seatX += d * Math.min(1, dt * 2.5) + Math.sign(d) * Math.min(Math.abs(d), dt * 2);
        if (Math.abs(d) < 0.02) this.glideX = null;
      }
      if (Math.abs(this.walkVel) > 1e-3) {
        this.seatX = Math.min(this.maxX - 1.5, Math.max(this.minX + 1.5, this.seatX - this.walkVel * dt));
      } else {
        this.walkVel = 0;
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
    if (this.glideX !== null) {
      const t = this.camera.target;
      const d = this.glideX - t.x;
      t.x += d * Math.min(1, dt * 2.5) + Math.sign(d) * Math.min(Math.abs(d), dt * 2);
      if (Math.abs(d) < 0.02 || panning) this.glideX = null;
    }
    if (this.glideZ !== null) {
      const t = this.camera.target;
      const d = this.glideZ - t.z;
      t.z += d * Math.min(1, dt * 2.5) + Math.sign(d) * Math.min(Math.abs(d), dt * 2);
      if (Math.abs(d) < 0.02 || panning) this.glideZ = null;
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
