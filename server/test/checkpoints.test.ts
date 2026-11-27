import { readFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { MAX_OBJECTS, OLD_MAX_OBJECTS, dropMissing, inspectBlob, shortfall } from '../src/checkpoints.js';
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
type Obj = { id: number; item: string; wild?: boolean };
/** a BCH2 beach as the app writes it: sand filled with `fill` mm, plus things */
function blob(objects: Obj[], fill = 0, n = 16, ny = n): Uint8Array {
  const q = new Int16Array(n * ny).fill(fill);
  const sand = deflateSync(Buffer.from(q.buffer));
  const objs = deflateSync(Buffer.from(JSON.stringify(objects.map((o) => ({ kind: 'rock', x: 5, y: 20, angle: 0, size: 0.3, variant: 1, ...o })))));
  const out = new Uint8Array(12 + sand.length + objs.length);
  out.set(Buffer.from('BCH2', 'latin1'), 0);
  const dv = new DataView(out.buffer);
  dv.setUint16(4, n, true);
  dv.setUint16(6, ny, true);
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
/** one edit token per bearer token: claim once, reuse (a new claim would fence the old one) */
const editTokens = new Map<string, string>();
const editToken = async (t: string) => {
  const hit = editTokens.get(t);
  if (hit) return hit;
  const r = await req('/edit-session', { method: 'POST' }, t);
  expect(r.status).toBe(200);
  const { token } = (await r.json()) as { token: string };
  editTokens.set(t, token);
  return token;
};
/** a request from the current editor (saves, restores, the beach roster, dig rolls) */
const reqE = async (path: string, init: RequestInit = {}, token?: string) => {
  const headers = { ...(init.headers as Record<string, string>), ...(token ? { 'X-Edit-Token': await editToken(token) } : {}) };
  return req(path, { ...init, headers }, token);
};
const save = async (t: string, beach: string, bytes: Uint8Array, items: Record<string, number> = {}, epoch?: number) =>
  reqE(
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
const restore = (t: string, beach: string, id: string, mode?: string) => reqE(`/beaches/mine/${beach}/restore`, json('POST', { checkpoint: id, mode }), t);
const sandOf = async (t: string, beach: string) => {
  const r = await req(`/beaches/mine/${beach}/sand`, {}, t);
  return { bytes: new Uint8Array(await r.arrayBuffer()), epoch: Number(r.headers.get('X-Beach-Epoch')) };
};
const newBeach = async (t: string, name: string) => {
  await grant(t, 'beach');
  const r = await reqE('/beaches/mine', json('POST', { name }), t);
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
    const many = (n: number) => blob(Array.from({ length: n }, (_, i) => ({ id: i + 1, item: 'rock' })));
    expect(inspectBlob(many(MAX_OBJECTS)).objects).toBe(MAX_OBJECTS);
    expect(() => inspectBlob(many(MAX_OBJECTS + 1))).toThrow(/too many/);
  });
  it('drops the newest of what is short, keeping the sand', () => {
    const b = blob([{ id: 1, item: 'deckchair' }, { id: 5, item: 'deckchair' }, { id: 3, item: 'deckchair' }, { id: 2, item: 'rock' }], 120);
    const { bytes, dropped } = dropMissing(b, [{ item: 'deckchair', need: 3, have: 1 }]);
    expect(dropped).toBe(2);
    expect(objectsOf(bytes).map((o) => o.id)).toEqual([1, 2]);
    expect(fillOf(bytes)).toBe(120);
  });
  it('reads BCH3 saves with rock cover, rejects corrupt cover, and keeps cover when dropping items', () => {
    const n = 16;
    const sand = deflateSync(Buffer.from(new Int16Array(n * n).fill(80).buffer));
    const objs = deflateSync(
      Buffer.from(
        JSON.stringify([
          { id: 1, kind: 'rock', item: 'rock', x: 5, y: 20, angle: 0, size: 0.4, variant: 1, base: 0.5 },
          { id: 2, kind: 'deckchair', item: 'deckchair', x: 6, y: 20, angle: 0, size: 1, variant: 1 },
          { id: 3, kind: 'deckchair', item: 'deckchair', x: 7, y: 20, angle: 0, size: 1, variant: 1 },
        ]),
      ),
    );
    const coverArr = new Int16Array(n * n);
    coverArr[5] = 250;
    const cov = deflateSync(Buffer.from(coverArr.buffer));
    const b3 = new Uint8Array(16 + sand.length + objs.length + cov.length);
    b3.set(Buffer.from('BCH3', 'latin1'), 0);
    const dv = new DataView(b3.buffer);
    dv.setUint16(4, n, true);
    dv.setUint16(6, n, true);
    dv.setUint32(8, sand.length, true);
    dv.setUint32(12, objs.length, true);
    b3.set(sand, 16);
    b3.set(objs, 16 + sand.length);
    b3.set(cov, 16 + sand.length + objs.length);

    expect(inspectBlob(b3)).toEqual({ nx: n, ny: n, items: { deckchair: 2 }, objects: 3 });
    expect(() => inspectBlob(b3.subarray(0, b3.length - 3))).toThrow(/corrupt/);

    const { bytes, dropped } = dropMissing(b3, [{ item: 'deckchair', need: 2, have: 1 }]);
    expect(dropped).toBe(1);
    expect(Buffer.from(bytes.subarray(0, 4)).toString('latin1')).toBe('BCH3');
    expect(inspectBlob(bytes)).toEqual({ nx: n, ny: n, items: { deckchair: 1 }, objects: 2 });
    const dv2 = new DataView(bytes.buffer, bytes.byteOffset);
    const sLen = dv2.getUint32(8, true);
    const oLen = dv2.getUint32(12, true);
    const covBack = new Int16Array(new Uint8Array(inflateSync(bytes.subarray(16 + sLen + oLen))).buffer);
    expect(covBack[5]).toBe(250);
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

  it('an automatic copy ("before import") replaces the last one and does not count', async () => {
    const { token: t, user } = await signIn('cp-auto');
    await save(t, user.id, blob([], 1));
    const r1 = await req(`/beaches/mine/${user.id}/checkpoints`, json('POST', { name: 'Before import', auto: true }), t);
    expect(r1.status).toBe(201);
    await save(t, user.id, blob([], 2));
    const r2 = (await (await req(`/beaches/mine/${user.id}/checkpoints`, json('POST', { name: 'Before import again', auto: true }), t)).json()) as { checkpoint: { id: string; kind: string } };
    const list = (await (await req('/checkpoints', {}, t)).json()) as { named: number; checkpoints: { id: string; name: string }[] };
    expect(list.named).toBe(0);
    expect(list.checkpoints.map((c) => c.name)).toEqual(['Before import again']);
    expect(r2.checkpoint).toMatchObject({ id: ((await r1.json()) as { checkpoint: { id: string } }).checkpoint.id, kind: 'auto' });
    expect(fillOf(new Uint8Array(await (await req(`/checkpoints/${r2.checkpoint.id}/sand`, {}, t)).arrayBuffer()))).toBe(2);
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

  it('a save from before a restore is refused; one from after, or with no epoch header, is not', async () => {
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
    expect((await save(t, user.id, blob([], 12))).status).toBe(200); // no epoch header, but the current edit token
    // no edit token at all: an older app is refused outright (426, reload to save)
    const noToken = await req(`/beaches/mine/${user.id}/sand`, {
      method: 'PUT',
      body: blob([], 13),
      headers: { 'X-Beach-Location': 'bondi', 'X-Beach-Nx': '16', 'X-Beach-Ny': '16', 'X-Beach-Max': '2000' },
    }, t);
    expect(noToken.status).toBe(426);
    // a stale edit token: another instance took over — 409 fenced, nothing written
    await req('/edit-session', { method: 'POST' }, t);
    const fencedSave = await save(t, user.id, blob([], 14), {}, r.epoch);
    expect(fencedSave.status).toBe(409);
    expect(await fencedSave.json()).toEqual({ error: 'fenced' });
    expect(fillOf((await sandOf(t, user.id)).bytes)).toBe(12);
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
    expect((await reqE(`/beaches/mine/${b}`, json('PATCH', { name: 'Renamed' }), t)).status).toBe(200);
    const afterRename = await checkpoint(t, b, 'keepsake after rename');
    const sameName = await newBeach(t, 'Renamed');
    await save(t, sameName, blob([], 6));
    const other = await checkpoint(t, sameName, 'another keepsake');
    expect((await reqE(`/beaches/mine/${b}`, { method: 'DELETE' }, t)).status).toBe(204);
    expect((await reqE(`/beaches/mine/${sameName}`, { method: 'DELETE' }, t)).status).toBe(204);
    const list = (await (await req('/checkpoints', {}, t)).json()) as { checkpoints: { id: string; fromBeach: unknown; fromName: string }[] };
    expect(list.checkpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: cp.id, fromBeach: null, fromName: 'Gone soon', originBeachId: b }),
      expect.objectContaining({ id: afterRename.id, fromBeach: null, fromName: 'Renamed', originBeachId: b }),
      expect.objectContaining({ id: other.id, fromBeach: null, fromName: 'Renamed', originBeachId: sameName }),
    ]));
    expect((await restore(t, user.id, cp.id)).status).toBe(200);
    await req('/account', { method: 'DELETE' }, t);
    expect((await db.query('SELECT 1 FROM checkpoints WHERE owner_id = $1', [user.id])).length).toBe(0);
  });

  it('an app from before the raise can not save over a beach holding more than it can', async () => {
    const { token: t, user } = await signIn('cp-old');
    const many = blob(Array.from({ length: OLD_MAX_OBJECTS + 50 }, (_, i) => ({ id: i + 1, item: 'rock' })));
    const put = (bytes: Uint8Array, max?: string) =>
      reqE(
        `/beaches/mine/${user.id}/sand`,
        { method: 'PUT', body: bytes, headers: { 'X-Beach-Location': 'bondi', 'X-Beach-Nx': '16', 'X-Beach-Ny': '16', ...(max ? { 'X-Beach-Max': max } : {}) } },
        t,
      );
    expect((await put(many, String(MAX_OBJECTS))).status).toBe(200);
    // an old app (no X-Beach-Max) would have kept only the first 400: refused, so nothing is lost
    const old = await put(blob([{ id: 1, item: 'rock' }]));
    expect(old.status).toBe(426);
    expect((await sandOf(t, user.id)).bytes.length).toBe(many.length);
    // a beach within the old limit: old apps still save as before
    expect((await put(blob([]), String(MAX_OBJECTS))).status).toBe(200);
    expect((await put(blob([{ id: 1, item: 'rock' }]))).status).toBe(200);
  });

  it('saves a beach deeper than it is wide (sand rows inland), and an app from before can not squeeze it', async () => {
    const { token: t, user } = await signIn('cp-deep');
    const put = (bytes: Uint8Array, ny: number, deep: boolean) =>
      reqE(
        `/beaches/mine/${user.id}/sand`,
        {
          method: 'PUT',
          body: bytes,
          headers: { 'X-Beach-Location': 'bondi', 'X-Beach-Nx': '16', 'X-Beach-Ny': String(ny), 'X-Beach-Max': String(MAX_OBJECTS), ...(deep ? { 'X-Beach-Deep': '1' } : {}) },
        },
        t,
      );
    // a thing on the row behind (40 m from the sea edge) is counted like any other
    const deepBeach = blob([{ id: 1, item: 'rock', y: 40 }], 0, 16, 28);
    expect((await put(deepBeach, 28, true)).status).toBe(200);
    expect((await sandOf(t, user.id)).bytes.length).toBe(deepBeach.length);
    // shallower than wide is still the old 32 x 24 app
    expect((await put(blob([], 0, 16, 12), 12, true)).status).toBe(426);
    // an app from before sand rows would have squeezed it into the square: refused
    expect((await put(blob([]), 16, false)).status).toBe(426);
    expect((await sandOf(t, user.id)).bytes.length).toBe(deepBeach.length);
    // this app can take the rows away
    expect((await put(blob([]), 16, true)).status).toBe(200);
    // and with a square beach stored, an old app saves as before
    expect((await put(blob([]), 16, false)).status).toBe(200);
  });

  it('lets the phone apps send its headers and PATCH', async () => {
    const r = await req('/checkpoints', { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost' } });
    const allow = r.headers.get('Access-Control-Allow-Headers') ?? '';
    for (const h of ['X-Beach-Items', 'X-Beach-Epoch', 'X-Beach-Max', 'X-Beach-Deep', 'X-Checkpoint-Name', 'X-Edit-Token']) expect(allow).toContain(h);
    expect(r.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
    expect(r.headers.get('Access-Control-Expose-Headers')).toContain('X-Beach-Epoch');
  });
});

describe('rate limits', () => {
  it('slows down one IP that hammers the API, signs-ins sooner; others and webhooks are unaffected', async () => {
    const limited = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true, rateLimit: { perMinute: 5, signInsPerMinute: 2 } });
    const from = (ip: string, path: string, init: RequestInit = {}) =>
      limited.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), 'X-Forwarded-For': `${ip}, 10.0.0.1` } });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await from('1.2.3.4', '/health')).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await from('1.2.3.4', '/health')).headers.get('Retry-After')).toBe('60');
    expect((await from('5.6.7.8', '/health')).status).toBe(200); // someone else
    const signIn = () => from('9.9.9.9', '/auth/dev', { method: 'POST', body: JSON.stringify({ name: 'rl' }), headers: { 'Content-Type': 'application/json' } });
    expect([(await signIn()).status, (await signIn()).status, (await signIn()).status]).toEqual([200, 200, 429]);
    // the stores' webhooks aren't limited (they fail on their signature instead)
    for (let i = 0; i < 8; i++) expect((await from('1.2.3.4', '/store/google/rtdn', { method: 'POST', body: '{}' })).status).not.toBe(429);
    // no forwarded IP (local development, tests): no limit
    for (let i = 0; i < 8; i++) expect((await limited.request('/health')).status).toBe(200);
  });
});
