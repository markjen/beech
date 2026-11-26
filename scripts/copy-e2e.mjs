// Browser end-to-end test of copying a beach (docs/COPY_BEACH.md) against a
// local server (npm run server:dev, which has DEV_AUTH for /api/dev/grant and
// the pretend store):
//   node scripts/copy-e2e.mjs [screenshot-dir]        (npm run e2e:copy)
// Ana's beach has a lighthouse and two rocks. Ben opens beechshore.com's
// "Copy to my beach" link (?visit=CODE&copy=1) signed out, signs in, and the
// copy sheet opens: he has no lighthouse. He copies without it onto his home,
// then Undo puts his beach back. He buys what's missing from the sheet and
// copies the whole beach. Ana hears about it, once, and her beechshore page
// says it was copied.
import { deflateSync } from 'node:zlib';
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
  page.on('dialog', (d) => void d.accept());
  await openApp(page, e2eUrl(URL_, query, { shots: Boolean(shots) }));
  return page;
};
const api = (page, url, init) =>
  page.evaluate(
    async ([u, i]) => {
      const r = await window.__beech.account().fetch(u, i);
      return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
    },
    [url, init],
  );
const things = (page) => page.evaluate(() => window.__beech.info().objects.filter((o) => !o.wild).map((o) => o.item).sort().join());

/** a saved beach (BCH2, 16×16 flat sand) with a lighthouse and two rocks */
function anaBeach() {
  const objects = [
    { id: 1, item: 'lighthouse', kind: 'lighthouse', x: 16, y: 22, angle: 0, size: 1, variant: 0 },
    { id: 2, item: 'rock', kind: 'rock', x: 12, y: 21, angle: 0, size: 0.5, variant: 1 },
    { id: 3, item: 'rock', kind: 'rock', x: 20, y: 21, angle: 0, size: 0.4, variant: 2 },
  ];
  const sand = deflateSync(Buffer.from(new Int16Array(16 * 16).fill(120).buffer));
  const objs = deflateSync(Buffer.from(JSON.stringify(objects)));
  const out = Buffer.alloc(12 + sand.length + objs.length);
  out.write('BCH2', 0, 'latin1');
  out.writeUInt16LE(16, 4);
  out.writeUInt16LE(16, 6);
  out.writeUInt32LE(sand.length, 8);
  sand.copy(out, 12);
  objs.copy(out, 12 + sand.length);
  return [...out];
}

const tag = `cp${Date.now() % 10000}${process.pid % 100}`;

// ---- Ana's beach, saved straight to the server
const pa = await open('nointro&fixedres&seed=1&nofinds', { width: 1100, height: 760 });
await pa.evaluate((n) => window.__beech.account().signInDev(n), `ana${tag}`);
await pa.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 30000 });
const anaCode = await pa.evaluate(() => window.__beech.neighbors().api.get().then((n) => n.code));
const anaHome = await pa.evaluate(() => window.__beech.beachId());
await api(pa, '/api/dev/grant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: 'lighthouse' }) });
const saved = await pa.evaluate(
  async ([id, bytes]) => {
    const a = window.__beech.account();
    const epoch = (await a.fetch(`/api/beaches/mine/${id}/sand`)).headers.get('X-Beach-Epoch') ?? '0';
    const r = await a.fetch(`/api/beaches/mine/${id}/sand`, {
      method: 'PUT',
      body: new Uint8Array(bytes),
      headers: { 'X-Beach-Location': 'bondi', 'X-Beach-Nx': '16', 'X-Beach-Ny': '16', 'X-Beach-Max': '2000', 'X-Beach-Epoch': epoch, ...a.editHeaders() },
    });
    return r.status;
  },
  [anaHome, anaBeach()],
);
check(saved === 200, `Ana's beach is saved with a lighthouse (${saved})`);
await pa.close(); // her device mustn't save its own sand over it

// ---- Ben opens "Copy to my beach" signed out, then signs in
const pb = await open(`visit=${anaCode}&copy=1&nointro&fixedres&seed=1&nofinds`, { width: 1100, height: 760 });
await pb.waitForFunction((c) => window.__beech.neighbors().visiting?.code === c, anaCode, { timeout: 60000 });
check(true, "signed out, Ben sees Ana's beach");
await pb.evaluate((n) => window.__beech.account().signInDev(n), `ben${tag}`);
await pb.waitForSelector('.copybeach.open [data-act="copy-drop"]', { timeout: 60000 });
check(true, 'after signing in, the copy sheet opens');
const sheetText = await pb.textContent('.copybeach.open');
check(/Lighthouse × 1/.test(sheetText) && /1 short/.test(sheetText) && /S\$ 30/.test(sheetText), 'it lists the lighthouse as short, with its price in sand bucks');
check((await pb.textContent('.copybeach [data-act="copy-buy"]')).includes('Buy what’s missing · S$ 30'), 'buy what’s missing: exactly the lighthouse');
check((await pb.textContent('.copybeach [data-act="copy-drop"]')).includes('Copy without them (1 left out)'), 'or copy without it');
check(!!(await pb.$('.copybeach .beach-pill.on')) && (await pb.textContent('.copybeach .beach-pill.on')).includes('⌂'), 'no room for a new beach: it goes onto his home');
if (shots) await pb.screenshot({ path: `${shots}/copy-sheet.png` });
const benHome = await pb.evaluate(() => window.__beech.account().home?.id);
const before = await api(pb, `/api/beaches/mine/${benHome}/sand`);

// ---- copy without it, then undo
await pb.click('.copybeach [data-act="copy-drop"]');
await pb.waitForFunction(() => [...document.querySelectorAll('.hint')].some((h) => h.textContent.includes('Copied')), null, { timeout: 60000 });
check(true, 'copied, with a toast');
// the toast lasts 10 s, and loading the beach can take most of that here: hold on to its Undo now
const undo = await pb.$('.hint .hint-action');
check(!!undo && (await undo.textContent()) === 'Undo', 'the toast offers Undo');
await pb.waitForFunction(() => window.__beech.beachId() && window.__beech.sync().state === 'saved', null, { timeout: 30000 });
await pb.waitForFunction(() => window.__beech.info().objects.filter((o) => o.item === 'rock' && !o.wild).length >= 2, null, { timeout: 30000 });
check(!(await things(pb)).includes('lighthouse'), `the rocks came, the lighthouse didn't (${await things(pb)})`);
if (undo) {
  await undo.evaluate((b) => b.click());
  await pb.waitForFunction(() => window.__beech.info().objects.filter((o) => o.item === 'rock' && !o.wild).length === 0, null, { timeout: 30000 }).catch(() => {});
  check(!(await things(pb)).includes('rock'), 'Undo put his beach back');
}
void before;

// ---- buy what's missing: not enough sand bucks, so a pack first (docs/SAND_BUCKS.md), then back to the copy.
// Ben came in through Ana's beach link, which counts as an invite: S$ 50 to start. Spend it first.
check((await api(pb, '/api/credit')).body?.bucks === 50, 'Ana’s link was an invite: Ben starts with S$ 50');
const spent = await api(pb, '/api/store/buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ basket: [{ product: 'item_parasol', quantity: 5 }], requestId: crypto.randomUUID() }) });
check(spent.body?.bucks === 0, 'he spends it on five parasols');
await pb.evaluate((c) => window.__beech.copyBeach(c), anaCode);
await pb.waitForSelector('.copybeach.open [data-act="copy-buy"]', { timeout: 60000 });
await pb.click('.copybeach [data-act="copy-buy"]');
await pb.waitForSelector('.shop.open .shop-packs button[data-product="bucks_30"]', { timeout: 60000 });
check(true, 'short of sand bucks: the shop opens at the packs');
check((await pb.textContent('.shop.open .shop-bucks')).includes('0 sand dollars (S$)'), 'the shop shows the balance');
if (shots) await pb.screenshot({ path: `${shots}/shop-packs.png` });
await pb.click('.shop.open .shop-packs button[data-product="bucks_30"]');
await pb.waitForSelector('.copybeach.open [data-act="copy-buy"]', { timeout: 60000 });
check((await pb.textContent('.copybeach.open')).includes('S$ 30'), 'with a pack bought, the copy sheet is back');
await pb.click('.copybeach [data-act="copy-buy"]');
await pb.waitForSelector('.copybeach.open [data-act="copy-go"]', { timeout: 60000 });
check((await pb.textContent('.copybeach [data-act="copy-go"]')).startsWith('Replace'), 'after buying, the button copies the whole beach');
if (shots) await pb.screenshot({ path: `${shots}/copy-bought.png` });
await pb.click('.copybeach [data-act="copy-go"]');
await pb.waitForFunction(() => window.__beech.info().objects.some((o) => o.item === 'lighthouse'), null, { timeout: 60000 });
check(true, 'the lighthouse is on his beach');
const left = (await api(pb, '/api/credit')).body?.bucks;
check(left === 3, `the pack (S$ 33) paid for it: S$ 30 spent, ${left} left`);

// ---- trade a thing in from the bag: long press it, pick how many, see the S$
await api(pb, '/api/dev/grant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: 'parasol', quantity: 2 }) });
await pb.evaluate(() => window.__beech.refreshOwned?.());
await pb.waitForFunction(() => window.__beech.inventory.tradeValue('parasol') === 10, null, { timeout: 30000 });
await pb.evaluate(() => window.__beech.setRail(true)); // the HUD starts as just the palm
await pb.evaluate(() => window.__beech.inventory.setOpen(true));
await pb.waitForSelector('.inv-tray.open', { timeout: 10000 });
check((await pb.textContent('.inv-tray .inv-tip')) === 'long press item to trade in', 'the bag says to long press to trade in');
const tile = pb.locator('.inv-grid .inv-item', { hasText: 'Parasol' }).first();
await pb.waitForTimeout(1500); // let the bag settle (it re-renders as the bag loads)
await tile.scrollIntoViewIfNeeded();
const box = await tile.boundingBox();
await pb.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await pb.mouse.down();
// hold until it opens, as a finger would (a slow software-rendered page runs the timer late)
await pb.waitForSelector('.trade-dlg:not([hidden])', { timeout: 20000 });
await pb.mouse.up();
await pb.waitForTimeout(300);
check(await pb.isVisible('.trade-dlg:not([hidden])'), 'a long press opens the trade-in dialog, and letting go keeps it open');
check(!(await pb.evaluate(() => window.__beech.inventory.current)), 'a long press opens the dialog without picking the parasol up');
check((await pb.textContent('.trade-dlg .trade-go')) === 'trade in · S$ 10', 'one parasol: trade in · S$ 10');
await pb.click('.trade-dlg [data-act="trade-more"]');
check((await pb.textContent('.trade-dlg .trade-value')) === 'you get S$ 20', 'two: you get S$ 20');
check(await pb.isVisible('.trade-dlg [data-act="trade-gift"]'), 'the dialog has a gift button');
if (shots) await pb.screenshot({ path: `${shots}/trade-in.png` });
await pb.click('.trade-dlg .trade-go');
await pb.waitForFunction(() => document.querySelector('.trade-dlg .trade-status')?.textContent === '+S$ 20', null, { timeout: 30000 });
check((await api(pb, '/api/credit')).body?.bucks === left + 20, 'traded in: S$ 20 back');
await pb.keyboard.press('Escape');
// with a thing in hand, the bar has no trade-in or gift
await api(pb, '/api/dev/grant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: 'parasol' }) });
await pb.evaluate(() => window.__beech.refreshOwned?.());
await pb.waitForFunction(() => window.__beech.inventory.ownedCount('parasol') > 0, null, { timeout: 30000 });
await pb.evaluate(() => window.__beech.inventory.select('parasol'));
await pb.waitForSelector('.place-bar.shown', { timeout: 30000 });
check((await pb.$$('.place-bar .pb-trade, .place-bar .pb-gift')).length === 0, 'the bar for the thing in hand has no trade-in or gift');

// ---- Ana hears about it once, and the shore page counts it
const pa2 = await open('nointro&fixedres&seed=1&nofinds', { width: 390, height: 844 });
await pa2.evaluate((n) => window.__beech.account().signInDev(n), `ana${tag}`);
await pa2.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 30000 });
const inbox = await api(pa2, '/api/inbox');
const copied = (inbox.body?.entries ?? []).filter((e) => e.kind === 'copied');
check(copied.length === 1 && copied[0].from?.name.startsWith('ben'), `Ana's inbox: Ben copied her beach, once (${copied.length})`);
const page = await pa2.evaluate(async (c) => (await fetch(`/shore/${c}`)).text(), anaCode);
check(page.includes('copied once') && page.includes('Copy to my beach'), 'her beechshore page says it was copied, and offers a copy');

// ---- on a phone, the shore bar's "copy" opens the sheet (Ana visits Ben's copy)
const benCode = await pb.evaluate(() => window.__beech.account().home?.code);
await pa2.evaluate((c) => window.__beech.neighbors().visit(c), benCode);
await pa2.waitForFunction((c) => window.__beech.neighbors().visiting?.code === c, benCode, { timeout: 60000 });
await pa2.click('[data-act="palm"]');
await pa2.click('.sp-toggle');
const copyBtn = `.shore-bar [data-act="copy-${benCode}"]:not([hidden])`;
await pa2.waitForSelector(copyBtn, { timeout: 60000 });
check(true, 'visiting, the shore bar offers "copy"');
if (shots) await pa2.screenshot({ path: `${shots}/copy-shore-bar-phone.png` });
await pa2.click(copyBtn);
await pa2.waitForSelector('.copybeach.open .copy-items', { timeout: 60000 });
check(true, 'it opens the copy sheet');
if (shots) await pa2.screenshot({ path: `${shots}/copy-sheet-phone.png` });

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await closeBrowser();
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
