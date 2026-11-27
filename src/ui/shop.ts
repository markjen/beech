import { APP_LINKS, codesAllowed, shopMode, type ShopApi, type ShopOffer, type ShopPack } from '../net/shop';
import { prizeName } from '../world/items';
import { icon, type IconName } from './hud';
import { bucksIcon, bucksWord, sd } from './inventory';
import { shoreAccountUrl } from '../net/share';

/**
 * The shop (docs/BEECH_BUCKS.md): your beech bucks, beech-buck packs for real
 * money, and everything for sale in beech bucks. A pack goes through Apple or
 * Google in the apps, Steam on Steam, and Xsolla's Pay Station on the web
 * (when the server has web checkout on; otherwise the web points you to the
 * app). Things are bought with beech bucks (bb where space is tight), on any
 * device. Gift cards, your history and topping up by card are on your
 * account page on beechshore. Labels and status only: how it works is in
 * the web guide.
 */
export type ShopTab = 'all' | 'beaches' | 'items' | 'pets' | 'packs';
export type OfferCategory = 'featured' | 'beaches' | 'items' | 'pets';

const TAB_LABELS: { id: ShopTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'beaches', label: 'Beaches' },
  { id: 'items', label: 'Items' },
  { id: 'pets', label: 'Pets' },
  { id: 'packs', label: 'bb' },
];

const GROUP_LABELS: { id: OfferCategory; label: string }[] = [
  { id: 'featured', label: '' },
  { id: 'beaches', label: 'Beaches' },
  { id: 'items', label: 'Items' },
  { id: 'pets', label: 'Pets & snacks' },
];

/** Which shop section an offer belongs to. */
export function offerCategory(o: Pick<ShopOffer, 'grants' | 'featured'>): OfferCategory {
  if (o.featured || o.grants.length > 1) return 'featured';
  if (o.grants.length > 0 && o.grants.every((g) => g.item === 'beach' || g.item === 'pier')) return 'beaches';
  if (o.grants.length > 0 && o.grants.every((g) => g.item.startsWith('pet-') || g.item === 'crab-treat')) return 'pets';
  return 'items';
}

export class Shop {
  private readonly root: HTMLDivElement;
  private readonly scroll: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly tabsEl: HTMLDivElement;
  private readonly getBucksBtn: HTMLButtonElement;
  private readonly note: HTMLParagraphElement;
  private readonly balanceLine: HTMLParagraphElement;
  private readonly promoForm: HTMLFormElement;
  private readonly promoInput: HTMLInputElement;
  private busy = false;
  private bucks = 0;
  private tab: ShopTab = 'all';
  /** gift cards and promo codes: not in the native apps (see codesAllowed) */
  private readonly codes = codesAllowed();
  private packs: ShopPack[] = [];
  private offers: ShopOffer[] = [];
  private packBonuses: Record<string, { code: string; bonusBucks: number }> = {};
  /** false in the apps when the store offers none of the packs (they aren't created there yet) */
  private storePacksAvailable = true;

  constructor(
    parent: HTMLElement,
    private readonly api: ShopApi,
    /** something was bought (refresh the bag and your beaches) */
    private readonly bought: (productId: string) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'claw shop';
    this.root.inert = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Shop');
    this.root.innerHTML = `
      <div class="claw-card shop-card">
        <div class="shop-head">
          <div class="shop-top">
            <h2>Shop</h2>
            <div class="shop-balance">
              <p class="shop-credit shop-bucks" role="status"></p>
              <button type="button" class="shop-get-bucks" data-act="shop-packs" aria-label="Get beech bucks">+ bb</button>
            </div>
            <button type="button" class="claw-close" aria-label="Close">×</button>
          </div>
          <p class="shop-note"></p>
          <div class="shop-tabs" role="tablist" aria-label="Shop sections"></div>
        </div>
        <div class="shop-scroll">
          <div class="shop-list"></div>
          <div class="shop-foot">
            <a class="shop-account" data-act="shop-account" target="_blank" rel="noopener">your account · gift cards · history ↗</a>
            <form class="shop-promo">
              <label>Promo code <input name="promo" type="text" autocomplete="off" aria-label="Promo code"></label>
              <button type="submit" class="shop-buy">Add</button>
            </form>
          </div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.scroll = this.root.querySelector('.shop-scroll')!;
    this.list = this.root.querySelector('.shop-list')!;
    this.tabsEl = this.root.querySelector('.shop-tabs')!;
    this.getBucksBtn = this.root.querySelector('.shop-get-bucks')!;
    this.note = this.root.querySelector('.shop-note')!;
    this.balanceLine = this.root.querySelector('.shop-bucks')!;
    this.root.querySelector<HTMLAnchorElement>('.shop-account')!.href = shoreAccountUrl({}, 'balance');
    this.promoForm = this.root.querySelector('.shop-promo')!;
    this.promoInput = this.root.querySelector('.shop-promo input')!;
    this.root.querySelector('.claw-close')!.addEventListener('click', () => this.close());
    this.getBucksBtn.addEventListener('click', () => this.setTab('packs'));
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
    // the apps sell through the stores only: no code fields there
    this.promoForm.hidden = !this.codes;
    // and no link out to paying on the web (store rules)
    this.root.querySelector<HTMLElement>('.shop-account')!.hidden = !this.codes;
    this.root.querySelector<HTMLElement>('.shop-foot')!.hidden = !this.codes;
    this.promoForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.addPromo();
    });
    this.tabsEl.addEventListener('keydown', (e) => this.onTabKey(e));
    this.renderTabs();
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  /** Open the shop; `section` 'packs' opens straight to the beech-buck packs. */
  async open(section?: 'packs'): Promise<void> {
    this.tab = section === 'packs' ? 'packs' : 'all';
    this.renderTabs();
    this.root.classList.add('open');
    this.root.inert = false;
    this.note.textContent = 'Opening the shop…';
    this.list.innerHTML = '';
    this.scroll.scrollTop = 0;
    void this.api.retryPending().then((n) => {
      if (n) void this.afterPack('');
    });
    if (shopMode() === 'web')
      void this.api.checkWebOrders().then((n) => {
        if (n) void this.afterPack('');
      });
    try {
      const [{ packs, offers, storePacksAvailable }] = await Promise.all([this.api.catalog(), this.refreshBucks(), this.refreshPromos()]);
      this.packs = packs;
      this.offers = offers;
      this.storePacksAvailable = storePacksAvailable;
      this.note.textContent = '';
      this.renderTabs();
      await this.render();
      this.scroll.scrollTop = 0;
    } catch (e) {
      this.note.textContent = (e as Error).message;
    }
  }

  close(): void {
    this.root.classList.remove('open');
    this.root.inert = true;
  }

  private setTab(next: ShopTab): void {
    if (this.tab === next) {
      this.scroll.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    this.tab = next;
    this.renderTabs();
    void this.render().then(() => {
      this.scroll.scrollTop = 0;
    });
  }

  private availableTabs(): { id: ShopTab; label: string }[] {
    if (!this.offers.length) return TAB_LABELS;
    const cats = new Set(this.offers.map((o) => offerCategory(o)));
    return TAB_LABELS.filter((t) => t.id === 'all' || t.id === 'packs' || cats.has(t.id));
  }

  private renderTabs(): void {
    const tabs = this.availableTabs();
    if (!tabs.some((t) => t.id === this.tab)) this.tab = 'all';
    const hadFocus = this.tabsEl.contains(document.activeElement);
    this.getBucksBtn.hidden = this.tab === 'packs';
    this.tabsEl.innerHTML = '';
    for (const t of tabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.dataset.shopTab = t.id;
      const on = t.id === this.tab;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      btn.textContent = t.label;
      btn.addEventListener('click', () => this.setTab(t.id));
      this.tabsEl.appendChild(btn);
      if (on && hadFocus) btn.focus();
    }
  }

  private onTabKey(e: KeyboardEvent): void {
    const buttons = [...this.tabsEl.querySelectorAll<HTMLButtonElement>('button[role="tab"]')];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 || !buttons.length) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % buttons.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = buttons[next];
    target.focus();
    this.setTab(target.dataset.shopTab as ShopTab);
  }

  /** The balance up top: the coin, then the full amount. */
  private renderBalance(): void {
    this.balanceLine.innerHTML = '';
    this.balanceLine.append(bucksIcon(), document.createTextNode(bucksWord(this.bucks)));
  }

  private async refreshBucks(): Promise<void> {
    try {
      this.bucks = (await this.api.bucks()).bucks;
    } catch {
      /* offline: keep what we had */
    }
    this.renderBalance();
  }

  private async refreshPromos(): Promise<void> {
    try {
      this.packBonuses = (await this.api.myPromos()).packBonuses;
    } catch {
      /* offline or signed out: keep what we had */
    }
  }

  private async addPromo(): Promise<void> {
    const code = this.promoInput.value.trim();
    if (!code || this.busy) return;
    const btn = this.promoForm.querySelector('button')!;
    await this.run(btn, async () => {
      const r = await this.api.loadPromo(code);
      this.promoInput.value = '';
      this.packBonuses = r.packBonuses;
      const deal = r.promo.kind === 'percent' ? `+${r.promo.value}% bb` : `+${r.promo.value} bb`;
      this.note.textContent = `${r.promo.code} added (${deal})`;
      await this.render();
    });
  }

  private async render(): Promise<void> {
    const prevScroll = this.scroll.scrollTop;
    this.renderBalance();
    this.getBucksBtn.hidden = this.tab === 'packs';
    this.list.innerHTML = '';
    const nodes: HTMLElement[] = [];
    if (this.tab !== 'packs') {
      const offersEl = document.createElement('div');
      offersEl.className = 'shop-offers';
      const byGroup = new Map<OfferCategory, ShopOffer[]>();
      for (const o of this.offers) {
        const cat = offerCategory(o);
        const arr = byGroup.get(cat) ?? [];
        arr.push(o);
        byGroup.set(cat, arr);
      }
      const groups =
        this.tab === 'all'
          ? GROUP_LABELS
          : GROUP_LABELS.filter((g) => g.id === this.tab);
      for (const g of groups) {
        const items = byGroup.get(g.id);
        if (!items?.length) continue;
        if (this.tab === 'all' && g.label) {
          const h = document.createElement('h3');
          h.className = 'shop-group-title';
          h.textContent = g.label;
          offersEl.appendChild(h);
        }
        const sorted = [...items].sort((a, b) => Number(b.featured) - Number(a.featured));
        for (const o of sorted) {
          offersEl.appendChild(this.offerRow(o, o.bucks));
        }
      }
      nodes.push(offersEl);
    }
    if (this.tab === 'all' || this.tab === 'packs') {
      const packs = document.createElement('div');
      packs.className = 'shop-packs';
      if (this.tab === 'all') {
        const h = document.createElement('h3');
        h.className = 'shop-group-title';
        h.textContent = 'Beech bucks (bb)';
        packs.appendChild(h);
      }
      const mode = shopMode();
      if (mode === 'web' && !this.api.webCheckout) {
        const p = document.createElement('p');
        p.className = 'shop-note';
        p.textContent = 'Get these in the beech app:';
        packs.appendChild(p);
      }
      if (mode === 'native' && !this.packs.length && !this.storePacksAvailable) {
        const p = document.createElement('p');
        p.className = 'shop-note';
        p.textContent = 'Beech-buck packs aren’t in the store yet — check back soon.';
        packs.appendChild(p);
      }
      for (const p of this.packs) {
        const bonus = this.packBonuses[p.id];
        const title = bonus ? `${sd(p.bucks)} + ${bonus.bonusBucks} bonus` : sd(p.bucks);
        const row = this.row('bucket', title, p.blurb, bonus ? bonus.code : '', p.featured);
        const btn = this.button(p.id, p.price ?? `$${p.usd.toFixed(2)}`);
        if (mode === 'web' && this.api.webCheckout) btn.addEventListener('click', () => void this.payOnWeb(p, btn));
        else if (mode === 'web') btn.addEventListener('click', () => this.getTheApp());
        else btn.addEventListener('click', () => void this.buyPack(p, btn));
        row.querySelector('.shop-actions')!.appendChild(btn);
        packs.appendChild(row);
      }
      nodes.push(packs);
    }
    this.list.append(...nodes);
    this.scroll.scrollTop = prevScroll;
  }

  private offerRow(o: ShopOffer, price: number): HTMLDivElement {
    const showWhat = o.grants.length > 1 || (o.grants.length === 1 && o.grants[0].quantity > 1);
    const what = showWhat
      ? o.grants.map((g) => `${g.quantity > 1 ? `${g.quantity} × ` : ''}${prizeName(g.item)}`).join(', ')
      : '';
    const row = this.row(o.grants[0]?.item ?? 'bag', o.featured ? `${o.name} · best value` : o.name, o.blurb, what, o.featured);
    const btn = this.button(o.id, price === 0 ? 'Free' : sd(price));
    btn.classList.add('shop-bucks-buy');
    if (price > this.bucks) {
      btn.textContent = sd(price);
      btn.classList.add('short');
      btn.addEventListener('click', () => this.setTab('packs'));
    } else {
      btn.addEventListener('click', () => void this.buyOffer(o, btn, price === 0));
    }
    row.querySelector('.shop-actions')!.appendChild(btn);
    return row;
  }

  private row(iconId: string, title: string, blurb: string, what: string, featured: boolean): HTMLDivElement {
    const row = document.createElement('div');
    row.className = `shop-item${featured ? ' featured' : ''}`;
    row.innerHTML = `
      <div class="shop-icon">${icon(iconId as IconName)}</div>
      <div class="shop-text"><b></b><span class="shop-blurb"></span><span class="shop-what"></span></div>
      <div class="shop-actions"></div>`;
    row.querySelector('b')!.textContent = title;
    row.querySelector('.shop-blurb')!.textContent = blurb;
    const whatEl = row.querySelector<HTMLSpanElement>('.shop-what')!;
    if (what) whatEl.textContent = what;
    else whatEl.remove();
    return row;
  }

  private button(id: string, label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shop-buy';
    btn.dataset.product = id;
    btn.textContent = label;
    return btn;
  }

  private getTheApp(): void {
    const ua = navigator.userAgent;
    const link = /iPhone|iPad|Mac/.test(ua) ? APP_LINKS.ios || APP_LINKS.android : APP_LINKS.android || APP_LINKS.ios;
    if (link) window.open(link, '_blank', 'noopener');
    else this.note.textContent = 'Beech bucks (bb) are sold in the beech app on iPhone and Android (coming to the stores soon).';
  }

  private async run(btn: HTMLButtonElement, fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const label = btn.textContent;
    btn.textContent = '…';
    btn.disabled = true;
    try {
      await fn();
    } catch (e) {
      this.note.textContent = (e as Error).message;
    } finally {
      this.busy = false;
      btn.textContent = label;
      btn.disabled = false;
    }
  }

  /** Web checkout: off to Xsolla's Pay Station; the return lands back on the beach (main.ts). */
  private async payOnWeb(p: ShopPack, btn: HTMLButtonElement): Promise<void> {
    await this.run(btn, async () => {
      const url = await this.api.startWebCheckout(p.id);
      this.note.textContent = 'Opening the secure checkout…';
      location.assign(url);
    });
  }

  private async buyPack(p: ShopPack, btn: HTMLButtonElement): Promise<void> {
    await this.run(btn, async () => {
      const r = await this.api.buy(p.id);
      if (r === 'bought') {
        this.note.textContent = `${p.name}: thank you!`;
        await this.afterPack(p.id);
      } else if (r === 'pending') {
        this.note.textContent = 'Your purchase is pending — your bb will arrive when it completes.';
      }
    });
  }

  private async afterPack(id: string): Promise<void> {
    await Promise.all([this.refreshBucks(), this.refreshPromos()]);
    if (this.isOpen && this.offers.length) await this.render();
    this.bought(id);
  }

  private async buyOffer(o: ShopOffer, btn: HTMLButtonElement, free: boolean): Promise<void> {
    await this.run(btn, async () => {
      const r = free ? await this.api.claimFree(o.id) : await this.api.buyWithCredit(o.id);
      this.bucks = r.bucks;
      this.note.textContent = `${o.name}: in your bag`;
      this.bought(o.id);
      await this.render();
    });
  }
}
