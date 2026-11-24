// Browser end-to-end test of the sandbox build (no accounts): the beach is
// kept on the device between visits, and checkpoints live on the device too
// (docs/CHECKPOINTS.md C6). Against a dev server or `vite preview`:
//   npx vite --port 5173 &   then   npm run e2e:sandbox [screenshot.png]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL_ = process.env.BEECH_URL ?? 'http://localhost:5173/';
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => void d.accept(d.type() === 'prompt' ? 'castle' : undefined));
const open = async () => {
  await page.goto(URL_ + '?nointro&fixedres&seed=1&nofinds');
  await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
  await page.waitForTimeout(1500);
};
const dug = () => page.evaluate(() => { const b = window.__beech; let d = 0; for (let k = 0; k < b.rest.length; k++) if (b.rest[k] > 0.5) d += Math.abs(b.picker.sand[k] - b.rest[k]); return d; });
await open();
await page.click('button[data-tool="sand"]');
await page.mouse.move(300, 560); await page.mouse.down();
for (let i = 0; i < 25; i++) { await page.mouse.move(300 + i * 8, 560); await page.waitForTimeout(30); }
await page.mouse.up();
await page.waitForTimeout(800);
const d0 = await dug();
// the tab goes to the back: it saves now
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForTimeout(1500);
await open();
const d1 = await dug();
check(d0 > 50 && d1 > d0 * 0.7, `the beach is kept on the device: dug ${d0.toFixed(1)}, after a reload ${d1.toFixed(1)}`);
// a checkpoint, with a thumbnail
await page.evaluate(() => window.__beech.sheet.show());
await page.waitForSelector('button[data-act="cp-save"]');
await page.click('button[data-act="cp-save"]');
await page.waitForSelector('.cp-row .cp-thumb[src]', { timeout: 10000 });
check((await page.textContent('.cp-row')).includes('castle'), 'saved a checkpoint on the device, with a thumbnail');
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
// smooth the beach, then restore
await page.evaluate(() => { const b = document.querySelector('button[data-act="smooth"]'); b.click(); b.click(); });
await page.waitForTimeout(1500);
const d2 = await dug();
await page.evaluate(() => window.__beech.sheet.show());
await page.click('.cp-row button[data-act^="cp-restore-"]');
await page.waitForTimeout(1500);
const d3 = await dug();
check(d2 < d1 * 0.2 && d3 > d1 * 0.7, `smoothed ${d2.toFixed(1)}, then the checkpoint brought it back: ${d3.toFixed(1)}`);
await page.evaluate(() => { const b = document.querySelector('.cp-row button[data-act^="cp-delete-"]'); b.click(); b.click(); });
await page.waitForFunction(() => !document.querySelector('.cp-row'), null, { timeout: 5000 });
check(true, 'deleted it (two taps)');
check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await browser.close();
console.log(failed ? `${failed} FAILED` : 'SANDBOX E2E PASS');
process.exit(failed ? 1 : 0);
