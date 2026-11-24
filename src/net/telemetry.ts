import { Capacitor } from '@capacitor/core';

import { version as APP_VERSION } from '../../package.json';
import { APP_BUILD } from '../platform/version';

// Reports client errors (both unhandled and caught failures like sign-in,
// purchases, sync, worker or WebGL crashes), page-load timing, and lightweight
// diagnostic telemetry to /api/client-events so phones (where nobody watches
// the console) are visible in Cloud Logging.
//
// Best effort: if a report fails, nothing retries, and telemetry never breaks
// the app. Respects VITE_API_URL so native Android/iOS shells (running under
// https://localhost or capacitor://localhost) post to the production API.
//
// Privacy: no user ids, no emails, no tokens, no query strings — only the
// pathname, platform/version/build, sanitized error message/stack, and flat
// low-cardinality metadata. The server validates, caps and rate-limits
// everything; see server/src/observability.ts.

export type ClientPlatform = 'web' | 'android' | 'ios';
export type ClientMeta = Record<string, string | number | boolean>;

export interface ClientContext {
  platform?: ClientPlatform;
  version?: string;
  build?: string;
}

export interface ClientErrorEvent extends ClientContext {
  kind: 'error';
  message: string;
  category?: string;
  source?: string;
  stack?: string;
  path?: string;
  meta?: ClientMeta;
}

export interface ClientPerfEvent extends ClientContext {
  kind: 'perf';
  load_ms: number;
  dcl_ms: number;
  tier?: 'low' | 'medium' | 'high';
  bench_ms?: number;
}

export interface ClientTelemetryEvent extends ClientContext {
  kind: 'event';
  name: string;
  meta?: ClientMeta;
}

export type ClientEvent = ClientErrorEvent | ClientPerfEvent | ClientTelemetryEvent;

const MAX_ERRORS_PER_LOAD = 20;
const MAX_EVENTS_PER_LOAD = 40;
const DEDUPE_MS = 10_000;

const env = import.meta.env;
const DEFAULT_API = String(env.VITE_API_URL ?? '').replace(/\/+$/, '');

let started = false;
let apiBase = DEFAULT_API;
let errorsSent = 0;
let eventsSent = 0;
const recentErrors = new Map<string, number>();

/** Endpoint URL for client events: relative on same-origin web, absolute in native shells. */
export function clientEventsUrl(base = apiBase): string {
  const clean = base.replace(/\/+$/, '');
  return clean ? `${clean}/api/client-events` : '/api/client-events';
}

/** Detect platform + app version + build id. Safe in Node and browser. */
export function clientContext(): ClientContext {
  let platform: ClientPlatform = 'web';
  try {
    const p = Capacitor.getPlatform();
    if (p === 'android' || p === 'ios') platform = p;
  } catch {
    /* non-Capacitor test environment */
  }
  return {
    platform,
    version: String(APP_VERSION || '').slice(0, 32) || undefined,
    build: APP_BUILD ? APP_BUILD.slice(0, 64) : undefined,
  };
}

/** Strip query strings and hashes from URLs in stack traces so share codes never leak. */
export function sanitizeStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const cleaned = stack.replace(/(https?:\/\/[^\s)?:]+)\?[^\s):]*/gi, '$1').replace(/#[^\s):]*/g, '').trim();
  return cleaned ? cleaned.slice(0, 1000) : undefined;
}

/** Keep only valid flat metadata values (at most 8 keys). */
export function sanitizeMeta(meta: Record<string, unknown> | undefined): ClientMeta | undefined {
  if (!meta) return undefined;
  const out: ClientMeta = {};
  let count = 0;
  for (const [k, v] of Object.entries(meta)) {
    if (count >= 8) break;
    if (!/^[a-z0-9_]{1,32}$/i.test(k)) continue;
    if (typeof v === 'string') {
      out[k] = v.slice(0, 120);
      count++;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v;
      count++;
    } else if (typeof v === 'boolean') {
      out[k] = v;
      count++;
    }
  }
  return count > 0 ? out : undefined;
}

/** Build an error payload. Pure: testable in node. */
export function errorEvent(
  message: string,
  source: string | undefined,
  path: string,
  extra?: { category?: string; stack?: string; meta?: Record<string, unknown>; context?: ClientContext },
): ClientErrorEvent {
  const safePath = path && path.startsWith('/') ? path.slice(0, 200) : '/';
  const e: ClientErrorEvent = {
    kind: 'error',
    message: message.slice(0, 500) || 'unknown error',
    path: safePath,
    ...(extra?.context ?? {}),
  };
  if (extra?.category && /^[a-z0-9_.-]{1,40}$/i.test(extra.category)) e.category = extra.category;
  if (source) e.source = source.slice(0, 200);
  const stack = sanitizeStack(extra?.stack);
  if (stack) e.stack = stack;
  const meta = sanitizeMeta(extra?.meta);
  if (meta) e.meta = meta;
  return e;
}

/** Build a perf payload from a navigation timing entry. Pure: testable in node. */
export function perfEvent(
  nav: { loadEventEnd: number; domContentLoadedEventEnd: number } | null,
  extra?: { tier?: 'low' | 'medium' | 'high'; bench_ms?: number; context?: ClientContext },
): ClientPerfEvent | null {
  if (!nav) return null;
  const load_ms = Math.round(nav.loadEventEnd);
  const dcl_ms = Math.round(nav.domContentLoadedEventEnd);
  if (!Number.isFinite(load_ms) || !Number.isFinite(dcl_ms) || load_ms < 0 || dcl_ms < 0) return null;
  const e: ClientPerfEvent = { kind: 'perf', load_ms, dcl_ms, ...(extra?.context ?? {}) };
  if (extra?.tier) e.tier = extra.tier;
  if (typeof extra?.bench_ms === 'number' && Number.isFinite(extra.bench_ms) && extra.bench_ms >= 0) {
    e.bench_ms = Math.round(extra.bench_ms * 10) / 10;
  }
  return e;
}

/** Build a general telemetry event payload. Pure: testable in node. */
export function telemetryEvent(
  name: string,
  meta?: Record<string, unknown>,
  context?: ClientContext,
): ClientTelemetryEvent | null {
  if (!name || !/^[a-z0-9_.-]{1,60}$/i.test(name)) return null;
  const m = sanitizeMeta(meta);
  return { kind: 'event', name, ...(context ?? {}), ...(m ? { meta: m } : {}) };
}

export function sendClientEvent(event: ClientEvent, base = apiBase): void {
  try {
    const url = clientEventsUrl(base);
    const body = JSON.stringify(event);
    // Use fetch(..., { keepalive: true }) everywhere: unlike navigator.sendBeacon
    // with application/json, fetch without credentials: 'include' passes CORS
    // cleanly from Capacitor native WebViews (https://localhost, capacitor://localhost).
    if (typeof fetch !== 'undefined') {
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    } else if (!base && typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    }
  } catch {
    /* telemetry must never break the app */
  }
}

/**
 * Report a caught/handled error (sign-in, shop, sync, worker, WebGL, boot).
 * No-op in sandbox builds or tests where `initTelemetry()` was not called.
 */
export function reportError(
  category: string,
  err: unknown,
  opts?: { source?: string; meta?: Record<string, unknown> },
): void {
  if (!started) return;
  const obj = typeof err === 'object' && err !== null ? (err as { message?: unknown; stack?: unknown; code?: unknown }) : null;
  const message =
    err instanceof Error
      ? err.message || err.name
      : typeof obj?.message === 'string' && obj.message
        ? obj.message
        : String(err ?? 'unknown error');
  const stack = err instanceof Error ? err.stack : typeof obj?.stack === 'string' ? obj.stack : undefined;
  const code = typeof obj?.code === 'string' || typeof obj?.code === 'number' ? obj.code : undefined;
  const meta = code !== undefined && opts?.meta?.code === undefined ? { ...(opts?.meta ?? {}), code } : opts?.meta;
  const key = `${category}|${opts?.source ?? ''}|${message.slice(0, 120)}`;
  const now = Date.now();
  const prev = recentErrors.get(key);
  if (prev !== undefined && now - prev < DEDUPE_MS) return;
  if (errorsSent >= MAX_ERRORS_PER_LOAD) return;
  recentErrors.set(key, now);
  if (recentErrors.size > 50) recentErrors.clear();
  errorsSent++;
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  sendClientEvent(
    errorEvent(message, opts?.source, path, {
      category,
      stack,
      meta,
      context: clientContext(),
    }),
  );
}

/**
 * Report a lightweight diagnostic telemetry event (e.g. app_boot, auth_success,
 * purchase_success, res_drop). No-op unless `initTelemetry()` was called.
 */
export function reportEvent(name: string, meta?: Record<string, unknown>): void {
  if (!started) return;
  if (eventsSent >= MAX_EVENTS_PER_LOAD) return;
  const ev = telemetryEvent(name, meta, clientContext());
  if (!ev) return;
  eventsSent++;
  sendClientEvent(ev);
}

/** Hook window error/rejection handlers and the one load-timing sample. Safe to call twice. */
export function initTelemetry(base = DEFAULT_API): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  apiBase = base;
  window.addEventListener('error', (e) => {
    const src = e.filename ? `${e.filename.split('?')[0]}:${e.lineno ?? 0}` : undefined;
    reportError('unhandled', e.error instanceof Error ? e.error : e.message || 'unknown error', { source: src });
  });
  window.addEventListener('unhandledrejection', (e) => {
    reportError('rejection', e.reason);
  });
  window.addEventListener('load', () => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const perf = perfEvent(nav ?? null, { context: clientContext() });
    if (perf) sendClientEvent(perf);
  });
}

/** Reset internal state (for unit tests). */
export function _resetTelemetryForTests(): void {
  started = false;
  apiBase = DEFAULT_API;
  errorsSent = 0;
  eventsSent = 0;
  recentErrors.clear();
}
