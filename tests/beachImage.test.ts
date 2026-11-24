// The server draws beaches for beechshore.com and link previews
// (server/src/beachImage.ts). It carries copies of the app's beach shape,
// palette and real-beach tints; these tests keep them in step, and check a
// saved beach decodes and draws.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DAY, PLACES, PROFILE as SERVER_PROFILE, beachPng, decodeSavedBeach, renderBeach, restHeight as serverRest } from '../server/src/beachImage';
import { PROFILE, WORLD_SIZE_X, WORLD_SIZE_Z } from '../src/config';
import { paletteByName } from '../src/palette';
import { restHeight } from '../src/sim/profile';
import { encodeSand } from '../src/sim/sandCodec';
import { parseBeachFile } from '../src/world/beachFile';
import { BEACHES } from '../src/world/locations';

const hex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

describe('server beach pictures stay in step with the app', () => {
  it('has the same untouched beach', () => {
    expect(WORLD_SIZE_X).toBe(32);
    expect(WORLD_SIZE_Z).toBe(32);
    for (const k of ['shoreline', 'offshoreDepth', 'swashSlope', 'bermHeight', 'backHeight', 'cuspAmp', 'cuspLength'] as const)
      expect(SERVER_PROFILE[k], k).toBe(PROFILE[k]);
    for (let x = 0; x <= 32; x += 0.37) for (let y = 0; y <= 32; y += 0.53) expect(serverRest(x, y)).toBe(restHeight(x, y));
  });

  it('has the same day palette', () => {
    const day = paletteByName('day');
    for (const [k, v] of Object.entries(DAY)) expect(v, k).toBe(hex(day[k as keyof typeof DAY] as [number, number, number]));
  });

  it('has the same real beaches and tints', () => {
    expect(PLACES.map((p) => p.id)).toEqual(BEACHES.map((b) => b.id));
    for (const b of BEACHES) {
      const p = PLACES.find((q) => q.id === b.id)!;
      expect(p.name).toBe(b.name);
      expect(p.place).toBe(b.place);
      expect(p.sand).toBe(hex(b.sand));
      expect(p.water).toBe(hex(b.water));
      expect(p.sandMix).toBe(b.sandMix);
      expect(p.waterMix).toBe(b.waterMix);
    }
  });
});

describe('drawing a saved beach', () => {
  it('decodes what the app saves, sand and things', async () => {
    const parsed = await parseBeachFile(readFileSync(new URL('../docs/examples/castle-cove.beach.json', import.meta.url), 'utf8'));
    if (!parsed.ok) throw new Error('example did not parse');
    const bytes = await encodeSand(parsed.beach.delta, parsed.beach.nx, parsed.beach.ny, parsed.beach.objects);
    const sand = decodeSavedBeach(bytes);
    expect(sand.nx).toBe(256);
    expect(sand.things.map((t) => t.kind).sort()).toEqual(parsed.beach.objects.map((o) => o.kind).sort());
    let maxErr = 0;
    for (let k = 0; k < sand.delta.length; k++) maxErr = Math.max(maxErr, Math.abs(sand.delta[k] - parsed.beach.delta[k]));
    expect(maxErr).toBeLessThan(0.0006); // millimetres
  });

  it('draws a PNG of the right size, and an untouched beach too', async () => {
    const out = process.env.BEACH_IMAGE_OUT; // set to a folder to look at the pictures
    for (const name of ['castle-cove', 'harbour', 'terrace']) {
      const parsed = await parseBeachFile(readFileSync(new URL(`../docs/examples/${name}.beach.json`, import.meta.url), 'utf8'));
      if (!parsed.ok) throw new Error(`${name} did not parse`);
      const bytes = await encodeSand(parsed.beach.delta, parsed.beach.nx, parsed.beach.ny, parsed.beach.objects);
      const png = beachPng(bytes, { width: 1200, height: 630, location: name === 'terrace' ? 'piha' : 'bondi' });
      expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(png.readUInt32BE(16)).toBe(1200);
      expect(png.readUInt32BE(20)).toBe(630);
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(`${out}/${name}.png`, png);
        writeFileSync(`${out}/${name}-thumb.png`, beachPng(bytes, { width: 480, height: 320, location: 'waikiki' }));
      }
    }
    const blank = renderBeach(null, { width: 60, height: 40 });
    expect(blank.length).toBe(60 * 40 * 3);
    // a broken save still draws (as the untouched beach)
    expect(beachPng(new Uint8Array([1, 2, 3]), { width: 30, height: 20 }).length).toBeGreaterThan(60);
  });

  it('decodes and draws BCH3 saves with buried rock cover', async () => {
    const { BeachSim } = await import('../src/sim/beachSim');
    const { GRID_TIERS, PROFILE: P } = await import('../src/config');
    const sim = new BeachSim(GRID_TIERS.low, 1, { waves: false, erosion: false, healing: false, seep: false });
    sim.placeObject({ kind: 'rock', item: 'rock', x: 16, y: P.shoreline + 8, angle: 0, size: 0.6, variant: 1 });
    for (let s = 0; s < 4; s++) sim.stamp('pile', 16, P.shoreline + 8, 1.0, 0.4);
    const bytes = await encodeSand(sim.sandDelta(), sim.nx, sim.ny, sim.objects.persisted(), sim.sandCover());
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('BCH3');
    const sand = decodeSavedBeach(bytes);
    expect(sand.cover).toBeDefined();
    expect(sand.things[0].base).toBeDefined();
    const png = beachPng(bytes, { width: 120, height: 80, location: 'bondi' });
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
