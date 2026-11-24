import { isMobileApp } from './runtime';

type Impact = 'light' | 'medium';

/**
 * Soft haptics. Native apps (Capacitor) use the Taptic Engine / vibrator via
 * @capacitor/haptics; Android browsers fall back to navigator.vibrate; iOS
 * Safari has no web vibration API, so it is silent there.
 */
export class Haptics {
  enabled = true;
  private native: typeof import('@capacitor/haptics') | null = null;
  private lastTick = 0;

  constructor() {
    if (isMobileApp()) {
      import('@capacitor/haptics')
        .then((m) => (this.native = m))
        .catch(() => {});
    }
  }

  impact(kind: Impact = 'light'): void {
    if (!this.enabled) return;
    if (this.native) {
      const { Haptics: H, ImpactStyle } = this.native;
      void H.impact({ style: kind === 'light' ? ImpactStyle.Light : ImpactStyle.Medium }).catch(() => {});
    } else if ('vibrate' in navigator) {
      try {
        navigator.vibrate(kind === 'light' ? 6 : 14);
      } catch {
        /* ignore */
      }
    }
  }

  /** Called every frame while digging: ticks faster the harder you dig. */
  dig(intensity: number): void {
    if (!this.enabled || intensity < 0.05) return;
    const now = performance.now();
    const interval = 150 - intensity * 90;
    if (now - this.lastTick < interval) return;
    this.lastTick = now;
    if (this.native) {
      void this.native.Haptics.selectionChanged().catch(() => {});
    } else if ('vibrate' in navigator) {
      try {
        navigator.vibrate(4);
      } catch {
        /* ignore */
      }
    }
  }
}
