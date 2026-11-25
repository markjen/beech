import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Account } from '../src/net/account';
import { BeachStore } from '../src/net/beachStore';
import { BeachSync } from '../src/net/beachSync';
import { beachBackend } from '../src/net/storeBackends';
import { buildRestProfile } from '../src/sim/profile';

// BeachSync talks to window timers and the Account talks to fetch, so both
// are stubbed here: the timers never fire on their own, and fetch answers
// from a per-test table.
const timers = {
  setInterval: () => 1,
  clearInterval: () => {},
  setTimeout: () => 0,
  clearTimeout: () => {},
};
vi.stubGlobal('window', timers);

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
type Handler = (url: string, init: RequestInit) => Response;
let handler: Handler = () => jsonRes(404, { error: 'no handler' });
let calls: { method: string; url: string; headers: Record<string, string> }[] = [];
vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
  calls.push({ method: init.method ?? 'GET', url, headers: Object.fromEntries(new Headers(init.headers as HeadersInit)) });
  return handler(url, init);
});

const grid = { nx: 16, ny: 16, dx: 2 };
const rest = buildRestProfile(grid, 1);
const host = {
  read: async () => ({ delta: new Float32Array(16 * 16), objects: [] }),
  write: () => {},
};
const SAND = '/api/beaches/mine/b1/sand';

const setup = async () => {
  const account = new Account();
  account.user = { id: 'u1', name: 'Ana' };
  const store = new BeachStore(grid, rest, beachBackend(account, { saveLocal: false }));
  store.canSave = () => !!account.user;
  const sync = new BeachSync(account, store, host);
  const prev = handler;
  handler = (url, init) => (url.endsWith(SAND) && (init.method ?? 'GET') === 'GET' ? jsonRes(404, { error: 'no saved beach yet' }) : prev(url, init));
  await sync.bind({ id: 'b1', code: 'B1', owned: true });
  handler = prev;
  return { account, store, sync };
};

beforeEach(() => {
  calls = [];
  handler = () => jsonRes(404, { error: 'no handler' });
});

describe('BeachSync fencing', () => {
  it('a fenced save stops autosaving and says so, and taking over reclaims editing', async () => {
    const { account, store, sync } = await setup();
    account.editToken = 'tok-1';
    let fenced = false;
    store.onProblem((_id, p) => {
      if (p === 'fenced') fenced = true;
    });
    handler = (url, init) => {
      if (url.endsWith(SAND) && init.method === 'PUT') return jsonRes(409, { error: 'fenced' });
      return jsonRes(404, { error: 'no handler' });
    };
    sync.markDirty(1e9);
    await sync.flush();
    expect(sync.fenced).toBe(true);
    expect(sync.state).toBe('fenced');
    expect(fenced).toBe(true);
    // nothing more goes out: marking dirty after being fenced saves nothing
    const puts = calls.filter((c) => c.method === 'PUT').length;
    sync.markDirty(0);
    await sync.flush();
    expect(calls.filter((c) => c.method === 'PUT').length).toBe(puts);

    // taking over claims a fresh token and reloads the beach, then saves again
    handler = (url, init) => {
      if (url.endsWith('/api/edit-session')) return jsonRes(200, { token: 'tok-2' });
      if (url.endsWith(SAND) && init.method === 'GET') return jsonRes(404, { error: 'no saved beach yet' });
      if (url.endsWith(SAND) && init.method === 'PUT') return jsonRes(200, { version: 2, updatedAt: 123, epoch: 0 });
      return jsonRes(404, { error: 'no handler' });
    };
    await sync.takeOver();
    expect(account.editToken).toBe('tok-2');
    expect(sync.fenced).toBe(false);
    sync.markDirty(1e9);
    await sync.flush();
    const lastPut = calls.filter((c) => c.method === 'PUT').at(-1)!;
    expect(lastPut.headers['x-edit-token']).toBe('tok-2');
  });

  it('claiming on sign-in sends the fresh token on the next save', async () => {
    const { account, sync } = await setup();
    handler = (url, init) => {
      if (url.endsWith('/api/edit-session')) return jsonRes(200, { token: 'tok-9' });
      if (url.endsWith(SAND) && init.method === 'PUT') return jsonRes(200, { version: 1, updatedAt: 1, epoch: 0 });
      return jsonRes(404, { error: 'no handler' });
    };
    await sync.claim();
    expect(account.editToken).toBe('tok-9');
    sync.markDirty(1e9);
    await sync.flush();
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toContain(SAND);
    expect(put.headers['x-edit-token']).toBe('tok-9');
  });

  it('a restore refusal reloads the restored beach instead of fencing', async () => {
    const { store, sync } = await setup();
    let problem = '';
    store.onProblem((_id, p) => (problem = p));
    handler = (url, init) => {
      if (url.endsWith(SAND) && init.method === 'PUT') return jsonRes(409, { error: 'restored' });
      if (url.endsWith(SAND) && init.method === 'GET') return jsonRes(404, { error: 'no saved beach yet' });
      return jsonRes(404, { error: 'no handler' });
    };
    sync.markDirty(1e9);
    await sync.flush();
    expect(problem).toBe('restored');
    expect(sync.fenced).toBe(false);
    await new Promise((r) => setImmediate(r));
    expect(calls.some((c) => c.method === 'GET' && c.url.endsWith(SAND))).toBe(true);
  });
});
