import { describe, expect, it } from 'vitest';
import { createPgliteDb } from '../src/db.js';
import { migrate } from '../src/migrations.js';

describe('migration 5: mutual neighbors', () => {
  it('keeps mutual pairs as links and turns one-way picks into requests', async () => {
    const db = await createPgliteDb();
    await migrate(db, 4);
    const ids = ['a', 'b', 'c', 'd'].map((x, i) => `0000000${i}-0000-4000-8000-00000000000${i}`);
    for (const [i, id] of ids.entries())
      await db.query('INSERT INTO users (id, provider, provider_sub, name, neighbor_code, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
        id,
        'dev',
        `s${i}`,
        `n${i}`,
        `CODE${i}X`,
        i,
      ]);
    const [a, b, c, d] = ids;
    const pick = (u: string, side: string, n: string) =>
      db.query('INSERT INTO neighbors (user_id, side, neighbor_id, created_at) VALUES ($1, $2, $3, 1)', [u, side, n]);
    await pick(a, 'left', b); // mutual: a's left is b, b's right is a
    await pick(b, 'right', a);
    await pick(c, 'left', d); // one-way: c picked d
    await migrate(db);
    const links = await db.query<{ user_id: string; side: string }>('SELECT user_id, side FROM neighbors ORDER BY user_id');
    expect(links.map((l) => [l.user_id, l.side])).toEqual([
      [a, 'left'],
      [b, 'right'],
    ]);
    const reqs = await db.query<{ from_id: string; to_id: string; side: string }>('SELECT from_id, to_id, side FROM neighbor_requests');
    expect(reqs).toEqual([{ from_id: c, to_id: d, side: 'left' }]);
    await db.close();
  });
});

describe('migration 6: growing claw cooldown', () => {
  it('carries earlier daily goes over as a count and a next free time', async () => {
    const db = await createPgliteDb();
    await migrate(db, 5);
    const id = '00000000-0000-4000-8000-000000000009';
    await db.query("INSERT INTO users (id, provider, provider_sub, name, neighbor_code, created_at) VALUES ($1, 'dev', 'x', 'x', 'CODEXX', 0)", [id]);
    for (const [day, at] of [['2026-11-20', 1000], ['2026-11-21', 2000], ['2026-11-22', 3000]] as const)
      await db.query("INSERT INTO pulls (user_id, pool, day, item_id, rarity, created_at) VALUES ($1, 'daily', $2, 'conch', 'common', $3)", [id, day, at]);
    await migrate(db);
    const st = await db.query<{ count: number; next_at: string }>('SELECT count, next_at FROM pull_state WHERE user_id = $1', [id]);
    expect(Number(st[0].count)).toBe(3);
    expect(Number(st[0].next_at)).toBe(3000 + 20 * 60000); // after the 3rd go: 20 minutes
    // and pulls is now a history (several a day are fine)
    await db.query("INSERT INTO pulls (user_id, pool, day, item_id, rarity, created_at) VALUES ($1, 'daily', '2026-11-22', 'conch', 'common', 4000)", [id]);
    await db.close();
  });
});
