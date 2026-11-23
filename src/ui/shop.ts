import { APP_LINKS, codesAllowed, shopMode, type ShopApi, type ShopProduct } from '../net/shop';
import { prizeName } from '../world/items';
import { icon, type IconName } from './hud';

/**
 * The shop: extra beaches, packs and things for your beach. In the apps each
 * "buy" goes through Apple or Google; on the web it points you to the app.
 */
export class Shop {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly note: HTMLParagraphElement;
  private readonly creditLine: HTMLParagraphElement;
  private readonly giftForm: HTMLFormElement;
  private readonly promoInput: HTMLInputElement;
  private busy = false;
  private creditCents = 0;
  /** gift cards, promo codes and credit: not in the native apps (see codesAllowed) */
  private readonly codes = codesAllowed();
  private products: ShopProduct[] = [];

  constructor(
    parent: HTMLElement,
    private readonly api: ShopApi,
    /** something was bought (refresh the bag and your beaches) */
    private readonly bought: (productId: string) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'claw shop';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Shop');
    this.root.innerHTML = `
      <div class="claw-card shop-card">
        <button type="button" class="claw-close" aria-label="Close">×</button>
        <h2>Shop</h2>
        <p class="shop-note"></p>
        <p class="shop-credit"></p>
        <div class="shop-list"></div>
        <form class="shop-gift">
          <input name="code" type="text" placeholder="Gift card code" autocomplete="off" aria-label="Gift card code">
          <button type="submit">Redeem gift card</button>
        </form>
        <label class="shop-promo">Promo code <input name="promo" type="text" autocomplete="off" aria-label="Promo code"></label>
        <p class="shop-small"></p>
      </div>`;
    parent.appendChild(this.root);
    this.list = this.root.querySelector('.shop-list')!;
    this.note = this.root.querySelector('.shop-note')!;
    this.creditLine = this.root.querySelector('.shop-credit')!;
    this.giftForm = this.root.querySelector('.shop-gift')!;
    this.promoInput = this.root.querySelector('.shop-promo input')!;
    this.root.querySelector('.claw-close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
    // the apps sell through the stores only: no code fields there
    this.giftForm.hidden = !this.codes;
    this.root.querySelector<HTMLElement>('.shop-promo')!.hidden = !this.codes;
    this.giftForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.redeem();
    });
    // Typing a promo code can bring a product within the player's credit, so
    // re-price the list when the code changes (on blur/Enter, not per key).
    this.promoInput.addEventListener('change', () => {
      if (this.products.length) void this.render(this.products);
    });
    const mode = shopMode();
    this.root.querySelector('.shop-small')!.textContent =
      mode === 'web'
        ? 'Purchases are made in the beech app through the App Store or Google Play. What you buy is yours on every device you sign in on.'
        : mode === 'native'
          ? 'Paid through your App Store or Google Play account. What you buy is yours on every device you sign in on.'
          : 'Development build: purchases use a pretend store.';
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  async open(): Promise<void> {
    this.root.classList.add('open');
    this.note.textContent = 'Opening the shop…';
    this.list.innerHTML = '';
    void this.api.retryPending().then((n) => n && this.bought(''));
    try {
      const products = await this.api.products();
      this.note.textContent = shopMode() === 'web' ? 'Get these in the beech app:' : '';
      try {
        this.creditCents = this.codes ? await this.api.credit() : 0;
      } catch {
        this.creditCents = 0;
      }
      this.render(products);
    } catch (e) {
      this.note.textContent = (e as Error).message;
    }
  }

  private showCredit(): void {
    this.creditLine.textContent = this.creditCents > 0 ? `Your credit: $${(this.creditCents / 100).toFixed(2)} (from gift cards)` : '';
  }

  private promoCode(): string | undefined {
    const code = this.promoInput.value.trim();
    return code ? code : undefined;
  }

  private async redeem(): Promise<void> {
    const input = this.giftForm.querySelector('input')!;
    const code = input.value.trim();
    if (!code || this.busy) return;
    this.busy = true;
    try {
      const r = await this.api.redeemGiftCard(code);
      this.creditCents = r.creditCents;
      this.note.textContent = `Gift card redeemed: $${(r.creditedCents / 100).toFixed(2)} added to your credit.`;
      input.value = '';
      this.showCredit();
      this.render(this.products);
    } catch (e) {
      this.note.textContent = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }

  close(): void {
    this.root.classList.remove('open');
  }

  private async render(products: ShopProduct[]): Promise<void> {
    this.products = products;
    this.showCredit();
    this.list.innerHTML = '';
    const mode = shopMode();
    // A promo code can bring a product within the player's credit, so quote
    // each product with it and gate the credit button on the discounted
    // price. A quote that fails (bad code, wrong product) leaves that
    // product at full price.
    const promo = this.promoCode();
    const finals = new Map<string, number>();
    if (promo) {
      await Promise.all(
        products.map(async (p) => {
          try {
            finals.set(p.id, (await this.api.quote(p.id, promo)).finalCents);
          } catch {
            // leave the product at full price
          }
        }),
      );
    }
    for (const p of [...products].sort((a, b) => Number(b.featured) - Number(a.featured))) {
      const row = document.createElement('div');
      row.className = `shop-item${p.featured ? ' featured' : ''}`;
      const first = p.grants[0]?.item ?? 'bag';
      const what = p.grants.map((g) => `${g.quantity > 1 ? `${g.quantity} × ` : ''}${prizeName(g.item)}`).join(', ');
      row.innerHTML = `
        <div class="shop-icon">${icon(first as IconName)}</div>
        <div class="shop-text"><b></b><span class="shop-blurb"></span><span class="shop-what"></span></div>`;
      row.querySelector('b')!.textContent = p.featured ? `${p.name} · best value` : p.name;
      row.querySelector('.shop-blurb')!.textContent = p.blurb;
      row.querySelector('.shop-what')!.textContent = what;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shop-buy';
      btn.dataset.product = p.id;
      const price = p.price ?? `$${p.usd.toFixed(2)}`;
      if (mode === 'web') {
        btn.textContent = price;
        btn.title = 'Buy in the beech app';
        btn.addEventListener('click', () => this.getTheApp());
      } else {
        btn.textContent = price;
        btn.addEventListener('click', () => void this.buy(p, btn));
      }
      row.appendChild(btn);
      // credit from gift cards buys here too (on the web: the apps sell
      // through the stores only); the server prices it and checks the balance.
      // The button shows when the credit covers the price after the promo,
      // not the undiscounted price.
      const priceCents = finals.get(p.id) ?? Math.round(p.usd * 100);
      if (this.codes && this.creditCents >= priceCents) {
        const creditBtn = document.createElement('button');
        creditBtn.type = 'button';
        creditBtn.className = 'shop-buy shop-credit-buy';
        creditBtn.textContent = 'Buy with credit';
        creditBtn.addEventListener('click', () => void this.buyWithCredit(p, creditBtn));
        row.appendChild(creditBtn);
      }
      this.list.appendChild(row);
    }
  }

  private getTheApp(): void {
    const ua = navigator.userAgent;
    const link = /iPhone|iPad|Mac/.test(ua) ? APP_LINKS.ios || APP_LINKS.android : APP_LINKS.android || APP_LINKS.ios;
    if (link) window.open(link, '_blank', 'noopener');
    else this.note.textContent = 'Purchases are made in the beech app on iPhone and Android (coming to the stores soon).';
  }

  private async buy(p: ShopProduct, btn: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const label = btn.textContent;
    btn.textContent = '…';
    btn.disabled = true;
    try {
      const r = await this.api.buy(p.id);
      if (r === 'bought') {
        this.note.textContent = `${p.name}: added to your bag. Thank you!`;
        this.bought(p.id);
      }
    } catch (e) {
      this.note.textContent = (e as Error).message;
    } finally {
      this.busy = false;
      btn.textContent = label;
      btn.disabled = false;
    }
  }

  private async buyWithCredit(p: ShopProduct, btn: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const label = btn.textContent;
    btn.textContent = '…';
    btn.disabled = true;
    try {
      const promo = this.promoCode();
      const r = await this.api.buyWithCredit(p.id, promo);
      this.creditCents = r.creditCents;
      const saved = r.discountCents > 0 ? ` (promo saved $${(r.discountCents / 100).toFixed(2)})` : '';
      this.note.textContent = `${p.name}: added to your bag. Paid $${(r.paidCents / 100).toFixed(2)} with credit${saved}. Credit left: $${(r.creditCents / 100).toFixed(2)}.`;
      this.bought(p.id);
      this.render(this.products);
    } catch (e) {
      this.note.textContent = (e as Error).message;
    } finally {
      this.busy = false;
      btn.textContent = label;
      btn.disabled = false;
    }
  }
}
