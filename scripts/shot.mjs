// Usage: node scripts/shot.mjs <url> <out.png> [width] [height] [waitMs] [actions.js]
// Loads the app in headless Chromium, waits until it reports ready, optionally
// runs an actions module (default export: async (page) => {}), and saves a screenshot.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}

const [url, out, w = '1280', h = '800', wait = '2500', actions] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
await page.waitForTimeout(+wait);
if (actions) {
  const mod = await import(pathToFileURL(path.resolve(actions)).href);
  await mod.default(page);
}
await page.screenshot({ path: out });
const errs = logs.filter((l) => /error|warn/i.test(l));
console.log(errs.slice(0, 20).join('\n') || 'no console errors');
await browser.close();
