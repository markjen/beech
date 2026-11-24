/**
 * Viewing mode: the beach info behind the small "i" at the bottom of the
 * screen. While you're looking at someone else's stretch of shore — visiting
 * a beach by code, or scrolled away from your own — no name tags float over
 * the sand. The info lives here instead: a small "i" at the bottom, and the
 * name cards open only when the viewer taps it.
 *
 * The card reuses the floating tags' own elements (name, star, "ask to be
 * neighbors"), moved into the card while it's open and back out when it
 * closes, so the actions keep working exactly as they do on the tags.
 */

/** Viewing is any time you're looking at someone else's stretch of shore. */
export function isViewingMode(visiting: boolean, ownVisible: boolean): boolean {
  return visiting || !ownVisible;
}

/** Nearest beach first, then outward: the beach under the view heads the list. */
export function orderInfoRows(indices: number[], focusIndex: number): number[] {
  return [...indices].sort((a, b) => {
    const da = Math.abs(a - focusIndex);
    const db = Math.abs(b - focusIndex);
    return da - db || a - b;
  });
}

export class ShoreInfo {
  /** the wrapper: the "i" button, with the card opening above it */
  readonly el: HTMLElement;
  private readonly btn: HTMLButtonElement;
  private readonly card: HTMLElement;
  private readonly list: HTMLElement;
  private open = false;
  private visible = false;
  /** the tags currently sitting in the card, in list order */
  private rows: HTMLElement[] = [];

  constructor(
    private readonly root: HTMLElement,
    opts: { onHome: () => void },
  ) {
    this.el = document.createElement('div');
    this.el.className = 'shore-info';
    this.el.hidden = true;

    this.btn = document.createElement('button');
    this.btn.type = 'button';
    this.btn.className = 'shore-info-btn';
    this.btn.textContent = 'i';
    this.btn.setAttribute('aria-label', 'Beach info');
    this.btn.setAttribute('aria-expanded', 'false');
    this.btn.title = 'Beach info';
    this.btn.addEventListener('click', () => this.setOpen(!this.open));

    this.card = document.createElement('div');
    this.card.className = 'shore-info-card';
    this.card.hidden = true;

    const home = document.createElement('button');
    home.type = 'button';
    home.className = 'shore-info-home';
    home.textContent = '⌂ my beach';
    home.addEventListener('click', () => opts.onHome());

    this.list = document.createElement('div');
    this.list.className = 'shore-info-list';

    this.card.append(home, this.list);
    // button first in the DOM (tab order), card above it on screen
    this.el.append(this.btn, this.card);
    root.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Is this tag sitting in the open card (so the floating-tag code should leave it alone)? */
  isInCard(el: HTMLElement): boolean {
    return el.parentElement === this.list;
  }

  /** Show or hide the whole control. Hiding closes the card and sends its tags home. */
  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    if (!on) this.setOpen(false);
    this.el.hidden = !on;
  }

  /** Open or close the card. Closing sends every tag back to the root. */
  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.btn.setAttribute('aria-expanded', String(open));
    this.card.hidden = !open;
    if (!open) this.setRows([]);
  }

  /**
   * The tags to show in the open card, in list order. Moving a tag in
   * clears the inline position the floating-tag code gave it, so the card's
   * CSS lays it out as a row. Tags that left the set go back to the root —
   * unless their slot was dropped meanwhile, in which case they're already
   * gone and there's nothing to send back.
   */
  setRows(labels: HTMLElement[]): void {
    if (!this.open) return;
    for (const row of this.rows) {
      if (!labels.includes(row) && row.isConnected) this.root.appendChild(row);
    }
    for (const label of labels) {
      label.style.display = '';
      label.style.transform = '';
      this.list.appendChild(label);
    }
    this.rows = [...labels];
  }

  /** Point at the "i" button: used when the viewer tries to dig on someone else's beach. */
  nudge(): void {
    this.btn.classList.remove('nudge');
    void this.btn.offsetWidth;
    this.btn.classList.add('nudge');
  }
}
