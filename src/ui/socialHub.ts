import type { ShoreBeach } from '../net/account';
import { beachById } from '../world/locations';
import { sortBeachesWestToEast } from './beachMap';

/**
 * Everything social sits behind the Inbox button at the top of the rail:
 * one modal with four tabs — Inbox, Leaderboard, Starred (the beaches you
 * starred) and Visit by code. Each tab is its own dialog; the hub puts the
 * same tab strip at the top of each and swaps between them in place.
 */
export type HubTab = 'inbox' | 'leaderboard' | 'starred' | 'visit';

export interface HubDialog {
  /** the dialog root (a .board with a .board-card inside) */
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  open(): void | Promise<void>;
  close(): void;
}

const LABELS: Record<HubTab, string> = {
  inbox: 'Inbox',
  leaderboard: 'Leaderboard',
  starred: 'Starred',
  visit: 'Visit by code',
};
const ORDER: HubTab[] = ['inbox', 'leaderboard', 'starred', 'visit'];

export class SocialHub {
  private readonly dialogs = new Map<HubTab, HubDialog>();

  constructor(
    /** tabs that need an account: tapping one signed out signs in instead */
    private readonly gate: { signedIn: () => boolean; signIn: () => void; needsAccount: HubTab[] },
  ) {}

  add(tab: HubTab, d: HubDialog): void {
    this.dialogs.set(tab, d);
    d.el.classList.add('hub-dialog');
    for (const t of this.dialogs.keys()) this.strip(t);
  }

  get isOpen(): boolean {
    return [...this.dialogs.values()].some((d) => d.isOpen);
  }

  /** which tab is showing, if any */
  get current(): HubTab | null {
    for (const [t, d] of this.dialogs) if (d.isOpen) return t;
    return null;
  }

  show(tab: HubTab): void {
    if (this.gate.needsAccount.includes(tab) && !this.gate.signedIn()) {
      this.closeAll();
      this.gate.signIn();
      return;
    }
    const d = this.dialogs.get(tab);
    if (!d) return;
    const cur = this.current;
    if (cur === tab) return;
    if (cur) {
      // swap in place: no fade between tabs
      const old = this.dialogs.get(cur)!;
      old.el.classList.add('instant');
      d.el.classList.add('instant');
      old.close();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          old.el.classList.remove('instant');
          d.el.classList.remove('instant');
        }),
      );
    }
    void d.open();
    d.el.querySelector<HTMLButtonElement>(`.hub-tabs [data-hub="${tab}"]`)?.focus({ preventScroll: true });
  }

  closeAll(): void {
    for (const d of this.dialogs.values()) if (d.isOpen) d.close();
  }

  /** (Re)build the tab strip at the top of one dialog's card. */
  private strip(tab: HubTab): void {
    const d = this.dialogs.get(tab)!;
    const card = d.el.querySelector<HTMLElement>('.board-card');
    if (!card) return;
    card.classList.add('hub-card');
    card.querySelector('.hub-tabs')?.remove();
    const s = document.createElement('div');
    s.className = 'hub-tabs';
    s.setAttribute('role', 'tablist');
    s.setAttribute('aria-label', 'Social');
    for (const t of ORDER) {
      if (!this.dialogs.has(t)) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.hub = t;
      b.textContent = LABELS[t];
      const on = t === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
      b.addEventListener('click', () => this.show(t));
      s.appendChild(b);
    }
    card.prepend(s);
  }
}

/** A plain hub dialog: a .board with a card, a close button, a body. */
abstract class SimpleDialog implements HubDialog {
  readonly el: HTMLDivElement;
  protected readonly body: HTMLDivElement;

  constructor(parent: HTMLElement, label: string) {
    this.el = document.createElement('div');
    this.el.className = 'board';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', label);
    this.el.innerHTML = `<div class="board-card"><button type="button" class="dlg-close" aria-label="Close">×</button><div class="hub-body"></div></div>`;
    parent.appendChild(this.el);
    this.body = this.el.querySelector('.hub-body')!;
    this.el.querySelector('.dlg-close')!.addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  open(): void {
    this.render();
    this.el.classList.add('open');
  }

  close(): void {
    this.el.classList.remove('open');
  }

  protected abstract render(): void;
}

export type StarredBeach = ShoreBeach;

/** Starred: the beaches you've starred, each with a Visit jump. */
export class StarredDialog extends SimpleDialog {
  constructor(
    parent: HTMLElement,
    private readonly host: {
      list: () => StarredBeach[];
      visit: (code: string) => Promise<void>;
      unstar: (b: StarredBeach) => Promise<void>;
    },
  ) {
    super(parent, 'Starred beaches');
  }

  /** the stars changed somewhere else (a name tag, the leaderboard) */
  refresh(): void {
    if (this.isOpen) this.render();
  }

  protected render(): void {
    this.body.innerHTML = '';
    const favs = sortBeachesWestToEast(this.host.list());
    const list = document.createElement('ol');
    list.className = 'board-list hub-list';
    if (!favs.length) {
      const p = document.createElement('p');
      p.className = 'board-note';
      p.textContent = 'No starred beaches yet';
      this.body.appendChild(p);
      return;
    }
    for (const f of favs) {
      const li = document.createElement('li');
      li.className = 'board-row fav-row';
      const place = f.location ? beachById(f.location) : undefined;
      const who = document.createElement('span');
      who.className = 'board-who';
      const b = document.createElement('b');
      b.textContent = f.beachName || `${f.name || 'Someone'}’s beach`;
      const small = document.createElement('small');
      small.textContent = [f.beachName ? f.name : '', place?.name].filter(Boolean).join(' · ');
      who.append(b, small);
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'board-star on';
      star.textContent = '★';
      star.title = 'Remove the star';
      star.setAttribute('aria-label', `Remove the star from ${b.textContent}`);
      star.addEventListener('click', () => void this.host.unstar(f).then(() => this.render()).catch(() => {}));
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'action board-visit';
      go.dataset.act = `visit-${f.code}`;
      go.textContent = 'visit';
      go.addEventListener('click', () => {
        this.close();
        void this.host.visit(f.code).catch(() => {});
      });
      li.append(who, star, go);
      list.appendChild(li);
    }
    this.body.appendChild(list);
  }
}

/** Visit by code: type a code, land on that beach. Your own code is here to share. */
export class VisitDialog extends SimpleDialog {
  private error = '';

  constructor(
    parent: HTMLElement,
    private readonly host: {
      visit: (code: string) => Promise<void>;
      myCode: () => string | null;
      share: () => void;
    },
  ) {
    super(parent, 'Visit by code');
  }

  protected render(): void {
    this.body.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'hub-visit';
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
    go.textContent = 'visit';
    const status = document.createElement('p');
    status.className = 'board-note';
    status.setAttribute('role', 'status');
    status.textContent = this.error;
    const doGo = async () => {
      const code = input.value.trim();
      if (!code) return;
      go.disabled = true;
      try {
        await this.host.visit(code);
        this.error = '';
        this.close();
      } catch (e) {
        this.error = (e as Error).message || 'No beach has that code';
        status.textContent = this.error;
      } finally {
        go.disabled = false;
      }
    };
    go.addEventListener('click', () => void doGo());
    input.addEventListener('keydown', (e) => e.key === 'Enter' && void doGo());
    row.append(input, go);
    this.body.appendChild(row);
    this.body.appendChild(status);

    const mine = this.host.myCode();
    if (mine) {
      const own = document.createElement('div');
      own.className = 'hub-own';
      const label = document.createElement('span');
      label.textContent = 'your code';
      const code = document.createElement('b');
      code.className = 'hub-code';
      code.textContent = mine;
      const share = document.createElement('button');
      share.type = 'button';
      share.className = 'action';
      share.dataset.act = 'share';
      share.textContent = 'share';
      share.addEventListener('click', () => this.host.share());
      own.append(label, code, share);
      this.body.appendChild(own);
    }
    window.setTimeout(() => input.focus({ preventScroll: true }), 50);
  }
}
