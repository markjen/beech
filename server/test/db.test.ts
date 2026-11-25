import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Db } from '../src/db.js';
import { openTestDb } from './testDb.js';

describe('Db.withTransaction', () => {
  let db: Db;

  beforeAll(async () => {
    db = await openTestDb();
    await db.exec('DROP TABLE IF EXISTS tx_test; CREATE TABLE tx_test (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
  });

  afterAll(async () => {
    await db?.exec('DROP TABLE IF EXISTS tx_test');
    await db?.close();
  });

  it('commits writes on success', async () => {
    await db.withTransaction(async (tx) => {
      await tx.query('INSERT INTO tx_test (id, v) VALUES ($1, $2)', [1, 'kept']);
    });
    const rows = await db.query<{ v: string }>('SELECT v FROM tx_test WHERE id = $1', [1]);
    expect(rows.map((r) => r.v)).toEqual(['kept']);
  });

  it('accepts an operation label on query, in and out of a transaction', async () => {
    await db.query('INSERT INTO tx_test (id, v) VALUES ($1, $2)', [10, 'labelled'], 'test.op');
    await db.withTransaction(async (tx) => {
      await tx.query('INSERT INTO tx_test (id, v) VALUES ($1, $2)', [11, 'tx-labelled'], 'test.txOp');
    });
    const rows = await db.query<{ v: string }>('SELECT v FROM tx_test WHERE id IN ($1, $2) ORDER BY id', [10, 11], 'test.op');
    expect(rows.map((r) => r.v)).toEqual(['labelled', 'tx-labelled']);
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
