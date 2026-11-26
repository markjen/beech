// Account.identities() / attachIdentity(): the "connected sign-ins"
// section in Settings reads and writes these.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Account, ApiError } from '../src/net/account';

let calls: { url: string; body: unknown }[] = [];
let identities: string[] = [];

beforeEach(() => {
  calls = [];
  identities = ['google'];
  vi.stubGlobal(
    'fetch',
    async (url: string, init: RequestInit = {}) => {
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, body });
      if (url === '/api/account/identities' && (!init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ identities }), { status: 200 });
      }
      if (url === '/api/account/identities' && init.method === 'POST') {
        if (body.provider === 'apple' && body.credential === 'taken-token') {
          return new Response(
            JSON.stringify({ error: 'that apple sign-in is already linked to another Beech account. To use it here, sign in with that account and delete this one first, or link this account to it with a link code from the other device.' }),
            { status: 409 },
          );
        }
        if (body.provider === 'apple' && body.credential === 'good-token') {
          identities = [...identities, 'apple'];
          return new Response(JSON.stringify({ identities }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'bad token' }), { status: 401 });
      }
      return new Response('{}', { status: 404 });
    },
  );
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Account identities', () => {
  it('lists the linked sign-ins', async () => {
    const account = new Account();
    expect(await account.identities()).toEqual(['google']);
    expect(calls).toEqual([{ url: '/api/account/identities', body: undefined }]);
  });

  it('attaches a new sign-in and returns the updated list', async () => {
    const account = new Account();
    expect(await account.attachIdentity('apple', 'good-token', 'Ada')).toEqual(['google', 'apple']);
    expect(calls[0]).toEqual({
      url: '/api/account/identities',
      body: { provider: 'apple', credential: 'good-token', name: 'Ada' },
    });
  });

  it('surfaces the server’s 409 message when the identity belongs to another account', async () => {
    const account = new Account();
    let err: ApiError | null = null;
    try {
      await account.attachIdentity('apple', 'taken-token');
    } catch (e) {
      err = e as ApiError;
    }
    expect(err).not.toBeNull();
    expect(err!.status).toBe(409);
    expect(err!.message).toMatch(/already linked to another Beech account/);
    expect(err!.message).toMatch(/link code/);
    expect(await account.identities()).toEqual(['google']);
  });
});
