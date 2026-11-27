// The global beachfront: beaches, their neighbor links, and the walk along
// the shore. Shared by the game API (app.ts, signed in) and the public shore
// site (shoreSite.ts, beechshore.com), so both walk the shore in the same
// order.
//
// Linked neighbors make stretches of shore. Past the end of a stretch the
// shore carries on into the next stretch, in a fixed order (by when each
// stretch's right-hand end joined), round and round. So you can keep walking
// either way and meet everyone.

import type { Db } from './db.js';
import { RATING_SHOWN_AT } from './inbox.js';

export const SIDES = ['left', 'right'] as const;
export type Side = (typeof SIDES)[number];

/** "k7f 2qx", "K7F-2QX" -> "K7F2QX" */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface NodeRow {
  id: string;
  name: string;
  beach_name: string;
  owner_id: string;
  code: string;
  created_at: string;
  location: string | null;
  updated_at: string | null;
  /** bumped by every change to the sand: saves, restores, and the sea's catch-up (docs/LIVE_SIM.md) */
  version: string | number;
  on_shore: boolean;
  saved: boolean;
  /** a pier is attached and its beach qualifies, so it shows (docs/PIERS.md) */
  pier: boolean;
  /** its inland sections' types, front row first, comma-separated (docs/INLAND_SECTIONS.md); null: none */
  sections: string | null;
  /** its ratings: how many, and their average in shells (docs/INBOX_NOTIFICATIONS.md) */
  rating_count: string | number;
  rating_avg: string | number | null;
}
/**
 * A beach of `b`'s owner is linked on `b`'s `side` (docs/PIERS.md): the
 * pier site test. Links are mutual and a beach can't be both neighbors of
 * another, so a left and a right one are two different beaches.
 */
export const OWN_SIDE = (side: 'left' | 'right') =>
  `EXISTS (SELECT 1 FROM neighbors pn JOIN beach pb ON pb.id = pn.neighbor_beach_id
            WHERE pn.beach_id = b.id AND pn.side = '${side}' AND pb.owner_id = b.owner_id)`;
/** `b` sits between two of its owner's own beaches */
export const PIER_SITE = `(${OWN_SIDE('left')} AND ${OWN_SIDE('right')})`;
/** `b` shows a pier: one is attached, and the beach still qualifies (a dormant one doesn't show) */
export const PIER_SHOWN = `(EXISTS (SELECT 1 FROM beach_piers bp WHERE bp.beach_id = b.id) AND ${PIER_SITE})`;
/** a beach and its owner's first name (select list, with `BEACH` as the FROM) */
/** `b`'s inland sections, front row first (docs/INLAND_SECTIONS.md). Rows are kept packed from 0. */
export const SECTIONS_OF = `(SELECT string_agg(bs.item_id, ',' ORDER BY bs.row) FROM beach_sections bs WHERE bs.beach_id = b.id)`;
/** `b`'s ratings, how many and their average (ratings_beach index) */
export const RATING_OF = `(SELECT COUNT(*) FROM ratings rt WHERE rt.beach_id = b.id) AS rating_count, (SELECT AVG(rt.shells) FROM ratings rt WHERE rt.beach_id = b.id) AS rating_avg`;
export const NODE = `b.id, u.name, b.name AS beach_name, b.owner_id, b.code, b.created_at, b.location, b.updated_at, b.version, b.on_shore, (b.sand IS NOT NULL) AS saved, ${PIER_SHOWN} AS pier, ${SECTIONS_OF} AS sections, ${RATING_OF}`;

/** A beach's average for its name tag: shown once it has RATING_SHOWN_AT ratings, to one decimal. */
export function ratingShown(count: string | number | null | undefined, avg: string | number | null | undefined): { average: number; count: number } | null {
  const n = Number(count ?? 0);
  if (!(n >= RATING_SHOWN_AT) || avg === null || avg === undefined) return null;
  return { average: Math.round(Number(avg) * 10) / 10, count: n };
}
export const BEACH = `beach b JOIN users u ON u.id = b.owner_id`;

export const beachJson = (r: NodeRow) => ({
  /** the client keeps beach state by id (docs/BEACH_STORE.md); id-scoped endpoints still check the owner */
  id: r.id,
  code: r.code,
  name: r.name,
  /** the beach's own name, if its owner gave it one ("Bondi") */
  beachName: r.beach_name || undefined,
  location: r.location,
  updatedAt: r.updated_at === null ? null : Number(r.updated_at),
  /** the sand's version: a catch-up moves it without a save (pictures carry it) */
  version: Number(r.version ?? 0),
  /** it shows a pier (left out when it doesn't) */
  ...(r.pier ? { pier: true as const } : {}),
  /** its inland sections' types, front row first (left out when it has none) */
  ...(r.sections ? { sections: r.sections.split(',') } : {}),
  /** its average in shells and how many rated it, once there are enough (left out before) */
  ...((rating) => (rating ? { rating } : {}))(ratingShown(r.rating_count, r.rating_avg)),
});
export type BeachJson = ReturnType<typeof beachJson>;
export type Step = BeachJson & { linked: boolean };

/**
 * The version a beach's pictures carry (`?v=`): its save time, and whether
 * its pier shows, since placing, removing or pausing one changes the
 * pictures without a save (docs/PIERS.md). Picture URLs are cached for
 * good, so anything drawn has to be in here.
 */
export const imageVersion = (updatedAt: number | string | null | undefined, pier: boolean | undefined, version?: number | string | null): string =>
  `${updatedAt ?? 0}${version ? `-${version}` : ''}${pier ? PIER_LOOK : ''}`;
/** the pier's look in pictures: bump when its shape changes (2: the higher deck, 2026-11-27) */
const PIER_LOOK = 'p2';

/** Can anyone, signed in or not, see this beach (beechshore.com)? On the shore and saved. */
export const isPublic = (r: Pick<NodeRow, 'on_shore' | 'saved'>): boolean => !!r.on_shore && !!r.saved;

export function shoreGraph(db: Db) {
  const nodeById = async (id: string): Promise<NodeRow | null> =>
    (await db.query<NodeRow>(`SELECT ${NODE} FROM ${BEACH} WHERE b.id = $1`, [id], 'shore.nodeById'))[0] ?? null;
  const nodeByCode = async (raw: string): Promise<NodeRow | null> => {
    const code = normalizeCode(raw ?? '');
    if (code.length !== 6) return null;
    return (await db.query<NodeRow>(`SELECT ${NODE} FROM ${BEACH} WHERE b.code = $1`, [code], 'shore.nodeByCode'))[0] ?? null;
  };
  /** which beach is on beach `id`'s `side`, if any */
  const linked = async (id: string, side: Side): Promise<NodeRow | null> =>
    (
      await db.query<NodeRow>(
        `SELECT ${NODE} FROM neighbors n JOIN ${BEACH} ON b.id = n.neighbor_beach_id WHERE n.beach_id = $1 AND n.side = $2`,
        [id, side],
        'shore.linked',
      )
    )[0] ?? null;

  /** the far end of a's stretch, going `side` */
  const endOf = async (a: NodeRow, side: Side): Promise<NodeRow> => {
    let at = a;
    const seen = new Set([a.id]);
    for (let i = 0; i < 2000; i++) {
      const next = await linked(at.id, side);
      if (!next || seen.has(next.id)) break;
      seen.add(next.id);
      at = next;
    }
    return at;
  };
  // the right-hand ends of stretches worth visiting (someone with a beach, or linked to someone)
  const ENDS = `FROM ${BEACH}
     WHERE b.on_shore
       AND NOT EXISTS (SELECT 1 FROM neighbors n WHERE n.beach_id = b.id AND n.side = 'right')
       AND (b.sand IS NOT NULL OR EXISTS (SELECT 1 FROM neighbors n WHERE n.beach_id = b.id))`;
  /** From the end of a stretch, the first beach of the next stretch going `dir`. */
  const nextStretch = async (at: NodeRow, dir: Side): Promise<NodeRow | null> => {
    const r = await endOf(at, 'right');
    const key = [r.created_at, r.id];
    // came all the way round to the stretch we started in: that's everyone
    const same = (n: NodeRow | undefined) => !!n && n.id === r.id;
    if (dir === 'left') {
      const rows =
        (await db.query<NodeRow>(`SELECT ${NODE} ${ENDS} AND (b.created_at, b.id) > ($1::bigint, $2::uuid) ORDER BY b.created_at, b.id LIMIT 1`, key, 'shore.nextStretch')).concat(
          await db.query<NodeRow>(`SELECT ${NODE} ${ENDS} ORDER BY b.created_at, b.id LIMIT 1`, [], 'shore.nextStretch'),
        );
      return rows[0] && !same(rows[0]) ? rows[0] : null; // enter it at its right-hand end, walking left
    }
    const rows =
      (await db.query<NodeRow>(`SELECT ${NODE} ${ENDS} AND (b.created_at, b.id) < ($1::bigint, $2::uuid) ORDER BY b.created_at DESC, b.id DESC LIMIT 1`, key, 'shore.nextStretch')).concat(
        await db.query<NodeRow>(`SELECT ${NODE} ${ENDS} ORDER BY b.created_at DESC, b.id DESC LIMIT 1`, [], 'shore.nextStretch'),
      );
    return rows[0] && !same(rows[0]) ? endOf(rows[0], 'left') : null; // enter it at its left-hand end, walking right
  };

  /**
   * Walk up to `count` beaches each way from `from` (one step left, one step
   * right, and so on, so the nearest come first and a small world isn't all
   * used up on one side). `linked` says if a beach is a real neighbor of the
   * one before it. Stops in a direction once it comes round to someone seen.
   *
   * `keep` (the public site: `isPublic`) walks past beaches it rejects
   * without listing them, so both sites keep the same order; a beach after
   * a skipped one isn't `linked`. At most `count × 4` steps each way.
   */
  const walk = async (from: NodeRow, dirs: readonly Side[], count: number, seen: Set<string>, keep?: (n: NodeRow) => boolean) => {
    const out: Record<Side, Step[]> = { left: [], right: [] };
    const at: Record<Side, NodeRow> = { left: from, right: from };
    const chain: Record<Side, boolean> = { left: true, right: true };
    const done = new Set<Side>(SIDES.filter((d) => !dirs.includes(d)));
    const maxSteps = keep ? count * 4 : count;
    for (let i = 0; i < maxSteps && done.size < 2; i++) {
      for (const dir of dirs) {
        if (done.has(dir)) continue;
        let next = await linked(at[dir].id, dir);
        let isLink = true;
        if (!next) {
          next = await nextStretch(at[dir], dir);
          isLink = false;
        }
        if (!next || seen.has(next.id)) {
          done.add(dir); // been all the way round
          continue;
        }
        seen.add(next.id);
        at[dir] = next;
        if (keep && !keep(next)) {
          chain[dir] = false;
          continue;
        }
        out[dir].push({ ...beachJson(next), linked: isLink && chain[dir] });
        chain[dir] = true;
        if (out[dir].length >= count) done.add(dir);
      }
    }
    return out;
  };

  return { nodeById, nodeByCode, linked, endOf, nextStretch, walk };
}
