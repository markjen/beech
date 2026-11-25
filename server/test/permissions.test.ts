// Who may change a beach (docs/LIVE_SIM.md, "only the owner can write their
// beach"): everyone else can look, and the server's catch-up is the only
// other thing that moves its sand. Each beach-changing endpoint is tried by
// another signed-in person, who holds their own edit token so that the
// refusal comes from ownership, not a missing token, and then the owner's
// beach is checked to be exactly as it was.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgDb, createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { beachBlob } from './beachBlob.js';

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
  app = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true });
});
afterAll(() => db.close());

type Who = { token: string; user: { id: string }; edit: string; code: string };
const req = (path: string, init: RequestInit = {}, who?: Who, headers: Record<string, string> = {}) =>
  app.request(path, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string>),
      ...headers,
      ...(who ? { Authorization: `Bearer ${who.token}`, 'X-Edit-Token': who.edit } : {}),
    },
  });
const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });
let seq = 0;
async function player(name: string): Promise<Who> {
  const s = (await (await app.request('/auth/dev', json('POST', { name: `${name}${++seq}` }))).json()) as { token: string; user: { id: string } };
  const auth = { Authorization: `Bearer ${s.token}` };
  const edit = ((await (await app.request('/edit-session', { method: 'POST', headers: auth })).json()) as { token: string }).token;
  const code = ((await (await app.request('/neighbors', { headers: auth })).json()) as { code: string }).code;
  return { ...s, edit, code };
}
const sandHeaders = (n = 256) => ({ 'X-Beach-Location': 'brighton', 'X-Beach-Nx': String(n), 'X-Beach-Ny': String(n), 'X-Beach-Max': '2000' });
const save = (who: Who, path: string, bytes: Uint8Array, extra: Record<string, string> = {}) =>
  req(path, { method: 'PUT', body: bytes }, who, { ...sandHeaders(), ...extra });
const row = async (id: string) =>
  (
    await db.query<{ version: number; epoch: number; name: string; code: string; location: string; home: boolean; sand: unknown }>(
      'SELECT version, epoch, name, code, location, home, sand FROM beach WHERE id = $1',
      [id],
    )
  )[0];

describe('only the owner changes a beach', () => {
  it("refuses every beach-changing call on someone else's beach, and leaves it as it was", async () => {
    const eve = await player('eve');
    const mal = await player('mal');
    // Eve: a home beach and a second one, both saved, plus a checkpoint
    await db.query("INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at) VALUES ($1, 'beach', 1, 'gift', $2)", [eve.user.id, Date.now()]);
    const made = await req('/beaches/mine', json('POST', { name: 'Second', location: 'bondi' }), eve);
    expect(made.status).toBe(200);
    const second = ((await made.json()) as { beach: { id: string; code: string } }).beach;
    expect((await save(eve, '/beach', beachBlob([], 5))).status).toBe(200);
    expect((await save(eve, `/beaches/mine/${second.id}/sand`, beachBlob([], 6))).status).toBe(200);
    const cp = await req(`/beaches/mine/${second.id}/checkpoints`, json('POST', { name: 'mine' }), eve);
    expect(cp.status).toBe(201);
    const cpId = ((await cp.json()) as { checkpoint: { id: string } }).checkpoint.id;
    // Mal has a beach and a checkpoint of his own
    expect((await save(mal, '/beach', beachBlob([], 1))).status).toBe(200);
    const malCp = ((await (await req(`/beaches/mine/${mal.user.id}/checkpoints`, json('POST', { name: 'his' }), mal)).json()) as {
      checkpoint: { id: string };
    }).checkpoint.id;

    const before = { home: await row(eve.user.id), second: await row(second.id) };
    for (const target of [eve.user.id, second.id]) {
      const tries: [string, Promise<Response>][] = [
        ['save', save(mal, `/beaches/mine/${target}/sand`, beachBlob([], 99))],
        ['read as mine', req(`/beaches/mine/${target}/sand`, {}, mal)],
        ['here', req(`/beaches/mine/${target}/here`, { method: 'POST' }, mal)],
        ['away', req(`/beaches/mine/${target}/away`, {}, mal)],
        ['away seen', req(`/beaches/mine/${target}/away/seen`, { method: 'POST' }, mal)],
        ['rename', req(`/beaches/mine/${target}`, json('PATCH', { name: 'Mine now', location: 'piha', home: true }), mal)],
        ['delete', req(`/beaches/mine/${target}`, { method: 'DELETE' }, mal)],
        ['checkpoint it', req(`/beaches/mine/${target}/checkpoints`, json('POST', { name: 'stolen' }), mal)],
        ['restore onto it', req(`/beaches/mine/${target}/restore`, json('POST', { checkpoint: malCp, mode: 'drop-missing' }), mal)],
        ['age it (dev)', req('/dev/age-beach', json('POST', { hours: 48, beach: target }), mal)],
        ['new code', req(`/neighbors/code?beach=${target}`, { method: 'POST' }, mal)],
        ['neighbors', req(`/neighbors?beach=${target}`, {}, mal)],
        ['ask a neighbor for it', req(`/neighbors/left?beach=${target}`, json('PUT', { code: mal.code }), mal)],
        ['move its neighbor away', req(`/neighbors/left?beach=${target}`, { method: 'DELETE' }, mal)],
        ['feed as owner', req('/animals/feed', json('POST', { beachId: target }), mal)],
        ['adopt', req('/pet/adopt', json('POST', { beachId: target, mode: 'befriend' }), mal)],
        ['rename pet', req('/pet', json('PATCH', { beachId: target, name: 'Mine' }), mal)],
        ['fit onto it', req(`/checkpoints/${malCp}/fit?beach=${target}`, {}, mal)],
      ];
      for (const [what, p] of tries) expect([what, (await p).status]).toEqual([what, 404]);
    }
    // Eve's checkpoint isn't Mal's to read, rename, delete or restore
    for (const [what, p] of [
      ['read', req(`/checkpoints/${cpId}/sand`, {}, mal)],
      ['rename', req(`/checkpoints/${cpId}`, json('PATCH', { name: 'x' }), mal)],
      ['delete', req(`/checkpoints/${cpId}`, { method: 'DELETE' }, mal)],
      ['restore', req(`/beaches/mine/${mal.user.id}/restore`, json('POST', { checkpoint: cpId }), mal)],
      ['fit', req(`/checkpoints/${cpId}/fit`, {}, mal)],
    ] as [string, Promise<Response>][])
      expect([what, (await p).status]).toEqual([what, 404]);

    // nothing moved: sand, version, epoch, name, code, place, home
    const after = { home: await row(eve.user.id), second: await row(second.id) };
    expect(after).toEqual(before);
    expect((await db.query('SELECT 1 FROM checkpoints WHERE id = $1', [cpId])).length).toBe(1);
    // looking is fine, and doesn't change it either
    expect((await req(`/beaches/${second.code}`, {}, mal)).status).toBe(200);
    expect((await req(`/beaches/${second.code}/live`, {}, mal)).status).toBe(200);
    expect(await row(second.id)).toEqual(before.second);
  });

  it('the old home-beach routes only ever reach your own beach', async () => {
    const ann = await player('ann');
    const bob = await player('bob');
    expect((await save(ann, '/beach', beachBlob([], 4))).status).toBe(200);
    const before = await row(ann.user.id);
    // Bob's /beach is Bob's, whatever he sends
    expect((await save(bob, '/beach', beachBlob([], 8), { 'X-Beach-Id': ann.user.id })).status).toBe(200);
    expect(await row(ann.user.id)).toEqual(before);
  });
});

describe('what a save may hold', () => {
  it('counts the things on a beach itself, ignoring X-Beach-Items', async () => {
    const p = await player('counter');
    await db.query(
      "INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at) VALUES ($1, 'deckchair', 2, 'pull', $2), ($1, 'starfish', 1, 'pull', $2)",
      [p.user.id, Date.now()],
    );
    const bytes = beachBlob([{ item: 'deckchair' }, { item: 'deckchair' }, { item: 'starfish' }, { item: 'rock' }, { item: 'shell' }]);
    // an app claiming fewer things than it placed (to free them for another beach)
    expect((await save(p, '/beach', bytes, { 'X-Beach-Items': 'deckchair=0' })).status).toBe(200);
    const items = (await db.query<{ items: unknown }>('SELECT items FROM beach WHERE id = $1', [p.user.id]))[0].items;
    expect(typeof items === 'string' ? JSON.parse(items) : items).toEqual({ deckchair: 2, starfish: 1 });
  });

  it("refuses bytes that aren't a beach, and a grid that doesn't match its headers", async () => {
    const p = await player('junk');
    expect((await save(p, '/beach', new Uint8Array([1, 2, 3]))).status).toBe(400);
    expect((await save(p, '/beach', beachBlob([], 0, 16))).status).toBe(400); // headers say 256
    expect((await req('/beach', {}, p)).status).toBe(404); // nothing was saved
    expect((await save(p, '/beach', beachBlob([], 0, 16), sandHeaders(16))).status).toBe(200);
  });
});

describe('a save stays within the bag', () => {
  const chairs = (n: number, fill = 0) => beachBlob(Array.from({ length: n }, () => ({ item: 'deckchair' })), fill);
  const give = (who: Who, item: string, n = 1) =>
    db.query("INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at) VALUES ($1, $2, $3, 'pull', $4)", [who.user.id, item, n, Date.now()]);

  it("can't place more than you own, across all your beaches", async () => {
    const p = await player('bag');
    await give(p, 'deckchair');
    await db.query("INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at) VALUES ($1, 'beach', 1, 'gift', $2)", [p.user.id, Date.now()]);
    const second = ((await (await req('/beaches/mine', json('POST', { name: 'Two' }), p)).json()) as { beach: { id: string } }).beach.id;
    // one you own: fine; two: refused, saying what's short
    expect((await save(p, '/beach', chairs(1))).status).toBe(200);
    const over = await save(p, '/beach', chairs(2));
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: 'short', short: [{ item: 'deckchair', need: 2, have: 1 }] });
    // the one is on the home beach, so the second beach can't have it too
    expect((await save(p, `/beaches/mine/${second}/sand`, chairs(1))).status).toBe(409);
    // free things are never short
    expect((await save(p, `/beaches/mine/${second}/sand`, beachBlob(Array.from({ length: 40 }, () => ({ item: 'rock' }))))).status).toBe(200);
    // nothing refused was stored
    const items = (await db.query<{ items: unknown }>('SELECT items FROM beach WHERE id = $1', [p.user.id]))[0].items;
    expect(typeof items === 'string' ? JSON.parse(items) : items).toEqual({ deckchair: 1 });
  });

  it('a move across a seam goes through once the beach it left has saved', async () => {
    const p = await player('seam');
    await give(p, 'deckchair');
    await db.query("INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at) VALUES ($1, 'beach', 1, 'gift', $2)", [p.user.id, Date.now()]);
    const second = ((await (await req('/beaches/mine', json('POST', { name: 'Two' }), p)).json()) as { beach: { id: string } }).beach.id;
    expect((await save(p, '/beach', chairs(1))).status).toBe(200);
    // the beach it went to saved first: refused, then the app saves the one it left and tries again
    expect((await save(p, `/beaches/mine/${second}/sand`, chairs(1))).status).toBe(409);
    expect((await save(p, '/beach', chairs(0))).status).toBe(200);
    expect((await save(p, `/beaches/mine/${second}/sand`, chairs(1))).status).toBe(200);
  });

  it('keeps what a beach already holds after the bag no longer covers it (given away)', async () => {
    const p = await player('giver');
    const friend = await player('friend');
    await give(p, 'deckchair');
    expect((await save(p, '/beach', chairs(1))).status).toBe(200);
    expect((await req('/gifts', json('POST', { code: friend.code, item: 'deckchair' }), p)).status).toBe(200);
    // still on the sand: digging around it still saves
    expect((await save(p, '/beach', chairs(1, 30))).status).toBe(200);
    // but no more of them
    expect((await save(p, '/beach', chairs(2, 30))).status).toBe(409);
    // once it's gone from the sand, it can't come back
    expect((await save(p, '/beach', chairs(0, 30))).status).toBe(200);
    expect((await save(p, '/beach', chairs(1, 30))).status).toBe(409);
  });
});

describe("visitors and a beach's pet", () => {
  it('the owner sees the pet on a beach kept off the shore; visitors see nothing', async () => {
    const own = await player('petowner');
    const vis = await player('petvisitor');
    expect((await save(own, '/beach', beachBlob())).status).toBe(200);
    await db.query(
      `INSERT INTO beach_pets (beach_id, species, name, variant, source, last_fed_at, last_fed_by, fed_count, created_at)
       VALUES ($1, 'crab', 'Pinch', 0, 'shop', $2, $1, 1, $2)`,
      [own.user.id, Date.now()],
    );
    await db.query('UPDATE beach SET on_shore = false WHERE id = $1', [own.user.id]);
    const mineView = await req(`/beaches/${own.code}/pet`, {}, own);
    expect(mineView.status).toBe(200);
    expect(((await mineView.json()) as { pet: { name: string } }).pet.name).toBe('Pinch');
    expect((await req(`/beaches/${own.code}/pet`, {}, vis)).status).toBe(404);
    expect((await req(`/beaches/${own.code}/pet`)).status).toBe(404);
    expect((await req(`/beaches/${own.code}/pet/feed`, json('POST', {}), vis)).status).toBe(404);
  });

  it("someone the owner blocked can't feed their pet", async () => {
    const own = await player('blocker');
    const pest = await player('pest');
    const ok = await player('friend');
    await db.query(
      `INSERT INTO beach_pets (beach_id, species, name, variant, source, last_fed_at, last_fed_by, fed_count, created_at)
       VALUES ($1, 'crab', 'Nip', 0, 'shop', $2, $1, 1, $2)`,
      [own.user.id, Date.now()],
    );
    expect((await req(`/blocks/${pest.code}`, { method: 'PUT' }, own)).status).toBe(204);
    expect((await req(`/beaches/${own.code}/pet/feed`, json('POST', {}), pest)).status).toBe(403);
    expect((await req(`/beaches/${own.code}/pet/feed`, json('POST', {}), ok)).status).toBe(200);
  });
});
