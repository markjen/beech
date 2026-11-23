import { Capacitor } from '@capacitor/core';
import { nativeSignOut } from './nativeAuth';

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

  /** Authenticated request to the API (used by NeighborApi). */
  fetch(path: string, init: RequestInit = {}): Promise<Response> {
    return this.call(path, init);
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const sent = this.token;
    if (sent) headers.set('Authorization', `Bearer ${sent}`);
    const res = await fetch(`${API}${path}`, { ...init, headers });
    // (only if it's still the session we asked with: a slow answer to an old
    // session must not sign out whoever has signed in since)
    if (res.status === 401 && sent && this.token === sent) {
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

  /** Sign in with Apple (the iOS app). Apple only shares the name on the very first sign-in. */
  signInWithApple(identityToken: string, name: string): Promise<AccountUser> {
    return this.call('/api/auth/apple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityToken, name }),
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
    void nativeSignOut();
    this.token = null;
    writeToken(null);
    this.user = null;
    this.beaches = [];
    this.beachId = null;
    this.emit();
  }

  async deleteAccount(): Promise<void> {
    const res = await this.call('/api/account', { method: 'DELETE' });
    if (!res.ok && res.status !== 401) throw new ApiError(res.status, 'could not delete the account');
    void nativeSignOut();
    this.beaches = [];
    this.beachId = null;
    this.token = null;
    writeToken(null);
    this.user = null;
    this.emit();
  }

  /** Items you own beyond the free ones (bought, won, given). Empty for now. */
  async inventory(): Promise<OwnedItem[]> {
    const res = await this.call('/api/inventory');
    if (!res.ok) throw await errorOf(res, 'Could not load your bag');
    return ((await res.json()) as { items: OwnedItem[] }).items;
  }

  // ---------------------------------------------------------------- my beaches
  /**
   * The beach this device shows and simulates (one of yours). Each device
   * remembers its own, so a phone and a TV can each run a different beach.
   * null until your beaches have loaded: then it's your home beach.
   */
  beachId: string | null = null;
  /** your beaches, as last loaded */
  beaches: MyBeach[] = [];
  allowance = 1;
  private beachListeners: ((id: string | null) => void)[] = [];

  onBeach(fn: (id: string | null) => void): void {
    this.beachListeners.push(fn);
  }

  /** Load your beaches and pick this device's one (as remembered, else home). */
  async loadBeaches(): Promise<MyBeach[]> {
    const who = this.user?.id;
    const res = await this.call('/api/beaches/mine');
    if (!res.ok) throw await errorOf(res, 'could not load your beaches');
    const data = (await res.json()) as { allowance: number; beaches: MyBeach[] };
    // someone else signed in meanwhile: this list isn't theirs
    if (this.user?.id !== who) return this.beaches;
    this.beaches = data.beaches;
    this.allowance = data.allowance;
    if (!this.beachId || !this.beaches.some((b) => b.id === this.beachId)) {
      const remembered = readActive(this.user?.id);
      const pick = this.beaches.find((b) => b.id === remembered) ?? this.beaches.find((b) => b.home) ?? this.beaches[0];
      this.setBeach(pick?.id ?? null);
    } else {
      // same beach, fresh list (names, links, allowance): let the panels redraw
      for (const fn of this.beachListeners) fn(this.beachId);
    }
    return this.beaches;
  }

  /** Show and simulate this beach on this device. */
  setBeach(id: string | null): void {
    if (id === this.beachId) return;
    this.beachId = id;
    if (this.user && id) writeActive(this.user.id, id);
    for (const fn of this.beachListeners) fn(id);
  }

  get beach(): MyBeach | undefined {
    return this.beaches.find((b) => b.id === this.beachId);
  }

  async createBeach(name: string, location: string): Promise<MyBeach> {
    const res = await this.call('/api/beaches/mine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, location }),
    });
    if (!res.ok) throw await errorOf(res, 'could not make a beach');
    const b = ((await res.json()) as { beach: MyBeach }).beach;
    await this.loadBeaches();
    return b;
  }

  async updateBeach(id: string, patch: { name?: string; location?: string; onShore?: boolean; home?: boolean }): Promise<void> {
    const res = await this.call(`/api/beaches/mine/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw await errorOf(res, 'could not change that beach');
    await this.loadBeaches();
  }

  async removeBeach(id: string): Promise<void> {
    const res = await this.call(`/api/beaches/mine/${id}`, { method: 'DELETE' });
    if (!res.ok) throw await errorOf(res, 'could not remove that beach');
    if (this.beachId === id) this.beachId = null;
    await this.loadBeaches();
  }

  /** the sand endpoint for this device's beach (the home beach before they've loaded) */
  private sandPath(): string {
    return this.beachId ? `/api/beaches/mine/${this.beachId}/sand` : '/api/beach';
  }

  async loadBeach(): Promise<SavedBeach | null> {
    const res = await this.call(this.sandPath());
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

  /** `items`: how many of each non-free item are on this beach (counted across your beaches) */
  async saveBeach(bytes: Uint8Array, location: string, nx: number, ny: number, keepalive = false, items: Record<string, number> = {}): Promise<number> {
    const res = await this.call(this.sandPath(), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Beach-Location': location,
        'X-Beach-Nx': String(nx),
        'X-Beach-Ny': String(ny),
        'X-Beach-Items': Object.entries(items)
          .map(([k, v]) => `${k}=${v}`)
          .join(','),
      },
      body: bytes as BodyInit,
      // keepalive lets a save finish while the page is closing (64 KB limit)
      keepalive: keepalive && bytes.byteLength < 60000,
    });
    if (!res.ok) throw new ApiError(res.status, 'could not save your beach');
    return ((await res.json()) as { updatedAt: number }).updatedAt;
  }
}

export type Side = 'left' | 'right';

/** One of your beaches (GET /api/beaches/mine). */
export interface MyBeach {
  id: string;
  code: string;
  name: string;
  home: boolean;
  onShore: boolean;
  location: string | null;
  updatedAt: number | null;
  /** how many of each non-free item are on it, as of its last save */
  items: Record<string, number>;
  left: (Neighbor & { yours: boolean }) | null;
  right: (Neighbor & { yours: boolean }) | null;
}

const ACTIVE_KEY = 'beech.activeBeach.v1';
function readActive(user: string | undefined): string | null {
  try {
    return user ? ((JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? '{}') as Record<string, string>)[user] ?? null) : null;
  } catch {
    return null;
  }
}
function writeActive(user: string, beach: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? '{}') as Record<string, string>;
    all[user] = beach;
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(all));
  } catch {
    /* storage blocked: this device opens the home beach next time */
  }
}

export interface Neighbor {
  code: string;
  name: string;
  /** their real beach id, or null if they haven't saved yet */
  location: string | null;
  updatedAt: number | null;
}

export interface Neighbors {
  /** your code, to share with people who want you next door */
  code: string;
  left: Neighbor | null;
  right: Neighbor | null;
  /** who you've asked to move in, per side of your beach (waiting for them to accept) */
  asked: { left: Neighbor | null; right: Neighbor | null };
  /** people asking to move in next to you; `side` is where they'd be on your beach */
  requests: (Neighbor & { side: Side })[];
}

export interface OwnedItem {
  /** catalog id (src/world/items.ts) */
  item: string;
  quantity: number;
  source: 'shop' | 'event' | 'pull' | 'gift';
  acquiredAt: number;
  /** null: yours for good */
  expiresAt: number | null;
}

async function errorOf(res: Response, fallback: string): Promise<ApiError> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return new ApiError(res.status, data.error ?? fallback);
}

/** The beaches on either side of yours. */
export class NeighborApi {
  constructor(private readonly account: Account) {}

  /** `?beach=<id>` for this device's beach ('' before beaches load: the server uses home) */
  private q(sep = '?'): string {
    return this.account.beachId ? `${sep}beach=${encodeURIComponent(this.account.beachId)}` : '';
  }

  async get(): Promise<Neighbors> {
    const res = await this.account.fetch(`/api/neighbors${this.q()}`);
    if (!res.ok) throw await errorOf(res, 'could not load your neighbors');
    return (await res.json()) as Neighbors;
  }

  /** Ask someone to be on your `side`. 'linked' if they had already asked for the same. */
  async set(side: Side, code: string): Promise<{ status: 'asked' | 'linked'; neighbor: Neighbor }> {
    const res = await this.account.fetch(`/api/neighbors/${side}${this.q()}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw await errorOf(res, 'could not ask them');
    return (await res.json()) as { status: 'asked' | 'linked'; neighbor: Neighbor };
  }

  /** Move away from your `side` neighbor (both ends), or take back your request for that side. */
  async remove(side: Side): Promise<void> {
    const res = await this.account.fetch(`/api/neighbors/${side}${this.q()}`, { method: 'DELETE' });
    if (!res.ok) throw await errorOf(res, 'could not remove that neighbor');
  }

  async accept(code: string): Promise<void> {
    const res = await this.account.fetch(`/api/neighbors/requests/${encodeURIComponent(code)}/accept${this.q()}`, { method: 'POST' });
    if (!res.ok) throw await errorOf(res, 'could not accept');
  }

  async decline(code: string): Promise<void> {
    const res = await this.account.fetch(`/api/neighbors/requests/${encodeURIComponent(code)}${this.q()}`, { method: 'DELETE' });
    if (!res.ok) throw await errorOf(res, 'could not decline');
  }

  /** Keep walking the shore from `from` (infinite scroll), nearest first. */
  async shoreMore(from: string, dir: Side, count: number): Promise<ShoreBeach[]> {
    const q = new URLSearchParams({ from, dir, count: String(count) });
    const res = await this.account.fetch(`/api/shore/more?${q}`);
    if (!res.ok) throw await errorOf(res, 'could not load more of the shore');
    return ((await res.json()) as { beaches: ShoreBeach[] }).beaches;
  }

  async beach(side: Side): Promise<SavedBeach | null> {
    const res = await this.account.fetch(`/api/neighbors/${side}/beach`);
    if (res.status === 404) return null;
    if (!res.ok) throw await errorOf(res, 'could not load their beach');
    return {
      location: res.headers.get('X-Beach-Location') ?? '',
      nx: Number(res.headers.get('X-Beach-Nx')),
      ny: Number(res.headers.get('X-Beach-Ny')),
      updatedAt: Number(res.headers.get('X-Beach-Updated')),
      bytes: new Uint8Array(await res.arrayBuffer()),
    };
  }

  async newCode(): Promise<string> {
    const res = await this.account.fetch(`/api/neighbors/code${this.q()}`, { method: 'POST' });
    if (!res.ok) throw await errorOf(res, 'could not make a new code');
    return ((await res.json()) as { code: string }).code;
  }

  /** A beach (yours, or anyone's by code) and the beaches down the shore each way, nearest first. */
  async shore(code: string | null, depth: number): Promise<Shore> {
    const q = new URLSearchParams({ depth: String(depth) });
    if (code) q.set('code', code);
    else if (this.account.beachId) q.set('beach', this.account.beachId);
    const res = await this.account.fetch(`/api/shore?${q}`);
    if (!res.ok) throw await errorOf(res, 'could not find that beach');
    return (await res.json()) as Shore;
  }

  /** Anyone's saved beach, by their code (null if they haven't saved one). */
  async beachByCode(code: string): Promise<SavedBeach | null> {
    const res = await this.account.fetch(`/api/beaches/${encodeURIComponent(code)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await errorOf(res, 'could not load their beach');
    return {
      location: res.headers.get('X-Beach-Location') ?? '',
      nx: Number(res.headers.get('X-Beach-Nx')),
      ny: Number(res.headers.get('X-Beach-Ny')),
      updatedAt: Number(res.headers.get('X-Beach-Updated')),
      bytes: new Uint8Array(await res.arrayBuffer()),
    };
  }

  async favorites(): Promise<ShoreBeach[]> {
    const res = await this.account.fetch('/api/favorites');
    if (!res.ok) throw await errorOf(res, 'could not load your favorites');
    return ((await res.json()) as { favorites: ShoreBeach[] }).favorites;
  }

  async favorite(code: string, on: boolean): Promise<void> {
    const res = await this.account.fetch(`/api/favorites/${encodeURIComponent(code)}`, { method: on ? 'PUT' : 'DELETE' });
    if (!res.ok) throw await errorOf(res, 'could not change your favorites');
  }

  /** The most-starred beaches: all time, or rising (star velocity). */
  async leaderboard(board: Board, limit = 50): Promise<BoardEntry[]> {
    const res = await this.account.fetch(`/api/leaderboard?board=${board}&limit=${limit}`);
    if (!res.ok) throw await errorOf(res, 'could not load the leaderboard');
    return ((await res.json()) as { entries: BoardEntry[] }).entries;
  }
}

export type Board = 'all' | 'rising';

/** A row of the leaderboard. */
export interface BoardEntry extends ShoreBeach {
  rank: number;
  /** stars it has now */
  stars: number;
  /** of those, made in the last week */
  recent: number;
  /** recent stars, each halved every 2 days of age (the rising board's order) */
  velocity: number;
  /** you've starred it */
  starred: boolean;
  /** it's one of your beaches */
  yours: boolean;
}

/** A beach somewhere along the shore (found by code or by walking). */
export interface ShoreBeach {
  code: string;
  name: string;
  /** their real beach id, or null if they haven't saved yet */
  location: string | null;
  updatedAt: number | null;
  /** the beach's own name, if its owner gave it one */
  beachName?: string;
  /** a real (mutual) neighbor of the beach before it along the shore */
  linked?: boolean;
}

export interface Shore {
  center: ShoreBeach & { you: boolean };
  /** nearest first */
  left: ShoreBeach[];
  right: ShoreBeach[];
}

export interface PullPool {
  id: string;
  name: string;
  /** published chance of each rarity */
  odds: Record<'common' | 'rare' | 'legendary', number>;
  items: Record<'common' | 'rare' | 'legendary', string[]>;
  /** how often the claw holds on to a ball of each rarity (a miss spends the go) */
  grab: Record<'common' | 'rare' | 'legendary', number>;
  /** a free go is ready now */
  free: boolean;
  /** how long the claw will rest after your next go (ms): 5 min, doubling, up to a day */
  nextCooldown: number;
  /** the fixed gifts of the first goes (shown before the odds) */
  starter?: { rare: string; paid: string; beach: string; beachAfterMs: number };
}

export interface GiftResult {
  item: string;
  to: { name: string; code: string };
}

/** Give one of your items to someone else, by their neighbor code. */
export class GiftApi {
  constructor(private readonly account: Account) {}

  async gift(code: string, item: string): Promise<GiftResult> {
    const res = await this.account.fetch('/api/gifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, item }),
    });
    if (!res.ok) throw await errorOf(res, 'could not send that gift');
    return (await res.json()) as GiftResult;
  }
}

/** The claw machine (and later, mystery boxes): draws happen on the server. */
export class PullApi {
  constructor(private readonly account: Account) {}

  async status(): Promise<{ pools: PullPool[]; nextFree: number }> {
    const res = await this.account.fetch('/api/pulls');
    if (!res.ok) throw await errorOf(res, 'The claw machine is out of order');
    return res.json();
  }

  /** A go: `missed` when the claw dropped the ball — the go is spent, nothing
   *  is won, and `dropped` says what slipped out. */
  async pull(pool: string): Promise<{
    item: string | null;
    rarity: string | null;
    missed: boolean;
    dropped?: { item: string; rarity: string };
    nextFree: number;
  }> {
    const res = await this.account.fetch(`/api/pulls/${encodeURIComponent(pool)}`, { method: 'POST' });
    if (!res.ok) throw await errorOf(res, 'The claw machine is out of order');
    return res.json();
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
