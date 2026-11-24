// Beach files in the app: pick a `.beach.json`, preview it (a map, what's on
// it, warnings, what your bag can't cover), then replace this beach.
// The format is docs/BEACH_FILE.md; reading and writing live in
// src/world/beachFile.ts.

import { isMobileApp, steamBridge } from '../platform/runtime';
import { PROFILE, WORLD_SIZE_X } from '../config';
import { applyRockCover, type PlacedObject } from '../sim/objects';
import { buildRestProfile, restHeight } from '../sim/profile';
import { parseBeachFile, reconcileItems, type ImportedBeach, type Issue, type Shortfall } from '../world/beachFile';
import { itemById } from '../world/items';

export interface BeachFileHost {
  /** the grid the sim runs at */
  grid: () => { nx: number; ny: number };
  /** non-free items you own, and how many are on your other beaches */
  owned: () => ReadonlyMap<string, number>;
  placedElsewhere: () => ReadonlyMap<string, number>;
  /** the sandbox has no bag: only free items can come in */
  hasBag: boolean;
  /** put it on the beach */
  apply: (beach: ImportedBeach) => void;
  /** before replacing the beach: keep it as its "Before import" checkpoint (signed in) */
  beforeApply?: () => Promise<void>;
  /** keep the file as a checkpoint instead (signed in; all of its things, checked when restored) */
  saveAsCheckpoint?: (beach: ImportedBeach, fallbackName: string) => Promise<void>;
  /** open the shop (production builds) */
  shop?: () => void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const pathOf = (i: Issue) => (i.path ? `<code>${esc(i.path)}</code> ` : '');

/** Let the person pick a file (resolves null if they cancel). */
export function pickFile(accept = '.json,.beach.json,application/json'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // the phone pickers grey out files whose type they can't map from the
    // extension (".beach.json" is often unknown), so let any file be picked
    // there; the reader says if it isn't a beach file
    if (!isMobileApp()) input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    let done = false;
    const finish = (f: File | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(f);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    input.click();
  });
}

/**
 * Save a beach file: the share sheet in the phone apps (a download can't
 * leave their WebView), the OS save dialog on Steam, or a download on the web.
 */
export async function saveText(name: string, text: string): Promise<void> {
  const steam = steamBridge();
  if (steam) {
    await steam.saveBeachFile(name, text);
    return;
  }
  if (isMobileApp()) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    try {
      await Share.share({ title: name, files: [uri] });
    } catch {
      /* the person closed the share sheet */
    }
    return;
  }
  downloadText(name, text);
}

/** Save text as a file (a download on the web). */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A file name for a beach: `castle-cove-2026-11-23.beach.json`. */
export function beachFileName(name: string, now = new Date()): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'beach';
  return `${slug}-${now.toISOString().slice(0, 10)}.beach.json`;
}

export class BeachFileDialog {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private isOpen = false;

  constructor(
    parent: HTMLElement,
    private readonly host: BeachFileHost,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'claw beachfile';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Import a beach');
    this.root.innerHTML = `
      <div class="claw-card shop-card beachfile-card">
        <button type="button" class="claw-close" aria-label="Close">×</button>
        <h2>Import a beach</h2>
        <div class="beachfile-body"></div>
      </div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.beachfile-body')!;
    this.root.querySelector('.claw-close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  /** Pick a file and show what it holds. */
  async pick(): Promise<void> {
    const file = await pickFile();
    if (file) await this.show(file.name, await file.text());
  }

  /** Preview a beach file's text. */
  async show(fileName: string, text: string): Promise<void> {
    this.open();
    this.body.innerHTML = `<p class="shop-note">Reading ${esc(fileName)}…</p>`;
    const { nx, ny } = this.host.grid();
    const r = await parseBeachFile(text, { nx, ny });
    if (!r.ok) {
      this.body.innerHTML = `
        <p class="shop-note">${esc(fileName)} isn't a beach file this app can open:</p>
        <ul class="beachfile-issues bad">${r.errors.map((e) => `<li>${pathOf(e)}${esc(e.message)}</li>`).join('')}</ul>
        <div class="beachfile-actions"><button type="button" class="claw-go" data-act="close">Close</button></div>`;
      this.body.querySelector('[data-act="close"]')!.addEventListener('click', () => this.close());
      return;
    }
    const beach = r.beach;
    const { keep, missing } = reconcileItems(beach.objects, this.host.owned(), this.host.placedElsewhere());
    this.render(fileName, beach, keep, missing, r.warnings);
  }

  private render(fileName: string, beach: ImportedBeach, keep: PlacedObject[], missing: Shortfall[], warnings: Issue[]): void {
    const counts = new Map<string, number>();
    for (const o of beach.objects) counts.set(o.item, (counts.get(o.item) ?? 0) + 1);
    const chips = [...counts]
      .map(([id, n]) => {
        const short = missing.find((m) => m.item === id);
        return `<span class="beachfile-chip${short ? ' short' : ''}">${esc(itemById(id)?.name ?? id)} × ${n}</span>`;
      })
      .join('');
    const shortText = missing
      .map((m) => `${plural(m.need, itemById(m.item)?.name.toLowerCase() ?? m.item)}: ${m.have ? `you have ${m.have} free` : 'you have none'}`)
      .join('<br>');
    const lead = this.host.hasBag
      ? 'Some things on it aren’t in your bag:'
      : 'Left out:';
    this.body.innerHTML = `
      <p class="shop-note"><b>${esc(beach.name ?? fileName)}</b></p>
      <canvas class="beachfile-map" width="160" height="160" aria-label="Map of the beach, sea at the bottom"></canvas>
      <div class="beachfile-chips">${chips || '<span class="shop-what">No things on it, just sand.</span>'}</div>
      ${missing.length ? `<p class="beachfile-short">${lead}<br>${shortText}</p>` : ''}
      ${warnings.length ? `<details class="beachfile-warn"><summary>${plural(warnings.length, 'thing')} fixed while reading</summary><ul class="beachfile-issues">${warnings.map((w) => `<li>${pathOf(w)}${esc(w.message)}</li>`).join('')}</ul></details>` : ''}
      <div class="beachfile-actions">
        <button type="button" class="claw-go" data-act="apply">${missing.length ? 'Import without them' : 'Replace this beach'}</button>
        ${missing.length && this.host.shop ? '<button type="button" class="shop-buy" data-act="shop">Shop</button>' : ''}
      </div>
      ${this.host.saveAsCheckpoint ? '<button type="button" class="action beachfile-keep" data-act="keep">keep it as a checkpoint instead</button>' : ''}`;
    drawMap(this.body.querySelector('canvas')!, beach, keep);
    this.body.querySelector('[data-act="apply"]')!.addEventListener('click', async () => {
      this.close();
      try {
        await this.host.beforeApply?.();
      } catch (e) {
        // no copy (offline, or checkpoints full): the sim's Undo still brings it back
        console.warn('could not keep the beach before importing:', (e as Error).message);
      }
      this.host.apply({ ...beach, objects: keep });
    });
    this.body.querySelector('[data-act="keep"]')?.addEventListener('click', async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      b.disabled = true;
      try {
        await this.host.saveAsCheckpoint!(beach, fileName.replace(/(\.beach)?\.json$/i, ''));
        this.close();
      } catch (err) {
        b.disabled = false;
        b.textContent = (err as Error).message;
      }
    });
    this.body.querySelector('[data-act="shop"]')?.addEventListener('click', () => {
      this.close();
      this.host.shop?.();
    });
  }

  private open(): void {
    this.isOpen = true;
    this.root.classList.add('open');
  }

  close(): void {
    this.isOpen = false;
    this.root.classList.remove('open');
  }
}

/**
 * A small top-down map: water blue, sand by height, objects as dots. Sea at
 * the bottom. (Also the checkpoints' thumbnails.)
 */
export function drawMap(canvas: HTMLCanvasElement, beach: { nx: number; ny: number; delta: Float32Array; cover?: Float32Array }, objects: PlacedObject[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // The saved delta is stripped of the sand piled over buried rocks, so lift
  // it back with the same cover math the neighbor views use (on a copy —
  // the caller's delta stays stripped).
  let delta = beach.delta;
  if (beach.cover) {
    const dx = WORLD_SIZE_X / beach.nx;
    delta = Float32Array.from(beach.delta);
    applyRockCover(delta, buildRestProfile({ nx: beach.nx, ny: beach.ny, dx }), beach.nx, beach.ny, dx, objects, beach.cover);
  }
  const W = canvas.width;
  const img = ctx.createImageData(W, W);
  const s = WORLD_SIZE_X / W;
  for (let py = 0; py < W; py++) {
    const y = (W - 1 - py + 0.5) * s; // row 0 of the image is the land edge
    const j = Math.min(beach.ny - 1, Math.floor((y / WORLD_SIZE_X) * beach.ny));
    for (let px = 0; px < W; px++) {
      const x = (px + 0.5) * s;
      const i = Math.min(beach.nx - 1, Math.floor((x / WORLD_SIZE_X) * beach.nx));
      const h = restHeight(x, y) + delta[j * beach.nx + i];
      const o = (py * W + px) * 4;
      if (h < 0) {
        const d = Math.min(1, -h / PROFILE.offshoreDepth);
        img.data[o] = 110 - 70 * d;
        img.data[o + 1] = 190 - 70 * d;
        img.data[o + 2] = 205 - 40 * d;
      } else {
        const t = Math.min(1, h / 1.6);
        img.data[o] = 214 + 35 * t;
        img.data[o + 1] = 188 + 45 * t;
        img.data[o + 2] = 140 + 70 * t;
      }
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  for (const ob of objects) {
    ctx.fillStyle = ob.kind === 'rock' ? '#6d6a72' : ob.kind === 'driftwood' ? '#8a6a4a' : '#e0567a';
    ctx.beginPath();
    ctx.arc(ob.x / s, W - ob.y / s, Math.max(1.5, Math.min(5, ob.size / s)), 0, Math.PI * 2);
    ctx.fill();
  }
}
