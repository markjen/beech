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
    expect(await first.json()).toMatchObject({ ok: true, remaining: 1 });

    const second = await req('/animals/feed', { method: 'POST' }, u.token);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, remaining: 0 });

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
    const body = (await feed.json()) as { ok: boolean; remaining: number };
    expect(body.ok).toBe(true);
    expect(body.remaining).toBe(0);
  });
});

import { BEFRIEND_FEED_THRESHOLD, PET_CRAB_ITEM_ID, petMood } from '../src/animals.js';

describe('resident pets (A3)', () => {
  it('computes cozy pet moods from elapsed time since last feed', () => {
    const h = 3600 * 1000;
    const t0 = 1_700_000_000_000;
    expect(petMood(t0, t0 + 2 * h)).toBe('happy');
    expect(petMood(t0, t0 + 16 * h)).toBe('peckish');
    expect(petMood(t0, t0 + 30 * h)).toBe('hungry');
    expect(petMood(t0, t0 + 72 * h)).toBe('sleepy');
  });

  it('lets a player befriend a wild sand crab after feeding enough times, then rename and feed it', async () => {
    const u = await signIn('Befriender');
    // Cannot adopt via befriend before threshold
    const early = await req('/pet/adopt', json('POST', { mode: 'befriend', name: 'Pinchy' }), u.token);
    expect(early.status).toBe(409);

    // Grant enough snacks to hit threshold + 1 extra for feeding after adoption
    expect((await req('/dev/grant', json('POST', { item: TREAT_ITEM_ID, quantity: BEFRIEND_FEED_THRESHOLD + 1 }), u.token)).status).toBe(204);

    let ready = false;
    for (let i = 0; i < BEFRIEND_FEED_THRESHOLD; i++) {
      const r = await req('/animals/feed', { method: 'POST' }, u.token);
      expect(r.status).toBe(200);
      const d = (await r.json()) as { bond?: { feedCount: number; ready: boolean } };
      expect(d.bond?.feedCount).toBe(i + 1);
      ready = Boolean(d.bond?.ready);
    }
    expect(ready).toBe(true);

    const adopted = await req('/pet/adopt', json('POST', { mode: 'befriend', name: 'Barnaby' }), u.token);
    expect(adopted.status).toBe(200);
    const { pet } = (await adopted.json()) as { pet: { name: string; source: string; mood: string; fedCount: number } };
    expect(pet.name).toBe('Barnaby');
    expect(pet.source).toBe('befriended');
    expect(pet.mood).toBe('happy');

    // Feeding now feeds the resident pet
    expect((await req('/dev/grant', json('POST', { item: TREAT_ITEM_ID, quantity: 1 }), u.token)).status).toBe(204);
    const fed = await req('/animals/feed', { method: 'POST' }, u.token);
    expect(fed.status).toBe(200);
    const fedData = (await fed.json()) as { pet?: { fedCount: number } };
    expect(fedData.pet?.fedCount).toBe(2);

    // Rename works
    const renamed = await req('/pet', json('PATCH', { name: 'Captain Pinch' }), u.token);
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { pet: { name: string } }).pet.name).toBe('Captain Pinch');
  });

  it('lets a player adopt a pet immediately from the shop item', async () => {
    const u = await signIn('ShopAdopter');
    expect((await req('/pet/adopt', json('POST', { mode: 'shop' }), u.token)).status).toBe(409);

    expect((await req('/dev/grant', json('POST', { item: PET_CRAB_ITEM_ID, quantity: 1 }), u.token)).status).toBe(204);
    const adopted = await req('/pet/adopt', json('POST', { mode: 'shop', name: 'Coral' }), u.token);
    expect(adopted.status).toBe(200);
    const { pet } = (await adopted.json()) as { pet: { name: string; source: string } };
    expect(pet.name).toBe('Coral');
    expect(pet.source).toBe('shop');

    // Cannot adopt a second pet on the same beach
    expect((await req('/pet/adopt', json('POST', { mode: 'shop' }), u.token)).status).toBe(409);
  });
});
