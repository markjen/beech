import { isPackagedApp } from '../platform/runtime';
import { nativeSignOut } from './nativeAuth';
import { MAX_OBJECTS } from '../sim/sandCodec';
import { APP_BUILD } from '../platform/version';

// Accounts are a build-time feature. The sandbox build (default
// `npm run build`) has no sign-in and saves nothing; the production build sets:
//   VITE_ACCOUNTS=1
//   VITE_API_URL=           (empty = same origin, e.g. https://beech.app/api)
//   VITE_GOOGLE_CLIENT_ID=  (OAuth web client ID; public, not a secret)
//   VITE_DEV_AUTH=1         (local development only: a "dev sign in" button)
const env = import.meta.env;
export const ACCOUNTS_ENABLED = import.meta.env.VITE_ACCOUNTS === '1';
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
  /** your own beaches: goes up each time a checkpoint is restored onto it */
  epoch?: number;
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
  /**
   * This instance's edit token (docs/EDIT_SESSIONS.md): claimed when it
   * opens your beach for editing, and what proves it is still the one
   * editor. In memory only — never localStorage, which two tabs share —
   * so each tab, device or app holds its own.
   */
  editToken: string | null = null;
  private listeners: Listener[] = [];

  onChange(fn: Listener): void {
    this.listeners.push(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.user);
  }

  /** Claim this instance as the one editor of your beaches (fences older instances). */
  async claimEditSession(): Promise<string> {
    const res = await this.call('/api/edit-session', { method: 'POST' });
    if (!res.ok) throw await errorOf(res, 'could not start editing');
    const { token } = (await res.json()) as { token: string };
    this.editToken = token;
    return token;
  }

  /** Is the token this instance holds still the current editor? (the heartbeat) */
  async editSessionActive(): Promise<boolean> {
    if (!this.editToken) return false;
    const res = await this.call('/api/edit-session', { headers: { 'X-Edit-Token': this.editToken } });
    if (!res.ok) return false;
    return ((await res.json()) as { active: boolean }).active;
  }

  /** The header beach edits carry, when this instance holds a token. */
  editHeaders(): Record<string, string> {
    return this.editToken ? { 'X-Edit-Token': this.editToken } : {};
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
      this.editToken = null;
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
    // a new sign-in hasn't claimed editing yet (the beach load does that)
    this.editToken = null;
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

  /** Sign in with a Steam Web API auth ticket (from window.beechSteam.getAuthTicket). */
  signInWithSteam(ticket: string, name: string): Promise<AccountUser> {
    return this.call('/api/auth/steam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket, name }),
    }).then((r) => this.session(r));
  }

  /** Generate a 10-minute one-time code to link a fresh Steam/other-device account to this one. */
  async createLinkCode(): Promise<{ code: string; expiresAt: number }> {
    const res = await this.call('/api/account/link-code', { method: 'POST' });
    if (!res.ok) throw await errorOf(res, 'could not create a link code');
    return (await res.json()) as { code: string; expiresAt: number };
  }

  /** Link this fresh account to an existing account using its 8-character code. */
  async redeemLinkCode(code: string): Promise<AccountUser> {
    const res = await this.call('/api/account/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const user = await this.session(res);
    this.beaches = [];
    this.beachId = null;
    return user;
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
    this.editToken = null;
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
    this.editToken = null;
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
      headers: { 'Content-Type': 'application/json', ...this.editHeaders() },
      body: JSON.stringify({ name, location }),
    });
    if (!res.ok) throw await errorOf(res, 'could not make a beach');
    const b = ((await res.json()) as { beach: MyBeach }).beach;
    await this.loadBeaches();
    return b;
  }

  async updateBeach(id: string, patch: { name?: string; location?: string; home?: boolean }): Promise<void> {
    const res = await this.call(`/api/beaches/mine/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...this.editHeaders() },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw await errorOf(res, 'could not change that beach');
    await this.loadBeaches();
  }

  async removeBeach(id: string): Promise<void> {
    const res = await this.call(`/api/beaches/mine/${id}`, { method: 'DELETE', headers: { ...this.editHeaders() } });
    if (!res.ok) throw await errorOf(res, 'could not remove that beach');
    if (this.beachId === id) this.beachId = null;
    await this.loadBeaches();
  }

  /** the sand endpoint for a beach (this device's beach by default, or home before they've loaded) */
  private sandPath(beachId?: string | null): string {
    const id = beachId ?? this.beachId;
    return id ? `/api/beaches/mine/${id}/sand` : '/api/beach';
  }

  async loadBeach(beachId?: string | null): Promise<SavedBeach | null> {
    const res = await this.call(this.sandPath(beachId));
    if (res.status === 404) return null;
    if (!res.ok) throw new ApiError(res.status, 'could not load your beach');
    return {
      location: res.headers.get('X-Beach-Location') ?? '',
      nx: Number(res.headers.get('X-Beach-Nx')),
      ny: Number(res.headers.get('X-Beach-Ny')),
      updatedAt: Number(res.headers.get('X-Beach-Updated')),
      epoch: Number(res.headers.get('X-Beach-Epoch') ?? 0) || 0,
      bytes: new Uint8Array(await res.arrayBuffer()),
    };
  }

  /**
   * `items`: how many of each non-free item are on this beach (counted across your beaches).
   * `largeEdit` says the save reshaped the beach (a tenth of the sand, fifty
   * things, a new grid); `largeEditCheckpoint` says the server kept the beach
   * as it was first in the auto checkpoint slot (docs/CHECKPOINTS.md). When
   * a large edit lands without that safety copy, the caller should say so:
   * the beach is saved, but there is nothing to go back to.
   */
  async saveBeach(
    bytes: Uint8Array,
    location: string,
    nx: number,
    ny: number,
    keepalive = false,
    items: Record<string, number> = {},
    /** the epoch the sand was loaded at: a restore since then refuses the save (409) */
    epoch?: number,
    /** which of your beaches to save (defaults to this device's active beach) */
    beachId?: string,
  ): Promise<{ updatedAt: number; largeEdit?: boolean; largeEditCheckpoint?: boolean }> {
    const res = await this.call(this.sandPath(beachId), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Beach-Location': location,
        'X-Beach-Nx': String(nx),
        'X-Beach-Ny': String(ny),
        'X-Beach-Items': Object.entries(items)
          .map(([k, v]) => `${k}=${v}`)
          .join(','),
        ...(epoch === undefined ? {} : { 'X-Beach-Epoch': String(epoch) }),
        // the edit token: only the current editor's saves go through
        ...this.editHeaders(),
        // how many things this app keeps (the server refuses saves from apps that keep fewer than a beach holds)
        'X-Beach-Max': String(MAX_OBJECTS),
        'X-App-Build': APP_BUILD,
      },
      body: bytes as BodyInit,
      // keepalive lets a save finish while the page is closing (64 KB limit)
      keepalive: keepalive && bytes.byteLength < 60000,
    });
    if (!res.ok) {
      // a fenced save keeps its reason: BeachSync tells it apart from a
      // restore (409 'restored') and turns this instance view-only
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (data.error === 'fenced') throw new ApiError(409, 'fenced');
      }
      throw new ApiError(res.status, 'could not save your beach');
    }
    return (await res.json()) as { updatedAt: number; largeEdit?: boolean; largeEditCheckpoint?: boolean };
  }
}

// ---------------------------------------------------------------- checkpoints
/** A saved copy of one of your beaches (docs/CHECKPOINTS.md). */
export interface Checkpoint {
  id: string;
  name: string;
  /** auto: the beach as it was before a restore replaced it */
  kind: 'named' | 'auto';
  source: 'beach' | 'import';
  fromBeach: { id: string; name: string } | null;
  fromName: string;
  location: string | null;
  nx: number;
  ny: number;
  /** non-free things on it, counted by the server */
  items: Record<string, number>;
  objects: number;
  bytes: number;
  createdAt: number;
}

export interface CheckpointList {
  limit: number;
  named: number;
  bytesUsed: number;
  bytesLimit: number;
  checkpoints: Checkpoint[];
}

export interface Short {
  item: string;
  need: number;
  have: number;
}

/** A restore the bag can't cover (strict mode). */
export class ShortError extends ApiError {
  constructor(readonly short: Short[]) {
    super(409, 'short');
  }
}

export class CheckpointApi {
  constructor(private readonly account: Account) {}

  private async json<T>(path: string, init: RequestInit = {}, fallback = 'something went wrong'): Promise<T> {
    const res = await this.account.fetch(path, init);
    if (!res.ok) throw await errorOf(res, fallback);
    return (await res.json()) as T;
  }

  list(): Promise<CheckpointList> {
    return this.json('/api/checkpoints', {}, 'could not load your checkpoints');
  }

  /** a checkpoint of one of your beaches, as last saved (auto: its one automatic copy, e.g. "Before import") */
  async save(beachId: string, name: string, auto = false): Promise<Checkpoint> {
    const r = await this.json<{ checkpoint: Checkpoint }>(
      `/api/beaches/mine/${beachId}/checkpoints`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, auto }) },
      'could not save a checkpoint',
    );
    return r.checkpoint;
  }

  /** a beach made elsewhere (a beach file), encoded with encodeSand */
  async import(bytes: Uint8Array, name: string, location?: string): Promise<Checkpoint> {
    const r = await this.json<{ checkpoint: Checkpoint }>(
      '/api/checkpoints',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Checkpoint-Name': encodeURIComponent(name),
          ...(location ? { 'X-Beach-Location': location } : {}),
        },
        body: bytes as BodyInit,
      },
      'could not save the checkpoint',
    );
    return r.checkpoint;
  }

  async sand(id: string): Promise<{ bytes: Uint8Array; location: string }> {
    const res = await this.account.fetch(`/api/checkpoints/${id}/sand`);
    if (!res.ok) throw await errorOf(res, 'could not load that checkpoint');
    return { bytes: new Uint8Array(await res.arrayBuffer()), location: res.headers.get('X-Beach-Location') ?? '' };
  }

  async rename(id: string, name: string): Promise<void> {
    await this.json(`/api/checkpoints/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }, 'could not rename it');
  }

  async remove(id: string): Promise<void> {
    const res = await this.account.fetch(`/api/checkpoints/${id}`, { method: 'DELETE' });
    if (!res.ok) throw await errorOf(res, 'could not delete it');
  }

  /**
   * Put a checkpoint on one of your beaches. Strict mode throws ShortError
   * when the bag can't cover it; drop-missing leaves those things out.
   * Returns the id of the "before restoring" checkpoint (for undo).
   */
  async restore(beachId: string, checkpoint: string, mode: 'strict' | 'drop-missing' = 'strict'): Promise<{ undo: string | null; dropped: number; epoch: number }> {
    const res = await this.account.fetch(`/api/beaches/mine/${beachId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.account.editHeaders() },
      body: JSON.stringify({ checkpoint, mode }),
    });
    if (res.status === 409) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; short?: Short[] };
      if (data.error === 'fenced') throw new ApiError(409, 'Another tab or device is editing this beach — take over editing there first.');
      if (data.short) throw new ShortError(data.short);
      throw new ApiError(409, data.error ?? 'could not restore');
    }
    if (!res.ok) throw await errorOf(res, 'could not restore');
    return (await res.json()) as { undo: string | null; dropped: number; epoch: number };
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
  /** the inbox, carried on the 30 s poll (docs/INBOX_NOTIFICATIONS.md) */
  inbox?: InboxSummary;
}

export interface InboxSummary {
  unread: number;
  latest: { id: number; kind: InboxKind; name: string | null } | null;
}

export interface OwnedItem {
  /** catalog id (src/world/items.ts) */
  item: string;
  quantity: number;
  source: 'shop' | 'event' | 'pull' | 'gift' | 'reward';
  acquiredAt: number;
  /** null: yours for good */
  expiresAt: number | null;
  /** one of a kind: who found it first */
  foundBy?: string;
  foundAt?: number;
}

async function errorOf(res: Response, fallback: string): Promise<ApiError> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return new ApiError(res.status, data.error ?? fallback);
}

/** The beaches on either side of yours. */
export class NeighborApi {
  constructor(private readonly account: Account) {}

  /** `?beach=<id>` for a beach (defaults to this device's beach; '' before beaches load: the server uses home) */
  private q(sep = '?', beachId?: string | null): string {
    const id = beachId ?? this.account.beachId;
    return id ? `${sep}beach=${encodeURIComponent(id)}` : '';
  }

  async get(beachId?: string): Promise<Neighbors> {
    if (!this.account.user) throw new ApiError(401, 'sign in first');
    const res = await this.account.fetch(`/api/neighbors${this.q('?', beachId)}`);
    if (!res.ok) throw await errorOf(res, 'could not load your neighbors');
    return (await res.json()) as Neighbors;
  }

  /** Ask someone to be on your `side`. 'linked' if they had already asked for the same. */
  async set(side: Side, code: string, beachId?: string): Promise<{ status: 'asked' | 'linked'; neighbor: Neighbor }> {
    const res = await this.account.fetch(`/api/neighbors/${side}${this.q('?', beachId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw await errorOf(res, 'could not ask them');
    return (await res.json()) as { status: 'asked' | 'linked'; neighbor: Neighbor };
  }

  /** Move away from your `side` neighbor (both ends), or take back your request for that side. */
  async remove(side: Side, beachId?: string): Promise<void> {
    const res = await this.account.fetch(`/api/neighbors/${side}${this.q('?', beachId)}`, { method: 'DELETE' });
    if (!res.ok) throw await errorOf(res, 'could not remove that neighbor');
  }

  async accept(code: string, beachId?: string): Promise<void> {
    const res = await this.account.fetch(`/api/neighbors/requests/${encodeURIComponent(code)}/accept${this.q('?', beachId)}`, { method: 'POST' });
    if (!res.ok) throw await errorOf(res, 'could not accept');
  }

  async decline(code: string, beachId?: string): Promise<void> {
    const res = await this.account.fetch(`/api/neighbors/requests/${encodeURIComponent(code)}${this.q('?', beachId)}`, { method: 'DELETE' });
    if (!res.ok) throw await errorOf(res, 'could not decline');
  }

  /** Keep walking the shore from `from` (infinite scroll), nearest first. */
  async shoreMore(from: string, dir: Side, count: number): Promise<ShoreBeach[]> {
    const q = new URLSearchParams({ from, dir, count: String(count) });
    const prefix = this.account.user ? '/api/shore/more' : '/api/public/shore/more';
    const res = await this.account.fetch(`${prefix}?${q}`);
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

  async newCode(beachId?: string): Promise<string> {
    const res = await this.account.fetch(`/api/neighbors/code${this.q('?', beachId)}`, { method: 'POST' });
    if (!res.ok) throw await errorOf(res, 'could not make a new code');
    return ((await res.json()) as { code: string }).code;
  }

  /** A beach (yours, or anyone's by code) and the beaches down the shore each way, nearest first. */
  async shore(code: string | null, depth: number): Promise<Shore> {
    const q = new URLSearchParams({ depth: String(depth) });
    if (code) q.set('code', code);
    else if (this.account.user && this.account.beachId) q.set('beach', this.account.beachId);
    const prefix = this.account.user ? '/api/shore' : '/api/public/shore';
    const res = await this.account.fetch(`${prefix}?${q}`);
    if (!res.ok) throw await errorOf(res, 'could not find that beach');
    return (await res.json()) as Shore;
  }

  /** Anyone's saved beach, by their code (null if they haven't saved one). */
  async beachByCode(code: string): Promise<SavedBeach | null> {
    const prefix = this.account.user ? '/api/beaches' : '/api/public/beaches';
    const res = await this.account.fetch(`${prefix}/${encodeURIComponent(code)}`);
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
  center: (ShoreBeach & { you: boolean }) | null;
  /** nearest first */
  left: ShoreBeach[];
  right: ShoreBeach[];
}

export interface PullPool {
  id: string;
  name: string;
  /** published chance of each rarity */
  odds: Record<'common' | 'uncommon' | 'rare' | 'legendary' | 'unique', number>;
  items: Record<'common' | 'uncommon' | 'rare' | 'legendary' | 'unique', string[]>;
  /** how often the claw holds on to a ball of each rarity (a miss spends the go); the claw only */
  grab?: Record<'common' | 'rare' | 'legendary', number>;
  /** a free go is ready now */
  free: boolean;
  /** the longest the machine can rest after your next go (ms) */
  nextCooldown: number;
  /** the claw's rest is random in this range (ms): shorter after a miss, longer after a win */
  cooldown?: { min: number; max: number };
  /** when your next free go is ready (ms since epoch) */
  nextFree?: number;
  /** the fixed gifts of the first goes (shown before the odds) */
  starter?: { rare: string; paid: string; beach: string; beachAfterMs: number };
  /** the vending machine's current weekly set */
  set?: { week: number; name: string };
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

/** The claw machine and the vending machine: draws happen on the server. */
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

/** The beach guide (docs/INVITES_GUIDE.md): which steps are done, and finishing one. */
export interface GuideStepResult {
  step: string;
  /** false: it was already done (no gift the second time) */
  new: boolean;
  /** what finishing it gave (an item id), if anything */
  gift: string | null;
  /** the bonus for finishing the whole guide, if this was the last step */
  bonus: string | null;
}

export class GuideApi {
  constructor(private readonly account: Account) {}

  async done(): Promise<string[]> {
    const res = await this.account.fetch('/api/guide');
    if (!res.ok) throw await errorOf(res, 'could not load the guide');
    return ((await res.json()) as { done: { step: string }[] }).done.map((d) => d.step);
  }

  /** Mark a step done. A 409 means the server can't see it yet (a claw go, a star…). */
  async complete(step: string): Promise<GuideStepResult> {
    const res = await this.account.fetch(`/api/guide/${encodeURIComponent(step)}`, { method: 'POST' });
    if (!res.ok) throw await errorOf(res, 'not yet');
    return (await res.json()) as GuideStepResult;
  }
}

/** Invites (docs/INVITES_GUIDE.md). */
export interface Referrals {
  /** your invite code (your home beach's code) */
  code: string;
  joined: number;
  settled: number;
  friends: { name: string; joinedAt: number; settled: boolean; reward: string | null }[];
  ladder: { rank: number; item: string }[];
  cap: number;
  settleSteps: number;
  welcomeGift: string;
}

export class ReferralApi {
  constructor(private readonly account: Account) {}

  /** Who an invite is from (works signed out). null: no beach has that code. */
  async lookup(code: string): Promise<{ name: string; welcomeGift: string } | null> {
    const res = await this.account.fetch(`/api/invites/${encodeURIComponent(code)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await errorOf(res, 'could not look up that invite');
    return res.json();
  }

  /** A new player claims the invite they came through: the welcome gift. */
  async claim(code: string): Promise<{ inviter: { name: string; code: string }; gift: string }> {
    const res = await this.account.fetch('/api/referrals/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw await errorOf(res, 'could not use that invite');
    return res.json();
  }

  async status(): Promise<Referrals> {
    const res = await this.account.fetch('/api/referrals');
    if (!res.ok) throw await errorOf(res, 'could not load your invites');
    return res.json();
  }
}

// ------------------------------------------------------------------ visitors and the inbox
// docs/INBOX_NOTIFICATIONS.md

export type InboxKind = 'visit' | 'gift' | 'neighbor_request' | 'neighbor_linked' | 'star' | 'rating' | 'invite_joined' | 'invite_settled' | 'system';

export interface InboxEntry {
  id: number;
  kind: InboxKind;
  /** null: the sender deleted their account */
  from: { name: string; code: string | null } | null;
  beach: { code: string; name: string | null } | null;
  item: string | null;
  shells: number | null;
  note: { id: number; text?: string; removed?: boolean } | null;
  /** batched rows (stars, ratings): how many that day */
  count: number;
  rating?: { count: number; average: number | null };
  payload: { code?: string; side?: Side; beach?: string };
  at: number;
  read: boolean;
}

/** What the visitor card needs for a beach. */
export interface VisitCard {
  count: number;
  /** null until the beach has a few ratings */
  average: number | null;
  mine: number | null;
  yours: boolean;
  quickNotes: string[];
  /** false: quick notes only (a brand-new account) */
  freeText: boolean;
}

export class InboxApi {
  constructor(private readonly account: Account) {}

  async list(before?: number): Promise<InboxSummary & { entries: InboxEntry[] }> {
    const res = await this.account.fetch(`/api/inbox${before ? `?before=${before}` : ''}`);
    if (!res.ok) throw await errorOf(res, 'could not load your inbox');
    return res.json();
  }

  async read(upTo: number): Promise<InboxSummary> {
    const res = await this.account.fetch('/api/inbox/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upTo }),
    });
    if (!res.ok) throw await errorOf(res, 'could not update your inbox');
    return res.json();
  }

  async report(noteId: number, reason = ''): Promise<void> {
    const res = await this.account.fetch(`/api/notes/${noteId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw await errorOf(res, 'could not report that');
  }

  async blocks(): Promise<{ name: string; code: string | null }[]> {
    const res = await this.account.fetch('/api/blocks');
    if (!res.ok) throw await errorOf(res, 'could not load who you blocked');
    return ((await res.json()) as { blocked: { name: string; code: string | null }[] }).blocked;
  }

  async block(code: string, on: boolean): Promise<void> {
    const res = await this.account.fetch(`/api/blocks/${encodeURIComponent(code)}`, { method: on ? 'PUT' : 'DELETE' });
    if (!res.ok) throw await errorOf(res, on ? 'could not block them' : 'could not unblock them');
  }

  /** Accept a neighbor request from the inbox (on the beach it was for). */
  async accept(code: string, beach?: string): Promise<void> {
    const res = await this.account.fetch(`/api/neighbors/requests/${encodeURIComponent(code)}/accept${beach ? `?beach=${encodeURIComponent(beach)}` : ''}`, { method: 'POST' });
    if (!res.ok) throw await errorOf(res, 'could not accept');
  }

  async decline(code: string, beach?: string): Promise<void> {
    const res = await this.account.fetch(`/api/neighbors/requests/${encodeURIComponent(code)}${beach ? `?beach=${encodeURIComponent(beach)}` : ''}`, { method: 'DELETE' });
    if (!res.ok) throw await errorOf(res, 'could not decline');
  }

  async card(code: string): Promise<VisitCard> {
    const res = await this.account.fetch(`/api/beaches/${encodeURIComponent(code)}/rating`);
    if (!res.ok) throw await errorOf(res, 'could not load that beach');
    return res.json();
  }

  /** Leave something on someone's beach: any of a rating, a note, a gift. */
  async leave(code: string, what: { shells?: number; note?: string; quick?: boolean; item?: string }): Promise<{ rating: { count: number; average: number | null } }> {
    const res = await this.account.fetch(`/api/beaches/${encodeURIComponent(code)}/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(what),
    });
    if (!res.ok) throw await errorOf(res, 'that didn’t go through');
    return res.json();
  }
}

/** Digging finds: the server rolls when a good dig ends (never the app). */
export interface DigFindResult {
  found: boolean;
  item?: string;
  rarity?: string;
  findsToday?: number;
  findsLeft?: number;
  nextFindsAt?: number | null;
}

export class DigFindApi {
  constructor(private readonly account: Account) {}

  /** false while signed out: a dig then never asks the server */
  get signedIn(): boolean {
    return !!this.account.user;
  }

  /** What you've dug up so far, newest first (the "found" collection). */
  async list(): Promise<{ item: string; rarity: string; at: number }[]> {
    const res = await this.account.fetch('/api/dig-finds');
    if (!res.ok) throw await errorOf(res, 'could not load your finds');
    return ((await res.json()) as { finds: { item: string; rarity: string; at: number }[] }).finds;
  }

  /** One roll for a finished dig stroke: `found` false is a normal miss. */
  async find(pathM: number, durationMs: number): Promise<DigFindResult> {
    const res = await this.account.fetch('/api/dig-finds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.account.editHeaders() },
      body: JSON.stringify({ pathM, durationMs }),
    });
    if (!res.ok) throw await errorOf(res, 'nothing buried here');
    return (await res.json()) as DigFindResult;
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

/** Can this build/platform offer Google sign-in? (Google blocks it inside app WebViews; Steam uses Steamworks.) */
export function googleSignInAvailable(): boolean {
  return ACCOUNTS_ENABLED && !!GOOGLE_CLIENT_ID && !isPackagedApp();
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

export interface PetDto {
  beachId: string;
  species: 'crab';
  name: string;
  variant: number;
  source: 'befriended' | 'shop';
  lastFedAt: number;
  fedCount: number;
  mood: 'happy' | 'peckish' | 'hungry' | 'sleepy';
}

export interface BondDto {
  species: string;
  feedCount: number;
  threshold: number;
  ready: boolean;
}

export interface PetFeederDto {
  name: string;
  at: number;
}

/** Animal food & resident pet API (POST /api/animals/feed, /api/pet*, /api/beaches/:code/pet*). */
export class AnimalsApi {
  constructor(private readonly account: Account) {}

  get signedIn(): boolean {
    return this.account.user !== null;
  }

  async feed(beachId?: string): Promise<{ ok: boolean; remaining: number; pet?: PetDto | null; bond?: BondDto }> {
    const res = await this.account.fetch('/api/animals/feed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(beachId ? { beachId } : {}),
    });
    if (!res.ok) throw await errorOf(res, 'no beach snacks left');
    return (await res.json()) as { ok: boolean; remaining: number; pet?: PetDto | null; bond?: BondDto };
  }

  async getPet(beachId?: string): Promise<{ pet: PetDto | null; bond: BondDto; recentFeeders: PetFeederDto[] }> {
    const q = beachId ? `?beach=${encodeURIComponent(beachId)}` : '';
    const res = await this.account.fetch(`/api/pet${q}`);
    if (!res.ok) throw await errorOf(res, 'could not load pet');
    return (await res.json()) as { pet: PetDto | null; bond: BondDto; recentFeeders: PetFeederDto[] };
  }

  async getBeachPet(code: string): Promise<{ pet: PetDto | null; recentFeeders: PetFeederDto[]; canFreeFeed?: boolean }> {
    const res = await this.account.fetch(`/api/beaches/${encodeURIComponent(code)}/pet`);
    if (!res.ok) throw await errorOf(res, 'could not load beach pet');
    return (await res.json()) as { pet: PetDto | null; recentFeeders: PetFeederDto[]; canFreeFeed?: boolean };
  }

  async feedVisitorPet(
    code: string,
    useFood = false,
  ): Promise<{ pet: PetDto; usedFood: boolean; remaining?: number; freeUsedToday: boolean }> {
    const res = await this.account.fetch(`/api/beaches/${encodeURIComponent(code)}/pet/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(useFood ? { useFood: true } : {}),
    });
    if (!res.ok) throw await errorOf(res, 'could not feed pet');
    return (await res.json()) as { pet: PetDto; usedFood: boolean; remaining?: number; freeUsedToday: boolean };
  }

  async adoptPet(opts: { mode: 'befriend' | 'shop'; name?: string; beachId?: string }): Promise<PetDto> {
    const res = await this.account.fetch('/api/pet/adopt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw await errorOf(res, 'could not adopt pet');
    const data = (await res.json()) as { pet: PetDto };
    return data.pet;
  }

  async renamePet(name: string, beachId?: string): Promise<PetDto> {
    const res = await this.account.fetch('/api/pet', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...(beachId ? { beachId } : {}) }),
    });
    if (!res.ok) throw await errorOf(res, 'could not rename pet');
    const data = (await res.json()) as { pet: PetDto };
    return data.pet;
  }
}

