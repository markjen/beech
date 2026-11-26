// Pets as things you own and move, against specs/tla/Pets.tla (docs/PETS.md).
// Fast: the real server in-process on PGlite, no rendering.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { befriendThreshold, TREAT_ITEM_ID } from '../../src/animals.js';
import { FEED_SHARE, PETS, SNACK_BUCKS } from '../../src/petCatalog.js';
import { PRODUCTS, realMoneyProductById } from '../../src/products.js';
import { listBucks } from '../../src/bucks.js';
import { PETS as CLIENT_PETS } from '../../../src/world/pets';
import { startServer, type Server } from './harness.js';

let s: Server;
beforeAll(async () => {
  s = await startServer();
});
afterAll(() => s.close());

interface Owner {
  token: string;
  id: string;
  beaches: [string, string];
  edit: string;
}

let n = 0;
async function owner(): Promise<Owner> {
  n++;
  const u = await s.signIn(`Keeper ${n}`);
  await s.grant(u.token, 'beach');
  const edit = await s.claim(u.token);
  const r = await s.post('/beaches/mine', u.token, { name: 'Second' }, { 'X-Edit-Token': edit });
  expect(r.status).toBe(200);
  const second = ((await r.json()) as { beach: { id: string } }).beach.id;
  return { ...u, beaches: [u.id, second], edit };
}

const adoptShop = (o: Owner, beachId: string, species: string) =>
  s.post('/pet/adopt', o.token, { beachId, mode: 'shop', species, name: 'Pip' });
const stow = (o: Owner, beachId: string) => s.post('/pet/stow', o.token, { beachId });
const place = (o: Owner, beachId: string, petId: number) => s.post('/pet/place', o.token, { beachId, petId });
const bag = async (o: Owner) => ((await (await s.req('/pet/bag', {}, o.token)).json()) as { pets: { id: number; species: string; name: string }[] }).pets;

async function where(o: Owner) {
  const rows = await s.db.query<{ beach_id: string; species: string }>(
    'SELECT beach_id, species FROM beach_pets WHERE beach_id = ANY($1)',
    [o.beaches],
  );
  return { onBeach: rows.map((r) => r.beach_id).sort(), bag: (await bag(o)).length };
}

describe('pet catalog', () => {
  it('feeding to befriend costs exactly a quarter of the shop price, for every pet', () => {
    expect(PETS).toHaveLength(6);
    expect(FEED_SHARE).toBe(1 / 4);
    for (const p of PETS) {
      expect(p.feeds * SNACK_BUCKS, p.species).toBe(p.bucks * FEED_SHARE);
      expect(befriendThreshold(p.species)).toBe(p.feeds);
    }
    // one snack is one buck, as sold in the shop
    const pack = PRODUCTS.find((p) => p.id === 'food_pack_10')!;
    expect(pack.bucks / pack.grants[0].quantity).toBe(SNACK_BUCKS);
  });

  it('every pet is sold for beech bucks at its price, never for real money (but the old crab listing), and none trade in', () => {
    for (const p of PETS) {
      const prod = PRODUCTS.find((x) => x.id === p.product);
      expect(prod, p.species).toMatchObject({ bucks: p.bucks, grants: [{ item: p.item, quantity: 1 }] });
      expect(listBucks(p.item)).toBeNull();
      expect(!!realMoneyProductById(p.product), p.species).toBe(p.species === 'crab');
      expect(prod!.steamItemId === undefined, p.species).toBe(p.species !== 'crab');
    }
    const ids = PRODUCTS.flatMap((p) => (p.steamItemId === undefined ? [] : [p.steamItemId]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('new pets are in the beech-bucks shop, and refused by every real-money checkout', async () => {
    const o = await owner();
    const catalog = (await (await s.req('/store/catalog')).json()) as { offers: { id: string; bucks: number }[] };
    expect(catalog.offers.find((x) => x.id === 'pet_dolphin')).toMatchObject({ bucks: 80 });
    const old = (await (await s.req('/store/products')).json()) as { products: { id: string }[] };
    expect(old.products.map((p) => p.id)).not.toContain('pet_dolphin');
    expect((await s.post('/store/purchase', o.token, { platform: 'dev', productId: 'pet_dolphin', token: 'x' })).status).toBe(404);
  });

  it('the pier is beech bucks only too', () => {
    expect(realMoneyProductById('item_pier')).toBeUndefined();
    expect(PRODUCTS.find((p) => p.id === 'item_pier')).toMatchObject({ bucksOnly: true, bucks: 30 });
  });

  it('the app and the server agree on every pet', () => {
    expect(CLIENT_PETS.map((p) => [p.species, p.habitat, p.bucks, p.feeds, p.item])).toEqual(
      PETS.map((p) => [p.species, p.habitat, p.bucks, p.feeds, p.item]),
    );
  });

  it('has land, sea, and both', () => {
    const habitats = new Set(PETS.map((p) => p.habitat));
    expect([...habitats].sort()).toEqual(['both', 'land', 'sea']);
    expect(PETS.find((p) => p.species === 'turtle')?.habitat).toBe('both');
  });
});

describe('pets: one transition at a time', () => {
  it('befriending a dolphin takes its own feeds, counted per species', async () => {
    const o = await owner();
    const need = befriendThreshold('dolphin');
    for (let left = need; left > 0; left -= 10) await s.grant(o.token, TREAT_ITEM_ID, Math.min(10, left));
    for (let i = 0; i < need - 1; i++) {
      s.clock.now += 1000;
      const r = await s.post('/animals/feed', o.token, { beachId: o.beaches[0], species: 'dolphin' });
      expect(r.status).toBe(200);
    }
    expect((await s.post('/pet/adopt', o.token, { beachId: o.beaches[0], mode: 'befriend', species: 'dolphin' })).status).toBe(409);
    s.clock.now += 1000;
    const last = (await (await s.post('/animals/feed', o.token, { beachId: o.beaches[0], species: 'dolphin' })).json()) as { bond: { ready: boolean; threshold: number } };
    expect(last.bond).toMatchObject({ ready: true, threshold: need });
    // the crab bond is untouched
    const crab = await s.post('/pet/adopt', o.token, { beachId: o.beaches[0], mode: 'befriend', species: 'crab' });
    expect(crab.status).toBe(409);
    const r = await s.post('/pet/adopt', o.token, { beachId: o.beaches[0], mode: 'befriend', species: 'dolphin' });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { pet: { species: string } }).pet.species).toBe('dolphin');
  });

  it('rejects an unknown species', async () => {
    const o = await owner();
    expect((await s.post('/animals/feed', o.token, { beachId: o.beaches[0], species: 'kraken' })).status).toBe(400);
  });

  it('ShopPlace spends that species’ item; Stow puts the pet in the bag; Place puts it on another beach', async () => {
    const o = await owner();
    expect((await adoptShop(o, o.beaches[0], 'turtle')).status).toBe(409); // no item
    await s.grant(o.token, 'pet-turtle');
    expect((await adoptShop(o, o.beaches[0], 'turtle')).status).toBe(200);
    expect(await where(o)).toEqual({ onBeach: [o.beaches[0]], bag: 0 });

    // hungry for 30 h, then put away for a week: still 30 h hungry when placed
    s.clock.now += 30 * 3600e3;
    const stowed = (await (await stow(o, o.beaches[0])).json()) as { pet: { id: number; species: string; name: string } };
    expect(stowed.pet).toMatchObject({ species: 'turtle', name: 'Pip' });
    expect(await where(o)).toEqual({ onBeach: [], bag: 1 });
    s.clock.now += 7 * 24 * 3600e3;

    const placed = await place(o, o.beaches[1], stowed.pet.id);
    expect(placed.status).toBe(200);
    const pet = ((await placed.json()) as { pet: { mood: string; lastFedAt: number; name: string } }).pet;
    expect(pet).toMatchObject({ mood: 'hungry', name: 'Pip' });
    expect(s.clock.now - pet.lastFedAt).toBe(30 * 3600e3);
    expect(await where(o)).toEqual({ onBeach: [o.beaches[1]], bag: 0 });
  });

  it('one pet per beach: Place on a beach with a pet is refused and the pet stays in the bag', async () => {
    const o = await owner();
    await s.grant(o.token, 'pet-crab');
    await s.grant(o.token, 'pet-seal');
    expect((await adoptShop(o, o.beaches[0], 'crab')).status).toBe(200);
    expect((await adoptShop(o, o.beaches[1], 'seal')).status).toBe(200);
    const crab = ((await (await stow(o, o.beaches[0])).json()) as { pet: { id: number } }).pet;
    expect((await place(o, o.beaches[1], crab.id)).status).toBe(409);
    expect(await where(o)).toEqual({ onBeach: [o.beaches[1]], bag: 1 });
  });

  it('a pet can be moved to a new spot on its beach, kept on the slab', async () => {
    const o = await owner();
    await s.grant(o.token, 'pet-octopus');
    await adoptShop(o, o.beaches[0], 'octopus');
    const r = await s.req('/pet', { method: 'PATCH', body: JSON.stringify({ beachId: o.beaches[0], home: { x: 3.25, z: -99 } }), headers: { 'Content-Type': 'application/json' } }, o.token);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { pet: { home: unknown; name: string } }).pet).toMatchObject({ home: { x: 3.25, z: -14.5 }, name: 'Pip' });
  });

  it('removing a beach puts its pet in the bag', async () => {
    const o = await owner();
    await s.grant(o.token, 'pet-sandpiper');
    await adoptShop(o, o.beaches[1], 'sandpiper');
    const r = await s.req(`/beaches/mine/${o.beaches[1]}`, { method: 'DELETE', headers: { 'X-Edit-Token': o.edit } }, o.token);
    expect(r.status).toBe(204);
    expect((await bag(o)).map((p) => p.species)).toEqual(['sandpiper']);
  });

  it('a pet of someone else can’t be placed, and your pet can’t go on their beach', async () => {
    const o = await owner();
    const other = await owner();
    await s.grant(o.token, 'pet-crab');
    await adoptShop(o, o.beaches[0], 'crab');
    const crab = ((await (await stow(o, o.beaches[0])).json()) as { pet: { id: number } }).pet;
    expect((await place(other, other.beaches[0], crab.id)).status).toBe(404);
    expect((await place(o, other.beaches[0], crab.id)).status).toBeGreaterThanOrEqual(400);
    expect((await bag(o)).length).toBe(1);
  });
});

describe('pets: TLC counterexamples, replayed', () => {
  it('NeverTwice: two devices placing one pet on two beaches at once put it on one', async () => {
    const o = await owner();
    await s.grant(o.token, 'pet-crab');
    await adoptShop(o, o.beaches[0], 'crab');
    const crab = ((await (await stow(o, o.beaches[0])).json()) as { pet: { id: number } }).pet;
    const gate = s.gate.pauseBefore(/INSERT INTO beach_pets/, { orTransaction: true });
    const first = place(o, o.beaches[0], crab.id);
    await Promise.race([gate.reached, first]);
    const second = await place(o, o.beaches[1], crab.id);
    gate.release();
    const statuses = [(await first).status, second.status].sort();
    expect(statuses).toEqual([200, 404]);
    const w = await where(o);
    expect(w.onBeach.length + w.bag).toBe(1);
  });

  it('NeverLost: a pet placed while another pet lands first stays in the bag', async () => {
    const o = await owner();
    await s.grant(o.token, 'pet-crab');
    await s.grant(o.token, 'pet-seal');
    await adoptShop(o, o.beaches[0], 'crab');
    const crab = ((await (await stow(o, o.beaches[0])).json()) as { pet: { id: number } }).pet;
    const gate = s.gate.pauseBefore(/INSERT INTO beach_pets/, { orTransaction: true });
    const placing = place(o, o.beaches[1], crab.id);
    await Promise.race([gate.reached, placing]);
    const shop = await adoptShop(o, o.beaches[1], 'seal');
    gate.release();
    const statuses = [(await placing).status, shop.status].sort();
    expect(statuses).toEqual([200, 409]);
    const w = await where(o);
    // two pets, each in exactly one place
    expect(w.onBeach.length + w.bag).toBe(2);
  });
});
