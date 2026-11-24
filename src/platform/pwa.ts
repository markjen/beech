import { isPackagedApp } from './runtime';

/** Register the offline service worker for the web build (not in dev, not in packaged shells). */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (isPackagedApp()) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is a bonus; ignore failures */
    });
  });
}
