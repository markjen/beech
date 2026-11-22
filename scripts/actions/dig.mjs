// Draw a curvy trench with the mouse, hold to dig a hole, then hover.
export default async function (page) {
  const vp = page.viewportSize();
  const cx = vp.width * 0.42;
  const cy = vp.height * 0.62;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    await page.mouse.move(cx + t * vp.width * 0.25, cy + Math.sin(t * 6) * 30);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  // hold still for a deep hole
  await page.mouse.move(cx - 80, cy - 60);
  await page.mouse.down();
  await page.waitForTimeout(1600);
  await page.mouse.up();
  await page.mouse.move(cx + 120, cy + 70);
  await page.waitForTimeout(600);
}
