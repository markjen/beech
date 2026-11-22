export default async function (page) {
  await page.waitForTimeout(Number(process.env.WAIT_MS || 6000));
}
