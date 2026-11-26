// Copying a beach (docs/COPY_BEACH.md): a beach on the shore, or one of your
// own, onto one of your beaches or a new one. The sheet shows the beach, where
// it goes, the bag things it needs and whether you have them, and, when you're
// short: buy what's missing, or copy without them. Keeping it as a checkpoint
// needs nothing from the bag. Labels and status only (CLAUDE.md): how it works
// is in the web guide.

import { CopyChangedError, ShortError, type CopyApi, type CopyDone, type CopyFit, type MyBeach } from '../net/account';
import { decodeSand, fitWorld } from '../sim/sandCodec';
import { beachById } from '../world/locations';
import { itemById, prizeName } from '../world/items';
import { drawMap } from './beachFileDialog';

export type CopyTarget = string | 'new';
export type CopyMode = 'strict' | 'drop-missing';

export interface CopyHost {
  api: CopyApi;
  /** your beaches */
  beaches(): MyBeach[];
  /** the most beaches anyone can have */
  cap: number;
  /** how many beaches you may have now */
  allowance(): number;
  /** the beach of yours in front of you, if any */
  here(): string | null;
  /** the source's saved bytes, for the map (null: no map) */
  sand(code: string): Promise<Uint8Array | null>;
  /** save a beach of yours before it's replaced */
  flush(id: string): Promise<void>;
  /** buy one of a product. 'away': the page is leaving for a checkout */
  /** buy the basket with sand bucks, in one go (docs/SAND_BUCKS.md) */
  buyBasket(lines: { product: string; quantity: number }[]): Promise<void>;
  /** not enough sand bucks: open the shop at the packs, remembering the copy to come back to */
  getBucks(p: { code: string; target: CopyTarget; mode: CopyMode }): void;
  /** it's copied: go there, reload what changed, offer Undo */
  copied(done: CopyDone, target: CopyTarget, fit: CopyFit): Promise<void>;
  /** kept as a checkpoint */
  kept(name: string): Promise<void>;
  toast(text: string): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const bucks = (n: number) => `${n} sand bucks`;
const isFree = (id: string) => itemById(id)?.unlimited === true;
const beachLabel = (b: MyBeach) => b.name || (b.home ? 'Home' : 'Beach');

export class CopySheet {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private code = '';
  private target: CopyTarget = 'new';
  private fit: CopyFit | null = null;
  private status = '';
  private busy = false;
  private mapFor = '';
  /** the target was picked by hand */
  private picked = false;

  constructor(
    parent: HTMLElement,
    private readonly host: CopyHost,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'claw beachfile copybeach';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Copy a beach');
    this.root.innerHTML = `
      <div class="claw-card shop-card beachfile-card">
        <button type="button" class="claw-close" aria-label="Close">×</button>
        <h2>Copy a beach</h2>
        <canvas class="beachfile-map" width="160" height="160" aria-label="Map of the beach, sea at the bottom"></canvas>
        <div class="beachfile-body copy-body"></div>
      </div>`;
    parent.appendChild(this.root);
    this.title = this.root.querySelector('h2')!;
    this.body = this.root.querySelector('.copy-body')!;
    this.root.querySelector('.claw-close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  /** Open the sheet for the beach with `code`; `target` defaults to a new beach when there's room. */
  async open(code: string, target?: CopyTarget): Promise<void> {
    this.code = code;
    this.picked = !!target;
    this.status = '';
    this.fit = null;
    this.root.classList.add('open');
    const mine = this.host.beaches();
    const own = mine.find((b) => b.code === code);
    this.target = target ?? this.defaultTarget(own?.id);
    this.title.textContent = 'Copy a beach';
    this.body.innerHTML = '<p class="shop-note">Looking at the beach…</p>';
    await this.refit();
    void this.drawMap();
  }

  close(): void {
    this.root.classList.remove('open');
  }

  /** a new beach if there's room, else the beach of yours in view, else your home */
  private defaultTarget(except?: string): CopyTarget {
    const mine = this.host.beaches().filter((b) => b.id !== except);
    const here = this.host.here();
    const allowance = this.fit?.allowance ?? this.host.allowance();
    if (this.host.beaches().length < Math.min(allowance, this.host.cap)) return 'new';
    return mine.find((b) => b.id === here)?.id ?? mine.find((b) => b.home)?.id ?? mine[0]?.id ?? 'new';
  }

  private async refit(): Promise<void> {
    try {
      this.fit = await this.host.api.fit(this.code, this.target);
      // first look: no room for a new beach? start on one of yours (picking "+ a new beach" offers to buy one)
      if (this.target === 'new' && !this.fit.room && !this.picked) {
        this.target = this.defaultTarget(this.ownId());
        if (this.target !== 'new') this.fit = await this.host.api.fit(this.code, this.target);
      }
      this.render();
    } catch (e) {
      this.fit = null;
      this.body.innerHTML = `<p class="shop-note">${esc((e as Error).message)}</p>`;
    }
  }

  private ownId(): string | undefined {
    return this.host.beaches().find((b) => b.code === this.code)?.id;
  }

  private async drawMap(): Promise<void> {
    const canvas = this.root.querySelector<HTMLCanvasElement>('.beachfile-map')!;
    if (this.mapFor === this.code) return;
    const code = this.code;
    canvas.hidden = true;
    try {
      const bytes = await this.host.sand(code);
      if (!bytes || this.code !== code) return;
      const b = fitWorld(await decodeSand(bytes));
      drawMap(canvas, b, b.objects);
      canvas.hidden = false;
      this.mapFor = code;
    } catch {
      /* no map: the beach is in view behind the sheet anyway */
    }
  }

  /** what the bag lacks, as the sheet shows it */
  private rows(f: CopyFit): string {
    const out: string[] = [];
    const items = Object.entries(f.need)
      .filter(([id, n]) => n > 0 && !isFree(id))
      .sort(([a], [b]) => (prizeName(a) < prizeName(b) ? -1 : 1));
    for (const [id, n] of items) {
      const short = f.short.find((s) => s.item === id);
      let state = '✓';
      if (short) {
        const missing = short.need - short.have;
        const line = f.basket.lines.find((l) => l.item === id);
        const placed = (f.elsewhere[id] ?? 0) > 0 && (f.owned[id] ?? 0) > 0 ? ' · on your other beaches' : '';
        state = `${missing} short${placed} · ${line ? bucks(line.bucks * line.quantity) : 'not in shop'}`;
      }
      out.push(`<li class="${short ? 'short' : ''}"><span>${esc(prizeName(id))} × ${n}</span><span>${esc(state)}</span></li>`);
    }
    const bag = items.reduce((t, [, n]) => t + n, 0);
    const free = Math.max(0, f.objects - bag);
    if (free) out.push(`<li class="free"><span>+ ${free} rocks, shells and more</span><span>✓</span></li>`);
    if (!out.length) out.push('<li class="free"><span>Just sand</span><span>✓</span></li>');
    return `<ul class="copy-items">${out.join('')}</ul>`;
  }

  private render(): void {
    const f = this.fit;
    if (!f) return;
    const title = f.name || `${f.owner ?? 'Someone'}’s beach`;
    this.title.textContent = `Copy “${title}”`;
    const place = f.location ? beachById(f.location)?.name : undefined;
    const by = [f.yours ? 'yours' : f.owner, place].filter(Boolean).join(' · ');
    const mine = this.host.beaches().filter((b) => b.code !== this.code);
    const canNew = f.beaches < this.host.cap;
    const pills = mine
      .map(
        (b) =>
          `<button type="button" class="beach-pill${this.target === b.id ? ' on' : ''}" data-act="copy-target-${b.id}" data-target="${b.id}">${b.home ? '⌂ ' : ''}${esc(beachLabel(b))}</button>`,
      )
      .concat(canNew ? [`<button type="button" class="beach-pill add${this.target === 'new' ? ' on' : ''}" data-act="copy-target-new" data-target="new">+ a new beach</button>`] : [])
      .join('');
    const shortItems = f.short.length;
    const lines = f.basket.lines;
    const buyable = lines.filter((l) => l.item !== 'beach').length;
    const noRoom = this.target === 'new' && !f.room;
    const left = f.short.reduce((t, s) => t + (s.need - s.have), 0);
    const actions: string[] = [];
    if (!shortItems && !noRoom) {
      const t = mine.find((b) => b.id === this.target);
      actions.push(`<button type="button" class="claw-go" data-act="copy-go">${t ? `Replace ${esc(beachLabel(t))}` : 'Copy'}</button>`);
    } else {
      if (lines.length) {
        const all = buyable === shortItems;
        actions.push(
          `<button type="button" class="claw-go" data-act="copy-buy">${all || !shortItems ? 'Buy what’s missing' : `Buy the ${buyable} you can`} · ${bucks(f.basket.bucks)}</button>`,
        );
      }
      if (shortItems && !noRoom) actions.push(`<button type="button" class="shop-buy" data-act="copy-drop">Copy without them (${left} left out)</button>`);
    }
    this.body.innerHTML = `
      <p class="shop-note">${esc(by)}</p>
      <div class="copy-onto"><span>Onto</span>${pills}</div>
      ${this.rows(f)}
      ${lines.length ? `<p class="copy-status">${esc(bucks(f.bucks))}</p>` : ''}
      ${this.status ? `<p class="copy-status" role="status">${esc(this.status)}</p>` : ''}
      <div class="beachfile-actions">${actions.join('')}</div>
      <button type="button" class="action beachfile-keep" data-act="copy-keep">keep it as a checkpoint</button>`;
    this.body.querySelectorAll<HTMLButtonElement>('[data-target]').forEach((b) =>
      b.addEventListener('click', () => {
        if (this.busy) return;
        this.target = b.dataset.target!;
        this.picked = true;
        this.status = '';
        void this.refit();
      }),
    );
    this.body.querySelector('[data-act="copy-go"]')?.addEventListener('click', () => void this.copy('strict'));
    this.body.querySelector('[data-act="copy-drop"]')?.addEventListener('click', () => void this.copy('drop-missing'));
    this.body.querySelector('[data-act="copy-buy"]')?.addEventListener('click', () => void this.buy());
    this.body.querySelector('[data-act="copy-keep"]')?.addEventListener('click', () => void this.keep());
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.body.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      await fn();
    } catch (e) {
      this.status = (e as Error).message;
      if (this.isOpen) this.render();
    } finally {
      this.busy = false;
      this.body.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  }

  private async copy(mode: CopyMode): Promise<void> {
    const f = this.fit;
    if (!f) return;
    const t = this.host.beaches().find((b) => b.id === this.target);
    if (t && !window.confirm(`Replace ${beachLabel(t)} with “${f.name || f.code}”?`)) return;
    await this.run(async () => {
      const target = this.target;
      let fit = f;
      const go = () => this.host.api.copy({ from: this.code, version: fit.version, target, mode });
      if (t) await this.host.flush(t.id);
      let done: CopyDone;
      try {
        done = await go();
      } catch (e) {
        if (e instanceof CopyChangedError) {
          // a newer save (or the sea catching up): if it still asks the same of your bag, go ahead
          const again = await this.host.api.fit(this.code, target);
          const same = JSON.stringify(again.short) === JSON.stringify(fit.short);
          this.fit = fit = again;
          if (!same) {
            this.status = 'This beach just changed';
            this.render();
            return;
          }
          done = await go();
        } else if (e instanceof ShortError) {
          this.fit = await this.host.api.fit(this.code, target);
          this.status = 'Your bag changed';
          this.render();
          return;
        } else throw e;
      }
      this.close();
      await this.host.copied(done, target, fit);
    });
  }

  private async buy(): Promise<void> {
    const f = this.fit;
    if (!f) return;
    // not enough sand bucks: get some first, then come back here
    if (f.bucks < f.basket.bucks) {
      this.host.getBucks({ code: this.code, target: this.target, mode: 'strict' });
      return;
    }
    await this.run(async () => {
      await this.host.buyBasket(f.basket.lines.map((l) => ({ product: l.product, quantity: l.quantity })));
      await this.after(1);
    });
  }

  /** after buying: look again (the button turns to Copy once nothing buyable is short) */
  private async after(bought: number): Promise<void> {
    this.fit = await this.host.api.fit(this.code, this.target);
    this.status = bought ? 'In your bag' : '';
    this.render();
  }

  private async keep(): Promise<void> {
    const f = this.fit;
    if (!f) return;
    await this.run(async () => {
      try {
        const cp = await this.host.api.keep(this.code, f.version);
        this.close();
        await this.host.kept(cp.name);
      } catch (e) {
        if (!(e instanceof CopyChangedError)) throw e;
        this.fit = await this.host.api.fit(this.code, this.target);
        const cp = await this.host.api.keep(this.code, this.fit.version);
        this.close();
        await this.host.kept(cp.name);
      }
    });
  }
}

/** A copy waiting on a web checkout (docs/COPY_BEACH.md): reopened when the payment comes back. */
export interface PendingCopy {
  code: string;
  target: CopyTarget;
  mode: CopyMode;
  at: number;
}
const PENDING_KEY = 'beech.pendingCopy';
const PENDING_MS = 24 * 60 * 60 * 1000;

export function rememberCopy(p: Omit<PendingCopy, 'at'>, now = Date.now()): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ ...p, at: now }));
  } catch {
    /* private mode: the copy just won't reopen by itself */
  }
}

/** the copy waiting on a checkout, if any (taken: it's forgotten once read) */
export function takePendingCopy(now = Date.now()): PendingCopy | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    localStorage.removeItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingCopy;
    if (typeof p.code !== 'string' || typeof p.at !== 'number' || now - p.at > PENDING_MS) return null;
    return p;
  } catch {
    return null;
  }
}

