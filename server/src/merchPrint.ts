// A beach as a merch print (docs/MERCH_STORE.md): the shore's top-down
// picture (beachImage.ts), seen straight from above, its colours muted so it
// sits quietly on a soft shirt, a mug or a wall. Two cuts:
//   square: the middle of the beach, sea at the top (the 10″ square on a
//           shirt's back, stickers, pillows);
//   flat:   the whole beach, wider than tall (wall art, mugs, the towel).
// Used for a buyer's own beach (merch.ts, per order) and for the sample
// beach, Sunny cove (scripts/merch-sample.mts, into public/merch).
import { decodeSavedBeach, encodePng, pictureHeight, renderBeach, type SavedSand } from './beachImage.js';
import { MERCH } from './merchCatalog.js';

export type PrintCut = 'square' | 'flat';

export interface PrintLook {
  location?: string | null;
  pier?: boolean;
  /** its inland rows, front row first (drawn under the beach on the flat cut) */
  sections?: string[];
}

/** Mute RGB pixels in place: a little toward gray, a little toward white. */
export function mute(rgb: Uint8Array, gray = 0.3, white = 0.12): Uint8Array {
  for (let i = 0; i < rgb.length; i += 3) {
    const l = rgb[i] * 0.3 + rgb[i + 1] * 0.59 + rgb[i + 2] * 0.11;
    for (let k = 0; k < 3; k++) {
      const v = rgb[i + k] * (1 - gray) + l * gray;
      rgb[i + k] = Math.round(v * (1 - white) + 255 * white);
    }
  }
  return rgb;
}

/** The beach's picture for a print, as a PNG. */
export function beachPrintPng(bytes: Uint8Array | null, look: PrintLook, cut: PrintCut, scale = 1): Buffer {
  let sand: SavedSand | null = null;
  if (bytes) {
    try {
      sand = decodeSavedBeach(bytes);
    } catch {
      sand = null; // a broken save still prints the beach
    }
  }
  if (cut === 'flat') {
    const opts = { width: Math.round(MERCH.flatWidth * scale), height: Math.round(MERCH.flatHeight * scale), location: look.location, pier: look.pier, sections: look.sections ?? [] };
    return encodePng(mute(renderBeach(sand, opts)), opts.width, pictureHeight(opts));
  }
  // the square: draw the beach at the card's proportions, S tall, and keep the middle S × S
  const S = Math.round(MERCH.squarePx * scale);
  const W = Math.round((S * MERCH.flatWidth) / MERCH.flatHeight);
  const rgb = renderBeach(sand, { width: W, height: S, location: look.location, pier: look.pier });
  const x0 = Math.floor((W - S) / 2);
  const out = new Uint8Array(S * S * 3);
  for (let y = 0; y < S; y++) out.set(rgb.subarray((y * W + x0) * 3, (y * W + x0 + S) * 3), y * S * 3);
  return encodePng(mute(out), S, S);
}
