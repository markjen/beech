// End-to-end smoke test in headless Chromium.
//   node scripts/smoke.mjs                 -> builds nothing; serves dist/ via `vite preview`
//   SMOKE_URL=http://localhost:5173/ node scripts/smoke.mjs   -> test a running dev server
// Checks: app boots, frames flow, a mouse dig changes the sand, undo restores it,
// redo re-applies it, and a quick second finger cancels a touch dig.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}

let server;
let url = process.env.SMOKE_URL;
if (!url) {
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
  url = 'http://localhost:4173/';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('preview server did not start')), 20000);
    server.stdout.on('data', (d) => {
      if (String(d).includes('4173')) {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

const fail = (msg) => {
  console.error('SMOKE FAIL:', msg);
  process.exitCode = 1;
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url + '?seed=1&smoke=1');
  await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
  // dismiss the start screen if present
  await page.mouse.click(5, 5);
  await page.waitForTimeout(800);

  const audioOk = await page.evaluate(() => window.__beech.audio.started);
  if (!audioOk) fail('audio did not start after the first click');
  else console.log('audio started');
  const frames = await page.evaluate(() => window.__beech.frames());
  if (frames < 5) fail(`only ${frames} sim frames arrived`);

  // total |sand - rest| over the dry backshore (waves never reach it, so only
  // the player's strokes change it)
  const diff = () =>
    page.evaluate(() => {
      const b = window.__beech;
      const s = b.picker.sand;
      const r = b.rest;
      let d = 0;
      for (let k = 0; k < s.length; k++) if (r[k] > 0.5) d += Math.abs(s[k] - r[k]);
      return d;
    });
  const settle = () => page.waitForTimeout(700);

  // touch: one finger down, a second finger 60 ms later -> the dig is cancelled
  const beforeTouch = await diff();
  const strokesBefore = await page.evaluate(() => window.__beech.info().undoCount);
  await page.evaluate(async () => {
    const c = document.getElementById('scene');
    const ev = (type, id, x, y) =>
      c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 11, button: 0, buttons: 1 }));
    // (both downs back to back: headless rendering makes timers too slow to
    // reliably land inside the cancel window)
    ev('pointerdown', 11, 300, 480);
    ev('pointermove', 11, 304, 482);
    ev('pointerdown', 12, 700, 420);
    await new Promise((r) => setTimeout(r, 50));
    ev('pointermove', 12, 720, 430);
    ev('pointerup', 12, 720, 430);
    ev('pointerup', 11, 300, 480);
  });
  await settle();
  const afterTouch = await diff();
  const strokesAfter = await page.evaluate(() => window.__beech.info().undoCount);
  if (Math.abs(afterTouch - beforeTouch) > 0.05 || strokesAfter !== strokesBefore)
    fail(`second finger did not cancel the dig (Δ ${(afterTouch - beforeTouch).toFixed(3)}, strokes ${strokesBefore}->${strokesAfter})`);
  else console.log('second-finger cancel ok');

  // touch: a single finger tap-and-drag digs
  await page.evaluate(async () => {
    const c = document.getElementById('scene');
    const ev = (type, x, y) =>
      c.dispatchEvent(new PointerEvent(type, { pointerId: 21, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true, button: 0, buttons: 1 }));
    ev('pointerdown', 250, 520);
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 40));
      ev('pointermove', 250 + i * 8, 520);
    }
    ev('pointerup', 330, 520);
  });
  await settle();
  const touchDug = await diff();
  if (!(touchDug > afterTouch + 0.3)) fail('one-finger touch did not dig');
  else console.log('touch dig ok');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1500);



  const base = await diff();
  await page.mouse.move(300, 560);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(300 + i * 6, 560 + i * 2);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await settle();
  const dug = await diff();
  if (!(dug > base + 0.5)) fail(`dig did not change the sand (base ${base.toFixed(2)}, after ${dug.toFixed(2)})`);
  else console.log(`dig ok (Σ|Δ| ${base.toFixed(2)} -> ${dug.toFixed(2)})`);

  await page.keyboard.press('Control+z');
  await settle();
  const undone = await diff();
  if (!(undone < base + (dug - base) * 0.15)) fail(`undo did not restore (after undo ${undone.toFixed(2)})`);
  else console.log(`undo ok (${undone.toFixed(2)})`);

  await page.keyboard.press('Control+Shift+z');
  await settle();
  const redone = await diff();
  if (!(redone > base + (dug - base) * 0.7)) fail(`redo did not re-apply (${redone.toFixed(2)})`);
  else console.log(`redo ok (${redone.toFixed(2)})`);

  const info = await page.evaluate(() => window.__beech.info());
  console.log(`sim tick ${info.tickMs.toFixed(1)} ms, undo ${info.undoCount}, redo ${info.redoCount}`);
  if (errors.length) fail('page errors: ' + errors.join(' | '));
} finally {
  await browser.close();
  server?.kill();
}
if (!process.exitCode) console.log('SMOKE PASS');
