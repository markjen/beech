import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shortfall } from '../src/world/checkpointFit';
import { ITEMS } from '../src/world/items';
import { countItems } from '../src/net/beachSync';

describe('checkpoint fit', () => {
  it('matches the shared cases (the server runs the same file)', () => {
    const { cases } = JSON.parse(readFileSync(new URL('./fixtures/checkpoint-fit.json', import.meta.url), 'utf8')) as {
      cases: { name: string; need: Record<string, number>; owned: Record<string, number>; elsewhere: Record<string, number>; short: unknown[] }[];
    };
    for (const k of cases) {
      expect(shortfall(k.need, k.owned, k.elsewhere), k.name).toEqual(k.short);
      expect(shortfall(k.need, new Map(Object.entries(k.owned)), new Map(Object.entries(k.elsewhere))), k.name).toEqual(k.short);
    }
  });

  it("the server's free items are the catalog's unlimited ones", () => {
    const src = readFileSync(new URL('../server/src/checkpoints.ts', import.meta.url), 'utf8');
    const m = /FREE_ITEMS[^=]*= new Set\(\[([^\]]*)\]\)/.exec(src);
    const server = [...(m?.[1] ?? '').matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]).sort();
    expect(server).toEqual(ITEMS.filter((i) => i.unlimited).map((i) => i.id).sort());
  });

  it('a beach counts its non-free things, wild ones too (as the server does)', () => {
    const o = (item: string, wild = false) => ({ id: 1, kind: 'rock' as const, item, x: 1, y: 1, angle: 0, size: 1, variant: 1, ...(wild ? { wild } : {}) });
    expect(countItems([o('rock'), o('lighthouse'), o('lighthouse', true), o('shell', true)])).toEqual({ lighthouse: 2 });
  });
});
