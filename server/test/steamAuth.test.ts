import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { verifySteamTicket, type SteamAuthConfig } from '../src/auth.js';
import { type Db } from '../src/db.js';
import { openTestDb } from './testDb.js';

const STEAM_CFG: SteamAuthConfig = { appId: '480', webApiKey: 'test-steam-key' };
const GOOD_TICKET = '0123456789abcdef0123456789abcdef';

describe('verifySteamTicket', () => {
  it('accepts a valid Steam Web API ticket and extracts steamid + persona name', async () => {
    const fakeFetch: typeof fetch = async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('key')).toBe('test-steam-key');
      expect(url.searchParams.get('appid')).toBe('480');
      expect(url.searchParams.get('ticket')).toBe(GOOD_TICKET);
      expect(url.searchParams.get('identity')).toBe('beech');
      return new Response(
        JSON.stringify({
          response: { params: { result: 'OK', steamid: '76561198012345678', vacbanned: false, publisherbanned: false } },
        }),
        { status: 200 },
      );
    };
    const who = await verifySteamTicket(GOOD_TICKET, STEAM_CFG, '  Captain  ', fakeFetch);
    expect(who).toEqual({ provider: 'steam', sub: '76561198012345678', name: 'Captain' });
  });

  it('rejects malformed tickets, VAC/publisher bans, Steam errors, and HTTP failures', async () => {
    await expect(verifySteamTicket('not-hex!', STEAM_CFG)).rejects.toThrow(/malformed/);
    await expect(verifySteamTicket(GOOD_TICKET, { appId: '', webApiKey: '' })).rejects.toThrow(/not configured/);

    const jsonResp = (body: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(body), { status });
    await expect(
      verifySteamTicket(GOOD_TICKET, STEAM_CFG, '', jsonResp({ response: { params: { result: 'OK', steamid: '76561198012345678', vacbanned: true } } })),
    ).rejects.toThrow(/restricted/);
    await expect(
      verifySteamTicket(
        GOOD_TICKET,
        STEAM_CFG,
        '',
        jsonResp({ response: { params: { result: 'OK', steamid: '76561198012345678', publisherbanned: true } } }),
      ),
    ).rejects.toThrow(/restricted/);
    await expect(
      verifySteamTicket(GOOD_TICKET, STEAM_CFG, '', jsonResp({ response: { error: { errorcode: 101, errordesc: 'Invalid ticket' } } })),
    ).rejects.toThrow(/Invalid ticket/);
    await expect(verifySteamTicket(GOOD_TICKET, STEAM_CFG, '', jsonResp({}, 502))).rejects.toThrow(/502/);
  });
});

describe('Steam auth and cross-platform account linking', () => {
  let db: Db;
  let skew = 0;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    db = await openTestDb();
    app = createApp(db, {
      googleClientIds: [],
      appleClientIds: [],
      allowedOrigins: ['app://beech'],
      devAuth: true,
      now: () => Date.now() + skew,
      steamAuth: STEAM_CFG,
      verifySteam: async (ticket, _cfg, name = '') => {
        if (ticket === 'bad') throw new Error('rejected');
        return { provider: 'steam', sub: `765611980000000${ticket.slice(-2)}`, name };
      },
    });
  });

  afterAll(async () => {
    await db?.close();
  });

  const post = (path: string, body: unknown, token?: string) =>
    app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  it('signs in with Steam and reuses the same user on repeat sign-in', async () => {
    const r1 = await post('/auth/steam', { ticket: `${GOOD_TICKET}01`, name: 'Maya' });
    expect(r1.status).toBe(200);
    const d1 = (await r1.json()) as { token: string; user: { id: string; name: string } };
    expect(d1.user.name).toBe('Maya');

    const r2 = await post('/auth/steam', { ticket: `${GOOD_TICKET}01`, name: 'Maya' });
    expect(r2.status).toBe(200);
    const d2 = (await r2.json()) as { token: string; user: { id: string; name: string } };
    expect(d2.user.id).toBe(d1.user.id);

    const bad = await post('/auth/steam', { ticket: 'bad' });
    expect(bad.status).toBe(401);
  });

  it('returns 404 for /auth/steam when Steam auth is not configured', async () => {
    const off = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: false });
    const res = await off.request('/auth/steam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: GOOD_TICKET }),
    });
    expect(res.status).toBe(404);
  });

  it('links a fresh Steam account to an existing account and syncs inventory across sign-ins', async () => {
    // Existing web/mobile user with an item in their bag
    const webRes = await post('/auth/dev', { name: 'WebPlayer' });
    const web = (await webRes.json()) as { token: string; user: { id: string; name: string } };
    expect((await post('/dev/grant', { item: 'lighthouse', quantity: 1 }, web.token)).status).toBe(204);

    // Generate a 10-min link code on the existing device
    const codeRes = await post('/account/link-code', {}, web.token);
    expect(codeRes.status).toBe(200);
    const { code } = (await codeRes.json()) as { code: string; expiresAt: number };
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // Fresh Steam user signs in, then redeems the link code
    const steamRes = await post('/auth/steam', { ticket: `${GOOD_TICKET}02`, name: 'SteamPlayer' });
    const steam = (await steamRes.json()) as { token: string; user: { id: string; name: string } };
    expect(steam.user.id).not.toBe(web.user.id);

    const linkRes = await post('/account/link', { code }, steam.token);
    expect(linkRes.status).toBe(200);
    const linked = (await linkRes.json()) as { token: string; user: { id: string; name: string } };
    expect(linked.user.id).toBe(web.user.id);

    // Subsequent Steam sign-in resolves directly to the linked account and sees the lighthouse
    const again = await post('/auth/steam', { ticket: `${GOOD_TICKET}02`, name: 'WebPlayer' });
    const againData = (await again.json()) as { token: string; user: { id: string } };
    expect(againData.user.id).toBe(web.user.id);

    const inv = await app.request('/inventory', { headers: { Authorization: `Bearer ${againData.token}` } });
    const invData = (await inv.json()) as { items: { item: string; quantity: number }[] };
    expect(invData.items.some((x) => x.item === 'lighthouse' && x.quantity === 1)).toBe(true);

    // Code is one-time use
    const reuse = await post('/account/link', { code }, againData.token);
    expect(reuse.status).toBe(404);
  });

  it('rejects self-linking and expired codes; a non-empty account merges only after confirmation', async () => {
    const a = (await (await post('/auth/dev', { name: 'Alpha' })).json()) as { token: string; user: { id: string } };
    const { code } = (await (await post('/account/link-code', {}, a.token)).json()) as { code: string };

    // Self-link refused
    expect((await post('/account/link', { code }, a.token)).status).toBe(400);

    // Non-empty Steam account: unconfirmed link is refused with a preview...
    const b = (await (await post('/auth/steam', { ticket: `${GOOD_TICKET}03`, name: 'BusySteam' })).json()) as { token: string; user: { id: string } };
    expect((await post('/dev/grant', { item: 'parasol', quantity: 1 }, b.token)).status).toBe(204);
    const unconfirmed = await post('/account/link', { code }, b.token);
    expect(unconfirmed.status).toBe(409);
    const unconfirmedBody = (await unconfirmed.json()) as { preview?: { inventory?: { rowsMoved: number } } };
    expect(unconfirmedBody.preview?.inventory?.rowsMoved).toBe(1);

    // ...and the confirmed link merges the parasol onto the target account
    const confirmed = await post('/account/link', { code, confirmed: true }, b.token);
    expect(confirmed.status).toBe(200);
    const merged = (await confirmed.json()) as { user: { id: string } };
    expect(merged.user.id).toBe(a.user.id);
    const again = (await (await post('/auth/steam', { ticket: `${GOOD_TICKET}03`, name: 'BusySteam' })).json()) as { user: { id: string } };
    expect(again.user.id).toBe(a.user.id);

    // Expired code refused (404): a fresh code, then the clock moves past it
    const { code: freshCode } = (await (await post('/account/link-code', {}, a.token)).json()) as { code: string };
    skew += 11 * 60 * 1000;
    const c = (await (await post('/auth/steam', { ticket: `${GOOD_TICKET}04`, name: 'LateSteam' })).json()) as { token: string };
    expect((await post('/account/link', { code: freshCode }, c.token)).status).toBe(404);
  });

  it('merges an account that starred a beach; a star on the survivor home beach is discarded', async () => {
    const a = (await (await post('/auth/dev', { name: 'Target' })).json()) as { token: string; user: { id: string } };
    const { code } = (await (await post('/account/link-code', {}, a.token)).json()) as { code: string };

    const steam = (await (await post('/auth/steam', { ticket: `${GOOD_TICKET}05`, name: 'Stargazer' })).json()) as {
      token: string;
      user: { id: string };
    };
    // Star the target's beach: no items, no saved beach. The star names the
    // survivor's own home beach, so the merge discards it (you cannot star
    // your own beach) instead of refusing the link.
    const beachRows = await db.query<{ id: string }>('SELECT id FROM beach WHERE owner_id = $1', [a.user.id]);
    expect(beachRows.length).toBe(1);
    await db.query('INSERT INTO star_first (user_id, beach_id, at) VALUES ($1, $2, $3)', [
      steam.user.id,
      beachRows[0].id,
      Date.now(),
    ]);
    const preview = await post('/account/link/preview', { code }, steam.token);
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { preview: { stars: { moved: number; discarded: number } } };
    expect(previewBody.preview.stars).toMatchObject({ moved: 0, discarded: 1 });
    const linked = await post('/account/link', { code, confirmed: true }, steam.token);
    expect(linked.status).toBe(200);
    const linkedBody = (await linked.json()) as { user: { id: string } };
    expect(linkedBody.user.id).toBe(a.user.id);
    expect(await db.query('SELECT 1 FROM star_first WHERE user_id = $1', [a.user.id])).toEqual([]);
  });
});
