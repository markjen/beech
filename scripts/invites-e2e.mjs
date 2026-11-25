// Browser end-to-end test of invites and the beach guide against a local
// server (npm run server:dev), docs/INVITES_GUIDE.md:
// Ana signs in and opens her invite panel. Fran opens Ana's invite link in a
// fresh browser: the start screen says Ana invited her; she signs in, gets the
// welcome parasol, lands on Ana's beach, asks to be her neighbor, then goes
// home and does three guide steps (dig, build, undo). Ana comes back: she's
// told Fran settled in, the parasol is in her bag, and the panel shows Fran.
//   node scripts/invites-e2e.mjs [screenshot-dir]
import { e2eUrl, openBrowser, waitForApp } from './lib/e2e.mjs';

const URL_ = process.env.BEECH_URL ?? 'http://127.0.0.1:8787/';
const shots = process.argv[2];
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};

const { browser, close: closeBrowser } = await openBrowser();
const errors = [];
const open = async (query, viewport = { width: 1100, height: 700 }) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(e2eUrl(URL_, query, { shots: Boolean(shots) }), { waitUntil: 'commit' });
  await waitForApp(page);
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

const tag = `iv${Date.now() % 10000}${process.pid % 100}`;
const ana = `ana${tag}`;
const fran = `fran${tag}`;

// ---- Ana: her code and her (empty) invite panel
const pa = await open('nointro&fixedres&seed=1&nofinds');
await signIn(pa, ana);
await pa.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 30000 });
const anaCode = await pa.evaluate(() => window.__beech.neighbors().api.get().then((n) => n.code));
await pa.evaluate(() => window.__beech.invites().open());
await pa.waitForSelector('.invite.open .invite-link input', { timeout: 30000 });
const link = await pa.$eval('.invite-link input', (i) => i.value);
check(link.endsWith(`?invite=${anaCode}`), `Ana's invite link carries her code (${link})`);
check((await pa.$eval('.invite-empty', (e) => e.textContent)).includes('nobody yet'), 'nobody has joined yet');

// ---- Fran: opens the link in a fresh browser
const pf = await open(`invite=${anaCode}&fixedres&seed=1&nofinds`, { width: 390, height: 844 });
await pf.waitForSelector('.start-invite', { timeout: 60000 });
check((await pf.$eval('.start-invite', (e) => e.textContent)).includes(`${ana} invited you`), 'the start screen says who invited her');
check(!(await pf.evaluate(() => location.search.includes('invite'))), 'the invite is taken out of the URL');
if (shots) await pf.screenshot({ path: `${shots}/invite-start.png` });
await pf.click('.start');
await signIn(pf, fran);
// the welcome note: read it and tap "be her neighbor" in one go, inside the
// page, the moment it appears (it only lives a few seconds, and a slow
// software-rendered page can outlast it)
const welcome = await pf.waitForFunction(
  () => {
    const h = [...document.querySelectorAll('.hint')].find((x) => x.textContent.includes('welcome gift'));
    if (!h) return null;
    const b = [...h.querySelectorAll('.hint-action')].find((x) => x.textContent.includes('neighbor'));
    b?.click();
    return { text: h.textContent, asked: !!b };
  },
  null,
  { timeout: 60000 },
);
const w = await welcome.jsonValue();
check(w.text.includes(`A welcome gift from ${ana}`), 'Fran is told about her welcome gift');
check(w.asked, 'the welcome note has a "be her neighbor" button');
check((await owned(pf, 'parasol')) === 1, 'the parasol is in her bag');
await pf.waitForFunction((c) => window.__beech.neighbors().visiting?.code === c, anaCode, { timeout: 60000 });
check(true, "she lands on Ana's beach");
if (shots) await pf.screenshot({ path: `${shots}/invite-welcome.png` });
// (the request itself is checked from Ana's side below: "Fran has asked to be her neighbor")
await pf.waitForFunction(() => window.__beech.guide.done.has('visit'), null, { timeout: 60000 });
check(true, 'visiting Ana counts as the guide’s visit step');

// Home, then three guide steps. Wait for the home simulation to bind
// before hitting sand, and aim at dry land in the portrait viewport.
await pf.bringToFront();
await pf.evaluate(async () => {
  await window.__beech.neighbors().visit(null);
  window.__beech.cam.goTo(0, true);
});
await pf.waitForFunction(() => {
  const app = window.__beech;
  return !app.neighbors().visiting && app.beachId() === app.account().home?.id && app.sync().state === 'saved';
});
const drag = async (tool) => {
  const [from, to] = await pf.evaluate((tool) => {
    const app = window.__beech;
    app.setRail(true);
    app.pickTool(tool);
    const scene = app.scene;
    const camera = scene.activeCamera;
    const canvas = app.engine.getRenderingCanvas();
    camera.getViewMatrix(true);
    camera.getProjectionMatrix(true);
    scene.updateTransformMatrix();
    const Vector = camera.position.constructor;
    const world = camera.getWorldMatrix().constructor.Identity();
    const viewport = camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight);
    return [-1, 2].map((x) => {
      const z = 7;
      const y = app.cam.groundHeight(x, z);
      const point = Vector.Project(new Vector(x, y, z), world, scene.getTransformMatrix(), viewport);
      return [point.x, point.y];
    });
  }, tool);
  await pf.mouse.move(...from);
  await pf.mouse.down();
  for (let i = 1; i <= 16; i++) {
    await pf.mouse.move(from[0] + (to[0] - from[0]) * i / 16, from[1] + (to[1] - from[1]) * i / 16);
    await pf.waitForTimeout(30);
  }
  await pf.mouse.up();
};
await drag('dig');
await pf.waitForFunction(() => window.__beech.guide.done.has('dig'), null, { timeout: 60000 });
await drag('pile');
await pf.waitForTimeout(300);
await pf.keyboard.press('Control+z');
await pf.waitForFunction(() => ['dig', 'pile', 'undo'].every((s) => window.__beech.guide.done.has(s)), null, { timeout: 60000 });
// the server has them too, with their gifts
await pf.waitForFunction(async () => (await window.__beech.account().inventory()).some((i) => i.item === 'conch'), null, { timeout: 60000 });
check((await owned(pf, 'conch')) >= 2 && (await owned(pf, 'sanddollar')) >= 2, 'guide steps leave gifts in her bag (conches and sand dollars)');
await pf.evaluate(() => window.__beech.guide.open());
await pf.waitForSelector('.guide.open .guide-row.done', { timeout: 60000 });
check((await pf.$$('.guide-row.done')).length >= 4, 'the guide shows four steps done');
if (shots) await pf.screenshot({ path: `${shots}/guide-panel.png` });

// ---- Ana comes back
await signIn(pa, `${ana}-other`);
await signIn(pa, ana);
await pa.waitForFunction(() => [...document.querySelectorAll('.hint')].some((h) => h.textContent.includes('settled in')), null, { timeout: 60000 });
check((await hints(pa)).some((h) => h.includes(`${fran} settled in`) && h.includes('parasol')), 'Ana is told Fran settled in, and what she got');
check((await owned(pa, 'parasol')) === 1, "Ana's parasol is in her bag");
const asks = await pa.evaluate(() => window.__beech.neighbors().api.get().then((n) => n.requests.map((r) => r.name)));
check(asks.includes(fran), 'Fran has asked to be her neighbor');
check(await pa.evaluate(() => window.__beech.guide.done.has('invite')), "Ana's guide has its invite step done");
await pa.evaluate(() => window.__beech.invites().open());
await pa.waitForSelector('.invite.open .invite-friends li b', { timeout: 60000 });
const friends = await pa.$$eval('.invite-friends li', (lis) => lis.map((l) => l.textContent));
check(friends.some((f) => f.includes(fran) && f.includes('settled in')), 'the panel lists Fran as settled in');
check((await pa.$$('.invite-rung.done')).length === 1, 'the first rung is ticked');
if (shots) await pa.screenshot({ path: `${shots}/invite-panel.png` });

// a second sign-in doesn't tell her again
await pa.evaluate(() => document.querySelectorAll('.hint').forEach((h) => h.remove()));
await signIn(pa, `${ana}-other2`);
await signIn(pa, ana);
await pa.waitForTimeout(800);
const told = (await hints(pa)).filter((h) => h.includes('settled in')).length;
check(told <= 1, 'she is told once');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await closeBrowser();
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('all invite checks passed');
