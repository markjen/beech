// A copy waiting on a web checkout (docs/COPY_BEACH.md): kept on the device for a day.
import { beforeEach, describe, expect, it } from 'vitest';
import { rememberCopy, takePendingCopy } from '../src/ui/copyBeach';

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
});

describe('pending copy', () => {
  it('comes back once, and not after a day', () => {
    rememberCopy({ code: 'K7F2QX', target: 'new', mode: 'strict' }, 1000);
    expect(takePendingCopy(2000)).toEqual({ code: 'K7F2QX', target: 'new', mode: 'strict', at: 1000 });
    expect(takePendingCopy(2000)).toBeNull();
    rememberCopy({ code: 'K7F2QX', target: 'abc', mode: 'strict' }, 0);
    expect(takePendingCopy(25 * 3600 * 1000)).toBeNull();
  });
});
