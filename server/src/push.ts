// Push notifications for the inbox (docs/INBOX_NOTIFICATIONS.md, "Push").
// The rules (who may be reached, how often, and what has to be one
// transaction under which lock) come from specs/tla/Push.tla.
//
// - Web (PWA, desktop and Android browsers, iPhone Home Screen apps): Web
//   Push with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291),
//   done here with node:crypto, so there is no extra dependency.
// - iOS app: APNs over HTTP/2 with a token-based (.p8) key.
// - Android app: Firebase Cloud Messaging HTTP v1, authorised with the Cloud
//   Run service account (the metadata server), so no key file exists.
// - Steam (Electron) has no push service for games: the running app shows
//   its own OS notifications from the 30 s poll (src/platform/notify.ts).
import { createCipheriv, createECDH, createPrivateKey, createSign, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from 'node:crypto';
import { connect as http2Connect, type ClientHttp2Session } from 'node:http2';
import type { Db } from './db.js';
import { PUSH_KINDS, type NotifyPref } from './notifyKinds.js';

// ------------------------------------------------------------------ rules

export { PUSH_KINDS, type NotifyPref } from './notifyKinds.js';
export const NOTIFY_PREFS: readonly NotifyPref[] = ['gifts', 'neighbors', 'invites'];
const PUSHED = Object.keys(PUSH_KINDS);

/** at most one push an hour per player; more in the hour folds into the next */
export const PUSH_EVERY_MS = 3600_000;
/** quiet hours, in the device's time zone: none from 22:00 to 08:00 */
export const QUIET_FROM = 22;
export const QUIET_TO = 8;
/** rows older than this when a push is due are only marked done (a new device doesn't get last week) */
export const PUSH_FRESH_MS = 24 * 3600_000;
/** most devices one player can have subscribed (the oldest goes) */
export const PUSH_DEVICES = 10;
/** one HTTP request to a push service */
const SEND_TIMEOUT_MS = 5000;

export function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** the hour of the day (0-23) at `now` in `tz` */
export function localHour(tz: string, now: number): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: validTz(tz) ? tz : 'UTC', hour: 'numeric', hourCycle: 'h23' }).format(now);
  return Number(h) % 24;
}

export const isQuiet = (tz: string, now: number): boolean => {
  const h = localHour(tz, now);
  return h >= QUIET_FROM || h < QUIET_TO;
};

/** A web endpoint must be a known push service (the server POSTs to it). */
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', '.notify.windows.com', '.push.apple.com'];
export function validEndpoint(platform: string, endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  if (platform !== 'web') return /^[A-Za-z0-9:_\-.]{20,1024}$/.test(endpoint);
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:' || u.port) return false;
    return PUSH_HOSTS.some((h) => (h.startsWith('.') ? u.hostname.endsWith(h) : u.hostname === h));
  } catch {
    return false;
  }
}

export interface PushRow {
  kind: string;
  name: string | null;
}

export interface PushMessage {
  title: string;
  body: string;
  /** where a tap goes */
  url: string;
  /** a later push replaces an earlier one on the device */
  tag: string;
}

/** What a push says. Never a note's text: pushes show on lock screens. */
export function pushMessage(rows: PushRow[]): PushMessage {
  const base = { title: 'beech', url: '/?inbox=1', tag: 'beech-inbox' };
  const names = [...new Set(rows.map((r) => r.name?.trim() || 'Someone'))];
  if (rows.length === 1) {
    const who = names[0];
    const body = {
      visit: `${who} left you something`,
      gift: `${who} gave you a gift`,
      neighbor_request: `${who} wants to be your neighbor`,
      neighbor_linked: `You and ${who} are neighbors`,
      invite_settled: `${who} settled in`,
    }[rows[0].kind] ?? 'Something new in your inbox';
    return { ...base, body };
  }
  if (names.length === 1) return { ...base, body: `${names[0]} left you ${rows.length} things` };
  const others = names.length - 1;
  return { ...base, body: `${names[0]} and ${others} other${others === 1 ? '' : 's'} left you something` };
}

// ------------------------------------------------------------------ sending

export interface PushTarget {
  id: string;
  platform: 'web' | 'ios' | 'android';
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
}
/** sent; gone (the push service forgot the device: delete it); failed (try next time) */
export type SendResult = 'sent' | 'gone' | 'failed';
export type PushSender = (target: PushTarget, msg: PushMessage) => Promise<SendResult>;

export interface PushConfig {
  /** VAPID: the public key (base64url, 65 bytes), the private key (base64url, 32 bytes), and a mailto: */
  web?: { publicKey: string; privateKey: string; subject: string };
  /** APNs token auth: the .p8 key (PEM), its key id, the team id, the app's bundle id */
  apns?: { key: string; keyId: string; teamId: string; bundleId: string; sandbox?: boolean };
  /** FCM HTTP v1: the Firebase project (the server's own identity sends) */
  fcm?: { projectId: string };
}

/** Push settings from the environment; a platform is on only when all of its settings are there. */
export function pushFromEnv(env: Record<string, string | undefined>): PushConfig {
  const cfg: PushConfig = {};
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT)
    cfg.web = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
  if (env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID)
    cfg.apns = {
      key: env.APNS_KEY,
      keyId: env.APNS_KEY_ID,
      teamId: env.APNS_TEAM_ID,
      bundleId: env.APNS_TOPIC || env.APPLE_BUNDLE_ID || 'app.beech.beach',
      sandbox: env.APNS_SANDBOX === '1',
    };
  if (env.FCM_PROJECT_ID) cfg.fcm = { projectId: env.FCM_PROJECT_ID };
  return cfg;
}

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url');

/** A fresh VAPID key pair, in the form `npx web-push generate-vapid-keys` prints (local development). */
export function devVapidKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const j = publicKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), unb64u(j.x!), unb64u(j.y!)]);
  return { publicKey: b64u(pub), privateKey: privateKey.export({ format: 'jwk' }).d! };
}

/** An ES256 JWT (header.claims.signature, the signature as raw r||s). */
export function es256Jwt(header: Record<string, unknown>, claims: Record<string, unknown>, key: KeyObject): string {
  const head = `${b64u(Buffer.from(JSON.stringify({ alg: 'ES256', ...header })))}.${b64u(Buffer.from(JSON.stringify(claims)))}`;
  const sig = createSign('SHA256').update(head).sign({ key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${b64u(sig)}`;
}

/** the VAPID private key (raw d, base64url) as a KeyObject, using the public key for x and y */
export function vapidKey(publicKey: string, privateKey: string): KeyObject {
  const pub = unb64u(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY is not an uncompressed P-256 key');
  return createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
}

/**
 * RFC 8291 (aes128gcm): encrypt `payload` for a browser's subscription keys.
 * `salt` and `serverKeys` are only passed by tests.
 */
export function encryptWebPush(
  payload: Buffer,
  p256dh: string,
  authSecret: string,
  opts: { salt?: Buffer; serverPrivate?: Buffer } = {},
): Buffer {
  const uaPublic = unb64u(p256dh);
  const auth = unb64u(authSecret);
  const ecdh = createECDH('prime256v1');
  if (opts.serverPrivate) ecdh.setPrivateKey(opts.serverPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, keyInfo, 32));
  const salt = opts.salt ?? randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // one record: the payload, then the last-record delimiter (no padding)
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(4096, 16);
  head.writeUInt8(asPublic.length, 20);
  return Buffer.concat([head, asPublic, body]);
}

async function timed(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
}

function webSender(cfg: NonNullable<PushConfig['web']>, fetchImpl: typeof fetch, clock: () => number): PushSender {
  const key = vapidKey(cfg.publicKey, cfg.privateKey);
  const jwts = new Map<string, { jwt: string; until: number }>();
  return async (t, msg) => {
    if (!t.p256dh || !t.auth) return 'gone';
    const aud = new URL(t.endpoint).origin;
    const now = clock();
    let j = jwts.get(aud);
    if (!j || j.until < now) {
      j = { jwt: es256Jwt({ typ: 'JWT' }, { aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: cfg.subject }, key), until: now + 6 * 3600_000 };
      jwts.set(aud, j);
    }
    const res = await timed(
      t.endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(24 * 3600),
          Urgency: 'normal',
          Topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32),
          Authorization: `vapid t=${j.jwt}, k=${cfg.publicKey}`,
        },
        body: new Uint8Array(encryptWebPush(Buffer.from(JSON.stringify(msg)), t.p256dh, t.auth)),
      },
      fetchImpl,
    );
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'sent' : 'failed';
  };
}

function apnsSender(cfg: NonNullable<PushConfig['apns']>, clock: () => number): PushSender {
  const key = createPrivateKey(cfg.key.replace(/\\n/g, '\n'));
  const host = cfg.sandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  let jwt = { token: '', until: 0 };
  let session: ClientHttp2Session | null = null;
  const conn = () => {
    if (!session || session.closed || session.destroyed) {
      session = http2Connect(host);
      session.on('error', () => (session = null));
      session.unref();
    }
    return session;
  };
  return (t, msg) =>
    new Promise<SendResult>((resolve) => {
      const now = clock();
      // Apple wants a token refreshed between 20 and 60 minutes
      if (jwt.until < now) jwt = { token: es256Jwt({ kid: cfg.keyId }, { iss: cfg.teamId, iat: Math.floor(now / 1000) }, key), until: now + 40 * 60_000 };
      let req;
      try {
        req = conn().request({
          ':method': 'POST',
          ':path': `/3/device/${t.endpoint}`,
          authorization: `bearer ${jwt.token}`,
          'apns-topic': cfg.bundleId,
          'apns-push-type': 'alert',
          'apns-collapse-id': msg.tag,
          'apns-expiration': String(Math.floor(now / 1000) + 24 * 3600),
        });
      } catch {
        session = null;
        return resolve('failed');
      }
      req.setTimeout(SEND_TIMEOUT_MS, () => req.close());
      let status = 0;
      let data = '';
      req.on('response', (h) => (status = Number(h[':status'])));
      req.on('data', (d) => (data += d));
      req.on('error', () => resolve('failed'));
      req.on('close', () => {
        if (status === 200) return resolve('sent');
        const reason = (() => {
          try {
            return (JSON.parse(data) as { reason?: string }).reason ?? '';
          } catch {
            return '';
          }
        })();
        resolve(status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered' ? 'gone' : 'failed');
      });
      req.end(JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: 'default', 'thread-id': msg.tag }, url: msg.url }));
    });
}

function fcmSender(cfg: NonNullable<PushConfig['fcm']>, fetchImpl: typeof fetch, clock: () => number): PushSender {
  let token = { value: '', until: 0 };
  const accessToken = async () => {
    if (token.until > clock()) return token.value;
    // Cloud Run's own identity (roles/firebasecloudmessaging.admin), no key file
    const res = await timed(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=https://www.googleapis.com/auth/firebase.messaging',
      { headers: { 'Metadata-Flavor': 'Google' } },
      fetchImpl,
    );
    if (!res.ok) throw new Error(`metadata token ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: j.access_token, until: clock() + (j.expires_in - 120) * 1000 };
    return token.value;
  };
  return async (t, msg) => {
    const res = await timed(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: t.endpoint,
            notification: { title: msg.title, body: msg.body },
            data: { url: msg.url },
            android: { collapse_key: msg.tag, ttl: '86400s', notification: { tag: msg.tag } },
          },
        }),
      },
      fetchImpl,
    );
    if (res.ok) return 'sent';
    if (res.status === 404) return 'gone';
    if (res.status === 400) {
      const text = await res.text();
      // a token that was never valid
      if (/registration token|UNREGISTERED|INVALID_ARGUMENT/.test(text) && /token/i.test(text)) return 'gone';
    }
    return 'failed';
  };
}

/** One sender for every platform that is set up; platforms that aren't answer 'failed'. */
export function makeSender(cfg: PushConfig, fetchImpl: typeof fetch = fetch, clock: () => number = Date.now): PushSender {
  const web = cfg.web ? webSender(cfg.web, fetchImpl, clock) : null;
  const ios = cfg.apns ? apnsSender(cfg.apns, clock) : null;
  const android = cfg.fcm ? fcmSender(cfg.fcm, fetchImpl, clock) : null;
  return async (t, msg) => {
    const s = t.platform === 'web' ? web : t.platform === 'ios' ? ios : android;
    if (!s) return 'failed';
    try {
      return await s(t, msg);
    } catch {
      return 'failed';
    }
  };
}

// ------------------------------------------------------------------ the tick

/**
 * Lock a player's push state (Push.tla's lock): their push_state row, made if
 * it isn't there. Every request that narrows who or what may reach their
 * devices (block, mute) takes it first, so it waits for a send in progress.
 */
export async function lockPush(tx: Db, user: string): Promise<{ last_push_at: number }> {
  await tx.query('INSERT INTO push_state (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [user]);
  const r = (await tx.query<{ last_push_at: string }>('SELECT last_push_at FROM push_state WHERE user_id = $1 FOR UPDATE', [user]))[0];
  return { last_push_at: Number(r?.last_push_at ?? 0) };
}

export interface TickResult {
  players: number;
  pushes: number;
  sent: number;
  gone: number;
  failed: number;
}

interface InboxPushRow {
  id: string;
  kind: string;
  name: string | null;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
}

function pushSubscriptions(tx: Db, user: string, now: number) {
  return tx.query<PushTarget & { tz: string; expires_at: string }>(
    `SELECT p.id::text AS id, p.platform, p.endpoint, p.p256dh, p.auth, p.tz, s.expires_at
       FROM push_subscriptions p JOIN sessions s ON s.token_hash = p.session_hash AND s.user_id = p.user_id
      WHERE p.user_id = $1 AND s.expires_at > $2
      ORDER BY p.id FOR NO KEY UPDATE OF p`,
    [user, now],
  );
}

function pushRows(tx: Db, user: string, ids?: string[]): Promise<InboxPushRow[]> {
  const rows = ids ? 'i.id = ANY($2::bigint[])' : 'i.pushed_at IS NULL AND i.kind = ANY($2::text[])';
  return tx.query<InboxPushRow>(
    `SELECT i.id, i.kind, u.name, i.actor_id, i.read_at, i.created_at
       FROM inbox i LEFT JOIN users u ON u.id = i.actor_id
      WHERE i.user_id = $1 AND ${rows}
      ORDER BY i.id FOR UPDATE OF i`,
    [user, ids ?? PUSHED],
  );
}

async function visiblePushRows(tx: Db, user: string, rows: InboxPushRow[], clock: () => number): Promise<InboxPushRow[]> {
  const prefs = (await tx.query<Record<NotifyPref, boolean>>('SELECT gifts, neighbors, invites FROM notify_prefs WHERE user_id = $1', [user]))[0];
  const blockedIds = new Set(
    (await tx.query<{ blocked_id: string }>('SELECT blocked_id FROM blocks WHERE blocker_id = $1', [user])).map((r) => r.blocked_id),
  );
  const now = clock();
  return rows.filter(
    (r) =>
      r.read_at === null &&
      now - Number(r.created_at) < PUSH_FRESH_MS &&
      !(r.actor_id && blockedIds.has(r.actor_id)) &&
      prefs?.[PUSH_KINDS[r.kind as keyof typeof PUSH_KINDS]] !== false,
  );
}

/** Commit the claim before sending, then recheck eligibility under the row locks. */
export async function pushPlayer(db: Db, user: string, send: PushSender, clock: () => number, out: TickResult): Promise<void> {
  const claim = await db.withTransaction(async (tx) => {
    const { last_push_at } = await lockPush(tx, user);
    if (clock() - last_push_at < PUSH_EVERY_MS) return;
    const subs = await pushSubscriptions(tx, user, clock());
    const at = clock();
    const newest = subs.filter((sub) => Number(sub.expires_at) > at).at(-1);
    if (!newest || isQuiet(newest.tz, at)) return;
    const due = await pushRows(tx, user);
    if (!due.length) return;
    const shown = await visiblePushRows(tx, user, due, clock);
    // Mark skipped rows too. A later tick must never replay a committed claim.
    await tx.query('UPDATE inbox SET pushed_at = $2 WHERE id = ANY($1::bigint[])', [due.map((r) => r.id), at]);
    if (!shown.length) return;
    await tx.query('UPDATE push_state SET last_push_at = $2 WHERE user_id = $1', [user, at]);
    return { at, ids: shown.map((r) => r.id) };
  });
  if (!claim) return;

  await db.withTransaction(async (tx) => {
    const [state] = await tx.query<{ last_push_at: string }>('SELECT last_push_at FROM push_state WHERE user_id = $1 FOR UPDATE', [user]);
    if (Number(state?.last_push_at) !== claim.at) return;
    const subs = await pushSubscriptions(tx, user, clock());
    if (!subs.length) return;
    const rows = await pushRows(tx, user, claim.ids);
    const shown = await visiblePushRows(tx, user, rows, clock);
    const now = clock();
    const active = subs.filter((sub) => Number(sub.expires_at) > now);
    const newest = active.at(-1);
    if (!shown.length || !newest || isQuiet(newest.tz, now) || now - claim.at >= PUSH_EVERY_MS) return;
    out.pushes++;
    const msg = pushMessage(shown.map((r) => ({ kind: r.kind, name: r.name })));
    const results = await Promise.all(active.map((s) => send(s, msg).catch((): SendResult => 'failed')));
    const gone = active.filter((_, i) => results[i] === 'gone').map((s) => s.id);
    for (const r of results) out[r === 'sent' ? 'sent' : r === 'gone' ? 'gone' : 'failed']++;
    if (gone.length) await tx.query('DELETE FROM push_subscriptions WHERE id = ANY($1::bigint[])', [gone]);
  });
}

/** One tick: every player with a subscription and something due. Safe to run twice at once. */
export async function pushTick(db: Db, send: PushSender, clock: () => number = Date.now, limit = 500): Promise<TickResult> {
  const now = clock();
  const out: TickResult = { players: 0, pushes: 0, sent: 0, gone: 0, failed: 0 };
  const players = await db.query<{ user_id: string }>(
    `SELECT DISTINCT p.user_id
       FROM push_subscriptions p JOIN sessions s ON s.token_hash = p.session_hash AND s.user_id = p.user_id
      WHERE s.expires_at > $2
        AND EXISTS (SELECT 1 FROM inbox i WHERE i.user_id = p.user_id AND i.pushed_at IS NULL AND i.kind = ANY($1::text[]))
        AND NOT EXISTS (SELECT 1 FROM push_state ps WHERE ps.user_id = p.user_id AND ps.last_push_at > $3)
      LIMIT $4`,
    [PUSHED, now, now - PUSH_EVERY_MS, limit],
  );
  for (const p of players) {
    out.players++;
    await pushPlayer(db, p.user_id, send, clock, out);
  }
  return out;
}
