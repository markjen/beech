export default async function (page) {
  const vp = page.viewportSize();
  await page.evaluate(() => {
    const b = window.__beech;
    b.cam.halfH = 6;
    b.cam.applyOrtho();
    b.cam.camera.target.z = 2;
  });
  await page.waitForTimeout(300);
  await page.keyboard.press('2'); // build
  const cx = vp.width * 0.35;
  const cy = vp.height * 0.6;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(1200);
  for (let i = 0; i < 25; i++) {
    await page.mouse.move(cx + i * 6, cy - i * 2);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.keyboard.press('1'); // dig a moat around it
  await page.mouse.move(cx + 220, cy - 40);
  await page.mouse.down();
  for (let i = 0; i < 25; i++) {
    await page.mouse.move(cx + 220 + i * 5, cy - 40 + i * 4);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.keyboard.press('3'); // smooth half of the dig
  await page.mouse.move(cx + 240, cy - 20);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(cx + 240 + (i % 5) * 6, cy - 20 + i);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.mouse.move(vp.width * 0.5, vp.height * 0.3);
  await page.waitForTimeout(500);
}
