// Your account on beechshore (/account; docs/BEECH_BUCKS.md, "Your account on
// beechshore"): your sand-dollar balance and history, topping up by card,
// gift cards, gifting a thing from your bag, and your invite link. It
// connects with the same popup as item submissions (submissionPage.ts) and
// calls /account/api/*, which the shore site forwards to the game API's
// /shore-account/* routes (app.ts).

import { SUBMISSION_CSS } from './submissionPage.js';

const ACCOUNT_CSS = `
.account-balance{font-size:clamp(1.6rem,5vw,2.3rem);font-weight:800;margin:.2em 0}
.bucks-icon{width:1em;height:1em;margin-right:.25em;vertical-align:-.15em;border-radius:4px}
.account-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.account-row :is(input,select){padding:9px;border:1px solid var(--line2);border-radius:8px;background:var(--sand2);color:var(--ink);font:inherit;min-width:0}
.account-row input{flex:1 1 180px}
.account-packs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.account-packs .btn{justify-content:center;flex-direction:column;display:flex;text-align:center;gap:2px}
.account-packs .btn small{font-weight:500;opacity:.85}
.account-table{width:100%;border-collapse:collapse;font-size:.95rem}
.account-table td,.account-table th{padding:7px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.account-table td.amt{text-align:right;white-space:nowrap;font-weight:700}
.account-table td.amt.in{color:var(--sea-hi)}
.account-table td.when{white-space:nowrap;color:var(--ink2)}
.account-link{overflow-wrap:anywhere;font-weight:700}
.account-friends{padding-left:1.35em}
.account-status:empty{display:none}
`;

export function accountContent(config: { api: string; connect: string; game: string }) {
  const settings = JSON.stringify(config).replace(/</g, '\\u003c');
  return `<div class="submission account">
<section class="head">
  <h1>Your account</h1>
  <p>Your beech bucks (bb), what you’ve bought and traded in, gifts and invites.</p>
</section>
<section class="submission-panel" id="account-connect-panel">
  <p id="account-status" role="status">Connect your Beech account to see your balance and history.</p>
  <button class="btn" id="account-connect" type="button">Connect Beech account</button>
  <noscript>Enable JavaScript to connect your account.</noscript>
</section>
<div id="account-body" hidden>
<section class="submission-panel" id="balance">
  <h2>Balance</h2>
  <p class="account-balance" id="account-bucks"></p>
  <p class="muted" id="account-debt" hidden></p>
</section>
<section class="submission-panel" id="sign-ins">
  <h2>Connected sign-ins</h2>
  <p id="account-signins">Loading…</p>
  <p class="muted">Link another sign-in in the game’s Settings, under “connected sign-ins” — the same beaches follow you everywhere.</p>
</section>
<section class="submission-panel" id="top-up">
  <h2>Top up</h2>
  <p class="muted" id="account-topup-note"></p>
  <div class="account-packs" id="account-packs"></div>
  <p class="account-status" id="account-topup-status" role="status"></p>
</section>
<section class="submission-panel" id="gift-card">
  <h2>Redeem a gift card</h2>
  <form class="account-row" id="account-redeem">
    <input name="code" type="text" placeholder="Gift card code" autocomplete="off" aria-label="Gift card code" required>
    <button class="btn" type="submit">Redeem</button>
  </form>
  <p class="account-status" id="account-redeem-status" role="status"></p>
</section>
<section class="submission-panel" id="gift">
  <h2>Gift something</h2>
  <p class="muted">Send one thing from your bag to a friend’s beach. You need their 6-letter beach code.</p>
  <form class="account-row" id="account-gift">
    <select name="thing" aria-label="What to gift" required></select>
    <input name="code" type="text" placeholder="Their beach code" maxlength="8" autocomplete="off" aria-label="Their beach code" required>
    <button class="btn" type="submit">Send gift</button>
  </form>
  <p class="account-status" id="account-gift-status" role="status"></p>
</section>
<section class="submission-panel" id="invite">
  <h2>Invite friends</h2>
  <p id="account-invite-blurb"></p>
  <p class="account-link" id="account-invite-link"></p>
  <div class="account-row">
    <button class="btn" type="button" id="account-invite-copy">Copy link</button>
    <button class="btn ghost" type="button" id="account-invite-share">Share</button>
  </div>
  <p class="account-status" id="account-invite-status" role="status"></p>
  <p id="account-invite-count"></p>
  <ul class="account-friends" id="account-friends"></ul>
</section>
<section class="submission-panel" id="history">
  <h2>History</h2>
  <table class="account-table">
    <thead><tr><th>When</th><th>What</th><th style="text-align:right">bb</th></tr></thead>
    <tbody id="account-ledger"></tbody>
  </table>
</section>
</div>
</div>
<style>${SUBMISSION_CSS}${ACCOUNT_CSS} [hidden]{display:none!important}</style>
<script>
(() => {
  const { api, connect: connectUrl, game } = ${settings};
  const $ = (id) => document.getElementById('account-' + id);
  const KEY = 'beechshore.account.v1';
  let token = null;
  try { token = sessionStorage.getItem(KEY); } catch {}
  let popup = null;
  let data = null;
  const S = (n) => 'bb ' + n;
  const when = (t) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  function disconnect(message) {
    token = null;
    try { sessionStorage.removeItem(KEY); } catch {}
    $('body').hidden = true;
    $('connect-panel').hidden = false;
    $('connect').hidden = false;
    $('status').textContent = message;
  }
  async function call(path, method = 'GET', body) {
    const res = await fetch(api + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const out = await res.json().catch(() => ({}));
    if (res.status === 401) disconnect('Connect your Beech account again.');
    if (!res.ok) throw new Error(out.error || 'That didn’t go through. Try again.');
    return out;
  }

  // opened from the iPhone / Android / Steam app: no paying on the web here (store rules)
  const fromApp = new URLSearchParams(location.search).get('from') === 'app';
  function render() {
    const d = data;
    document.getElementById('top-up').hidden = fromApp;
    document.getElementById('gift-card').hidden = fromApp;
    $('bucks').innerHTML = '<img src="/icons/beech-bucks.webp" alt="" class="bucks-icon" width="18" height="18"> ' + d.bucks + ' beech ' + (d.bucks === 1 ? 'buck' : 'bucks');
    $('debt').hidden = !d.debt;
    $('debt').textContent = d.debt ? S(d.debt) + ' owed from a refund: the next beech bucks in pay it off first.' : '';
    // top up
    const packs = $('packs');
    packs.replaceChildren();
    $('topup-note').textContent = d.webCheckout
      ? 'Pay by card. Beech bucks work in the game on every device.'
      : 'Card payments on the web aren’t open yet. Get beech bucks in the beech app.';
    for (const p of d.packs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (p.featured ? '' : ' ghost');
      b.disabled = !d.webCheckout;
      b.dataset.pack = p.id;
      const big = document.createElement('span');
      big.textContent = S(p.bucks);
      const small = document.createElement('small');
      small.textContent = '$' + p.usd.toFixed(2) + (p.featured ? ' · best value' : '');
      b.append(big, small);
      b.addEventListener('click', () => topUp(p, b));
      packs.append(b);
    }
    // gift
    const select = $('gift').elements.thing;
    const want = select.value || new URLSearchParams(location.search).get('gift') || '';
    select.replaceChildren();
    if (!d.bag.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'Nothing in your bag to gift yet';
      select.append(o);
    }
    for (const it of d.bag) {
      const o = document.createElement('option');
      o.value = it.item;
      o.textContent = it.name + ' (' + it.owned + ')';
      select.append(o);
    }
    if (d.bag.some((it) => it.item === want)) select.value = want;
    // invites
    const inv = d.invites;
    const link = inv.code ? game + '/?invite=' + inv.code : '';
    $('invite-link').textContent = link;
    $('invite-blurb').textContent = 'When a friend makes an account through your link, you both get ' + S(inv.bonus) + ' (for your first ' + inv.cap + ' friends).';
    $('invite-count').textContent = inv.joined
      ? inv.joined + (inv.joined === 1 ? ' friend' : ' friends') + ' joined · ' + S(inv.earned) + ' earned'
      : 'No friends have joined yet.';
    const friends = $('friends');
    friends.replaceChildren();
    for (const f of inv.friends) {
      const li = document.createElement('li');
      li.textContent = f.name + ' · ' + when(f.joinedAt) + (f.bucks ? ' · +' + S(f.bucks) : '');
      friends.append(li);
    }
    // history
    const body = $('ledger');
    body.replaceChildren();
    if (!d.ledger.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = 'Nothing yet.';
      tr.append(td);
      body.append(tr);
    }
    for (const r of d.ledger) {
      const tr = document.createElement('tr');
      const a = document.createElement('td');
      a.className = 'when';
      a.textContent = when(r.at);
      const b = document.createElement('td');
      b.textContent = r.what;
      const c = document.createElement('td');
      c.className = 'amt' + (r.bucks > 0 ? ' in' : '');
      c.textContent = (r.bucks > 0 ? '+' : '−') + Math.abs(r.bucks);
      tr.append(a, b, c);
      body.append(tr);
    }
  }

  async function load() {
    data = await call('/summary');
    $('connect-panel').hidden = true;
    $('body').hidden = false;
    render();
    try {
      const ids = await call('/identities');
      const names = { google: 'Google', apple: 'Apple', steam: 'Steam' };
      $('signins').textContent = ids.identities.length
        ? 'Signed in with ' + ids.identities.map((p) => names[p] || p).join(' · ') + '.'
        : 'No sign-in linked yet.';
    } catch {
      document.getElementById('sign-ins').hidden = true;
    }
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }

  async function connected(value) {
    token = value;
    try { sessionStorage.setItem(KEY, value); } catch {}
    try {
      await load();
      await returnedFromCheckout();
    } catch (err) {
      $('connect-panel').hidden = false;
      $('status').textContent = err.message;
    }
  }

  async function topUp(p, btn) {
    btn.disabled = true;
    $('topup-status').textContent = 'Opening the secure checkout…';
    try {
      const r = await call('/top-up', 'POST', { productId: p.id, mount: location.pathname.startsWith('/shore/') ? 'game' : 'shore' });
      location.assign(r.url);
    } catch (err) {
      $('topup-status').textContent = err.message;
      btn.disabled = false;
    }
  }

  // back from Pay Station (?web_order=…): wait for the payment to land
  async function returnedFromCheckout() {
    const q = new URLSearchParams(location.search);
    const id = q.get('web_order');
    if (!id) return;
    q.delete('web_order');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + '#balance');
    $('topup-status').textContent = 'Checking your payment…';
    for (let i = 0; i < 10; i++) {
      try {
        const { order } = await call('/web-orders/' + encodeURIComponent(id));
        if (order.status === 'paid') {
          $('topup-status').textContent = 'Thank you! Your beech bucks are in.';
          await load();
          return;
        }
        if (order.status !== 'created') {
          $('topup-status').textContent = 'That payment didn’t go through.';
          return;
        }
      } catch (err) {
        $('topup-status').textContent = err.message;
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    $('topup-status').textContent = 'Your payment is still on its way. Your beech bucks will arrive when it completes.';
  }

  $('redeem').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('redeem').elements.code;
    $('redeem-status').textContent = 'Redeeming…';
    try {
      const r = await call('/redeem', 'POST', { code: input.value.trim() });
      input.value = '';
      $('redeem-status').textContent = 'Gift card redeemed: +' + S(r.credited);
      await load();
    } catch (err) {
      $('redeem-status').textContent = err.message;
    }
  });

  $('gift').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = $('gift').elements;
    if (!f.thing.value) return;
    $('gift-status').textContent = 'Sending…';
    try {
      const r = await call('/gift', 'POST', { item: f.thing.value, code: f.code.value.trim() });
      f.code.value = '';
      $('gift-status').textContent = 'Sent to ' + r.to.name + '.';
      await load();
    } catch (err) {
      $('gift-status').textContent = err.message;
    }
  });

  $('invite-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('invite-link').textContent);
      $('invite-status').textContent = 'Link copied.';
    } catch {
      $('invite-status').textContent = 'Copy the link above.';
    }
  });
  $('invite-share').addEventListener('click', async () => {
    const url = $('invite-link').textContent;
    if (navigator.share) {
      try { await navigator.share({ title: 'beech', text: (data.user.name || 'A friend') + ' invited you to beech 🏖️', url }); } catch {}
    } else {
      $('invite-copy').click();
    }
  });

  const connectOrigin = new URL(connectUrl, location.href).origin;
  window.addEventListener('message', (event) => {
    if (event.origin !== connectOrigin || event.source !== popup || event.data?.type !== 'beech-item-submission') return;
    if (typeof event.data.token !== 'string') return;
    popup.close();
    popup = null;
    void connected(event.data.token);
  });
  $('connect').addEventListener('click', () => {
    if (popup && !popup.closed) { popup.focus(); return; }
    popup = window.open(connectUrl, '_blank', 'popup,width=520,height=540');
    $('status').textContent = popup
      ? 'Finish connecting in the Beech window.'
      : 'Allow pop-ups for this page and try connecting again.';
  });

  if (token) void connected(token);
})();
</script>`;
}
