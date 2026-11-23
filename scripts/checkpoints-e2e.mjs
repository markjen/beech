// Browser end-to-end test of checkpoints (docs/CHECKPOINTS.md), against a
// local server (npm run server:dev, which has DEV_AUTH for /api/dev/grant):
//   node scripts/checkpoints-e2e.mjs        (npm run e2e:checkpoints)
// One person, two devices: save a checkpoint, restore it onto another beach
// (short, then without what's missing, then in full), undo, a restore under
// another device's feet, and checkpoints outliving their beach.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
const who = `cp${Date.now() % 100000}`;
const dialogs = [];

async function device(label) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => {
    if (process.env.DEBUG_E2E && m.type() === 'warning' && !m.text().includes('GL Driver')) console.log(`dbg ${label} console: ${m.text()}`);
  });
  page.answer = 'yes';
  page.on('dialog', (d) => {
    dialogs.push(`${label} ${d.type()}: ${d.message()}`);
    void d.accept(d.type() === 'prompt' ? page.answer : undefined);
  });
  await page.goto(URL_ + '?nointro&fixedres&seed=1&nofinds');
  await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
  await page.evaluate((n) => window.__beech.account().signInDev(n), who);
  await page.waitForFunction(() => window.__beech.account().beachId && window.__beech.sync().state === 'saved', null, { timeout: 20000 });
  return page;
}
const api = (page, url, init) =>
  page.evaluate(
    async ([u, i]) => {
      const r = await window.__beech.account().fetch(u, i ? { ...i, headers: { 'Content-Type': 'application/json' } } : undefined);
      return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
    },
    [url, init],
  );
const grant = (page, item) => api(page, '/api/dev/grant', { method: 'POST', body: JSON.stringify({ item }) });
const things = (page) => page.evaluate(() => window.__beech.info().objects.filter((o) => !o.wild).map((o) => o.item).sort().join());
const raised = (page) =>
  page.evaluate(() => {
    const b = window.__beech;
    let d = 0;
    for (let k = 0; k < b.rest.length; k++) d = Math.max(d, b.picker.sand[k] - b.rest[k]);
    return d;
  });
// open settings and make sure it stays open (opening a beach closes it a moment later)
const showSheet = async (page) => {
  await page.waitForTimeout(500);
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.__beech.sheet.show());
    await page.waitForTimeout(400);
    if (await page.evaluate(() => window.__beech.sheet.isOpen)) return;
  }
};
const checkpointsList = async (page) => (await api(page, '/api/checkpoints')).body;

// ------------------------------------------------------------------ 1
const a = await device('A');
const home = await a.evaluate(() => window.__beech.account().beachId);
await grant(a, 'lighthouse');
await grant(a, 'beach');
await a.evaluate(() => window.__beech.account().loadBeaches());
// a designed beach with a lighthouse, imported onto home (needs the bag's lighthouse)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beech-cp-'));
const file = path.join(dir, 'one.beach.json');
fs.writeFileSync(
  file,
  JSON.stringify({
    format: 'beech.beach',
    version: 1,
    name: 'One',
    shapes: [{ type: 'mound', x: 16, y: 24, radius: 3, height: 0.7 }],
    objects: [{ item: 'lighthouse', x: 16, y: 24 }, { item: 'rock', x: 12, y: 21, size: 0.5 }],
  }),
);
// the bag must know about the lighthouse before importing
await a.reload();
await a.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
await a.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 20000 });
await showSheet(a);
const [chooser] = await Promise.all([a.waitForEvent('filechooser'), a.click('button[data-act="import"]')]);
await chooser.setFiles(file);
await a.waitForSelector('.beachfile.open [data-act="apply"]');
check((await a.textContent('.beachfile [data-act="apply"]')) === 'Replace this beach', 'the bag covers the designed beach');
await a.click('.beachfile [data-act="apply"]');
await a.waitForFunction(() => window.__beech.info().objects.some((o) => o.item === 'lighthouse'), null, { timeout: 10000 });
await showSheet(a);
a.answer = 'one';
await a.waitForSelector('button[data-act="cp-save"]', { timeout: 10000 });
await a.click('button[data-act="cp-save"]');
await a.waitForFunction(() => [...document.querySelectorAll('.cp-row b')].some((b) => b.textContent === 'one'), null, { timeout: 15000 });
const one = (await checkpointsList(a)).checkpoints.find((c) => c.name === 'one');
check(one && one.items.lighthouse === 1 && one.objects === 2, `saved checkpoint "one" with the lighthouse (${JSON.stringify(one?.items)})`);
check((await a.textContent(`.cp-row[data-id="${one?.id}"]`)).includes('Lighthouse'), 'the list shows its lighthouse');
const homeAuto = (await checkpointsList(a)).checkpoints.find((c) => c.kind === 'auto');
check(homeAuto?.name === 'Before import', 'importing onto home kept it first as "Before import"');
if (process.env.SHOT_DIR) await a.screenshot({ path: `${process.env.SHOT_DIR}/checkpoints.png` });

// ------------------------------------------------------------------ 2
a.answer = 'Second';
await a.click('button[data-act="new-beach"]');
await a.waitForFunction((h) => window.__beech.account().beachId !== h && window.__beech.sync().state === 'saved', home, { timeout: 20000 });
const second = await a.evaluate(() => window.__beech.account().beachId);
await a.waitForFunction(() => !window.__beech.info().objects.some((o) => !o.wild), null, { timeout: 10000 }).catch(() => {});
check((await things(a)) === '', `A is on a new, empty beach (${await things(a)})`);
await showSheet(a);
await a.waitForSelector(`.cp-row[data-id="${one.id}"] .cp-chip.short`, { timeout: 10000 });
check(true, 'its lighthouse chip is red here (the lighthouse is on home)');
dialogs.length = 0;
await a.click(`button[data-act="cp-restore-${one.id}"]`);
await a.waitForFunction(() => window.__beech.info().objects.some((o) => o.item === 'rock'), null, { timeout: 20000 });
check(dialogs.some((d) => d.includes('needs 1 more Lighthouse')), 'it said the lighthouse is missing and asked');
check((await things(a)) === 'rock', `restored without it: the rock, no lighthouse (${await things(a)})`);
check((await raised(a)) > 0.4, 'and the sand of "one" is here');

// ------------------------------------------------------------------ 3, 5
await grant(a, 'lighthouse');
await a.reload();
await a.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
await a.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 20000 });
check((await a.evaluate(() => window.__beech.account().beachId)) === second, 'A is still on the second beach');
await showSheet(a);
await a.waitForSelector(`.cp-row[data-id="${one.id}"]`, { timeout: 10000 });
check(!(await a.$(`.cp-row[data-id="${one.id}"] .cp-chip.short`)), 'with a second lighthouse it fits');
dialogs.length = 0;
await a.click(`button[data-act="cp-restore-${one.id}"]`);
await a.waitForFunction(() => window.__beech.info().objects.some((o) => o.item === 'lighthouse'), null, { timeout: 20000 });
check(dialogs.some((d) => d.startsWith('A confirm: Replace')), 'it asked before replacing the beach');
check((await things(a)) === 'lighthouse,rock', 'restored in full');
await a.waitForSelector('.hint.with-action .hint-action', { timeout: 5000 });
check(true, 'an Undo toast appeared');
if (process.env.SHOT_DIR) await a.screenshot({ path: `${process.env.SHOT_DIR}/restored.png` });
await a.evaluate(() => window.__beech.sheet.hide());
await a.click('.hint-action');
await a.waitForFunction(() => !window.__beech.info().objects.some((o) => o.item === 'lighthouse'), null, { timeout: 20000 });
check((await things(a)) === 'rock', 'Undo put the beach back as it was before');

// ------------------------------------------------------------------ 4
const b = await device('B');
check((await b.evaluate(() => window.__beech.account().beachId)) === home, 'B opens home');
// open the second beach on B the way the panel does
await showSheet(b);
await b.click(`button[data-act="open-${second}"]`);
await b.waitForFunction(() => window.__beech.sync().state === 'saved' && window.__beech.info().objects.some((o) => o.item === 'rock'), null, { timeout: 20000 }).catch(() => {});
await b.evaluate(() => window.__beech.sheet.hide());
// A restores "one" onto the second beach while B shows it
await showSheet(a);
await a.click(`button[data-act="cp-restore-${one.id}"]`);
await a.waitForFunction(() => window.__beech.info().objects.some((o) => o.item === 'lighthouse'), null, { timeout: 20000 });
// B digs and saves: its save is refused and B loads the restored beach instead
await b.click('button[data-tool="dig"]');
await b.mouse.move(300, 500);
await b.mouse.down();
for (let i = 0; i < 12; i++) await b.mouse.move(300 + i * 8, 500);
await b.mouse.up();
await b.evaluate(() => window.__beech.sync().flush());
await b.waitForFunction(() => window.__beech.info().objects.some((o) => o.item === 'lighthouse'), null, { timeout: 20000 }).catch(() => {});
check((await things(b)) === 'lighthouse,rock', `B reloaded the restored beach instead of saving over it (${await things(b)})`);
const server = await api(a, '/api/beaches/mine');
const secondNow = server.body.beaches.find((x) => x.id === second);
if (secondNow?.items.lighthouse !== 1 && process.env.DEBUG_E2E) {
  const { inflateSync } = await import('node:zlib');
  const raw = await a.evaluate(async (id) => Array.from(new Uint8Array(await (await window.__beech.account().fetch(`/api/beaches/mine/${id}/sand`)).arrayBuffer())), second);
  const buf = Buffer.from(raw);
  const len = buf.readUInt32LE(8);
  console.log('dbg stored things', inflateSync(buf.subarray(12 + len)).toString().slice(0, 400));
  console.log('dbg B things', await things(b), 'A things', await things(a));
}
check(secondNow?.items.lighthouse === 1, `and the server still has the restored beach (${JSON.stringify(secondNow?.items)})`);

// ------------------------------------------------------------------ 6
await showSheet(a);
await a.click(`button[data-act="remove-beach-${second}"]`);
await a.waitForFunction((h) => window.__beech.account().beachId === h && window.__beech.account().beaches.length === 1, home, { timeout: 20000 });
const after = await checkpointsList(a);
check(after.checkpoints.some((c) => c.id === one.id), '"one" outlived the beach it was restored onto');
check(after.checkpoints.some((c) => c.kind === 'auto' && !c.fromBeach), 'the second beach\'s "before restoring" copy is kept too');
// ------------------------------------------------------------------ 7: beach files
await showSheet(a);
await a.waitForSelector(`button[data-act="cp-export-${one.id}"]`);
const [dl] = await Promise.all([a.waitForEvent('download'), a.click(`button[data-act="cp-export-${one.id}"]`)]);
const exported = path.join(dir, 'exported.beach.json');
await dl.saveAs(exported);
const ex = JSON.parse(fs.readFileSync(exported, 'utf8'));
check(ex.format === 'beech.beach' && ex.name === 'one' && ex.objects.map((o) => o.item).sort().join() === 'lighthouse,rock', `exported "one" as a beach file (${dl.suggestedFilename()})`);
// and back in, as a checkpoint of its own
await showSheet(a);
const [pick] = await Promise.all([a.waitForEvent('filechooser'), a.click('button[data-act="cp-import"]')]);
await pick.setFiles(exported);
await a.waitForFunction(() => [...document.querySelectorAll('.cp-row .cp-meta')].some((m) => m.textContent.startsWith('imported')), null, { timeout: 15000 });
const imported = (await checkpointsList(a)).checkpoints.find((c) => c.source === 'import');
check(imported && imported.name === 'one' && imported.items.lighthouse === 1, 'imported the file back as a checkpoint');
// the import preview can keep a file as a checkpoint instead of putting it on the beach
await showSheet(a);
const [pick2] = await Promise.all([a.waitForEvent('filechooser'), a.click('button[data-act="import"]')]);
await pick2.setFiles(file);
await a.waitForSelector('.beachfile.open [data-act="keep"]');
await a.click('.beachfile [data-act="keep"]');
await a.waitForFunction(() => !document.querySelector('.beachfile.open'), null, { timeout: 15000 });
check((await checkpointsList(a)).checkpoints.some((c) => c.name === 'One' && c.source === 'import'), 'the preview kept "One" as a checkpoint');
// replacing a beach from a file keeps it first as "Before import"
const homeBefore = await things(a);
await showSheet(a);
const [pick3] = await Promise.all([a.waitForEvent('filechooser'), a.click('button[data-act="import"]')]);
await pick3.setFiles(file);
await a.waitForSelector('.beachfile.open [data-act="apply"]');
await a.click('.beachfile [data-act="apply"]');
// (home already has a rock and a lighthouse: wait for the new copy itself)
for (let i = 0; i < 30; i++) {
  const list = await checkpointsList(a);
  if (list.checkpoints.some((c) => c.kind === 'auto' && c.fromBeach?.id === home && c.createdAt > homeAuto.createdAt)) break;
  await a.waitForTimeout(500);
}
const autos = (await checkpointsList(a)).checkpoints.filter((c) => c.kind === 'auto' && c.fromBeach?.id === home);
check(autos.length === 1 && autos[0].name === 'Before import' && autos[0].createdAt > homeAuto.createdAt, `the beach was kept as "Before import" again, replacing the last one (it had: ${homeBefore || 'nothing'})`);

await showSheet(a);
await a.waitForSelector(`button[data-act="cp-delete-${one.id}"]`);
// both taps in one go: headless rendering is slow enough to miss the confirm window
await a.evaluate((id) => {
  const b = document.querySelector(`button[data-act="cp-delete-${id}"]`);
  b.click();
  b.click();
}, one.id);
await a.waitForFunction((id) => !document.querySelector(`.cp-row[data-id="${id}"]`), one.id, { timeout: 10000 });
check(!(await checkpointsList(a)).checkpoints.some((c) => c.id === one.id), 'deleted "one" (two taps)');

await a.evaluate(() => window.__beech.account().deleteAccount());
fs.rmSync(dir, { recursive: true, force: true });
check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
if (process.env.DEBUG_E2E) console.log(dialogs.join('\n'));
await browser.close();
console.log(failed ? `${failed} FAILED` : 'CHECKPOINTS E2E PASS');
process.exit(failed ? 1 : 0);
