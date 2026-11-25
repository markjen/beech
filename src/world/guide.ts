// The beach guide (docs/INVITES_GUIDE.md): a checklist that teaches the game
// one mechanic at a time. The server (server/src/referrals.ts) holds the
// same step ids and the gifts; tests/guide.test.ts keeps the two in step.
// Pure, so it can be tested without a DOM.

import type { IconName } from '../ui/hud';

export type GuideStepId = 'dig' | 'pile' | 'undo' | 'place' | 'chair' | 'claw' | 'visit' | 'star' | 'invite';

export interface GuideStep {
  id: GuideStepId;
  icon: IconName;
  /** what to do, as a short imperative ("Dig in the sand") */
  title: string;
  /** how, in one line */
  how: string;
  /** needs an account (and the server) to do at all */
  needsAccount: boolean;
  /** what the server gives for it (server/src/referrals.ts), shown in the list */
  gift: string | null;
}

export const GUIDE: GuideStep[] = [
  { id: 'dig', icon: 'dig', title: 'Dig in the sand', how: 'Pick the shovel and drag on the sand. Hold still to dig deeper.', needsAccount: false, gift: 'conch' },
  { id: 'pile', icon: 'build', title: 'Build a mound', how: 'Pick the build tool and drag to heap the sand up. The waves will wear it down.', needsAccount: false, gift: 'sanddollar' },
  { id: 'undo', icon: 'undo', title: 'Take it back', how: 'Tap undo to take back your last stroke.', needsAccount: false, gift: 'conch' },
  { id: 'place', icon: 'bag', title: 'Put something on the sand', how: 'Open the bag, pick a rock or a shell, and tap the sand.', needsAccount: false, gift: 'sanddollar' },
  { id: 'chair', icon: 'chair', title: 'Sit on the beach', how: 'Tap the chair to sit and look out to sea. Hold ‹ › to walk along the shore.', needsAccount: false, gift: 'conch' },
  { id: 'claw', icon: 'claw', title: 'Play the claw machine', how: 'Open the bag and play the claw machine. It’s free.', needsAccount: true, gift: null },
  { id: 'visit', icon: 'trophy', title: 'Visit someone’s beach', how: 'Walk down the shore, or open the most-starred beaches and pick one.', needsAccount: true, gift: 'sanddollar' },
  { id: 'star', icon: 'starfish', title: 'Star a beach you like', how: 'Tap ☆ on someone’s beach to star it.', needsAccount: true, gift: 'conch' },
  { id: 'invite', icon: 'gift', title: 'Invite a friend', how: 'Share your invite link. Your friend gets a gift, and so do you.', needsAccount: true, gift: null },
];

/** finishing every step but `invite` also gives this */
export const GUIDE_BONUS = 'starfish';

export const guideStepById = (id: string): GuideStep | undefined => GUIDE.find((s) => s.id === id);

/** The steps this build can show: all of them with accounts, the local ones in the sandbox. */
export function guideSteps(accounts: boolean): GuideStep[] {
  return accounts ? GUIDE : GUIDE.filter((s) => !s.needsAccount);
}

/** The first step not done yet (in order), or null when the guide is finished. */
export function nextStep(done: ReadonlySet<string>, accounts: boolean): GuideStep | null {
  return guideSteps(accounts).find((s) => !done.has(s.id)) ?? null;
}

/** "3/9": steps done out of the steps there are. */
export function progress(done: ReadonlySet<string>, accounts: boolean): { done: number; total: number } {
  const steps = guideSteps(accounts);
  return { done: steps.filter((s) => done.has(s.id)).length, total: steps.length };
}
