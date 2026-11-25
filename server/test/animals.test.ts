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

  it('does not spend a snack when feeding on a beach the player does not own', async () => {
    const owner = await signIn('SnackOwner');
    const other = await signIn('SnackThief');
    const ownerBeach = owner.user.id; // a home beach's id is its owner's id
    await req('/dev/grant', json('POST', { item: TREAT_ITEM_ID, quantity: 1 }), other.token);
    const bad = await req('/animals/feed', json('POST', { beachId: ownerBeach }), other.token);
    expect(bad.status).toBe(404);
    const ok = await req('/animals/feed', { method: 'POST' }, other.token);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, remaining: 0 });
  });

  it('grants a free bonus beach snack when a dig find hits and the roll succeeds', async () => {
    const u = await signIn('SnackDigger');
    const edit = ((await (await req('/edit-session', { method: 'POST' }, u.token)).json()) as { token: string }).token;
    const dig = await req('/dig-finds', { ...json('POST', { pathM: 4, durationMs: 2000 }), headers: { 'Content-Type': 'application/json', 'X-Edit-Token': edit } }, u.token);
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

describe('visitor pet feeding (A4)', () => {
  it('allows 1 free feed per beach per UTC day, then requires the visitor to spend their own snack, and logs recentFeeders', async () => {
    const owner = await signIn('PetOwner');
    const visitor = await signIn('FriendlyVisitor');

    // Adopt a pet on owner's home beach
    expect((await req('/dev/grant', json('POST', { item: PET_CRAB_ITEM_ID, quantity: 1 }), owner.token)).status).toBe(204);
    expect((await req('/pet/adopt', json('POST', { mode: 'shop', name: 'Shelly' }), owner.token)).status).toBe(200);

    // Fetch owner's beach code
    const mineRes = await req('/beaches/mine', {}, owner.token);
    expect(mineRes.status).toBe(200);
    const code = ((await mineRes.json()) as { beaches: { code: string }[] }).beaches[0].code;

    // Signed-out visitor can see the public beach's pet
    const pub = await req(`/beaches/${code}/pet`);
    expect(pub.status).toBe(200);
    expect(((await pub.json()) as { pet: { name: string } }).pet.name).toBe('Shelly');

    // Signed-out visitor cannot feed
    expect((await req(`/beaches/${code}/pet/feed`, { method: 'POST' })).status).toBe(401);

    // Signed-in visitor gets 1 free feed today (no snacks required)
    const freeFeed = await req(`/beaches/${code}/pet/feed`, { method: 'POST' }, visitor.token);
    expect(freeFeed.status).toBe(200);
    const freeData = (await freeFeed.json()) as { usedFood: boolean; freeUsedToday: boolean; pet: { fedCount: number } };
    expect(freeData.usedFood).toBe(false);
    expect(freeData.freeUsedToday).toBe(true);
    expect(freeData.pet.fedCount).toBe(2);

    // Second feed same day without snacks returns 409
    const secondEmpty = await req(`/beaches/${code}/pet/feed`, { method: 'POST' }, visitor.token);
    expect(secondEmpty.status).toBe(409);

    // Grant visitor 1 beach snack — now a second feed succeeds and spends it
    expect((await req('/dev/grant', json('POST', { item: TREAT_ITEM_ID, quantity: 1 }), visitor.token)).status).toBe(204);
    const paidFeed = await req(`/beaches/${code}/pet/feed`, { method: 'POST' }, visitor.token);
    expect(paidFeed.status).toBe(200);
    const paidData = (await paidFeed.json()) as { usedFood: boolean; remaining: number; pet: { fedCount: number } };
    expect(paidData.usedFood).toBe(true);
    expect(paidData.remaining).toBe(0);
    expect(paidData.pet.fedCount).toBe(3);

    // Owner sees FriendlyVisitor in recentFeeders
    const ownerPet = await req('/pet', {}, owner.token);
    expect(ownerPet.status).toBe(200);
    const ownerData = (await ownerPet.json()) as { recentFeeders: { name: string; at: number }[] };
    expect(ownerData.recentFeeders.length).toBeGreaterThan(0);
    expect(ownerData.recentFeeders[0].name).toBe('FriendlyVisitor');
  });
});
