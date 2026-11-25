// Browser end-to-end test of the shore against a local server (npm run server:dev):
// Ben -left-> Ana -left-> Cleo. Ben walks down the shore past Ana to Cleo,
// heads home with the home button, then visits Dot by code and stars her beach.
//   node scripts/shore-e2e.mjs [screenshot.png]
import { e2eUrl, openApp, openBrowser } from './lib/e2e.mjs';

const URL_ = process.env.BEECH_URL ?? 'http://127.0.0.1:8787/';
const shot = process.argv[2];
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};

const { browser, close: closeBrowser } = await openBrowser();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await openApp(page, e2eUrl(URL_, 'nointro&fixedres&seed=1&nofinds&time=2026-11-25T23:00:00Z', { shots: Boolean(shot) }));

const tag = `sh${Date.now() % 10000}${process.pid % 100}`;
const names = { ana: `ana${tag}`, ben: `ben${tag}`, cleo: `cleo${tag}`, dot: `dot${tag}` };
// sign in as someone, save once, and return their code
const become = async (name) => {
  await page.evaluate(async (n) => {
    const b = window.__beech;
    if (b.account().user) await b.account().signOut();
    await b.account().signInDev(n);
  }, name);
  await page.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 15000 });
  return page.evaluate(() => window.__beech.neighbors().api.get().then((n) => n.code));
};
const codes = {};
// Cleo's beach is in Waikiki, Ben's in Brighton: the light follows the view
const places = { cleo: 'waikiki', ben: 'brighton' };
for (const k of ['cleo', 'dot', 'ana', 'ben']) {
  codes[k] = await become(names[k]);
  if (places[k]) await page.evaluate((loc) => window.__beech.account().updateBeach(window.__beech.beachId(), { location: loc }), places[k]);
  if (k === 'cleo') {
    await page.evaluate(async () => {
      const account = window.__beech.account();
      const post = (path, body) => account.fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!(await post('/api/dev/grant', { item: 'pet-crab', quantity: 1 })).ok ||
          !(await post('/api/pet/adopt', { mode: 'shop', name: 'Coral' })).ok) {
        throw new Error('Could not set up Cleo’s pet');
      }
    });
  }
}
// Ana's left is Cleo; Ben's left is Ana (each asked, the other accepted)
const ask = (side, c) => page.evaluate(({ side, c }) => window.__beech.neighbors().api.set(side, c), { side, c });
const accept = (c) => page.evaluate((c) => window.__beech.neighbors().api.accept(c), c);
await become(names.ana);
await ask('left', codes.cleo);
await become(names.cleo);
await accept(codes.ana);
await become(names.ben);
await ask('left', codes.ana);
await become(names.ana);
await accept(codes.ben);
await become(names.ben);
await page.evaluate(() => window.__beech.neighbors().refresh());
check((await page.evaluate(() => window.__beech.neighbors().beachAt(1)?.name)) === names.ana, "Ana is on Ben's left");
check((await page.evaluate(() => window.__beech.neighbors().beachAt(2)?.name)) === names.cleo, "and Cleo beyond her (Ana's neighbor)");
const ext = await page.evaluate(() => window.__beech.neighbors().extent);
check(ext.left > 2 || ext.right > 0, `the shore carries on past them into other beaches (${JSON.stringify(ext)})`);
const home = page.getByRole('button', { name: 'Return to my beach' });
const shoreLink = page.locator('.sp-head').getByRole('link');
const shoreUrl = (process.env.VITE_SHORE_URL || 'https://beechshore.com').replace(/\/+$/, '');
await page.evaluate(() => { window.__beech.setRail(true); window.__beech.setPane('default'); });
check(!(await home.isVisible()), 'no return button at home');
check(!(await shoreLink.isVisible()), 'no Beechshore link at home');

// ask from the shore: Ana (already his neighbor) doesn't offer "ask to be
// neighbors", while the unlinked beach to Ben's right does, in the status pane
await page.evaluate(() => window.__beech.cam.goTo(window.__beech.neighbors().xFor(1), true));
await shoreLink.waitFor({ timeout: 10000 });
const anaUrl = `${shoreUrl}/${codes.ana}`;
check((await shoreLink.textContent())?.includes(`${names.ana}’s beach`), 'Ana’s beach title is the link');
const context = page.context();
await context.route(anaUrl, (route) => route.fulfill({ contentType: 'text/html', body: '<title>Beechshore</title>' }));
const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 10000 }), shoreLink.click()]);
check(popup.url() === anaUrl, 'the title opens Ana’s Beechshore page in a new tab');
await popup.close();
await context.unroute(anaUrl);
await page.locator('.sp-toggle').click();
await page.waitForFunction(() => document.querySelector('.shore-bar.shown .sb-where')?.textContent?.includes(window.__beech.neighbors().beachAt(1)?.name ?? ''), null, { timeout: 10000 }).catch(() => {});
check(!(await page.isVisible('.shore-bar .sb-ask')), 'Ana (already his neighbor) does not offer "ask to be neighbors"');

await page.evaluate(() => window.__beech.cam.goTo(window.__beech.neighbors().xFor(-1), true));
await page.waitForSelector('.shore-bar.shown .sb-ask:not([hidden])', { timeout: 15000 }).catch(() => {});
check(await page.isVisible('.shore-bar .sb-ask'), 'a beach at the end of a stretch offers "ask to be neighbors" in the status pane');
await page.click('.shore-bar .sb-ask');
await page.waitForFunction(() => !!window.__beech.neighbors().state?.asked.right, null, { timeout: 15000 }).catch(() => {});
const askedName = await page.evaluate(() => window.__beech.neighbors().state?.asked.right?.name ?? null);
check(!!askedName, `asking from the status pane sent the request (${askedName})`);
// take it back and go home, so the rest of the walk is as before
await page.evaluate(() => window.__beech.neighbors().api.remove('right'));
await page.evaluate(() => window.__beech.neighbors().refresh());
await page.evaluate(() => window.__beech.cam.goTo(0, true));

// walk (pan) down the shore to Cleo
await page.evaluate(() => {
  const b = window.__beech;
  b.cam.halfH = 14;
  b.cam.applyOrtho();
  b.cam.goTo(b.neighbors().xFor(2), true);
});
await page.waitForFunction((name) => {
  const shore = window.__beech.neighbors();
  const [first, last] = shore.window;
  const label = document.querySelector('.shore-bar.shown .sb-where');
  return first <= 2 && last >= 2 && shore.snapshot(2) && label?.textContent?.includes(name);
}, names.cleo, { polling: 100, timeout: 15000 });
const where = await page.textContent('.shore-bar .sb-where');
check(await home.isVisible(), 'down the shore: the return button shows');
check(await home.locator('svg').isVisible() && !(await home.textContent())?.trim(), 'the return button shows only a home icon');
check(await shoreLink.getAttribute('href') === `${shoreUrl}/${codes.cleo}`, 'the Beechshore link follows the beach in view');
check(where?.includes(names.cleo), `it says whose beach this is (${where})`);
const win = await page.evaluate(() => window.__beech.neighbors().window);
check(win[0] <= 2 && win[1] >= 2, `Cleo's beach is drawn (beaches ${win.join('..')})`);
if (shot) await page.screenshot({ path: shot });
await page.waitForFunction(() => window.__beech.light().place === 'waikiki', null, { timeout: 5000 }).catch(() => {});
check((await page.evaluate(() => window.__beech.light().place)) === 'waikiki', "local weather: Cleo's beach has Waikiki's sky");
check((await page.evaluate(() => window.__beech.live().localTime !== window.__beech.light().localTime)), 'its own local time, not the live beach’s');
// local weather off: the pinned light, wherever you look
{
  const localWeather = page.locator('input[data-key="localWeather"]');
  await page.evaluate(() => window.__beech.sheet.show('settings'));
  check(await localWeather.isChecked(), 'local weather is on by default');
  check((await page.evaluate(() => window.__beech.light().palette)) !== 'night', 'Waikiki starts in daylight');
  await page.locator('.chips[data-key="palette"] button[data-v="night"]').click();
  await localWeather.uncheck();
  await page.waitForFunction(() => window.__beech.light().palette === 'night', null, { polling: 100, timeout: 5000 });
  check(true, 'turned off, the light pinned in settings shows');
  await localWeather.check();
  await page.waitForFunction(() => window.__beech.light().palette !== 'night', null, { polling: 100, timeout: 5000 });
  await page.evaluate(() => window.__beech.sheet.hide());
}
// Feeding a visitor's pet requires a completed tap on dry sand.
{
  const feedButton = page.locator('.shore-bar .sb-pet');
  await page.waitForFunction(() => window.__beech.animals.visit().isPet && window.__beech.animals.visit().active, null, { polling: 100, timeout: 15000 });
  const { dry, wet } = await page.evaluate(() => {
    const b = window.__beech;
    b.scene.render();
    const camera = b.scene.activeCamera;
    const canvas = document.querySelector('canvas');
    const V = camera.position.constructor;
    const viewport = camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight);
    const x = b.animals.visit().offsetX;
    const project = (z) => {
      const y = b.neighbors().heightAtWorld(x, z);
      const p = V.Project(new V(x, y, z), camera.getWorldMatrix().constructor.Identity(), b.scene.getTransformMatrix(), viewport);
      return [p.x, p.y];
    };
    return { dry: project(6), wet: project(-5) };
  });
  const requests = [];
  const feedPath = `/api/beaches/${codes.cleo}/pet/feed`;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === feedPath) requests.push(request);
  });
  await feedButton.click();
  await page.mouse.click(...wet);
  await page.mouse.move(...dry);
  await page.mouse.down();
  await page.mouse.move(dry[0] + 30, dry[1]);
  await page.mouse.up();
  check(await feedButton.textContent() === 'cancel' && requests.length === 0, 'wet sand and a drag leave the snack in hand');
  const fed = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === feedPath);
  await page.mouse.click(...dry);
  check((await fed).ok() && requests.length === 1, 'one dry tap feeds the visited pet');
  const food = await page.evaluate(() => ({ ...window.__beech.animals.visit().food }));
  check(food.active && Math.abs(food.x) < 0.15 && Math.abs(food.z - 6) < 0.15, 'the snack appears where the visitor tapped');
}
// star Cleo's beach from the bar
await page.click('.shore-bar .sb-fav');
await page.waitForFunction((c) => window.__beech.neighbors().favorites.has(c), codes.cleo, { timeout: 5000 });
check(true, "starred Cleo's beach");
// Return home with the toolbar and status pane closed.
await page.evaluate(() => { window.__beech.setPane('closed'); window.__beech.setRail(false); });
await home.click();
await page.waitForFunction(() => {
  const app = window.__beech;
  const shore = app.neighbors();
  return shore.nearestIndex(app.cam.focusX) === 0 && shore.liveVisible
    && !document.querySelector('.shore-bar.shown');
}, null, { polling: 100, timeout: 30000 });
check(await page.evaluate(() => window.__beech.neighbors().liveVisible), 'home again: your beach is drawn');
check(!(await home.isVisible()), 'the return button hides back at home');
await page.evaluate(() => window.__beech.setPane('expanded'));

// infinite scroll: head right past what's loaded and more of the shore loads
{
  const before = await page.evaluate(() => window.__beech.neighbors().extent.right);
  if (before > 0) {
    await page.evaluate((n) => window.__beech.cam.goTo(window.__beech.neighbors().xFor(-n), true), before);
    await page.waitForFunction((n) => window.__beech.neighbors().extent.right > n, before, { timeout: 8000 }).catch(() => {});
    const after = await page.evaluate(() => window.__beech.neighbors().extent.right);
    check(after >= before, `scrolling right loads more of the shore when there is more (${before} -> ${after})`);
    await page.evaluate(() => window.__beech.cam.goTo(0, true));
  }
}

// visit Dot by code (the Inbox's Visit by code tab)
await page.evaluate(() => window.__beech.hub().show('visit'));
await page.fill('#visit-code', codes.dot.toLowerCase());
await page.click('button[data-act="visit"]');
await page.waitForFunction(() => window.__beech.neighbors().visiting !== null, null, { timeout: 15000 });
check((await page.evaluate(() => window.__beech.neighbors().visiting.name)) === names.dot, "visiting Dot's beach");
await page.waitForFunction(() => document.querySelector('.shore-bar .sb-where')?.textContent?.startsWith('Visiting'), null, { timeout: 5000 }).catch(() => {});
check((await page.textContent('.shore-bar .sb-where'))?.startsWith('Visiting'), 'the bar says Visiting');
await page.evaluate(() => window.__beech.setRail(true));
check(await shoreLink.getAttribute('href') === `${shoreUrl}/${codes.dot}`, 'a visit by code links to the visited beach');
check(await page.evaluate(() => {
  const app = window.__beech;
  return app.neighbors().visiting.id !== app.beachId();
}), "the visited beach is not the live editing beach");
// you can't dig someone else's beach
await page.keyboard.press('Escape');
await page.click('[data-act="dirt"]');
const d0 = await page.evaluate(() => window.__beech.info().undoCount);
await page.mouse.move(500, 450);
await page.mouse.down();
await page.mouse.move(560, 460);
await page.mouse.up();
await page.waitForTimeout(500);
check((await page.evaluate(() => window.__beech.info().undoCount)) === d0, "digging does nothing on someone else's beach");
await page.click('.shore-bar .sb-fav');
await page.waitForFunction((c) => window.__beech.neighbors().favorites.has(c), codes.dot, { timeout: 5000 });
// the Inbox's Starred tab
await page.evaluate(() => window.__beech.hub().show('starred'));
await page.waitForSelector(`button[data-act="visit-${codes.cleo}"]`, { timeout: 5000 });
check(await page.isVisible(`button[data-act="visit-${codes.dot}"]`), 'both starred beaches are in the favorites list');
await page.click(`button[data-act="visit-${codes.cleo}"]`);
await page.waitForFunction((n) => window.__beech.neighbors().visiting?.name === n, names.cleo, { timeout: 15000 });
check(true, 'visited Cleo from favorites');
await home.click();
await page.waitForFunction((name) => {
  const shore = window.__beech.neighbors();
  return shore.visiting === null && shore.liveVisible && shore.beachAt(1)?.name === name;
}, names.ana, { timeout: 15000 });
check(true, 'home: Ana is next door again');

// signed out: other sections of the public shore still render beside the empty beach
await page.evaluate(() => window.__beech.account().signOut());
await page.waitForFunction(() => !window.__beech.account().user && window.__beech.neighbors().snapshot(1) !== null, null, { timeout: 15000 });
const signedOut = await page.evaluate(() => ({
  ownVisible: window.__beech.neighbors().liveVisible,
  ext: window.__beech.neighbors().extent,
  left: window.__beech.neighbors().beachAt(1)?.name ?? null,
  maxX: window.__beech.cam.maxX,
}));
check(signedOut.ownVisible && signedOut.ext.left > 0 && !!signedOut.left && signedOut.maxX > 40, `signed out: public shore renders next to empty beach (${JSON.stringify(signedOut)})`);

check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await closeBrowser();
console.log(failed ? `${failed} FAILED` : 'SHORE E2E PASS');
process.exit(failed ? 1 : 0);
