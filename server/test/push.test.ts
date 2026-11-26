// Push notifications (docs/INBOX_NOTIFICATIONS.md, "Push"): the payload
// encryption and VAPID token, the wording, quiet hours, and the routes. The
// races (who may be reached, and how often) are in stateMachines/push.test.ts.
import { createDecipheriv, createECDH, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import { importJWK, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import {
  PUSH_EVERY_MS,
  encryptWebPush,
  es256Jwt,
  isQuiet,
  localHour,
  makeSender,
  pushMessage,
  pushTick,
  validEndpoint,
  vapidKey,
  type PushMessage,
  type PushTarget,
} from '../src/push.js';
import { FREE_TEXT_AFTER_MS } from '../src/inbox.js';
import { openTestDb } from './testDb.js';

/** a browser's side of a subscription */
function browserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
}

/** RFC 8291 decryption, as the browser does it */
function decrypt(body: Buffer, ua: ReturnType<typeof browserKeys>): string {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  expect(rs).toBe(4096);
  const shared = ua.ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, Buffer.from(ua.auth, 'base64url'), keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  expect(plain[plain.length - 1]).toBe(2); // the last-record delimiter
  return plain.subarray(0, plain.length - 1).toString();
}

/** a VAPID key pair in the form `npx web-push generate-vapid-keys` prints */
function vapidPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]);
  return { publicKey: pub.toString('base64url'), privateKey: privateKey.export({ format: 'jwk' }).d! };
}

describe('web push', () => {
  it('encrypts a payload the browser can read (RFC 8291)', () => {
    const ua = browserKeys();
    const body = encryptWebPush(Buffer.from('{"body":"Ben gave you a gift"}'), ua.p256dh, ua.auth);
    expect(decrypt(body, ua)).toBe('{"body":"Ben gave you a gift"}');
  });

  it('signs a VAPID token the push service can check (RFC 8292)', async () => {
    const pair = vapidPair();
    const jwt = es256Jwt({ typ: 'JWT' }, { aud: 'https://fcm.googleapis.com', exp: 2e9, sub: 'mailto:help@example.com' }, vapidKey(pair.publicKey, pair.privateKey));
    const pub = Buffer.from(pair.publicKey, 'base64url');
    const key = await importJWK({ kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, 'ES256');
    const { payload } = await jwtVerify(jwt, key, { audience: 'https://fcm.googleapis.com' });
    expect(payload.sub).toBe('mailto:help@example.com');
  });

  it('sends with the right headers, and a 410 means the device is gone', async () => {
    const pair = vapidPair();
    const ua = browserKeys();
    const seen: { url: string; init: RequestInit }[] = [];
    let status = 201;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(null, { status });
    }) as unknown as typeof fetch;
    const send = makeSender({ web: { ...pair, subject: 'mailto:help@example.com' } }, fakeFetch);
    const target: PushTarget = { id: '1', platform: 'web', endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: ua.p256dh, auth: ua.auth };
    const msg: PushMessage = pushMessage([{ kind: 'gift', name: 'Ben' }]);
    expect(await send(target, msg)).toBe('sent');
    const h = seen[0].init.headers as Record<string, string>;
    expect(h['Content-Encoding']).toBe('aes128gcm');
    expect(h.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    expect(JSON.parse(decrypt(Buffer.from(seen[0].init.body as Uint8Array), ua))).toMatchObject({ body: 'Ben gave you a gift', url: '/?inbox=1' });
    status = 410;
    expect(await send(target, msg)).toBe('gone');
    status = 500;
    expect(await send(target, msg)).toBe('failed');
    // a platform that isn't set up never sends
    expect(await send({ ...target, platform: 'ios', endpoint: 'a'.repeat(64) }, msg)).toBe('failed');
  });

  it('only posts to known push services', () => {
    expect(validEndpoint('web', 'https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(validEndpoint('web', 'https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(validEndpoint('web', 'https://web.push.apple.com/QH')).toBe(true);
    expect(validEndpoint('web', 'https://db5p.notify.windows.com/w/?token=x')).toBe(true);
    for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example.com/x', 'https://fcm.googleapis.com:8443/x', 'https://169.254.169.254/', 42])
      expect(validEndpoint('web', bad), String(bad)).toBe(false);
    expect(validEndpoint('ios', 'ab'.repeat(32))).toBe(true);
    expect(validEndpoint('android', 'not a token')).toBe(false);
  });
});

describe('what a push says', () => {
  it('names the sender, never the note', () => {
    expect(pushMessage([{ kind: 'visit', name: 'Ben' }]).body).toBe('Ben left you something');
    expect(pushMessage([{ kind: 'neighbor_request', name: 'Ben' }]).body).toBe('Ben wants to be your neighbor');
    expect(pushMessage([{ kind: 'neighbor_linked', name: null }]).body).toBe('You and Someone are neighbors');
    expect(pushMessage([{ kind: 'gift', name: 'Ben' }, { kind: 'visit', name: 'Ben' }]).body).toBe('Ben left you 2 things');
    expect(pushMessage([{ kind: 'gift', name: 'Ben' }, { kind: 'visit', name: 'Cat' }, { kind: 'gift', name: 'Dee' }]).body).toBe('Ben and 2 others left you something');
    expect(pushMessage([{ kind: 'gift', name: 'Ben' }, { kind: 'visit', name: 'Cat' }]).body).toBe('Ben and 1 other left you something');
  });

  it('keeps quiet from 22:00 to 08:00 on the device clock', () => {
    const at = Date.UTC(2026, 10, 25, 23); // 23:00 UTC
    expect(localHour('UTC', at)).toBe(23);
    expect(isQuiet('UTC', at)).toBe(true);
    expect(isQuiet('America/Los_Angeles', at)).toBe(false); // 15:00
    expect(isQuiet('Asia/Tokyo', at)).toBe(false); // 08:00
    expect(isQuiet('Not/A_Zone', Date.UTC(2026, 10, 25, 7))).toBe(true); // falls back to UTC
  });
});

describe('the push routes', () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  const clock = { now: Date.UTC(2026, 10, 25, 12) };
  const sent: { target: PushTarget; msg: PushMessage }[] = [];
  const pair = vapidPair();

  beforeAll(async () => {
    db = await openTestDb();
    app = createApp(db, {
      googleClientIds: [],
      appleClientIds: [],
      allowedOrigins: [],
      devAuth: true,
      now: () => clock.now,
      push: {
        config: { web: { ...pair, subject: 'mailto:help@example.com' }, fcm: { projectId: 'beech-test' } },
        send: async (target, msg) => {
          sent.push({ target, msg });
          return target.endpoint.endsWith('/gone') ? 'gone' : 'sent';
        },
      },
    });
  });
  afterAll(() => db.close());

  const req = (path: string, init: RequestInit = {}, token?: string) =>
    app.request(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });
  let n = 0;
  async function player(name: string) {
    const r = await req('/auth/dev', json('POST', { name: `${name}${++n}` }));
    const s = (await r.json()) as { token: string; user: { id: string } };
    await db.query('UPDATE users SET created_at = $2 WHERE id = $1', [s.user.id, clock.now - FREE_TEXT_AFTER_MS - 60000]);
    const code = ((await (await req('/neighbors', {}, s.token)).json()) as { code: string }).code;
    return { ...s, code };
  }
  const web = (end = `https://fcm.googleapis.com/fcm/send/${++n}`) => {
    const ua = browserKeys();
    return { platform: 'web', endpoint: end, keys: { p256dh: ua.p256dh, auth: ua.auth }, tz: 'UTC' };
  };

  it('says which platforms are set up', async () => {
    expect(await (await req('/push/config')).json()).toEqual({ web: pair.publicKey, ios: false, android: true });
  });

  it('checks a subscription', async () => {
    const ana = await player('ana');
    expect((await req('/push/subscribe', json('POST', web()), ana.token)).status).toBe(204);
    expect((await req('/push/subscribe', json('POST', { ...web(), keys: { p256dh: 'x', auth: 'y' } }), ana.token)).status).toBe(400);
    expect((await req('/push/subscribe', json('POST', { ...web(), endpoint: 'https://example.com/x' }), ana.token)).status).toBe(400);
    expect((await req('/push/subscribe', json('POST', { platform: 'ios', endpoint: 'ab'.repeat(32) }), ana.token)).status).toBe(404);
    expect((await req('/push/subscribe', json('POST', { platform: 'android', endpoint: 'tok:' + 'a'.repeat(40) }), ana.token)).status).toBe(204);
    expect((await req('/push/subscribe', json('POST', web()))).status).toBe(401);
  });

  it('a visit reaches the device once; signing out takes the device with it', async () => {
    const ana = await player('ana');
    const ben = await player('ben');
    const phone = web();
    expect((await req('/push/subscribe', json('POST', phone), ana.token)).status).toBe(204);
    await db.query(`INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at) VALUES ($1, 'starfish', 1, 'pull', $2)`, [ben.user.id, clock.now]);
    expect((await req(`/beaches/${ana.code}/visit`, json('POST', { note: 'Lovely moat', item: 'starfish' }), ben.token)).status).toBe(200);
    sent.length = 0;
    await pushTick(db, async (t, m) => (sent.push({ target: t, msg: m }), 'sent'), () => clock.now);
    const toAna = sent.filter((s) => s.target.endpoint === phone.endpoint);
    expect(toAna).toHaveLength(1);
    expect(toAna[0].msg.body).toMatch(/^ben\d+ left you something$/);
    // nothing new: nothing sent
    sent.length = 0;
    clock.now += PUSH_EVERY_MS;
    await pushTick(db, async (t, m) => (sent.push({ target: t, msg: m }), 'sent'), () => clock.now);
    expect(sent.filter((s) => s.target.endpoint === phone.endpoint)).toHaveLength(0);
    // sign out: the subscription goes too
    expect((await req('/auth/logout', { method: 'POST' }, ana.token)).status).toBe(204);
    expect(await db.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [phone.endpoint])).toHaveLength(0);
  });

  it('a gone device is forgotten; unsubscribe and prefs', async () => {
    const ana = await player('ana');
    const ben = await player('ben');
    const dead = web('https://fcm.googleapis.com/fcm/send/gone');
    expect((await req('/push/subscribe', json('POST', dead), ana.token)).status).toBe(204);
    await req(`/beaches/${ana.code}/visit`, json('POST', { note: 'Hello there' }), ben.token);
    clock.now += PUSH_EVERY_MS;
    const r = await pushTick(db, async (t) => (t.endpoint.endsWith('/gone') ? 'gone' : 'sent'), () => clock.now);
    expect(r.gone).toBeGreaterThanOrEqual(1);
    expect(await db.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [dead.endpoint])).toHaveLength(0);

    expect(await (await req('/notify-prefs', {}, ana.token)).json()).toEqual({ gifts: true, neighbors: true, invites: true });
    expect(await (await req('/notify-prefs', json('PUT', { gifts: false }), ana.token)).json()).toEqual({ gifts: false, neighbors: true, invites: true });
    expect((await req('/notify-prefs', json('PUT', { gifts: 'no' }), ana.token)).status).toBe(400);
    const phone = web();
    await req('/push/subscribe', json('POST', phone), ana.token);
    await req(`/beaches/${ana.code}/visit`, json('POST', { note: 'Hello again' }), ben.token);
    clock.now += PUSH_EVERY_MS;
    sent.length = 0;
    await pushTick(db, async (t, m) => (sent.push({ target: t, msg: m }), 'sent'), () => clock.now);
    expect(sent.filter((s) => s.target.endpoint === phone.endpoint)).toHaveLength(0); // muted
    expect((await req('/push/subscribe', json('DELETE', { endpoint: phone.endpoint }), ana.token)).status).toBe(204);
    expect(await db.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [phone.endpoint])).toHaveLength(0);
  });

  it('the tick endpoint needs Cloud Scheduler', async () => {
    expect((await req('/push/tick', { method: 'POST' })).status).toBe(404);
  });
});
