import { APP_LINKS, shopMode, type ShopApi, type ShopProduct } from '../net/shop';
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
  private busy = false;

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
        <div class="shop-list"></div>
        <p class="shop-small"></p>
      </div>`;
    parent.appendChild(this.root);
    this.list = this.root.querySelector('.shop-list')!;
    this.note = this.root.querySelector('.shop-note')!;
    this.root.querySelector('.claw-close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
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
      this.render(products);
    } catch (e) {
      this.note.textContent = (e as Error).message;
    }
  }

  close(): void {
    this.root.classList.remove('open');
  }

  private render(products: ShopProduct[]): void {
    this.list.innerHTML = '';
    const mode = shopMode();
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
}
