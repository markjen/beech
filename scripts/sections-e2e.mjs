// Browser end-to-end test of inland beach sections (docs/INLAND_SECTIONS.md),
// against a local server (npm run server:dev, which has DEV_AUTH for
// /api/dev/grant): open the editor from the shore tab, add rows and see the
// preview, cancel, reorder and save, see the rows from a second device, and
// a write from an old layout refused.
//   node scripts/sections-e2e.mjs [out-dir for screenshots]
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
const name = `inland${Date.now() % 100000}`;

async function device(label) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await openApp(page, e2eUrl(URL_, 'nointro&quality=low&fixedres&seed=1&nofinds&time=2026-07-01T17:00:00Z'));
  await page.evaluate(() => window.__beech.engine.setHardwareScalingLevel(2));
  await page.evaluate((n) => window.__beech.account().signInDev(n), name);
  await page.waitForFunction(() => window.__beech.beachId() && window.__beech.sync().state === 'saved', null, { timeout: 40000 });
  return page;
}
const api = (page, path, init = {}) =>
  page.evaluate(
    async ([p, i]) => {
      const a = window.__beech.account();
      const r = await a.fetch(p, { ...i, headers: { 'Content-Type': 'application/json', ...a.editHeaders(), ...(i.headers ?? {}) } });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [path, init],
  );
const drawn = (page) => page.evaluate((id) => window.__beech.neighbors().sectionRowsDrawn(id), home.id);
const click = (page, sel) => page.locator(sel).first().evaluate((b) => b.click());

const a = await device('A');
const home = await a.evaluate(() => window.__beech.account().home);
// (other beaches on a shared dev server may have rows: count this one's)
await api(a, '/api/dev/grant', { method: 'POST', body: JSON.stringify({ item: 'section-boardwalk', quantity: 2 }) });
await api(a, '/api/dev/grant', { method: 'POST', body: JSON.stringify({ item: 'section-picnic', quantity: 1 }) });
await a.evaluate(() => window.__beech.account().loadBeaches());
check((await drawn(a)) === 0, 'no rows drawn yet');

// the editor, from the shore tab
const openEditor = async (id) => {
  await a.evaluate(() => window.__beech.sheet.show('shore'));
  await a.waitForSelector(`[data-sections-beach="${id}"] [data-act="sections-edit"]`, { state: 'attached', timeout: 10000 });
  await click(a, `[data-sections-beach="${id}"] [data-act="sections-edit"]`);
  await a.waitForSelector('.sections-editor:not([hidden])', { timeout: 10000 });
};
await openEditor(home.id);
await click(a, '.sections-editor [data-act="sections-add"][data-type="section-boardwalk"]');
await click(a, '.sections-editor [data-act="sections-add"][data-type="section-picnic"]');
await a.waitForTimeout(800);
check((await drawn(a)) === 2, 'the preview draws two rows');
check((await a.locator('.sections-editor [data-act="sections-add"][data-type="section-picnic"]').count()) === 0, 'the only picnic grove is used: no more to add (and it is off sale)');
await click(a, '.sections-editor [data-act="sections-cancel"]');
await a.waitForTimeout(300);
check((await drawn(a)) === 0, 'cancel takes the preview away');

// again, reorder, and save
await openEditor(home.id);
await click(a, '.sections-editor [data-act="sections-add"][data-type="section-boardwalk"]');
await click(a, '.sections-editor [data-act="sections-add"][data-type="section-picnic"]');
await click(a, '.sections-editor li[data-row="1"] [data-act="sections-up"]');
await a.waitForTimeout(1500);
if (shots) await a.screenshot({ path: `${shots}/sections-editor.png` });
await click(a, '.sections-editor [data-act="sections-save"]');
await a.waitForSelector('.sections-editor', { state: 'hidden', timeout: 10000 });
await a.waitForTimeout(800);
const saved = await a.evaluate((id) => window.__beech.account().mine(id), home.id);
check(JSON.stringify(saved?.sections) === JSON.stringify(['section-picnic', 'section-boardwalk']), 'saved front row first, in the new order');
check((await drawn(a)) === 2, 'the saved rows are drawn');
if (shots) await a.screenshot({ path: `${shots}/sections-saved.png` });

// replace a row in place: the picnic grove (front row) becomes a boardwalk,
// the second copy in the bag; the grove goes back to the bag
await a.evaluate(() => window.__beech.account().loadBeaches());
await openEditor(home.id);
await click(a, '.sections-editor li[data-row="0"] [data-act="sections-replace"]');
check((await a.locator('.sections-editor [data-act="sections-swap"][data-type="section-picnic"]').count()) === 0, 'replacing offers other types, not the one in the row');
await click(a, '.sections-editor [data-act="sections-swap"][data-type="section-boardwalk"]');
if (shots) await a.screenshot({ path: `${shots}/sections-replaced.png` });
await click(a, '.sections-editor [data-act="sections-save"]');
await a.waitForSelector('.sections-editor', { state: 'hidden', timeout: 10000 });
await a.waitForTimeout(800);
const replaced = await a.evaluate((id) => window.__beech.account().mine(id), home.id);
check(JSON.stringify(replaced?.sections) === JSON.stringify(['section-boardwalk', 'section-boardwalk']), 'a row replaced in place, the others where they were');

// B: the same player on another device sees them
const b = await device('B');
// the rows arrive with the beach load, not on a fixed clock: wait for them
// (a sleep here passed locally and failed on the loaded runner)
await b.waitForFunction((id) => window.__beech.neighbors().sectionRowsDrawn(id) === 2, home.id, { timeout: 30000 });
check((await drawn(b)) === 2, 'a second device draws the rows');
const shore = await api(b, `/api/shore?code=${home.code}&depth=0`);
check(JSON.stringify(shore.body?.center?.sections) === JSON.stringify(['section-boardwalk', 'section-boardwalk']), 'the shore carries the rows');

// a stale layout from the second device is refused
const stale = await api(b, `/api/beaches/mine/${home.id}/sections`, { method: 'PUT', body: JSON.stringify({ rows: [], rev: 0 }) });
check(stale.status === 409, 'a write from an old layout is refused');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
await closeBrowser();
process.exit(failed ? 1 : 0);
