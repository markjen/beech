import type { CapacitorConfig } from '@capacitor/cli';

// iOS bundles dist/. Android sync packages a connection-error screen and
// points the native shell at the production game.
const hostedAndroid = process.env.BEECH_CAP_ANDROID === '1';

// appId is the store bundle identifier. Pick the final one BEFORE the first
// store upload: it can never change after an app is published.
const config: CapacitorConfig = {
  appId: 'app.beech.beach',
  appName: 'beech',
  webDir: hostedAndroid ? 'android/web' : 'dist',
  server: hostedAndroid ? { url: 'https://play.beech.games', errorPath: 'index.html' } : undefined,
  backgroundColor: '#fbeedd',
  ios: {
    // The location and local notification plugins are enabled on Android.
    includePlugins: [
      '@capacitor/app', '@capacitor/filesystem', '@capacitor/haptics', '@capacitor/share',
      '@capgo/capacitor-social-login', '@capgo/native-purchases',
    ],
    contentInset: 'never',
    backgroundColor: '#fbeedd',
    // the canvas handles all gestures itself
    scrollEnabled: false,
  },
  android: {
    backgroundColor: '#fbeedd',
    resolveServiceWorkerRequests: false,
  },
  plugins: {
    // native sign-in (src/net/nativeAuth.ts): Google everywhere, Apple on iOS.
    // Facebook and Twitter are left out so their SDKs (and Facebook's
    // advertising-ID permission) never ship.
    SocialLogin: {
      providers: { google: true, apple: true, facebook: false, twitter: false },
      logLevel: 1,
    },
  },
};

export default config;
