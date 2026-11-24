import { steamBridge } from './runtime';

export type SteamAchievementId =
  | 'FIRST_DIG'
  | 'CHAIR_VIEW'
  | 'NIGHT_BEACH'
  | 'WALK_SHORE'
  | 'FIRST_NEIGHBOR'
  | 'CLAW_WIN'
  | 'VENDING_PULL'
  | 'BURIED_FIND'
  | 'CHECKPOINT_SAVED'
  | 'FIVE_BEACHES';

const unlocked = new Set<SteamAchievementId>();
let lastPresenceKey = '';

/** Unlock a Steam achievement at most once per session (no-op outside Steam). */
export function unlockSteamAchievement(id: SteamAchievementId): void {
  if (unlocked.has(id)) return;
  const steam = steamBridge();
  if (!steam) return;
  unlocked.add(id);
  steam.unlockAchievement(id);
}

/** Update Steam Rich Presence when the beach or view changes (no-op outside Steam). */
export function updateSteamRichPresence(beachName: string, mode: 'diorama' | 'chair'): void {
  const steam = steamBridge();
  if (!steam) return;
  const display = mode === 'chair' ? '#Status_Chair' : '#Status_AtBeach';
  const key = `${display}|${beachName}`;
  if (key === lastPresenceKey) return;
  lastPresenceKey = key;
  steam.setRichPresence('beach', beachName);
  steam.setRichPresence('steam_display', display);
}

/** Reset deduplication state (tests only). */
export function resetSteamFeatureState(): void {
  unlocked.clear();
  lastPresenceKey = '';
}
