// Browser end-to-end test of the leaderboard against a local server (npm run server:dev):
// Ana, Ben and Cleo save beaches; fans star them (Ana 3, Ben 2, Cleo 1, and
// Cleo's star is the newest). The all-time board orders them by stars; Dot
// opens it, stars Cleo's beach from the board, then visits Ana's from it.
//   node scripts/leaderboard-e2e.mjs [screenshot.png]
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
await page.goto(URL_ + '?nointro&fixedres&seed=1');
await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });

const tag = Date.now() % 100000;
const names = { ana: `ana${tag}`, ben: `ben${tag}`, cleo: `cleo${tag}`, dot: `dot${tag}`, f1: `fanA${tag}`, f2: `fanB${tag}` };
// sign in as someone, save once, and return their code
const become = async (name, save = true) => {
  await page.evaluate(async (n) => {
    const b = window.__beech;
    if (b.account().user) await b.account().signOut();
    await b.account().signInDev(n);
  }, name);
  if (save) await page.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 15000 });
  return page.evaluate(() => window.__beech.neighbors().api.get().then((n) => n.code));
};
const star = (code) => page.evaluate((c) => window.__beech.neighbors().api.favorite(c, true), code);
const codes = {};
for (const k of ['ana', 'ben', 'cleo']) codes[k] = await become(names[k]);
// fans: Ana gets three stars, Ben two, Cleo one
await become(names.f1);
for (const k of ['ana', 'ben']) await star(codes[k]);
await become(names.f2);
for (const k of ['ana', 'ben']) await star(codes[k]);
await become(names.ben);
await star(codes.ana);
await star(codes.cleo);
codes.dot = await become(names.dot);
await page.evaluate(() => window.__beech.neighbors().loadFavorites());

// open the board from the HUD
await page.click('button[data-act="leaderboard"]');
await page.waitForSelector('.board.open .board-row', { timeout: 10000 });
const order = async () =>
  page.$$eval('.board-row', (rows) => rows.map((r) => ({ code: r.dataset.code, count: r.querySelector('.board-count span')?.textContent })));
const ours = (rows) => rows.filter((r) => [codes.ana, codes.ben, codes.cleo].includes(r.code));
let rows = ours(await order());
check(rows.map((r) => r.code).join() === [codes.ana, codes.ben, codes.cleo].join(), `all time: Ana, Ben, Cleo by stars (${rows.map((r) => r.count).join(' / ')})`);
check(rows[0]?.count === '★ 3', 'Ana shows 3 stars');
const label = await page.textContent(`.board-row[data-code="${codes.ana}"] .board-who b`);
check(label === names.ana, `rows name the owner (${label})`);

// rising: all of these are this week's stars
await page.click('.board-tabs button[data-board="rising"]');
await page.waitForFunction(() => document.querySelector('.board-tabs button[data-board="rising"]').classList.contains('on'));
await page.waitForFunction((c) => !!document.querySelector(`.board-row[data-code="${c}"]`), codes.cleo, { timeout: 5000 });
rows = ours(await order());
check(rows.length === 3 && rows[0].code === codes.ana && rows[0].count === '▲ 3', `rising lists this week's stars (${rows.map((r) => r.count).join(' / ')})`);
if (shot) await page.screenshot({ path: shot });

// star Cleo's beach from the board
await page.click('.board-tabs button[data-board="all"]');
await page.waitForSelector(`button[data-act="board-star-${codes.cleo}"]`, { timeout: 5000 });
await page.click(`button[data-act="board-star-${codes.cleo}"]`);
await page.waitForFunction((c) => window.__beech.neighbors().favorites.has(c), codes.cleo, { timeout: 5000 });
check((await page.textContent(`button[data-act="board-star-${codes.cleo}"]`)) === '★', 'starred Cleo from the board');
check((await page.textContent(`.board-row[data-code="${codes.cleo}"] .board-count span`)) === '★ 2', 'her count went up');
const server = await page.evaluate(() => window.__beech.neighbors().api.leaderboard('all', 100));
const cleo = server.find((e) => e.code === codes.cleo);
check(cleo?.stars === 2 && cleo?.starred === true, 'and the server agrees');
// reopening the board: Cleo now ties Ben on 2 (and is rising faster, so she's ahead)
await page.click('.board-close');
await page.click('button[data-act="leaderboard"]');
await page.waitForFunction((c) => document.querySelector(`button[data-act="board-star-${c}"]`)?.textContent === '★', codes.cleo, { timeout: 5000 });
rows = ours(await order());
check(rows.map((r) => r.code).join() === [codes.ana, codes.cleo, codes.ben].join(), 'reloaded: Ana, then Cleo and Ben on 2 (Cleo newer)');

// visit Ana's beach from the board
await page.click(`button[data-act="board-visit-${codes.ana}"]`);
await page.waitForFunction((n) => window.__beech.neighbors().visiting?.name === n, names.ana, { timeout: 15000 });
check(!(await page.isVisible('.board.open')), 'the board closes on visit');
await page.waitForFunction(() => document.querySelector('.shore-bar .sb-where')?.textContent?.startsWith('Visiting'), null, { timeout: 5000 }).catch(() => {});
check((await page.textContent('.shore-bar .sb-where'))?.includes(names.ana), "the bar says we're visiting Ana");
// star her from the shore bar: the board shows it next time
await page.click('.shore-bar .sb-fav');
await page.waitForFunction((c) => window.__beech.neighbors().favorites.has(c), codes.ana, { timeout: 5000 });
await page.click('button[data-act="leaderboard"]');
await page.waitForFunction((c) => document.querySelector(`.board-row[data-code="${c}"] .board-count span`)?.textContent === '★ 4', codes.ana, { timeout: 5000 }).catch(() => {});
check((await page.textContent(`button[data-act="board-star-${codes.ana}"]`)) === '★', 'a star from the shore bar shows on the board');
check((await page.textContent(`.board-row[data-code="${codes.ana}"] .board-count span`)) === '★ 4', 'Ana has 4 now');
await page.click('.board-close');
await page.click('.shore-bar .sb-home');
await page.waitForFunction(() => window.__beech.neighbors().visiting === null, null, { timeout: 15000 });
check(true, 'home again');

// signed out: the board asks you to sign in
await page.evaluate(() => window.__beech.account().signOut());
await page.click('button[data-act="leaderboard"]');
await page.waitForSelector('.board.open .board-signin', { timeout: 5000 });
check((await page.$$('.board-row')).length === 0, 'signed out: no rows, just a sign-in button');

check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await browser.close();
console.log(failed ? `${failed} FAILED` : 'LEADERBOARD E2E PASS');
process.exit(failed ? 1 : 0);
