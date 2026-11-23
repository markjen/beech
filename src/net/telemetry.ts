// Reports unhandled client errors and one page-load timing sample to the
// server, so phones (where nobody watches the console) are visible in Cloud
// Logging. Best effort: if the beacon fails, nothing retries, and telemetry
// never breaks the app.
//
// Privacy: no user ids, no full URLs — only the pathname and the error
// message. The server endpoint (/api/client-events) validates, caps and
// rate-limits what it accepts; see server/src/observability.ts.

export interface ClientErrorEvent {
  kind: 'error';
  message: string;
  source?: string;
  path?: string;
}

export interface ClientPerfEvent {
  kind: 'perf';
  load_ms: number;
  dcl_ms: number;
}

const MAX_ERRORS_PER_LOAD = 10;
let errorsSent = 0;
let started = false;

/** Build the error payload. Pure: testable in node. */
export function errorEvent(message: string, source: string | undefined, path: string): ClientErrorEvent {
  const e: ClientErrorEvent = { kind: 'error', message: message.slice(0, 500) || 'unknown error', path: path.slice(0, 200) };
  if (source) e.source = source.slice(0, 200);
  return e;
}

/** Build the perf payload from a navigation timing entry. Pure: testable in node. */
export function perfEvent(nav: { loadEventEnd: number; domContentLoadedEventEnd: number } | null): ClientPerfEvent | null {
  if (!nav) return null;
  const load_ms = Math.round(nav.loadEventEnd);
  const dcl_ms = Math.round(nav.domContentLoadedEventEnd);
  if (!Number.isFinite(load_ms) || !Number.isFinite(dcl_ms) || load_ms < 0 || dcl_ms < 0) return null;
  return { kind: 'perf', load_ms, dcl_ms };
}

export function sendClientEvent(event: ClientErrorEvent | ClientPerfEvent): void {
  try {
    const body = JSON.stringify(event);
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      navigator.sendBeacon('/api/client-events', new Blob([body], { type: 'application/json' }));
    } else if (typeof fetch !== 'undefined') {
      void fetch('/api/client-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* telemetry must never break the app */
  }
}

/** Hook window error/rejection handlers and the one load-timing sample. Safe to call twice. */
export function initTelemetry(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const report = (message: string, source?: string) => {
    if (errorsSent >= MAX_ERRORS_PER_LOAD) return;
    errorsSent++;
    sendClientEvent(errorEvent(message, source, window.location.pathname));
  };
  window.addEventListener('error', (e) =>
    report(e.message || 'unknown error', e.filename ? `${e.filename}:${e.lineno ?? 0}` : undefined),
  );
  window.addEventListener('unhandledrejection', (e) =>
    report(e.reason instanceof Error ? e.reason.message : String(e.reason)),
  );
  window.addEventListener('load', () => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const perf = perfEvent(nav ?? null);
    if (perf) sendClientEvent(perf);
  });
}
