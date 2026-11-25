import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Account } from '../src/net/account';
import { BeachSync } from '../src/net/beachSync';

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
vi.stubGlobal(
  'fetch',
  async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? 'GET', url, headers: Object.fromEntries(new Headers(init.headers as HeadersInit)) });
    return handler(url, init);
  },
);

const host = {
  getSand: async () => ({ delta: new Float32Array(16 * 16), objects: [] }),
  setSand: () => {},
  grid: { nx: 16, ny: 16 },
  location: () => 'bondi',
  setLocation: () => {},
};

const signedIn = () => {
  const account = new Account();
  account.user = { id: 'u1', name: 'Ana' };
  return account;
};

beforeEach(() => {
  calls = [];
  handler = () => jsonRes(404, { error: 'no handler' });
});

describe('BeachSync fencing', () => {
  it('a fenced save stops autosaving and says so, and taking over reclaims editing', async () => {
    const account = signedIn();
    account.editToken = 'tok-1';
    const sync = new BeachSync(account, host);
    let fenced = false;
    sync.onFenced(() => {
      fenced = true;
    });
    handler = (url, init) => {
      if (url.endsWith('/api/beach') && init.method === 'PUT') return jsonRes(409, { error: 'fenced' });
      return jsonRes(404, { error: 'no handler' });
    };
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
      if (url.endsWith('/api/beach') && init.method === 'GET') return jsonRes(404, { error: 'no saved beach yet' });
      if (url.endsWith('/api/beach') && init.method === 'PUT') return jsonRes(200, { version: 2, updatedAt: 123, epoch: 0 });
      return jsonRes(404, { error: 'no handler' });
    };
    await sync.takeOver();
    expect(account.editToken).toBe('tok-2');
    expect(sync.fenced).toBe(false);
    const lastPut = calls.filter((c) => c.method === 'PUT').at(-1)!;
    expect(lastPut.headers['x-edit-token']).toBe('tok-2');
  });

  it('claiming on sign-in sends the fresh token on the first save', async () => {
    const account = signedIn();
    const sync = new BeachSync(account, host);
    handler = (url, init) => {
      if (url.endsWith('/api/edit-session')) return jsonRes(200, { token: 'tok-9' });
      if (url.endsWith('/api/beach') && init.method === 'GET') return jsonRes(404, { error: 'no saved beach yet' });
      if (url.endsWith('/api/beach') && init.method === 'PUT') return jsonRes(200, { version: 1, updatedAt: 1, epoch: 0 });
      return jsonRes(404, { error: 'no handler' });
    };
    expect(await sync.restoreOrCreate(false, true)).toBe('created');
    expect(account.editToken).toBe('tok-9');
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.headers['x-edit-token']).toBe('tok-9');
  });

  it('a restore refusal still reloads the restored beach instead of fencing', async () => {
    const account = signedIn();
    account.editToken = 'tok-1';
    const sync = new BeachSync(account, host);
    let fenced = false;
    sync.onFenced(() => {
      fenced = true;
    });
    let puts = 0;
    handler = (url, init) => {
      if (url.endsWith('/api/beach') && init.method === 'PUT') {
        puts++;
        return jsonRes(409, { error: 'restored' });
      }
      if (url.endsWith('/api/beach') && init.method === 'GET') return jsonRes(404, { error: 'no saved beach yet' });
      return jsonRes(404, { error: 'no handler' });
    };
    await sync.flush();
    expect(fenced).toBe(false);
    expect(sync.fenced).toBe(false);
    // the reload after a restore tries to create (no saved beach here), which saves again
    expect(puts).toBeGreaterThanOrEqual(1);
  });
});
