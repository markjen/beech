import { Capacitor } from '@capacitor/core';
import { isMobileApp } from '../platform/runtime';
import {
  attachSignInDiagnostics,
  finishSignInAttempt,
  startSignInAttempt,
} from './signinDiagnostics';

// Sign-in inside the phone apps. Google refuses its web sign-in inside app
// WebViews, so the apps use the system sign-in sheets instead (Credential
// Manager on Android, GoogleSignIn and AuthenticationServices on iOS) through
// @capgo/capacitor-social-login. Each returns an ID token that the server
// checks exactly like the web's.
//
// Build-time settings (public client IDs, not secrets):
//   VITE_GOOGLE_CLIENT_ID      the OAuth *web* client ID. Android asks for a
//                              token for it, so it is the token's audience.
//   VITE_GOOGLE_IOS_CLIENT_ID  the OAuth iOS client ID (its reversed form is
//                              the URL scheme in ios/App/App/Info.plist; see
//                              scripts/native-auth-config.mjs)
// Sign in with Apple needs no ID here (the bundle ID is the audience); the
// "Sign in with Apple" capability is in ios/App/App/App.entitlements.

const env = import.meta.env;
const WEB_CLIENT_ID: string = env.VITE_GOOGLE_CLIENT_ID ?? '';
const IOS_CLIENT_ID: string = env.VITE_GOOGLE_IOS_CLIENT_ID ?? '';

export type NativeProvider = 'google' | 'apple';

export interface NativeIdentity {
  provider: NativeProvider;
  idToken: string;
  /** first name, when the provider tells us (Apple: only on the very first sign-in) */
  name: string;
}

const platform = () => Capacitor.getPlatform();

/** Which native sign-ins this app build offers. Empty on the web and Steam. */
export function nativeProviders(): NativeProvider[] {
  if (!isMobileApp()) return [];
  const out: NativeProvider[] = [];
  if (platform() === 'ios') {
    // App Store guideline 4.8: offer Apple wherever Google is offered
    out.push('apple');
    if (IOS_CLIENT_ID && WEB_CLIENT_ID) out.push('google');
  } else if (platform() === 'android' && WEB_CLIENT_ID) {
    out.push('google');
  }
  return out;
}

type Plugin = typeof import('@capgo/capacitor-social-login').SocialLogin;
let ready: Promise<Plugin> | null = null;

function plugin(): Promise<Plugin> {
  if (!ready) {
    ready = (async () => {
      // loaded only in the apps, so the web build never pulls it in
      const { SocialLogin } = await import('@capgo/capacitor-social-login');
      const ios = platform() === 'ios';
      await SocialLogin.initialize({
        google: WEB_CLIENT_ID
          ? ios
            ? { iOSClientId: IOS_CLIENT_ID, iOSServerClientId: WEB_CLIENT_ID }
            : { webClientId: WEB_CLIENT_ID, skipAuthOnlyAuthorizationAfterSignIn: true }
          : undefined,
        apple: ios ? { clientId: 'app', redirectUrl: '' } : undefined,
      });
      return SocialLogin;
    })();
    ready.catch(() => (ready = null));
  }
  return ready;
}

/** Thrown when the person closed the sign-in sheet: not worth an error message. */
export class SignInCancelled extends Error {}

const looksCancelled = (e: unknown) => /cancel|dismiss|12501|1001|user closed/i.test(String((e as Error)?.message ?? e));

export async function nativeSignIn(provider: NativeProvider): Promise<NativeIdentity> {
  const SocialLogin = await plugin();
  // Diagnostics only: the attempt and its outcome are uploaded as
  // `auth_attempt` events (see signinDiagnostics.ts); the flow below is
  // unchanged.
  const attempt = startSignInAttempt(provider, provider === 'google' ? WEB_CLIENT_ID : undefined);
  try {
    if (provider === 'google') {
      // no scopes on Android: the default sign-in already includes profile and
      // email, and asking again is refused on a stock BridgeActivity
      const res = await SocialLogin.login({
        provider: 'google',
        options: platform() === 'ios' ? { scopes: ['profile', 'email'] } : {},
      });
      const r = res.result as { idToken?: string | null; profile?: { givenName?: string | null } };
      if (!r.idToken) throw new Error('Google did not return an ID token');
      await finishSignInAttempt(attempt, 'success');
      return { provider, idToken: r.idToken, name: r.profile?.givenName ?? '' };
    }
    const res = await SocialLogin.login({ provider: 'apple', options: { scopes: ['name', 'email'] } });
    const r = res.result as { idToken?: string | null; profile?: { givenName?: string | null } };
    if (!r.idToken) throw new Error('Apple did not return an ID token');
    await finishSignInAttempt(attempt, 'success');
    return { provider, idToken: r.idToken, name: r.profile?.givenName ?? '' };
  } catch (e) {
    const cancelled = looksCancelled(e);
    const done = await finishSignInAttempt(attempt, cancelled ? 'cancelled' : 'failed', e);
    if (cancelled) throw new SignInCancelled();
    attachSignInDiagnostics(e, done);
    throw e;
  }
}

/** Forget the provider's own session too, so the next sign-in can pick another account. */
export async function nativeSignOut(): Promise<void> {
  if (!isMobileApp() || !ready) return;
  const SocialLogin = await ready;
  for (const provider of nativeProviders()) await SocialLogin.logout({ provider }).catch(() => {});
}
