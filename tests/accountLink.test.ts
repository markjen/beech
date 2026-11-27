// Account.identities() / attachIdentity() and web Sign in with Apple.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Account, ApiError, webAppleSignIn } from '../src/net/account';
import { SignInCancelled } from '../src/net/nativeAuth';

let calls: { url: string; body: unknown }[] = [];
let identities: string[] = [];

beforeEach(() => {
  calls = [];
  identities = ['google'];
  vi.stubGlobal(
    'fetch',
    async (url: string, init: RequestInit = {}) => {
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      // Account.call() prefixes import.meta.env.VITE_API_URL (set to the
      // production origin by the release workflow, which also runs these
      // tests), so route on the request path, not the absolute URL. Record
      // the path so the assertions below still see the exact request.
      const path = String(url).replace(/^https?:\/\/[^/]*/, '');
      calls.push({ url: path, body });
      if (path === '/api/auth/apple' && init.method === 'POST') {
        return new Response(JSON.stringify({ token: 'tok', user: { id: 'u1', name: body.name || 'Ada' } }), { status: 200 });
      }
      if (path === '/api/account/identities' && (!init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ identities }), { status: 200 });
      }
      if (path === '/api/account/identities' && init.method === 'POST') {
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

  it('forwards Apple authorizationCode and redirectUri on sign-in and attach', async () => {
    const account = new Account();
    await account.signInWithApple('id-tok', 'Ada', 'auth-code-1', 'https://play.beech.games/');
    expect(calls[0]).toEqual({
      url: '/api/auth/apple',
      body: {
        identityToken: 'id-tok',
        name: 'Ada',
        authorizationCode: 'auth-code-1',
        redirectUri: 'https://play.beech.games/',
      },
    });
    await account.attachIdentity('apple', 'good-token', 'Ada', {
      authorizationCode: 'auth-code-2',
      redirectUri: 'https://play.beech.games/',
    });
    expect(calls[1]).toEqual({
      url: '/api/account/identities',
      body: {
        provider: 'apple',
        credential: 'good-token',
        name: 'Ada',
        authorizationCode: 'auth-code-2',
        redirectUri: 'https://play.beech.games/',
      },
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

describe('webAppleSignIn', () => {
  it('initializes Apple JS popup flow and returns idToken, authorizationCode, name, and redirectUri', async () => {
    let initCfg: Record<string, unknown> | null = null;
    vi.stubGlobal('window', {
      location: { origin: 'https://play.beech.games' },
      AppleID: {
        auth: {
          init: (cfg: Record<string, unknown>) => {
            initCfg = cfg;
          },
          signIn: async () => ({
            authorization: { id_token: 'apple-jwt', code: 'apple-code' },
            user: { name: { firstName: 'Ada', lastName: 'Lovelace' } },
          }),
        },
      },
    });

    const who = await webAppleSignIn('app.beech.beach.web');
    expect(initCfg).toMatchObject({
      clientId: 'app.beech.beach.web',
      scope: 'name email',
      redirectURI: 'https://play.beech.games/',
      usePopup: true,
    });
    expect(who).toEqual({
      idToken: 'apple-jwt',
      name: 'Ada',
      authorizationCode: 'apple-code',
      redirectUri: 'https://play.beech.games/',
    });
  });

  it('throws SignInCancelled when the user closes the Apple popup', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://play.beech.games' },
      AppleID: {
        auth: {
          init: () => {},
          signIn: async () => {
            throw { error: 'popup_closed_by_user' };
          },
        },
      },
    });

    await expect(webAppleSignIn('app.beech.beach.web')).rejects.toBeInstanceOf(SignInCancelled);
  });
});
