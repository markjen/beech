// Lightweight Gamepad API adapter for Steam Deck and desktop controllers.
// Standard mapping (Xbox / Steam Deck / DualSense):
//   Left stick:   pan camera (diorama) / look around (chair)
//   Right stick:  move virtual brush cursor across the beach
//   RT / A:       dig or place item at the virtual cursor
//   D-pad Up/Dn:  zoom in / out
//   LB / RB:      cycle tools (look / dig / build / smooth / clearing)
//   Y:            toggle Chair / Diorama view
//   B:            undo
//   Start / Menu: toggle settings

import type { CameraController } from './cameraController';

export interface GamepadHandlers {
  digStart(sx: number, sy: number): void;
  digMove(sx: number, sy: number): void;
  digEnd(): void;
  hover(sx: number, sy: number): void;
  undo(): void;
  cycleTool(delta: -1 | 1): void;
  toggleView(): void;
  toggleSettings(): void;
  interacted(): void;
}

const DEADZONE = 0.18;

/** Apply radial/axial deadzone and rescale smoothly to [-1, 1]. */
export function applyDeadzone(v: number, deadzone = DEADZONE): number {
  const a = Math.abs(v);
  if (a <= deadzone) return 0;
  return Math.sign(v) * ((a - deadzone) / (1 - deadzone));
}

export class GamepadController {
  private cx = 0;
  private cy = 0;
  private cursorInit = false;
  private digging = false;
  private prevButtons: boolean[] = [];
  enabled = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cam: CameraController,
    private readonly h: GamepadHandlers,
  ) {}

  poll(dt: number): void {
    if (!this.enabled || typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
    const pads = navigator.getGamepads();
    let pad: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]?.connected) {
        pad = pads[i];
        break;
      }
    }
    if (!pad) {
      if (this.digging) {
        this.digging = false;
        this.h.digEnd();
      }
      return;
    }

    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (!this.cursorInit) {
      this.cx = w * 0.5;
      this.cy = h * 0.5;
      this.cursorInit = true;
    }

    const step = Math.min(dt, 0.05);
    const lx = applyDeadzone(pad.axes[0] ?? 0);
    const ly = applyDeadzone(pad.axes[1] ?? 0);
    const rx = applyDeadzone(pad.axes[2] ?? 0);
    const ry = applyDeadzone(pad.axes[3] ?? 0);

    // Left stick: pan / look
    if (lx !== 0 || ly !== 0) {
      this.h.interacted();
      const speed = 420 * step;
      this.cam.panScreen(-lx * speed, -ly * speed, w * 0.5, h * 0.5);
    }

    // Right stick: virtual brush cursor
    if (rx !== 0 || ry !== 0) {
      this.h.interacted();
      const cursorSpeed = 540 * step;
      this.cx = Math.max(16, Math.min(w - 16, this.cx + rx * cursorSpeed));
      this.cy = Math.max(16, Math.min(h - 16, this.cy + ry * cursorSpeed));
      if (this.digging) this.h.digMove(this.cx, this.cy);
      else this.h.hover(this.cx, this.cy);
    }

    const pressed = (idx: number) => Boolean(pad!.buttons[idx]?.pressed || (pad!.buttons[idx]?.value ?? 0) > 0.35);
    const justPressed = (idx: number) => pressed(idx) && !this.prevButtons[idx];

    // Dig / place: A (0) or RT (7)
    const wantDig = pressed(0) || pressed(7);
    if (wantDig && !this.digging) {
      this.h.interacted();
      this.digging = true;
      this.h.digStart(this.cx, this.cy);
    } else if (wantDig && this.digging) {
      this.h.digMove(this.cx, this.cy);
    } else if (!wantDig && this.digging) {
      this.digging = false;
      this.h.digEnd();
    }

    // D-pad Up (12) / Down (13) or LT (6): zoom
    if (pressed(12)) {
      this.h.interacted();
      this.cam.zoomAt(Math.pow(0.45, step), w * 0.5, h * 0.5);
    } else if (pressed(13) || pressed(6)) {
      this.h.interacted();
      this.cam.zoomAt(Math.pow(2.2, step), w * 0.5, h * 0.5);
    }

    // Edge-triggered actions
    if (justPressed(4)) {
      this.h.interacted();
      this.h.cycleTool(-1);
    }
    if (justPressed(5)) {
      this.h.interacted();
      this.h.cycleTool(1);
    }
    if (justPressed(3)) {
      this.h.interacted();
      this.h.toggleView();
    }
    if (justPressed(1)) {
      this.h.interacted();
      this.h.undo();
    }
    if (justPressed(9)) {
      this.h.interacted();
      this.h.toggleSettings();
    }

    for (let i = 0; i < pad.buttons.length; i++) this.prevButtons[i] = pressed(i);
  }
}
