import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgDb, createPgliteDb, type Db } from '../src/db.js';
import { FREE_TEXT_AFTER_MS, NOTE_MAX, NOTES_PER_BEACH_DAY, QUICK_NOTES, checkNote } from '../src/inbox.js';
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
  app = createApp(db, { googleClientIds: ['web'], appleClientIds: [], allowedOrigins: [], devAuth: true });
});

afterAll(() => db.close());

const req = (path: string, init: RequestInit = {}, token?: string) =>
  app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });
let seq = 0;
type Who = { token: string; user: { id: string; name: string }; code: string };
/** a player; `old` ones are past the new-account quick-notes-only window */
async function player(name = 'p', old = true): Promise<Who> {
  const r = await req('/auth/dev', json('POST', { name: `${name}${++seq}` }));
  const s = (await r.json()) as { token: string; user: { id: string; name: string } };
  if (old) await db.query('UPDATE users SET created_at = $2 WHERE id = $1', [s.user.id, Date.now() - FREE_TEXT_AFTER_MS - 60000]);
  const n = (await (await req('/neighbors', {}, s.token)).json()) as { code: string };
  return { ...s, code: n.code };
}
async function save(w: Who) {
  const r = await req('/beach', { method: 'PUT', body: new Uint8Array([1, 2, 3]), headers: { 'X-Beach-Location': 'bondi', 'X-Beach-Nx': '256', 'X-Beach-Ny': '256' } }, w.token);
  expect(r.status).toBe(200);
}
async function seed(w: Who, item: string, n = 1) {
  await db.query(
    `INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at) SELECT $1, $2, 1, 'pull', $3 FROM generate_series(1, $4)`,
    [w.user.id, item, Date.now(), n],
  );
}
async function owned(w: Who, item: string) {
  const items = ((await (await req('/inventory', {}, w.token)).json()) as { items: { item: string; quantity: number }[] }).items;
  return items.filter((i) => i.item === item).reduce((s, i) => s + i.quantity, 0);
}
type Entry = {
  id: number; kind: string; from: { name: string; code: string } | null; item: string | null; shells: number | null;
  note: { id: number; text?: string; removed?: boolean } | null; count: number; rating?: { count: number; average: number | null };
  payload: Record<string, unknown>; read: boolean;
};
async function inbox(w: Who) {
  const r = await req('/inbox', {}, w.token);
  expect(r.status).toBe(200);
  return (await r.json()) as { unread: number; latest: { id: number; kind: string } | null; entries: Entry[] };
}
const visit = (w: Who, code: string, data: Record<string, unknown>) => req(`/beaches/${code}/visit`, json('POST', data), w.token);

describe('the note filter', () => {
  it('lets ordinary notes through, tidied', () => {
    expect(checkNote('  What a   lovely moat! ')).toEqual({ ok: true, text: 'What a lovely moat!' });
    expect(checkNote('Built this in 2026, 3 towers')).toMatchObject({ ok: true });
    expect(checkNote('Essex sand is the best')).toMatchObject({ ok: true }); // "sex" inside a word is fine
  });
  it('refuses empty, too long, links, handles, numbers and blocked words', () => {
    for (const bad of ['', '   ', 'x'.repeat(NOTE_MAX + 1), 'see www.example.com', 'go to example.com', 'add me @sandy_99', 'call 555 123 4567', 'find me on discord', 'f*ck', 'sh1t moat', 'you are a B1TCH', 42])
      expect(checkNote(bad).ok, String(bad)).toBe(false);
    expect(checkNote('x'.repeat(NOTE_MAX)).ok).toBe(true);
  });
});

describe('visitors', () => {
  it('a rating, a note and a gift arrive as one inbox row', async () => {
    const ana = await player('ana');
    const ben = await player('ben');
    await seed(ben, 'starfish');
    const r = await visit(ben, ana.code, { shells: 4, note: 'What a lovely moat!', item: 'starfish' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ rated: true, noted: true, gifted: 'starfish' });
    expect(await owned(ana, 'starfish')).toBe(1);
    expect(await owned(ben, 'starfish')).toBe(0);
    const box = await inbox(ana);
    expect(box.unread).toBe(1);
    expect(box.entries).toHaveLength(1);
    expect(box.entries[0]).toMatchObject({ kind: 'visit', from: { name: ben.user.name, code: ben.code }, item: 'starfish', shells: 4, note: { text: 'What a lovely moat!' } });
    // the poll carries it too
    const poll = (await (await req('/neighbors', {}, ana.token)).json()) as { inbox: { unread: number; latest: { kind: string; name: string } } };
    expect(poll.inbox).toMatchObject({ unread: 1, latest: { kind: 'visit', name: ben.user.name } });
    // reading clears the count
    const read = await req('/inbox/read', json('POST', { upTo: box.entries[0].id }), ana.token);
    expect(((await read.json()) as { unread: number }).unread).toBe(0);
    expect((await inbox(ana)).entries[0].read).toBe(true);
  });

  it('a gift you don’t have stops the whole visit: no note, no row', async () => {
    const ana = await player();
    const ben = await player();
    expect((await visit(ben, ana.code, { note: 'Lovely!', item: 'lighthouse' })).status).toBe(409);
    expect((await inbox(ana)).entries).toHaveLength(0);
    expect((await db.query('SELECT 1 FROM notes WHERE from_id = $1', [ben.user.id])).length).toBe(0);
  });

  it('refuses your own beach, nothing at all, and bad ratings', async () => {
    const ana = await player();
    const ben = await player();
    expect((await visit(ana, ana.code, { shells: 5 })).status).toBe(400);
    expect((await visit(ben, ana.code, {})).status).toBe(400);
    expect((await visit(ben, ana.code, { shells: 6 })).status).toBe(400);
    expect((await visit(ben, ana.code, { shells: 2.5 })).status).toBe(400);
    expect((await visit(ben, 'ZZZZZZ', { shells: 3 })).status).toBe(404);
    expect((await req(`/beaches/${ana.code}/visit`, json('POST', { shells: 3 }))).status).toBe(401);
  });

  it('ratings alone fold into one row a day, and the average shows from three', async () => {
    const ana = await player();
    const raters = [await player(), await player(), await player()];
    const shells = [5, 4, 3];
    for (const [i, r] of raters.entries()) {
      expect((await visit(r, ana.code, { shells: shells[i] })).status).toBe(200);
      const card = (await (await req(`/beaches/${ana.code}/rating`, {}, r.token)).json()) as { count: number; average: number | null; mine: number };
      expect(card.count).toBe(i + 1);
      expect(card.mine).toBe(shells[i]);
      expect(card.average).toBe(i < 2 ? null : 4);
    }
    const box = await inbox(ana);
    expect(box.entries).toHaveLength(1);
    expect(box.entries[0]).toMatchObject({ kind: 'rating', count: 3, rating: { count: 3, average: 4 } });
  });

  it('puts a refreshed rating batch above newer messages and leaves it unread', async () => {
    const ana = await player();
    const first = await player();
    const second = await player();
    expect((await visit(first, ana.code, { shells: 4 })).status).toBe(200);
    expect((await visit(first, ana.code, { note: 'Lovely sand!' })).status).toBe(200);
    const seen = await inbox(ana);
    expect((await visit(second, ana.code, { shells: 5 })).status).toBe(200);
    await req('/inbox/read', json('POST', { upTo: seen.entries[0].id }), ana.token);
    const refreshed = await inbox(ana);
    expect(refreshed.unread).toBe(1);
    expect(refreshed.entries[0]).toMatchObject({ kind: 'rating', count: 2, read: false });
  });

  it('a rating changes at most once a day (the same rating again is fine)', async () => {
    const ana = await player();
    const ben = await player();
    expect((await visit(ben, ana.code, { shells: 2 })).status).toBe(200);
    await db.query('UPDATE ratings SET updated_at = updated_at - 60000 WHERE rater_id = $1', [ben.user.id]);
    const before = await db.query('SELECT updated_at FROM ratings WHERE rater_id = $1', [ben.user.id]);
    expect((await visit(ben, ana.code, { shells: 2 })).status).toBe(200);
    expect(await db.query('SELECT updated_at FROM ratings WHERE rater_id = $1', [ben.user.id])).toEqual(before);
    expect((await inbox(ana)).entries[0].count).toBe(1);
    expect((await visit(ben, ana.code, { shells: 5 })).status).toBe(429);
    await db.query('UPDATE ratings SET updated_at = updated_at - 90000000 WHERE rater_id = $1', [ben.user.id]);
    expect((await visit(ben, ana.code, { shells: 5 })).status).toBe(200);
  });

  it('filters notes, and new accounts send quick notes only', async () => {
    const ana = await player();
    const ben = await player();
    const r = await visit(ben, ana.code, { note: 'visit www.spam.example' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain('no links');
    const fresh = await player('new', false);
    const card = (await (await req(`/beaches/${ana.code}/rating`, {}, fresh.token)).json()) as { freeText: boolean; quickNotes: string[] };
    expect(card.freeText).toBe(false);
    expect(card.quickNotes).toEqual(QUICK_NOTES);
    expect((await visit(fresh, ana.code, { note: 'Hello there' })).status).toBe(403);
    expect((await visit(fresh, ana.code, { note: 'Not a preset', quick: true })).status).toBe(400);
    expect((await visit(fresh, ana.code, { note: QUICK_NOTES[0], quick: true })).status).toBe(200);
    expect((await inbox(ana)).entries[0]).toMatchObject({ kind: 'visit', note: { text: QUICK_NOTES[0] } });
  });

  it(`sends at most ${NOTES_PER_BEACH_DAY} notes a day to one beach`, async () => {
    const ana = await player();
    const ben = await player();
    for (let i = 0; i < NOTES_PER_BEACH_DAY; i++) expect((await visit(ben, ana.code, { note: `Note ${i + 1}` })).status).toBe(200);
    expect((await visit(ben, ana.code, { note: 'One too many' })).status).toBe(429);
    // a rating alone still works
    expect((await visit(ben, ana.code, { shells: 3 })).status).toBe(200);
  });

  it('a deleted sender’s note stays, unsigned', async () => {
    const ana = await player();
    const ben = await player();
    await visit(ben, ana.code, { note: 'Bye for now' });
    expect((await req('/account', { method: 'DELETE' }, ben.token)).status).toBe(204);
    const e = (await inbox(ana)).entries[0];
    expect(e.from).toBeNull();
    expect(e.note?.text).toBe('Bye for now');
  });
});

describe('blocks and reports', () => {
  it('a blocked person can’t rate, note, gift or ask, and their rows disappear', async () => {
    const ana = await player();
    const ben = await player();
    await seed(ben, 'conch', 2);
    await visit(ben, ana.code, { note: 'Hi Ana' });
    expect((await inbox(ana)).entries).toHaveLength(1);
    expect((await req(`/blocks/${ben.code}`, { method: 'PUT' }, ana.token)).status).toBe(204);
    expect((await inbox(ana)).entries).toHaveLength(0);
    expect((await inbox(ana)).unread).toBe(0);
    expect((await visit(ben, ana.code, { shells: 1 })).status).toBe(403);
    expect((await req('/gifts', json('POST', { code: ana.code, item: 'conch' }), ben.token)).status).toBe(403);
    expect((await req('/neighbors/left', json('PUT', { code: ana.code }), ben.token)).status).toBe(403);
    expect(await owned(ben, 'conch')).toBe(2);
    const list = (await (await req('/blocks', {}, ana.token)).json()) as { blocked: { name: string; code: string }[] };
    expect(list.blocked).toEqual([{ name: ben.user.name, code: ben.code }]);
    // unblocking brings the old row back and lets them through again
    expect((await req(`/blocks/${ben.code}`, { method: 'DELETE' }, ana.token)).status).toBe(204);
    expect((await inbox(ana)).entries).toHaveLength(1);
    expect((await visit(ben, ana.code, { shells: 4 })).status).toBe(200);
    expect((await req(`/blocks/${ana.code}`, { method: 'PUT' }, ana.token)).status).toBe(400);
  });

  it('blocking takes their pending neighbor request away', async () => {
    const ana = await player();
    const ben = await player();
    expect((await req('/neighbors/left', json('PUT', { code: ana.code }), ben.token)).status).toBe(200);
    await req(`/blocks/${ben.code}`, { method: 'PUT' }, ana.token);
    const n = (await (await req('/neighbors', {}, ana.token)).json()) as { requests: unknown[] };
    expect(n.requests).toHaveLength(0);
  });

  it('only the recipient can report a note, once', async () => {
    const ana = await player();
    const ben = await player();
    const cleo = await player();
    await visit(ben, ana.code, { note: 'Rude words here' });
    const id = (await inbox(ana)).entries[0].note!.id;
    expect((await req(`/notes/${id}/report`, json('POST', { reason: 'rude' }), cleo.token)).status).toBe(404);
    expect((await req(`/notes/${id}/report`, json('POST', { reason: 'rude' }), ana.token)).status).toBe(204);
    expect((await req(`/notes/${id}/report`, json('POST', { reason: 'rude' }), ana.token)).status).toBe(204);
    const rows = await db.query('SELECT 1 FROM reports WHERE note_id = $1', [id]);
    expect(rows).toHaveLength(1);
    // hidden by the admin: the row says the note was removed
    await db.query('UPDATE notes SET hidden_at = 1 WHERE id = $1', [id]);
    expect((await inbox(ana)).entries[0].note).toEqual({ id, removed: true });
  });
});

describe('what else lands in the inbox', () => {
  it('gifts from the bag, stars (folded per day), and first stars only', async () => {
    const ana = await player();
    const ben = await player();
    const cleo = await player();
    await seed(ben, 'conch');
    expect((await req('/gifts', json('POST', { code: ana.code, item: 'conch' }), ben.token)).status).toBe(200);
    for (const w of [ben, cleo]) expect((await req(`/favorites/${ana.code}`, { method: 'PUT' }, w.token)).status).toBe(200);
    // un-star and star again: not a new star
    await req(`/favorites/${ana.code}`, { method: 'DELETE' }, ben.token);
    await req(`/favorites/${ana.code}`, { method: 'PUT' }, ben.token);
    const box = await inbox(ana);
    expect(box.entries.map((e) => [e.kind, e.count])).toEqual([
      ['star', 2],
      ['gift', 1],
    ]);
    expect(box.entries[1]).toMatchObject({ item: 'conch', from: { code: ben.code } });
  });

  it('neighbor requests (with what to accept) and links', async () => {
    const ana = await player();
    const ben = await player();
    const bensBeach = (await (await req('/beaches/mine', {}, ben.token)).json()) as { beaches: { code: string }[] };
    expect((await req('/neighbors/left', json('PUT', { code: ana.code }), ben.token)).status).toBe(200);
    const asked = (await inbox(ana)).entries[0];
    expect(asked).toMatchObject({ kind: 'neighbor_request', from: { code: ben.code }, payload: { code: bensBeach.beaches[0].code, side: 'right' } });
    expect((await req(`/neighbors/requests/${ben.code}/accept`, { method: 'POST' }, ana.token)).status).toBe(200);
    expect((await inbox(ben)).entries[0]).toMatchObject({ kind: 'neighbor_linked', from: { code: ana.code } });
  });

  it('invites: a friend joined, then settled in', async () => {
    const ana = await player();
    const fran = await player('fran', false);
    expect((await req('/referrals/claim', json('POST', { code: ana.code }), fran.token)).status).toBe(200);
    for (const s of ['dig', 'pile', 'undo']) await req(`/guide/${s}`, { method: 'POST' }, fran.token);
    const kinds = (await inbox(ana)).entries.map((e) => [e.kind, e.item]);
    expect(kinds).toEqual([
      ['invite_settled', 'parasol'],
      ['invite_joined', null],
    ]);
  });
});

describe('signed-out visits', () => {
  it('shows public beaches (on the shore, saved) and nothing else', async () => {
    const ana = await player();
    const ben = await player();
    const cleo = await player();
    await save(ana);
    await save(cleo);
    // Ben has no save; Cleo is Ana's left neighbor but off the shore
    expect((await req('/neighbors/left', json('PUT', { code: cleo.code }), ana.token)).status).toBe(200);
    await req(`/neighbors/requests/${ana.code}/accept`, { method: 'POST' }, cleo.token);
    await db.query('UPDATE beach SET on_shore = false WHERE owner_id = $1', [cleo.user.id]);

    const sand = await req(`/public/beaches/${ana.code}`);
    expect(sand.status).toBe(200);
    expect(sand.headers.get('X-Beach-Location')).toBe('bondi');
    expect(new Uint8Array(await sand.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await req(`/public/beaches/${ben.code}`)).status).toBe(404);
    expect((await req(`/public/beaches/${cleo.code}`)).status).toBe(404);

    const shore = (await (await req(`/public/shore?code=${ana.code}&depth=3`)).json()) as { center: { code: string; you: boolean }; left: { code: string }[]; right: { code: string }[] };
    expect(shore.center).toMatchObject({ code: ana.code, you: false });
    expect([...shore.left, ...shore.right].map((b) => b.code)).not.toContain(cleo.code);
    expect((await req(`/public/shore?code=${cleo.code}`)).status).toBe(404);
  });
});
