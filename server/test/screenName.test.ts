import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { checkScreenName, SCREEN_NAME_MAX } from '../src/inbox.js';
import { createRootApp } from '../src/rootApp.js';
import { openTestDb } from './testDb.js';

describe('checkScreenName', () => {
  it('accepts normal screen names and collapses whitespace', () => {
    expect(checkScreenName('  Captain   Crab 42 ')).toEqual({ ok: true, text: 'Captain Crab 42' });
    expect(checkScreenName('a'.repeat(SCREEN_NAME_MAX))).toEqual({ ok: true, text: 'a'.repeat(SCREEN_NAME_MAX) });
  });

  it('rejects empty, non-string, too long, links, handles, phone numbers, and blocked words', () => {
    expect(checkScreenName(123)).toMatchObject({ ok: false });
    expect(checkScreenName('   ')).toMatchObject({ ok: false });
    expect(checkScreenName('a'.repeat(SCREEN_NAME_MAX + 1))).toMatchObject({ ok: false });
    expect(checkScreenName('visit example.com')).toMatchObject({ ok: false });
    expect(checkScreenName('@sandy')).toMatchObject({ ok: false });
    expect(checkScreenName('555-123-4567')).toMatchObject({ ok: false });
    expect(checkScreenName('sh1t head')).toMatchObject({ ok: false });
  });
});

describe('screen names API', () => {
  let db: Db;
  let root: ReturnType<typeof createRootApp>;
  let mockGoogleName = 'RealFirst';

  beforeAll(async () => {
    db = await openTestDb();
    const api = createApp(db, {
      googleClientIds: ['test-google-client'],
      appleClientIds: [],
      allowedOrigins: [],
      devAuth: true,
      verifyGoogle: async (token) => ({
        provider: 'google',
        sub: token,
        name: mockGoogleName,
        email: `${token}@example.test`,
      }),
    });
    root = createRootApp(db, api, '/no-static-files-needed');
  });

  afterAll(() => db?.close());

  const req = (path: string, init?: RequestInit) => root.request('/api' + path, init);
  const json = (method: string, path: string, body: unknown, token?: string) =>
    req(path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

  it('lets a player choose a screen name and keeps it across subsequent sign-ins', async () => {
    mockGoogleName = 'Alice';
    const first = await json('POST', '/auth/google', { credential: 'sub-keep' });
    expect(first.status).toBe(200);
    const s1 = (await first.json()) as { token: string; user: { id: string; name: string } };
    expect(s1.user.name).toBe('Alice');

    // Before choosing a screen name, provider name updates still flow through
    mockGoogleName = 'Alicia';
    const refreshed = await json('POST', '/auth/google', { credential: 'sub-keep' });
    const s2 = (await refreshed.json()) as { token: string; user: { id: string; name: string } };
    expect(s2.user.name).toBe('Alicia');

    // Choose a screen name
    const patch = await json('PATCH', '/me', { name: '  Sandy   Shells ' }, s2.token);
    expect(patch.status).toBe(200);
    expect(await patch.json()).toEqual({ user: { id: s2.user.id, name: 'Sandy Shells' } });

    // GET /me returns the chosen screen name
    const me = await req('/me', { headers: { Authorization: `Bearer ${s2.token}` } });
    expect(await me.json()).toEqual({ user: { id: s2.user.id, name: 'Sandy Shells' } });

    // Signing in again with Google does NOT overwrite the chosen screen name
    mockGoogleName = 'Alice Realname';
    const again = await json('POST', '/auth/google', { credential: 'sub-keep' });
    const s3 = (await again.json()) as { token: string; user: { id: string; name: string } };
    expect(s3.user.name).toBe('Sandy Shells');
  });

  it('rejects invalid screen names and unauthenticated requests', async () => {
    const unauth = await json('PATCH', '/me', { name: 'Sandy' });
    expect(unauth.status).toBe(401);

    const sign = await json('POST', '/auth/dev', { name: 'validator-user' });
    const { token } = (await sign.json()) as { token: string };

    expect((await json('PATCH', '/me', { name: '' }, token)).status).toBe(400);
    expect((await json('PATCH', '/me', { name: 'x'.repeat(SCREEN_NAME_MAX + 1) }, token)).status).toBe(400);
    expect((await json('PATCH', '/me', { name: 'https://spam.example' }, token)).status).toBe(400);
  });

  it('supports updating screen name via beechshore /account/api/name', async () => {
    const sign = await json('POST', '/auth/dev', { name: 'shore-name-user' });
    const { token, user } = (await sign.json()) as { token: string; user: { id: string; name: string } };
    const connect = await json('POST', '/item-submissions/connect', {}, token);
    const { token: shoreToken } = (await connect.json()) as { token: string };

    const res = await root.request('https://beechshore.com/account/api/name', {
      method: 'PATCH',
      headers: {
        Host: 'beechshore.com',
        Authorization: `Bearer ${shoreToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Tide Walker' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: user.id, name: 'Tide Walker' } });

    const me = await req('/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(await me.json()).toEqual({ user: { id: user.id, name: 'Tide Walker' } });
  });

  it('preserves a chosen screen name across account merge', async () => {
    mockGoogleName = 'RealSurvivor';
    const survRes = await json('POST', '/auth/google', { credential: 'sub-merge-surv' });
    const surv = (await survRes.json()) as { token: string; user: { id: string; name: string } };

    mockGoogleName = 'RealAbsorbed';
    const absRes = await json('POST', '/auth/google', { credential: 'sub-merge-abs' });
    const abs = (await absRes.json()) as { token: string; user: { id: string; name: string } };

    // Absorbed player chose a screen name; survivor did not
    expect((await json('PATCH', '/me', { name: 'Pebble King' }, abs.token)).status).toBe(200);

    const codeRes = await json('POST', '/account/link-code', {}, surv.token);
    const { code } = (await codeRes.json()) as { code: string };
    const linkRes = await json('POST', '/account/link', { code, confirm: true }, abs.token);
    expect(linkRes.status).toBe(200);
    const linked = (await linkRes.json()) as { token: string; user: { id: string; name: string } };
    expect(linked.user.id).toBe(surv.user.id);
    expect(linked.user.name).toBe('Pebble King');

    // Subsequent sign-in still keeps the merged chosen screen name
    mockGoogleName = 'RealSurvivorAgain';
    const after = await json('POST', '/auth/google', { credential: 'sub-merge-surv' });
    const afterJson = (await after.json()) as { user: { name: string } };
    expect(afterJson.user.name).toBe('Pebble King');
  });
});
