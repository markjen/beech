import { DEV_AUTH, googleSignInAvailable, renderGoogleButton, type Account } from '../net/account';
import type { BeachSync, SyncState } from '../net/beachSync';

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
  ) {
    account.onChange(() => this.render());
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
      box.querySelector('[data-act="signout"]')!.addEventListener('click', () => void this.account.signOut());
      const del = box.querySelector<HTMLButtonElement>('[data-act="delete"]')!;
      del.addEventListener('click', async () => {
        // deleting is permanent, so it takes a second tap
        if (performance.now() - this.confirmDelete > 3000) {
          this.confirmDelete = performance.now();
          del.textContent = 'tap again to delete your account and beach';
          window.setTimeout(() => (del.textContent = 'delete account'), 3000);
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
