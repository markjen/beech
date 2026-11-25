import './overlays.css';

import { GUIDE_URL, type QualityTier } from '../config';
import { steamBridge } from '../platform/runtime';
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

  /** Who invited you (an `?invite=` link), under the title. */
  setInvite(name: string, gift: string): void {
    if (this.done) return;
    const p = document.createElement('p');
    p.className = 'start-invite';
    p.textContent = `${name} invited you · a ${gift} is waiting`;
    this.el.querySelector('.start-sub')!.after(p);
  }
}

/** A short note over the beach ("no beach has that code"), gone after a few seconds. */
export function showToast(parent: HTMLElement, text: string): () => void {
  const { el, hide } = showNote(parent, 6000);
  el.textContent = text;
  return hide;
}

/** A note with one button ("Restored 'Moat' · Undo"), gone after `ms`. */
export function showActionToast(parent: HTMLElement, text: string, label: string, onClick: () => void, ms = 10000): () => void {
  const { el, hide } = showNote(parent, ms);
  el.classList.add('with-action');
  const span = document.createElement('span');
  span.textContent = text;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hint-action';
  b.textContent = label;
  b.addEventListener('click', () => {
    hide();
    onClick();
  });
  el.append(span, b);
  return hide;
}

/** A note with several buttons (the "while you were away" card); any button closes it. */
export function showChoiceToast(parent: HTMLElement, text: string, buttons: { label: string; onClick?: () => void }[], ms = 30000): () => void {
  const { el, hide } = showNote(parent, ms);
  el.classList.add('with-action', 'choice');
  const span = document.createElement('span');
  span.textContent = text;
  el.append(span);
  for (const btn of buttons) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hint-action';
    b.textContent = btn.label;
    b.addEventListener('click', () => {
      hide();
      btn.onClick?.();
    });
    el.append(b);
  }
  return hide;
}

/** A `.hint` element that shows itself, then removes itself after `ms`. */
function showNote(parent: HTMLElement, ms: number): { el: HTMLDivElement; hide: () => void } {
  const el = document.createElement('div');
  el.className = 'hint';
  parent.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  let hidden = false;
  const hide = () => {
    if (hidden) return;
    hidden = true;
    el.classList.remove('show');
    window.setTimeout(() => el.remove(), 800);
  };
  window.setTimeout(hide, ms);
  return { el, hide };
}

export interface SettingsHandlers {
  change(s: Settings, key: keyof Settings): void;
  /** "near me": ask for the device location and pick the closest beach */
  nearMe(): void;
  smooth(): void;
  smoothTarget(): string | null;
  share(): void;
  fullscreen(): void;
  /** one tap for the TV: ambient + seated view + fullscreen */
  tv(): void;
  /** beach files (docs/BEACH_FILE.md) */
  exportBeach(): void;
  importBeach(): void;
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

export type SettingsTab = 'beach' | 'shore' | 'display' | 'account' | 'help';

/** Bottom sheet with tabbed settings: Beach, Shore, Display, and Account. */
export class SettingsSheet {
  readonly el: HTMLDivElement;
  private open = false;
  private activeTab: SettingsTab = 'beach';
  private readonly hasAccounts: boolean;

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private readonly h: SettingsHandlers,
    beaches: Beach[],
    options: { accounts?: boolean } = {},
  ) {
    this.hasAccounts = !!options.accounts;
    this.el = document.createElement('div');
    this.el.className = 'sheet-wrap';
    this.el.inert = true;
    const tabsHtml = this.hasAccounts
      ? `<button type="button" role="tab" data-tab="beach" aria-selected="true">Beach</button>
         <button type="button" role="tab" data-tab="shore" aria-selected="false">Shore<span class="tab-dot" hidden></span></button>
         <button type="button" role="tab" data-tab="display" aria-selected="false">Display</button>
         <button type="button" role="tab" data-tab="account" aria-selected="false">Account</button>
         <button type="button" role="tab" data-tab="help" aria-selected="false">Help</button>`
      : `<button type="button" role="tab" data-tab="beach" aria-selected="true">Beach</button>
         <button type="button" role="tab" data-tab="display" aria-selected="false">Display</button>
         <button type="button" role="tab" data-tab="help" aria-selected="false">Help</button>`;
    this.el.innerHTML = `
      <div class="sheet-scrim"></div>
      <div class="sheet" role="dialog" aria-label="Settings">
        <div class="sheet-head">
          <div class="sheet-grip"></div>
          <div class="sheet-top">
            <div class="sheet-tabs" role="tablist" aria-label="Settings sections">${tabsHtml}</div>
            <button type="button" class="sheet-close" data-act="close" aria-label="Close settings">×</button>
          </div>
        </div>
        <div class="sheet-pane" data-pane="beach" role="tabpanel">
          <div class="beach-slot"></div>
          <div class="row col"><span>place</span><div class="chips" data-key="beach">${beaches
            .map((b) => `<button type="button" data-v="${b.id}" title="${b.place}">${b.name}</button>`)
            .join('')}<button type="button" class="near" data-act="near">near me</button></div></div>
          <div class="row actions">
            <button type="button" class="action" data-act="share">save a picture</button>
            <button type="button" class="action" data-act="smooth">smooth the beach</button>
            <button type="button" class="action" data-act="export">export beach</button>
            <button type="button" class="action" data-act="import">import beach</button>
          </div>
          <div class="checkpoints-slot"></div>
        </div>
        ${this.hasAccounts ? `<div class="sheet-pane" data-pane="shore" role="tabpanel" hidden><div class="shore-slot"></div></div>` : ''}
        <div class="sheet-pane" data-pane="display" role="tabpanel" hidden>
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
            <button type="button" class="action" data-act="tv">watch on TV</button>
            <button type="button" class="action" data-act="fullscreen">full screen</button>
            ${steamBridge() ? '<button type="button" class="action" data-act="quit">quit</button>' : ''}
          </div>
        </div>
        ${this.hasAccounts ? `<div class="sheet-pane" data-pane="account" role="tabpanel" hidden><div class="account-slot"></div></div>` : ''}
        <div class="sheet-pane" data-pane="help" role="tabpanel" hidden>
          <h2>Help</h2>
          <dl class="hud-help">
            <dt>Edit</dt><dd>Shape the sand, build sandcastles, place things from your bag, or calm the waves.</dd>
            <dt>Shop</dt><dd>Open the capsule machine, claw machine, or paid shop.</dd>
            <dt>Chair</dt><dd>Sit at the shore and use the arrows to move along it.</dd>
            <dt>Move</dt><dd>Drag to move the view. Pinch or scroll to zoom.</dd>
            <dt>Beach settings</dt><dd>Choose a beach, change the light, or manage your beaches and neighbors.</dd>
            <dt>Settings</dt><dd>Sign in or adjust sound, music, haptics, and display options.</dd>
            <dt>Leaderboard</dt><dd>Find and visit the most-starred beaches.</dd>
          </dl>
          <a class="action" data-act="guide" href="${GUIDE_URL}" target="_blank" rel="noopener">Full guide</a>
        </div>
      </div>`;
    parent.appendChild(this.el);
    for (const btn of this.el.querySelectorAll<HTMLButtonElement>('.sheet-tabs button[data-tab]')) {
      btn.addEventListener('click', () => this.setTab(btn.dataset.tab as SettingsTab));
    }
    const steam = steamBridge();
    if (steam) {
      this.el.querySelector<HTMLAnchorElement>('a[data-act="guide"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        steam.openExternal(GUIDE_URL);
      });
      this.el.querySelector<HTMLButtonElement>('button[data-act="quit"]')?.addEventListener('click', () => steam.quit());
    }
    this.el.querySelector('.sheet-scrim')!.addEventListener('pointerdown', () => this.hide());
    this.el.querySelector('.sheet-close')!.addEventListener('click', () => this.hide());
    for (const input of this.el.querySelectorAll<HTMLInputElement>('input[data-key]')) {
      input.addEventListener('change', () => {
        const key = input.dataset.key as 'sound' | 'music' | 'haptics' | 'batterySaver' | 'ambient';
        this.settings = { ...this.settings, [key]: input.checked };
        this.h.change(this.settings, key);
      });
    }
    this.el.querySelector<HTMLButtonElement>('button[data-act="near"]')?.addEventListener('click', () => this.h.nearMe());
    this.el.querySelector<HTMLButtonElement>('button[data-act="fullscreen"]')?.addEventListener('click', () => {
      this.hide();
      this.h.fullscreen();
    });
    this.el.querySelector<HTMLButtonElement>('button[data-act="tv"]')?.addEventListener('click', () => {
      this.hide();
      this.h.tv();
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
    for (const act of ['export', 'import'] as const) {
      this.el.querySelector<HTMLButtonElement>(`button[data-act="${act}"]`)?.addEventListener('click', () => {
        this.hide();
        if (act === 'export') this.h.exportBeach();
        else this.h.importBeach();
      });
    }
    let confirmSmooth: { target: string | null; expires: number } | undefined;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-act="share"], button[data-act="smooth"]')) {
      b.addEventListener('click', () => {
        if (b.dataset.act === 'share') {
          this.hide();
          this.h.share();
          return;
        }
        // Confirm a second tap for the same beach.
        const target = this.h.smoothTarget();
        if (confirmSmooth && confirmSmooth.target === target && performance.now() < confirmSmooth.expires) {
          confirmSmooth = undefined;
          b.textContent = 'smooth the beach';
          this.hide();
          this.h.smooth();
        } else {
          const confirmation = { target, expires: performance.now() + 2500 };
          confirmSmooth = confirmation;
          b.textContent = 'tap again to smooth';
          window.setTimeout(() => {
            if (confirmSmooth !== confirmation) return;
            confirmSmooth = undefined;
            b.textContent = 'smooth the beach';
          }, 2500);
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

  /** Highlight a specific real-world place chip (e.g. for the beach selected in settings). */
  setBeachLocation(id: string): void {
    const group = this.el.querySelector<HTMLDivElement>('.chips[data-key="beach"]');
    if (!group) return;
    for (const b of group.querySelectorAll<HTMLButtonElement>('button[data-v]')) {
      b.classList.toggle('on', b.dataset.v === id);
    }
  }

  /** Reflect a change made outside the sheet (e.g. "near me" or the default beach). */
  setSettings(s: Settings): void {
    this.settings = s;
    // the switches are rendered from settings, so keep them in step too
    for (const input of this.el.querySelectorAll<HTMLInputElement>('input[data-key]')) {
      input.checked = !!s[input.dataset.key as keyof Settings];
    }
    this.sync();
  }

  setTab(tab: SettingsTab): void {
    if (!this.hasAccounts && (tab === 'shore' || tab === 'account')) tab = 'beach';
    this.activeTab = tab;
    for (const btn of this.el.querySelectorAll<HTMLButtonElement>('.sheet-tabs button[data-tab]')) {
      const on = btn.dataset.tab === tab;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', String(on));
    }
    for (const pane of this.el.querySelectorAll<HTMLElement>('.sheet-pane')) {
      pane.hidden = pane.dataset.pane !== tab;
    }
    const sheet = this.el.querySelector<HTMLElement>('.sheet');
    if (sheet) sheet.scrollTop = 0;
  }

  get tab(): SettingsTab {
    return this.activeTab;
  }

  /** Show a small indicator dot on the Shore tab when there are incoming neighbor requests. */
  setShoreBadge(count: number): void {
    const dot = this.el.querySelector<HTMLElement>('.sheet-tabs [data-tab="shore"] .tab-dot');
    if (dot) dot.hidden = count <= 0;
  }

  /** Top of the Beach tab: beach selector, map, selected beach actions & code. */
  get beachSlot(): HTMLDivElement {
    return this.el.querySelector<HTMLDivElement>('.beach-slot')!;
  }

  /** Bottom of the Beach tab: checkpoints. */
  get checkpointsSlot(): HTMLDivElement {
    return this.el.querySelector<HTMLDivElement>('.checkpoints-slot')!;
  }

  /** Shore tab: connect your beaches, neighbors, visit & favorites. */
  get shoreSlot(): HTMLDivElement | null {
    return this.el.querySelector<HTMLDivElement>('.shore-slot');
  }

  /** Account tab (or checkpointsSlot fallback in sandbox builds). */
  get accountSlot(): HTMLDivElement {
    return this.el.querySelector<HTMLDivElement>('.account-slot') ?? this.checkpointsSlot;
  }

  toggleOpen(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(tab?: SettingsTab): void {
    if (tab) this.setTab(tab);
    this.open = true;
    this.el.classList.add('open');
    this.el.inert = false;
  }

  hide(): void {
    this.open = false;
    this.el.classList.remove('open');
    this.el.inert = true;
  }

  get isOpen(): boolean {
    return this.open;
  }
}
