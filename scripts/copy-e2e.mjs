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
check(/Lighthouse × 1/.test(sheetText) && /1 short/.test(sheetText) && /\$2\.99/.test(sheetText), 'it lists the lighthouse as short, with its price');
check((await pb.textContent('.copybeach [data-act="copy-buy"]')).includes('Buy what’s missing · $2.99'), 'buy what’s missing: exactly the lighthouse');
check((await pb.textContent('.copybeach [data-act="copy-drop"]')).includes('Copy without them (1 left out)'), 'or copy without it');
check(!!(await pb.$('.copybeach .beach-pill.on')) && (await pb.textContent('.copybeach .beach-pill.on')).includes('⌂'), 'no room for a new beach: it goes onto his home');
if (shots) await pb.screenshot({ path: `${shots}/copy-sheet.png` });
const benHome = await pb.evaluate(() => window.__beech.account().home?.id);
const before = await api(pb, `/api/beaches/mine/${benHome}/sand`);

// ---- copy without it, then undo
await pb.click('.copybeach [data-act="copy-drop"]');
await pb.waitForFunction(() => [...document.querySelectorAll('.hint')].some((h) => h.textContent.includes('Copied')), null, { timeout: 60000 });
check(true, 'copied, with a toast');
await pb.waitForFunction(() => window.__beech.beachId() && window.__beech.sync().state === 'saved', null, { timeout: 30000 });
await pb.waitForFunction(() => window.__beech.info().objects.filter((o) => o.item === 'rock' && !o.wild).length >= 2, null, { timeout: 30000 });
check(!(await things(pb)).includes('lighthouse'), `the rocks came, the lighthouse didn't (${await things(pb)})`);
const undo = pb.locator('.hint button', { hasText: 'Undo' }).first();
const hasUndo = await undo.waitFor({ timeout: 10000 }).then(() => true, () => false);
check(hasUndo, 'the toast offers Undo');
if (hasUndo) {
  await undo.click();
  await pb.waitForFunction(() => window.__beech.info().objects.filter((o) => o.item === 'rock' && !o.wild).length === 0, null, { timeout: 30000 }).catch(() => {});
  check(!(await things(pb)).includes('rock'), 'Undo put his beach back');
}
void before;

// ---- buy what's missing from the sheet, then copy the whole beach
await pb.evaluate((c) => window.__beech.copyBeach(c), anaCode);
await pb.waitForSelector('.copybeach.open [data-act="copy-buy"]', { timeout: 60000 });
await pb.click('.copybeach [data-act="copy-buy"]');
await pb.waitForSelector('.copybeach.open [data-act="copy-go"]', { timeout: 60000 });
check((await pb.textContent('.copybeach [data-act="copy-go"]')).startsWith('Replace'), 'after buying, the button copies the whole beach');
if (shots) await pb.screenshot({ path: `${shots}/copy-bought.png` });
await pb.click('.copybeach [data-act="copy-go"]');
await pb.waitForFunction(() => window.__beech.info().objects.some((o) => o.item === 'lighthouse'), null, { timeout: 60000 });
check(true, 'the lighthouse is on his beach');

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
await pa2.click('.place');
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
