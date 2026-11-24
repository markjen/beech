import type { PullApi, PullPool } from '../net/account';
import { itemById, prizeName, type Rarity } from '../world/items';
import { GUIDE_URL } from '../config';
import { itemIcon } from './hud';

/** Ball colours by rarity (UI only). */
const BALL: Record<string, string> = {
  common: '#f4c7b8',
  uncommon: '#a8d8a0',
  rare: '#8ec5e8',
  unique: '#c06fd6',
};
const RARITY_NAME: Record<string, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary', unique: 'One of a kind' };

type Phase = 'idle' | 'dispense' | 'open' | 'done';

/**
 * The vending machine: one free ball a day, from a set of items that
 * changes every week. The ball is drawn on the server (this week's set and
 * odds are in the guide on the website, GUIDE_URL#vending); the machine is
 * the fun part. Press the button, a ball
 * drops into the tray, and it opens to show what's inside.
 */
export class VendingMachine {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly btn: HTMLButtonElement;
  private readonly note: HTMLParagraphElement;
  private readonly reveal: HTMLDivElement;
  private pool: PullPool | null = null;
  private nextFree = 0;
  private phase: Phase = 'idle';
  private t = 0;
  private prize: { item: string; rarity: string } | null = null;
  private error = '';
  private raf = 0;
  private last = 0;
  private balls: { x: number; y: number; c: string }[] = [];
  private result: Promise<{ item: string; rarity: string } | null> | null = null;

  constructor(
    parent: HTMLElement,
    private readonly api: PullApi,
    /** called with a won item id (to refresh the bag and pick it up) */
    private readonly won: (item: string, place: boolean) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'vending';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Vending machine');
    this.root.innerHTML = `
      <div class="vending-card">
        <button type="button" class="vending-close" aria-label="Close">×</button>
        <h2>Vending machine</h2>
        <canvas width="300" height="300"></canvas>
        <button type="button" class="vending-go">Get a ball</button>
        <p class="vending-note"></p>
        <a class="guide-link" href="${GUIDE_URL}#vending" target="_blank" rel="noopener">this week’s set and odds</a>
        <div class="vending-reveal" hidden></div>
      </div>`;
    parent.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.btn = this.root.querySelector('.vending-go')!;
    this.note = this.root.querySelector('.vending-note')!;
    this.reveal = this.root.querySelector('.vending-reveal')!;
    this.root.querySelector('.vending-close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
    this.btn.addEventListener('click', () => this.dispense());
    // the balls behind the glass: colours weighted by the published odds
    const r = mulberry(11);
    const odds = { common: 0.6, uncommon: 0.25, rare: 0.12, unique: 0.03 };
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        const roll = r();
        const c = roll < odds.unique ? BALL.unique : roll < odds.unique + odds.rare ? BALL.rare : roll < odds.unique + odds.rare + odds.uncommon ? BALL.uncommon : BALL.common;
        this.balls.push({ x: 0.28 + col * 0.11, y: 0.24 + row * 0.13, c });
      }
    }
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  async open(): Promise<void> {
    this.root.classList.add('open');
    this.reset();
    this.loop(performance.now());
    try {
      const s = await this.api.status();
      this.pool = s.pools.find((p) => p.id === 'vending') ?? null;
      this.nextFree = this.pool?.nextFree ?? s.nextFree;
      this.error = '';
    } catch (e) {
      this.error = (e as Error).message;
    }
    this.renderInfo();
    this.btn.focus({ preventScroll: true });
  }

  close(): void {
    this.root.classList.remove('open');
    cancelAnimationFrame(this.raf);
  }

  private reset(): void {
    this.phase = 'idle';
    this.prize = null;
    this.result = null;
    this.reveal.hidden = true;
  }

  private renderInfo(): void {
    const free = !!this.pool?.free;
    this.btn.disabled = !free || this.phase !== 'idle';
    // status only: an error, or when the next ball is ready
    this.note.textContent = this.error || (this.pool && !free ? `Your next ball is in ${until(this.nextFree)}.` : '');
  }

  private dispense(): void {
    if (this.phase !== 'idle' || !this.pool?.free) return;
    this.phase = 'dispense';
    this.t = 0;
    this.btn.disabled = true;
    // ask the server now; the ball takes long enough to cover the wait
    this.result = this.api.pull('vending').then(
      (r) => {
        this.nextFree = r.nextFree;
        if (this.pool) this.pool.free = false;
        // the server never drops a vending ball (only the claw misses), but
        // the response shape allows it: say so rather than show nothing
        if (r.missed || !r.item || !r.rarity) {
          this.error = 'The ball got stuck. Try again tomorrow.';
          return null;
        }
        return { item: r.item, rarity: r.rarity };
      },
      (e: Error) => {
        this.error = e.message;
        return null;
      },
    );
    void this.result.then((p) => (this.prize = p));
  }

  private loop = (now: number) => {
    const dt = Math.min(0.25, (now - this.last) / 1000 || 0);
    this.last = now;
    this.step(dt);
    this.draw();
    if (this.isOpen) this.raf = requestAnimationFrame(this.loop);
  };

  private step(dt: number): void {
    this.t += dt;
    switch (this.phase) {
      case 'dispense':
        if (this.t > 1.1 && this.result) {
          // wait for the server before opening (usually long done)
          if (this.prize !== null || this.error) {
            this.phase = this.prize ? 'open' : 'done';
            this.t = 0;
            if (!this.prize) this.renderInfo();
          }
        }
        break;
      case 'open':
        if (this.t > 0.6) {
          this.phase = 'done';
          this.showPrize();
        }
        break;
    }
  }

  private showPrize(): void {
    const p = this.prize!;
    const placeable = !!itemById(p.item);
    this.reveal.hidden = false;
    this.reveal.className = `vending-reveal rarity-${p.rarity}`;
    this.reveal.innerHTML = `
      <div class="vending-prize">${itemIcon(p.item)}</div>
      <b>${prizeName(p.item)}</b>
      <span>${RARITY_NAME[p.rarity as Rarity] ?? p.rarity}</span>
      <button type="button" class="vending-place">${placeable ? 'Put it on the beach' : 'Keep it'}</button>`;
    this.reveal.querySelector('.vending-place')!.addEventListener('click', () => {
      this.close();
      this.won(p.item, placeable);
    });
    this.won(p.item, false);
    this.renderInfo();
  }

  private draw(): void {
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    // the machine body
    c.fillStyle = '#5a4a72';
    roundRect(c, 40, 16, W - 80, H - 32, 18);
    c.fill();
    c.fillStyle = '#6e5c88';
    roundRect(c, 48, 24, W - 96, 8, 4);
    c.fill();
    // the window, with the balls behind the glass
    c.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(c, 56, 44, W - 112, 130, 12);
    c.fill();
    for (const k of this.balls) ball(c, k.x * W, k.y * H, 12, k.c);
    // the tray
    c.fillStyle = 'rgba(46,40,78,0.35)';
    roundRect(c, 56, 196, W - 112, 56, 12);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.font = '12px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('PUSH', W / 2, 246);
    // the ball dropping into the tray
    if (this.prize && (this.phase === 'dispense' || this.phase === 'open' || this.phase === 'done')) {
      const fall = this.phase === 'dispense' ? Math.min(1, this.t / 1.1) : 1;
      // ease in, with a little bounce at the end
      const y = 60 + (224 - 60) * (fall < 0.8 ? fall * fall * 1.25 : 1 - (fall - 0.8) * 0.5);
      ball(c, W / 2, y, 14, BALL[this.prize.rarity] ?? BALL.common);
    }
  }
}

function ball(c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string): void {
  c.fillStyle = col;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.beginPath();
  c.arc(x - r * 0.3, y - r * 0.35, r * 0.28, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(46,40,78,0.25)';
  c.lineWidth = 1.5;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.stroke();
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function until(t: number): string {
  const m = Math.max(1, Math.round((t - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
