import './overlays.css';

import type { QualityTier } from '../config';
import type { Beach } from '../world/locations';
import type { PaletteChoice, Settings } from './settingsStore';

/** Title card shown until the first touch (which also unlocks audio). */
export class StartScreen {
  readonly el: HTMLDivElement;
  private done = false;

  constructor(parent: HTMLElement, onStart: () => void, isTouch: boolean) {
    this.el = document.createElement('div');
    this.el.className = 'start';
    this.el.innerHTML = `
      <div class="start-card">
        <h1>beech</h1>
        <p class="start-sub">a quiet place by the sea</p>
        <p class="start-hint">${isTouch ? 'touch to begin' : 'click to begin'}</p>
      </div>`;
    parent.appendChild(this.el);
    const go = (e: Event) => {
      e.preventDefault();
      if (this.done) return;
      this.done = true;
      this.el.classList.add('gone');
      window.setTimeout(() => this.el.remove(), 900);
      onStart();
    };
    this.el.addEventListener('pointerdown', go);
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.done && (e.key === 'Enter' || e.key === ' ')) go(e);
      },
      { once: false },
    );
  }

  get visible(): boolean {
    return !this.done;
  }
}

/** A brief hint about the controls, shown once after the start screen. */
export function showHint(parent: HTMLElement, isTouch: boolean): () => void {
  const el = document.createElement('div');
  el.className = 'hint';
  el.innerHTML = isTouch
    ? 'one finger draws in the sand · hold to dig deeper<br>two fingers move, pinch and turn the view'
    : 'drag to draw in the sand · hold to dig deeper<br>right-drag turns · wheel zooms · middle-drag or WASD moves';
  parent.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  let hidden = false;
  const hide = () => {
    if (hidden) return;
    hidden = true;
    el.classList.remove('show');
    window.setTimeout(() => el.remove(), 800);
  };
  window.setTimeout(hide, 9000);
  return hide;
}

export interface SettingsHandlers {
  change(s: Settings, key: keyof Settings): void;
  /** "near me": ask for the device location and pick the closest beach */
  nearMe(): void;
  smooth(): void;
  share(): void;
  fullscreen(): void;
}

const PALETTE_LABELS: [PaletteChoice, string][] = [
  ['live', 'live'],
  ['dawn', 'dawn'],
  ['day', 'day'],
  ['golden', 'golden'],
  ['dusk', 'dusk'],
  ['night', 'night'],
];

const QUALITY_LABELS: [QualityTier | 'auto', string][] = [
  ['auto', 'auto'],
  ['low', 'light'],
  ['medium', 'balanced'],
  ['high', 'fine'],
];

/** Bottom sheet with the few preferences the toy has. */
export class SettingsSheet {
  readonly el: HTMLDivElement;
  private open = false;

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private readonly h: SettingsHandlers,
    beaches: Beach[],
  ) {
    this.el = document.createElement('div');
    this.el.className = 'sheet-wrap';
    this.el.innerHTML = `
      <div class="sheet-scrim"></div>
      <div class="sheet" role="dialog" aria-label="Settings">
        <div class="sheet-grip"></div>
        <div class="account-slot"></div>
        <div class="row col"><span>beach</span><div class="chips" data-key="beach">${beaches
          .map((b) => `<button type="button" data-v="${b.id}" title="${b.place}">${b.name}</button>`)
          .join('')}<button type="button" class="near" data-act="near">near me</button></div></div>
        <div class="row"><span>sound</span>${this.toggle('sound')}</div>
        <div class="row"><span>music</span>${this.toggle('music')}</div>
        <div class="row"><span>haptics</span>${this.toggle('haptics')}</div>
        <div class="row"><span>battery saver</span>${this.toggle('batterySaver')}</div>
        <div class="row"><span>ambient (for a TV)</span>${this.toggle('ambient')}</div>
        <div class="row col"><span>light</span><div class="chips" data-key="palette">${PALETTE_LABELS.map(
          ([v, l]) => `<button type="button" data-v="${v}">${l}</button>`,
        ).join('')}</div></div>
        <div class="row col"><span>detail</span><div class="chips" data-key="quality">${QUALITY_LABELS.map(
          ([v, l]) => `<button type="button" data-v="${v}">${l}</button>`,
        ).join('')}</div></div>
        <div class="row actions">
          <button type="button" class="action" data-act="fullscreen">full screen</button>
          <button type="button" class="action" data-act="share">save a picture</button>
          <button type="button" class="action" data-act="smooth">smooth the beach</button>
        </div>
        <p class="note">detail changes apply on next launch</p>
      </div>`;
    parent.appendChild(this.el);
    this.el.querySelector('.sheet-scrim')!.addEventListener('pointerdown', () => this.hide());
    for (const input of this.el.querySelectorAll<HTMLInputElement>('input[data-key]')) {
      input.addEventListener('change', () => {
        const key = input.dataset.key as 'sound' | 'music' | 'haptics' | 'batterySaver' | 'ambient';
        this.settings = { ...this.settings, [key]: input.checked };
        this.h.change(this.settings, key);
      });
    }
    this.el.querySelector<HTMLButtonElement>('button[data-act="near"]')!.addEventListener('click', () => this.h.nearMe());
    this.el.querySelector<HTMLButtonElement>('button[data-act="fullscreen"]')!.addEventListener('click', () => {
      this.hide();
      this.h.fullscreen();
    });
    for (const group of this.el.querySelectorAll<HTMLDivElement>('.chips')) {
      const key = group.dataset.key as 'palette' | 'quality' | 'beach';
      for (const b of group.querySelectorAll<HTMLButtonElement>('button[data-v]')) {
        b.addEventListener('click', () => {
          this.settings = { ...this.settings, [key]: b.dataset.v } as Settings;
          this.sync();
          this.h.change(this.settings, key);
        });
      }
    }
    let confirmSmooth = 0;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-act="share"], button[data-act="smooth"]')) {
      b.addEventListener('click', () => {
        if (b.dataset.act === 'share') {
          this.hide();
          this.h.share();
          return;
        }
        // smoothing wipes everything, so ask for a second tap
        if (performance.now() - confirmSmooth < 2500) {
          confirmSmooth = 0;
          b.textContent = 'smooth the beach';
          this.hide();
          this.h.smooth();
        } else {
          confirmSmooth = performance.now();
          b.textContent = 'tap again to smooth';
          window.setTimeout(() => (b.textContent = 'smooth the beach'), 2500);
        }
      });
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.hide();
    });
    this.sync();
  }

  private toggle(key: keyof Settings): string {
    return `<label class="switch"><input type="checkbox" data-key="${key}" ${this.settings[key] ? 'checked' : ''}/><i></i></label>`;
  }

  private sync(): void {
    for (const group of this.el.querySelectorAll<HTMLDivElement>('.chips')) {
      const key = group.dataset.key as 'palette' | 'quality' | 'beach';
      for (const b of group.querySelectorAll<HTMLButtonElement>('button[data-v]')) {
        b.classList.toggle('on', b.dataset.v === this.settings[key]);
      }
    }
  }

  /** Reflect a change made outside the sheet (e.g. "near me" or the default beach). */
  setSettings(s: Settings): void {
    this.settings = s;
    this.sync();
  }

  /** Where the account panel renders (empty in the sandbox build). */
  get accountSlot(): HTMLDivElement {
    return this.el.querySelector<HTMLDivElement>('.account-slot')!;
  }

  toggleOpen(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(): void {
    this.open = true;
    this.el.classList.add('open');
  }

  hide(): void {
    this.open = false;
    this.el.classList.remove('open');
  }

  get isOpen(): boolean {
    return this.open;
  }
}
