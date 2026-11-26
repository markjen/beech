// Is a newer version of the web app out? A tab left open across a deploy
// keeps running old code; worse, an old app can save data in a shape the
// new server no longer accepts (the server says 426). The build writes its
// id to version.json (vite.config.ts); the app knows its own.

import { getRuntime, type Runtime } from './runtime';

declare const __APP_BUILD__: string;
declare const __APP_VERSION__: string;

/** this app's build id ("dev" when run from the dev server) */
export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

/** the marketing version from package.json ("dev" when run from the dev server) */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** What this build is, in one place, for the settings sheet and bug reports. */
export interface AppInfo {
  /** marketing version, e.g. "1.0.0" */
  version: string;
  /**
   * native build number (Android versionCode / iOS CURRENT_PROJECT_VERSION),
   * or the bundle's build id on web, where there is no store build.
   */
  build: string;
  platform: Runtime;
  /** the git commit the bundle was built from, when the build carries one */
  commit?: string;
}

/** "beech 1.0.0 · build 2 · android", plus the commit when the build carries one. */
export function formatAppVersion(info: AppInfo): string {
  const base = `beech ${info.version} · build ${info.build} · ${info.platform}`;
  return info.commit ? `${base} · ${info.commit}` : base;
}

/** The build id Vite stamps in is the commit on CI builds (GITHUB_SHA, 12 hex). */
function buildCommit(build = APP_BUILD): string | undefined {
  return /^[0-9a-f]{12}$/.test(build) ? build : undefined;
}

/**
 * The best-known info without asking the native shell: exact on web and
 * Steam. On native the build is the bundle's id until resolveAppInfo()
 * asks the shell for its store build number.
 */
export function syncAppInfo(): AppInfo {
  return { version: APP_VERSION, build: APP_BUILD, platform: getRuntime() };
}

type NativeInfo = { version: string; build: string };

/**
 * The app's info, asking the native shell for its store version/build on
 * iOS and Android (the numbers the stores show, so a bug report can say
 * "build 2" and mean it). Anything the shell won't say falls back to the
 * bundle's own version and build id — the same id the X-App-Build header
 * carries, so what the sheet shows is never a third, made-up number.
 * `getInfo` is injectable so tests can stand in for the native shell.
 */
export async function resolveAppInfo(
  platform: Runtime = getRuntime(),
  getInfo: () => Promise<NativeInfo> = async () => {
    const { App } = await import('@capacitor/app');
    return App.getInfo();
  },
): Promise<AppInfo> {
  if (platform !== 'ios' && platform !== 'android') {
    return { version: APP_VERSION, build: APP_BUILD, platform };
  }
  try {
    const info = await getInfo();
    return {
      version: info.version || APP_VERSION,
      build: info.build || APP_BUILD,
      platform,
      commit: buildCommit(),
    };
  } catch {
    return { version: APP_VERSION, build: APP_BUILD, platform };
  }
}

/** The app's info, asked of the native shell once and then remembered. */
let cached: Promise<AppInfo> | undefined;
export function appInfo(): Promise<AppInfo> {
  return (cached ??= resolveAppInfo());
}


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
 * comes back to the front), and call `onNew` once when there is one.
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
