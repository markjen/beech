import { Capacitor } from '@capacitor/core';

import { clientContext, reportEvent } from './telemetry';
import type { NativeProvider } from './nativeAuth';

// Sign-in diagnostics: what a failed native sign-in can tell us without
// logcat (store apps cannot read logcat, and there is no adb access to the
// user's phone). Two places show the same record:
//   - telemetry: an `auth_attempt` event per attempt (started, then one of
//     success / cancelled / failed) via the existing /api/client-events
//     endpoint — see reportSignInAttempt.
//   - on screen: the account panel shows the record after a failed native
//     sign-in, with a copy button — see formatSignInDiagnostics.
//
// Privacy: no user ids, no emails, no tokens, no account names. The web
// OAuth client id is public (repo docs say so); the signing fingerprints
// identify the installed APK, not the person.

export interface SigningFingerprints {
  /** SHA-1 fingerprints of the certificates that signed the installed APK. */
  sha1: string[];
  /** SHA-256 fingerprints of the same certificates. */
  sha256: string[];
}

export type SignInOutcome = 'started' | 'success' | 'cancelled' | 'failed';

export interface SignInDiagnostics {
  provider: NativeProvider;
  outcome: SignInOutcome;
  platform: string;
  version: string;
  build: string;
  /** native app id, e.g. app.beech.beach (native shells only) */
  appId?: string;
  /** OAuth web client id the token is requested for (google only, public) */
  clientId?: string;
  /** short code pulled out of the failure message, e.g. '16', '28444' */
  errorCode?: string;
  /** raw failure message, truncated — no PII by construction (see above) */
  error?: string;
  /** signing-cert SHA-1 fingerprints (android only) */
  sha1?: string[];
  /** signing-cert SHA-256 fingerprints (android only) */
  sha256?: string[];
}

/**
 * Pull a short error code out of a sign-in failure message. The plugin
 * surfaces failures like "[16] Account reauth failed" or "[28444]
 * Developer console is not set up correctly"; other failures name the
 * exception (NoCredentialException) or the OAuth error (access_denied).
 * Unknown messages return undefined — the raw message still travels in
 * the diagnostics record.
 */
export function signinErrorCode(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const bracketed = /\[(\d+)\]/.exec(message);
  if (bracketed) return bracketed[1];
  if (/\bNoCredentialException\b/.test(message)) return 'no_credential';
  if (/\baccess_denied\b/.test(message)) return 'access_denied';
  if (/Developer console is not set up correctly/.test(message)) return 'developer_error';
  if (/^\s*10:/.test(message)) return '10';
  return undefined;
}

/** One `key: value` line per known field, in diagnosis order. Pure. */
export function formatSignInDiagnostics(d: SignInDiagnostics): string {
  const lines: [string, string | undefined][] = [
    ['sign-in', d.provider],
    ['outcome', d.outcome],
    ['error code', d.errorCode],
    ['error', d.error],
    ['platform', d.platform],
    ['app', `${d.version} (build ${d.build})`],
    ['app id', d.appId],
    ['client id', d.clientId],
    ['sha-1', d.sha1?.length ? d.sha1.join(', ') : undefined],
    ['sha-256', d.sha256?.length ? d.sha256.join(', ') : undefined],
  ];
  return lines
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

/**
 * The reportEvent meta for one attempt. At most 7 keys (the endpoint caps
 * at 8); fingerprints are comma-joined because meta values must be flat
 * strings. reportEvent/telemetryEvent still sanitize and cap the values.
 */
export function authAttemptMeta(d: SignInDiagnostics): Record<string, unknown> {
  const meta: Record<string, unknown> = { provider: d.provider, outcome: d.outcome };
  if (d.errorCode) meta.error_code = d.errorCode;
  if (d.clientId) meta.client_id = d.clientId;
  if (d.appId) meta.app_id = d.appId;
  if (d.sha1?.length) meta.sha1 = d.sha1.join(',');
  if (d.sha256?.length) meta.sha256 = d.sha256.join(',');
  return meta;
}

/** Upload one `auth_attempt` event. Never throws. */
export function reportSignInAttempt(d: SignInDiagnostics): void {
  try {
    reportEvent('auth_attempt', authAttemptMeta(d));
  } catch {
    /* telemetry must never break sign-in */
  }
}

function raceTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([p.catch(() => fallback), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function fingerprintList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const fp = item.trim().toUpperCase();
    // colon-separated hex, SHA-1 (59 chars) or SHA-256 (95 chars)
    if (/^[0-9A-F:]{40,96}$/.test(fp) && fp.includes(':')) out.push(fp);
  }
  return out;
}

interface SigningInfoPlugin {
  getSigningInfo(): Promise<{ sha1?: unknown; sha256?: unknown }>;
}

let fingerprintsPromise: Promise<SigningFingerprints | null> | null = null;

/**
 * The installed APK's signing fingerprints, from the small read-only
 * SigningInfo plugin in android/ (PackageManager, no permissions). Null
 * on web/iOS, or when the plugin is absent or does not answer in time.
 * Cached: the fingerprints cannot change while the app runs.
 */
export function getSigningFingerprints(): Promise<SigningFingerprints | null> {
  if (!fingerprintsPromise) fingerprintsPromise = fetchSigningFingerprints();
  return fingerprintsPromise;
}

async function fetchSigningFingerprints(): Promise<SigningFingerprints | null> {
  try {
    if (Capacitor.getPlatform() !== 'android') return null;
    if (!Capacitor.isPluginAvailable('SigningInfo')) return null;
    const plugin = Capacitor.registerPlugin<SigningInfoPlugin>('SigningInfo');
    const res = await raceTimeout(plugin.getSigningInfo(), 1000, null);
    if (!res) return null;
    const sha1 = fingerprintList(res.sha1);
    const sha256 = fingerprintList(res.sha256);
    if (!sha1.length && !sha256.length) return null;
    return { sha1, sha256 };
  } catch {
    return null;
  }
}

let appIdPromise: Promise<string | undefined> | null = null;

/** The native app id (package/bundle id), via @capacitor/app. Undefined off native. */
export function getSignInAppId(): Promise<string | undefined> {
  if (!appIdPromise) appIdPromise = fetchSignInAppId();
  return appIdPromise;
}

async function fetchSignInAppId(): Promise<string | undefined> {
  try {
    const platform = Capacitor.getPlatform();
    if (platform !== 'android' && platform !== 'ios') return undefined;
    const { App } = await import('@capacitor/app');
    const info = await raceTimeout(App.getInfo(), 1000, null);
    return typeof info?.id === 'string' && info.id ? info.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Start an attempt record and upload the `started` event. The static
 * fields (provider, client id, platform/version/build) are known
 * synchronously; the app id and fingerprints resolve in the background
 * and land on the outcome event instead of delaying the sign-in sheet.
 */
export function startSignInAttempt(provider: NativeProvider, clientId?: string): SignInDiagnostics {
  const ctx = clientContext();
  const attempt: SignInDiagnostics = {
    provider,
    outcome: 'started',
    platform: ctx.platform ?? 'web',
    version: ctx.version ?? '',
    build: ctx.build ?? '',
    ...(clientId ? { clientId } : {}),
  };
  // Warm the caches so the outcome event has the values ready.
  void getSignInAppId();
  void getSigningFingerprints();
  reportSignInAttempt(attempt);
  return attempt;
}

/**
 * Complete an attempt record: fill in the app id and fingerprints, upload
 * the outcome event, and return the record for on-screen display. Never
 * throws; a diagnostics failure must not mask the sign-in result.
 */
export async function finishSignInAttempt(
  attempt: SignInDiagnostics,
  outcome: Exclude<SignInOutcome, 'started'>,
  error?: unknown,
): Promise<SignInDiagnostics> {
  const done: SignInDiagnostics = { ...attempt, outcome };
  try {
    const message = error instanceof Error ? error.message || error.name : typeof error === 'string' ? error : undefined;
    if (outcome === 'failed' && message) {
      done.errorCode = signinErrorCode(message);
      done.error = message.slice(0, 200);
    }
    const [appId, fp] = await Promise.all([getSignInAppId(), getSigningFingerprints()]);
    if (appId) done.appId = appId;
    if (fp?.sha1.length) done.sha1 = fp.sha1;
    if (fp?.sha256.length) done.sha256 = fp.sha256;
  } catch {
    /* keep whatever the record already has */
  }
  reportSignInAttempt(done);
  return done;
}

/** Attach a diagnostics record to a thrown sign-in error for the UI to read. */
export function attachSignInDiagnostics(error: unknown, d: SignInDiagnostics): void {
  if (typeof error === 'object' && error !== null) {
    (error as Record<string, unknown>).signInDiagnostics = d;
  }
}

/** Read a diagnostics record off a thrown sign-in error, if it has one. */
export function signInDiagnosticsOf(error: unknown): SignInDiagnostics | null {
  const d = (error as { signInDiagnostics?: unknown } | null)?.signInDiagnostics;
  return d !== null && typeof d === 'object' && typeof (d as SignInDiagnostics).provider === 'string'
    ? (d as SignInDiagnostics)
    : null;
}

/** Reset cached native lookups (for unit tests). */
export function _resetSignInDiagnosticsForTests(): void {
  fingerprintsPromise = null;
  appIdPromise = null;
}
