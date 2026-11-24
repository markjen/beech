// Cozy local hunger notification scheduling (docs/ANIMALS.md, Phase 3a).
//
// Schedules a single gentle reminder 24 h after the pet was last fed, pushing
// out of local quiet hours (22:00–08:00) to 08:00 the next morning. Uses
// Capacitor's LocalNotifications plugin when available in native shells, and
// safely no-ops when absent or disabled.

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

interface CapLocalNotifications {
  schedule(opts: { notifications: { id: number; title: string; body: string; schedule: { at: Date } }[] }): Promise<void>;
  cancel(opts: { notifications: { id: number }[] }): Promise<void>;
}

function nativeLocalNotifications(): CapLocalNotifications | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: { LocalNotifications?: CapLocalNotifications } } }).Capacitor;
  return cap?.Plugins?.LocalNotifications ?? null;
}

const PET_NOTIFY_ID = 7351;

/** Schedule (or replace) the single local hunger reminder on iOS/Android. */
export async function schedulePetHungerReminder(petName: string, beachName: string, lastFedAt: number, now = Date.now()): Promise<boolean> {
  const plugin = nativeLocalNotifications();
  if (!plugin) return false;
  const at = new Date(nextPetNotifyTime(lastFedAt, now));
  const label = petName || 'Your sand crab';
  try {
    await plugin.cancel({ notifications: [{ id: PET_NOTIFY_ID }] }).catch(() => {});
    await plugin.schedule({
      notifications: [
        {
          id: PET_NOTIFY_ID,
          title: 'beech',
          body: `${label} is getting hungry on ${beachName || 'your beach'}.`,
          schedule: { at },
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}
