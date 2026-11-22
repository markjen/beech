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
await page.goto(URL_ + '?nointro&fixedres&seed=1');
await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
await page.waitForTimeout(600);

// Ana: sign in, dig a long trench, save
const anaName = `ana${Date.now() % 100000}`;
await page.evaluate((n) => window.__beech.account().signInDev(n), anaName);
await page.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 15000 });
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

// Ben: sign in, add Ana on the left through the settings sheet
await page.evaluate(() => window.__beech.account().signInDev('ben'));
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
await page.waitForFunction((n) => window.__beech.neighbors().state?.left?.name === n, anaName, { timeout: 15000 }).catch(async (e) => { console.log('panel:', await page.evaluate(() => document.querySelector('.account')?.innerText), JSON.stringify(await page.evaluate(() => window.__beech.neighbors().state))); throw e; });
check(true, 'Ben added Ana as his left neighbor');
check(await page.isVisible('button[data-act="remove-left"]'), 'the sheet shows Ana on the left');
await page.evaluate(() => window.__beech.sheet.hide());

// pan over toward the left neighbor (world +X) and look
await page.evaluate(() => {
  const b = window.__beech;
  b.cam.halfH = 15;
  b.cam.applyOrtho();
  b.cam.camera.target.x = 17;
  b.cam.camera.target.z = 0;
});
await page.waitForTimeout(1500);
const tag = await page.evaluate(() => {
  const t = document.querySelector('.neighbor-tag');
  return t && getComputedStyle(t).display !== 'none' ? t.textContent : null;
});
check(!!tag && tag.includes(anaName), `name tag shows (${tag})`);
check((await page.evaluate(() => window.__beech.cam.maxX)) > 40, 'camera can pan over to the neighbor');
if (shot) await page.screenshot({ path: shot });

// moving away removes it
await page.evaluate(() => window.__beech.neighbors().api.remove('left').then(() => window.__beech.neighbors().refresh()));
await page.waitForTimeout(300);
check((await page.$$('.neighbor-tag')).length === 0, 'moving away removes the neighbor beach');

check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await browser.close();
console.log(failed ? `${failed} FAILED` : 'NEIGHBORS E2E PASS');
process.exit(failed ? 1 : 0);
