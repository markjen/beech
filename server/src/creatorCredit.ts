//@ backend dafny
import type { Db } from './db.js';
import type { Product } from './products.js';

interface Offer {
  id: string;
  submitter_user_id: string;
  product_id: string;
  item_id: string;
  approved_price_cents: number | null;
  for_sale: boolean;
  status: 'approved' | 'pending' | 'rejected';
}

/** A binding is for one catalog item, even when a SKU grants several copies of it. */
function matches(offer: Offer, product: Product) {
  return product.grants.length === 1 && product.grants[0].item !== 'beach' &&
    offer.product_id === product.id && offer.item_id === product.grants[0].item;
}

const OFFER_FIELDS = 'id, submitter_user_id, product_id, item_id, approved_price_cents, for_sale, status';
/**
 * What a product sells for in USD cents, or null when it isn't for sale. A
 * creator item sells only once approved and marked for sale, at its
 * approved price; 0 means free (claimed with no payment, through
 * /store/credit-purchase).
 */
export function salePriceCents(product: Product, offer?: Offer): number | null {
  //@ verify
  //@ ensures offer !== undefined && \result !== null ==> offer.status === 'approved' && offer.for_sale && \result === offer.approved_price_cents
  if (!offer) return Math.round(product.usd * 100);
  return offer.status === 'approved' && offer.for_sale && offer.approved_price_cents !== null ? offer.approved_price_cents : null;
}

export async function creatorOffers(db: Db) {
  const offers = await db.query<Offer>(`SELECT ${OFFER_FIELDS} FROM item_submissions WHERE product_id IS NOT NULL`);
  const byProduct = new Map(offers.map((offer) => [offer.product_id, offer]));
  return (product: Product) => {
    const offer = byProduct.get(product.id);
    return salePriceCents(product, offer && matches(offer, product) ? offer : undefined);
  };
}

export async function creatorOffer(db: Db, product: Product, lock = false) {
  if (product.grants.length !== 1 || product.grants[0].item === 'beach') return undefined;
  const [offer] = await db.query<Offer>(
    `SELECT ${OFFER_FIELDS} FROM item_submissions
      WHERE product_id = $1 AND item_id = $2${lock ? ' FOR NO KEY UPDATE' : ''}`,
    [product.id, product.grants[0].item],
  );
  return offer;
}

/** Apple and Google receipts can be delivered after an admin changes the price. */
export async function nativeSalePrice(db: Db, submissionId: string, purchasedAt: number) {
  const [revision] = await db.query<{ price_cents: number | null }>(
    `SELECT price_cents FROM creator_price_history WHERE submission_id = $1 AND changed_at <= $2
      ORDER BY changed_at DESC, id DESC LIMIT 1`, [submissionId, purchasedAt],
  );
  return revision?.price_cents ?? 0;
}

/** Checkout providers hold the offer and USD price at order creation. */
export async function awardCheckoutCreatorCredit(db: Db, args: {
  submissionId: string; product: Product; storePurchaseId: string; buyer: string; paidCents: number; now: number;
}) {
  const [offer] = await db.query<Offer>(
    `SELECT ${OFFER_FIELDS} FROM item_submissions WHERE id = $1 FOR NO KEY UPDATE`, [args.submissionId],
  );
  if (offer && matches(offer, args.product)) {
    await awardCreatorCredit(db, { ...args, offer, purchaseRef: `store:${args.storePurchaseId}` });
  }
}

export async function lockCreditUsers(db: Db, buyer: string, offer: Offer) {
  await db.query('SELECT id FROM users WHERE id IN ($1, $2) ORDER BY id FOR NO KEY UPDATE', [buyer, offer.submitter_user_id]);
}

export async function awardCreatorCredit(db: Db, args: {
  offer: Offer; buyer: string; purchaseRef: string; storePurchaseId?: string;
  paidCents: number; now: number;
}) {
  const { offer, buyer, purchaseRef, storePurchaseId, paidCents, now } = args;
  if (paidCents <= 0) return;
  // Only an approved item earns credit, and never on the creator's own
  // purchase. A rejected submission keeps its product link (rejection only
  // changes the status), so a still-listed store receipt would otherwise
  // keep paying out; and a creator buying their own item would get 30%
  // back on every purchase, including ones paid for with credit.
  if (offer.status !== 'approved' || buyer === offer.submitter_user_id) return;
  const cents = Math.round(paidCents * 0.3);
  const [royalty] = await db.query<{ id: string }>(
    `INSERT INTO creator_royalties
       (submission_id, creator_user_id, buyer_user_id, product_id, purchase_ref, store_purchase_id, sale_price_cents, credit_cents, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
    [offer.id, offer.submitter_user_id, buyer, offer.product_id, purchaseRef, storePurchaseId ?? null, paidCents, cents, now],
  );
  if (!royalty) return;

  await db.query(
    `WITH balance AS (
       SELECT id, LEAST(creator_credit_debt_cents, $2) AS recovered FROM users WHERE id = $1 FOR NO KEY UPDATE
     ), credited AS (
       UPDATE users u SET credit_cents = credit_cents + $2 - balance.recovered,
                          creator_credit_debt_cents = creator_credit_debt_cents - balance.recovered
        FROM balance WHERE u.id = balance.id RETURNING u.id, $2 - balance.recovered AS delta
     )
     INSERT INTO credit_ledger (user_id, kind, amount_cents, ref, created_at)
     SELECT id, 'creator_royalty', delta, $3, $4 FROM credited WHERE delta > 0`,
    [offer.submitter_user_id, cents, String(royalty.id), now],
  );
  await db.query(
    `UPDATE item_submissions SET sales_count = sales_count + 1, total_credit_earned_cents = total_credit_earned_cents + $2 WHERE id = $1`,
    [offer.id, cents],
  );
}

export async function reverseCreatorCredit(db: Db, purchaseId: string, now: number) {
  const [royalty] = await db.query<{ id: string; submission_id: string; creator_user_id: string; credit_cents: number }>(
    `UPDATE creator_royalties SET refunded_at = $2 WHERE store_purchase_id = $1 AND refunded_at IS NULL
     RETURNING id, submission_id, creator_user_id, credit_cents`, [purchaseId, now],
  );
  if (!royalty) return;
  // Use the same submission-then-user lock order as purchase grants.
  await db.query(
    `UPDATE item_submissions SET sales_count = sales_count - 1, total_credit_earned_cents = total_credit_earned_cents - $2 WHERE id = $1`,
    [royalty.submission_id, royalty.credit_cents],
  );
  await db.query(
    `WITH balance AS (
       SELECT id, LEAST(credit_cents, $2) AS reversed FROM users WHERE id = $1 FOR NO KEY UPDATE
     ), debited AS (
       UPDATE users u SET credit_cents = credit_cents - balance.reversed,
                          creator_credit_debt_cents = creator_credit_debt_cents + $2 - balance.reversed
        FROM balance WHERE u.id = balance.id RETURNING u.id, balance.reversed
     )
     INSERT INTO credit_ledger (user_id, kind, amount_cents, ref, created_at)
     SELECT id, 'creator_royalty_refund', -reversed, $3, $4 FROM debited WHERE reversed > 0`,
    [royalty.creator_user_id, royalty.credit_cents, String(royalty.id), now],
  );
}
