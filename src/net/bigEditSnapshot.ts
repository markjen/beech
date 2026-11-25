/**
 * The "before big edit" snapshot, taken on the client (docs/CHECKPOINTS.md):
 * when the player picks up a clearing tool — bulldozer, flatten, vacuum —
 * the beach as it is now is worth keeping before the first stroke lands.
 * The server's save-diff backstop (server/src/app.ts, maybeLargeEditSave)
 * catches any large save whatever the client, but it only sees the last
 * *saved* beach: a long clearing session autosaves in chunks, and each chunk
 * alone can stay under the large-edit threshold while the session as a whole
 * reshapes the beach. The intent — starting to clear — is the trigger the
 * server cannot see, so the client snapshots once, at the first clearing
 * stroke after the last save, and then leaves the server to it.
 *
 * Best-effort on purpose: the stroke is already under the player's finger,
 * so a failed snapshot never blocks it. The flush first saves any unsaved
 * work (a moat dug a minute ago belongs in the "before" copy), then the
 * snapshot copies the saved beach into its one auto slot, replacing
 * whatever auto copy was there. If either step fails — no saved beach yet,
 * offline, the store full — the stroke goes ahead anyway and the server
 * backstop still gets its chance at the next save.
 */
export type BigEditSnapshotResult = 'done' | 'skipped' | 'failed';

export async function snapshotBeforeBigEdit(opts: {
  /** this instance is view-only: it cannot edit, so it must not snapshot either */
  fenced: boolean;
  /** signed out, or the sandbox build: no server checkpoints at all */
  signedIn: boolean;
  /** which beach is being cleared (null before the first beach loads) */
  beachId: string | null;
  /** a snapshot has already been taken (or attempted) since the last save */
  alreadyAttempted: boolean;
  /** save what is on screen now, so the snapshot holds the pre-stroke beach */
  flush: () => Promise<void>;
  /** POST /api/beaches/mine/:id/checkpoints { name, auto: true } */
  saveAutoCheckpoint: (beachId: string, name: string) => Promise<void>;
  now?: Date;
}): Promise<BigEditSnapshotResult> {
  if (opts.fenced || !opts.signedIn || !opts.beachId || opts.alreadyAttempted) return 'skipped';
  try {
    await opts.flush();
    const day = (opts.now ?? new Date()).toISOString().slice(0, 10);
    await opts.saveAutoCheckpoint(opts.beachId, `Before big edit ${day}`);
    return 'done';
  } catch {
    return 'failed';
  }
}
