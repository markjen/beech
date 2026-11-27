// GET /pane: the expanded status pane's chips (stars on the beach in view,
// buried finds today). Read-only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import { DIG_FIND_DAILY_CAP } from '../src/digFinds.js';
import { pullDay } from '../src/pulls.js';
import { openTestDb } from './testDb.js';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  db = await openTestDb();
  app = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true });
});
afterAll(() => db.close());

const req = (path: string, init: RequestInit = {}, token?: string) =>
  app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
async function signIn(name: string) {
  const r = await req('/auth/dev', { method: 'POST', body: JSON.stringify({ name }), headers: { 'Content-Type': 'application/json' } });
  const s = (await r.json()) as { token: string; user: { id: string } };
  const n = (await (await req('/neighbors', {}, s.token)).json()) as { code: string };
  return { token: s.token, id: s.user.id, code: n.code };
}

describe('GET /pane', () => {
  it('counts the stars on a beach and your finds today', async () => {
    const ana = await signIn('Ana');
    const ben = await signIn('Ben');
    const cy = await signIn('Cy');
    for (const t of [ben.token, cy.token]) expect((await req(`/favorites/${ana.code}`, { method: 'PUT' }, t)).status).toBeLessThan(300);
    const home = ana.id; // a home beach's id is its owner's id
    await db.query('INSERT INTO dig_state (user_id, day, finds, last_roll_at) VALUES ($1, $2, 2, 0)', [ben.id, pullDay(Date.now())]);
    const r = await req(`/pane?beach=${home}`, {}, ben.token);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ stars: 2, findsToday: 2, findsCap: DIG_FIND_DAILY_CAP });
    // no beach, or not an id: just the finds; yesterday's finds don't count
    await db.query("UPDATE dig_state SET day = '2000-01-01' WHERE user_id = $1", [ben.id]);
    expect(await (await req('/pane?beach=nope', {}, ben.token)).json()).toEqual({ stars: null, findsToday: 0, findsCap: DIG_FIND_DAILY_CAP });
    expect((await req('/pane')).status).toBe(401);
  });
});
