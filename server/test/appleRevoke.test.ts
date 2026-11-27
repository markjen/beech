// Apple token exchange on sign-in / identity attach and revocation on
// DELETE /account (App Store guideline 5.1.1(v)).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import { openTestDb } from './testDb.js';

let db: Db;
let app: ReturnType<typeof createApp>;
let exchanged: { code: string; clientId: string; redirectUri?: string }[];
let revoked: { refreshToken: string; clientId: string }[];
let failExchange = false;
let failRevoke = false;

beforeAll(async () => {
  db = await openTestDb();
  app = createApp(db, {
    googleClientIds: [],
    appleClientIds: ['app.beech.beach', 'app.beech.beach.web'],
    allowedOrigins: [],
    devAuth: true,
    verifyApple: async (token, _ids, name = '') => {
      // format: "apple:<clientId>:<sub>"
      const [, clientId, sub] = token.split(':');
      if (!clientId || !sub) throw new Error('bad apple token');
      return { provider: 'apple', sub, name: name || 'Apple Player', clientId };
    },
    appleTokenExchange: async (code, clientId, redirectUri) => {
      exchanged.push({ code, clientId, redirectUri });
      if (failExchange) throw new Error('apple down');
      return `rft-${code}`;
    },
    appleTokenRevoke: async (refreshToken, clientId) => {
      revoked.push({ refreshToken, clientId });
      if (failRevoke) throw new Error('apple revoke down');
    },
  });
});

beforeEach(() => {
  exchanged = [];
  revoked = [];
  failExchange = false;
  failRevoke = false;
});

afterAll(async () => {
  await db?.close();
});

const req = (path: string, method: string, body?: unknown, token?: string) =>
  app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('Apple token revocation on account delete', () => {
  it('exchanges the auth code on POST /auth/apple and revokes it on DELETE /account', async () => {
    const signIn = await req('/auth/apple', 'POST', {
      identityToken: 'apple:app.beech.beach:ios-user-1',
      name: 'Ada',
      authorizationCode: 'code-ios-1',
    });
    expect(signIn.status).toBe(200);
    const { token, user } = (await signIn.json()) as { token: string; user: { id: string } };
    expect(exchanged).toEqual([{ code: 'code-ios-1', clientId: 'app.beech.beach', redirectUri: undefined }]);

    const del = await req('/account', 'DELETE', undefined, token);
    expect(del.status).toBe(204);
    expect(revoked).toEqual([{ refreshToken: 'rft-code-ios-1', clientId: 'app.beech.beach' }]);
    const remaining = await db.query('SELECT id FROM users WHERE id = $1', [user.id]);
    expect(remaining).toHaveLength(0);
  });

  it('exchanges the web auth code with redirectUri on POST /api/account/identities and revokes on DELETE /account', async () => {
    const dev = (await (await req('/auth/dev', 'POST', { name: 'WebLinker' })).json()) as { token: string };
    const attach = await req(
      '/api/account/identities',
      'POST',
      {
        provider: 'apple',
        credential: 'apple:app.beech.beach.web:web-user-1',
        name: 'Grace',
        authorizationCode: 'code-web-1',
        redirectUri: 'https://play.beech.games/',
      },
      dev.token,
    );
    expect(attach.status).toBe(200);
    expect(exchanged).toEqual([
      { code: 'code-web-1', clientId: 'app.beech.beach.web', redirectUri: 'https://play.beech.games/' },
    ]);

    const del = await req('/account', 'DELETE', undefined, dev.token);
    expect(del.status).toBe(204);
    expect(revoked).toEqual([{ refreshToken: 'rft-code-web-1', clientId: 'app.beech.beach.web' }]);
  });

  it('preserves the Apple refresh token across account merge so deleting the survivor still revokes it', async () => {
    const survivor = (await (await req('/auth/dev', 'POST', { name: 'Survivor' })).json()) as { token: string };
    const appleUser = (await (
      await req('/auth/apple', 'POST', {
        identityToken: 'apple:app.beech.beach:merged-apple',
        authorizationCode: 'code-merged',
      })
    ).json()) as { token: string };

    const { code } = (await (await req('/account/link-code', 'POST', {}, survivor.token)).json()) as { code: string };
    const merged = await req('/account/link', 'POST', { code }, appleUser.token);
    expect(merged.status).toBe(200);
    const { token: survivorToken } = (await merged.json()) as { token: string };

    const del = await req('/account', 'DELETE', undefined, survivorToken);
    expect(del.status).toBe(204);
    expect(revoked).toEqual([{ refreshToken: 'rft-code-merged', clientId: 'app.beech.beach' }]);
  });

  it('does not block sign-in if Apple token exchange fails, and does not block account delete if revoke fails', async () => {
    failExchange = true;
    const signIn = await req('/auth/apple', 'POST', {
      identityToken: 'apple:app.beech.beach:resilient-1',
      authorizationCode: 'code-fail',
    });
    expect(signIn.status).toBe(200);
    const { token } = (await signIn.json()) as { token: string };
    expect((await req('/account', 'DELETE', undefined, token)).status).toBe(204);
    expect(revoked).toEqual([]);

    failExchange = false;
    const signIn2 = await req('/auth/apple', 'POST', {
      identityToken: 'apple:app.beech.beach:resilient-2',
      authorizationCode: 'code-ok',
    });
    const { token: token2, user: user2 } = (await signIn2.json()) as { token: string; user: { id: string } };
    failRevoke = true;
    expect((await req('/account', 'DELETE', undefined, token2)).status).toBe(204);
    expect(revoked).toEqual([{ refreshToken: 'rft-code-ok', clientId: 'app.beech.beach' }]);
    expect(await db.query('SELECT id FROM users WHERE id = $1', [user2.id])).toHaveLength(0);
  });
});
