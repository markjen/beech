// frames from the diorama -> chair flight
export default async function (page) {
  const out = process.env.SHOT_PREFIX || 'trans';
  await page.evaluate(() => window.__beech.view('chair'));
  for (const [i, t] of [[1, 0.35], [2, 0.6], [3, 0.85]]) {
    await page.waitForFunction((tt) => (window.__beech.cam.anim?.t ?? 1) >= tt, t, { timeout: 20000 });
    await page.screenshot({ path: `${out}-${i}.png` });
  }
  await page.waitForFunction(() => !window.__beech.cam.animating, null, { timeout: 20000 });
}
