import { describe, expect, it, vi } from 'vitest';
import { snapshotBeforeBigEdit } from '../src/net/bigEditSnapshot';

const base = () => ({
  fenced: false,
  signedIn: true,
  beachId: 'beach-1',
  alreadyAttempted: false,
  flush: vi.fn(async () => {}),
  saveAutoCheckpoint: vi.fn(async (_id: string, _name: string) => {}),
});

describe('snapshotBeforeBigEdit', () => {
  it('flushes first, then snapshots the beach into its auto slot', async () => {
    const opts = base();
    const order: string[] = [];
    opts.flush = vi.fn(async () => {
      order.push('flush');
    });
    opts.saveAutoCheckpoint = vi.fn(async () => {
      order.push('snapshot');
    });
    expect(await snapshotBeforeBigEdit(opts)).toBe('done');
    expect(order).toEqual(['flush', 'snapshot']);
    expect(opts.saveAutoCheckpoint).toHaveBeenCalledWith('beach-1', `Before big edit ${new Date().toISOString().slice(0, 10)}`);
  });

  it('skips a fenced instance, a signed-out player, and a repeat since the last save', async () => {
    expect(await snapshotBeforeBigEdit({ ...base(), fenced: true })).toBe('skipped');
    expect(await snapshotBeforeBigEdit({ ...base(), signedIn: false })).toBe('skipped');
    expect(await snapshotBeforeBigEdit({ ...base(), beachId: null })).toBe('skipped');
    expect(await snapshotBeforeBigEdit({ ...base(), alreadyAttempted: true })).toBe('skipped');
    const opts = base();
    expect(await snapshotBeforeBigEdit({ ...opts, fenced: true })).toBe('skipped');
    expect(opts.flush).not.toHaveBeenCalled();
    expect(opts.saveAutoCheckpoint).not.toHaveBeenCalled();
  });

  it('a failed flush or snapshot never throws, so the stroke goes ahead anyway', async () => {
    const flushFails = { ...base(), flush: vi.fn(async () => { throw new Error('offline'); }) };
    expect(await snapshotBeforeBigEdit(flushFails)).toBe('failed');
    expect(flushFails.saveAutoCheckpoint).not.toHaveBeenCalled();
    const saveFails = { ...base(), saveAutoCheckpoint: vi.fn(async () => { throw new Error('no saved beach yet'); }) };
    expect(await snapshotBeforeBigEdit(saveFails)).toBe('failed');
    expect(saveFails.flush).toHaveBeenCalled();
  });
});
