import { icon, type IconName } from './hud';
import { EXTRAS, isAvailable, type Item } from '../world/items';

/** What's planned but not here yet, shown greyed out so the tray reads as a beginning. */
// (the shop and the vending machine, once listed here, are both built now)
const COMING: { name: string; note: string }[] = [];

/** How the claw machine tile behaves: play, ask to sign in, or not here (sandbox). */
export type ClawState = 'play' | 'signin' | 'none';

/** How the vending machine tile behaves: the same three states. */
export type VendingState = 'play' | 'signin' | 'none';

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
  /** how many of each are on your other beaches (as of their last saves) */
  private elsewhere = new Map<string, number>();
  private claw: ClawState = 'none';
  /** opens the claw machine (or the sign-in sheet) */
  onClaw: () => void = () => {};
  private vending: VendingState = 'none';
  /** opens the vending machine (or the sign-in sheet) */
  onVending: () => void = () => {};
  /** opens the shop (or the sign-in sheet) */
  onShop: () => void = () => {};

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

  setElsewhere(m: Map<string, number>): void {
    this.elsewhere = m;
    this.render();
  }

  setClaw(state: ClawState): void {
    if (state === this.claw) return;
    this.claw = state;
    this.render();
  }

  setVending(state: VendingState): void {
    if (state === this.vending) return;
    this.vending = state;
    this.render();
  }

  private ownedOf(id: string): number {
    return this.owned.get(id) ?? 0;
  }

  /** How many of this item you own (for the gift button in the place bar). */
  ownedCount(id: string): number {
    return this.ownedOf(id);
  }

  /** on this beach, plus on your other beaches */
  private placedOf(id: string): number {
    return (this.placed.get(id) ?? 0) + (this.elsewhere.get(id) ?? 0);
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
      b.innerHTML = `${icon('claw')}<b>Claw machine</b><span>${this.claw === 'play' ? 'Free goes' : 'Sign in to play'}</span>`;
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
    if (this.vending !== 'none') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inv-item vending-tile';
      b.dataset.act = 'vending';
      b.innerHTML = `${icon('vending')}<b>Vending machine</b><span>${this.vending === 'play' ? 'A free ball a day' : 'Sign in to play'}</span>`;
      b.addEventListener('click', () => {
        this.setOpen(false);
        this.onVending();
      });
      grid.appendChild(b);
    } else {
      const d = document.createElement('div');
      d.className = 'inv-item soon';
      d.innerHTML = `<b>Vending machine</b><span>Coming soon</span>`;
      grid.appendChild(d);
    }
    if (this.claw !== 'none') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inv-item shop-tile';
      b.dataset.act = 'shop';
      b.innerHTML = `${icon('bag')}<b>Shop</b><span>${this.claw === 'play' ? 'Beaches and more' : 'Sign in to shop'}</span>`;
      b.addEventListener('click', () => {
        this.setOpen(false);
        this.onShop();
      });
      grid.appendChild(b);
    } else {
      const d = document.createElement('div');
      d.className = 'inv-item soon';
      d.innerHTML = `<b>Shop</b><span>In the app</span>`;
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
    // things you own that don't go on the sand (an extra beach): tap to read about it
    for (const x of EXTRAS) {
      const n = this.ownedOf(x.id);
      if (!n) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `inv-item extra rarity-${x.rarity}`;
      b.dataset.extra = x.id;
      b.innerHTML = `${icon(x.id as IconName)}<b>${x.name}</b><span>${n > 1 ? `${n} owned` : 'yours'}</span>`;
      b.addEventListener('click', () => (tip.textContent = x.note));
      grid.insertBefore(b, grid.querySelector('.claw-tile, .soon'));
    }
    this.tray.appendChild(tip);
  }
}

/**
 * Shown while an item is in hand: what it is, a size slider (remembered per
 * item), a button to gift it (owned, non-free items only), and a button to
 * put it away. Gifting asks for their neighbor code right here in the bar.
 */
export interface PlaceBarGift {
  /** Is this item one you can give away? (owned, and not a free item) */
  giftable: (item: Item) => boolean;
  /** Send it. Resolves with who it went to; throws with the reason it didn't. */
  sendGift: (item: Item, code: string) => Promise<{ name: string }>;
}

export class PlaceBar {
  private readonly root: HTMLDivElement;
  private readonly name: HTMLElement;
  private readonly ico: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly sizeRow: HTMLElement;
  private readonly giftBtn: HTMLButtonElement;
  private readonly giftRow: HTMLElement;
  private readonly giftInput: HTMLInputElement;
  private readonly giftStatus: HTMLElement;
  private item: Item | null = null;
  private gifting = false;

  constructor(
    parent: HTMLElement,
    private readonly sizes: () => Record<string, number>,
    private readonly setSize: (id: string, v: number) => void,
    private readonly putAway: () => void,
    private gift?: PlaceBarGift,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'place-bar';
    this.root.innerHTML = `
      <span class="pb-icon"></span>
      <b class="pb-name"></b>
      <label class="pb-size"><span>small</span><input type="range" min="0" max="1" step="0.01" aria-label="Size"><span>big</span></label>
      <button type="button" class="pb-gift" aria-label="Gift this to someone">${icon('gift')}</button>
      <label class="pb-gift-row"><span>gift to</span><input placeholder="their code" maxlength="8" autocomplete="off" aria-label="Neighbor code to gift to"><button type="button" class="pb-send">send</button><button type="button" class="pb-cancel" aria-label="Cancel gifting">×</button></label>
      <span class="pb-status" role="status"></span>
      <button type="button" class="pb-close" aria-label="Put it away">×</button>`;
    parent.appendChild(this.root);
    this.ico = this.root.querySelector('.pb-icon')!;
    this.name = this.root.querySelector('.pb-name')!;
    this.slider = this.root.querySelector('.pb-size input')!;
    this.sizeRow = this.root.querySelector('.pb-size')!;
    this.giftBtn = this.root.querySelector('.pb-gift')!;
    this.giftRow = this.root.querySelector('.pb-gift-row')!;
    this.giftInput = this.giftRow.querySelector('input')!;
    this.giftStatus = this.root.querySelector('.pb-status')!;
    this.slider.addEventListener('input', () => {
      if (this.item) this.setSize(this.item.id, Number(this.slider.value));
    });
    dragSlider(this.slider);
    this.root.querySelector('.pb-close')!.addEventListener('click', () => this.putAway());
    this.giftBtn.addEventListener('click', () => this.setGifting(true));
    this.giftRow.querySelector('.pb-cancel')!.addEventListener('click', () => this.setGifting(false));
    const send = () => void this.sendGift();
    this.giftRow.querySelector('.pb-send')!.addEventListener('click', send);
    this.giftInput.addEventListener('keydown', (e) => e.key === 'Enter' && send());
  }

  show(item: Item | null, size01: number): void {
    this.item = item;
    this.setGifting(false);
    this.root.classList.toggle('shown', !!item);
    if (!item) return;
    this.ico.innerHTML = icon(item.id as IconName);
    this.name.textContent = item.name;
    this.sizeRow.hidden = !!item.fixedSize;
    this.slider.value = String(this.sizes()[item.id] ?? size01);
    this.giftBtn.hidden = !this.gift || !this.gift.giftable(item);
  }

  /** Add (or replace) the gifting flow after construction (once signed in). */
  setGift(gift: PlaceBarGift): void {
    this.gift = gift;
    if (this.item) this.giftBtn.hidden = !this.gift.giftable(this.item);
  }

  /** Show (or hide) the code input for gifting the item in hand. */
  private setGifting(on: boolean): void {
    this.gifting = on && !!this.item;
    this.root.classList.toggle('gifting', this.gifting);
    this.sizeRow.hidden = this.gifting || !!this.item?.fixedSize;
    this.giftBtn.hidden = this.gifting || !this.gift || !this.item || !this.gift.giftable(this.item);
    this.giftInput.value = '';
    this.giftStatus.textContent = '';
    if (this.gifting) this.giftInput.focus({ preventScroll: true });
  }

  private async sendGift(): Promise<void> {
    if (!this.item || !this.gift) return;
    const code = this.giftInput.value.trim();
    if (!code) {
      this.giftStatus.textContent = 'type their code first';
      return;
    }
    const item = this.item;
    this.giftInput.disabled = true;
    this.giftStatus.textContent = 'sending…';
    try {
      const { name } = await this.gift.sendGift(item, code);
      this.giftStatus.textContent = `Sent to ${name}`;
      window.setTimeout(() => this.putAway(), 1500);
    } catch (e) {
      this.giftStatus.textContent = (e as Error).message;
      this.giftInput.disabled = false;
      this.giftInput.focus({ preventScroll: true });
    }
  }
}

/**
 * Make a range input follow a finger. The page turns off the browser's own
 * touch handling (so the beach gets every gesture), which on phones leaves
 * a native slider tap-only; this drives it from pointer events instead.
 */
export function dragSlider(input: HTMLInputElement): void {
  let id = -1;
  const setFrom = (e: PointerEvent) => {
    const r = input.getBoundingClientRect();
    const min = Number(input.min || 0);
    const max = Number(input.max || 1);
    const step = Number(input.step) || 0;
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
    let v = min + t * (max - min);
    if (step) v = Math.round(v / step) * step;
    if (String(v) !== input.value) {
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
  input.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return; // mice already work
    e.preventDefault();
    id = e.pointerId;
    try {
      input.setPointerCapture(id);
    } catch {
      /* ignore */
    }
    setFrom(e);
  });
  input.addEventListener('pointermove', (e) => {
    if (e.pointerId === id) setFrom(e);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = -1;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  input.addEventListener('pointerup', end);
  input.addEventListener('pointercancel', end);
}
