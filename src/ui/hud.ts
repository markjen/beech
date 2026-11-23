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
  gift: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.5h17v2.5h-17z" /><path d="M5.5 11h13v8.5h-13z" /><path d="M12 8.5V19.5" /><path d="M12 8.5C9.5 8.5 8 7.5 8 6c0-1.6 2-2 4 2.5zM12 8.5c2.5 0 4-1 4-2.5 0-1.6-2-2-4 2.5z" /></svg>`,
  rock: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 18.5l2.2-6.3 4.6-4.4 5.6 1.1 3.6 4.4 1 5.2z" /><path d="M10.3 7.8l1.4 5.2 4.2-3.9M11.7 13l-6-0.8" opacity=".55"/></svg>`,
  driftwood: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15.5c4-1.8 10-3.2 18-4" /><path d="M3.6 18.2c4.4-1.6 10.4-3 17-3.9" /><path d="M3 15.5l.6 2.7M21 11.5l-.4 2.8" /><path d="M12 13.6l2.5-3.6" opacity=".55"/></svg>`,
  shell: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19.5L4 10a8.5 8.5 0 0 1 16 0z" /><path d="M12 19.5L8.2 6.3M12 19.5l3.8-13.2M12 19.5V5.2" opacity=".55"/><path d="M10 19.5h4" /></svg>`,
  seaglass: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14.5l2.5-6 6.5-2 4 4.5-1.5 6-6.5 2.5z" /><path d="M8.5 8.5l3 4 5.5-2M11.5 12.5L11 19" opacity=".55"/></svg>`,
  flag: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21V3.5" /><path d="M7 4l11 3.5L7 11" /><path d="M4 21h6" opacity=".55"/></svg>`,
  left: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" /></svg>`,
  right: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" /></svg>`,
  claw: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16" /><path d="M12 3v6" /><path d="M12 9l-4 3.5 1 3M12 9l4 3.5-1 3" /><circle cx="12" cy="18.5" r="2.5" /></svg>`,
  vending: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2.5" width="14" height="19" rx="2" /><path d="M8 6h8v6H8z" /><circle cx="10.2" cy="9" r="1.4" /><circle cx="13.8" cy="9" r="1.4" /><path d="M8 18.5h8" /></svg>`,
  // Week 1 vending set: variants reuse their kind's drawing; the name and
  // rarity ring are what set them apart in the bag.
  'pink-shell': `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19.5L4 10a8.5 8.5 0 0 1 16 0z" /><path d="M12 19.5L8.2 6.3M12 19.5l3.8-13.2M12 19.5V5.2" opacity=".55"/><path d="M10 19.5h4" /></svg>`,
  'blue-seaglass': `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14.5l2.5-6 6.5-2 4 4.5-1.5 6-6.5 2.5z" /><path d="M8.5 8.5l3 4 5.5-2M11.5 12.5L11 19" opacity=".55"/></svg>`,
  pebble: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 18.5l2.2-6.3 4.6-4.4 5.6 1.1 3.6 4.4 1 5.2z" /><path d="M10.3 7.8l1.4 5.2 4.2-3.9M11.7 13l-6-0.8" opacity=".55"/></svg>`,
  'spiral-conch': `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 13.5c3-5 9-7.5 17-6.5-1.5 5.5-6 10-12.5 10.5-2.5.2-4.5-1.5-4.5-4z" /><path d="M8 11.5c2 .5 3 2.5 2.5 5M12.5 9.5c1.5 1 2 3 1.5 5.5" opacity=".55"/></svg>`,
  'gold-sanddollar': `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 6.5v3.5M12 12l3.5-2M12 12l-3.5-2M12 12l2.2 3.6M12 12l-2.2 3.6" opacity=".6"/></svg>`,
  'sunset-starfish': `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.4 6.2 6.6.4-5.1 4.2 1.7 6.4L12 16.4 6.4 20l1.7-6.4L3 9.4l6.6-.4z" /></svg>`,
  'green-bottle': `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 15.5l9-9 2.5.5 2-2 2 2-2 2 .5 2.5-9 9a2 2 0 0 1-2.8 0l-2.2-2.2a2 2 0 0 1 0-2.8z" /><path d="M8 13l3 3" opacity=".55"/></svg>`,
  nautilus: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 12m-5.5 0a5.5 5.5 0 1 1 5.5 5.5 3.5 3.5 0 1 1-3.5-3.5 2 2 0 1 1 2 2" opacity=".6"/></svg>`,
  conch: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 13.5c3-5 9-7.5 17-6.5-1.5 5.5-6 10-12.5 10.5-2.5.2-4.5-1.5-4.5-4z" /><path d="M8 11.5c2 .5 3 2.5 2.5 5M12.5 9.5c1.5 1 2 3 1.5 5.5" opacity=".55"/></svg>`,
  sanddollar: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 6.5v3.5M12 12l3.5-2M12 12l-3.5-2M12 12l2.2 3.6M12 12l-2.2 3.6" opacity=".6"/></svg>`,
  starfish: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.4 6.2 6.6.4-5.1 4.2 1.7 6.4L12 16.4 6.4 20l1.7-6.4L3 9.4l6.6-.4z" /></svg>`,
  bottle: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 15.5l9-9 2.5.5 2-2 2 2-2 2 .5 2.5-9 9a2 2 0 0 1-2.8 0l-2.2-2.2a2 2 0 0 1 0-2.8z" /><path d="M8 13l3 3" opacity=".55"/></svg>`,
  hand: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12.5V5.8a1.4 1.4 0 0 1 2.8 0V11" /><path d="M10.8 10.5V4.4a1.4 1.4 0 0 1 2.8 0v6.1" /><path d="M13.6 10.6V5.6a1.4 1.4 0 0 1 2.8 0v6.4" /><path d="M16.4 9.4a1.4 1.4 0 0 1 2.8 0V14a7 7 0 0 1-7 7h-.6a6 6 0 0 1-4.7-2.3L4 15.4a1.5 1.5 0 0 1 2.2-2l1.8 1.8" /></svg>`,
  dozer: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.5h11" /><circle cx="5.5" cy="17.5" r="2" /><circle cx="11.5" cy="17.5" r="2" /><path d="M4 15.5v-4h6l2 4" /><path d="M6.5 11.5V8.5h3" /><path d="M14 15.5l4-1.5M18 10v8l3 1" /></svg>`,
  blade: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14h18" /><path d="M12 14V6" /><path d="M9 9l3-3 3 3" /></svg>`,
  vacuum: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="17" r="3.5" /><path d="M10 14.5c3-.8 5-2.8 6.2-5.5" /><path d="M16.2 9L20 6.5 19 10z" /></svg>`,
  deckchair: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 20l4.5-9.5L17 5" /><path d="M8.5 15h8l2.5 5" /><path d="M10.5 10.5c2 1 4 3 6 4.5" opacity=".55"/></svg>`,
  beach: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 16.5c3.5-3 15.5-3 19 0" /><path d="M2.5 19.5c3-1.4 6-1.4 9.5 0s6.5 1.4 9.5 0" opacity=".55"/><path d="M12 13V6" /><path d="M12 6c-2.8 0-5 1.5-6 3.5h12C17 7.5 14.8 6 12 6z" /></svg>`,
  parasol: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11a9 7 0 0 1 18 0z" /><path d="M12 11v10M12 4v1" /><path d="M9 11c0-3 1.2-5.5 3-6.5 1.8 1 3 3.5 3 6.5" opacity=".55"/></svg>`,
  surfboard: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c3 3 3.6 9.5 2.2 15.5L12 21.5 9.8 18C8.4 12 9 5.5 12 2.5z" /><path d="M10 12h4" opacity=".55"/><path d="M4 21.5h16" /></svg>`,
  sandcastle: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18" /><path d="M5 20v-8h3v-2h2v2h4v-2h2v2h3v8" /><path d="M9 20v-4h6v4" /><path d="M12 10V4l3 1.2L12 6.4" /></svg>`,
  beachhut: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10l9-6 9 6" /><path d="M5 9v10h14V9" /><path d="M10 19v-6h4v6" /><path d="M5 21v-2M19 21v-2" opacity=".55"/></svg>`,
  lighthouse: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 21l1-12h3l1 12z" /><path d="M10 7h4v2h-4zM11 5l1-1.5L13 5" /><path d="M4 6l4 1.5M20 6l-4 1.5" opacity=".55"/><path d="M10.2 14h3.6" opacity=".55"/></svg>`,
  tikitorch: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22V10" /><path d="M9.5 10h5l-.8-2.5h-3.4z" /><path d="M12 7.5c-1.8-1.5-.6-3.5 0-5 .6 1.5 1.8 3.5 0 5z" /></svg>`,
  share: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11" /><path d="M7.5 8 12 3.5 16.5 8" /><path d="M5 12.5v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>`,
  trophy: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z" /><path d="M7.5 6H4.5c0 3 1.3 4.5 3.4 4.8M16.5 6h3c0 3-1.3 4.5-3.4 4.8" opacity=".55"/><path d="M12 13.5V17M8.5 20.5h7M9.5 20.5l.6-3.5h3.8l.6 3.5" /></svg>`,
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

export interface ToolDef {
  id: string;
  icon: IconName;
  label: string;
  /** modes of a grouped tool (e.g. the clearing tool): shown while it is current */
  modes?: { id: string; icon: IconName; label: string }[];
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
  setTools(tools: ToolDef[], current: string, pick: (id: string) => void): void {
    this.toolGroup.innerHTML = '';
    for (const t of tools) {
      const b = this.button(t.icon, t.label, 'hud-btn hud-tool');
      b.setAttribute('role', 'radio');
      b.dataset.tool = t.id;
      b.addEventListener('click', () => pick(t.id));
      this.toolGroup.appendChild(b);
      if (t.modes) {
        const strip = document.createElement('div');
        strip.className = 'hud-modes';
        strip.dataset.forTool = t.id;
        strip.setAttribute('role', 'radiogroup');
        strip.setAttribute('aria-label', `${t.label} mode`);
        for (const m of t.modes) {
          const mb = this.button(m.icon, m.label, 'hud-btn hud-mode');
          mb.setAttribute('role', 'radio');
          mb.dataset.mode = m.id;
          mb.addEventListener('click', () => pick(m.id));
          strip.appendChild(mb);
        }
        this.toolGroup.appendChild(strip);
      }
    }
    this.setTool(current);
  }

  setTool(id: string, mode?: string): void {
    for (const b of this.toolGroup.querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.tool === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
      if (b.dataset.mode !== undefined) {
        const mon = b.dataset.mode === mode;
        b.classList.toggle('active', mon);
        b.setAttribute('aria-checked', String(mon));
      }
    }
    for (const s of this.toolGroup.querySelectorAll<HTMLElement>('.hud-modes')) {
      s.classList.toggle('open', s.dataset.forTool === id);
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
