import { petKind, type PetSpecies } from '../world/pets';
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
  /** signed out (accounts build): a sign-in notice at the top of the bag */
  private signIn: (() => void) | null = null;
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
  /** what each thing trades in for (docs/BEECH_BUCKS.md): how many can be, and each unit's value, newest first */
  private tradeInfo = new Map<string, TradeInfo>();
  /** trading in and gifting from the bag (signed in): long press a thing */
  private bagActions: BagActions | null = null;
  private readonly dialog: TradeDialog;
  /** a long press opened the dialog: swallow the click that ends it */
  private suppressClick = false;
  /** a press on a tile in progress (long press opens the trade-in dialog) */
  private press: { timer: number; start: { x: number; y: number } } | null = null;

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
    this.dialog = new TradeDialog(this.modal, () => this.bagActions);
    window.addEventListener('pointermove', (e) => {
      if (this.press && Math.hypot(e.clientX - this.press.start.x, e.clientY - this.press.start.y) > 10) this.endPress();
    });
    window.addEventListener('pointerup', () => this.endPress());
    window.addEventListener('pointercancel', () => this.endPress());
    // a long press ends in a click (on the tile, or on the backdrop when the
    // dialog opened under the finger): don't pick the thing up, or close the bag
    this.modal.addEventListener(
      'click',
      (e) => {
        if (!this.suppressClick) return;
        this.suppressClick = false;
        e.stopImmediatePropagation();
        e.preventDefault();
      },
      { capture: true },
    );
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

  /** Show the sign-in notice (signed out) or hide it (null: signed in, or no accounts). */
  setSignIn(fn: (() => void) | null): void {
    if (fn === this.signIn) return;
    this.signIn = fn;
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
    const key = (x: Map<string, number>) => [...x].sort().join();
    if (key(m) === key(this.elsewhere)) return;
    this.elsewhere = m;
    this.render();
  }

  private ownedOf(id: string): number {
    return this.owned.get(id) ?? 0;
  }

  /** What each thing trades in for (from the server's /bag). */
  setTradeInfo(m: Map<string, TradeInfo>): void {
    this.tradeInfo = m;
    this.dialog.refresh(m);
    this.render();
  }

  /** The trade-in value of the next one of this thing, if one can be traded in now. */
  tradeValue(id: string): number | undefined {
    const t = this.tradeInfo.get(id);
    return t && t.free > 0 && t.values.length ? t.values[0] : undefined;
  }

  /** Turn on long press → trade in / gift (signed in), or off (null). */
  setBagActions(a: BagActions | null): void {
    this.bagActions = a;
    this.render();
  }

  /** Open the trade-in dialog for a thing in the bag (a long press does this). */
  openTrade(id: string): void {
    const name = this.items.find((i) => i.id === id)?.name ?? EXTRAS.find((x) => x.id === id)?.name ?? id;
    this.dialog.open(id, name, this.tradeInfo.get(id));
  }

  /** select several to trade in at once: how many of each are picked (null: not selecting) */
  private picks: Map<string, number> | null = null;
  private pickStatus = '';
  private pickBusy = false;

  /** Select mode: tap things to pick them (each tap one more, up to what's free, then back to none). */
  setSelecting(on: boolean): void {
    this.picks = on ? new Map() : null;
    this.pickStatus = '';
    this.render();
  }

  get selecting(): boolean {
    return this.picks !== null;
  }

  /** what the picks give back: each thing's newest units first, the order a trade-in takes them */
  private picksValue(): number {
    let total = 0;
    for (const [id, n] of this.picks ?? []) total += (this.tradeInfo.get(id)?.values ?? []).slice(0, n).reduce((t, v) => t + v, 0);
    return total;
  }

  private pickTap(id: string): void {
    if (!this.picks) return;
    const free = this.tradeInfo.get(id)?.free ?? 0;
    if (free < 1) return;
    const n = ((this.picks.get(id) ?? 0) + 1) % (free + 1);
    if (n) this.picks.set(id, n);
    else this.picks.delete(id);
    this.pickStatus = '';
    this.render();
  }

  private async tradePicks(): Promise<void> {
    const a = this.bagActions;
    if (!a || !this.picks || !this.picks.size || this.pickBusy) return;
    this.pickBusy = true;
    this.pickStatus = 'trading in…';
    this.render();
    try {
      const r = await a.tradeInMany([...this.picks].map(([item, quantity]) => ({ item, quantity })));
      this.picks = new Map();
      this.pickStatus = `+${sd(r.credited)}`;
    } catch (e) {
      this.pickStatus = (e as Error).message;
    } finally {
      this.pickBusy = false;
      this.render();
    }
  }

  /** at the bottom while selecting: what the picks give back, and trade in */
  private pickBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'inv-pickbar';
    const count = [...(this.picks ?? [])].reduce((t, [, n]) => t + n, 0);
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'action trade-go';
    go.dataset.act = 'bag-trade-picks';
    go.textContent = count ? `trade in ${count} · ${sd(this.picksValue())}` : 'trade in';
    go.disabled = !count || this.pickBusy;
    go.addEventListener('click', () => void this.tradePicks());
    const status = document.createElement('p');
    status.className = 'trade-status';
    status.setAttribute('role', 'status');
    status.textContent = this.pickStatus;
    bar.append(go, status);
    return bar;
  }

  /** the tile's ×n badge and look while selecting */
  private markPick(b: HTMLElement, id: string): void {
    if (!this.picks) return;
    const n = this.picks.get(id) ?? 0;
    const can = (this.tradeInfo.get(id)?.free ?? 0) > 0;
    b.classList.toggle('picked', n > 0);
    b.classList.toggle('unpickable', !can);
    b.setAttribute('aria-pressed', String(n > 0));
    if (n > 0) {
      const badge = document.createElement('i');
      badge.className = 'inv-pick';
      badge.textContent = `×${n}`;
      b.appendChild(badge);
    }
  }

  /** Long press (or right click) on a tile opens the trade-in dialog. */
  private longPress(el: HTMLElement, id: string): void {
    if (!this.bagActions || this.signIn || this.picks) return;
    // the press is tracked on the bag, not the tile: the bag re-renders its
    // tiles while you hold, which would lose a per-tile timer's events
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.endPress();
      this.suppressClick = false;
      const start = { x: e.clientX, y: e.clientY };
      const timer = window.setTimeout(() => {
        this.press = null;
        this.suppressClick = true;
        this.openTrade(id);
      }, LONG_PRESS_MS);
      this.press = { timer, start };
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.endPress();
      this.openTrade(id);
    });
  }

  private endPress(): void {
    if (this.press) window.clearTimeout(this.press.timer);
    this.press = null;
  }

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
    if (!on) this.dialog.close();
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
    if (this.bagActions && !this.signIn) {
      const tip = document.createElement('p');
      tip.className = 'inv-tip';
      tip.textContent = this.picks ? 'tap items to trade in' : 'long press item to trade in';
      const sel = document.createElement('button');
      sel.type = 'button';
      sel.className = 'action inv-select';
      sel.dataset.act = 'bag-select';
      sel.textContent = this.picks ? 'cancel' : 'select';
      sel.addEventListener('click', () => this.setSelecting(!this.picks));
      tip.appendChild(sel);
      this.tray.appendChild(tip);
    }
    const signIn = this.signIn;
    if (signIn) {
      const n = document.createElement('div');
      n.className = 'inv-signin';
      n.innerHTML = '<span>You’re not signed in</span>';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'action';
      b.dataset.act = 'sign-in';
      b.textContent = 'sign in';
      b.addEventListener('click', () => {
        this.setOpen(false);
        signIn();
      });
      n.appendChild(b);
      this.tray.appendChild(n);
    }
    if (this.machines.length && !this.picks) {
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
      if (this.picks) {
        if (it.unlimited) continue; // free things never trade in
        this.markPick(b, it.id);
        b.addEventListener('click', () => this.pickTap(it.id));
        grid.appendChild(b);
        continue;
      }
      b.addEventListener('click', () => {
        this.select(it.id === this.selected ? null : it.id);
        this.setOpen(false);
      });
      if (!it.unlimited) this.longPress(b, it.id);
      grid.appendChild(b);
    }
    this.tray.appendChild(grid);
    if (this.picks) this.tray.appendChild(this.pickBar());
    else this.tray.appendChild(this.foundSection());
    // things you own that don't go on the sand (an extra beach, beach snacks)
    for (const x of EXTRAS) {
      const n = this.ownedOf(x.id);
      if (!n) continue;
      if (x.id === 'crab-treat' || x.id.startsWith('pet-')) {
        if (this.picks) continue; // snacks and pets never trade in
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `inv-item extra rarity-${x.rarity}`;
        b.dataset.extra = x.id;
        b.innerHTML = `${icon(x.id as IconName)}<b>${x.name}</b><span>${x.id.startsWith('pet-') ? (n > 1 ? `${n} · place` : 'place') : `${n} left`}</span>`;
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
        // an extra beach you aren't using can be traded in (long press)
        if (x.id === 'beach') this.longPress(b, x.id);
        if (this.picks && x.id === 'beach') {
          this.markPick(b, x.id);
          b.addEventListener('click', () => this.pickTap(x.id));
          b.setAttribute('role', 'button');
          b.tabIndex = 0;
        }
        grid.appendChild(b);
      }
    }
    // your pets in the bag (docs/PETS.md): tap one, then tap a beach of yours to set it down
    for (const p of this.picks ? [] : this.bagPets) {
      const b = document.createElement('button');
      b.type = 'button';
      const kind = petKind(p.species);
      b.className = 'inv-item extra rarity-rare';
      b.dataset.extra = `bagpet:${p.id}`;
      b.innerHTML = `${icon(kind.item as IconName)}<b>${escapeText(p.name || kind.name)}</b><span>${p.name ? `${kind.name.toLowerCase()} · place` : 'place'}</span>`;
      b.addEventListener('click', () => {
        this.setOpen(false);
        this.onUseExtra(`bagpet:${p.id}`);
      });
      grid.appendChild(b);
    }
  }

  /** pets put away in your bag */
  private bagPets: { id: number; species: PetSpecies; name: string }[] = [];

  setBagPets(pets: { id: number; species: PetSpecies; name: string }[]): void {
    const same = pets.length === this.bagPets.length && pets.every((p, i) => p.id === this.bagPets[i].id && p.name === this.bagPets[i].name);
    this.bagPets = pets.map((p) => ({ id: p.id, species: p.species, name: p.name }));
    if (!same) this.render();
  }

  bagPet(id: number): { id: number; species: PetSpecies; name: string } | undefined {
    return this.bagPets.find((p) => p.id === id);
  }
}

const escapeText = (t: string): string =>
  t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** What a thing in the bag trades in for: how many can be now, and each unit's value (newest first, the order a trade-in takes them). */
export interface TradeInfo {
  free: number;
  values: number[];
}

/** Trading in and gifting from the bag (docs/BEECH_BUCKS.md). */
export interface BagActions {
  /** Trade `quantity` in. Resolves with the beech bucks credited; throws with the reason it didn't. */
  tradeIn: (id: string, quantity: number) => Promise<{ credited: number }>;
  /** Trade several things in at once (all of them or none). */
  tradeInMany: (lines: { item: string; quantity: number }[]) => Promise<{ credited: number }>;
  /** Gift one: opens your account page on beechshore with it picked. */
  gift: (id: string) => void;
  /** can this one be gifted? */
  giftable: (id: string) => boolean;
}

const LONG_PRESS_MS = 450;

/** bb and a number: the short form of beech bucks where space is tight. */
export const sd = (n: number) => `bb ${n}`;

/** One beech buck, or many: the full form, with the singular right. */
export const bucksWord = (n: number) => `${n} beech buck${n === 1 ? '' : 's'}`;

/** The beech-buck coin (public/icons/beech-bucks.webp), for balance lines. */
export function bucksIcon(size = 18): HTMLImageElement {
  const img = document.createElement('img');
  img.src = '/icons/beech-bucks.webp';
  img.alt = '';
  img.className = 'bucks-icon';
  img.width = size;
  img.height = size;
  return img;
}

/**
 * The trade-in dialog (long press a thing in the bag): how many to trade
 * in, what that gives back in bb, trade in, and gift. Labels and status only.
 */
export class TradeDialog {
  private readonly root: HTMLDivElement;
  private id = '';
  private info: TradeInfo | undefined;
  private n = 1;
  private busy = false;

  constructor(
    parent: HTMLElement,
    private readonly actions: () => BagActions | null,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'trade-dlg';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Trade in');
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="trade-card">
        <button type="button" class="dlg-close" aria-label="Close">×</button>
        <div class="trade-head"><span class="trade-icon"></span><b class="trade-name"></b></div>
        <div class="trade-qty">
          <button type="button" class="trade-step" data-act="trade-less" aria-label="One fewer">−</button>
          <output class="trade-n" aria-live="polite"></output>
          <button type="button" class="trade-step" data-act="trade-more" aria-label="One more">+</button>
          <span class="trade-of"></span>
        </div>
        <p class="trade-value"></p>
        <div class="trade-actions">
          <button type="button" class="action trade-go" data-act="trade-in"></button>
          <button type="button" class="action trade-gift" data-act="trade-gift">${icon('gift')}<span>gift</span></button>
        </div>
        <p class="trade-status" role="status"></p>
      </div>`;
    parent.appendChild(this.root);
    this.root.querySelector('.dlg-close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target === this.root) this.close();
    });
    this.root.querySelector('[data-act="trade-less"]')!.addEventListener('click', () => this.step(-1));
    this.root.querySelector('[data-act="trade-more"]')!.addEventListener('click', () => this.step(1));
    this.root.querySelector('.trade-go')!.addEventListener('click', () => void this.trade());
    this.root.querySelector('.trade-gift')!.addEventListener('click', () => {
      this.actions()?.gift(this.id);
      this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.stopImmediatePropagation();
        this.close();
      }
    }, true);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(id: string, name: string, info: TradeInfo | undefined): void {
    this.id = id;
    this.info = info;
    this.n = 1;
    this.root.querySelector('.trade-icon')!.innerHTML = id === 'beach' ? icon('beach' as IconName) : itemIcon(id);
    this.root.querySelector('.trade-name')!.textContent = name;
    this.root.querySelector('.trade-status')!.textContent = '';
    this.root.hidden = false;
    this.render();
    this.root.querySelector<HTMLButtonElement>('.trade-go')?.focus({ preventScroll: true });
  }

  close(): void {
    this.root.hidden = true;
  }

  /** The bag was reloaded: keep the open dialog in step. */
  refresh(m: Map<string, TradeInfo>): void {
    if (!this.isOpen) return;
    this.info = m.get(this.id);
    this.render();
  }

  private get max(): number {
    return Math.min(this.info?.free ?? 0, this.info?.values.length ?? 0);
  }

  private step(d: number): void {
    this.n = Math.max(1, Math.min(this.max, this.n + d));
    this.render();
  }

  /** what `n` units give back: the newest n */
  private value(n: number): number {
    return (this.info?.values ?? []).slice(0, n).reduce((t, v) => t + v, 0);
  }

  private render(): void {
    const max = this.max;
    this.n = Math.max(1, Math.min(max, this.n));
    const can = max > 0;
    this.root.querySelector('.trade-n')!.textContent = String(can ? this.n : 0);
    this.root.querySelector('.trade-of')!.textContent = `of ${max}`;
    this.root.querySelector<HTMLButtonElement>('[data-act="trade-less"]')!.disabled = !can || this.n <= 1;
    this.root.querySelector<HTMLButtonElement>('[data-act="trade-more"]')!.disabled = !can || this.n >= max;
    this.root.querySelector('.trade-value')!.textContent = can ? `you get ${sd(this.value(this.n))}` : this.id === 'beach' ? 'every extra beach is in use' : 'pick it up off your beach first';
    const go = this.root.querySelector<HTMLButtonElement>('.trade-go')!;
    go.textContent = can ? `trade in · ${sd(this.value(this.n))}` : 'trade in';
    go.disabled = !can || this.busy;
    this.root.querySelector<HTMLButtonElement>('.trade-gift')!.hidden = !this.actions()?.giftable(this.id);
  }

  private async trade(): Promise<void> {
    const a = this.actions();
    if (!a || this.busy || this.max < 1) return;
    this.busy = true;
    const status = this.root.querySelector('.trade-status')!;
    status.textContent = 'trading in…';
    this.render();
    try {
      const r = await a.tradeIn(this.id, this.n);
      status.textContent = `+${sd(r.credited)}`;
      this.n = 1;
    } catch (e) {
      status.textContent = (e as Error).message;
    } finally {
      this.busy = false;
      this.render();
    }
  }
}

/**
 * Shown while an item is in hand: what it is, a size slider (remembered per
 * item), and a button to put it away. Trading in and gifting live in the bag
 * (long press a thing there), never here.
 */
export class PlaceBar {
  private readonly root: HTMLDivElement;
  private readonly name: HTMLElement;
  private readonly ico: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly sizeRow: HTMLElement;
  private readonly bagBtn: HTMLButtonElement;
  private readonly status: HTMLElement;
  private item: Item | null = null;
  private petBag: (() => void) | null = null;

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
      <button type="button" class="pb-tobag" data-act="pet-to-bag" hidden>put in bag</button>
      <span class="pb-status" role="status"></span>
      <button type="button" class="pb-close" aria-label="Put it away">×</button>`;
    parent.appendChild(this.root);
    this.ico = this.root.querySelector('.pb-icon')!;
    this.name = this.root.querySelector('.pb-name')!;
    this.slider = this.root.querySelector('.pb-size input')!;
    this.sizeRow = this.root.querySelector('.pb-size')!;
    this.bagBtn = this.root.querySelector('.pb-tobag')!;
    this.status = this.root.querySelector('.pb-status')!;
    this.bagBtn.addEventListener('click', () => {
      const go = this.petBag;
      this.petBag = null;
      this.bagBtn.hidden = true;
      go?.();
    });
    this.slider.addEventListener('input', () => {
      if (this.item) this.setSize(this.item.id, Number(this.slider.value));
    });
    dragSlider(this.slider);
    this.root.querySelector('.pb-close')!.addEventListener('click', () => this.putAway());
  }

  show(item: Item | null, size01: number): void {
    this.item = item;
    this.petBag = null;
    this.bagBtn.hidden = true;
    this.status.textContent = '';
    this.root.classList.toggle('shown', !!item);
    if (!item) return;
    this.ico.innerHTML = itemIcon(item.id);
    this.name.textContent = item.name;
    this.sizeRow.hidden = !!item.fixedSize;
    this.slider.value = String(this.sizes()[item.id] ?? size01);
  }

  /**
   * A pet in hand (no size): its name, and while you're carrying your
   * beach's pet, a button to put it in the bag.
   */
  showPet(name: string, species: PetSpecies, toBag?: () => void): void {
    this.show(null, 0);
    this.root.classList.add('shown');
    this.ico.innerHTML = icon(petKind(species).item as IconName);
    this.name.textContent = name;
    this.sizeRow.hidden = true;
    this.status.textContent = '';
    this.petBag = toBag ?? null;
    this.bagBtn.hidden = !toBag;
  }

  /** A beach snack in hand (no size): its name and how many are left. */
  showSnack(name: string, left: number): void {
    this.show(null, 0);
    this.root.classList.add('shown');
    this.ico.innerHTML = icon('crab-treat');
    this.name.textContent = name;
    this.sizeRow.hidden = true;
    this.status.textContent = `${left} left`;
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
