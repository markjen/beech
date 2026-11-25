import type { CameraController } from './cameraController';

export interface GestureHandlers {
  /** finger/mouse went down on the sand (CSS px relative to canvas) */
  digStart(sx: number, sy: number): void;
  digMove(sx: number, sy: number): void;
  digEnd(): void;
  /** the dig turned out to be the start of a camera gesture: roll it back */
  digCancel(): void;
  /** mouse hovering (no button) – used for the brush ring on desktop */
  hover(sx: number, sy: number): void;
  hoverEnd(): void;
  undo(): void;
  redo(): void;
  /** number keys 1-3 pick a tool */
  tool?(index: number): void;
  /** V: switch between the diorama and the chair view */
  view?(): void;
  /** H: collapse/expand the toolbars for minimal-overlay panning */
  toggleCollapse?(): void;
  /** Escape: restore collapsed toolbars */
  exitCollapse?(): void;
  /** any user input at all (used to unlock audio, hide hints) */
  interacted(): void;
  /**
   * Look mode: the pointer has held still on (sx, sy) for a long-press. Return
   * true if that picked something up: the gesture then carries on as a drag
   * (digMove / digEnd / digCancel) instead of panning.
   */
  grabAt?(sx: number, sy: number): boolean;
}

/** how long to hold still for a long-press, and how still (CSS px) */
export const LONG_PRESS_MS = 420;
export const HOLD_SLOP_PX = 9;

type Mode = 'idle' | 'dig' | 'camera' | 'mousePan' | 'mouseRotate' | 'onePan';

export interface TwoFingers {
  mx: number;
  my: number;
  dist: number;
  angle: number;
}

/**
 * What a two-finger gesture is, once it has moved a little: two fingers side
 * by side sliding up or down together is a tilt (as in map apps); anything
 * else is the usual pan + pinch + twist. Returns null while undecided.
 */
export function classifyTwoFinger(start: TwoFingers, now: TwoFingers): 'tilt' | 'move' | null {
  const dx = now.mx - start.mx;
  const dy = now.my - start.my;
  const moved = Math.hypot(dx, dy);
  const pinch = Math.abs(now.dist / start.dist - 1);
  let twist = Math.abs(now.angle - start.angle);
  if (twist > Math.PI) twist = Math.PI * 2 - twist;
  if (moved < 10 && pinch < 0.06 && twist < 0.08) return null;
  // fingers roughly side by side: the line between them is near horizontal
  const a = Math.abs(Math.sin(start.angle));
  const sideBySide = a < 0.55;
  if (sideBySide && Math.abs(dy) > 2 * Math.abs(dx) && pinch < 0.12 && twist < 0.15 && moved >= 10) return 'tilt';
  return 'move';
}

/** If a second finger lands within this many ms of the first, the dig is undone. */
const CANCEL_WINDOW_MS = 220;

/**
 * Maps pointer input to digging and camera moves.
 *
 *   touch: 1 finger = dig, 2 fingers = pan + pinch zoom + twist rotate
 *   mouse: left = dig, middle / space+left = pan, right = rotate, wheel = zoom
 *   keys:  WASD pan, Q/E rotate 45deg, +/- zoom, Ctrl/Cmd+Z undo, +Shift redo
 */
/** UI that needs the browser's own touch handling: scrolling panels and form controls. */
export const TOUCH_UI = '.sheet, .hud-popup, .inv-tray, .claw-card, .board-card, .hint.with-action, input, textarea, select';

export function letTouchThrough(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest?.(TOUCH_UI);
}

export class Gestures {
  private mode: Mode = 'idle';
  private pointers = new Map<number, { x: number; y: number }>();
  private digPointer = -1;
  private digStartAt = 0;
  private two: TwoFingers | null = null;
  private twoStart: TwoFingers | null = null;
  private twoKind: 'tilt' | 'move' | null = null;
  private last = { x: 0, y: 0 };
  private space = false;
  enabled = true;
  /** the look tool: one finger / left button moves the view instead of digging */
  lookOnly = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cam: CameraController,
    private readonly h: GestureHandlers,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // stop iOS Safari's own pinch/scroll gestures over the beach, but let
    // panels scroll and sliders slide (they're driven by touchmove on iOS)
    for (const t of ['gesturestart', 'gesturechange', 'touchmove']) {
      document.addEventListener(
        t,
        (e) => {
          if (t === 'touchmove' && letTouchThrough(e.target)) return;
          e.preventDefault();
        },
        { passive: false },
      );
    }
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => {
      this.cam.held.clear();
      this.space = false;
    });
  }

  get cameraActive(): boolean {
    return this.mode === 'camera' || this.mode === 'mousePan' || this.mode === 'onePan';
  }

  private pos(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** look mode: a long-press on a thing turns a pan into a drag */
  private hold: { timer: number; x: number; y: number; id: number } | null = null;

  private startHold(p: { x: number; y: number }, id: number): void {
    this.endHold();
    if (!this.h.grabAt) return;
    const hold = { x: p.x, y: p.y, id, timer: 0 };
    hold.timer = window.setTimeout(() => {
      this.hold = null;
      if ((this.mode !== 'onePan' && this.mode !== 'mousePan') || !this.h.grabAt!(hold.x, hold.y)) return;
      this.cam.releasePan();
      this.mode = 'dig';
      this.digPointer = id;
      this.digStartAt = 0; // a second finger now cancels the drag, not a dig
    }, LONG_PRESS_MS);
    this.hold = hold;
  }

  private endHold(): void {
    if (this.hold) window.clearTimeout(this.hold.timer);
    this.hold = null;
  }

  private onDown = (e: PointerEvent) => {
    this.h.interacted();
    if (!this.enabled) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const p = this.pos(e);
    if (e.pointerType === 'mouse') {
      if (this.mode !== 'idle') return;
      this.last = p;
      if (e.button === 0 && this.lookOnly) {
        this.mode = 'mousePan';
        this.cam.stopGlide();
        this.startHold(p, e.pointerId);
      } else if (e.button === 0 && !this.space) {
        this.mode = 'dig';
        this.digPointer = e.pointerId;
        this.h.digStart(p.x, p.y);
      } else if (e.button === 1 || (e.button === 0 && this.space)) {
        this.mode = 'mousePan';
        this.cam.stopGlide();
      } else if (e.button === 2) {
        this.mode = 'mouseRotate';
      }
      return;
    }

    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1 && this.mode === 'idle' && this.lookOnly) {
      this.mode = 'onePan';
      this.last = p;
      this.cam.stopGlide();
      this.startHold(p, e.pointerId);
    } else if (this.pointers.size === 1 && this.mode === 'idle') {
      this.mode = 'dig';
      this.digPointer = e.pointerId;
      this.digStartAt = performance.now();
      this.cam.stopGlide();
      this.h.digStart(p.x, p.y);
    } else if (this.pointers.size === 2) {
      this.endHold();
      if (this.mode === 'onePan') this.cam.releasePan();
      if (this.mode === 'dig') {
        if (performance.now() - this.digStartAt < CANCEL_WINDOW_MS) this.h.digCancel();
        else this.h.digEnd();
      }
      this.mode = 'camera';
      this.digPointer = -1;
      this.cam.stopGlide();
      this.two = this.twoState();
      this.twoStart = this.two;
      this.twoKind = null;
    }
  };

  private twoState() {
    const [a, b] = [...this.pointers.values()];
    return {
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
      dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  private onMove = (e: PointerEvent) => {
    const p = this.pos(e);
    // moved before the long-press: it's a pan after all
    if (this.hold && Math.hypot(p.x - this.hold.x, p.y - this.hold.y) > HOLD_SLOP_PX) this.endHold();
    if (e.pointerType === 'mouse') {
      switch (this.mode) {
        case 'dig':
          this.h.digMove(p.x, p.y);
          break;
        case 'mousePan':
          this.cam.panScreen(this.last.x, this.last.y, p.x, p.y);
          break;
        case 'mouseRotate':
          // right-drag: sideways turns, up/down tilts
          this.cam.rotate(-(p.x - this.last.x) * 0.008);
          this.cam.tilt(-(p.y - this.last.y) * 0.006);
          break;
        default:
          this.h.hover(p.x, p.y);
      }
      this.last = p;
      return;
    }
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, p);
    if (this.mode === 'dig' && e.pointerId === this.digPointer) {
      this.h.digMove(p.x, p.y);
    } else if (this.mode === 'onePan') {
      this.cam.panScreen(this.last.x, this.last.y, p.x, p.y);
      this.last = p;
    } else if (this.mode === 'camera' && this.pointers.size === 2 && this.two) {
      const now = this.twoState();
      if (!this.twoKind && this.twoStart) {
        this.twoKind = classifyTwoFinger(this.twoStart, now);
        if (!this.twoKind) return; // wait until it's clear what this is
        this.two = this.twoStart; // apply everything since the start
      }
      if (this.twoKind === 'tilt') {
        // fingers up = toward the horizon
        this.cam.tilt(-(now.my - this.two.my) * 0.006);
      } else {
        this.cam.panScreen(this.two.mx, this.two.my, now.mx, now.my);
        this.cam.zoomAt(this.two.dist / now.dist, now.mx, now.my);
        let da = now.angle - this.two.angle;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        this.cam.rotate(da);
      }
      this.two = now;
    }
  };

  private onUp = (e: PointerEvent) => {
    this.endHold();
    if (e.pointerType === 'mouse') {
      if (this.mode === 'dig') this.h.digEnd();
      if (this.mode === 'mouseRotate') this.cam.snapRotation();
      if (this.mode === 'mousePan') this.cam.releasePan();
      this.mode = 'idle';
      this.digPointer = -1;
      return;
    }
    this.pointers.delete(e.pointerId);
    if (this.mode === 'onePan') {
      this.cam.releasePan();
      if (this.pointers.size === 0) this.mode = 'idle';
    } else if (this.mode === 'dig' && e.pointerId === this.digPointer) {
      this.h.digEnd();
      this.mode = 'idle';
      this.digPointer = -1;
    } else if (this.mode === 'camera') {
      if (this.pointers.size === 1) {
        // one finger left: keep blocking digs until everything lifts
        this.cam.releasePan();
        this.cam.snapRotation();
        this.two = null;
      }
      if (this.pointers.size === 0) {
        this.cam.releasePan();
        this.cam.snapRotation();
        this.mode = 'idle';
        this.two = null;
      }
    }
  };

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && this.mode === 'idle') this.h.hoverEnd();
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.h.interacted();
    const p = this.pos(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (e.ctrlKey) {
      // trackpad pinch arrives as ctrl+wheel
      this.cam.zoomAt(Math.exp(dy * 0.01), p.x, p.y);
    } else {
      this.cam.zoomAt(Math.exp(dy * 0.0015), p.x, p.y);
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    this.h.interacted();
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.h.redo();
      else this.h.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'y') {
      e.preventDefault();
      this.h.redo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === ' ') {
      this.space = true;
      e.preventDefault();
    } else if (k >= '1' && k <= '5' && k.length === 1) this.h.tool?.(Number(k) - 1);
    else if (k === 'v') this.h.view?.();
    else if (k === 'h') this.h.toggleCollapse?.();
    else if (k === 'escape') this.h.exitCollapse?.();
    else if (k === 'r' || k === 'f') this.cam.held.add(k);
    else if ((k === 'q' || k === 'e') && this.cam.mode === 'chair') this.cam.held.add(k); // walk along the beach
    else if (k === 'q') this.cam.snapRotation(-1);
    else if (k === 'e') this.cam.snapRotation(1);
    else if (['w', 'a', 's', 'd'].includes(k)) this.cam.held.add(k);
    else if (k === '+' || k === '=') this.cam.held.add('+');
    else if (k === '-' || k === '_') this.cam.held.add('-');
    else if (k === 'arrowup') this.cam.held.add('w');
    else if (k === 'arrowdown') this.cam.held.add('s');
    else if (k === 'arrowleft') this.cam.held.add('a');
    else if (k === 'arrowright') this.cam.held.add('d');
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === ' ') this.space = false;
    const map: Record<string, string> = {
      '=': '+',
      _: '-',
      arrowup: 'w',
      arrowdown: 's',
      arrowleft: 'a',
      arrowright: 'd',
    };
    this.cam.held.delete(map[k] ?? k);
  };
}
