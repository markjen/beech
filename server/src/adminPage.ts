// The admin console's two pages (adminApp.ts serves them at /):
//   - adminSignInHtml: all anyone gets until they sign in. A Google button
//     and nothing else: no console code, no API paths beyond /auth/google.
//   - adminConsoleHtml: only for a signed-in admin. Beaches, gift cards,
//     promo codes, redemptions and the audit log.
// Both run under a nonce-based Content-Security-Policy, so every <script>
// and <style> carries the nonce and there are no inline handlers or style
// attributes. A gift card code is rendered once, right after it is issued
// (the server never returns codes again).

import { BEHAVIORS, FREQUENCIES } from './itemSubmissions.js';

const options = (values: readonly string[]) => values.map((value) => `<option>${value}</option>`).join('');

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** a value for an inline <script>: JSON that can't close the tag */
const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

const STYLE = `
  :root { color-scheme: light; --line: #dde3e6; --muted: #5f6b72; --ink: #1c2b33; --accent: #0b6e8a; --bad: #a40000; --good: #106010; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; color: var(--ink); background: #f7f9fa; }
  header { display: flex; align-items: center; gap: 1rem; padding: .7rem 1rem; background: #fff; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  header h1 { font-size: 1.1rem; margin: 0; }
  header .who { margin-left: auto; color: var(--muted); font-size: .9rem; }
  nav { display: flex; gap: .25rem; flex-wrap: wrap; }
  nav button { border: 0; background: none; padding: .4rem .7rem; border-radius: 6px; cursor: pointer; font: inherit; color: var(--muted); }
  nav button[aria-selected=true] { background: #e5f1f5; color: var(--accent); font-weight: 600; }
  main { max-width: 1100px; margin: 0 auto; padding: 1rem; }
  h2 { font-size: 1.05rem; margin: 1.5rem 0 .5rem; }
  .panel { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 1rem; margin: .75rem 0; overflow-x: auto; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: .5rem; }
  .stat { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: .6rem .8rem; }
  .stat b { display: block; font-size: 1.3rem; }
  .stat span { color: var(--muted); font-size: .85rem; }
  label { display: block; margin: .4rem 0; } label > span { display: inline-block; min-width: 7rem; }
  input, select, textarea, button { font: inherit; padding: .35rem .55rem; border: 1px solid #c5ced3; border-radius: 6px; background: #fff; }
  .submission-review label { display:flex; align-items:baseline; gap:.5rem; flex-wrap:wrap; }
  .submission-review :is(input:not([type=checkbox]), select, textarea) { width:min(100%, 27rem); }
  .submission-review dt { font-weight:600; }
  .submission-review dd { margin:0 0 .6rem; overflow-wrap:anywhere; }
  button { cursor: pointer; } button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  button.danger { color: var(--bad); border-color: #e3b5b5; }
  .row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
  .row input[type=search] { flex: 1 1 220px; min-width: 0; }
  .muted { color: var(--muted); font-size: .9rem; }
  .code { font: 1.2rem ui-monospace, monospace; background: #f1f4f5; padding: .5rem; border-radius: 4px; word-break: break-all; }
  .mono { font-family: ui-monospace, monospace; }
  .warn { background: #fff4d6; border: 1px solid #e6c200; padding: .6rem; border-radius: 6px; }
  .err { color: var(--bad); } .ok { color: var(--good); }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  td, th { border-bottom: 1px solid #eef1f2; padding: .35rem .4rem; text-align: left; vertical-align: top; }
  tr.pick { cursor: pointer; } tr.pick:hover { background: #f3f8fa; } tr.sel { background: #e5f1f5; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .2rem .8rem; margin: 0; } dt { color: var(--muted); }
  .tag { display: inline-block; font-size: .75rem; padding: 0 .4rem; border-radius: 4px; background: #eef1f2; color: var(--muted); }
  .tag.off { background: #fbe3e3; color: var(--bad); }
  [hidden] { display: none !important; }
  @media (max-width: 640px) { header .who { margin-left: 0; width: 100%; } }
`;

export function adminSignInHtml(opts: { nonce: string; googleClientId: string | null }): string {
  const n = esc(opts.nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>beech admin sign-in</title>
<style nonce="${n}">${STYLE}
  .signin { max-width: 380px; margin: 12vh auto; background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 1.5rem; text-align: center; }
  .signin h1 { font-size: 1.2rem; margin: 0 0 .5rem; }
  #gsi { display: flex; justify-content: center; margin: 1rem 0; min-height: 44px; }
</style>
</head>
<body>
<div class="signin">
  <h1>beech admin</h1>
  <p class="muted">Sign in with the admin Google account.</p>
  <div id="gsi"></div>
  <p id="err" class="err" role="alert" hidden></p>
  <p id="off" class="muted" hidden>Google sign-in is not configured on this server.</p>
</div>
<script nonce="${n}" src="https://accounts.google.com/gsi/client" async defer></script>
<script nonce="${n}">
const clientId = ${js(opts.googleClientId)};
const err = document.getElementById('err');
async function signIn(credential) {
  err.hidden = true;
  const res = await fetch('/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Beech-Admin': '1' }, body: JSON.stringify({ credential }) });
  if (res.ok) { location.reload(); return; }
  err.hidden = false;
  err.textContent = res.status === 403 ? "This Google account isn't an admin." : 'Sign-in failed. Try again.';
  if (window.google) window.google.accounts.id.disableAutoSelect();
}
window.addEventListener('load', () => {
  if (!clientId) { document.getElementById('off').hidden = false; return; }
  const render = () => {
    window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => void signIn(r.credential), auto_select: false });
    window.google.accounts.id.renderButton(document.getElementById('gsi'), { theme: 'outline', size: 'large', text: 'signin_with' });
  };
  if (window.google && window.google.accounts) render();
  else { const t = setInterval(() => { if (window.google && window.google.accounts) { clearInterval(t); render(); } }, 200); }
});
</script>
</body>
</html>`;
}

export function adminConsoleHtml(opts: { nonce: string; email: string; appUrl: string | null }): string {
  const n = esc(opts.nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>beech admin</title>
<style nonce="${n}">${STYLE}</style>
</head>
<body>
<header>
  <h1>beech admin</h1>
  <nav role="tablist">
    <button type="button" role="tab" data-tab="beaches" aria-selected="true">Beaches</button>
    <button type="button" role="tab" data-tab="submissions" aria-selected="false">Item submissions</button>
    <button type="button" role="tab" data-tab="gifts" aria-selected="false">Gift cards</button>
    <button type="button" role="tab" data-tab="promos" aria-selected="false">Promo codes</button>
    <button type="button" role="tab" data-tab="redemptions" aria-selected="false">Redemptions</button>
    <button type="button" role="tab" data-tab="reports" aria-selected="false">Reports</button>
    <button type="button" role="tab" data-tab="audit" aria-selected="false">Audit log</button>
  </nav>
  <div class="who">${esc(opts.email)} <button id="signout" type="button">Sign out</button></div>
</header>
<main>
  <p id="msg" class="muted" role="status"></p>

  <section id="tab-beaches">
    <div id="stats" class="stats"></div>
    <div class="panel">
      <form id="beach-search" class="row">
        <input name="q" type="search" placeholder="Code, beach name, owner name or email" aria-label="Search beaches">
        <select name="filter" aria-label="Filter"><option value="">All beaches</option><option value="built">With sand</option><option value="hidden">Hidden from shore</option></select>
        <button type="submit" class="primary">Search</button>
      </form>
      <div id="beach-list"><p class="muted">Loading…</p></div>
      <div class="row"><button id="beach-more" type="button" hidden>More</button></div>
    </div>
    <div id="beach-detail" class="panel" hidden></div>
  </section>

  <section id="tab-submissions" hidden>
    <div class="panel">
      <h2>Item submissions</h2>
      <label>Queue <select id="submission-filter">
        <option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
      </select></label>
      <div id="submission-list"></div>
      <div class="row">
        <button id="submission-prev" type="button" hidden>Previous</button>
        <button id="submission-next" type="button" hidden>Next</button>
      </div>
    </div>
    <div class="panel submission-review" id="submission-review" hidden>
      <h2 id="submission-title"></h2>
      <dl id="submission-original"></dl>
      <div class="row" id="submission-downloads"></div>
      <h2>Editorial decision</h2>
      <form id="submission-review-form">
        <label><span>Name</span><input name="name" maxlength="80" required></label>
        <label><span>Slug</span><input name="slug" maxlength="40" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required></label>
        <label><span>Description</span><textarea name="description" rows="3" maxlength="1500"></textarea></label>
        <label><span>Behavior</span><select name="behavior">${options(BEHAVIORS)}</select></label>
        <label><span>Minimum size (m)</span><input name="sizeMin" type="number" min=".01" max="8" step="any" required></label>
        <label><span>Maximum size (m)</span><input name="sizeMax" type="number" min=".01" max="8" step="any" required></label>
        <label><span>Fixed size</span><input name="fixedSize" type="checkbox" value="true"></label>
        <label><span>Frequency</span><select name="frequency">${options(FREQUENCIES)}</select></label>
        <label><span>Availability details</span><input name="frequencyNote" maxlength="500"></label>
        <label><span>Price (USD)</span><input name="price" type="number" min="0" max="21474836.47" step=".01"></label>
        <label><span>Replacement asset</span><input name="replacement" type="file" accept=".json,.glb,.gltf,.ts"></label>
        <label><span>Product SKU</span><input name="productId" list="submission-products" maxlength="80" placeholder="e.g. item_tide_pool_pot"></label>
        <datalist id="submission-products"></datalist>
        <label><span>Catalog item ID</span><input name="itemId" maxlength="40" placeholder="e.g. tide-pool-pot"></label>
        <p class="muted">Leave both IDs blank to approve before linking to the shop. A positive price lists the linked product when its item ships. Clear the price or enter 0 to take it out of the shop. Asset and availability changes ship through the game catalog.</p>
        <label><span>Admin note</span><textarea name="adminNote" rows="3" maxlength="1500"></textarea></label>
        <div class="row">
          <button type="submit" value="approved" class="primary">Save approval</button>
          <button type="submit" value="rejected" class="danger" formnovalidate>Reject</button>
        </div>
      </form>
    </div>
  </section>

  <section id="tab-gifts" hidden>
    <div class="panel">
      <h2>Issue a gift card</h2>
      <form id="gift-form">
        <label><span>Amount ($)</span><input name="amount" type="number" min="0.5" max="1000" step="0.01" required></label>
        <label><span>Expires</span><input name="expires" type="date"></label>
        <label><span>Note</span><input name="note" type="text" maxlength="200" placeholder="who it's for"></label>
        <button type="submit" class="primary">Issue gift card</button>
      </form>
      <div id="gift-new" hidden>
        <p class="warn">Save this code now. It is shown once and never again, and anyone with it can redeem the card.</p>
        <p class="code" id="gift-code"></p>
        <p><button id="gift-copy" type="button">Copy code</button> <span id="gift-amount" class="muted"></span></p>
      </div>
    </div>
    <div class="panel"><h2>Gift cards</h2><div id="gift-list"><p class="muted">Loading…</p></div></div>
  </section>

  <section id="tab-promos" hidden>
    <div class="panel">
      <h2>New promo code</h2>
      <form id="promo-form">
        <label><span>Code</span><input name="code" type="text" required minlength="3" maxlength="32" placeholder="LAUNCH20"></label>
        <label><span>Kind</span><select name="kind"><option value="percent">Percent off</option><option value="fixed">Fixed amount off</option></select></label>
        <label><span>Value</span><input name="value" type="number" min="1" step="1" required placeholder="20 = 20% or 200 = $2.00"></label>
        <label><span>Product</span><select name="appliesTo"><option value="">Any product</option></select></label>
        <label><span>Max uses</span><input name="maxUses" type="number" min="1" step="1" placeholder="unlimited"></label>
        <label><span>Expires</span><input name="expires" type="date"></label>
        <button type="submit" class="primary">Create promo code</button>
      </form>
    </div>
    <div class="panel"><h2>Promo codes</h2><div id="promo-list"><p class="muted">Loading…</p></div></div>
  </section>

  <section id="tab-redemptions" hidden>
    <div class="panel"><div id="redemptions"><p class="muted">Loading…</p></div></div>
  </section>

  <section id="tab-reports" hidden>
    <div class="panel">
      <label><input type="checkbox" id="reports-all"> show resolved too</label>
      <div id="reports"><p class="muted">Loading…</p></div>
    </div>
  </section>

  <section id="tab-audit" hidden>
    <div class="panel"><div id="audit"><p class="muted">Loading…</p></div></div>
  </section>
</main>

<script nonce="${n}">
const APP_URL = ${js(opts.appUrl)};
const $ = (id) => document.getElementById(id);
const api = async (path, init) => {
  const res = await fetch('/api' + path, { ...init, headers: { 'X-Beech-Admin': '1', ...(init && init.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (res.status === 401) { location.reload(); throw new Error('signed out'); }
  let body = null;
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error((body && body.error) || ('request failed (' + res.status + ')'));
  return body;
};
const post = (path, data, method) => api(path, { method: method || 'POST', body: JSON.stringify(data || {}) });
const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
const money = (c) => '$' + (c / 100).toFixed(2);
const when = (ms) => ms == null ? '—' : new Date(ms).toLocaleString();
const say = (text, ok) => { const m = $('msg'); m.textContent = text; m.className = ok ? 'ok' : 'err'; };
const kb = (b) => b == null ? '—' : (b / 1024).toFixed(0) + ' KB';
const items = (m) => { const e = Object.entries(m || {}); return e.length ? e.map(([k, v]) => esc(k) + ' ×' + v).join(', ') : '—'; };

// ---- tabs
const loaded = {};
const loaders = { beaches: loadBeachesTab, submissions: () => loadSubmissions(0), gifts: loadGifts, promos: loadPromos, redemptions: loadRedemptions, reports: loadReports, audit: loadAudit };
function show(tab) {
  document.querySelectorAll('nav [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  for (const t of Object.keys(loaders)) $('tab-' + t).hidden = t !== tab;
  if (!loaded[tab]) { loaded[tab] = true; loaders[tab]().catch((e) => say(e.message)); }
  try { sessionStorage.setItem('beech-admin-tab', tab); } catch { /* private mode */ }
}
document.querySelectorAll('nav [data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));

// ---- beaches
let search = { q: '', filter: '', offset: 0 };
let selected = null;
async function loadBeachesTab() { await Promise.all([loadStats(), loadBeaches(false)]); }
async function loadStats() {
  const s = await api('/stats');
  $('stats').innerHTML = [['Players', s.users], ['Beaches', s.beaches], ['With sand', s.built], ['Saved in 24 h', s.activeDay], ['Neighbor links', s.links], ['Hidden', s.hidden]]
    .map(([k, v]) => '<div class="stat"><b>' + v + '</b><span>' + k + '</span></div>').join('');
}
async function loadBeaches(append) {
  const qs = new URLSearchParams({ q: search.q, filter: search.filter, offset: String(search.offset), limit: '50' });
  const r = await api('/beaches?' + qs);
  const el = $('beach-list');
  const rows = r.beaches.map((b) => '<tr class="pick' + (b.id === selected ? ' sel' : '') + '" data-id="' + esc(b.id) + '"><td class="mono">' + esc(b.code) + '</td><td>' + esc(b.name || '—') +
    (b.home ? ' <span class="tag">home</span>' : '') + (b.onShore ? '' : ' <span class="tag off">hidden</span>') + '</td><td>' + esc(b.owner.name || '—') +
    (b.owner.email ? '<br><span class="muted">' + esc(b.owner.email) + '</span>' : '') + '</td><td>' + esc(b.location || '—') + '</td><td>' + kb(b.bytes) + '</td><td>' + when(b.updatedAt) + '</td></tr>').join('');
  if (!append) el.innerHTML = rows ? '<table><thead><tr><th>Code</th><th>Beach</th><th>Owner</th><th>Location</th><th>Size</th><th>Saved</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="muted">No beaches match.</p>';
  else el.querySelector('tbody').insertAdjacentHTML('beforeend', rows);
  $('beach-more').hidden = !r.more;
}
$('beach-list').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) void openBeach(tr.dataset.id); });
$('beach-search').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  search = { q: String(f.get('q') || ''), filter: String(f.get('filter') || ''), offset: 0 };
  loadBeaches(false).catch((err) => say(err.message));
});
$('beach-more').addEventListener('click', () => { search.offset += 50; loadBeaches(true).catch((err) => say(err.message)); });

async function openBeach(id) {
  selected = id;
  document.querySelectorAll('#beach-list tr[data-id]').forEach((tr) => tr.classList.toggle('sel', tr.dataset.id === id));
  const d = await api('/beaches/' + encodeURIComponent(id));
  const b = d.beach;
  const el = $('beach-detail');
  el.hidden = false;
  el.innerHTML =
    '<div class="row"><h2>' + esc(b.name || 'Unnamed beach') + ' <span class="mono">' + esc(b.code) + '</span></h2>' +
      (b.visitUrl ? '<a href="' + esc(b.visitUrl) + '" target="_blank" rel="noopener noreferrer">Open in the game ↗</a>' : '') + '</div>' +
    '<dl>' +
      '<dt>Owner</dt><dd>' + esc(b.owner.name || '—') + ' · ' + esc(b.owner.email || 'no email') + ' · ' + esc(b.owner.provider) + ' <span class="muted mono">' + esc(b.owner.id) + '</span></dd>' +
      '<dt>Home</dt><dd>' + (b.home ? 'yes' : 'no') + '</dd>' +
      '<dt>On the shore</dt><dd>' + (b.onShore ? 'yes' : '<span class="err">hidden</span>') + '</dd>' +
      '<dt>Location</dt><dd>' + esc(b.location || '—') + (b.nx ? ' · ' + b.nx + '×' + b.ny : '') + '</dd>' +
      '<dt>Sand</dt><dd>' + kb(b.bytes) + ' · version ' + b.version + ' · epoch ' + b.epoch + ' · saved ' + when(b.updatedAt) + '</dd>' +
      '<dt>Things on it</dt><dd>' + items(b.items) + '</dd>' +
      '<dt>Neighbors</dt><dd>left ' + esc(b.left || '—') + ' · right ' + esc(b.right || '—') + '</dd>' +
      '<dt>Requests</dt><dd>' + (d.requests.length ? d.requests.map((r) => (r.dir === 'in' ? 'from ' : 'to ') + esc(r.code) + ' (' + esc(r.side) + ')').join(', ') : '—') + '</dd>' +
      '<dt>Favorited by</dt><dd>' + d.favoritedBy + '</dd>' +
      '<dt>Checkpoints</dt><dd>' + (d.checkpoints.length ? d.checkpoints.map((k) => esc(k.name) + (k.kind === 'auto' ? ' (auto)' : '')).join(', ') : '—') + '</dd>' +
      '<dt>Owner\\'s other beaches</dt><dd>' + (d.ownerBeaches.length ? d.ownerBeaches.map((o) => '<a href="#" data-open="' + esc(o.id) + '" class="mono">' + esc(o.code) + '</a> ' + esc(o.name)).join(', ') : '—') + '</dd>' +
      '<dt>Created</dt><dd>' + when(b.createdAt) + '</dd>' +
    '</dl>' +
    '<h2>Actions</h2>' +
    '<form id="rename" class="row"><input name="name" maxlength="30" value="' + esc(b.name) + '" aria-label="Beach name"><button type="submit">Rename</button></form>' +
    '<p class="row">' +
      '<button type="button" data-act="shore">' + (b.onShore ? 'Hide from the shore' : 'Put back on the shore') + '</button>' +
      '<button type="button" data-act="new-code">New code</button>' +
      (b.left ? '<button type="button" data-act="unlink-left">Part from left neighbor</button>' : '') +
      (b.right ? '<button type="button" data-act="unlink-right">Part from right neighbor</button>' : '') +
      (b.bytes != null ? '<button type="button" class="danger" data-act="clear">Clear the sand</button>' : '') +
      (!b.home ? '<button type="button" class="danger" data-act="delete">Delete beach</button>' : '') +
    '</p>' +
    '<p class="muted">Every action is recorded in the audit log. Clearing keeps what was there as the beach\\'s "Before it was cleared" checkpoint, so the owner can restore it.</p>';
  el.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); void openBeach(a.dataset.open); }));
  $('rename').addEventListener('submit', (e) => { e.preventDefault(); act(b, 'rename', String(new FormData(e.target).get('name') || '')); });
  el.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', () => act(b, btn.dataset.act)));
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function act(b, what, arg) {
  const path = '/beaches/' + encodeURIComponent(b.id);
  const label = b.code + (b.name ? ' (' + b.name + ')' : '');
  try {
    if (what === 'rename') { await post(path, { name: arg }, 'PATCH'); say('Renamed ' + b.code + '.', true); }
    else if (what === 'shore') { await post(path, { onShore: !b.onShore }, 'PATCH'); say(b.onShore ? 'Hidden from the shore.' : 'Back on the shore.', true); }
    else if (what === 'new-code') {
      if (!confirm('Give ' + label + ' a new code? The old code stops working, and links shared with it break.')) return;
      const r = await post(path + '/new-code'); say('New code: ' + r.beach.code, true);
    } else if (what === 'unlink-left' || what === 'unlink-right') {
      const side = what === 'unlink-left' ? 'left' : 'right';
      if (!confirm('Part ' + label + ' from its ' + side + ' neighbor?')) return;
      await post(path + '/unlink', { side }); say('Neighbors parted.', true);
    } else if (what === 'clear') {
      if (!confirm('Clear all the sand on ' + label + '? The owner keeps a checkpoint of it.')) return;
      await post(path + '/clear'); say('Sand cleared. The old beach is in the owner\\'s checkpoints.', true);
    } else if (what === 'delete') {
      if (prompt('Delete ' + label + ' for good? Type the code ' + b.code + ' to confirm.') !== b.code) return;
      await api(path, { method: 'DELETE' }); say('Beach deleted.', true);
      selected = null; $('beach-detail').hidden = true; await loadBeaches(false); await loadStats(); return;
    }
    await Promise.all([openBeach(b.id), loadBeaches(false), loadStats()]);
  } catch (e) { say(e.message); }
}

// ---- item submissions
let submissionOffset = 0;
let selectedSubmission = null;
let shownProducts = [];
const reviewForm = $('submission-review-form');
async function loadSubmissions(offset) {
  const status = $('submission-filter').value;
  const { submissions, more } = await api('/item-submissions?status=' + status + '&offset=' + offset);
  if (status !== $('submission-filter').value) return;
  submissionOffset = offset;
  $('submission-prev').hidden = offset === 0;
  $('submission-next').hidden = !more;
  const list = $('submission-list');
  list.innerHTML = submissions.length
    ? '<table><thead><tr><th>Item</th><th>Creator beach</th><th>Proposed price</th><th>Frequency</th><th>Submitted</th></tr></thead><tbody>' +
      submissions.map((s) => '<tr><td><button type="button" data-id="' + s.id + '">' + esc(s.name) + '</button></td><td>' +
        esc(s.submitter_beach_code) + '</td><td>' + money(s.proposed_price_cents) + '</td><td>' +
        esc(s.proposed_frequency) + '</td><td>' + when(Number(s.created_at)) + '</td></tr>').join('') + '</tbody></table>'
    : '<p class="muted">No submissions in this queue.</p>';
  list.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    openSubmission(b.dataset.id).catch((e) => say(e.message));
  }));
}
$('submission-filter').addEventListener('change', () => {
  selectedSubmission = null;
  $('submission-review').hidden = true;
  loadSubmissions(0).catch((e) => say(e.message));
});
$('submission-prev').addEventListener('click', () => loadSubmissions(submissionOffset - 25).catch((e) => say(e.message)));
$('submission-next').addEventListener('click', () => loadSubmissions(submissionOffset + 25).catch((e) => say(e.message)));

async function submissionDownload(id, file, filename) {
  const res = await fetch('/api/item-submissions/' + id + '/files/' + file, { headers: { 'X-Beech-Admin': '1' } });
  if (!res.ok) throw new Error('The upload could not be downloaded.');
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || (res.headers.get('content-disposition') || '').split('"')[1] || 'preview';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function openSubmission(id) {
  selectedSubmission = id;
  const { submission: row, products } = await api('/item-submissions/' + id);
  if (id !== selectedSubmission) return;
  shownProducts = products;
  $('submission-title').textContent = row.name;
  const assetSize = row.asset_size < 1024 ? row.asset_size + ' B' : kb(row.asset_size);
  const assetSummary = row.asset_summary.parts ? ' · ' + row.asset_summary.parts + ' parts'
    : row.asset_summary.meshes ? ' · ' + row.asset_summary.meshes + ' meshes' : '';
  const details = [
    ['Status', row.status],
    ['Creator beach', row.submitter_beach_code],
    ['Original item', row.slug + ' · ' + row.behavior + ' · ' + row.size_min + '–' + row.size_max + ' m'],
    ['Original description', row.description],
    ['Proposal', money(row.proposed_price_cents) + ' · ' + row.proposed_frequency + (row.frequency_note ? ' · ' + row.frequency_note : '')],
    ['Asset', row.asset_format + ' · ' + assetSize + assetSummary],
    ['Terms accepted', row.terms_version + ' · ' + when(Number(row.terms_accepted_at))],
    ['Sales and credit', row.sales_count + ' sales · ' + money(row.total_credit_earned_cents)],
    ['Last reviewed', row.reviewed_by ? row.reviewed_by + ' · ' + when(Number(row.reviewed_at)) : '—'],
  ];
  $('submission-original').innerHTML = details.map(([label, value]) => '<dt>' + label + '</dt><dd>' + esc(value || '—') + '</dd>').join('');
  const downloads = [['original', 'Original asset', row.asset_filename]];
  if (row.has_preview) downloads.push(['preview', 'Preview image']);
  if (row.replacement_filename) downloads.push(['replacement', 'Replacement asset', row.replacement_filename]);
  $('submission-downloads').replaceChildren(...downloads.map(([file, label, filename]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Download ' + label.toLowerCase();
    button.addEventListener('click', () => submissionDownload(id, file, filename).catch((e) => say(e.message)));
    return button;
  }));
  reviewForm.reset();
  const approved = row.approved_item || {};
  const fields = reviewForm.elements;
  for (const [key, value] of Object.entries({
    name: row.name, slug: row.slug, description: row.description, behavior: row.behavior,
    sizeMin: row.size_min, sizeMax: row.size_max, frequencyNote: row.frequency_note, ...approved,
    frequency: row.approved_frequency || row.proposed_frequency,
    price: row.approved_item && row.approved_price_cents === null ? '' : (row.approved_price_cents ?? row.proposed_price_cents) / 100,
    productId: row.product_id || '', itemId: row.item_id || '', adminNote: row.admin_note,
  })) {
    if (key !== 'fixedSize') fields[key].value = value;
  }
  fields.fixedSize.checked = approved.fixedSize ?? row.fixed_size;
  fields.productId.readOnly = fields.itemId.readOnly = !!row.product_id;
  $('submission-products').replaceChildren(...products.map((p) => new Option(p.itemId, p.id)));
  $('submission-review').hidden = false;
  $('submission-review').scrollIntoView({ block: 'nearest' });
}
reviewForm.elements.productId.addEventListener('change', () => {
  const fields = reviewForm.elements;
  const product = shownProducts.find((p) => p.id === fields.productId.value);
  if (product) fields.itemId.value = product.itemId;
});
reviewForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = selectedSubmission;
  if (!id || !e.submitter || e.submitter.disabled) return;
  const f = new FormData(reviewForm);
  f.set('status', e.submitter.value);
  f.set('priceCents', f.get('price') ? String(Math.round(reviewForm.elements.price.valueAsNumber * 100)) : '');
  f.delete('price');
  if (!reviewForm.elements.replacement.files.length) f.delete('replacement');
  const buttons = reviewForm.querySelectorAll('button');
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const res = await fetch('/api/item-submissions/' + id + '/review', {
      method: 'POST', headers: { 'X-Beech-Admin': '1' }, body: f,
    });
    if (res.status === 401) { location.reload(); return; }
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'The decision could not be saved.');
    say(result.status === 'approved' ? 'Approval saved.' : 'Submission rejected.', true);
    await loadSubmissions(submissionOffset);
    if (selectedSubmission === id) await openSubmission(id);
  } catch (err) {
    say(err.message);
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
});

// ---- gift cards
async function loadGifts() {
  const { giftCards: list } = await api('/gift-cards');
  const el = $('gift-list');
  if (!list.length) { el.innerHTML = '<p class="muted">No gift cards yet.</p>'; return; }
  el.innerHTML = '<table><tr><th>Amount</th><th>Status</th><th>Issued</th><th>Expires</th><th>Redeemed by</th><th></th></tr>' +
    list.map((g) => '<tr><td>' + money(g.amountCents) + '</td><td>' + esc(g.status) + '</td><td>' + when(g.issuedAt) + '</td><td>' + when(g.expiresAt) + '</td><td>' + esc(g.redeemedBy || '—') + (g.note ? ' · ' + esc(g.note) : '') + '</td>' +
      (g.status === 'active' ? '<td><button type="button" data-disable-gift="' + esc(g.id) + '">Disable</button></td>' : '<td></td>') + '</tr>').join('') + '</table>';
  el.querySelectorAll('[data-disable-gift]').forEach((b) => b.addEventListener('click', async () => {
    try { await post('/gift-cards/' + encodeURIComponent(b.dataset.disableGift) + '/disable'); say('Gift card disabled.', true); await loadGifts(); }
    catch (e) { say(e.message); }
  }));
}
$('gift-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const expires = f.get('expires') ? new Date(f.get('expires') + 'T23:59:59').getTime() : null;
  try {
    const g = await post('/gift-cards', { amountCents: Math.round(Number(f.get('amount')) * 100), expiresAt: expires, note: f.get('note') });
    $('gift-new').hidden = false;
    $('gift-code').textContent = g.code;
    $('gift-amount').textContent = g.amount + ' gift card';
    say('Gift card issued. Save the code: it will not be shown again.', true);
    e.target.reset();
    await loadGifts();
  } catch (err) { say(err.message); }
});
$('gift-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('gift-code').textContent); say('Code copied.', true); }
  catch { say('Copy failed: select the code and copy it by hand.'); }
});

// ---- promo codes
async function loadPromos() {
  const [{ promos: list }, { products }] = await Promise.all([api('/promo-codes'), api('/products')]);
  const sel = document.querySelector('#promo-form select[name=appliesTo]');
  sel.querySelectorAll('option:not([value=""])').forEach((o) => o.remove());
  for (const p of products) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name + ' (' + money(Math.round(p.usd * 100)) + ')'; sel.appendChild(o); }
  const el = $('promo-list');
  if (!list.length) { el.innerHTML = '<p class="muted">No promo codes yet.</p>'; return; }
  el.innerHTML = '<table><tr><th>Code</th><th>Off</th><th>For</th><th>Uses</th><th>Active</th><th>Expires</th><th></th></tr>' +
    list.map((p) => '<tr><td><b>' + esc(p.code) + '</b></td><td>' + (p.kind === 'percent' ? p.value + '%' : money(p.value)) + '</td><td>' + esc(p.appliesTo || 'any') + '</td><td>' + p.uses + (p.maxUses ? ' / ' + p.maxUses : '') + '</td><td>' + (p.active ? 'yes' : 'no') + '</td><td>' + when(p.expiresAt) + '</td>' +
      (p.active ? '<td><button type="button" data-disable-promo="' + esc(p.code) + '">Disable</button></td>' : '<td></td>') + '</tr>').join('') + '</table>';
  el.querySelectorAll('[data-disable-promo]').forEach((b) => b.addEventListener('click', async () => {
    try { await post('/promo-codes/' + encodeURIComponent(b.dataset.disablePromo) + '/disable'); say('Promo code disabled.', true); await loadPromos(); }
    catch (e) { say(e.message); }
  }));
}
$('promo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const expires = f.get('expires') ? new Date(f.get('expires') + 'T23:59:59').getTime() : null;
  try {
    await post('/promo-codes', { code: f.get('code'), kind: f.get('kind'), value: Number(f.get('value')),
      appliesTo: f.get('appliesTo') || null, maxUses: f.get('maxUses') ? Number(f.get('maxUses')) : null, expiresAt: expires });
    say('Promo code created.', true);
    e.target.reset();
    await loadPromos();
  } catch (err) { say(err.message); }
});

// ---- redemptions and audit
async function loadRedemptions() {
  const red = await api('/redemptions');
  const giftRows = red.giftCards.map((g) => '<tr><td>Gift card</td><td>' + money(g.amountCents) + '</td><td>' + esc(g.redeemedBy || '') + '</td><td>' + when(g.redeemedAt) + '</td></tr>').join('');
  const promoRows = red.promoUses.map((p) => '<tr><td>Promo ' + esc(p.code) + '</td><td>−' + money(p.discountCents) + ' on ' + esc(p.productId) + '</td><td>' + esc(p.user || '') + '</td><td>' + when(p.usedAt) + '</td></tr>').join('');
  const creditRows = red.credit.map((l) => '<tr><td>Credit ' + esc(l.kind) + '</td><td>' + (l.amountCents >= 0 ? '+' : '−') + money(Math.abs(l.amountCents)) + ' (' + esc(l.ref) + ')</td><td>' + esc(l.user || '') + '</td><td>' + when(l.createdAt) + '</td></tr>').join('');
  const rows = giftRows + promoRows + creditRows;
  $('redemptions').innerHTML = rows ? '<table><tr><th>What</th><th>Amount</th><th>Who</th><th>When</th></tr>' + rows + '</table>' : '<p class="muted">Nothing redeemed yet.</p>';
}
async function loadReports() {
  const { reports } = await api('/reports' + ($('reports-all').checked ? '?all=1' : ''));
  const el = $('reports');
  el.innerHTML = reports.length ? '<table><tr><th>When</th><th>Note</th><th>From</th><th>To</th><th>Reason</th><th></th></tr>' +
    reports.map((r) => '<tr><td>' + when(r.at) + '</td><td>' + (r.hidden ? '<s>' + esc(r.note) + '</s>' : esc(r.note)) + '</td><td>' +
      (r.from ? esc(r.from.name) + ' <span class="mono">' + esc(r.from.code || '') + '</span><br><span class="muted">' + esc(r.from.email || '') + ' · ' + r.senderReports + ' report(s)</span>' : '<span class="muted">deleted</span>') +
      '</td><td>' + esc(r.to.name) + ' <span class="mono">' + esc(r.to.code || '') + '</span></td><td>' + esc(r.reason) + '</td><td>' +
      (r.resolvedAt ? esc(r.resolution) + '<br><span class="muted">' + esc(r.resolvedBy || '') + '</span>'
        : '<button type="button" data-report-hide="' + r.id + '">Hide note</button> <button type="button" data-report-dismiss="' + r.id + '">Dismiss</button>') +
      '</td></tr>').join('') + '</table>'
    : '<p class="muted">No open reports.</p>';
  const act = (attr, action) => el.querySelectorAll('[' + attr + ']').forEach((b) => b.addEventListener('click', async () => {
    try { await post('/reports/' + b.getAttribute(attr) + '/resolve', { action }); say(action === 'hide' ? 'Note hidden' : 'Report dismissed', true); await loadReports(); }
    catch (e) { say(e.message); }
  }));
  act('data-report-hide', 'hide');
  act('data-report-dismiss', 'dismiss');
}
$('reports-all').addEventListener('change', () => loadReports().catch((e) => say(e.message)));

async function loadAudit() {
  const { audit } = await api('/audit');
  $('audit').innerHTML = audit.length ? '<table><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr>' +
    audit.map((a) => '<tr><td>' + when(a.at) + '</td><td>' + esc(a.actor) + '</td><td>' + esc(a.action) + '</td><td class="mono">' + esc(a.target) + '</td><td class="mono">' + esc(JSON.stringify(a.detail)) + '</td></tr>').join('') + '</table>'
    : '<p class="muted">No admin actions yet.</p>';
}

$('signout').addEventListener('click', async () => {
  try { await fetch('/auth/logout', { method: 'POST', headers: { 'X-Beech-Admin': '1' } }); } finally { location.reload(); }
});

let first = 'beaches';
try { const t = sessionStorage.getItem('beech-admin-tab'); if (t && loaders[t]) first = t; } catch { /* private mode */ }
show(first);
</script>
</body>
</html>`;
}
