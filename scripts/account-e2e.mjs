// Browser end-to-end test of accounts + saved beaches against a local Worker.
//   VITE_ACCOUNTS=1 VITE_DEV_AUTH=1 npm run build
//   (cd server && npm run migrate:local && npm run dev)
//   node scripts/account-e2e.mjs            # BEECH_URL defaults to http://127.0.0.1:8787/
// Signs in (dev), digs, saves, reloads and checks the beach comes back, then
// deletes the account.
import { createRequire } from 'node:module';

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

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const open = async () => {
  await page.goto(URL_ + '?nointro&fixedres&seed=1');
  await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
  await page.waitForTimeout(800);
};
const dug = () =>
  page.evaluate(() => {
    const b = window.__beech;
    let d = 0;
    for (let k = 0; k < b.rest.length; k++) if (b.rest[k] > 0.5) d += Math.abs(b.picker.sand[k] - b.rest[k]);
    return d;
  });
const syncState = () => page.evaluate(() => window.__beech.sync()?.state ?? 'none');

await open();
check((await page.evaluate(() => !!window.__beech.account())) === true, 'accounts are enabled in this build');
await page.evaluate(() => window.__beech.sheet.show());
await page.waitForTimeout(400);
await page.click('button[data-act="dev"]');
await page.waitForFunction(() => window.__beech.account()?.user, null, { timeout: 10000 });
check(true, 'dev sign in');
await page.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 15000 });
check(true, 'first save created the beach on the server');
await page.evaluate(() => window.__beech.sheet.hide());

// pick a beach and dig
await page.evaluate(() => window.__beech.setBeach('piha'));
await page.mouse.move(300, 560);
await page.mouse.down();
for (let i = 0; i < 25; i++) {
  await page.mouse.move(300 + i * 6, 560 + i * 2);
  await page.waitForTimeout(30);
}
await page.mouse.up();
await page.waitForTimeout(700);
const before = await dug();
check(before > 1, `dug the sand (${before.toFixed(1)})`);
await page.evaluate(() => window.__beech.sync().flush());
check((await syncState()) === 'saved', 'saved after digging');

// a fresh load should bring the same beach back
await open();
await page.waitForFunction(() => window.__beech.sync()?.state === 'saved', null, { timeout: 15000 });
await page.waitForTimeout(800);
const after = await dug();
check(Math.abs(after - before) / before < 0.15, `beach restored after reload (${before.toFixed(1)} -> ${after.toFixed(1)})`);
check((await page.evaluate(() => window.__beech.beach().id)) === 'piha', 'and it is the same real beach (Piha)');
check((await page.evaluate(() => window.__beech.account().user?.name)) === 'tester', 'still signed in');

// delete the account (two taps)
await page.evaluate(() => window.__beech.sheet.show());
await page.waitForTimeout(300);
// both taps in one go: headless rendering is slow enough to miss the confirm window
await page.evaluate(() => {
  const b = document.querySelector('button[data-act="delete"]');
  b.click();
  b.click();
});
await page.waitForFunction(() => !window.__beech.account().user, null, { timeout: 10000 });
check(true, 'account deleted and signed out');
check(await page.isVisible('button[data-act="dev"]'), 'sign-in button is back');

check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await browser.close();
console.log(failed ? `${failed} FAILED` : 'ACCOUNT E2E PASS');
process.exit(failed ? 1 : 0);
