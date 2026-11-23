import { describe, expect, it } from 'vitest';
import { errorEvent, perfEvent } from '../src/net/telemetry';

describe('client telemetry payloads', () => {
  it('builds an error event and cuts over-long fields', () => {
    const e = errorEvent('kaboom', 'main.ts:12:3', '/beach');
    expect(e).toEqual({ kind: 'error', message: 'kaboom', source: 'main.ts:12:3', path: '/beach' });
    const long = errorEvent('x'.repeat(600), undefined, '/');
    expect(long.message).toHaveLength(500);
    expect(long.source).toBeUndefined();
    expect(errorEvent('', undefined, '/').message).toBe('unknown error');
  });

  it('builds a perf sample from navigation timing, and rejects junk', () => {
    expect(perfEvent({ loadEventEnd: 1234.4, domContentLoadedEventEnd: 800.6 })).toEqual({
      kind: 'perf',
      load_ms: 1234,
      dcl_ms: 801,
    });
    expect(perfEvent(null)).toBeNull();
    expect(perfEvent({ loadEventEnd: -1, domContentLoadedEventEnd: 5 })).toBeNull();
    expect(perfEvent({ loadEventEnd: Number.NaN, domContentLoadedEventEnd: 5 })).toBeNull();
  });
});
