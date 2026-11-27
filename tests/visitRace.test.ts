/**
 * Repro for the visit() race (found by e2e verification, Nov 27):
 * two overlapping visit() calls — the last fetch to finish used to win,
 * not the last call. Going home in the first second after signing in from
 * an invite link could be undone by the pending visit landing late.
 * anchorAt carries a generation now: a superseded visit stands down
 * instead of overwriting the newer anchor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Account, type Shore, type ShoreBeach } from '../src/net/account';
import { BeachStore, type StoreBackend } from '../src/net/beachStore';
import { NeighborView } from '../src/render/neighbors';
import { buildRestProfile } from '../src/sim/profile';

// The race under test is in anchorAt, not in drawing: stand in a renderer
// that records nothing and touches no WebGL, keeping the real constants.
vi.mock('../src/render/beachRenderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/beachRenderer')>();
  class BeachRendererStub {
    offsetX: number;
    grid: { ny: number };
    constructor(
      _scene: unknown,
      grid: { ny: number },
      _rest: Float32Array,
      _swell: unknown,
      x: number,
    ) {
      this.grid = grid;
      this.offsetX = x;
    }
    dispose() {}
    resize(grid: { ny: number }) {
      this.grid = grid;
    }
    setChairView(_on: boolean) {}
    setNeighbors(_a: unknown, _b: unknown) {}
    easeStatic(_buf: Float32Array, _ms: number) {}
    showStatic(_buf: Float32Array) {}
  }
  return { ...actual, BeachRenderer: BeachRendererStub as unknown as typeof actual.BeachRenderer };
});
vi.mock('../src/render/objects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/objects')>();
  class ObjectViewStub {
    constructor(
      _scene: unknown,
      _renderer: unknown,
      _offsetX = 0,
    ) {}
    dispose() {}
    setStatic(_objs: unknown, _heightAt: unknown) {}
  }
  return { ...actual, ObjectView: ObjectViewStub as unknown as typeof actual.ObjectView };
});

// Neighbors touches window timers and (via the live poll) document.hidden;
// node has the same timer functions.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
(globalThis as unknown as { document: { hidden: boolean } }).document = { hidden: false };

const grid = { nx: 8, ny: 8, dx: 4 };
const rest = buildRestProfile(grid, 1);

function beach(code: string): ShoreBeach {
  return { id: `id-${code || 'home'}`, code, name: '', location: null, updatedAt: null };
}

function shoreFor(code: string | null): Shore {
  return { center: { ...beach(code ?? ''), you: false }, left: [], right: [] };
}

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('overlapping visit() calls', () => {
  let nv: NeighborView;
  // existence checks (depth=0) held open by code, so a second visit can
  // start while the first is still in flight
  let held: Map<string, Deferred<Shore>>;

  beforeEach(() => {
    held = new Map();
    vi.stubGlobal(
      'fetch',
      async (url: string) => {
        const u = new URL(String(url), 'http://test');
        if (!u.pathname.endsWith('/shore')) throw new Error(`unexpected fetch ${url}`);
        const depth = u.searchParams.get('depth');
        const code = u.searchParams.get('code');
        if (depth === '0' && code) {
          const d = held.get(code);
          const body = d
            ? await d.promise
            : code === 'NOPE00'
              ? { center: null, left: [], right: [] }
              : shoreFor(code);
          return new Response(JSON.stringify(body), { status: 200 });
        }
        // a refresh (depth=6): the shore around the anchor, at once
        return new Response(JSON.stringify(shoreFor(code)), { status: 200 });
      },
    );
    const backend: StoreBackend = {
      async load() {
        return null;
      },
      async save() {
        return { updatedAt: Date.now() };
      },
    };
    const store = new BeachStore(grid, rest, backend);
    const account = new Account();
    const cam = { focusX: 0, groundFootprint: () => null, maxX: 0, minX: 0 };
    nv = new NeighborView({} as never, grid, rest, {} as never, cam as never, account, store);
  });

  afterEach(() => {
    nv.clear();
    vi.unstubAllGlobals();
  });

  it('going home while an invite visit is in flight stays home', async () => {
    held.set('INV000', deferred<Shore>());
    const first = nv.visit('INV000');
    await Promise.resolve(); // let the existence check start
    await nv.visit(null); // go home: completes while the check hangs
    held.get('INV000')!.resolve(shoreFor('INV000'));
    await first;
    expect(nv.anchorCode).toBe(null);
    expect(nv.beachAt(0)?.id).toBe('id-home');
  });

  it('of two overlapping visits, the last call wins even when its check is slower to finish', async () => {
    held.set('AAAAAA', deferred<Shore>());
    held.set('BBBBBB', deferred<Shore>());
    const first = nv.visit('AAAAAA');
    const second = nv.visit('BBBBBB');
    held.get('BBBBBB')!.resolve(shoreFor('BBBBBB'));
    await second;
    held.get('AAAAAA')!.resolve(shoreFor('AAAAAA'));
    await first;
    expect(nv.anchorCode).toBe('BBBBBB');
    expect(nv.beachAt(0)?.id).toBe('id-BBBBBB');
  });

  it('a single visit still lands, and an unknown code still throws', async () => {
    await nv.visit('AAAAAA');
    expect(nv.anchorCode).toBe('AAAAAA');
    expect(nv.beachAt(0)?.id).toBe('id-AAAAAA');
    await expect(nv.visit('NOPE00')).rejects.toThrow('could not find that beach');
    expect(nv.anchorCode).toBe('AAAAAA');
  });

  it('a superseded visit to an unknown beach stays silent', async () => {
    held.set('NOPE00', deferred<Shore>());
    const first = nv.visit('NOPE00');
    await nv.visit('BBBBBB');
    held.get('NOPE00')!.resolve({ center: null, left: [], right: [] });
    await expect(first).resolves.toBeUndefined();
    expect(nv.anchorCode).toBe('BBBBBB');
  });
});
