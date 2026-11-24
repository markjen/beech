import { describe, expect, it } from 'vitest';
import { isNewer, latestBuild } from '../src/platform/version';

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
