// The admin's system messages, against specs/tla/SystemMessages.tla
// (docs/INBOX_NOTIFICATIONS.md, docs/STATE_MACHINES.md): one message to every
// inbox, at most one a UTC day, a retry never sends twice.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminApp } from '../../src/adminApp.js';
import { pushMessage } from '../../src/push.js';
import { rng, startServer, type Server } from './harness.js';
import { SystemMessagesModel } from './systemMessagesModel.js';

const TOKEN = 'admin-cli';
const DAY = 86400000;
let s: Server;
let admin: ReturnType<typeof createAdminApp>;
beforeAll(async () => {
  s = await startServer();
  admin = createAdminApp(s.db, { googleClientId: null, adminEmails: [], adminTokenHash: createHash('sha256').update(TOKEN).digest('hex'), now: () => s.clock.now });
});
afterAll(() => s.close());

const send = (text: string, requestId: string) =>
  admin.request('/api/system-messages', { method: 'POST', body: JSON.stringify({ text, requestId }), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } });
const players = async () => (await s.db.query<{ id: string }>('SELECT id FROM users ORDER BY id')).map((r) => r.id);
const rowsOf = async () =>
  (await s.db.query<{ user_id: string; message: string }>("SELECT user_id, payload->>'message' AS message FROM inbox WHERE kind = 'system'")).map((r) => `${r.message}:${r.user_id}`);
let n = 0;
const person = () => s.signIn(`P ${++n}`);

describe('system messages: transitions', () => {
  it('Send reaches every inbox once; a retry and a second one the same day are refused; the next day sends', async () => {
    const [a] = [await person(), await person()];
    const r1 = crypto.randomUUID();
    const first = await send('Week 2’s vending set is in', r1);
    expect(first.status).toBe(200);
    expect((await first.json()) as { recipients: number }).toMatchObject({ recipients: (await players()).length });
    const box = (await (await s.req('/inbox', {}, a.token)).json()) as { entries: { kind: string; payload: { text: string } }[] };
    expect(box.entries.find((e) => e.kind === 'system')?.payload.text).toBe('Week 2’s vending set is in');
    // a retry of the same request: nothing more
    const again = await send('Week 2’s vending set is in', r1);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'that message was already sent' });
    // another message the same day: refused
    expect((await send('Another one', crypto.randomUUID())).status).toBe(409);
    // someone who joins later doesn't get the old one; tomorrow's reaches them
    const late = await person();
    s.clock.now += DAY;
    expect((await send('Tomorrow’s news', crypto.randomUUID())).status).toBe(200);
    const lateBox = (await (await s.req('/inbox', {}, late.token)).json()) as { entries: { kind: string; payload: { text: string } }[] };
    expect(lateBox.entries.filter((e) => e.kind === 'system').map((e) => e.payload.text)).toEqual(['Tomorrow’s news']);
  });

  it('refuses an empty or long message, a missing request id, and anyone but the admin', async () => {
    expect((await send('', crypto.randomUUID())).status).toBe(400);
    expect((await send('x'.repeat(141), crypto.randomUUID())).status).toBe(400);
    expect((await send('hi', 'nope')).status).toBe(400);
    expect((await admin.request('/api/system-messages', { method: 'POST', body: '{}' })).status).toBe(401);
  });

  it('pushes its words (the admin’s, never a player’s), and "news" switches it off', async () => {
    expect(pushMessage([{ kind: 'system', name: null, text: 'Week 3 is in' }]).body).toBe('Week 3 is in');
    const p = await person();
    expect(await (await s.req('/notify-prefs', {}, p.token)).json()).toMatchObject({ news: true });
    const off = await s.req('/notify-prefs', { method: 'PUT', body: JSON.stringify({ news: false }), headers: { 'Content-Type': 'application/json' } }, p.token);
    expect(await off.json()).toMatchObject({ news: false, gifts: true });
  });
});

describe('system messages: OneADay (SystemMessages.cfg)', () => {
  it('two different requests at once on a fresh day: one goes out', async () => {
    s.clock.now += 3 * DAY;
    const got = await Promise.all([send('One', crypto.randomUUID()), send('Two', crypto.randomUUID())]);
    expect(got.map((r) => r.status).sort()).toEqual([200, 409]);
    const day = new Date(s.clock.now).toISOString().slice(0, 10);
    expect((await s.db.query('SELECT 1 FROM system_messages WHERE day = $1', [day])).length).toBe(1);
  });
});

describe('system messages: random walk, server vs model', () => {
  it('sends, retries, new days and new players agree with the model', async () => {
    const r = rng(77);
    s.clock.now += 10 * DAY;
    // the model starts from what's there
    const m = new SystemMessagesModel();
    for (const row of await s.db.query<{ day: string; request_id: string }>('SELECT day, request_id FROM system_messages')) {
      m.days.add(row.day);
      m.requests.add(row.request_id);
    }
    const sent: string[] = [];
    const before = new Set(await rowsOf());
    for (let step = 0; step < 25; step++) {
      const roll = r.next();
      if (roll < 0.45) {
        const req = sent.length && r.next() < 0.4 ? r.pick(sent) : crypto.randomUUID();
        const day = new Date(s.clock.now).toISOString().slice(0, 10);
        const want = m.send(day, req, await players());
        const got = await send(`step ${step}`, req);
        expect(got.status, `step ${step}`).toBe(want.status);
        if (got.status === 200) {
          sent.push(req);
          expect(((await got.json()) as { recipients: number }).recipients).toBe(want.recipients);
        }
      } else if (roll < 0.7) {
        s.clock.now += DAY;
      } else {
        await person();
      }
    }
    // every message reached each player at most once
    const all = (await rowsOf()).filter((x) => !before.has(x));
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe([...m.rows.values()].filter((_, i) => i >= 0).reduce((t, set) => t + set.size, 0));
  });
});
