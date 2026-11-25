import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

import { hashToken, newSessionToken } from './auth.js';
import type { Db } from './db.js';
import { productById } from './products.js';
import { badSubmission, readAsset, readPreview, UPLOAD_LIMIT } from './submissionAssets.js';

export const TERMS_VERSION = '2026-11-24';
export const SUBMISSION_TERMS = [
  'I own or control all rights needed to submit this item, including its assets, preview and underlying intellectual property.',
  'By uploading, I grant Mark Jen (Jenerator Labs) an unlimited, perpetual, irrevocable, worldwide, nonexclusive, transferable, sublicensable license to use, copy, modify, create derivative works from, publish, distribute, and commercially exploit my submission, its assets and intellectual property in any medium.',
  'Beech may approve or reject the submission and may change the item, its availability or price at its sole discretion without further permission.',
  'I earn 30% in Beech account credit when an approved, priced item is sold. Credit is for use within Beech and cannot be cashed out. Refunded sales reverse their credit.',
];

export const BEHAVIORS = ['fixed', 'tumble', 'float', 'rock'] as const;
export const FREQUENCIES = ['shop', 'limited', 'common', 'uncommon', 'rare', 'legendary', 'unique'] as const;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DAY = 86_400_000;

export const limitUpload = bodyLimit({
  maxSize: UPLOAD_LIMIT,
  onError: (c) => c.json({ error: 'The upload is too large.' }, 413),
});

export async function multipart(req: Request): Promise<FormData> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;')) {
    return badSubmission('Expected a multipart form.');
  }
  try {
    return await req.formData();
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    return badSubmission('The upload could not be read.');
  }
}

function field(form: FormData, key: string, limit: number, required = false): string {
  const val = form.get(key) ?? '';
  if (typeof val !== 'string' || val.length > limit || val.includes('\0') || (required && !val.trim())) {
    return badSubmission(`Enter a valid ${key} (up to ${limit} characters).`);
  }
  return val.trim();
}

function choice<T extends string>(value: string, values: readonly T[], label: string): T {
  const selected = values.find((v) => v === value);
  return selected ?? badSubmission(`Choose a valid ${label}.`);
}

function numberField(form: FormData, name: string, min: number, max: number): number {
  const raw = field(form, name, 16, true);
  const n = Number(raw);
  if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(n) || n < min || n > max) {
    return badSubmission(`Enter ${name} between ${min} and ${max}.`);
  }
  return n;
}

function itemFields(form: FormData) {
  const name = field(form, 'name', 80, true);
  const slug = field(form, 'slug', 40, true);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) badSubmission('Use lowercase letters, numbers and single hyphens for the item slug.');
  const description = field(form, 'description', 1500);
  const behavior = choice(field(form, 'behavior', 16), BEHAVIORS, 'behavior');
  const sizeMin = numberField(form, 'sizeMin', 0.01, 8);
  const sizeMax = numberField(form, 'sizeMax', sizeMin, 8);
  const fixedSize = form.get('fixedSize') === 'true';
  if (fixedSize && sizeMin !== sizeMax) badSubmission('Use the same minimum and maximum for a fixed-size item.');
  return { name, slug, description, behavior, sizeMin, sizeMax, fixedSize, frequencyNote: field(form, 'frequencyNote', 500) };
}

function cents(form: FormData, key: string, required: true): number;
function cents(form: FormData, key: string, required?: false): number | null;
function cents(form: FormData, key: string, required = false): number | null {
  const raw = field(form, key, 10, required);
  if (!raw) return null;
  const max = required ? 99_999 : 2_147_483_647;
  const price = Number(raw);
  if (!/^\d+$/.test(raw) || price > max) return badSubmission(`Enter a price as a whole number of cents from 0 to ${max}.`);
  return price;
}

export async function createItemSubmission(db: Db, userId: string, form: FormData, now: number) {
  if (form.get('termsAccepted') !== 'true' || form.get('termsVersion') !== TERMS_VERSION) {
    return badSubmission('Read and accept the current submission terms before uploading.');
  }
  const item = itemFields(form);
  const price = cents(form, 'priceCents', true);
  const frequency = choice(field(form, 'frequency', 16), FREQUENCIES, 'frequency');
  const asset = await readAsset(form.get('asset'));
  const preview = await readPreview(form.get('preview'));
  const id = crypto.randomUUID();
  await db.withTransaction(async (tx) => {
    const [user] = await tx.query<{ neighbor_code: string }>('SELECT neighbor_code FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!user) throw new HTTPException(401, { message: 'Connect your Beech account again.' });
    const [limit] = await tx.query('SELECT 1 FROM item_submissions WHERE submitter_user_id = $1 AND created_at > $2 LIMIT 1 OFFSET 9', [userId, now - DAY]);
    if (limit) throw new HTTPException(429, { message: 'You can submit up to 10 items per day.' });
    await tx.query(
      `INSERT INTO item_submissions (
        id, submitter_user_id, submitter_beach_code, name, slug, description, behavior, size_min, size_max,
        fixed_size, proposed_price_cents, proposed_frequency, frequency_note, asset_format, asset_filename, asset_mime,
        asset_bytes, asset_size, asset_summary, preview_mime, preview_bytes, terms_accepted, terms_version,
        terms_accepted_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,true,$22,$23,$23,$23)`,
      [id, userId, user.neighbor_code, item.name, item.slug, item.description, item.behavior, item.sizeMin, item.sizeMax,
        item.fixedSize, price, frequency, item.frequencyNote, asset.format, asset.filename, asset.mime, asset.bytes,
        asset.bytes.length, JSON.stringify(asset.summary), preview?.mime ?? null, preview?.bytes ?? null, TERMS_VERSION, now],
    );
  });
  return id;
}

export async function issueSubmissionSession(db: Db, sessionHash: string) {
  const token = newSessionToken();
  const now = Date.now();
  await db.query('DELETE FROM item_submission_sessions WHERE expires_at <= $1', [now]);
  const issued = await db.query(
    `INSERT INTO item_submission_sessions (token_hash, session_hash, expires_at)
     SELECT $1, token_hash, LEAST(expires_at, $3) FROM sessions WHERE token_hash = $2 AND expires_at > $4
     RETURNING 1`,
    [await hashToken(token), sessionHash, now + 3600000, now],
  );
  if (!issued.length) throw new HTTPException(401, { message: 'Connect your Beech account again.' });
  return token;
}

export const requireSubmissionSession = (db: Db) => createMiddleware<{ Variables: { submitter: { id: string; name: string } } }>(
  async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const token = /^Bearer (\S+)$/.exec(c.req.header('Authorization') ?? '')?.[1] ?? '';
    if (!TOKEN_PATTERN.test(token)) return c.json({ error: 'Connect your Beech account.' }, 401);
    const [submitter] = await db.query<{ id: string; name: string }>(
      `SELECT u.id, u.name FROM item_submission_sessions i JOIN sessions s ON s.token_hash = i.session_hash
       JOIN users u ON u.id = s.user_id WHERE i.token_hash = $1 AND i.expires_at > $2 AND s.expires_at > $2`,
      [await hashToken(token), Date.now()],
    );
    if (!submitter) return c.json({ error: 'Connect your Beech account again.' }, 401);
    c.set('submitter', submitter);
    await next();
  },
);

export function creatorSubmissions(db: Db, userId: string) {
  return db.query(
    `SELECT id, name, status, approved_item->>'name' AS approved_name, approved_price_cents, for_sale, approved_frequency,
            sales_count, total_credit_earned_cents, created_at
       FROM item_submissions WHERE submitter_user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`,
    [userId],
  );
}

export function adminSubmissions(db: Db, status: string, offset: number) {
  return db.query(
    `SELECT id, name, status, submitter_beach_code, proposed_price_cents, proposed_frequency, created_at
       FROM item_submissions WHERE status = $1 ORDER BY created_at DESC, id DESC LIMIT 26 OFFSET $2`,
    [status, offset],
  );
}

export const adminSubmission = async (db: Db, id: string) => (await db.query(
  `SELECT id, submitter_beach_code, name, slug, description, behavior, size_min, size_max, fixed_size,
          proposed_price_cents, proposed_frequency, frequency_note, asset_format, asset_filename, asset_size,
          asset_summary, (preview_bytes IS NOT NULL) AS has_preview, terms_version, terms_accepted_at,
          status, approved_price_cents, for_sale, approved_frequency, approved_item, product_id, item_id, replacement_filename,
          admin_note, sales_count, total_credit_earned_cents, reviewed_by, reviewed_at
     FROM item_submissions WHERE id = $1`, [id],
))[0];

export const eligibleProduct = (id: string) => {
  const product = productById(id);
  return product?.grants.length === 1 && product.grants[0].item !== 'beach' ? product : undefined;
};

export async function reviewSubmission(db: Db, id: string, form: FormData, actor: string, now: number) {
  const status = choice(field(form, 'status', 16, true), ['approved', 'rejected'] as const, 'decision');
  const adminNote = field(form, 'adminNote', 1500);
  const previous = (await db.query<{ product_id: string | null; item_id: string | null }>('SELECT product_id, item_id FROM item_submissions WHERE id = $1 FOR UPDATE', [id]))[0];
  if (!previous) throw new HTTPException(404, { message: 'No such submission.' });

  if (status === 'rejected') {
    await db.query(
      `UPDATE item_submissions SET status = $2, admin_note = $3, reviewed_by = $4, reviewed_at = $5, updated_at = $5
       WHERE id = $1`, [id, status, adminNote, actor, now],
    );
    if (previous.product_id) await db.query(
      'INSERT INTO creator_price_history (submission_id, price_cents, changed_at) VALUES ($1, NULL, $2)', [id, now],
    );
    return { status };
  }

  const item = itemFields(form);
  const price = cents(form, 'priceCents');
  const forSale = form.get('notForSale') !== 'true';
  const frequency = choice(field(form, 'frequency', 16), FREQUENCIES, 'frequency');
  const requestedProduct = field(form, 'productId', 80);
  const productId = requestedProduct || previous.product_id;
  const requestedItem = field(form, 'itemId', 40);
  const itemId = requestedItem || previous.item_id;
  if (previous.product_id && (productId !== previous.product_id || itemId !== previous.item_id)) {
    return badSubmission('This submission is already linked to a product.');
  }
  if (productId || itemId) {
    if (!productId || !/^item_[a-z0-9][a-z0-9_.]{0,63}$/.test(productId) ||
        !itemId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(itemId)) {
      return badSubmission('Link a single item SKU and its catalog item ID.');
    }
    if (productById(productId) && eligibleProduct(productId)?.grants[0].item !== itemId) {
      return badSubmission('The catalog product must grant the linked item.');
    }
  }
  if (productId && forSale && price === null) {
    return badSubmission('Enter a price (0 for free), or mark it not for sale.');
  }
  const file = form.get('replacement');
  const replacement = file && (typeof file === 'string' || file.size || file.name) ? await readAsset(file) : null;

  try {
    await db.query(
      `UPDATE item_submissions SET status = $2, approved_item = $3, approved_price_cents = $4, approved_frequency = $5,
         product_id = $6, item_id = $7,
         replacement_filename = COALESCE($9, replacement_filename), replacement_bytes = COALESCE($10, replacement_bytes),
         admin_note = $11, reviewed_by = $12, reviewed_at = $8, updated_at = $8, for_sale = $13
       WHERE id = $1`,
      [id, status, JSON.stringify(item), price, frequency, productId, itemId, now,
        replacement?.filename ?? null, replacement?.bytes ?? null, adminNote, actor, forSale],
    );
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new HTTPException(409, { message: 'That product is already linked to a submission.' });
    throw err;
  }
  if (productId) await db.query(
    'INSERT INTO creator_price_history (submission_id, price_cents, changed_at) VALUES ($1, $2, $3)',
    // royalties on app-store receipts price from here; free and off-sale earn none
    [id, forSale && price ? price : null, now],
  );
  return { status, price, forSale, frequency, productId, itemId };
}
