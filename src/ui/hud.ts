import './hud.css';

const ICONS = {
  undo: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7H5V3" /><path d="M5.6 7.2A8 8 0 1 1 4.3 14" /></svg>`,
  redo: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 7h4V3" /><path d="M18.4 7.2A8 8 0 1 0 19.7 14" /></svg>`,
  wave: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 14c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" /><path d="M2 19c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" opacity=".55"/></svg>`,
  calm: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13h18" /><path d="M5 18h14" opacity=".55"/></svg>`,
  dig: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15c3 3.5 13 3.5 16 0" /><path d="M7 15.5c2 1.6 8 1.6 10 0" opacity=".55"/><path d="M12 3v8" /><path d="M9.5 8.5 12 11l2.5-2.5" /></svg>`,
  build: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18" /><path d="M6 18l3.2-7h5.6L18 18" /><path d="M9.2 11V7.5h5.6V11" /><path d="M9.2 7.5V5.5M12 7.5V5.5M14.8 7.5V5.5" /></svg>`,
  smooth: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16c3-1.5 6-1.5 9 0s6 1.5 9 0" /><path d="M7 11.5c1.6-.8 3.4-.8 5 0" opacity=".55"/></svg>`,
  chair: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l3 9h7" /><path d="M10 13l-2 7M17 13l2 7" /><path d="M5 13h14" opacity=".55"/></svg>`,
  diorama: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l8 4.5-8 4.5-8-4.5z" /><path d="M4 8.5V14l8 4.5 8-4.5V8.5" /><path d="M12 13v5.5" /></svg>`,
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
  readonly toolGroup: HTMLDivElement;
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

    this.toolGroup = document.createElement('div');
    this.toolGroup.className = 'hud-tools';
    this.toolGroup.setAttribute('role', 'radiogroup');
    this.toolGroup.setAttribute('aria-label', 'Tool');
    right.appendChild(this.toolGroup);

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

  /** Small column of tool buttons above the undo button. */
  setTools(tools: { id: string; icon: IconName; label: string }[], current: string, pick: (id: string) => void): void {
    this.toolGroup.innerHTML = '';
    for (const t of tools) {
      const b = this.button(t.icon, t.label, 'hud-btn hud-tool');
      b.setAttribute('role', 'radio');
      b.dataset.tool = t.id;
      b.addEventListener('click', () => pick(t.id));
      this.toolGroup.appendChild(b);
    }
    this.setTool(current);
  }

  setTool(id: string): void {
    for (const b of this.toolGroup.querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.tool === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
  }

  setUndoState(undoCount: number, redoCount: number): void {
    this.undoBtn.classList.toggle('dim', undoCount === 0 && redoCount === 0);
    this.undoBtn.dataset.count = String(undoCount);
  }

  /** Tint the UI to match the current palette. */
  setColors(fg: string, bg: string): void {
    const r = document.documentElement.style;
    if (r.getPropertyValue('--ui-fg') === fg && r.getPropertyValue('--ui-bg') === bg) return;
    r.setProperty('--ui-fg', fg);
    r.setProperty('--ui-bg', bg);
  }
}
