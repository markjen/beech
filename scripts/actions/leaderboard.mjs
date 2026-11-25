// Screenshot action (production build + npm run server:dev): sign in as a
// fan and open the leaderboard. Pass LB_BOARD=rising for the Rising tab.
export default async function (page) {
  await page.evaluate(async () => {
    const b = window.__beech;
    if (b.account().user) await b.account().signOut();
    await b.account().signInDev('Shot');
    await b.neighbors().loadFavorites();
  });
  await page.evaluate(() => window.__beech.setRail(true));
  await page.click('[data-act="inbox"]');
  await page.click('.board.open .hub-tabs [data-hub="leaderboard"]');
  if (process.env.LB_BOARD === 'rising') await page.click('.board-tabs button[data-board="rising"]');
  await page.waitForSelector('.board.open .board-row', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
}
