// Browser end-to-end test of live beaches (docs/LIVE_SIM.md), against a
// local server (npm run server:dev, which has DEV_AUTH for /api/dev/*):
//   node scripts/live-e2e.mjs        (npm run e2e:live)
// Ana leaves a castle at the waterline and a nautilus in the sea; two days
// pass (/api/dev/age-beach); she opens her beach: the sea has worn the castle
// down, taken the nautilus (back in her bag) and washed things up. "While you
// were away" says so once, and "Put it back as it was" brings it all back.
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}
const URL_ = process.env.BEECH_URL ?? 'http://127.0.0.1:8787/';
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};
const who = `live${Date.now() % 100000}`;

// ------------------------------------------------------------------ the beach, from Node
const api = async (path, init = {}, token) => {
  const r = await fetch(new URL(`api${path}`, URL_), {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : null };
};
const json = (method, data) => ({ method, body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });
const { body: me } = await api('/auth/dev', json('POST', { name: who }));
const token = me.token;
await api('/dev/grant', json('POST', { item: 'nautilus' }), token);

const N = 192;
const SHORE_J = Math.round((16.5 / 32) * N);
const CASTLE = { i0: 60, i1: 72, j0: SHORE_J - 4, j1: SHORE_J + 4 };
const q = new Int16Array(N * N);
for (let j = CASTLE.j0; j <= CASTLE.j1; j++) for (let i = CASTLE.i0; i <= CASTLE.i1; i++) q[j * N + i] = 500;
const sand = deflateSync(Buffer.from(q.buffer));
const objs = deflateSync(Buffer.from(JSON.stringify([{ id: 1, kind: 'nautilus', item: 'nautilus', x: 20, y: 12, angle: 0, size: 0.2, variant: 1 }])));
const bytes = new Uint8Array(12 + sand.length + objs.length);
bytes.set(Buffer.from('BCH2', 'latin1'), 0);
const dv = new DataView(bytes.buffer);
dv.setUint16(4, N, true);
dv.setUint16(6, N, true);
dv.setUint32(8, sand.length, true);
bytes.set(sand, 12);
bytes.set(objs, 12 + sand.length);
const put = await api(
  '/beach',
  {
    method: 'PUT',
    body: bytes,
    headers: { 'X-Beach-Location': 'brighton', 'X-Beach-Nx': String(N), 'X-Beach-Ny': String(N), 'X-Beach-Max': '2000', 'X-Beach-Items': 'nautilus=1' },
  },
  token,
);
check(put.status === 200, `saved a castle at the waterline and a nautilus in the sea (${put.status})`);
check((await api('/dev/age-beach', json('POST', { hours: 48 }), token)).status === 204, 'two days pass with nobody on the beach');

// ------------------------------------------------------------------ Ana opens it
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1000, height: 760 } })).newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL_ + '?nointro&fixedres&seed=1&nofinds');
await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
await page.evaluate((n) => window.__beech.account().signInDev(n), who);
await page.waitForFunction(() => window.__beech.account().beachId && window.__beech.sync().state === 'saved', null, { timeout: 45000 });

const castleTop = () =>
  page.evaluate((c) => {
    const b = window.__beech;
    const g = b.picker;
    // the castle's box in sim metres, on this device's grid
    const n = Math.round(Math.sqrt(b.rest.length));
    const s = n / 192;
    let m = 0;
    for (let j = Math.floor(c.j0 * s); j <= Math.ceil(c.j1 * s); j++)
      for (let i = Math.floor(c.i0 * s); i <= Math.ceil(c.i1 * s); i++) m = Math.max(m, g.sand[j * n + i] - b.rest[j * n + i]);
    return m;
  }, CASTLE);
const things = () => page.evaluate(() => window.__beech.info().objects.filter((o) => !o.wild).map((o) => o.item).sort().join());
const strays = () => page.evaluate(() => window.__beech.info().objects.filter((o) => o.wild).length);

await page.waitForSelector('.hint.choice', { timeout: 15000 }).catch(() => {});
const card = await page.evaluate(() => document.querySelector('.hint.choice')?.textContent ?? '');
check(card.startsWith('While you were away (2 days)'), `"while you were away" (${card})`);
check(card.includes('the sea took 1 thing (back in your bag)'), 'it counts what the sea took');
const top = await castleTop();
check(top < 0.3, `the castle is worn down (${top.toFixed(2)} m of 0.5)`);
check(!(await things()).includes('nautilus'), `the nautilus is gone from the beach (${await things()})`);
check((await strays()) > 0, `the sea washed things up (${await strays()})`);
const mine = await api('/beaches/mine', {}, token);
check(!(mine.body.beaches[0].items?.nautilus > 0), 'the server counts no nautilus placed: it is back in the bag');

// put it back as it was (slow here: a restore, then the beach reloads)
await page.click('.hint.choice button.hint-action');
await page
  .waitForFunction(() => [...document.querySelectorAll('.hint')].some((h) => /before the tide/.test(h.textContent ?? '')), null, { timeout: 45000 })
  .catch(() => {});
const toast = await page.evaluate(() => [...document.querySelectorAll('.hint')].map((h) => h.textContent).join(' | '));
// (the toast is gone after 10 s, which can be before this slow page looks: the server is the check)
console.log(`info "Put it back as it was" toast: ${toast || '(missed)'}`);
const restored = (await api('/checkpoints', {}, token)).body.checkpoints.some((c) => c.kind === 'auto' && /Before the tide/.test(c.name));
check(restored, 'the beach was restored from "Before the tide" (its own "Before restoring" copy is there for Undo)');
await page.waitForFunction(() => window.__beech.info().objects.some((o) => o.item === 'nautilus'), null, { timeout: 20000 }).catch(() => {});
check((await things()).includes('nautilus'), `the nautilus is back (${await things()})`);
const back = await castleTop();
// it's back at the waterline, so the live sea starts on it again at once
check(back > 0.25, `and the castle (${back.toFixed(2)} m, from 0.5)`);

// only once
await page.reload();
await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
await page.waitForFunction(() => window.__beech.account().beachId && window.__beech.sync().state === 'saved', null, { timeout: 45000 });
await page.waitForTimeout(3000);
check(!(await page.$('.hint.choice')), 'the card shows once, not again on the next visit');

// ------------------------------------------------------------------ live viewers (L5)
// Ana is on her beach; Ben visits it; Ana digs; Ben sees it within seconds
const device = async (name) => {
  const p = await (await browser.newContext({ viewport: { width: 1000, height: 760 } })).newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await p.goto(URL_ + '?nointro&fixedres&seed=1&nofinds');
  await p.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
  await p.evaluate((n) => window.__beech.account().signInDev(n), name);
  await p.waitForFunction(() => window.__beech.account().beachId && window.__beech.sync().state === 'saved', null, { timeout: 45000 });
  return p;
};
const ben = await device(`${who}b`);
const code = (await api('/neighbors', {}, token)).body.code;
await ben.evaluate((c) => window.__beech.neighbors().visit(c), code);
await ben.waitForFunction(() => window.__beech.neighbors().snapshot(0) !== null, null, { timeout: 20000 });
const seen0 = await ben.evaluate(() => window.__beech.neighbors().snapshot(0).updatedAt);
// Ana's next heartbeat hears she's being watched
await page.waitForFunction(() => window.__beech.sync().watched, null, { timeout: 30000 }).catch(() => {});
check(await page.evaluate(() => window.__beech.sync().watched), "Ana's app knows someone is watching");
await page.click('button[data-tool="sand"]');
await page.mouse.move(300, 500);
await page.mouse.down();
for (let i = 0; i < 12; i++) await page.mouse.move(300 + i * 8, 500);
await page.mouse.up();
const dugAt = Date.now();
const got = await ben
  .waitForFunction((t) => (window.__beech.neighbors().snapshot(0)?.updatedAt ?? 0) > t, seen0, { timeout: 25000 })
  .then(() => true)
  .catch(() => false);
check(got, `Ben sees Ana's dig ${((Date.now() - dugAt) / 1000).toFixed(1)} s later`);

check(errors.length === 0, `no page errors ${errors.join('; ')}`);
await browser.close();
console.log(failed ? `LIVE E2E: ${failed} FAILED` : 'LIVE E2E PASS');
process.exit(failed ? 1 : 0);
