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
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('dialog', (d) => void d.accept(d.type() === 'prompt' ? `${label} beach` : undefined));
  await page.goto(URL_ + '?nointro&fixedres&seed=1&nofinds');
  await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
  await page.evaluate((n) => window.__beech.account().signInDev(n), name);
  await page.waitForFunction(() => window.__beech.account().beachId && window.__beech.sync().state === 'saved', null, { timeout: 20000 });
  return page;
}
const dig = async (page, y) => {
  await page.click('button[data-tool="sand"]');
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

// each beach has its own code and neighbors; connect the two in 1 click on the Shore tab (no code copying)
const codes = await a.evaluate(() => window.__beech.account().beaches.map((x) => ({ id: x.id, code: x.code })));
const secondCode = codes.find((c) => c.id === second).code;
check((await a.evaluate(() => window.__beech.neighbors().state?.code)) === secondCode, "A's neighbor panel is for the second beach");
await b.evaluate(() => window.__beech.sheet.show('shore'));
await b.waitForSelector(`select[data-connect-beach="${home}"][data-connect-side="left"]`, { timeout: 8000 });
await b.selectOption(`select[data-connect-beach="${home}"][data-connect-side="left"]`, secondCode);
await b.waitForFunction((c) => window.__beech.neighbors().beachAt(1)?.code === c, secondCode, { timeout: 15000 });
check((await b.evaluate(() => window.__beech.neighbors().beachAt(1)?.code)) === secondCode, 'on B the second beach is next door via 1-click connect');
await b.evaluate(() => window.__beech.sheet.hide());

// on B (where home is selected/active), pan over to the adjacent second beach and dig directly on it:
// writes must save automatically into the second beach, not home!
const beforeSecondUpdated = await b.evaluate((id) => window.__beech.account().beaches.find((x) => x.id === id)?.updatedAt ?? 0, second);
await b.evaluate(() => {
  const nv = window.__beech.neighbors();
  window.__beech.cam.goTo(nv.xFor(1), true);
});
await b.waitForFunction(() => window.__beech.neighbors().snapshot('left') !== null, null, { timeout: 15000 });
await b.waitForTimeout(400);
await b.click('button[data-tool="sand"]');
await b.mouse.move(420, 460);
await b.mouse.down();
for (let i = 0; i < 18; i++) {
  await b.mouse.move(420 + i * 8, 460);
  await b.waitForTimeout(25);
}
await b.mouse.up();
await b.waitForTimeout(400);
await b.evaluate(() => window.__beech.neighbors().flushAll());
const afterSecondUpdated = await b.evaluate(async (id) => {
  await window.__beech.account().loadBeaches();
  return window.__beech.account().beaches.find((x) => x.id === id)?.updatedAt ?? 0;
}, second);
check((await b.evaluate(() => window.__beech.account().beachId)) === home, 'B still has home selected while editing the adjacent beach');
check(afterSecondUpdated > beforeSecondUpdated, `editing the adjacent beach saved automatically into the second beach (${beforeSecondUpdated} -> ${afterSecondUpdated})`);

// device A remembers its choice after a reload
await a.reload();
await a.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
await a.waitForFunction(() => window.__beech.account().beachId && window.__beech.sync().state === 'saved', null, { timeout: 20000 });
check((await a.evaluate(() => window.__beech.account().beachId)) === second, 'A still opens the second beach after a reload');

check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await browser.close();
console.log(failed ? `${failed} FAILED` : 'BEACHES E2E PASS');
process.exit(failed ? 1 : 0);
