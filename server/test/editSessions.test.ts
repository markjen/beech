import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import { openTestDb } from './testDb.js';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await openTestDb();
  app = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: ['capacitor://localhost'], devAuth: true });
});
afterAll(() => db.close());

// ---------------------------------------------------------------- helpers
/** a BCH2 beach as the app writes it: sand filled with `fill` mm, plus things */
function blob(objects: { id: number; item: string }[], fill = 0, n = 16): Uint8Array {
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
const active = async (t: string, edit: string | undefined) => {
  const r = await req('/edit-session', { headers: edit ? { 'X-Edit-Token': edit } : {} }, t);
  return ((await r.json()) as { active: boolean }).active;
};
const save = (t: string, beach: string, bytes: Uint8Array, edit?: string, epoch?: number) =>
  req(
    `/beaches/mine/${beach}/sand`,
    {
      method: 'PUT',
      body: bytes,
      headers: {
        'X-Beach-Location': 'bondi',
        'X-Beach-Nx': '16',
        'X-Beach-Ny': '16',
        'X-Beach-Max': '2000',
        ...(edit ? { 'X-Edit-Token': edit } : {}),
        ...(epoch === undefined ? {} : { 'X-Beach-Epoch': String(epoch) }),
      },
    },
    t,
  );
const sandOf = async (t: string, beach: string) => {
  const r = await req(`/beaches/mine/${beach}/sand`, {}, t);
  return { bytes: new Uint8Array(await r.arrayBuffer()), epoch: Number(r.headers.get('X-Beach-Epoch')) };
};
type Cp = { id: string; name: string; kind: string; createdAt: number };
const listCps = async (t: string) =>
  ((await (await req('/checkpoints', {}, t)).json()) as { named: number; bytesUsed: number; checkpoints: Cp[] });
const checkpoint = async (t: string, beach: string, name: string) => {
  const r = await req(`/beaches/mine/${beach}/checkpoints`, json('POST', { name }), t);
  expect(r.status).toBe(201);
  return ((await r.json()) as { checkpoint: { id: string } }).checkpoint;
};
const restore = (t: string, beach: string, id: string, edit?: string) =>
  req(
    `/beaches/mine/${beach}/restore`,
    { ...json('POST', { checkpoint: id }), headers: { 'Content-Type': 'application/json', ...(edit ? { 'X-Edit-Token': edit } : {}) } },
    t,
  );

describe('one active editor', () => {
  it('a new claim fences the old instance: its saves, restores and dig rolls are refused', async () => {
    const { token: t, user } = await signIn('ed-ana');
    const first = await claim(t);
    expect(await active(t, first)).toBe(true);
    expect((await save(t, user.id, blob([], 10), first)).status).toBe(200);
    // a second tab (or device) opens the beach: it claims, fencing the first
    const second = await claim(t);
    expect(second).not.toBe(first);
    expect(await active(t, first)).toBe(false);
    expect(await active(t, second)).toBe(true);
    const fencedSave = await save(t, user.id, blob([], 99), first);
    expect(fencedSave.status).toBe(409);
    expect(await fencedSave.json()).toEqual({ error: 'fenced' });
    // nothing written: the beach is still the first save
    expect(fillOf((await sandOf(t, user.id)).bytes)).toBe(10);
    // the new editor saves fine
    expect((await save(t, user.id, blob([], 20), second)).status).toBe(200);
    // and a restore from the fenced instance is refused too
    const cp = await checkpoint(t, user.id, 'keep');
    const fencedRestore = await restore(t, user.id, cp.id, first);
    expect(fencedRestore.status).toBe(409);
    expect(await fencedRestore.json()).toEqual({ error: 'fenced' });
    // a dig roll from the fenced instance: refused, no find spent
    const dig = await req(
      '/dig-finds',
      { ...json('POST', { pathM: 3, durationMs: 2000 }), headers: { 'Content-Type': 'application/json', 'X-Edit-Token': first } },
      t,
    );
    expect(dig.status).toBe(409);
    expect(await dig.json()).toEqual({ error: 'fenced' });
    // taking over again fences the second instance in turn
    const third = await claim(t);
    expect(await active(t, second)).toBe(false);
    expect(await active(t, third)).toBe(true);
    expect((await save(t, user.id, blob([], 30), third)).status).toBe(200);
  });

  it('no edit token at all is refused, and the heartbeat says so without one', async () => {
    const { token: t, user } = await signIn('ed-old');
    expect(await active(t, undefined)).toBe(false);
    expect((await save(t, user.id, blob([], 1))).status).toBe(426);
    // a token for someone else is not yours
    const { token: other } = await signIn('ed-other');
    const theirs = await claim(other);
    expect(await active(t, theirs)).toBe(false);
    expect((await save(t, user.id, blob([], 2), theirs)).status).toBe(409);
  });

  it('the beach roster is fenced too: a view-only instance cannot make, rename or remove a beach', async () => {
    const { token: t } = await signIn('ed-roster');
    await req('/dev/grant', json('POST', { item: 'beach', quantity: 1 }), t);
    const first = await claim(t);
    const second = await claim(t);
    const mk = await req('/beaches/mine', { ...json('POST', { name: 'Nope' }), headers: { 'Content-Type': 'application/json', 'X-Edit-Token': first } }, t);
    expect(mk.status).toBe(409);
    const made = await req(
      '/beaches/mine',
      { ...json('POST', { name: 'Yes' }), headers: { 'Content-Type': 'application/json', 'X-Edit-Token': second } },
      t,
    );
    expect(made.status).toBe(200);
    const id = ((await made.json()) as { beach: { id: string } }).beach.id;
    const rename = await req(
      `/beaches/mine/${id}`,
      { ...json('PATCH', { name: 'Nope' }), headers: { 'Content-Type': 'application/json', 'X-Edit-Token': first } },
      t,
    );
    expect(rename.status).toBe(409);
    const del = await req(`/beaches/mine/${id}`, { method: 'DELETE', headers: { 'X-Edit-Token': first } }, t);
    expect(del.status).toBe(409);
  });

  it('signing out ends the edit session with the account', async () => {
    const { token: t, user } = await signIn('ed-out');
    const edit = await claim(t);
    expect(await active(t, edit)).toBe(true);
    expect((await req('/auth/logout', { method: 'POST' }, t)).status).toBe(204);
    // the bearer token is dead, so the heartbeat is unauthenticated now
    expect((await req('/edit-session', { headers: { 'X-Edit-Token': edit } }, t)).status).toBe(401);
    expect((await db.query('SELECT 1 FROM edit_sessions WHERE user_id = $1', [user.id])).length).toBe(1); // the row stays; the session is gone
  });
});

describe('the daily auto-save', () => {
  it('keeps the beach as it was, at most once a day, in the one auto slot', async () => {
    const { token: t, user } = await signIn('as-daily');
    const edit = await claim(t);
    const today = `Auto-save ${new Date().toISOString().slice(0, 10)}`;
    // first save: nothing to keep yet
    expect((await save(t, user.id, blob([], 10), edit)).status).toBe(200);
    expect((await listCps(t)).checkpoints).toEqual([]);
    // second save: the beach as it was (fill 10) is kept
    expect((await save(t, user.id, blob([], 20), edit)).status).toBe(200);
    let list = await listCps(t);
    expect(list.named).toBe(0);
    expect(list.checkpoints).toHaveLength(1);
    expect(list.checkpoints[0]).toMatchObject({ name: today, kind: 'auto' });
    const autoId = list.checkpoints[0].id;
    const autoSand = await req(`/checkpoints/${autoId}/sand`, {}, t);
    expect(fillOf(new Uint8Array(await autoSand.arrayBuffer()))).toBe(10);
    // a third save the same day: the auto copy is left alone
    expect((await save(t, user.id, blob([], 30), edit)).status).toBe(200);
    list = await listCps(t);
    expect(list.checkpoints).toHaveLength(1);
    expect(list.checkpoints[0].id).toBe(autoId);
    expect(fillOf(new Uint8Array(await (await req(`/checkpoints/${autoId}/sand`, {}, t)).arrayBuffer()))).toBe(10);
    // a day later: the same slot is replaced with the beach as it was (fill 30)
    await db.query('UPDATE checkpoints SET created_at = $2 WHERE id = $1', [autoId, Date.now() - 25 * 3600 * 1000]);
    expect((await save(t, user.id, blob([], 40), edit)).status).toBe(200);
    list = await listCps(t);
    expect(list.checkpoints).toHaveLength(1);
    expect(list.checkpoints[0]).toMatchObject({ id: autoId, name: today, kind: 'auto' });
    expect(fillOf(new Uint8Array(await (await req(`/checkpoints/${autoId}/sand`, {}, t)).arrayBuffer()))).toBe(30);
  });

  it('a restore’s undo copy is safe for a day, then the daily save takes the slot', async () => {
    const { token: t, user } = await signIn('as-undo');
    const edit = await claim(t);
    await save(t, user.id, blob([], 10), edit);
    const cp = await checkpoint(t, user.id, 'v1');
    await save(t, user.id, blob([], 20), edit);
    const r = await restore(t, user.id, cp.id, edit);
    expect(r.status).toBe(200);
    const { undo } = (await r.json()) as { undo: string };
    // a save now does not touch the "before restoring" copy
    expect((await save(t, user.id, blob([], 30), edit)).status).toBe(200);
    let list = await listCps(t);
    expect(list.checkpoints.find((c) => c.id === undo)).toMatchObject({ name: 'Before restoring “v1”', kind: 'auto' });
    // a day later the daily save replaces it — one auto slot, the newest auto event wins
    await db.query('UPDATE checkpoints SET created_at = $2 WHERE id = $1', [undo, Date.now() - 25 * 3600 * 1000]);
    expect((await save(t, user.id, blob([], 40), edit)).status).toBe(200);
    list = await listCps(t);
    expect(list.checkpoints.filter((c) => c.kind === 'auto')).toHaveLength(1);
    expect(list.checkpoints.find((c) => c.id === undo)).toMatchObject({ kind: 'auto' });
    expect(list.checkpoints[0].name).toMatch(/^Auto-save /);
    expect(fillOf(new Uint8Array(await (await req(`/checkpoints/${undo}/sand`, {}, t)).arrayBuffer()))).toBe(30);
  });

  it('a first save on a new beach keeps nothing, and a full checkpoint store never blocks the save', async () => {
    const { token: t, user } = await signIn('as-full');
    const edit = await claim(t);
    await save(t, user.id, blob([], 10), edit);
    // a second beach: its first save has nothing to keep
    await req('/dev/grant', json('POST', { item: 'beach', quantity: 1 }), t);
    const made = await req(
      '/beaches/mine',
      { ...json('POST', { name: 'Two' }), headers: { 'Content-Type': 'application/json', 'X-Edit-Token': edit } },
      t,
    );
    const two = ((await made.json()) as { beach: { id: string } }).beach.id;
    expect((await save(t, two, blob([], 5), edit)).status).toBe(200);
    expect((await listCps(t)).checkpoints).toEqual([]);
    // fill the store past 16 MB on paper: the next save still goes through, with no snapshot
    await db.query(
      "INSERT INTO checkpoints (id, owner_id, name, kind, source, from_beach, from_name, location, nx, ny, sand, bytes, items, objects, created_at) VALUES ($1, $2, 'big', 'named', 'beach', NULL, '', NULL, 16, 16, $3, $4, '{}', 0, $5)",
      [crypto.randomUUID(), user.id, blob([], 1), 16 * 1024 * 1024, Date.now()],
    );
    expect((await save(t, user.id, blob([], 20), edit)).status).toBe(200);
    expect(fillOf((await sandOf(t, user.id)).bytes)).toBe(20);
    expect((await listCps(t)).checkpoints.filter((c) => c.kind === 'auto')).toEqual([]);
  });
});
