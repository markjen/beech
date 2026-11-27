// Inland sections (docs/INLAND_SECTIONS.md): the editor for the rows behind
// one of your beaches. The layout shows behind the beach as you change it
// (the preview); "save" writes the whole list, made from the revision it
// started at, and "cancel" puts the beach back as it was. Labels only (no
// notes in the game UI).

import type { SectionCounts } from '../net/account';
import { SECTIONS, SECTION_ROWS, sectionById } from '../world/sections';

/**
 * How many of `type` you could still add to this draft: owned, less what's
 * on your beaches, plus what this beach's saved rows hold (they come back
 * when you take them off), less what the draft already uses.
 */
export function freeFor(type: string, counts: SectionCounts, saved: readonly string[], draft: readonly string[]): number {
  const n = (l: readonly string[]) => l.filter((x) => x === type).length;
  return (counts.owned[type] ?? 0) - (counts.placed[type] ?? 0) + n(saved) - n(draft);
}

/** Put `type` in row `i` instead of what's there (that copy goes back to the bag). */
export function replaceRow(draft: readonly string[], i: number, type: string): string[] {
  if (i < 0 || i >= draft.length) return [...draft];
  const out = [...draft];
  out[i] = type;
  return out;
}

export interface SectionsEditorHooks {
  /** draw this draft behind the beach */
  preview: (rows: string[]) => void;
  /** write it (throws with a message to show) */
  save: (rows: string[]) => Promise<void>;
  /** buy one of this type into the bag; resolves with the new counts */
  buy: (type: string) => Promise<SectionCounts>;
  /** put the beach back as it was */
  cancel: () => void;
}

export class SectionsEditor {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly list: HTMLOListElement;
  private readonly add: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly saveBtn: HTMLButtonElement;
  private hooks: SectionsEditorHooks | null = null;
  private saved: string[] = [];
  private draft: string[] = [];
  private counts: SectionCounts = { owned: {}, placed: {} };
  private busy = false;
  /** the row being replaced: the add buttons put their type there instead of appending */
  private replacing: number | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'sections-editor';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Inland sections');
    this.title = document.createElement('div');
    this.title.className = 'sections-title';
    this.list = document.createElement('ol');
    this.list.className = 'sections-rows';
    this.add = document.createElement('div');
    this.add.className = 'sections-add';
    this.status = document.createElement('div');
    this.status.className = 'sections-status';
    const foot = document.createElement('div');
    foot.className = 'sections-foot';
    this.saveBtn = this.button('save', 'sections-save', () => void this.commit());
    const cancel = this.button('cancel', 'sections-cancel', () => {
      const fn = this.hooks?.cancel;
      this.hide();
      fn?.();
    });
    foot.append(this.saveBtn, cancel);
    this.root.append(this.title, this.list, this.add, this.status, foot);
    parent.appendChild(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(name: string, saved: readonly string[], counts: SectionCounts, hooks: SectionsEditorHooks): void {
    this.hooks = hooks;
    this.title.textContent = `inland sections · ${name}`;
    this.saved = [...saved];
    this.draft = [...saved];
    this.counts = counts;
    this.status.textContent = '';
    this.replacing = null;
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
    this.hooks = null;
  }

  private button(text: string, act: string, fn: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'action';
    b.dataset.act = act;
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  }

  private change(next: string[]): void {
    this.draft = next;
    this.replacing = null;
    this.hooks?.preview([...next]);
    this.render();
  }

  private render(): void {
    this.list.replaceChildren();
    this.draft.forEach((type, i) => {
      const li = document.createElement('li');
      li.dataset.row = String(i);
      li.dataset.type = type;
      const label = document.createElement('span');
      label.className = 'sections-name';
      label.textContent = sectionById(type)?.name.toLowerCase() ?? type;
      const up = this.button('↑', 'sections-up', () => this.change(swap(this.draft, i, i - 1)));
      up.setAttribute('aria-label', 'move toward the sea');
      up.disabled = i === 0;
      const down = this.button('↓', 'sections-down', () => this.change(swap(this.draft, i, i + 1)));
      down.setAttribute('aria-label', 'move inland');
      down.disabled = i === this.draft.length - 1;
      const off = this.button('to bag', 'sections-remove', () => this.change(this.draft.filter((_, k) => k !== i)));
      const swapBtn = this.button(this.replacing === i ? 'keep' : 'replace', 'sections-replace', () => {
        this.replacing = this.replacing === i ? null : i;
        this.render();
      });
      swapBtn.setAttribute('aria-pressed', String(this.replacing === i));
      li.classList.toggle('replacing', this.replacing === i);
      li.append(label, up, down, swapBtn, off);
      this.list.appendChild(li);
    });
    this.add.replaceChildren();
    const full = this.draft.length >= SECTION_ROWS;
    const row = this.replacing;
    for (const s of SECTIONS) {
      // replacing a row: its own type isn't offered (nothing would change)
      if (row !== null && this.draft[row] === s.id) continue;
      const free = freeFor(s.id, this.counts, this.saved, this.draft);
      const name = s.name.toLowerCase();
      const btn =
        free > 0
          ? row !== null
            ? this.button(`→ ${name}${free > 1 ? ` · ${free}` : ''}`, 'sections-swap', () => this.change(replaceRow(this.draft, row, s.id)))
            : this.button(`+ ${name}${free > 1 ? ` · ${free}` : ''}`, 'sections-add', () => this.change([...this.draft, s.id]))
          : this.button(`${name} · bb 15`, 'sections-buy', () => void this.buy(s.id));
      btn.dataset.type = s.id;
      if (free > 0 && row === null) btn.disabled = full;
      this.add.appendChild(btn);
    }
    this.saveBtn.disabled = same(this.draft, this.saved);
  }

  private async buy(type: string): Promise<void> {
    if (this.busy || !this.hooks) return;
    this.busy = true;
    try {
      this.counts = await this.hooks.buy(type);
      this.status.textContent = '';
      // bought while replacing a row: it goes there
      if (this.replacing !== null) this.change(replaceRow(this.draft, this.replacing, type));
      else if (this.draft.length < SECTION_ROWS) this.change([...this.draft, type]);
      else this.render();
    } catch (e) {
      this.status.textContent = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }

  private async commit(): Promise<void> {
    if (this.busy || !this.hooks) return;
    this.busy = true;
    this.saveBtn.disabled = true;
    try {
      await this.hooks.save([...this.draft]);
      this.hide();
    } catch (e) {
      this.status.textContent = (e as Error).message;
      this.saveBtn.disabled = false;
    } finally {
      this.busy = false;
    }
  }
}

const swap = (l: string[], i: number, j: number): string[] => {
  const out = [...l];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
