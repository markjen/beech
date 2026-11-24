import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetTelemetryForTests,
  clientEventsUrl,
  errorEvent,
  initTelemetry,
  perfEvent,
  reportError,
  reportEvent,
  sanitizeMeta,
  sanitizeStack,
  sendClientEvent,
  telemetryEvent,
} from '../src/net/telemetry';

afterEach(() => {
  _resetTelemetryForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('client telemetry payloads', () => {
  it('builds an error event and cuts over-long fields', () => {
    const e = errorEvent('kaboom', 'main.ts:12:3', '/beach', {
      category: 'auth',
      stack: 'Error: kaboom\n    at foo (https://play.beech.games/app.js?visit=SECRET#hash:1:2)',
      meta: { method: 'native_google', status: 401, ok: false },
      context: { platform: 'android', version: '1.0.0', build: 'abc123' },
    });
    expect(e).toEqual({
      kind: 'error',
      message: 'kaboom',
      category: 'auth',
      source: 'main.ts:12:3',
      stack: 'Error: kaboom\n    at foo (https://play.beech.games/app.js:1:2)',
      path: '/beach',
      platform: 'android',
      version: '1.0.0',
      build: 'abc123',
      meta: { method: 'native_google', status: 401, ok: false },
    });
    const long = errorEvent('x'.repeat(600), undefined, '/');
    expect(long.message).toHaveLength(500);
    expect(long.source).toBeUndefined();
    expect(errorEvent('', undefined, '/').message).toBe('unknown error');
    expect(errorEvent('bad path', undefined, 'no-slash').path).toBe('/');
  });

  it('builds a perf sample from navigation timing, and rejects junk', () => {
    expect(
      perfEvent(
        { loadEventEnd: 1234.4, domContentLoadedEventEnd: 800.6 },
        { tier: 'medium', bench_ms: 6.44, context: { platform: 'web', version: '1.0.0' } },
      ),
    ).toEqual({
      kind: 'perf',
      load_ms: 1234,
      dcl_ms: 801,
      tier: 'medium',
      bench_ms: 6.4,
      platform: 'web',
      version: '1.0.0',
    });
    expect(perfEvent(null)).toBeNull();
    expect(perfEvent({ loadEventEnd: -1, domContentLoadedEventEnd: 5 })).toBeNull();
    expect(perfEvent({ loadEventEnd: Number.NaN, domContentLoadedEventEnd: 5 })).toBeNull();
  });

  it('builds general telemetry events and rejects invalid names', () => {
    expect(telemetryEvent('app_boot', { tier: 'low', touch: true }, { platform: 'ios', version: '1.0.0' })).toEqual({
      kind: 'event',
      name: 'app_boot',
      platform: 'ios',
      version: '1.0.0',
      meta: { tier: 'low', touch: true },
    });
    expect(telemetryEvent('', {})).toBeNull();
    expect(telemetryEvent('bad event name!')).toBeNull();
  });

  it('sanitizes stack traces and metadata', () => {
    expect(sanitizeStack('at https://beech.games/a.js?visit=K7F2QX:10:2')).toBe('at https://beech.games/a.js:10:2');
    expect(sanitizeStack(undefined)).toBeUndefined();
    expect(
      sanitizeMeta({
        good_key: 'a'.repeat(200),
        num: 42,
        badNum: Number.NaN,
        'bad key!': 'ignored',
        nested: { nope: true },
      }),
    ).toEqual({ good_key: 'a'.repeat(120), num: 42 });
  });

  it('resolves relative and absolute client-events URLs', () => {
    expect(clientEventsUrl('')).toBe('/api/client-events');
    expect(clientEventsUrl('https://play.beech.games')).toBe('https://play.beech.games/api/client-events');
    expect(clientEventsUrl('https://beech.markjen.com/')).toBe('https://beech.markjen.com/api/client-events');
  });
});

describe('client telemetry delivery', () => {
  it('posts to VITE_API_URL via CORS-safe fetch with keepalive', () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', mockFetch);
    sendClientEvent(
      errorEvent('boom', 'nativeAuth:google', '/', { category: 'auth', context: { platform: 'android' } }),
      'https://beech.markjen.com',
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://beech.markjen.com/api/client-events');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toMatchObject({ kind: 'error', category: 'auth', platform: 'android', message: 'boom' });
  });

  it('is a no-op before initTelemetry and deduplicates rapid repeat errors after init', () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', mockFetch);
    reportError('auth', new Error('before init'));
    reportEvent('app_boot', { tier: 'medium' });
    expect(mockFetch).not.toHaveBeenCalled();

    // minimal window stub for initTelemetry
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    vi.stubGlobal('window', {
      location: { pathname: '/' },
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        (listeners[type] ??= []).push(fn);
      },
    });
    initTelemetry('https://play.beech.games');
    reportError('auth', new Error('[16] Account reauth failed'), { source: 'accountPanel:native_google' });
    reportError('auth', new Error('[16] Account reauth failed'), { source: 'accountPanel:native_google' });
    reportError('shop', { message: 'Billing unavailable', code: 'BILLING_UNAVAILABLE' }, { source: 'shop:purchase' });
    reportEvent('auth_cancel', { method: 'native_google' });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[0][0]).toBe('https://play.beech.games/api/client-events');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
      kind: 'error',
      category: 'auth',
      message: '[16] Account reauth failed',
      source: 'accountPanel:native_google',
    });
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toMatchObject({
      kind: 'error',
      category: 'shop',
      message: 'Billing unavailable',
      source: 'shop:purchase',
      meta: { code: 'BILLING_UNAVAILABLE' },
    });
    expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toMatchObject({
      kind: 'event',
      name: 'auth_cancel',
      meta: { method: 'native_google' },
    });
  });
});
