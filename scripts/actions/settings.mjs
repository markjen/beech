export default async function (page) {
  await page.evaluate(() => window.__beech.sheet.show());
  await page.waitForTimeout(700);
}
