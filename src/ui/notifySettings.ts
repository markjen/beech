// The "notifications" rows in Settings (docs/INBOX_NOTIFICATIONS.md, "Push"):
// this device on or off, then which kinds (stored on the server, so every
// device follows them). Labels and status only; what each one means is in
// the web guide (CLAUDE.md, "No notes in the game UI").
import type { Notifier, NotifyPrefs } from '../platform/notify';

const KIND_ROWS: [keyof NotifyPrefs, string][] = [
  ['gifts', 'gifts and notes'],
  ['neighbors', 'neighbors'],
  ['invites', 'invites'],
  ['beach', 'your beaches'],
];

const sw = (key: string, on: boolean, label: string) =>
  `<label class="switch"><input type="checkbox" data-n="${key}" aria-label="${label}" ${on ? 'checked' : ''}/><i></i></label>`;

export class NotifySettings {
  readonly el: HTMLDivElement;

  constructor(
    private readonly notifier: Notifier,
    private readonly signedIn: () => boolean,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'notify-settings';
    this.el.hidden = true;
    this.el.addEventListener('change', (e) => void this.changed(e.target as HTMLInputElement));
  }

  /** Draw the rows for the current device and player (nothing when this device can't be reached). */
  async render(): Promise<void> {
    const channel = this.signedIn() ? await this.notifier.channel() : null;
    if (!channel) {
      this.el.hidden = true;
      this.el.innerHTML = '';
      return;
    }
    const on = this.notifier.on;
    const blocked = await this.notifier.blocked();
    const prefs = on ? await this.notifier.prefs() : null;
    this.el.innerHTML = `
      <div class="row"><span>notifications</span>${sw('device', on && !blocked, 'Notifications on this device')}</div>
      ${blocked ? `<div class="row status"><span>off in this device's settings</span></div>` : ''}
      ${
        on && prefs && !blocked
          ? KIND_ROWS.map(([k, label]) => `<div class="row sub"><span>${label}</span>${sw(k, prefs[k], label)}</div>`).join('')
          : ''
      }`;
    this.el.hidden = false;
  }

  private async changed(input: HTMLInputElement): Promise<void> {
    const key = input.dataset.n;
    if (!key) return;
    input.disabled = true;
    try {
      if (key === 'device') {
        if (input.checked) await this.notifier.enable();
        else await this.notifier.disable();
      } else {
        await this.notifier.setPref(key as keyof NotifyPrefs, input.checked);
      }
    } catch {
      /* offline: the row redraws as it is */
    }
    await this.render();
  }
}
