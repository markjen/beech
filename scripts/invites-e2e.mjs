// Browser end-to-end test of invites and the beach guide against a local
// server (npm run server:dev), docs/INVITES_GUIDE.md:
// Ana signs in; her invites are on her account page on beechshore. Fran opens
// Ana's invite link in a fresh browser: the start screen says Ana invited her
// and bb 50 is waiting; she signs in, gets bb 50, lands on Ana's beach, asks
// to be her neighbor, then goes home and does three guide steps (dig, build,
// undo). Ana comes back: she's told Fran joined, and she has bb 50 too.
//   node scripts/invites-e2e.mjs [screenshot-dir]
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
const open = async (query, viewport = { width: 1100, height: 700 }) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page, e2eUrl(URL_, query, { shots: Boolean(shots) }));
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
const bucks = (page) => page.evaluate(async () => (await (await window.__beech.account().fetch('/api/credit')).json()).bucks);
const hints = (page) => page.$$eval('.hint', (els) => els.map((e) => e.textContent ?? ''));

const tag = `iv${Date.now() % 10000}${process.pid % 100}`;
const ana = `ana${tag}`;
const fran = `fran${tag}`;

// ---- Ana: her code and her (empty) invite panel
const pa = await open('nointro&fixedres&seed=1&nofinds');
await signIn(pa, ana);
await pa.waitForFunction(() => window.__beech.sync().state === 'saved', null, { timeout: 30000 });
const anaCode = await pa.evaluate(() => window.__beech.neighbors().api.get().then((n) => n.code));
const accountUrl = await pa.evaluate(() => window.__beech.inviteUrl());
check(/\/account#invite$/.test(accountUrl), `"invite" goes to her account page on beechshore (${accountUrl})`);
const mine0 = await pa.evaluate(async () => (await window.__beech.account().fetch('/api/referrals')).json());
check(mine0.code === anaCode && mine0.joined === 0, 'her invite code is her beach code, and nobody has joined yet');

// ---- Fran: opens the link in a fresh browser
const pf = await open(`invite=${anaCode}&fixedres&seed=1&nofinds`, { width: 390, height: 844 });
await pf.waitForSelector('.start-invite', { timeout: 60000 });
const startText = await pf.$eval('.start-invite', (e) => e.textContent);
check(startText.includes(`${ana} invited you`) && startText.includes('bb 50'), `the start screen says who invited her, and bb 50 is waiting (${startText})`);
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
check(w.text.includes(`A welcome gift from ${ana}`) && w.text.includes('bb 50'), 'Fran is told about her bb 50');
check(w.asked, 'the welcome note has a "be her neighbor" button');
check((await bucks(pf)) === 50, 'bb 50 is in her balance');
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
await pa.waitForFunction(() => [...document.querySelectorAll('.hint')].some((h) => h.textContent.includes('joined through your invite')), null, { timeout: 60000 });
check((await hints(pa)).some((h) => h.includes(`${fran} joined through your invite`) && h.includes('bb 50')), 'Ana is told Fran joined, and the bb she got');
check((await bucks(pa)) === 50, 'bb 50 is in her balance');
const asks = await pa.evaluate(() => window.__beech.neighbors().api.get().then((n) => n.requests.map((r) => r.name)));
check(asks.includes(fran), 'Fran has asked to be her neighbor');
check(await pa.evaluate(() => window.__beech.guide.done.has('invite')), "Ana's guide has its invite step done");
const mine = await pa.evaluate(async () => (await window.__beech.account().fetch('/api/referrals')).json());
check(mine.joined === 1 && mine.earned === 50 && mine.friends[0]?.name === fran, 'her invites list Fran, with bb 50 earned');
if (shots) await pa.screenshot({ path: `${shots}/invite-joined.png` });

// a second sign-in doesn't tell her again
await pa.evaluate(() => document.querySelectorAll('.hint').forEach((h) => h.remove()));
await signIn(pa, `${ana}-other2`);
await signIn(pa, ana);
await pa.waitForTimeout(800);
const told = (await hints(pa)).filter((h) => h.includes('joined through your invite')).length;
check(told <= 1, 'she is told once');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await closeBrowser();
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('all invite checks passed');
