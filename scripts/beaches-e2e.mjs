// Browser end-to-end test of owning more than one beach, against a local
// server (npm run server:dev, which has DEV_AUTH for /api/dev/grant):
// one person on two devices, each running a different beach at the same time.
//   node scripts/beaches-e2e.mjs
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
const errors = [];
const name = `multi${Date.now() % 100000}`;

async function device(label) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await ctx.newPage();
  // a dig can turn up a buried item (1 in 10, server-side): close that popup
  // whenever it shows, so it never lands on top of the next click
  void page.addLocatorHandler(page.locator('.digfind.open'), () => page.click('.digfind-close'));
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('dialog', (d) => void d.accept(d.type() === 'prompt' ? `${label} beach` : undefined));
  await page.goto(URL_ + '?nointro&fixedres&seed=1');
  await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
  await page.evaluate((n) => window.__beech.account().signInDev(n), name);
  await page.waitForFunction(() => window.__beech.account().beachId && window.__beech.sync().state === 'saved', null, { timeout: 20000 });
  return page;
}
const dig = async (page, y) => {
  await page.click('button[data-tool="dig"]');
  await page.mouse.move(300, y);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(300 + i * 8, y);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__beech.sync().flush());
};
const dug = (page) =>
  page.evaluate(() => {
    const b = window.__beech;
    let d = 0;
    for (let k = 0; k < b.rest.length; k++) if (b.rest[k] > 0.5) d += Math.abs(b.picker.sand[k] - b.rest[k]);
    return d;
  });

// device A: dig on the home beach, then get an extra beach and open a new one
const a = await device('A');
const home = await a.evaluate(() => window.__beech.account().beachId);
await dig(a, 540);
const homeDug = await dug(a);
check(homeDug > 1, `A dug the home beach (${homeDug.toFixed(1)})`);
await a.evaluate(() => window.__beech.account().fetch('/api/dev/grant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: 'beach' }) }));
await a.evaluate(() => window.__beech.account().loadBeaches());
await a.evaluate(() => window.__beech.sheet.show());
await a.waitForSelector('button[data-act="new-beach"]', { timeout: 8000 });
await a.click('button[data-act="new-beach"]');
await a.waitForFunction((h) => window.__beech.account().beachId !== h && window.__beech.sync().state === 'saved', home, { timeout: 20000 });
const second = await a.evaluate(() => window.__beech.account().beachId);
await a.waitForTimeout(800);
check((await dug(a)) < homeDug * 0.2, 'A is on a new, untouched beach');
check((await a.evaluate(() => window.__beech.account().beaches.length)) === 2, 'A has two beaches');
await a.evaluate(() => window.__beech.sheet.hide());
await dig(a, 470);
const secondDug = await dug(a);

// device B: the same person opens the app; this device has never chosen, so it shows home
const b = await device('B');
await b.waitForTimeout(800);
check((await b.evaluate(() => window.__beech.account().beachId)) === home, 'B opens the home beach');
const bDug = await dug(b);
check(Math.abs(bDug - homeDug) / homeDug < 0.2, `B shows the home sand A dug (${bDug.toFixed(1)})`);

// both live at once: each device digs its own beach and saves it
await Promise.all([dig(a, 600), dig(b, 420)]);
const [aNow, bNow] = [await dug(a), await dug(b)];
const sands = await b.evaluate(async (ids) => {
  const acct = window.__beech.account();
  const get = async (id) => new Uint8Array(await (await acct.fetch(`/api/beaches/mine/${id}/sand`)).arrayBuffer()).length;
  return [await get(ids[0]), await get(ids[1])];
}, [home, second]);
check(aNow > secondDug && bNow > bDug, `both devices dug at the same time (A ${secondDug.toFixed(0)}->${aNow.toFixed(0)}, B ${bDug.toFixed(0)}->${bNow.toFixed(0)})`);
check(sands[0] > 0 && sands[1] > 0, 'each beach saved separately');

// each beach has its own code and neighbors; connect the two (yours: no asking)
const codes = await a.evaluate(() => window.__beech.account().beaches.map((x) => ({ id: x.id, code: x.code })));
const secondCode = codes.find((c) => c.id === second).code;
check((await a.evaluate(() => window.__beech.neighbors().state?.code)) === secondCode, "A's neighbor panel is for the second beach");
const r = await b.evaluate((c) => window.__beech.neighbors().api.set('left', c), secondCode);
check(r.status === 'linked', 'B links the home beach to the second one at once');
await b.evaluate(() => window.__beech.neighbors().refresh());
check((await b.evaluate(() => window.__beech.neighbors().beachAt(1)?.code)) === secondCode, 'on B the second beach is next door');

// device A remembers its choice after a reload
await a.reload();
await a.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
await a.waitForFunction(() => window.__beech.account().beachId && window.__beech.sync().state === 'saved', null, { timeout: 20000 });
check((await a.evaluate(() => window.__beech.account().beachId)) === second, 'A still opens the second beach after a reload');

check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await browser.close();
console.log(failed ? `${failed} FAILED` : 'BEACHES E2E PASS');
process.exit(failed ? 1 : 0);
