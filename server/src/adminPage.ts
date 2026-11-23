// The admin console, served at /admin (server.ts). A small page of its own,
// not part of the beach app: it signs in with Google, swaps the credential
// for a beech session, and talks to /api/admin. The API decides who is an
// admin; this page shows a flat denial to anyone who isn't, and never
// renders a gift card code except once, right after it is issued (the
// server never returns codes again).

export function adminPageHtml(googleClientId: string | null): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>beech admin</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #1c2b33; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; border-top: 1px solid #ddd; padding-top: 1rem; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin: .5rem 0; }
  label { display: block; margin: .4rem 0; } label span { display: inline-block; min-width: 7rem; }
  input, select, button { font: inherit; padding: .35rem .5rem; }
  button { cursor: pointer; }
  .row { display: flex; gap: .5rem; align-items: baseline; flex-wrap: wrap; }
  .muted { color: #666; font-size: .9rem; }
  .code { font: 1.2rem ui-monospace, monospace; background: #f4f4f4; padding: .5rem; border-radius: 4px; word-break: break-all; }
  .warn { background: #fff4d6; border: 1px solid #e6c200; padding: .6rem; border-radius: 4px; }
  .err { color: #a00; } .ok { color: #060; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; } td, th { border-bottom: 1px solid #eee; padding: .3rem; text-align: left; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<h1>beech admin</h1>
<p class="muted">Gift cards, promo codes and redemptions. Only the allowlisted Google account can use this page.</p>

<div id="signin">
  <div id="gsi"></div>
  <p id="signin-err" class="err" hidden></p>
  <p id="signin-note" class="muted" hidden>Google sign-in is not configured on this server.</p>
</div>

<div id="denied" hidden>
  <p class="err">This Google account isn't an admin.</p>
  <p><button id="signout1" type="button">Sign out</button></p>
</div>

<div id="console" hidden>
  <p>Signed in as <b id="who"></b> <button id="signout2" type="button">Sign out</button></p>
  <p id="msg" class="muted" role="status"></p>

  <h2>Issue a gift card</h2>
  <form id="gift-form">
    <label><span>Amount ($)</span><input name="amount" type="number" min="0.5" max="1000" step="0.01" required></label>
    <label><span>Expires</span><input name="expires" type="date"></label>
    <label><span>Note</span><input name="note" type="text" maxlength="200" placeholder="who it's for"></label>
    <button type="submit">Issue gift card</button>
  </form>
  <div id="gift-new" hidden>
    <p class="warn">Save this code now — it is shown once and never again. Anyone with it can redeem the card.</p>
    <p class="code" id="gift-code"></p>
    <p><button id="gift-copy" type="button">Copy code</button> <span id="gift-amount" class="muted"></span></p>
  </div>

  <h2>Gift cards</h2>
  <div id="gift-list"><p class="muted">Loading…</p></div>

  <h2>New promo code</h2>
  <form id="promo-form">
    <label><span>Code</span><input name="code" type="text" required minlength="3" maxlength="32" placeholder="LAUNCH20"></label>
    <label><span>Kind</span><select name="kind"><option value="percent">Percent off</option><option value="fixed">Fixed amount off</option></select></label>
    <label><span>Value</span><input name="value" type="number" min="1" step="1" required placeholder="20 = 20% or 200 = $2.00"></label>
    <label><span>Product</span><select name="appliesTo"><option value="">Any product</option></select></label>
    <label><span>Max uses</span><input name="maxUses" type="number" min="1" step="1" placeholder="unlimited"></label>
    <label><span>Expires</span><input name="expires" type="date"></label>
    <button type="submit">Create promo code</button>
  </form>

  <h2>Promo codes</h2>
  <div id="promo-list"><p class="muted">Loading…</p></div>

  <h2>Redemptions</h2>
  <div id="redemptions"><p class="muted">Loading…</p></div>
</div>

<script src="https://accounts.google.com/gsi/client" async defer></script>
<script>
const $ = (id) => document.getElementById(id);
const token = () => sessionStorage.getItem('beech-admin-token');
const api = async (path, init) => {
  const res = await fetch(path, { ...init, headers: { ...(init && init.headers), ...(token() ? { Authorization: 'Bearer ' + token() } : {}) } });
  let body = null;
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error((body && body.error) || ('request failed (' + res.status + ')'));
  return body;
};
const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
const money = (c) => '$' + (c / 100).toFixed(2);
const when = (ms) => ms == null ? '—' : new Date(ms).toLocaleString();
const say = (text, ok) => { const m = $('msg'); m.textContent = text; m.className = ok ? 'ok' : 'muted'; };

async function signIn(credential) {
  try {
    const { token: t } = await api('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
    sessionStorage.setItem('beech-admin-token', t);
    await enter();
  } catch (e) { $('signin-err').hidden = false; $('signin-err').textContent = e.message; }
}

async function enter() {
  try {
    const me = await api('/api/admin/me');
    $('signin').hidden = true; $('denied').hidden = true; $('console').hidden = false;
    $('who').textContent = me.email || me.via;
    await refreshAll();
  } catch (e) {
    $('signin').hidden = true; $('console').hidden = true; $('denied').hidden = false;
  }
}

function signOut() {
  sessionStorage.removeItem('beech-admin-token');
  $('console').hidden = true; $('denied').hidden = true; $('signin').hidden = false;
  location.reload();
}

async function refreshAll() {
  const [cards, promos, red, products] = await Promise.all([
    api('/api/admin/gift-cards'), api('/api/admin/promo-codes'), api('/api/admin/redemptions'), api('/api/store/products'),
  ]);
  renderGifts(cards.giftCards);
  renderPromos(promos.promos);
  renderRedemptions(red);
  const sel = document.querySelector('#promo-form select[name=appliesTo]');
  sel.querySelectorAll('option[value!=""]').forEach((o) => o.remove());
  for (const p of products.products) {
    const o = document.createElement('option'); o.value = p.id; o.textContent = p.name + ' (' + money(Math.round(p.usd * 100)) + ')';
    sel.appendChild(o);
  }
}

function renderGifts(list) {
  const el = $('gift-list');
  if (!list.length) { el.innerHTML = '<p class="muted">No gift cards yet.</p>'; return; }
  el.innerHTML = '<table><tr><th>Amount</th><th>Status</th><th>Issued</th><th>Expires</th><th>Redeemed by</th><th></th></tr>' +
    list.map((g) => '<tr><td>' + money(g.amountCents) + '</td><td>' + esc(g.status) + '</td><td>' + when(g.issuedAt) + '</td><td>' + when(g.expiresAt) + '</td><td>' + esc(g.redeemedBy || '—') + (g.note ? ' · ' + esc(g.note) : '') + '</td>' +
      (g.status === 'active' ? '<td><button type="button" data-disable-gift="' + esc(g.id) + '">Disable</button></td>' : '<td></td>') + '</tr>').join('') + '</table>';
  el.querySelectorAll('[data-disable-gift]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/api/admin/gift-cards/' + encodeURIComponent(b.dataset.disableGift) + '/disable', { method: 'POST' }); say('Gift card disabled.', true); await refreshAll(); }
    catch (e) { say(e.message); }
  }));
}

function renderPromos(list) {
  const el = $('promo-list');
  if (!list.length) { el.innerHTML = '<p class="muted">No promo codes yet.</p>'; return; }
  el.innerHTML = '<table><tr><th>Code</th><th>Off</th><th>For</th><th>Uses</th><th>Active</th><th>Expires</th><th></th></tr>' +
    list.map((p) => '<tr><td><b>' + esc(p.code) + '</b></td><td>' + (p.kind === 'percent' ? p.value + '%' : money(p.value)) + '</td><td>' + esc(p.appliesTo || 'any') + '</td><td>' + p.uses + (p.maxUses ? ' / ' + p.maxUses : '') + '</td><td>' + (p.active ? 'yes' : 'no') + '</td><td>' + when(p.expiresAt) + '</td>' +
      (p.active ? '<td><button type="button" data-disable-promo="' + esc(p.code) + '">Disable</button></td>' : '<td></td>') + '</tr>').join('') + '</table>';
  el.querySelectorAll('[data-disable-promo]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/api/admin/promo-codes/' + encodeURIComponent(b.dataset.disablePromo) + '/disable', { method: 'POST' }); say('Promo code disabled.', true); await refreshAll(); }
    catch (e) { say(e.message); }
  }));
}

function renderRedemptions(red) {
  const el = $('redemptions');
  const giftRows = red.giftCards.map((g) => '<tr><td>Gift card</td><td>' + money(g.amountCents) + '</td><td>' + esc(g.redeemedBy || '') + '</td><td>' + when(g.redeemedAt) + '</td></tr>').join('');
  const promoRows = red.promoUses.map((p) => '<tr><td>Promo ' + esc(p.code) + '</td><td>−' + money(p.discountCents) + ' on ' + esc(p.productId) + '</td><td>' + esc(p.user || '') + '</td><td>' + when(p.usedAt) + '</td></tr>').join('');
  const creditRows = red.credit.map((l) => '<tr><td>Credit ' + esc(l.kind) + '</td><td>' + (l.amountCents >= 0 ? '+' : '−') + money(Math.abs(l.amountCents)) + ' (' + esc(l.ref) + ')</td><td>' + esc(l.user || '') + '</td><td>' + when(l.createdAt) + '</td></tr>').join('');
  const rows = giftRows + promoRows + creditRows;
  el.innerHTML = rows ? '<table><tr><th>What</th><th>Amount</th><th>Who</th><th>When</th></tr>' + rows + '</table>' : '<p class="muted">Nothing redeemed yet.</p>';
}

$('gift-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const expires = f.get('expires') ? new Date(f.get('expires') + 'T23:59:59').getTime() : null;
  try {
    const g = await api('/api/admin/gift-cards', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents: Math.round(Number(f.get('amount')) * 100), expiresAt: expires, note: f.get('note') }) });
    $('gift-new').hidden = false;
    $('gift-code').textContent = g.code;
    $('gift-amount').textContent = g.amount + ' gift card';
    say('Gift card issued. Save the code — it will not be shown again.', true);
    e.target.reset();
    await refreshAll();
  } catch (err) { say(err.message); }
});

$('gift-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('gift-code').textContent); say('Code copied.', true); }
  catch { say('Copy failed — select the code and copy it by hand.'); }
});

$('promo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const expires = f.get('expires') ? new Date(f.get('expires') + 'T23:59:59').getTime() : null;
  try {
    await api('/api/admin/promo-codes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: f.get('code'), kind: f.get('kind'), value: Number(f.get('value')),
        appliesTo: f.get('appliesTo') || null, maxUses: f.get('maxUses') ? Number(f.get('maxUses')) : null, expiresAt: expires }) });
    say('Promo code created.', true);
    e.target.reset();
    await refreshAll();
  } catch (err) { say(err.message); }
});

$('signout1').addEventListener('click', signOut);
$('signout2').addEventListener('click', signOut);

window.addEventListener('load', async () => {
  const clientId = ${JSON.stringify(googleClientId)};
  if (token()) { await enter(); return; }
  if (!clientId) { $('signin-note').hidden = false; return; }
  const render = () => {
    window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => void signIn(r.credential) });
    window.google.accounts.id.renderButton($('gsi'), { theme: 'outline', size: 'large', text: 'signin_with' });
  };
  if (window.google && window.google.accounts) render();
  else { const t = setInterval(() => { if (window.google && window.google.accounts) { clearInterval(t); render(); } }, 200); }
});
</script>
</body>
</html>`;
}
