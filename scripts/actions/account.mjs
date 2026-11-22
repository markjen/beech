export default async function (page) {
  await page.evaluate(() => window.__beech.sheet.show());
  await page.waitForTimeout(400);
  await page.click('button[data-act="dev"]');
  await page.waitForFunction(() => window.__beech.sync()?.state === 'saved', null, { timeout: 15000 });
  await page.waitForTimeout(300);
}
