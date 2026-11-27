// The beach guide (docs/INVITES_GUIDE.md): a checklist that teaches the game
// one mechanic at a time, a coach card that shows the next step, and a
// button with your progress. The steps themselves are in src/world/guide.ts.
//
// Where progress lives:
// - signed out (and always in the sandbox build): this device, in
//   localStorage (`local`);
// - signed in: the server (`server`), which also gives each step's gift.
//   Steps done while signed out are sent after signing in, so they still
//   earn their gifts, then forgotten locally.

import type { GuideStepResult } from '../net/account';
import { guideStepById, guideSteps, nextStep, progress, type GuideStep, type GuideStepId } from '../world/guide';
import { prizeName } from '../world/items';
import { GUIDE_URL } from '../config';
import { icon, type IconName } from './hud';

export interface GuideHost {
  /** the build has accounts (false: the sandbox, local steps only) */
  accounts: boolean;
  signedIn(): boolean;
  signIn(): void;
  /** the server's list of done steps */
  load(): Promise<string[]>;
  /** tell the server a step is done (throws when it can't see it yet) */
  complete(step: GuideStepId): Promise<GuideStepResult>;
  openInvite(): void;
  /** a short note over the beach */
  toast(text: string): void;
  /** the bag changed (a gift arrived) */
  gifted(): void;
}

/** the steps the server checks for itself: only marked done when it says so */
const SERVER_CHECKED = new Set<GuideStepId>(['claw', 'vending', 'star', 'checkpoint', 'invite']);
const KEY = 'beech-guide';

interface Stored {
  /** steps done on this device while signed out */
  local: string[];
  /** the coach card is hidden (the button stays) */
  hidden: boolean;
}

function load(): Stored {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Stored>;
    return { local: Array.isArray(s.local) ? s.local.filter((x) => typeof x === 'string') : [], hidden: !!s.hidden };
  } catch {
    return { local: [], hidden: false };
  }
}

function save(s: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: progress lasts for this visit */
  }
}

/** "Dug in! A conch is in your bag." */
const DONE_LINE: Record<GuideStepId, string> = {
  dig: 'Dug in!',
  pile: 'A mound!',
  undo: 'Taken back.',
  place: 'Set down.',
  chair: 'Nice view.',
  clear: 'Cleared away.',
  calm: 'All calm.',
  claw: 'Claw machine played.',
  vending: 'Vending machine tried.',
  visit: 'You went visiting.',
  star: 'Starred.',
  checkpoint: 'Checkpoint saved.',
  invite: 'A friend joined!',
};

const article = (name: string) => (/^[aeiou]/i.test(name) ? 'An' : 'A');

export class BeachGuide {
  readonly button: HTMLButtonElement;
  private readonly badge: HTMLSpanElement;
  private readonly coach: HTMLDivElement;
  private readonly root: HTMLDivElement;
  private readonly list: HTMLOListElement;
  private readonly foot: HTMLParagraphElement;
  private stored = load();
  /** what the server says is done (signed in) */
  private server = new Set<string>();
  /** steps on their way to the server, so a burst of digs sends one request */
  private sending = new Set<string>();
  private justDone: string | null = null;
  private justTimer = 0;

  constructor(
    parent: HTMLElement,
    hudRoot: HTMLElement,
    makeButton: (name: IconName, label: string) => HTMLButtonElement,
    private readonly host: GuideHost,
    /** show the coach card (off under ?nointro, with the rest of the onboarding) */
    private readonly coachOn = true,
  ) {
    this.button = makeButton('compass', 'Beach guide');
    this.button.dataset.act = 'guide';
    this.button.classList.add('guide-btn');
    this.badge = document.createElement('span');
    this.badge.className = 'guide-badge';
    this.button.appendChild(this.badge);
    this.button.addEventListener('click', () => this.open());

    this.coach = document.createElement('div');
    this.coach.className = 'guide-coach';
    this.coach.setAttribute('role', 'status');
    hudRoot.appendChild(this.coach);

    this.root = document.createElement('div');
    this.root.className = 'board guide';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Beach guide');
    this.root.innerHTML = `
      <div class="board-card">
        <button type="button" class="dlg-close" aria-label="Close">×</button>
        <h2>Beach guide</h2>
        <p class="board-blurb"><a class="guide-link" href="${GUIDE_URL}#beach-guide" target="_blank" rel="noopener">how it works</a></p>
        <ol class="board-list guide-list"></ol>
        <p class="board-note guide-foot"></p>
      </div>`;
    parent.appendChild(this.root);
    this.list = this.root.querySelector('.guide-list')!;
    this.foot = this.root.querySelector('.guide-foot')!;
    this.root.querySelector('.dlg-close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
    this.render();
  }

  /** what counts as done right now */
  get done(): Set<string> {
    const local = new Set(this.stored.local);
    if (!this.host.signedIn()) return local;
    return new Set([...this.server, ...local]);
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  open(): void {
    this.root.classList.add('open');
    this.render();
    if (this.host.signedIn()) void this.sync();
  }

  close(): void {
    this.root.classList.remove('open');
  }

  /**
   * Something happened that a step teaches. Cheap to call often: a step
   * that's done (or on its way) returns at once.
   */
  mark(id: GuideStepId): void {
    if (this.done.has(id) || this.sending.has(id)) return;
    const step = guideStepById(id);
    if (!step) return;
    if (!this.host.signedIn()) {
      if (step.needsAccount) return;
      this.stored.local.push(id);
      save(this.stored);
      this.celebrate(step, null, null);
      return;
    }
    void this.send(step);
  }

  /** After signing in (or opening the guide): the server's list, and send what this device did signed out. */
  async sync(): Promise<void> {
    if (!this.host.signedIn()) {
      this.server.clear();
      this.render();
      return;
    }
    try {
      this.server = new Set(await this.host.load());
    } catch {
      return; // offline: try again next time
    }
    const pending = this.stored.local.filter((s) => !this.server.has(s));
    let gifts = 0;
    for (const id of pending) {
      try {
        const r = await this.host.complete(id as GuideStepId);
        this.server.add(id);
        if (r.gift || r.bonus) gifts++;
      } catch {
        /* keep it for next time */
      }
    }
    this.stored.local = this.stored.local.filter((s) => !this.server.has(s));
    save(this.stored);
    if (gifts) {
      this.host.gifted();
      this.host.toast(`Your guide steps are saved: ${gifts === 1 ? 'a gift is' : `${gifts} gifts are`} in your bag.`);
    }
    this.render();
  }

  /** Signed out: forget the server's list (this device's own steps stay). */
  signedOut(): void {
    this.server.clear();
    this.render();
  }

  private async send(step: GuideStep): Promise<void> {
    this.sending.add(step.id);
    try {
      const r = await this.host.complete(step.id);
      this.server.add(step.id);
      if (r.new) this.celebrate(step, r.gift, r.bonus);
      if (r.gift || r.bonus) this.host.gifted();
    } catch {
      // a server-checked step the server can't see yet, or offline: an
      // app-checked step is kept on the device and sent on the next sync
      if (!SERVER_CHECKED.has(step.id) && !this.stored.local.includes(step.id)) {
        this.stored.local.push(step.id);
        save(this.stored);
        this.celebrate(step, null, null);
      }
    } finally {
      this.sending.delete(step.id);
      this.render();
    }
  }

  private celebrate(step: GuideStep, gift: string | null, bonus: string | null): void {
    let text = DONE_LINE[step.id];
    if (gift) text += ` ${article(prizeName(gift))} ${prizeName(gift).toLowerCase()} is in your bag.`;
    if (bonus) text += ` You finished the guide: ${article(prizeName(bonus)).toLowerCase()} ${prizeName(bonus).toLowerCase()} too!`;
    this.justDone = text;
    window.clearTimeout(this.justTimer);
    this.justTimer = window.setTimeout(() => {
      this.justDone = null;
      this.renderCoach();
    }, 3500);
    this.render();
  }

  setHidden(hidden: boolean): void {
    this.stored.hidden = hidden;
    save(this.stored);
    this.render();
  }

  render(): void {
    const accounts = this.host.accounts;
    const done = this.done;
    const p = progress(done, accounts);
    this.badge.textContent = p.done >= p.total ? '✓' : `${p.done}/${p.total}`;
    this.button.classList.toggle('finished', p.done >= p.total);
    this.button.setAttribute('aria-label', `Beach guide, ${p.done} of ${p.total} done`);
    this.renderCoach();
    if (!this.isOpen) return;

    const next = nextStep(done, accounts);
    const signedIn = this.host.signedIn();
    this.list.innerHTML = '';
    for (const [i, s] of guideSteps(accounts).entries()) {
      const li = document.createElement('li');
      const isDone = done.has(s.id);
      li.className = `board-row guide-row${isDone ? ' done' : ''}${next?.id === s.id ? ' next' : ''}`;
      li.dataset.step = s.id;
      const mark = document.createElement('span');
      mark.className = 'guide-mark';
      mark.textContent = isDone ? '✓' : String(i + 1);
      const who = document.createElement('div');
      who.className = 'board-who guide-who';
      const b = document.createElement('b');
      b.textContent = s.title;
      who.append(b);
      li.append(mark, who);
      const gift = accounts ? s.gift : null;
      if (s.id === 'invite' && accounts) {
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'action board-visit';
        go.dataset.act = 'invite';
        go.textContent = 'invite';
        go.addEventListener('click', () => {
          this.close();
          if (signedIn) this.host.openInvite();
          else this.host.signIn();
        });
        li.appendChild(go);
      } else if (s.needsAccount && !signedIn) {
        const note = document.createElement('small');
        note.className = 'guide-gift';
        note.textContent = 'sign in';
        li.appendChild(note);
      } else if (gift && !isDone) {
        const note = document.createElement('small');
        note.className = 'guide-gift';
        note.textContent = prizeName(gift).toLowerCase();
        li.appendChild(note);
      }
      this.list.appendChild(li);
    }

    this.foot.innerHTML = '';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'action';
    toggle.dataset.act = 'guide-coach';
    toggle.textContent = this.stored.hidden ? 'show the next step' : 'hide the next step';
    toggle.addEventListener('click', () => this.setHidden(!this.stored.hidden));
    this.foot.appendChild(toggle);
  }

  private renderCoach(): void {
    const next = nextStep(this.done, this.host.accounts);
    const show = this.coachOn && (!!this.justDone || (!!next && !this.stored.hidden));
    this.coach.classList.toggle('shown', show);
    this.coach.classList.toggle('cheer', !!this.justDone);
    if (!show) return;
    if (this.justDone) {
      this.coach.innerHTML = `<span class="guide-coach-icon">✓</span><span class="guide-coach-text"><b></b></span>`;
      this.coach.querySelector('b')!.textContent = this.justDone;
      return;
    }
    const step = next!;
    const signIn = step.needsAccount && !this.host.signedIn();
    this.coach.innerHTML = `
      <button type="button" class="guide-coach-open" data-act="guide-coach-open">
        <span class="guide-coach-icon">${icon(step.icon)}</span>
        <span class="guide-coach-text"><b></b><small></small></span>
      </button>
      <button type="button" class="guide-coach-hide" aria-label="Hide the next step">×</button>`;
    // labels only (CLAUDE.md, no notes in the game): how to do it is in the web guide
    this.coach.querySelector('b')!.textContent = step.title;
    this.coach.querySelector('small')!.textContent = signIn ? 'sign in' : '';
    this.coach.querySelector('.guide-coach-open')!.addEventListener('click', () => {
      if (signIn) this.host.signIn();
      else if (step.id === 'invite') this.host.openInvite();
      else this.open();
    });
    this.coach.querySelector('.guide-coach-hide')!.addEventListener('click', () => this.setHidden(true));
  }

  /** The current coach line (for tests). */
  get coachText(): string {
    return this.coach.classList.contains('shown') ? (this.coach.textContent ?? '').trim() : '';
  }
}
