// Suspending a sender's notes, against specs/tla/NoteSuspension.tla
// (docs/INBOX_NOTIFICATIONS.md, docs/STATE_MACHINES.md). Fast: the real game
// server and admin console in-process on one database, no rendering.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminApp } from '../../src/adminApp.js';
import { rng, startServer, type Server } from './harness.js';
import { NoteSuspensionModel } from './noteSuspensionModel.js';

const TOKEN = 'admin-cli';
let s: Server;
let admin: ReturnType<typeof createAdminApp>;
beforeAll(async () => {
  s = await startServer();
  admin = createAdminApp(s.db, {
    googleClientId: null,
    adminEmails: [],
    adminTokenHash: createHash('sha256').update(TOKEN).digest('hex'),
    now: () => s.clock.now,
  });
});
afterAll(() => s.close());

const apost = (path: string, data: unknown) =>
  admin.request(`/api${path}`, { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } });

let n = 0;
async function person(label: string) {
  n++;
  const u = await s.signIn(`${label} ${n}`);
  const code = ((await (await s.req('/neighbors', {}, u.token)).json()) as { code: string }).code;
  return { ...u, code };
}
/** a quick note (no new-account wait), with a rating so a refused note is still a whole visit */
const visit = (from: { token: string }, to: { code: string }, note = true) =>
  s.post(`/beaches/${to.code}/visit`, from.token, note ? { note: 'Lovely beach!', quick: true } : { shells: 4 });
const notesOf = async (id: string) =>
  (await s.db.query<{ hidden_at: string | null }>('SELECT hidden_at FROM notes WHERE from_id = $1 ORDER BY id', [id])).map((r) => ({ hidden: r.hidden_at !== null }));

describe('note suspension: transitions', () => {
  it('Suspend refuses notes but not ratings; Lift lets them through again', async () => {
    const sid = await person('Sender');
    const ana = await person('Ana');
    expect((await visit(sid, ana)).status).toBe(200);
    expect((await apost(`/senders/${sid.id}/suspend-notes`, { days: 7 })).status).toBe(200);
    const refused = await visit(sid, ana);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toMatch(/notes are paused/);
    expect((await visit(sid, ana, false)).status).toBe(200); // a rating alone is fine
    // without hide, what they sent before stays as it was
    expect(await notesOf(sid.id)).toEqual([{ hidden: false }]);
    expect((await apost(`/senders/${sid.id}/lift-notes`, {})).status).toBe(200);
    expect((await visit(sid, ana)).status).toBe(200);
  });

  it('Suspend with hide hides every note of theirs still shown; it runs out on its own', async () => {
    const sid = await person('Sender');
    const ana = await person('Ana');
    const ben = await person('Ben');
    expect((await visit(sid, ana)).status).toBe(200);
    expect((await visit(sid, ben)).status).toBe(200);
    const r = await apost(`/senders/${sid.id}/suspend-notes`, { days: 1, hide: true });
    expect(await r.json()).toMatchObject({ hidden: 2 });
    expect(await notesOf(sid.id)).toEqual([{ hidden: true }, { hidden: true }]);
    // the owner's inbox no longer shows the words
    const box = (await (await s.req('/inbox', {}, ana.token)).json()) as { entries: { note?: { text?: string; removed?: boolean } | null }[] };
    expect(box.entries.every((e) => !e.note?.text)).toBe(true);
    s.clock.now += 86400000 + 1;
    expect((await visit(sid, ana)).status).toBe(200);
  });

  it('refuses a bad length or an unknown player, and needs the admin', async () => {
    const sid = await person('Sender');
    expect((await apost(`/senders/${sid.id}/suspend-notes`, { days: 2 })).status).toBe(400);
    expect((await apost('/senders/00000000-0000-4000-8000-000000000000/suspend-notes', { days: 1 })).status).toBe(404);
    expect((await apost('/senders/not-an-id/lift-notes', {})).status).toBe(404);
    expect((await admin.request(`/api/senders/${sid.id}/suspend-notes`, { method: 'POST', body: '{"days":1}' })).status).toBe(401);
  });

  it('replay (NoteSuspension.cfg): a visit past its check, then suspend and hide, then its note: refused', async () => {
    const sid = await person('Sender');
    const ana = await person('Ana');
    // stop the visit just before its transaction (after any check made outside it)
    const p = s.gate.pauseBefore(/^\b$/, { orTransaction: true });
    const pending = visit(sid, ana);
    await p.reached;
    expect((await apost(`/senders/${sid.id}/suspend-notes`, { days: 7, hide: true })).status).toBe(200);
    p.release();
    expect((await pending).status).toBe(403);
    expect(await notesOf(sid.id)).toEqual([]);
  });
});

describe('note suspension: random walks, server vs model', () => {
  for (const seed of [7, 8, 9]) {
    it(`seed ${seed}: visits, suspensions, lifts and time agree with the model`, async () => {
      const r = rng(seed);
      const sid = await person('Sender');
      const owners = await Promise.all([person('A'), person('B'), person('C')]);
      const m = new NoteSuspensionModel();
      for (let step = 0; step < 30; step++) {
        const roll = r.next();
        if (roll < 0.55) {
          const note = r.next() < 0.8;
          const got = await visit(sid, r.pick(owners), note);
          expect(got.status, `step ${step}: visit`).toBe(m.visit(s.clock.now, note));
        } else if (roll < 0.75) {
          const days = r.pick([1, 7]);
          const hide = r.next() < 0.5;
          expect((await apost(`/senders/${sid.id}/suspend-notes`, { days, hide })).status).toBe(m.suspend(s.clock.now, days, hide));
        } else if (roll < 0.85) {
          expect((await apost(`/senders/${sid.id}/lift-notes`, {})).status).toBe(m.lift());
        }
        // time passes (keeps under the hourly and per-beach note limits)
        s.clock.now += 9 * 3600000;
        m.tick(s.clock.now);
        expect(m.check()).toEqual([]);
        expect(await notesOf(sid.id)).toEqual(m.notes.map((x) => ({ hidden: x.hidden })));
      }
    });
  }
});
