import { Capacitor } from '@capacitor/core';

/** Register the offline service worker for the web build (not in dev, not in the native shells). */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (Capacitor.isNativePlatform()) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is a bonus; ignore failures */
    });
  });
}
