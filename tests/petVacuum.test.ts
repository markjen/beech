// Vacuum a placed pet (docs/PETS.md): the bag shows the live beach's placed
// pet with a "vacuum up" button, two taps to confirm, and the pet goes back
// in the bag so a different pet can take its place. The server side is
// POST /pet/stow, pinned by server/test/stateMachines/pets.test.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A stand-in for the DOM bits the bag tray touches. */
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
  querySelector(): FakeEl {
    return new FakeEl();
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
  const timers: (() => void)[] = [];
  vi.stubGlobal('document', { createElement: () => new FakeEl() });
  vi.stubGlobal('window', {
    addEventListener: () => {},
    setTimeout: (cb: () => void) => {
      timers.push(cb);
      return timers.length;
    },
    clearTimeout: () => {},
  });
  const { InventoryTray } = await import('../src/ui/inventory');
  const parent = new FakeEl();
  const tray = new InventoryTray(
    () => new FakeEl() as unknown as HTMLButtonElement,
    parent as unknown as HTMLElement,
    [],
    () => {},
  );
  const vacuumButton = () => allEls(parent).find((el) => el.innerHTML.includes('vacuum up'));
  const bagPetButton = () => allEls(parent).find((el) => el.innerHTML.includes('· place'));
  return { tray, parent, timers, vacuumButton, bagPetButton };
}

describe('pet vacuum in the bag', () => {
  it('shows the live beach’s placed pet with a vacuum button, and hides it when there is none', async () => {
    const { tray, vacuumButton } = await loadTray();
    expect(vacuumButton()).toBeUndefined();
    tray.setPlacedPet({ species: 'crab', name: 'Pip', beachId: 'b1' });
    const btn = vacuumButton();
    expect(btn).toBeDefined();
    expect(btn!.innerHTML).toContain('Pip');
    expect(btn!.innerHTML).toContain('on this beach · vacuum up');
    tray.setPlacedPet(null);
    expect(vacuumButton()).toBeUndefined();
  });

  it('one tap arms the vacuum, the second tap vacuums', async () => {
    const { tray, vacuumButton } = await loadTray();
    const vacuumed: string[] = [];
    tray.onVacuumPet = (beachId) => {
      vacuumed.push(beachId);
    };
    tray.setPlacedPet({ species: 'dolphin', name: 'Splash', beachId: 'b2' });
    vacuumButton()!.click();
    expect(vacuumed).toEqual([]);
    expect(vacuumButton()!.innerHTML).toContain('tap again to vacuum up Splash');
    vacuumButton()!.click();
    expect(vacuumed).toEqual(['b2']);
  });

  it('the arm expires, so a later tap only arms again', async () => {
    const { tray, timers, vacuumButton } = await loadTray();
    const vacuumed: string[] = [];
    tray.onVacuumPet = (beachId) => {
      vacuumed.push(beachId);
    };
    tray.setPlacedPet({ species: 'seal', name: 'Sam', beachId: 'b3' });
    vacuumButton()!.click();
    expect(vacuumButton()!.innerHTML).toContain('tap again to vacuum up Sam');
    expect(timers.length).toBe(1);
    timers[0]();
    expect(vacuumButton()!.innerHTML).toContain('on this beach · vacuum up');
    vacuumButton()!.click();
    expect(vacuumed).toEqual([]);
    expect(vacuumButton()!.innerHTML).toContain('tap again to vacuum up Sam');
  });

  it('the vacuumed pet’s bag tile sits next to the placed-pet tile', async () => {
    const { tray, vacuumButton, bagPetButton } = await loadTray();
    tray.setPlacedPet({ species: 'turtle', name: 'Pip', beachId: 'b1' });
    tray.setBagPets([{ id: 7, species: 'seal', name: 'Sam' }]);
    expect(vacuumButton()).toBeDefined();
    const bag = bagPetButton();
    expect(bag).toBeDefined();
    expect(bag!.innerHTML).toContain('Sam');
  });

  it('main.ts wires the bag’s vacuum button to the stow endpoint and shows the placed pet', () => {
    const src = readFileSync(path.join(ROOT, 'src/main.ts'), 'utf8');
    expect(src).toContain('inventory.onVacuumPet = (beachId) => vacuumPet(beachId)');
    expect(src).toContain('inventory.setPlacedPet(');
    expect(src).toContain('vacuum it up from your bag to swap');
    expect(src).toContain('.stowPet(beachId)');
  });
});
