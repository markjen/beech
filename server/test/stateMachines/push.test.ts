// Push notifications against specs/tla/Push.tla (docs/STATE_MACHINES.md):
// each action on its own, the races TLC found in the unlocked form replayed
// on the real server, and a seeded random walk against PushModel.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db.js';
import { PUSH_EVERY_MS, pushTick, type PushTarget, type SendResult } from '../../src/push.js';
import { T0, rng, startServer, type Server } from './harness.js';
import { ACTORS, DEVICES, KINDS, PREFS, PushModel, type Actor, type Device, type Kind } from './pushModel.js';

const P256DH = 'BOr8Z9d0rWbX6pJ0uYqk6f8m1bQhR3y9bJt4sVJm6kC1oQ7nV0eZ3uY4rX9mT2pL5wK8jH1gF6dS3aQ0zX7cV4E';
const AUTH = 'k5V2xQ8mN1bR4tY7uI0oPw';
const endpoint = (d: Device) => `https://fcm.googleapis.com/fcm/send/${d}`;
const deviceOf = (t: PushTarget) => t.endpoint.split('/').pop() as Device;

/** a fake push service: records deliveries; "gone" for expired devices; can hold a send open */
function pushService() {
  const expired = new Set<Device>();
  const delivered: string[] = [];
  let hold: { reached: () => void; wait: Promise<void> } | null = null;
  const send = async (t: PushTarget, msg: { body: string }): Promise<SendResult> => {
    if (hold) {
      const h = hold;
      hold = null;
      h.reached();
      await h.wait;
    }
    const d = deviceOf(t);
    if (expired.has(d)) return 'gone';
    delivered.push(`${d}: ${msg.body}`);
    return 'sent';
  };
  /** the next send stops until released */
  const holdNext = () => {
    let reached!: () => void;
    let release!: () => void;
    const r = new Promise<void>((x) => (reached = x));
    const wait = new Promise<void>((x) => (release = x));
    hold = { reached, wait };
    return { reached: r, release };
  };
  return { expired, delivered, send, holdNext };
}

async function world() {
  const svc = pushService();
  const s = await startServer({ push: { config: { web: { publicKey: 'x', privateKey: 'y', subject: 'mailto:t@example.com' } }, send: svc.send } });
  const ana = await s.signIn('ana');
  const actors = { ben: await s.signIn('ben'), cat: await s.signIn('cat') };
  const codes = {} as Record<Actor, string>;
  for (const a of ACTORS) codes[a] = ((await (await s.req('/neighbors', {}, actors[a].token)).json()) as { code: string }).code;
  const tokens: Partial<Record<Device, string>> = {};
  const json = (method: string, token: string | undefined, path: string, data: unknown) =>
    s.req(path, { method, body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }, token);
  const api = {
    async signIn(d: Device) {
      tokens[d] = (await s.signIn('ana')).token;
    },
    subscribe: async (d: Device) =>
      (await json('POST', tokens[d], '/push/subscribe', { platform: 'web', endpoint: endpoint(d), keys: { p256dh: P256DH, auth: AUTH }, tz: 'UTC' })).status,
    unsubscribe: async (d: Device) => (await json('DELETE', tokens[d], '/push/subscribe', { endpoint: endpoint(d) })).status,
    async signOut(d: Device) {
      const st = (await json('POST', tokens[d], '/auth/logout', {})).status;
      if (st === 204) delete tokens[d];
      return st;
    },
    async expireSession(d: Device) {
      await s.db.query('UPDATE sessions SET expires_at = $1 WHERE token_hash = (SELECT session_hash FROM push_subscriptions WHERE endpoint = $2)', [
        s.clock.now,
        endpoint(d),
      ]);
    },
    async arrive(a: Actor, kind: Kind) {
      const r = await s.db.query<{ id: string }>('INSERT INTO inbox (user_id, kind, actor_id, created_at) VALUES ($1, $2, $3, $4) RETURNING id', [
        ana.id,
        kind,
        actors[a].id,
        s.clock.now,
      ]);
      return Number(r[0].id);
    },
    read: async (upTo: number) => (await s.post('/inbox/read', ana.token, { upTo })).status,
    block: async (a: Actor, on: boolean) => (await s.req(`/blocks/${codes[a]}`, { method: on ? 'PUT' : 'DELETE' }, ana.token)).status,
    pref: async (p: string, on: boolean) => (await json('PUT', ana.token, '/notify-prefs', { [p]: on })).status,
    tick: () => pushTick(s.db, svc.send, () => s.clock.now),
  };
  const names = { ben: actors.ben.name, cat: actors.cat.name };
  return { s, svc, api, names, ana };
}

/** the database, as the model sees it */
async function snapshot(s: Server, ana: string) {
  const subs = (await s.db.query<{ endpoint: string }>('SELECT endpoint FROM push_subscriptions WHERE user_id = $1', [ana])).map((r) => r.endpoint.split('/').pop()).sort();
  const pushed = (await s.db.query<{ id: string; pushed_at: string | null }>('SELECT id, pushed_at FROM inbox WHERE user_id = $1 ORDER BY id', [ana])).map(
    (r) => [Number(r.id), r.pushed_at !== null],
  );
  const last = Number((await s.db.query<{ last_push_at: string }>('SELECT last_push_at FROM push_state WHERE user_id = $1', [ana]))[0]?.last_push_at ?? 0);
  return { subs, pushed, last };
}

let s: Server | null = null;
afterEach(async () => {
  await s?.close();
  s = null;
});

describe('Push: one action at a time', () => {
  it('a device subscribed while signed in gets a pushed kind, once; a star never', async () => {
    const w = await world();
    s = w.s;
    expect(await w.api.subscribe('d1')).toBe(401); // not signed in
    await w.api.signIn('d1');
    expect(await w.api.subscribe('d1')).toBe(204);
    await w.api.arrive('ben', 'star');
    await w.api.tick();
    expect(w.svc.delivered).toEqual([]);
    await w.api.arrive('ben', 'gift');
    await w.api.tick();
    await w.api.tick();
    expect(w.svc.delivered).toEqual([`d1: ${w.names.ben} gave you a gift`]);
  });

  it('one push an hour; what arrives in the hour folds into the next', async () => {
    const w = await world();
    s = w.s;
    await w.api.signIn('d1');
    await w.api.subscribe('d1');
    await w.api.arrive('ben', 'gift');
    await w.api.tick();
    await w.api.arrive('cat', 'gift');
    await w.api.arrive('ben', 'neighbor_request');
    w.s.clock.now += PUSH_EVERY_MS / 2;
    await w.api.tick();
    expect(w.svc.delivered).toHaveLength(1);
    w.s.clock.now += PUSH_EVERY_MS / 2;
    await w.api.tick();
    expect(w.svc.delivered[1]).toBe(`d1: ${w.names.cat} and 1 other left you something`);
  });

  it('quiet hours wait until morning; a read row is never pushed', async () => {
    const w = await world();
    s = w.s;
    await w.api.signIn('d1');
    await w.api.subscribe('d1');
    w.s.clock.now = T0 + 11 * 3600_000; // 23:00 UTC
    await w.api.arrive('ben', 'gift');
    const read = await w.api.arrive('cat', 'gift');
    await w.api.tick();
    expect(w.svc.delivered).toEqual([]);
    expect(await w.api.read(read - 1)).toBe(200);
    w.s.clock.now = T0 + 20 * 3600_000; // 08:00
    await w.api.tick();
    expect(w.svc.delivered).toEqual([`d1: ${w.names.cat} gave you a gift`]);
  });

  it('blocked people and muted kinds are not pushed; a gone device is deleted', async () => {
    const w = await world();
    s = w.s;
    await w.api.signIn('d1');
    await w.api.signIn('d2');
    await w.api.subscribe('d1');
    await w.api.subscribe('d2');
    expect(await w.api.block('ben', true)).toBe(204);
    expect(await w.api.pref('neighbors', false)).toBe(200);
    await w.api.arrive('ben', 'gift');
    await w.api.arrive('cat', 'neighbor_request');
    await w.api.tick();
    expect(w.svc.delivered).toEqual([]);
    w.svc.expired.add('d2');
    await w.api.arrive('cat', 'gift');
    await w.api.tick();
    expect(w.svc.delivered).toEqual([`d1: ${w.names.cat} gave you a gift`]);
    expect((await snapshot(w.s, w.ana.id)).subs).toEqual(['d1']);
  });
});

/*
 * TLC's counterexamples in the unlocked form (specs/tla/Push.cfg), replayed:
 * a push is held open at the push service while another request runs. On
 * the built code each of those requests waits for the push to finish, so
 * nothing reaches a device after the request returned, and a second tick
 * finds nothing left to send.
 */
describe('Push: the races TLC found, replayed', () => {
  async function heldPush() {
    const w = await world();
    s = w.s;
    await w.api.signIn('d1');
    await w.api.subscribe('d1');
    await w.api.arrive('ben', 'gift');
    const held = w.svc.holdNext();
    const tick = w.api.tick();
    await held.reached;
    return { w, held, tick };
  }
  /** run `req` while the push is held; returns the deliveries made before it returned */
  async function during(req: (w: Awaited<ReturnType<typeof world>>) => Promise<unknown>) {
    const { w, held, tick } = await heldPush();
    const events: string[] = [];
    const done = req(w).then(() => events.push(`returned after ${w.svc.delivered.length}`));
    await new Promise((r) => setTimeout(r, 20));
    held.release();
    await tick;
    await done;
    await w.api.tick();
    return { w, events };
  }

  it('AtMostOnce, OnePerHour: two ticks at once send one push', async () => {
    const { w, held, tick } = await heldPush();
    const second = w.api.tick();
    await new Promise((r) => setTimeout(r, 20));
    held.release();
    await Promise.all([tick, second]);
    expect(w.svc.delivered).toEqual([`d1: ${w.names.ben} gave you a gift`]);
  });

  it('NotAfterGone: an unsubscribe during a push returns after it', async () => {
    const { w, events } = await during((w) => w.api.unsubscribe('d1'));
    expect(events).toEqual(['returned after 1']);
    expect(w.svc.delivered).toHaveLength(1);
  });

  it('NotAfterGone: a sign-out during a push returns after it, and takes the subscription', async () => {
    const { w, events } = await during((w) => w.api.signOut('d1'));
    expect(events).toEqual(['returned after 1']);
    expect((await snapshot(w.s, w.ana.id)).subs).toEqual([]);
  });

  it('NeverBlocked: a block during a push returns after it', async () => {
    const { w, events } = await during(async (w) => {
      await w.api.block('ben', true);
      await w.api.arrive('ben', 'gift');
    });
    expect(events).toEqual(['returned after 1']);
    w.s.clock.now += PUSH_EVERY_MS;
    await w.api.tick();
    expect(w.svc.delivered).toHaveLength(1);
  });

  it('NeverMuted: turning gifts off during a push returns after it', async () => {
    const { w, events } = await during(async (w) => {
      await w.api.pref('gifts', false);
      await w.api.arrive('cat', 'gift');
    });
    expect(events).toEqual(['returned after 1']);
    w.s.clock.now += PUSH_EVERY_MS;
    await w.api.tick();
    expect(w.svc.delivered).toHaveLength(1);
  });

  it('skips elapsed sessions whose subscriptions have not been cleaned up', async () => {
    const w = await world();
    s = w.s;
    for (const d of DEVICES) {
      await w.api.signIn(d);
      await w.api.subscribe(d);
    }
    await w.api.expireSession('d1');
    await w.api.arrive('ben', 'gift');
    await w.api.tick();
    expect(w.svc.delivered).toEqual([`d2: ${w.names.ben} gave you a gift`]);
    expect((await snapshot(w.s, w.ana.id)).subs).toEqual(['d1', 'd2']);
  });

  it('rechecks mutes after the claim commits and before delivery', async () => {
    const w = await world();
    s = w.s;
    await w.api.signIn('d1');
    await w.api.subscribe('d1');
    await w.api.arrive('ben', 'gift');
    let transactions = 0;
    const db = {
      ...w.s.db,
      withTransaction: async <T>(fn: (tx: Db) => Promise<T>) => {
        if (++transactions === 2) expect(await w.api.pref('gifts', false)).toBe(200);
        return w.s.db.withTransaction(fn);
      },
    };
    await pushTick(db, w.svc.send, () => w.s.clock.now);
    expect(w.svc.delivered).toEqual([]);
  });

  it('does not replay an accepted push when the delivery transaction rolls back', async () => {
    const w = await world();
    s = w.s;
    await w.api.signIn('d1');
    await w.api.subscribe('d1');
    await w.api.arrive('ben', 'gift');
    const db = {
      ...w.s.db,
      withTransaction: <T>(fn: (tx: Db) => Promise<T>) =>
        w.s.db.withTransaction(async (tx) => {
          const result = await fn(tx);
          if (w.svc.delivered.length) throw new Error('delivery transaction lost');
          return result;
        }),
    };
    await expect(pushTick(db, w.svc.send, () => w.s.clock.now)).rejects.toThrow('delivery transaction lost');
    w.s.clock.now += PUSH_EVERY_MS;
    await w.api.tick();
    expect(w.svc.delivered).toEqual([`d1: ${w.names.ben} gave you a gift`]);
  });

  it('keeps both changes when two requests edit different preferences', async () => {
    const w = await world();
    s = w.s;
    const gate = w.s.gate.pauseBefore(/INSERT INTO notify_prefs/, { orTransaction: true });
    const gifts = w.api.pref('gifts', false);
    await gate.reached;
    try {
      expect(await w.api.pref('neighbors', false)).toBe(200);
    } finally {
      gate.release();
    }
    expect(await gifts).toBe(200);
    const prefs = await w.s.req('/notify-prefs', {}, w.ana.token);
    expect(await prefs.json()).toEqual({ gifts: false, neighbors: false, invites: true });
  });
});

describe('Push: random walks against the model', () => {
  const walked: number[] = [];
  afterAll(() => {
    // the walks are only worth something if pushes happen in them
    expect(walked.reduce((a, b) => a + b, 0)).toBeGreaterThan(8);
  });
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}`, async () => {
      const w = await world();
      s = w.s;
      const m = new PushModel(w.s.clock.now, w.names);
      const r = rng(seed);
      const trace: string[] = [];
      // both devices start signed in, the first subscribed
      for (const d of DEVICES) {
        await w.api.signIn(d);
        m.signIn(d);
      }
      expect(await w.api.subscribe('d1')).toBe(m.subscribe('d1'));
      for (let step = 0; step < 80; step++) {
        const d = r.pick(DEVICES);
        const a = r.pick(ACTORS);
        const choice = r.int(15);
        let label = '';
        if (choice === 0) {
          label = `signIn ${d}`;
          if (!m.signedIn.has(d)) {
            await w.api.signIn(d);
            m.signIn(d);
          }
        } else if (choice === 1) {
          label = `subscribe ${d}`;
          if (m.signedIn.has(d)) {
            expect(await w.api.subscribe(d)).toBe(m.subscribe(d));
            w.svc.expired.delete(d); // a fresh endpoint
          }
        } else if (choice === 2) {
          label = `unsubscribe ${d}`;
          if (m.signedIn.has(d)) expect(await w.api.unsubscribe(d)).toBe(m.unsubscribe(d));
        } else if (choice === 3) {
          label = `signOut ${d}`;
          if (m.signedIn.has(d)) expect(await w.api.signOut(d)).toBe(m.signOut(d));
        } else if (choice === 4) {
          label = `expire ${d}`;
          if (m.subs.has(d)) {
            m.expire(d);
            w.svc.expired.add(d);
          }
        } else if (choice <= 6 || choice === 14) {
          const k = r.pick(KINDS);
          label = `arrive ${a} ${k}`;
          m.arrive(await w.api.arrive(a, k), a, k);
        } else if (choice === 7) {
          label = `block ${a}`;
          const on = !m.blocked.has(a);
          expect(await w.api.block(a, on)).toBe(204);
          if (on) m.block(a);
          else m.unblock(a);
        } else if (choice === 8) {
          const p = r.pick(PREFS);
          const on = m.muted.has(p);
          label = `pref ${p} ${on}`;
          expect(await w.api.pref(p, on)).toBe(200);
          m.setPref(p, on);
        } else if (choice === 9 && m.rows.length) {
          const upTo = r.pick(m.rows).id;
          label = `read ${upTo}`;
          expect(await w.api.read(upTo)).toBe(200);
          m.read(upTo);
        } else if (choice === 10) {
          label = 'wait 1h';
          w.s.clock.now += 3600_000;
          m.now = w.s.clock.now;
        } else {
          label = 'tick';
          const before = w.svc.delivered.length;
          const want = m.push();
          await w.api.tick();
          expect(w.svc.delivered.slice(before).sort(), `seed ${seed}\n${trace.join('\n')}\ntick`).toEqual(want.sort());
        }
        if (label) trace.push(label);
        const snap = await snapshot(w.s, w.ana.id);
        const ctx = `seed ${seed}\n${trace.join('\n')}`;
        expect(snap.subs, ctx).toEqual([...m.subs].sort());
        expect(snap.pushed, ctx).toEqual(m.rows.map((x) => [x.id, x.pushed]));
        expect(snap.last, ctx).toBe(m.lastPush);
        // the invariants: at most one push an hour; nothing reaches a device that isn't subscribed
        expect(w.svc.delivered, ctx).toEqual(m.delivered);
      }
      walked.push(m.delivered.length);
    });
  }
});
