// The beach guide and invites (docs/INVITES_GUIDE.md).
//
// The guide is a short checklist that teaches each mechanic by doing it once;
// each step gives a small gift. Invites (specs/tla/Invites.tla): a friend who
// joins through your link and makes an account gets INVITE_BONUS beech bucks,
// and so do you, for your first REWARD_CAP friends. Referrals from before the
// bonus still finish on the old item ladder once the friend settles in.
//
// Item ids must exist in the app's catalog (src/world/items.ts), and the step
// ids must match the app's guide (src/world/guide.ts); tests/guide.test.ts
// keeps them in step.

export interface GuideStepDef {
  id: string;
  /** the step's name, as the game shows it (src/world/guide.ts has the same) */
  title: string;
  /** how to do it: shown in the web guide only (server/src/guide.ts), never in the game */
  how: string;
  /** what finishing it gives (null: nothing beyond what the step itself gives) */
  gift: string | null;
  /** the server checks it's true before counting it, instead of trusting the app */
  serverChecked: boolean;
}

export const GUIDE_STEPS: GuideStepDef[] = [
  { id: 'dig', title: 'Dig in the sand', how: 'Pick the Sand tool in dig mode (the shovel) and drag on the sand. Hold still to dig deeper.', gift: 'conch', serverChecked: false },
  { id: 'pile', title: 'Build a mound', how: 'Switch the Sand tool to build (the sand dune) and drag to heap the sand up. The waves will wear it down.', gift: 'sanddollar', serverChecked: false },
  { id: 'undo', title: 'Take it back', how: 'Tap undo to take back your last stroke.', gift: 'conch', serverChecked: false },
  { id: 'place', title: 'Put something on the sand', how: 'Open the bag, pick a rock or a shell, and tap the sand.', gift: 'sanddollar', serverChecked: false },
  { id: 'chair', title: 'Sit on the beach', how: 'Tap the chair to sit and look out to sea. Hold ‹ › to walk along the shore.', gift: 'conch', serverChecked: false },
  { id: 'clear', title: 'Clear some sand away', how: 'Pick the bulldozer, flatten or vacuum from the sand tools and drag across the beach. It scrapes the sand and anything on it away; undo puts it back.', gift: 'sanddollar', serverChecked: false },
  { id: 'calm', title: 'Calm the waves', how: 'Open Manage → Settings and set the waves to calm. Gentle, lively and surf bring them back up.', gift: 'conch', serverChecked: false },
  { id: 'claw', title: 'Play the claw machine', how: 'Open the bag and play the claw machine. It’s free.', gift: null, serverChecked: true }, // the claw gives its own prize
  { id: 'vending', title: 'Try the vending machine', how: 'Open the bag and use the vending machine. It has this week’s set of things to find.', gift: null, serverChecked: true }, // the machine gives its own prize
  { id: 'visit', title: 'Visit someone’s beach', how: 'Walk down the shore, or open the most-starred beaches and pick one.', gift: 'sanddollar', serverChecked: false },
  { id: 'star', title: 'Star a beach you like', how: 'Tap ☆ on someone’s beach to star it.', gift: 'conch', serverChecked: true },
  { id: 'checkpoint', title: 'Save a checkpoint', how: 'Open Manage → Beaches, pick a beach and save a checkpoint of it. It keeps a copy you can go back to.', gift: 'sanddollar', serverChecked: true },
  { id: 'invite', title: 'Invite a friend', how: 'Share your invite link from your account page on beechshore. When your friend makes an account, you both get 50 beech bucks.', gift: null, serverChecked: true }, // the invite ladder is the reward
];

export const guideStep = (id: string): GuideStepDef | undefined => GUIDE_STEPS.find((s) => s.id === id);

/** finishing every step but `invite` also gives this */
export const GUIDE_BONUS = 'starfish';
/** the steps the bonus needs */
export const BONUS_STEPS = GUIDE_STEPS.filter((s) => s.id !== 'invite').map((s) => s.id);

/** guide steps (not counting `invite`) a friend must do to count as settled in */
export const SETTLE_STEPS = 3;
/** what a friend gets the moment they join through an invite (kept for old app versions' start screen) */
export const WELCOME_GIFT = 'parasol';
/** beech bucks a friend gets for joining through an invite, and the inviter gets for each of their first REWARD_CAP friends */
export const INVITE_BONUS = 50;
/** only accounts this new can claim an invite */
export const CLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** the inviter's rewards stop after this many friends (they still count, and still get their own bonus) */
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
