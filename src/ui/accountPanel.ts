import { beachById } from '../world/locations';
import { shoreRowOrder } from '../render/shoreSpacing';
import { MAX_OBJECTS } from '../sim/sandCodec';
import { renderBeachMap, sortBeachesWestToEast } from './beachMap';
import { buildOwnStretches, connectableBeaches, hasSparePierWithoutSite, ownBeachLabel } from './shoreConnect';
import { DEV_AUTH, googleSignInAvailable, renderGoogleButton, type Account, type MyBeach, type Neighbors, type Side } from '../net/account';
import { beachShareText, shareUrl, shoreBeachUrl } from '../net/share';
import { DISCORD_INVITE_URL } from '../../server/src/community';
import { copyText, shareLink } from './shareSheet';
import { isSteam, steamBridge } from '../platform/runtime';
import { appInfo, formatAppVersion, syncAppInfo } from '../platform/version';
import { unlockSteamAchievement } from '../platform/steamFeatures';
import { nativeProviders, nativeSignIn, SignInCancelled, type NativeProvider } from '../net/nativeAuth';
import {
  formatSignInDiagnostics,
  signInDiagnosticsOf,
  type SignInDiagnostics,
} from '../net/signinDiagnostics';
import { reportError, reportEvent } from '../net/telemetry';
import type { BeachSync, SyncState } from '../net/beachSync';
import type { NeighborView } from '../render/neighbors';
import type { CheckpointsSection } from './checkpoints';

const APPLE_LOGO = `<svg viewBox="0 0 814 1000" aria-hidden="true"><path fill="currentColor" d="M788 341c-6 4-108 62-108 190 0 148 130 200 134 202-1 3-21 72-69 142-43 62-88 124-156 124s-86-40-165-40c-77 0-104 41-166 41s-106-57-156-127C44 791 0 667 0 549c0-191 124-292 246-292 65 0 119 43 160 43 39 0 100-45 174-45 28 0 129 2 196 86zM554 159c31-37 53-88 53-139 0-7-1-14-2-20-50 2-110 34-146 76-28 32-55 83-55 135 0 8 1 16 2 18 3 1 9 1 14 1 45 0 102-30 134-71z"/></svg>`;
const G_LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>`;

function ago(ts: number): string {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 90) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  return new Date(ts).toLocaleString();
}

export interface AccountPanelSlots {
  beach: HTMLElement;
  checkpoints: HTMLElement;
  shore: HTMLElement;
  account: HTMLElement;
}

export interface MineCallbacks {
  /** Go to one of your beaches (pans if it's on the shore in view, else lays the shore out around it). */
  open: (id: string) => Promise<void>;
  /** The beach of yours in front of you now (the one the waves run on), if any. */
  inView: () => string | null;
  /** Stop simulating this beach and remove it. */
  remove: (id: string) => Promise<void>;
  /** Real-world location id for newly created beaches. */
  location: () => string;
  changed: () => void;
  shop?: () => void;
  /** Copy this beach onto another of yours, or a new one (docs/COPY_BEACH.md). */
  duplicate?: (beach: MyBeach) => void;
  /** Fired whenever the beach selected *for settings* changes. */
  onSelect?: (beach: MyBeach | undefined) => void;
  /** Fired when auth state transitions so the sheet can switch to Account/Beach tab. */
  onAuthChange?: (signedIn: boolean) => void;
  /** Piers (docs/PIERS.md): buy one for sand bucks (resolves once it's in the bag). */
  buyPier?: () => Promise<void>;
  /** Show the pier on this beach with "place pier" and "cancel". */
  previewPier?: (beach: MyBeach) => void;
}

/** Account, beach settings, shore connections, and checkpoints rendered across the settings sheet's tabs. */
export class AccountPanel {
  private error = '';
  /** diagnostics of the last failed native sign-in, for the on-screen readout (null otherwise) */
  private signInDiagnostics: SignInDiagnostics | null = null;
  private confirmDelete = 0;
  /** The beach currently selected *in settings* (independent of which beach you're editing in 3D). */
  private selectedId: string | null = null;
  /** Cached neighbor state for `selectedId` when it isn't the shore's own (`NeighborView.state`). */
  private selectedNeighbors = new Map<string, Neighbors | null>();
  private loadingNeighborsFor = new Set<string>();
  private lastSignedIn: boolean | null = null;
  /** opens the invite panel (set by main once it exists) */
  invite?: () => void;
  /** said above the sign-in buttons instead of "sign in to keep your beach" (an invite) */
  signInNote = '';

  constructor(
    private readonly slots: AccountPanelSlots,
    private readonly account: Account,
    private readonly sync: BeachSync,
    private readonly onSignedIn: () => void,
    private readonly neighbors?: NeighborView,
    /** go to anyone's beach by code */
    private readonly onVisit?: (code: string) => Promise<void>,
    private readonly mine?: MineCallbacks,
    private readonly checkpoints?: CheckpointsSection,
  ) {
    account.onBeaches(() => {
      this.syncSelection();
      this.render();
    });
    account.onChange((u) => {
      const signedIn = !!u;
      if (!signedIn) {
        this.selectedId = null;
        this.selectedNeighbors.clear();
      } else {
        this.syncSelection();
      }
      if (this.lastSignedIn !== signedIn) {
        this.lastSignedIn = signedIn;
        this.mine?.onAuthChange?.(signedIn);
      }
      this.render();
    });
    neighbors?.onChange(() => this.render());
    neighbors?.onFavorites(() => this.render());
    sync.onState(() => this.renderStatus());
    window.setInterval(() => this.renderStatus(), 20000);
    this.lastSignedIn = !!account.user;
    this.mine?.onAuthChange?.(this.lastSignedIn);
    this.render();
  }

  /** The beach currently selected for settings (falls back to the one in view, then home). */
  get selectedBeach(): MyBeach | undefined {
    const a = this.account;
    if (this.selectedId) {
      const found = a.beaches.find((b) => b.id === this.selectedId);
      if (found) return found;
    }
    return a.mine(this.mine?.inView()) ?? a.home ?? undefined;
  }

  /** Select a beach in settings without switching the 3D scene. */
  selectBeach(id: string): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.mine?.onSelect?.(this.selectedBeach);
    if (this.neighbors && id !== this.shoreStateId) {
      void this.loadNeighborsFor(id);
    }
    this.render();
  }

  /** the beach whose neighbor slots the shore view already holds (the anchor if yours, else home) */
  private get shoreStateId(): string | undefined {
    return this.neighbors?.stateBeachId ?? this.account.home?.id;
  }

  private syncSelection(): void {
    const a = this.account;
    if (!this.selectedId || !a.beaches.some((b) => b.id === this.selectedId)) {
      this.selectedId = a.mine(this.mine?.inView())?.id ?? a.home?.id ?? null;
    }
    this.mine?.onSelect?.(this.selectedBeach);
  }

  private async loadNeighborsFor(beachId: string): Promise<void> {
    const user = this.account.user?.id;
    if (!this.neighbors || !user || this.loadingNeighborsFor.has(beachId)) return;
    this.loadingNeighborsFor.add(beachId);
    try {
      const state = await this.neighbors.api.get(beachId).catch(() => null);
      if (this.account.user?.id === user) this.selectedNeighbors.set(beachId, state);
    } finally {
      this.loadingNeighborsFor.delete(beachId);
      this.render();
    }
  }

  private neighborsFor(beachId: string): Neighbors | null {
    if (!this.neighbors) return null;
    if (beachId === this.shoreStateId) return this.neighbors.state;
    if (!this.selectedNeighbors.has(beachId)) void this.loadNeighborsFor(beachId);
    return this.selectedNeighbors.get(beachId) ?? null;
  }

  private renderStatus(): void {
    const st = this.slots.account.querySelector('.sync-status');
    if (!st) return;
    const s: SyncState = this.sync.state;
    const pending = this.sync.pending;
    st.textContent =
      s === 'saving' || pending
        ? 'saving your beach…'
        : s === 'offline'
          ? 'offline: your beach will save when you reconnect'
          : s === 'outdated'
            ? 'a new version is ready: reload to keep saving'
            : s === 'fenced'
              ? 'view-only: another tab or device is editing this beach'
              : s === 'tooBig'
                ? 'too big to save: smooth some of the sand to save again'
                : this.sync.dropped
                  ? `saved, but ${this.sync.dropped} of your things didn't fit (${MAX_OBJECTS} at most)`
                  : this.sync.savedAt
                    ? `beach saved ${ago(this.sync.savedAt)}`
                    : 'your beach saves as you play';
  }

  render(): void {
    this.renderBeachTab();
    this.renderShoreTab();
    this.renderAccountTab();
    this.renderStatus();
  }

  private errorBanner(): HTMLElement | null {
    if (!this.error) return null;
    const err = document.createElement('div');
    err.className = 'err';
    err.textContent = this.error;
    return err;
  }

  // ---------------------------------------------------------------- Beach tab

  private renderBeachTab(): void {
    const u = this.account.user;
    this.slots.beach.innerHTML = '';
    this.slots.checkpoints.innerHTML = '';
    if (!u || !this.mine) return;

    const a = this.account;
    const mine = this.mine;
    const sel = this.selectedBeach;
    const ordered = sortBeachesWestToEast(a.beaches);

    const wrap = document.createElement('div');
    wrap.className = 'settings-section beaches';
    const err = this.errorBanner();
    if (err) wrap.appendChild(err);

    // Beach selector bar (when you have multiple beaches, or can make one)
    const bar = document.createElement('div');
    bar.className = 'beach-picker';
    for (const b of ordered) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `beach-pill${sel && b.id === sel.id ? ' on' : ''}`;
      pill.dataset.act = `select-beach-${b.id}`;
      pill.textContent = `${b.home ? '⌂ ' : ''}${ownBeachLabel(b)}`;
      pill.addEventListener('click', () => this.selectBeach(b.id));
      bar.appendChild(pill);
    }
    if (a.beaches.length < a.allowance) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'beach-pill add';
      add.dataset.act = 'new-beach';
      add.textContent = '+ new beach';
      add.addEventListener('click', () =>
        void this.guard(async () => {
          const name = window.prompt('Name your new beach', '') ?? '';
          const b = await a.createBeach(name.trim(), mine.location());
          if (a.beaches.length >= 5) unlockSteamAchievement('FIVE_BEACHES');
          this.selectedId = b.id;
          await mine.open(b.id);
          mine.changed();
        }),
      );
      bar.appendChild(add);
    } else if (mine.shop) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'beach-pill add';
      more.dataset.act = 'shop-beaches';
      more.textContent = '+ get beach';
      more.addEventListener('click', () => mine.shop!());
      bar.appendChild(more);
    }
    wrap.appendChild(bar);
    const extraBeachesInUse = a.extraBeachesInUse;
    if (a.allowance > 1 || extraBeachesInUse > 0) {
      const usage = document.createElement('div');
      usage.className = 'status';
      usage.textContent = `${extraBeachesInUse} of ${a.allowance - 1} extra beach slots in use`;
      wrap.appendChild(usage);
    }

    // World map (clicking a pin selects that beach in settings)
    if (ordered.length > 0) {
      wrap.appendChild(renderBeachMap(ordered, sel?.id ?? mine.inView(), (id) => this.selectBeach(id)));
    }

    // Selected beach details & actions
    if (sel) {
      const card = document.createElement('div');
      card.className = 'beach-card';
      const head = document.createElement('div');
      head.className = 'beach-card-head';
      const place = sel.location ? beachById(sel.location) : undefined;
      const title = document.createElement('div');
      title.className = 'beach-card-title';
      title.textContent = `${ownBeachLabel(sel)}${place ? ` · ${place.name}` : ''}`;
      head.appendChild(title);

      const act = (label: string, key: string, fn: () => Promise<void>, titleText = '') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'action';
        b.dataset.act = key;
        b.textContent = label;
        if (titleText) b.title = titleText;
        b.addEventListener('click', () =>
          void this.guard(async () => {
            await fn();
            mine.changed();
          }),
        );
        return b;
      };

      const acts = document.createElement('div');
      acts.className = 'slot beach-card-acts';
      if (sel.id !== mine.inView() || this.neighbors?.visiting) {
        acts.appendChild(act('go there', `open-${sel.id}`, () => mine.open(sel.id), 'Jump to this beach'));
      }
      if (a.beaches.length > 1) {
        acts.appendChild(
          act('rename', `rename-${sel.id}`, async () => {
            const name = window.prompt('Name this beach', sel.name);
            if (name !== null) await a.updateBeach(sel.id, { name });
          }),
        );
        if (!sel.home) acts.appendChild(act('make home', `home-${sel.id}`, () => a.updateBeach(sel.id, { home: true })));
      }
      if (this.checkpoints && sel.updatedAt) {
        const cps = this.checkpoints;
        acts.appendChild(act('checkpoint', `checkpoint-${sel.id}`, () => cps.saveOf(sel.id), 'Save a checkpoint of this beach'));
      }
      if (mine.duplicate && sel.updatedAt) {
        const dup = mine.duplicate;
        acts.appendChild(act('duplicate', `duplicate-${sel.id}`, async () => dup(sel), 'Copy this beach'));
      }
      if (!sel.home) {
        acts.appendChild(
          act('remove', `remove-beach-${sel.id}`, async () => {
            if (!window.confirm(`Remove ${sel.name || 'this beach'}? Its sand, placed things and neighbor links will be lost. This frees an extra beach slot.`)) return;
            const homeId = a.beaches.find((x) => x.home)!.id;
            await mine.remove(sel.id);
            this.selectedId = homeId;
          }),
        );
      }
      card.append(head, acts);

      // Code & share row for the selected beach
      card.appendChild(this.codeShareBlock(sel));
      wrap.appendChild(card);
    }

    this.slots.beach.appendChild(wrap);
    if (this.checkpoints) this.slots.checkpoints.appendChild(this.checkpoints.element());
  }

  /** Code, copy, share, game link, new code, and beechshore links for a beach. */
  private codeShareBlock(beach: MyBeach): HTMLElement {
    const block = document.createElement('div');
    block.className = 'neighbors code-block';
    const share = document.createElement('div');
    share.className = 'slot';
    share.innerHTML = `<span>code</span><span class="code"></span>`;
    share.querySelector('.code')!.textContent = beach.code;

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'action';
    copy.textContent = 'copy';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(beach.code);
        copy.textContent = 'copied';
      } catch {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(share.querySelector('.code')!);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    });

    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'action';
    link.textContent = 'share';
    link.title = 'Send a link to your beach';
    link.addEventListener('click', async () => {
      const r = await shareLink({
        url: shoreBeachUrl(beach.code),
        title: beach.name || `${this.account.user?.name ?? 'My'} beach`,
        text: beachShareText(this.account.user?.name, beach.name, true),
      });
      if (r === 'copied' || r === 'failed') {
        link.textContent = r === 'copied' ? 'link copied' : 'try again';
        window.setTimeout(() => (link.textContent = 'share'), 2500);
      }
    });

    const gameLink = document.createElement('button');
    gameLink.type = 'button';
    gameLink.className = 'action';
    gameLink.textContent = 'game link';
    gameLink.title = 'Copy the link that opens your beach in the game';
    gameLink.addEventListener('click', async () => {
      const ok = await copyText(shareUrl(location.origin, location.pathname, beach.code));
      gameLink.textContent = ok ? 'copied' : 'try again';
      window.setTimeout(() => (gameLink.textContent = 'game link'), 2500);
    });

    const fresh = document.createElement('button');
    fresh.type = 'button';
    fresh.className = 'action';
    fresh.textContent = 'new code';
    fresh.addEventListener('click', () =>
      void this.guard(async () => {
        if (!this.neighbors) return;
        await this.neighbors.api.newCode(beach.id);
        await this.account.loadBeaches();
        this.selectedNeighbors.delete(beach.id);
        await this.neighbors.refresh();
      }),
    );

    share.append(copy, link, gameLink, fresh);
    block.appendChild(share);

    if (beach.onShore !== false) {
      const links = document.createElement('div');
      links.className = 'shore-links';
      const view = document.createElement('a');
      view.className = 'shore-link';
      view.href = shoreBeachUrl(beach.code);
      view.target = '_blank';
      view.rel = 'noopener';
      view.textContent = 'see it on beechshore ↗';
      const snap = document.createElement('a');
      snap.className = 'shore-link';
      snap.href = `${shoreBeachUrl(beach.code)}#share`;
      snap.target = '_blank';
      snap.rel = 'noopener';
      snap.textContent = 'share snapshot ↗';
      links.append(view, snap);
      block.appendChild(links);
    }
    if (this.invite) {
      const invite = document.createElement('button');
      invite.type = 'button';
      invite.className = 'action invite-open';
      invite.textContent = 'invite friends';
      invite.addEventListener('click', () => this.invite?.());
      block.appendChild(invite);
    }
    return block;
  }

  // ---------------------------------------------------------------- Shore tab

  private renderShoreTab(): void {
    this.slots.shore.innerHTML = '';
    if (!this.neighbors) return;

    const wrap = document.createElement('div');
    wrap.className = 'settings-section shore-tab';
    const err = this.errorBanner();
    if (err) wrap.appendChild(err);

    if (!this.account.user) {
      if (this.onVisit) wrap.appendChild(this.publicShoreSection(this.neighbors, this.onVisit));
      this.slots.shore.appendChild(wrap);
      return;
    }

    // 1. Visual one-click connector for your own beaches (no code copying or flipping!)
    if (this.account.beaches.length > 1) {
      wrap.appendChild(this.connectBeachesSection(this.neighbors));
    }

    // 2. Neighbors of the selected beach (requests, left/right slots)
    const sel = this.selectedBeach;
    if (sel) {
      wrap.appendChild(this.neighborSection(this.neighbors, sel));
    }

    // (visiting by code and the starred beaches live in the Inbox now)

    this.slots.shore.appendChild(wrap);
  }

  /** Visual strip of your own beaches grouped by connected stretch, with 1-click connect & disconnect. */
  private connectBeachesSection(nv: NeighborView): HTMLElement {
    const a = this.account;
    const sel = this.selectedBeach;
    const wrap = document.createElement('div');
    wrap.className = 'neighbors shore-connect';

    const h = document.createElement('div');
    h.className = 'status';
    h.textContent = 'your beaches on the shore';
    wrap.appendChild(h);

    const stretches = buildOwnStretches(a.beaches);

    const makeConnectPicker = (beach: MyBeach, side: Side): HTMLElement | null => {
      const candidates = connectableBeaches(a.beaches, beach.id, side);
      if (!candidates.length) return null;
      const select = document.createElement('select');
      select.className = 'connect-select';
      select.dataset.connectBeach = beach.id;
      select.dataset.connectSide = side;
      select.setAttribute('aria-label', `Connect a beach to the ${side} of ${ownBeachLabel(beach)}`);
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = side === 'left' ? '+ left' : '+ right';
      select.appendChild(ph);
      for (const c of candidates) {
        const opt = document.createElement('option');
        opt.value = c.code;
        opt.textContent = ownBeachLabel(c);
        select.appendChild(opt);
      }
      select.addEventListener('change', () => {
        const code = select.value;
        if (!code) return;
        select.disabled = true;
        void this.guard(async () => {
          await nv.api.set(side, code, beach.id);
          await a.loadBeaches();
          this.selectedNeighbors.clear();
          await nv.refresh();
          this.mine?.changed();
        });
      });
      return select;
    };

    for (const chain of stretches) {
      const row = document.createElement('div');
      row.className = 'stretch-chain';

      const leftPicker = makeConnectPicker(chain[0], 'left');
      if (leftPicker) row.appendChild(leftPicker);

      chain.forEach((b, idx) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `stretch-chip${sel && b.id === sel.id ? ' on' : ''}`;
        chip.textContent = ownBeachLabel(b);
        chip.addEventListener('click', () => this.selectBeach(b.id));
        row.appendChild(chip);

        if (idx < chain.length - 1) {
          const next = chain[idx + 1];
          const unlink = document.createElement('button');
          unlink.type = 'button';
          unlink.className = 'stretch-unlink';
          unlink.dataset.act = `unlink-${b.id}-right`;
          unlink.textContent = '×';
          unlink.title = `Disconnect ${ownBeachLabel(b)} and ${ownBeachLabel(next)}`;
          unlink.setAttribute('aria-label', unlink.title);
          unlink.addEventListener('click', () =>
            void this.guard(async () => {
              await nv.api.remove('right', b.id);
              await a.loadBeaches();
              this.selectedNeighbors.clear();
              await nv.refresh();
              this.mine?.changed();
            }),
          );
          row.appendChild(unlink);
        }
      });

      const rightPicker = makeConnectPicker(chain[chain.length - 1], 'right');
      if (rightPicker) row.appendChild(rightPicker);

      wrap.appendChild(row);
    }

    for (const chain of stretches) for (const b of chain) {
      const row = this.pierRow(b);
      if (row) wrap.appendChild(row);
    }

    // A pier in the bag with no site yet: show it, and what unlocks one.
    // (The shop sells the pier without that check, so without this the
    // bought pier is invisible — docs/PIERS.md.)
    if (hasSparePierWithoutSite(a.beaches, a.piers)) {
      const spare = a.piers.owned - a.piers.placed;
      const row = document.createElement('div');
      row.className = 'slot pier-row';
      row.dataset.pierBag = 'true';
      const label = document.createElement('span');
      label.className = 'fav-name';
      label.textContent = spare > 1 ? `${spare} piers · in your bag` : 'pier · in your bag';
      row.appendChild(label);
      const hint = document.createElement('span');
      hint.className = 'status';
      hint.textContent = 'link three of your beaches side by side to place it on the middle one';
      row.appendChild(hint);
      wrap.appendChild(row);
    }

    return wrap;
  }

  /** A pier site, or a beach holding a pier: buy, place, or remove it (docs/PIERS.md). */
  private pierRow(b: MyBeach): HTMLElement | null {
    const a = this.account;
    if (!b.pier && !b.pierSite) return null;
    const row = document.createElement('div');
    row.className = 'slot pier-row';
    row.dataset.pierBeach = b.id;
    const label = document.createElement('span');
    label.className = 'fav-name';
    label.textContent = `${b.pier === 'paused' ? 'pier paused' : 'pier'} · ${ownBeachLabel(b)}`;
    row.appendChild(label);
    const button = (text: string, act: string, fn: () => Promise<void>) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action';
      btn.dataset.act = act;
      btn.textContent = text;
      btn.addEventListener('click', () => {
        btn.disabled = true;
        void this.guard(fn).finally(() => (btn.disabled = false));
      });
      row.appendChild(btn);
    };
    if (b.pier) {
      button('remove pier', 'pier-remove', async () => {
        await a.removePier(b.id);
        this.mine?.changed();
      });
    } else if (a.piers.owned > a.piers.placed) {
      if (this.mine?.previewPier) button('place pier', 'pier-place', async () => this.mine?.previewPier?.(b));
    } else if (this.mine?.buyPier) {
      button('buy pier · 30 sand bucks', 'pier-buy', async () => {
        await this.mine!.buyPier!();
        await a.loadBeaches();
        this.mine?.previewPier?.(b);
      });
    }
    return row;
  }

  /** Neighbors of the selected beach: requests and left/right slots. */
  private neighborSection(nv: NeighborView, beach: MyBeach): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'neighbors neighbor-section';

    if (this.account.beaches.length > 1) {
      const head = document.createElement('div');
      head.className = 'beach-picker compact';
      const lbl = document.createElement('span');
      lbl.className = 'status';
      lbl.textContent = 'neighbors of';
      head.appendChild(lbl);
      for (const b of sortBeachesWestToEast(this.account.beaches)) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = `beach-pill${b.id === beach.id ? ' on' : ''}`;
        pill.textContent = ownBeachLabel(b);
        pill.addEventListener('click', () => this.selectBeach(b.id));
        head.appendChild(pill);
      }
      wrap.appendChild(head);
    } else {
      const h = document.createElement('div');
      h.className = 'status';
      h.textContent = 'neighbors';
      wrap.appendChild(h);
    }

    const n = this.neighborsFor(beach.id);
    if (!n) {
      const loading = document.createElement('div');
      loading.className = 'status';
      if (this.selectedNeighbors.get(beach.id) === null && !this.loadingNeighborsFor.has(beach.id)) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'action';
        retry.textContent = 'retry loading neighbors';
        retry.addEventListener('click', () => void this.loadNeighborsFor(beach.id));
        loading.appendChild(retry);
      } else {
        loading.textContent = 'neighbors are loading…';
      }
      wrap.appendChild(loading);
      return wrap;
    }

    const reloadAll = async () => {
      await this.account.loadBeaches();
      this.selectedNeighbors.delete(beach.id);
      await nv.refresh();
      if (beach.id !== this.shoreStateId) await this.loadNeighborsFor(beach.id);
    };

    // people asking to move in next to this beach
    for (const r of n.requests) {
      const row = document.createElement('div');
      row.className = 'slot request';
      const label = document.createElement('span');
      label.className = 'fav-name';
      const place = r.location ? beachById(r.location) : undefined;
      label.textContent = `${r.name || 'someone'}${place ? ` · ${place.name}` : ''} → ${r.side}`;
      const yes = document.createElement('button');
      yes.type = 'button';
      yes.className = 'action';
      yes.dataset.act = `accept-${r.code}`;
      yes.textContent = 'accept';
      const taken = !!n[r.side];
      yes.disabled = taken;
      if (taken) yes.title = `Move your ${r.side} neighbor away first`;
      yes.addEventListener('click', () =>
        void this.guard(async () => {
          await nv.api.accept(r.code, beach.id);
          unlockSteamAchievement('FIRST_NEIGHBOR');
          await reloadAll();
        }),
      );
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'action';
      no.dataset.act = `decline-${r.code}`;
      no.textContent = 'no thanks';
      no.addEventListener('click', () =>
        void this.guard(async () => {
          await nv.api.decline(r.code, beach.id);
          await reloadAll();
        }),
      );
      row.append(label, yes, no);
      wrap.appendChild(row);
    }

    for (const side of ['left', 'right'] as Side[]) {
      const row = document.createElement('div');
      row.className = 'slot';
      row.innerHTML = `<span>${side}</span>`;
      const who = n[side];
      const asked = n.asked[side];
      if (who || asked) {
        const label = document.createElement('span');
        label.className = 'fav-name';
        label.textContent = who ? who.name || 'a neighbor' : `waiting for ${asked!.name || 'them'}…`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'action';
        remove.dataset.act = `remove-${side}`;
        remove.textContent = who ? 'move away' : 'take back';
        remove.addEventListener('click', () =>
          void this.guard(async () => {
            await nv.api.remove(side, beach.id);
            await reloadAll();
          }),
        );
        row.append(label, remove);
      } else {
        const input = document.createElement('input');
        input.id = `neighbor-${side}`;
        input.placeholder = 'their code';
        input.maxLength = 8;
        input.autocomplete = 'off';
        input.setAttribute('aria-label', `${side} neighbor's code`);
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'action';
        add.dataset.act = `add-${side}`;
        add.textContent = 'ask';
        const go = () =>
          void this.guard(async () => {
            await nv.api.set(side, input.value, beach.id);
            await reloadAll();
          });
        add.addEventListener('click', go);
        input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
        row.append(input, add);
      }
      wrap.appendChild(row);
    }
    return wrap;
  }

  // ---------------------------------------------------------------- Account tab

  private renderAccountTab(): void {
    const u = this.account.user;
    this.slots.account.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'account';
    if (u) {
      box.innerHTML = `
        <div class="who">signed in${u.name ? ` as <b></b>` : ''}</div>
        <div class="status sync-status"></div>
        <div class="buttons">
          <button type="button" class="action" data-act="signout">sign out</button>
          <button type="button" class="action" data-act="delete">delete account</button>
        </div>`;
      if (u.name) box.querySelector('b')!.textContent = u.name;
      box.appendChild(this.linkSection());
      box.querySelector('[data-act="signout"]')!.addEventListener('click', () => void this.account.signOut());
      const del = box.querySelector<HTMLButtonElement>('[data-act="delete"]')!;
      del.addEventListener('click', async () => {
        if (performance.now() - this.confirmDelete > 5000) {
          this.confirmDelete = performance.now();
          del.textContent = 'tap again to delete your account and beach';
          window.setTimeout(() => (del.textContent = 'delete account'), 5000);
          return;
        }
        try {
          await this.account.deleteAccount();
        } catch (e) {
          this.error = (e as Error).message;
          this.render();
        }
      });
    } else {
      box.innerHTML = `<div class="who">sign in to keep your beach</div>`;
      const buttons = document.createElement('div');
      buttons.className = 'buttons';
      const native = nativeProviders();
      for (const p of native) buttons.appendChild(this.nativeButton(p));
      if (isSteam()) {
        const steamBtn = document.createElement('button');
        steamBtn.type = 'button';
        steamBtn.className = 'action';
        steamBtn.dataset.act = 'steam';
        steamBtn.textContent = 'sign in with Steam';
        steamBtn.addEventListener('click', () => {
          const steam = steamBridge();
          if (!steam) {
            this.error = 'Steam is not running';
            this.render();
            return;
          }
          void this.signIn(async () => {
            const t = await steam.getAuthTicket();
            return this.account.signInWithSteam(t.ticketHex, t.personaName);
          }, 'steam');
        });
        buttons.appendChild(steamBtn);
      } else if (native.length) {
        /* native sign-in sheets */
      } else if (googleSignInAvailable()) {
        const gis = document.createElement('div');
        gis.className = 'gis';
        buttons.appendChild(gis);
        renderGoogleButton(gis, (credential) => void this.signIn(() => this.account.signInWithGoogle(credential), 'web_google')).catch((e) => {
          reportError('auth', e, { source: 'web_google:gis_load' });
          this.error = 'Google sign-in could not load. Check your connection.';
          this.render();
        });
      } else if (!DEV_AUTH) {
        const note = document.createElement('div');
        note.className = 'status';
        note.textContent = 'sign-in is coming to the app soon';
        box.appendChild(note);
      }
      if (DEV_AUTH) {
        const dev = document.createElement('button');
        dev.type = 'button';
        dev.className = 'action';
        dev.dataset.act = 'dev';
        dev.textContent = 'dev sign in';
        dev.addEventListener('click', () => void this.signIn(() => this.account.signInDev('tester'), 'dev'));
        buttons.appendChild(dev);
      }
      box.appendChild(buttons);
    }
    const err = this.errorBanner();
    if (err) box.appendChild(err);
    const diag = this.signInDiagnosticsBlock();
    if (diag) box.appendChild(diag);

    const community = document.createElement('div');
    community.className = 'status';
    const discord = document.createElement('a');
    discord.href = DISCORD_INVITE_URL;
    discord.target = '_blank';
    discord.rel = 'noopener';
    discord.textContent = 'Join our Discord — feedback, bug reports and ideas ↗';
    const steam = steamBridge();
    if (steam) {
      discord.addEventListener('click', (e) => {
        e.preventDefault();
        steam.openExternal(DISCORD_INVITE_URL);
      });
    }
    community.appendChild(discord);
    box.appendChild(community);

    const ver = document.createElement('div');
    ver.className = 'status';
    ver.textContent = formatAppVersion(syncAppInfo());
    box.appendChild(ver);
    void appInfo().then((info) => {
      if (ver.isConnected) ver.textContent = formatAppVersion(info);
    });
    this.slots.account.appendChild(box);
  }

  private publicShoreSection(nv: NeighborView, visit: (code: string) => Promise<void>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'neighbors visit';
    const { left, right } = nv.extent;
    const h = document.createElement('div');
    h.className = 'status';
    if (!left && !right) {
      h.textContent = 'beaches along the shore are loading…';
      wrap.appendChild(h);
      return wrap;
    }
    h.textContent = 'beaches along the shore';
    wrap.appendChild(h);
    for (const index of shoreRowOrder(left, right)) {
      const b = nv.beachAt(index);
      if (!b) continue;
      const r = document.createElement('div');
      r.className = 'slot shore-row';
      const place = b.location ? beachById(b.location) : undefined;
      const name = document.createElement('span');
      name.className = 'fav-name';
      name.textContent = `${b.name || 'a neighbor'}${place ? ` · ${place.name}` : ''}`;
      const side = document.createElement('span');
      side.textContent = index > 0 ? 'left' : 'right';
      const v = document.createElement('button');
      v.type = 'button';
      v.className = 'action';
      v.dataset.act = `visit-${b.code}`;
      v.textContent = 'visit';
      v.addEventListener('click', () => void this.guard(() => visit(b.code)));
      r.append(side, name, v);
      wrap.appendChild(r);
    }
    return wrap;
  }

  private linkSection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'neighbors';
    wrap.innerHTML = `
      <div class="code-row">
        <span>link device</span>
        <button type="button" class="action" data-act="link-gen">get code</button>
      </div>
      <form class="slot link-form">
        <input type="text" maxlength="9" placeholder="XXXX-XXXX" autocomplete="off" spellcheck="false" aria-label="Link code"/>
        <button type="submit" class="action">link</button>
      </form>`;
    const gen = wrap.querySelector<HTMLButtonElement>('[data-act="link-gen"]')!;
    gen.addEventListener('click', () =>
      void this.guard(async () => {
        const { code } = await this.account.createLinkCode();
        gen.textContent = code;
        void copyText(code);
      }),
    );
    const form = wrap.querySelector<HTMLFormElement>('.link-form')!;
    const input = form.querySelector<HTMLInputElement>('input')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = input.value.trim();
      if (!code) return;
      void this.signIn(async () => {
        await this.account.redeemLinkCode(code);
        await this.account.loadBeaches();
      }, 'link_code');
    });
    return wrap;
  }

  private async guard(fn: () => Promise<void>): Promise<void> {
    this.error = '';
    try {
      await fn();
    } catch (e) {
      this.error = (e as Error).message;
      this.render();
    }
  }

  /** "Sign in with Apple" (Apple's black button style) or "Continue with Google". */
  private nativeButton(p: NativeProvider): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `native-signin ${p}`;
    b.dataset.act = `native-${p}`;
    b.innerHTML = p === 'apple' ? `${APPLE_LOGO}<span>Sign in with Apple</span>` : `${G_LOGO}<span>Continue with Google</span>`;
    b.addEventListener('click', () =>
      void this.signIn(
        async () => {
          const who = await nativeSignIn(p);
          return p === 'apple' ? this.account.signInWithApple(who.idToken, who.name) : this.account.signInWithGoogle(who.idToken);
        },
        `native_${p}`,
      ),
    );
    return b;
  }

  /**
   * The last failed native sign-in, as a copyable readout: provider, error
   * code, app version/build, app id, client id, and the installed APK's
   * signing fingerprints. Only ever shown with a sign-in failure, never
   * as a permanent banner.
   */
  private signInDiagnosticsBlock(): HTMLElement | null {
    const d = this.signInDiagnostics;
    if (!d) return null;
    const wrap = document.createElement('div');
    wrap.className = 'diag';
    const pre = document.createElement('pre');
    pre.textContent = formatSignInDiagnostics(d);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'action';
    copy.dataset.act = 'copy-diag';
    copy.textContent = 'copy diagnostics';
    copy.addEventListener('click', () => {
      void copyText(formatSignInDiagnostics(d)).then((ok) => {
        copy.textContent = ok ? 'copied' : 'copy failed';
        window.setTimeout(() => {
          copy.textContent = 'copy diagnostics';
        }, 2000);
      });
    });
    wrap.append(pre, copy);
    return wrap;
  }

  private async signIn(fn: () => Promise<unknown>, method: string): Promise<void> {
    this.error = '';
    this.signInDiagnostics = null;
    try {
      await fn();
      reportEvent('auth_success', { method });
      this.onSignedIn();
    } catch (e) {
      if (e instanceof SignInCancelled) {
        reportEvent('auth_cancel', { method });
        return;
      }
      reportError('auth', e, { source: `accountPanel:${method}`, meta: { method } });
      this.error = (e as Error).message;
      this.signInDiagnostics = signInDiagnosticsOf(e);
      this.render();
    }
  }
}
