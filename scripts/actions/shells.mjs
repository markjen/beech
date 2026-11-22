export default async function (page) {
  await page.evaluate(() => {
    const b = window.__beech;
    b.cam.halfH = 4;
    b.cam.applyOrtho();
    b.cam.camera.target.z = -1.5;
  });
  await page.waitForFunction(() => window.__beech.shells.count > 0, null, { timeout: 90000 });
  await page.evaluate(() => {
    const b = window.__beech;
    const s = b.shells.shells[0];
    b.cam.halfH = 2.6;
    b.cam.applyOrtho();
    b.cam.camera.target.x = s.x;
    b.cam.camera.target.z = s.z;
  });
  await page.waitForTimeout(2500);
}
