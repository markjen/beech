import { describe, expect, it } from 'vitest';
import { migrate } from '../src/migrations.js';
import { openEmptyTestDb } from './testDb.js';

describe('migration 5: mutual neighbors', () => {
  it('keeps mutual pairs as links and turns one-way picks into requests', async () => {
    const db = await openEmptyTestDb();
    try {
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
      await migrate(db, 5);
      const links = await db.query<{ user_id: string; side: string }>('SELECT user_id, side FROM neighbors ORDER BY user_id');
      expect(links.map((l) => [l.user_id, l.side])).toEqual([
        [a, 'left'],
        [b, 'right'],
      ]);
      const reqs = await db.query<{ from_id: string; to_id: string; side: string }>('SELECT from_id, to_id, side FROM neighbor_requests');
      expect(reqs).toEqual([{ from_id: c, to_id: d, side: 'left' }]);
    } finally {
      await db.close();
    }
  });
});

describe('migration 6: growing claw cooldown', () => {
  it('carries earlier daily goes over as a count and a next free time', async () => {
    const db = await openEmptyTestDb();
    try {
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
    } finally {
      await db.close();
    }
  });
});

describe('migration 7: beaches of their own', () => {
  it('gives everyone a home beach with their code, sand and links', async () => {
    const db = await openEmptyTestDb();
    try {
      await migrate(db, 6);
      const a = '00000000-0000-4000-8000-0000000000a1';
      const b = '00000000-0000-4000-8000-0000000000b2';
      for (const [id, code, at] of [[a, 'AAAAAA', 1], [b, 'BBBBBB', 2]] as const)
        await db.query("INSERT INTO users (id, provider, provider_sub, name, neighbor_code, created_at) VALUES ($1, 'dev', $2, $2, $2, $3)", [id, code, at]);
      await db.query("INSERT INTO beaches (user_id, location, nx, ny, version, updated_at, sand) VALUES ($1, 'piha', 8, 8, 3, 10, $2)", [a, new Uint8Array([5])]);
      await db.query("INSERT INTO neighbors (user_id, side, neighbor_id, created_at) VALUES ($1, 'left', $2, 1), ($2, 'right', $1, 1)", [a, b]);
      await db.query('INSERT INTO favorites (user_id, fav_id, created_at) VALUES ($1, $2, 1)', [b, a]);
      await migrate(db);
      const beaches = await db.query<{ id: string; owner_id: string; code: string; home: boolean; location: string | null; version: number }>(
        'SELECT id, owner_id, code, home, location, version FROM beach ORDER BY code',
      );
      expect(beaches).toEqual([
        { id: a, owner_id: a, code: 'AAAAAA', home: true, location: 'piha', version: 3 },
        { id: b, owner_id: b, code: 'BBBBBB', home: true, location: null, version: 0 },
      ]);
      const links = await db.query<{ beach_id: string; side: string; neighbor_beach_id: string }>('SELECT beach_id, side, neighbor_beach_id FROM neighbors ORDER BY side');
      expect(links).toEqual([
        { beach_id: a, side: 'left', neighbor_beach_id: b },
        { beach_id: b, side: 'right', neighbor_beach_id: a },
      ]);
      expect(await db.query('SELECT beach_id FROM favorites')).toEqual([{ beach_id: a }]);
      // migration 10: existing stars count on the leaderboard from when they were made
      const first = await db.query<{ user_id: string; beach_id: string; at: string }>('SELECT user_id, beach_id, at FROM star_first');
      expect(first.map((r) => [r.user_id, r.beach_id, Number(r.at)])).toEqual([[b, a, 1]]);
      // deleting a user takes their beaches and links with them
      await db.query('DELETE FROM users WHERE id = $1', [a]);
      expect(await db.query('SELECT * FROM neighbors')).toEqual([]);
      expect(await db.query('SELECT * FROM star_first')).toEqual([]);
    } finally {
      await db.close();
    }
  });
});

describe('migration 13: checkpoints', () => {
  it('adds the table and an epoch to beaches that already have sand', async () => {
    const db = await openEmptyTestDb();
    try {
      await migrate(db, 12);
      const a = '00000000-0000-4000-8000-0000000000c3';
      await db.query("INSERT INTO users (id, provider, provider_sub, name, neighbor_code, created_at) VALUES ($1, 'dev', 'c', 'c', 'CCCCCC', 1)", [a]);
      await db.query("INSERT INTO beach (id, owner_id, code, home, location, nx, ny, version, updated_at, sand, created_at) VALUES ($1, $1, 'CCCCCC', true, 'piha', 8, 8, 4, 9, $2, 1)", [a, new Uint8Array([1])]);
      await migrate(db);
      expect(await db.query('SELECT version, epoch FROM beach')).toEqual([{ version: 4, epoch: 0 }]);
      await db.query(
        "INSERT INTO checkpoints (id, owner_id, name, kind, source, from_beach, nx, ny, sand, bytes, objects, created_at) VALUES ($1, $2, 'x', 'auto', 'beach', $2, 8, 8, $3, 1, 0, 1)",
        ['00000000-0000-4000-8000-0000000000d4', a, new Uint8Array([1])],
      );
      // one automatic checkpoint per beach
      await expect(
        db.query(
          "INSERT INTO checkpoints (id, owner_id, name, kind, source, from_beach, nx, ny, sand, bytes, objects, created_at) VALUES ($1, $2, 'y', 'auto', 'beach', $2, 8, 8, $3, 1, 0, 1)",
          ['00000000-0000-4000-8000-0000000000d5', a, new Uint8Array([1])],
        ),
      ).rejects.toThrow();
      // a removed beach leaves its checkpoints; the account takes them
      await db.query('DELETE FROM users WHERE id = $1', [a]);
      expect(await db.query('SELECT * FROM checkpoints')).toEqual([]);
    } finally {
      await db.close();
    }
  });
});

describe('migration 28: not for sale is its own choice', () => {
  it('keeps approvals priced blank or 0 out of the shop, and the rest for sale', async () => {
    const db = await openEmptyTestDb();
    try {
      await migrate(db, 27);
      const u = '00000000-0000-4000-8000-0000000000e1';
      await db.query("INSERT INTO users (id, provider, provider_sub, name, neighbor_code, created_at) VALUES ($1, 'dev', 'e', 'e', 'EEEEEE', 1)", [u]);
      const add = (n: number, price: number | null) =>
        db.query(
          `INSERT INTO item_submissions (id, submitter_user_id, submitter_beach_code, name, slug, behavior, size_min, size_max,
             proposed_price_cents, proposed_frequency, asset_format, asset_filename, asset_mime, asset_bytes, asset_size,
             terms_accepted, terms_version, terms_accepted_at, created_at, updated_at, status, approved_price_cents)
           VALUES ($1, $2, 'EEEEEE', 'x', 'x', 'fixed', 1, 1, 0, 'shop', 'glb', 'x.glb', 'model/gltf-binary', $3, 1, true, 'v', 1, 1, 1, 'approved', $4)`,
          [`00000000-0000-4000-8000-0000000000f${n}`, u, new Uint8Array([1]), price],
        );
      await add(1, null);
      await add(2, 0);
      await add(3, 250);
      await migrate(db);
      const rows = await db.query<{ approved_price_cents: number | null; for_sale: boolean }>(
        'SELECT approved_price_cents, for_sale FROM item_submissions ORDER BY id',
      );
      expect(rows).toEqual([
        { approved_price_cents: null, for_sale: false },
        { approved_price_cents: 0, for_sale: false },
        { approved_price_cents: 250, for_sale: true },
      ]);
    } finally {
      await db.close();
    }
  });
});
