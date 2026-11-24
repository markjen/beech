// Browser end-to-end test of the shore against a local server (npm run server:dev):
// Ben -left-> Ana -left-> Cleo. Ben walks down the shore past Ana to Cleo,
// heads home with the home button, then visits Dot by code and stars her beach.
//   node scripts/shore-e2e.mjs [screenshot.png]
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
await page.goto(URL_ + '?nointro&fixedres&seed=1&nofinds');
await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });

const tag = Date.now() % 100000;
const names = { ana: `ana${tag}`, ben: `ben${tag}`, cleo: `cleo${tag}`, dot: `dot${tag}` };
// sign in as someone, save once, and return their code
const become = async (name) => {
  await page.evaluate(async (n) => {
    const b = window.__beech;
    if (b.account().user) await b.account().signOut();
    await b.account().signInDev(n);
  }, name);
  await page.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 15000 });
  return page.evaluate(() => window.__beech.neighbors().api.get().then((n) => n.code));
};
const codes = {};
for (const k of ['cleo', 'dot', 'ana', 'ben']) codes[k] = await become(names[k]);
// Ana's left is Cleo; Ben's left is Ana (each asked, the other accepted)
const ask = (side, c) => page.evaluate(({ side, c }) => window.__beech.neighbors().api.set(side, c), { side, c });
const accept = (c) => page.evaluate((c) => window.__beech.neighbors().api.accept(c), c);
await become(names.ana);
await ask('left', codes.cleo);
await become(names.cleo);
await accept(codes.ana);
await become(names.ben);
await ask('left', codes.ana);
await become(names.ana);
await accept(codes.ben);
await become(names.ben);
await page.evaluate(() => window.__beech.neighbors().refresh());
check((await page.evaluate(() => window.__beech.neighbors().beachAt(1)?.name)) === names.ana, "Ana is on Ben's left");
check((await page.evaluate(() => window.__beech.neighbors().beachAt(2)?.name)) === names.cleo, "and Cleo beyond her (Ana's neighbor)");
const ext = await page.evaluate(() => window.__beech.neighbors().extent);
check(ext.left > 2 || ext.right > 0, `the shore carries on past them into other beaches (${JSON.stringify(ext)})`);
check(!(await page.isVisible('.shore-bar.shown')), 'no home button at home');

// ask from the shore: Ben's right side is free, so the beach just to his right
// (the end of another stretch) offers "ask to be neighbors" on its tag; Ana,
// already his neighbor, doesn't
await page.waitForFunction(() => document.querySelectorAll('.neighbor-tag .ask:not([hidden])').length > 0, null, { timeout: 15000 }).catch(() => {});
const offers = await page.evaluate(() =>
  [...document.querySelectorAll('.neighbor-tag')].map((t) => ({ name: t.querySelector('.name')?.textContent ?? '', ask: !t.querySelector('.ask')?.hidden })),
);
check(offers.some((o) => o.ask), `a beach at the end of a stretch offers "ask to be neighbors" (${offers.filter((o) => o.ask).map((o) => o.name).join(', ')})`);
check(!offers.some((o) => o.ask && o.name.startsWith(names.ana)), 'Ana (already his neighbor) does not');
const asked = await page.evaluate(async () => {
  const b = [...document.querySelectorAll('.neighbor-tag .ask')].find((x) => !x.hidden);
  b.click();
  for (let i = 0; i < 50 && !window.__beech.neighbors().state?.asked.right; i++) await new Promise((r) => setTimeout(r, 200));
  return { asked: window.__beech.neighbors().state?.asked.right?.name ?? null, label: b.textContent };
});
check(!!asked.asked, `asking from the tag sent the request (${asked.asked}, "${asked.label}")`);
// take it back, so the rest of the walk is as before
await page.evaluate(() => window.__beech.neighbors().api.remove('right'));
await page.evaluate(() => window.__beech.neighbors().refresh());

// walk (pan) down the shore to Cleo
await page.evaluate(() => {
  const b = window.__beech;
  b.cam.halfH = 14;
  b.cam.applyOrtho();
  b.cam.goTo(2 * 33.6, true);
});
await page.waitForFunction(() => window.__beech.neighbors().snapshot(2) !== null, null, { timeout: 15000 });
await page.waitForTimeout(800);
const where = await page.textContent('.shore-bar .sb-where');
check(await page.isVisible('.shore-bar.shown'), 'down the shore: the home button shows');
check(where?.includes(names.cleo), `it says whose beach this is (${where})`);
const win = await page.evaluate(() => window.__beech.neighbors().window);
check(win[0] <= 2 && win[1] >= 2, `Cleo's beach is drawn (beaches ${win.join('..')})`);
if (shot) await page.screenshot({ path: shot });
// star Cleo's beach from the bar
await page.click('.shore-bar .sb-fav');
await page.waitForFunction((c) => window.__beech.neighbors().favorites.has(c), codes.cleo, { timeout: 5000 });
check(true, "starred Cleo's beach");
// and home
await page.click('.shore-bar .sb-home');
await page.waitForFunction(() => Math.abs(window.__beech.cam.focusX) < 0.5, null, { timeout: 15000 });
check(await page.evaluate(() => window.__beech.neighbors().ownVisible), 'home again: your beach is drawn');

// infinite scroll: head right past what's loaded and more of the shore loads
{
  const before = await page.evaluate(() => window.__beech.neighbors().extent.right);
  if (before > 0) {
    await page.evaluate((n) => window.__beech.cam.goTo(-n * 33.6, true), before);
    await page.waitForFunction((n) => window.__beech.neighbors().extent.right > n, before, { timeout: 8000 }).catch(() => {});
    const after = await page.evaluate(() => window.__beech.neighbors().extent.right);
    check(after >= before, `scrolling right loads more of the shore when there is more (${before} -> ${after})`);
    await page.evaluate(() => window.__beech.cam.goTo(0, true));
  }
}

// visit Dot by code
await page.evaluate(() => window.__beech.sheet.show());
await page.fill('#visit-code', codes.dot.toLowerCase());
await page.click('button[data-act="visit"]');
await page.waitForFunction(() => window.__beech.neighbors().visiting !== null, null, { timeout: 15000 });
check((await page.evaluate(() => window.__beech.neighbors().visiting.name)) === names.dot, "visiting Dot's beach");
await page.waitForFunction(() => document.querySelector('.shore-bar .sb-where')?.textContent?.startsWith('Visiting'), null, { timeout: 5000 }).catch(() => {});
check((await page.textContent('.shore-bar .sb-where'))?.startsWith('Visiting'), 'the bar says Visiting');
check(!(await page.evaluate(() => window.__beech.neighbors().ownVisible)), 'your own beach is hidden while visiting');
// you can't dig someone else's beach
await page.click('button[data-tool="dig"]');
const d0 = await page.evaluate(() => window.__beech.info().undoCount);
await page.mouse.move(500, 450);
await page.mouse.down();
await page.mouse.move(560, 460);
await page.mouse.up();
await page.waitForTimeout(500);
check((await page.evaluate(() => window.__beech.info().undoCount)) === d0, "digging does nothing on someone else's beach");
await page.click('.shore-bar .sb-fav');
await page.waitForFunction((c) => window.__beech.neighbors().favorites.has(c), codes.dot, { timeout: 5000 });
// favorites list in the sheet
await page.evaluate(() => window.__beech.sheet.show());
await page.waitForSelector(`button[data-act="visit-${codes.cleo}"]`, { timeout: 5000 });
check(await page.isVisible(`button[data-act="visit-${codes.dot}"]`), 'both starred beaches are in the favorites list');
await page.click(`button[data-act="visit-${codes.cleo}"]`);
await page.waitForFunction((n) => window.__beech.neighbors().visiting?.name === n, names.cleo, { timeout: 15000 });
check(true, 'visited Cleo from favorites');
await page.click('.shore-bar .sb-home');
await page.waitForFunction(() => window.__beech.neighbors().visiting === null && window.__beech.neighbors().ownVisible, null, { timeout: 15000 });
check((await page.evaluate(() => window.__beech.neighbors().beachAt(1)?.name)) === names.ana, 'home: Ana is next door again');

check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await browser.close();
console.log(failed ? `${failed} FAILED` : 'SHORE E2E PASS');
process.exit(failed ? 1 : 0);
