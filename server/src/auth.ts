import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTVerifyGetKey } from 'jose';

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
  /**
   * Apple only: the verified `aud` claim (iOS bundle ID or web Services ID),
   * needed when exchanging an authorization code or revoking a refresh token.
   */
  clientId?: string;
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
  const clientId = typeof payload.aud === 'string' ? payload.aud : Array.isArray(payload.aud) ? payload.aud[0] : undefined;
  return { provider: 'apple', sub: payload.sub, name: name.slice(0, 60), ...(clientId ? { clientId } : {}) };
}

export interface AppleAuthKeyConfig {
  /** Sign in with Apple .p8 private key (PEM) */
  key: string;
  /** 10-character Key ID */
  keyId: string;
  /** 10-character Apple Developer Team ID */
  teamId: string;
}

/**
 * Read Sign in with Apple private-key credentials from the environment.
 * Unset until the owner adds the key to Secret Manager: sign-in still works
 * without it, and token exchange / revocation switch on once it is set.
 */
export function appleAuthKeyFromEnv(env: Record<string, string | undefined>): AppleAuthKeyConfig | undefined {
  const key = env.APPLE_AUTH_KEY?.trim();
  const keyId = env.APPLE_AUTH_KEY_ID?.trim();
  const teamId = (env.APPLE_AUTH_TEAM_ID || env.APNS_TEAM_ID)?.trim();
  if (!key || !keyId || !teamId) return undefined;
  return { key: key.replace(/\\n/g, '\n'), keyId, teamId };
}

/**
 * Sign a short-lived ES256 client_secret JWT for Apple's /auth/token and
 * /auth/revoke endpoints.
 */
export async function makeAppleClientSecret(
  cfg: AppleAuthKeyConfig,
  clientId: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const privateKey = await importPKCS8(cfg.key, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: cfg.keyId })
    .setIssuer(cfg.teamId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .setAudience('https://appleid.apple.com')
    .setSubject(clientId)
    .sign(privateKey);
}

/**
 * Exchange a Sign in with Apple authorization code for a refresh token via
 * POST https://appleid.apple.com/auth/token. The code expires in 5 minutes,
 * so this runs at sign-in / identity-attach time and stores the refresh token
 * for revocation on account delete.
 */
export async function exchangeAppleAuthorizationCode(
  code: string,
  clientId: string,
  cfg: AppleAuthKeyConfig,
  redirectUri?: string,
  fetchFn: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<string> {
  const clientSecret = await makeAppleClientSecret(cfg, clientId, nowMs);
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    ...(redirectUri ? { redirect_uri: redirectUri } : {}),
  });
  const res = await fetchFn('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`apple token exchange HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  const data = (await res.json()) as { refresh_token?: string; error?: string };
  if (data.error) throw new Error(`apple token exchange error: ${data.error}`);
  if (typeof data.refresh_token !== 'string' || !data.refresh_token) {
    throw new Error('apple token exchange returned no refresh_token');
  }
  return data.refresh_token;
}

/**
 * Revoke a stored Sign in with Apple refresh token on account deletion
 * (App Store guideline 5.1.1(v)) via POST https://appleid.apple.com/auth/revoke.
 */
export async function revokeAppleToken(
  refreshToken: string,
  clientId: string,
  cfg: AppleAuthKeyConfig,
  fetchFn: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<void> {
  const clientSecret = await makeAppleClientSecret(cfg, clientId, nowMs);
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    token: refreshToken,
    token_type_hint: 'refresh_token',
  });
  const res = await fetchFn('https://appleid.apple.com/auth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`apple token revoke HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
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
