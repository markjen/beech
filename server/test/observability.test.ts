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
  it('accepts a client error and a perf sample', () => {
    expect(parseClientEvent({ kind: 'error', message: 'kaboom', source: 'main.ts:12:3', path: '/' }).ok).toBe(true);
    expect(parseClientEvent({ kind: 'perf', load_ms: 1234, dcl_ms: 800 }).ok).toBe(true);
  });

  it('rejects bad kinds, missing fields, oversized strings and impossible timings', () => {
    expect(parseClientEvent({ kind: 'nope' }).ok).toBe(false);
    expect(parseClientEvent({ kind: 'error' }).ok).toBe(false);
    expect(parseClientEvent({ kind: 'error', message: '' }).ok).toBe(false);
    // an over-long message is accepted but cut to 500 chars, not dropped
    const long = parseClientEvent({ kind: 'error', message: 'x'.repeat(501) });
    expect(long.ok).toBe(true);
    if (long.ok && long.event.kind === 'error') expect(long.event.message).toHaveLength(500);
    expect(parseClientEvent({ kind: 'error', message: 'x', path: 'no-slash' }).ok).toBe(false);
    expect(parseClientEvent({ kind: 'perf', load_ms: -1, dcl_ms: 5 }).ok).toBe(false);
    expect(parseClientEvent({ kind: 'perf', load_ms: Number.NaN, dcl_ms: 5 }).ok).toBe(false);
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
