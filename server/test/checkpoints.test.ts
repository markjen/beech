import { readFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { dropMissing, inspectBlob, shortfall } from '../src/checkpoints.js';
import { createPgDb, createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrations.js';

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
  app = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: ['capacitor://localhost'], devAuth: true });
});
afterAll(() => db.close());

// ---------------------------------------------------------------- helpers
type Obj = { id: number; item: string; wild?: boolean };
/** a BCH2 beach as the app writes it: sand filled with `fill` mm, plus things */
function blob(objects: Obj[], fill = 0, n = 16): Uint8Array {
  const q = new Int16Array(n * n).fill(fill);
  const sand = deflateSync(Buffer.from(q.buffer));
  const objs = deflateSync(Buffer.from(JSON.stringify(objects.map((o) => ({ kind: 'rock', x: 5, y: 20, angle: 0, size: 0.3, variant: 1, ...o })))));
  const out = new Uint8Array(12 + sand.length + objs.length);
  out.set(Buffer.from('BCH2', 'latin1'), 0);
  const dv = new DataView(out.buffer);
  dv.setUint16(4, n, true);
  dv.setUint16(6, n, true);
  dv.setUint32(8, sand.length, true);
  out.set(sand, 12);
  out.set(objs, 12 + sand.length);
  return out;
}
const objectsOf = (b: Uint8Array): Obj[] => {
  const len = new DataView(b.buffer, b.byteOffset).getUint32(8, true);
  return JSON.parse(inflateSync(b.subarray(12 + len)).toString()) as Obj[];
};
const fillOf = (b: Uint8Array): number => {
  const len = new DataView(b.buffer, b.byteOffset).getUint32(8, true);
  return new Int16Array(new Uint8Array(inflateSync(b.subarray(12, 12 + len))).buffer)[0];
};

const req = (path: string, init: RequestInit = {}, token?: string) =>
  app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });
async function signIn(name: string) {
  const r = await req('/auth/dev', json('POST', { name }));
  return (await r.json()) as { token: string; user: { id: string } };
}
const grant = (t: string, item: string, quantity = 1) => req('/dev/grant', json('POST', { item, quantity }), t);
const save = (t: string, beach: string, bytes: Uint8Array, items: Record<string, number> = {}, epoch?: number) =>
  req(
    `/beaches/mine/${beach}/sand`,
    {
      method: 'PUT',
      body: bytes,
      headers: {
        'X-Beach-Location': 'bondi',
        'X-Beach-Nx': '16',
        'X-Beach-Ny': '16',
        'X-Beach-Items': Object.entries(items).map(([k, v]) => `${k}=${v}`).join(','),
        ...(epoch === undefined ? {} : { 'X-Beach-Epoch': String(epoch) }),
      },
    },
    t,
  );
const checkpoint = async (t: string, beach: string, name: string) => {
  const r = await req(`/beaches/mine/${beach}/checkpoints`, json('POST', { name }), t);
  expect(r.status).toBe(201);
  return ((await r.json()) as { checkpoint: { id: string; items: Record<string, number> } }).checkpoint;
};
const restore = (t: string, beach: string, id: string, mode?: string) => req(`/beaches/mine/${beach}/restore`, json('POST', { checkpoint: id, mode }), t);
const sandOf = async (t: string, beach: string) => {
  const r = await req(`/beaches/mine/${beach}/sand`, {}, t);
  return { bytes: new Uint8Array(await r.arrayBuffer()), epoch: Number(r.headers.get('X-Beach-Epoch')) };
};
const newBeach = async (t: string, name: string) => {
  await grant(t, 'beach');
  const r = await req('/beaches/mine', json('POST', { name }), t);
  expect(r.status).toBe(200);
  return ((await r.json()) as { beach: { id: string } }).beach.id;
};

// ---------------------------------------------------------------- pure parts
describe('reading a saved beach', () => {
  it('counts non-free things, wild ones too', () => {
    const info = inspectBlob(blob([{ id: 1, item: 'rock' }, { id: 2, item: 'lighthouse' }, { id: 3, item: 'lighthouse', wild: true }, { id: 4, item: 'starfish' }]));
    expect(info).toEqual({ nx: 16, ny: 16, items: { lighthouse: 2, starfish: 1 }, objects: 4 });
  });
  it('refuses what is not one', () => {
    expect(() => inspectBlob(new Uint8Array(40))).toThrow(/not a saved beach/);
    const b = blob([]);
    expect(() => inspectBlob(b.subarray(0, b.length - 4))).toThrow(/corrupt/);
    // a short sand part
    const short = blob([], 0, 16);
    short[4] = 17;
    expect(() => inspectBlob(short)).toThrow(/corrupt/);
    // a zip bomb in the things part
    const bomb = blob([]);
    const len = new DataView(bomb.buffer).getUint32(8, true);
    const big = deflateSync(Buffer.alloc(50 * 1024 * 1024, 32));
    const withBomb = new Uint8Array(12 + len + big.length);
    withBomb.set(bomb.subarray(0, 12 + len));
    withBomb.set(big, 12 + len);
    expect(() => inspectBlob(withBomb)).toThrow(/corrupt/);
    expect(() => inspectBlob(blob(Array.from({ length: 401 }, (_, i) => ({ id: i + 1, item: 'rock' }))))).toThrow(/too many/);
  });
  it('drops the newest of what is short, keeping the sand', () => {
    const b = blob([{ id: 1, item: 'deckchair' }, { id: 5, item: 'deckchair' }, { id: 3, item: 'deckchair' }, { id: 2, item: 'rock' }], 120);
    const { bytes, dropped } = dropMissing(b, [{ item: 'deckchair', need: 3, have: 1 }]);
    expect(dropped).toBe(2);
    expect(objectsOf(bytes).map((o) => o.id)).toEqual([1, 2]);
    expect(fillOf(bytes)).toBe(120);
  });
  it('matches the shared fit cases (the app runs the same file)', () => {
    const { cases } = JSON.parse(readFileSync(new URL('../../tests/fixtures/checkpoint-fit.json', import.meta.url), 'utf8')) as {
      cases: { name: string; need: Record<string, number>; owned: Record<string, number>; elsewhere: Record<string, number>; short: unknown[] }[];
    };
    for (const k of cases) expect(shortfall(k.need, k.owned, k.elsewhere), k.name).toEqual(k.short);
  });
});

// ---------------------------------------------------------------- the API
describe('checkpoints', () => {
  it('makes, lists, renames and deletes, and only for you', async () => {
    const { token: a, user } = await signIn('cp-ana');
    const { token: b } = await signIn('cp-ben');
    expect((await req(`/beaches/mine/${user.id}/checkpoints`, json('POST', { name: 'x' }), a)).status).toBe(404); // nothing saved yet
    expect((await save(a, user.id, blob([{ id: 1, item: 'rock' }], 50))).status).toBe(200);
    expect((await req(`/beaches/mine/${user.id}/checkpoints`, json('POST', { name: '  ' }), a)).status).toBe(400);
    const cp = await checkpoint(a, user.id, 'First');
    const list = (await (await req('/checkpoints', {}, a)).json()) as { limit: number; named: number; checkpoints: { name: string; fromBeach: unknown }[] };
    expect(list.limit).toBe(5);
    expect(list.named).toBe(1);
    expect(list.checkpoints[0]).toMatchObject({ name: 'First', fromBeach: { id: user.id } });
    expect((await req(`/checkpoints/${cp.id}`, json('PATCH', { name: 'Renamed' }), a)).status).toBe(200);
    // someone else can't see, read, restore or delete it
    expect((await req(`/checkpoints/${cp.id}/sand`, {}, b)).status).toBe(404);
    expect((await req(`/checkpoints/${cp.id}`, { method: 'DELETE' }, b)).status).toBe(404);
    expect(((await (await req('/checkpoints', {}, b)).json()) as { checkpoints: unknown[] }).checkpoints).toEqual([]);
    const sand = await req(`/checkpoints/${cp.id}/sand`, {}, a);
    expect(fillOf(new Uint8Array(await sand.arrayBuffer()))).toBe(50);
    expect((await req(`/checkpoints/${cp.id}`, { method: 'DELETE' }, a)).status).toBe(204);
    expect(((await (await req('/checkpoints', {}, a)).json()) as { named: number }).named).toBe(0);
  });

  it('keeps 5 per beach you may have', async () => {
    const { token, user } = await signIn('cp-cap');
    await save(token, user.id, blob([]));
    for (let i = 0; i < 5; i++) await checkpoint(token, user.id, `n${i}`);
    expect((await req(`/beaches/mine/${user.id}/checkpoints`, json('POST', { name: 'one more' }), token)).status).toBe(409);
    await grant(token, 'beach');
    await checkpoint(token, user.id, 'room now');
  });

  it('imports a beach (checked and counted by the server)', async () => {
    const { token } = await signIn('cp-imp');
    const up = (bytes: Uint8Array, name = 'Imported%20cove') =>
      req('/checkpoints', { method: 'POST', body: bytes, headers: { 'X-Checkpoint-Name': name, 'X-Beach-Location': 'piha' } }, token);
    const r = await up(blob([{ id: 1, item: 'lighthouse' }, { id: 2, item: 'rock' }]));
    expect(r.status).toBe(201);
    const { checkpoint: cp } = (await r.json()) as { checkpoint: { name: string; source: string; items: unknown; location: string } };
    expect(cp).toMatchObject({ name: 'Imported cove', source: 'import', items: { lighthouse: 1 }, location: 'piha' });
    expect((await up(new Uint8Array(100))).status).toBe(400);
    expect((await up(blob([]), '')).status).toBe(400);
  });

  it('restores strictly, or without what is missing, and can be undone', async () => {
    const { token: t, user } = await signIn('cp-res');
    const home = user.id;
    await grant(t, 'lighthouse');
    // home: dug, with the lighthouse on it
    await save(t, home, blob([{ id: 1, item: 'rock' }, { id: 2, item: 'lighthouse' }], 200), { lighthouse: 1 });
    const one = await checkpoint(t, home, 'one');
    expect(one.items).toEqual({ lighthouse: 1 });
    const two = await newBeach(t, 'Two');
    await save(t, two, blob([{ id: 7, item: 'flag' }], 30));
    // the lighthouse is on home, so beach two can't have it too
    const fit = (await (await req(`/checkpoints/${one.id}/fit?beach=${two}`, {}, t)).json()) as { ok: boolean; short: unknown[] };
    expect(fit).toMatchObject({ ok: false, short: [{ item: 'lighthouse', need: 1, have: 0 }] });
    const strict = await restore(t, two, one.id);
    expect(strict.status).toBe(409);
    expect(await strict.json()).toEqual({ error: 'short', short: [{ item: 'lighthouse', need: 1, have: 0 }] });
    expect(fillOf((await sandOf(t, two)).bytes)).toBe(30); // nothing written
    // without them: the sand and the rock, no lighthouse
    const before = await sandOf(t, two);
    const loose = await restore(t, two, one.id, 'drop-missing');
    expect(loose.status).toBe(200);
    const done = (await loose.json()) as { epoch: number; undo: string; dropped: number };
    expect(done.dropped).toBe(1);
    expect(done.epoch).toBe(before.epoch + 1);
    const after = await sandOf(t, two);
    expect(fillOf(after.bytes)).toBe(200);
    expect(objectsOf(after.bytes).map((o) => o.item)).toEqual(['rock']);
    const mineNow = (await (await req('/beaches/mine', {}, t)).json()) as { beaches: { id: string; items: unknown; location: string }[] };
    expect(mineNow.beaches.find((b) => b.id === two)).toMatchObject({ items: {}, location: 'bondi' });
    // undo: the "before restoring" checkpoint brings the flag back
    const list = (await (await req('/checkpoints', {}, t)).json()) as { checkpoints: { id: string; kind: string; name: string }[] };
    const auto = list.checkpoints.find((c) => c.id === done.undo)!;
    expect(auto).toMatchObject({ kind: 'auto', name: 'Before restoring “one”' });
    expect((await restore(t, two, auto.id)).status).toBe(200);
    const undone = await sandOf(t, two);
    expect(fillOf(undone.bytes)).toBe(30);
    expect(objectsOf(undone.bytes).map((o) => o.item)).toEqual(['flag']);
    // still one auto per beach
    const autos = ((await (await req('/checkpoints', {}, t)).json()) as { checkpoints: { kind: string }[] }).checkpoints.filter((c) => c.kind === 'auto');
    expect(autos.length).toBe(1);
    // take the lighthouse off home: now it restores in full
    await save(t, home, blob([{ id: 1, item: 'rock' }], 200), {});
    expect((await restore(t, two, one.id)).status).toBe(200);
    expect(objectsOf((await sandOf(t, two)).bytes).map((o) => o.item).sort()).toEqual(['lighthouse', 'rock']);
  });

  it('a save from before a restore is refused; one from after, or from an old app, is not', async () => {
    const { token: t, user } = await signIn('cp-epoch');
    await save(t, user.id, blob([], 10));
    const cp = await checkpoint(t, user.id, 'e');
    const seen = (await sandOf(t, user.id)).epoch;
    const r = (await (await restore(t, user.id, cp.id)).json()) as { epoch: number };
    expect(r.epoch).toBe(seen + 1);
    const stale = await save(t, user.id, blob([], 99), {}, seen);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'restored' });
    expect((await save(t, user.id, blob([], 11), {}, r.epoch)).status).toBe(200);
    expect((await save(t, user.id, blob([], 12))).status).toBe(200); // no header: an older app
  });

  it('two restores at once can not both use one lighthouse', async () => {
    const { token: t, user } = await signIn('cp-race');
    await grant(t, 'lighthouse');
    await save(t, user.id, blob([{ id: 1, item: 'lighthouse' }]), { lighthouse: 1 });
    const cp = await checkpoint(t, user.id, 'lh');
    await save(t, user.id, blob([]), {}); // picked up again
    const b2 = await newBeach(t, 'B2');
    const b3 = await newBeach(t, 'B3');
    await save(t, b2, blob([]));
    await save(t, b3, blob([]));
    const res = await Promise.all([restore(t, b2, cp.id), restore(t, b3, cp.id)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('a removed beach keeps its checkpoints; a deleted account takes them', async () => {
    const { token: t, user } = await signIn('cp-keep');
    const b = await newBeach(t, 'Gone soon');
    await save(t, b, blob([], 5));
    const cp = await checkpoint(t, b, 'keepsake');
    expect((await req(`/beaches/mine/${b}`, { method: 'DELETE' }, t)).status).toBe(204);
    const list = (await (await req('/checkpoints', {}, t)).json()) as { checkpoints: { id: string; fromBeach: unknown; fromName: string }[] };
    expect(list.checkpoints.find((c) => c.id === cp.id)).toMatchObject({ fromBeach: null, fromName: 'Gone soon' });
    expect((await restore(t, user.id, cp.id)).status).toBe(200);
    await req('/account', { method: 'DELETE' }, t);
    expect((await db.query('SELECT 1 FROM checkpoints WHERE owner_id = $1', [user.id])).length).toBe(0);
  });

  it('lets the phone apps send its headers and PATCH', async () => {
    const r = await req('/checkpoints', { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost' } });
    const allow = r.headers.get('Access-Control-Allow-Headers') ?? '';
    for (const h of ['X-Beach-Items', 'X-Beach-Epoch', 'X-Checkpoint-Name']) expect(allow).toContain(h);
    expect(r.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
    expect(r.headers.get('Access-Control-Expose-Headers')).toContain('X-Beach-Epoch');
  });
});
