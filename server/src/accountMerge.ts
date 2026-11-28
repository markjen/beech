import crypto from 'node:crypto';

import type { Db } from './db.js';

/**
 * Merging two non-empty Beech accounts (docs/STEAM.md, "Merging accounts").
 *
 * Survivor model: the link-code owner's account survives; the account that
 * redeems the code (the "absorbed" account) is folded into it and its user
 * row deleted. Everything moves or nothing does: plan + execute run in one
 * transaction, and the plan is computed inside that transaction (after
 * locking both user rows) so nothing can change under it.
 *
 * The one structural wrinkle: a person's home beach takes their user id as
 * its id, so the absorbed account's home beach has to be re-identified.
 * Postgres checks foreign keys after each statement and these FKs have no
 * ON UPDATE CASCADE, so the re-id is a copy-and-delete: insert a copy of
 * the home beach under a fresh id (holding its code), point every
 * beach-keyed row at the new id, then delete the old row.
 */

export interface MergePreview {
  survivor: { id: string; name: string };
  absorbed: { id: string; name: string };
  /** the absorbed account holds nothing to move: the old empty-account fast path */
  empty: boolean;
  /** things that stop the merge; empty means it can go ahead */
  blocks: string[];
  beaches: { moved: number; survivorHas: number; allowanceAfter: number; overAllowance: boolean };
  inventory: { rowsMerged: number; rowsMoved: number; quantitySummed: number };
  /** beech-buck credit (cents) and creator-credit debt (cents) moving to the survivor */
  creditCents: number;
  debtCents: number;
  purchases: number;
  checkpoints: number;
  favorites: { moved: number; deduped: number; discarded: number };
  stars: { moved: number; deduped: number; discarded: number };
  ratings: { moved: number; discarded: number };
  neighbors: { linksRetired: number; requestsRetired: number };
  referrals: { moved: number; dropped: number; reranked: number };
  submissions: number;
  inbox: { moved: number; folded: number };
  sessionsInvalidated: number;
  /** human-readable lines, in the order the UI shows them */
  notes: string[];
}

interface MergeAccount {
  id: string;
  name: string;
  nameChosen: boolean;
  email: string | null;
  neighborCode: string;
  creditCents: number;
  debtCents: number;
}

interface InventoryMerge {
  survivorRowId: number;
  addQuantity: number;
  absorbedRowIds: number[];
}

interface ReferralRerank {
  inviteeId: string;
  newRank: number;
}

interface InboxFold {
  absorbedRowId: number;
  survivorRowId: number;
  addCount: number;
}

/** What the plan needs that the preview doesn't show. */
export interface MergeInternal {
  survivor: MergeAccount;
  absorbed: MergeAccount;
  /** the absorbed account's home beach, if it has one */
  homeBeach: { id: string; code: string; saved: boolean } | null;
  newHomeBeachId: string | null;
  survivorBeachIds: string[];
  /** absorbed beach ids with the home beach already mapped to its new id */
  absorbedBeachIds: string[];
  inventoryMerges: InventoryMerge[];
  referralReranks: ReferralRerank[];
  inboxFolds: InboxFold[];
  /** fill the survivor's blank name / missing email from the absorbed account */
  takeName: boolean;
  takeEmail: boolean;
  /** move the absorbed account's dig state (only when the survivor has none) */
  moveDigState: boolean;
  /** counts of the smaller categories, for the `empty` check and the notes */
  other: {
    gifts: number;
    guideSteps: number;
    itemVotes: number;
    itemComments: number;
    pulls: number;
    pullState: number;
    notesTo: number;
    blocks: number;
    webOrders: number;
    steamOrders: number;
    tradeIns: number;
    promoUses: number;
    creditShopOrders: number;
    creditLedger: number;
    beachEvents: number;
    beachCopies: number;
    giftCards: number;
    promoCodes: number;
    uniqueItems: number;
    royalties: number;
    /** pets stowed in the absorbed account's bag (migration 35, `pet_bag`) */
    baggedPets: number;
  };
}

export interface MergePlan {
  preview: MergePreview;
  internal: MergeInternal;
}

const num = (v: unknown): number => Number(v ?? 0);

async function userRow(q: Db, id: string): Promise<MergeAccount | null> {
  const rows = await q.query<{
    id: string;
    name: string;
    name_chosen: boolean;
    email: string | null;
    neighbor_code: string;
    credit_cents: string;
    creator_credit_debt_cents: string;
  }>(
    'SELECT id, name, name_chosen, email, neighbor_code, credit_cents, creator_credit_debt_cents FROM users WHERE id = $1',
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    nameChosen: Boolean(r.name_chosen),
    email: r.email,
    neighborCode: r.neighbor_code,
    creditCents: num(r.credit_cents),
    debtCents: num(r.creator_credit_debt_cents),
  };
}

async function count(q: Db, sql: string, params: unknown[]): Promise<number> {
  const rows = await q.query<{ n: string }>(sql, params);
  return num(rows[0]?.n);
}

/** Read-only analysis of what merging `absorbedId` into `survivorId` would do. */
export async function planAccountMerge(
  q: Db,
  survivorId: string,
  absorbedId: string,
  now: number,
  beachCap: number,
): Promise<MergePlan> {
  const survivor = await userRow(q, survivorId);
  const absorbed = await userRow(q, absorbedId);
  if (!survivor || !absorbed) throw new Error('account not found');

  const survivorBeaches = await q.query<{ id: string; home: boolean }>(
    'SELECT id, home FROM beach WHERE owner_id = $1 ORDER BY created_at',
    [survivorId],
  );
  const absorbedBeaches = await q.query<{ id: string; home: boolean; saved: boolean; code: string }>(
    'SELECT id, home, sand IS NOT NULL AS saved, code FROM beach WHERE owner_id = $1 ORDER BY created_at',
    [absorbedId],
  );
  const homeBeachRow = absorbedBeaches.find((b) => b.home) ?? null;
  const homeBeach = homeBeachRow ? { id: homeBeachRow.id, code: homeBeachRow.code, saved: !!homeBeachRow.saved } : null;
  const newHomeBeachId = homeBeach ? crypto.randomUUID() : null;
  const mapBeach = (id: string): string => (homeBeach && id === homeBeach.id ? newHomeBeachId! : id);
  const survivorBeachIds = survivorBeaches.map((b) => b.id);
  const absorbedBeachIds = absorbedBeaches.map((b) => mapBeach(b.id));

  // --- beaches / allowance -------------------------------------------------
  const beachItems = await count(
    q,
    `SELECT COALESCE(SUM(quantity), 0)::text AS n FROM inventory
      WHERE user_id IN ($1, $2) AND item_id = 'beach' AND (expires_at IS NULL OR expires_at > $3)`,
    [survivorId, absorbedId, now],
  );
  const allowanceAfter = Math.min(beachCap, 1 + beachItems);
  const beachesMoved = absorbedBeaches.length;
  const overAllowance = survivorBeaches.length + beachesMoved > allowanceAfter;

  // --- inventory: fold identical rows, move the rest -----------------------
  const invKey = (r: { item_id: string; source: string; expires_at: unknown; purchase_id: unknown; unit_cents: unknown; royalty_ref: unknown }): string =>
    [r.item_id, r.source, r.expires_at ?? '', r.purchase_id ?? '', r.unit_cents ?? '', r.royalty_ref ?? ''].join('|');
  type InvRow = { id: string; item_id: string; quantity: string; source: string; expires_at: unknown; purchase_id: unknown; unit_cents: unknown; royalty_ref: unknown };
  const [survivorInv, absorbedInv] = await Promise.all([
    q.query<InvRow>(
      'SELECT id, item_id, quantity, source, expires_at, purchase_id, unit_cents, royalty_ref FROM inventory WHERE user_id = $1',
      [survivorId],
    ),
    q.query<InvRow>(
      'SELECT id, item_id, quantity, source, expires_at, purchase_id, unit_cents, royalty_ref FROM inventory WHERE user_id = $1',
      [absorbedId],
    ),
  ]);
  const survivorInvByKey = new Map<string, InvRow>();
  for (const r of survivorInv) if (!survivorInvByKey.has(invKey(r))) survivorInvByKey.set(invKey(r), r);
  const absorbedGroups = new Map<string, InvRow[]>();
  for (const r of absorbedInv) {
    const k = invKey(r);
    const g = absorbedGroups.get(k) ?? [];
    g.push(r);
    absorbedGroups.set(k, g);
  }
  const inventoryMerges: InventoryMerge[] = [];
  let rowsMerged = 0;
  let rowsMoved = 0;
  let quantitySummed = 0;
  for (const [key, group] of absorbedGroups) {
    const match = survivorInvByKey.get(key);
    if (match) {
      inventoryMerges.push({
        survivorRowId: Number(match.id),
        addQuantity: group.reduce((s, r) => s + num(r.quantity), 0),
        absorbedRowIds: group.map((r) => Number(r.id)),
      });
      rowsMerged += group.length;
      quantitySummed += group.reduce((s, r) => s + num(r.quantity), 0);
    } else {
      rowsMoved += group.length;
    }
  }

  // --- purchases: a shared store transaction would be a double grant -------
  const purchaseCollisions = await q.query<{ transaction_id: string }>(
    `SELECT p.transaction_id FROM purchases p WHERE p.user_id = $1
       AND EXISTS (SELECT 1 FROM purchases s WHERE s.user_id = $2 AND s.store = p.store AND s.transaction_id = p.transaction_id)`,
    [absorbedId, survivorId],
  );
  const purchases = await count(q, 'SELECT COUNT(*)::text AS n FROM purchases WHERE user_id = $1', [absorbedId]);
  const shopOrderCollisions = await count(
    q,
    `SELECT COUNT(*)::text AS n FROM credit_shop_orders l
      WHERE l.user_id = $1 AND EXISTS (SELECT 1 FROM credit_shop_orders s WHERE s.user_id = $2 AND s.request_id = l.request_id)`,
    [absorbedId, survivorId],
  );
  const blocks: string[] = [];
  if (purchaseCollisions.length) {
    blocks.push(
      `both accounts hold store transaction ${purchaseCollisions[0].transaction_id}; that purchase cannot belong to two accounts`,
    );
  }
  if (shopOrderCollisions) blocks.push('both accounts hold the same credit-shop order id; that order cannot belong to two accounts');

  // --- favorites / stars / ratings -----------------------------------------
  // "duplicate" = the survivor already has the same row, so the absorbed
  // one goes away: for favorites/stars that is a dedupe (the same star),
  // for ratings it is a discard (the survivor's rating wins).
  const dedupe3 = async (
    table: 'favorites' | 'star_first' | 'ratings',
    userCol: 'user_id' | 'rater_id',
  ): Promise<{ moved: number; deduped: number; discarded: number }> => {
    const absorbedRows = await q.query<{ beach_id: string }>(`SELECT beach_id FROM ${table} WHERE ${userCol} = $1`, [absorbedId]);
    const survivorRows = await q.query<{ beach_id: string }>(`SELECT beach_id FROM ${table} WHERE ${userCol} = $1`, [survivorId]);
    const survivorSet = new Set(survivorRows.map((r) => r.beach_id));
    let moved = 0;
    let dup = 0;
    let discarded = 0;
    for (const r of absorbedRows) {
      const beach = mapBeach(r.beach_id);
      if (table !== 'ratings' && beach === survivorId) discarded++;
      else if (survivorSet.has(beach)) dup++;
      else moved++;
    }
    if (table === 'ratings') return { moved, deduped: 0, discarded: dup };
    return { moved, deduped: dup, discarded };
  };
  const favorites = await dedupe3('favorites', 'user_id');
  const stars = await dedupe3('star_first', 'user_id');
  const ratings = await dedupe3('ratings', 'rater_id');

  // --- neighbors: links between the two accounts' beaches retire -----------
  // (a link whose both ends end up owned by the same person is meaningless;
  // links to third parties stay, with the home beach re-identified).
  const unionIds = [...survivorBeachIds, ...absorbedBeaches.map((b) => b.id)];
  const absorbedIds = absorbedBeaches.map((b) => b.id);
  const neighborLinks = await q.query<{ beach_id: string; neighbor_beach_id: string }>(
    `SELECT beach_id, neighbor_beach_id FROM neighbors
      WHERE beach_id = ANY($1::uuid[]) OR neighbor_beach_id = ANY($1::uuid[])`,
    [absorbedIds],
  );
  const inUnion = (id: string): boolean => unionIds.includes(id);
  const inAbsorbed = (id: string): boolean => absorbedIds.includes(id);
  const linksRetired = neighborLinks.filter(
    (r) => inUnion(r.beach_id) && inUnion(r.neighbor_beach_id) && (inAbsorbed(r.beach_id) || inAbsorbed(r.neighbor_beach_id)),
  ).length;
  const neighborRequests = await q.query<{ from_beach: string; to_beach: string }>(
    `SELECT from_beach, to_beach FROM neighbor_requests
      WHERE from_beach = ANY($1::uuid[]) OR to_beach = ANY($1::uuid[])`,
    [absorbedIds],
  );
  const requestsRetired = neighborRequests.filter(
    (r) => inUnion(r.from_beach) && inUnion(r.to_beach) && (inAbsorbed(r.from_beach) || inAbsorbed(r.to_beach)),
  ).length;

  // --- blocks: a block that would point at yourself after the move is dropped
  const blockRows = await q.query<{ blocker_id: string; blocked_id: string }>(
    'SELECT blocker_id, blocked_id FROM blocks WHERE blocker_id = $1 OR blocked_id = $1',
    [absorbedId],
  );
  const survivorBlocks = await q.query<{ blocker_id: string; blocked_id: string }>(
    'SELECT blocker_id, blocked_id FROM blocks WHERE blocker_id = $1 OR blocked_id = $1',
    [survivorId],
  );
  const survivorBlocksOut = new Set(survivorBlocks.filter((r) => r.blocker_id === survivorId).map((r) => r.blocked_id));
  const survivorBlockedBy = new Set(survivorBlocks.filter((r) => r.blocked_id === survivorId).map((r) => r.blocker_id));
  let blocksMoved = 0;
  let blocksDropped = 0;
  for (const r of blockRows) {
    if (r.blocker_id === absorbedId && r.blocked_id === survivorId) blocksDropped++;
    else if (r.blocker_id === survivorId && r.blocked_id === absorbedId) blocksDropped++;
    else if (r.blocker_id === absorbedId && survivorBlocksOut.has(r.blocked_id)) blocksDropped++;
    else if (r.blocked_id === absorbedId && survivorBlockedBy.has(r.blocker_id)) blocksDropped++;
    else blocksMoved++;
  }

  // --- referrals ------------------------------------------------------------
  const referralRows = await q.query<{
    invitee_id: string;
    inviter_id: string;
    reward_rank: string | null;
  }>('SELECT invitee_id, inviter_id, reward_rank FROM referrals WHERE invitee_id = $1 OR inviter_id = $1', [absorbedId]);
  const survivorIsInvitee = (await count(q, 'SELECT COUNT(*)::text AS n FROM referrals WHERE invitee_id = $1', [survivorId])) > 0;
  // Rank math ignores the survivor-invited-absorbed row: the merge drops it
  // (it would become a self-referral), so its rank is freed, not held.
  const survivorMaxRank = num(
    (await q.query<{ m: string | null }>(
      'SELECT MAX(reward_rank) AS m FROM referrals WHERE inviter_id = $1 AND invitee_id <> $2',
      [survivorId, absorbedId],
    ))[0]?.m,
  );
  let referralsMoved = 0;
  let referralsDropped = 0;
  const referralReranks: ReferralRerank[] = [];
  // re-rank in the order the rows already hold, so the earliest friend keeps
  // the earliest rung under the kept account
  const rankOrder = (a: { reward_rank: string | null }, b: { reward_rank: string | null }): number =>
    a.reward_rank === null ? (b.reward_rank === null ? 0 : 1) : b.reward_rank === null ? -1 : num(a.reward_rank) - num(b.reward_rank);
  const rerankOf = new Map<string, number>();
  {
    let next = survivorMaxRank;
    for (const r of referralRows.filter((x) => x.inviter_id === absorbedId).sort(rankOrder)) {
      if (r.invitee_id !== survivorId && r.reward_rank !== null) rerankOf.set(r.invitee_id, ++next);
    }
  }
  for (const r of referralRows) {
    if (r.invitee_id === absorbedId) {
      // the absorbed account was invited by someone; it cannot stay invited
      // by the survivor (that would be a self-referral), and the survivor
      // can only have been invited once
      if (r.inviter_id === survivorId || survivorIsInvitee) referralsDropped++;
      else referralsMoved++;
    } else {
      // the absorbed account invited someone; that link moves, unless the
      // friend is the survivor (again, a self-referral after the move)
      if (r.invitee_id === survivorId) referralsDropped++;
      else {
        referralsMoved++;
        const rank = rerankOf.get(r.invitee_id);
        if (rank !== undefined) referralReranks.push({ inviteeId: r.invitee_id, newRank: rank });
      }
    }
  }

  // --- inbox: batched rows with the same key fold their counts together ----
  const absorbedInbox = await q.query<{ id: string; kind: string; beach_id: string; day: string | null; count: string }>(
    'SELECT id, kind, beach_id, day, count FROM inbox WHERE user_id = $1',
    [absorbedId],
  );
  const survivorInbox = await q.query<{ id: string; kind: string; beach_id: string; day: string | null; count: string }>(
    'SELECT id, kind, beach_id, day, count FROM inbox WHERE user_id = $1 AND day IS NOT NULL',
    [survivorId],
  );
  const survivorInboxByKey = new Map(survivorInbox.map((r) => [`${r.kind}|${r.beach_id}|${r.day}`, r]));
  const inboxFolds: InboxFold[] = [];
  let inboxMoved = 0;
  for (const r of absorbedInbox) {
    if (r.day !== null) {
      const match = survivorInboxByKey.get(`${r.kind}|${mapBeach(r.beach_id)}|${r.day}`);
      if (match) {
        inboxFolds.push({ absorbedRowId: Number(r.id), survivorRowId: Number(match.id), addCount: num(r.count) });
        continue;
      }
    }
    inboxMoved++;
  }

  // --- guide steps / votes / pull state / dig state -------------------------
  const guideRows = await q.query<{ step: string }>('SELECT step FROM guide_steps WHERE user_id = $1', [absorbedId]);
  const survivorSteps = new Set((await q.query<{ step: string }>('SELECT step FROM guide_steps WHERE user_id = $1', [survivorId])).map((r) => r.step));
  const guideDeduped = guideRows.filter((r) => survivorSteps.has(r.step)).length;
  const voteRows = await q.query<{ item_id: string }>('SELECT item_id FROM item_votes WHERE user_id = $1', [absorbedId]);
  const survivorVotes = new Set((await q.query<{ item_id: string }>('SELECT item_id FROM item_votes WHERE user_id = $1', [survivorId])).map((r) => r.item_id));
  const votesDeduped = voteRows.filter((r) => survivorVotes.has(r.item_id)).length;
  const pullStateRows = await q.query<{ pool: string }>('SELECT pool FROM pull_state WHERE user_id = $1', [absorbedId]);
  const survivorPools = new Set((await q.query<{ pool: string }>('SELECT pool FROM pull_state WHERE user_id = $1', [survivorId])).map((r) => r.pool));
  const pullStateDiscarded = pullStateRows.filter((r) => survivorPools.has(r.pool)).length;
  const survivorDig = (await count(q, 'SELECT COUNT(*)::text AS n FROM dig_state WHERE user_id = $1', [survivorId])) > 0;
  const absorbedDig = (await count(q, 'SELECT COUNT(*)::text AS n FROM dig_state WHERE user_id = $1', [absorbedId])) > 0;

  const checkpoints = await count(q, 'SELECT COUNT(*)::text AS n FROM checkpoints WHERE owner_id = $1', [absorbedId]);
  const submissions = await count(q, 'SELECT COUNT(*)::text AS n FROM item_submissions WHERE submitter_user_id = $1', [absorbedId]);
  const sessionsInvalidated = await count(q, 'SELECT COUNT(*)::text AS n FROM sessions WHERE user_id = $1', [absorbedId]);

  const other = {
    gifts: await count(q, 'SELECT COUNT(*)::text AS n FROM gifts WHERE from_id = $1 OR to_id = $1', [absorbedId]),
    guideSteps: guideRows.length - guideDeduped,
    itemVotes: voteRows.length - votesDeduped,
    itemComments: await count(q, 'SELECT COUNT(*)::text AS n FROM item_comments WHERE user_id = $1', [absorbedId]),
    pulls: await count(q, 'SELECT COUNT(*)::text AS n FROM pulls WHERE user_id = $1', [absorbedId]),
    pullState: pullStateRows.length - pullStateDiscarded,
    notesTo: await count(q, 'SELECT COUNT(*)::text AS n FROM notes WHERE to_id = $1', [absorbedId]),
    blocks: blocksMoved,
    webOrders: await count(q, 'SELECT COUNT(*)::text AS n FROM web_orders WHERE user_id = $1', [absorbedId]),
    steamOrders: await count(q, 'SELECT COUNT(*)::text AS n FROM steam_orders WHERE user_id = $1', [absorbedId]),
    tradeIns: await count(q, 'SELECT COUNT(*)::text AS n FROM trade_ins WHERE user_id = $1', [absorbedId]),
    promoUses: await count(q, 'SELECT COUNT(*)::text AS n FROM promo_uses WHERE user_id = $1', [absorbedId]),
    creditShopOrders: await count(q, 'SELECT COUNT(*)::text AS n FROM credit_shop_orders WHERE user_id = $1', [absorbedId]),
    creditLedger: await count(q, 'SELECT COUNT(*)::text AS n FROM credit_ledger WHERE user_id = $1', [absorbedId]),
    beachEvents: await count(
      q,
      'SELECT COUNT(*)::text AS n FROM beach_events WHERE beach_id IN (SELECT id FROM beach WHERE owner_id = $1)',
      [absorbedId],
    ),
    beachCopies: await count(q, 'SELECT COUNT(*)::text AS n FROM beach_copies WHERE copier = $1', [absorbedId]),
    giftCards: await count(q, 'SELECT COUNT(*)::text AS n FROM gift_cards WHERE issued_by = $1 OR redeemed_by = $1', [absorbedId]),
    promoCodes: await count(q, 'SELECT COUNT(*)::text AS n FROM promo_codes WHERE created_by = $1', [absorbedId]),
    uniqueItems: await count(q, 'SELECT COUNT(*)::text AS n FROM unique_items WHERE owner_id = $1', [absorbedId]),
    royalties: await count(
      q,
      'SELECT COUNT(*)::text AS n FROM creator_royalties WHERE creator_user_id = $1 OR buyer_user_id = $1',
      [absorbedId],
    ),
    // bagged pets are plain rows keyed by user: they move whole (no dedupe,
    // no unique constraint). Without this count the `empty` check below
    // would call an account holding only a stowed pet empty and link it
    // without confirmation — and the user row's delete would cascade the
    // pet away with no preview.
    baggedPets: await count(q, 'SELECT COUNT(*)::text AS n FROM pet_bag WHERE user_id = $1', [absorbedId]),
  };

  const empty =
    beachesMoved === 1 &&
    homeBeach !== null &&
    !homeBeach.saved &&
    rowsMerged === 0 &&
    rowsMoved === 0 &&
    purchases === 0 &&
    checkpoints === 0 &&
    favorites.moved === 0 &&
    favorites.deduped === 0 &&
    favorites.discarded === 0 &&
    stars.moved === 0 &&
    stars.deduped === 0 &&
    stars.discarded === 0 &&
    ratings.moved === 0 &&
    ratings.discarded === 0 &&
    linksRetired === 0 &&
    requestsRetired === 0 &&
    referralsMoved === 0 &&
    referralsDropped === 0 &&
    submissions === 0 &&
    inboxMoved === 0 &&
    inboxFolds.length === 0 &&
    absorbed.creditCents === 0 &&
    absorbed.debtCents === 0 &&
    Object.values(other).every((n) => n === 0) &&
    guideDeduped === 0 &&
    votesDeduped === 0 &&
    pullStateDiscarded === 0 &&
    !absorbedDig;

  const notes: string[] = [];
  notes.push(
    `${beachesMoved} beach${beachesMoved === 1 ? '' : 'es'} move to ${survivor.name || 'the kept account'}${homeBeach ? '; its home beach becomes a regular beach (your home stays home)' : ''}.`,
  );
  if (rowsMerged || rowsMoved) notes.push(`${rowsMerged + rowsMoved} bag rows move (${rowsMerged} folded into matching rows, ${quantitySummed} items summed).`);
  if (absorbed.creditCents) notes.push(`${absorbed.creditCents} cents of beech-buck credit move over.`);
  if (absorbed.debtCents) notes.push(`${absorbed.debtCents} cents of creator-credit debt move over.`);
  if (purchases) notes.push(`${purchases} purchase${purchases === 1 ? '' : 's'} move over.`);
  if (checkpoints) notes.push(`${checkpoints} checkpoint${checkpoints === 1 ? '' : 's'} move over.`);
  if (favorites.moved || favorites.deduped || favorites.discarded)
    notes.push(`${favorites.moved} favorite${favorites.moved === 1 ? '' : 's'} move (${favorites.deduped} already favorited, ${favorites.discarded} dropped: your own home beach).`);
  if (stars.moved || stars.deduped || stars.discarded)
    notes.push(`${stars.moved} stars move (${stars.deduped} already starred, ${stars.discarded} dropped: your own home beach).`);
  if (ratings.moved || ratings.discarded) notes.push(`${ratings.moved} ratings move (${ratings.discarded} dropped: you had already rated that beach).`);
  if (linksRetired || requestsRetired) notes.push(`${linksRetired} neighbor link${linksRetired === 1 ? '' : 's'} and ${requestsRetired} request${requestsRetired === 1 ? '' : 's'} between your two accounts retire (you can't be your own neighbor).`);
  if (referralsMoved || referralsDropped || referralReranks.length)
    notes.push(`${referralsMoved} invite referral${referralsMoved === 1 ? '' : 's'} move (${referralsDropped} dropped: they named your other account; ${referralReranks.length} re-ranked under your kept account).`);
  if (submissions) notes.push(`${submissions} item submission${submissions === 1 ? '' : 's'} move over, with their sales and royalties.`);
  if (inboxMoved || inboxFolds.length) notes.push(`${inboxMoved} inbox rows move (${inboxFolds.length} folded into matching rows).`);
  if (other.gifts) notes.push(`${other.gifts} gift record${other.gifts === 1 ? '' : 's'} move over.`);
  if (other.uniqueItems) notes.push(`${other.uniqueItems} unique item${other.uniqueItems === 1 ? '' : 's'} move over.`);
  if (other.baggedPets)
    notes.push(`${other.baggedPets} pet${other.baggedPets === 1 ? '' : 's'} in the bag move${other.baggedPets === 1 ? 's' : ''} over.`);
  if (other.guideSteps || other.itemVotes || other.itemComments)
    notes.push(`${other.guideSteps} guide steps, ${other.itemVotes} item votes and ${other.itemComments} comments move over.`);
  if (other.pulls || other.pullState) notes.push(`claw history moves over (${other.pulls} draws).`);
  if (sessionsInvalidated) notes.push(`${sessionsInvalidated} sign-in session${sessionsInvalidated === 1 ? '' : 's'} on the absorbed account stop working; sign in with it again and you land on the kept account.`);
  if (overAllowance)
    notes.push(
      `after the merge you hold ${survivorBeaches.length + beachesMoved} beaches against an allowance of ${allowanceAfter}; nothing is deleted, but you can't make a new beach until you're back under it.`,
    );
  if (survivor.name === '' && absorbed.name !== '') notes.push(`your kept account takes the name ${absorbed.name} (it had none).`);
  if (survivor.email === null && absorbed.email !== null) notes.push(`your kept account takes the email ${absorbed.email} (it had none).`);
  notes.push(`the absorbed account's neighbor code ${absorbed.neighborCode} retires; its beaches keep their share codes.`);
  if (empty) notes.push('nothing else to move: this is the empty-account link.');

  const preview: MergePreview = {
    survivor: { id: survivor.id, name: survivor.name },
    absorbed: { id: absorbed.id, name: absorbed.name },
    empty,
    blocks,
    beaches: { moved: beachesMoved, survivorHas: survivorBeaches.length, allowanceAfter, overAllowance },
    inventory: { rowsMerged, rowsMoved, quantitySummed },
    creditCents: absorbed.creditCents,
    debtCents: absorbed.debtCents,
    purchases,
    checkpoints,
    favorites,
    stars,
    ratings,
    neighbors: { linksRetired, requestsRetired },
    referrals: { moved: referralsMoved, dropped: referralsDropped, reranked: referralReranks.length },
    submissions,
    inbox: { moved: inboxMoved, folded: inboxFolds.length },
    sessionsInvalidated,
    notes,
  };

  return {
    preview,
    internal: {
      survivor,
      absorbed,
      homeBeach,
      newHomeBeachId,
      survivorBeachIds,
      absorbedBeachIds,
      inventoryMerges,
      referralReranks,
      inboxFolds,
      takeName:
        (survivor.name === '' && absorbed.name !== '') ||
        (!survivor.nameChosen && absorbed.nameChosen && absorbed.name !== ''),
      takeEmail: survivor.email === null && absorbed.email !== null,
      moveDigState: absorbedDig && !survivorDig,
      other,
    },
  };
}

/** Every beach column that can hold a beach id (migrations 7-35). The home
 * beach re-id points all of them at the new id; the first two are the
 * beach's own copy link. */
const BEACH_REFS: { table: string; column: string }[] = [
  { table: 'beach', column: 'copied_from' },
  { table: 'neighbors', column: 'beach_id' },
  { table: 'neighbors', column: 'neighbor_beach_id' },
  { table: 'neighbor_requests', column: 'from_beach' },
  { table: 'neighbor_requests', column: 'to_beach' },
  { table: 'favorites', column: 'beach_id' },
  { table: 'star_first', column: 'beach_id' },
  { table: 'ratings', column: 'beach_id' },
  { table: 'notes', column: 'beach_id' },
  { table: 'inbox', column: 'beach_id' },
  { table: 'checkpoints', column: 'from_beach' },
  { table: 'checkpoints', column: 'origin_beach_id' },
  { table: 'beach_pets', column: 'beach_id' },
  { table: 'wild_feed_progress', column: 'beach_id' },
  { table: 'pet_feed_log', column: 'beach_id' },
  { table: 'beach_snacks', column: 'beach_id' },
  { table: 'beach_piers', column: 'beach_id' },
  { table: 'beach_events', column: 'beach_id' },
  { table: 'beach_copies', column: 'source_beach' },
];

const BEACH_COLUMNS =
  'id, owner_id, code, name, home, on_shore, location, nx, ny, version, updated_at, sand, items, created_at, epoch, simulated_until, here_until, owner_seen_at, viewed_until, copied_from, copied_from_code, copied_version';

/** Run the merge the plan describes. Must be called in the same transaction
 * (and after the same locks) as the plan, with the link code already
 * consumed. Either everything below commits or the transaction rolls back. */
export async function executeAccountMerge(tx: Db, plan: MergePlan, now: number): Promise<void> {
  const { survivor, absorbed } = plan.internal;
  const s = survivor.id;
  const a = absorbed.id;
  const { newHomeBeachId, homeBeach } = plan.internal;

  // --- re-identify the absorbed account's home beach -----------------------
  // Copy it under a fresh id (it becomes a regular beach of the survivor),
  // point every beach-keyed row at the copy, then delete the original. The
  // code stays: share links to it keep working.
  if (homeBeach && newHomeBeachId) {
    // free the code, copy the row under the fresh id (a regular beach of the
    // survivor, holding the original code), then point every beach-keyed row
    // at the copy and delete the original
    await tx.query('UPDATE beach SET code = $1 WHERE id = $2', [`merge-tmp-${newHomeBeachId}`, homeBeach.id]);
    await tx.query(
      `INSERT INTO beach (${BEACH_COLUMNS})
       SELECT $1, $2, $3, name, false, on_shore, location, nx, ny, version, updated_at, sand, items,
              created_at, epoch, simulated_until, here_until, owner_seen_at, viewed_until,
              copied_from, copied_from_code, copied_version
         FROM beach WHERE id = $4`,
      [newHomeBeachId, s, homeBeach.code, homeBeach.id],
    );
    for (const { table, column } of BEACH_REFS) {
      await tx.query(`UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`, [newHomeBeachId, homeBeach.id]);
    }
    await tx.query('DELETE FROM beach WHERE id = $1', [homeBeach.id]);
  }

  // --- the absorbed account's other beaches move over ----------------------
  await tx.query('UPDATE beach SET owner_id = $1 WHERE owner_id = $2', [s, a]);

  // --- neighbor links/requests between the two accounts' beaches retire ----
  // (both ends now have the same owner; links to third parties stay)
  const union = [...plan.internal.survivorBeachIds, ...plan.internal.absorbedBeachIds];
  const absorbedSet = plan.internal.absorbedBeachIds;
  const retire = async (table: string, c1: string, c2: string): Promise<void> => {
    await tx.query(
      `DELETE FROM ${table}
        WHERE (${c1} = ANY($1::uuid[]) OR ${c2} = ANY($1::uuid[]))
          AND ${c1} = ANY($2::uuid[]) AND ${c2} = ANY($2::uuid[])`,
      [absorbedSet, union],
    );
  };
  await retire('neighbors', 'beach_id', 'neighbor_beach_id');
  await retire('neighbor_requests', 'from_beach', 'to_beach');

  // --- inventory: fold identical rows, move the rest -----------------------
  for (const m of plan.internal.inventoryMerges) {
    await tx.query('UPDATE inventory SET quantity = quantity + $1 WHERE id = $2', [m.addQuantity, m.survivorRowId]);
    await tx.query('DELETE FROM inventory WHERE id = ANY($1::bigint[])', [m.absorbedRowIds]);
  }
  await tx.query('UPDATE inventory SET user_id = $1 WHERE user_id = $2', [s, a]);

  // --- money: credit and debt sum; the move is written to the ledger -------
  if (absorbed.creditCents !== 0 || absorbed.debtCents !== 0) {
    await tx.query(
      'UPDATE users SET credit_cents = credit_cents + $1, creator_credit_debt_cents = creator_credit_debt_cents + $2 WHERE id = $3',
      [absorbed.creditCents, absorbed.debtCents, s],
    );
  }
  if (absorbed.creditCents > 0) {
    await tx.query(
      "INSERT INTO credit_ledger (user_id, kind, amount_cents, ref, created_at) VALUES ($1, 'merge', $2, $3, $4)",
      [s, absorbed.creditCents, `merge:${a}`, now],
    );
  }
  await tx.query('UPDATE credit_ledger SET user_id = $1 WHERE user_id = $2', [s, a]);

  // --- plain moves: every row just changes owner ---------------------------
  const moves: [string, string][] = [
    ['purchases', 'user_id'],
    ['checkpoints', 'owner_id'],
    ['pulls', 'user_id'],
    ['promo_uses', 'user_id'],
    ['web_orders', 'user_id'],
    ['steam_orders', 'user_id'],
    ['trade_ins', 'user_id'],
    ['credit_shop_orders', 'user_id'],
    ['item_comments', 'user_id'],
    ['item_submissions', 'submitter_user_id'],
    ['beach_snacks', 'user_id'],
    ['beach_piers', 'owner_id'],
    ['pet_bag', 'user_id'],
    ['notes', 'to_id'],
  ];
  for (const [table, column] of moves) {
    await tx.query(`UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`, [s, a]);
  }
  await tx.query('UPDATE gifts SET from_id = $1 WHERE from_id = $2', [s, a]);
  await tx.query('UPDATE gifts SET to_id = $1 WHERE to_id = $2', [s, a]);
  await tx.query('UPDATE gift_cards SET issued_by = $1 WHERE issued_by = $2', [s, a]);
  await tx.query('UPDATE gift_cards SET redeemed_by = $1 WHERE redeemed_by = $2', [s, a]);
  await tx.query('UPDATE promo_codes SET created_by = $1 WHERE created_by = $2', [s, a]);
  await tx.query('UPDATE unique_items SET owner_id = $1 WHERE owner_id = $2', [s, a]);
  await tx.query('UPDATE creator_royalties SET creator_user_id = $1 WHERE creator_user_id = $2', [s, a]);
  await tx.query('UPDATE creator_royalties SET buyer_user_id = $1 WHERE buyer_user_id = $2', [s, a]);

  // --- dedupe moves: the survivor's row wins, the absorbed one is dropped --
  // favorites / stars: also drop rows naming the survivor's own home beach
  for (const table of ['favorites', 'star_first'] as const) {
    await tx.query(`DELETE FROM ${table} WHERE user_id = $1 AND beach_id = $2`, [a, s]);
    await tx.query(
      `DELETE FROM ${table} f USING ${table} sv
        WHERE f.user_id = $1 AND sv.user_id = $2 AND sv.beach_id = f.beach_id`,
      [a, s],
    );
    await tx.query(`UPDATE ${table} SET user_id = $1 WHERE user_id = $2`, [s, a]);
  }
  // ratings: the survivor's rating wins
  await tx.query(
    `DELETE FROM ratings r USING ratings sv WHERE r.rater_id = $1 AND sv.rater_id = $2 AND sv.beach_id = r.beach_id`,
    [a, s],
  );
  await tx.query('UPDATE ratings SET rater_id = $1 WHERE rater_id = $2', [s, a]);
  // blocks: a block that would point at yourself is dropped, then deduped
  await tx.query('DELETE FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [a, s]);
  await tx.query(
    `DELETE FROM blocks b USING blocks sv
      WHERE b.blocker_id = $1 AND sv.blocker_id = $2 AND sv.blocked_id = b.blocked_id`,
    [a, s],
  );
  await tx.query(
    `DELETE FROM blocks b USING blocks sv
      WHERE b.blocked_id = $1 AND sv.blocked_id = $2 AND sv.blocker_id = b.blocker_id`,
    [a, s],
  );
  await tx.query('UPDATE blocks SET blocker_id = $1 WHERE blocker_id = $2', [s, a]);
  await tx.query('UPDATE blocks SET blocked_id = $1 WHERE blocked_id = $2', [s, a]);
  // guide steps / item votes: one each; the survivor's wins
  await tx.query(
    `DELETE FROM guide_steps g USING guide_steps sv WHERE g.user_id = $1 AND sv.user_id = $2 AND sv.step = g.step`,
    [a, s],
  );
  await tx.query('UPDATE guide_steps SET user_id = $1 WHERE user_id = $2', [s, a]);
  await tx.query(
    `DELETE FROM item_votes v USING item_votes sv WHERE v.user_id = $1 AND sv.user_id = $2 AND sv.item_id = v.item_id`,
    [a, s],
  );
  await tx.query('UPDATE item_votes SET user_id = $1 WHERE user_id = $2', [s, a]);
  // beach copies: one per person per source; the survivor's wins
  await tx.query(
    `DELETE FROM beach_copies c USING beach_copies sv
      WHERE c.copier = $1 AND sv.copier = $2 AND sv.source_beach = c.source_beach`,
    [a, s],
  );
  await tx.query('UPDATE beach_copies SET copier = $1 WHERE copier = $2', [s, a]);
  // pull state: one row per pool; the survivor's cooldown wins
  await tx.query(
    `DELETE FROM pull_state p USING pull_state sv WHERE p.user_id = $1 AND sv.user_id = $2 AND sv.pool = p.pool`,
    [a, s],
  );
  await tx.query('UPDATE pull_state SET user_id = $1 WHERE user_id = $2', [s, a]);
  // dig state: move only when the survivor has none
  if (plan.internal.moveDigState) {
    await tx.query('UPDATE dig_state SET user_id = $1 WHERE user_id = $2', [s, a]);
  }

  // --- referrals: drop the self-referrals, move and re-rank the rest -------
  await tx.query('DELETE FROM referrals WHERE invitee_id = $1 AND inviter_id = $2', [a, s]);
  await tx.query('DELETE FROM referrals WHERE invitee_id = $1 AND EXISTS (SELECT 1 FROM referrals r WHERE r.invitee_id = $2)', [a, s]);
  await tx.query('DELETE FROM referrals WHERE inviter_id = $1 AND invitee_id = $2', [a, s]);
  await tx.query('UPDATE referrals SET invitee_id = $1 WHERE invitee_id = $2', [s, a]);
  // clear ranks before moving the inviter rows: two rows can't share a rank
  // under one inviter, and the plan's re-ranks are applied right after
  await tx.query('UPDATE referrals SET reward_rank = NULL WHERE inviter_id = $1', [a]);
  await tx.query('UPDATE referrals SET inviter_id = $1 WHERE inviter_id = $2', [s, a]);
  for (const r of plan.internal.referralReranks) {
    await tx.query('UPDATE referrals SET reward_rank = $1 WHERE invitee_id = $2', [r.newRank, r.inviteeId]);
  }

  // --- inbox: fold batched rows into the survivor's, move the rest ---------
  for (const f of plan.internal.inboxFolds) {
    await tx.query('UPDATE inbox SET count = count + $1 WHERE id = $2', [f.addCount, f.survivorRowId]);
    await tx.query('DELETE FROM inbox WHERE id = $1', [f.absorbedRowId]);
  }
  await tx.query('UPDATE inbox SET user_id = $1 WHERE user_id = $2', [s, a]);

  // --- the absorbed account itself ------------------------------------------
  // name / email only fill blanks on the survivor (or keep a chosen screen name), never overwrite a chosen one
  if (plan.internal.takeName) {
    await tx.query('UPDATE users SET name = $1, name_chosen = $2 WHERE id = $3', [absorbed.name, absorbed.nameChosen, s]);
  }
  if (plan.internal.takeEmail) await tx.query('UPDATE users SET email = $1 WHERE id = $2', [absorbed.email, s]);
  // identities move first, so a sign-in with the absorbed provider lands on
  // the survivor from here on; sessions die with the user row (and take
  // push subscriptions and item-submission sessions with them)
  await tx.query('UPDATE user_identities SET user_id = $1 WHERE user_id = $2', [s, a]);
  await tx.query('DELETE FROM sessions WHERE user_id = $1', [a]);
  await tx.query('DELETE FROM users WHERE id = $1', [a]);
}
