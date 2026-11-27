// Browser end-to-end test of the sandbox build (no accounts): the beach is
// kept on the device between visits, and checkpoints live on the device too
// (docs/CHECKPOINTS.md C6). Against a dev server or `vite preview`:
//   npx vite --port 5173 &   then   npm run e2e:sandbox [screenshot.png]
import { e2eUrl, openApp, openBrowser } from './lib/e2e.mjs';

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
  await openApp(page, e2eUrl(URL_, 'nointro&fixedres&seed=1&nofinds&quality=low', { shots }), 60000);
  await page.evaluate(() => window.__beech.engine.setHardwareScalingLevel(2));
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
// (the worker read and encoding can take a few seconds in a slow container)
await page.waitForFunction(() => !window.__beech.store().isDirty('local'), null, { timeout: 15000 }).catch(() => {});
await open();
// the picker has the sand once the worker's first frame of the kept beach lands
await page.waitForFunction((lim) => {
  const b = window.__beech; let d = 0;
  for (let k = 0; k < b.rest.length; k++) if (b.rest[k] > 0.5) d += Math.abs(b.picker.sand[k] - b.rest[k]);
  return d > lim;
}, d0 * 0.7, { timeout: 10000 }).catch(() => {});
const d1 = await dug();
// Require a real edit and compare what survived, even if the worker processed
// fewer dig frames on a busy runner.
check(d0 > 1 && d1 > d0 * 0.7, `the beach is kept on the device: dug ${d0.toFixed(1)}, after a reload ${d1.toFixed(1)}`);
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
// long-press a thing to pick it up, drag it, let go: it moves (in look mode,
// palm only, and with a tool picked)
const things = () => page.evaluate(() => window.__beech.info().objects.map((o) => ({ id: o.id, item: o.item, x: o.x, y: o.y })));
await page.evaluate(() => window.__beech.sheet.hide());
await page.waitForTimeout(300);
await page.evaluate(() => window.__beech.setRail(true));
await page.evaluate(() => window.__beech.inventory.select('rock'));
await page.waitForTimeout(300);
await page.mouse.click(500, 560);
await page.waitForFunction(() => window.__beech.info().objects.some((o) => o.item === 'rock'), null, { timeout: 5000 }).catch(() => {});
const rockOf = async () => (await things()).find((o) => o.item === 'rock');
check(!!(await rockOf()), 'set a rock down');
const longDrag = async (sx, sy) => {
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.waitForTimeout(700);
  for (let i = 1; i <= 20; i++) { await page.mouse.move(sx + i * 4, sy); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(800);
};
let pressAt = [500, 560];
for (const mode of ['look', 'tool']) {
  if (mode === 'look') await page.evaluate(() => { window.__beech.inventory.select(null); window.__beech.setRail(false); });
  else await page.evaluate(() => { window.__beech.setRail(true); window.__beech.pickTool('dig'); });
  await page.waitForTimeout(300);
  const before = await rockOf();
  // a dragged thing goes down under the pointer: the next press starts there
  await longDrag(...pressAt);
  pressAt = [pressAt[0] + 80, pressAt[1]];
  const after = await rockOf();
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  check(after.id === before.id && moved > 0.5, `${mode} mode: long-press and drag moves the rock (${moved.toFixed(2)} m)`);
}
// the lone palm fades after 5 s of quiet (outside ambient mode) and comes back on a move
await page.evaluate(() => { window.__beech.sheet.hide(); window.__beech.inventory.select(null); window.__beech.setRail(false); });
await page.mouse.move(10, 10);
const palmIdle = () => page.evaluate(() => document.body.classList.contains('palm-idle'));
await page.waitForTimeout(1000);
const early = await palmIdle();
await page.waitForFunction(() => document.body.classList.contains('palm-idle'), null, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(2000); // the 1.2 s fade
const faded = await page.evaluate(() => document.body.classList.contains('palm-idle') && Number(getComputedStyle(document.querySelector('.hud')).opacity));
await page.mouse.move(20, 20);
check(!early && faded < 0.05 && !(await palmIdle()), `the palm fades after a quiet spell and comes back on a move (opacity ${faded})`);
// with the rail open nothing fades
await page.evaluate(() => window.__beech.setRail(true));
await page.mouse.move(30, 30);
await page.waitForTimeout(6000);
check(await page.evaluate(() => getComputedStyle(document.querySelector('.hud')).opacity === '1'), 'with the rail open the controls stay');
check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await closeBrowser();
console.log(failed ? `${failed} FAILED` : 'SANDBOX E2E PASS');
process.exit(failed ? 1 : 0);
