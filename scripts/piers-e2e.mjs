// Browser end-to-end test of piers (docs/PIERS.md), against a local server
// (npm run server:dev, which has DEV_AUTH for /api/dev/grant): three beaches
// side by side, buy a pier, preview it, place it, see it from a second
// device and signed out, then unlink and watch it go.
//   node scripts/piers-e2e.mjs [out-dir for screenshots]
import { e2eUrl, openApp, openBrowser } from './lib/e2e.mjs';

const URL_ = process.env.BEECH_URL ?? 'http://127.0.0.1:8787/';
const shots = process.argv[2];
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};

const { browser, close: closeBrowser } = await openBrowser();
const errors = [];
const name = `pier${Date.now() % 100000}`;

async function device(label, signIn = true) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await openApp(page, e2eUrl(URL_, 'nointro&quality=low&fixedres&seed=1&nofinds'));
  await page.evaluate(() => window.__beech.engine.setHardwareScalingLevel(2));
  if (signIn) {
    await page.evaluate((n) => window.__beech.account().signInDev(n), name);
    await page.waitForFunction(() => window.__beech.beachId() && window.__beech.sync().state === 'saved', null, { timeout: 20000 });
  }
  return page;
}
const api = (page, path, init = {}) =>
  page.evaluate(
    async ([p, i]) => {
      const a = window.__beech.account();
      const r = await a.fetch(p, { ...i, headers: { 'Content-Type': 'application/json', ...a.editHeaders(), ...(i.headers ?? {}) } });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [path, init],
  );
const drawn = (page) => page.evaluate(() => window.__beech.neighbors().piersDrawn);

// A: three beaches, home in the middle: left - home - right
const a = await device('A');
await api(a, '/api/dev/grant', { method: 'POST', body: JSON.stringify({ item: 'beach', quantity: 2 }) });
const made = [];
for (const n of ['west', 'east']) made.push((await api(a, '/api/beaches/mine', { method: 'POST', body: JSON.stringify({ name: n }) })).body.beach);
const home = await a.evaluate(() => window.__beech.account().home);
check(!!home && made.every(Boolean), 'A has three beaches');
await api(a, `/api/neighbors/left?beach=${home.id}`, { method: 'PUT', body: JSON.stringify({ code: made[0].code }) });
await api(a, `/api/neighbors/right?beach=${home.id}`, { method: 'PUT', body: JSON.stringify({ code: made[1].code }) });
await a.evaluate(async () => {
  await window.__beech.account().loadBeaches();
  await window.__beech.neighbors().refresh();
});
const site = await a.evaluate((id) => window.__beech.account().mine(id), home.id);
check(site?.pierSite === true && !site.pier, 'the middle beach is a pier site with no pier');
check((await drawn(a)) === 0, 'no pier drawn yet');

// buy it from the shore tab: no sand bucks yet, so the shop opens at the packs
const buyPier = async () => {
  await a.evaluate(() => window.__beech.sheet.show('shore'));
  await a.waitForSelector(`[data-pier-beach="${home.id}"] [data-act="pier-buy"]`, { state: 'attached', timeout: 10000 });
  await a.locator(`[data-pier-beach="${home.id}"] [data-act="pier-buy"]`).evaluate((b) => b.click());
};
await buyPier();
await a.waitForSelector('.shop.open .shop-packs button[data-product="bucks_30"]', { timeout: 60000 });
check(true, 'short of sand bucks: the shop opens at the packs');
await a.click('.shop.open .shop-packs button[data-product="bucks_30"]');
await a.waitForFunction(async () => (await (await window.__beech.account().fetch('/api/credit')).json()).bucks === 30, null, { timeout: 30000 });
await a.evaluate(() => window.__beech.shop()?.close());
// with the bucks, buying shows the preview
await buyPier();
await a.waitForSelector('.pier-preview:not([hidden])', { timeout: 10000 });
await a.waitForTimeout(1500);
check((await drawn(a)) === 1, 'the preview draws the pier');
check((await a.evaluate(() => window.__beech.account().piers)).owned === 1, 'the pier is in the bag');
if (shots) await a.screenshot({ path: `${shots}/pier-preview.png` });

// cancel, then place it for real
await a.click('.pier-preview .pier-cancel');
await a.waitForTimeout(300);
check((await drawn(a)) === 0, 'cancel takes the preview away');
await a.evaluate(() => window.__beech.sheet.show('shore'));
await a.waitForSelector(`[data-pier-beach="${home.id}"] [data-act="pier-place"]`, { state: 'attached', timeout: 10000 });
await a.locator(`[data-pier-beach="${home.id}"] [data-act="pier-place"]`).evaluate((b) => b.click());
await a.waitForSelector('.pier-preview:not([hidden])', { timeout: 10000 });
await a.click('.pier-preview .pier-place');
await a.waitForSelector('.pier-preview', { state: 'hidden', timeout: 10000 });
await a.waitForTimeout(800);
check((await a.evaluate((id) => window.__beech.account().mine(id)?.pier, home.id)) === 'active', 'the pier is placed');
check((await drawn(a)) === 1, 'the placed pier is drawn');
if (shots) {
  await a.evaluate(() => window.__beech.view('chair'));
  await a.waitForTimeout(1500);
  await a.screenshot({ path: `${shots}/pier-chair.png` });
  await a.evaluate(() => window.__beech.view('diorama'));
}

// B: the same player on another device sees it
const b = await device('B');
await b.waitForTimeout(1500);
check((await drawn(b)) === 1, 'a second device draws the pier');

// signed out, the public shore carries it
const pub = await api(b, `/api/public/shore?code=${home.code}&depth=0`);
check(pub.status === 404 || pub.body?.center?.pier === true, 'the public shore shows the pier (once the beach is public)');

// unlink one side: it pauses and disappears, on both devices
await api(a, `/api/neighbors/right?beach=${home.id}`, { method: 'DELETE' });
await a.evaluate(async () => {
  await window.__beech.account().loadBeaches();
  await window.__beech.neighbors().refresh();
});
await b.evaluate(() => window.__beech.neighbors().refresh());
await a.waitForTimeout(500);
check((await a.evaluate((id) => window.__beech.account().mine(id)?.pier, home.id)) === 'paused', 'unlinking pauses the pier');
check((await drawn(a)) === 0 && (await drawn(b)) === 0, 'a paused pier is drawn nowhere');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
await closeBrowser();
process.exit(failed ? 1 : 0);
