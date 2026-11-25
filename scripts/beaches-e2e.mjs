// Browser end-to-end test of owning more than one beach, against a local
// server (npm run server:dev, which has DEV_AUTH for /api/dev/grant):
// one person on two devices, each running a different beach at the same time.
//   node scripts/beaches-e2e.mjs
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
const errors = [];
const name = `multi${Date.now() % 100000}`;

async function device(label) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('dialog', (d) => void d.accept(d.type() === 'prompt' ? `${label} beach` : undefined));
  await page.goto(URL_ + '?nointro&quality=low&fixedres&seed=1&nofinds', { waitUntil: 'commit' });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
  await page.evaluate(() => window.__beech.engine.setHardwareScalingLevel(2));
  await page.evaluate((n) => window.__beech.account().signInDev(n), name);
  await page.waitForFunction(() => window.__beech.beachId() && window.__beech.sync().state === 'saved', null, { timeout: 20000 });
  return page;
}
const dig = async (page, y) => {
  await page.click('[data-act="edit-menu"]');
  await page.click('button[data-tool="sand"]');
  await page.mouse.move(300, y);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(300 + i * 8, y);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__beech.sync().flush());
};
const dug = (page) =>
  page.evaluate(() => {
    const b = window.__beech;
    let d = 0;
    for (let k = 0; k < b.rest.length; k++) if (b.rest[k] > 0.5) d += Math.abs(b.picker.sand[k] - b.rest[k]);
    return d;
  });

// device A: dig on the home beach, then get an extra beach and open a new one
const a = await device('A');
const home = await a.evaluate(() => window.__beech.beachId());
await dig(a, 540);
const homeDug = await dug(a);
check(homeDug > 1, `A dug the home beach (${homeDug.toFixed(1)})`);
await a.evaluate(() => window.__beech.account().fetch('/api/dev/grant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: 'beach' }) }));
await a.evaluate(() => window.__beech.account().loadBeaches());
await a.evaluate(() => window.__beech.sheet.show('beach'));
await a.waitForSelector('button[data-act="new-beach"]', { timeout: 8000 });
await a.click('button[data-act="new-beach"]');
await a.waitForFunction((h) => window.__beech.beachId() !== h && window.__beech.sync().state === 'saved', home, { timeout: 20000 });
const second = await a.evaluate(() => window.__beech.beachId());
await a.waitForTimeout(800);
check((await dug(a)) < homeDug * 0.2, 'A is on a new, untouched beach');
check((await a.evaluate(() => window.__beech.account().beaches.length)) === 2, 'A has two beaches');
await a.evaluate(() => window.__beech.sheet.hide());
await dig(a, 470);
const secondDug = await dug(a);

// device B: the same person opens the app; this device has never chosen, so it shows home
const b = await device('B');
await b.waitForTimeout(800);
check((await b.evaluate(() => window.__beech.beachId())) === home, 'B opens the home beach');
const bDug = await dug(b);
check(Math.abs(bDug - homeDug) / homeDug < 0.2, `B shows the home sand A dug (${bDug.toFixed(1)})`);

// both live at once: each device digs its own beach and saves it
await Promise.all([dig(a, 600), dig(b, 420)]);
const [aNow, bNow] = [await dug(a), await dug(b)];
const sands = await b.evaluate(async (ids) => {
  const acct = window.__beech.account();
  const get = async (id) => new Uint8Array(await (await acct.fetch(`/api/beaches/mine/${id}/sand`)).arrayBuffer()).length;
  return [await get(ids[0]), await get(ids[1])];
}, [home, second]);
check(aNow > secondDug && bNow > bDug, `both devices dug at the same time (A ${secondDug.toFixed(0)}->${aNow.toFixed(0)}, B ${bDug.toFixed(0)}->${bNow.toFixed(0)})`);
check(sands[0] > 0 && sands[1] > 0, 'each beach saved separately');

// each beach has its own code and neighbors; connect the two in 1 click on the Shore tab (no code copying)
const codes = await a.evaluate(() => window.__beech.account().beaches.map((x) => ({ id: x.id, code: x.code })));
const secondCode = codes.find((c) => c.id === second).code;
check((await a.evaluate(() => window.__beech.neighbors().state?.code)) === secondCode, "A's neighbor panel is for the second beach");
await b.evaluate(() => window.__beech.sheet.show('shore'));
await b.waitForSelector(`select[data-connect-beach="${home}"][data-connect-side="left"]`, { timeout: 8000 });
await b.selectOption(`select[data-connect-beach="${home}"][data-connect-side="left"]`, secondCode);
await b.waitForFunction((c) => window.__beech.neighbors().beachAt(1)?.code === c, secondCode, { timeout: 15000 });
check((await b.evaluate(() => window.__beech.neighbors().beachAt(1)?.code)) === secondCode, 'on B the second beach is next door via 1-click connect');
await b.evaluate(() => window.__beech.sheet.hide());

// on B, pan over to the adjacent second beach and dig directly on it: the waves move
// there with the view (no "active" beach), and writes save into the second beach, not home!
const beforeSecondUpdated = await b.evaluate((id) => window.__beech.account().beaches.find((x) => x.id === id)?.updatedAt ?? 0, second);
await b.evaluate(() => {
  const nv = window.__beech.neighbors();
  window.__beech.cam.goTo(nv.xFor(1), true);
});
await b.waitForFunction(() => window.__beech.neighbors().snapshot('left') !== null, null, { timeout: 15000 });
await b.waitForTimeout(400);
await b.click('button[data-tool="sand"]');
await b.mouse.move(420, 460);
await b.mouse.down();
for (let i = 0; i < 18; i++) {
  await b.mouse.move(420 + i * 8, 460);
  await b.waitForTimeout(25);
}
await b.mouse.up();
await b.waitForTimeout(400);
await b.evaluate(() => window.__beech.store().flushAll());
const afterSecondUpdated = await b.evaluate(async (id) => {
  await window.__beech.account().loadBeaches();
  return window.__beech.account().beaches.find((x) => x.id === id)?.updatedAt ?? 0;
}, second);
check((await b.evaluate(() => window.__beech.beachId())) === second, 'on B the waves moved with the view onto the second beach');
check(afterSecondUpdated > beforeSecondUpdated, `editing the adjacent beach saved automatically into the second beach (${beforeSecondUpdated} -> ${afterSecondUpdated})`);

// Hold the response to the first save while the player edits the same beach again.
let releaseSave;
const waitForRelease = new Promise((resolve) => { releaseSave = resolve; });
let saveStarted;
const waitForSave = new Promise((resolve) => { saveStarted = resolve; });
const savePath = `**/api/beaches/mine/${second}/sand`;
await b.route(savePath, async (route) => {
  if (route.request().method() !== 'PUT') return route.continue();
  const response = await route.fetch();
  saveStarted();
  await waitForRelease;
  await route.fulfill({ response });
});
// back home: the second beach is a snapshot again, edited through the store by its id
await b.evaluate(() => window.__beech.cam.goTo(0, true));
await b.waitForFunction((h) => window.__beech.beachId() === h, home, { timeout: 15000 });
await b.evaluate((id) => {
  window.__beech.neighbors().placeObject(id, { kind: 'rock', item: 'rock', x: 8, y: 3, size: 0.5, angle: 0, variant: 0 });
  void window.__beech.store().flushAll();
}, second);
await Promise.race([
  waitForSave,
  b.waitForTimeout(15000).then(() => { throw new Error('expected a save for the second beach'); }),
]);
const firstSave = await b.evaluate(async (id) => Array.from((await window.__beech.account().loadBeach(id)).bytes), second);
await b.evaluate((id) => window.__beech.neighbors().placeObject(id, { kind: 'rock', item: 'rock', x: 12, y: 3, size: 0.5, angle: 0, variant: 0 }), second);
releaseSave();
await b.evaluate(() => window.__beech.store().flushAll());
await b.unroute(savePath);
const secondSave = await b.evaluate(async (id) => Array.from((await window.__beech.account().loadBeach(id)).bytes), second);
check(firstSave.length !== secondSave.length || firstSave.some((value, i) => secondSave[i] !== value), 'an edit made during a save is saved too');

// One drag crosses the seam without opening a menu or lifting the mouse.
const points = await b.evaluate(() => {
  const beech = window.__beech;
  const neighbor = beech.neighbors();
  const seam = neighbor.xFor(1) / 2;
  beech.cam.goTo(seam, true);
  beech.scene.render();
  const camera = beech.scene.activeCamera;
  const { clientWidth, clientHeight } = document.querySelector('canvas');
  const V = camera.position.constructor;
  const identity = camera.getWorldMatrix().constructor.Identity();
  const project = (x) => {
    const z = 7;
    const y = beech.cam.groundHeight(x, z);
    const p = V.Project(new V(x, y, z), identity, beech.scene.getTransformMatrix(), camera.viewport.toGlobal(clientWidth, clientHeight));
    return [p.x, p.y];
  };
  beech.pickTool('pile');
  return {
    from: project(seam - 2),
    to: project(seam + 2),
    homeHeight: beech.cam.groundHeight(seam - 2, 7),
    neighborHeight: beech.cam.groundHeight(seam + 2, 7),
    seam,
  };
});
await b.mouse.move(...points.from);
await b.mouse.down();
await b.waitForTimeout(400);
await b.mouse.move(...points.to, { steps: 12 });
await b.waitForTimeout(650);
await b.mouse.up();
await b.evaluate(() => window.__beech.store().flushAll());
const crossed = await b.evaluate(async ({ homeHeight, neighborHeight, seam }) => {
  const beech = window.__beech;
  await beech.neighbors().refresh();
  return {
    homeRaised: beech.cam.groundHeight(seam - 2, 7) > homeHeight + 0.02,
    neighborRaised: beech.cam.groundHeight(seam + 2, 7) > neighborHeight + 0.02,
    focus: beech.cam.focusX,
  };
}, points);
check(crossed.homeRaised && crossed.neighborRaised && Math.abs(crossed.focus - points.seam) < 1, 'one drag raised both beaches and kept the camera at the seam');

// device A remembers which beach it was looking at after a reload (a view bookmark)
await a.reload({ waitUntil: 'commit' });
await a.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
await a.waitForFunction(() => window.__beech.beachId() && window.__beech.sync().state === 'saved', null, { timeout: 20000 });
check((await a.evaluate(() => window.__beech.beachId())) === second, 'A still opens the second beach after a reload');

// Removing the beach the waves are on must put them back on home, even when it is already visible.
await a.evaluate(() => window.__beech.sheet.show('beach'));
await a.click(`[data-act="select-beach-${second}"]`);
await a.click(`[data-act="remove-beach-${second}"]`);
await a.waitForFunction((id) => window.__beech.beachId() === id && window.__beech.account().beaches.length === 1, home, { timeout: 20000 });
await a.waitForTimeout(800);
check((await dug(a)) > homeDug * 0.8, 'removing the beach in view puts the waves back on the saved home beach');

check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await browser.close();
console.log(failed ? `${failed} FAILED` : 'BEACHES E2E PASS');
process.exit(failed ? 1 : 0);
