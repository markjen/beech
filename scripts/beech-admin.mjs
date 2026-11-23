#!/usr/bin/env node
// beech admin CLI: the same admin operations as the /admin console, from a
// terminal. See docs/GIFT_CARDS_PROMOS.md.
//
//   beech-admin.mjs gift-card issue --amount 9.99 [--expires 2027-06-01] [--note "for Ana"]
//   beech-admin.mjs gift-card list
//   beech-admin.mjs gift-card disable <id>
//   beech-admin.mjs promo create --code LAUNCH20 --percent 20 [--product beach_1] [--max-uses 100] [--expires 2027-01-01]
//   beech-admin.mjs promo create --code WELCOME2 --fixed-cents 200
//   beech-admin.mjs promo list
//   beech-admin.mjs promo disable <code>
//   beech-admin.mjs redemptions
//   beech-admin.mjs whoami
//
// Authentication: the CLI proves it is Mark with the admin API token —
//   BEECH_ADMIN_TOKEN env var, or --token. The token is never written to
//   disk by this tool and never appears in its output. Create one in Secret
//   Manager (ADMIN_API_TOKEN on the server) and hand it to the CLI through
//   the environment; rotate it by replacing the secret and restarting the
//   service. There is no fallback: without a valid token every command
//   fails, and DEV_AUTH never counts.
// The API base is BEECH_API_URL (default http://localhost:8080), or --api.

const usage = `usage:
  beech-admin.mjs gift-card issue --amount <dollars> [--expires YYYY-MM-DD] [--note "..."]
  beech-admin.mjs gift-card list
  beech-admin.mjs gift-card disable <id>
  beech-admin.mjs promo create --code <CODE> (--percent <1-100> | --fixed-cents <cents>) [--product <id>] [--max-uses <n>] [--expires YYYY-MM-DD]
  beech-admin.mjs promo list
  beech-admin.mjs promo disable <CODE>
  beech-admin.mjs redemptions
  beech-admin.mjs whoami

env: BEECH_ADMIN_TOKEN (required), BEECH_API_URL (default http://localhost:8080)`;

const die = (msg) => {
  console.error(`beech-admin: ${msg}`);
  process.exit(1);
};

/** `--key value` and `--key=value`, plus positionals. */
function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 2) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length) flags[a.slice(2)] = argv[++i];
      else die(`missing value for ${a}`);
    } else pos.push(a);
  }
  return { flags, pos };
}

const { flags, pos } = parseArgs(process.argv.slice(2));
const token = flags.token ?? process.env.BEECH_ADMIN_TOKEN;
if (!token) die('no admin token: set BEECH_ADMIN_TOKEN or pass --token');
const base = (flags.api ?? process.env.BEECH_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');

async function call(path, method = 'GET', body) {
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    die(`could not reach ${base}: ${e.message}`);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) die(data?.error ?? `request failed (${res.status})`);
  return data;
}

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const when = (ms) => (ms == null ? '—' : new Date(ms).toLocaleString());
const toExpiry = (d) => (d ? new Date(`${d}T23:59:59`).getTime() : null);

const [group, cmd, arg] = pos;

if (group === 'whoami') {
  const me = await call('/api/admin/me');
  console.log(`admin: yes, via ${me.via}${me.email ? ` (${me.email})` : ''}`);
} else if (group === 'gift-card' && cmd === 'issue') {
  const amount = Number(flags.amount);
  if (!Number.isFinite(amount) || amount <= 0) die('--amount <dollars> is required');
  const g = await call('/api/admin/gift-cards', 'POST', {
    amountCents: Math.round(amount * 100),
    expiresAt: toExpiry(flags.expires),
    note: flags.note ?? '',
  });
  // The code is returned once. Print it clearly, and say so: it will
  // never be shown again, and it is not stored anywhere but the database
  // (as a hash).
  console.log(`gift card issued: ${g.amount} (id ${g.id})`);
  console.log(`code: ${g.code}`);
  console.log('Save this code now — it is shown once and never again.');
} else if (group === 'gift-card' && cmd === 'list') {
  const { giftCards } = await call('/api/admin/gift-cards');
  if (!giftCards.length) console.log('no gift cards yet');
  for (const g of giftCards) {
    console.log(`${g.id}  ${money(g.amountCents)}  ${g.status}  issued ${when(g.issuedAt)}  expires ${when(g.expiresAt)}${g.redeemedBy ? `  redeemed by ${g.redeemedBy}` : ''}${g.note ? `  — ${g.note}` : ''}`);
  }
} else if (group === 'gift-card' && cmd === 'disable') {
  if (!arg) die('gift-card disable needs an id');
  await call(`/api/admin/gift-cards/${encodeURIComponent(arg)}/disable`, 'POST');
  console.log(`gift card ${arg} disabled`);
} else if (group === 'promo' && cmd === 'create') {
  const code = flags.code;
  if (!code) die('--code is required');
  const kind = flags.percent ? 'percent' : flags['fixed-cents'] ? 'fixed' : null;
  if (!kind) die('give --percent <1-100> or --fixed-cents <cents>');
  const value = Number(flags.percent ?? flags['fixed-cents']);
  const p = await call('/api/admin/promo-codes', 'POST', {
    code,
    kind,
    value,
    appliesTo: flags.product ?? null,
    maxUses: flags['max-uses'] ? Number(flags['max-uses']) : null,
    expiresAt: toExpiry(flags.expires),
  });
  console.log(`promo ${p.promo.code} created: ${kind === 'percent' ? `${value}% off` : `${money(value)} off`}${p.promo.appliesTo ? ` on ${p.promo.appliesTo}` : ''}${p.promo.maxUses ? `, max ${p.promo.maxUses} uses` : ''}`);
} else if (group === 'promo' && cmd === 'list') {
  const { promos } = await call('/api/admin/promo-codes');
  if (!promos.length) console.log('no promo codes yet');
  for (const p of promos) {
    console.log(`${p.code}  ${p.kind === 'percent' ? `${p.value}%` : money(p.value)}  ${p.appliesTo ?? 'any product'}  uses ${p.uses}${p.maxUses ? `/${p.maxUses}` : ''}  ${p.active ? 'active' : 'disabled'}  expires ${when(p.expiresAt)}`);
  }
} else if (group === 'promo' && cmd === 'disable') {
  if (!arg) die('promo disable needs a code');
  await call(`/api/admin/promo-codes/${encodeURIComponent(arg)}/disable`, 'POST');
  console.log(`promo ${arg} disabled`);
} else if (group === 'redemptions') {
  const r = await call('/api/admin/redemptions');
  console.log('gift cards redeemed:');
  for (const g of r.giftCards) console.log(`  ${money(g.amountCents)} by ${g.redeemedBy ?? '?'} at ${when(g.redeemedAt)}${g.note ? ` — ${g.note}` : ''}`);
  console.log('promo uses:');
  for (const p of r.promoUses) console.log(`  ${p.code}: -${money(p.discountCents)} on ${p.productId} by ${p.user ?? '?'} at ${when(p.usedAt)}`);
  console.log('credit movements:');
  for (const l of r.credit) console.log(`  ${l.kind} ${l.amountCents >= 0 ? '+' : ''}${money(l.amountCents)} (${l.ref}) by ${l.user ?? '?'} at ${when(l.createdAt)}`);
} else {
  console.error(usage);
  process.exit(1);
}
