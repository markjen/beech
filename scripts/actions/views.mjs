// screenshots of the tilted diorama and the chair view
export default async function (page) {
  const out = process.env.SHOT_PREFIX || 'views';
  await page.evaluate(() => {
    const c = window.__beech.cam;
    c.tilt(0.35); // toward the horizon
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}-tilt.png` });
  await page.evaluate(() => window.__beech.view('chair'));
  await page.waitForTimeout(1500);
}
