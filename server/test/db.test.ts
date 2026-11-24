import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPgliteDb, type Db } from '../src/db.js';

describe('Db.withTransaction', () => {
  let db: Db;

  beforeAll(async () => {
    db = await createPgliteDb();
    await db.exec('CREATE TABLE tx_test (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
  });

  afterAll(async () => {
    await db?.close();
  });

  it('commits writes on success', async () => {
    await db.withTransaction(async (tx) => {
      await tx.query('INSERT INTO tx_test (id, v) VALUES ($1, $2)', [1, 'kept']);
    });
    const rows = await db.query<{ v: string }>('SELECT v FROM tx_test WHERE id = $1', [1]);
    expect(rows.map((r) => r.v)).toEqual(['kept']);
  });

  it('rolls back writes when fn throws, and the db stays usable', async () => {
    await expect(
      db.withTransaction(async (tx) => {
        await tx.query('INSERT INTO tx_test (id, v) VALUES ($1, $2)', [2, 'lost']);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rows = await db.query<{ v: string }>('SELECT v FROM tx_test WHERE id = $1', [2]);
    expect(rows).toEqual([]);
    // The connection/pool is healthy after the rollback.
    await db.query('INSERT INTO tx_test (id, v) VALUES ($1, $2)', [3, 'after']);
    const after = await db.query<{ v: string }>('SELECT v FROM tx_test WHERE id = $1', [3]);
    expect(after.map((r) => r.v)).toEqual(['after']);
  });
});
