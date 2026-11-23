import type { PullApi, PullPool } from '../net/account';
import { extraById, itemById, prizeName, type Rarity } from '../world/items';
import { icon, type IconName } from './hud';

/** Capsule colours by rarity (UI only). */
const CAPSULE: Record<string, string> = {
  common: '#f4c7b8',
  rare: '#8ec5e8',
  legendary: '#f2c45a',
};
const RARITY_NAME: Record<string, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary', unique: 'One of a kind' };

type Phase = 'idle' | 'drop' | 'grab' | 'lift' | 'carry' | 'open' | 'done';

/**
 * The claw machine: free goes, with a rest between them that starts at
 * 5 minutes and doubles each go, up to a day. The prize is drawn on the server
 * (with the odds printed under the machine); the claw is the fun part. Hold
 * the button to steer, let go to drop, and it always comes back with a
 * capsule.
 */
export class ClawMachine {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly btn: HTMLButtonElement;
  private readonly note: HTMLParagraphElement;
  private readonly oddsEl: HTMLDivElement;
  private readonly reveal: HTMLDivElement;
  private pool: PullPool | null = null;
  private nextFree = 0;
  private phase: Phase = 'idle';
  private t = 0;
  private clawX = 0.6;
  private clawY = 0.12;
  private dir = 1;
  private prize: { item: string; rarity: string } | null = null;
  private error = '';
  private raf = 0;
  private last = 0;
  private capsules: { x: number; y: number; c: string }[] = [];
  private result: Promise<{ item: string; rarity: string } | null> | null = null;

  constructor(
    parent: HTMLElement,
    private readonly api: PullApi,
    /** called with a won item id (to refresh the bag and pick it up) */
    private readonly won: (item: string, place: boolean) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'claw';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Claw machine');
    this.root.innerHTML = `
      <div class="claw-card">
        <button type="button" class="claw-close" aria-label="Close">×</button>
        <h2>Claw machine</h2>
        <canvas width="300" height="300"></canvas>
        <button type="button" class="claw-go">Drop the claw</button>
        <p class="claw-note"></p>
        <div class="claw-odds"></div>
        <div class="claw-reveal" hidden></div>
      </div>`;
    parent.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.btn = this.root.querySelector('.claw-go')!;
    this.note = this.root.querySelector('.claw-note')!;
    this.oddsEl = this.root.querySelector('.claw-odds')!;
    this.reveal = this.root.querySelector('.claw-reveal')!;
    this.root.querySelector('.claw-close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
    this.btn.addEventListener('click', () => this.drop());
    // a pile of capsules
    const r = mulberry(7);
    for (let i = 0; i < 26; i++) {
      const roll = r();
      this.capsules.push({ x: 0.32 + r() * 0.58, y: 0.72 + r() * 0.2, c: roll < 0.08 ? CAPSULE.legendary : roll < 0.35 ? CAPSULE.rare : CAPSULE.common });
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
      this.pool = s.pools.find((p) => p.id === 'daily') ?? null;
      this.nextFree = s.nextFree;
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
    this.clawY = 0.12;
    this.reveal.hidden = true;
  }

  private renderInfo(): void {
    const free = !!this.pool?.free;
    this.btn.disabled = !free || this.phase !== 'idle';
    if (this.error) this.note.textContent = this.error;
    else if (!this.pool) this.note.textContent = '';
    else if (free) this.note.textContent = `A free go! After it the claw rests ${duration(this.pool.nextCooldown)}.`;
    else this.note.textContent = `Your next free go is in ${until(this.nextFree)}.`;
    if (!this.pool) {
      this.oddsEl.innerHTML = '';
      return;
    }
    const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
    const rows = (['common', 'rare', 'legendary'] as const)
      .map((k) => {
        const names = this.pool!.items[k].map((id) => itemById(id)?.name ?? id).join(', ');
        return `<li><span class="dot" style="background:${CAPSULE[k]}"></span><b>${RARITY_NAME[k]} ${pct(this.pool!.odds[k])}</b> ${names}</li>`;
      })
      .join('');
    this.oddsEl.innerHTML = `<p>What's inside, and the chance of each:</p><ul>${rows}</ul>`;
  }

  private drop(): void {
    if (this.phase !== 'idle' || !this.pool?.free) return;
    this.phase = 'drop';
    this.t = 0;
    this.btn.disabled = true;
    // ask the server now; the claw takes long enough to cover the wait
    this.result = this.api.pull('daily').then(
      (r) => {
        this.nextFree = r.nextFree;
        if (this.pool) this.pool.free = false;
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
      case 'idle':
        // the claw wanders along its rail
        this.clawX += this.dir * dt * 0.28;
        if (this.clawX > 0.84 || this.clawX < 0.36) this.dir *= -1;
        break;
      case 'drop':
        this.clawY += dt * 0.55;
        if (this.clawY >= 0.68) {
          this.phase = 'grab';
          this.t = 0;
        }
        break;
      case 'grab':
        if (this.t > 0.5 && this.result) {
          // wait for the server before lifting (usually long done)
          if (this.prize !== null || this.error) {
            this.phase = this.prize ? 'lift' : 'done';
            this.t = 0;
            if (!this.prize) this.renderInfo();
          }
        }
        break;
      case 'lift':
        this.clawY -= dt * 0.5;
        if (this.clawY <= 0.12) {
          this.clawY = 0.12;
          this.phase = 'carry';
        }
        break;
      case 'carry':
        this.clawX -= dt * 0.45;
        if (this.clawX <= 0.12) {
          this.clawX = 0.12;
          this.phase = 'open';
          this.t = 0;
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
    const extra = extraById(p.item);
    this.reveal.hidden = false;
    this.reveal.className = `claw-reveal rarity-${p.rarity}`;
    this.reveal.innerHTML = `
      <div class="claw-prize">${icon(p.item as IconName)}</div>
      <b>${prizeName(p.item)}</b>
      <span>${RARITY_NAME[p.rarity as Rarity] ?? p.rarity}</span>
      ${extra ? `<p class="claw-extra"></p>` : ''}
      <button type="button" class="claw-place">${placeable ? 'Put it on the beach' : 'Keep it'}</button>`;
    if (extra) this.reveal.querySelector('.claw-extra')!.textContent = extra.note;
    this.reveal.querySelector('.claw-place')!.addEventListener('click', () => {
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
    // the glass box
    c.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(c, 10, 10, W - 20, H - 20, 18);
    c.fill();
    // prize chute (bottom left)
    c.fillStyle = 'rgba(46,40,78,0.15)';
    roundRect(c, 18, H * 0.62, W * 0.18, H * 0.3, 8);
    c.fill();
    // capsules
    for (const k of this.capsules) capsule(c, k.x * W, k.y * H, 13, k.c);
    // rail and claw
    const x = this.clawX * W;
    const y = this.clawY * H;
    c.strokeStyle = 'rgba(46,40,78,0.55)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(20, H * 0.1);
    c.lineTo(W - 20, H * 0.1);
    c.moveTo(x, H * 0.1);
    c.lineTo(x, y);
    c.stroke();
    const shut = this.phase === 'grab' ? Math.min(1, this.t * 3) : this.phase === 'lift' || this.phase === 'carry' ? 1 : this.phase === 'open' ? 1 - Math.min(1, this.t * 3) : 0;
    const spread = 16 - shut * 9;
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x - spread, y + 14);
    c.lineTo(x - spread + 5, y + 24);
    c.moveTo(x, y);
    c.lineTo(x + spread, y + 14);
    c.lineTo(x + spread - 5, y + 24);
    c.stroke();
    // the capsule it's carrying
    if (this.prize && (this.phase === 'lift' || this.phase === 'carry')) capsule(c, x, y + 24, 13, CAPSULE[this.prize.rarity] ?? CAPSULE.common);
    if (this.prize && (this.phase === 'open' || this.phase === 'done')) {
      const fall = Math.min(1, this.t * 2);
      capsule(c, W * 0.12 + 14, H * (0.2 + fall * 0.55), 13, CAPSULE[this.prize.rarity] ?? CAPSULE.common);
    }
  }
}

function capsule(c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string): void {
  c.fillStyle = col;
  c.beginPath();
  c.arc(x, y, r, Math.PI, 0);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI);
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

/** 5 min, 1 h 20 min, 1 day */
function duration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m >= 1440) return '1 day';
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
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
