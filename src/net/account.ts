import { Capacitor } from '@capacitor/core';

// Accounts are a build-time feature. The public GitHub Pages build is a
// sandbox (no sign-in, nothing saved); the production build sets:
//   VITE_ACCOUNTS=1
//   VITE_API_URL=           (empty = same origin, e.g. https://beech.app/api)
//   VITE_GOOGLE_CLIENT_ID=  (OAuth web client ID; public, not a secret)
//   VITE_DEV_AUTH=1         (local development only: a "dev sign in" button)
const env = import.meta.env;
export const ACCOUNTS_ENABLED = env.VITE_ACCOUNTS === '1';
export const GOOGLE_CLIENT_ID: string = env.VITE_GOOGLE_CLIENT_ID ?? '';
export const DEV_AUTH = env.VITE_DEV_AUTH === '1';
const API = String(env.VITE_API_URL ?? '').replace(/\/+$/, '');
const TOKEN_KEY = 'beech.session.v1';

export interface AccountUser {
  id: string;
  name: string;
}

export interface SavedBeach {
  location: string;
  nx: number;
  ny: number;
  bytes: Uint8Array;
  updatedAt: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(t: string | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked: the session lasts for this visit only */
  }
}

type Listener = (user: AccountUser | null) => void;

/** The signed-in person (if any) and the calls that need them. */
export class Account {
  private token: string | null = readToken();
  user: AccountUser | null = null;
  private listeners: Listener[] = [];

  onChange(fn: Listener): void {
    this.listeners.push(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.user);
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    const res = await fetch(`${API}${path}`, { ...init, headers });
    if (res.status === 401 && this.token) {
      // the session ended (expired, signed out elsewhere, account deleted)
      this.token = null;
      writeToken(null);
      this.user = null;
      this.emit();
    }
    return res;
  }

  private async session(res: Response): Promise<AccountUser> {
    if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'sign-in failed');
    const data = (await res.json()) as { token: string; user: AccountUser };
    this.token = data.token;
    writeToken(data.token);
    this.user = data.user;
    this.emit();
    return data.user;
  }

  /** On startup: pick up a saved session, if it is still valid. */
  async restore(): Promise<AccountUser | null> {
    if (!this.token) return null;
    try {
      const res = await this.call('/api/me');
      if (!res.ok) return null;
      this.user = ((await res.json()) as { user: AccountUser }).user;
      this.emit();
      return this.user;
    } catch {
      return null; // offline: stay signed out for now, keep the token for next time
    }
  }

  signInWithGoogle(credential: string): Promise<AccountUser> {
    return this.call('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    }).then((r) => this.session(r));
  }

  signInDev(name: string): Promise<AccountUser> {
    return this.call('/api/auth/dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((r) => this.session(r));
  }

  async signOut(): Promise<void> {
    try {
      await this.call('/api/auth/logout', { method: 'POST' });
    } catch {
      /* offline: forget the token locally anyway */
    }
    this.token = null;
    writeToken(null);
    this.user = null;
    this.emit();
  }

  async deleteAccount(): Promise<void> {
    const res = await this.call('/api/account', { method: 'DELETE' });
    if (!res.ok && res.status !== 401) throw new ApiError(res.status, 'could not delete the account');
    this.token = null;
    writeToken(null);
    this.user = null;
    this.emit();
  }

  async loadBeach(): Promise<SavedBeach | null> {
    const res = await this.call('/api/beach');
    if (res.status === 404) return null;
    if (!res.ok) throw new ApiError(res.status, 'could not load your beach');
    return {
      location: res.headers.get('X-Beach-Location') ?? '',
      nx: Number(res.headers.get('X-Beach-Nx')),
      ny: Number(res.headers.get('X-Beach-Ny')),
      updatedAt: Number(res.headers.get('X-Beach-Updated')),
      bytes: new Uint8Array(await res.arrayBuffer()),
    };
  }

  async saveBeach(bytes: Uint8Array, location: string, nx: number, ny: number, keepalive = false): Promise<number> {
    const res = await this.call('/api/beach', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Beach-Location': location,
        'X-Beach-Nx': String(nx),
        'X-Beach-Ny': String(ny),
      },
      body: bytes as BodyInit,
      // keepalive lets a save finish while the page is closing (64 KB limit)
      keepalive: keepalive && bytes.byteLength < 60000,
    });
    if (!res.ok) throw new ApiError(res.status, 'could not save your beach');
    return ((await res.json()) as { updatedAt: number }).updatedAt;
  }
}

// ------------------------------------------------------------------ Google

interface GoogleId {
  accounts: {
    id: {
      initialize(o: Record<string, unknown>): void;
      renderButton(el: HTMLElement, o: Record<string, unknown>): void;
    };
  };
}

let gisLoading: Promise<GoogleId> | null = null;
function loadGis(): Promise<GoogleId> {
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve((window as unknown as { google: GoogleId }).google);
      s.onerror = () => reject(new Error('could not reach Google'));
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

/** Can this build/platform offer Google sign-in? (Google blocks it inside app WebViews.) */
export function googleSignInAvailable(): boolean {
  return ACCOUNTS_ENABLED && !!GOOGLE_CLIENT_ID && !Capacitor.isNativePlatform();
}

/** Render Google's own sign-in button into `el`; calls back with an ID token. */
export async function renderGoogleButton(el: HTMLElement, onCredential: (credential: string) => void): Promise<void> {
  const google = await loadGis();
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (r: { credential: string }) => onCredential(r.credential),
    ux_mode: 'popup',
    use_fedcm_for_button: true,
  });
  google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 260 });
}
