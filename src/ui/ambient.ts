import { steamBridge } from '../platform/runtime';

// Ambient ("TV") mode: after a few quiet seconds the controls fade away and
// the screen is kept awake, so the beach can sit on a TV or a tablet stand
// like a window. Any touch, mouse move or key (TV remote) brings them back.

interface WakeLockLike {
  release(): Promise<void>;
}

export class Ambient {
  enabled = false;
  private timer = 0;
  private lock: WakeLockLike | null = null;

  constructor(private readonly idleMs = 6000) {
    for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
      window.addEventListener(ev, () => this.poke(), { passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      // the browser drops the wake lock when the page is hidden
      if (this.enabled && !document.hidden) void this.wake();
    });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) void this.wake();
    else void this.lock?.release().catch(() => {});
    if (!on) this.lock = null;
    this.poke();
  }

  poke(): void {
    document.body.classList.remove('ambient-idle');
    window.clearTimeout(this.timer);
    if (this.enabled) this.timer = window.setTimeout(() => document.body.classList.add('ambient-idle'), this.idleMs);
  }

  private async wake(): Promise<void> {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> } };
      this.lock = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      /* not allowed here (or not supported): the screen may sleep */
    }
  }
}

export async function toggleFullscreen(): Promise<void> {
  const steam = steamBridge();
  if (steam) {
    try {
      await steam.toggleFullscreen();
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    else await document.exitFullscreen();
  } catch {
    /* refused (iOS Safari has no fullscreen for pages; installed PWAs already are) */
  }
}
