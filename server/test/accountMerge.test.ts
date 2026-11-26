import crypto from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import type { MergePreview } from '../src/accountMerge.js';
import type { Db } from '../src/db.js';
import { openTestDb } from './testDb.js';

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
const get = (path: string, token?: string) =>
  app.request(path, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

type Who = { token: string; user: { id: string; name: string } };
async function signIn(name: string): Promise<Who> {
  const r = await post('/auth/dev', { name });
  expect(r.status).toBe(200);
  return (await r.json()) as Who;
}
async function linkCode(token: string): Promise<string> {
  const r = await post('/account/link-code', {}, token);
  expect(r.status).toBe(200);
  return ((await r.json()) as { code: string }).code;
}
async function preview(code: string, token: string): Promise<{ status: number; preview: MergePreview }> {
  const r = await post('/account/link/preview', { code }, token);
  const body = (await r.json()) as { preview: MergePreview; error?: string };
  return { status: r.status, preview: body.preview };
}
async function homeBeach(userId: string): Promise<string> {
  const rows = await db.query<{ id: string }>('SELECT id FROM beach WHERE owner_id = $1 AND home', [userId]);
  expect(rows.length).toBe(1);
  return rows[0].id;
}
async function grant(userId: string, item: string, quantity: number, source = 'shop'): Promise<void> {
  await db.query(
    `INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at) VALUES ($1, $2, $3, $4, $5)`,
    [userId, item, quantity, source, Date.now()],
  );
}
async function saveBeach(userId: string): Promise<void> {
  await db.query('UPDATE beach SET sand = $1, version = 1 WHERE owner_id = $2 AND home', [Buffer.from([1, 2, 3]), userId]);
}
async function extraBeach(userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO beach (id, owner_id, code, name, home, created_at) VALUES ($1, $2, $3, '', false, $4)`,
    [id, userId, `X${Math.random().toString(36).slice(2, 8).toUpperCase()}`, Date.now()],
  );
  return id;
}
async function purchase(userId: string, transactionId: string, productId = 'item_parasol'): Promise<number> {
  const [p] = await db.query<{ id: string }>(
    `INSERT INTO purchases (user_id, store, transaction_id, product_id, environment, purchased_at, granted_at)
     VALUES ($1, 'apple', $2, $3, 'Sandbox', 1, 1) RETURNING id`,
    [userId, transactionId, productId],
  );
  return Number(p.id);
}
async function userExists(id: string): Promise<boolean> {
  return (await db.query('SELECT 1 FROM users WHERE id = $1', [id])).length > 0;
}
async function owned(userId: string, item: string): Promise<number> {
  const rows = await db.query<{ n: string }>(
    'SELECT COALESCE(SUM(quantity), 0)::text AS n FROM inventory WHERE user_id = $1 AND item_id = $2',
    [userId, item],
  );
  return Number(rows[0]?.n ?? 0);
}

describe('merging two non-empty accounts', () => {
  it('moves beaches, folds inventory, sums credit and debt, moves purchases, and lands the absorbed sign-in on the survivor', async () => {
    const survivor = await signIn('merge-survivor');
    const absorbed = await signIn('merge-absorbed');
    const third = await signIn('merge-third');

    // survivor: 1 lighthouse + 2 parasols, 500 credit, a purchase, stars/favorites third's beach
    await grant(survivor.user.id, 'lighthouse', 1);
    await grant(survivor.user.id, 'parasol', 2);
    await purchase(survivor.user.id, 'MERGE-TX-S1');
    await db.query('UPDATE users SET credit_cents = 500 WHERE id = $1', [survivor.user.id]);
    const thirdHome = await homeBeach(third.user.id);
    await db.query('INSERT INTO favorites (user_id, beach_id, created_at) VALUES ($1, $2, $3)', [survivor.user.id, thirdHome, 1]);
    await db.query('INSERT INTO star_first (user_id, beach_id, at) VALUES ($1, $2, $3)', [survivor.user.id, thirdHome, 1]);
    await db.query('INSERT INTO ratings (rater_id, beach_id, shells, updated_at) VALUES ($1, $2, 5, $3)', [survivor.user.id, thirdHome, 1]);

    // absorbed: 1 lighthouse + 1 parasol (same source, so they fold), 300 credit, 120 debt,
    // a purchase, a saved home beach, an extra beach, a checkpoint, stars/favorites/ratings
    await grant(absorbed.user.id, 'lighthouse', 1);
    await grant(absorbed.user.id, 'parasol', 1);
    await purchase(absorbed.user.id, 'MERGE-TX-A1');
    await db.query('UPDATE users SET credit_cents = 300, creator_credit_debt_cents = 120 WHERE id = $1', [absorbed.user.id]);
    await saveBeach(absorbed.user.id);
    const absorbedExtra = await extraBeach(absorbed.user.id);
    const absorbedHome = await homeBeach(absorbed.user.id);
    const [absorbedHomeCode] = await db.query<{ code: string }>('SELECT code FROM beach WHERE id = $1', [absorbedHome]);
    await db.query(
      `INSERT INTO checkpoints (id, owner_id, name, kind, source, from_beach, from_name, location, nx, ny, sand, bytes, items, objects, created_at)
       VALUES ($1, $2, 'before', 'named', 'beach', $3, '', NULL, 0, 0, $4, 3, '{}', 0, $5)`,
      [crypto.randomUUID(), absorbed.user.id, absorbedHome, Buffer.from([9]), Date.now()],
    );
    await db.query('INSERT INTO favorites (user_id, beach_id, created_at) VALUES ($1, $2, $3)', [absorbed.user.id, thirdHome, 1]);
    await db.query('INSERT INTO star_first (user_id, beach_id, at) VALUES ($1, $2, $3)', [absorbed.user.id, thirdHome, 1]);
    await db.query('INSERT INTO ratings (rater_id, beach_id, shells, updated_at) VALUES ($1, $2, 3, $3)', [absorbed.user.id, thirdHome, 1]);
    // absorbed also favorited the survivor's home beach: dropped after the move (own home)
    const survivorHome = await homeBeach(survivor.user.id);
    await db.query('INSERT INTO favorites (user_id, beach_id, created_at) VALUES ($1, $2, $3)', [absorbed.user.id, survivorHome, 1]);

    const code = await linkCode(survivor.token);
    const { status: previewStatus, preview: p } = await preview(code, absorbed.token);
    expect(previewStatus).toBe(200);
    expect(p.empty).toBe(false);
    expect(p.survivor.id).toBe(survivor.user.id);
    expect(p.absorbed.id).toBe(absorbed.user.id);
    expect(p.beaches.moved).toBe(2);
    expect(p.inventory.rowsMerged).toBe(2);
    expect(p.inventory.quantitySummed).toBe(2);
    expect(p.creditCents).toBe(300);
    expect(p.debtCents).toBe(120);
    expect(p.purchases).toBe(1);
    expect(p.checkpoints).toBe(1);
    expect(p.favorites).toMatchObject({ moved: 0, deduped: 1, discarded: 1 });
    expect(p.stars).toMatchObject({ moved: 0, deduped: 1, discarded: 0 });
    expect(p.ratings).toMatchObject({ moved: 0, discarded: 1 });
    expect(p.blocks).toEqual([]);

    // unconfirmed: refused, and the preview comes back with the refusal
    const refused = await post('/account/link', { code }, absorbed.token);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { preview: MergePreview }).preview.creditCents).toBe(300);
    // the code is NOT spent by a refused merge: it still works
    const linked = await post('/account/link', { code, confirmed: true }, absorbed.token);
    expect(linked.status).toBe(200);
    const done = (await linked.json()) as { token: string; user: { id: string }; merged: MergePreview };
    expect(done.user.id).toBe(survivor.user.id);
    expect(done.merged.creditCents).toBe(300);

    // inventory folded, credit + debt summed, ledger explains the move
    expect(await owned(survivor.user.id, 'lighthouse')).toBe(2);
    expect(await owned(survivor.user.id, 'parasol')).toBe(3);
    const [u] = await db.query<{ credit_cents: string; creator_credit_debt_cents: string }>(
      'SELECT credit_cents, creator_credit_debt_cents FROM users WHERE id = $1',
      [survivor.user.id],
    );
    expect(Number(u.credit_cents)).toBe(800);
    expect(Number(u.creator_credit_debt_cents)).toBe(120);
    const [ledger] = await db.query<{ kind: string; amount_cents: string }>(
      "SELECT kind, amount_cents FROM credit_ledger WHERE user_id = $1 AND kind = 'merge'",
      [survivor.user.id],
    );
    expect(ledger).toMatchObject({ kind: 'merge', amount_cents: 300 });

    // both purchases now belong to the survivor
    expect(await count('SELECT COUNT(*)::text AS n FROM purchases WHERE user_id = $1', [survivor.user.id])).toBe(2);

    // beaches: survivor home + absorbed home (re-identified, demoted, code kept) + absorbed extra
    const beaches = await db.query<{ id: string; home: boolean; code: string }>(
      'SELECT id, home, code FROM beach WHERE owner_id = $1 ORDER BY created_at',
      [survivor.user.id],
    );
    expect(beaches.length).toBe(3);
    expect(beaches.filter((b) => b.home).length).toBe(1);
    expect(beaches.filter((b) => b.home)[0].id).toBe(survivorHome);
    const movedHome = beaches.find((b) => b.id !== survivorHome && b.id !== absorbedExtra)!;
    expect(movedHome.home).toBe(false);
    expect(movedHome.id).not.toBe(absorbedHome);
    // the absorbed home beach kept its share code (findable by code)
    expect(movedHome.code).toBe(absorbedHomeCode.code);
    expect(await db.query('SELECT 1 FROM beach WHERE id = $1', [absorbedHome])).toEqual([]);
    // its checkpoint moved with it, pointing at the new id
    const [ckpt] = await db.query<{ owner_id: string; from_beach: string }>(
      'SELECT owner_id, from_beach FROM checkpoints WHERE owner_id = $1',
      [survivor.user.id],
    );
    expect(ckpt.owner_id).toBe(survivor.user.id);
    expect(ckpt.from_beach).toBe(movedHome.id);

    // favorites/stars: one each on third's beach; the survivor's rating wins
    expect(await count('SELECT COUNT(*)::text AS n FROM favorites WHERE user_id = $1', [survivor.user.id])).toBe(1);
    expect(await count('SELECT COUNT(*)::text AS n FROM star_first WHERE user_id = $1', [survivor.user.id])).toBe(1);
    const [rating] = await db.query<{ shells: string }>('SELECT shells FROM ratings WHERE rater_id = $1 AND beach_id = $2', [
      survivor.user.id,
      thirdHome,
    ]);
    expect(Number(rating.shells)).toBe(5);

    // the absorbed account is gone; its old session is dead; signing in with
    // it again lands on the survivor
    expect(await userExists(absorbed.user.id)).toBe(false);
    expect((await get('/me', absorbed.token)).status).toBe(401);
    const again = await signIn('merge-absorbed');
    expect(again.user.id).toBe(survivor.user.id);
    // and the survivor's own session still works
    expect((await get('/me', survivor.token)).status).toBe(200);
  });

  it('previews without changing anything, and an empty account still links without confirming', async () => {
    const survivor = await signIn('merge-preview-survivor');
    const absorbed = await signIn('merge-preview-absorbed');
    await grant(absorbed.user.id, 'parasol', 1);
    const code = await linkCode(survivor.token);
    const { preview: p } = await preview(code, absorbed.token);
    expect(p.empty).toBe(false);
    expect(p.inventory.rowsMoved).toBe(1);
    // preview spent nothing: the absorbed account still exists and the code still works
    expect(await userExists(absorbed.user.id)).toBe(true);
    expect((await post('/account/link', { code, confirmed: true }, absorbed.token)).status).toBe(200);
    expect(await userExists(absorbed.user.id)).toBe(false);

    const survivor2 = await signIn('merge-empty-survivor');
    const fresh = await signIn('merge-empty-absorbed');
    const code2 = await linkCode(survivor2.token);
    const { preview: p2 } = await preview(code2, fresh.token);
    expect(p2.empty).toBe(true);
    // the old fast path: no confirmation needed
    expect((await post('/account/link', { code: code2 }, fresh.token)).status).toBe(200);
  });

  it('refuses self-linking, bad codes, and expired codes', async () => {
    const a = await signIn('merge-refuse-a');
    const code = await linkCode(a.token);
    expect((await post('/account/link', { code }, a.token)).status).toBe(400);
    expect((await post('/account/link/preview', { code: 'NOPE' }, a.token)).status).toBe(400);
    const b = await signIn('merge-refuse-b');
    expect((await post('/account/link', { code: 'NOPE-1234' }, b.token)).status).toBe(404);
    skew += 11 * 60 * 1000;
    expect((await post('/account/link', { code }, b.token)).status).toBe(404);
    skew -= 11 * 60 * 1000;
  });

  it('re-identifies the absorbed home beach and keeps third-party references to it', async () => {
    const survivor = await signIn('merge-reid-survivor');
    const absorbed = await signIn('merge-reid-absorbed');
    const third = await signIn('merge-reid-third');
    const absorbedHome = await homeBeach(absorbed.user.id);
    const thirdHome = await homeBeach(third.user.id);
    const survivorHome = await homeBeach(survivor.user.id);
    await saveBeach(absorbed.user.id);

    // mutual neighbor links: absorbed home <-> third home
    await db.query('INSERT INTO neighbors (beach_id, side, neighbor_beach_id, created_at) VALUES ($1, $2, $3, $4)', [
      absorbedHome,
      'left',
      thirdHome,
      1,
    ]);
    await db.query('INSERT INTO neighbors (beach_id, side, neighbor_beach_id, created_at) VALUES ($1, $2, $3, $4)', [
      thirdHome,
      'right',
      absorbedHome,
      1,
    ]);
    // a link between the two merging accounts retires (self-neighbor)
    await db.query('INSERT INTO neighbors (beach_id, side, neighbor_beach_id, created_at) VALUES ($1, $2, $3, $4)', [
      survivorHome,
      'left',
      absorbedHome,
      1,
    ]);
    await db.query('INSERT INTO neighbors (beach_id, side, neighbor_beach_id, created_at) VALUES ($1, $2, $3, $4)', [
      absorbedHome,
      'right',
      survivorHome,
      1,
    ]);
    // a pending request from absorbed's home to third stays; one to the survivor retires
    await db.query('INSERT INTO neighbor_requests (from_beach, to_beach, side, created_at) VALUES ($1, $2, $3, $4)', [
      absorbedHome,
      thirdHome,
      'left',
      1,
    ]);
    // third favorited + starred the absorbed home beach, and left a note on it
    await db.query('INSERT INTO favorites (user_id, beach_id, created_at) VALUES ($1, $2, $3)', [third.user.id, absorbedHome, 1]);
    await db.query('INSERT INTO star_first (user_id, beach_id, at) VALUES ($1, $2, $3)', [third.user.id, absorbedHome, 1]);
    await db.query('INSERT INTO notes (from_id, to_id, beach_id, body, created_at) VALUES ($1, $2, $3, $4, $5)', [
      third.user.id,
      absorbed.user.id,
      absorbedHome,
      'lovely beach',
      1,
    ]);

    const code = await linkCode(survivor.token);
    const { preview: p } = await preview(code, absorbed.token);
    expect(p.neighbors).toMatchObject({ linksRetired: 2, requestsRetired: 0 });
    expect((await post('/account/link', { code, confirmed: true }, absorbed.token)).status).toBe(200);

    // the absorbed home beach has a new id; every third-party reference moved with it
    const [moved] = await db.query<{ id: string }>('SELECT id FROM beach WHERE owner_id = $1 AND NOT home ORDER BY created_at', [
      survivor.user.id,
    ]);
    expect(moved.id).not.toBe(absorbedHome);
    expect(await db.query('SELECT 1 FROM beach WHERE id = $1', [absorbedHome])).toEqual([]);
    const links = await db.query<{ beach_id: string; neighbor_beach_id: string }>(
      'SELECT beach_id, neighbor_beach_id FROM neighbors WHERE beach_id = $1 OR neighbor_beach_id = $1',
      [moved.id],
    );
    expect(links).toHaveLength(2);
    expect(links.map((l) => [l.beach_id, l.neighbor_beach_id].sort().join(':')).sort()).toEqual(
      [[moved.id, thirdHome].sort().join(':'), [moved.id, thirdHome].sort().join(':')].sort(),
    );
    // the self-links are gone
    expect(
      await db.query('SELECT 1 FROM neighbors WHERE beach_id = $1 OR neighbor_beach_id = $1', [survivorHome]),
    ).toEqual([]);
    // third's favorite/star/note and the pending request still name the moved beach
    expect(await db.query('SELECT 1 FROM favorites WHERE user_id = $1 AND beach_id = $2', [third.user.id, moved.id])).toHaveLength(1);
    expect(await db.query('SELECT 1 FROM star_first WHERE user_id = $1 AND beach_id = $2', [third.user.id, moved.id])).toHaveLength(1);
    const [note] = await db.query<{ to_id: string; beach_id: string }>('SELECT to_id, beach_id FROM notes WHERE beach_id = $1', [moved.id]);
    expect(note.to_id).toBe(survivor.user.id);
    expect(await db.query('SELECT 1 FROM neighbor_requests WHERE from_beach = $1 AND to_beach = $2', [moved.id, thirdHome])).toHaveLength(1);
  });

  it('moves referrals, re-ranks them under the survivor, and drops self-referrals', async () => {
    const survivor = await signIn('merge-ref-survivor');
    const absorbed = await signIn('merge-ref-absorbed');
    const f1 = await signIn('merge-ref-f1');
    const f2 = await signIn('merge-ref-f2');
    const f3 = await signIn('merge-ref-f3');
    const invite = async (inviter: string, invitee: string, rank: number | null, qualified = true): Promise<void> => {
      await db.query(
        `INSERT INTO referrals (invitee_id, inviter_id, code, created_at, qualified_at, reward_rank, reward_item, bonus_bucks)
         VALUES ($1, $2, 'CODE', 1, $3, $4, NULL, NULL)`,
        [invitee, inviter, qualified ? 1 : null, rank],
      );
    };
    await invite(survivor.user.id, f1.user.id, 1); // survivor's first settled friend
    await invite(absorbed.user.id, f2.user.id, 1); // absorbed's friends, ranks 1 and 2
    await invite(absorbed.user.id, f3.user.id, 2);
    // the survivor invited the absorbed account: after the merge that would
    // be a self-referral, so it is dropped (an account has one invitee row)
    await invite(survivor.user.id, absorbed.user.id, 2);

    const code = await linkCode(survivor.token);
    const { preview: p } = await preview(code, absorbed.token);
    expect(p.referrals).toMatchObject({ moved: 2, dropped: 1, reranked: 2 });
    expect((await post('/account/link', { code, confirmed: true }, absorbed.token)).status).toBe(200);

    const rows = await db.query<{ invitee_id: string; reward_rank: string | null }>(
      'SELECT invitee_id, reward_rank FROM referrals WHERE inviter_id = $1 ORDER BY reward_rank',
      [survivor.user.id],
    );
    expect(rows.map((r) => [r.invitee_id, r.reward_rank ? Number(r.reward_rank) : null])).toEqual([
      [f1.user.id, 1],
      [f2.user.id, 2],
      [f3.user.id, 3],
    ]);
    // no self-referral survives
    expect(await db.query('SELECT 1 FROM referrals WHERE invitee_id = inviter_id')).toEqual([]);
  });

  it("moves the absorbed account's invite (as the friend) onto the survivor", async () => {
    const survivor = await signIn('merge-ref2-survivor');
    const absorbed = await signIn('merge-ref2-absorbed');
    const f4 = await signIn('merge-ref2-f4');
    const f2 = await signIn('merge-ref2-f2');
    // absorbed was invited by f4 (settled, rank 1); absorbed invited f2 (unsettled, no rank yet)
    await db.query(
      `INSERT INTO referrals (invitee_id, inviter_id, code, created_at, qualified_at, reward_rank, reward_item, bonus_bucks)
       VALUES ($1, $2, 'CODE', 1, 1, 1, NULL, NULL)`,
      [absorbed.user.id, f4.user.id],
    );
    await db.query(
      `INSERT INTO referrals (invitee_id, inviter_id, code, created_at, qualified_at, reward_rank, reward_item, bonus_bucks)
       VALUES ($1, $2, 'CODE', 1, NULL, NULL, NULL, NULL)`,
      [f2.user.id, absorbed.user.id],
    );
    const code = await linkCode(survivor.token);
    const { preview: p } = await preview(code, absorbed.token);
    expect(p.referrals).toMatchObject({ moved: 2, dropped: 0, reranked: 0 });
    expect((await post('/account/link', { code, confirmed: true }, absorbed.token)).status).toBe(200);
    // f4's invite of the absorbed account now names the survivor
    expect(await db.query('SELECT 1 FROM referrals WHERE invitee_id = $1 AND inviter_id = $2', [survivor.user.id, f4.user.id])).toHaveLength(1);
    // f2 is now the survivor's invitee, still unranked (it never settled)
    const [f2row] = await db.query<{ reward_rank: string | null }>(
      'SELECT reward_rank FROM referrals WHERE invitee_id = $1 AND inviter_id = $2',
      [f2.user.id, survivor.user.id],
    );
    expect(f2row.reward_rank).toBeNull();
  });

  it('folds batched inbox rows and moves the rest', async () => {
    const survivor = await signIn('merge-inbox-survivor');
    const absorbed = await signIn('merge-inbox-absorbed');
    const third = await signIn('merge-inbox-third');
    const thirdHome = await homeBeach(third.user.id);
    const day = '2026-11-26';
    await db.query(`INSERT INTO inbox (user_id, kind, beach_id, count, day, created_at) VALUES ($1, 'star', $2, 1, $3, 1)`, [
      survivor.user.id,
      thirdHome,
      day,
    ]);
    await db.query(`INSERT INTO inbox (user_id, kind, beach_id, count, day, created_at) VALUES ($1, 'star', $2, 2, $3, 1)`, [
      absorbed.user.id,
      thirdHome,
      day,
    ]);
    await db.query(`INSERT INTO inbox (user_id, kind, beach_id, count, created_at) VALUES ($1, 'gift', $2, 1, 1)`, [
      absorbed.user.id,
      thirdHome,
    ]);
    const code = await linkCode(survivor.token);
    const { preview: p } = await preview(code, absorbed.token);
    expect(p.inbox).toMatchObject({ moved: 1, folded: 1 });
    expect((await post('/account/link', { code, confirmed: true }, absorbed.token)).status).toBe(200);
    const [folded] = await db.query<{ count: string }>(
      "SELECT count FROM inbox WHERE user_id = $1 AND kind = 'star' AND day = $2",
      [survivor.user.id, day],
    );
    expect(Number(folded.count)).toBe(3);
    expect(await count("SELECT COUNT(*)::text AS n FROM inbox WHERE user_id = $1 AND kind = 'gift'", [survivor.user.id])).toBe(1);
  });

  it('moves submissions, gift records, and unique items; keeps different-source bag rows separate', async () => {
    const survivor = await signIn('merge-misc-survivor');
    const absorbed = await signIn('merge-misc-absorbed');
    await grant(survivor.user.id, 'parasol', 1, 'shop');
    await grant(absorbed.user.id, 'parasol', 1, 'gift');
    const [sub] = await db.query<{ id: string }>(
      `INSERT INTO item_submissions (id, submitter_user_id, submitter_beach_code, name, slug, behavior, size_min, size_max,
         proposed_price_cents, proposed_frequency, asset_format, asset_filename, asset_mime, asset_bytes, asset_size,
         asset_summary, terms_accepted, terms_version, terms_accepted_at, created_at, updated_at)
       VALUES ($1, $2, 'CODE', 'Shell', 'shell', 'fixed', 1, 1, 100, 'common', 'beech-json', 'shell.json',
         'application/json', $3, 1, '{}', true, 'v1', 1, 1, 1) RETURNING id`,
      [crypto.randomUUID(), absorbed.user.id, Buffer.from('x')],
    );
    await db.query(
      `INSERT INTO creator_royalties (submission_id, creator_user_id, buyer_user_id, product_id, purchase_ref, sale_price_cents, credit_cents, created_at)
       VALUES ($1, $2, $3, 'item_shell', 'REF-1', 100, 30, 1)`,
      [sub.id, absorbed.user.id, survivor.user.id],
    );
    await db.query(`INSERT INTO unique_items (item_id, owner_id, found_by, found_at) VALUES ('nautilus', $1, 'Abs', 1)`, [
      absorbed.user.id,
    ]);
    await db.query('INSERT INTO gifts (from_id, to_id, item_id, created_at) VALUES ($1, $2, $3, 1)', [
      absorbed.user.id,
      survivor.user.id,
      'parasol',
    ]);
    const code = await linkCode(survivor.token);
    expect((await post('/account/link', { code, confirmed: true }, absorbed.token)).status).toBe(200);
    // different sources stay separate rows (no folding across sources)
    const rows = await db.query<{ source: string; quantity: string }>(
      "SELECT source, quantity FROM inventory WHERE user_id = $1 AND item_id = 'parasol' ORDER BY source",
      [survivor.user.id],
    );
    expect(rows.map((r) => [r.source, Number(r.quantity)])).toEqual([
      ['gift', 1],
      ['shop', 1],
    ]);
    expect(await db.query('SELECT 1 FROM item_submissions WHERE id = $1 AND submitter_user_id = $2', [sub.id, survivor.user.id])).toHaveLength(1);
    expect(await db.query('SELECT 1 FROM creator_royalties WHERE submission_id = $1 AND creator_user_id = $2', [sub.id, survivor.user.id])).toHaveLength(1);
    expect(await db.query("SELECT 1 FROM unique_items WHERE item_id = 'nautilus' AND owner_id = $1", [survivor.user.id])).toHaveLength(1);
    expect(await db.query('SELECT 1 FROM gifts WHERE from_id = $1 AND to_id = $1', [survivor.user.id])).toHaveLength(1);
  });

  it('takes the absorbed name and email only when the survivor has none', async () => {
    const survivor = await signIn('merge-blank-survivor');
    await db.query("UPDATE users SET name = '', email = NULL WHERE id = $1", [survivor.user.id]);
    const absorbed = await signIn('merge-blank-absorbed');
    await db.query("UPDATE users SET email = 'absorbed@example.test' WHERE id = $1", [absorbed.user.id]);
    await grant(absorbed.user.id, 'parasol', 1);
    const code = await linkCode(survivor.token);
    expect((await post('/account/link', { code, confirmed: true }, absorbed.token)).status).toBe(200);
    const [u] = await db.query<{ name: string; email: string | null }>('SELECT name, email FROM users WHERE id = $1', [survivor.user.id]);
    expect(u.name).toBe('merge-blank-absorbed');
    expect(u.email).toBe('absorbed@example.test');
  });
});

async function count(sql: string, params: unknown[]): Promise<number> {
  const rows = await db.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}
