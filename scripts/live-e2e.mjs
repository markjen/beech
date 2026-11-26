// Browser end-to-end test of live beaches (docs/LIVE_SIM.md), against a
// local server (npm run server:dev, which has DEV_AUTH for /api/dev/*):
//   node scripts/live-e2e.mjs        (npm run e2e:live)
// Ana leaves a castle at the waterline and a nautilus in the sea; two days
// pass (/api/dev/age-beach); she opens her beach: the sea has worn the castle
// down, taken the nautilus (back in her bag) and washed things up. Nothing
// pops up over the beach for it any more: the sea's work is in her inbox
// (one 'tide' row for the day), and "Before the tide" in Manage →
// Checkpoints puts it all back.
import { deflateSync } from 'node:zlib';
import { e2eUrl, openApp, openBrowser, reloadApp } from './lib/e2e.mjs';

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
const { body: edit } = await api('/edit-session', { method: 'POST' }, token);
const put = await api(
  '/beach',
  {
    method: 'PUT',
    body: bytes,
    headers: { 'X-Beach-Location': 'brighton', 'X-Beach-Nx': String(N), 'X-Beach-Ny': String(N), 'X-Beach-Max': '2000', 'X-Beach-Items': 'nautilus=1', 'X-Edit-Token': edit.token },
  },
  token,
);
check(put.status === 200, `saved a castle at the waterline and a nautilus in the sea (${put.status})`);
check((await api('/dev/age-beach', json('POST', { hours: 48 }), token)).status === 204, 'two days pass with nobody on the beach');

// ------------------------------------------------------------------ Ana opens it
const { browser, close: closeBrowser } = await openBrowser();
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1000, height: 760 } })).newPage();
page.on('pageerror', (e) => errors.push(e.message));
await openApp(page, e2eUrl(URL_, 'nointro&fixedres&seed=1&nofinds'));
await page.evaluate((n) => window.__beech.account().signInDev(n), who);
await page.waitForFunction(() => window.__beech.beachId() && window.__beech.sync().state === 'saved', null, { timeout: 45000 });

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

await page.waitForTimeout(3000);
check(!(await page.$('.hint.choice')), 'no "while you were away" card pops up over the beach any more');
// the sea's work is in the inbox instead: one tide row for the day
const inbox = (await api('/inbox', {}, token)).body;
const tide = inbox.entries.find((e) => e.kind === 'tide');
check(!!tide, 'the inbox has the tide row');
check(tide?.payload.tides >= 3, `it counts the tides (${tide?.payload.tides})`);
check(tide?.payload.lost === 1, `it counts what the sea took (${tide?.payload.lost})`);
check(tide?.payload.brought > 0, `it counts what washed up (${tide?.payload.brought})`);
const top = await castleTop();
check(top < 0.3, `the castle is worn down (${top.toFixed(2)} m of 0.5)`);
check(!(await things()).includes('nautilus'), `the nautilus is gone from the beach (${await things()})`);
check((await strays()) > 0, `the sea washed things up (${await strays()})`);
const mine = await api('/beaches/mine', {}, token);
check(!(mine.body.beaches[0].items?.nautilus > 0), 'the server counts no nautilus placed: it is back in the bag');

// put it back as it was: the "Before the tide" checkpoint restores it
// (the same restore the checkpoints panel runs; slow here: a restore, then
// the beach reloads)
const beachId = mine.body.beaches[0].id;
const restoredRes = await api(`/beaches/mine/${beachId}/restore`, json('POST', { checkpoint: tide.payload.checkpoint, mode: 'strict' }), token);
check(restoredRes.status === 200, `restoring "Before the tide" works (${restoredRes.status})`);
const restored = (await api('/checkpoints', {}, token)).body.checkpoints.some((c) => c.kind === 'auto' && /Before the tide/.test(c.name));
check(restored, 'the beach was restored from "Before the tide" (its own "Before restoring" copy is there for Undo)');
await page.waitForFunction(() => window.__beech.info().objects.some((o) => o.item === 'nautilus'), null, { timeout: 20000 }).catch(() => {});
check((await things()).includes('nautilus'), `the nautilus is back (${await things()})`);
const back = await castleTop();
// it's back at the waterline, so the live sea starts on it again at once
check(back > 0.25, `and the castle (${back.toFixed(2)} m, from 0.5)`);

// only once: no card on the next visit either (there never is one now)
await reloadApp(page);
await page.waitForFunction(() => window.__beech.beachId() && window.__beech.sync().state === 'saved', null, { timeout: 45000 });
await page.waitForTimeout(3000);
check(!(await page.$('.hint.choice')), 'no card on the next visit either');

// ------------------------------------------------------------------ live viewers (L5)
// Ana is on her beach; Ben visits it; Ana digs; Ben sees it within seconds
const device = async (name) => {
  const p = await (await browser.newContext({ viewport: { width: 1000, height: 760 } })).newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await openApp(p, e2eUrl(URL_, 'nointro&fixedres&seed=1&nofinds'));
  await p.evaluate((n) => window.__beech.account().signInDev(n), name);
  await p.waitForFunction(() => window.__beech.beachId() && window.__beech.sync().state === 'saved', null, { timeout: 45000 });
  return p;
};
const ben = await device(`${who}b`);
const code = (await api('/neighbors', {}, token)).body.code;
await ben.evaluate((c) => window.__beech.neighbors().visit(c), code);
await ben.waitForFunction(() => window.__beech.neighbors().snapshot(0) !== null, null, { timeout: 20000 });
const seen0 = await ben.evaluate(() => window.__beech.neighbors().snapshot(0).updatedAt);
// Ana's next heartbeat hears she's being watched
await page.waitForFunction(() => window.__beech.sync().watched, null, { timeout: 30000 });
check(await page.evaluate(() => window.__beech.sync().watched), "Ana's app knows someone is watching");
await page.evaluate(() => window.__beech.setRail(true));
await page.click('[data-act="dirt"]');
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
await Promise.all([page, ben].map((p) => p.evaluate(() => { window.__beech.engine.skipFrameRender = true; })));
await closeBrowser();
console.log(failed ? `LIVE E2E: ${failed} FAILED` : 'LIVE E2E PASS');
process.exit(failed ? 1 : 0);
