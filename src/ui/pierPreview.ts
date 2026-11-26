// The pier preview (docs/PIERS.md): the pier shows on the beach before it's
// placed, with "place pier" and "cancel" together, so a player can look at
// it before their beach changes. Labels only (no notes in the game UI).

export class PierPreview {
  private readonly root: HTMLDivElement;
  private readonly status: HTMLSpanElement;
  private readonly place: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private onPlace: (() => Promise<void>) | null = null;
  private onCancel: (() => void) | null = null;
  private busy = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'pier-preview';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Place pier');
    this.status = document.createElement('span');
    this.status.className = 'pier-preview-status';
    this.place = document.createElement('button');
    this.place.type = 'button';
    this.place.className = 'action pier-place';
    this.place.textContent = 'place pier';
    this.cancel = document.createElement('button');
    this.cancel.type = 'button';
    this.cancel.className = 'action pier-cancel';
    this.cancel.textContent = 'cancel';
    this.root.append(this.status, this.place, this.cancel);
    parent.appendChild(this.root);
    this.place.addEventListener('click', () => void this.confirm());
    this.cancel.addEventListener('click', () => {
      const fn = this.onCancel;
      this.hide();
      fn?.();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(name: string, onPlace: () => Promise<void>, onCancel: () => void): void {
    this.onPlace = onPlace;
    this.onCancel = onCancel;
    this.status.textContent = name;
    this.place.disabled = false;
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.onPlace = null;
    this.onCancel = null;
  }

  private async confirm(): Promise<void> {
    if (this.busy || !this.onPlace) return;
    this.busy = true;
    this.place.disabled = true;
    const label = this.status.textContent;
    try {
      await this.onPlace();
      this.hide();
    } catch (e) {
      this.status.textContent = (e as Error).message;
      this.place.disabled = false;
      setTimeout(() => {
        if (this.isOpen) this.status.textContent = label;
      }, 4000);
    } finally {
      this.busy = false;
    }
  }
}
