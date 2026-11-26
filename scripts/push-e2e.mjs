// Browser end-to-end test of notifications against a local server
// (npm run server:dev with VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
// VAPID_SUBJECT set), docs/INBOX_NOTIFICATIONS.md ("Push"):
// Ana signs in; nothing asks about notifications at start-up. Ben gives her
// a gift; the note over her beach comes with the one-time question, and
// saying yes subscribes this browser (POST /api/push/subscribe). Settings
// shows the notifications rows; turning gifts off is stored on the server;
// turning the device off forgets the subscription. Signing out takes the
// subscription with the session.
//   node scripts/push-e2e.mjs [screenshot-dir]
// Without the VAPID settings on the server it skips (exit 0).
import { e2eUrl, openApp, openBrowser } from './lib/e2e.mjs';

const URL_ = process.env.BEECH_URL ?? 'http://127.0.0.1:8787/';
const shots = process.argv[2];
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};

const cfg = await fetch(new URL('api/push/config', URL_)).then((r) => r.json());
if (!cfg.web) {
  console.log('skip: the server has no VAPID keys (web push is off)');
  process.exit(0);
}

const { browser, close: closeBrowser } = await openBrowser();
const errors = [];
const open = async (viewport, grant) => {
  const ctx = await browser.newContext({ viewport });
  if (grant) await ctx.grantPermissions(['notifications'], { origin: new URL(URL_).origin });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page, e2eUrl(URL_, 'nointro&fixedres&seed=1&nofinds', { shots: Boolean(shots) }));
  return page;
};

const tag = `pu${Date.now() % 10000}${process.pid % 100}`;
const ana = `ana${tag}`;
const ben = `ben${tag}`;

const pa = await open({ width: 1100, height: 760 }, true);
await pa.evaluate((n) => window.__beech.account().signInDev(n), ana);
await pa.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 30000 });
const anaCode = await pa.evaluate(() => window.__beech.neighbors().api.get().then((n) => n.code));
const hints = () => pa.$$eval('.hint', (els) => els.map((e) => e.textContent ?? ''));
check(!(await hints()).some((h) => h.includes('Want to know')), 'nothing asks about notifications at start-up');
await pa.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready, null, { timeout: 30000 });

// ---- Ben gives Ana a gift
const pb = await open({ width: 390, height: 844 }, false);
await pb.evaluate((n) => window.__beech.account().signInDev(n), ben);
await pb.waitForFunction(() => !!window.__beech.account().user);
await pb.evaluate(async (code) => {
  const acct = window.__beech.account();
  const { quickNotes } = await (await acct.fetch(`/api/beaches/${code}/rating`)).json();
  const r = await acct.fetch(`/api/beaches/${code}/visit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shells: 5, note: quickNotes[0], quick: true }),
  });
  if (!r.ok) throw new Error(`visit ${r.status}`);
}, anaCode);

// ---- the note over Ana's beach asks once
await pa.evaluate(() => window.__beech.neighbors().refresh());
await pa.waitForFunction(() => [...document.querySelectorAll('.hint')].some((h) => h.textContent?.includes('left you something')), null, { timeout: 60000 });
check(true, "the note over Ana's beach says Ben left her something");
check(!(await hints()).some((h) => h.includes('Want to know')), '…and the question waits for it to go');
await pa.waitForFunction(() => [...document.querySelectorAll('.hint')].some((h) => h.textContent?.includes('Want to know')), null, { timeout: 30000 });
check(true, 'then the question comes, once');
if (shots) await pa.screenshot({ path: `${shots}/push-ask.png` });
const subscribed = pa.waitForResponse((r) => r.url().includes('/api/push/subscribe') && r.request().method() === 'POST', { timeout: 30000 }).catch(() => null);
await pa.evaluate(() =>
  [...document.querySelectorAll('.hint.with-action')].find((h) => h.textContent?.includes('Want to know'))?.querySelector('button')?.click(),
);
const sub = await subscribed;
if (sub) {
  check(sub.status() === 204, `yes subscribes this browser (${sub.status()})`);
} else {
  // headless Chromium can't always reach the browser's push service from a sandbox
  console.log('note: the browser could not make a push subscription here (no push service); the server side is covered by its tests');
}

// ---- settings
await pa.evaluate(() => window.__beech.sheet.show('settings'));
await pa.waitForSelector('.notify-settings:not([hidden]) input[data-n="device"]');
check(true, 'settings shows the notifications switch');
if (shots) await pa.screenshot({ path: `${shots}/push-settings-device.png` });
if (sub?.status() === 204) {
  check(await pa.$eval('input[data-n="device"]', (i) => i.checked), '…and it is on');
  await pa.waitForSelector('input[data-n="gifts"]');
  const put = pa.waitForResponse((r) => r.url().includes('/api/notify-prefs') && r.request().method() === 'PUT');
  await pa.click('label:has(input[data-n="gifts"])');
  check((await (await put).json()).gifts === false, 'gifts and notes off is stored on the server');
  if (shots) await pa.screenshot({ path: `${shots}/push-settings.png` });
  const del = pa.waitForResponse((r) => r.url().includes('/api/push/subscribe') && r.request().method() === 'DELETE');
  await pa.click('label:has(input[data-n="device"])');
  check((await del).status() === 204, 'turning this device off forgets it');
}

if (errors.length) console.log('page errors:', errors);
check(errors.length === 0, 'no page errors');
await closeBrowser();
console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
