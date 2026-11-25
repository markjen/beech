// The admin console's beach tools (adminApp.ts): search, look, rename, hide
// from the shore, new code, part neighbors, clear the sand (undoable via a
// checkpoint), delete a non-home beach. Every action is audited.
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminApp } from '../src/adminApp.js';
import { createApp } from '../src/app.js';
import { createPgDb, createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrations.js';

let db: Db;
let app: ReturnType<typeof createApp>;
let admin: ReturnType<typeof createAdminApp>;
const CLI = 'cli-token-for-beaches';

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL) {
    db = createPgDb({ url: process.env.TEST_DATABASE_URL });
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } else {
    db = await createPgliteDb();
  }
  await migrate(db);
  app = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true });
  admin = createAdminApp(db, {
    googleClientId: 'web',
    adminEmails: ['admin@example.com'],
    adminTokenHash: createHash('sha256').update(CLI).digest('hex'),
    appUrl: 'https://beech.example/',
  });
});
afterAll(() => db.close());

/** a small BCH2 beach with one starfish on it */
function blob(n = 16): Uint8Array {
  const sand = deflateSync(Buffer.from(new Int16Array(n * n).fill(40).buffer));
  const objs = deflateSync(Buffer.from(JSON.stringify([{ id: 1, kind: 'starfish', item: 'starfish', x: 5, y: 5, angle: 0, size: 0.3, variant: 1 }])));
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

const json = (method: string, data?: unknown): RequestInit => ({
  method,
  ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  headers: { 'Content-Type': 'application/json' },
});
const play = (path: string, init: RequestInit = {}, token?: string) =>
  app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
const adm = (path: string, init: RequestInit = {}) =>
  admin.request(`/api${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${CLI}` } });

interface AdminBeach {
  id: string;
  code: string;
  name: string;
  home: boolean;
  onShore: boolean;
  bytes: number | null;
  epoch: number;
  left: string | null;
  right: string | null;
  owner: { id: string; name: string };
  visitUrl: string | null;
}

async function player(name: string) {
  const r = await play('/auth/dev', json('POST', { name }));
  const { token, user } = (await r.json()) as { token: string; user: { id: string } };
  const edit = ((await (await play('/edit-session', { method: 'POST' }, token)).json()) as { token: string }).token;
  // the starfish on it is theirs (a save can't hold more than the bag)
  await db.query("INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at) VALUES ($1, 'starfish', 1, 'pull', $2)", [user.id, Date.now()]);
  const save = await play('/beach', { method: 'PUT', body: blob(), headers: { 'X-Beach-Location': 'bondi', 'X-Beach-Nx': '16', 'X-Beach-Ny': '16', 'X-Beach-Items': 'starfish=1', 'X-Edit-Token': edit } }, token);
  expect(save.status).toBe(200);
  const code = ((await (await play('/neighbors', {}, token)).json()) as { code: string }).code;
  return { token, id: user.id, code, edit };
}
const find = async (q: string) => ((await (await adm(`/beaches?q=${encodeURIComponent(q)}`)).json()) as { beaches: AdminBeach[] }).beaches;
const one = async (id: string) => ((await (await adm(`/beaches/${id}`)).json()) as { beach: AdminBeach }).beach;
const audits = async (action: string) => db.query<{ target_id: string; actor: string }>('SELECT target_id, actor FROM admin_audit WHERE action = $1', [action]);

let alice: Awaited<ReturnType<typeof player>>;
let bob: Awaited<ReturnType<typeof player>>;

describe('admin beaches', () => {
  beforeAll(async () => {
    alice = await player('Alicebeach');
    bob = await player('Bobbeach');
    // alice asks bob to be on her right; bob accepts
    expect((await play('/neighbors/right', json('PUT', { code: bob.code }), alice.token)).status).toBe(200);
    expect((await play(`/neighbors/requests/${alice.code}/accept`, json('POST'), bob.token)).status).toBe(200);
  });

  it('needs an admin', async () => {
    expect((await admin.request('/api/beaches')).status).toBe(401);
    expect((await admin.request('/api/beaches', { headers: { Authorization: `Bearer ${alice.token}` } })).status).toBe(401);
  });

  it('lists and searches by code, owner name and id', async () => {
    const all = (await (await adm('/beaches')).json()) as { beaches: AdminBeach[]; more: boolean };
    expect(all.beaches.length).toBeGreaterThanOrEqual(2);
    const byCode = await find(alice.code.toLowerCase());
    expect(byCode.map((b) => b.id)).toEqual([alice.id]);
    expect(byCode[0].right).toBe(bob.code);
    expect(byCode[0].visitUrl).toBe(`https://beech.example/?visit=${alice.code}`);
    expect(byCode[0].bytes).toBeGreaterThan(0);
    expect((await find('bobbea')).map((b) => b.id)).toEqual([bob.id]);
    expect((await find(bob.id)).map((b) => b.id)).toEqual([bob.id]);
    // LIKE wildcards are taken literally
    expect(await find('%')).toEqual([]);
    const stats = (await (await adm('/stats')).json()) as { beaches: number; links: number };
    expect(stats.beaches).toBeGreaterThanOrEqual(2);
    expect(stats.links).toBe(1);
  });

  it('shows one beach', async () => {
    const r = await adm(`/beaches/${alice.id}`);
    expect(r.status).toBe(200);
    const d = (await r.json()) as { beach: AdminBeach; ownerBeaches: unknown[]; favoritedBy: number };
    expect(d.beach.owner.name).toBe('Alicebeach');
    expect(d.beach.home).toBe(true);
    expect((await adm('/beaches/not-a-uuid')).status).toBe(404);
    expect((await adm('/beaches/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('renames and hides from the shore', async () => {
    const r = await adm(`/beaches/${bob.id}`, json('PATCH', { name: '  Nicer name  ', onShore: false }));
    expect(r.status).toBe(200);
    const b = ((await r.json()) as { beach: AdminBeach }).beach;
    expect(b.name).toBe('Nicer name');
    expect(b.onShore).toBe(false);
    expect((await adm(`/beaches/${bob.id}`, json('PATCH', { onShore: 'yes' }))).status).toBe(400);
    expect((await adm(`/beaches/${bob.id}`, json('PATCH', {}))).status).toBe(400);
    // the owner sees it
    const mine = (await (await play('/beaches/mine', {}, bob.token)).json()) as { beaches: { name: string; onShore: boolean }[] };
    expect(mine.beaches[0]).toEqual(expect.objectContaining({ name: 'Nicer name', onShore: false }));
    expect(await audits('beach.update')).toEqual([{ target_id: bob.id, actor: 'cli-token' }]);
    await adm(`/beaches/${bob.id}`, json('PATCH', { onShore: true }));
  });

  it('gives a beach a new code; the old one stops working', async () => {
    const r = await adm(`/beaches/${alice.id}/new-code`, json('POST'));
    expect(r.status).toBe(200);
    const b = ((await r.json()) as { beach: AdminBeach }).beach;
    expect(b.code).not.toBe(alice.code);
    expect(b.code).toMatch(/^[A-Z2-9]{6}$/);
    expect((await play(`/beaches/${alice.code}`, {}, bob.token)).status).toBe(404);
    expect((await play(`/beaches/${b.code}`, {}, bob.token)).status).toBe(200);
    // the home beach's code is the owner's neighbor code too
    const u = await db.query<{ neighbor_code: string }>('SELECT neighbor_code FROM users WHERE id = $1', [alice.id]);
    expect(u[0].neighbor_code).toBe(b.code);
    alice.code = b.code;
  });

  it('parts two neighbors, both ends', async () => {
    expect((await adm(`/beaches/${alice.id}/unlink`, json('POST', { side: 'up' }))).status).toBe(400);
    expect((await adm(`/beaches/${alice.id}/unlink`, json('POST', { side: 'left' }))).status).toBe(404);
    const r = await adm(`/beaches/${alice.id}/unlink`, json('POST', { side: 'right' }));
    expect(r.status).toBe(200);
    expect((await one(alice.id)).right).toBeNull();
    expect((await one(bob.id)).left).toBeNull();
    expect((await db.query('SELECT 1 FROM neighbors')).length).toBe(0);
  });

  it("clears the sand, keeping it as the owner's checkpoint, and refuses the old device's save", async () => {
    const before = await one(bob.id);
    const r = await adm(`/beaches/${bob.id}/clear`, json('POST'));
    expect(r.status).toBe(200);
    const { beach, checkpoint } = (await r.json()) as { beach: AdminBeach; checkpoint: string };
    expect(beach.bytes).toBeNull();
    expect(beach.epoch).toBe(before.epoch + 1);
    // the owner gets a fresh beach
    expect((await play('/beach', {}, bob.token)).status).toBe(404);
    // ... and can restore what was there
    const cps = (await (await play('/checkpoints', {}, bob.token)).json()) as { checkpoints: { id: string; name: string; items: Record<string, number> }[] };
    const cp = cps.checkpoints.find((k) => k.id === checkpoint);
    expect(cp?.name).toBe('Before it was cleared');
    expect(cp?.items).toEqual({ starfish: 1 });
    // a device still showing the old sand (old epoch) can't save it back
    const stale = await play(
      '/beach',
      { method: 'PUT', body: blob(), headers: { 'X-Beach-Location': 'bondi', 'X-Beach-Nx': '16', 'X-Beach-Ny': '16', 'X-Beach-Epoch': String(before.epoch), 'X-Edit-Token': bob.edit } },
      bob.token,
    );
    expect(stale.status).toBe(409);
    // nothing to clear twice
    expect((await adm(`/beaches/${bob.id}/clear`, json('POST'))).status).toBe(409);
  });

  it("deletes another beach, but never someone's home", async () => {
    expect((await adm(`/beaches/${alice.id}`, { method: 'DELETE' })).status).toBe(409);
    // give alice a second beach
    await play('/dev/grant', json('POST', { item: 'beach', quantity: 1 }), alice.token);
    const made = await play('/beaches/mine', { ...json('POST', { name: 'Second' }), headers: { 'Content-Type': 'application/json', 'X-Edit-Token': alice.edit } }, alice.token);
    expect(made.status).toBe(200);
    const second = ((await made.json()) as { beach: { id: string } }).beach.id;
    const d = await adm(`/beaches/${second}`, { method: 'DELETE' });
    expect(d.status).toBe(204);
    expect((await db.query('SELECT 1 FROM beach WHERE id = $1', [second])).length).toBe(0);
    expect((await audits('beach.delete')).map((a) => a.target_id)).toEqual([second]);
  });

  it('the audit log lists every beach action', async () => {
    const r = await adm('/audit');
    const actions = ((await r.json()) as { audit: { action: string }[] }).audit.map((a) => a.action);
    for (const a of ['beach.update', 'beach.new_code', 'beach.unlink', 'beach.clear', 'beach.delete']) expect(actions).toContain(a);
  });
});
