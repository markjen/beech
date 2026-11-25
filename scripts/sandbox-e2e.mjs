// Browser end-to-end test of the sandbox build (no accounts): the beach is
// kept on the device between visits, and checkpoints live on the device too
// (docs/CHECKPOINTS.md C6). Against a dev server or `vite preview`:
//   npx vite --port 5173 &   then   npm run e2e:sandbox [screenshot.png]
import { e2eUrl, openBrowser } from './lib/e2e.mjs';

const URL_ = process.env.BEECH_URL ?? 'http://localhost:5173/';
const shots = Boolean(process.argv[2]);
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};
const { browser, close: closeBrowser } = await openBrowser();
const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => void d.accept(d.type() === 'prompt' ? 'castle' : undefined));
const open = async () => {
  await page.goto(e2eUrl(URL_, 'nointro&fixedres&seed=1&nofinds&quality=low', { shots }), { waitUntil: 'commit' });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
  await page.waitForTimeout(300);
};
const dug = () => page.evaluate(() => { const b = window.__beech; let d = 0; for (let k = 0; k < b.rest.length; k++) if (b.rest[k] > 0.5) d += Math.abs(b.picker.sand[k] - b.rest[k]); return d; });
await open();
await page.keyboard.press('Escape');
await page.evaluate(() => window.__beech.setRail(true));
await page.click('[data-act="dirt"]');
await page.mouse.move(300, 560); await page.mouse.down();
for (let i = 0; i < 25; i++) { await page.mouse.move(300 + i * 8, 560); await page.waitForTimeout(16); }
await page.mouse.up();
await page.waitForTimeout(300);
const d0 = await dug();
// the tab goes to the back: it saves now
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForTimeout(600);
await open();
const d1 = await dug();
check(d0 > 50 && d1 > d0 * 0.7, `the beach is kept on the device: dug ${d0.toFixed(1)}, after a reload ${d1.toFixed(1)}`);
// a checkpoint, with a thumbnail
await page.evaluate(() => window.__beech.sheet.show('checkpoints'));
await page.waitForSelector('button[data-act="cp-save"]');
await page.click('button[data-act="cp-save"]');
await page.evaluate(() => window.__beech.sheet.setTab('checkpoints'));
await page.waitForSelector('.cp-row .cp-thumb[src]', { timeout: 10000 });
check((await page.textContent('.cp-row')).includes('castle'), 'saved a checkpoint on the device, with a thumbnail');
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
// smooth the beach, then restore
await page.evaluate(() => { const b = document.querySelector('button[data-act="smooth"]'); b.click(); b.click(); });
await page.waitForFunction((lim) => {
  const b = window.__beech; let d = 0;
  for (let k = 0; k < b.rest.length; k++) if (b.rest[k] > 0.5) d += Math.abs(b.picker.sand[k] - b.rest[k]);
  return d < lim;
}, d1 * 0.2, { timeout: 5000 }).catch(() => {});
const d2 = await dug();
await page.evaluate(() => window.__beech.sheet.show('checkpoints'));
await page.click('.cp-row button[data-act^="cp-restore-"]');
await page.waitForFunction((lim) => {
  const b = window.__beech; let d = 0;
  for (let k = 0; k < b.rest.length; k++) if (b.rest[k] > 0.5) d += Math.abs(b.picker.sand[k] - b.rest[k]);
  return d > lim;
}, d1 * 0.7, { timeout: 5000 }).catch(() => {});
const d3 = await dug();
check(d2 < d1 * 0.2 && d3 > d1 * 0.7, `smoothed ${d2.toFixed(1)}, then the checkpoint brought it back: ${d3.toFixed(1)}`);
await page.evaluate(() => { const b = document.querySelector('.cp-row button[data-act^="cp-delete-"]'); b.click(); b.click(); });
await page.waitForFunction(() => !document.querySelector('.cp-row'), null, { timeout: 5000 });
check(true, 'deleted it (two taps)');
check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await closeBrowser();
console.log(failed ? `${failed} FAILED` : 'SANDBOX E2E PASS');
process.exit(failed ? 1 : 0);
