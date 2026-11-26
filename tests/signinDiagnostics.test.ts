import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetSignInDiagnosticsForTests,
  attachSignInDiagnostics,
  authAttemptMeta,
  finishSignInAttempt,
  formatSignInDiagnostics,
  getSignInAppId,
  getSigningFingerprints,
  reportSignInAttempt,
  signinErrorCode,
  signInDiagnosticsOf,
  startSignInAttempt,
  type SignInDiagnostics,
} from '../src/net/signinDiagnostics';
import { _resetTelemetryForTests as resetTelemetry, initTelemetry, telemetryEvent } from '../src/net/telemetry';

afterEach(() => {
  resetTelemetry();
  _resetSignInDiagnosticsForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const SHA1 = '0D:DA:E6:DC:0E:53:55:0B:DC:1B:65:8E:56:F2:85:28:8B:A9:AC:A4';
const SHA256 = '91:53:C7:9D:B3:B5:83:26:48:74:AC:D4:C8:8A:E4:50:4A:FE:21:4E:39:70:2D:8C:90:3C:6D:52:AF:0F:60:87';
const SHA1_B = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD';

function failed(): SignInDiagnostics {
  return {
    provider: 'google',
    outcome: 'failed',
    platform: 'android',
    version: '1.0.0',
    build: '4',
    appId: 'app.beech.beach',
    clientId: '650382817342-69g4u7agreiik2l1fqpvdqlkibsv3es4.apps.googleusercontent.com',
    errorCode: '16',
    error: 'Google Sign-In failed: [16] Account reauth failed.',
    sha1: [SHA1],
    sha256: [SHA256],
  };
}

describe('signinErrorCode', () => {
  it('pulls the bracketed code out of plugin failures', () => {
    expect(signinErrorCode('Google Sign-In failed: [16] Account reauth failed.')).toBe('16');
    expect(signinErrorCode('[28444] Developer console is not set up correctly')).toBe('28444');
    expect(signinErrorCode('[10] Developer error')).toBe('10');
  });

  it('names known exceptions and OAuth errors', () => {
    expect(signinErrorCode('NoCredentialException: No credentials available')).toBe('no_credential');
    expect(signinErrorCode('403 access_denied')).toBe('access_denied');
    expect(signinErrorCode('Developer console is not set up correctly')).toBe('developer_error');
    expect(signinErrorCode('10: something broke')).toBe('10');
  });

  it('returns undefined for unknown messages', () => {
    expect(signinErrorCode(undefined)).toBeUndefined();
    expect(signinErrorCode('')).toBeUndefined();
    expect(signinErrorCode('Google did not return an ID token')).toBeUndefined();
  });
});

describe('formatSignInDiagnostics', () => {
  it('renders the full record as copyable key: value lines', () => {
    expect(formatSignInDiagnostics(failed())).toBe(
      [
        'sign-in: google',
        'outcome: failed',
        'error code: 16',
        'error: Google Sign-In failed: [16] Account reauth failed.',
        'platform: android',
        'app: 1.0.0 (build 4)',
        'app id: app.beech.beach',
        'client id: 650382817342-69g4u7agreiik2l1fqpvdqlkibsv3es4.apps.googleusercontent.com',
        `sha-1: ${SHA1}`,
        `sha-256: ${SHA256}`,
      ].join('\n'),
    );
  });

  it('skips missing fields and never prints undefined', () => {
    const minimal: SignInDiagnostics = { provider: 'apple', outcome: 'cancelled', platform: 'ios', version: '1.0.0', build: '4' };
    const text = formatSignInDiagnostics(minimal);
    expect(text).toBe(['sign-in: apple', 'outcome: cancelled', 'platform: ios', 'app: 1.0.0 (build 4)'].join('\n'));
    expect(text).not.toContain('undefined');
  });

  it('joins multiple signing fingerprints on one line', () => {
    const d = failed();
    d.sha1 = [SHA1, SHA1_B];
    expect(formatSignInDiagnostics(d)).toContain(`sha-1: ${SHA1}, ${SHA1_B}`);
  });
});

describe('authAttemptMeta', () => {
  it('stays within the endpoint shape: at most 7 flat keys', () => {
    const meta = authAttemptMeta(failed());
    expect(meta).toEqual({
      provider: 'google',
      outcome: 'failed',
      error_code: '16',
      client_id: '650382817342-69g4u7agreiik2l1fqpvdqlkibsv3es4.apps.googleusercontent.com',
      app_id: 'app.beech.beach',
      sha1: SHA1,
      sha256: SHA256,
    });
    expect(Object.keys(meta).length).toBeLessThanOrEqual(8);
  });

  it('omits missing fields and joins multiple fingerprints', () => {
    expect(authAttemptMeta({ provider: 'google', outcome: 'started', platform: 'android', version: '1.0.0', build: '4' })).toEqual({
      provider: 'google',
      outcome: 'started',
    });
    const d = failed();
    d.sha1 = [SHA1, SHA1_B];
    expect(authAttemptMeta(d).sha1).toBe(`${SHA1},${SHA1_B}`);
  });

  it('survives the telemetry sanitizer: the first sha-256 stays intact', () => {
    const d = failed();
    d.sha256 = [SHA256, SHA256];
    const ev = telemetryEvent('auth_attempt', authAttemptMeta(d));
    expect(ev?.meta?.sha256).toHaveLength(120);
    expect(String(ev?.meta?.sha256).startsWith(SHA256)).toBe(true);
  });
});

describe('auth_attempt reporting', () => {
  function initWithFetch(): ReturnType<typeof vi.fn> {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('window', {
      location: { pathname: '/' },
      addEventListener: () => {},
    });
    initTelemetry('https://play.beech.games');
    return mockFetch;
  }

  it('is a no-op before initTelemetry', () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', mockFetch);
    reportSignInAttempt(failed());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('posts started and failed attempts with the diagnostics meta', async () => {
    const mockFetch = initWithFetch();
    startSignInAttempt('google', '650382817342-69g4u7agreiik2l1fqpvdqlkibsv3es4.apps.googleusercontent.com');
    const done = await finishSignInAttempt(
      {
        provider: 'google',
        outcome: 'started',
        platform: 'android',
        version: '1.0.0',
        build: '4',
        clientId: '650382817342-69g4u7agreiik2l1fqpvdqlkibsv3es4.apps.googleusercontent.com',
      },
      'failed',
      new Error('Google Sign-In failed: [16] Account reauth failed.'),
    );
    expect(done.outcome).toBe('failed');
    expect(done.errorCode).toBe('16');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const started = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(started).toMatchObject({ kind: 'event', name: 'auth_attempt', meta: { provider: 'google', outcome: 'started' } });
    const failedEv = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(failedEv).toMatchObject({
      kind: 'event',
      name: 'auth_attempt',
      meta: { provider: 'google', outcome: 'failed', error_code: '16' },
    });
    expect(failedEv.meta.client_id).toContain('650382817342-');
  });

  it('finish never throws, even for a non-Error failure', async () => {
    initWithFetch();
    const done = await finishSignInAttempt(
      { provider: 'google', outcome: 'started', platform: 'android', version: '1.0.0', build: '4' },
      'failed',
      'plain string failure',
    );
    expect(done.outcome).toBe('failed');
    expect(done.errorCode).toBeUndefined();
  });
});

describe('native lookups off Android', () => {
  it('returns null/undefined in a non-native environment', async () => {
    expect(await getSigningFingerprints()).toBeNull();
    expect(await getSignInAppId()).toBeUndefined();
  });
});

describe('attaching diagnostics to a thrown error', () => {
  it('round-trips through signInDiagnosticsOf and ignores plain errors', () => {
    const err = new Error('[16] Account reauth failed');
    attachSignInDiagnostics(err, failed());
    expect(signInDiagnosticsOf(err)).toEqual(failed());
    expect(signInDiagnosticsOf(new Error('nope'))).toBeNull();
    expect(signInDiagnosticsOf(null)).toBeNull();
    expect(signInDiagnosticsOf('a string')).toBeNull();
    const notAnError: Record<string, unknown> = {};
    attachSignInDiagnostics(notAnError, failed());
    expect(signInDiagnosticsOf(notAnError)).toEqual(failed());
  });
});
