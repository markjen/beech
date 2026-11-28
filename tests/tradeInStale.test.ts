// A trade-in after a pick-up (Rose, #bugs, 2026-11-27): she vacuumed sand
// dollars up off her beach, opened the bag, and the trade-in dialog still
// said "0 of 0" with "pick it up off your beach first". The bag's trade
// counts come from the server's /bag as of the last save, and nothing
// re-fetched them after a pick-up — so opening the bag now saves first,
// then re-fetches, and the dialog shows what's actually off the beach.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A stand-in for the DOM bits the bag tray touches (after tests/petVacuum.test.ts). */
class FakeEl {
  className = '';
  textContent = '';
  hidden = false;
  inert = false;
  type = '';
  disabled = false;
  dataset: Record<string, string> = {};
  children: FakeEl[] = [];
  // setting innerHTML replaces the children, as in a real DOM (render()
  // clears the tray this way)
  private _innerHTML = '';
  get innerHTML(): string {
    return this._innerHTML;
  }
  set innerHTML(v: string) {
    this._innerHTML = v;
    this.children = [];
  }
  private classes = new Set<string>();
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  classList = {
    add: (c: string) => void this.classes.add(c),
    remove: (c: string) => void this.classes.delete(c),
    toggle: (c: string, force?: boolean) => void (force === undefined ? (this.classes.has(c) ? this.classes.delete(c) : this.classes.add(c)) : force ? this.classes.add(c) : this.classes.delete(c)),
    contains: (c: string) => this.classes.has(c),
  };
  setAttribute(): void {}
  append(...els: FakeEl[]): void {
    this.children.push(...els);
  }
  appendChild(el: FakeEl): FakeEl {
    this.children.push(el);
    return el;
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  // the trade dialog re-queries the same selectors on every render, so
  // each selector keeps one element (a real DOM does the same)
  private queried = new Map<string, FakeEl>();
  querySelector(sel: string): FakeEl {
    const el = this.queried.get(sel) ?? new FakeEl();
    this.queried.set(sel, el);
    return el;
  }
  focus(): void {}
  click(): void {
    for (const fn of this.listeners.get('click') ?? []) fn({ target: this, stopPropagation: () => {}, preventDefault: () => {} });
  }
}

function allEls(el: FakeEl): FakeEl[] {
  return [el, ...el.children.flatMap(allEls)];
}

async function loadTray() {
  vi.stubGlobal('document', { createElement: () => new FakeEl() });
  vi.stubGlobal('window', {
    addEventListener: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  const { InventoryTray } = await import('../src/ui/inventory');
  const { ITEMS } = await import('../src/world/items');
  const sanddollar = ITEMS.find((i) => i.id === 'sanddollar')!;
  const parent = new FakeEl();
  const tray = new InventoryTray(
    () => new FakeEl() as unknown as HTMLButtonElement,
    parent as unknown as HTMLElement,
    [sanddollar],
    () => {},
  );
  tray.setOwned(new Map([['sanddollar', 2]]));
  tray.setBagActions({
    tradeIn: async () => ({ credited: 0 }),
    tradeInMany: async () => ({ credited: 0 }),
    gift: () => {},
    giftable: () => true,
  });
  // the trade dialog, for reading what it shows
  const dialog = () => allEls(parent).find((el) => el.className.includes('trade-dlg'))!;
  const shown = () => ({
    of: dialog().querySelector('.trade-of').textContent,
    n: dialog().querySelector('.trade-n').textContent,
    value: dialog().querySelector('.trade-value').textContent,
    goDisabled: dialog().querySelector('.trade-go').disabled,
  });
  return { tray, shown };
}

describe('trade-in after a pick-up', () => {
  it('opening the bag refreshes the trade-in counts (once per opening)', async () => {
    const { tray } = await loadTray();
    // as of sign-in: both sand dollars still on the beach
    tray.setTradeInfo(new Map([['sanddollar', { free: 0, values: [] }]]));
    expect(tray.tradeValue('sanddollar')).toBeUndefined();
    let opens = 0;
    // what main.ts wires onOpen to: the pick-up is saved, then /bag is
    // re-fetched — here the re-fetch finds both sand dollars free
    tray.onOpen = () => {
      opens++;
      tray.setTradeInfo(new Map([['sanddollar', { free: 2, values: [5, 5] }]]));
    };
    tray.setOpen(true);
    expect(opens).toBe(1);
    expect(tray.tradeValue('sanddollar')).toBe(5);
    tray.setOpen(true);
    expect(opens).toBe(1);
    tray.setOpen(false);
    tray.setOpen(true);
    expect(opens).toBe(2);
  });

  it('the trade dialog shows the refreshed count, not the stale "0 of 0"', async () => {
    const { tray, shown } = await loadTray();
    // stale from sign-in: the sand dollars were still on the beach
    tray.setTradeInfo(new Map([['sanddollar', { free: 0, values: [] }]]));
    tray.openTrade('sanddollar');
    expect(shown()).toMatchObject({ of: 'of 0', n: '0', value: 'pick it up off your beach first', goDisabled: true });
    // the pick-up is saved and /bag is re-fetched when the bag opens
    tray.onOpen = () => tray.setTradeInfo(new Map([['sanddollar', { free: 2, values: [5, 5] }]]));
    tray.setOpen(true);
    tray.openTrade('sanddollar');
    expect(shown()).toMatchObject({ of: 'of 2', n: '1', value: 'you get bb 5', goDisabled: false });
  });

  it('main.ts wires the bag opening to save first, then refresh the bag', () => {
    const src = readFileSync(path.join(ROOT, 'src/main.ts'), 'utf8');
    expect(src).toContain('inventory.onOpen = () => {');
    expect(src).toContain('void store.flushAll().then(() => refreshOwned())');
  });
});
