// Invite bonuses, against specs/tla/Invites.tla (docs/INVITES_GUIDE.md,
// docs/STATE_MACHINES.md). Fast: the real server in-process, no rendering.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INVITE_BONUS, REWARD_CAP } from '../../src/referrals.js';
import { rng, startServer, type Server } from './harness.js';
import { InvitesModel } from './invitesModel.js';

let s: Server;
beforeAll(async () => {
  s = await startServer();
});
afterAll(() => s.close());

let n = 0;
async function person(label: string) {
  n++;
  const u = await s.signIn(`${label} ${n}`);
  const code = (await s.db.query<{ code: string }>('SELECT code FROM beach WHERE owner_id = $1 AND home', [u.id]))[0]?.code
    ?? ((await (await s.req('/neighbors', {}, u.token)).json()) as { code: string }).code;
  return { ...u, code };
}
const bucks = async (id: string) =>
  Number((await s.db.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [id]))[0].credit_cents) / 10;

describe('invites: transitions', () => {
  it('ClaimAtomic: two devices of one friend at once give one bonus (the Invites.cfg OneBonusEach trace)', async () => {
    const a = await person('Inviter');
    const f = await person('Friend');
    const rs = await Promise.all([s.post('/referrals/claim', f.token, { code: a.code }), s.post('/referrals/claim', f.token, { code: a.code })]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await bucks(f.id)).toBe(INVITE_BONUS);
    expect(await bucks(a.id)).toBe(INVITE_BONUS);
  });
});

describe('invites: random walks, server vs model', () => {
  for (const seed of [41, 42, 43, 44]) {
    it(`seed ${seed}: claims (some at once) agree with the model and keep its invariants`, async () => {
      const r = rng(seed);
      const a = await person('Inviter');
      const friends = await Promise.all(Array.from({ length: REWARD_CAP + 3 }, () => person('Friend')));
      const m = new InvitesModel(REWARD_CAP, INVITE_BONUS);
      for (let step = 0; step < 25; step++) {
        // one claim, or two at once (the same friend or two friends)
        const batch = [r.pick(friends), ...(r.next() < 0.4 ? [r.pick(friends)] : [])];
        const got = await Promise.all(batch.map((f) => s.post('/referrals/claim', f.token, { code: a.code })));
        // in a race the model takes them in some order: the statuses agree as a multiset
        const want = batch.map((f) => m.claim(f.id).status);
        expect(got.map((g) => g.status).sort()).toEqual(want.sort());
        expect(m.check()).toEqual([]);
        expect(await bucks(a.id)).toBe(m.inviterBal);
        for (const f of new Set(batch)) expect(await bucks(f.id)).toBe(m.friendBal.get(f.id) ?? 0);
      }
    });
  }
});
