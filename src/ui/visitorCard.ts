// The visitor card (docs/INBOX_NOTIFICATIONS.md): on someone else's beach,
// leave a rating (shells), a note (typed, or a quick one) and a gift from your
// bag, all in one go. Only owned, non-free things can be given. Labels and
// status only (CLAUDE.md): how it works is in the web guide.

import { GUIDE_URL, NOTE_MAX_CHARS } from '../config';
import type { InboxApi, VisitCard } from '../net/account';
import { icon, type IconName } from './hud';
import { aPrize } from './inboxText';

export interface VisitorHost {
  /** what you can give: owned, non-free, with how many */
  giftable(): { id: string; name: string; icon: IconName; count: number }[];
  /** the bag changed (a gift went) */
  gifted(): void;
  toast(text: string): void;
}

export class VisitorCard {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private code = '';
  private owner = '';
  private card: VisitCard | null = null;
  private shells: number | null = null;
  private note = '';
  private quick = false;
  private item: string | null = null;
  private status = '';
  private busy = false;

  constructor(
    parent: HTMLElement,
    private readonly api: InboxApi,
    private readonly host: VisitorHost,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'board visitor';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Leave something');
    this.root.innerHTML = `
      <div class="board-card">
        <button type="button" class="dlg-close" aria-label="Close">×</button>
        <h2></h2>
        <p class="board-blurb"><a class="guide-link" href="${GUIDE_URL}#visitors" target="_blank" rel="noopener">how it works</a></p>
        <div class="visitor-body"></div>
      </div>`;
    parent.appendChild(this.root);
    this.title = this.root.querySelector('h2')!;
    this.body = this.root.querySelector('.visitor-body')!;
    this.root.querySelector('.dlg-close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  /** Open the card for the beach with `code`, owned by `owner` (a first name). */
  async open(code: string, owner: string, beachName?: string): Promise<void> {
    this.code = code;
    this.owner = owner || 'Someone';
    this.card = null;
    this.shells = null;
    this.note = '';
    this.quick = false;
    this.item = null;
    this.status = 'loading…';
    this.title.textContent = beachName ? `${beachName}` : `${this.owner}’s beach`;
    this.root.classList.add('open');
    this.render();
    try {
      this.card = await this.api.card(code);
      this.shells = this.card.mine;
      this.status = '';
    } catch (e) {
      this.status = (e as Error).message;
    }
    this.render();
  }

  close(): void {
    this.root.classList.remove('open');
  }

  private render(): void {
    this.body.innerHTML = '';
    const c = this.card;
    if (!c) {
      this.body.appendChild(this.statusLine());
      return;
    }

    // rating: five shells
    const rate = document.createElement('div');
    rate.className = 'visitor-section';
    rate.innerHTML = `<h3>rating</h3>`;
    const row = document.createElement('div');
    row.className = 'visitor-shells';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', 'rating');
    for (let n = 1; n <= 5; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `visitor-shell${this.shells !== null && n <= this.shells ? ' on' : ''}`;
      b.dataset.shells = String(n);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(this.shells === n));
      b.setAttribute('aria-label', `${n} shell${n > 1 ? 's' : ''}`);
      b.innerHTML = icon('shell');
      b.addEventListener('click', () => {
        this.shells = this.shells === n ? null : n;
        this.render();
      });
      row.appendChild(b);
    }
    rate.appendChild(row);
    if (c.average !== null) {
      const avg = document.createElement('small');
      avg.className = 'visitor-avg';
      avg.textContent = `${c.average} · ${c.count}`;
      rate.appendChild(avg);
    }
    this.body.appendChild(rate);

    // a note: typed (not for brand-new accounts) or a quick one
    const noteBox = document.createElement('div');
    noteBox.className = 'visitor-section';
    noteBox.innerHTML = `<h3>note</h3>`;
    if (c.freeText) {
      const ta = document.createElement('textarea');
      ta.className = 'visitor-note';
      ta.maxLength = NOTE_MAX_CHARS;
      ta.rows = 2;
      ta.setAttribute('aria-label', 'note');
      ta.value = this.quick ? '' : this.note;
      const count = document.createElement('small');
      count.className = 'visitor-count';
      const sync = () => (count.textContent = `${[...ta.value].length}/${NOTE_MAX_CHARS}`);
      sync();
      ta.addEventListener('input', () => {
        this.note = ta.value;
        this.quick = false;
        noteBox.querySelectorAll('.visitor-quick button.on').forEach((b) => b.classList.remove('on'));
        sync();
      });
      noteBox.append(ta, count);
    }
    const chips = document.createElement('div');
    chips.className = 'visitor-quick';
    for (const q of c.quickNotes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `action${this.quick && this.note === q ? ' on' : ''}`;
      b.textContent = q;
      b.addEventListener('click', () => {
        const on = !(this.quick && this.note === q);
        this.quick = on;
        this.note = on ? q : '';
        this.render();
      });
      chips.appendChild(b);
    }
    noteBox.appendChild(chips);
    this.body.appendChild(noteBox);

    // a gift: owned, non-free things only
    const can = this.host.giftable();
    if (can.length) {
      const giftBox = document.createElement('div');
      giftBox.className = 'visitor-section';
      giftBox.innerHTML = `<h3>gift</h3>`;
      const list = document.createElement('div');
      list.className = 'visitor-gifts';
      for (const g of can) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `visitor-gift${this.item === g.id ? ' on' : ''}`;
        b.dataset.item = g.id;
        b.setAttribute('aria-pressed', String(this.item === g.id));
        b.innerHTML = `${icon(g.icon)}<span></span><small></small>`;
        b.querySelector('span')!.textContent = g.name;
        b.querySelector('small')!.textContent = `×${g.count}`;
        b.addEventListener('click', () => {
          this.item = this.item === g.id ? null : g.id;
          this.render();
        });
        list.appendChild(b);
      }
      giftBox.appendChild(list);
      this.body.appendChild(giftBox);
    }

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'action visitor-go';
    go.dataset.act = 'visitor-leave';
    go.textContent = 'leave it';
    const note = this.note.trim();
    const changedRating = this.shells !== null && this.shells !== c.mine;
    go.disabled = this.busy || (!changedRating && !note && !this.item);
    go.addEventListener('click', () => void this.send());
    this.body.append(go, this.statusLine());
  }

  private statusLine(): HTMLElement {
    const p = document.createElement('p');
    p.className = 'board-note visitor-status';
    p.textContent = this.status;
    return p;
  }

  private async send(): Promise<void> {
    const c = this.card;
    if (!c || this.busy) return;
    const note = this.note.trim();
    const what: { shells?: number; note?: string; quick?: boolean; item?: string } = {};
    if (this.shells !== null && this.shells !== c.mine) what.shells = this.shells;
    if (note) {
      what.note = note;
      if (this.quick) what.quick = true;
    }
    if (this.item) what.item = this.item;
    this.busy = true;
    this.status = '';
    this.render();
    try {
      const r = await this.api.leave(this.code, what);
      if (what.item) this.host.gifted();
      this.close();
      const parts = [what.item ? aPrize(what.item) : '', what.note ? 'a note' : '', what.shells ? `${what.shells} shell${what.shells > 1 ? 's' : ''}` : ''].filter(Boolean);
      this.host.toast(`Left ${this.owner} ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')}`);
      this.card = { ...c, ...r.rating, mine: what.shells ?? c.mine };
    } catch (e) {
      this.status = (e as Error).message;
    } finally {
      this.busy = false;
      if (this.isOpen) this.render();
    }
  }
}
