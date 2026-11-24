import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createDbStats, createRateLimiter, httpLogger, parseClientEvent } from '../src/observability.js';

/** Capture the JSON lines the logger writes via console.log / console.error. */
function captureLogs() {
  const lines: Record<string, unknown>[] = [];
  const take = (args: unknown[]) => {
    for (const a of args) {
      if (typeof a === 'string' && a.startsWith('{')) {
        try {
          lines.push(JSON.parse(a) as Record<string, unknown>);
        } catch {
          /* not a JSON log line */
        }
      }
    }
  };
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => take(args));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => take(args));
  return lines;
}

describe('httpLogger', () => {
  it('logs method, route template, status and latency — never the raw path', async () => {
    const lines = captureLogs();
    const app = new Hono();
    app.use('*', httpLogger);
    app.get('/beaches/:code', (c) => c.json({ ok: true }));
    app.get('/health', (c) => c.json({ ok: true }));
    const r = await app.request('/beaches/K7F2QX');
    expect(r.status).toBe(200);
    const line = lines.find((l) => l.event === 'http_request');
    expect(line).toBeDefined();
    expect(line!.method).toBe('GET');
    expect(line!.route).toBe('/beaches/:code');
    expect(line!.status).toBe(200);
    expect(typeof line!.duration_ms).toBe('number');
    expect(JSON.stringify(line)).not.toContain('K7F2QX');
    vi.restoreAllMocks();
  });

  it('buckets an unmatched path instead of logging it', async () => {
    const lines = captureLogs();
    const app = new Hono();
    app.use('*', httpLogger);
    app.get('/health', (c) => c.json({ ok: true }));
    // like the real server: unmatched GETs fall through to the SPA page
    app.get('*', (c) => c.text('spa'));
    // a GET outside /api lands on the SPA fallback; a POST to nowhere matches nothing
    expect((await app.request('/nonsense/K7F2QX')).status).toBe(200);
    const spa = lines.find((l) => l.event === 'http_request');
    expect(spa!.route).toBe('spa');
    expect(JSON.stringify(spa)).not.toContain('K7F2QX');
    const r = await app.request('/api/nonsense/K7F2QX', { method: 'POST' });
    expect(r.status).toBe(404);
    const un = lines.filter((l) => l.event === 'http_request').pop();
    expect(un!.route).toBe('unmatched');
    expect(JSON.stringify(un)).not.toContain('K7F2QX');
    vi.restoreAllMocks();
  });

  it('logs a throwing handler as a 500 ERROR line', async () => {
    const lines = captureLogs();
    const app = new Hono();
    app.use('*', httpLogger);
    app.onError((_err, c) => c.json({ error: 'boom' }, 500));
    app.get('/boom', () => {
      throw new Error('kaboom');
    });
    const r = await app.request('/boom');
    expect(r.status).toBe(500);
    const line = lines.find((l) => l.event === 'http_request');
    expect(line!.status).toBe(500);
    expect(line!.severity).toBe('ERROR');
    vi.restoreAllMocks();
  });
});

describe('parseClientEvent', () => {
  it('accepts enriched client errors, perf samples and telemetry events', () => {
    const err = parseClientEvent({
      kind: 'error',
      category: 'auth',
      message: 'kaboom',
      source: 'main.ts:12:3',
      stack: 'Error: kaboom\n  at login',
      path: '/',
      platform: 'android',
      version: '1.0.0',
      build: 'abc123',
      meta: { method: 'native_google', status: 401, retry: true },
    });
    expect(err.ok).toBe(true);
    if (err.ok && err.event.kind === 'error') {
      expect(err.event.category).toBe('auth');
      expect(err.event.platform).toBe('android');
      expect(err.event.meta).toEqual({ method: 'native_google', status: 401, retry: true });
    }
    expect(parseClientEvent({ kind: 'perf', load_ms: 1234, dcl_ms: 800, platform: 'web', tier: 'medium', bench_ms: 6.4 }).ok).toBe(true);
    expect(parseClientEvent({ kind: 'event', name: 'app_boot', platform: 'ios', version: '1.0.0', meta: { tier: 'low', touch: true } }).ok).toBe(true);
  });

  it('rejects bad kinds, invalid platforms/meta, missing fields and impossible timings', () => {
    expect(parseClientEvent({ kind: 'nope' }).ok).toBe(false);
    expect(parseClientEvent({ kind: 'error' }).ok).toBe(false);
    expect(parseClientEvent({ kind: 'error', message: '' }).ok).toBe(false);
    expect(parseClientEvent({ kind: 'error', message: 'x', platform: 'atari' }).ok).toBe(false);
    expect(parseClientEvent({ kind: 'error', message: 'x', category: 'bad cat!' }).ok).toBe(false);
    expect(parseClientEvent({ kind: 'error', message: 'x', meta: { 'bad key': 1 } }).ok).toBe(false);
    expect(parseClientEvent({ kind: 'error', message: 'x', meta: { nested: {} } }).ok).toBe(false);
    // an over-long message is accepted but cut to 500 chars, not dropped
    const long = parseClientEvent({ kind: 'error', message: 'x'.repeat(501) });
    expect(long.ok).toBe(true);
    if (long.ok && long.event.kind === 'error') expect(long.event.message).toHaveLength(500);
    expect(parseClientEvent({ kind: 'error', message: 'x', path: 'no-slash' }).ok).toBe(false);
    expect(parseClientEvent({ kind: 'perf', load_ms: -1, dcl_ms: 5 }).ok).toBe(false);
    expect(parseClientEvent({ kind: 'perf', load_ms: Number.NaN, dcl_ms: 5 }).ok).toBe(false);
    expect(parseClientEvent({ kind: 'perf', load_ms: 10, dcl_ms: 5, tier: 'ultra' }).ok).toBe(false);
    expect(parseClientEvent({ kind: 'event' }).ok).toBe(false);
    expect(parseClientEvent({ kind: 'event', name: 'bad name!' }).ok).toBe(false);
    expect(parseClientEvent('junk').ok).toBe(false);
    expect(parseClientEvent(null).ok).toBe(false);
  });
});

describe('createRateLimiter', () => {
  it('allows up to the limit, then blocks, then allows again after the window', () => {
    vi.useFakeTimers();
    const allow = createRateLimiter(2, 1000);
    expect(allow('1.2.3.4')).toBe(true);
    expect(allow('1.2.3.4')).toBe(true);
    expect(allow('1.2.3.4')).toBe(false);
    expect(allow('5.6.7.8')).toBe(true); // another key is unaffected
    vi.advanceTimersByTime(1001);
    expect(allow('1.2.3.4')).toBe(true);
    vi.useRealTimers();
  });
});

describe('createDbStats', () => {
  it('counts queries, errors and slow ones, and reports p50/p95', () => {
    const stats = createDbStats(() => ({ total: 3, idle: 2, waiting: 1 }));
    for (const ms of [10, 20, 30, 40, 50, 600]) stats.record(ms, true);
    stats.record(5, false);
    const s = stats.snapshot();
    expect(s.queries).toBe(7);
    expect(s.errors).toBe(1);
    expect(s.slow).toBe(1);
    expect(s.p50_ms).toBe(30);
    expect(s.p95_ms).toBe(600);
    expect(s.pool_total).toBe(3);
    expect(s.pool_idle).toBe(2);
    expect(s.pool_waiting).toBe(1);
  });
});

describe('request logging in the real app', () => {
  it('logs an /api request exactly once, with the route template', async () => {
    const { createApp } = await import('../src/app.js');
    const { createPgliteDb } = await import('../src/db.js');
    const { migrate } = await import('../src/migrations.js');
    const db = await createPgliteDb();
    await migrate(db);
    const lines = captureLogs();
    // wired like server.ts: the logger on the root app, the API under /api
    const root = new Hono();
    root.use('*', httpLogger);
    root.route('/api', createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: false }));
    expect((await root.request('/api/health')).status).toBe(200);
    const reqs = lines.filter((l) => l.event === 'http_request');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].route).toBe('/api/health');
    vi.restoreAllMocks();
    await db.close();
  });

  it('accepts cross-origin native client errors and telemetry events at /api/client-events', async () => {
    const { createApp } = await import('../src/app.js');
    const { createPgliteDb } = await import('../src/db.js');
    const { migrate } = await import('../src/migrations.js');
    const db = await createPgliteDb();
    await migrate(db);
    const lines = captureLogs();
    const root = new Hono();
    root.route(
      '/api',
      createApp(db, {
        googleClientIds: [],
        appleClientIds: [],
        allowedOrigins: ['https://localhost', 'capacitor://localhost'],
        devAuth: false,
      }),
    );

    const errRes = await root.request('/api/client-events', {
      method: 'POST',
      headers: { Origin: 'https://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'error',
        category: 'auth',
        message: 'Google Sign-In failed: [16] Account reauth failed.',
        source: 'accountPanel:native_google',
        platform: 'android',
        version: '1.0.0',
        build: 'abc123',
        meta: { method: 'native_google' },
      }),
    });
    expect(errRes.status).toBe(204);
    expect(errRes.headers.get('Access-Control-Allow-Origin')).toBe('https://localhost');

    const evRes = await root.request('/api/client-events', {
      method: 'POST',
      headers: { Origin: 'capacitor://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'event',
        name: 'app_boot',
        platform: 'ios',
        version: '1.0.0',
        meta: { tier: 'medium', touch: true },
      }),
    });
    expect(evRes.status).toBe(204);

    const errLine = lines.find((l) => l.event === 'client_error');
    expect(errLine).toMatchObject({
      severity: 'WARNING',
      category: 'auth',
      platform: 'android',
      version: '1.0.0',
      build: 'abc123',
      source: 'accountPanel:native_google',
      message: 'Google Sign-In failed: [16] Account reauth failed.',
      meta: { method: 'native_google' },
    });
    const evLine = lines.find((l) => l.event === 'client_event');
    expect(evLine).toMatchObject({
      severity: 'INFO',
      name: 'app_boot',
      platform: 'ios',
      version: '1.0.0',
      meta: { tier: 'medium', touch: true },
    });
    vi.restoreAllMocks();
    await db.close();
  });
});
