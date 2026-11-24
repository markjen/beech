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

export type ClientPlatform = 'web' | 'android' | 'ios';
export type ClientMeta = Record<string, string | number | boolean>;

export type ClientEvent =
  | {
      kind: 'error';
      message: string;
      category?: string;
      source?: string;
      stack?: string;
      path?: string;
      platform?: ClientPlatform;
      version?: string;
      build?: string;
      meta?: ClientMeta;
    }
  | {
      kind: 'perf';
      load_ms: number;
      dcl_ms: number;
      platform?: ClientPlatform;
      version?: string;
      build?: string;
      tier?: 'low' | 'medium' | 'high';
      bench_ms?: number;
    }
  | {
      kind: 'event';
      name: string;
      platform?: ClientPlatform;
      version?: string;
      build?: string;
      meta?: ClientMeta;
    };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampStr = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;

const TAG_RE = /^[a-z0-9_.-]+$/i;
const META_KEY_RE = /^[a-z0-9_]+$/i;
const PLATFORMS = new Set<ClientPlatform>(['web', 'android', 'ios']);
const TIERS = new Set<'low' | 'medium' | 'high'>(['low', 'medium', 'high']);

function parsePlatform(v: unknown): ClientPlatform | undefined {
  return typeof v === 'string' && PLATFORMS.has(v as ClientPlatform) ? (v as ClientPlatform) : undefined;
}

function parseMeta(v: unknown): { ok: true; meta?: ClientMeta } | { ok: false; reason: string } {
  if (v === undefined) return { ok: true };
  if (!isRecord(v)) return { ok: false, reason: 'meta must be an object' };
  const entries = Object.entries(v);
  if (entries.length > 8) return { ok: false, reason: 'meta may have at most 8 keys' };
  const out: ClientMeta = {};
  for (const [k, raw] of entries) {
    if (!k || k.length > 32 || !META_KEY_RE.test(k)) return { ok: false, reason: 'invalid meta key' };
    if (typeof raw === 'string') out[k] = raw.slice(0, 120);
    else if (typeof raw === 'number' && Number.isFinite(raw)) out[k] = raw;
    else if (typeof raw === 'boolean') out[k] = raw;
    else if (raw !== undefined && raw !== null) return { ok: false, reason: 'meta values must be string, number or boolean' };
  }
  return { ok: true, meta: Object.keys(out).length ? out : undefined };
}

/**
 * Validate an untrusted client-event body. Returns ok: false when the event
 * isn't one we accept — wrong shape, oversized fields, impossible timings.
 * The endpoint only ever writes a log line, never the database.
 */
export function parseClientEvent(body: unknown): { ok: true; event: ClientEvent } | { ok: false; reason: string } {
  if (!isRecord(body)) return { ok: false, reason: 'event must be an object' };
  const platform = parsePlatform(body.platform);
  if (body.platform !== undefined && !platform) return { ok: false, reason: 'invalid platform' };
  const version = clampStr(body.version, 32);
  const build = clampStr(body.build, 64);
  const ctx = { ...(platform ? { platform } : {}), ...(version ? { version } : {}), ...(build ? { build } : {}) };

  if (body.kind === 'error') {
    const message = clampStr(body.message, 500);
    if (!message) return { ok: false, reason: 'error needs a message' };
    const category = clampStr(body.category, 40);
    if (category !== undefined && !TAG_RE.test(category)) return { ok: false, reason: 'invalid category' };
    const source = clampStr(body.source, 200);
    const stack = clampStr(body.stack, 1000);
    const path = clampStr(body.path, 200);
    if (path !== undefined && !path.startsWith('/')) return { ok: false, reason: 'path must start with /' };
    const m = parseMeta(body.meta);
    if (!m.ok) return m;
    return {
      ok: true,
      event: {
        kind: 'error',
        message,
        ...(category ? { category } : {}),
        ...(source ? { source } : {}),
        ...(stack ? { stack } : {}),
        ...(path ? { path } : {}),
        ...ctx,
        ...(m.meta ? { meta: m.meta } : {}),
      },
    };
  }
  if (body.kind === 'perf') {
    const load_ms = body.load_ms;
    const dcl_ms = body.dcl_ms;
    if (!isFiniteNumber(load_ms) || !isFiniteNumber(dcl_ms) || load_ms < 0 || dcl_ms < 0 || load_ms > 3600000 || dcl_ms > 3600000) {
      return { ok: false, reason: 'perf needs load_ms and dcl_ms in milliseconds' };
    }
    const tier = typeof body.tier === 'string' && TIERS.has(body.tier as 'low' | 'medium' | 'high') ? (body.tier as 'low' | 'medium' | 'high') : undefined;
    if (body.tier !== undefined && !tier) return { ok: false, reason: 'invalid tier' };
    let bench_ms: number | undefined;
    if (body.bench_ms !== undefined) {
      if (!isFiniteNumber(body.bench_ms) || body.bench_ms < 0 || body.bench_ms > 60000) return { ok: false, reason: 'invalid bench_ms' };
      bench_ms = Math.round(body.bench_ms * 10) / 10;
    }
    return {
      ok: true,
      event: {
        kind: 'perf',
        load_ms: Math.round(load_ms),
        dcl_ms: Math.round(dcl_ms),
        ...ctx,
        ...(tier ? { tier } : {}),
        ...(bench_ms !== undefined ? { bench_ms } : {}),
      },
    };
  }
  if (body.kind === 'event') {
    const name = clampStr(body.name, 60);
    if (!name || !TAG_RE.test(name)) return { ok: false, reason: 'event needs a valid name' };
    const m = parseMeta(body.meta);
    if (!m.ok) return m;
    return {
      ok: true,
      event: {
        kind: 'event',
        name,
        ...ctx,
        ...(m.meta ? { meta: m.meta } : {}),
      },
    };
  }
  return { ok: false, reason: 'kind must be error, perf or event' };
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
