// Attach another sign-in to the account you're already signed into
// (POST /api/account/identities), and what the beechshore account page
// may read through its short-lived token (GET /shore-account/identities).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import { createRootApp } from '../src/rootApp.js';
import { openTestDb } from './testDb.js';

const shore = 'https://beechshore.com';
let db: Db;
let app: ReturnType<typeof createApp>;
let root: ReturnType<typeof createRootApp>;

beforeAll(async () => {
  db = await openTestDb();
  app = createApp(db, {
    googleClientIds: [],
    appleClientIds: [],
    allowedOrigins: ['app://beech'],
    devAuth: true,
    steamAuth: { appId: '480', webApiKey: 'test-steam-key' },
    verifyGoogle: async (token) => {
      if (!token.startsWith('google-')) throw new Error('bad google token');
      const sub = token.slice('google-'.length);
      return { provider: 'google', sub, name: 'Google Player', email: `${sub}@example.com` };
    },
    verifyApple: async (token, _ids, name = '') => {
      if (!token.startsWith('apple-')) throw new Error('bad apple token');
      return { provider: 'apple', sub: token.slice('apple-'.length), name: name || 'Apple Player' };
    },
    verifySteam: async (ticket, _cfg, name = '') => {
      if (!ticket.startsWith('steam-')) throw new Error('rejected');
      return { provider: 'steam', sub: ticket.slice('steam-'.length), name: name || 'Steam Player' };
    },
  });
  root = createRootApp(db, app, '/no-static-files-needed');
});

afterAll(async () => {
  await db?.close();
});

const req = (path: string, method: string, body: unknown, token?: string) =>
  app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const post = (path: string, body: unknown, token?: string) => req(path, 'POST', body, token);
const get = (path: string, token?: string) => req(path, 'GET', undefined, token);

async function devUser(name: string) {
  const r = await post('/auth/dev', { name });
  const d = (await r.json()) as { token: string; user: { id: string; name: string } };
  return d;
}

describe('attach a sign-in to your own account', () => {
  it('lists no identities for a fresh account, then the attached ones', async () => {
    const u = await devUser('Lister');
    expect((await get('/api/account/identities')).status).toBe(401);
    expect(((await (await get('/api/account/identities', u.token)).json()) as { identities: string[] }).identities).toEqual([]);

    const r = await post('/api/account/identities', { provider: 'google', credential: 'google-alice' }, u.token);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { identities: string[] }).identities).toEqual(['google']);
    expect(((await (await get('/api/account/identities', u.token)).json()) as { identities: string[] }).identities).toEqual(['google']);
  });

  it('a later sign-in with the attached identity resolves to the same account', async () => {
    const u = await devUser('Attacher');
    await post('/api/account/identities', { provider: 'google', credential: 'google-bob' }, u.token);
    const again = await post('/auth/google', { credential: 'google-bob' });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { user: { id: string } }).user.id).toBe(u.user.id);
  });

  it('attaching the same identity twice is idempotent', async () => {
    const u = await devUser('Twice');
    expect((await post('/api/account/identities', { provider: 'apple', credential: 'apple-carol', name: 'Carol' }, u.token)).status).toBe(200);
    const again = await post('/api/account/identities', { provider: 'apple', credential: 'apple-carol', name: 'Carol' }, u.token);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { identities: string[] }).identities).toEqual(['apple']);
    const rows = await db.query('SELECT COUNT(*)::text AS n FROM user_identities WHERE user_id = $1 AND provider = $2', [u.user.id, 'apple']);
    expect(rows[0].n).toBe('1');
  });

  it('attaches Apple and Steam the same way, and lists them sorted', async () => {
    const u = await devUser('AllThree');
    await post('/api/account/identities', { provider: 'steam', credential: 'steam-dave' }, u.token);
    await post('/api/account/identities', { provider: 'apple', credential: 'apple-dave' }, u.token);
    await post('/api/account/identities', { provider: 'google', credential: 'google-dave' }, u.token);
    expect(((await (await get('/api/account/identities', u.token)).json()) as { identities: string[] }).identities).toEqual([
      'apple',
      'google',
      'steam',
    ]);
  });

  it('refuses an identity that already belongs to another account, and leaves both alone', async () => {
    const a = await devUser('Owner');
    const b = await devUser('Other');
    await post('/api/account/identities', { provider: 'google', credential: 'google-erin' }, a.token);
    const r = await post('/api/account/identities', { provider: 'google', credential: 'google-erin' }, b.token);
    expect(r.status).toBe(409);
    const err = ((await r.json()) as { error: string }).error;
    expect(err).toMatch(/already linked to another Beech account/);
    expect(err).toMatch(/link code/);
    // neither account changed: a still has it, b still has nothing
    expect(((await (await get('/api/account/identities', a.token)).json()) as { identities: string[] }).identities).toEqual(['google']);
    expect(((await (await get('/api/account/identities', b.token)).json()) as { identities: string[] }).identities).toEqual([]);
    // and the identity still signs into a's account
    const again = await post('/auth/google', { credential: 'google-erin' });
    expect(((await again.json()) as { user: { id: string } }).user.id).toBe(a.user.id);
  });

  it('rejects bad credentials, unknown providers, and missing fields', async () => {
    const u = await devUser('Picky');
    expect((await post('/api/account/identities', { provider: 'google', credential: 'not-a-google-token' }, u.token)).status).toBe(401);
    expect((await post('/api/account/identities', { provider: 'facebook', credential: 'x' }, u.token)).status).toBe(400);
    expect((await post('/api/account/identities', { provider: 'google' }, u.token)).status).toBe(400);
    expect((await post('/api/account/identities', { credential: 'google-x' }, u.token)).status).toBe(400);
  });
});

describe('the beechshore account page and the shore token', () => {
  const accountApi = (path: string, token?: string, data?: unknown) =>
    root.request(`${shore}/account/api${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        Host: 'beechshore.com',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });

  async function scopedUser(name: string) {
    const u = await devUser(name);
    const scoped = ((await (await post('/item-submissions/connect', {}, u.token)).json()) as { token: string }).token;
    return { ...u, scoped };
  }

  it('the shore token can read connected sign-ins, but cannot attach one', async () => {
    const u = await scopedUser('ShoreReader');
    await post('/api/account/identities', { provider: 'google', credential: 'google-fay' }, u.token);
    const read = await accountApi('/identities', u.scoped);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { identities: string[] }).identities).toEqual(['google']);
    // attaching needs the game session: the shore token gets nothing here
    expect((await accountApi('/identities', u.scoped, { provider: 'apple', credential: 'apple-fay' })).status).toBe(404);
    expect((await root.request('/api/shore-account/identities', {
      method: 'POST',
      headers: { Authorization: `Bearer ${u.scoped}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'apple', credential: 'apple-fay' }),
    })).status).toBe(404);
    // and the failed attach changed nothing
    expect(((await (await get('/api/account/identities', u.token)).json()) as { identities: string[] }).identities).toEqual(['google']);
  });
});
