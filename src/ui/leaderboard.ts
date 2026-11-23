import type { Board, BoardEntry } from '../net/account';
import { beachById } from '../world/locations';

/** What the leaderboard needs from the app. */
export interface LeaderboardHost {
  signedIn(): boolean;
  /** open the sign-in (the settings sheet) */
  signIn(): void;
  load(board: Board): Promise<BoardEntry[]>;
  /** whether you've starred it, as the app knows now (stars elsewhere update the panel) */
  starred(code: string): boolean;
  star(entry: BoardEntry, on: boolean): Promise<void>;
  /** go and look at it (the panel closes first) */
  visit(entry: BoardEntry): Promise<void>;
}

const BLURB: Record<Board, string> = {
  all: 'The beaches with the most stars.',
  rising: 'Stars from the past week. The newest count most.',
};

/**
 * The leaderboard: the most-starred beaches, everyone's. Two tabs: all time
 * (stars now) and rising (star velocity, see BACKEND.md). Each row can be
 * visited and starred from here.
 */
export class Leaderboard {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLOListElement;
  private readonly note: HTMLParagraphElement;
  private readonly blurb: HTMLParagraphElement;
  private board: Board = 'all';
  private entries: BoardEntry[] = [];
  /** the last load (a slower earlier one can't overwrite it) */
  private gen = 0;

  constructor(
    parent: HTMLElement,
    private readonly host: LeaderboardHost,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'board';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Leaderboard');
    this.root.innerHTML = `
      <div class="board-card">
        <button type="button" class="board-close" aria-label="Close">×</button>
        <h2>Most-starred beaches</h2>
        <div class="board-tabs" role="tablist">
          <button type="button" role="tab" data-board="all">All time</button>
          <button type="button" role="tab" data-board="rising">Rising</button>
        </div>
        <p class="board-blurb"></p>
        <ol class="board-list"></ol>
        <p class="board-note"></p>
      </div>`;
    parent.appendChild(this.root);
    this.list = this.root.querySelector('.board-list')!;
    this.note = this.root.querySelector('.board-note')!;
    this.blurb = this.root.querySelector('.board-blurb')!;
    this.root.querySelector('.board-close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
    for (const t of this.root.querySelectorAll<HTMLButtonElement>('.board-tabs button'))
      t.addEventListener('click', () => this.show(t.dataset.board as Board));
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  open(board: Board = this.board): void {
    this.root.classList.add('open');
    void this.show(board);
  }

  close(): void {
    this.root.classList.remove('open');
  }

  /** Stars changed somewhere else in the app (a name tag, the shore bar). */
  refreshStars(): void {
    if (!this.isOpen) return;
    for (const e of this.entries) {
      const on = this.host.starred(e.code);
      if (on !== e.starred && !e.yours) {
        e.stars += on ? 1 : -1;
        e.starred = on;
      }
    }
    this.render();
  }

  async show(board: Board): Promise<void> {
    if (board !== this.board) this.entries = [];
    this.board = board;
    for (const t of this.root.querySelectorAll<HTMLButtonElement>('.board-tabs button')) {
      const on = t.dataset.board === board;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', String(on));
    }
    this.blurb.textContent = BLURB[board];
    if (!this.host.signedIn()) {
      this.entries = [];
      this.render();
      this.note.innerHTML = '';
      this.note.append('Sign in to see everyone’s favorite beaches. ');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'action board-signin';
      b.textContent = 'sign in';
      b.addEventListener('click', () => {
        this.close();
        this.host.signIn();
      });
      this.note.appendChild(b);
      return;
    }
    const gen = ++this.gen;
    if (!this.entries.length) this.note.textContent = 'Loading…';
    try {
      const entries = await this.host.load(board);
      if (gen !== this.gen) return;
      this.entries = entries;
      this.note.textContent = entries.length
        ? ''
        : board === 'rising'
          ? 'No new stars this week yet. Tap ☆ on a beach you like.'
          : 'No stars yet. Tap ☆ on a beach you like and it shows up here.';
    } catch (e) {
      if (gen !== this.gen) return;
      this.note.textContent = (e as Error).message;
    }
    this.render();
  }

  private render(): void {
    this.list.innerHTML = '';
    for (const e of this.entries) this.list.appendChild(this.row(e));
  }

  private row(e: BoardEntry): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'board-row';
    li.dataset.code = e.code;

    const rank = document.createElement('span');
    rank.className = `board-rank${e.rank <= 3 ? ` top r${e.rank}` : ''}`;
    rank.textContent = String(e.rank);

    const place = e.location ? beachById(e.location) : undefined;
    const who = document.createElement('div');
    who.className = 'board-who';
    const title = document.createElement('b');
    title.textContent = e.beachName || e.name || 'Someone';
    const sub = document.createElement('small');
    sub.textContent = [e.yours ? 'yours' : '', e.beachName ? `by ${e.name}` : '', place?.name ?? ''].filter(Boolean).join(' · ') || ' ';
    who.append(title, sub);

    const count = document.createElement('div');
    count.className = 'board-count';
    const big = document.createElement('span');
    const small = document.createElement('small');
    if (this.board === 'rising') {
      big.textContent = `▲ ${e.recent}`;
      big.className = 'up';
      small.textContent = `★ ${e.stars} in all`;
    } else {
      big.textContent = `★ ${e.stars}`;
      small.textContent = e.recent ? `▲ ${e.recent} this week` : '';
      small.className = 'up';
    }
    count.title = `${e.stars} star${e.stars === 1 ? '' : 's'}, ${e.recent} this week`;
    count.append(big, small);

    const star = document.createElement('button');
    star.type = 'button';
    star.className = `board-star${e.starred ? ' on' : ''}`;
    star.dataset.act = `board-star-${e.code}`;
    star.textContent = e.starred ? '★' : '☆';
    star.setAttribute('aria-pressed', String(e.starred));
    star.setAttribute('aria-label', `${e.starred ? 'Remove the star from' : 'Star'} ${title.textContent}`);
    star.hidden = e.yours;
    star.addEventListener('click', () => void this.toggle(e));

    const visit = document.createElement('button');
    visit.type = 'button';
    visit.className = 'action board-visit';
    visit.dataset.act = `board-visit-${e.code}`;
    visit.textContent = e.yours ? 'open' : 'visit';
    visit.setAttribute('aria-label', `${e.yours ? 'Open' : 'Visit'} ${title.textContent}`);
    visit.addEventListener('click', () => {
      this.close();
      void this.host.visit(e).catch((err) => {
        this.open();
        this.note.textContent = (err as Error).message;
      });
    });

    if (e.yours) li.classList.add('yours');
    li.append(rank, who, count, star, visit);
    return li;
  }

  private async toggle(e: BoardEntry): Promise<void> {
    const on = !e.starred;
    e.starred = on;
    e.stars += on ? 1 : -1;
    this.render();
    try {
      await this.host.star(e, on);
    } catch (err) {
      // the app put its stars back (refreshStars may already have followed)
      if (e.starred !== this.host.starred(e.code)) {
        e.starred = !on;
        e.stars += on ? -1 : 1;
      }
      this.render();
      this.note.textContent = (err as Error).message;
    }
  }
}
