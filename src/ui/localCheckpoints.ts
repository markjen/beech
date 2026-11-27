// Checkpoints in the sandbox build (no accounts): kept on this device, in
// IndexedDB (src/net/localStore.ts). Save the beach as it is, put one back
// (one undo step), rename, delete, and swap them as beach files
// (docs/BEACH_FILE.md). The sandbox has no bag: everything in it is free.

import { LocalCheckpoints, LOCAL_CHECKPOINTS, type LocalCheckpoint } from '../net/localStore';
import { thumbnailCanvas } from './checkpoints';

export interface LocalCheckpointHost {
  /** the beach as it is now: saved-beach bytes, things on it, the real beach */
  snapshot(): Promise<{ bytes: Uint8Array; objects: number; location: string }>;
  /** put saved-beach bytes on the beach (one undo step) */
  restore(bytes: Uint8Array): Promise<void>;
  /** save a checkpoint as a beach file */
  exportFile(name: string, bytes: Uint8Array): Promise<void>;
  /** pick a beach file: its name and saved-beach bytes (null if cancelled) */
  importFile(): Promise<{ name: string; bytes: Uint8Array; objects: number; location: string } | null>;
  toast(text: string): void;
}

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : new Date(ts).toLocaleDateString();
}

export class LocalCheckpointsSection {
  readonly el: HTMLDivElement;
  private list: LocalCheckpoint[] = [];
  private thumbs = new Map<string, HTMLCanvasElement>();
  private error = '';
  private confirmDelete: { id: string; at: number } | null = null;

  constructor(
    parent: HTMLElement,
    private readonly host: LocalCheckpointHost,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'account';
    parent.appendChild(this.el);
    void this.load();
  }

  async load(): Promise<void> {
    this.list = await LocalCheckpoints.list();
    this.render();
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.error = '';
    try {
      await fn();
    } catch (e) {
      this.error = (e as Error).message;
    }
    await this.load();
  }

  private render(): void {
    this.el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'neighbors checkpoints';
    const head = document.createElement('div');
    head.className = 'status';
    head.textContent = `checkpoints on this device (${this.list.length} of ${LOCAL_CHECKPOINTS})`;
    wrap.appendChild(head);
    const buttons = document.createElement('div');
    buttons.className = 'slot';
    buttons.append(
      this.button('save a checkpoint', 'cp-save', () =>
        this.run(async () => {
          const name = window.prompt('Name this checkpoint', `My beach, ${new Date().toLocaleDateString()}`);
          if (name === null || !name.trim()) return;
          const s = await this.host.snapshot();
          await LocalCheckpoints.save(name.trim().slice(0, 40), s.bytes, s.objects, s.location);
          this.host.toast(`Saved checkpoint “${name.trim()}”`);
        }),
      ),
      this.button('import a beach file', 'cp-import', () =>
        this.run(async () => {
          const f = await this.host.importFile();
          if (!f) return;
          await LocalCheckpoints.save(f.name.slice(0, 40), f.bytes, f.objects, f.location);
          this.host.toast(`Kept “${f.name}” as a checkpoint`);
        }),
      ),
    );
    wrap.appendChild(buttons);
    if (!this.list.length) {
      const note = document.createElement('div');
      note.className = 'status';
      note.textContent = 'none yet. A checkpoint keeps the beach as it is now, to come back to later. They stay in this browser; sign in to keep them anywhere.';
      wrap.appendChild(note);
    }
    for (const cp of this.list) wrap.appendChild(this.row(cp));
    if (this.error) {
      const err = document.createElement('div');
      err.className = 'err';
      err.textContent = this.error;
      wrap.appendChild(err);
    }
    this.el.appendChild(wrap);
  }

  private row(cp: LocalCheckpoint): HTMLElement {
    const row = document.createElement('div');
    row.className = 'cp-row';
    row.dataset.id = cp.id;
    // a little top-down map of it, drawn on first sight. The drawn canvas
    // itself is the thumbnail (no pixel readback); a re-render just moves
    // the cached canvas from the discarded row.
    const cached = this.thumbs.get(cp.id);
    const thumb = cached ?? document.createElement('canvas');
    if (!cached) {
      thumb.className = 'cp-thumb';
      thumb.width = thumb.height = 72;
      thumb.setAttribute('aria-hidden', 'true');
      void LocalCheckpoints.sand(cp.id).then(async (bytes) => {
        if (!bytes) return;
        const drawn = await thumbnailCanvas(bytes).catch(() => null);
        if (!drawn) return;
        this.thumbs.set(cp.id, drawn);
        if (thumb.isConnected) thumb.replaceWith(drawn);
      });
    }
    row.appendChild(thumb);
    const title = document.createElement('div');
    title.className = 'cp-title';
    const name = document.createElement('b');
    name.textContent = cp.name;
    const meta = document.createElement('span');
    meta.className = 'cp-meta';
    meta.textContent = `${cp.objects} thing${cp.objects === 1 ? '' : 's'} · ${ago(cp.createdAt)}`;
    title.append(name, meta);
    row.appendChild(title);
    const acts = document.createElement('div');
    acts.className = 'slot cp-acts';
    const bytesOf = async () => {
      const b = await LocalCheckpoints.sand(cp.id);
      if (!b) throw new Error('that checkpoint is gone from this browser');
      return b;
    };
    acts.append(
      this.button('restore here', `cp-restore-${cp.id}`, () =>
        this.run(async () => {
          if (!window.confirm(`Replace your beach with “${cp.name}”? Undo brings it back.`)) return;
          await this.host.restore(await bytesOf());
          this.host.toast(`Restored “${cp.name}”. Undo brings your beach back.`);
        }),
      ),
      this.button('export', `cp-export-${cp.id}`, () => this.run(async () => this.host.exportFile(cp.name, await bytesOf()))),
      this.button('rename', `cp-rename-${cp.id}`, () =>
        this.run(async () => {
          const n = window.prompt('Name this checkpoint', cp.name);
          if (n !== null && n.trim()) await LocalCheckpoints.rename(cp.id, n.trim().slice(0, 40));
        }),
      ),
    );
    const del = this.button('delete', `cp-delete-${cp.id}`, async () => {
      if (!this.confirmDelete || this.confirmDelete.id !== cp.id || performance.now() - this.confirmDelete.at > 5000) {
        this.confirmDelete = { id: cp.id, at: performance.now() };
        del.textContent = 'tap again to delete';
        return;
      }
      this.confirmDelete = null;
      await this.run(() => LocalCheckpoints.remove(cp.id));
    });
    acts.appendChild(del);
    row.appendChild(acts);
    return row;
  }

  private button(label: string, act: string, fn: () => Promise<void>): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'action';
    b.dataset.act = act;
    b.textContent = label;
    b.addEventListener('click', () => void fn());
    return b;
  }
}
