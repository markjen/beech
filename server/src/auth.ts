import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Google's signing keys for ID tokens (cached by jose between requests). */
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface VerifiedIdentity {
  provider: 'google' | 'apple' | 'steam';
  sub: string;
  name: string;
  /**
   * Google only, and only when Google says the address is verified
   * (payload.email_verified). The admin allowlist checks this, so an
   * unverified address must never arrive here.
   */
  email?: string;
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
  // the email is only trusted when Google has verified it
  const email = payload.email_verified === true && typeof payload.email === 'string' ? payload.email : undefined;
  return { provider: 'google', sub: payload.sub, name: (given || full).slice(0, 60), ...(email ? { email } : {}) };
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

export interface SteamAuthConfig {
  appId: string;
  webApiKey: string;
  /** identity string passed to GetAuthTicketForWebApi (default 'beech') */
  identity?: string;
}

interface SteamAuthResponse {
  response?: {
    params?: {
      result?: string;
      steamid?: string;
      ownersteamid?: string;
      vacbanned?: boolean;
      publisherbanned?: boolean;
    };
    error?: { errorcode?: number; errordesc?: string };
  };
}

/**
 * Verify a Steam Web API auth ticket (from GetAuthTicketForWebApi) via
 * ISteamUserAuth/AuthenticateUserTicket/v1. Throws if Steam rejects the ticket
 * or the account is VAC/publisher banned.
 */
export async function verifySteamTicket(
  ticketHex: string,
  cfg: SteamAuthConfig,
  name = '',
  fetchFn: typeof fetch = fetch,
): Promise<VerifiedIdentity> {
  if (!cfg.appId || !cfg.webApiKey) throw new Error('steam sign-in is not configured');
  if (!/^[0-9a-f]{16,4096}$/i.test(ticketHex)) throw new Error('malformed steam ticket');
  const params = new URLSearchParams({
    key: cfg.webApiKey,
    appid: cfg.appId,
    ticket: ticketHex,
    identity: cfg.identity ?? 'beech',
  });
  const res = await fetchFn(`https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/?${params.toString()}`);
  if (!res.ok) throw new Error(`steam auth HTTP ${res.status}`);
  const data = (await res.json()) as SteamAuthResponse;
  const err = data.response?.error;
  if (err) throw new Error(err.errordesc || `steam error ${err.errorcode ?? ''}`.trim());
  const p = data.response?.params;
  if (!p || p.result !== 'OK') throw new Error('steam ticket rejected');
  if (p.vacbanned || p.publisherbanned) throw new Error('steam account is restricted');
  if (typeof p.steamid !== 'string' || !/^\d{10,25}$/.test(p.steamid)) throw new Error('invalid steamid');
  return { provider: 'steam', sub: p.steamid, name: name.trim().slice(0, 60) };
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
