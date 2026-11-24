// Browser end-to-end test of neighbors against a local server (see docs/GCP.md):
// Ana digs and saves; Ben puts Ana's beach on his left and sees it there.
//   node scripts/neighbors-e2e.mjs [screenshot.png]
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}
const URL_ = process.env.BEECH_URL ?? 'http://127.0.0.1:8787/';
const shot = process.argv[2];
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
if (process.env.DEBUG_E2E)
  page.on('requestfinished', async (r) => {
    if (r.url().includes('/api/')) console.log('req', r.method(), new URL(r.url()).pathname, (await r.response())?.status(), r.method() === 'GET' && r.url().endsWith('/neighbors') ? (await (await r.response()).text()).slice(0, 90) : '');
  });
await page.goto(URL_ + '?nointro&fixedres&seed=1&nofinds');
await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
await page.waitForTimeout(600);

// Ana: sign in, dig a long trench, save
const anaName = `ana${Date.now() % 100000}`;
await page.evaluate((n) => window.__beech.account().signInDev(n), anaName);
await page.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 15000 });
await page.click('button[data-tool="sand"]');
await page.mouse.move(260, 560);
await page.mouse.down();
for (let i = 0; i < 40; i++) {
  await page.mouse.move(260 + i * 8, 560 - i * 3);
  await page.waitForTimeout(25);
}
await page.mouse.up();
await page.waitForTimeout(500);
await page.evaluate(() => window.__beech.sync().flush());
const anaCode = await page.evaluate(() => window.__beech.neighbors().api.get().then((n) => n.code));
check(/^[A-Z2-9]{6}$/.test(anaCode), `Ana has a neighbor code (${anaCode})`);
await page.evaluate(() => window.__beech.account().signOut());

// Ben: sign in, ask Ana to be on his left through the settings sheet
const benName = `ben${Date.now() % 100000}`;
await page.evaluate((n) => window.__beech.account().signInDev(n), benName);
await page.waitForFunction(() => window.__beech.neighbors()?.state, null, { timeout: 15000 });
// start from an empty left slot (earlier runs may have left one), and let
// the sign-in refresh finish before touching the panel
await page.evaluate(async () => {
  const nv = window.__beech.neighbors();
  await nv.api.remove('left');
  await nv.refresh();
});
await page.evaluate(() => window.__beech.sheet.show());
await page.waitForSelector('#neighbor-left', { timeout: 8000 }).catch(async (e) => { console.log('PANEL', await page.evaluate(() => document.querySelector('.account')?.innerText), JSON.stringify(await page.evaluate(() => window.__beech.neighbors().state))); throw e; });
await page.fill('#neighbor-left', anaCode.toLowerCase());
await page.click('button[data-act="add-left"]');
await page.waitForFunction((n) => window.__beech.neighbors().state?.asked?.left?.name === n, anaName, { timeout: 15000 });
check((await page.textContent('.account .neighbor-section'))?.includes(`waiting for ${anaName}`), 'Ben asked Ana; the sheet says it is waiting for her');
check((await page.evaluate(() => window.__beech.neighbors().state.left)) === null, 'not neighbors until she accepts');
const benCode = await page.evaluate(() => window.__beech.neighbors().state.code);
await page.evaluate(() => window.__beech.sheet.hide());

// Ana sees the request (a dot on the settings button) and accepts it
await page.evaluate(async (n) => {
  await window.__beech.account().signOut();
  await window.__beech.account().signInDev(n);
}, anaName);
await page.waitForFunction(() => window.__beech.neighbors()?.state?.requests?.length > 0, null, { timeout: 15000 });
check(await page.evaluate(() => document.querySelector('.hud-btn.badge') !== null), 'Ana gets a dot on the settings button');
await page.evaluate(() => window.__beech.sheet.show());
await page.click(`button[data-act="accept-${benCode}"]`);
await page.waitForFunction((n) => window.__beech.neighbors().state?.right?.name === n, benName, { timeout: 15000 });
check(true, 'Ana accepted: Ben is on her right');
await page.evaluate(() => window.__beech.sheet.hide());

// back to Ben: Ana is on his left
await page.evaluate(async (n) => {
  await window.__beech.account().signOut();
  await window.__beech.account().signInDev(n);
}, benName);
await page.waitForFunction((n) => window.__beech.neighbors()?.state?.left?.name === n, anaName, { timeout: 15000 });
check(true, 'Ben added Ana as his left neighbor');
check((await page.evaluate(() => window.__beech.neighbors().beachAt(1)?.name)) === anaName, "Ana's beach is next to his");

// pan over toward the left neighbor (world +X) and look
await page.evaluate(() => {
  const b = window.__beech;
  b.cam.halfH = 15;
  b.cam.applyOrtho();
  b.cam.camera.target.x = 17;
  b.cam.camera.target.z = 0;
});
// wait for Ana's beach to load and its tag to show (the shore loads several beaches)
await page
  .waitForFunction(
    (n) => [...document.querySelectorAll('.neighbor-tag')].some((x) => x.textContent.includes(n) && getComputedStyle(x).display !== 'none'),
    anaName,
    { timeout: 20000 },
  )
  .catch(() => {});
const tag = await page.evaluate((n) => {
  const t = [...document.querySelectorAll('.neighbor-tag')].find((x) => x.textContent.includes(n));
  return t && getComputedStyle(t).display !== 'none' ? t.textContent : null;
}, anaName);
check(!!tag && tag.includes(anaName), `name tag shows (${tag})`);
check((await page.evaluate(() => window.__beech.cam.maxX)) > 40, 'camera can pan over to the neighbor');
if (shot) await page.screenshot({ path: shot });

// live: Ana (on another device) puts a rock down and saves; Ben's view picks it up
{
  const before = await page.evaluate(() => window.__beech.neighbors().snapshot('left'));
  const ctx2 = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const ana = await ctx2.newPage();
  await ana.goto(URL_ + '?nointro&fixedres&seed=1&nofinds');
  await ana.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
  await ana.evaluate((n) => window.__beech.account().signInDev(n), anaName);
  await ana.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 15000 });
  await ana.evaluate(() => window.__beech.send({ type: 'placeObject', obj: { kind: 'rock', item: 'rock', x: 12, y: 27, angle: 0, size: 0.5, variant: 2 } }));
  await ana.waitForTimeout(800);
  await ana.evaluate(() => window.__beech.sync().flush());
  if (process.env.DEBUG_E2E) console.log('ana saved', await ana.evaluate(() => JSON.stringify({ state: window.__beech.sync().state, savedAt: window.__beech.sync().savedAt, objs: window.__beech.info().objects.filter((o) => !o.wild).length })));
  await ctx2.close();
  await page.evaluate(() => window.__beech.neighbors().poll());
  if (process.env.DEBUG_E2E) console.log('ben sees', JSON.stringify(await page.evaluate(() => window.__beech.neighbors().snapshot('left'))), 'before', JSON.stringify(before));
  const after = await page.evaluate(() => window.__beech.neighbors().snapshot('left'));
  check(
    !!before && !!after && after.updatedAt > before.updatedAt && after.objects === before.objects + 1,
    `Ben sees Ana's new save without reloading (${before?.objects} -> ${after?.objects} things)`,
  );
}

// moving away removes it
await page.evaluate(() => window.__beech.neighbors().api.remove('left').then(() => window.__beech.neighbors().refresh()));
await page.waitForTimeout(300);
check((await page.evaluate(() => window.__beech.neighbors().state.left)) === null, 'moving away unlinks Ben');
await page.evaluate(async (n) => {
  await window.__beech.account().signOut();
  await window.__beech.account().signInDev(n);
}, anaName);
await page.waitForFunction(() => window.__beech.neighbors()?.state, null, { timeout: 15000 });
check((await page.evaluate(() => window.__beech.neighbors().state.right)) === null, '...and Ana, both ends');

check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await browser.close();
console.log(failed ? `${failed} FAILED` : 'NEIGHBORS E2E PASS');
process.exit(failed ? 1 : 0);
