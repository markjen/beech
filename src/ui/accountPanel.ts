import { DEV_AUTH, googleSignInAvailable, renderGoogleButton, type Account } from '../net/account';
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
  ) {
    account.onChange(() => this.render());
    neighbors?.onChange(() => this.render());
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
      if (googleSignInAvailable()) {
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
    help.textContent = 'share your code so friends can put your beach next to theirs';
    wrap.appendChild(help);

    for (const side of ['left', 'right'] as Side[]) {
      const row = document.createElement('div');
      row.className = 'slot';
      row.innerHTML = `<span>${side}</span>`;
      const who = n[side];
      if (who) {
        const label = document.createElement('span');
        label.textContent = who.name || 'a neighbor';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'action';
        remove.dataset.act = `remove-${side}`;
        remove.textContent = 'move away';
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
        add.textContent = 'move in';
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
    if (n.pickedBy > 0) {
      const p = document.createElement('div');
      p.className = 'status';
      p.textContent = n.pickedBy === 1 ? '1 beach has you next door' : `${n.pickedBy} beaches have you next door`;
      wrap.appendChild(p);
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

  private async signIn(fn: () => Promise<unknown>): Promise<void> {
    this.error = '';
    try {
      await fn();
      this.onSignedIn();
    } catch (e) {
      this.error = (e as Error).message;
      this.render();
    }
  }
}
