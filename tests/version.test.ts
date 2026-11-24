import { describe, expect, it } from 'vitest';
import { appInfo, formatAppVersion, isNewer, latestBuild, resolveAppInfo, syncAppInfo } from '../src/platform/version';

describe('app version line', () => {
  it('reads "beech 1.0.0 · build 2 · android" on a store build, with the commit', () => {
    expect(formatAppVersion({ version: '1.0.0', build: '2', platform: 'android', commit: '9e5117a3f2c1' })).toBe(
      'beech 1.0.0 · build 2 · android · 9e5117a3f2c1',
    );
  });
  it('shows the bundle build id on web, where there is no store build', () => {
    expect(formatAppVersion({ version: '1.0.0', build: '9e5117a3f2c1', platform: 'web' })).toBe(
      'beech 1.0.0 · build 9e5117a3f2c1 · web',
    );
  });
  it('shows dev values under the dev server', () => {
    expect(formatAppVersion({ version: 'dev', build: 'dev', platform: 'web' })).toBe('beech dev · build dev · web');
  });

  it('resolves to the bundle ids on web, with no native shell involved', async () => {
    const info = await resolveAppInfo('web');
    expect(info).toEqual({ version: 'dev', build: 'dev', platform: 'web' });
    expect(syncAppInfo()).toEqual({ version: 'dev', build: 'dev', platform: 'web' });
  });
  it('takes the store version and build number from the native shell', async () => {
    const info = await resolveAppInfo('android', async () => ({ version: '1.0.0', build: '2' }));
    expect(info).toEqual({ version: '1.0.0', build: '2', platform: 'android', commit: undefined });
  });
  it('falls back to the bundle ids when the shell will not answer', async () => {
    const refused = async () => {
      throw new Error('no plugin');
    };
    expect(await resolveAppInfo('ios', refused)).toEqual({ version: 'dev', build: 'dev', platform: 'ios' });
    expect(await resolveAppInfo('android', async () => ({ version: '', build: '' }))).toEqual({
      version: 'dev',
      build: 'dev',
      platform: 'android',
      commit: undefined,
    });
  });
  it('remembers the answer', async () => {
    expect(await appInfo()).toBe(await appInfo());
  });
});

describe('a newer version', () => {
  it('is newer only when the server has a different, known build', () => {
    expect(isNewer('abc', 'def')).toBe(true);
    expect(isNewer('abc', 'abc')).toBe(false);
    expect(isNewer(null, 'abc')).toBe(false);
    expect(isNewer('abc', 'dev')).toBe(false); // the dev server never nags
  });
  it('reads version.json, and shrugs off failures', async () => {
    const ok = (async () => new Response(JSON.stringify({ build: 'b2' }))) as unknown as typeof fetch;
    expect(await latestBuild(ok)).toBe('b2');
    const down = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    expect(await latestBuild(down)).toBe(null);
    const offline = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await latestBuild(offline)).toBe(null);
  });
});
