// The inbox (docs/INBOX_NOTIFICATIONS.md): a mailbox button with an unread
// badge (top right) and a list of everything that happened to you, newest
// first, with the actions in place: accept or decline a neighbor, say
// thanks, report a note, block someone, visit them. Labels and status only
// (CLAUDE.md): how it works is in the web guide.

import { GUIDE_URL } from '../config';
import type { InboxApi, InboxEntry, InboxSummary } from '../net/account';
import { icon, type IconName } from './hud';
import { ago, describeEntry } from './inboxText';

export interface InboxHost {
  signedIn(): boolean;
  signIn(): void;
  /** go and look at someone's beach (the panel closes first) */
  visit(code: string): void;
  /** neighbors changed (an accept from here) */
  neighborsChanged(): void;
  toast(text: string): void;
}

export class InboxPanel {
  readonly button: HTMLButtonElement;
  private readonly badge: HTMLSpanElement;
  private readonly root: HTMLDivElement;
  /** the dialog root (for the social hub's tab strip) */
  get el(): HTMLDivElement {
    return this.root;
  }
  private readonly list: HTMLOListElement;
  private readonly foot: HTMLDivElement;
  private entries: InboxEntry[] = [];
  private more = false;
  private error = '';
  private loading = false;
  private unread = 0;
  private blocked: { name: string; code: string | null }[] | null = null;
  /** first tap on "block" asks again; the second blocks */
  private confirmBlock = '';
  private readonly hud: HTMLElement;

  constructor(
    parent: HTMLElement,
    hudRoot: HTMLElement,
    makeButton: (name: IconName, label: string) => HTMLButtonElement,
    private readonly api: InboxApi,
    private readonly host: InboxHost,
  ) {
    // the rail's top button: whoever holds the panel adds it to the rail and
    // decides what a tap opens (the social hub)
    this.button = makeButton('inbox', 'Inbox');
    this.button.classList.add('inbox-btn', 'hud-tool');
    this.button.dataset.act = 'inbox';
    this.badge = document.createElement('span');
    this.badge.className = 'inbox-badge';
    this.button.appendChild(this.badge);
    this.hud = hudRoot;

    this.root = document.createElement('div');
    this.root.className = 'board inbox';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Inbox');
    this.root.innerHTML = `
      <div class="board-card">
        <button type="button" class="dlg-close" aria-label="Close">×</button>
        <h2>Inbox</h2>
        <p class="board-blurb"><a class="guide-link" href="${GUIDE_URL}#visitors" target="_blank" rel="noopener">how it works</a></p>
        <ol class="board-list inbox-list"></ol>
        <div class="inbox-foot"></div>
      </div>`;
    parent.appendChild(this.root);
    this.list = this.root.querySelector('.inbox-list')!;
    this.foot = this.root.querySelector('.inbox-foot')!;
    this.root.querySelector('.dlg-close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
    this.setSummary(null);
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  /** The unread count from the poll (null: signed out). */
  setSummary(s: InboxSummary | null): void {
    this.unread = s?.unread ?? 0;
    this.badge.textContent = this.unread > 99 ? '99+' : String(this.unread);
    this.badge.hidden = this.unread === 0;
    this.button.setAttribute('aria-label', this.unread ? `Inbox, ${this.unread} new` : 'Inbox');
    this.button.classList.toggle('shown', !!s);
    // the shore bar makes room for the mailbox
    this.hud.classList.toggle('inbox-shown', !!s);
  }

  async open(): Promise<void> {
    this.root.classList.add('open');
    this.entries = [];
    this.blocked = null;
    await this.load();
  }

  close(): void {
    this.root.classList.remove('open');
  }

  private async load(before?: number): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.error = '';
    this.render();
    try {
      const r = await this.api.list(before);
      this.entries = before ? [...this.entries, ...r.entries] : r.entries;
      this.more = r.entries.length >= 30;
      // what's shown has been seen (still drawn as new this once)
      const top = this.entries[0]?.id;
      if (top && r.unread) this.setSummary(await this.api.read(top));
      else this.setSummary(r);
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    this.list.innerHTML = '';
    if (!this.entries.length) {
      const li = document.createElement('li');
      li.className = 'board-note inbox-empty';
      li.textContent = this.error || (this.loading ? 'loading…' : 'nothing yet');
      this.list.appendChild(li);
    }
    for (const e of this.entries) this.list.appendChild(this.row(e));
    this.foot.innerHTML = '';
    if (this.more) this.foot.appendChild(this.action('more', 'inbox-more', () => void this.load(this.entries[this.entries.length - 1]?.id)));
    this.foot.appendChild(this.blockedSection());
  }

  private row(e: InboxEntry): HTMLLIElement {
    const li = document.createElement('li');
    li.className = `board-row inbox-row${e.read ? '' : ' unread'}`;
    li.dataset.id = String(e.id);
    li.dataset.kind = e.kind;
    const mark = document.createElement('span');
    mark.className = 'inbox-icon';
    mark.innerHTML = icon(KIND_ICON[e.kind] ?? 'mail');
    const body = document.createElement('div');
    body.className = 'board-who inbox-body';
    const { title, detail } = describeEntry(e);
    const b = document.createElement('b');
    b.textContent = title;
    body.appendChild(b);
    for (const d of detail) {
      const p = document.createElement('small');
      p.className = d.startsWith('“') ? 'inbox-note' : '';
      p.textContent = d;
      body.appendChild(p);
    }
    const when = document.createElement('small');
    when.className = 'inbox-when';
    when.textContent = ago(e.at);
    body.appendChild(when);
    const acts = document.createElement('div');
    acts.className = 'inbox-acts';
    const from = e.from?.code ?? null;
    if (e.kind === 'neighbor_request' && e.payload.code) {
      const code = e.payload.code;
      acts.append(
        this.action('accept', `accept-${e.id}`, async (btn) => {
          await this.api.accept(code, e.payload.beach);
          btn.textContent = 'accepted';
          this.host.neighborsChanged();
        }),
        this.action('decline', `decline-${e.id}`, async (btn) => {
          await this.api.decline(code, e.payload.beach);
          btn.textContent = 'declined';
          this.host.neighborsChanged();
        }),
      );
    }
    if ((e.kind === 'visit' || e.kind === 'gift') && from) {
      acts.appendChild(
        this.action('say thanks', `thanks-${e.id}`, async (btn) => {
          await this.api.leave(from, { note: e.item ? 'Thanks for the gift!' : 'Thank you!', quick: true });
          btn.textContent = 'thanked';
          btn.disabled = true;
        }),
      );
    }
    if (from && e.kind !== 'neighbor_linked') acts.appendChild(this.action('visit', `visit-${e.id}`, () => {
      this.close();
      this.host.visit(from);
    }));
    if (e.note && !e.note.removed) {
      const noteId = e.note.id;
      acts.appendChild(
        this.action('report', `report-${e.id}`, async (btn) => {
          await this.api.report(noteId);
          btn.textContent = 'reported';
          btn.disabled = true;
        }),
      );
    }
    if (from && e.kind !== 'star' && e.kind !== 'rating') {
      acts.appendChild(
        this.action(this.confirmBlock === `${e.id}` ? 'block them?' : 'block', `block-${e.id}`, async () => {
          if (this.confirmBlock !== `${e.id}`) {
            this.confirmBlock = `${e.id}`;
            this.render();
            return;
          }
          this.confirmBlock = '';
          await this.api.block(from, true);
          this.entries = this.entries.filter((x) => x.from?.code !== from);
          this.blocked = null;
          this.host.toast(`Blocked ${e.from?.name ?? ''}`.trim());
          this.render();
        }),
      );
    }
    li.append(mark, body);
    if (acts.childElementCount) body.appendChild(acts);
    return li;
  }

  private blockedSection(): HTMLElement {
    const box = document.createElement('details');
    box.className = 'inbox-blocked';
    const sum = document.createElement('summary');
    sum.textContent = 'blocked';
    box.appendChild(sum);
    box.addEventListener('toggle', () => {
      if (box.open && !this.blocked) {
        void this.api
          .blocks()
          .then((b) => {
            this.blocked = b;
            this.fillBlocked(box);
          })
          .catch(() => {});
      }
    });
    if (this.blocked) this.fillBlocked(box);
    return box;
  }

  private fillBlocked(box: HTMLElement): void {
    box.querySelectorAll('.inbox-blocked-row, .inbox-blocked-none').forEach((n) => n.remove());
    if (!this.blocked?.length) {
      const p = document.createElement('p');
      p.className = 'inbox-blocked-none';
      p.textContent = 'nobody';
      box.appendChild(p);
      return;
    }
    for (const who of this.blocked) {
      const row = document.createElement('div');
      row.className = 'inbox-blocked-row';
      const n = document.createElement('span');
      n.textContent = who.name;
      row.appendChild(n);
      if (who.code) {
        const code = who.code;
        row.appendChild(
          this.action('unblock', `unblock-${code}`, async () => {
            await this.api.block(code, false);
            this.blocked = (this.blocked ?? []).filter((x) => x.code !== code);
            await this.load();
          }),
        );
      }
      box.appendChild(row);
    }
  }

  /** a small action button; a failure shows on the button */
  private action(label: string, act: string, fn: (btn: HTMLButtonElement) => unknown): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'action inbox-act';
    btn.dataset.act = act;
    btn.textContent = label;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await fn(btn);
        if (btn.textContent === label) btn.disabled = false;
      } catch (err) {
        btn.textContent = (err as Error).message || 'try again';
        btn.disabled = false;
      }
    });
    return btn;
  }
}

const KIND_ICON: Partial<Record<InboxEntry['kind'], IconName>> = {
  visit: 'shell',
  gift: 'gift',
  neighbor_request: 'beach',
  neighbor_linked: 'beach',
  star: 'starfish',
  rating: 'shell',
  invite_joined: 'gift',
  invite_settled: 'gift',
};
