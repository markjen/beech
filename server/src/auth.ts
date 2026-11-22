import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Google's signing keys for ID tokens (cached by jose between requests). */
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface VerifiedIdentity {
  provider: 'google' | 'apple';
  sub: string;
  name: string;
}

/**
 * Check a Google ID token (from Google Identity Services on the web, or a
 * native Google sign-in plugin in the apps): signature, issuer, audience
 * (one of our OAuth client IDs) and expiry. Throws if anything is off.
 */
export async function verifyGoogleIdToken(
  token: string,
  clientIds: string[],
  keys: JWTVerifyGetKey = GOOGLE_JWKS,
): Promise<VerifiedIdentity> {
  if (!clientIds.length) throw new Error('google sign-in is not configured');
  const { payload } = await jwtVerify(token, keys, {
    issuer: GOOGLE_ISSUERS,
    audience: clientIds,
    clockTolerance: 60,
  });
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('token has no subject');
  const given = typeof payload.given_name === 'string' ? payload.given_name : '';
  const full = typeof payload.name === 'string' ? payload.name : '';
  return { provider: 'google', sub: payload.sub, name: (given || full).slice(0, 60) };
}

const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

/**
 * Check a Sign in with Apple identity token (from the native iOS sign-in, or
 * Apple's JS SDK on the web). Apple only sends the person's name once, on the
 * first sign-in, so the client passes it alongside.
 */
export async function verifyAppleIdToken(
  token: string,
  clientIds: string[],
  name = '',
  keys: JWTVerifyGetKey = APPLE_JWKS,
): Promise<VerifiedIdentity> {
  if (!clientIds.length) throw new Error('apple sign-in is not configured');
  const { payload } = await jwtVerify(token, keys, {
    issuer: 'https://appleid.apple.com',
    audience: clientIds,
    clockTolerance: 60,
  });
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('token has no subject');
  return { provider: 'apple', sub: payload.sub, name: name.slice(0, 60) };
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function newSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const SESSION_DAYS = 60;
