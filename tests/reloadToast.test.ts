import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// The "a new version is ready · Reload" prompt is a toast, and a plain toast
// has no z-index — so any open modal (Manage at 6, Bag / Store / Inbox / …
// at 20, the pier preview at 40) painted above it and the modal's backdrop
// swallowed the click on Reload. The prompt now asks for the topmost layer
// instead. These tests pin that: the class the toast gets, the z-index that
// class carries against every other z-index in the UI, and the call site.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI_CSS = [path.join(ROOT, 'src/ui/overlays.css'), path.join(ROOT, 'src/ui/hud.css'), path.join(ROOT, 'src/style.css')];

/** Every `z-index: N` in `file`, with the selector-ish line it sits under. */
function zIndexes(file: string): { at: string; value: number }[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const out: { at: string; value: number }[] = [];
  let at = '';
  for (const line of lines) {
    if (line.includes('{')) at = line.trim();
    const m = /z-index:\s*(\d+)/.exec(line);
    if (m) out.push({ at, value: Number(m[1]) });
  }
  return out;
}

/** A stand-in for the few DOM bits the toast helpers touch. */
class FakeEl {
  className = '';
  textContent = '';
  children: FakeEl[] = [];
  private classes = new Set<string>();
  classList = {
    add: (c: string) => void this.classes.add(c),
    remove: (c: string) => void this.classes.delete(c),
    contains: (c: string) => this.classes.has(c),
  };
  append(...els: FakeEl[]): void {
    this.children.push(...els);
  }
  appendChild(el: FakeEl): FakeEl {
    this.children.push(el);
    return el;
  }
  addEventListener(): void {}
}

async function loadOverlays() {
  const doc = { createElement: () => new FakeEl() };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { setTimeout: () => 0 });
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    cb(0);
    return 0;
  });
  return import('../src/ui/overlays');
}

describe('reload prompt layering', () => {
  it('a topmost toast gets the topmost class, a plain toast does not', async () => {
    const { showToast, showActionToast } = await loadOverlays();
    const parent = new FakeEl();
    const asEl = parent as unknown as HTMLElement;
    showToast(asEl, 'plain');
    showToast(asEl, 'top', { topmost: true });
    showActionToast(asEl, 'plain action', 'Do', () => {});
    showActionToast(asEl, 'top action', 'Reload', () => {}, 1000, { topmost: true });
    const [plain, top, plainAction, topAction] = parent.children;
    expect(plain.classList.contains('topmost')).toBe(false);
    expect(top.classList.contains('topmost')).toBe(true);
    expect(plainAction.classList.contains('topmost')).toBe(false);
    expect(topAction.classList.contains('topmost')).toBe(true);
  });

  it('the topmost z-index sits above every other z-index in the UI', () => {
    const css = readFileSync(path.join(ROOT, 'src/ui/overlays.css'), 'utf8');
    const topmost = /\.hint\.topmost\s*\{[^}]*z-index:\s*(\d+)/.exec(css);
    expect(topmost, 'no .hint.topmost z-index in overlays.css').not.toBeNull();
    const top = Number(topmost![1]);
    const others: { at: string; value: number; where: string }[] = [];
    for (const file of UI_CSS) {
      for (const z of zIndexes(file)) {
        if (z.at.startsWith('.hint.topmost')) continue;
        others.push({ ...z, where: path.basename(file) });
      }
    }
    // Inline styles (e.g. the debug overlay) layer the same way.
    for (const file of readdirSync(path.join(ROOT, 'src/ui')).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(path.join(ROOT, 'src/ui', file), 'utf8');
      for (const m of src.matchAll(/z-index:\s*(\d+)/g)) {
        others.push({ at: '(inline style)', value: Number(m[1]), where: file });
      }
    }
    expect(others.length).toBeGreaterThan(0);
    for (const o of others) expect(top, `${o.where} ${o.at}`).toBeGreaterThan(o.value);
  });

  it('offerReload asks for the topmost layer on every platform', () => {
    const src = readFileSync(path.join(ROOT, 'src/main.ts'), 'utf8');
    const start = src.indexOf('const offerReload');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\n  };', start);
    const fn = src.slice(start, end);
    // Hosted (Reload button) + Steam + store: the same update notice.
    expect(fn.match(/topmost: true/g)?.length).toBe(3);
    expect(fn).toContain("'Reload'");
  });
});
