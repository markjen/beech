import { randomUUID } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { sandDiff } from '../src/checkpoints.js';
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
type Obj = { id: number; item: string; x?: number; y?: number };
/** a BCH2 beach as the app writes it: sand from `heights` mm, plus things */
function blobHeights(heights: Int16Array, objects: Obj[] = [], n = 16): Uint8Array {
  const sand = deflateSync(Buffer.from(heights.buffer));
  const objs = deflateSync(
    Buffer.from(JSON.stringify(objects.map((o) => ({ kind: 'rock', x: 5, y: 20, angle: 0, size: 0.3, variant: 1, ...o })))),
  );
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
const blob = (objects: Obj[] = [], fill = 0, n = 16): Uint8Array => blobHeights(new Int16Array(n * n).fill(fill), objects, n);
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
const claim = async (t: string) => {
  const r = await req('/edit-session', { method: 'POST' }, t);
  expect(r.status).toBe(200);
  return ((await r.json()) as { token: string }).token;
};
const save = (t: string, beach: string, bytes: Uint8Array, edit: string, n = 16, epoch?: number) =>
  req(
    `/beaches/mine/${beach}/sand`,
    {
      method: 'PUT',
      body: bytes,
      headers: {
        'X-Beach-Location': 'bondi',
        'X-Beach-Nx': String(n),
        'X-Beach-Ny': String(n),
        'X-Beach-Max': '2000',
        'X-Edit-Token': edit,
        ...(epoch === undefined ? {} : { 'X-Beach-Epoch': String(epoch) }),
      },
    },
    t,
  );
const sandOf = async (t: string, beach: string) => {
  const r = await req(`/beaches/mine/${beach}/sand`, {}, t);
  return new Uint8Array(await r.arrayBuffer());
};
const checkpoint = async (t: string, beach: string, name: string) => {
  const r = await req(`/beaches/mine/${beach}/checkpoints`, json('POST', { name }), t);
  expect(r.status).toBe(201);
  return ((await r.json()) as { checkpoint: { id: string } }).checkpoint;
};
const restore = (t: string, beach: string, id: string, edit: string) =>
  req(
    `/beaches/mine/${beach}/restore`,
    { ...json('POST', { checkpoint: id }), headers: { 'Content-Type': 'application/json', 'X-Edit-Token': edit } },
    t,
  );
const epochOf = async (t: string, beach: string) => {
  const r = await req(`/beaches/mine/${beach}/sand`, {}, t);
  return Number(r.headers.get('X-Beach-Epoch'));
};
type Cp = { id: string; name: string; kind: string; createdAt: number };
const listCps = async (t: string) =>
  ((await (await req('/checkpoints', {}, t)).json()) as { named: number; bytesUsed: number; checkpoints: Cp[] });
const checkpointSand = async (t: string, id: string) => new Uint8Array(await (await req(`/checkpoints/${id}/sand`, {}, t)).arrayBuffer());

// ---------------------------------------------------------------- the diff
describe('sandDiff', () => {
  it('an unchanged beach is not large', () => {
    expect(sandDiff(blob([], 100), blob([], 100))).toMatchObject({ changedCells: 0, changedObjects: 0, gridChanged: false, large: false });
  });
  it('a centimetre of drift everywhere is not large, five centimetres is', () => {
    expect(sandDiff(blob([], 0), blob([], 30)).large).toBe(false);
    expect(sandDiff(blob([], 0), blob([], 100)).large).toBe(true);
  });
  it('reshaping a tenth of the cells is large, a twentieth is not', () => {
    const n = 20; // 400 cells: a tenth is exactly 40
    const before = new Int16Array(n * n);
    const tenth = new Int16Array(before);
    tenth.fill(100, 0, Math.floor(n * n * 0.1));
    const twentieth = new Int16Array(before);
    twentieth.fill(100, 0, Math.floor(n * n * 0.05));
    expect(sandDiff(blobHeights(before, [], n), blobHeights(tenth, [], n))).toMatchObject({ large: true, changedCells: 40 });
    expect(sandDiff(blobHeights(before, [], n), blobHeights(twentieth, [], n))).toMatchObject({ large: false, changedCells: 20 });
  });
  it('moving fifty things is large, moving ten is not', () => {
    const objs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, item: 'rock', x: 5, y: 20 }));
    const moved = (n: number) => objs(60).map((o, i) => (i < n ? { ...o, x: 6 } : o));
    expect(sandDiff(blob(objs(60)), blob(moved(10)))).toMatchObject({ large: false });
    expect(sandDiff(blob(objs(60)), blob(moved(30)))).toMatchObject({ large: true, changedObjects: 60 });
    // vacuuming fifty things up is large too
    expect(sandDiff(blob(objs(60)), blob(objs(10)))).toMatchObject({ large: true, changedObjects: 50 });
  });
  it('a grid change is large, and unreadable bytes count as large', () => {
    expect(sandDiff(blob([], 0, 16), blob([], 0, 32))).toMatchObject({ gridChanged: true, large: true });
    expect(sandDiff(blob([], 0), new Uint8Array(40))).toMatchObject({ large: true });
    expect(sandDiff(new Uint8Array(40), blob([], 0))).toMatchObject({ large: true });
  });
});

// ---------------------------------------------------------------- the save
describe('a large save keeps the beach as it was first', () => {
  it('a big save snapshots the old beach into the one auto slot; a small save does not', async () => {
    const { token: t, user } = await signIn('le-big');
    const edit = await claim(t);
    expect((await save(t, user.id, blob([], 0), edit)).status).toBe(200);
    // a small save (a centimetre everywhere): no big-edit snapshot — but
    // the daily auto-save fires, there being no auto checkpoint yet
    const small = await save(t, user.id, blob([], 30), edit);
    expect(small.status).toBe(200);
    expect(await small.json()).not.toHaveProperty('largeEdit');
    let list = await listCps(t);
    expect(list.checkpoints.filter((c) => c.kind === 'auto')).toHaveLength(1);
    expect(list.checkpoints[0].name).toMatch(/^Auto-save /);
    expect(fillOf(await checkpointSand(t, list.checkpoints[0].id))).toBe(0);
    // a big save (five centimetres everywhere): the old beach is kept, named for it, in the same one slot
    const big = await save(t, user.id, blob([], 100), edit);
    expect(big.status).toBe(200);
    expect(await big.json()).toMatchObject({ largeEdit: true, largeEditCheckpoint: true });
    list = await listCps(t);
    expect(list.checkpoints.filter((c) => c.kind === 'auto')).toHaveLength(1);
    expect(list.checkpoints[0].name).toMatch(/^Before big edit /);
    expect(fillOf(await checkpointSand(t, list.checkpoints[0].id))).toBe(30);
    // the beach itself is the new one
    expect(fillOf(await sandOf(t, user.id))).toBe(100);
  });

  it('a big save fires even when a daily auto-save fired an hour ago, and reuses the same slot', async () => {
    const { token: t, user } = await signIn('le-daily');
    const edit = await claim(t);
    expect((await save(t, user.id, blob([], 0), edit)).status).toBe(200);
    // a small save: the daily snapshot fires, there being no auto checkpoint yet
    expect((await save(t, user.id, blob([], 30), edit)).status).toBe(200);
    let list = await listCps(t);
    expect(list.checkpoints.filter((c) => c.kind === 'auto')).toHaveLength(1);
    expect(list.checkpoints[0].name).toMatch(/^Auto-save /);
    // an hour later (the daily clock has not run out) a big save still snapshots — and replaces that copy
    const big = await save(t, user.id, blob([], 200), edit);
    expect(await big.json()).toMatchObject({ largeEdit: true, largeEditCheckpoint: true });
    list = await listCps(t);
    expect(list.checkpoints.filter((c) => c.kind === 'auto')).toHaveLength(1);
    expect(list.checkpoints[0].name).toMatch(/^Before big edit /);
    expect(fillOf(await checkpointSand(t, list.checkpoints[0].id))).toBe(30);
  });

  it('a big save on a first save keeps nothing, and a fenced save snapshots nothing', async () => {
    const { token: t, user } = await signIn('le-first');
    const edit = await claim(t);
    const first = await save(t, user.id, blob([], 200), edit);
    expect(first.status).toBe(200);
    expect(await first.json()).not.toHaveProperty('largeEdit');
    expect((await listCps(t)).checkpoints).toEqual([]);
    // a second editor claims: the first instance's big save is refused, and nothing is snapshotted
    const second = await claim(t);
    expect(second).not.toBe(edit);
    const fenced = await save(t, user.id, blob([], 0), edit);
    expect(fenced.status).toBe(409);
    expect((await listCps(t)).checkpoints).toEqual([]);
    expect(fillOf(await sandOf(t, user.id))).toBe(200);
  });

  it('a stale large save is refused before it snapshots, so the restore undo copy survives', async () => {
    const { token: t, user } = await signIn('le-stale');
    const edit = await claim(t);
    expect((await save(t, user.id, blob([], 0), edit)).status).toBe(200);
    const zero = await checkpoint(t, user.id, 'zero');
    expect((await save(t, user.id, blob([], 30), edit)).status).toBe(200);
    const seen = await epochOf(t, user.id);
    const r = await restore(t, user.id, zero.id, edit);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { epoch: number }).epoch).toBe(seen + 1);
    // the restore's undo copy is the fill-30 beach, in the one auto slot
    let list = await listCps(t);
    expect(list.checkpoints.filter((c) => c.kind === 'auto')).toHaveLength(1);
    expect(list.checkpoints[0].name).toMatch(/^Before restoring /);
    expect(fillOf(await checkpointSand(t, list.checkpoints[0].id))).toBe(30);
    // a large save from before the restore: refused, and the undo copy is untouched
    const stale = await save(t, user.id, blob([], 200), edit, 16, seen);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'restored' });
    list = await listCps(t);
    expect(list.checkpoints.filter((c) => c.kind === 'auto')).toHaveLength(1);
    expect(list.checkpoints[0].name).toMatch(/^Before restoring /);
    expect(fillOf(await checkpointSand(t, list.checkpoints[0].id))).toBe(30);
    expect(fillOf(await sandOf(t, user.id))).toBe(0);
  });

  it('a full checkpoint store never blocks a big save, and says so in the response', async () => {
    const { token: t, user } = await signIn('le-full');
    const edit = await claim(t);
    expect((await save(t, user.id, blob([], 0), edit)).status).toBe(200);
    // fill the store past 16 MB on paper (as in editSessions.test.ts)
    await db.query(
      "INSERT INTO checkpoints (id, owner_id, name, kind, source, from_beach, from_name, location, nx, ny, sand, bytes, items, objects, created_at) VALUES ($1, $2, 'big', 'named', 'beach', NULL, '', NULL, 16, 16, $3, $4, '{}', 0, $5)",
      [randomUUID(), user.id, blob([], 1), 16 * 1024 * 1024, Date.now()],
    );
    const big = await save(t, user.id, blob([], 200), edit);
    expect(big.status).toBe(200);
    expect(await big.json()).toMatchObject({ largeEdit: true, largeEditCheckpoint: false });
    expect(fillOf(await sandOf(t, user.id))).toBe(200);
    expect((await listCps(t)).checkpoints.filter((c) => c.kind === 'auto')).toEqual([]);
  });
});
