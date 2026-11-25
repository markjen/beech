// The beach guide and invites (docs/INVITES_GUIDE.md).
//
// The guide is a short checklist that teaches each mechanic by doing it once;
// each step gives a small gift. Invites: a friend who joins through your link
// gets a welcome gift; you get the next rung of the ladder once they've
// settled in (done SETTLE_STEPS steps of the guide).
//
// Item ids must exist in the app's catalog (src/world/items.ts), and the step
// ids must match the app's guide (src/world/guide.ts); tests/guide.test.ts
// keeps them in step.

export interface GuideStepDef {
  id: string;
  /** what finishing it gives (null: nothing beyond what the step itself gives) */
  gift: string | null;
  /** the server checks it's true before counting it, instead of trusting the app */
  serverChecked: boolean;
}

export const GUIDE_STEPS: GuideStepDef[] = [
  { id: 'dig', gift: 'conch', serverChecked: false },
  { id: 'pile', gift: 'sanddollar', serverChecked: false },
  { id: 'undo', gift: 'conch', serverChecked: false },
  { id: 'place', gift: 'sanddollar', serverChecked: false },
  { id: 'chair', gift: 'conch', serverChecked: false },
  { id: 'claw', gift: null, serverChecked: true }, // the claw gives its own prize
  { id: 'visit', gift: 'sanddollar', serverChecked: false },
  { id: 'star', gift: 'conch', serverChecked: true },
  { id: 'invite', gift: null, serverChecked: true }, // the invite ladder is the reward
];

export const guideStep = (id: string): GuideStepDef | undefined => GUIDE_STEPS.find((s) => s.id === id);

/** finishing every step but `invite` also gives this */
export const GUIDE_BONUS = 'starfish';
/** the steps the bonus needs */
export const BONUS_STEPS = GUIDE_STEPS.filter((s) => s.id !== 'invite').map((s) => s.id);

/** guide steps (not counting `invite`) a friend must do to count as settled in */
export const SETTLE_STEPS = 3;
/** what a friend gets the moment they join through an invite */
export const WELCOME_GIFT = 'parasol';
/** only accounts this new can claim an invite */
export const CLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** rewards stop after this many settled friends (they still count) */
export const REWARD_CAP = 10;

/** What the inviter gets for their nth settled friend (1-based); null past the cap. */
export function ladderReward(rank: number): string | null {
  if (!Number.isInteger(rank) || rank < 1 || rank > REWARD_CAP) return null;
  return LADDER[rank - 1] ?? LADDER_REST;
}
const LADDER = ['parasol', 'surfboard', 'beach', 'tikitorch', 'sandcastle'];
const LADDER_REST = 'starfish';

/** The whole ladder, for the invite panel. */
export function ladder(): { rank: number; item: string }[] {
  return Array.from({ length: REWARD_CAP }, (_, i) => ({ rank: i + 1, item: ladderReward(i + 1)! }));
}
