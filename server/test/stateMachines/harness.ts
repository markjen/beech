// Shared harness for the state-machine tests (docs/STATE_MACHINES.md).
//
// The real server (createApp) runs in-process on PGlite: no browser, no
// rendering, no network. Two hooks make the TLA+ models testable:
// - a clock the test moves (snacks expire, days end);
// - a gate on the database: `gate.pauseBefore(/sql/)` stops the next request
//   that is about to run a matching statement *outside a transaction*, so a
//   test can run another request in the gap and then let the first one go.
//   That is how a TLC counterexample (specs/tla) is replayed step by step.
//   The gate skips statements inside transactions. PostgreSQL tests can
//   exercise row-lock contention with separate connections when needed.
import { deflateSync } from 'node:zlib';
import { expect } from 'vitest';
import { createApp } from '../../src/app.js';
import { type Db } from '../../src/db.js';
import { openTestDb } from '../testDb.js';

export interface Gate {
  /**
   * Pause the next non-transactional statement matching `re` (or, with
   * `orTransaction`, the next transaction about to start, whichever comes
   * first: "before the write", whether the write is a bare statement in the
   * old code or a transaction in the fixed code).
   */
  pauseBefore(re: RegExp, opts?: { orTransaction?: boolean }): { reached: Promise<void>; release: () => void };
  /** Statements seen outside transactions since the last reset (for debugging). */
  log: string[];
}

function gated(db: Db): { db: Db; gate: Gate } {
  let armed: { re: RegExp; tx: boolean; hit: () => void; wait: Promise<void> } | null = null;
  const log: string[] = [];
  const wrap = (inner: Db, inTx: boolean): Db => ({
    query: async (sql, params, operation) => {
      if (!inTx) {
        log.push(sql.replace(/\s+/g, ' ').slice(0, 80));
        if (armed && armed.re.test(sql)) {
          const a = armed;
          armed = null;
          a.hit();
          await a.wait;
        }
      }
      return inner.query(sql, params, operation);
    },
    exec: (sql) => inner.exec(sql),
    withLock: (key, fn) => inner.withLock(key, fn),
    withTransaction: async (fn) => {
      if (!inTx && armed?.tx) {
        const a = armed;
        armed = null;
        a.hit();
        await a.wait;
      }
      return inner.withTransaction((tx) => fn(wrap(tx, true)));
    },
    stats: inner.stats ? () => inner.stats!() : undefined,
    close: () => inner.close(),
  });
  const gate: Gate = {
    log,
    pauseBefore(re, opts = {}) {
      let hit!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((r) => (hit = r));
      const wait = new Promise<void>((r) => (release = r));
      armed = { re, tx: !!opts.orTransaction, hit, wait };
      return { reached, release };
    },
  };
  return { db: wrap(db, false), gate };
}

/** Noon UTC on a fixed day, so "today" never crosses midnight by accident. */
export const T0 = Date.UTC(2026, 10, 25, 12);

export async function startServer(opts: { rand?: () => number; push?: Parameters<typeof createApp>[1]["push"] } = {}) {
  const raw = await openTestDb();
  const { db, gate } = gated(raw);
  const clock = { now: T0 };
  const app = createApp(db, {
    googleClientIds: [],
    appleClientIds: [],
    allowedOrigins: [],
    devAuth: true,
    now: () => clock.now,
    rand: opts.rand ?? (() => 0.5),
    push: opts.push,
  });

  const req = (path: string, init: RequestInit = {}, token?: string) =>
    app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const post = (path: string, token: string, data: unknown = {}, headers: Record<string, string> = {}) =>
    req(path, { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json', ...headers } }, token);

  async function signIn(name: string) {
    const r = await post('/auth/dev', '', { name });
    expect(r.status).toBe(200);
    const { token, user } = (await r.json()) as { token: string; user: { id: string; name: string } };
    return { token, id: user.id, name: user.name };
  }
  const grant = async (token: string, item: string, quantity = 1) => {
    const r = await post('/dev/grant', token, { item, quantity });
    expect(r.status).toBe(204);
  };
  /** POST /edit-session: this device becomes the editor (a takeover fences the last one). */
  const claim = async (token: string) => {
    const r = await post('/edit-session', token);
    expect(r.status).toBe(200);
    return ((await r.json()) as { token: string }).token;
  };

  return { db: raw, gate, clock, app, req, post, signIn, grant, claim, close: () => raw.close() };
}

export type Server = Awaited<ReturnType<typeof startServer>>;

/** A saved beach as the app writes it (BCH2, 16x16 flat sand), holding `items`. */
export function beachBytes(items: Record<string, number>): Uint8Array {
  const objects: object[] = [];
  let id = 1;
  for (const [item, n] of Object.entries(items))
    for (let i = 0; i < n; i++) objects.push({ id: id++, item, kind: 'rock', x: 4 + id, y: 20, angle: 0, size: 0.3, variant: 1 });
  const sand = deflateSync(Buffer.from(new Int16Array(16 * 16).buffer));
  const objs = deflateSync(Buffer.from(JSON.stringify(objects)));
  const out = new Uint8Array(12 + sand.length + objs.length);
  out.set(Buffer.from('BCH2', 'latin1'), 0);
  const dv = new DataView(out.buffer);
  dv.setUint16(4, 16, true);
  dv.setUint16(6, 16, true);
  dv.setUint32(8, sand.length, true);
  out.set(sand, 12);
  out.set(objs, 12 + sand.length);
  return out;
}

/** A small seeded PRNG (mulberry32), so a failing random walk can be replayed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)] };
}
