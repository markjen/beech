// Checkpoints, against specs/tla/Checkpoints.tla (docs/STATE_MACHINES.md).
// Fast: the real server in-process, no rendering.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHECKPOINT_BYTES_PER_USER, CHECKPOINTS_PER_BEACH } from '../../src/checkpoints.js';
import { CheckpointsModel } from './checkpointsModel.js';
import { beachBytes, rng, startServer, type Server } from './harness.js';

const BEACH = beachBytes({});
const UNIT = BEACH.byteLength;
let s: Server;
beforeAll(async () => {
  s = await startServer();
});
afterAll(() => s.close());

let n = 0;
/** a player with a saved beach, and the store filled to leave `room` units free */
async function player(room?: number) {
  n++;
  const u = await s.signIn(`Keeper ${n}`);
  const edit = await s.claim(u.token);
  const save = await s.req(
    `/beaches/mine/${u.id}/sand`,
    {
      method: 'PUT',
      body: BEACH,
      headers: { 'X-Beach-Location': 'bondi', 'X-Beach-Nx': '16', 'X-Beach-Ny': '16', 'X-Beach-Max': '2000', 'X-Beach-Epoch': '0', 'X-Edit-Token': edit },
    },
    u.token,
  );
  expect(save.status).toBe(200);
  if (room !== undefined) {
    // an old automatic copy with no beach behind it: it takes bytes, never a named slot
    await s.db.query(
      `INSERT INTO checkpoints (id, owner_id, name, kind, source, from_beach, from_name, location, nx, ny, sand, bytes, items, objects, created_at)
       VALUES ($1, $2, 'filler', 'auto', 'beach', NULL, '', 'bondi', 16, 16, $3, $4, '{}', 0, 0)`,
      [crypto.randomUUID(), u.id, BEACH, CHECKPOINT_BYTES_PER_USER - room * UNIT],
    );
  }
  return { ...u, edit };
}
type Who = Awaited<ReturnType<typeof player>>;
const makeImport = (w: Who) =>
  s.req('/checkpoints', { method: 'POST', body: BEACH, headers: { 'X-Checkpoint-Name': 'kept', 'X-Beach-Location': 'bondi' } }, w.token);
const makeFromBeach = (w: Who, auto = false) => s.post(`/beaches/mine/${w.id}/checkpoints`, w.token, { name: 'kept', auto });
const restore = (w: Who, checkpoint: string) => s.post(`/beaches/mine/${w.id}/restore`, w.token, { checkpoint }, { 'X-Edit-Token': w.edit });
const stored = async (w: Who) => {
  const [r] = await s.db.query<{ named: string; slot: string }>(
    "SELECT COUNT(*) FILTER (WHERE kind = 'named') AS named, COUNT(*) FILTER (WHERE kind = 'auto' AND from_beach = $2) AS slot FROM checkpoints WHERE owner_id = $1",
    [w.id, w.id],
  );
  return { named: Number(r.named), slot: Number(r.slot) };
};
const bytesUsed = async (w: Who) =>
  Number((await s.db.query<{ b: string }>("SELECT COALESCE(SUM(bytes), 0) AS b FROM checkpoints WHERE owner_id = $1 AND kind <> 'tide'", [w.id]))[0].b);
/** `first` paused before its write (the INSERT, or the transaction it is in), `second` in the gap */
async function interleave(first: () => Promise<Response>, second: () => Promise<Response>) {
  const g = s.gate.pauseBefore(/INSERT INTO checkpoints/, { orTransaction: true });
  const a = first();
  await g.reached;
  const b = await second();
  g.release();
  return [(await a).status, b.status];
}

describe('checkpoints: transitions', () => {
  it('MakeCheck: two devices making the last named checkpoint at once keep one (the Checkpoints.cfg NamedWithinLimit trace)', async () => {
    const w = await player();
    for (let i = 0; i < CHECKPOINTS_PER_BEACH - 1; i++) expect((await makeImport(w)).status).toBe(201);
    expect(await interleave(() => makeImport(w), () => makeFromBeach(w))).toEqual([409, 201]);
    expect((await stored(w)).named).toBe(CHECKPOINTS_PER_BEACH);
  });

  it('MakeCheck and AutoCheck: a named checkpoint and an automatic copy at once with room for one keep one (the FitsWhenAdded trace)', async () => {
    const w = await player(1);
    expect(await interleave(() => makeImport(w), () => makeFromBeach(w, true))).toEqual([413, 201]);
    expect(await bytesUsed(w)).toBeLessThanOrEqual(CHECKPOINT_BYTES_PER_USER);
  });

  it('Restore: fills the beach slot even when the store is full, and the next checked write is refused', async () => {
    const w = await player(1);
    const made = await makeImport(w);
    expect(made.status).toBe(201);
    const id = ((await made.json()) as { checkpoint: { id: string } }).checkpoint.id;
    expect((await restore(w, id)).status).toBe(200);
    expect(await bytesUsed(w)).toBe(CHECKPOINT_BYTES_PER_USER + UNIT);
    expect((await makeImport(w)).status).toBe(413);
  });
});

describe('checkpoints: random walks, server vs model', () => {
  for (const seed of [91, 92, 93, 94, 95, 96]) {
    it(`seed ${seed}: makes, automatic copies, restores and deletes (some at once) agree with the model`, async () => {
      const r = rng(seed);
      const room = 3 + r.int(4);
      const w = await player(room);
      let m = new CheckpointsModel(CHECKPOINTS_PER_BEACH, room);
      const ids: string[] = [];
      const trace: string[] = [];
      const keep = async (res: Response) => {
        if (res.status === 201) {
          const c = ((await res.json()) as { checkpoint: { id: string; kind: string } }).checkpoint;
          if (c.kind === 'named') ids.push(c.id);
        }
        return res.status;
      };
      for (let step = 0; step < 30; step++) {
        const x = r.next();
        if (x < 0.15 && ids.length) {
          const id = ids.splice(r.int(ids.length), 1)[0];
          expect((await s.req(`/checkpoints/${id}`, { method: 'DELETE' }, w.token)).status).toBe(204);
          m.deleteNamed();
          trace.push('delete');
        } else if (x < 0.25 && ids.length) {
          const got = (await restore(w, r.pick(ids))).status;
          trace.push(`restore=${got}`);
          expect(got, trace.join(' ')).toBe(m.restore());
        } else {
          // one or two at once: named (import or from the beach) or an automatic copy
          const kinds = Array.from({ length: r.next() < 0.4 ? 2 : 1 }, () => r.pick(['import', 'beach', 'auto'] as const));
          const got = await Promise.all(kinds.map((k) => (k === 'import' ? makeImport(w) : makeFromBeach(w, k === 'auto')).then(keep)));
          trace.push(kinds.map((k, i) => `${k}=${got[i]}`).join(' '));
          // requests at once may land in either order: the answers must match
          // the model run in one of them (an automatic copy that only replaces
          // the beach's slot can go first and leave room for a named one)
          const outcomes = [kinds.map((k, i) => ({ k, g: got[i] }))];
          if (kinds.length === 2) outcomes.push([...outcomes[0]].reverse());
          const fits = outcomes
            .map((order) => {
              const t = Object.assign(new CheckpointsModel(m.limit, m.cap), m);
              const ok = order.every(({ k, g }) => g === (k === 'auto' ? t.autoCopy() : t.make()));
              return ok ? t : null;
            })
            .find((t) => t !== null);
          expect(fits ? got : 'no order fits', trace.join(' ')).toEqual(got);
          m = fits!;
        }
        expect(m.check()).toEqual([]);
        expect(await stored(w), trace.join(' ')).toEqual({ named: m.named, slot: m.slot });
      }
    });
  }
});
