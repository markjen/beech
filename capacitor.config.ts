import type { CapacitorConfig } from '@capacitor/cli';

// Native shells for the App Store and Google Play. The web build in dist/ is
// copied into each native project by `npx cap sync`.
//
// appId is the store bundle identifier. Pick the final one BEFORE the first
// store upload: it can never change after an app is published.
const config: CapacitorConfig = {
  appId: 'app.beech.beach',
  appName: 'beech',
  webDir: 'dist',
  backgroundColor: '#fbeedd',
  ios: {
    contentInset: 'never',
    backgroundColor: '#fbeedd',
    // the canvas handles all gestures itself
    scrollEnabled: false,
  },
  android: {
    backgroundColor: '#fbeedd',
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
