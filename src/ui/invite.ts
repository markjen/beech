// The invite panel (docs/INVITES_GUIDE.md): your invite link, the gifts it
// earns (the ladder), and the friends who joined through it.

import type { Referrals } from '../net/account';
import { inviteText, inviteUrl } from '../net/share';
import { prizeName } from '../world/items';

export interface InviteHost {
  signedIn(): boolean;
  signIn(): void;
  /** your first name, for the share text */
  name(): string;
  load(): Promise<Referrals>;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const lower = (id: string) => (id === 'beach' ? 'an extra beach' : `${/^[aeiou]/i.test(prizeName(id)) ? 'an' : 'a'} ${prizeName(id).toLowerCase()}`);

/** The ladder in a few lines: runs of the same reward are folded ("6th–10th: a starfish each"). */
export function ladderLines(ladder: { rank: number; item: string }[]): { from: number; to: number; item: string }[] {
  const out: { from: number; to: number; item: string }[] = [];
  for (const r of ladder) {
    const last = out[out.length - 1];
    if (last && last.item === r.item && last.to === r.rank - 1) last.to = r.rank;
    else out.push({ from: r.rank, to: r.rank, item: r.item });
  }
  return out;
}

export class InvitePanel {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private data: Referrals | null = null;
  private error = '';
  private gen = 0;

  constructor(
    parent: HTMLElement,
    private readonly host: InviteHost,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'board invite';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Invite friends');
    this.root.innerHTML = `
      <div class="board-card">
        <button type="button" class="dlg-close" aria-label="Close">×</button>
        <h2>Invite friends</h2>
        <div class="invite-body"></div>
      </div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.invite-body')!;
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

  async open(): Promise<void> {
    this.root.classList.add('open');
    this.render();
    if (!this.host.signedIn()) return;
    const gen = ++this.gen;
    try {
      const d = await this.host.load();
      if (gen !== this.gen) return;
      this.data = d;
      this.error = '';
    } catch (e) {
      if (gen !== this.gen) return;
      this.error = (e as Error).message;
    }
    this.render();
  }

  close(): void {
    this.root.classList.remove('open');
  }

  private render(): void {
    this.body.innerHTML = '';
    if (!this.host.signedIn()) {
      const p = document.createElement('p');
      p.className = 'board-note';
      p.append('Sign in to get your own invite link. ');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'action board-signin';
      b.textContent = 'sign in';
      b.addEventListener('click', () => {
        this.close();
        this.host.signIn();
      });
      p.appendChild(b);
      this.body.appendChild(p);
      return;
    }
    const d = this.data;
    if (!d) {
      const p = document.createElement('p');
      p.className = 'board-note';
      p.textContent = this.error || 'Loading…';
      this.body.appendChild(p);
      return;
    }

    const blurb = document.createElement('p');
    blurb.className = 'board-blurb invite-blurb';
    blurb.textContent = `A friend who joins through your link gets ${lower(d.welcomeGift)} at once. When they’ve settled in (${d.settleSteps} steps of the beach guide), you get the next gift below.`;
    this.body.appendChild(blurb);

    // the link, to share or copy
    const url = inviteUrl(location.origin, location.pathname, d.code);
    const linkRow = document.createElement('div');
    linkRow.className = 'invite-link';
    const field = document.createElement('input');
    field.type = 'text';
    field.readOnly = true;
    field.value = url;
    field.setAttribute('aria-label', 'Your invite link');
    field.addEventListener('focus', () => field.select());
    const share = document.createElement('button');
    share.type = 'button';
    share.className = 'action invite-share';
    share.dataset.act = 'invite-share';
    share.textContent = 'share';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'action';
    copy.dataset.act = 'invite-copy';
    copy.textContent = 'copy';
    const flash = (b: HTMLButtonElement, text: string, back: string) => {
      b.textContent = text;
      window.setTimeout(() => (b.textContent = back), 2500);
    };
    const copyIt = async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        field.select();
        document.execCommand('copy');
      }
      flash(copy, 'copied', 'copy');
    };
    copy.addEventListener('click', () => void copyIt());
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      share.addEventListener('click', async () => {
        try {
          await nav.share!({ title: 'beech', text: inviteText(this.host.name()), url });
        } catch {
          /* cancelled */
        }
      });
      linkRow.append(field, share, copy);
    } else {
      linkRow.append(field, copy);
    }
    this.body.appendChild(linkRow);

    // the ladder
    const h = document.createElement('h3');
    h.className = 'invite-h';
    h.textContent = 'Your gifts';
    this.body.appendChild(h);
    const ol = document.createElement('ol');
    ol.className = 'board-list invite-ladder';
    for (const line of ladderLines(d.ladder)) {
      const li = document.createElement('li');
      const reached = d.settled >= line.to;
      const next = !reached && d.settled + 1 >= line.from && d.settled + 1 <= line.to;
      li.className = `board-row invite-rung${reached ? ' done' : ''}${next ? ' next' : ''}`;
      const mark = document.createElement('span');
      mark.className = 'guide-mark';
      mark.textContent = reached ? '✓' : String(line.from);
      const who = document.createElement('div');
      who.className = 'board-who';
      const b = document.createElement('b');
      const s = lower(line.item);
      b.textContent = s.charAt(0).toUpperCase() + s.slice(1) + (line.from !== line.to ? ' each' : '');
      const small = document.createElement('small');
      small.textContent = line.from === line.to ? `your ${ordinal(line.from)} friend` : `your ${ordinal(line.from)} to ${ordinal(line.to)} friends`;
      who.append(b, small);
      li.append(mark, who);
      ol.appendChild(li);
    }
    this.body.appendChild(ol);

    // who joined
    const fh = document.createElement('h3');
    fh.className = 'invite-h';
    fh.textContent = d.joined ? `Friends (${d.settled} of ${d.joined} settled in)` : 'Friends';
    this.body.appendChild(fh);
    const friends = document.createElement('ul');
    friends.className = 'invite-friends';
    if (!d.friends.length) {
      const li = document.createElement('li');
      li.className = 'invite-empty';
      li.textContent = 'Nobody yet. Send your link to someone who’d like a quiet beach.';
      friends.appendChild(li);
    }
    for (const f of d.friends) {
      const li = document.createElement('li');
      const n = document.createElement('b');
      n.textContent = f.name;
      const st = document.createElement('small');
      st.textContent = f.settled ? `settled in ✓${f.reward ? ` · you got ${lower(f.reward)}` : ''}` : 'joined · settling in';
      li.append(n, st);
      friends.appendChild(li);
    }
    this.body.appendChild(friends);
    if (d.settled >= d.cap) {
      const cap = document.createElement('p');
      cap.className = 'board-note';
      cap.textContent = `You’ve earned every invite gift. Friends still count, and they still get their welcome gift.`;
      this.body.appendChild(cap);
    }
  }
}
