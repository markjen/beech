import './overlays.css';

import { GUIDE_URL, type QualityTier } from '../config';
import { steamBridge } from '../platform/runtime';
import type { Beach } from '../world/locations';
import { PlacePicker } from './placePicker';
import { WAVE_STRENGTHS, type PaletteChoice, type Settings } from './settingsStore';

/** Title card shown until the first touch (which also unlocks audio). */
export class StartScreen {
  readonly el: HTMLDivElement;
  private done = false;

  constructor(parent: HTMLElement, private readonly onStart: () => void, isTouch: boolean) {
    this.el = document.createElement('div');
    this.el.className = 'start';
    this.el.innerHTML = `
      <div class="start-card">
        <h1>beech</h1>
        <p class="start-sub">a quiet place by the sea</p>
        <p class="start-hint">${isTouch ? 'touch to begin' : 'click to begin'}</p>
      </div>`;
    parent.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.dismiss();
    });
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.done || e.target instanceof HTMLButtonElement || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        this.dismiss();
      },
      { once: false },
    );
  }

  dismiss(): void {
    if (this.done) return;
    this.done = true;
    this.el.classList.add('gone');
    window.setTimeout(() => this.el.remove(), 900);
    this.onStart();
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

/**
 * A short note under the status pane (top left): the parent is the pane's
 * wrapper, so the note sits right below the pane however tall it is, and
 * goes away with it when the UI is tucked away. Gone after a few seconds.
 */
export function showPaneToast(parent: HTMLElement, text: string): () => void {
  const { el, hide } = showNote(parent, 6000);
  el.classList.add('below-status');
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

/** A note with several buttons; any button closes it. */
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
  enablePetReminders?(): Promise<boolean>;
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

/** Manage's tabs. 'shore', 'display' and 'account' are older names, kept as aliases. */
export type SettingsTab = 'beach' | 'checkpoints' | 'settings' | 'help' | 'shore' | 'display' | 'account';
const TAB_ALIAS: Partial<Record<SettingsTab, SettingsTab>> = { shore: 'beach', display: 'settings', account: 'settings' };

/** Manage: a modal with tabs — Beaches, Checkpoints, Settings, Help. */
export class SettingsSheet {
  readonly el: HTMLDivElement;
  private open = false;
  private activeTab: SettingsTab = 'beach';
  private readonly hasAccounts: boolean;
  /** the place picker on the Beaches tab */
  readonly places: PlacePicker;

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
    const tabsHtml = `<button type="button" role="tab" data-tab="beach" aria-selected="true">Beaches</button>
         <button type="button" role="tab" data-tab="checkpoints" aria-selected="false">Checkpoints</button>
         <button type="button" role="tab" data-tab="settings" aria-selected="false">Settings</button>
         <button type="button" role="tab" data-tab="help" aria-selected="false">Help</button>`;
    this.el.innerHTML = `
      <div class="sheet-scrim"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Manage">
        <div class="sheet-head">
          <div class="sheet-grip"></div>
          <div class="sheet-top">
            <div class="sheet-tabs" role="tablist" aria-label="Manage">${tabsHtml}</div>
            <button type="button" class="sheet-close" data-act="close" aria-label="Close">×</button>
          </div>
        </div>
        <div class="sheet-pane" data-pane="beach" role="tabpanel">
          <div class="beach-slot"></div>
          <div class="row col place-slot"></div>
          <div class="row actions">
            <button type="button" class="action" data-act="share">save a picture</button>
            <button type="button" class="action" data-act="smooth">smooth the beach</button>
            <button type="button" class="action" data-act="export">export beach</button>
            <button type="button" class="action" data-act="import">import beach</button>
          </div>
          ${this.hasAccounts ? `<div class="shore-slot"></div>` : ''}
        </div>
        <div class="sheet-pane" data-pane="checkpoints" role="tabpanel" hidden>
          <div class="checkpoints-slot"></div>
        </div>
        <div class="sheet-pane" data-pane="settings" role="tabpanel" hidden>
          ${this.hasAccounts ? `<div class="account-slot"></div>` : ''}
          <div class="row col"><span>waves</span><div class="chips" data-key="waves">${WAVE_STRENGTHS.map(
            (v) => `<button type="button" data-v="${v}">${v}</button>`,
          ).join('')}</div></div>
          <div class="row"><span>sound</span>${this.toggle('sound')}</div>
          <div class="row"><span>music</span>${this.toggle('music')}</div>
          <div class="row"><span>haptics</span>${this.toggle('haptics')}</div>
          ${this.h.enablePetReminders ? `<div class="row"><span>pet reminders</span>${this.toggle('petReminders', 'Pet reminders')}</div>` : ''}
          <div class="row"><span>battery saver</span>${this.toggle('batterySaver')}</div>
          <div class="row"><span>ambient (for a TV)</span>${this.toggle('ambient')}</div>
          <div class="row"><span>local weather</span>${this.toggle('localWeather')}</div>
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
        <div class="sheet-pane" data-pane="help" role="tabpanel" hidden>
          <h2>Help</h2>
          <dl class="hud-help">
            <dt>Palm</dt><dd>Opens the toolbar; the × closes it again.</dd>
            ${this.hasAccounts ? '<dt>Inbox</dt><dd>Messages and requests, the leaderboard, starred beaches, and visiting by code.</dd>' : ''}
            <dt>Hand</dt><dd>Drag to move the view. Pinch or scroll to zoom.</dd>
            <dt>Dirt</dt><dd>Dig, build up, smooth, flatten, vacuum, bulldoze, or mold a sandcastle.</dd>
            <dt>Bag</dt><dd>Things to put on the sand${this.hasAccounts ? ', and the claw and capsule machines' : ''}.</dd>
            ${this.hasAccounts ? '<dt>Store</dt><dd>The paid shop.</dd>' : ''}
            <dt>View</dt><dd>Chair, isometric, or looking back from the sea.</dd>
            <dt>Manage</dt><dd>Beaches, checkpoints, settings, and help.</dd>
            <dt>Undo</dt><dd>Hold it to redo.</dd>
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
      input.addEventListener('change', async () => {
        const key = input.dataset.key as 'sound' | 'music' | 'haptics' | 'batterySaver' | 'ambient' | 'localWeather' | 'petReminders';
        let checked = input.checked;
        if (key === 'petReminders' && checked && this.h.enablePetReminders) {
          input.disabled = true;
          checked = await this.h.enablePetReminders();
          input.disabled = false;
          input.checked = checked;
        }
        this.settings = { ...this.settings, [key]: checked };
        this.sync();
        this.h.change(this.settings, key);
      });
    }
    this.places = new PlacePicker(beaches, {
      pick: (id) => {
        this.settings = { ...this.settings, beach: id };
        this.h.change(this.settings, 'beach');
      },
      nearMe: () => this.h.nearMe(),
    });
    this.el.querySelector('.place-slot')!.appendChild(this.places.el);
    this.el.querySelector<HTMLButtonElement>('button[data-act="fullscreen"]')?.addEventListener('click', () => {
      this.hide();
      this.h.fullscreen();
    });
    this.el.querySelector<HTMLButtonElement>('button[data-act="tv"]')?.addEventListener('click', () => {
      this.hide();
      this.h.tv();
    });
    for (const group of this.el.querySelectorAll<HTMLDivElement>('.chips')) {
      const key = group.dataset.key as 'palette' | 'quality' | 'waves';
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

  private toggle(key: keyof Settings, label?: string): string {
    return `<label class="switch"><input type="checkbox" data-key="${key}" ${label ? `aria-label="${label}"` : ''} ${this.settings[key] ? 'checked' : ''}/><i></i></label>`;
  }

  private sync(): void {
    for (const group of this.el.querySelectorAll<HTMLDivElement>('.chips')) {
      const key = group.dataset.key as 'palette' | 'quality' | 'waves';
      const v = this.settings[key] ?? (key === 'waves' ? 'lively' : undefined);
      for (const b of group.querySelectorAll<HTMLButtonElement>('button[data-v]')) {
        b.classList.toggle('on', b.dataset.v === v);
      }
    }
    this.places.setCurrent(this.settings.beach);
    // the pinned light waits in the background while local weather is on
    this.el.querySelector('.chips[data-key="palette"]')?.classList.toggle('standby', this.settings.localWeather);
  }

  /** Show a specific real-world place in the picker (e.g. for the beach selected in settings). */
  setBeachLocation(id: string): void {
    this.places.setCurrent(id);
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
    tab = TAB_ALIAS[tab] ?? tab;
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
    this.places.refresh();
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
