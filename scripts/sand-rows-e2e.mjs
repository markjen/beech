// Browser end-to-end test of sand rows inland (docs/INLAND_SECTIONS.md):
// sand extensions straight behind a beach are part of its sand. Against a
// local server (npm run server:dev, DEV_AUTH for /api/dev/grant): add two
// sand rows, see the beach's grid run 24 m deeper (no scenery drawn for
// them), dig there and put a thing down, open it again and find both, then take a
// row away and see the beach shrink with what was on it.
//   node scripts/sand-rows-e2e.mjs [out-dir for screenshots]
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
const name = `sandrows${Date.now() % 100000}`;

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
const click = (page, sel) => page.locator(sel).first().evaluate((b) => b.click());
const depth = (page) => page.evaluate(() => window.__beech.picker.g.ny * window.__beech.picker.g.dx);
const drawn = (page, id) => page.evaluate((i) => window.__beech.neighbors().sectionRowsDrawn(i), id);
/** sand height at sim metres (x along, y from the sea edge) on the live beach */
const height = (page, x, y) => page.evaluate(([sx, sy]) => window.__beech.picker.heightAt(sx + window.__beech.origin.x, sy + window.__beech.origin.z), [x, y]);
const saveNow = async (page) => {
  // (the edits above went straight to the worker, not through a gesture: mark the beach changed)
  await page.evaluate(() => window.__beech.store().markDirty(window.__beech.beachId(), 0));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__beech.store().flushAll());
  await page.waitForFunction(() => !window.__beech.store().hasPendingSaves(), null, { timeout: 20000 });
};

const a = await device('A');
const home = await a.evaluate(() => window.__beech.account().home);
await api(a, '/api/dev/grant', { method: 'POST', body: JSON.stringify({ item: 'section-sand', quantity: 2 }) });
await api(a, '/api/dev/grant', { method: 'POST', body: JSON.stringify({ item: 'conch', quantity: 2 }) });
await a.evaluate(() => window.__beech.account().loadBeaches());
check(Math.abs((await depth(a)) - 32) < 0.2, 'the beach starts 32 m deep');

const openEditor = async (page) => {
  await page.evaluate(() => window.__beech.sheet.show('shore'));
  // (the shore list draws again as the shore refreshes: click until the editor is open)
  const sel = `[data-sections-beach="${home.id}"] [data-act="sections-edit"]`;
  for (let i = 0; i < 10; i++) {
    const clicked = await page.evaluate((q) => {
      const el = document.querySelector(q);
      el?.click();
      return !!el;
    }, sel);
    if (clicked) {
      const open = await page.waitForSelector('.sections-editor:not([hidden])', { timeout: 4000 }).catch(() => null);
      if (open) return;
    } else await page.waitForTimeout(500);
  }
  throw new Error('the inland sections editor did not open');
};
await openEditor(a);
await click(a, '.sections-editor [data-act="sections-add"][data-type="section-sand"]');
await click(a, '.sections-editor [data-act="sections-add"][data-type="section-sand"]');
await click(a, '.sections-editor [data-act="sections-save"]');
await a.waitForSelector('.sections-editor', { state: 'hidden', timeout: 10000 }).catch(async (e) => {
  console.log('editor:', await a.evaluate(() => [...document.querySelectorAll('.sections-editor')].map((el) => el.innerText.replace(/\s+/g, ' ')).join(' || ')));
  throw e;
});
await a.waitForFunction(() => window.__beech.picker.g.ny * window.__beech.picker.g.dx > 50, null, { timeout: 15000 });
check(Math.abs((await depth(a)) - 56) < 0.2, 'two sand rows: the beach runs 24 m further inland');
check((await drawn(a, home.id)) === 0, 'they are the beach’s own sand, not scenery');
// the slope across the old back edge is the beach's own, with no step
const h = await Promise.all([30.5, 31.5, 32.5].map((v) => height(a, 16, v)));
check(Math.abs(h[2] - h[1] - (h[1] - h[0])) < 0.01, `the sand runs straight on from the beach (${h.map((v) => v.toFixed(3)).join(' → ')})`);

// dig in the second row, and put a conch down in the first
const y = 50;
const before = await height(a, 12, y);
await a.evaluate(([sy]) => {
  const send = window.__beech.send;
  send({ type: 'brush', phase: 'start', x: 12, y: sy, r: 0.6, mode: 'dig' });
  for (let i = 1; i <= 6; i++) send({ type: 'brush', phase: 'move', x: 12 + i * 0.2, y: sy, r: 0.6 });
}, [y]);
await a.waitForTimeout(800);
await a.evaluate(() => window.__beech.send({ type: 'brush', phase: 'end' }));
await a.evaluate(() => window.__beech.send({ type: 'placeObject', obj: { kind: 'conch', item: 'conch', x: 20, y: 38, angle: 0, size: 0.3, variant: 1 } }));
await a.evaluate(() => window.__beech.send({ type: 'placeObject', obj: { kind: 'conch', item: 'conch', x: 20, y: 52, angle: 0, size: 0.3, variant: 2 } }));
await a.waitForTimeout(800);
const dug = await height(a, 12.6, y);
check(dug < before - 0.05, `digging works on the sand row (${before.toFixed(3)} → ${dug.toFixed(3)})`);
const shell = await a.evaluate(() => window.__beech.info().objects.find((o) => o.item === 'conch'));
check(!!shell && Math.abs(shell.y - 38) < 0.1, 'a thing put down on the sand row stays there');
if (shots) {
  await a.evaluate(() => window.__beech.cam.goToZ(20));
  await a.waitForTimeout(1500);
  await a.screenshot({ path: `${shots}/sand-rows.png` });
}
await saveNow(a);

// open it again: it loads at that depth, with the dig and the conch
await a.reload();
await a.waitForFunction(() => window.__beech?.beachId() && window.__beech.sync().state === 'saved', null, { timeout: 40000 });
await a.waitForFunction(() => window.__beech.picker.g.ny * window.__beech.picker.g.dx > 50, null, { timeout: 15000 });
check(Math.abs((await depth(a)) - 56) < 0.2, 'opened again, the beach is as deep');
await a.waitForTimeout(1000);
check((await height(a, 12.6, y)) < before - 0.04, 'with the dig');
check(!!(await a.evaluate(() => window.__beech.info().objects.find((o) => o.item === 'conch' && o.y > 32))), 'and the conch');

// take a row away (as another device would): the beach shrinks, and what was on that row goes with it
const mine = await api(a, '/api/beaches/mine');
const rev = mine.body?.beaches?.find((x) => x.id === home.id)?.sectionsRev ?? 0;
const put = await api(a, `/api/beaches/mine/${home.id}/sections`, { method: 'PUT', body: JSON.stringify({ rows: ['section-sand'], rev }) });
check(put.status === 200, `the layout changes to one sand row (${put.status})`);
await a.evaluate(async () => {
  await window.__beech.account().loadBeaches();
  await window.__beech.neighbors().refresh();
});
await a.waitForFunction(() => window.__beech.picker.g.ny * window.__beech.picker.g.dx < 50, null, { timeout: 15000 });
check(Math.abs((await depth(a)) - 44) < 0.2, 'one sand row: 12 m further inland');
await a.waitForTimeout(800);
const shells = await a.evaluate(() => window.__beech.info().objects.filter((o) => o.item === 'conch').map((o) => Math.round(o.y)));
check(JSON.stringify(shells) === '[38]', `the conch on the row that stayed is still there, the other one is gone (${shells})`);
// …and back in the bag, once saved
await saveNow(a);
const items = await api(a, '/api/beaches/mine');
const onIt = items.body?.beaches?.find((x) => x.id === home.id)?.items?.conch ?? 0;
check(onIt === 1, `the server counts one conch on the beach (${onIt})`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
await closeBrowser();
process.exit(failed ? 1 : 0);
