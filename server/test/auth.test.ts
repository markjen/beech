import { describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, exportPKCS8, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import {
  appleAuthKeyFromEnv,
  exchangeAppleAuthorizationCode,
  makeAppleClientSecret,
  revokeAppleToken,
  verifyAppleIdToken,
  verifyGoogleIdToken,
} from '../src/auth.js';

describe('ID token verification', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });
  const other = await generateKeyPair('RS256');
  const sign = (claims: Record<string, unknown>, key = privateKey, exp = '1h') =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuedAt().setExpirationTime(exp).sign(key);

  it('accepts a valid Google token and reads sub + first name', async () => {
    const t = await sign({ iss: 'https://accounts.google.com', aud: 'web', sub: '123', given_name: 'Ada', name: 'Ada L' });
    expect(await verifyGoogleIdToken(t, ['web'], keys)).toEqual({ provider: 'google', sub: '123', name: 'Ada' });
  });
  it('rejects wrong audience, issuer, expiry, key, and empty config', async () => {
    const good = await sign({ iss: 'accounts.google.com', aud: 'web', sub: '1' });
    await expect(verifyGoogleIdToken(good, ['other'], keys)).rejects.toThrow();
    await expect(verifyGoogleIdToken(await sign({ iss: 'https://evil.example', aud: 'web', sub: '1' }), ['web'], keys)).rejects.toThrow();
    await expect(verifyGoogleIdToken(await sign({ iss: 'accounts.google.com', aud: 'web', sub: '1' }, privateKey, '-5m'), ['web'], keys)).rejects.toThrow();
    await expect(verifyGoogleIdToken(await sign({ iss: 'accounts.google.com', aud: 'web', sub: '1' }, other.privateKey), ['web'], keys)).rejects.toThrow();
    await expect(verifyGoogleIdToken(good, [], keys)).rejects.toThrow();
  });
  it('returns the email only when Google says it is verified', async () => {
    const verified = await sign({ iss: 'https://accounts.google.com', aud: 'web', sub: '1', email: 'markjen@gmail.com', email_verified: true });
    expect(await verifyGoogleIdToken(verified, ['web'], keys)).toEqual(
      expect.objectContaining({ provider: 'google', sub: '1', email: 'markjen@gmail.com' }),
    );
    const unverified = await sign({ iss: 'https://accounts.google.com', aud: 'web', sub: '1', email: 'markjen@gmail.com', email_verified: false });
    expect(await verifyGoogleIdToken(unverified, ['web'], keys)).not.toHaveProperty('email');
    const noEmail = await sign({ iss: 'https://accounts.google.com', aud: 'web', sub: '1' });
    expect(await verifyGoogleIdToken(noEmail, ['web'], keys)).not.toHaveProperty('email');
  });
  it('verifies Apple tokens separately and returns the matched clientId', async () => {
    const apple = await sign({ iss: 'https://appleid.apple.com', aud: 'app.beech.beach', sub: 'a1' });
    expect(await verifyAppleIdToken(apple, ['app.beech.beach', 'app.beech.beach.web'], 'Ada', keys)).toEqual({
      provider: 'apple',
      sub: 'a1',
      name: 'Ada',
      clientId: 'app.beech.beach',
    });
    const webApple = await sign({ iss: 'https://appleid.apple.com', aud: 'app.beech.beach.web', sub: 'a2' });
    expect((await verifyAppleIdToken(webApple, ['app.beech.beach', 'app.beech.beach.web'], '', keys)).clientId).toBe(
      'app.beech.beach.web',
    );
    const google = await sign({ iss: 'https://accounts.google.com', aud: 'app.beech.beach', sub: 'g' });
    await expect(verifyAppleIdToken(google, ['app.beech.beach'], '', keys)).rejects.toThrow();
  });
});

describe('Apple token exchange and revocation', async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const pem = await exportPKCS8(privateKey);
  const cfg = { key: pem, keyId: 'KEY1234567', teamId: 'TEAM123456' };

  it('reads Apple auth key config from env and falls back to APNS_TEAM_ID', () => {
    expect(appleAuthKeyFromEnv({})).toBeUndefined();
    expect(appleAuthKeyFromEnv({ APPLE_AUTH_KEY: 'k', APPLE_AUTH_KEY_ID: 'id' })).toBeUndefined();
    expect(
      appleAuthKeyFromEnv({
        APPLE_AUTH_KEY: 'line1\\nline2',
        APPLE_AUTH_KEY_ID: 'KEY1',
        APNS_TEAM_ID: 'TEAM1',
      }),
    ).toEqual({ key: 'line1\nline2', keyId: 'KEY1', teamId: 'TEAM1' });
  });

  it('signs a valid ES256 client_secret JWT', async () => {
    const now = 1_700_000_000_000;
    const secret = await makeAppleClientSecret(cfg, 'app.beech.beach.web', now);
    const { payload, protectedHeader } = await jwtVerify(secret, publicKey, {
      issuer: 'TEAM123456',
      audience: 'https://appleid.apple.com',
      subject: 'app.beech.beach.web',
      currentDate: new Date(now),
    });
    expect(protectedHeader).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    expect(payload.iat).toBe(1_700_000_000);
    expect(payload.exp).toBe(1_700_000_300);
  });

  it('exchanges an authorization code for a refresh token', async () => {
    let seenUrl = '';
    let seenParams: URLSearchParams | null = null;
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenParams = new URLSearchParams(String(init?.body ?? ''));
      return new Response(JSON.stringify({ refresh_token: 'rft-123', access_token: 'at-1' }), { status: 200 });
    }) as typeof fetch;

    const rft = await exchangeAppleAuthorizationCode(
      'code-abc',
      'app.beech.beach.web',
      cfg,
      'https://play.beech.games/',
      fakeFetch,
      1_700_000_000_000,
    );
    expect(rft).toBe('rft-123');
    expect(seenUrl).toBe('https://appleid.apple.com/auth/token');
    expect(seenParams!.get('client_id')).toBe('app.beech.beach.web');
    expect(seenParams!.get('code')).toBe('code-abc');
    expect(seenParams!.get('grant_type')).toBe('authorization_code');
    expect(seenParams!.get('redirect_uri')).toBe('https://play.beech.games/');
    expect(seenParams!.get('client_secret')).toBeTruthy();

    const failFetch = (async () => new Response('invalid_grant', { status: 400 })) as typeof fetch;
    await expect(exchangeAppleAuthorizationCode('bad', 'app.beech.beach', cfg, undefined, failFetch)).rejects.toThrow(/HTTP 400/);
  });

  it('revokes a refresh token at Apple /auth/revoke', async () => {
    let seenUrl = '';
    let seenParams: URLSearchParams | null = null;
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenParams = new URLSearchParams(String(init?.body ?? ''));
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    await revokeAppleToken('rft-123', 'app.beech.beach', cfg, fakeFetch, 1_700_000_000_000);
    expect(seenUrl).toBe('https://appleid.apple.com/auth/revoke');
    expect(seenParams!.get('client_id')).toBe('app.beech.beach');
    expect(seenParams!.get('token')).toBe('rft-123');
    expect(seenParams!.get('token_type_hint')).toBe('refresh_token');
    expect(seenParams!.get('client_secret')).toBeTruthy();

    const failFetch = (async () => new Response('invalid_client', { status: 400 })) as typeof fetch;
    await expect(revokeAppleToken('rft-123', 'app.beech.beach', cfg, failFetch)).rejects.toThrow(/HTTP 400/);
  });
});
