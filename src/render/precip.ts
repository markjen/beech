import { WEATHER } from '../config';
import { rgbToCss, WEATHER_COLORS } from '../palette';
import type { WeatherLook } from '../world/weather';

/**
 * Rain and snow over the scene: a plain 2D canvas laid over the 3D one
 * (under the UI), drawn only while something is falling. Cheap on purpose:
 * a few hundred short strokes, no textures, and nothing at all when dry.
 */
export class Precipitation {
  readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private drops: { x: number; y: number; z: number }[] = [];
  private shown = false;
  private w = 0;
  private h = 0;

  constructor(parent: HTMLElement, before: Element | null) {
    this.el = document.createElement('canvas');
    this.el.className = 'precip';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.hidden = true;
    parent.insertBefore(this.el, before);
    this.ctx = this.el.getContext('2d');
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < WEATHER.maxDrops; i++) this.drops.push({ x: rnd(), y: rnd(), z: 0.35 + rnd() * 0.65 });
  }

  /** `look` from the view's weather; `dt` in seconds; `night` dims the streaks. */
  update(look: WeatherLook, dt: number, night: number, enabled = true): void {
    const amount = enabled ? look.rain : 0;
    if (amount < 0.02 || !this.ctx) {
      if (this.shown) {
        this.shown = false;
        this.el.hidden = true;
      }
      return;
    }
    if (!this.shown) {
      this.shown = true;
      this.el.hidden = false;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(this.el.clientWidth * dpr);
    const ch = Math.round(this.el.clientHeight * dpr);
    if (cw !== this.w || ch !== this.h) {
      this.w = this.el.width = cw;
      this.h = this.el.height = ch;
    }
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const n = Math.round(this.drops.length * amount);
    const snow = look.snow;
    // screen heights per second: rain falls fast, snow drifts
    const fall = snow ? 0.12 : 1.6;
    const slant = look.wind * (snow ? 0.25 : 0.35);
    const len = (snow ? 0 : 0.035) * h;
    const alpha = (snow ? 0.85 : 0.35) * (1 - 0.45 * night);
    ctx.strokeStyle = rgbToCss(snow ? WEATHER_COLORS.snow : WEATHER_COLORS.rain, alpha);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const d = this.drops[i];
      d.y += fall * d.z * dt;
      d.x += slant * fall * d.z * dt + (snow ? Math.sin((d.y + i) * 9) * 0.0008 : 0);
      if (d.y > 1) {
        d.y -= 1;
        d.x = (d.x + 0.37) % 1;
      }
      d.x = ((d.x % 1) + 1) % 1;
      const x = d.x * w;
      const y = d.y * h;
      if (snow) {
        const r = 1.2 * dpr * d.z + 0.4;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      } else {
        ctx.moveTo(x, y);
        ctx.lineTo(x - slant * len * d.z * 2, y - len * d.z);
      }
    }
    if (snow) ctx.fill();
    else ctx.stroke();
  }
}
