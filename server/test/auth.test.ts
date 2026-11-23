import { describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifyAppleIdToken, verifyGoogleIdToken } from '../src/auth.js';

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
  it('verifies Apple tokens separately', async () => {
    const apple = await sign({ iss: 'https://appleid.apple.com', aud: 'app.beech.beach', sub: 'a1' });
    expect((await verifyAppleIdToken(apple, ['app.beech.beach'], 'Ada', keys)).provider).toBe('apple');
    const google = await sign({ iss: 'https://accounts.google.com', aud: 'app.beech.beach', sub: 'g' });
    await expect(verifyAppleIdToken(google, ['app.beech.beach'], '', keys)).rejects.toThrow();
  });
});
