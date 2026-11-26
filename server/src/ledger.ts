// Your sand-buck history (docs/SAND_BUCKS.md, "Your account on beechshore"):
// every row of credit_ledger for one player, newest first, each with a
// plain-words line saying what it was. credit_ledger already logs every
// movement of the balance (packs, spending, trade-ins, gift cards, creator
// credit, refunds, invite bonuses), so this only reads and labels it.

import type { Db } from './db.js';
import { centsToBucks } from './bucks.js';
import { displayName } from './prizeNames.js';
import { productById, storeProductById } from './products.js';

export interface LedgerRow {
  id: number;
  kind: string;
  /** signed: + in, - out */
  bucks: number;
  what: string;
  at: number;
}

interface Raw {
  id: string;
  kind: string;
  amount_cents: number;
  ref: string;
  created_at: string;
  product_id: string | null;
  traded: string | null;
  who: string | null;
}

const productName = (id: string): string => storeProductById(id)?.name ?? displayName(id);

/** What one ledger row was, in plain words. */
export function ledgerLabel(r: { kind: string; ref: string; product_id?: string | null; traded?: string | null; who?: string | null }): string {
  const who = r.who?.trim() || 'someone';
  switch (r.kind) {
    case 'pack':
      return r.product_id ? `Bought ${productName(r.product_id)}` : 'Bought sand dollars';
    case 'pack_refund':
      return r.product_id ? `Refund: ${productName(r.product_id)}` : 'Refund of sand dollars';
    case 'spend':
      if (r.ref.startsWith('basket:')) return 'Bought what a copied beach needed';
      return `Bought ${productById(r.ref)?.name ?? displayName(r.ref)}`;
    case 'trade_in': {
      const n = Number(r.traded ?? 0);
      return `Traded in ${n > 1 ? `${n} × ` : ''}${displayName(r.ref)}`;
    }
    case 'trade_in_refund':
      return 'Refund: a traded-in thing taken back';
    case 'gift_card':
      return 'Redeemed a gift card';
    case 'creator_royalty':
      return 'Creator credit for your item';
    case 'creator_royalty_refund':
      return 'Creator credit returned';
    case 'invite_bonus':
      return r.ref.startsWith('invited_by:') ? `Joined through ${who}’s invite` : `${who} joined through your invite`;
    default:
      return r.kind;
  }
}

/** The newest `limit` rows of a player's sand-buck history. */
export async function ledgerOf(db: Db, user: string, limit = 100): Promise<LedgerRow[]> {
  const rows = await db.query<Raw>(
    `SELECT l.id, l.kind, l.amount_cents, l.ref, l.created_at,
            p.product_id,
            (SELECT SUM(t.quantity) FROM trade_ins t
              WHERE l.kind = 'trade_in' AND t.user_id = l.user_id AND t.item_id = l.ref AND t.created_at = l.created_at) AS traded,
            u.name AS who
       FROM credit_ledger l
       LEFT JOIN purchases p ON l.kind IN ('pack', 'pack_refund') AND l.ref = 'purchase:' || p.id::text
       LEFT JOIN users u ON l.kind = 'invite_bonus'
                        AND u.id::text = substring(l.ref FROM '^invited(?:_by)?:(.*)$')
      WHERE l.user_id = $1
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $2`,
    [user, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    bucks: Math.sign(Number(r.amount_cents)) * centsToBucks(Math.abs(Number(r.amount_cents))),
    what: ledgerLabel(r),
    at: Number(r.created_at),
  }));
}
