export default async function (page) {
  const vp = page.viewportSize();
  const cx = vp.width * 0.45;
  const cy = vp.height * 0.6;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(30);
  }
  await page.mouse.down();
  for (let i = 0; i <= 30; i++) {
    await page.mouse.move(cx + i * 8, cy + Math.sin(i / 5) * 40);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.mouse.move(cx - 100, cy - 80);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await page.mouse.move(10, 10);
  await page.waitForTimeout(800);
}
