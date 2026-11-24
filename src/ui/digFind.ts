import { itemById, prizeName, type Rarity } from '../world/items';
import { itemIcon } from './hud';

const RARITY_NAME: Record<string, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary', unique: 'One of a kind' };

/**
 * Digging finds: when a good dig turns something up, the server has already
 * granted it to the bag — this just says what it was. "Put it on the beach"
 * picks it up in hand; "Keep it" leaves it in the bag.
 */
export class DigFind {
  private readonly root: HTMLDivElement;
  private readonly reveal: HTMLDivElement;
  private readonly note: HTMLParagraphElement;

  constructor(
    parent: HTMLElement,
    private readonly won: (item: string, place: boolean) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'digfind';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'You dug something up');
    this.root.innerHTML = `
      <div class="digfind-card">
        <button type="button" class="digfind-close" aria-label="Close">×</button>
        <h2>You dug something up!</h2>
        <div class="digfind-reveal"></div>
        <p class="digfind-note"></p>
      </div>`;
    parent.appendChild(this.root);
    this.reveal = this.root.querySelector('.digfind-reveal')!;
    this.note = this.root.querySelector('.digfind-note')!;
    this.root.querySelector('.digfind-close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  show(prize: { item: string; rarity: string }, findsLeft: number): void {
    const placeable = !!itemById(prize.item);
    this.note.textContent =
      findsLeft > 0 ? `${findsLeft} more buried today.` : 'That is all the buried treasure for today.';
    this.reveal.className = `digfind-reveal rarity-${prize.rarity}`;
    this.reveal.innerHTML = `
      <div class="digfind-prize">${itemIcon(prize.item)}</div>
      <b>${prizeName(prize.item)}</b>
      <span>${RARITY_NAME[prize.rarity as Rarity] ?? prize.rarity}</span>
      <button type="button" class="digfind-place">${placeable ? 'Put it on the beach' : 'Keep it'}</button>`;
    const btn = this.reveal.querySelector('.digfind-place') as HTMLButtonElement;
    btn.addEventListener('click', () => {
      this.close();
      this.won(prize.item, placeable);
    });
    this.root.classList.add('open');
    btn.focus({ preventScroll: true });
  }

  close(): void {
    this.root.classList.remove('open');
  }
}
