/**
 * Repro for Discord #bugs 1574941390083723265 (rosejen):
 * "One of my beaches (roro) was overridden when I was switching to the beach"
 *
 * Hypothesis: two switchTo() calls overlapping (tapping a second beach while
 * the first is still loading) let the second call's pre-switch flush save the
 * still-loaded old beach's sand into the first target beach. A timer-fired
 * flush mid-switch has the same hole: the sim still shows the old beach
 * while account.beachId already names the new one.
 */
import { describe, expect, it } from 'vitest';
import { BeachSync, type SyncHost } from '../src/net/beachSync';
import { encodeSand, decodeSand } from '../src/sim/sandCodec';

// BeachSync touches window timers; node has the same functions.
(globalThis as any).window = globalThis;

const NX = 4;
const NY = 4;

function sandBytes(fill: number): Promise<Uint8Array> {
  return encodeSand(new Float32Array(NX * NY).fill(fill), NX, NY, []);
}

async function sandFill(bytes: Uint8Array): Promise<number> {
  const { delta } = await decodeSand(bytes);
  return delta[0];
}

async function makeWorld() {
  // Server-side store: beach id -> saved bytes. B and C already have sand.
  const store = new Map<string, Uint8Array>([
    ['B', await sandBytes(2)],
    ['C', await sandBytes(3)],
  ]);
  const saves: { beach: string; fill: number }[] = [];

  // The sim currently shows beach A's sand (fill 1).
  let simFill = 1;
  const host: SyncHost = {
    grid: { nx: NX, ny: NY },
    location: () => 'test',
    setLocation: () => {},
    getSand: async () => ({ delta: new Float32Array(NX * NY).fill(simFill), objects: [] }),
    setSand: (delta) => {
      simFill = delta[0];
    },
  };

  let beachId: string | null = 'A';
  const account: any = {
    user: { id: 'u1' },
    get beachId() {
      return beachId;
    },
    onChange: () => {},
    setBeach: (id: string | null) => {
      beachId = id;
    },
    // Slow load so a second switch / flush can start while the first is in flight.
    loadBeach: async () => {
      await new Promise((r) => setTimeout(r, 30));
      const bytes = beachId ? store.get(beachId) : undefined;
      if (!bytes) return null;
      return { location: '', nx: NX, ny: NY, updatedAt: 1, epoch: 0, bytes };
    },
    saveBeach: async (bytes: Uint8Array) => {
      saves.push({ beach: beachId!, fill: await sandFill(bytes) });
      if (beachId) store.set(beachId, bytes);
      return Date.now();
    },
  };

  const sync = new BeachSync(account, host);
  return { store, saves, sync, getSimFill: () => simFill };
}

describe('switchTo race', () => {
  it('a second switch while the first is loading must not save old sand into the first beach', async () => {
    const { store, saves, sync, getSimFill } = await makeWorld();

    const first = sync.switchTo('B');
    // While B is still loading, the user taps another beach.
    await new Promise((r) => setTimeout(r, 5));
    await sync.switchTo('C');
    await first;

    // B must still hold its own sand (fill 2), not A's (fill 1).
    expect(await sandFill(store.get('B')!)).toBe(2);
    expect(getSimFill()).toBe(3); // ended on C
    expect(saves.filter((s) => s.beach === 'B' && s.fill === 1)).toEqual([]);
  });

  it('a flush fired mid-switch (90s interval / offline retry) must not save old sand into the new beach', async () => {
    const { store, saves, sync, getSimFill } = await makeWorld();

    const switching = sync.switchTo('B');
    // While B is still loading, a timer fires a save — the sim still shows A.
    await new Promise((r) => setTimeout(r, 5));
    await sync.flush();
    await switching;

    // B must still hold its own sand (fill 2), not A's (fill 1).
    expect(await sandFill(store.get('B')!)).toBe(2);
    expect(getSimFill()).toBe(2); // ended on B
    expect(saves.filter((s) => s.beach === 'B' && s.fill === 1)).toEqual([]);
  });
});
