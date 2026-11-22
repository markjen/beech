import { icon, type IconName } from './hud';
import { isAvailable, type Item } from '../world/items';

/** What's planned but not here yet, shown greyed out so the tray reads as a beginning. */
const COMING = [
  { name: 'Shop', note: 'Special items, some only for a while' },
  { name: 'Mystery box', note: 'Rare, legendary and one-of-a-kind finds' },
  { name: 'Claw machine', note: 'Try your luck' },
];

/**
 * The bag: a small tray of things you can put on the beach. Pick one, then
 * tap the sand to set it down; tap something already there to pick it back up.
 */
export class InventoryTray {
  readonly button: HTMLButtonElement;
  private readonly tray: HTMLDivElement;
  private selected: string | null = null;
  private open = false;

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
      if (!isAvailable(it, now)) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `inv-item rarity-${it.rarity}`;
      b.classList.toggle('selected', it.id === this.selected);
      b.setAttribute('aria-pressed', String(it.id === this.selected));
      b.innerHTML = `${icon(it.id as IconName)}<b>${it.name}</b><span>${it.unlimited ? 'Free · ∞' : ''}</span>`;
      b.addEventListener('click', () => {
        this.select(it.id === this.selected ? null : it.id);
        this.setOpen(false);
      });
      grid.appendChild(b);
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
