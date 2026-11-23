// Observability for the beech server: structured JSON logs that Cloud Run
// ships to Cloud Logging, plus the small pieces that turn those logs into
// metrics (see infra/monitoring.tf for the log-based metrics, dashboard
// and alerts built on top of them).
//
// Why logs, not OpenTelemetry: Cloud Run already sends stdout to Cloud
// Logging, so one JSON line per request costs no new dependency, no
// exporter and no extra service to operate. The volume is tiny at this
// scale (50 GiB/month of log ingestion is free) and the log-based metrics
// built on top are effectively free. If distributed tracing is ever
// needed, that is the moment to add OTel.
//
// Privacy: metric labels are route templates only — never user ids, beach
// ids, neighbor codes, IPs or raw paths. httpLogger's routeLabel() buckets
// anything that isn't a matched route template as "static", "spa" or
// "unmatched", so a code in the URL can never become a label.

import type { Context, MiddlewareHandler } from 'hono';

export const SLOW_QUERY_MS = 500;

/** One JSON log line. Cloud Logging parses the JSON; `severity` drives the log level. */
export function logEvent(
  event: string,
  fields: Record<string, unknown> = {},
  severity: 'INFO' | 'WARNING' | 'ERROR' = 'INFO',
): void {
  const line = JSON.stringify({
    severity,
    time: new Date().toISOString(),
    service: 'beech',
    revision: process.env.K_REVISION ?? 'local',
    event,
    ...fields,
  });
  if (severity === 'ERROR') console.error(line);
  else console.log(line);
}

/**
 * The route label for a request: the matched route's template ("/beaches/:code"),
 * or "static" (a file from dist), "spa" (the single-page fallback, which
 * serves any unmatched GET outside /api) or "unmatched" (no route at all).
 * Raw paths — which can hold a neighbor code — are never used as labels.
 * (Middleware patterns like "*" and "/*" don't count as handlers; the
 * logger's own pattern is one of them, so it is skipped here.)
 */
export function routeLabel(c: Context): string {
  const routes = (c.req as unknown as { matchedRoutes?: { path: string }[] }).matchedRoutes ?? [];
  const handler = [...routes].reverse().find((r) => r.path !== '*' && r.path !== '/*');
  if (handler) {
    const p = handler.path;
    return p.length > 100 ? p.slice(0, 100) : p;
  }
  const path = c.req.path;
  if (path.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(path)) return 'static';
  if (c.req.method === 'GET' && !path.startsWith('/api/')) return 'spa';
  return 'unmatched';
}

/**
 * One JSON line per request: method, route template, status and latency.
 * 5xx lines are severity ERROR, 4xx WARNING, so they are easy to find in
 * Logs Explorer and so the log-based metrics can count them.
 */
export const httpLogger: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  try {
    await next();
  } finally {
    const status = c.res?.status ?? 500;
    logEvent(
      'http_request',
      {
        method: c.req.method,
        route: routeLabel(c),
        status,
        duration_ms: Math.round((performance.now() - start) * 10) / 10,
      },
      status >= 500 ? 'ERROR' : status >= 400 ? 'WARNING' : 'INFO',
    );
  }
};

// ------------------------------------------------------------------ DB stats

export interface DbStatsSnapshot {
  queries: number;
  errors: number;
  slow: number; // queries over SLOW_QUERY_MS
  p50_ms: number | null;
  p95_ms: number | null;
  pool_total: number | null;
  pool_idle: number | null;
  pool_waiting: number | null;
}

export interface DbStats {
  record(durationMs: number, ok: boolean): void;
  snapshot(): DbStatsSnapshot;
}

/** Rolling query counters + latency percentiles, summarised every minute by server.ts. */
export function createDbStats(
  getPool?: () => { total: number; idle: number; waiting: number } | null,
): DbStats {
  let queries = 0;
  let errors = 0;
  let slow = 0;
  const durations: number[] = []; // last 1000, for p50/p95
  return {
    record(durationMs, ok) {
      queries++;
      if (!ok) errors++;
      if (durationMs > SLOW_QUERY_MS) {
        slow++;
        logEvent('db_slow_query', { duration_ms: Math.round(durationMs) }, 'WARNING');
      }
      durations.push(durationMs);
      if (durations.length > 1000) durations.shift();
    },
    snapshot() {
      const sorted = [...durations].sort((a, b) => a - b);
      const pct = (p: number): number | null =>
        sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] * 10) / 10 : null;
      const pool = getPool?.() ?? null;
      return {
        queries,
        errors,
        slow,
        p50_ms: pct(50),
        p95_ms: pct(95),
        pool_total: pool?.total ?? null,
        pool_idle: pool?.idle ?? null,
        pool_waiting: pool?.waiting ?? null,
      };
    },
  };
}

// ------------------------------------------------------------- client events

export type ClientEvent =
  | { kind: 'error'; message: string; source?: string; path?: string }
  | { kind: 'perf'; load_ms: number; dcl_ms: number };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampStr = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;

/**
 * Validate an untrusted client-event body. Returns null when the event
 * isn't one we accept — wrong shape, oversized strings, impossible timings.
 * The endpoint only ever writes a log line, never the database.
 */
export function parseClientEvent(body: unknown): { ok: true; event: ClientEvent } | { ok: false; reason: string } {
  if (!isRecord(body)) return { ok: false, reason: 'event must be an object' };
  if (body.kind === 'error') {
    const message = clampStr(body.message, 500);
    if (!message) return { ok: false, reason: 'error needs a message' };
    const source = clampStr(body.source, 200);
    const path = clampStr(body.path, 200);
    if (path !== undefined && !path.startsWith('/')) return { ok: false, reason: 'path must start with /' };
    return { ok: true, event: { kind: 'error', message, source, path } };
  }
  if (body.kind === 'perf') {
    const load_ms = body.load_ms;
    const dcl_ms = body.dcl_ms;
    if (!isFiniteNumber(load_ms) || !isFiniteNumber(dcl_ms) || load_ms < 0 || dcl_ms < 0 || load_ms > 3600000 || dcl_ms > 3600000) {
      return { ok: false, reason: 'perf needs load_ms and dcl_ms in milliseconds' };
    }
    return { ok: true, event: { kind: 'perf', load_ms: Math.round(load_ms), dcl_ms: Math.round(dcl_ms) } };
  }
  return { ok: false, reason: 'kind must be error or perf' };
}

/** In-memory per-key token bucket (best effort, per process). */
export function createRateLimiter(maxPerMinute: number, windowMs = 60000): (key: string) => boolean {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key) => {
    if (hits.size > 10000) hits.clear();
    const now = Date.now();
    const e = hits.get(key);
    if (!e || now >= e.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (e.count >= maxPerMinute) return false;
    e.count++;
    return true;
  };
}
