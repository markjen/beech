// Is a newer version of the web app out? A tab left open across a deploy
// keeps running old code; worse, an old app can save data in a shape the
// new server no longer accepts (the server says 426). The build writes its
// id to version.json (vite.config.ts); the app knows its own.

declare const __APP_BUILD__: string;

/** this app's build id ("dev" when run from the dev server) */
export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

/** The newest build's id, from version.json (null if it can't be read). */
export async function latestBuild(fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchFn(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { build?: unknown };
    return typeof data.build === 'string' ? data.build : null;
  } catch {
    return null;
  }
}

/** A newer build than this one? (Unknown or the same: no.) */
export function isNewer(latest: string | null, mine = APP_BUILD): boolean {
  return !!latest && mine !== 'dev' && latest !== mine;
}

/**
 * Check for a newer build now and then (every `everyMs`, and whenever the tab
 * comes back to the front), and call `onNew` once when there is one. The
 * phone apps carry their web code inside, so they don't watch: their updates
 * come through the stores.
 */
export function watchForNewVersion(onNew: () => void, everyMs = 10 * 60 * 1000): () => void {
  let told = false;
  const check = async () => {
    if (told) return;
    if (isNewer(await latestBuild())) {
      told = true;
      onNew();
    }
  };
  const timer = window.setInterval(() => void check(), everyMs);
  const vis = () => {
    if (document.visibilityState === 'visible') void check();
  };
  document.addEventListener('visibilitychange', vis);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', vis);
  };
}
