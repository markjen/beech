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
// start clean: an earlier, interrupted run may have left the test account behind
await page.evaluate(async () => {
  const a = window.__beech.account();
  await a.signInDev('tester');
  await a.deleteAccount();
});
await page.evaluate(() => window.__beech.sheet.show());
await page.waitForTimeout(400);
await page.click('button[data-act="dev"]');
await page.waitForFunction(() => window.__beech.account()?.user, null, { timeout: 10000 });
check(true, 'dev sign in');
await page.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 15000 });
check(true, 'first save created the beach on the server');
await page.evaluate(() => window.__beech.sheet.hide());

// pick a beach and dig
await page.click('button[data-tool="dig"]');
await page.evaluate(() => window.__beech.setBeach('piha'));
await page.mouse.move(300, 560);
await page.mouse.down();
for (let i = 0; i < 25; i++) {
  await page.mouse.move(300 + i * 6, 560 + i * 2);
  await page.waitForTimeout(30);
}
await page.mouse.up();
// and put a rock and a piece of driftwood high on the beach
await page.evaluate(() => {
  const b = window.__beech;
  b.send({ type: 'placeObject', obj: { kind: 'rock', item: 'rock', x: 9, y: 27, angle: 0.4, size: 0.5, variant: 3 } });
  b.send({ type: 'placeObject', obj: { kind: 'driftwood', item: 'driftwood', x: 22, y: 28, angle: 1, size: 1.5, variant: 2 } });
});
await page.waitForTimeout(700);
const before = await dug();
const kindsBefore = await page.evaluate(() => window.__beech.info().objects.filter((o) => !o.wild).map((o) => o.kind).sort().join());
check(before > 1, `dug the sand (${before.toFixed(1)})`);
await page.evaluate(() => window.__beech.sync().flush());
// (a debounced save from the dig may follow ours: wait for things to settle)
await page.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 15000 }).catch(() => {});
check((await syncState()) === 'saved', 'saved after digging');

// a fresh load should bring the same beach back
await open();
await page.waitForFunction(() => window.__beech.sync()?.state === 'saved', null, { timeout: 15000 });
await page.waitForTimeout(800);
const after = await dug();
check(Math.abs(after - before) / before < 0.15, `beach restored after reload (${before.toFixed(1)} -> ${after.toFixed(1)})`);
const kinds = await page.evaluate(() => window.__beech.info().objects.filter((o) => !o.wild).map((o) => o.kind).sort().join());
check(kinds === kindsBefore && kinds.includes('driftwood') && kinds.includes('rock'), `the rock and driftwood came back too (${kinds})`);
check((await page.evaluate(() => window.__beech.beach().id)) === 'piha', 'and it is the same real beach (Piha)');
check((await page.evaluate(() => window.__beech.account().user?.name)) === 'tester', 'still signed in');

// the claw machine: one free go, the prize goes in the bag and onto the beach
await page.click('button[data-tool="place"]');
await page.click('button[data-act="claw"]');
await page.waitForSelector('.claw.open .claw-go:not([disabled])', { timeout: 10000 });
const odds = await page.textContent('.claw-odds');
check(/Common 70%.*Rare 25%.*Legendary 5%/s.test(odds ?? ''), 'the machine shows its odds');
check((await page.textContent('.claw-note'))?.includes('rests 5 min'), 'it says the claw rests 5 min after this go');
if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/claw.png` });
await page.click('.claw-go');
await page.waitForSelector('.claw-reveal:not([hidden])', { timeout: 60000 });
const prize = await page.textContent('.claw-reveal b');
check(prize === 'Starfish', `first go is the rare starter gift (${prize})`);
check((await page.textContent('.claw-odds'))?.includes('Your first goes are gifts'), 'the machine says the first goes are gifts');
if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/claw-prize.png` });
await page.click('.claw-place');
await page.waitForFunction(() => window.__beech.inventory.current !== null, null, { timeout: 10000 });
const prizeId = await page.evaluate(() => window.__beech.inventory.current);
const countOf = (id) => page.evaluate((i) => window.__beech.info().objects.filter((o) => o.item === i).length, id);
await page.mouse.click(520, 420);
await page.waitForTimeout(800);
if (process.env.DEBUG_E2E)
  console.log(
    'dbg',
    JSON.stringify(
      await page.evaluate(() => {
        const b = window.__beech;
        const nv = b.neighbors();
        return {
          current: b.inventory.current,
          ownVisible: nv?.ownVisible,
          visiting: !!nv?.visiting,
          win: nv?.window,
          objs: b.info().objects.map((o) => o.item),
          beachId: b.account().beachId,
          canPlace: b.inventory.canPlace(b.inventory.current),
          tray: document.querySelector('.inv-tray')?.textContent,
        };
      }),
    ),
  );
check((await countOf(prizeId)) === 1, `the ${prizeId} is on the beach`);
await page.mouse.click(620, 380);
await page.waitForTimeout(800);
check((await countOf(prizeId)) === 1, 'and you can only put down as many as you own');
const again = await page.evaluate(() => window.__beech.account().fetch('/api/pulls/daily', { method: 'POST' }).then((r) => r.status));
check(again === 409, 'then the claw rests (5 minutes after the first go)');
await page.click('button[data-tool="dig"]');

// the shop (a development build uses a pretend store): buy an extra beach and a parasol
await page.click('button[data-tool="place"]');
await page.click('button[data-act="shop"]');
await page.waitForSelector('.shop.open .shop-buy[data-product="beach_1"]', { timeout: 10000 });
check((await page.$$('.shop-item')).length >= 8, 'the shop lists its products');
check((await page.textContent('.shop-item.featured b'))?.includes("Founder's pack"), "the founder's pack is featured first");
if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/shop.png` });
const allowanceBefore = await page.evaluate(() => window.__beech.account().allowance);
await page.click('.shop-buy[data-product="beach_1"]');
await page.waitForFunction((n) => window.__beech.account().allowance > n, allowanceBefore, { timeout: 15000 });
check(true, `bought an extra beach (allowance ${allowanceBefore} -> ${await page.evaluate(() => window.__beech.account().allowance)})`);
await page.click('.shop-buy[data-product="item_parasol"]');
await page.waitForFunction(() => document.querySelector('.shop-note')?.textContent?.includes('Parasol: added'), null, { timeout: 15000 });
await page.click('.shop .claw-close');
await page.click('button[data-tool="place"]');
await page.waitForSelector('.inv-tray.open', { timeout: 5000 });
check((await page.textContent('.inv-tray'))?.includes('Parasol'), 'the parasol is in the bag');
await page.click('button[data-tool="place"]');
await page.click('button[data-tool="dig"]');

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
