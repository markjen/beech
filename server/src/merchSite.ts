// store.beech.games: the merch store (docs/MERCH_STORE.md). One page that
// draws itself from GET /api/catalog: the set, the logo things, and "your
// beach" prints (sign in with Google or Apple, pick one of your beaches).
// The bag lives in this browser; checkout is Stripe's page; /order/<id> is
// where Stripe sends the shopper back.
//
// /api/* is forwarded to the game API's /merch/* (merch.ts), and
// /api/auth/google|apple to /shore-auth/* for a shore token, the same
// sign-in as beechshore.com's account page (docs/SHORE_SITE.md).
import { Hono, type Context } from 'hono';
import fs from 'node:fs';
import path from 'node:path';

export interface StoreSiteConfig {
  /** path the site is mounted at: '' on store.beech.games, '/merch-store' elsewhere */
  base: string;
  /** the game (https://play.beech.games) */
  gameUrl: string;
  /** built web app dir: /merch-art/* comes from public/merch, the icons from public/icons */
  publicDir: string;
  /** the game API (createApp) */
  api: { fetch: (req: Request) => Response | Promise<Response> };
  googleClientId?: string;
  appleClientId?: string;
}

const API = /^\/api\/(catalog|sample-beach\.png|my-beaches|beach-preview\/[0-9a-f-]{36}|checkout|orders\/[0-9a-f-]{36}|stripe-webhook|printful-webhook|print\/[0-9a-f]{32}\.png)$/;
const AUTH = /^\/api\/auth\/(google|apple)$/;

export function createStoreSite(cfg: StoreSiteConfig): Hono {
  const app = new Hono();
  const base = cfg.base;
  const forward = async (c: Context, target: string) => {
    const headers = new Headers();
    for (const h of ['authorization', 'content-type', 'x-forwarded-for', 'stripe-signature']) {
      const v = c.req.header(h);
      if (v) headers.set(h, v);
    }
    const q = new URL(c.req.url).search;
    const method = c.req.method;
    const res = await cfg.api.fetch(new Request(`http://api.internal/${target}${q}`, { method, headers, body: method === 'POST' ? await c.req.arrayBuffer() : undefined }));
    const type = res.headers.get('content-type') ?? 'application/json';
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': type, 'Cache-Control': type.startsWith('image/') && target.startsWith('merch/print/') ? 'public, max-age=86400' : 'no-store' } });
  };
  app.on(['GET', 'POST'], `${base}/api/*`, (c) => {
    const p = c.req.path.slice(base.length);
    const auth = AUTH.exec(p);
    if (auth && c.req.method === 'POST') return forward(c, `shore-auth/${auth[1]}`);
    const m = API.exec(p);
    if (!m) return c.json({ error: 'not found' }, 404);
    return forward(c, `merch/${m[1]}`);
  });
  const file = (dir: string, name: string, type: string, cache: string) => (c: Context) => {
    if (!/^[a-z0-9-]+\.(png|svg)$/.test(name)) return c.text('not found', 404);
    const f = path.join(cfg.publicDir, dir, name);
    if (!fs.existsSync(f)) return c.text('not found', 404);
    return c.body(new Uint8Array(fs.readFileSync(f)), 200, { 'Content-Type': type, 'Cache-Control': cache });
  };
  app.get(`${base}/merch-art/:name`, (c) => file('merch', c.req.param('name'), 'image/png', 'public, max-age=86400')(c));
  app.get(`${base}/icons/:name`, (c) => {
    const n = c.req.param('name');
    return file('icons', n, n.endsWith('.svg') ? 'image/svg+xml' : 'image/png', 'public, max-age=86400')(c);
  });
  const page = (c: Context) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(storeHtml({ base, gameUrl: cfg.gameUrl, googleClientId: cfg.googleClientId ?? '', appleClientId: cfg.appleClientId ?? '' }));
  };
  app.get(base || '/', page);
  app.get(`${base}/`, page);
  app.get(`${base}/bag`, page);
  app.get(`${base}/order/:id`, page);
  app.get(`${base}/*`, (c) => c.redirect(`${base}/`, 302));
  return app;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function storeHtml(o: { base: string; gameUrl: string; googleClientId: string; appleClientId: string }): string {
  const settings = JSON.stringify(o).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>beech store</title>
<meta name="description" content="Tees, hoodies, hats, flip flops and towels from beech, and your own beach printed on a tee or hoodie.">
<meta property="og:title" content="beech store">
<meta property="og:description" content="Wear the beach. Tees, hoodies, hats, flip flops, towels, and your own beach on a tee.">
<meta property="og:image" content="https://beech.games/hero-beach.jpg">
<meta name="theme-color" content="#fbf4e7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#131b26" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${esc(o.base)}/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${esc(o.base)}/icons/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap">
<style>${STORE_CSS}</style>
</head>
<body>
<header class="top">
  <a class="brand" href="${esc(o.base)}/"><img src="${esc(o.base)}/icons/icon.svg" alt="" width="32" height="32"><span>beech <em>store</em></span></a>
  <nav>
    <a href="${esc(o.gameUrl)}" class="quiet">Play beech</a>
    <button class="bag-btn" id="bag-open" type="button" aria-label="Your bag">Bag <span id="bag-count" class="count">0</span></button>
  </nav>
</header>

<main id="shop">
  <section class="hero">
    <div class="hero-copy">
      <p class="kicker">The beech store</p>
      <h1>Wear the beach.</h1>
      <p class="lede">Soft tees and hoodies, an embroidered hat, flip flops and a big beach towel. Or put your own beach on a shirt.</p>
      <div class="hero-actions">
        <a class="btn" href="#set">Get the whole set</a>
        <a class="btn ghost" href="#yours">Print your beach</a>
      </div>
      <p class="status" id="store-status" role="status"></p>
    </div>
    <div class="hero-art" id="hero-art" aria-hidden="true"></div>
  </section>

  <section class="set" id="set"></section>

  <section class="grid-wrap">
    <h2>The beech collection</h2>
    <div class="grid" id="grid"></div>
  </section>

  <section class="yours" id="yours">
    <div class="yours-copy">
      <h2>Your beach, printed</h2>
      <p>The beach you built, drawn big on the front of a tee or a hoodie. We print it as it is when you order, so keep building.</p>
      <div id="signin">
        <div class="signin-buttons">
          <span id="google-button"></span>
          <button class="btn apple" id="apple-button" type="button" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.37 12.62c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.86-.76-1.47.02-2.83.86-3.59 2.17-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.25 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.08 2.65-2.14.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.3-3.5zM14.2 6.16c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.56-1.23z"/></svg>Sign in with Apple</button>
        </div>
        <p class="status" id="signin-status" role="status"></p>
      </div>
      <div id="signed-in" hidden>
        <p class="who">Signed in as <strong id="who"></strong> · <button class="link" id="sign-out" type="button">sign out</button></p>
        <div class="beaches" id="beaches" role="radiogroup" aria-label="Your beaches"></div>
      </div>
    </div>
    <div class="yours-products" id="yours-products"></div>
  </section>
</main>

<main id="order" hidden>
  <section class="order-card">
    <p class="kicker">Your order</p>
    <h1 id="order-title">Checking your order…</h1>
    <p class="lede" id="order-sub"></p>
    <ol class="steps" id="order-steps"></ol>
    <ul class="order-lines" id="order-lines"></ul>
    <p class="order-total" id="order-total"></p>
    <p><a class="btn ghost" href="${esc(o.base)}/">Back to the store</a></p>
  </section>
</main>

<footer class="foot">
  <a href="https://beech.games">beech.games</a>
  <a href="https://beech.games/guide#store">Help &amp; returns</a>
  <a href="https://beech.games/privacy.html">Privacy</a>
</footer>

<dialog id="sheet" aria-labelledby="sheet-name">
  <form method="dialog" class="sheet">
    <button class="close" value="close" aria-label="Close">×</button>
    <div class="sheet-art" id="sheet-art"></div>
    <div class="sheet-body">
      <h3 id="sheet-name"></h3>
      <p class="price" id="sheet-price"></p>
      <div id="sheet-options"></div>
      <label class="qty">Quantity <input id="sheet-qty" type="number" min="1" max="10" value="1" inputmode="numeric"></label>
      <p class="status" id="sheet-status" role="status"></p>
      <button class="btn wide" id="sheet-add" type="button">Add to bag</button>
    </div>
  </form>
</dialog>

<dialog id="bag" aria-labelledby="bag-title">
  <form method="dialog" class="bag">
    <button class="close" value="close" aria-label="Close">×</button>
    <h3 id="bag-title">Your bag</h3>
    <ul id="bag-lines"></ul>
    <dl class="sums">
      <dt>Subtotal</dt><dd id="bag-subtotal"></dd>
      <dt>Shipping</dt><dd id="bag-shipping"></dd>
    </dl>
    <p class="status" id="bag-status" role="status"></p>
    <button class="btn wide" id="checkout" type="button">Check out</button>
  </form>
</dialog>

<script>
${storeScript(settings)}
</script>
</body>
</html>`;
}

const STORE_CSS = `
:root{--bg:#fbf4e7;--bg-deep:#f2e5ce;--surface:#fffcf6;--ink:#1d2d38;--ink-soft:#4e606e;--ink-faint:#758490;--line:rgba(98,82,62,.16);--sea:#1a6f85;--sea-hover:#135a6d;--sea-soft:rgba(26,111,133,.1);--sea-ink:#fffdf8;--coral:#d9624c;--sand:#f6e3c3;--shadow:0 14px 36px rgba(32,48,60,.10),0 2px 8px rgba(32,48,60,.05);--display:'Fraunces',Georgia,serif;--sans:'Plus Jakarta Sans',system-ui,-apple-system,'Segoe UI',sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#131b26;--bg-deep:#0e151f;--surface:#1b2534;--ink:#f3ede3;--ink-soft:#b2c0cc;--ink-faint:#7e90a1;--line:rgba(226,214,196,.14);--sea:#66c8d4;--sea-hover:#7fd6e0;--sea-soft:rgba(102,200,212,.14);--sea-ink:#0c1b23;--coral:#ee826c;--sand:#2a3444;--shadow:0 16px 40px rgba(0,0,0,.34)}}
:root[data-theme="dark"]{--bg:#131b26;--bg-deep:#0e151f;--surface:#1b2534;--ink:#f3ede3;--ink-soft:#b2c0cc;--ink-faint:#7e90a1;--line:rgba(226,214,196,.14);--sea:#66c8d4;--sea-hover:#7fd6e0;--sea-soft:rgba(102,200,212,.14);--sea-ink:#0c1b23;--coral:#ee826c;--sand:#2a3444;--shadow:0 16px 40px rgba(0,0,0,.34)}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
a{color:var(--sea)}
h1,h2,h3{font-family:var(--display);font-weight:600;letter-spacing:-.01em;line-height:1.1;margin:0 0 .4em}
h1{font-size:clamp(40px,7vw,72px)}
h2{font-size:clamp(28px,4vw,40px)}
h3{font-size:24px}
[hidden]{display:none!important}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px max(16px,calc((100vw - 1160px)/2));background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font:600 22px var(--display)}
.brand img{border-radius:8px}
.brand em{font-style:normal;color:var(--sea)}
nav{display:flex;align-items:center;gap:14px}
.quiet{color:var(--ink-soft);text-decoration:none;font-weight:500}
.btn,.bag-btn{appearance:none;border:0;border-radius:999px;background:var(--sea);color:var(--sea-ink);font:600 16px var(--sans);padding:12px 22px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:background .15s,transform .15s}
.btn:hover,.bag-btn:hover{background:var(--sea-hover)}
.btn:active{transform:scale(.98)}
.btn:disabled{opacity:.5;cursor:default}
.btn.ghost{background:transparent;color:var(--sea);box-shadow:inset 0 0 0 1.5px var(--sea)}
.btn.ghost:hover{background:var(--sea-soft)}
.btn.wide{width:100%}
.btn.apple{background:#111;color:#fff}
.btn.apple svg{width:1.1em;height:1.1em}
.bag-btn{padding:9px 16px}
.count{background:var(--sea-ink);color:var(--sea);border-radius:999px;min-width:22px;padding:0 6px;font-size:13px;line-height:22px}
.link{appearance:none;border:0;background:none;color:var(--sea);font:inherit;text-decoration:underline;cursor:pointer;padding:0}
main{max-width:1160px;margin:0 auto;padding:0 16px}
.hero{display:grid;grid-template-columns:1.05fr 1fr;gap:32px;align-items:center;padding:48px 0 24px}
.kicker{text-transform:uppercase;letter-spacing:.14em;font-size:13px;font-weight:700;color:var(--coral);margin:0 0 10px}
.lede{font-size:19px;color:var(--ink-soft);max-width:34em}
.hero-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}
.hero-art{aspect-ratio:1;border-radius:32px;background:radial-gradient(circle at 30% 25%,#cfe9ee,#8fd0e6 60%,#2fa4bb);position:relative;overflow:hidden;box-shadow:var(--shadow)}
.hero-art svg{position:absolute}
.status{min-height:1.5em;color:var(--ink-soft);font-size:15px;margin:10px 0 0}
.status.bad{color:var(--coral)}
.set{margin:40px 0;border-radius:32px;background:var(--surface);box-shadow:var(--shadow);display:grid;grid-template-columns:1.2fr 1fr;overflow:hidden}
.set-art{background:var(--sand);display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:24px;align-content:center}
.set-art .pic{background:transparent;box-shadow:none}
.set-copy{padding:36px}
.set-copy .price{font-size:28px}
.was{color:var(--ink-faint);text-decoration:line-through;font-size:18px;margin-left:8px;font-weight:400}
.grid-wrap{margin:56px 0}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.card{appearance:none;border:0;text-align:left;font:inherit;color:inherit;background:var(--surface);border-radius:24px;padding:14px 14px 18px;box-shadow:0 2px 10px rgba(38,49,58,.06);cursor:pointer;transition:transform .15s,box-shadow .15s;display:flex;flex-direction:column}
.card:hover{transform:translateY(-3px);box-shadow:var(--shadow)}
.card[aria-disabled="true"]{cursor:default;opacity:.7}
.card[aria-disabled="true"]:hover{transform:none}
.pic{aspect-ratio:1;border-radius:18px;background:var(--bg-deep);display:grid;place-items:center;overflow:hidden}
.pic svg{width:86%;height:86%}
.card h3{font-size:20px;margin:14px 4px 2px}
.card p{margin:0 4px;color:var(--ink-soft);font-size:15px}
.card .price{margin:10px 4px 0}
.price{font-weight:700;font-size:18px;color:var(--ink);margin:0 0 12px}
.tag{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:var(--sea-soft);color:var(--sea);border-radius:999px;padding:2px 10px;margin-left:6px;vertical-align:middle}
.swatches{display:flex;gap:6px;margin:10px 4px 0}
.swatches i{width:14px;height:14px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)}
.yours{margin:56px 0;display:grid;grid-template-columns:1fr 1.1fr;gap:32px;align-items:start;background:linear-gradient(160deg,var(--sea-soft),transparent 60%);border-radius:32px;padding:36px}
.yours-products{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.signin-buttons{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:8px}
.who{color:var(--ink-soft)}
.beaches{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.beach{appearance:none;border:0;font:inherit;color:inherit;background:var(--surface);border-radius:16px;padding:8px;cursor:pointer;text-align:left;box-shadow:inset 0 0 0 2px transparent}
.beach[aria-checked="true"]{box-shadow:inset 0 0 0 2px var(--sea)}
.beach img{width:100%;aspect-ratio:1800/945;object-fit:cover;border-radius:10px;display:block;background:var(--bg-deep)}
.beach span{display:block;font-size:14px;font-weight:600;margin:6px 2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.foot{display:flex;gap:20px;justify-content:center;flex-wrap:wrap;padding:40px 16px 56px;color:var(--ink-faint);font-size:14px}
.foot a{color:var(--ink-soft)}
dialog{border:0;padding:0;border-radius:28px;background:var(--surface);color:var(--ink);box-shadow:0 30px 80px rgba(0,0,0,.3);max-width:min(880px,calc(100vw - 24px));width:100%;max-height:calc(100dvh - 24px)}
dialog::backdrop{background:rgba(16,26,34,.45);backdrop-filter:blur(3px)}
#bag{max-width:min(460px,calc(100vw - 24px))}
.sheet{display:grid;grid-template-columns:1fr 1fr;position:relative}
.sheet-art{background:var(--bg-deep);display:grid;place-items:center;padding:24px}
.sheet-art svg{width:100%;height:auto}
.sheet-body{padding:32px 28px}
.close{position:absolute;top:10px;right:12px;z-index:1;appearance:none;border:0;background:var(--surface);color:var(--ink);width:36px;height:36px;border-radius:50%;font-size:24px;line-height:1;cursor:pointer}
fieldset{border:0;padding:0;margin:0 0 16px}
legend{font-weight:600;margin-bottom:8px;font-size:15px}
legend small{color:var(--ink-faint);font-weight:500;margin-left:6px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{position:relative}
.chip input{position:absolute;opacity:0;inset:0;cursor:pointer;margin:0}
.chip span{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:7px 14px;box-shadow:inset 0 0 0 1.5px var(--line);font-size:15px;font-weight:500}
.chip input:checked+span{box-shadow:inset 0 0 0 2px var(--sea);background:var(--sea-soft)}
.chip input:focus-visible+span{outline:2px solid var(--sea);outline-offset:2px}
.chip i{width:16px;height:16px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.2)}
.part{border-top:1px solid var(--line);padding-top:12px}
.qty{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;margin:4px 0 8px}
.qty input{width:72px;font:inherit;padding:8px 10px;border-radius:12px;border:1.5px solid var(--line);background:var(--bg);color:var(--ink)}
.bag{padding:28px;position:relative}
#bag-lines{list-style:none;padding:0;margin:0 0 12px}
#bag-lines li{display:grid;grid-template-columns:64px 1fr auto;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
#bag-lines .mini{width:64px;height:64px;border-radius:12px;background:var(--bg-deep);display:grid;place-items:center}
#bag-lines .mini svg{width:52px;height:52px}
#bag-lines small{display:block;color:var(--ink-soft)}
#bag-lines .empty{display:block;color:var(--ink-soft);border:0}
.sums{display:grid;grid-template-columns:1fr auto;gap:4px 12px;margin:12px 0}
.sums dt{color:var(--ink-soft)}
.sums dd{margin:0;font-weight:600;text-align:right}
.order-card{max-width:640px;margin:48px auto;background:var(--surface);border-radius:32px;padding:36px;box-shadow:var(--shadow)}
.steps{list-style:none;padding:0;margin:24px 0;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;counter-reset:s}
.steps li{font-size:13px;font-weight:600;color:var(--ink-faint);border-top:4px solid var(--line);padding-top:8px}
.steps li.done{color:var(--sea);border-color:var(--sea)}
.order-lines{list-style:none;padding:0;margin:0}
.order-lines li{padding:10px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:12px}
.order-lines small{display:block;color:var(--ink-soft)}
.order-total{font-weight:700;text-align:right}
@media (max-width:820px){
  .hero,.set,.yours{grid-template-columns:1fr}
  .hero{padding-top:28px}
  .hero-art{order:-1;aspect-ratio:16/10}
  .grid{grid-template-columns:1fr 1fr;gap:12px}
  .card h3{font-size:17px}
  .yours{padding:22px}
  .set-copy{padding:24px}
  .sheet{grid-template-columns:1fr}
  .sheet-art{padding:12px;max-height:38vh}
  .sheet-art svg{max-height:34vh}
  .sheet-body{padding:20px}
  .quiet{display:none}
}
@media (max-width:420px){.grid{grid-template-columns:1fr 1fr}.card p{display:none}.yours-products{grid-template-columns:1fr 1fr}}
`;

function storeScript(settings: string): string {
  return `(() => {
const CFG = ${settings};
const B = CFG.base;
const $ = (id) => document.getElementById(id);
const money = (c) => '$' + (c / 100).toFixed(c % 100 ? 2 : 0);
const BAG_KEY = 'beech.store.bag.v1';
const TOKEN_KEY = 'beech.store.token.v1';
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let token = null;
try { token = sessionStorage.getItem(TOKEN_KEY); } catch {}
let catalog = null;
let bag = store.get(BAG_KEY, []);
let beaches = [];
let chosenBeach = null;
const previews = new Map();
const SAMPLE = B + '/api/sample-beach.png';

// ------------------------------------------------------------ pictures
// Each product is drawn here: its shape in the chosen colour, with the print
// on it (the brand art, or the shopper's beach).
const art = (file, dark) => B + '/merch-art/' + (dark ? file.replace('.png', '-light.png') : file);
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
};
let uid = 0;
function picture(id, color, print) {
  const c = color ? color.hex : '#ffffff';
  const dark = !!(color && color.dark);
  const edge = shade(c, 0.86);
  const k = 'p' + (++uid);
  switch (id) {
    case 'tee': case 'beach-tee': {
      const img = print || art('logo-front.png', dark);
      const box = print ? 'x="122" y="128" width="156" height="82"' : 'x="140" y="108" width="120" height="120"';
      return '<svg viewBox="0 0 400 400"><path d="M140 52 L92 70 L36 128 L76 172 L108 146 L108 352 L292 352 L292 146 L324 172 L364 128 L308 70 L260 52 Q200 92 140 52 Z" fill="' + c + '" stroke="' + edge + '" stroke-width="3" stroke-linejoin="round"/><path d="M140 52 Q200 92 260 52" fill="none" stroke="' + edge + '" stroke-width="5"/><image href="' + img + '" ' + box + ' preserveAspectRatio="xMidYMid meet"' + (print ? ' style="border-radius:6px"' : '') + '/></svg>';
    }
    case 'hoodie': case 'beach-hoodie': {
      const img = print || art('logo-front.png', dark);
      const box = print ? 'x="128" y="140" width="144" height="76"' : 'x="148" y="124" width="104" height="104"';
      return '<svg viewBox="0 0 400 400"><path d="M150 60 Q200 10 250 60 L300 74 L340 140 L372 330 L326 340 L300 196 L300 360 L100 360 L100 196 L74 340 L28 330 L60 140 L100 74 Z" fill="' + c + '" stroke="' + edge + '" stroke-width="3" stroke-linejoin="round"/><path d="M150 60 Q200 120 250 60" fill="' + edge + '" opacity=".55"/><path d="M178 92 L174 140 M222 92 L226 140" stroke="' + edge + '" stroke-width="3" stroke-linecap="round"/><path d="M140 262 L260 262 L276 320 L124 320 Z" fill="none" stroke="' + edge + '" stroke-width="3"/><image href="' + img + '" ' + box + ' preserveAspectRatio="xMidYMid meet"/></svg>';
    }
    case 'hat':
      return '<svg viewBox="0 0 400 400"><path d="M70 236 Q74 108 200 102 Q326 108 330 236 Z" fill="' + c + '" stroke="' + edge + '" stroke-width="3"/><path d="M200 102 L200 236 M130 120 Q150 180 152 236 M270 120 Q250 180 248 236" stroke="' + edge + '" stroke-width="2.5" fill="none"/><path d="M58 236 Q200 214 342 236 Q360 300 200 300 Q40 300 58 236 Z" fill="' + edge + '"/><circle cx="200" cy="104" r="7" fill="' + edge + '"/><image href="' + art('logo-hat.png', dark) + '" x="128" y="150" width="144" height="63" preserveAspectRatio="xMidYMid meet"/></svg>';
    case 'flipflops':
      return '<svg viewBox="0 0 400 400"><defs><pattern id="' + k + '" patternUnits="userSpaceOnUse" width="400" height="400"><image href="' + art('flipflops.png') + '" width="400" height="400"/></pattern></defs><g transform="rotate(-8 140 200)"><path d="M140 40 C 200 40 214 120 200 200 C 190 280 196 360 140 364 C 84 360 92 280 82 200 C 70 120 80 40 140 40 Z" fill="url(#' + k + ')" stroke="#2a3a46" stroke-width="10"/><path d="M90 170 Q140 110 192 170" fill="none" stroke="#1d2d38" stroke-width="12" stroke-linecap="round"/><path d="M140 118 L140 130" stroke="#1d2d38" stroke-width="12" stroke-linecap="round"/></g><g transform="rotate(8 270 200)"><path d="M270 40 C 330 40 340 120 328 200 C 318 280 326 360 270 364 C 214 360 222 280 210 200 C 200 120 210 40 270 40 Z" fill="url(#' + k + ')" stroke="#2a3a46" stroke-width="10"/><path d="M218 170 Q270 110 320 170" fill="none" stroke="#1d2d38" stroke-width="12" stroke-linecap="round"/><path d="M270 118 L270 130" stroke="#1d2d38" stroke-width="12" stroke-linecap="round"/></g></svg>';
    case 'towel':
      return '<svg viewBox="0 0 400 400"><defs><clipPath id="' + k + '"><rect x="110" y="20" width="180" height="360" rx="14"/></clipPath></defs><g transform="rotate(-6 200 200)"><g clip-path="url(#' + k + ')"><image href="' + art('towel.png') + '" x="110" y="20" width="180" height="360" preserveAspectRatio="none"/></g><rect x="110" y="20" width="180" height="360" rx="14" fill="none" stroke="#e8dcc6" stroke-width="5"/><path d="M110 352 L290 352" stroke="#fff" stroke-width="4" stroke-dasharray="6 6" opacity=".7"/></g></svg>';
      return '<svg viewBox="0 0 400 400"><path d="M44 178 Q40 150 70 148 L168 148 Q186 150 182 176 L174 226 Q168 254 136 254 L92 254 Q62 254 56 226 Z" fill="#1d2d38"/><path d="M356 178 Q360 150 330 148 L232 148 Q214 150 218 176 L226 226 Q232 254 264 254 L308 254 Q338 254 344 226 Z" fill="#1d2d38"/><path d="M70 160 L160 160 L150 220 Q146 240 124 240 L94 240 Q76 240 72 220 Z" fill="#2fa4bb" opacity=".85"/><path d="M330 160 L240 160 L250 220 Q254 240 276 240 L306 240 Q324 240 328 220 Z" fill="#2fa4bb" opacity=".85"/><path d="M78 168 L120 168" stroke="#8ff0de" stroke-width="6" stroke-linecap="round" opacity=".8"/><path d="M282 168 L322 168" stroke="#8ff0de" stroke-width="6" stroke-linecap="round" opacity=".8"/><path d="M182 168 Q200 156 218 168" fill="none" stroke="#1d2d38" stroke-width="10"/><path d="M44 160 L14 150 M356 160 L386 150" stroke="#1d2d38" stroke-width="10" stroke-linecap="round"/></svg>';
  }
  return '';
}
const firstColor = (p) => p.colors[0];
const productOf = (id) => catalog.products.find((p) => p.id === id);

// ------------------------------------------------------------ the shop
function setStatus(id, text, bad) {
  const el = $(id);
  el.textContent = text || '';
  el.classList.toggle('bad', !!bad);
}

function renderShop() {
  const set = productOf('set');
  const parts = set.parts.map(productOf);
  const full = parts.reduce((s, p) => s + p.cents, 0);
  $('set').innerHTML =
    '<div class="set-art">' + parts.map((p) => '<div class="pic">' + picture(p.id, firstColor(p)) + '</div>').join('') + '</div>' +
    '<div class="set-copy"><p class="kicker">The whole beach set</p><h2>Everything, together</h2><p class="lede">' + esc(set.blurb) + '. Pick your colours and sizes for each.</p>' +
    '<p class="price">' + money(set.cents) + '<span class="was">' + money(full) + '</span></p>' +
    '<button class="btn" type="button" id="set-open"' + (set.available ? '' : ' disabled') + '>' + (set.available ? 'Choose the set' : 'Sold out') + '</button></div>';
  $('set-open').onclick = () => openSheet('set');
  const place = (svg, style) => svg.replace('<svg ', '<svg style="' + style + '" ');
  $('hero-art').innerHTML =
    place(picture('hoodie', productOf('hoodie').colors[0]), 'left:4%;top:8%;width:62%') +
    place(picture('tee', productOf('tee').colors[2]), 'right:2%;bottom:4%;width:54%;transform:rotate(6deg)') +
    place(picture('hat', productOf('hat').colors[0]), 'right:6%;top:4%;width:34%;transform:rotate(-10deg)');
  const grid = ['tee', 'hoodie', 'hat', 'flipflops', 'towel'].map(productOf);
  $('grid').innerHTML = grid.map(card).join('');
  $('yours-products').innerHTML = ['beach-tee', 'beach-hoodie'].map(productOf).map(card).join('');
  document.querySelectorAll('.card').forEach((el) => {
    el.onclick = () => { if (el.getAttribute('aria-disabled') !== 'true') openSheet(el.dataset.id); };
  });
  if (!catalog.open) setStatus('store-status', 'The store opens soon. Have a look around.');
}
function card(p) {
  const print = p.beachPrint ? (chosenBeach && previews.get(chosenBeach)) || SAMPLE : null;
  const sw = p.colors.length > 1 ? '<span class="swatches">' + p.colors.map((c) => '<i style="background:' + c.hex + '"></i>').join('') + '</span>' : '';
  return '<button type="button" class="card" data-id="' + p.id + '"' + (p.available ? '' : ' aria-disabled="true"') + '>' +
    '<span class="pic">' + picture(p.id, firstColor(p), print) + '</span>' +
    '<h3>' + esc(p.name) + (p.available ? '' : '<span class="tag">Sold out</span>') + '</h3><p>' + esc(p.blurb) + '</p>' + sw +
    '<span class="price">' + money(p.cents) + '</span></button>';
}
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => '&#' + ch.charCodeAt(0) + ';');

// ------------------------------------------------------------ the product sheet
let sheetProduct = null;
function optionsFor(p, prefix) {
  let h = '';
  if (p.colors.length > 1) {
    h += '<fieldset><legend>Colour <small data-for="' + prefix + 'color"></small></legend><div class="chips">' +
      p.colors.map((c, i) => '<label class="chip"><input type="radio" name="' + prefix + 'color" value="' + c.id + '"' + (i === 0 ? ' checked' : '') + '><span><i style="background:' + c.hex + '"></i>' + esc(c.name) + '</span></label>').join('') + '</div></fieldset>';
  }
  if (p.sizes.length > 1) {
    h += '<fieldset><legend>Size</legend><div class="chips">' +
      p.sizes.map((s) => '<label class="chip"><input type="radio" name="' + prefix + 'size" value="' + esc(s) + '"' + (s === 'M' ? ' checked' : '') + '><span>' + esc(s) + '</span></label>').join('') + '</div></fieldset>';
  }
  return h;
}
const picked = (name) => document.querySelector('input[name="' + name + '"]:checked')?.value;
function openSheet(id) {
  const p = productOf(id);
  sheetProduct = p;
  $('sheet-name').textContent = p.name;
  $('sheet-price').textContent = money(p.cents);
  $('sheet-qty').value = 1;
  setStatus('sheet-status', '');
  if (p.parts) {
    $('sheet-options').innerHTML = p.parts.map(productOf).filter((x) => x.colors.length > 1 || x.sizes.length > 1)
      .map((x) => '<div class="part"><h4 style="margin:0 0 8px;font:600 16px var(--sans)">' + esc(x.name.replace('Beech ', '')) + '</h4>' + optionsFor(x, x.id + '-') + '</div>').join('');
  } else {
    $('sheet-options').innerHTML = optionsFor(p, '');
  }
  if (p.beachPrint && !chosenBeach) setStatus('sheet-status', token ? 'Pick one of your beaches first.' : 'Sign in to pick your beach.');
  $('sheet-add').disabled = !p.available || !catalog.open || (p.beachPrint && !chosenBeach);
  $('sheet-add').textContent = !catalog.open ? 'Opening soon' : 'Add to bag';
  drawSheet();
  $('sheet-options').onchange = drawSheet;
  $('sheet').showModal();
}
function drawSheet() {
  const p = sheetProduct;
  if (p.parts) {
    $('sheet-art').innerHTML = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:100%">' +
      p.parts.map(productOf).map((x) => picture(x.id, x.colors.find((c) => c.id === picked(x.id + '-color')) || firstColor(x))).join('') + '</div>';
    return;
  }
  const color = p.colors.find((c) => c.id === picked('color')) || firstColor(p);
  $('sheet-art').innerHTML = picture(p.id, color, p.beachPrint ? (chosenBeach && previews.get(chosenBeach)) || SAMPLE : null);
}
$('sheet-add').onclick = () => {
  const p = sheetProduct;
  const quantity = Math.max(1, Math.min(10, parseInt($('sheet-qty').value, 10) || 1));
  const line = { product: p.id, quantity };
  if (p.parts) {
    line.parts = {};
    for (const x of p.parts.map(productOf)) line.parts[x.id] = { color: picked(x.id + '-color') || firstColor(x).id, size: picked(x.id + '-size') || x.sizes[0] };
  } else {
    line.color = picked('color') || firstColor(p).id;
    line.size = picked('size') || p.sizes[0];
    if (p.beachPrint) {
      line.beachId = chosenBeach;
      line.beachName = (beaches.find((b) => b.id === chosenBeach) || {}).name || 'your beach';
    }
  }
  bag.push(line);
  saveBag();
  $('sheet').close();
  openBag();
};

// ------------------------------------------------------------ the bag
function saveBag() {
  store.set(BAG_KEY, bag);
  $('bag-count').textContent = bag.reduce((s, l) => s + l.quantity, 0);
}
function lineLabel(l) {
  const p = productOf(l.product);
  if (!p) return '';
  if (l.parts) return p.parts.map(productOf).map((x) => {
    const c = l.parts[x.id] || {};
    const bits = [];
    if (x.colors.length > 1) bits.push((x.colors.find((y) => y.id === c.color) || {}).name);
    if (x.sizes.length > 1) bits.push(c.size);
    return bits.length ? x.name.replace('Beech ', '') + ': ' + bits.join(', ') : '';
  }).filter(Boolean).join(' · ');
  const bits = [];
  if (l.beachName) bits.push(l.beachName);
  if (p.colors.length > 1) bits.push((p.colors.find((y) => y.id === l.color) || {}).name);
  if (p.sizes.length > 1) bits.push(l.size);
  return bits.join(' · ');
}
function openBag() {
  bag = bag.filter((l) => productOf(l.product));
  const list = $('bag-lines');
  if (!bag.length) list.innerHTML = '<li class="empty">Your bag is empty.</li>';
  else list.innerHTML = bag.map((l, i) => {
    const p = productOf(l.product);
    const color = p.colors.find((c) => c.id === l.color) || firstColor(p);
    const pic = p.parts ? picture('towel') : picture(p.id, color, p.beachPrint ? previews.get(l.beachId) : null);
    return '<li><span class="mini">' + pic + '</span><span><strong>' + esc(p.name) + (l.quantity > 1 ? ' × ' + l.quantity : '') + '</strong><small>' + esc(lineLabel(l)) + '</small>' +
      '<button class="link" type="button" data-remove="' + i + '">Remove</button></span><strong>' + money(p.cents * l.quantity) + '</strong></li>';
  }).join('');
  list.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = () => { bag.splice(+b.dataset.remove, 1); saveBag(); openBag(); }));
  const sub = bag.reduce((s, l) => s + productOf(l.product).cents * l.quantity, 0);
  const ship = !bag.length ? 0 : sub >= catalog.shipping.freeFromCents ? 0 : catalog.shipping.cents;
  $('bag-subtotal').textContent = money(sub);
  $('bag-shipping').textContent = !bag.length ? '—' : ship ? money(ship) : 'Free';
  $('checkout').disabled = !bag.length || !catalog.open;
  $('checkout').textContent = catalog.open ? 'Check out · ' + money(sub + ship) : 'Opening soon';
  setStatus('bag-status', '');
  if (!$('bag').open) $('bag').showModal();
}
$('bag-open').onclick = openBag;
$('checkout').onclick = async () => {
  $('checkout').disabled = true;
  setStatus('bag-status', 'Taking you to checkout…');
  try {
    const lines = bag.map(({ beachName, ...l }) => l);
    const r = await fetch(B + '/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ lines }) });
    const out = await r.json().catch(() => ({}));
    if (r.status === 401) signedOut();
    if (!r.ok || !out.url) throw new Error(out.error || 'Checkout didn’t start. Try again.');
    location.href = out.url;
  } catch (e) {
    setStatus('bag-status', e.message, true);
    $('checkout').disabled = false;
  }
};

// ------------------------------------------------------------ signing in, your beaches
async function api(path) {
  const r = await fetch(B + '/api' + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  if (r.status === 401) { signedOut(); throw new Error('Sign in again.'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Something went wrong.');
  return r;
}
function signedOut() {
  token = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
  beaches = [];
  chosenBeach = null;
  $('signin').hidden = false;
  $('signed-in').hidden = true;
  renderShop();
}
async function signedIn(t) {
  token = t;
  try { sessionStorage.setItem(TOKEN_KEY, t); } catch {}
  try {
    const out = await (await api('/my-beaches')).json();
    beaches = out.beaches;
    $('who').textContent = out.user.name;
    $('signin').hidden = true;
    $('signed-in').hidden = false;
    const el = $('beaches');
    if (!beaches.length) { el.innerHTML = '<p>Build a beach in the game first, then come back.</p>'; return; }
    el.innerHTML = beaches.map((b) => '<button class="beach" type="button" role="radio" aria-checked="false" data-id="' + b.id + '"><img alt=""><span>' + esc(b.name) + '</span></button>').join('');
    el.querySelectorAll('.beach').forEach((btn) => (btn.onclick = () => chooseBeach(btn.dataset.id)));
    for (const b of beaches) loadPreview(b.id).then((url) => { const img = el.querySelector('[data-id="' + b.id + '"] img'); if (img && url) img.src = url; });
    await chooseBeach(beaches[0].id);
  } catch (e) {
    setStatus('signin-status', e.message, true);
  }
}
async function loadPreview(id) {
  if (previews.has(id)) return previews.get(id);
  try {
    const blob = await (await api('/beach-preview/' + id)).blob();
    const url = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    previews.set(id, url);
    return url;
  } catch { return null; }
}
async function chooseBeach(id) {
  chosenBeach = id;
  document.querySelectorAll('.beach').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === id)));
  await loadPreview(id);
  $('yours-products').innerHTML = ['beach-tee', 'beach-hoodie'].map(productOf).map(card).join('');
  $('yours-products').querySelectorAll('.card').forEach((el) => (el.onclick = () => openSheet(el.dataset.id)));
}
$('sign-out').onclick = signedOut;

async function signInWith(provider, body) {
  setStatus('signin-status', 'Signing in…');
  try {
    const r = await fetch(B + '/api/auth/' + provider, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || !out.token) throw new Error(out.error || 'Sign-in didn’t go through.');
    setStatus('signin-status', '');
    await signedIn(out.token);
  } catch (e) {
    setStatus('signin-status', e.message, true);
  }
}
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error('could not load sign-in')); document.head.appendChild(s); });
}
async function setUpSignIn() {
  if (CFG.googleClientId) {
    try {
      await loadScript('https://accounts.google.com/gsi/client');
      google.accounts.id.initialize({ client_id: CFG.googleClientId, callback: (r) => signInWith('google', { credential: r.credential }), ux_mode: 'popup', use_fedcm_for_button: true });
      google.accounts.id.renderButton($('google-button'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 240 });
    } catch {}
  }
  if (CFG.appleClientId) {
    $('apple-button').hidden = false;
    $('apple-button').onclick = async () => {
      try {
        if (!window.AppleID) await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
        const redirectURI = location.origin + '/';
        const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
        AppleID.auth.init({ clientId: CFG.appleClientId, scope: 'name email', redirectURI, state, usePopup: true });
        const res = await AppleID.auth.signIn();
        await signInWith('apple', { identityToken: res.authorization.id_token, name: res.user?.name?.firstName ?? '', authorizationCode: res.authorization.code, redirectUri: redirectURI });
      } catch (e) {
        const err = String(e?.error ?? e?.message ?? e);
        if (!/popup_closed_by_user|user_cancelled_authorize|cancel/i.test(err)) setStatus('signin-status', 'Apple sign-in didn’t go through.', true);
      }
    };
  }
  if (!CFG.googleClientId && !CFG.appleClientId) setStatus('signin-status', 'Sign-in opens soon.');
}

// ------------------------------------------------------------ an order
const STEPS = [['paid', 'Paid'], ['sent', 'Being made'], ['shipped', 'Shipped'], ['done', 'Delivered']];
const WORDS = {
  open: ['Waiting for your payment', 'If you paid, this page updates in a moment.'],
  expired: ['Checkout closed', 'Nothing was charged. Your bag is still here.'],
  paid: ['Thank you! It’s paid', 'We’re sending it to the printer now.'],
  sending: ['Thank you! It’s paid', 'We’re sending it to the printer now.'],
  sent: ['It’s being made', 'Printed to order, usually 2–5 days, then it ships.'],
  shipped: ['It’s on its way', ''],
  canceled: ['This order was canceled', 'Your payment was refunded.'],
  refunded: ['This order was refunded', ''],
};
async function showOrder(id) {
  $('shop').hidden = true;
  $('order').hidden = false;
  let tries = 0;
  const load = async () => {
    let o;
    try {
      const r = await fetch(B + '/api/orders/' + id);
      if (!r.ok) throw new Error();
      o = await r.json();
    } catch {
      $('order-title').textContent = 'We couldn’t find that order';
      return;
    }
    const [title, sub] = WORDS[o.status] || ['Your order', ''];
    $('order-title').textContent = title;
    $('order-sub').innerHTML = esc(sub) + (o.status === 'shipped' && o.tracking?.url ? ' <a href="' + esc(o.tracking.url) + '" rel="noopener" target="_blank">Track it' + (o.tracking.carrier ? ' (' + esc(o.tracking.carrier) + ')' : '') + '</a>' : '');
    const at = { open: -1, expired: -1, canceled: -1, refunded: -1, paid: 0, sending: 0, sent: 1, shipped: 2 }[o.status];
    $('order-steps').innerHTML = at < 0 ? '' : STEPS.map(([, w], i) => '<li class="' + (i <= at ? 'done' : '') + '">' + w + '</li>').join('');
    $('order-lines').innerHTML = o.lines.map((l) => '<li><span><strong>' + esc(l.name) + (l.quantity > 1 ? ' × ' + l.quantity : '') + '</strong><small>' + esc([l.beach, l.label].filter(Boolean).join(' · ')) + '</small></span><span>' + money(l.unitCents * l.quantity) + '</span></li>').join('');
    $('order-total').textContent = o.totalCents != null ? 'Total ' + money(o.totalCents) : '';
    if (o.status !== 'open' && o.status !== 'expired') { bag = []; saveBag(); }
    if (o.status === 'open' && ++tries < 15) setTimeout(load, 2000);
  };
  await load();
}

// ------------------------------------------------------------ start
(async () => {
  saveBag();
  try {
    catalog = await (await fetch(B + '/api/catalog')).json();
  } catch {
    setStatus('store-status', 'The store didn’t load. Refresh to try again.', true);
    return;
  }
  const m = location.pathname.slice(B.length).match(/^\\/order\\/([0-9a-f-]{36})$/i);
  if (m) return showOrder(m[1]);
  renderShop();
  setUpSignIn();
  if (token) signedIn(token);
  if (location.pathname.slice(B.length) === '/bag') openBag();
})();
})();`;
}
