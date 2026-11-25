import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import { liveConfig } from '../src/liveBeach.js';
import { openTestDb } from './testDb.js';

// Live beaches (docs/LIVE_SIM.md): a beach read after a gap is caught up first.

let db: Db;
let t = Date.UTC(2026, 10, 1, 6);
const H = 3600000;
const cfg = { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true, now: () => t };
let app: ReturnType<typeof createApp>;
let other: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await openTestDb();
  app = createApp(db, cfg);
  // a second server instance on the same database
  other = createApp(db, cfg);
});
afterAll(() => db.close());

// ---------------------------------------------------------------- helpers
const N = 192;
/** the still-water shoreline's row (16.5 m from the offshore edge of 32 m) */
const SHORE_J = Math.round((16.5 / 32) * N);
type Obj = { id: number; kind: string; item: string; x: number; y: number; wild?: boolean };
/** a beach as the app saves it: a castle at the waterline (mm above the rest beach) and things */
function beach(objects: Obj[], castleMm = 500): Uint8Array {
  const q = new Int16Array(N * N);
  for (let j = SHORE_J - 4; j <= SHORE_J + 4; j++) for (let i = 60; i <= 72; i++) q[j * N + i] = castleMm;
  const sand = deflateSync(Buffer.from(q.buffer));
  const objs = deflateSync(Buffer.from(JSON.stringify(objects.map((o) => ({ angle: 0, size: 0.2, variant: 1, ...o })))));
  const out = new Uint8Array(12 + sand.length + objs.length);
  out.set(Buffer.from('BCH2', 'latin1'), 0);
  const dv = new DataView(out.buffer);
  dv.setUint16(4, N, true);
  dv.setUint16(6, N, true);
  dv.setUint32(8, sand.length, true);
  out.set(sand, 12);
  out.set(objs, 12 + sand.length);
  return out;
}
const sandOf = (b: Uint8Array) => {
  const len = new DataView(b.buffer, b.byteOffset).getUint32(8, true);
  return new Int16Array(new Uint8Array(inflateSync(b.subarray(12, 12 + len))).buffer);
};
const objectsOf = (b: Uint8Array): Obj[] => {
  if (Buffer.from(b.subarray(0, 4)).toString('latin1') !== 'BCH2') return [];
  const len = new DataView(b.buffer, b.byteOffset).getUint32(8, true);
  return JSON.parse(inflateSync(b.subarray(12 + len)).toString()) as Obj[];
};
const castleTop = (b: Uint8Array) => {
  const q = sandOf(b);
  let m = -Infinity;
  for (let j = SHORE_J - 4; j <= SHORE_J + 4; j++) for (let i = 60; i <= 72; i++) m = Math.max(m, q[j * N + i]);
  return m;
};

const req = (a: ReturnType<typeof createApp>, path: string, init: RequestInit = {}, token?: string) =>
  a.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });
const editTokens = new Map<string, string>();
const editToken = async (tok: string) => {
  const hit = editTokens.get(tok);
  if (hit) return hit;
  const r = await req(app, '/edit-session', { method: 'POST' }, tok);
  expect(r.status).toBe(200);
  const { token } = (await r.json()) as { token: string };
  editTokens.set(tok, token);
  return token;
};
const reqE = async (a: ReturnType<typeof createApp>, path: string, init: RequestInit = {}, token?: string) => {
  const headers = { ...(init.headers as Record<string, string>), ...(token ? { 'X-Edit-Token': await editToken(token) } : {}) };
  return req(a, path, { ...init, headers }, token);
};
async function signIn(name: string) {
  const r = await req(app, '/auth/dev', json('POST', { name }));
  return (await r.json()) as { token: string; user: { id: string } };
}
const save = (tok: string, bytes: Uint8Array, items: Record<string, number> = {}, epoch?: number) =>
  reqE(
    app,
    '/beach',
    {
      method: 'PUT',
      body: bytes,
      headers: {
        'X-Beach-Location': 'brighton',
        'X-Beach-Nx': String(N),
        'X-Beach-Ny': String(N),
        'X-Beach-Max': '2000',
        'X-Beach-Items': Object.entries(items).map(([k, v]) => `${k}=${v}`).join(','),
        ...(epoch === undefined ? {} : { 'X-Beach-Epoch': String(epoch) }),
      },
    },
    tok,
  );
async function load(tok: string, a = app) {
  const r = await req(a, '/beach', {}, tok);
  expect(r.status).toBe(200);
  return {
    bytes: new Uint8Array(await r.arrayBuffer()),
    version: Number(r.headers.get('X-Beach-Version')),
    epoch: Number(r.headers.get('X-Beach-Epoch')),
    simulatedUntil: Number(r.headers.get('X-Beach-Simulated-Until')),
  };
}
const events = (beach: string) =>
  db.query<{ tides: number; lost: number; brought: number; checkpoint: string | null; sand_moved: number }>(
    'SELECT tides, lost, brought, checkpoint, sand_moved FROM beach_events WHERE beach_id = $1 ORDER BY id',
    [beach],
  );

// ---------------------------------------------------------------- tests
describe('catch-up on read', () => {
  it('leaves a beach read soon after it was saved alone', async () => {
    const { token } = await signIn('Ana');
    expect((await save(token, beach([]))).status).toBe(200);
    t += 5 * 60000;
    const b = await load(token);
    expect(b.version).toBe(1);
    expect(b.epoch).toBe(0);
    expect(castleTop(b.bytes)).toBe(500);
  });

  it('two days later: the sea has worn the castle down, taken the owned nautilus and washed things up', async () => {
    const { token, user } = await signIn('Ben');
    await req(app, '/dev/grant', json('POST', { item: 'nautilus' }), token);
    const start = beach([
      { id: 1, kind: 'nautilus', item: 'nautilus', x: 20, y: 12 }, // under water
      { id: 2, kind: 'flag', item: 'flag', x: 6, y: 30 }, // high and dry
    ]);
    expect((await save(token, start, { nautilus: 1 })).status).toBe(200);
    const saved = await load(token);
    t += 2 * 24 * H;
    // a neighbor's or visitor's read catches it up too; here the owner's
    const b = await load(token);
    expect(b.version).toBe(saved.version + 1);
    expect(b.epoch).toBe(saved.epoch + 1);
    expect(b.simulatedUntil).toBe(t);
    expect(castleTop(b.bytes)).toBeLessThan(250);
    const objs = objectsOf(b.bytes);
    expect(objs.some((o) => o.item === 'nautilus')).toBe(false);
    expect(objs.some((o) => o.item === 'flag')).toBe(true);
    expect(objs.some((o) => o.wild)).toBe(true);
    // the server's own count: no nautilus placed any more (it's back in the bag)
    const row = (await db.query<{ items: Record<string, number> | string }>('SELECT items FROM beach WHERE id = $1', [user.id]))[0];
    const items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
    expect(items.nautilus ?? 0).toBe(0);
    // what happened, for "while you were away"
    const ev = await events(user.id);
    expect(ev.length).toBe(1);
    expect(ev[0].tides).toBeGreaterThanOrEqual(3);
    expect(ev[0].lost).toBe(1);
    expect(ev[0].brought).toBeGreaterThan(0);
    expect(ev[0].sand_moved).toBeGreaterThan(0);
    // and the beach as it was, kept as "Before the tide" (not counted)
    const list = (await (await req(app, '/checkpoints', {}, token)).json()) as {
      named: number;
      bytesUsed: number;
      checkpoints: { id: string; kind: string; name: string; items: Record<string, number> }[];
    };
    const tide = list.checkpoints.find((c) => c.kind === 'tide')!;
    expect(tide.name).toBe('Before the tide');
    expect(tide.items).toEqual({ nautilus: 1 });
    expect(tide.id).toBe(ev[0].checkpoint);
    expect(list.named).toBe(0);
    expect(list.bytesUsed).toBe(0);
    // reading again right away changes nothing
    const again = await load(token);
    expect(again.version).toBe(b.version);
    // a device still holding the old sand can't save it back over the sea's work
    expect((await save(token, start, { nautilus: 1 }, saved.epoch)).status).toBe(409);
    // the next long gap replaces the one "Before the tide", it doesn't add another
    t += 2 * 24 * H;
    await load(token);
    const tides = (await db.query("SELECT 1 FROM checkpoints WHERE from_beach = $1 AND kind = 'tide'", [user.id])).length;
    expect(tides).toBe(1);
  });

  it('a short gap catches up without a "Before the tide" checkpoint', async () => {
    const { token, user } = await signIn('Cy');
    await save(token, beach([]));
    t += 6 * H;
    await load(token);
    const ev = await events(user.id);
    expect(ev.length).toBe(1);
    expect(ev[0].checkpoint).toBeNull();
    expect((await db.query("SELECT 1 FROM checkpoints WHERE from_beach = $1 AND kind = 'tide'", [user.id])).length).toBe(0);
  });

  it("not while the owner's app has the beach open", async () => {
    const { token, user } = await signIn('Di');
    await save(token, beach([]));
    const before = await load(token);
    const r = await req(app, '/beach/here', { method: 'POST' }, token);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { epoch: number }).epoch).toBe(0);
    // time passes without a save, but the app is there (heartbeat 20 s ago)
    await db.query('UPDATE beach SET simulated_until = $2 WHERE id = $1', [user.id, t - 2 * 24 * H]);
    t += 20000;
    expect((await load(token)).version).toBe(before.version);
    // the app goes away; the heartbeat lapses
    t += 60000;
    expect((await load(token)).version).toBe(before.version + 1);
  });

  it('two servers reading at once write it once', async () => {
    const { token, user } = await signIn('Ed');
    await save(token, beach([]));
    t += 3 * 24 * H;
    const [a, b] = await Promise.all([load(token, app), load(token, other)]);
    expect(a.version).toBe(2);
    expect(b.version).toBe(2);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    expect((await events(user.id)).length).toBe(1);
  });

  it('a restore starts the clock again: the checkpoint is not eroded for the time it sat', async () => {
    const { token, user } = await signIn('Flo');
    await save(token, beach([]));
    const cp = (await (await req(app, `/beaches/mine/${user.id}/checkpoints`, json('POST', { name: 'Castle' }), token)).json()) as {
      checkpoint: { id: string };
    };
    t += 3 * 24 * H;
    await load(token); // eroded
    const r = await reqE(app, `/beaches/mine/${user.id}/restore`, json('POST', { checkpoint: cp.checkpoint.id }), token);
    expect(r.status).toBe(200);
    const b = await load(token);
    expect(castleTop(b.bytes)).toBe(500);
    expect(b.simulatedUntil).toBe(t);
  });

  it("dev only: age a beach (for the e2e test)", async () => {
    const { token } = await signIn('Gus');
    await save(token, beach([]));
    expect((await req(app, '/dev/age-beach', json('POST', { hours: 30 }), token)).status).toBe(204);
    expect((await load(token)).version).toBe(2);
    const prod = createApp(db, { ...cfg, devAuth: false });
    expect((await req(prod, '/dev/age-beach', json('POST', { hours: 30 }), token)).status).toBe(404);
  });
});

describe('config', () => {
  it('reads the cap from CATCHUP_MAX_GAP_DAYS, else 14 days', () => {
    expect(liveConfig({}).maxGapDays).toBe(14);
    expect(liveConfig({ CATCHUP_MAX_GAP_DAYS: '3' }).maxGapDays).toBe(3);
    expect(liveConfig({ CATCHUP_MAX_GAP_DAYS: 'nope' }).maxGapDays).toBe(14);
    expect(liveConfig({ CATCHUP_MAX_GAP_DAYS: '-1' }).maxGapDays).toBe(14);
    expect(liveConfig({}).tideCheckpointGapMs).toBe(12 * H);
  });
});

describe('while you were away', () => {
  const away = async (tok: string) =>
    ((await (await req(app, '/beach/away', {}, tok)).json()) as {
      away: { from: number; to: number; highTides: number; lost: number; broughtIn: number; checkpoint: string | null } | null;
    }).away;

  it('sums what the sea did since you last looked, once, with the "Before the tide" to put back', async () => {
    const { token, user } = await signIn('Hal');
    await req(app, '/dev/grant', json('POST', { item: 'nautilus' }), token);
    await save(token, beach([{ id: 1, kind: 'nautilus', item: 'nautilus', x: 20, y: 12 }]), { nautilus: 1 });
    expect(await away(token)).toBeNull();
    const start = t;
    t += 2 * 24 * H;
    await load(token);
    t += 6 * H;
    await load(token);
    const a = (await away(token))!;
    expect(a.from).toBe(start);
    expect(a.to).toBe(t);
    expect(a.highTides).toBeGreaterThanOrEqual(4);
    expect(a.lost).toBe(1);
    expect(a.broughtIn).toBeGreaterThan(0);
    const cp = (await db.query<{ id: string }>("SELECT id FROM checkpoints WHERE from_beach = $1 AND kind = 'tide'", [user.id]))[0];
    expect(a.checkpoint).toBe(cp.id);
    expect((await req(app, '/beach/away/seen', { method: 'POST' }, token)).status).toBe(204);
    expect(await away(token)).toBeNull();
    // "put it back as it was": the usual restore, castle and all
    t += 60000;
    const r = await reqE(app, `/beaches/mine/${user.id}/restore`, json('POST', { checkpoint: a.checkpoint, mode: 'drop-missing' }), token);
    expect(r.status).toBe(200);
    const b = await load(token);
    expect(castleTop(b.bytes)).toBe(500);
    expect(objectsOf(b.bytes).some((o) => o.item === 'nautilus')).toBe(true);
  });

  it('repeated visitor reads while you are away keep the original "Before the tide" until you return', async () => {
    const { token, user } = await signIn('Kit');
    const { token: visitor } = await signIn('Lou');
    await save(token, beach([]));
    const code = ((await (await req(app, '/neighbors', {}, token)).json()) as { code: string }).code;
    // first visitor after 18 h: creates "Before the tide" from the 500 mm castle
    t += 18 * H;
    expect((await req(app, `/beaches/${code}`, {}, visitor)).status).toBe(200);
    // second visitor 18 h later while owner still hasn't returned: must NOT overwrite it with eroded sand
    t += 18 * H;
    expect((await req(app, `/beaches/${code}`, {}, visitor)).status).toBe(200);
    const a = (await away(token))!;
    expect(a.checkpoint).toBeTruthy();
    const r = await reqE(app, `/beaches/mine/${user.id}/restore`, json('POST', { checkpoint: a.checkpoint, mode: 'drop-missing' }), token);
    expect(r.status).toBe(200);
    expect(castleTop((await load(token)).bytes)).toBe(500);
    // once the owner has seen it, a later >12 h gap replaces "Before the tide" with the newer state
    expect((await req(app, '/beach/away/seen', { method: 'POST' }, token)).status).toBe(204);
    await save(token, beach([], 300));
    t += 18 * H;
    await load(token);
    const a2 = (await away(token))!;
    expect(a2.checkpoint).toBeTruthy();
    expect((await reqE(app, `/beaches/mine/${user.id}/restore`, json('POST', { checkpoint: a2.checkpoint, mode: 'drop-missing' }), token)).status).toBe(200);
    expect(castleTop((await load(token)).bytes)).toBe(300);
  });

  it("someone else's beach: not yours to read", async () => {
    const { token } = await signIn('Ivy');
    const { user: other } = await signIn('Jo');
    expect((await req(app, `/beaches/mine/${other.id}/away`, {}, token)).status).toBe(404);
  });
});

describe('live viewers (L5)', () => {
  it("a visitor's reads and polls tell the owner's app someone is watching, and show when the owner is on", async () => {
    const { token: owner } = await signIn('Kai');
    const { token: visitor } = await signIn('Lu');
    await save(owner, beach([]));
    const code = ((await (await req(app, '/neighbors', {}, owner)).json()) as { code: string }).code;
    // nobody watching yet
    let here = (await (await req(app, '/beach/here', { method: 'POST' }, owner)).json()) as { watched: boolean };
    expect(here.watched).toBe(false);
    // a visitor polls: the owner is on it now
    const st = (await (await req(app, `/beaches/${code}/live`, {}, visitor)).json()) as { version: number; live: boolean };
    expect(st.live).toBe(true);
    expect(st.version).toBe(1);
    here = (await (await req(app, '/beach/here', { method: 'POST' }, owner)).json()) as { watched: boolean };
    expect(here.watched).toBe(true);
    // the owner saves: the visitor's next poll sees a new version
    await save(owner, beach([], 300));
    expect(((await (await req(app, `/beaches/${code}/live`, {}, visitor)).json()) as { version: number }).version).toBe(2);
    // the visitor leaves: after a while nobody's watching
    t += 20000;
    here = (await (await req(app, '/beach/here', { method: 'POST' }, owner)).json()) as { watched: boolean };
    expect(here.watched).toBe(false);
    // the owner's own beach isn't "watched" by its owner
    expect((await req(app, `/beaches/${code}/live`, {}, owner)).status).toBe(400);
  });
});
