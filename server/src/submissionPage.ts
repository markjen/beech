import { BEHAVIORS, FREQUENCIES, SUBMISSION_TERMS, TERMS_VERSION } from './itemSubmissions.js';

export const SUBMISSION_CSS = `
.submission{max-width:780px;margin:0 auto}
.submission .head{padding-bottom:14px}
.submission-panel{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:clamp(16px,4vw,30px);margin:0 0 20px;box-shadow:var(--sh-sm)}
.submission-panel h2,.submission-panel h3{margin-top:0}
.submission-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.submission-fields label{display:grid;gap:5px;align-content:start;font-weight:700;min-width:0}
.submission-fields .wide{grid-column:1/-1}
.submission-fields :is(input:not([type=checkbox]),select,textarea){width:100%;padding:9px;border:1px solid var(--line2);border-radius:8px;background:var(--sand2);color:var(--ink);font:inherit;font-weight:500}
.submission-fields :is(input,textarea)::placeholder{color:var(--ink2)}
.submission-fields small,.submission-panel .muted{color:var(--ink2);font-weight:500}
.submission-fields label.check{display:flex;align-items:start}
.submission-fields [type=checkbox]{accent-color:var(--sea-hi);margin-top:.38em}
.submission-terms{margin:4px 0 0;padding-left:1.35em}
.submission-terms li+li{margin-top:.6em}
.submission .actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.submission .btn:disabled{opacity:.55;cursor:default}
.submission-history{padding-left:1.35em}
.submission-history li+li{margin-top:.6em}
.submission code{overflow-wrap:anywhere}
@media(max-width:535px){.submission-fields{grid-template-columns:minmax(0,1fr)}}
`;

const options = (values: readonly string[]) => values.map((v) => `<option value="${v}">${v[0].toUpperCase()}${v.slice(1)}</option>`).join('');

export function submissionContent(href: (p: string) => string, config: { endpoint: string; bridge: string | null }) {
  const settings = JSON.stringify(config).replace(/</g, '\\u003c');
  return `<div class="submission">
<section class="head">
  <h1>Submit an item</h1>
  <p>Design a prop for Beech, propose its price and how often it should appear, and send it for review.</p>
  <div class="tabs"><a href="${href('/items')}">All items</a><a href="${href('/submit')}" aria-current="page">Submit an item</a><a href="${href('/submit/spec')}">Asset spec</a></div>
</section>
<section class="submission-panel">
  <p id="submission-status" role="status">Connect your Beech account to submit an item and see your previous submissions.</p>
  <button class="btn" id="submission-connect" type="button">Connect Beech account</button>
  <noscript>Enable JavaScript to connect your account and upload an item.</noscript>
  <form id="submission-form" class="submission-fields" hidden>
    <label>Item name <input name="name" required maxlength="80"></label>
    <label>Item slug <input name="slug" required maxlength="40" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="e.g. tide-pool-pot"></label>
    <label class="wide">Description <textarea name="description" maxlength="1500" rows="3"></textarea></label>
    <label>Proposed price (USD) <input type="number" name="price" min="0" max="999.99" step=".01" required><small>Enter 0 for a free item.</small></label>
    <label>Proposed frequency <select name="frequency">${options(FREQUENCIES)}</select></label>
    <label class="wide">Availability details <input name="frequencyNote" maxlength="500" placeholder="e.g. a summer shop item"></label>
    <label>Beach behavior <select name="behavior">${options(BEHAVIORS)}</select></label>
    <label class="check"><input type="checkbox" name="fixedSize" value="true" checked> Fixed size</label>
    <label>Minimum size (m) <input type="number" name="sizeMin" min=".01" max="8" step="any" value="0.5" required></label>
    <label>Maximum size (m) <input type="number" name="sizeMax" min=".01" max="8" step="any" value="0.5" required></label>
    <label>Item asset <input type="file" name="asset" accept=".json,.glb,.gltf,.ts" required><small>Beech JSON, GLB, glTF or TypeScript, up to 2 MiB.</small></label>
    <label>Preview image (optional) <input type="file" name="preview" accept="image/png,image/jpeg"><small>PNG or JPEG, up to 512 KiB.</small></label>
    <div class="wide">
      <details open><summary><strong>Submission terms</strong></summary>
        <ul class="submission-terms">${SUBMISSION_TERMS.map((term) => `<li>${term}</li>`).join('')}</ul>
      </details>
      <input type="hidden" name="termsVersion" value="${TERMS_VERSION}">
      <label class="check"><input type="checkbox" name="termsAccepted" value="true" required> I accept the submission terms.</label>
    </div>
    <div class="wide actions"><button class="btn" id="submission-send" type="submit" disabled>Submit for review</button></div>
  </form>
</section>
<section class="submission-panel" id="submission-history" hidden>
  <h2>Your submissions</h2>
  <p id="submission-credit"></p>
  <ul class="submission-history" id="submission-items"></ul>
</section>
</div>
<style>${SUBMISSION_CSS} [hidden]{display:none!important}</style>
<script>
(() => {
  const { endpoint, bridge } = ${settings};
  const byId = (id) => document.getElementById('submission-' + id);
  const connect = byId('connect');
  const form = byId('form');
  const status = byId('status');
  const send = byId('send');
  let token;
  let popup;
  let busy = false;
  function updateSubmitButton() {
    send.disabled = busy || !form.elements.termsAccepted.checked;
  }
  form.elements.termsAccepted.addEventListener('change', updateSubmitButton);
  form.elements.fixedSize.addEventListener('change', () => {
    if (form.elements.fixedSize.checked) form.elements.sizeMax.value = form.elements.sizeMin.value;
  });
  form.elements.sizeMin.addEventListener('input', () => {
    if (form.elements.fixedSize.checked) form.elements.sizeMax.value = form.elements.sizeMin.value;
  });

  async function request(method, body) {
    const res = await fetch(endpoint, { method, body, headers: { Authorization: 'Bearer ' + token } });
    const data = await res.json();
    if (res.status === 401) {
      token = undefined;
      connect.hidden = false;
      form.hidden = true;
      byId('history').hidden = true;
    }
    if (!res.ok) throw new Error(data.error || 'The request did not go through.');
    return data;
  }

  async function history() {
    const data = await request('GET');
    const list = byId('items');
    list.replaceChildren();
    byId('credit').textContent = 'Available Beech credit: $' + (data.creditCents / 100).toFixed(2);
    if (!data.submissions.length) {
      const empty = document.createElement('li');
      empty.textContent = 'You haven’t submitted an item yet.';
      list.append(empty);
    }
    for (const row of data.submissions) {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = row.approved_name || row.name;
      const state = row.status === 'pending' ? 'in review' : row.status;
      const price = !row.for_sale ? 'not for sale'
        : row.approved_price_cents === null ? ''
        : row.approved_price_cents === 0 ? 'free' : '$' + (row.approved_price_cents / 100).toFixed(2);
      const decision = row.status === 'approved'
        ? ' · ' + row.approved_frequency + (price ? ' · ' + price : '')
        : '';
      const credits = row.status === 'approved' || row.sales_count > 0
        ? ' · ' + row.sales_count + ' sales · $' + (row.total_credit_earned_cents / 100).toFixed(2) + ' earned'
        : '';
      item.append(name, ' · ' + state + decision + credits);
      list.append(item);
    }
    byId('history').hidden = false;
    return data.user;
  }

  async function connected(value) {
    token = value;
    try {
      const user = await history();
      connect.hidden = true;
      form.hidden = false;
      status.textContent = 'Connected as ' + (user.name || 'a Beech player') + '.';
    } catch (err) {
      status.textContent = err.message;
    }
  }

  const connectUrl = bridge || '/shore/submit/connect';
  const connectionOrigin = new URL(connectUrl, location.href).origin;
  window.addEventListener('message', (event) => {
    if (event.origin !== connectionOrigin || event.source !== popup || event.data?.type !== 'beech-item-submission') return;
    if (typeof event.data.token !== 'string') return;
    popup.close();
    popup = null;
    void connected(event.data.token);
  });
  connect.addEventListener('click', () => {
    if (popup && !popup.closed) { popup.focus(); return; }
    popup = window.open(connectUrl, '_blank', 'popup,width=520,height=540');
    status.textContent = popup
      ? 'Finish connecting in the Beech window.'
      : 'Allow pop-ups for this page and try connecting again.';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const data = new FormData(form);
    data.set('priceCents', String(Math.round(form.elements.price.valueAsNumber * 100)));
    data.delete('price');
    if (!form.elements.preview.files.length) data.delete('preview');
    busy = true;
    updateSubmitButton();
    status.textContent = 'Uploading…';
    try {
      await request('POST', data);
      form.reset();
      status.textContent = 'Item submitted for review.';
      await history().catch(() => {});
      status.scrollIntoView({ block: 'nearest' });
    } catch (err) {
      status.textContent = err.message;
      status.scrollIntoView({ block: 'nearest' });
    } finally {
      busy = false;
      updateSubmitButton();
    }
  });
})();
</script>`;
}

export function connectContent(destination: string | null) {
  return `<div class="submission">
<section class="head"><h1>Connect Beech</h1></section>
<section class="submission-panel">
  <p id="connect-status" role="status">Checking your Beech sign-in…</p>
  <div class="actions">
    <a class="btn" id="connect-game" href="/" target="_blank" rel="noopener" hidden>Open Beech to sign in ↗</a>
    <button class="btn ghost" id="connect-retry" type="button" hidden>Check sign-in again</button>
  </div>
</section>
</div>
<style>${SUBMISSION_CSS} [hidden]{display:none!important}</style>
<script>
(() => {
  const destination = ${JSON.stringify(destination).replace(/</g, '\\u003c')} || location.origin;
  const status = document.getElementById('connect-status');
  const game = document.getElementById('connect-game');
  const retry = document.getElementById('connect-retry');
  let busy = false;
  async function connect() {
    if (busy) return;
    if (!window.opener) {
      status.textContent = 'Open this window from beechshore.';
      return;
    }
    busy = true;
    try {
      const gameToken = localStorage.getItem('beech.session.v1');
      if (!gameToken) throw new Error('Sign in to Beech in this browser, then return to this window.');
      const res = await fetch('/api/item-submissions/connect', { method: 'POST', headers: { Authorization: 'Bearer ' + gameToken } });
      if (res.status === 401) throw new Error('Sign in to Beech again, then return to this window.');
      if (!res.ok) throw new Error('The connection could not be made. Try again.');
      const { token } = await res.json();
      window.opener.postMessage({ type: 'beech-item-submission', token }, destination);
      status.textContent = 'Connected. You can return to the submission page.';
      game.hidden = true;
      retry.hidden = true;
    } catch (err) {
      status.textContent = err.message;
      game.hidden = false;
      retry.hidden = false;
    } finally {
      busy = false;
    }
  }
  retry.addEventListener('click', connect);
  window.addEventListener('focus', () => { if (!retry.hidden) void connect(); });
  void connect();
})();
</script>`;
}

export function specContent(href: (p: string) => string) {
  return `<div class="submission">
<section class="head">
  <h1>Item asset specification</h1>
  <p>Use these requirements with any modeling tool or AI agent.</p>
  <div class="tabs"><a href="${href('/items')}">All items</a><a href="${href('/submit')}">Submit an item</a><a href="${href('/submit/spec')}" aria-current="page">Asset spec</a></div>
</section>
<section class="submission-panel">
  <h2>Model</h2>
  <ul>
    <li>Create one static low-poly beach prop, with an easy-to-read silhouette, restrained pastel colors, and simple materials.</li>
    <li>Use meters, +Y up and +Z forward in Beech JSON and TypeScript. Center the pivot on the contact point at ground level. For glTF and GLB, keep the format’s native right-handed axes.</li>
    <li>Aim for fewer than 2,000 triangles and four materials. Omit lights, cameras, animations and external dependencies.</li>
    <li>Choose fixed, tumble, float or rock behavior. Fixed props stay put, tumble props roll in the swash, float props ride the water, and rock props raise the sand floor.</li>
  </ul>
  <h2>Files</h2>
  <ul>
    <li><strong>Beech JSON</strong> defines 1–32 primitive parts. Each part has a shape, position, full XYZ dimensions, and a hex color. Rotation is optional and uses radians around XYZ.</li>
    <li><strong>GLB or glTF 2.0</strong> includes all model data in one file. Use a GLB binary chunk or embedded Base64 data URIs. External files and network URLs are unsupported.</li>
    <li><strong>TypeScript</strong> is review-only source. Supply one readable file with a pure mesh builder using Babylon.js primitives, no network or file access and no extra packages.</li>
    <li>Keep the model file under 2 MiB. You can also supply a PNG or JPEG preview under 512 KiB, ideally an oblique view on a neutral background.</li>
  </ul>
  <h2>Prompt for an agent</h2>
  <p>Make a small terracotta tide-pool pot for Beech. Return one JSON file that validates against the asset schema below. Use a flat base at Y=0, a soft terracotta and sand palette, and a silhouette that reads at a glance. Suggest a name, slug, description, fixed or variable size in meters, behavior, USD price and availability.</p>
  <div class="actions"><a class="btn" href="${href('/submit/schema.json')}">JSON Schema</a><a class="btn ghost" href="${href('/submit/example.json')}" download="tide-pool-pot.json">Download example</a><a href="${href('/submit')}">Submit an item →</a></div>
</section>
</div>
<style>${SUBMISSION_CSS}</style>`;
}
