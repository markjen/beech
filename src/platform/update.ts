import { Capacitor } from '@capacitor/core';

// "A new version is ready": an open tab asks the server now and then which
// build is live (./version.json, written by the build next to index.html;
// see vite.config.ts) and compares it with the build it is running (the
// beech-build meta tag in index.html). Web build only: the native apps
// ship their own copy and update through the stores.

/** how often an open, visible tab checks */
const CHECK_MS = 5 * 60_000;
/** at most one check this often (focus / online events come in bursts) */
const MIN_GAP_MS = 30_000;

/** The build this page is running: a hash of the built file names, or 'dev'. */
export function currentBuild(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="beech-build"]')?.content || 'dev';
}

/**
 * Call `onNew` once, when the live build differs from this page's. Checks
 * every few minutes while the tab is visible, and when it comes back into
 * view or online. Does nothing in dev builds and in the native apps.
 */
export function watchForUpdates(onNew: () => void): void {
  const mine = currentBuild();
  if (!import.meta.env.PROD || mine === 'dev' || Capacitor.isNativePlatform()) return;
  let told = false;
  let last = 0;
  const check = async () => {
    if (told || document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - last < MIN_GAP_MS) return;
    last = now;
    try {
      const res = await fetch('./version.json', { cache: 'no-store' });
      if (!res.ok) return;
      const { build } = (await res.json()) as { build?: unknown };
      if (told || typeof build !== 'string' || !build || build === mine) return;
      told = true;
      onNew();
    } catch {
      /* offline or mid-deploy: try again next time */
    }
  };
  window.setInterval(() => void check(), CHECK_MS);
  document.addEventListener('visibilitychange', () => void check());
  window.addEventListener('online', () => void check());
}
