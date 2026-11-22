// Programmatically dig a moat + channel + mound around the swash line, then watch the waves.
export default async function (page) {
  const shots = process.env.SHOT_PREFIX || 'erode';
  await page.evaluate(async () => {
    const b = window.__beech;
    b.cam.halfH = 5;
    b.cam.applyOrtho();
    b.cam.camera.target.x = 0;
    b.cam.camera.target.z = -1.5;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const stroke = async (pts, r, mode = 'dig', hold = 40) => {
      b.send({ type: 'brush', phase: 'start', x: pts[0][0], y: pts[0][1], r, mode });
      for (const [x, y] of pts) {
        b.send({ type: 'brush', phase: 'move', x, y, r, mode });
        await sleep(hold);
      }
      b.send({ type: 'brush', phase: 'end' });
    };
    // moat ring centred on the upper swash zone
    const ring = [];
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      ring.push([16 + Math.cos(a) * 1.6, 12.2 + Math.sin(a) * 1.6]);
    }
    await stroke(ring, 0.3);
    // channel from the dry beach down to the sea
    const ch = [];
    for (let i = 0; i <= 30; i++) ch.push([20, 14.5 - i * 0.18]);
    await stroke(ch, 0.25);
    // a mound to be knocked down
    await stroke([[12, 11.2], [12, 11.2], [12, 11.2], [12.05, 11.2]], 0.6, 'pile', 400);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}-0.png` });
  await page.waitForTimeout(Number(process.env.ERODE_MS || 20000));
}
