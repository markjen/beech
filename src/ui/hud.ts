import './hud.css';

const ICONS = {
  undo: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7H5V3" /><path d="M5.6 7.2A8 8 0 1 1 4.3 14" /></svg>`,
  redo: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 7h4V3" /><path d="M18.4 7.2A8 8 0 1 0 19.7 14" /></svg>`,
  wave: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 14c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" /><path d="M2 19c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" opacity=".55"/></svg>`,
  calm: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13h18" /><path d="M5 18h14" opacity=".55"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></svg>`,
};

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): string {
  return ICONS[name];
}

export interface HudHandlers {
  undo(): void;
  redo(): void;
}

/** The few round buttons over the canvas. */
export class Hud {
  readonly root: HTMLDivElement;
  readonly undoBtn: HTMLButtonElement;
  readonly leftGroup: HTMLDivElement;
  private pressTimer = 0;
  private longPressed = false;

  constructor(parent: HTMLElement, private readonly h: HudHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    parent.appendChild(this.root);

    this.leftGroup = document.createElement('div');
    this.leftGroup.className = 'hud-group hud-left';
    this.root.appendChild(this.leftGroup);

    const right = document.createElement('div');
    right.className = 'hud-group hud-right';
    this.root.appendChild(right);

    this.undoBtn = this.button('undo', 'Undo (hold to redo)', 'hud-btn hud-big');
    right.appendChild(this.undoBtn);
    this.undoBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.longPressed = false;
      this.undoBtn.classList.add('pressed');
      this.pressTimer = window.setTimeout(() => {
        this.longPressed = true;
        this.flash(this.undoBtn, 'redo');
        this.h.redo();
      }, 480);
    });
    const release = (fire: boolean) => {
      window.clearTimeout(this.pressTimer);
      this.undoBtn.classList.remove('pressed');
      if (fire && !this.longPressed) {
        this.flash(this.undoBtn, 'undo');
        this.h.undo();
      }
      this.longPressed = false;
    };
    this.undoBtn.addEventListener('pointerup', () => release(true));
    this.undoBtn.addEventListener('pointerleave', () => release(false));
    this.undoBtn.addEventListener('pointercancel', () => release(false));
    this.undoBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.h.undo();
      }
    });
  }

  button(name: IconName, label: string, cls = 'hud-btn'): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = cls;
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = icon(name);
    return b;
  }

  setIcon(b: HTMLButtonElement, name: IconName): void {
    b.innerHTML = icon(name);
  }

  private flash(b: HTMLButtonElement, name: IconName) {
    this.setIcon(b, name);
    b.classList.remove('flash');
    void b.offsetWidth;
    b.classList.add('flash');
    window.setTimeout(() => this.setIcon(b, 'undo'), 450);
  }

  setUndoState(undoCount: number, redoCount: number): void {
    this.undoBtn.classList.toggle('dim', undoCount === 0 && redoCount === 0);
    this.undoBtn.dataset.count = String(undoCount);
  }

  /** Tint the UI to match the current palette. */
  setColors(fg: string, bg: string): void {
    this.root.style.setProperty('--ui-fg', fg);
    this.root.style.setProperty('--ui-bg', bg);
  }
}
