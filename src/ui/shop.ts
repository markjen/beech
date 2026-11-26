import { APP_LINKS, codesAllowed, shopMode, type ShopApi, type ShopOffer, type ShopPack } from '../net/shop';
import { prizeName } from '../world/items';
import { icon, type IconName } from './hud';
import { sd } from './inventory';
import { shoreAccountUrl } from '../net/share';

/**
 * The shop (docs/SAND_BUCKS.md): your sand bucks, sand-buck packs for real
 * money, and everything for sale in sand bucks. A pack goes through Apple or
 * Google in the apps, Steam on Steam, and Xsolla's Pay Station on the web
 * (when the server has web checkout on; otherwise the web points you to the
 * app). Things are bought with sand bucks (S$ where space is tight), on any
 * device. Gift cards, your history and topping up by card are on your
 * account page on beechshore. Labels and status only: how it works is in
 * the web guide.
 */
export class Shop {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly note: HTMLParagraphElement;
  private readonly balanceLine: HTMLParagraphElement;
  private readonly promoInput: HTMLInputElement;
  private busy = false;
  private bucks = 0;
  /** gift cards and promo codes: not in the native apps (see codesAllowed) */
  private readonly codes = codesAllowed();
  private packs: ShopPack[] = [];
  private offers: ShopOffer[] = [];
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
        <button type="button" class="claw-close" aria-label="Close">×</button>
        <h2>Shop</h2>
        <p class="shop-credit shop-bucks" role="status"></p>
        <p class="shop-note"></p>
        <div class="shop-list"></div>
        <a class="shop-account" data-act="shop-account" target="_blank" rel="noopener">your account · gift cards · history ↗</a>
        <label class="shop-promo">Promo code <input name="promo" type="text" autocomplete="off" aria-label="Promo code"></label>
      </div>`;
    parent.appendChild(this.root);
    this.list = this.root.querySelector('.shop-list')!;
    this.note = this.root.querySelector('.shop-note')!;
    this.balanceLine = this.root.querySelector('.shop-bucks')!;
    this.root.querySelector<HTMLAnchorElement>('.shop-account')!.href = shoreAccountUrl({}, 'balance');
    this.promoInput = this.root.querySelector('.shop-promo input')!;
    this.root.querySelector('.claw-close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
    // the apps sell through the stores only: no code fields there
    this.root.querySelector<HTMLElement>('.shop-promo')!.hidden = !this.codes;
    // and no link out to paying on the web (store rules)
    this.root.querySelector<HTMLElement>('.shop-account')!.hidden = !this.codes;
    // a promo code changes what the offers cost: price them again
    this.promoInput.addEventListener('change', () => {
      if (this.offers.length) void this.render();
    });
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  /** Open the shop; `section` 'packs' scrolls to the sand-buck packs. */
  async open(section?: 'packs'): Promise<void> {
    this.root.classList.add('open');
    this.root.inert = false;
    this.note.textContent = 'Opening the shop…';
    this.list.innerHTML = '';
    void this.api.retryPending().then((n) => {
      if (n) void this.afterPack('');
    });
    if (shopMode() === 'web')
      void this.api.checkWebOrders().then((n) => {
        if (n) void this.afterPack('');
      });
    try {
      const [{ packs, offers, storePacksAvailable }] = await Promise.all([this.api.catalog(), this.refreshBucks()]);
      this.packs = packs;
      this.offers = offers;
      this.storePacksAvailable = storePacksAvailable;
      this.note.textContent = '';
      await this.render();
      if (section === 'packs') this.list.querySelector('.shop-packs')?.scrollIntoView({ block: 'start' });
    } catch (e) {
      this.note.textContent = (e as Error).message;
    }
  }

  close(): void {
    this.root.classList.remove('open');
    this.root.inert = true;
  }

  private async refreshBucks(): Promise<void> {
    try {
      this.bucks = (await this.api.bucks()).bucks;
    } catch {
      /* offline: keep what we had */
    }
    this.balanceLine.textContent = `${this.bucks} sand dollars (S$)`;
  }

  private promoCode(): string | undefined {
    const code = this.promoInput.value.trim();
    return code ? code : undefined;
  }

  private async render(): Promise<void> {
    this.balanceLine.textContent = `${this.bucks} sand dollars (S$)`;
    this.list.innerHTML = '';
    // a promo code: what each offer costs with it
    const promo = this.codes ? this.promoCode() : undefined;
    const finals = new Map<string, number>();
    if (promo) {
      await Promise.all(
        this.offers.map(async (o) => {
          try {
            finals.set(o.id, (await this.api.quote(o.id, promo)).final);
          } catch {
            /* the code doesn't apply: full price */
          }
        }),
      );
    }
    const offers = document.createElement('div');
    offers.className = 'shop-offers';
    for (const o of [...this.offers].sort((a, b) => Number(b.featured) - Number(a.featured))) {
      const price = finals.get(o.id) ?? o.bucks;
      const what = o.grants.map((g) => `${g.quantity > 1 ? `${g.quantity} × ` : ''}${prizeName(g.item)}`).join(', ');
      const row = this.row(o.grants[0]?.item ?? 'bag', o.featured ? `${o.name} · best value` : o.name, o.blurb, what, o.featured);
      const btn = this.button(o.id, price === 0 ? 'Free' : sd(price));
      btn.classList.add('shop-bucks-buy');
      if (price > this.bucks) {
        btn.textContent = sd(price);
        btn.classList.add('short');
        btn.addEventListener('click', () => this.list.querySelector('.shop-packs')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      } else {
        btn.addEventListener('click', () => void this.buyOffer(o, btn, price === 0));
      }
      row.querySelector('.shop-actions')!.appendChild(btn);
      offers.appendChild(row);
    }
    const packs = document.createElement('div');
    packs.className = 'shop-packs';
    const h = document.createElement('h3');
    h.textContent = 'Sand dollars (S$)';
    packs.appendChild(h);
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
      p.textContent = 'Sand-buck packs aren’t in the store yet — check back soon.';
      packs.appendChild(p);
    }
    for (const p of this.packs) {
      const row = this.row('bucket', sd(p.bucks), p.blurb, '', p.featured);
      const btn = this.button(p.id, p.price ?? `$${p.usd.toFixed(2)}`);
      if (mode === 'web' && this.api.webCheckout) btn.addEventListener('click', () => void this.payOnWeb(p, btn));
      else if (mode === 'web') btn.addEventListener('click', () => this.getTheApp());
      else btn.addEventListener('click', () => void this.buyPack(p, btn));
      row.querySelector('.shop-actions')!.appendChild(btn);
      packs.appendChild(row);
    }
    this.list.append(offers, packs);
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
    row.querySelector('.shop-what')!.textContent = what;
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
    else this.note.textContent = 'Sand dollars (S$) are sold in the beech app on iPhone and Android (coming to the stores soon).';
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
        this.note.textContent = 'Your purchase is pending — your S$ will arrive when it completes.';
      }
    });
  }

  private async afterPack(id: string): Promise<void> {
    await this.refreshBucks();
    if (this.isOpen && this.offers.length) await this.render();
    this.bought(id);
  }

  private async buyOffer(o: ShopOffer, btn: HTMLButtonElement, free: boolean): Promise<void> {
    await this.run(btn, async () => {
      const r = free ? await this.api.claimFree(o.id) : await this.api.buyWithCredit(o.id, this.codes ? this.promoCode() : undefined);
      this.bucks = r.bucks;
      this.note.textContent = `${o.name}: in your bag`;
      this.bought(o.id);
      await this.render();
    });
  }
}
