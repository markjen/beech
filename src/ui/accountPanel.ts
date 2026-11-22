import { beachById } from '../world/locations';
import { DEV_AUTH, googleSignInAvailable, renderGoogleButton, type Account } from '../net/account';
import { nativeProviders, nativeSignIn, SignInCancelled, type NativeProvider } from '../net/nativeAuth';

const APPLE_LOGO = `<svg viewBox="0 0 814 1000" aria-hidden="true"><path fill="currentColor" d="M788 341c-6 4-108 62-108 190 0 148 130 200 134 202-1 3-21 72-69 142-43 62-88 124-156 124s-86-40-165-40c-77 0-104 41-166 41s-106-57-156-127C44 791 0 667 0 549c0-191 124-292 246-292 65 0 119 43 160 43 39 0 100-45 174-45 28 0 129 2 196 86zM554 159c31-37 53-88 53-139 0-7-1-14-2-20-50 2-110 34-146 76-28 32-55 83-55 135 0 8 1 16 2 18 3 1 9 1 14 1 45 0 102-30 134-71z"/></svg>`;
const G_LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>`;
import type { BeachSync, SyncState } from '../net/beachSync';
import type { Side } from '../net/account';
import type { NeighborView } from '../render/neighbors';

function ago(ts: number): string {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 90) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  return new Date(ts).toLocaleString();
}

/** Sign in / signed-in panel at the top of the settings sheet. */
export class AccountPanel {
  private error = '';
  private confirmDelete = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly account: Account,
    private readonly sync: BeachSync,
    private readonly onSignedIn: () => void,
    private readonly neighbors?: NeighborView,
    /** go to anyone's beach by code */
    private readonly onVisit?: (code: string) => Promise<void>,
  ) {
    account.onChange(() => this.render());
    neighbors?.onChange(() => this.render());
    neighbors?.onFavorites(() => this.render());
    sync.onState(() => this.renderStatus());
    window.setInterval(() => this.renderStatus(), 20000);
    this.render();
  }

  private renderStatus(): void {
    const st = this.el.querySelector('.status');
    if (!st) return;
    const s: SyncState = this.sync.state;
    st.textContent =
      s === 'saving'
        ? 'saving your beach…'
        : s === 'offline'
          ? 'offline: your beach will save when you reconnect'
          : this.sync.savedAt
            ? `beach saved ${ago(this.sync.savedAt)}`
            : 'your beach saves as you play';
  }

  render(): void {
    const u = this.account.user;
    this.el.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'account';
    if (u) {
      box.innerHTML = `
        <div class="who">signed in${u.name ? ` as <b></b>` : ''}</div>
        <div class="status"></div>
        <div class="buttons">
          <button type="button" class="action" data-act="signout">sign out</button>
          <button type="button" class="action" data-act="delete">delete account</button>
        </div>`;
      if (u.name) box.querySelector('b')!.textContent = u.name;
      if (this.neighbors) box.appendChild(this.neighborSection(this.neighbors));
      if (this.neighbors && this.onVisit) box.appendChild(this.visitSection(this.neighbors, this.onVisit));
      box.querySelector('[data-act="signout"]')!.addEventListener('click', () => void this.account.signOut());
      const del = box.querySelector<HTMLButtonElement>('[data-act="delete"]')!;
      del.addEventListener('click', async () => {
        // deleting is permanent, so it takes a second tap
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
      if (native.length) {
        /* the app's own sign-in sheets */
      } else if (googleSignInAvailable()) {
        const gis = document.createElement('div');
        gis.className = 'gis';
        buttons.appendChild(gis);
        renderGoogleButton(gis, (credential) => void this.signIn(() => this.account.signInWithGoogle(credential))).catch(() => {
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
        dev.addEventListener('click', () => void this.signIn(() => this.account.signInDev('tester')));
        buttons.appendChild(dev);
      }
      box.appendChild(buttons);
    }
    if (this.error) {
      const err = document.createElement('div');
      err.className = 'err';
      err.textContent = this.error;
      box.appendChild(err);
    }
    this.el.appendChild(box);
    this.renderStatus();
  }

  /** Your code to share, and who lives either side of you. */
  private neighborSection(nv: NeighborView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'neighbors';
    const n = nv.state;
    if (!n) {
      wrap.innerHTML = `<div class="status">neighbors are loading…</div>`;
      return wrap;
    }
    const share = document.createElement('div');
    share.className = 'slot';
    share.innerHTML = `<span>code</span><span class="code"></span>`;
    share.querySelector('.code')!.textContent = n.code;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'action';
    copy.textContent = 'copy';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(n.code);
        copy.textContent = 'copied';
      } catch {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(share.querySelector('.code')!);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    });
    const fresh = document.createElement('button');
    fresh.type = 'button';
    fresh.className = 'action';
    fresh.textContent = 'new code';
    fresh.title = 'Your old code stops working; current neighbors keep you';
    fresh.addEventListener('click', () => void this.guard(async () => {
      await nv.api.newCode();
      await nv.refresh();
    }));
    share.append(copy, fresh);
    wrap.appendChild(share);
    const help = document.createElement('div');
    help.className = 'status';
    help.textContent = 'neighbors are mutual: share your code, ask for a side, and they accept';
    wrap.appendChild(help);

    // people asking to move in next to you
    for (const r of n.requests) {
      const row = document.createElement('div');
      row.className = 'slot request';
      const label = document.createElement('span');
      label.className = 'fav-name';
      const place = r.location ? beachById(r.location) : undefined;
      label.textContent = `${r.name || 'someone'}${place ? ` · ${place.name}` : ''} wants to be on your ${r.side}`;
      const yes = document.createElement('button');
      yes.type = 'button';
      yes.className = 'action';
      yes.dataset.act = `accept-${r.code}`;
      yes.textContent = 'accept';
      const taken = !!n[r.side];
      yes.disabled = taken;
      if (taken) yes.title = `Move your ${r.side} neighbor away first`;
      yes.addEventListener('click', () => void this.guard(async () => {
        await nv.api.accept(r.code);
        await nv.refresh();
      }));
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'action';
      no.dataset.act = `decline-${r.code}`;
      no.textContent = 'no thanks';
      no.addEventListener('click', () => void this.guard(async () => {
        await nv.api.decline(r.code);
        await nv.refresh();
      }));
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
        remove.addEventListener('click', () => void this.guard(async () => {
          await nv.api.remove(side);
          await nv.refresh();
        }));
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
        const go = () => void this.guard(async () => {
          await nv.api.set(side, input.value);
          await nv.refresh();
        });
        add.addEventListener('click', go);
        input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
        row.append(input, add);
      }
      wrap.appendChild(row);
    }
    return wrap;
  }

  /** Visit any beach by its code, and the beaches you've starred. */
  private visitSection(nv: NeighborView, visit: (code: string) => Promise<void>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'neighbors visit';
    const row = document.createElement('div');
    row.className = 'slot';
    row.innerHTML = `<span>visit</span>`;
    const input = document.createElement('input');
    input.id = 'visit-code';
    input.placeholder = 'a beach code';
    input.maxLength = 8;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Code of a beach to visit');
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'action';
    go.dataset.act = 'visit';
    go.textContent = 'go';
    const doGo = () => void this.guard(() => visit(input.value));
    go.addEventListener('click', doGo);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && doGo());
    row.append(input, go);
    wrap.appendChild(row);

    const favs = [...nv.favorites.values()];
    const h = document.createElement('div');
    h.className = 'status';
    h.textContent = favs.length ? 'favorite beaches' : 'tap ☆ on a beach to keep it here';
    wrap.appendChild(h);
    for (const f of favs) {
      const r = document.createElement('div');
      r.className = 'slot fav-row';
      const place = f.location ? beachById(f.location) : undefined;
      const name = document.createElement('span');
      name.className = 'fav-name';
      name.textContent = `${f.name || 'a beach'}${place ? ` · ${place.name}` : ''}`;
      const v = document.createElement('button');
      v.type = 'button';
      v.className = 'action';
      v.dataset.act = `visit-${f.code}`;
      v.textContent = 'visit';
      v.addEventListener('click', () => void this.guard(() => visit(f.code)));
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'action';
      x.textContent = '★';
      x.title = 'Remove from favorites';
      x.setAttribute('aria-label', `Remove ${name.textContent} from favorites`);
      x.addEventListener('click', () => void this.guard(() => nv.toggleFavorite(f)));
      r.append(name, v, x);
      wrap.appendChild(r);
    }
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
      void this.signIn(async () => {
        const who = await nativeSignIn(p);
        return p === 'apple' ? this.account.signInWithApple(who.idToken, who.name) : this.account.signInWithGoogle(who.idToken);
      }),
    );
    return b;
  }

  private async signIn(fn: () => Promise<unknown>): Promise<void> {
    this.error = '';
    try {
      await fn();
      this.onSignedIn();
    } catch (e) {
      if (e instanceof SignInCancelled) return;
      this.error = (e as Error).message;
      this.render();
    }
  }
}
