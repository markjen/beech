// Browser end-to-end test of visitors and the inbox against a local server
// (npm run server:dev), docs/INBOX_NOTIFICATIONS.md:
// Ana saves her beach. Ben opens a link to it in a fresh browser, signed out,
// and sees it straight away. He taps "leave something", which asks him to
// sign in; after signing in the card opens (and the link counts as Ana's
// invite: bb 50; he's given a parasol). He leaves 4 shells, a quick note and the
// parasol. Ana's mailbox shows it; she opens the inbox, says thanks, reports
// the note and blocks Ben; Ben's next visit doesn't go through.
//   node scripts/inbox-e2e.mjs [screenshot-dir]
import { e2eUrl, openApp, openBrowser } from './lib/e2e.mjs';

const URL_ = process.env.BEECH_URL ?? 'http://127.0.0.1:8787/';
const shots = process.argv[2];
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};

const { browser, close: closeBrowser } = await openBrowser();
const errors = [];
const open = async (query, viewport) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page, e2eUrl(URL_, query, { shots: Boolean(shots) }));
  return page;
};
const owned = (page, item) =>
  page.evaluate(async (i) => (await window.__beech.account().inventory()).filter((x) => x.item === i).reduce((s, x) => s + x.quantity, 0), item);
const hints = (page) => page.$$eval('.hint', (els) => els.map((e) => e.textContent ?? ''));

const tag = `ib${Date.now() % 10000}${process.pid % 100}`;
const ana = `ana${tag}`;
const ben = `ben${tag}`;

// ---- Ana saves her beach
const pa = await open('nointro&fixedres&seed=1&nofinds', { width: 1100, height: 760 });
await pa.evaluate((n) => window.__beech.account().signInDev(n), ana);
await pa.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 30000 });
const anaCode = await pa.evaluate(() => window.__beech.neighbors().api.get().then((n) => n.code));
check(await pa.$eval('.inbox-btn', (b) => b.classList.contains('shown')), 'signed in, the inbox is live');

// ---- Ben opens the link signed out
const pb = await open(`visit=${anaCode}&nointro&fixedres&seed=1&nofinds`, { width: 390, height: 844 });
await pb.waitForFunction((c) => window.__beech.neighbors().visiting?.code === c, anaCode, { timeout: 60000 });
check(!(await pb.evaluate(() => !!window.__beech.account().user)), 'Ben is signed out…');
check(true, "…and sees Ana's beach straight away");
check(await pb.$eval('.inbox-btn', (b) => !b.classList.contains('shown')), 'no inbox while signed out');
// viewing mode: "leave something" is in the expanded status pane at the top left
await pb.click('[data-act="palm"]');
await pb.click('.sp-toggle');
const leave = `.shore-bar [data-act="leave-${anaCode}"]:not([hidden])`;
await pb.waitForSelector(leave, { timeout: 60000 });
check(true, "the status pane offers to leave something on Ana's beach");
if (shots) await pb.screenshot({ path: `${shots}/visit-signed-out.png` });
await pb.click(leave);
check(await pb.evaluate(() => !window.__beech.visitor().isOpen), 'signed out, it asks to sign in instead of opening the card');
await pb.evaluate((n) => window.__beech.account().signInDev(n), ben);
await pb.waitForSelector('.visitor.open .visitor-shell', { timeout: 60000 });
check(true, 'after signing in, the visitor card opens');
await pb.evaluate(() => window.__beech.sheet.hide());
// the link counted as Ana's invite: bb 50 for Ben (docs/INVITES_GUIDE.md)
await pb.waitForFunction(async () => (await (await window.__beech.account().fetch('/api/credit')).json()).bucks === 50, null, { timeout: 60000 });
check(true, 'the visit link counted as an invite: Ben has bb 50');
// and a parasol in his bag to leave her
await pb.evaluate(() => window.__beech.account().fetch('/api/dev/grant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: 'parasol' }) }));
await pb.evaluate(() => window.__beech.refreshOwned?.());
await pb.waitForFunction(() => window.__beech.inventory.ownedCount('parasol') > 0, null, { timeout: 60000 });
// reopen to see the parasol in the gift list (the bag loaded after the card)
await pb.evaluate((c) => window.__beech.visitor().open(c, 'ana'), anaCode);
await pb.waitForSelector('.visitor.open .visitor-gift[data-item="parasol"]', { timeout: 60000 });
check(!(await pb.$('.visitor.open .visitor-gift[data-item="rock"]')), 'free things aren’t offered as gifts');
check(!(await pb.$('.visitor.open .visitor-note')), 'a brand-new account gets quick notes only');

// Allow free text for this card without waiting for the test account to age.
const ratingUrl = `**/api/beaches/${anaCode}/rating`;
const allowFreeText = async (route) => {
  const response = await route.fetch();
  await route.fulfill({ response, json: { ...await response.json(), freeText: true } });
};
await pb.route(ratingUrl, allowFreeText);
await pb.evaluate((c) => window.__beech.visitor().open(c, 'ana'), anaCode);
const note = pb.locator('.visitor.open .visitor-note');
const send = pb.locator('[data-act="visitor-leave"]');
await note.press('Space');
check(await note.inputValue() === ' ', 'the note field accepts the Space key');
check(await send.isDisabled(), 'a whitespace-only note cannot be sent');
await note.pressSequentially('I can add a space');
check(await note.inputValue() === ' I can add a space', 'spaces between words are preserved while typing');
check(await send.isEnabled(), 'a typed note can be sent on its own');
await note.clear();
check(await send.isDisabled(), 'clearing the note disables sending again');
await pb.unroute(ratingUrl, allowFreeText);
await pb.evaluate((c) => window.__beech.visitor().open(c, 'ana'), anaCode);

await pb.click('.visitor-shell[data-shells="4"]');
await pb.click('.visitor-quick button >> text=Lovely beach!');
await pb.click('.visitor-gift[data-item="parasol"]');
if (shots) await pb.screenshot({ path: `${shots}/visitor-card.png` });
await pb.click('[data-act="visitor-leave"]');
await pb.waitForFunction(() => [...document.querySelectorAll('.hint')].some((h) => h.textContent.startsWith('Left ')), null, { timeout: 60000 });
check((await hints(pb)).some((h) => h.includes('parasol') && h.includes('4 shells')), 'Ben is told what he left');
check((await owned(pb, 'parasol')) === 0, 'the parasol left his bag');

// ---- Ana's inbox
await pa.bringToFront();
await pa.evaluate(() => window.__beech.neighbors().refresh()); // the 30 s poll, now
await pa.waitForFunction(() => Number(document.querySelector('.inbox-badge')?.textContent) >= 2, null, { timeout: 60000 });
check(true, 'the mailbox counts what arrived');
await pa.waitForFunction(() => [...document.querySelectorAll('.hint')].some((h) => h.textContent.includes('left you something')), null, { timeout: 60000 });
check(true, 'a note says Ben left something');
check((await owned(pa, 'parasol')) === 1, "the parasol is in Ana's bag");
await pa.evaluate(() => window.__beech.setRail(true));
await pa.click('[data-act="inbox"]');
await pa.waitForSelector('.inbox.open .inbox-row[data-kind="visit"]', { timeout: 60000 });
const visitText = await pa.$eval('.inbox-row[data-kind="visit"]', (r) => r.textContent);
check(visitText.includes(`${ben} visited`) && visitText.includes('Lovely beach!') && visitText.includes('parasol') && visitText.includes('4 shells'), 'the visit row has the note, the gift and the rating');
check(!!(await pa.$('.inbox-row[data-kind="invite_joined"]')), 'and Ben joining through her link');
if (shots) await pa.screenshot({ path: `${shots}/inbox.png` });
await pa.waitForFunction(() => document.querySelector('.inbox-badge')?.hidden, null, { timeout: 60000 });
check(true, 'opening the inbox clears the badge');
const vid = await pa.$eval('.inbox-row[data-kind="visit"]', (r) => r.dataset.id);
await pa.click(`[data-act="thanks-${vid}"]`);
await pa.waitForSelector(`[data-act="thanks-${vid}"]:text("thanked")`, { timeout: 60000 });
check(true, 'say thanks');
await pa.click(`[data-act="report-${vid}"]`);
await pa.waitForSelector(`[data-act="report-${vid}"]:text("reported")`, { timeout: 60000 });
check(true, 'report the note');
await pa.click(`[data-act="block-${vid}"]`);
await pa.click(`[data-act="block-${vid}"]`); // the second tap blocks
await pa.waitForFunction(() => !document.querySelector('.inbox-row[data-kind="visit"]'), null, { timeout: 60000 });
check(true, "blocking Ben takes his rows out of Ana's inbox");

// ---- Ben got the thanks, and can't reach Ana any more
await pb.evaluate(() => window.__beech.inbox().open());
await pb.waitForSelector('.inbox.open .inbox-row[data-kind="visit"]', { timeout: 60000 });
check((await pb.$eval('.inbox-row[data-kind="visit"]', (r) => r.textContent)).includes('Thank'), "Ana's thanks reached Ben");
await pb.evaluate(() => window.__beech.inbox().close());
await pb.evaluate((c) => window.__beech.visitor().open(c, 'ana'), anaCode);
await pb.waitForSelector('.visitor.open .visitor-shell', { timeout: 60000 });
await pb.click('.visitor-shell[data-shells="5"]');
await pb.click('[data-act="visitor-leave"]');
await pb.waitForFunction(() => document.querySelector('.visitor-status')?.textContent?.includes('didn’t go through'), null, { timeout: 60000 });
check(true, "a blocked visitor's rating doesn't go through");

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await closeBrowser();
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('all inbox checks passed');
