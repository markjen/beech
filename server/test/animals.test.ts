import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgDb, createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { TREAT_ITEM_ID } from '../src/animals.js';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL) {
    db = createPgDb({ url: process.env.TEST_DATABASE_URL });
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } else {
    db = await createPgliteDb();
  }
  await migrate(db);
  app = createApp(db, {
    googleClientIds: ['web'],
    appleClientIds: [],
    allowedOrigins: ['capacitor://localhost'],
    devAuth: true,
    rand: () => 0.01,
  });
});

afterAll(() => db.close());

const req = (path: string, init: RequestInit = {}, token?: string) =>
  app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
const json = (method: string, data: unknown): RequestInit => ({
  method,
  body: JSON.stringify(data),
  headers: { 'Content-Type': 'application/json' },
});

async function signIn(name: string) {
  const r = await req('/auth/dev', json('POST', { name }));
  expect(r.status).toBe(200);
  return (await r.json()) as { token: string; user: { id: string; name: string } };
}

describe('animals feeding (A2)', () => {
  it('requires sign-in to feed animals', async () => {
    const r = await req('/animals/feed', { method: 'POST' });
    expect(r.status).toBe(401);
  });

  it('returns 409 when the player has no beach snacks, and atomically consumes 1 when owned', async () => {
    const u = await signIn('CrabFeeder');
    const empty = await req('/animals/feed', { method: 'POST' }, u.token);
    expect(empty.status).toBe(409);

    // Grant 2 beach snacks via dev grant
    const grant = await req('/dev/grant', json('POST', { item: TREAT_ITEM_ID, quantity: 2 }), u.token);
    expect(grant.status).toBe(204);

    const first = await req('/animals/feed', { method: 'POST' }, u.token);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, remaining: 1 });

    const second = await req('/animals/feed', { method: 'POST' }, u.token);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, remaining: 0 });

    const third = await req('/animals/feed', { method: 'POST' }, u.token);
    expect(third.status).toBe(409);
  });

  it('grants a free bonus beach snack when a dig find hits and the roll succeeds', async () => {
    const u = await signIn('SnackDigger');
    const dig = await req('/dig-finds', json('POST', { pathM: 4, durationMs: 2000 }), u.token);
    expect(dig.status).toBe(200);
    const data = (await dig.json()) as { found: boolean; bonusTreat?: boolean };
    expect(data.found).toBe(true);
    expect(data.bonusTreat).toBe(true);

    const feed = await req('/animals/feed', { method: 'POST' }, u.token);
    expect(feed.status).toBe(200);
    expect(await feed.json()).toEqual({ ok: true, remaining: 0 });
  });
});
