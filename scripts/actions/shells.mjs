// Wait for the sea to bring something in, then zoom in on it.
export default async function (page) {
  await page.waitForFunction(() => window.__beech.info().objects.some((o) => o.wild), null, { timeout: 240000 });
  await page.evaluate(() => {
    const b = window.__beech;
    const s = b.info().objects.find((o) => o.wild);
    b.cam.halfH = 2.6;
    b.cam.applyOrtho();
    b.cam.camera.target.x = s.x + b.origin.x;
    b.cam.camera.target.z = s.y + b.origin.z;
  });
  await page.waitForTimeout(2500);
}
