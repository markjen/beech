import { icon, itemIcon, type IconName } from './hud';
import { EXTRAS, isAvailable, type Item } from '../world/items';

/**
 * The bag: a small tray of things you can put on the beach. Pick one, then
 * tap the sand to set it down; tap something already there to pick it back up.
 */
/** A tile at the top of the bag that opens something else (the claw, the capsule machine). */
export interface BagMachine {
  id: string;
  icon: IconName;
  label: string;
  open: () => void;
}

export class InventoryTray {
  readonly button: HTMLButtonElement;
  /** the modal: a dimmed backdrop with the bag card centered on it */
  private readonly modal: HTMLDivElement;
  private readonly tray: HTMLDivElement;
  private machines: BagMachine[] = [];
  private selected: string | null = null;
  private open = false;
  /** how many of each non-free item you own, and how many are on the beach */
  private owned = new Map<string, number>();
  private extraBeachesInUse: number | null = null;
  /** the "found" collection: kept from the sea (by item, on this beach), and dug up (newest first) */
  private keptFromSea = new Map<string, number>();
  private dugUp: { item: string; rarity: string }[] = [];
  /** one-of-a-kind things you own: who found each first */
  private foundBy = new Map<string, string>();
  private placed = new Map<string, number>();
  /** how many of each are on your other beaches (as of their last saves) */
  private elsewhere = new Map<string, number>();
  /** uses an actionable extra from the bag (e.g. tossing a beach snack) */
  onUseExtra: (id: string) => void = () => {};
  /** what the next one of each thing trades in for (sand bucks), when one can be (docs/SAND_BUCKS.md) */
  private tradeValues = new Map<string, number>();
  /** trade one in (an extra beach, from the bag) */
  onTradeIn: (id: string) => void = () => {};

  constructor(
    hudButton: (name: IconName, label: string, cls?: string) => HTMLButtonElement,
    parent: HTMLElement,
    private readonly items: Item[],
    private readonly pick: (item: Item | null) => void,
  ) {
    this.button = hudButton('bag', 'Bag', 'hud-btn hud-tool');
    this.button.dataset.tool = 'place';
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.addEventListener('click', () => this.toggle());

    this.modal = document.createElement('div');
    this.modal.className = 'inv-modal';
    this.modal.inert = true;
    this.tray = document.createElement('div');
    this.tray.className = 'inv-tray';
    this.tray.setAttribute('role', 'dialog');
    this.tray.setAttribute('aria-modal', 'true');
    this.tray.setAttribute('aria-label', 'Bag');
    this.modal.appendChild(this.tray);
    parent.appendChild(this.modal);
    this.render();
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.setOpen(false);
    });
    // the dimmed beach around the card closes it
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.setOpen(false);
    });
  }

  /** The tiles at the top of the bag (signed-in builds: the claw and capsule machines). */
  setMachines(m: BagMachine[]): void {
    this.machines = m;
    this.render();
  }

  setOwned(owned: Map<string, number>, foundBy: Map<string, string> = new Map()): void {
    this.owned = owned;
    this.foundBy = foundBy;
    if (this.selected && !this.canPlace(this.selected) && this.placedOf(this.selected) === 0 && !this.ownedOf(this.selected)) this.select(null);
    this.render();
  }

  setExtraBeachesInUse(count: number | null): void {
    if (count === this.extraBeachesInUse) return;
    this.extraBeachesInUse = count;
    this.render();
  }

  setPlaced(placed: Map<string, number>): void {
    const key = (m: Map<string, number>) => [...m].sort().join();
    if (key(placed) === key(this.placed)) return;
    this.placed = placed;
    this.render();
  }

  /** What you've found: things the sea brought in that you kept, and what you've dug up. */
  setFound(keptFromSea: Map<string, number>, dugUp?: { item: string; rarity: string }[]): void {
    const same = [...keptFromSea].sort().join() === [...this.keptFromSea].sort().join();
    this.keptFromSea = keptFromSea;
    if (dugUp) this.dugUp = dugUp;
    if (!same || dugUp) this.render();
  }

  setElsewhere(m: Map<string, number>): void {
    this.elsewhere = m;
    this.render();
  }

  private ownedOf(id: string): number {
    return this.owned.get(id) ?? 0;
  }

  /** What the next free one of each thing trades in for (from the server's /bag). */
  setTradeValues(m: Map<string, number>): void {
    this.tradeValues = m;
    this.render();
  }

  /** The trade-in value of the next one of this thing, if one can be traded in now. */
  tradeValue(id: string): number | undefined {
    return this.tradeValues.get(id);
  }

  /** How many of this item you own (for the gift button in the place bar). */
  /** what you own, and what's on your other beaches (for beach files and checkpoints) */
  ownedItems(): ReadonlyMap<string, number> {
    return this.owned;
  }
  elsewhereItems(): ReadonlyMap<string, number> {
    return this.elsewhere;
  }

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
    this.modal.classList.toggle('open', on);
    this.tray.classList.toggle('open', on);
    this.modal.inert = !on;
    this.button.setAttribute('aria-expanded', String(on));
    if (on) this.tray.querySelector<HTMLButtonElement>('.inv-item')?.focus({ preventScroll: true });
  }

  /** Another tool was chosen: nothing is in hand any more. */
  deselect(): void {
    this.selected = null;
    this.button.innerHTML = icon('bag');
    if (this.open) this.setOpen(false);
    this.render();
  }

  select(id: string | null): void {
    const item = id ? this.items.find((i) => i.id === id) ?? null : null;
    this.selected = item?.id ?? null;
    this.button.innerHTML = item ? itemIcon(item.id) : icon('bag');
    this.render();
    this.pick(item);
  }

  /** "Found": what the sea brought that you kept (pick a stray up and put it down), and what you've dug up. */
  private foundSection(): HTMLElement {
    const sec = document.createElement('div');
    sec.className = 'inv-found-list';
    const name = (id: string, n: number) => `${this.items.find((x) => x.id === id)?.name ?? id}${n > 1 ? ` × ${n}` : ''}`;
    const sea = [...this.keptFromSea].map(([id, n]) => name(id, n));
    const dug = new Map<string, number>();
    for (const d of this.dugUp) dug.set(d.item, (dug.get(d.item) ?? 0) + 1);
    const rare = this.dugUp.filter((d) => d.rarity !== 'common').length;
    const lines: string[] = [];
    lines.push(sea.length ? `<b>Kept from the sea</b> ${sea.join(' · ')}` : '<b>Kept from the sea</b> nothing yet: pick up something the waves bring in (hold on it) and put it down to keep it');
    if (this.dugUp.length) lines.push(`<b>Dug up</b> ${[...dug].map(([id, n]) => name(id, n)).join(' · ')}${rare ? ` <i>(${rare} rare or better)</i>` : ''}`);
    sec.innerHTML = `<div class="inv-title">Found</div>${lines.map((l) => `<p>${l}</p>`).join('')}`;
    return sec;
  }

  private render(): void {
    const now = new Date();
    this.tray.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'inv-title';
    h.textContent = 'Bag';
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'dlg-close';
    x.setAttribute('aria-label', 'Close');
    x.textContent = '×';
    x.addEventListener('click', () => this.setOpen(false));
    this.tray.append(h, x);
    if (this.machines.length) {
      const row = document.createElement('div');
      row.className = 'inv-machines';
      for (const m of this.machines) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'inv-item inv-machine';
        b.dataset.act = m.id;
        b.innerHTML = `${icon(m.icon)}<b>${m.label}</b>`;
        b.addEventListener('click', () => {
          this.setOpen(false);
          m.open();
        });
        row.appendChild(b);
      }
      this.tray.appendChild(row);
    }
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
      const finder = this.foundBy.get(it.id);
      b.innerHTML = `${itemIcon(it.id)}<b>${it.name}</b><span>${it.unlimited ? 'Free · ∞' : finder !== undefined ? 'one of a kind' : `${Math.max(0, left)} of ${this.ownedOf(it.id)} left`}</span>`;
      if (finder !== undefined) {
        // the only one in the game, and who found it
        const f = document.createElement('i');
        f.className = 'inv-found';
        f.textContent = finder ? `found by ${finder}` : 'found';
        b.appendChild(f);
        b.title = `${it.name}: one of a kind${finder ? `, first found by ${finder}` : ''}`;
      }
      if (!it.unlimited && left <= 0 && it.id !== this.selected) b.classList.add('used');
      b.addEventListener('click', () => {
        this.select(it.id === this.selected ? null : it.id);
        this.setOpen(false);
      });
      grid.appendChild(b);
    }
    this.tray.appendChild(grid);
    this.tray.appendChild(this.foundSection());
    // things you own that don't go on the sand (an extra beach, beach snacks)
    for (const x of EXTRAS) {
      const n = this.ownedOf(x.id);
      if (!n) continue;
      if (x.id === 'crab-treat' || x.id === 'pet-crab') {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `inv-item extra rarity-${x.rarity}`;
        b.dataset.extra = x.id;
        b.innerHTML = `${icon(x.id as IconName)}<b>${x.name}</b><span>${x.id === 'pet-crab' ? 'Tap to adopt' : `${n} left`}</span>`;
        b.addEventListener('click', () => {
          this.setOpen(false);
          this.onUseExtra(x.id);
        });
        grid.appendChild(b);
      } else {
        const b = document.createElement('div');
        b.className = `inv-item extra rarity-${x.rarity}`;
        b.dataset.extra = x.id;
        const count = x.id === 'beach' && this.extraBeachesInUse !== null
          ? `${this.extraBeachesInUse} of ${n} in use`
          : `${n} owned`;
        b.innerHTML = `${icon(x.id as IconName)}<b>${x.name}</b><span>${count}</span>`;
        // an extra beach you aren't using can be traded in
        const value = this.tradeValues.get(x.id);
        if (value !== undefined) {
          const t = document.createElement('button');
          t.type = 'button';
          t.className = 'inv-trade';
          t.dataset.act = `trade-${x.id}`;
          t.textContent = `trade in · ${value}`;
          t.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onTradeIn(x.id);
          });
          b.appendChild(t);
        }
        grid.appendChild(b);
      }
    }
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

/** Trading the thing in hand back in for sand bucks (docs/SAND_BUCKS.md). */
export interface PlaceBarTrade {
  /** what the next one trades in for, or undefined when none can be (all on a beach, or not tradeable) */
  value: (item: Item) => number | undefined;
  /** Trade one in. Resolves with the bucks credited and how many are left to trade; throws with the reason it didn't. */
  tradeIn: (item: Item) => Promise<{ credited: number; left: number }>;
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
  private readonly tradeBtn: HTMLButtonElement;
  private item: Item | null = null;
  private gifting = false;
  private trade?: PlaceBarTrade;
  /** the first tap on "trade in" asks; the second does it */
  private tradeArmed = false;

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
      <button type="button" class="pb-trade" data-act="trade-in" hidden></button>
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
    this.tradeBtn = this.root.querySelector('.pb-trade')!;
    this.tradeBtn.addEventListener('click', () => void this.tradeIn());
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
    this.ico.innerHTML = itemIcon(item.id);
    this.name.textContent = item.name;
    this.sizeRow.hidden = !!item.fixedSize;
    this.slider.value = String(this.sizes()[item.id] ?? size01);
    this.giftBtn.hidden = !this.gift || !this.gift.giftable(item);
    this.showTrade();
  }

  /** Add the trade-in button's behaviour (once signed in). */
  setTrade(trade: PlaceBarTrade): void {
    this.trade = trade;
    this.showTrade();
  }

  /** The trade-in values changed (the bag was reloaded). */
  refreshTrade(): void {
    this.showTrade();
  }

  private showTrade(): void {
    this.tradeArmed = false;
    const value = this.item && this.trade && !this.gifting ? this.trade.value(this.item) : undefined;
    this.tradeBtn.hidden = value === undefined;
    this.tradeBtn.textContent = value === undefined ? '' : `trade in · ${value}`;
  }

  private async tradeIn(): Promise<void> {
    if (!this.item || !this.trade) return;
    const value = this.trade.value(this.item);
    if (value === undefined) return;
    if (!this.tradeArmed) {
      // a second tap confirms
      this.tradeArmed = true;
      this.tradeBtn.textContent = `sure? · ${value}`;
      return;
    }
    const item = this.item;
    this.tradeBtn.disabled = true;
    this.giftStatus.textContent = '';
    try {
      const r = await this.trade.tradeIn(item);
      this.giftStatus.textContent = `+${r.credited} sand bucks`;
      if (r.left <= 0) window.setTimeout(() => this.putAway(), 1200);
    } catch (e) {
      this.giftStatus.textContent = (e as Error).message;
    } finally {
      this.tradeBtn.disabled = false;
      if (this.item === item) this.showTrade();
    }
  }

  /** A beach snack in hand (no size, no gift): its name and how many are left. */
  showSnack(name: string, left: number): void {
    this.show(null, 0);
    this.root.classList.add('shown');
    this.ico.innerHTML = icon('crab-treat');
    this.name.textContent = name;
    this.sizeRow.hidden = true;
    this.giftBtn.hidden = true;
    this.giftStatus.textContent = `${left} left`;
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
    if (this.gifting) this.tradeBtn.hidden = true;
    else this.showTrade();
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
