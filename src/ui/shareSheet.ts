// Sending a link: the phone's share sheet where there is one (the native
// apps through @capacitor/share, browsers through navigator.share), and
// copying it everywhere else.

import { Capacitor } from '@capacitor/core';

export interface ShareData {
  url: string;
  title: string;
  text: string;
}
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/** Copy text: the clipboard API, or (older browsers) a scratch field. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.readOnly = true;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    field.remove();
    return ok;
  }
}

export async function shareLink(d: ShareData): Promise<ShareResult> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title: d.title, text: d.text, url: d.url, dialogTitle: d.title });
      return 'shared';
    } catch (e) {
      if (/cancel/i.test(String((e as Error)?.message ?? e))) return 'cancelled';
      // fall through to copying
    }
  } else if (typeof navigator.share === 'function') {
    try {
      await navigator.share(d);
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
      // not allowed here (some desktop browsers): copy instead
    }
  }
  return (await copyText(d.url)) ? 'copied' : 'failed';
}
