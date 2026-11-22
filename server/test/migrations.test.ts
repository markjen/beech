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
