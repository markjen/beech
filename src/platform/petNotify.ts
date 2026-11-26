import { Capacitor } from '@capacitor/core';

const HUNGRY_DELAY_MS = 24 * 3600 * 1000;
const QUIET_START_HOUR = 22;
const QUIET_END_HOUR = 8;

/**
 * Compute the timestamp (ms) for the next pet hunger notification, respecting
 * local quiet hours [22:00, 08:00). Always strictly in the future relative to
 * `now` (at least 60 s ahead).
 */
export function nextPetNotifyTime(lastFedAt: number, now: number): number {
  const target = Math.max(now + 60_000, lastFedAt + HUNGRY_DELAY_MS);
  const d = new Date(target);
  const h = d.getHours();
  if (h >= QUIET_START_HOUR) {
    d.setDate(d.getDate() + 1);
    d.setHours(QUIET_END_HOUR, 0, 0, 0);
    return d.getTime();
  }
  if (h < QUIET_END_HOUR) {
    d.setHours(QUIET_END_HOUR, 0, 0, 0);
    return d.getTime();
  }
  return target;
}

const PET_NOTIFY_ID = 7351;
let pending = Promise.resolve();

export function canSchedulePetReminders(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocalNotifications');
}

export async function requestPetReminderPermission(): Promise<boolean> {
  if (!canSchedulePetReminders()) return false;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    return (await LocalNotifications.requestPermissions()).display === 'granted';
  } catch {
    return false;
  }
}

/** Keep a single local reminder. Serialize changes so opting out wins over a pending schedule. */
export function setPetHungerReminder(pet: { name: string; beachName: string; lastFedAt: number } | null): void {
  if (!canSchedulePetReminders()) return;
  pending = pending.then(async () => {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id: PET_NOTIFY_ID }] });
    if (!pet) {
      await LocalNotifications.removeDeliveredNotificationsById({ ids: [PET_NOTIFY_ID] });
      return;
    }
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
    const at = new Date(nextPetNotifyTime(pet.lastFedAt, Date.now()));
    await LocalNotifications.schedule({ notifications: [{
      id: PET_NOTIFY_ID,
      title: 'beech',
      body: `${pet.name || 'Your sand crab'} is getting hungry on ${pet.beachName || 'your beach'}.`,
      schedule: { at, allowWhileIdle: true },
      isExactNotification: false,
    }] });
  }).catch(() => { /* Notifications may be unavailable on this device. */ });
}
