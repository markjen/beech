// Checkpoints in settings (docs/CHECKPOINTS.md): save a named copy of any of
// your beaches, and put one back on any of them, if your bag still holds the
// things it needs. Every restore can be undone: the beach as it was becomes
// its "before restoring" checkpoint.

import { ShortError, type Account, type Checkpoint, type CheckpointApi, type CheckpointList } from '../net/account';
import { shortfall, type Short } from '../world/checkpointFit';
import { itemById } from '../world/items';
import { decodeSand, fitWorld } from '../sim/sandCodec';
import { drawMap } from './beachFileDialog';
import { ownBeachLabel } from './shoreConnect';
import { unlockSteamAchievement } from '../platform/steamFeatures';

/** A checkpoint's thumbnail from its saved bytes: a small top-down map, drawn on a canvas. */
export async function thumbnailCanvas(bytes: Uint8Array, size = 72): Promise<HTMLCanvasElement> {
  // No thumbnails when rendering is off (?norender, the e2e path): drawing
  // the map is cheap, but the panel works fine without the picture. Callers
  // already treat a missing thumbnail as optional, and thumbnails are
  // covered by scripts/sandbox-e2e.mjs on a real device.
  if (new URLSearchParams(location.search).has('norender')) throw new Error('thumbnails off with ?norender');
  const b = fitWorld(await decodeSand(bytes));
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.className = 'cp-thumb';
  c.setAttribute('aria-hidden', 'true');
  drawMap(c, b, b.objects);
  // The canvas itself is the thumbnail: it is appended to the row, so the
  // pixels are never read back off the GPU. The old toBlob + <img> version
  // stalled the main thread ~25 s per thumbnail on software rendering (CDP
  // profiler: toBlob was 97% of samples over the stall) — the whole panel
  // froze while the rows rendered.
  c.dataset.drawn = '1';
  return c;
}

export interface CheckpointHost {
  /** what you own (non-free items) */
  owned(): ReadonlyMap<string, number>;
  /** non-free things on one of your beaches right now (the live one counts what's on it this moment) */
  itemsOn(beachId: string): Record<string, number>;
  /** the beach of yours in front of you now ("restore here"), if any */
  here(): string | null;
  /** save this beach now (what you see is what the checkpoint keeps) */
  saveBeach(beachId: string): Promise<void>;
  /** replace this beach on the server: save it, run `change`, load what the server has then */
  replaceBeach(beachId: string, change: () => Promise<void>): Promise<void>;
  /** your beaches or bag changed (reload the list, recount the bag) */
  changed(): Promise<void>;
  toast(text: string, undo?: () => void): void;
  /** a named checkpoint was saved (the guide's step) */
  saved?(): void;
  /** export a checkpoint as a beach file (BEACH_FILE.md) */
  exportCheckpoint?(cp: Checkpoint): Promise<void>;
  /** pick a beach file and keep it as a checkpoint */
  importAsCheckpoint?(): Promise<void>;
  shop?(): void;
}

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}

const itemName = (id: string, n = 1) => {
  const name = itemById(id)?.name ?? id;
  return n === 1 ? name : `${name}s`.replace(/ss$/, 'sses');
};

/** "1 more Lighthouse" / "2 more Deckchairs" */
export function describeShort(short: Short[]): string {
  return short.map((s) => `${s.need - s.have} more ${itemName(s.item, s.need - s.have)}`).join(', ');
}

export class CheckpointsSection {
  private list: CheckpointList | null = null;
  private listOwner: string | null = null;
  private sourceFilter = '';
  private error = '';
  private busy = false;
  private confirmDelete: { id: string; at: number } | null = null;
  /** thumbnails drawn so far (by checkpoint id and size); drawn one at a time */
  private thumbs = new Map<string, HTMLCanvasElement>();
  private thumbQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly api: CheckpointApi,
    private readonly account: Account,
    private readonly host: CheckpointHost,
    /** redraw the panel this section sits in */
    private readonly redraw: () => void,
  ) {}

  /** (Re)load the list from the server. */
  async load(): Promise<void> {
    const owner = this.account.user?.id ?? null;
    if (owner !== this.listOwner) {
      this.list = null;
      this.listOwner = owner;
      this.sourceFilter = '';
      this.error = '';
    }
    if (!owner) return;
    try {
      const list = await this.api.list();
      if (this.account.user?.id !== owner) return;
      this.list = list;
      this.error = '';
    } catch (e) {
      if (this.account.user?.id !== owner) return;
      this.error = (e as Error).message;
    }
    this.redraw();
  }

  /** Save a checkpoint of one of your beaches (asks for a name). */
  async saveOf(beachId: string): Promise<void> {
    const b = this.account.beaches.find((x) => x.id === beachId);
    const label = b?.name || (b?.home ? 'Home' : 'My beach');
    const name = window.prompt('Name this checkpoint', `${label}, ${new Date().toLocaleDateString()}`);
    if (name === null || !name.trim()) return;
    await this.run(async () => {
      // save what's here first, so the checkpoint is what you see
      await this.host.saveBeach(beachId);
      const cp = await this.api.save(beachId, name.trim());
      this.host.toast(`Saved checkpoint “${cp.name}”`);
      unlockSteamAchievement('CHECKPOINT_SAVED');
      this.host.saved?.();
    });
  }

  private beachName(id: string): string {
    const b = this.account.beaches.find((x) => x.id === id);
    return b?.name || (b?.home ? 'your home beach' : 'that beach');
  }

  private checkpointSource(cp: Checkpoint): { key: string; label: string } {
    if (cp.source === 'import') return { key: 'import', label: 'Imported files' };
    // a beach on the shore kept as a checkpoint (docs/COPY_BEACH.md)
    if (cp.source === 'copy') return { key: 'copy', label: 'Copied beaches' };
    const id = cp.originBeachId ?? cp.fromBeach?.id;
    const beach = this.account.mine(cp.fromBeach?.id);
    const name = beach ? ownBeachLabel(beach) : cp.fromBeach?.name || cp.fromName || 'A beach';
    return {
      key: id ? `beach:${id}` : `removed:${cp.fromName}`,
      label: cp.fromBeach ? name : `${name} (removed)`,
    };
  }

  /** what's on your beaches other than `target` */
  private elsewhere(target: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const b of this.account.beaches) {
      if (b.id === target) continue;
      for (const [k, v] of Object.entries(this.host.itemsOn(b.id))) out[k] = (out[k] ?? 0) + v;
    }
    return out;
  }

  shortFor(cp: Checkpoint, target: string): Short[] {
    return shortfall(cp.items, this.host.owned(), this.elsewhere(target));
  }

  /** "Put it back as it was" (docs/LIVE_SIM.md): restore checkpoint `id` onto `target` without asking. */
  async putBack(id: string, target: string): Promise<void> {
    await this.load();
    const cp = this.list?.checkpoints.find((c) => c.id === id);
    if (!cp) {
      this.host.toast('That copy of the beach is gone');
      return;
    }
    await this.restore(cp, target, false);
  }

  /** Put `cp` on beach `target`, asking first. */
  async restore(cp: Checkpoint, target: string, ask = true): Promise<void> {
    const name = this.beachName(target);
    let mode: 'strict' | 'drop-missing' = 'strict';
    const short = this.shortFor(cp, target);
    // not asking (a tap that already meant "put it back"): leave out what the bag can't cover
    if (!ask && short.length) mode = 'drop-missing';
    if (ask) {
      const keep = cp.kind === 'auto' ? '' : ` ${name} as it is now is kept as “Before restoring”, so you can go back.`;
      if (short.length) {
        if (!window.confirm(`“${cp.name}” needs ${describeShort(short)} than your bag has free (they may be on your other beaches). Put it on ${name} without them?${keep}`)) return;
        mode = 'drop-missing';
      } else if (!window.confirm(`Replace ${name} with “${cp.name}”?${keep}`)) return;
    }
    await this.run(async () => {
      let result: { undo: string | null; dropped: number };
      const go = () => this.api.restore(target, cp.id, mode);
      const attempt = () => this.restoreOnto(target, go);
      try {
        result = await attempt();
      } catch (e) {
        // the bag changed since we looked (another device): ask again
        if (!(e instanceof ShortError)) throw e;
        if (!window.confirm(`“${cp.name}” needs ${describeShort(e.short)} than your bag has free. Restore without them?`)) return;
        mode = 'drop-missing';
        result = await attempt();
      }
      await this.host.changed();
      const undoId = result.undo;
      const left = result.dropped ? ` (${result.dropped} left out)` : '';
      this.host.toast(
        cp.kind === 'auto'
          ? `${name} is back as it was`
          : cp.kind === 'tide'
            ? `${name} is back as it was before the tide${left}`
            : `Restored “${cp.name}” on ${name}${left}`,
        undoId && cp.kind !== 'auto' ? () => void this.undo(undoId, target) : undefined,
      );
    });
  }

  private async restoreOnto(target: string, go: () => Promise<{ undo: string | null; dropped: number }>) {
    let out: { undo: string | null; dropped: number } = { undo: null, dropped: 0 };
    await this.host.replaceBeach(target, async () => {
      out = await go();
    });
    return out;
  }

  private async undo(autoId: string, target: string): Promise<void> {
    await this.load();
    const auto = this.list?.checkpoints.find((c) => c.id === autoId);
    if (auto) await this.restore(auto, target, false);
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.redraw();
    try {
      await fn();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
      await this.load();
    }
  }

  /** The section's element (built fresh on each panel render). */
  element(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'neighbors checkpoints';
    const head = document.createElement('div');
    head.className = 'status';
    const list = this.list;
    head.textContent = list ? `checkpoints (${list.named} of ${list.limit})` : 'checkpoints';
    wrap.appendChild(head);
    const here = this.host.here();
    const buttons = document.createElement('div');
    buttons.className = 'slot';
    if (here) buttons.appendChild(this.button('save a checkpoint', 'cp-save', () => this.saveOf(here)));
    if (this.host.importAsCheckpoint) buttons.appendChild(this.button('import a beach file', 'cp-import', () => this.run(() => this.host.importAsCheckpoint!())));
    wrap.appendChild(buttons);
    if (!list) {
      const note = document.createElement('div');
      note.className = 'status';
      note.textContent = this.error || 'loading…';
      wrap.appendChild(note);
      return wrap;
    }
    if (!list.checkpoints.length) {
      const note = document.createElement('div');
      note.className = 'status';
      note.textContent = 'none yet';
      wrap.appendChild(note);
    }
    const entries = list.checkpoints.map((cp) => ({ cp, source: this.checkpointSource(cp) }));
    const sources = new Map<string, string>();
    for (const { source } of entries) {
      if (!sources.has(source.key)) sources.set(source.key, source.label);
    }
    if (!sources.has(this.sourceFilter)) this.sourceFilter = '';
    const results = document.createElement('div');
    results.className = 'cp-results';
    const renderRows = () => {
      results.replaceChildren();
      for (const { cp, source } of entries) {
        if (!this.sourceFilter || source.key === this.sourceFilter) results.appendChild(this.row(cp, source.label));
      }
    };
    if (sources.size > 1) {
      const filter = document.createElement('select');
      filter.className = 'action cp-source';
      filter.setAttribute('aria-label', 'Filter checkpoints by source');
      filter.add(new Option('All sources', ''));
      const labels = new Map<string, number>();
      const ordered = [...sources].sort(([a, nameA], [b, nameB]) => nameA.localeCompare(nameB) || a.localeCompare(b));
      for (const [key, label] of ordered) {
        const n = (labels.get(label) ?? 0) + 1;
        labels.set(label, n);
        filter.add(new Option(n === 1 ? label : `${label} (${n})`, key));
      }
      filter.value = this.sourceFilter;
      filter.addEventListener('change', () => {
        this.sourceFilter = filter.value;
        renderRows();
      });
      buttons.appendChild(filter);
    }
    renderRows();
    wrap.appendChild(results);
    if (this.error) {
      const err = document.createElement('div');
      err.className = 'err';
      err.textContent = this.error;
      wrap.appendChild(err);
    }
    return wrap;
  }

  private row(cp: Checkpoint, sourceLabel: string): HTMLElement {
    const a = this.account;
    const row = document.createElement('div');
    row.className = `cp-row${cp.kind !== 'named' ? ' auto' : ''}`;
    row.dataset.id = cp.id;
    // a little top-down map of it, fetched and drawn on first sight. The
    // drawn canvas itself is the thumbnail (no pixel readback), so a row
    // re-render just moves the canvas from the discarded row.
    const key = `${cp.id}:${cp.bytes}:${cp.createdAt}`;
    let thumb = this.thumbs.get(key);
    if (!thumb) {
      thumb = document.createElement('canvas');
      thumb.className = 'cp-thumb';
      thumb.width = thumb.height = 72;
      thumb.setAttribute('aria-hidden', 'true');
      this.thumbQueue = this.thumbQueue.then(async () => {
        if (this.thumbs.has(key)) return;
        try {
          const drawn = await thumbnailCanvas((await this.api.sand(cp.id)).bytes);
          this.thumbs.set(key, drawn);
          // the panel may have re-rendered meanwhile: swap the drawn canvas in
          const live = document.querySelector<HTMLCanvasElement>(`.cp-row[data-id="${cp.id}"] .cp-thumb`);
          if (live && live !== drawn) live.replaceWith(drawn);
        } catch {
          /* no thumbnail: it's only a picture */
        }
      });
    }
    row.appendChild(thumb);
    const title = document.createElement('div');
    title.className = 'cp-title';
    const name = document.createElement('b');
    name.textContent = cp.name;
    const meta = document.createElement('span');
    meta.className = 'cp-meta';
    const kind =
      cp.kind === 'auto'
        ? cp.name.startsWith('Auto-save ')
          ? 'auto-saved daily'
          : cp.name.startsWith('Before import')
            ? 'kept before an import'
            : 'kept before a restore'
        : cp.kind === 'tide' ? 'kept before the tide came in' : '';
    const from = cp.source === 'import' ? 'imported' : cp.source === 'copy' ? `copied from ${cp.fromName}` : `from ${sourceLabel}`;
    meta.textContent = [kind, from, ago(cp.createdAt)].filter(Boolean).join(' · ');
    title.append(name, meta);
    row.appendChild(title);
    // the non-free things on it; red when restoring here would be short
    const here = this.host.here();
    const short = here ? this.shortFor(cp, here) : [];
    const entries = Object.entries(cp.items);
    if (entries.length) {
      const chips = document.createElement('div');
      chips.className = 'cp-chips';
      for (const [id, n] of entries) {
        const c = document.createElement('span');
        c.className = `cp-chip${short.some((s) => s.item === id) ? ' short' : ''}`;
        c.textContent = `${itemById(id)?.name ?? id}${n > 1 ? ` × ${n}` : ''}`;
        chips.appendChild(c);
      }
      row.appendChild(chips);
    }
    const acts = document.createElement('div');
    acts.className = 'slot cp-acts';
    if (here) acts.appendChild(this.button('restore here', `cp-restore-${cp.id}`, () => this.restore(cp, here)));
    const others = a.beaches.filter((b) => b.id !== here);
    if (others.length) {
      // restore onto another of your beaches
      const sel = document.createElement('select');
      sel.className = 'action cp-onto';
      sel.dataset.act = `cp-onto-${cp.id}`;
      sel.setAttribute('aria-label', `Restore “${cp.name}” onto another beach`);
      sel.innerHTML = `<option value="">restore onto…</option>`;
      for (const b of others) {
        const o = document.createElement('option');
        o.value = b.id;
        o.textContent = b.name || (b.home ? 'home' : 'a beach');
        sel.appendChild(o);
      }
      sel.disabled = this.busy;
      sel.addEventListener('change', () => {
        const target = sel.value;
        sel.value = '';
        if (target) void this.restore(cp, target);
      });
      acts.appendChild(sel);
    }
    if (this.host.exportCheckpoint) acts.appendChild(this.button('export', `cp-export-${cp.id}`, () => this.run(() => this.host.exportCheckpoint!(cp))));
    acts.appendChild(
      this.button('rename', `cp-rename-${cp.id}`, async () => {
        const n = window.prompt('Name this checkpoint', cp.name);
        if (n !== null && n.trim()) await this.run(() => this.api.rename(cp.id, n.trim()));
      }),
    );
    const del = this.button('delete', `cp-delete-${cp.id}`, async () => {
      // a second tap deletes
      if (!this.confirmDelete || this.confirmDelete.id !== cp.id || performance.now() - this.confirmDelete.at > 4000) {
        this.confirmDelete = { id: cp.id, at: performance.now() };
        del.textContent = 'tap again to delete';
        return;
      }
      this.confirmDelete = null;
      await this.run(() => this.api.remove(cp.id));
    });
    acts.appendChild(del);
    row.appendChild(acts);
    return row;
  }

  private button(label: string, act: string, fn: () => Promise<void>, title = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'action';
    b.dataset.act = act;
    b.textContent = label;
    b.disabled = this.busy;
    if (title) b.title = title;
    b.addEventListener('click', () => void fn());
    return b;
  }
}
