// Browser end-to-end test of invites and the beach guide against a local
// server (npm run server:dev), docs/INVITES_GUIDE.md:
// Ana signs in and opens her invite panel. Fran opens Ana's invite link in a
// fresh browser: the start screen says Ana invited her; she signs in, gets the
// welcome parasol, lands on Ana's beach, asks to be her neighbor, then goes
// home and does three guide steps (dig, build, undo). Ana comes back: she's
// told Fran settled in, the parasol is in her bag, and the panel shows Fran.
//   node scripts/invites-e2e.mjs [screenshot-dir]
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}
const URL_ = process.env.BEECH_URL ?? 'http://127.0.0.1:8787/';
const shots = process.argv[2];
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const open = async (url, viewport = { width: 1100, height: 700 }) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
  return page;
};
const signIn = (page, name) =>
  page.evaluate(async (n) => {
    const b = window.__beech;
    if (b.account().user) await b.account().signOut();
    await b.account().signInDev(n);
  }, name);
const owned = (page, item) =>
  page.evaluate(async (i) => (await window.__beech.account().inventory()).filter((x) => x.item === i).reduce((s, x) => s + x.quantity, 0), item);
const hints = (page) => page.$$eval('.hint', (els) => els.map((e) => e.textContent ?? ''));

const tag = Date.now() % 100000;
const ana = `ana${tag}`;
const fran = `fran${tag}`;

// ---- Ana: her code and her (empty) invite panel
const pa = await open(URL_ + '?nointro&fixedres&seed=1&nofinds');
await signIn(pa, ana);
await pa.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 15000 });
const anaCode = await pa.evaluate(() => window.__beech.neighbors().api.get().then((n) => n.code));
await pa.evaluate(() => window.__beech.invites().open());
await pa.waitForSelector('.invite.open .invite-link input', { timeout: 10000 });
const link = await pa.$eval('.invite-link input', (i) => i.value);
check(link.endsWith(`?invite=${anaCode}`), `Ana's invite link carries her code (${link})`);
check((await pa.$eval('.invite-empty', (e) => e.textContent)).includes('Nobody yet'), 'nobody has joined yet');

// ---- Fran: opens the link in a fresh browser
const pf = await open(`${URL_}?invite=${anaCode}&fixedres&seed=1&nofinds`, { width: 390, height: 844 });
await pf.waitForSelector('.start-invite', { timeout: 10000 });
check((await pf.$eval('.start-invite', (e) => e.textContent)).includes(`${ana} invited you`), 'the start screen says who invited her');
check(!(await pf.evaluate(() => location.search.includes('invite'))), 'the invite is taken out of the URL');
if (shots) await pf.screenshot({ path: `${shots}/invite-start.png` });
await pf.click('.start');
await signIn(pf, fran);
await pf.waitForFunction(() => [...document.querySelectorAll('.hint')].some((h) => h.textContent.includes('welcome gift')), null, { timeout: 15000 });
check((await hints(pf)).some((h) => h.includes(`A welcome gift from ${ana}`)), 'Fran is told about her welcome gift');
check((await owned(pf, 'parasol')) === 1, 'the parasol is in her bag');
await pf.waitForFunction((c) => window.__beech.neighbors().visiting?.code === c, anaCode, { timeout: 15000 });
check(true, "she lands on Ana's beach");
if (shots) await pf.screenshot({ path: `${shots}/invite-welcome.png` });
// ask to be neighbors from the note
await pf.click('.hint .hint-action');
await pf.waitForFunction(() => [...document.querySelectorAll('.hint')].some((h) => h.textContent.includes('your neighbor')), null, { timeout: 10000 });
check(true, 'the note asks Ana to be her neighbor');
await pf.waitForFunction(() => window.__beech.guide.done.has('visit'), null, { timeout: 10000 });
check(true, 'visiting Ana counts as the guide’s visit step');

// home, then three guide steps
await pf.evaluate(async () => {
  await window.__beech.neighbors().visit(null);
  window.__beech.cam.goTo(0, true);
});
await pf.waitForTimeout(800);
const drag = async (tool) => {
  await pf.evaluate((t) => window.__beech.pickTool(t), tool);
  await pf.mouse.move(195, 430);
  await pf.mouse.down();
  for (let i = 0; i < 16; i++) {
    await pf.mouse.move(195 + i * 5, 430 + i * 2);
    await pf.waitForTimeout(30);
  }
  await pf.mouse.up();
};
await drag('dig');
await pf.waitForFunction(() => window.__beech.guide.done.has('dig'), null, { timeout: 10000 });
await drag('pile');
await pf.waitForTimeout(300);
await pf.keyboard.press('Control+z');
await pf.waitForFunction(() => ['dig', 'pile', 'undo'].every((s) => window.__beech.guide.done.has(s)), null, { timeout: 10000 });
// the server has them too, with their gifts
await pf.waitForFunction(async () => (await window.__beech.account().inventory()).some((i) => i.item === 'conch'), null, { timeout: 10000 });
check((await owned(pf, 'conch')) >= 2 && (await owned(pf, 'sanddollar')) >= 2, 'guide steps leave gifts in her bag (conches and sand dollars)');
await pf.evaluate(() => window.__beech.guide.open());
await pf.waitForSelector('.guide.open .guide-row.done', { timeout: 5000 });
check((await pf.$$('.guide-row.done')).length >= 4, 'the guide shows four steps done');
if (shots) await pf.screenshot({ path: `${shots}/guide-panel.png` });

// ---- Ana comes back
await signIn(pa, `${ana}-other`);
await signIn(pa, ana);
await pa.waitForFunction(() => [...document.querySelectorAll('.hint')].some((h) => h.textContent.includes('settled in')), null, { timeout: 15000 });
check((await hints(pa)).some((h) => h.includes(`${fran} settled in`) && h.includes('parasol')), 'Ana is told Fran settled in, and what she got');
check((await owned(pa, 'parasol')) === 1, "Ana's parasol is in her bag");
const asks = await pa.evaluate(() => window.__beech.neighbors().api.get().then((n) => n.requests.map((r) => r.name)));
check(asks.includes(fran), 'Fran has asked to be her neighbor');
check(await pa.evaluate(() => window.__beech.guide.done.has('invite')), "Ana's guide has its invite step done");
await pa.evaluate(() => window.__beech.invites().open());
await pa.waitForSelector('.invite.open .invite-friends li b', { timeout: 10000 });
const friends = await pa.$$eval('.invite-friends li', (lis) => lis.map((l) => l.textContent));
check(friends.some((f) => f.includes(fran) && f.includes('settled in')), 'the panel lists Fran as settled in');
check((await pa.$$('.invite-rung.done')).length === 1, 'the first rung is ticked');
if (shots) await pa.screenshot({ path: `${shots}/invite-panel.png` });

// a second sign-in doesn't tell her again
await pa.evaluate(() => document.querySelectorAll('.hint').forEach((h) => h.remove()));
await signIn(pa, `${ana}-other2`);
await signIn(pa, ana);
await pa.waitForTimeout(2000);
const told = (await hints(pa)).filter((h) => h.includes('settled in')).length;
check(told <= 1, 'she is told once');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('all invite checks passed');
