// The beach guide (docs/INVITES_GUIDE.md): a checklist that teaches the game
// one mechanic at a time. The server (server/src/referrals.ts) holds the
// same step ids and the gifts; tests/guide.test.ts keeps the two in step.
// Pure, so it can be tested without a DOM.

import type { IconName } from '../ui/hud';

export type GuideStepId = 'dig' | 'pile' | 'undo' | 'place' | 'chair' | 'clear' | 'calm' | 'claw' | 'vending' | 'visit' | 'star' | 'checkpoint' | 'invite';

export interface GuideStep {
  id: GuideStepId;
  icon: IconName;
  /** what to do, as a short imperative ("Dig in the sand") */
  title: string;
  /** needs an account (and the server) to do at all */
  needsAccount: boolean;
  /** what the server gives for it (server/src/referrals.ts), shown in the list */
  gift: string | null;
}

export const GUIDE: GuideStep[] = [
  { id: 'dig', icon: 'dig', title: 'Dig in the sand', needsAccount: false, gift: 'conch' },
  { id: 'pile', icon: 'build', title: 'Build a mound', needsAccount: false, gift: 'sanddollar' },
  { id: 'undo', icon: 'undo', title: 'Take it back', needsAccount: false, gift: 'conch' },
  { id: 'place', icon: 'bag', title: 'Put something on the sand', needsAccount: false, gift: 'sanddollar' },
  { id: 'chair', icon: 'chair', title: 'Sit on the beach', needsAccount: false, gift: 'conch' },
  { id: 'clear', icon: 'dozer', title: 'Clear some sand away', needsAccount: false, gift: 'sanddollar' },
  { id: 'calm', icon: 'calm', title: 'Calm the waves', needsAccount: false, gift: 'conch' },
  { id: 'claw', icon: 'claw', title: 'Play the claw machine', needsAccount: true, gift: null },
  { id: 'vending', icon: 'vending', title: 'Try the vending machine', needsAccount: true, gift: null },
  { id: 'visit', icon: 'trophy', title: 'Visit someone’s beach', needsAccount: true, gift: 'sanddollar' },
  { id: 'star', icon: 'starfish', title: 'Star a beach you like', needsAccount: true, gift: 'conch' },
  { id: 'checkpoint', icon: 'flag', title: 'Save a checkpoint', needsAccount: true, gift: 'sanddollar' },
  { id: 'invite', icon: 'gift', title: 'Invite a friend', needsAccount: true, gift: null },
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
