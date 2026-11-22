import { icon, type IconName } from './hud';
import { isAvailable, type Item } from '../world/items';

/** What's planned but not here yet, shown greyed out so the tray reads as a beginning. */
const COMING = [
  { name: 'Shop', note: 'Special items, some only for a while' },
  { name: 'Mystery box', note: 'Rare, legendary and one-of-a-kind finds' },
];

/** How the claw machine tile behaves: play, ask to sign in, or not here (sandbox). */
export type ClawState = 'play' | 'signin' | 'none';

/**
 * The bag: a small tray of things you can put on the beach. Pick one, then
 * tap the sand to set it down; tap something already there to pick it back up.
 */
export class InventoryTray {
  readonly button: HTMLButtonElement;
  private readonly tray: HTMLDivElement;
  private selected: string | null = null;
  private open = false;
  /** how many of each non-free item you own, and how many are on the beach */
  private owned = new Map<string, number>();
  private placed = new Map<string, number>();
  private claw: ClawState = 'none';
  /** opens the claw machine (or the sign-in sheet) */
  onClaw: () => void = () => {};

  constructor(
    hudButton: (name: IconName, label: string, cls?: string) => HTMLButtonElement,
    parent: HTMLElement,
    private readonly items: Item[],
    private readonly pick: (item: Item | null) => void,
  ) {
    this.button = hudButton('bag', 'Things to put on the beach', 'hud-btn hud-tool');
    this.button.dataset.tool = 'place';
    this.button.setAttribute('aria-haspopup', 'true');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.addEventListener('click', () => this.toggle());

    this.tray = document.createElement('div');
    this.tray.className = 'inv-tray';
    this.tray.setAttribute('role', 'dialog');
    this.tray.setAttribute('aria-label', 'Your bag');
    parent.appendChild(this.tray);
    this.render();
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.setOpen(false);
    });
  }

  setOwned(owned: Map<string, number>): void {
    this.owned = owned;
    if (this.selected && !this.canPlace(this.selected) && this.placedOf(this.selected) === 0 && !this.ownedOf(this.selected)) this.select(null);
    this.render();
  }

  setPlaced(placed: Map<string, number>): void {
    const key = (m: Map<string, number>) => [...m].sort().join();
    if (key(placed) === key(this.placed)) return;
    this.placed = placed;
    this.render();
  }

  setClaw(state: ClawState): void {
    if (state === this.claw) return;
    this.claw = state;
    this.render();
  }

  private ownedOf(id: string): number {
    return this.owned.get(id) ?? 0;
  }

  private placedOf(id: string): number {
    return this.placed.get(id) ?? 0;
  }

  /** Is there one left to put down? (free items: always) */
  canPlace(id: string): boolean {
    const it = this.items.find((i) => i.id === id);
    if (!it) return false;
    return it.unlimited || this.placedOf(id) < this.ownedOf(id);
  }

  get current(): string | null {
    return this.selected;
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  setOpen(on: boolean): void {
    this.open = on;
    this.tray.classList.toggle('open', on);
    this.button.setAttribute('aria-expanded', String(on));
    if (on) this.tray.querySelector<HTMLButtonElement>('.inv-item')?.focus({ preventScroll: true });
  }

  /** Another tool was chosen: nothing is in hand any more. */
  deselect(): void {
    this.selected = null;
    this.button.innerHTML = icon('bag');
    this.render();
  }

  select(id: string | null): void {
    const item = id ? this.items.find((i) => i.id === id) ?? null : null;
    this.selected = item?.id ?? null;
    this.button.innerHTML = icon(item ? (item.id as IconName) : 'bag');
    this.render();
    this.pick(item);
  }

  private render(): void {
    const now = new Date();
    this.tray.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'inv-title';
    h.textContent = 'Your bag';
    this.tray.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'inv-grid';
    for (const it of this.items) {
      if (!isAvailable(it, now) && !this.ownedOf(it.id)) continue;
      // things you win or buy show once you have them
      if (!it.unlimited && !this.ownedOf(it.id)) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `inv-item rarity-${it.rarity}`;
      b.classList.toggle('selected', it.id === this.selected);
      b.setAttribute('aria-pressed', String(it.id === this.selected));
      const left = this.ownedOf(it.id) - this.placedOf(it.id);
      b.innerHTML = `${icon(it.id as IconName)}<b>${it.name}</b><span>${it.unlimited ? 'Free · ∞' : `${Math.max(0, left)} of ${this.ownedOf(it.id)} left`}</span>`;
      if (!it.unlimited && left <= 0 && it.id !== this.selected) b.classList.add('used');
      b.addEventListener('click', () => {
        this.select(it.id === this.selected ? null : it.id);
        this.setOpen(false);
      });
      grid.appendChild(b);
    }
    if (this.claw !== 'none') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inv-item claw-tile';
      b.dataset.act = 'claw';
      b.innerHTML = `${icon('claw')}<b>Claw machine</b><span>${this.claw === 'play' ? 'One free go a day' : 'Sign in to play'}</span>`;
      b.addEventListener('click', () => {
        this.setOpen(false);
        this.onClaw();
      });
      grid.appendChild(b);
    } else {
      const d = document.createElement('div');
      d.className = 'inv-item soon';
      d.innerHTML = `<b>Claw machine</b><span>Coming soon</span>`;
      grid.appendChild(d);
    }
    for (const c of COMING) {
      const d = document.createElement('div');
      d.className = 'inv-item soon';
      d.title = c.note;
      d.innerHTML = `<b>${c.name}</b><span>Coming soon</span>`;
      grid.appendChild(d);
    }
    this.tray.appendChild(grid);
    const tip = document.createElement('p');
    tip.className = 'inv-tip';
    tip.textContent = 'Tap the sand to set it down. Tap it again to pick it up.';
    this.tray.appendChild(tip);
  }
}

/**
 * Shown while an item is in hand: what it is, a size slider (remembered per
 * item), and a button to put it away.
 */
export class PlaceBar {
  private readonly root: HTMLDivElement;
  private readonly name: HTMLElement;
  private readonly ico: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly sizeRow: HTMLElement;
  private item: Item | null = null;

  constructor(
    parent: HTMLElement,
    private readonly sizes: () => Record<string, number>,
    private readonly setSize: (id: string, v: number) => void,
    private readonly putAway: () => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'place-bar';
    this.root.innerHTML = `
      <span class="pb-icon"></span>
      <b class="pb-name"></b>
      <label class="pb-size"><span>small</span><input type="range" min="0" max="1" step="0.01" aria-label="Size"><span>big</span></label>
      <button type="button" class="pb-close" aria-label="Put it away">×</button>`;
    parent.appendChild(this.root);
    this.ico = this.root.querySelector('.pb-icon')!;
    this.name = this.root.querySelector('.pb-name')!;
    this.slider = this.root.querySelector('input')!;
    this.sizeRow = this.root.querySelector('.pb-size')!;
    this.slider.addEventListener('input', () => {
      if (this.item) this.setSize(this.item.id, Number(this.slider.value));
    });
    this.root.querySelector('.pb-close')!.addEventListener('click', () => this.putAway());
  }

  show(item: Item | null, size01: number): void {
    this.item = item;
    this.root.classList.toggle('shown', !!item);
    if (!item) return;
    this.ico.innerHTML = icon(item.id as IconName);
    this.name.textContent = item.name;
    this.sizeRow.hidden = !!item.fixedSize;
    this.slider.value = String(this.sizes()[item.id] ?? size01);
  }
}
