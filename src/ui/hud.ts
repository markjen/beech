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
  bag: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14l-1.2 10.5a1.5 1.5 0 0 1-1.5 1.3H7.7a1.5 1.5 0 0 1-1.5-1.3z" /><path d="M9 9V7a3 3 0 0 1 6 0v2" /></svg>`,
  rock: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 18.5l2.2-6.3 4.6-4.4 5.6 1.1 3.6 4.4 1 5.2z" /><path d="M10.3 7.8l1.4 5.2 4.2-3.9M11.7 13l-6-0.8" opacity=".55"/></svg>`,
  driftwood: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15.5c4-1.8 10-3.2 18-4" /><path d="M3.6 18.2c4.4-1.6 10.4-3 17-3.9" /><path d="M3 15.5l.6 2.7M21 11.5l-.4 2.8" /><path d="M12 13.6l2.5-3.6" opacity=".55"/></svg>`,
  shell: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19.5L4 10a8.5 8.5 0 0 1 16 0z" /><path d="M12 19.5L8.2 6.3M12 19.5l3.8-13.2M12 19.5V5.2" opacity=".55"/><path d="M10 19.5h4" /></svg>`,
  seaglass: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14.5l2.5-6 6.5-2 4 4.5-1.5 6-6.5 2.5z" /><path d="M8.5 8.5l3 4 5.5-2M11.5 12.5L11 19" opacity=".55"/></svg>`,
  flag: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21V3.5" /><path d="M7 4l11 3.5L7 11" /><path d="M4 21h6" opacity=".55"/></svg>`,
  left: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" /></svg>`,
  right: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" /></svg>`,
  claw: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16" /><path d="M12 3v6" /><path d="M12 9l-4 3.5 1 3M12 9l4 3.5-1 3" /><circle cx="12" cy="18.5" r="2.5" /></svg>`,
  conch: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 13.5c3-5 9-7.5 17-6.5-1.5 5.5-6 10-12.5 10.5-2.5.2-4.5-1.5-4.5-4z" /><path d="M8 11.5c2 .5 3 2.5 2.5 5M12.5 9.5c1.5 1 2 3 1.5 5.5" opacity=".55"/></svg>`,
  sanddollar: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 6.5v3.5M12 12l3.5-2M12 12l-3.5-2M12 12l2.2 3.6M12 12l-2.2 3.6" opacity=".6"/></svg>`,
  starfish: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.4 6.2 6.6.4-5.1 4.2 1.7 6.4L12 16.4 6.4 20l1.7-6.4L3 9.4l6.6-.4z" /></svg>`,
  bottle: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 15.5l9-9 2.5.5 2-2 2 2-2 2 .5 2.5-9 9a2 2 0 0 1-2.8 0l-2.2-2.2a2 2 0 0 1 0-2.8z" /><path d="M8 13l3 3" opacity=".55"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></svg>`,
};

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): string {
  return ICONS[name] ?? ICONS.bag;
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
